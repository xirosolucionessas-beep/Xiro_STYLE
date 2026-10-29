import type { AuthSession, BalanceDto, BalanceMovementsPage, SaleDto } from '@xiro/shared';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { addDays, localDate } from '../src/booking/time';
import { auth, createEmployee, createService, register, TZ } from './helpers/booking';
import { createTestDatabase, testAppConfig, type TestDatabase } from './helpers/db';

/**
 * Finanzas, fase 4 — Balance general: ingresos (servicios + productos − descuentos; propinas aparte), gastos operativos y
 * nómina, utilidad y margen, comparación con el periodo anterior y movimientos. Solo dueño o "Finanzas"; por negocio.
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
const send = (session: AuthSession, method: 'GET' | 'POST', url: string, payload?: Record<string, unknown>) =>
  app.inject({ method, url, headers: auth(session), ...(payload === undefined ? {} : { payload: payload as InjectOptions['payload'] }) });
const balance = async (session: AuthSession, from = today(), to = today()) => (await send(session, 'GET', `/api/reports/balance?from=${from}&to=${to}`)).json<BalanceDto>();

/** Negocio con una venta (servicio 50.000 + producto 2 × 10.000, descuento 7.000, propina 5.000) y gastos de hoy. */
async function businessWithActivity(label: string) {
  const owner = await register(app, label);
  const service = await createService(app, owner, { name: 'Corte', price: 50000 });
  const product = await createService(app, owner, { name: 'Cera', price: 10000, kind: 'product', stock: 20 });
  const sale = await send(owner, 'POST', '/api/sales', {
    occasional: true,
    lines: [{ kind: 'service', itemId: service.id, quantity: 1 }, { kind: 'product', itemId: product.id, quantity: 2 }],
    discount: 7000,
    tip: 5000,
    payments: [{ method: 'card', amount: 68000 }],
  });
  expect(sale.statusCode, sale.body).toBe(201);
  await send(owner, 'POST', '/api/expenses', { amount: 12000, description: 'Insumos', method: 'bank_transfer', category: 'supplies' });
  const { employee } = await createEmployee(app, owner, []);
  await send(owner, 'POST', '/api/expenses', { amount: 20000, description: 'Comisión', method: 'bank_transfer', type: 'payroll', category: 'commission', employeeId: employee.id });
  return { owner, sale: sale.json<SaleDto>(), service, product };
}

describe('permisos y aislamiento', () => {
  it('un empleado sin "Finanzas" recibe 403 en el balance y en los movimientos; con "Finanzas", 200', async () => {
    const owner = await register(app, 'Permisos balance');
    const { session: worker } = await createEmployee(app, owner, ['services_record', 'clients_view']);
    const { session: admin } = await createEmployee(app, owner, ['finance']);
    for (const url of [`/api/reports/balance?from=${today()}&to=${today()}`, `/api/reports/balance/movements?from=${today()}&to=${today()}`]) {
      expect((await send(worker, 'GET', url)).statusCode, url).toBe(403);
      { const r = await send(admin, "GET", url); expect(r.statusCode, r.body).toBe(200); }
    }
  });

  it('el balance del negocio B no incluye nada del negocio A', async () => {
    await businessWithActivity('Balance A');
    const b = await register(app, 'Balance B');
    const result = await balance(b);
    expect(result.totals).toMatchObject({ income: 0, operating: 0, payroll: 0, net: 0, tips: 0 });
    expect((await send(b, 'GET', `/api/reports/balance/movements?from=${today()}&to=${today()}`)).json<BalanceMovementsPage>().total).toBe(0);
  });
});

