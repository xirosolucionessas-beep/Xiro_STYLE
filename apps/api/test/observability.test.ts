import type { ErrorEvent } from '@sentry/node';
import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type BuildOptions } from '../src/app';
import { loadConfig } from '../src/config';
import { scrubEvent } from '../src/monitoring';
import { createTestDatabase, testAppConfig, type TestDatabase } from './helpers/db';

/**
 * Fase 4: ids de petición, health/readiness (base de datos y Redis), métricas Prometheus protegidas, compresión,
 * protección contra sobrecarga y limpieza de datos personales antes de enviar un error a Sentry.
 */
let testDb: TestDatabase;
const apps: FastifyInstance[] = [];
const cleanups: Array<() => void> = [];
const METRICS_TOKEN = 'm'.repeat(40);

async function makeApp(config: BuildOptions['config'] = {}, extra: Partial<BuildOptions> = {}) {
  const setup = testAppConfig(config);
  cleanups.push(setup.cleanup);
  const merged = { ...setup.config, observability: { ...loadConfig({ NODE_ENV: 'test' } as NodeJS.ProcessEnv).observability, ...(config.observability ?? {}) } };
  const instance = await buildApp({ db: testDb.db, config: merged, ...extra });
  apps.push(instance);
  return instance;
}

beforeAll(async () => {
  testDb = await createTestDatabase();
});
afterAll(async () => {
  await Promise.all(apps.map((a) => a.close()));
  cleanups.forEach((fn) => fn());
  await testDb.drop();
});

describe('id de petición (X-Request-Id)', () => {
  it('genera uno por petición, respeta el del proxy si es válido y descarta lo que no lo es', async () => {
    const app = await makeApp();
    const generated = await app.inject({ method: 'GET', url: '/api/health' });
    expect(String(generated.headers['x-request-id'])).toMatch(/^[0-9a-f-]{36}$/);
    const forwarded = await app.inject({ method: 'GET', url: '/api/health', headers: { 'x-request-id': 'lb-abc123-xyz' } });
    expect(forwarded.headers['x-request-id']).toBe('lb-abc123-xyz');
    for (const bad of ['corto', '<script>alert(1)</script>-ataque', 'a'.repeat(300), 'con espacios y saltos\n de línea']) {
      const res = await app.inject({ method: 'GET', url: '/api/health', headers: { 'x-request-id': bad } });
      expect(String(res.headers['x-request-id']), bad).toMatch(/^[0-9a-f-]{36}$/);
    }
  });
});

