import type { AuthSession, CashDaySummary, ExpenseDto } from '@xiro/shared';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { addDays, localDate } from '../src/booking/time';
import { auth, register, TZ } from './helpers/booking';
import { createTestDatabase, testAppConfig, type TestDatabase } from './helpers/db';

/**
 * Finanzas, fase 2 — integración con Caja: "pagado desde caja" exige la caja abierta; sin ella, se registra como "no pagado
 * desde caja"; el formato anterior de Cierre de caja no cambia; y un gasto de una caja YA CERRADA solo se corrige o anula con
 * un ajuste explícito, que queda registrado (antes/después) y a la vista en el resumen de ese día.
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

const today = () => localDate(new Date(), TZ);
const send = (session: AuthSession, method: 'GET' | 'POST' | 'PUT', url: string, payload?: Record<string, unknown>) =>
  app.inject({ method, url, headers: auth(session), ...(payload === undefined ? {} : { payload: payload as InjectOptions['payload'] }) });
const create = (session: AuthSession, payload: Record<string, unknown>) => send(session, 'POST', '/api/expenses', payload);
const summary = async (session: AuthSession, day = today()) => (await send(session, 'GET', `/api/cash/close-summary?day=${day}`)).json<CashDaySummary>();
const open = (session: AuthSession, amount = 100000) => send(session, 'POST', '/api/cash/opening', { amount });
const close = (session: AuthSession, countedAmount: number) => send(session, 'POST', '/api/cash/close', { day: today(), countedAmount });

describe('caja abierta', () => {
  it('"desde caja" explícito sin caja abierta → 409 claro; como "no pagado desde caja" sí se registra y no toca el arqueo', async () => {
    const owner = await register(app, 'Sin caja');
    const res = await create(owner, { amount: 10000, description: 'Insumos', method: 'cash', category: 'supplies', paidFromCash: true });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'cash_not_open', cashDay: today() });
    const notFromCash = await create(owner, { amount: 10000, description: 'Insumos', method: 'cash', category: 'supplies', paidFromCash: false });
    expect(notFromCash.statusCode).toBe(201);
    expect(notFromCash.json<ExpenseDto>().paidFromCash).toBe(false);
    await open(owner, 50000);
    expect((await summary(owner)).expectedCash).toBe(50000); // el gasto "no desde caja" no se resta
  });

  it('con la caja abierta, "desde caja" se enlaza a la apertura y se resta; el formato anterior (sin la marca) sigue igual', async () => {
    const owner = await register(app, 'Con caja');
    await open(owner, 80000);
    expect((await create(owner, { amount: 5000, description: 'Café', method: 'cash', paidFromCash: true })).json<ExpenseDto>().paidFromCash).toBe(true);
    expect((await create(owner, { amount: 3000, description: 'Domicilio', method: 'cash' })).json<ExpenseDto>().paidFromCash).toBe(true);
    expect((await summary(owner)).expectedCash).toBe(72000);
  });

  it('un gasto de otro día "desde caja" exige la caja de ESE día (un día sin apertura → 409)', async () => {
    const owner = await register(app, 'Otro día');
    await open(owner);
    const res = await create(owner, { amount: 1000, description: 'Ayer', method: 'cash', paidFromCash: true, expenseDate: addDays(today(), -3) });
    expect(res.json()).toMatchObject({ code: 'cash_not_open' });
  });
});

describe('ajustes con la caja cerrada', () => {
  async function closedDay(label: string) {
    const owner = await register(app, label);
    await open(owner, 100000);
    const expense = (await create(owner, { amount: 20000, description: 'Insumos', method: 'cash', category: 'supplies', paidFromCash: true })).json<ExpenseDto>();
    expect((await close(owner, 80000)).statusCode).toBe(201);
    return { owner, expense };
  }

  it('sin motivo de ajuste: 409 que indica que se puede ajustar; agregar uno nuevo desde esa caja: 409 sin ajuste posible', async () => {
    const { owner, expense } = await closedDay('Cerrada sin motivo');
    const voidRes = await send(owner, 'POST', `/api/expenses/${expense.id}/void`, { reason: 'Error' });
    expect(voidRes.json()).toMatchObject({ code: 'expense_day_closed', adjustable: true, cashDay: today() });
    const editRes = await send(owner, 'PUT', `/api/expenses/${expense.id}`, { amount: 15000, description: 'Insumos', method: 'cash', category: 'supplies' });
    expect(editRes.json()).toMatchObject({ code: 'expense_day_closed', adjustable: true });
    const newRes = await create(owner, { amount: 1000, description: 'Tarde', method: 'cash', paidFromCash: true });
    expect(newRes.json()).toMatchObject({ code: 'expense_day_closed', adjustable: false });
    expect((await list(owner)).find((e) => e.id === expense.id)).toMatchObject({ status: 'active', cashDayClosed: true });
  });

  it('anular con ajuste: se anula, queda registrado (20.000 → 0) y el resumen del día lo muestra; el cierre firmado no cambia', async () => {
    const { owner, expense } = await closedDay('Cerrada anular');
    const res = await send(owner, 'POST', `/api/expenses/${expense.id}/void`, { reason: 'Se pagó con la tarjeta', adjustmentReason: 'El pago fue con tarjeta, no salió de la caja' });
    expect(res.statusCode).toBe(200);
    expect(res.json<ExpenseDto>().status).toBe('voided');
    const detail = (await send(owner, 'GET', `/api/expenses/${expense.id}`)).json<ExpenseDto>();
    expect(detail.adjustments).toMatchObject([{ kind: 'void', reason: 'El pago fue con tarjeta, no salió de la caja', amountBefore: 20000, amountAfter: 0, cashDay: today() }]);
    expect(detail.adjustments![0]!.createdByName).toBeTruthy();
    const s = await summary(owner);
    expect(s.adjustmentsAfterClose).toHaveLength(1);
    expect(s.expectedCash).toBe(100000); // en vivo ya no se resta
    // El cierre firmado conserva lo que se contó y esperó en su momento.
    const [closing] = (await send(owner, 'GET', `/api/cash/closings?from=${today()}&to=${today()}`)).json<Array<{ expectedAmount: number; countedAmount: number }>>();
    expect(closing).toMatchObject({ expectedAmount: 80000, countedAmount: 80000 });
  });

  it('editar con ajuste: registra lo que salía antes y después; un motivo vacío o corto se rechaza', async () => {
    const { owner, expense } = await closedDay('Cerrada editar');
    const short = await send(owner, 'PUT', `/api/expenses/${expense.id}`, { amount: 15000, description: 'Insumos', method: 'cash', category: 'supplies', adjustmentReason: 'no' });
    expect(short.statusCode).toBe(400);
    const ok = await send(owner, 'PUT', `/api/expenses/${expense.id}`, { amount: 15000, description: 'Insumos (corregido)', method: 'cash', category: 'supplies', adjustmentReason: 'El recibo era de 15.000' });
    expect(ok.statusCode).toBe(200);
    const detail = (await send(owner, 'GET', `/api/expenses/${expense.id}`)).json<ExpenseDto>();
    expect(detail).toMatchObject({ amount: 15000, description: 'Insumos (corregido)' });
    expect(detail.adjustments).toMatchObject([{ kind: 'edit', amountBefore: 20000, amountAfter: 15000 }]);
    expect((await summary(owner)).expectedCash).toBe(85000);
  });

  it('un gasto que NO salió de la caja cerrada se edita y anula sin ajuste (no toca ningún arqueo)', async () => {
    const owner = await register(app, 'Cerrada transferencia');
    await open(owner);
    const transfer = (await create(owner, { amount: 50000, description: 'Arriendo', method: 'bank_transfer', category: 'rent' })).json<ExpenseDto>();
    await close(owner, 100000);
    expect((await send(owner, 'PUT', `/api/expenses/${transfer.id}`, { amount: 55000, description: 'Arriendo', method: 'bank_transfer', category: 'rent' })).statusCode).toBe(200);
    expect((await send(owner, 'POST', `/api/expenses/${transfer.id}/void`, { reason: 'Duplicado' })).statusCode).toBe(200);
    expect((await summary(owner)).adjustmentsAfterClose).toEqual([]);
  });
});

const list = async (session: AuthSession) => (await send(session, 'GET', '/api/expenses?from=2000-01-01&to=2100-01-01&status=all')).json<ExpenseDto[]>();
