import { EMPLOYEE_PERMISSIONS, type AssistantAnswer, type AuthSession } from '@xiro/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { auth, createEmployee, firstCategoryId, register } from './helpers/booking';
import { createTestDatabase, testAppConfig, type TestDatabase } from './helpers/db';

/**
 * Ruta del asistente de negocio (Fase A): catálogo cerrado, mismo cálculo y mismo permiso que ya exige la pantalla
 * equivalente (authz.ts es 'any' aquí a propósito — ver el comentario junto a esas dos entradas — y esta ruta exige
 * el permiso real por pregunta dentro del código, nunca confiando en la interfaz).
 */
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

const ask = (session: { accessToken: string }, question: string, extra: Record<string, string> = {}) =>
  app.inject({ method: 'GET', url: `/api/assistant/ask?${new URLSearchParams({ question, ...extra })}`, headers: auth(session) });

async function sell(session: AuthSession, categoryId: string, name: string, price: number) {
  const item = await app.inject({ method: 'POST', url: '/api/items', headers: auth(session), payload: { name, categoryId, price, kind: 'service', durationMinutes: 30 } });
  expect(item.statusCode).toBe(201);
  const itemId = item.json<{ id: string }>().id;
  const sale = await app.inject({ method: 'POST', url: '/api/sales', headers: auth(session), payload: { lines: [{ kind: 'service', itemId }], payments: [{ method: 'cash', amount: price }] } });
  expect(sale.statusCode).toBe(201);
}

describe('catálogo del asistente', () => {
  it('solo lista lo que el actor puede preguntar ahora mismo (ocultar no reemplaza el permiso de /ask)', async () => {
    const owner = await register(app, 'Catálogo asistente');
    const ownerCatalog = (await app.inject({ method: 'GET', url: '/api/assistant/catalog', headers: auth(owner) })).json<Array<{ question: string }>>();
    expect(ownerCatalog.map((q) => q.question)).toContain('net_profit');
    expect(ownerCatalog.map((q) => q.question)).toContain('employees_active');

    const nobody = (await createEmployee(app, owner, [])).session;
    const nobodyCatalog = (await app.inject({ method: 'GET', url: '/api/assistant/catalog', headers: auth(nobody) })).json<Array<{ question: string }>>();
    // Única pregunta abierta a "cualquiera": el resto exige un permiso que este empleado no tiene.
    expect(nobodyCatalog.map((q) => q.question)).toEqual(['subscription_status']);
  });
});

describe('/assistant/ask exige, por pregunta, el MISMO permiso que su pantalla equivalente', () => {
  it('ventas y caja: igual que GET /sales (services_record)', async () => {
    const owner = await register(app, 'Permiso ventas');
    const nobody = (await createEmployee(app, owner, [])).session;
    expect((await ask(nobody, 'sales_total')).statusCode).toBe(403);
    expect((await ask(nobody, 'cash_state')).statusCode).toBe(403);
    const withPerm = (await createEmployee(app, owner, ['services_record'])).session;
    expect((await ask(withPerm, 'sales_total')).statusCode).toBe(200);
  });

  it('finanzas: igual que GET /reports/balance (finance)', async () => {
    const owner = await register(app, 'Permiso finanzas');
    const nobody = (await createEmployee(app, owner, [])).session;
    expect((await ask(nobody, 'net_profit')).statusCode).toBe(403);
    expect((await ask(nobody, 'expenses_by_category')).statusCode).toBe(403);
    const withPerm = (await createEmployee(app, owner, ['finance'])).session;
    expect((await ask(withPerm, 'net_profit')).statusCode).toBe(200);
  });

  it('inventario: igual que GET /items (catalog_view)', async () => {
    const owner = await register(app, 'Permiso inventario');
    const nobody = (await createEmployee(app, owner, [])).session;
    expect((await ask(nobody, 'stock_low')).statusCode).toBe(403);
    const withPerm = (await createEmployee(app, owner, ['catalog_view'])).session;
    expect((await ask(withPerm, 'stock_low')).statusCode).toBe(200);
  });

  it('empleados activos: solo el dueño, aunque el empleado tenga TODOS los demás permisos', async () => {
    const owner = await register(app, 'Permiso equipo');
    const everything = (await createEmployee(app, owner, [...EMPLOYEE_PERMISSIONS])).session;
    expect((await ask(everything, 'employees_active')).statusCode).toBe(403);
    expect((await ask(owner, 'employees_active')).statusCode).toBe(200);
  });

  it('estado de la suscripción: "any", como GET /subscription — hasta un empleado sin ningún permiso puede preguntarlo', async () => {
    const owner = await register(app, 'Permiso suscripción');
    const nobody = (await createEmployee(app, owner, [])).session;
    expect((await ask(nobody, 'subscription_status')).statusCode).toBe(200);
  });
});

describe('aislamiento entre negocios', () => {
  it('las cifras de un negocio nunca aparecen en la respuesta del otro', async () => {
    const a = await register(app, 'Asistente A');
    const b = await register(app, 'Asistente B');
    await sell(a, await firstCategoryId(app, a), 'Servicio A', 40_000);
    await sell(b, await firstCategoryId(app, b), 'Servicio B', 999_000);
    const resA = (await ask(a, 'sales_total', { period: 'today' })).json<AssistantAnswer>();
    expect(resA.data).toMatchObject({ total: 40_000, count: 1 });
  });
});

