import type { AuthSession, CashClosingDto, ExpenseDto, SaleDto } from '@xiro/shared';
import ExcelJS from 'exceljs';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { addDays, localDate } from '../src/booking/time';
import { auth, createEmployee, createService, register, TZ } from './helpers/booking';
import { createTestDatabase, testAppConfig, type TestDatabase } from './helpers/db';

/**
 * Fase 4 de la auditoría — autorización y aislamiento de TODO lo financiero (gastos, balance, descargas, caja, ventas).
 * Dos negocios con datos marcados: B nunca lee, cambia ni infiere nada de A; los permisos se aplican por rol y por
 * "Finanzas", y un cambio de permisos o una desactivación aplican en la siguiente petición (sin volver a iniciar sesión).
 */
let app: FastifyInstance;
let testDb: TestDatabase;
let cleanupConfig: () => void;

const MARK = 'MARCA-FINANZAS-A';
const AMOUNT_A = 777_777;
const PRICE_A = 654_321;
const OPENING_A = 123_457;

let a: AuthSession;
let b: AuthSession;
let financeA: AuthSession;
let financeEmployeeId: string;
let plainA: AuthSession;
let payeeA: { id: string; name: string };
let expenseA: ExpenseDto;
let saleA: SaleDto;
let closingA: CashClosingDto;

const today = () => localDate(new Date(), TZ);
const range = () => `from=${addDays(today(), -6)}&to=${today()}`;
const send = (session: AuthSession, method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: Record<string, unknown>) =>
  app.inject({ method, url, headers: auth(session), ...(payload === undefined ? {} : { payload: payload as InjectOptions['payload'] }) });

beforeAll(async () => {
  testDb = await createTestDatabase();
  const { config, cleanup } = testAppConfig();
  cleanupConfig = cleanup;
  app = await buildApp({ db: testDb.db, config });

  a = await register(app, 'Finanzas A');
  b = await register(app, 'Finanzas B');
  const fin = await createEmployee(app, a, ['finance']);
  financeA = fin.session;
  financeEmployeeId = fin.employee.id;
  plainA = (await createEmployee(app, a, ['services_record', 'clients_view'])).session;
  const payee = await createEmployee(app, a, []);
  payeeA = { id: payee.employee.id, name: payee.employee.name };

  // Datos de A: caja, venta, gastos (uno de nómina con su empleado) y el cierre del día.
  expect((await send(a, 'POST', '/api/cash/opening', { amount: OPENING_A })).statusCode).toBe(201);
  const service = await createService(app, a, { name: `${MARK} servicio`, price: PRICE_A });
  saleA = (await send(a, 'POST', '/api/sales', { occasional: true, clientLabel: MARK, lines: [{ kind: 'service', itemId: service.id, quantity: 1 }], payments: [{ method: 'cash', amount: PRICE_A }] })).json<SaleDto>();
  expenseA = (await send(a, 'POST', '/api/expenses', { amount: AMOUNT_A, description: MARK, method: 'bank_transfer', notes: MARK })).json<ExpenseDto>();
  expect((await send(a, 'POST', '/api/expenses', { amount: 1000, description: `${MARK} nómina`, method: 'bank_transfer', type: 'payroll', category: 'salary', employeeId: payeeA.id })).statusCode).toBe(201);
  closingA = (await send(a, 'POST', '/api/cash/close', { day: today(), countedAmount: 0, note: MARK })).json<CashClosingDto>();
  expect(closingA.id).toBeTruthy();
});

afterAll(async () => {
  await app.close();
  cleanupConfig();
  await testDb.drop();
});

/** Nada de A en la respuesta: ni sus textos, ni sus montos, ni sus ids, ni el nombre de su personal. */
function expectNothingOfA(label: string, text: string) {
  for (const needle of [MARK, String(AMOUNT_A), String(PRICE_A), String(OPENING_A), expenseA.id, saleA.id, closingA.id, payeeA.id, payeeA.name, a.business.id]) {
    expect(text.includes(needle), `${label} contiene ${needle}`).toBe(false);
  }
}

async function xlsxText(body: Buffer): Promise<string> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(body as unknown as ExcelJS.Buffer);
  const cells: string[] = [];
  for (const sheet of wb.worksheets) sheet.eachRow((row) => cells.push(...(row.values as unknown[]).map(String)));
  return cells.join('|');
}

