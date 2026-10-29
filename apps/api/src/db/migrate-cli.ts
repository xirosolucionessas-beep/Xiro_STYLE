import { loadConfig } from '../config';
import { createDatabase, directDatabaseConfig } from './client';
import { runMigrations } from './migrate';

const config = loadConfig();
// El candado de las migraciones es de sesión: siempre por la conexión directa (DATABASE_DIRECT_URL si existe).
const handle = createDatabase(directDatabaseConfig(config.database, 1));
try {
  await runMigrations(handle);
  console.log('Migraciones aplicadas.');
} finally {
  await handle.close();
}