describe('cuentas', () => {
  it('ingresos sin doble conteo (servicios + productos − descuento), propina aparte; utilidad y margen correctos', async () => {
    const { owner } = await businessWithActivity('Cuentas balance');
    const { totals } = await balance(owner);
    expect(totals).toEqual({ services: 50000, products: 20000, discounts: 7000, income: 63000, tips: 5000, operating: 12000, payroll: 20000, net: 31000, margin: 49.2 });
  });

  it('una venta anulada y un gasto anulado dejan de contar', async () => {
    const { owner, sale } = await businessWithActivity('Anulados balance');
    await send(owner, 'POST', `/api/sales/${sale.id}/void`, { reason: 'Error de cobro' });
    const [insumos] = (await send(owner, 'GET', `/api/expenses?from=${today()}&to=${today()}&category=supplies`)).json<Array<{ id: string }>>();
    await send(owner, 'POST', `/api/expenses/${insumos!.id}/void`, { reason: 'Duplicado' });
    const { totals } = await balance(owner);
    expect(totals).toMatchObject({ services: 0, products: 0, discounts: 0, income: 0, tips: 0, operating: 0, payroll: 20000, net: -20000, margin: null });
  });

  it('un movimiento a las 11:30 p. m. hora Bogotá cae en su día (no en el siguiente)', async () => {
    const owner = await register(app, 'Zona horaria balance');
    const service = await createService(app, owner, { name: 'Corte', price: 30000 });
    await send(owner, 'POST', '/api/sales', { occasional: true, lines: [{ kind: 'service', itemId: service.id, quantity: 1 }], payments: [{ method: 'cash', amount: 30000 }] });
    // 10 de mayo 23:30 en Bogotá = 11 de mayo 04:30 UTC.
    await testDb.pool.query("update service_records set created_at = '2026-05-11T04:30:00Z' where business_id = $1", [owner.business.id]);
    await testDb.pool.query("update sales set created_at = '2026-05-11T04:30:00Z' where business_id = $1", [owner.business.id]);
    await send(owner, 'POST', '/api/expenses', { amount: 1000, description: 'Luz', method: 'bank_transfer', category: 'utilities_power', expenseDate: '2026-05-10' });
    expect((await balance(owner, '2026-05-10', '2026-05-10')).totals).toMatchObject({ income: 30000, operating: 1000 });
    expect((await balance(owner, '2026-05-11', '2026-05-11')).totals).toMatchObject({ income: 0, operating: 0 });
  });
});

describe('rango y comparación', () => {
  it('inicio > fin, fechas futuras o un rango de más de 3 años se rechazan', async () => {
    const owner = await register(app, 'Rangos balance');
    const bad = [
      [`from=2026-05-10&to=2026-05-01`, 'range_invalid'],
      [`from=${today()}&to=${addDays(today(), 1)}`, 'range_future'],
      [`from=2020-01-01&to=2024-01-01`, 'range_too_long'],
      [`from=2026-02-30&to=2026-03-01`, 'date_invalid'],
    ] as const;
    for (const [query, code] of bad) {
      const res = await send(owner, 'GET', `/api/reports/balance?${query}`);
      expect(res.statusCode, query).toBe(400);
      expect(res.body, query).toContain(code);
    }
  });

  it('compara con el periodo anterior de igual duración; si el anterior es 0, "sin datos previos" (null)', async () => {
    const owner = await register(app, 'Comparación balance');
    await send(owner, 'POST', '/api/expenses', { amount: 10000, description: 'Agua mayo 1', method: 'bank_transfer', category: 'utilities_water', expenseDate: '2026-05-01' });
    await send(owner, 'POST', '/api/expenses', { amount: 15000, description: 'Agua mayo 9', method: 'bank_transfer', category: 'utilities_water', expenseDate: '2026-05-09' });
    // 8 al 14 de mayo vs 1 al 7 de mayo.
    const week = await balance(owner, '2026-05-08', '2026-05-14');
    expect(week.previous).toMatchObject({ from: '2026-05-01', to: '2026-05-07' });
    expect(week.totals.operating).toBe(15000);
    expect(week.comparison.operating).toBe(50);
    expect(week.comparison.income).toBeNull(); // ningún ingreso antes: sin datos previos
    // El anterior sin gastos → null (nunca un "+∞ %").
    expect((await balance(owner, '2026-04-24', '2026-04-30')).comparison.operating).toBeNull();
  });
});

