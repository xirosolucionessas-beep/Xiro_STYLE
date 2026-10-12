import type { AppointmentDto, Item } from '@xiro/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { at, auth, firstCategoryId, nextPhone, setupBiz, workday, type Biz } from './helpers/booking';
import { createTestDatabase, testAppConfig, type TestDatabase } from './helpers/db';

/**
 * Operaciones críticas bajo concurrencia (Fase 4): la misma acción enviada N veces A LA VEZ (doble clic, reintentos de
 * red, dos dispositivos) debe tener efecto UNA sola vez. Contra PostgreSQL real con un pool de varias conexiones.
 */
let app: FastifyInstance;
let testDb: TestDatabase;
let cleanup: () => void;
const N = 12;

beforeAll(async () => {
  testDb = await createTestDatabase({ poolMax: 20 });
  const setup = testAppConfig();
  cleanup = setup.cleanup;
  app = await buildApp({ db: testDb.db, notifier: { sendOtp: async () => undefined, sendAppointmentReminder: async () => undefined }, config: setup.config });
});
afterAll(async () => {
  await app.close();
  cleanup();
  await testDb.drop();
});

const send = (biz: Biz, method: string, url: string, payload?: unknown) => app.inject({ method: method as 'POST', url, headers: auth(biz.session), ...(payload === undefined ? {} : { payload: payload as object }) });
const all = <T>(count: number, fn: () => Promise<T>) => Promise.all(Array.from({ length: count }, fn));
const ok = (codes: number[]) => codes.filter((c) => c < 300).length;
const count = async (sql: string, params: unknown[]) => (await testDb.pool.query<{ n: number }>(sql, params)).rows[0]!.n;

async function product(biz: Biz, stock: number): Promise<Item> {
  const res = await send(biz, 'POST', '/api/items', { name: `Champú ${nextPhone()}`, categoryId: await firstCategoryId(app, biz.session), price: 20000, kind: 'product', stock });
  expect(res.statusCode).toBe(201);
  return res.json<Item>();
}

describe('operaciones críticas: N peticiones simultáneas, un solo efecto', () => {
  it('anular la MISMA venta a la vez: una sola anulación y el stock se devuelve una sola vez', async () => {
    const biz = await setupBiz(app, 'Anular');
    const item = await product(biz, 10);
    const sale = await send(biz, 'POST', '/api/sales', { occasional: true, lines: [{ kind: 'product', itemId: item.id, quantity: 3 }], payments: [{ method: 'cash', amount: 60000 }] });
    expect(sale.statusCode).toBe(201);
    const saleId = sale.json<{ id: string }>().id;
    expect(await count('select stock as n from items where id = $1', [item.id])).toBe(7);

    const codes = (await all(N, () => send(biz, 'POST', `/api/sales/${saleId}/void`, { reason: 'doble clic' }))).map((r) => r.statusCode);
    expect(codes.every((c) => c < 500), String(codes)).toBe(true);
    expect(ok(codes)).toBe(1);
    expect(await count('select stock as n from items where id = $1', [item.id])).toBe(10); // no 19 ni más
  });

  it('cerrar la caja del MISMO día desde varios dispositivos: un solo cierre', async () => {
    const biz = await setupBiz(app, 'Cierre');
    expect((await send(biz, 'POST', '/api/cash/opening', { amount: 100000 })).statusCode).toBeLessThan(300);
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date()); // día del negocio, no UTC
    const codes = (await all(N, () => send(biz, 'POST', '/api/cash/close', { day, countedAmount: 100000, note: '' }))).map((r) => r.statusCode);
    expect(codes.every((c) => c < 500), String(codes)).toBe(true);
    expect(ok(codes)).toBe(1);
    expect(await count('select count(*)::int as n from cash_closings where business_id = $1', [biz.session.business.id])).toBe(1);
  });

  it('completar la MISMA cita a la vez: un solo registro de servicio, un solo sello y el stock del producto baja una vez', async () => {
    const biz = await setupBiz(app, 'Completar');
    expect((await send(biz, 'PUT', '/api/loyalty/program', { enabled: true, goal: 10, itemIds: [biz.serviceId] })).statusCode).toBe(200);
    const item = await product(biz, 10);
    const created = await send(biz, 'POST', '/api/appointments', {
      professionalId: biz.ownerId,
      startsAt: at(workday(3), '10:00'),
      selection: { services: [{ itemId: biz.serviceId }], packages: [], products: [{ itemId: item.id, quantity: 2 }] },
      newClient: { name: 'Cliente Simultáneo', phone: nextPhone() },
    });
    expect(created.statusCode, created.body).toBe(201);
    const appt = created.json<AppointmentDto>();

    const codes = (await all(N, () => send(biz, 'POST', `/api/appointments/${appt.id}/status`, { status: 'completed' }))).map((r) => r.statusCode);
    expect(codes.every((c) => c < 500), String(codes)).toBe(true);
    expect(ok(codes)).toBe(1);
    const businessId = biz.session.business.id;
    expect(await count('select count(*)::int as n from service_records where business_id = $1', [businessId])).toBe(2); // servicio + producto, una vez
    expect(await count('select coalesce(sum(count), 0)::int as n from loyalty_progress where business_id = $1', [businessId])).toBe(1);
    expect(await count('select stock as n from items where id = $1', [item.id])).toBe(8);
  });

  it('reclamar la prueba gratis a la vez: una sola, y las demás 409 (no 500)', async () => {
    const biz = await setupBiz(app, 'Prueba');
    const codes = (await all(N, () => send(biz, 'POST', '/api/subscription/trial', { plan: 'monthly', platform: 'web' }))).map((r) => r.statusCode);
    expect(codes.every((c) => c < 500), String(codes)).toBe(true);
    expect(ok(codes)).toBe(1);
    expect(await count('select count(*)::int as n from subscriptions where business_id = $1', [biz.session.business.id])).toBe(1);
  });

  it('canjear el MISMO premio a la vez: un solo canje', async () => {
    const biz = await setupBiz(app, 'Canje');
    expect((await send(biz, 'PUT', '/api/loyalty/program', { enabled: true, goal: 2, itemIds: [biz.serviceId] })).statusCode).toBe(200);
    const client = (await send(biz, 'POST', '/api/clients', { name: 'Fiel', phone: nextPhone() })).json<{ id: string }>();
    for (let i = 0; i < 2; i += 1) expect((await send(biz, 'POST', '/api/service-records', { clientId: client.id, itemId: biz.serviceId })).statusCode).toBe(201);

    const codes = (await all(N, () => send(biz, 'POST', `/api/loyalty/clients/${client.id}/redeem`, {}))).map((r) => r.statusCode);
    expect(codes.every((c) => c < 500), String(codes)).toBe(true);
    expect(ok(codes)).toBe(1);
    expect(await count('select count(*)::int as n from loyalty_redemptions where business_id = $1', [biz.session.business.id])).toBe(1);
  });
});
