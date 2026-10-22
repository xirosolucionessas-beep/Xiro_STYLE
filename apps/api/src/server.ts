import { PgBoss } from 'pg-boss';
import { buildApp } from './app';
import { assertStartupReady, loadConfig } from './config';
import type { Ctx } from './context';
import { createDatabase, directDatabaseConfig } from './db/client';
import { runMigrations } from './db/migrate';
import { ensureBirthdaySchedule, registerBirthdayWorker } from './jobs/birthdays';
import { ensureReminderQueue, registerReminderWorker } from './jobs/reminders';
import { scheduleMaintenance } from './maintenance';
import { flushMonitoring, initMonitoring, reportError } from './monitoring';
import { createNotifier } from './notifier';
import { createRealtimeBus } from './realtime';
import { PublicCache, RedisCacheBackend } from './publicCache';
import { FallbackRateStore, MemoryRateStore, RateLimits, RedisRateStore } from './rateStore';
import { createRedis } from './redis';
import { LocalMediaStore, S3MediaStore } from './storage';
import { ExportPool } from './exports/pool';

const config = loadConfig();
assertStartupReady(config);
const monitoring = await initMonitoring(config.observability);

/**
 * Errores que se escaparon de todo manejo (Fase 4). Se registran desde el primer momento (antes de migrar o conectar):
 *  - uncaughtException: el proceso quedó en un estado desconocido → se registra, se reporta y se cierra ordenadamente con
 *    código 1 para que el orquestador lo reinicie limpio.
 *  - unhandledRejection: una promesa sin `catch` (p. ej. un aviso push de "disparar y olvidar" que falló) → se registra y
 *    se reporta, pero NO tumba la API: un fallo de Expo o de Google no debe dejar sin servicio a todos los negocios.
 */
let fatal: ((error: unknown) => void) | null = null;
process.on('uncaughtException', (error) => {
  console.error('[fatal] uncaughtException', error);
  reportError(error, { source: 'uncaughtException' });
  if (fatal) fatal(error);
  else void flushMonitoring().finally(() => process.exit(1));
});
process.on('unhandledRejection', (reason) => {
  console.error('[error] unhandledRejection', reason);
  reportError(reason, { source: 'unhandledRejection' });
});
const database = createDatabase(config.database, (error) => console.error('[pg pool]', error.message));

if (config.autoMigrate) {
  // El candado de las migraciones es de sesión: con un pooler delante se usa la conexión directa.
  if (config.database.directUrl) {
    const direct = createDatabase(directDatabaseConfig(config.database, 1), (error) => console.error('[pg migrate]', error.message));
    try {
      await runMigrations(direct);
    } finally {
      await direct.close();
    }
  } else await runMigrations(database);
}

// Su propio pool y esquema (`pgboss`) en la misma base; independiente del pool de la app. Conexión directa si la hay.
const boss = new PgBoss(config.database.directUrl ?? config.database.url);
boss.on('error', (error: Error) => console.error('[pg-boss]', error.message));
await boss.start();
await ensureReminderQueue(boss);
await ensureBirthdaySchedule(boss);

// Conexión dedicada para LISTEN/NOTIFY (la Agenda en tiempo real, ver realtime.ts); independiente del pool de la app.
const realtime = createRealtimeBus(config.database, (line) => console.error(line));

// Redis compartido (límites de abuso entre instancias y caché pública). Obligatorio en producción (ver config.ts).
const redis = config.redis.url ? createRedis(config.redis.url, (error) => console.error('[redis]', error.message)) : null;

