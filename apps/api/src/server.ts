import { buildApp } from './app';
import { loadConfig } from './config';
import { createDatabase } from './db/client';
import { runMigrations } from './db/migrate';
import { scheduleMaintenance } from './maintenance';

const config = loadConfig();
const database = createDatabase(config.database, (error) => console.error('[pg pool]', error.message));

if (config.autoMigrate) await runMigrations(database);

const app = await buildApp({ config, db: database.db, logger: true });
const stopMaintenance = scheduleMaintenance(database.db, (message) => app.log.info(message));

let closing = false;
const shutdown = async (signal: string) => {
  if (closing) return;
  closing = true;
  app.log.info(`${signal} recibido: dejando de aceptar peticiones y cerrando…`);
  stopMaintenance();
  // Primero se termina de atender lo que está en curso; después se cierra el pool.
  await app.close();
  await database.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ port: config.port, host: config.host });
} catch (error) {
  app.log.error(error);
  await database.close().catch(() => undefined);
  process.exit(1);
}
