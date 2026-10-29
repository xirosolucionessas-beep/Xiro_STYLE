/**
 * PostgreSQL DEDICADO a las pruebas de carga (binarios oficiales vía embedded-postgres), separado de la base de
 * desarrollo: datos en apps/api/data/carga/pg, puerto 54330 (LOADTEST_PG_PORT). Déjalo corriendo en otra terminal:
 *
 *   npm run load:db -w @xiro/api
 *
 * Si ya tienes un PostgreSQL para la carga (p. ej. uno igual al de producción), sáltate esto y define
 * LOADTEST_ADMIN_URL=postgres://usuario:clave@host:5432/postgres (debe poder crear la base `xiro_carga`).
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { LOAD_DIR, PG_PORT, ensureDatabase } from './lib';

const databaseDir = path.join(LOAD_DIR, 'pg');
const fresh = !existsSync(path.join(databaseDir, 'PG_VERSION'));
const server = new EmbeddedPostgres({ databaseDir, user: 'xiro', password: 'xiro', port: PG_PORT, persistent: true, onLog: () => undefined, onError: (e) => console.error(e) });
if (fresh) await server.initialise();
await server.start();
await ensureDatabase();
console.log(`PostgreSQL de carga listo en 127.0.0.1:${PG_PORT} (base xiro_carga). Ctrl+C para detenerlo.`);

const stop = async () => {
  await server.stop();
  process.exit(0);
};
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
setInterval(() => undefined, 1 << 30);