describe('health y readiness', () => {
  it('liveness responde sin tocar dependencias; readiness revisa base de datos y Redis', async () => {
    const app = await makeApp();
    expect((await app.inject({ method: 'GET', url: '/api/health' })).json()).toEqual({ status: 'ok' });
    expect((await app.inject({ method: 'GET', url: '/api/health/ready' })).json()).toEqual({ status: 'ok', database: 'up', redis: 'not_configured' });

    const downRedis = { ping: () => Promise.reject(new Error('caído')) } as unknown as Redis;
    const withRedis = await makeApp({}, { redis: downRedis });
    const res = await withRedis.inject({ method: 'GET', url: '/api/health/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'unavailable', database: 'up', redis: 'down' });
    // La liveness sigue en 200: que Redis caiga no se arregla reiniciando la API.
    expect((await withRedis.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200);
  });
});

describe('métricas Prometheus', () => {
  it('no existen sin METRICS_TOKEN ni con un token incorrecto (404, sin pistas)', async () => {
    const off = await makeApp();
    expect((await off.inject({ method: 'GET', url: '/api/metrics' })).statusCode).toBe(404);
    const on = await makeApp({ observability: { metricsToken: METRICS_TOKEN } as never });
    expect((await on.inject({ method: 'GET', url: '/api/metrics', headers: { authorization: 'Bearer otro-token-otro-token-otro-token-1234' } })).statusCode).toBe(404);
  });

  it('con el token: peticiones por PLANTILLA de ruta (sin ids reales), latencia, memoria y pool', async () => {
    const app = await makeApp({ observability: { metricsToken: METRICS_TOKEN } as never });
    await app.inject({ method: 'GET', url: '/api/public/booking/no-existe-123/catalog' });
    await app.inject({ method: 'GET', url: '/api/health' });
    const res = await app.inject({ method: 'GET', url: '/api/metrics', headers: { authorization: `Bearer ${METRICS_TOKEN}` } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    const body = res.body;
    expect(body).toContain('xiro_http_requests_total{method="GET",route="/api/public/booking/:slug/catalog",status="4xx"} 1');
    expect(body).not.toContain('no-existe-123');
    expect(body).toMatch(/xiro_http_request_duration_seconds_bucket\{method="GET",route="\/api\/health",le="\+Inf"\} 1/);
    expect(body).toMatch(/xiro_process_resident_memory_bytes \d+/);
    expect(body).toMatch(/xiro_db_pool_connections\{state="total"\} \d+/);
    expect(body).toMatch(/xiro_password_hash_waiting \d+/);
  });
});

describe('compresión', () => {
  it('las respuestas JSON grandes salen en gzip si el cliente lo acepta; las pequeñas no', async () => {
    const app = await makeApp({ corsOrigins: [] });
    const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { name: 'Ana', businessName: 'Gzip', email: `gz${Date.now()}@correo.com`, password: 'Secreta123', acceptTerms: true } });
    const token = reg.json<{ accessToken: string }>().accessToken;
    for (let i = 0; i < 20; i += 1) await app.inject({ method: 'POST', url: '/api/clients', headers: { authorization: `Bearer ${token}` }, payload: { name: `Cliente número ${i}`, notes: 'Prefiere la tarde' } });
    const big = await app.inject({ method: 'GET', url: '/api/clients', headers: { authorization: `Bearer ${token}`, 'accept-encoding': 'gzip' } });
    const plain = await app.inject({ method: 'GET', url: '/api/clients', headers: { authorization: `Bearer ${token}` } });
    expect(plain.body.length).toBeGreaterThan(1024); // si no, la prueba no probaría nada
    expect(plain.headers['content-encoding']).toBeUndefined();
    expect(big.headers['content-encoding']).toBe('gzip');
    expect(big.rawPayload.length).toBeLessThan(plain.body.length);
    expect(JSON.parse(gunzipSync(big.rawPayload).toString('utf8'))).toEqual(plain.json());
    const small = await app.inject({ method: 'GET', url: '/api/health', headers: { 'accept-encoding': 'gzip' } });
    expect(small.headers['content-encoding']).toBeUndefined();
  });
});

describe('protección contra sobrecarga', () => {
  it('con la memoria por encima del tope: 503 + Retry-After en la API, pero las rutas de salud siguen respondiendo', async () => {
    const app = await makeApp({ observability: { maxHeapUsedMb: 1 } as never });
    await new Promise((resolve) => setTimeout(resolve, 1_300)); // el plugin mide cada segundo
    const busy = await app.inject({ method: 'GET', url: '/api/public/booking/algo' });
    expect(busy.statusCode).toBe(503);
    expect(busy.headers['retry-after']).toBe('5');
    expect(busy.json()).toEqual({ code: 'server_busy', message: 'Server busy' });
    expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/health/ready' })).statusCode).toBe(200);
  });
});

describe('Sentry: nada personal sale del servidor', () => {
  it('quita cuerpo, cookies, cabeceras de sesión y consulta; redacta tokens de la URL; del usuario solo el id', () => {
    const event = scrubEvent({
      type: undefined,
      server_name: 'contenedor-7f9c',
      user: { id: 'u-1', email: 'ana@correo.com', ip_address: '1.2.3.4' },
      request: {
        url: 'https://api.xirostyle.com/api/public/booking/spa/appointments/TOKENSECRETO1234567890',
        data: { password: 'Secreta123' },
        cookies: { xrt: 'refresh' },
        query_string: 'ticket=abc',
        headers: { authorization: 'Bearer abc', cookie: 'xrt=1', 'user-agent': 'Mozilla' },
      },
    } as ErrorEvent);
    expect(event.user).toEqual({ id: 'u-1' });
    expect(event.server_name).toBeUndefined();
    expect(event.request?.data).toBeUndefined();
    expect(event.request?.cookies).toBeUndefined();
    expect(event.request?.query_string).toBeUndefined();
    expect(event.request?.headers).toEqual({ 'user-agent': 'Mozilla' });
    expect(event.request?.url).not.toContain('TOKENSECRETO');
  });
});

describe('configuración de observabilidad', () => {
  it('METRICS_TOKEN corto se rechaza al arrancar; por defecto: compresión activa y keep-alive mayor que el del balanceador', () => {
    expect(() => loadConfig({ NODE_ENV: 'test', METRICS_TOKEN: 'corto' } as NodeJS.ProcessEnv)).toThrow(/METRICS_TOKEN/);
    const defaults = loadConfig({ NODE_ENV: 'test' } as NodeJS.ProcessEnv).observability;
    expect(defaults).toMatchObject({ sentryDsn: null, metricsToken: null, compression: true, maxEventLoopDelayMs: 1_000, maxHeapUsedMb: 0, keepAliveTimeoutMs: 72_000 });
  });
});