describe('lecturas: el negocio B no ve ni puede inferir nada de A', () => {
  it('gastos, beneficiarios, balance, movimientos, caja y ventas', async () => {
    const urls = [
      `/api/expenses?${range()}&status=all`,
      `/api/expenses/page?${range()}&status=all`,
      '/api/expenses/payees',
      `/api/reports/balance?${range()}`,
      `/api/reports/balance/movements?${range()}`,
      `/api/cash/close-summary?day=${today()}`,
      `/api/cash/closings?${range()}`,
      `/api/cash/openings?${range()}`,
      '/api/cash/today',
      `/api/sales?from=${addDays(today(), -6)}T00:00:00.000Z&to=${addDays(today(), 1)}T00:00:00.000Z`,
    ];
    for (const url of urls) {
      const res = await send(b, 'GET', url);
      expect(res.statusCode, url).toBe(200);
      expectNothingOfA(url, res.body);
    }
    // Control: lo que B no ve, A SÍ lo ve (las marcas existen; la prueba no pasa "en vacío").
    expect((await send(a, 'GET', `/api/expenses?${range()}&status=all`)).body).toContain(MARK);
    expect((await send(a, 'GET', '/api/expenses/payees')).body).toContain(payeeA.name);
    expect((await send(a, 'GET', `/api/cash/close-summary?day=${today()}`)).body).toContain(String(PRICE_A));
    expect((await send(a, 'GET', `/api/reports/balance/movements?${range()}`)).body).toContain(String(AMOUNT_A));
    // Y los totales de B son los de un negocio vacío (no "absorbe" cifras de A).
    const balance = (await send(b, 'GET', `/api/reports/balance?${range()}`)).json<{ totals: Record<string, number | null> }>();
    expect(balance.totals).toMatchObject({ income: 0, operating: 0, payroll: 0, net: 0 });
  });

  it('descargas en Excel de B: ninguna celda de A', async () => {
    for (const url of [`/api/expenses/export.xlsx?${range()}&status=all`, `/api/reports/balance/export.xlsx?${range()}`]) {
      const res = await send(b, 'GET', url);
      expect(res.statusCode, url).toBe(200);
      expectNothingOfA(url, await xlsxText(res.rawPayload));
    }
  });

  it('un id de A responde EXACTAMENTE como un id que no existe (no se puede saber si existe)', async () => {
    const ghost = '00000000-0000-4000-8000-000000000000';
    for (const [real, fake] of [
      [`/api/expenses/${expenseA.id}`, `/api/expenses/${ghost}`],
      [`/api/cash/closings/${closingA.id}`, `/api/cash/closings/${ghost}`],
      [`/api/sales/${saleA.id}`, `/api/sales/${ghost}`],
    ] as const) {
      const [r, f] = [await send(b, 'GET', real), await send(b, 'GET', fake)];
      expect(r.statusCode, real).toBe(404);
      expect({ status: r.statusCode, body: r.body }, real).toEqual({ status: f.statusCode, body: f.body });
    }
  });
});

describe('escrituras: con ids de A, B no cambia nada', () => {
  it('editar o anular un gasto, anular una venta o un cierre de A → 404, y lo de A queda intacto', async () => {
    expect((await send(b, 'PUT', `/api/expenses/${expenseA.id}`, { amount: 1, description: 'hackeado', method: 'bank_transfer' })).statusCode).toBe(404);
    expect((await send(b, 'POST', `/api/expenses/${expenseA.id}/void`, { reason: 'hackeado' })).statusCode).toBe(404);
    expect((await send(b, 'POST', `/api/sales/${saleA.id}/void`, { reason: 'hackeado' })).statusCode).toBe(404);
    expect((await send(b, 'POST', `/api/cash/closings/${closingA.id}/void`, { reason: 'hackeado' })).statusCode).toBe(404);
    const { rows: [exp] } = await testDb.pool.query('select amount, description, status from expenses where id = $1', [expenseA.id]);
    expect(exp).toEqual({ amount: AMOUNT_A, description: MARK, status: 'active' });
    const { rows: [sale] } = await testDb.pool.query('select status from sales where id = $1', [saleA.id]);
    expect(sale.status).toBe('completed');
    const { rows: [closing] } = await testDb.pool.query('select status from cash_closings where id = $1', [closingA.id]);
    expect(closing.status).toBe('completed');
  });

  it('pagar nómina a un empleado de A desde B → rechazado (y el gasto no se crea)', async () => {
    const res = await send(b, 'POST', '/api/expenses', { amount: 5000, description: 'Nómina ajena', method: 'bank_transfer', type: 'payroll', category: 'salary', employeeId: payeeA.id });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'expense_employee_invalid' });
    const { rows } = await testDb.pool.query("select count(*)::int as n from expenses where description = 'Nómina ajena'");
    expect(rows[0].n).toBe(0);
  });
});

