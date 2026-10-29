import type { AuthSession, BalanceDto, BalanceMovementsPage, CashClosingDto, CashDaySummary, ExpensesPage, SaleDto } from '@xiro/shared';
import ExcelJS from 'exceljs';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { addDays, localDate } from '../src/booking/time';
import { auth, createEmployee, createService, register, TZ } from './helpers/booking';
import { createTestDatabase, testAppConfig, type TestDatabase } from './helpers/db';

/**
 * Fase 5 de la auditoría — reglas y cálculos financieros con VALORES CONOCIDOS (calculados a mano, no por el código): la
 * caja, el balance, los movimientos, el Excel y el listado de gastos cuentan lo mismo y cuadran entre sí. Las reglas están en
 * docs/finance-rules.md. El descuento en reservas (lo cobrado al completar es el total menos el código) está en discounts.test.ts.
 */
let app: FastifyInstance;
let testDb: TestDatabase;
let cleanupConfig: () => void;
let owner: AuthSession;

const today = () => localDate(new Date(), TZ);
const send = (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: Record<string, unknown>) =>
  app.inject({ method, url, headers: auth(owner), ...(payload === undefined ? {} : { payload: payload as InjectOptions['payload'] }) });
const ok = async (method: 'POST' | 'PUT' | 'PATCH', url: string, payload: Record<string, unknown>) => {
  const res = await send(method, url, payload);
  expect(res.statusCode, `${method} ${url}: ${res.body}`).toBeLessThan(300);
  return res;
};
const balance = async (from = today(), to = today()) => (await send('GET', `/api/reports/balance?from=${from}&to=${to}`)).json<BalanceDto>();
const cash = async () => (await send('GET', `/api/cash/close-summary?day=${today()}`)).json<CashDaySummary>();

/**
 * El día de prueba (todo hoy, salvo un gasto de ayer):
 *  - base de caja 100.000
 *  - venta 1: servicio 50.000 + producto 2 × 10.000 = 70.000; descuento 7.000; propina 5.000 → total 68.000
 *    pagado 40.000 en efectivo + 28.000 con tarjeta
 *  - venta 2: servicio 30.000 en efectivo, ANULADA
 *  - un servicio registrado a mano (sin venta): 15.000
 *  - gastos: 12.000 desde caja (operativo), 20.000 por transferencia de nómina a un empleado INACTIVO,
 *    9.000 ANULADO, y 3.000 de AYER (retroactivo)
 */
beforeAll(async () => {
  testDb = await createTestDatabase();
  const { config, cleanup } = testAppConfig();
  cleanupConfig = cleanup;
  app = await buildApp({ db: testDb.db, config });
  owner = await register(app, 'Reglas financieras');

  await ok('POST', '/api/cash/opening', { amount: 100_000 });
  const service = await createService(app, owner, { name: 'Corte', price: 50_000 });
  const product = await createService(app, owner, { name: 'Cera', price: 10_000, kind: 'product', stock: 20 });
  const cheap = await createService(app, owner, { name: 'Cejas', price: 30_000 });
  const manual = await createService(app, owner, { name: 'Barba', price: 15_000 });

  await ok('POST', '/api/sales', {
    occasional: true,
    lines: [{ kind: 'service', itemId: service.id, quantity: 1 }, { kind: 'product', itemId: product.id, quantity: 2 }],
    discount: 7_000,
    tip: 5_000,
    payments: [{ method: 'cash', amount: 40_000 }, { method: 'card', amount: 28_000 }],
  });
  const voided = (await ok('POST', '/api/sales', { occasional: true, lines: [{ kind: 'service', itemId: cheap.id, quantity: 1 }], payments: [{ method: 'cash', amount: 30_000 }] })).json<SaleDto>();
  await ok('POST', `/api/sales/${voided.id}/void`, { reason: 'Error de cobro' });

  const client = (await ok('POST', '/api/clients', { name: 'Cliente de prueba' })).json<{ id: string }>();
  await ok('POST', '/api/service-records', { clientId: client.id, itemId: manual.id });

  await ok('POST', '/api/expenses', { amount: 12_000, description: 'Insumos', method: 'cash', paidFromCash: true, category: 'supplies' });
  const { employee } = await createEmployee(app, owner, []);
  await ok('PATCH', `/api/employees/${employee.id}`, { active: false });
  await ok('POST', '/api/expenses', { amount: 20_000, description: 'Liquidación', method: 'bank_transfer', type: 'payroll', category: 'salary', employeeId: employee.id });
  const wrong = (await ok('POST', '/api/expenses', { amount: 9_000, description: 'Duplicado', method: 'bank_transfer', category: 'other' })).json<{ id: string }>();
  await ok('POST', `/api/expenses/${wrong.id}/void`, { reason: 'Duplicado' });
  await ok('POST', '/api/expenses', { amount: 3_000, description: 'Agua de ayer', method: 'bank_transfer', category: 'utilities_water', expenseDate: addDays(today(), -1) });
});

