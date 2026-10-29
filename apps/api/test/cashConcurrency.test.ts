import type { AuthSession, CashClosingDto, CashDaySummary, ExpenseDto, SaleDto } from '@xiro/shared';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { localDate } from '../src/booking/time';
import { auth, createService, register, TZ } from './helpers/booking';
import { createTestDatabase, testAppConfig, type TestDatabase } from './helpers/db';

/**
 * Concurrencia entre el CIERRE DE CAJA y las operaciones que lo afectan (gastos pagados desde caja, ventas). El cierre
 * calcula el resumen del día y lo firma; si otra operación confirma "en medio", el cierre firmado no la refleja.
 *
 * Para reproducir la carrera de forma determinista, un trigger de la base de PRUEBA hace lenta una operación concreta
 * (marcada con un valor especial) con pg_sleep, y la otra se lanza mientras tanto:
 *   A) la operación ya comprobó "caja abierta" y está a punto de confirmar → entra el cierre.
 *   B) el cierre ya calculó su resumen y está a punto de confirmar → entra la operación.
 * Invariante: al terminar, lo firmado en el cierre coincide con lo registrado (o la operación se rechazó con 409).
 */
let app: FastifyInstance;
let testDb: TestDatabase;
let cleanupConfig: () => void;
const SLOW = 1.2; // segundos

beforeAll(async () => {
  testDb = await createTestDatabase();
  const { config, cleanup } = testAppConfig();
  cleanupConfig = cleanup;
  app = await buildApp({ db: testDb.db, config });
  // Solo en la base de prueba: vuelven lenta UNA operación marcada, para poder intercalar la otra.
  await testDb.pool.query(`
    create or replace function test_slow() returns trigger language plpgsql as $$ begin perform pg_sleep(${SLOW}); return new; end $$;
    create trigger test_slow_expense_insert before insert on expenses for each row when (new.description = 'LENTO') execute function test_slow();
    create trigger test_slow_expense_update before update on expenses for each row when (new.amount = 7777 or (new.status = 'voided' and old.description = 'LENTO-ANULAR')) execute function test_slow();
    create trigger test_slow_sale_insert before insert on sales for each row when (new.client_label = 'LENTO') execute function test_slow();
    create trigger test_slow_sale_void before update on sales for each row when (new.status = 'voided' and new.client_label = 'LENTO-ANULAR') execute function test_slow();
    create trigger test_slow_closing before insert on cash_closings for each row when (new.note = 'LENTO') execute function test_slow();
  `);
});

afterAll(async () => {
  await app.close();
  cleanupConfig();
  await testDb.drop();
});

const today = () => localDate(new Date(), TZ);
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const send = (session: AuthSession, method: 'GET' | 'POST' | 'PUT', url: string, payload?: Record<string, unknown>) =>
  app.inject({ method, url, headers: auth(session), ...(payload === undefined ? {} : { payload: payload as InjectOptions['payload'] }) });
const summary = async (s: AuthSession) => (await send(s, 'GET', `/api/cash/close-summary?day=${today()}`)).json<CashDaySummary>();
const closeCash = (s: AuthSession, note = '') => send(s, 'POST', '/api/cash/close', { day: today(), countedAmount: 0, note });

async function openBusiness(label: string) {
  const owner = await register(app, label);
  expect((await send(owner, 'POST', '/api/cash/opening', { amount: 100000 })).statusCode).toBe(201);
  const service = await createService(app, owner, { name: 'Corte', price: 30000 });
  return { owner, service };
}

/** Lo firmado en el cierre coincide con lo que quedó registrado ese día. */
async function expectClosingMatches(owner: AuthSession, closing: CashClosingDto) {
  const now = await summary(owner);
  expect({ expected: closing.expectedAmount, sales: closing.totalSales, expenses: closing.totalExpenses }).toEqual({ expected: now.expectedCash, sales: now.totalSales, expenses: now.totalExpenses });
}

