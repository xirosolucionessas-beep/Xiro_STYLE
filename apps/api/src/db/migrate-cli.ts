import { loadConfig } from '../config';
import { createDatabase } from './client';
import { runMigrations } from './migrate';

const config = loadConfig();
const handle = createDatabase(config.database);
try {
  await runMigrations(handle);
  console.log('Migraciones aplicadas.');
} finally {
  await handle.close();
}