const app = await buildApp({ config, db: database.db, boss, realtime, redis, logger: true });
// El trabajador comparte el mismo almacén de límites (no los usa, pero el contexto debe estar completo).
const workerRates = new RateLimits(redis ? new FallbackRateStore(new RedisRateStore(redis), new MemoryRateStore(), () => undefined) : new MemoryRateStore());
// Contexto propio para el trabajador (no el de las rutas, que buildApp mantiene privado): mismos db/config/notifier,
// pero los limitadores de peticiones no aplican aquí y no se usan.
const workerCtx: Ctx = {
  db: database.db,
  config,
  notifier: createNotifier(config, (line) => app.log.info(line)),
  accountLimiter: workerRates.limiter('account', config.rateLimit.accountWindowMinutes * 60_000),
  bookingLimiter: workerRates.limiter('booking-business', 60_000),
  rates: workerRates,
  media: config.media.storage === 's3' ? new S3MediaStore(config.media) : new LocalMediaStore(config.mediaDir),
  redis,
  // Mismo Redis que la API: si algún trabajo cambiara datos públicos, su invalidación llega a todas las instancias.
  publicCache: new PublicCache(redis ? new RedisCacheBackend(redis) : null, config.publicCacheTtlSeconds),
  // El trabajador de la cola no genera descargas: sin hilos propios.
  exports: new ExportPool({ ...config.exports, workers: 0 }),
  boss,
  realtime,
  maps: null, // el trabajador de recordatorios no usa mapas
};
await registerReminderWorker(boss, workerCtx, (line) => app.log.error(line));
await registerBirthdayWorker(boss, workerCtx, (line) => app.log.info(line));
const stopMaintenance = scheduleMaintenance(database.db, (message) => app.log.info(message));

let closing = false;
const shutdown = async (signal: string, exitCode = 0) => {
  if (closing) return;
  closing = true;
  app.log.info(`${signal} recibido: dejando de aceptar peticiones y cerrando…`);
  // Si algo se cuelga al cerrar (una conexión que no suelta, un trabajo atascado), el orquestador no debe esperar para
  // siempre: pasado el tope se sale con error. `unref` evita que este temporizador por sí solo mantenga vivo el proceso.
  setTimeout(() => {
    app.log.error(`Cierre ordenado excedió ${config.shutdownTimeoutMs} ms: se fuerza la salida.`);
    process.exit(1);
  }, config.shutdownTimeoutMs).unref();
  // Cada paso protegido: si uno falla, los demás igual se cierran.
  const step = (promise: Promise<unknown> | undefined) => promise?.catch((error: unknown) => app.log.error({ err: error }, 'Error durante el cierre'));
  stopMaintenance();
  // Primero se termina de atender lo que está en curso; después se cierra el pool.
  await step(app.close());
  await step(boss.stop());
  await step(realtime.close());
  await step(redis?.quit());
  await step(database.close());
  await flushMonitoring();
  process.exit(exitCode);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
fatal = (error) => {
  app.log.fatal({ err: error }, 'Error no controlado: cierre ordenado para reiniciar limpio');
  void shutdown('uncaughtException', 1);
};
app.log.info({ monitoring, release: config.observability.release }, monitoring ? 'Sentry activo (solo errores, sin datos personales)' : 'Sentry inactivo (sin SENTRY_DSN)');

// Google Maps: solo se dice si las claves están presentes (nunca su valor). Sin la del servidor no hay buscador de direcciones
// ni imagen del mapa en la página pública; sin la del navegador, el selector de "Mi página web" no muestra el mapa arrastrable.
const hasServerKey = Boolean(config.booking.googleServerKey);
const hasBrowserKey = Boolean(config.booking.googleBrowserKey);
app.log.info(
  { googleServerKey: hasServerKey, googleBrowserKey: hasBrowserKey },
  hasServerKey
    ? `Google Maps: clave del servidor presente (buscador y mapa de la página pública activos); clave del navegador ${hasBrowserKey ? 'presente' : 'ausente (sin mapa arrastrable)'}`
    : 'Google Maps: clave del servidor AUSENTE (define GOOGLE_MAPS_SERVER_KEY en apps/api/.env y reinicia): sin buscador de direcciones ni imagen de mapa',
);

try {
  await app.listen({ port: config.port, host: config.host });
} catch (error) {
  app.log.error(error);
  reportError(error, { source: 'listen' });
  await flushMonitoring();
  await boss.stop().catch(() => undefined);
  await realtime.close().catch(() => undefined);
  await redis?.quit().catch(() => undefined);
  await database.close().catch(() => undefined);
  process.exit(1);
}
