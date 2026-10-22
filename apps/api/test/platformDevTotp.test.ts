import type { PlatformSessionDto } from '@xiro/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { createAdmin } from '../src/platform/admins';
import { totpCode, totpStep } from '../src/platform/crypto';
import { createTestDatabase, testAppConfig, type TestDatabase } from './helpers/db';

/**
 * Código TOTP maestro "123456" para /platform/auth/login: SOLO fuera de producción (facilita probar el panel en
 * local sin tener la app autenticadora a mano). En producción, el formato de 6 dígitos lo sigue exigiendo el esquema
 * de siempre, pero el valor "123456" en sí nunca vale si no es el código real de la cuenta.
 */
const ADMIN_KEY = 'clave-de-prueba-para-el-totp-maestro-0123456789';
let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await createTestDatabase();
});
afterAll(async () => {
  await testDb.drop();
});

async function makeAdmin() {
  return createAdmin(testDb.db, ADMIN_KEY, { email: `admin-${Date.now()}-${Math.random()}@xiro.test`, name: 'Admin de prueba', founder: true });
}

describe('fuera de producción: "123456" siempre entra, sea o no el código real', () => {
  let app: FastifyInstance;
  let cleanupConfig: () => void;

  beforeAll(async () => {
    const { config, cleanup } = testAppConfig({ platform: { adminKey: ADMIN_KEY } });
    cleanupConfig = cleanup;
    app = await buildApp({ db: testDb.db, config }); // testAppConfig no fija production: hereda NODE_ENV=test → production=false
  });
  afterAll(async () => {
    await app.close();
    cleanupConfig();
  });

  it('entra con el código maestro aunque NO sea el código real de la cuenta', async () => {
    const enrollment = await makeAdmin();
    const res = await app.inject({ method: 'POST', url: '/api/platform/auth/login', payload: { email: enrollment.email, password: enrollment.password, totp: '123456' } });
    expect(res.statusCode).toBe(200);
    expect(res.json<PlatformSessionDto>().token).toBeTruthy();
  });

  it('el código real de la cuenta sigue funcionando igual que siempre (no lo reemplaza, lo complementa)', async () => {
    const enrollment = await makeAdmin();
    const res = await app.inject({ method: 'POST', url: '/api/platform/auth/login', payload: { email: enrollment.email, password: enrollment.password, totp: totpCode(enrollment.totpSecret, totpStep()) } });
    expect(res.statusCode).toBe(200);
  });

  it('la contraseña sigue siendo obligatoria: el código maestro no la reemplaza', async () => {
    const enrollment = await makeAdmin();
    const res = await app.inject({ method: 'POST', url: '/api/platform/auth/login', payload: { email: enrollment.email, password: 'contraseña-incorrecta', totp: '123456' } });
    expect(res.statusCode).toBe(401);
  });

  it('cualquier otro código de 6 dígitos que no sea el real (ni "123456") sigue sin servir', async () => {
    const enrollment = await makeAdmin();
    const res = await app.inject({ method: 'POST', url: '/api/platform/auth/login', payload: { email: enrollment.email, password: enrollment.password, totp: '000000' } });
    expect(res.statusCode).toBe(401);
  });
});

describe('en producción: el código maestro nunca vale', () => {
  let app: FastifyInstance;
  let cleanupConfig: () => void;

  beforeAll(async () => {
    const { config, cleanup } = testAppConfig({ platform: { adminKey: ADMIN_KEY }, production: true });
    cleanupConfig = cleanup;
    app = await buildApp({ db: testDb.db, config });
  });
  afterAll(async () => {
    await app.close();
    cleanupConfig();
  });

  it('"123456" se rechaza igual que cualquier código inventado', async () => {
    const enrollment = await makeAdmin();
    const res = await app.inject({ method: 'POST', url: '/api/platform/auth/login', payload: { email: enrollment.email, password: enrollment.password, totp: '123456' } });
    expect(res.statusCode).toBe(401);
  });

  it('el código real de la cuenta sigue siendo el único camino', async () => {
    const enrollment = await makeAdmin();
    const res = await app.inject({ method: 'POST', url: '/api/platform/auth/login', payload: { email: enrollment.email, password: enrollment.password, totp: totpCode(enrollment.totpSecret, totpStep()) } });
    expect(res.statusCode).toBe(200);
  });
});
