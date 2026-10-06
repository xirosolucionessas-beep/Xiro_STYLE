import type { AuthSession, CashClosingDto, CashDaySummary, CashOpeningDto, ExpenseDto, SaleDto } from '@xiro/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { auth, createEmployee, createService, register, TZ } from './helpers/booking';
import { createTestDatabase, testAppConfig, type TestDatabase } from './helpers/db';

let testDb: TestDatabase;
let app: FastifyInstance;
let cleanup: () => void;

beforeAll(async () => {
  testDb = await createTestDatabase();
  const setup = testAppConfig();
  cleanup = setup.cleanup;
  app = await buildApp({ db: testDb.db, config: setup.config });
});
afterAll(async () => {
  await app.close();
  cleanup();
  await testDb.drop();
});

/** Fecha local de hoy (AAAA-MM-DD) en la zona horaria del negocio de prueba, igual que la usa el servidor. */
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

const send = (session: { accessToken: string }, method: 'GET' | 'POST', url: string, payload?: unknown) => app.inject({ method, url, headers: auth(session), payload: payload as object | undefined });

const openCash = (session: AuthSession, amount: number) => send(session, 'POST', '/api/cash/opening', { amount });
const summary = (session: AuthSession, day: string) => send(session, 'GET', `/api/cash/close-summary?day=${day}`).then((r) => r.json<CashDaySummary>());
const close = (session: AuthSession, day: string, countedAmount: number, note = '') => send(session, 'POST', '/api/cash/close', { day, countedAmount, note });
const closings = (session: AuthSession, from: string, to: string) => send(session, 'GET', `/api/cash/closings?from=${from}&to=${to}`).then((r) => r.json<CashClosingDto[]>());
const closing = (session: AuthSession, id: string) => send(session, 'GET', `/api/cash/closings/${id}`).then((r) => r.json<CashClosingDto>());
const voidClosing = (session: AuthSession, id: string, reason: string) => send(session, 'POST', `/api/cash/closings/${id}/void`, { reason });
const addExpense = (session: AuthSession, amount: number, description: string, method = 'cash') => send(session, 'POST', '/api/expenses', { amount, description, method });
const openings = (session: AuthSession, from: string, to: string) => send(session, 'GET', `/api/cash/openings?from=${from}&to=${to}`).then((r) => r.json<CashOpeningDto[]>());

async function saleOf(session: AuthSession, price: number, method: 'cash' | 'nequi' = 'cash'): Promise<SaleDto> {
  const service = await createService(app, session, { price });
  const res = await send(session, 'POST', '/api/sales', { occasional: true, lines: [{ kind: 'service', itemId: service.id, quantity: 1 }], payments: [{ method, amount: price }] });
  expect(res.statusCode).toBe(201);
  return res.json<SaleDto>();
}

describe('cierre de caja: resumen del día', () => {
  it('sin abrir caja ese día, `opening` y `expectedCash` son null', async () => {
    const owner = await register(app, 'SinAbrir');
    const day = await summary(owner, today());
    expect(day.opening).toBeNull();
    expect(day.expectedCash).toBeNull();
  });

  it('junta ventas en efectivo/otros métodos, gastos en efectivo y calcula el efectivo esperado', async () => {
    const owner = await register(app, 'Resumen');
    expect((await openCash(owner, 100_000)).statusCode).toBe(201);
    await saleOf(owner, 30_000, 'cash');
    await saleOf(owner, 50_000, 'nequi');
    await addExpense(owner, 10_000, 'Insumos', 'cash');
    await addExpense(owner, 5_000, 'Domicilio', 'nequi'); // no en efectivo: no descuenta del conteo físico

    const day = await summary(owner, today());
    expect(day.opening).toBe(100_000);
    expect(day.totalSales).toBe(80_000);
    expect(day.salesByMethod.find((m) => m.method === 'cash')).toMatchObject({ total: 30_000, count: 1 });
    expect(day.salesByMethod.find((m) => m.method === 'nequi')).toMatchObject({ total: 50_000, count: 1 });
    expect(day.totalExpenses).toBe(15_000);
    // 100.000 base + 30.000 en efectivo − 10.000 gasto en efectivo = 120.000 (el gasto en Nequi no toca el efectivo)
    expect(day.expectedCash).toBe(120_000);
    expect(day.clientsServed).toBe(2); // dos ventas ocasionales = dos personas distintas
  });

  it('GET /cash/openings?from&to: trae la base de hoy; un día sin apertura no inventa una fila (Reportes, "Base inicial")', async () => {
    const owner = await register(app, 'Openings');
    const list1 = await openings(owner, today(), today());
    expect(list1).toEqual([]); // nunca se abrió caja: sin fila, no un 0 inventado

    expect((await openCash(owner, 25_000)).statusCode).toBe(201);
    const list2 = await openings(owner, today(), today());
    expect(list2).toHaveLength(1);
    expect(list2[0]).toMatchObject({ day: today(), amount: 25_000 });
  });

  it('atribuye las ventas a quien atendió (comisiones)', async () => {
    const owner = await register(app, 'Comisiones');
    const luis = await createEmployee(app, owner, ['services_record']);
    const service = await createService(app, owner, { price: 40_000 });
    const res = await send(luis.session, 'POST', '/api/sales', { occasional: true, lines: [{ kind: 'service', itemId: service.id, quantity: 1, employeeId: luis.employee.id }], payments: [{ method: 'cash', amount: 40_000 }] });
    expect(res.statusCode).toBe(201);
    const day = await summary(owner, today());
    expect(day.employeeSales).toEqual([{ employeeId: luis.employee.id, employeeName: expect.any(String), total: 40_000, count: 1 }]);
  });
});

