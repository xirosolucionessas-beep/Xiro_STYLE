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
    // Límite en el servidor y en el cliente: una consulta atascada no retiene una conexión para siempre.
    statement_timeout: config.statementTimeoutMs,
    query_timeout: config.statementTimeoutMs + 2_000,
    idle_in_transaction_session_timeout: config.statementTimeoutMs * 2,
    maxLifetimeSeconds: config.maxLifetimeSeconds > 0 ? config.maxLifetimeSeconds : undefined,
    application_name: config.applicationName,
    keepAlive: true,
    ssl: config.ssl === 'disable' ? false : { rejectUnauthorized: config.ssl === 'require' },
  };
}

export function createDatabase(config: DatabaseConfig, onError: (error: Error) => void = console.error): DatabaseHandle {
  const pool = new pg.Pool(poolOptions(config));
  // Un error en una conexión ociosa (p. ej. reinicio del servidor) no debe tumbar el proceso.
  pool.on('error', onError);
  const db = drizzle(pool, { schema });
  return { db, pool, close: () => pool.end() };
}
