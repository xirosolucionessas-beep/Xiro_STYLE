import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { inject } from 'vitest';
import type { BuildOptions } from '../../src/app';
import { loadConfig, type DatabaseConfig } from '../../src/config';
import { createDatabase, type DatabaseHandle } from '../../src/db/client';
import { runMigrations } from '../../src/db/migrate';

export interface TestDatabase extends DatabaseHandle {
  url: string;
  config: DatabaseConfig;
  /** Cierra el pool y elimina la base de datos de prueba. */
  drop: () => Promise<void>;
}

/** Crea una base de datos vacía y migrada, aislada de las de otros archivos de pruebas. */
export async function createTestDatabase(overrides: Partial<DatabaseConfig> = {}): Promise<TestDatabase> {
  const adminUrl = inject('pgAdminUrl');
  const name = `xiro_test_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`create database ${name}`);
  await admin.end();

  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const config: DatabaseConfig = { ...loadConfig({ NODE_ENV: 'test' } as NodeJS.ProcessEnv).database, url: url.toString(), ssl: 'disable', poolMax: 10, ...overrides };
  const handle = createDatabase(config, () => undefined);
  await runMigrations(handle);

  return {
    ...handle,
    url: config.url,
    config,
    drop: async () => {
      await handle.close();
      const cleaner = new pg.Client({ connectionString: adminUrl });
      await cleaner.connect();
      await cleaner.query(`drop database if exists ${name} with (force)`);
      await cleaner.end();
    },
  };
}

/** Configuración de la app para pruebas: sin límites de peticiones (salvo que la prueba los pida) y con un directorio temporal. */
export function testAppConfig(overrides: BuildOptions['config'] = {}): { config: NonNullable<BuildOptions['config']>; cleanup: () => void } {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'xiro-test-'));
  return {
    config: {
      dataDir,
      mediaDir: path.join(dataDir, 'media'),
      jwtSecret: 'test-secret-test-secret-test-secret-123',
      webDir: null,
      exposeDevOtp: false,
      corsOrigins: ['http://localhost:8081'],
      exports: { workers: 0, queueMax: 20, timeoutMs: 60_000, workerMemoryMb: 256 },
      ...overrides,
      rateLimit: { enabled: false, ...overrides.rateLimit },
    },
    cleanup: () => rmSync(dataDir, { recursive: true, force: true }),
  };
}
