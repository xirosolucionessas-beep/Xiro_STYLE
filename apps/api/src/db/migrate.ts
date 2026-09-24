import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { DatabaseHandle } from './client';

export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));
const LOCK_KEY = 7_262_026; // clave arbitraria y estable del advisory lock de migraciones

/**
 * Aplica las migraciones pendientes. Con varias instancias arrancando a la vez, un advisory lock de sesión
 * garantiza que solo una migra; las demás esperan y encuentran todo aplicado.
 */
export async function runMigrations(handle: DatabaseHandle): Promise<void> {
  const client = await handle.pool.connect();
  try {
    await client.query('select pg_advisory_lock($1)', [LOCK_KEY]);
    await migrate(handle.db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await client.query('select pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => undefined);
    client.release();
  }
}
