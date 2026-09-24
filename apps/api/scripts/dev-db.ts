/**
 * PostgreSQL local para desarrollo sin instalar nada (binarios oficiales vía embedded-postgres).
 * Los datos persisten en apps/api/data/pg; el puerto y las credenciales coinciden con el DATABASE_URL de .env.example.
 * Detén con Ctrl+C.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';

const port = Number(process.env.DEV_DB_PORT ?? 54320);
const databaseDir = path.resolve('data', 'pg');
const fresh = !existsSync(path.join(databaseDir, 'PG_VERSION'));

const server = new EmbeddedPostgres({ databaseDir, user: 'xiro', password: 'xiro', port, persistent: true, onLog: () => undefined, onError: (e) => console.error(e) });
if (fresh) await server.initialise();
await server.start();
if (fresh) await server.createDatabase('xiro');

// Comprobación de que responde.
const client = new pg.Client({ connectionString: `postgres://xiro:xiro@localhost:${port}/xiro` });
await client.connect();
const { rows } = await client.query('select version()');
await client.end();
console.log(`PostgreSQL listo en localhost:${port} (${String(rows[0]?.version).split(',')[0]})\nDATABASE_URL=postgres://xiro:xiro@localhost:${port}/xiro`);

const stop = async () => {
  await server.stop();
  process.exit(0);
};
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
setInterval(() => undefined, 1 << 30); // mantiene el proceso vivo
