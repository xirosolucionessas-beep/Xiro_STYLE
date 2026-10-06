import { PgBoss } from 'pg-boss';
import { buildApp } from './app';
import { loadConfig } from './config';
import type { Ctx } from './context';
import { createDatabase } from './db/client';
import { runMigrations } from './db/migrate';
import { ensureReminderQueue, registerReminderWorker } from './jobs/reminders';
import { scheduleMaintenance } from './maintenance';
import { ConsoleNotifier } from './notifier';
import { createRealtimeBus } from './realtime';
import { WindowCounter } from './security';

const config = loadConfig();
const database = createDatabase(config.database, (error) => console.error('[pg pool]', error.message));

if (config.autoMigrate) await runMigrations(database);

// Su propio pool y esquema (`pgboss`) en la misma base; independiente del pool de la app.
const boss = new PgBoss(config.database.url);
boss.on('error', (error: Error) => console.error('[pg-boss]', error.message));
await boss.start();
await ensureReminderQueue(boss);

// Conexión dedicada para LISTEN/NOTIFY (la Agenda en tiempo real, ver realtime.ts); independiente del pool de la app.
const realtime = createRealtimeBus(config.database, (line) => console.error(line));

const app = await buildApp({ config, db: database.db, boss, realtime, logger: true });
// Contexto propio para el trabajador (no el de las rutas, que buildApp mantiene privado): mismos db/config/notifier,
// pero los limitadores de peticiones no aplican aquí y no se usan.
const workerCtx: Ctx = {
  db: database.db,
  config,
  notifier: new ConsoleNotifier((line) => app.log.info(line)),
  accountLimiter: new WindowCounter(config.rateLimit.accountWindowMinutes * 60_000),
  bookingLimiter: new WindowCounter(60_000),
  boss,
  realtime,
  maps: null, // el trabajador de recordatorios no usa mapas
};
await registerReminderWorker(boss, workerCtx, (line) => app.log.error(line));
const stopMaintenance = scheduleMaintenance(database.db, (message) => app.log.info(message));

let closing = false;
const shutdown = async (signal: string) => {
  if (closing) return;
  closing = true;
  app.log.info(`${signal} recibido: dejando de aceptar peticiones y cerrando…`);
  stopMaintenance();
  // Primero se termina de atender lo que está en curso; después se cierra el pool.
  await app.close();
  await boss.stop();
  await realtime.close();
  await database.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

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
  await boss.stop().catch(() => undefined);
  await realtime.close().catch(() => undefined);
  await database.close().catch(() => undefined);
  process.exit(1);
}
