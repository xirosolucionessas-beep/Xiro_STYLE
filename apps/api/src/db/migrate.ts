import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { DatabaseHandle } from './client';

export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));
const LOCK_KEY = 7_262_026; // clave arbitraria y estable del advisory lock de migraciones

/**
 * Aplica las migraciones pendientes. Con varias instancias arrancando a la vez, un advisory lock de sesión
 * garantiza que solo una migra; las demás esperan y encuentran todo aplicado. Las migraciones corren en la MISMA
 * conexión que tiene el candado: así bastan pools de una sola conexión (migrate-cli, server.ts con DATABASE_DIRECT_URL)
 * y el candado protege exactamente la sesión que migra.
 */
export async function runMigrations(handle: DatabaseHandle): Promise<void> {
  const client = await handle.pool.connect();
  try {
    await client.query('select pg_advisory_lock($1)', [LOCK_KEY]);
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await client.query('select pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => undefined);
    client.release();
  }
}