describe('A) la operación está en curso cuando entra el cierre: el cierre la espera y la incluye', () => {
  it('alta de un gasto pagado desde caja', async () => {
    const { owner } = await openBusiness('Carrera alta gasto');
    const expense = send(owner, 'POST', '/api/expenses', { amount: 12000, description: 'LENTO', method: 'cash', paidFromCash: true });
    await wait(300);
    const closing = await closeCash(owner);
    expect((await expense).statusCode).toBe(201);
    expect(closing.statusCode, closing.body).toBe(201);
    await expectClosingMatches(owner, closing.json<CashClosingDto>());
    expect(closing.json<CashClosingDto>().expectedAmount).toBe(88000);
  });

  it('edición del monto de un gasto pagado desde caja', async () => {
    const { owner } = await openBusiness('Carrera edición gasto');
    const created = (await send(owner, 'POST', '/api/expenses', { amount: 10000, description: 'Insumos', method: 'cash', paidFromCash: true })).json<ExpenseDto>();
    const edit = send(owner, 'PUT', `/api/expenses/${created.id}`, { amount: 7777, description: 'Insumos', method: 'cash', paidFromCash: true });
    await wait(300);
    const closing = await closeCash(owner);
    expect((await edit).statusCode).toBe(200);
    expect(closing.statusCode, closing.body).toBe(201);
    await expectClosingMatches(owner, closing.json<CashClosingDto>());
  });

  it('anulación de un gasto pagado desde caja', async () => {
    const { owner } = await openBusiness('Carrera anulación gasto');
    const created = (await send(owner, 'POST', '/api/expenses', { amount: 10000, description: 'LENTO-ANULAR', method: 'cash', paidFromCash: true })).json<ExpenseDto>();
    const voiding = send(owner, 'POST', `/api/expenses/${created.id}/void`, { reason: 'Duplicado' });
    await wait(300);
    const closing = await closeCash(owner);
    expect((await voiding).statusCode).toBe(200);
    expect(closing.statusCode, closing.body).toBe(201);
    await expectClosingMatches(owner, closing.json<CashClosingDto>());
  });

  it('venta en efectivo', async () => {
    const { owner, service } = await openBusiness('Carrera venta');
    const sale = send(owner, 'POST', '/api/sales', { occasional: true, clientLabel: 'LENTO', lines: [{ kind: 'service', itemId: service.id, quantity: 1 }], payments: [{ method: 'cash', amount: 30000 }] });
    await wait(300);
    const closing = await closeCash(owner);
    expect((await sale).statusCode).toBe(201);
    expect(closing.statusCode, closing.body).toBe(201);
    await expectClosingMatches(owner, closing.json<CashClosingDto>());
    expect(closing.json<CashClosingDto>().expectedAmount).toBe(130000);
  });

  it('anulación de una venta en efectivo', async () => {
    const { owner, service } = await openBusiness('Carrera anulación venta');
    const created = (await send(owner, 'POST', '/api/sales', { occasional: true, clientLabel: 'LENTO-ANULAR', lines: [{ kind: 'service', itemId: service.id, quantity: 1 }], payments: [{ method: 'cash', amount: 30000 }] })).json<SaleDto>();
    const voiding = send(owner, 'POST', `/api/sales/${created.id}/void`, { reason: 'Error de cobro' });
    await wait(300);
    const closing = await closeCash(owner);
    expect((await voiding).statusCode).toBe(200);
    expect(closing.statusCode, closing.body).toBe(201);
    await expectClosingMatches(owner, closing.json<CashClosingDto>());
  });
});

