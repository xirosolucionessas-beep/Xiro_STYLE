import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { auth, createService, nextPhone, setupBiz, workday, type Biz } from './helpers/booking';
import { createTestDatabase, testAppConfig, type TestDatabase } from './helpers/db';

/**
 * Fase 5 del plan: además del límite por IP, un tope de creaciones por NEGOCIO y por minuto (todas las IP juntas) en pedidos,
 * reservas y lista de espera; y un límite de reseñas por IP. Un negocio frenado no afecta a ningún otro.
 */
let app: FastifyInstance;
let testDb: TestDatabase;
let cleanupConfig: () => void;

beforeAll(async () => {
  testDb = await createTestDatabase();
  const { config, cleanup } = testAppConfig({ rateLimit: { enabled: true, accountAttempts: 10, authPerMinute: 1_000, globalPerMinute: 100_000, userPerMinute: 100_000 } });
  cleanupConfig = cleanup;
  app = await buildApp({ db: testDb.db, config });
});

afterAll(async () => {
  await app.close();
  cleanupConfig();
  await testDb.drop();
});

let ipCounter = 0;
const freshIp = () => `10.20.${Math.floor((ipCounter += 1) / 250)}.${(ipCounter % 250) + 1}`;
const customer = () => ({ firstName: 'Ana', lastName: 'Ruiz', email: '', phone: nextPhone(), notes: '', custom: {} });

async function shop(label: string): Promise<{ biz: Biz; productId: string }> {
  const biz = await setupBiz(app, label);
  expect((await app.inject({ method: 'PUT', url: '/api/booking/settings', headers: auth(biz.session), payload: { productOrdersEnabled: true, waitlistEnabled: true } })).statusCode).toBe(200);
  const product = await createService(app, biz.session, { name: 'Gel', price: 10000, kind: 'product', stock: 500 });
  return { biz, productId: product.id };
}
const order = (biz: Biz, productId: string) =>
  app.inject({ method: 'POST', url: `${biz.base}/orders`, remoteAddress: freshIp(), payload: { products: [{ itemId: productId, quantity: 1 }], customer: customer(), acceptTerms: true, website: '' } });

describe('límite de creaciones por negocio', () => {
  it('pedidos: el 11.º en un minuto (desde IP distintas) se frena con Retry-After; otro negocio sigue normal', async () => {
    const a = await shop('Ráfaga A');
    const b = await shop('Ráfaga B');
    const results = [];
    for (let i = 0; i < 11; i += 1) results.push(await order(a.biz, a.productId));
    expect(results.slice(0, 10).every((r) => r.statusCode === 201)).toBe(true);
    expect(results[10]!.statusCode).toBe(429);
    expect(Number(results[10]!.headers['retry-after'])).toBeGreaterThan(0);
    expect((await order(b.biz, b.productId)).statusCode).toBe(201);
  });

  it('lista de espera: mismo tope por negocio', async () => {
    const { biz } = await shop('Ráfaga espera');
    const codes = [];
    for (let i = 0; i < 11; i += 1) {
      const res = await app.inject({ method: 'POST', url: `${biz.base}/waitlist`, remoteAddress: freshIp(), payload: { date: workday(3), services: [biz.serviceId], customer: customer(), acceptTerms: true, website: '' } });
      codes.push(res.statusCode);
    }
    expect(codes.slice(0, 10).every((c) => c === 201)).toBe(true);
    expect(codes[10]).toBe(429);
  });
});

describe('límite de reseñas por IP', () => {
  it('muchos intentos desde la misma IP se frenan (aunque cada enlace sea inválido)', async () => {
    const { biz } = await shop('Reseñas spam');
    const ip = freshIp();
    const codes = [];
    for (let i = 0; i < 11; i += 1) {
      const res = await app.inject({ method: 'POST', url: `${biz.base}/review-link/00000000-0000-4000-8000-000000000000.${'x'.repeat(43)}`, remoteAddress: ip, payload: { rating: 5, comment: '' } });
      codes.push(res.statusCode);
    }
    expect(codes.slice(0, 10).every((c) => c === 404)).toBe(true);
    expect(codes[10]).toBe(429);
  });
});