afterAll(async () => {
  await app.close();
  cleanupConfig();
  await testDb.drop();
});

describe('valores conocidos del día', () => {
  it('Balance: ingresos = servicios + productos − descuentos (venta anulada fuera, servicio a mano dentro); propina aparte', async () => {
    const { totals } = await balance();
    expect(totals).toEqual({
      services: 65_000, // 50.000 de la venta + 15.000 registrado a mano
      products: 20_000,
      discounts: 7_000,
      income: 78_000,
      tips: 5_000,
      operating: 12_000, // el anulado (9.000) no cuenta; el de ayer (3.000) es de otro día
      payroll: 20_000, // pagado a un empleado inactivo: permitido (liquidación)
      net: 46_000,
      margin: 59, // 46.000 / 78.000 = 58,97 % → 59,0
    });
    // El gasto retroactivo cuenta en SU día.
    expect((await balance(addDays(today(), -1), addDays(today(), -1))).totals.operating).toBe(3_000);
  });

  it('Caja: ventas con propina (lo cobrado), por método; efectivo esperado = base + efectivo − gastos desde caja', async () => {
    const s = await cash();
    expect({ totalSales: s.totalSales, totalTip: s.totalTip, totalExpenses: s.totalExpenses, expectedCash: s.expectedCash }).toEqual({
      totalSales: 68_000,
      totalTip: 5_000,
      totalExpenses: 32_000, // 12.000 + 20.000 (el anulado no cuenta; el de ayer es de ayer)
      expectedCash: 128_000, // 100.000 + 40.000 en efectivo − 12.000 desde caja (la nómina fue por transferencia)
    });
    expect(Object.fromEntries(s.salesByMethod.map((m) => [m.method, m.total]))).toEqual({ cash: 40_000, card: 28_000 });
    // El servicio registrado a mano no tiene método de pago: se muestra aparte, no entra al arqueo.
    expect(s.unbilledRecords).toEqual({ count: 1, total: 15_000 });
  });

  it('conciliación Caja ↔ Balance: ingresos del balance = ventas de caja − propinas + cobros sin venta', async () => {
    const [b, s] = [await balance(), await cash()];
    expect(b.totals.income).toBe(s.totalSales - s.totalTip + s.unbilledRecords.total);
    expect(b.totals.operating + b.totals.payroll).toBe(s.totalExpenses);
  });

  it('Movimientos: entradas − salidas = utilidad del balance; y cada fila una sola vez', async () => {
    const page = (await send('GET', `/api/reports/balance/movements?from=${today()}&to=${today()}&pageSize=200`)).json<BalanceMovementsPage>();
    const total = (dir: 'in' | 'out') => page.rows.filter((r) => r.direction === dir).reduce((sum, r) => sum + r.amount, 0);
    expect(total('in')).toBe(85_000); // 50.000 + 20.000 + 15.000
    expect(total('out')).toBe(39_000); // descuento 7.000 + 12.000 + 20.000
    expect(total('in') - total('out')).toBe((await balance()).totals.net);
    expect(new Set(page.rows.map((r) => `${r.kind}:${r.id}`)).size).toBe(page.rows.length);
  });

  it('Excel del balance y listado de Gastos: los mismos números', async () => {
    const res = await send('GET', `/api/reports/balance/export.xlsx?from=${today()}&to=${today()}`);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.rawPayload as unknown as ExcelJS.Buffer);
    const rows: unknown[][] = [];
    wb.getWorksheet('Resumen')!.eachRow((row) => rows.push((row.values as unknown[]).slice(1)));
    const line = (label: string) => rows.find((r) => r[0] === label)![1];
    expect([line('Ingresos'), line('Gastos operativos'), line('Nómina'), line('Utilidad neta')]).toEqual([78_000, -12_000, -20_000, 46_000]);

    const active = (await send('GET', `/api/expenses/page?from=${today()}&to=${today()}`)).json<ExpensesPage>().summary;
    const all = (await send('GET', `/api/expenses/page?from=${today()}&to=${today()}&status=all`)).json<ExpensesPage>().summary;
    expect(active).toEqual({ count: 2, activeCount: 2, activeTotal: 32_000 });
    expect(all).toEqual({ count: 3, activeCount: 2, activeTotal: 32_000 });
  });
});

