import type { PublicBookingCatalog, PublicBookingProfile } from '@xiro/shared';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import type { Notifier } from '../src/notifier';
import { MemoryCacheBackend, PublicCache, RedisCacheBackend, type CacheBackend } from '../src/publicCache';
import { auth, setupBiz, type Biz } from './helpers/booking';
import { createTestDatabase, testAppConfig, type TestDatabase } from './helpers/db';

/**
 * Caché de lecturas públicas (Fase 2, punto 11): se reutiliza mientras el negocio no cambie nada, se invalida en cuanto
 * guarda algo, nunca mezcla negocios, no guarda errores y nunca tumba una petición si el almacén falla.
 */

function cacheContract(name: string, makeBackend: () => CacheBackend) {
  describe(`caché pública: ${name}`, () => {
    it('reutiliza lo calculado y vuelve a calcular tras invalidar, solo para ese negocio', async () => {
      const cache = new PublicCache(makeBackend(), 300);
      let calls = 0;
      const compute = (value: string) => async () => ((calls += 1), { value });
      const a = `negocio-a-${Date.now()}`;
      const b = `negocio-b-${Date.now()}`;
      expect(await cache.wrap(a, 'perfil', compute('a1'))).toEqual({ value: 'a1' });
      expect(await cache.wrap(a, 'perfil', compute('a2'))).toEqual({ value: 'a1' }); // de la caché
      expect(await cache.wrap(b, 'perfil', compute('b1'))).toEqual({ value: 'b1' }); // otro negocio, otra entrada
      expect(calls).toBe(2);
      await cache.invalidate(a);
      expect(await cache.wrap(a, 'perfil', compute('a3'))).toEqual({ value: 'a3' });
      expect(await cache.wrap(b, 'perfil', compute('b2'))).toEqual({ value: 'b1' }); // invalidar A no toca B
      expect(calls).toBe(3);
    });

    it('no guarda errores (un 404 se vuelve a consultar)', async () => {
      const cache = new PublicCache(makeBackend(), 300);
      const id = `negocio-${Date.now()}`;
      await expect(cache.wrap(id, 'item', async () => Promise.reject(new Error('no existe')))).rejects.toThrow('no existe');
      expect(await cache.wrap(id, 'item', async () => 'ahora sí')).toBe('ahora sí');
    });

    it('una escritura mientras se calcula deja ese resultado viejo fuera de la caché', async () => {
      const cache = new PublicCache(makeBackend(), 300);
      const id = `negocio-${Date.now()}`;
      const stale = await cache.wrap(id, 'perfil', async () => {
        await cache.invalidate(id); // el negocio guarda un cambio mientras se leía el estado anterior
        return 'viejo';
      });
      expect(stale).toBe('viejo');
      expect(await cache.wrap(id, 'perfil', async () => 'nuevo')).toBe('nuevo');
    });
  });
}

cacheContract('memoria', () => new MemoryCacheBackend());
const redisUrl = process.env.REDIS_TEST_URL;
if (redisUrl) {
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  afterAll(() => redis.quit());
  cacheContract('Redis real (REDIS_TEST_URL)', () => new RedisCacheBackend(redis));
} else {
  describe.skip('caché pública: Redis real — define REDIS_TEST_URL=redis://… para correrla', () => {
    it('omitida', () => undefined);
  });
}

describe('caché pública: límites y fallos', () => {
  it('memoria: respeta el TTL y el tope de tamaño', async () => {
    const backend = new MemoryCacheBackend(4_000); // ~2.000 caracteres
    await backend.set('corta', 'x', 0.05);
    expect(await backend.get('corta')).toBe('x');
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(await backend.get('corta')).toBeNull();
    for (let i = 0; i < 10; i += 1) await backend.set(`k${i}`, 'y'.repeat(400), 60);
    expect(await backend.get('k0')).toBeNull(); // las más viejas salen
    expect(await backend.get('k9')).toBe('y'.repeat(400));
    await backend.set('enorme', 'z'.repeat(1_500), 60); // más de 1/4 del tope: no se guarda
    expect(await backend.get('enorme')).toBeNull();
  });

  it('si el almacén falla responde igual (calculando) y avisa; invalidar nunca lanza', async () => {
    const errors: unknown[] = [];
    const broken: CacheBackend = { kind: 'redis', get: () => Promise.reject(new Error('caído')), set: () => Promise.reject(new Error('caído')), setIfAbsent: () => Promise.reject(new Error('caído')) };
    const cache = new PublicCache(broken, 300, (error) => errors.push(error));
    expect(await cache.wrap('n', 'perfil', async () => 'directo')).toBe('directo');
    await expect(cache.invalidate('n')).resolves.toBeUndefined();
    expect(errors).toHaveLength(2);
  });

  it('TTL 0 o sin almacén: apagada (siempre calcula)', async () => {
    let calls = 0;
    for (const cache of [new PublicCache(new MemoryCacheBackend(), 0), new PublicCache(null, 300)]) {
      expect(cache.enabled).toBe(false);
      await cache.wrap('n', 'x', async () => (calls += 1));
      await cache.wrap('n', 'x', async () => (calls += 1));
    }
    expect(calls).toBe(4);
  });
});

