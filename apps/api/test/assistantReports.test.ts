import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSalesReport, loadOpeningBaseTotal, loadSalesInWindow, timezoneOf } from '../src/assistant/reportsData';
import { buildApp } from '../src/app';
import { auth, firstCategoryId, register, TZ } from './helpers/booking';
import { createTestDatabase, testAppConfig, type TestDatabase } from './helpers/db';

let app: FastifyInstance;
let testDb: TestDatabase;
let cleanupConfig: () => void;

beforeAll(async () => {
  testDb = await createTestDatabase();
  const { config, cleanup } = testAppConfig();
  cleanupConfig = cleanup;
  app = await buildApp({ db: testDb.db, config });
});

afterAll(async () => {
  await app.close();
  cleanupConfig();
  await testDb.drop();
});

async function sell(session: { accessToken: string }, categoryId: string, name: string, price: number) {
  const item = await app.inject({ method: 'POST', url: '/api/items', headers: auth(session), payload: { name, categoryId, price, kind: 'service', durationMinutes: 30 } });
  expect(item.statusCode).toBe(201);
  const itemId = item.json<{ id: string }>().id;
  const sale = await app.inject({ method: 'POST', url: '/api/sales', headers: auth(session), payload: { lines: [{ kind: 'service', itemId }], payments: [{ method: 'cash', amount: price }] } });
  expect(sale.statusCode).toBe(201);
  return sale.json();
}

describe('datos de reportes para el asistente de IA: misma fuente que el panel, sin el tope de 200 filas', () => {
  it('ventas_resumen coincide con lo realmente vendido hoy, y no acota por cantidad de filas', async () => {
    const session = await register(app, 'Datos asistente');
    const businessId = session.business.id;
    const categoryId = await firstCategoryId(app, session);

    await sell(session, categoryId, 'Corte', 30_000);
    await sell(session, categoryId, 'Tinte', 50_000);

    const timezone = await timezoneOf(testDb.db, businessId);
    expect(timezone).toBe(TZ);

    const report = await buildSalesReport(testDb.db, businessId, 'today', timezone!, new Date());
    expect(report.current.total).toBe(80_000);
    expect(report.current.count).toBe(2);
    expect(report.paymentMethods).toEqual([{ method: 'cash', total: 80_000, count: 2, percent: 100 }]);
    expect(report.topServices.map((r) => r.label).sort()).toEqual(['Corte', 'Tinte']);
  });

  it('aislamiento: las ventas de un negocio nunca aparecen en el reporte de otro', async () => {
    const sessionA = await register(app, 'Negocio A');
    const sessionB = await register(app, 'Negocio B');
    await sell(sessionA, await firstCategoryId(app, sessionA), 'Servicio A', 40_000);
    await sell(sessionB, await firstCategoryId(app, sessionB), 'Servicio B', 999_000);

    const timezone = await timezoneOf(testDb.db, sessionA.business.id);
    const report = await buildSalesReport(testDb.db, sessionA.business.id, 'today', timezone!, new Date());
    expect(report.current.total).toBe(40_000);
    expect(report.topServices.map((r) => r.label)).toEqual(['Servicio A']);
  });

  it('caja: la base inicial del día entra al cálculo del total en caja', async () => {
    const session = await register(app, 'Caja asistente');
    const businessId = session.business.id;
    await sell(session, await firstCategoryId(app, session), 'Corte', 20_000);
    const opening = await app.inject({ method: 'POST', url: '/api/cash/opening', headers: auth(session), payload: { amount: 50_000, note: '' } });
    expect(opening.statusCode).toBe(201);

    const timezone = await timezoneOf(testDb.db, businessId);
    const report = await buildSalesReport(testDb.db, businessId, 'today', timezone!, new Date());
    expect(report.openingBase).toBe(50_000);
    expect(report.cashTotal).toBe(70_000); // 50.000 base + 20.000 vendido en efectivo

    const direct = await loadOpeningBaseTotal(testDb.db, businessId, report.range.current);
    expect(direct).toBe(50_000);
  });

  it('sin ventas en el periodo: nunca inventa cifras, todo queda en cero real', async () => {
    const session = await register(app, 'Sin ventas');
    const timezone = await timezoneOf(testDb.db, session.business.id);
    const report = await buildSalesReport(testDb.db, session.business.id, 'today', timezone!, new Date());
    expect(report.current).toEqual({ total: 0, count: 0, average: null });
    expect(report.paymentMethods).toEqual([]);
    expect(report.openingBase).toBe(0);
    expect(report.cashTotal).toBe(0);
  });

  it('timezoneOf: null para un negocio que no existe', async () => {
    expect(await timezoneOf(testDb.db, '00000000-0000-0000-0000-000000000000')).toBeNull();
  });

  it('loadSalesInWindow: respeta el límite [from, to) — una venta justo en el borde superior no cuenta', async () => {
    const session = await register(app, 'Bordes de ventana');
    const businessId = session.business.id;
    await sell(session, await firstCategoryId(app, session), 'Corte', 10_000);
    const timezone = await timezoneOf(testDb.db, businessId);
    const range = (await buildSalesReport(testDb.db, businessId, 'today', timezone!, new Date())).range;
    // Ventana que termina justo ahora: la venta recién creada queda ANTES de `to` (ya pasó al menos 1 ms).
    const sales = await loadSalesInWindow(testDb.db, businessId, { from: range.current.from, to: new Date().toISOString() });
    expect(sales.length).toBe(1);
    const noneYet = await loadSalesInWindow(testDb.db, businessId, { from: range.current.from, to: range.current.from });
    expect(noneYet.length).toBe(0);
  });
});