describe('reglas', () => {
  it('fecha del gasto posterior a hoy: 400 expense_date_future (alta y edición); hoy y días pasados sí', async () => {
    const future = await send('POST', '/api/expenses', { amount: 1_000, description: 'Futuro', method: 'bank_transfer', expenseDate: addDays(today(), 1) });
    expect(future.statusCode).toBe(400);
    expect(future.json()).toMatchObject({ code: 'expense_date_future' });
    const created = (await ok('POST', '/api/expenses', { amount: 1_000, description: 'Hoy', method: 'bank_transfer', expenseDate: today() })).json<{ id: string }>();
    const moved = await send('PUT', `/api/expenses/${created.id}`, { amount: 1_000, description: 'Hoy', method: 'bank_transfer', expenseDate: addDays(today(), 3) });
    expect(moved.statusCode).toBe(400);
    expect(moved.json()).toMatchObject({ code: 'expense_date_future' });
    expect((await send('PUT', `/api/expenses/${created.id}`, { amount: 1_000, description: 'Hace un año', method: 'bank_transfer', expenseDate: addDays(today(), -365) })).statusCode).toBe(200);
  });

  it('cierre y ventas después del cierre: lo firmado no cambia, la diferencia queda explicada y el balance la incluye', async () => {
    const closing = (await ok('POST', '/api/cash/close', { day: today(), countedAmount: 128_000 })).json<CashClosingDto>();
    expect(closing).toMatchObject({ openingAmount: 100_000, expectedAmount: 128_000, totalSales: 68_000, totalTip: 5_000, totalExpenses: 32_000, difference: 0 });
    const before = (await balance()).totals.income;
    const service = await createService(app, owner, { name: 'Tardía', price: 10_000 });
    await ok('POST', '/api/sales', { occasional: true, lines: [{ kind: 'service', itemId: service.id, quantity: 1 }], payments: [{ method: 'cash', amount: 10_000 }] });
    const s = await cash();
    expect(s.afterClose).toMatchObject({ closedSales: 68_000, closedExpectedCash: 128_000, salesDelta: 10_000, expectedCashDelta: 10_000 });
    expect((await balance()).totals.income).toBe(before + 10_000);
    // El cierre guardado sigue igual.
    const { rows } = await testDb.pool.query('select expected_amount, total_sales from cash_closings where id = $1', [closing.id]);
    expect(rows[0]).toEqual({ expected_amount: 128_000, total_sales: 68_000 });
  });
});
