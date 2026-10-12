import { drizzle, type NodePgDatabase, type NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import pg from 'pg';
import type { DatabaseConfig } from '../config';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;
/** Base común de la base de datos y de una transacción: las funciones de datos aceptan ambas. */
export type DbExecutor = PgDatabase<NodePgQueryResultHKT, typeof schema>;

export interface DatabaseHandle {
  db: Database;
  pool: pg.Pool;
  /** Cierra el pool esperando a que terminen las consultas en curso. */
  close: () => Promise<void>;
}

export function poolOptions(config: DatabaseConfig): pg.PoolConfig {
  return {
    connectionString: config.url,
    max: config.poolMax,
    min: config.poolMin,
    // Una conexión ociosa se cierra pasado este tiempo (no acumula conexiones muertas tras un pico).
    idleTimeoutMillis: config.idleTimeoutMs,
    // Si el pool está saturado, la petición falla rápido en vez de esperar indefinidamente.
    connectionTimeoutMillis: config.connectionTimeoutMs,
    // Límite en el servidor y en el cliente: una consulta atascada no retiene una conexión para siempre. Detrás de
    // PgBouncer/pooler (`sessionParams: 'none'`) los dos del servidor van en el rol; el del cliente se mantiene siempre.
    ...(config.sessionParams === 'none' ? {} : { statement_timeout: config.statementTimeoutMs, idle_in_transaction_session_timeout: config.statementTimeoutMs * 2 }),
    query_timeout: config.statementTimeoutMs + 2_000,
    maxLifetimeSeconds: config.maxLifetimeSeconds > 0 ? config.maxLifetimeSeconds : undefined,
    application_name: config.applicationName,
    keepAlive: true,
    ssl: config.ssl === 'disable' ? false : { rejectUnauthorized: config.ssl === 'require' },
  };
}

/**
 * Configuración para una conexión DIRECTA (sin pooler): la de `directUrl` si existe, siempre con parámetros de sesión
 * (una conexión directa sí los acepta). La usan las migraciones; LISTEN y pg-boss toman `directUrl` igual.
 */
export function directDatabaseConfig(config: DatabaseConfig, poolMax = config.poolMax): DatabaseConfig {
  return { ...config, url: config.directUrl ?? config.url, sessionParams: 'startup', poolMax, poolMin: Math.min(config.poolMin, poolMax) };
}

export function createDatabase(config: DatabaseConfig, onError: (error: Error) => void = console.error): DatabaseHandle {
  const pool = new pg.Pool(poolOptions(config));
  // Un error en una conexión ociosa (p. ej. reinicio del servidor) no debe tumbar el proceso.
  pool.on('error', onError);
  const db = drizzle(pool, { schema });
  return { db, pool, close: () => pool.end() };
}