describe('permisos', () => {
  const financeRoutes = (): Array<[string, string]> => [
    ['GET', `/api/expenses?${range()}`],
    ['GET', `/api/expenses/page?${range()}`],
    ['GET', '/api/expenses/payees'],
    ['GET', `/api/expenses/${expenseA.id}`],
    ['GET', `/api/reports/balance?${range()}`],
    ['GET', `/api/reports/balance/movements?${range()}`],
    ['GET', `/api/reports/balance/export.xlsx?${range()}`],
    ['GET', `/api/expenses/export.xlsx?${range()}`],
  ];
  const ownerOnly = (): Array<[string, string, Record<string, unknown>?]> => [
    ['GET', `/api/cash/close-summary?day=${today()}`],
    ['GET', `/api/cash/closings?${range()}`],
    ['GET', `/api/cash/closings/${closingA.id}`],
    ['GET', `/api/cash/openings?${range()}`],
    ['GET', '/api/cash/today'],
    ['POST', '/api/cash/opening', { amount: 1 }],
    ['POST', '/api/cash/close', { day: today(), countedAmount: 0 }],
    ['POST', `/api/cash/closings/${closingA.id}/void`, { reason: 'sin permiso' }],
    ['POST', `/api/sales/${saleA.id}/void`, { reason: 'sin permiso' }],
  ];

  it('con "Finanzas": gastos y balance sí; la caja (solo dueño) no', async () => {
    for (const [method, url] of financeRoutes()) expect((await send(financeA, method as 'GET', url)).statusCode, url).toBe(200);
    for (const [method, url, payload] of ownerOnly()) expect((await send(financeA, method as 'GET', url, payload)).statusCode, url).toBe(403);
  });

  it('sin "Finanzas": 403 en todo lo financiero, también en escrituras', async () => {
    for (const [method, url] of financeRoutes()) expect((await send(plainA, method as 'GET', url)).statusCode, url).toBe(403);
    for (const [method, url, payload] of ownerOnly()) expect((await send(plainA, method as 'GET', url, payload)).statusCode, url).toBe(403);
    expect((await send(plainA, 'POST', '/api/expenses', { amount: 1000, description: 'x', method: 'bank_transfer' })).statusCode).toBe(403);
    expect((await send(plainA, 'PUT', `/api/expenses/${expenseA.id}`, { amount: 1000, description: 'x', method: 'bank_transfer' })).statusCode).toBe(403);
    expect((await send(plainA, 'POST', `/api/expenses/${expenseA.id}/void`, { reason: 'x' })).statusCode).toBe(403);
  });

  it('quitar "Finanzas" aplica en la siguiente petición (sin volver a iniciar sesión); desactivar corta el acceso', async () => {
    expect((await send(financeA, 'GET', `/api/expenses?${range()}`)).statusCode).toBe(200);
    expect((await send(a, 'PATCH', `/api/employees/${financeEmployeeId}`, { permissions: [] })).statusCode).toBe(200);
    expect((await send(financeA, 'GET', `/api/expenses?${range()}`)).statusCode).toBe(403);
    expect((await send(financeA, 'GET', `/api/reports/balance/export.xlsx?${range()}`)).statusCode).toBe(403);
    expect((await send(a, 'PATCH', `/api/employees/${financeEmployeeId}`, { permissions: ['finance'] })).statusCode).toBe(200);
    expect((await send(financeA, 'GET', `/api/expenses?${range()}`)).statusCode).toBe(200);
    expect((await send(a, 'PATCH', `/api/employees/${financeEmployeeId}`, { active: false })).statusCode).toBe(200);
    expect((await send(financeA, 'GET', `/api/expenses?${range()}`)).statusCode).toBe(401);
  });
});

describe('segunda barrera: RLS en service_records (migración 0035)', () => {
  it('con el rol restringido, una consulta SIN filtro por negocio solo ve las filas del negocio de la sesión', async () => {
    const { sql } = await import('drizzle-orm');
    const { withBusiness } = await import('../src/booking/scope');
    const { rows: [all] } = await testDb.pool.query('select count(*)::int as n from service_records');
    const { rows: [ofA] } = await testDb.pool.query('select count(*)::int as n from service_records where business_id = $1', [a.business.id]);
    expect(ofA.n).toBeGreaterThan(0);
    const seenByB = await withBusiness(testDb.db, b.business.id, (tx) => tx.execute<{ n: number }>(sql`select count(*)::int as n, count(*) filter (where business_id <> ${b.business.id})::int as foreign from service_records`));
    expect(seenByB.rows[0]).toMatchObject({ foreign: 0 });
    const seenByA = await withBusiness(testDb.db, a.business.id, (tx) => tx.execute<{ n: number }>(sql`select count(*)::int as n from service_records`));
    expect(seenByA.rows[0]!.n).toBe(ofA.n);
    expect(all.n).toBeGreaterThanOrEqual(ofA.n);
  });

  it('el rol restringido solo puede LEER service_records (escribir sigue siendo del flujo de ventas y citas)', async () => {
    const { sql } = await import('drizzle-orm');
    const { withBusiness } = await import('../src/booking/scope');
    // Drizzle envuelve el error de PostgreSQL: el motivo real está en `cause`.
    const pgError = (run: () => Promise<unknown>) => run().then(() => 'sin error', (e: { cause?: { message?: string }; message: string }) => e.cause?.message ?? e.message);
    expect(await pgError(() => withBusiness(testDb.db, a.business.id, (tx) => tx.execute(sql`update service_records set amount = amount where business_id = ${a.business.id}`)))).toMatch(/permission denied for table service_records/);
    expect(await pgError(() => withBusiness(testDb.db, a.business.id, (tx) => tx.execute(sql`delete from service_records where business_id = ${a.business.id}`)))).toMatch(/permission denied for table service_records/);
  });
});