describe('B) el cierre está en curso cuando llega la operación', () => {
  it('un gasto pagado desde caja espera al cierre y se rechaza con 409 (el día ya quedó cerrado)', async () => {
    const { owner } = await openBusiness('Carrera cierre lento gasto');
    const closing = closeCash(owner, 'LENTO');
    await wait(300);
    const expense = await send(owner, 'POST', '/api/expenses', { amount: 12000, description: 'Insumos', method: 'cash', paidFromCash: true });
    expect((await closing).statusCode).toBe(201);
    expect(expense.statusCode, expense.body).toBe(409);
    expect(expense.json()).toMatchObject({ code: 'expense_day_closed' });
    await expectClosingMatches(owner, (await closing).json<CashClosingDto>());
  });

  it('dos cierres simultáneos del mismo día: uno se firma y el otro recibe 409 (nunca dos cierres ni un 500)', async () => {
    const { owner } = await openBusiness('Carrera doble cierre');
    const [a, b] = await Promise.all([closeCash(owner, 'LENTO'), (async () => (await wait(300), closeCash(owner)))()]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([201, 409]);
    const { rows } = await testDb.pool.query("select count(*)::int as n from cash_closings where day = $1 and status = 'completed' and business_id = $2", [today(), owner.business.id]);
    expect(rows[0].n).toBe(1);
  });
});

describe('B) más casos con el cierre en curso', () => {
  it('una venta espera al cierre, se registra y queda "después del cierre": el cierre firmado no cambia y el resumen lo explica', async () => {
    const { owner, service } = await openBusiness('Carrera cierre lento venta');
    const closing = closeCash(owner, 'LENTO');
    await wait(300);
    const sale = await send(owner, 'POST', '/api/sales', { occasional: true, lines: [{ kind: 'service', itemId: service.id, quantity: 1 }], payments: [{ method: 'cash', amount: 30000 }] });
    const signed = (await closing).json<CashClosingDto>();
    expect(sale.statusCode, sale.body).toBe(201);
    expect(signed).toMatchObject({ totalSales: 0, expectedAmount: 100000 });
    const now = await summary(owner);
    expect(now.totalSales).toBe(30000);
    expect(now.afterClose).toMatchObject({ closedSales: 0, closedExpectedCash: 100000, salesDelta: 30000, expectedCashDelta: 30000 });
  });

  it('anular un gasto desde caja mientras se cierra: espera y luego exige el ajuste con motivo (409 adjustable)', async () => {
    const { owner } = await openBusiness('Carrera cierre lento anulación');
    const created = (await send(owner, 'POST', '/api/expenses', { amount: 10000, description: 'Insumos', method: 'cash', paidFromCash: true })).json<ExpenseDto>();
    const closing = closeCash(owner, 'LENTO');
    await wait(300);
    const voiding = await send(owner, 'POST', `/api/expenses/${created.id}/void`, { reason: 'Duplicado' });
    expect((await closing).statusCode).toBe(201);
    expect(voiding.statusCode).toBe(409);
    expect(voiding.json()).toMatchObject({ code: 'expense_day_closed', adjustable: true });
    await expectClosingMatches(owner, (await closing).json<CashClosingDto>());
  });

  it('un día sin cerrar no trae "después del cierre"', async () => {
    const { owner } = await openBusiness('Sin cierre');
    expect((await summary(owner)).afterClose).toBeNull();
  });
});

describe('ráfaga: muchas ventas y gastos a la vez con un cierre en medio', () => {
  it('nada se pierde ni se cuenta dos veces, y lo firmado es coherente con lo que quedó dentro del cierre', async () => {
    const { owner, service } = await openBusiness('Ráfaga');
    const sale = () => send(owner, 'POST', '/api/sales', { occasional: true, lines: [{ kind: 'service', itemId: service.id, quantity: 1 }], payments: [{ method: 'cash', amount: 30000 }] });
    const expense = () => send(owner, 'POST', '/api/expenses', { amount: 5000, description: 'Insumos', method: 'cash', paidFromCash: true });
    const ops = [...Array.from({ length: 10 }, sale), ...Array.from({ length: 6 }, expense)];
    const [closing, ...results] = await Promise.all([(async () => (await wait(40), closeCash(owner)))(), ...ops]);
    expect(closing.statusCode, closing.body).toBe(201);
    const signed = closing.json<CashClosingDto>();
    const sales = results.slice(0, 10);
    const expenses = results.slice(10);
    // Ventas: todas se registran (antes o después del cierre). Gastos: entran o se rechazan con 409, nunca a medias.
    expect(sales.every((r) => r.statusCode === 201)).toBe(true);
    expect(expenses.every((r) => r.statusCode === 201 || (r.statusCode === 409 && r.json().code === 'expense_day_closed'))).toBe(true);
    const acceptedExpenses = expenses.filter((r) => r.statusCode === 201).length;
    // Lo firmado es un subconjunto exacto: múltiplos de cada monto y el efectivo esperado cuadra con esas ventas y gastos.
    expect(signed.totalSales % 30000).toBe(0);
    expect(signed.totalExpenses % 5000).toBe(0);
    expect(signed.expectedAmount).toBe(100000 + signed.totalSales - signed.totalExpenses);
    // Ningún gasto aceptado quedó fuera del cierre (los que llegaron después se rechazaron).
    expect(signed.totalExpenses).toBe(acceptedExpenses * 5000);
    // Y el resumen de ahora: todas las ventas exactamente una vez; la diferencia con lo firmado, explicada.
    const now = await summary(owner);
    expect(now.totalSales).toBe(10 * 30000);
    expect(now.totalExpenses).toBe(acceptedExpenses * 5000);
    expect(now.afterClose!.salesDelta).toBe(now.totalSales - signed.totalSales);
    expect(now.expectedCash).toBe(signed.expectedAmount + now.afterClose!.expectedCashDelta);
  });
});