describe('cada respuesta trae período, moneda, fuente y la cifra correcta — la misma que su pantalla', () => {
  it('sales_total', async () => {
    const owner = await register(app, 'Respuesta ventas');
    await sell(owner, await firstCategoryId(app, owner), 'Corte', 30_000);
    const res = await ask(owner, 'sales_total', { period: 'today' });
    expect(res.statusCode).toBe(200);
    const body = res.json<AssistantAnswer>();
    expect(body).toMatchObject({ question: 'sales_total', category: 'sales', currency: 'COP', source: 'Reportes → Ventas', data: { question: 'sales_total', total: 30_000, count: 1 } });
    expect(body.period).toMatchObject({ period: 'today' });
  });

  it('sin período explícito, usa "month" por defecto', async () => {
    const owner = await register(app, 'Período por defecto');
    const res = (await ask(owner, 'sales_count')).json<AssistantAnswer>();
    expect(res.period?.period).toBe('month');
  });

  it('cash_state: base de apertura + lo cobrado en efectivo', async () => {
    const owner = await register(app, 'Caja asistente ruta');
    await sell(owner, await firstCategoryId(app, owner), 'Corte', 20_000);
    expect((await app.inject({ method: 'POST', url: '/api/cash/opening', headers: auth(owner), payload: { amount: 50_000, note: '' } })).statusCode).toBe(201);
    const res = (await ask(owner, 'cash_state', { period: 'today' })).json<AssistantAnswer>();
    expect(res.data).toMatchObject({ openingBase: 50_000, cashSales: 20_000, cashTotal: 70_000 });
  });

  it('expenses_operating_payroll y net_profit: la misma cuenta que Finanzas → Balance general', async () => {
    const owner = await register(app, 'Finanzas asistente');
    await sell(owner, await firstCategoryId(app, owner), 'Corte', 100_000);
    const expense = await app.inject({ method: 'POST', url: '/api/expenses', headers: auth(owner), payload: { amount: 15_000, description: 'Arriendo', method: 'cash', type: 'operating', category: 'rent' } });
    expect(expense.statusCode).toBe(201);
    const ops = (await ask(owner, 'expenses_operating_payroll', { period: 'today' })).json<AssistantAnswer>();
    expect(ops.data).toMatchObject({ operating: 15_000, payroll: 0 });
    const net = (await ask(owner, 'net_profit', { period: 'today' })).json<AssistantAnswer>();
    expect(net.data).toMatchObject({ income: 100_000, expenses: 15_000, net: 85_000 });
    expect(net.source).toBe('Finanzas → Balance general');
  });

  it('stock_low: solo productos agotados o por agotarse, nunca servicios', async () => {
    const owner = await register(app, 'Inventario asistente');
    const categoryId = await firstCategoryId(app, owner);
    expect((await app.inject({ method: 'POST', url: '/api/items', headers: auth(owner), payload: { name: 'Shampoo', categoryId, price: 10_000, kind: 'product', stock: 0 } })).statusCode).toBe(201);
    expect((await app.inject({ method: 'POST', url: '/api/items', headers: auth(owner), payload: { name: 'Cera abundante', categoryId, price: 5_000, kind: 'product', stock: 999 } })).statusCode).toBe(201);
    const res = (await ask(owner, 'stock_low')).json<AssistantAnswer>();
    expect(res.data).toMatchObject({ rows: [{ name: 'Shampoo', stock: 0, stockStatus: 'out_of_stock' }] });
  });

  it('employees_active: cuenta solo a los empleados activos', async () => {
    const owner = await register(app, 'Equipo asistente');
    await createEmployee(app, owner, []);
    const e2 = await createEmployee(app, owner, []);
    expect((await app.inject({ method: 'PATCH', url: `/api/employees/${e2.employee.id}`, headers: auth(owner), payload: { active: false } })).statusCode).toBe(200);
    const res = (await ask(owner, 'employees_active')).json<AssistantAnswer>();
    expect(res.data).toMatchObject({ active: 1 });
  });

  it('subscription_status: "none" para un negocio recién registrado, sin inventar acceso', async () => {
    const owner = await register(app, 'Suscripción asistente');
    const res = (await ask(owner, 'subscription_status')).json<AssistantAnswer>();
    expect(res.data).toMatchObject({ status: 'none', hasAccess: false });
  });
});

describe('validación estricta: nunca un 500 por un parámetro inventado', () => {
  it('pregunta desconocida, período desconocido y período personalizado inválido → 400', async () => {
    const owner = await register(app, 'Validación asistente');
    expect((await ask(owner, 'algo-que-no-existe')).statusCode).toBe(400);
    expect((await ask(owner, 'sales_total', { period: 'eon' })).statusCode).toBe(400);
    expect((await ask(owner, 'sales_total', { period: 'custom' })).statusCode).toBe(400); // sin from/to
    expect((await ask(owner, 'sales_total', { period: 'custom', from: '2026-02-01', to: '2026-01-01' })).statusCode).toBe(400); // from > to
    expect((await ask(owner, 'sales_total', { extra: '1' })).statusCode).toBe(400); // campo no reconocido
  });
});
