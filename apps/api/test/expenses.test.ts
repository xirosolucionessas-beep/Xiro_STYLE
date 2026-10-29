import type { AuthSession, CashDaySummary, ExpenseDto } from '@xiro/shared';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { localDate } from '../src/booking/time';
import { auth, createEmployee, register, TZ } from './helpers/booking';
import { createTestDatabase, testAppConfig, type TestDatabase } from './helpers/db';

/**
 * Módulo Finanzas, fase 1: gastos operativos y de nómina. Solo el dueño o un empleado con el permiso "finance"; el negocio
 * sale siempre de la sesión; nada se borra (se anula con motivo); el formato anterior (Cierre de caja) sigue funcionando.
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
const list = async (session: AuthSession, query = '') => (await send(session, 'GET', `/api/expenses?from=2000-01-01&to=2100-01-01${query}`)).json<ExpenseDto[]>();
const summary = async (session: AuthSession) => (await send(session, 'GET', `/api/cash/close-summary?day=${today()}`)).json<CashDaySummary>();

describe('permisos', () => {
  it('un empleado SIN "Finanzas" recibe 403 en todos los endpoints de gastos', async () => {
    const owner = await register(app, 'Permisos gastos');
    const expense = (await create(owner, { amount: 10000, description: 'Jabón', method: 'card' })).json<ExpenseDto>();
    const { session: employee } = await createEmployee(app, owner, ['clients_view', 'services_record', 'agenda_all']);
    const calls = [
      send(employee, 'GET', '/api/expenses?from=2026-01-01&to=2026-12-31'),
      send(employee, 'GET', `/api/expenses/${expense.id}`),
      send(employee, 'GET', '/api/expenses/payees'),
      create(employee, { amount: 5000, description: 'X' }),
      send(employee, 'PUT', `/api/expenses/${expense.id}`, { amount: 1, description: 'Y', method: 'card' }),
      send(employee, 'POST', `/api/expenses/${expense.id}/void`, { reason: 'no debería' }),
    ];
    for (const res of await Promise.all(calls)) expect(res.statusCode, res.body).toBe(403);
  });

  it('un empleado CON "Finanzas" puede registrar y consultar (actúa como administrador)', async () => {
    const owner = await register(app, 'Admin finanzas');
    const { session: admin } = await createEmployee(app, owner, ['finance']);
    expect((await create(admin, { amount: 20000, description: 'Toallas', method: 'card', category: 'supplies' })).statusCode).toBe(201);
    expect(await list(owner)).toHaveLength(1);
  });
});

describe('aislamiento entre negocios', () => {
  it('el negocio B no ve, no edita ni anula los gastos de A (404) y no puede pagar nómina a un empleado de A', async () => {
    const a = await register(app, 'Negocio A gastos');
    const b = await register(app, 'Negocio B gastos');
    const { employee: employeeOfA } = await createEmployee(app, a, []);
    const expense = (await create(a, { amount: 300000, description: 'Arriendo', method: 'bank_transfer', category: 'rent' })).json<ExpenseDto>();
    expect(await list(b)).toEqual([]);
    expect((await send(b, 'GET', `/api/expenses/${expense.id}`)).statusCode).toBe(404);
    expect((await send(b, 'PUT', `/api/expenses/${expense.id}`, { amount: 1, description: 'robado', method: 'card' })).statusCode).toBe(404);
    expect((await send(b, 'POST', `/api/expenses/${expense.id}/void`, { reason: 'robado' })).statusCode).toBe(404);
    const payroll = await create(b, { amount: 50000, description: 'Sueldo', method: 'bank_transfer', type: 'payroll', category: 'salary', employeeId: employeeOfA.id });
    expect(payroll.statusCode).toBe(400);
    expect(payroll.json()).toMatchObject({ code: 'expense_employee_invalid' });
    expect((await list(a))[0]).toMatchObject({ amount: 300000, status: 'active' });
  });
});

describe('alta, validaciones y formato anterior', () => {
  it('el formato de Cierre de caja sigue igual: operativo · otros, fecha de hoy y —en efectivo— pagado desde caja', async () => {
    const owner = await register(app, 'Formato anterior');
    const cash = (await create(owner, { amount: 12000, description: 'Domicilio', method: 'cash' })).json<ExpenseDto>();
    expect(cash).toMatchObject({ type: 'operating', category: 'other', expenseDate: today(), paidFromCash: true, status: 'active', notes: '', employeeId: null });
    const card = (await create(owner, { amount: 8000, description: 'Software', method: 'card' })).json<ExpenseDto>();
    expect(card.paidFromCash).toBe(false);
  });

  it('nómina con su empleado; validaciones de monto, categoría por tipo, empleado obligatorio y caja solo en efectivo', async () => {
    const owner = await register(app, 'Validaciones gastos');
    const { employee } = await createEmployee(app, owner, []);
    const payroll = await create(owner, { amount: 900000, description: 'Quincena', method: 'bank_transfer', type: 'payroll', category: 'salary', employeeId: employee.id, notes: 'Primera quincena' });
    expect(payroll.statusCode).toBe(201);
    expect(payroll.json<ExpenseDto>()).toMatchObject({ type: 'payroll', category: 'salary', employeeId: employee.id, employeeName: employee.name, notes: 'Primera quincena' });
    const bad = [
      { amount: 0, description: 'Cero' },
      { amount: 1000, description: 'Sin empleado', type: 'payroll', category: 'salary' },
      { amount: 1000, description: 'Categoría cruzada', type: 'operating', category: 'salary' },
      { amount: 1000, description: 'Tarjeta desde caja', method: 'card', paidFromCash: true },
      { amount: 1000, description: 'Fecha rara', expenseDate: '2026-13-40' },
    ];
    for (const payload of bad) expect((await create(owner, payload)).statusCode, JSON.stringify(payload)).toBe(400);
  });
});

describe('arqueo de caja', () => {
  it('un gasto en efectivo desde caja reduce el efectivo esperado; por transferencia no; anularlo lo devuelve', async () => {
    const owner = await register(app, 'Arqueo gastos');
    await send(owner, 'POST', '/api/cash/opening', { amount: 100000 });
    expect((await summary(owner)).expectedCash).toBe(100000);
    const cash = (await create(owner, { amount: 15000, description: 'Insumos', method: 'cash', category: 'supplies' })).json<ExpenseDto>();
    await create(owner, { amount: 40000, description: 'Internet', method: 'bank_transfer', category: 'utilities_internet' });
    const s = await summary(owner);
    expect(s.expectedCash).toBe(85000);
    expect(s.totalExpenses).toBe(55000);
    expect((await send(owner, 'POST', `/api/expenses/${cash.id}/void`, { reason: 'Se registró dos veces' })).json<ExpenseDto>()).toMatchObject({ status: 'voided', voidReason: 'Se registró dos veces' });
    const after = await summary(owner);
    expect(after.expectedCash).toBe(100000);
    expect(after.totalExpenses).toBe(40000);
    expect(after.expenses.map((e) => e.description)).toEqual(['Internet']);
  });

  it('caja del día cerrada: no se edita ni anula un gasto que salió de ella, ni se agrega otro desde caja (sí uno por transferencia)', async () => {
    const owner = await register(app, 'Caja cerrada gastos');
    await send(owner, 'POST', '/api/cash/opening', { amount: 50000 });
    const cash = (await create(owner, { amount: 5000, description: 'Café', method: 'cash' })).json<ExpenseDto>();
    expect((await send(owner, 'POST', '/api/cash/close', { day: today(), countedAmount: 45000 })).statusCode).toBe(201);
    for (const res of [
      await send(owner, 'POST', `/api/expenses/${cash.id}/void`, { reason: 'tarde' }),
      await send(owner, 'PUT', `/api/expenses/${cash.id}`, { amount: 9000, description: 'Café', method: 'cash' }),
      await create(owner, { amount: 1000, description: 'Otro café', method: 'cash' }),
    ]) {
      expect(res.statusCode, res.body).toBe(409);
      expect(res.json()).toMatchObject({ code: 'expense_day_closed' });
    }
    expect((await create(owner, { amount: 1000, description: 'Pago en línea', method: 'bank_transfer' })).statusCode).toBe(201);
  });
});

describe('listado y edición', () => {
  it('filtros por tipo, categoría, empleado y fecha; los anulados solo con status=all; inicio > fin se rechaza', async () => {
    const owner = await register(app, 'Filtros gastos');
    const { employee } = await createEmployee(app, owner, []);
    await create(owner, { amount: 1000, description: 'Luz', method: 'bank_transfer', category: 'utilities_power', expenseDate: '2026-03-10' });
    await create(owner, { amount: 2000, description: 'Comisión', method: 'bank_transfer', type: 'payroll', category: 'commission', employeeId: employee.id, expenseDate: '2026-03-15' });
    const voided = (await create(owner, { amount: 3000, description: 'Error', method: 'card', expenseDate: '2026-03-20' })).json<ExpenseDto>();
    await send(owner, 'POST', `/api/expenses/${voided.id}/void`, { reason: 'error de digitación' });
    expect((await list(owner, '&type=payroll')).map((e) => e.description)).toEqual(['Comisión']);
    expect((await list(owner, '&category=utilities_power')).map((e) => e.description)).toEqual(['Luz']);
    expect((await list(owner, `&employeeId=${employee.id}`)).map((e) => e.description)).toEqual(['Comisión']);
    expect((await send(owner, 'GET', '/api/expenses?from=2026-03-12&to=2026-03-31')).json<ExpenseDto[]>().map((e) => e.description)).toEqual(['Comisión']);
    expect((await list(owner)).map((e) => e.description)).toEqual(['Comisión', 'Luz']);
    expect((await list(owner, '&status=all')).map((e) => e.description)).toEqual(['Error', 'Comisión', 'Luz']);
    expect((await send(owner, 'GET', '/api/expenses?from=2026-04-01&to=2026-03-01')).statusCode).toBe(400);
    // Un anulado no se vuelve a anular ni se edita.
    expect((await send(owner, 'POST', `/api/expenses/${voided.id}/void`, { reason: 'otra vez' })).json()).toMatchObject({ code: 'expense_already_voided' });
  });

  it('editar actualiza los campos (y la fecha de modificación)', async () => {
    const owner = await register(app, 'Editar gastos');
    const created = (await create(owner, { amount: 1000, description: 'Agua', method: 'bank_transfer', category: 'utilities_water', expenseDate: '2026-02-01' })).json<ExpenseDto>();
    const updated = (await send(owner, 'PUT', `/api/expenses/${created.id}`, { amount: 1500, description: 'Agua (feb)', method: 'bank_transfer', category: 'utilities_water', expenseDate: '2026-02-02', notes: 'Factura 123' })).json<ExpenseDto>();
    expect(updated).toMatchObject({ amount: 1500, description: 'Agua (feb)', expenseDate: '2026-02-02', notes: 'Factura 123' });
    expect(Date.parse(updated.updatedAt)).toBeGreaterThanOrEqual(Date.parse(created.updatedAt));
  });
});

describe('beneficiarios de nómina', () => {
  it('un administrador con "Finanzas" ve solo id, nombre y rol de las personas de SU negocio', async () => {
    const owner = await register(app, 'Beneficiarios');
    const other = await register(app, 'Otro beneficiarios');
    const { session: admin, employee } = await createEmployee(app, owner, ['finance']);
    await createEmployee(app, other, []);
    const payees = (await send(admin, 'GET', '/api/expenses/payees')).json<Array<Record<string, unknown>>>();
    expect(payees.map((p) => p.id).sort()).toEqual([owner.user.id, employee.id].sort());
    for (const p of payees) expect(Object.keys(p).sort()).toEqual(['active', 'id', 'name', 'role']);
  });
});
