import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import type { Notifier } from '../src/notifier';
import { FallbackRateStore, MemoryRateStore, RateLimits, RedisRateStore, type RateStore } from '../src/rateStore';
import { createTestDatabase, testAppConfig, type TestDatabase } from './helpers/db';

/**
 * Límites de abuso compartidos (Fase 2, punto 5): mismo comportamiento con memoria o Redis, espacios de nombres
 * separados, Retry-After correcto, respaldo si Redis cae y bloqueo de inicio de sesión por cuenta Y por IP.
 */

/** Pruebas comunes a cualquier almacén (se corren con memoria y, si hay REDIS_TEST_URL, con Redis real). */
function storeContract(name: string, makeStore: () => RateStore, clock?: { advance: (ms: number) => void }) {
  describe(`almacén de límites: ${name}`, () => {
    it('cuenta por clave dentro de la ventana y separa los espacios de nombres', async () => {
      const rates = new RateLimits(makeStore());
      const login = rates.limiter(`login-${Date.now()}`, 60_000);
      const booking = rates.limiter(`booking-${Date.now()}`, 60_000);
      expect(await login.hit('ana')).toBe(1);
      expect(await login.hit('ana')).toBe(2);
      expect(await login.hit('beto')).toBe(1);
      expect(await booking.hit('ana')).toBe(1); // misma clave, otro límite: no se pisan
      expect(await login.count('ana')).toBe(2);
      expect(await login.count('nadie')).toBe(0);
      const retry = await login.retryAfterSeconds('ana');
      expect(retry).toBeGreaterThanOrEqual(1);
      expect(retry).toBeLessThanOrEqual(60);
      await login.reset('ana');
      expect(await login.count('ana')).toBe(0);
    });

    if (clock) {
      it('la ventana vence y vuelve a empezar', async () => {
        const rates = new RateLimits(makeStore());
        const limiter = rates.limiter('ventana', 1_000);
        await limiter.hit('x');
        await limiter.hit('x');
        clock.advance(1_001);
        expect(await limiter.count('x')).toBe(0);
        expect(await limiter.hit('x')).toBe(1);
      });
    }
  });
}

let now = 1_000_000;
storeContract('memoria', () => new MemoryRateStore(() => now), { advance: (ms) => (now += ms) });

const redisUrl = process.env.REDIS_TEST_URL;
if (redisUrl) {
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  afterAll(() => redis.quit());
  storeContract('Redis real (REDIS_TEST_URL)', () => new RedisRateStore(redis, `xiro:test:${Date.now()}:`));
} else {
  describe.skip('almacén de límites: Redis real — define REDIS_TEST_URL=redis://… para correrla', () => {
    it('omitida', () => undefined);
  });
}

describe('respaldo si Redis cae', () => {
  it('usa memoria mientras Redis falla, avisa una sola vez y vuelve a Redis cuando responde', async () => {
    let down = true;
    const redisLike = new MemoryRateStore();
    const flaky: RateStore = {
      kind: 'redis',
      hit: (key, ms) => (down ? Promise.reject(new Error('ECONNREFUSED')) : redisLike.hit(key, ms)),
      peek: (key) => (down ? Promise.reject(new Error('ECONNREFUSED')) : redisLike.peek(key)),
      reset: (key) => (down ? Promise.reject(new Error('ECONNREFUSED')) : redisLike.reset(key)),
    };
    const warnings: unknown[] = [];
    const limiter = new RateLimits(new FallbackRateStore(flaky, new MemoryRateStore(), (error) => warnings.push(error))).limiter('login', 60_000);

    expect(await limiter.hit('ana')).toBe(1); // sin Redis: sigue contando (protege) en lugar de fallar
    expect(await limiter.hit('ana')).toBe(2);
    expect(warnings).toHaveLength(1); // un aviso por caída, no uno por petición
    down = false;
    expect(await limiter.hit('ana')).toBe(1); // Redis volvió: cuenta ahí
    down = true;
    await limiter.hit('ana');
    expect(warnings).toHaveLength(2); // nueva caída, nuevo aviso
  });
});

describe('bloqueo de inicio de sesión por cuenta y por IP', () => {
  let app: FastifyInstance;
  let testDb: TestDatabase;
  let cleanup: () => void;
  const notifier: Notifier = { sendOtp: async () => undefined, sendAppointmentReminder: async () => undefined };

  beforeAll(async () => {
    testDb = await createTestDatabase();
    // 2 intentos por cuenta → la IP se bloquea a los 2 × 5 = 10 fallos (cuentas distintas incluidas).
    const created = testAppConfig({ rateLimit: { enabled: true, accountAttempts: 2, authPerMinute: 1_000, globalPerMinute: 10_000, userPerMinute: 10_000 } });
    cleanup = created.cleanup;
    app = await buildApp({ db: testDb.db, notifier, config: created.config });
  });
  afterAll(async () => {
    await app.close();
    cleanup();
    await testDb.drop();
  });

  const login = (identifier: string, password: string, ip = '203.0.113.7') => app.inject({ method: 'POST', url: '/api/auth/login', payload: { identifier, password }, remoteAddress: ip });

  it('una cuenta se bloquea tras sus intentos fallidos aunque cambie la IP, con Retry-After', async () => {
    const email = 'bloqueo@correo.com';
    expect((await app.inject({ method: 'POST', url: '/api/auth/register', payload: { name: 'Ana', businessName: 'Bloqueo', businessType: 'beauty_salon', email, password: 'Secreta123', acceptTerms: true, language: 'es' } })).statusCode).toBe(201);
    expect((await login(email, 'Mala1234', '198.51.100.1')).statusCode).toBe(401);
    expect((await login(email, 'Mala1234', '198.51.100.2')).statusCode).toBe(401);
    const blocked = await login(email, 'Secreta123', '198.51.100.3'); // ni con la correcta, ni desde otra IP
    expect(blocked.statusCode).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('una IP que prueba muchas cuentas distintas se bloquea aunque ninguna cuenta llegue a su límite', async () => {
    const ip = '192.0.2.50';
    for (let i = 0; i < 10; i += 1) expect((await login(`no-existe-${i}@correo.com`, 'Mala1234', ip)).statusCode).toBe(401);
    const blocked = await login('otra-mas@correo.com', 'Mala1234', ip);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toMatchObject({ code: 'too_many_requests' });
    // Otra IP no queda afectada.
    expect((await login('otra-mas@correo.com', 'Mala1234', '192.0.2.51')).statusCode).toBe(401);
  });

  it('las respuestas no revelan si la cuenta existe', async () => {
    const unknown = await login('nadie-aqui@correo.com', 'Mala1234', '192.0.2.99');
    const wrong = await login('bloqueo2@correo.com', 'Mala1234', '192.0.2.98');
    expect(unknown.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    expect(unknown.json()).toEqual(wrong.json());
  });
});
