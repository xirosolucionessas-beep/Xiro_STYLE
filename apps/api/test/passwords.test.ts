import { randomBytes, scryptSync } from 'node:crypto';
import type { AuthSession } from '@xiro/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { users } from '../src/db/schema';
import type { Notifier } from '../src/notifier';
import { configurePasswordHashing, hashPassword, needsRehash, passwordQueueStats, verifyPassword } from '../src/passwords';
import { createTestDatabase, testAppConfig, type TestDatabase } from './helpers/db';

/** Hash con el formato scrypt que usaba la app antes de argon2id (N=16384, r=8, p=1, 64 bytes). */
function legacyScrypt(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return ['scrypt', 16384, 8, 1, salt.toString('base64'), key.toString('base64')].join('$');
}

describe('hash de contraseñas (argon2id + compatibilidad con scrypt)', () => {
  it('argon2id: valida la correcta, rechaza la incorrecta y no pide re-hash', async () => {
    const stored = await hashPassword('Secreta123');
    expect(stored).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await verifyPassword('Secreta123', stored)).toBe(true);
    expect(await verifyPassword('secreta123', stored)).toBe(false);
    expect(needsRehash(stored)).toBe(false);
  });

  it('las cuentas con hash scrypt anterior siguen entrando y quedan marcadas para re-hash', async () => {
    const legacy = legacyScrypt('Secreta123');
    expect(await verifyPassword('Secreta123', legacy)).toBe(true);
    expect(await verifyPassword('Otra123', legacy)).toBe(false);
    expect(needsRehash(legacy)).toBe(true);
  });

  it('un hash con formato desconocido o alterado nunca valida', async () => {
    for (const stored of ['', 'texto-plano', 'md5$abc', '$argon2id$v=19$m=19456,t=2,p=1$roto', 'scrypt$16384$8$1$$']) {
      expect(await verifyPassword('Secreta123', stored)).toBe(false);
    }
    expect(needsRehash('$argon2id$v=19$m=4096,t=3,p=1$x$y')).toBe(true); // parámetros viejos
  });

  it('la cola nunca supera el tope de hashes simultáneos y responde 503 si se desborda', async () => {
    configurePasswordHashing({ concurrency: 2, maxQueue: 3 });
    let peak = 0;
    const timer = setInterval(() => (peak = Math.max(peak, passwordQueueStats().running)), 1);
    try {
      const results = await Promise.allSettled(Array.from({ length: 8 }, () => hashPassword('x')));
      const busy = results.filter((r) => r.status === 'rejected');
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5); // 2 corriendo + 3 en espera
      expect(busy).toHaveLength(3);
      expect((busy[0] as PromiseRejectedResult).reason).toMatchObject({ status: 503, code: 'server_busy', headers: { 'Retry-After': '2' } });
      expect(peak).toBeLessThanOrEqual(2);
      expect(passwordQueueStats()).toMatchObject({ running: 0, waiting: 0 });
    } finally {
      clearInterval(timer);
      configurePasswordHashing({ concurrency: 2, maxQueue: 200 });
    }
  });
});

describe('re-hash transparente al iniciar sesión', () => {
  let app: FastifyInstance;
  let testDb: TestDatabase;
  let cleanup: () => void;
  const notifier: Notifier = { sendOtp: async () => undefined, sendAppointmentReminder: async () => undefined };

  beforeAll(async () => {
    testDb = await createTestDatabase();
    const created = testAppConfig();
    cleanup = created.cleanup;
    app = await buildApp({ db: testDb.db, notifier, config: created.config });
  });
  afterAll(async () => {
    await app.close();
    cleanup();
    await testDb.drop();
  });

  it('una cuenta con hash scrypt entra, queda en argon2id y sus sesiones abiertas siguen válidas', async () => {
    const email = 'rehash@correo.com';
    const registered = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { name: 'Ana', businessName: 'Rehash', businessType: 'beauty_salon', email, password: 'Secreta123', acceptTerms: true, language: 'es' } });
    expect(registered.statusCode).toBe(201);
    const session = registered.json<AuthSession>();
    // Se simula una cuenta creada antes de argon2id.
    await testDb.db.update(users).set({ passwordHash: legacyScrypt('Secreta123') }).where(eq(users.email, email));
    const [before] = await testDb.db.select({ changedAt: users.passwordChangedAt }).from(users).where(eq(users.email, email));

    expect((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { identifier: email, password: 'Incorrecta1' } })).statusCode).toBe(401);
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { identifier: email, password: 'Secreta123' } });
    expect(login.statusCode).toBe(200);

    const [after] = await testDb.db.select({ hash: users.passwordHash, changedAt: users.passwordChangedAt }).from(users).where(eq(users.email, email));
    expect(after!.hash).toMatch(/^\$argon2id\$/);
    expect(after!.changedAt.getTime()).toBe(before!.changedAt.getTime()); // el re-hash no invalida sesiones
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${session.accessToken}` } })).statusCode).toBe(200);
    // Y sigue entrando con la misma contraseña (ahora contra argon2id).
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { identifier: email, password: 'Secreta123' } })).statusCode).toBe(200);
  });
});