describe('caché pública en la API', () => {
  let app: FastifyInstance;
  let testDb: TestDatabase;
  let cleanup: () => void;
  const notifier: Notifier = { sendOtp: async () => undefined, sendAppointmentReminder: async () => undefined };

  beforeAll(async () => {
    testDb = await createTestDatabase();
    const created = testAppConfig({ publicCacheTtlSeconds: 300 });
    cleanup = created.cleanup;
    app = await buildApp({ db: testDb.db, notifier, config: created.config });
  });
  afterAll(async () => {
    await app.close();
    cleanup();
    await testDb.drop();
  });

  const profile = async (biz: Biz) => (await app.inject({ method: 'GET', url: biz.base })).json<PublicBookingProfile>();
  const catalog = async (biz: Biz) => (await app.inject({ method: 'GET', url: `${biz.base}/catalog` })).json<PublicBookingCatalog>();
  /** Cambio hecho por fuera de la API (como lo haría otra herramienta): la caché no se entera, así se ve si se usó. */
  const sneakTagline = (biz: Biz, tagline: string) => testDb.pool.query('update business_public_profiles set tagline = $2 where business_id = $1', [biz.session.business.id, tagline]);

  it('reutiliza la respuesta pública y la renueva en cuanto el negocio guarda un cambio desde la app', async () => {
    const biz = await setupBiz(app, 'Caché');
    expect((await app.inject({ method: 'PUT', url: '/api/booking/profile', headers: auth(biz.session), payload: { tagline: 'Primera' } })).statusCode).toBe(200);
    expect((await profile(biz)).tagline).toBe('Primera');
    await sneakTagline(biz, 'Por fuera');
    expect((await profile(biz)).tagline).toBe('Primera'); // servida desde la caché

    expect((await app.inject({ method: 'PUT', url: '/api/booking/profile', headers: auth(biz.session), payload: { tagline: 'Segunda' } })).statusCode).toBe(200);
    expect((await profile(biz)).tagline).toBe('Segunda'); // la escritura la invalidó antes de responder

    const before = await catalog(biz);
    const service = before.services.find((s) => s.id === biz.serviceId)!;
    const categoryId = (await app.inject({ method: 'GET', url: '/api/categories', headers: auth(biz.session) })).json<Array<{ id: string }>>()[0]!.id;
    expect((await app.inject({ method: 'PUT', url: `/api/items/${biz.serviceId}`, headers: auth(biz.session), payload: { name: 'Corte nuevo', categoryId, price: 45000, kind: 'service', durationMinutes: 60 } })).statusCode).toBe(200);
    const after = (await catalog(biz)).services.find((s) => s.id === biz.serviceId)!;
    expect(service.name).toBe('Corte');
    expect(after.name).toBe('Corte nuevo');
  });

  it('una escritura rechazada no invalida, y cada negocio tiene su propia caché', async () => {
    const a = await setupBiz(app, 'Caché A');
    const b = await setupBiz(app, 'Caché B');
    expect((await profile(a)).slug).toBe(a.slug);
    expect((await profile(b)).slug).toBe(b.slug);
    await sneakTagline(a, 'A por fuera');
    await sneakTagline(b, 'B por fuera');
    // Error de validación (400): nada cambió, la caché sigue.
    expect((await app.inject({ method: 'PUT', url: '/api/booking/profile', headers: auth(a.session), payload: { tagline: 'x'.repeat(500) } })).statusCode).toBe(400);
    expect((await profile(a)).tagline).not.toBe('A por fuera');
    // Una escritura de A renueva A y no toca B.
    expect((await app.inject({ method: 'PUT', url: '/api/booking/profile', headers: auth(a.session), payload: { description: 'Hola' } })).statusCode).toBe(200);
    expect((await profile(a)).tagline).toBe('A por fuera');
    expect((await profile(b)).tagline).not.toBe('B por fuera');
  });

  it('despublicar surte efecto al instante aunque la página esté en caché', async () => {
    const biz = await setupBiz(app, 'Caché despublicar');
    expect((await app.inject({ method: 'GET', url: biz.base })).statusCode).toBe(200);
    await testDb.pool.query('update business_public_profiles set published = false where business_id = $1', [biz.session.business.id]);
    expect((await app.inject({ method: 'GET', url: biz.base })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `${biz.base}/catalog` })).statusCode).toBe(404);
  });
});