describe('cerrar y anular', () => {
  it('cierra el día, congela el sobrante/faltante, y no deja cerrar dos veces el mismo día', async () => {
    const owner = await register(app, 'Cerrar');
    await openCash(owner, 50_000);
    await saleOf(owner, 20_000, 'cash');
    // Efectivo esperado: 50.000 + 20.000 = 70.000; se cuenta 68.000 → faltan 2.000.
    const closed = await close(owner, today(), 68_000, 'Cuadre de la tarde');
    expect(closed.statusCode).toBe(201);
    const dto = closed.json<CashClosingDto>();
    expect(dto).toMatchObject({ openingAmount: 50_000, expectedAmount: 70_000, countedAmount: 68_000, difference: -2_000, status: 'completed' });
    expect(dto.summary?.totalSales).toBe(20_000);

    const again = await close(owner, today(), 70_000);
    expect(again.statusCode).toBe(409);
    expect(again.json<{ code: string }>().code).toBe('already_closed');
  });

  it('no se puede cerrar un día sin abrir caja', async () => {
    const owner = await register(app, 'SinCaja');
    const res = await close(owner, today(), 0);
    expect(res.statusCode).toBe(409);
    expect(res.json<{ code: string }>().code).toBe('no_opening');
  });

  it('anular exige motivo, no se puede anular dos veces, y libera el día para volver a cerrarlo', async () => {
    const owner = await register(app, 'Anular');
    await openCash(owner, 10_000);
    const created = (await close(owner, today(), 10_000)).json<CashClosingDto>();

    expect((await voidClosing(owner, created.id, '')).statusCode).toBe(400); // motivo obligatorio
    const voided = await voidClosing(owner, created.id, 'Conteo equivocado');
    expect(voided.statusCode).toBe(200);
    expect(voided.json<CashClosingDto>().status).toBe('voided');
    expect((await voidClosing(owner, created.id, 'otra vez')).statusCode).toBe(409);

    // El día vuelve a estar disponible para cerrar.
    const reclosed = await close(owner, today(), 10_000);
    expect(reclosed.statusCode).toBe(201);
  });

  it('un cierre guardado nunca cambia: consultarlo después de editar el catálogo sigue mostrando los mismos totales', async () => {
    const owner = await register(app, 'Historial');
    await openCash(owner, 0);
    await saleOf(owner, 25_000, 'cash');
    const created = (await close(owner, today(), 25_000)).json<CashClosingDto>();
    const fetched = await closing(owner, created.id);
    expect(fetched).toMatchObject({ id: created.id, expectedAmount: 25_000, countedAmount: 25_000, difference: 0 });
    expect(fetched.summary?.totalSales).toBe(25_000);
  });

  it('la lista de cierres respeta el rango de fechas', async () => {
    const owner = await register(app, 'Lista');
    await openCash(owner, 1_000);
    await close(owner, today(), 1_000);
    const list = await closings(owner, today(), today());
    expect(list).toHaveLength(1);
    const past = await closings(owner, '2020-01-01', '2020-01-02');
    expect(past).toHaveLength(0);
  });

  it('solo el dueño abre/cierra caja, registra gastos y anula un cierre', async () => {
    const owner = await register(app, 'SoloDueno');
    const cashier = await createEmployee(app, owner, ['services_record']);
    await openCash(owner, 5_000);
    const created = (await close(owner, today(), 5_000)).json<CashClosingDto>();

    expect((await openCash(cashier.session, 5_000)).statusCode).toBe(403);
    expect((await close(cashier.session, today(), 5_000)).statusCode).toBe(403);
    expect((await addExpense(cashier.session, 1_000, 'x')).statusCode).toBe(403);
    expect((await voidClosing(cashier.session, created.id, 'motivo')).statusCode).toBe(403);
    expect((await send(cashier.session, 'GET', `/api/cash/close-summary?day=${today()}`)).statusCode).toBe(403);
  });
});

describe('gastos', () => {
  it('registra un gasto y lo lista dentro del rango de fechas', async () => {
    const owner = await register(app, 'Gastos');
    const created = await addExpense(owner, 12_000, 'Aseo', 'cash');
    expect(created.statusCode).toBe(201);
    expect(created.json<ExpenseDto>()).toMatchObject({ amount: 12_000, description: 'Aseo', method: 'cash' });
    const list = await send(owner, 'GET', `/api/expenses?from=${today()}&to=${today()}`).then((r) => r.json<ExpenseDto[]>());
    expect(list).toHaveLength(1);
  });
});

describe('aislamiento entre negocios', () => {
  it('un negocio no ve, ni anula, los gastos ni los cierres de otro', async () => {
    const a = await register(app, 'NegocioA');
    await openCash(a, 1_000);
    const created = (await close(a, today(), 1_000)).json<CashClosingDto>();
    await addExpense(a, 500, 'Solo de A');

    const b = await register(app, 'NegocioB');
    expect((await send(b, 'GET', `/api/cash/closings/${created.id}`)).statusCode).toBe(404);
    expect((await voidClosing(b, created.id, 'ajeno')).statusCode).toBe(404);
    expect(await closings(b, today(), today())).toEqual([]);
    expect(await send(b, 'GET', `/api/expenses?from=${today()}&to=${today()}`).then((r) => r.json())).toEqual([]);
    expect(await openings(b, today(), today())).toEqual([]);
  });
});
