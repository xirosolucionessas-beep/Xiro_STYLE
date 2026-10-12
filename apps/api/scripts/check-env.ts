/**
 * Verifica la configuración ANTES de desplegar (Fase 4): aplica exactamente las mismas reglas que el arranque de la API
 * (config.ts: loadConfig + assertStartupReady) sin conectar a nada, y muestra un resumen SIN valores secretos.
 *
 *   npm run env:check -w @xiro/api                                    → usa apps/api/.env
 *   npx tsx --env-file=.env.production scripts/check-env.ts           → un archivo concreto (desde apps/api)
 *
 * Sale con código 1 y el motivo si algo crítico falta o es inválido (la API tampoco arrancaría).
 */
import { assertStartupReady, loadConfig } from '../src/config';

try {
  const config = loadConfig();
  assertStartupReady(config);
  const yes = (value: unknown) => (value ? 'sí' : 'no');
  const summary: Array<[string, string]> = [
    ['Entorno', config.production ? 'producción' : 'desarrollo'],
    ['Base de datos', `${config.database.ssl === 'disable' ? 'sin TLS' : `TLS (${config.database.ssl})`}, pool ${config.database.poolMin}–${config.database.poolMax}${config.database.directUrl ? ', con conexión directa' : ''}`],
    ['Redis (límites y caché compartidos)', yes(config.redis.url)],
    ['Imágenes', config.media.storage === 's3' ? `S3/R2 (bucket ${config.media.bucket})` : 'carpeta local'],
    ['CORS (orígenes permitidos)', config.corsOrigins.join(', ') || '(ninguno: solo mismo origen)'],
    ['HSTS / CSP', `${yes(config.security.hsts)} / ${yes(config.security.csp)}`],
    ['Proxy de confianza', String(config.trustProxy)],
    ['Migraciones al arrancar', yes(config.autoMigrate)],
    ['Envío de códigos (OTP)', config.notifications.provider],
    ['Captcha (Turnstile)', yes(config.booking.turnstileSecret)],
    ['Sentry', yes(config.observability.sentryDsn)],
    ['Métricas /api/metrics', yes(config.observability.metricsToken)],
    ['Versión (RELEASE)', config.observability.release ?? '(sin definir)'],
  ];
  const width = Math.max(...summary.map(([label]) => label.length));
  console.log('Configuración válida:\n');
  for (const [label, value] of summary) console.log(`  ${label.padEnd(width)}  ${value}`);
  if (config.production && !config.observability.sentryDsn) console.log('\nAviso: sin SENTRY_DSN los errores solo quedan en los logs.');
  if (config.production && config.corsOrigins.length === 0) console.log('\nAviso: CORS_ORIGINS vacío: solo funcionará la web servida por esta misma API.');
} catch (error) {
  console.error(`Configuración INVÁLIDA: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