describe('movimientos', () => {
  it('ingresos y egresos juntos, filtrables, ordenables por monto y paginados', async () => {
    const { owner } = await businessWithActivity('Movimientos balance');
    const base = `/api/reports/balance/movements?from=${today()}&to=${today()}`;
    const all = (await send(owner, 'GET', base)).json<BalanceMovementsPage>();
    // 2 registros (servicio y producto) + 1 descuento + 2 gastos.
    expect(all.total).toBe(5);
    expect(all.rows.map((r) => `${r.direction}:${r.kind}:${r.amount}`).sort()).toEqual(['in:product:20000', 'in:service:50000', 'out:discount:7000', 'out:operating:12000', 'out:payroll:20000']);
    expect((await send(owner, 'GET', `${base}&kind=income`)).json<BalanceMovementsPage>().rows.map((r) => r.kind).sort()).toEqual(['discount', 'product', 'service']);
    expect((await send(owner, 'GET', `${base}&kind=expense`)).json<BalanceMovementsPage>().rows.map((r) => r.category).sort()).toEqual(['commission', 'supplies']);
    const byAmount = (await send(owner, 'GET', `${base}&sort=amount&dir=desc`)).json<BalanceMovementsPage>().rows.map((r) => r.amount);
    expect(byAmount).toEqual([...byAmount].sort((a, b) => b - a));
    const page2 = (await send(owner, 'GET', `${base}&sort=amount&dir=desc&pageSize=10&page=1`)).json<BalanceMovementsPage>();
    expect(page2).toMatchObject({ page: 1, pageSize: 10, total: 5 });
    // Un orden que no está en la lista se rechaza (nunca llega a la consulta).
    expect((await send(owner, 'GET', `${base}&sort=amount;drop table sales`)).statusCode).toBe(400);
  });
});

describe('gráficos (fase 5)', () => {
  it('la agrupación cambia con el rango: día hasta 31 días, semana hasta ~6 meses, mes desde ahí', async () => {
    const owner = await register(app, 'Agrupación balance');
    const week = await balance(owner, '2026-05-04', '2026-05-10');
    expect(week.series.grouping).toBe('day');
    expect(week.series.buckets.map((b) => b.key)).toEqual(['2026-05-04', '2026-05-05', '2026-05-06', '2026-05-07', '2026-05-08', '2026-05-09', '2026-05-10']);
    expect((await balance(owner, '2026-05-01', '2026-05-31')).series.grouping).toBe('day');
    // 1 de mayo (viernes) al 1 de junio: 32 días → por semana; la primera semana empieza el lunes 27 de abril, recortada al 1.
    const weeks = await balance(owner, '2026-05-01', '2026-06-01');
    expect(weeks.series.grouping).toBe('week');
    expect(weeks.series.buckets[0]).toMatchObject({ key: '2026-04-27', from: '2026-05-01', to: '2026-05-03' });
    expect(weeks.series.buckets.at(-1)).toMatchObject({ key: '2026-06-01', from: '2026-06-01', to: '2026-06-01' });
    const months = await balance(owner, '2025-10-15', '2026-05-10');
    expect(months.series.grouping).toBe('month');
    expect(months.series.buckets.map((b) => b.key)).toEqual(['2025-10-01', '2025-11-01', '2025-12-01', '2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01']);
    expect(months.series.buckets[0]).toMatchObject({ from: '2025-10-15', to: '2025-10-31' });
  });

  it('la suma de los grupos es exactamente el total, y la dona reparte los gastos por categoría', async () => {
    const { owner } = await businessWithActivity('Series balance');
    await send(owner, 'POST', '/api/expenses', { amount: 3000, description: 'Más insumos', method: 'bank_transfer', category: 'supplies', expenseDate: addDays(today(), -2) });
    const result = await balance(owner, addDays(today(), -6), today());
    const sum = (key: 'income' | 'expenses' | 'net') => result.series.buckets.reduce((acc, b) => acc + b[key], 0);
    expect(sum('income')).toBe(result.totals.income);
    expect(sum('expenses')).toBe(result.totals.operating + result.totals.payroll);
    expect(sum('net')).toBe(result.totals.net);
    expect(result.series.buckets.at(-1)).toMatchObject({ key: today(), income: 63000, expenses: 32000, net: 31000 });
    expect(result.expenseBreakdown).toEqual([
      { type: 'payroll', category: 'commission', amount: 20000 },
      { type: 'operating', category: 'supplies', amount: 15000 },
    ]);
  });

  it('un cobro a las 11:30 p. m. hora Bogotá queda en el punto de su día', async () => {
    const owner = await register(app, 'Series zona horaria');
    const service = await createService(app, owner, { name: 'Corte', price: 30000 });
    await send(owner, 'POST', '/api/sales', { occasional: true, lines: [{ kind: 'service', itemId: service.id, quantity: 1 }], payments: [{ method: 'cash', amount: 30000 }] });
    await testDb.pool.query("update service_records set created_at = '2026-05-11T04:30:00Z' where business_id = $1", [owner.business.id]);
    const { series } = await balance(owner, '2026-05-10', '2026-05-11');
    expect(series.buckets.map((b) => [b.key, b.income])).toEqual([['2026-05-10', 30000], ['2026-05-11', 0]]);
  });
});
