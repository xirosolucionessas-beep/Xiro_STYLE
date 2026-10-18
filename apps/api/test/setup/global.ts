import { mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    pgAdminUrl: string;
  }
}

// embedded-postgres registra (vía async-exit-hook) un manejador de 'beforeExit' que llama a process.exit(0) y borra el
// código de salida que Vitest fija al fallar una prueba: la suite fallaba y el CI la daba por buena. Se restaura aquí.
let failedExitCode: number | undefined;
process.prependListener('beforeExit', () => {
  const code = Number(process.exitCode ?? 0);
  if (code !== 0) failedExitCode = code;
});
process.on('exit', () => {
  if (failedExitCode !== undefined && Number(process.exitCode ?? 0) === 0) process.exitCode = failedExitCode;
});

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });

/**
 * Las pruebas de la API corren contra un PostgreSQL REAL (no un emulador): mismas restricciones, índices, bloqueos y
 * transacciones que en producción. Con TEST_DATABASE_URL se usa ese servidor (p. ej. un servicio de CI); sin ella se
 * levanta uno efímero con binarios oficiales.
 */
export default async function setup(project: TestProject) {
  if (process.env.TEST_DATABASE_URL) {
    project.provide('pgAdminUrl', process.env.TEST_DATABASE_URL);
    return;
  }

  const dir = mkdtempSync(path.join(tmpdir(), 'xiro-pg-'));
  const port = await freePort();
  const server = new EmbeddedPostgres({ databaseDir: dir, user: 'xiro', password: 'xiro', port, persistent: false, onLog: () => undefined, onError: () => undefined });
  await server.initialise();
  await server.start();
  project.provide('pgAdminUrl', `postgres://xiro:xiro@127.0.0.1:${port}/postgres`);

  return async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  };
}
