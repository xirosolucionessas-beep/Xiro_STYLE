import { allocateProportionally, type AuthSession, type CashClosingDto, type CashDaySalesPage, type CashDaySummary, type Client, type SaleDto } from '@xiro/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { auth, createEmployee, createService, register, TZ } from './helpers/booking';
import { createTestDatabase, testAppConfig, type TestDatabase } from './helpers/db';

/**
 * Cierre de caja: desglose por empleado (bruto, descuento guardado repartido, neto, unidades) y su conciliación con las ventas
 * del día. Productos y propinas sin atribución inventada.
 */
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

const q = <T = Record<string, unknown>>(text: string, values: unknown[] = []) => testDb.pool.query(text, values).then((r) => r.rows as T[]);
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const yesterdayOf = (day: string) => new Date(Date.parse(`${day}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
const send = (session: { accessToken: string }, method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) => app.inject({ method, url, headers: auth(session), payload: payload as object | undefined });
const summary = (session: AuthSession, day: string) => send(session, 'GET', `/api/cash/close-summary?day=${day}`).then((r) => r.json<CashDaySummary>());

async function setup(label: string) {
  const owner = await register(app, label);
  const ana = await createEmployee(app, owner, ['services_record']);
  const luis = await createEmployee(app, owner, ['services_record']);
  const corte = await createService(app, owner, { name: 'Corte', price: 20_000 });
  const tinte = await createService(app, owner, { name: 'Tinte', price: 30_000 });
  const champu = await createService(app, owner, { name: 'Champú', price: 5_000, kind: 'product', stock: 50 });
  return { owner, ana: ana.employee, luis: luis.employee, anaSession: ana.session, corte, tinte, champu };
}
type Setup = Awaited<ReturnType<typeof setup>>;

async function sell(session: AuthSession, body: Record<string, unknown>, pay: number): Promise<SaleDto> {
  const res = await send(session, 'POST', '/api/sales', { occasional: true, payments: [{ method: 'cash', amount: pay }], ...body });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<SaleDto>();
}
/** Venta compartida: Corte ×3 (Ana) + Tinte ×1 (Luis) + Champú ×2 (producto); subtotal 100.000. */
const sharedSale = (s: Setup, discount: number, tip: number) =>
  sell(
    s.owner,
    {
      lines: [
        { kind: 'service', itemId: s.corte.id, quantity: 3, employeeId: s.ana.id },
        { kind: 'service', itemId: s.tinte.id, quantity: 1, employeeId: s.luis.id },
        { kind: 'product', itemId: s.champu.id, quantity: 2 },
      ],
      discount,
      tip,
    },
    100_000 - discount + tip,
  );

function expectReconciled(day: CashDaySummary) {
  const b = day.employeeBreakdown!;
  const net = b.employees.reduce((sum, e) => sum + e.net, 0) + b.unattributed.net;
  expect(net).toBe(b.totals.net);
  expect(b.employees.reduce((sum, e) => sum + e.discount, 0) + b.unattributed.discount).toBe(b.totals.discount);
  expect(b.totals.net + b.totals.tip).toBe(day.totalSales);
  expect(b.totals.tip).toBe(day.totalTip);
}

describe('desglose del cierre por empleado', () => {
  it('venta compartida con cantidades, descuento manual, producto y propina: reparte el descuento guardado y concilia; la anulada no cuenta', async () => {
    const s = await setup('Desglose');
    await sharedSale(s, 7_001, 5_000);
    // Una línea más del MISMO servicio en otra venta, hecha por Ana: se agrupa con la anterior.
    await sell(s.anaSession, { lines: [{ kind: 'service', itemId: s.corte.id, quantity: 1, employeeId: s.ana.id }] }, 20_000);
    const voided = await sharedSale(s, 0, 0);
    expect((await send(s.owner, 'POST', `/api/sales/${voided.id}/void`, { reason: 'Error' })).statusCode).toBe(200);

    const day = await summary(s.owner, today());
    const b = day.employeeBreakdown!;
    // Reparto del descuento de 7.001 sobre 60.000 / 30.000 / 10.000 (mayor residuo).
    const [anaShare, luisShare, productShare] = allocateProportionally([60_000, 30_000, 10_000], 7_001);
    const ana = b.employees.find((e) => e.employeeId === s.ana.id)!;
    const luis = b.employees.find((e) => e.employeeId === s.luis.id)!;
    expect(ana).toMatchObject({ employeeName: s.ana.name, serviceUnits: 4, gross: 80_000, discount: anaShare, net: 80_000 - anaShare! });
    expect(ana.services).toEqual([{ name: 'Corte', units: 4, gross: 80_000, discount: anaShare, net: 80_000 - anaShare! }]);
    expect(luis).toMatchObject({ serviceUnits: 1, gross: 30_000, discount: luisShare, net: 30_000 - luisShare! });
    // Producto: sin atribución (no se registra quién lo vendió), aunque la venta la registró la dueña.
    expect(b.unattributed).toMatchObject({ productUnits: 2, gross: 10_000, discount: productShare });
    expect(b.unattributed.products).toEqual([{ name: 'Champú', units: 2, gross: 10_000, discount: productShare, net: 10_000 - productShare! }]);
    // La propina queda solo en el total, sin atribuirla a nadie; la venta anulada no aparece en nada.
    expect(b.totals).toEqual({ gross: 120_000, discount: 7_001, net: 112_999, tip: 5_000, total: 117_999 });
    expect(day.totalSales).toBe(117_999);
    expectReconciled(day);
  });

  it('recompensa de cumpleaños + descuento manual: usa el descuento GUARDADO en la venta, sin volver a aplicarlo', async () => {
    const s = await setup('Cumple caja');
    expect((await send(s.owner, 'PUT', '/api/birthday/program', { enabled: true, rewardKind: 'percent', rewardValue: 10, scope: 'all', validDays: 7, minTotal: 0, combinable: true, message: '' })).statusCode).toBe(200);
    const client = (await send(s.owner, 'POST', '/api/clients', { name: 'Marta', phone: '3009998877', birthDate: '1990-01-01' })).json<Client>();
    const day = today();
    const [reward] = await q<{ id: string }>(
      `insert into birthday_rewards (business_id, client_id, year, starts_on, ends_on, reward_kind, reward_value, scope, min_total, combinable)
       select business_id, id, $2, $3::date, $3::date + 3, 'percent', 10, 'all', 0, true from clients where id = $1 returning id`,
      [client.id, Number(day.slice(0, 4)), day],
    );
    // Subtotal 100.000: manual 1.000 + cumpleaños 10 % (10.000) = 11.000 guardados en la venta.
    const res = await send(s.owner, 'POST', '/api/sales', {
      clientId: client.id,
      lines: [
        { kind: 'service', itemId: s.corte.id, quantity: 3, employeeId: s.ana.id },
        { kind: 'service', itemId: s.tinte.id, quantity: 1, employeeId: s.luis.id },
        { kind: 'product', itemId: s.champu.id, quantity: 2 },
      ],
      discount: 1_000,
      birthdayRewardId: reward!.id,
      payments: [{ method: 'cash', amount: 89_000 }],
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json<SaleDto>().discount).toBe(11_000);

    const summaryDay = await summary(s.owner, day);
    expect(summaryDay.employeeBreakdown!.totals).toMatchObject({ gross: 100_000, discount: 11_000, net: 89_000 });
    const shares = allocateProportionally([60_000, 30_000, 10_000], 11_000);
    expect(summaryDay.employeeBreakdown!.employees.map((e) => e.discount).sort((a, b) => b - a)).toEqual([shares[0], shares[1]]);
    expectReconciled(summaryDay);
  });

  it('el día se corta en la zona horaria del negocio: una venta de las 23:59 locales de ayer no entra hoy', async () => {
    const s = await setup('Zona');
    const late = await sell(s.owner, { lines: [{ kind: 'service', itemId: s.corte.id, employeeId: s.ana.id }] }, 20_000);
    const early = await sell(s.owner, { lines: [{ kind: 'service', itemId: s.tinte.id, employeeId: s.luis.id }] }, 30_000);
    const day = today();
    // Bogotá es UTC−5: las 00:00 locales de hoy son las 05:00 UTC.
    await q(`update sales set created_at = ($2::date + time '04:59') at time zone 'UTC' where id = $1`, [late.id, day]);
    await q(`update sales set created_at = ($2::date + time '05:00') at time zone 'UTC' where id = $1`, [early.id, day]);

    const todaySummary = await summary(s.owner, day);
    expect(todaySummary.employeeBreakdown!.employees.map((e) => e.employeeId)).toEqual([s.luis.id]);
    const yesterday = await summary(s.owner, yesterdayOf(day));
    expect(yesterday.employeeBreakdown!.employees.map((e) => e.employeeId)).toEqual([s.ana.id]);
    expectReconciled(todaySummary);
    expectReconciled(yesterday);
  });

  it('cierre firmado: los importes congelados no cambian; una venta posterior se ve en el desglose y en "después del cierre"', async () => {
    const s = await setup('Firmado');
    expect((await send(s.owner, 'POST', '/api/cash/opening', { amount: 50_000 })).statusCode).toBe(201);
    await sell(s.owner, { lines: [{ kind: 'service', itemId: s.corte.id, employeeId: s.ana.id }] }, 20_000);
    const closed = await send(s.owner, 'POST', '/api/cash/close', { day: today(), countedAmount: 70_000 });
    expect(closed.statusCode).toBe(201);
    const closing = closed.json<CashClosingDto>();
    expect(closing.summary!.employeeBreakdown!.totals.net).toBe(20_000);

    await sell(s.owner, { lines: [{ kind: 'service', itemId: s.tinte.id, employeeId: s.luis.id }] }, 30_000);
    const detail = (await send(s.owner, 'GET', `/api/cash/closings/${closing.id}`)).json<CashClosingDto>();
    expect(detail).toMatchObject({ totalSales: 20_000, expectedAmount: 70_000, countedAmount: 70_000, closedByName: expect.any(String) });
    expect(detail.summary!.afterClose).toMatchObject({ closedSales: 20_000, salesDelta: 30_000 });
    expect(detail.summary!.employeeBreakdown!.totals.net).toBe(50_000);
    expectReconciled(detail.summary!);
  });

  it('aislamiento y permisos: otro negocio no ve estas ventas y un empleado no consulta el cierre', async () => {
    const a = await setup('Aislado A');
    const b = await setup('Aislado B');
    await sharedSale(a, 0, 0);
    const other = await summary(b.owner, today());
    expect(other.employeeBreakdown!.employees).toEqual([]);
    expect(other.employeeBreakdown!.totals.total).toBe(0);
    expect((await send(a.anaSession, 'GET', `/api/cash/close-summary?day=${today()}`)).statusCode).toBe(403);
  });
});

describe('"Ver más": ventas del día por empleado', () => {
  const daySales = (session: AuthSession, query: Record<string, string | number>) =>
    send(session, 'GET', `/api/cash/day-sales?${new URLSearchParams(Object.entries(query).map(([k, v]): [string, string] => [k, String(v)])).toString()}`);

  it('ventas de un empleado: solo sus líneas, descuento distribuido, propina aparte, pagos divididos, cliente y quién registró', async () => {
    const s = await setup('VerMas');
    const client = (await send(s.owner, 'POST', '/api/clients', { name: 'Marta Ruiz', phone: '3001112233' })).json<Client>();
    // Venta compartida con cliente registrado y pago dividido: subtotal 100.000, descuento 7.001, propina 5.000 → total 97.999.
    const shared = await send(s.owner, 'POST', '/api/sales', {
      clientId: client.id,
      lines: [
        { kind: 'service', itemId: s.corte.id, quantity: 3, employeeId: s.ana.id },
        { kind: 'service', itemId: s.tinte.id, quantity: 1, employeeId: s.luis.id },
        { kind: 'product', itemId: s.champu.id, quantity: 2 },
      ],
      discount: 7_001,
      tip: 5_000,
      payments: [
        { method: 'cash', amount: 50_000 },
        { method: 'nequi', amount: 47_999 },
      ],
    });
    expect(shared.statusCode, shared.body).toBe(201);
    const sharedId = shared.json<SaleDto>().id;
    const own = await sell(s.anaSession, { lines: [{ kind: 'service', itemId: s.corte.id, employeeId: s.ana.id }] }, 20_000);
    const voided = await sell(s.owner, { lines: [{ kind: 'service', itemId: s.corte.id, employeeId: s.ana.id }] }, 20_000);
    expect((await send(s.owner, 'POST', `/api/sales/${voided.id}/void`, { reason: 'Error' })).statusCode).toBe(200);

    const res = await daySales(s.owner, { day: today(), scope: 'employee', employeeId: s.ana.id });
    expect(res.statusCode).toBe(200);
    const page = res.json<CashDaySalesPage>();
    expect(page.nextCursor).toBeNull();
    expect(page.data.map((d) => d.sale.id)).toEqual([voided.id, own.id, sharedId]); // más reciente primero

    const [anaShare] = allocateProportionally([60_000, 30_000, 10_000], 7_001);
    const detail = page.data.find((d) => d.sale.id === sharedId)!;
    expect(detail.lines).toEqual([{ id: expect.any(String), kind: 'service', name: 'Corte', quantity: 3, unitPrice: 20_000, gross: 60_000, discountShare: anaShare, net: 60_000 - anaShare! }]);
    expect(detail.sale).toMatchObject({ clientName: 'Marta Ruiz', discount: 7_001, tip: 5_000, total: 97_999, status: 'completed' });
    expect(detail.sale.createdByName).not.toBe(s.ana.name); // registró la dueña; el servicio lo hizo Ana
    expect(detail.sale.items.find((i) => i.name === 'Corte')!.employeeName).toBe(s.ana.name);
    expect(detail.sale.payments.map((p) => [p.method, p.amount])).toEqual([
      ['cash', 50_000],
      ['nequi', 47_999],
    ]);
    expect(detail.sale.items).toHaveLength(3); // la venta completa sigue visible
    expect(JSON.stringify(detail)).not.toContain('3001112233'); // sin teléfono del cliente
    expect(Date.parse(detail.sale.createdAt)).not.toBeNaN(); // fecha y hora del servidor

    expect(page.data.find((d) => d.sale.id === own.id)!.sale.clientName).toBe('Cliente ocasional');
    expect(page.data.find((d) => d.sale.id === voided.id)!.sale.status).toBe('voided');

    // El resumen (todo el día) cuadra con el desglose del cierre y no suma la anulada.
    const day = await summary(s.owner, today());
    const ana = day.employeeBreakdown!.employees.find((e) => e.employeeId === s.ana.id)!;
    expect(page.summary).toEqual({ completedCount: 2, voidedCount: 1, gross: ana.gross, discountShare: ana.discount, net: ana.net, units: ana.serviceUnits });
  });

  it('productos y servicios sin profesional: vista aparte que cuadra con "Sin atribución"', async () => {
    const s = await setup('SinAtribucion');
    await sharedSale(s, 7_001, 0);
    await sell(s.owner, { lines: [{ kind: 'service', itemId: s.corte.id }] }, 20_000); // servicio sin profesional
    await sell(s.owner, { lines: [{ kind: 'service', itemId: s.tinte.id, employeeId: s.luis.id }] }, 30_000); // no entra
    const page = (await daySales(s.owner, { day: today(), scope: 'unattributed' })).json<CashDaySalesPage>();
    expect(page.data).toHaveLength(2);
    expect(page.data.flatMap((d) => d.lines.map((l) => `${l.kind}:${l.name}`)).sort()).toEqual(['product:Champú', 'service:Corte']);
    const day = await summary(s.owner, today());
    const u = day.employeeBreakdown!.unattributed;
    expect(page.summary).toMatchObject({ completedCount: 2, gross: u.gross, discountShare: u.discount, net: u.net, units: u.serviceUnits + u.productUnits });
  });

  it('paginación por cursor: todas las ventas, sin repetir ni saltar; el resumen solo en la primera página', async () => {
    const s = await setup('Paginas');
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await sell(s.owner, { lines: [{ kind: 'service', itemId: s.corte.id, employeeId: s.ana.id }] }, 20_000)).id);
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res = await daySales(s.owner, { day: today(), scope: 'employee', employeeId: s.ana.id, limit: 2, ...(cursor ? { cursor } : {}) });
      expect(res.statusCode).toBe(200);
      const page = res.json<CashDaySalesPage>();
      if (pages === 0) expect(page.summary).toMatchObject({ completedCount: 5, gross: 100_000 });
      else expect(page.summary).toBeNull();
      seen.push(...page.data.map((d) => d.sale.id));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor);
    expect(pages).toBe(3);
    expect([...seen].sort()).toEqual([...ids].sort());
    expect((await daySales(s.owner, { day: today(), scope: 'employee', employeeId: s.ana.id, cursor: 'basura' })).statusCode).toBe(400);
  });

  it('el día se corta en la zona horaria del negocio', async () => {
    const s = await setup('ZonaDetalle');
    const late = await sell(s.owner, { lines: [{ kind: 'service', itemId: s.corte.id, employeeId: s.ana.id }] }, 20_000);
    await q(`update sales set created_at = ($2::date + time '04:59') at time zone 'UTC' where id = $1`, [late.id, today()]);
    expect((await daySales(s.owner, { day: today(), scope: 'employee', employeeId: s.ana.id })).json<CashDaySalesPage>().data).toEqual([]);
    expect((await daySales(s.owner, { day: yesterdayOf(today()), scope: 'employee', employeeId: s.ana.id })).json<CashDaySalesPage>().data.map((d) => d.sale.id)).toEqual([late.id]);
  });

  it('aislamiento, permisos y validación', async () => {
    const a = await setup('DetalleA');
    const b = await setup('DetalleB');
    await sharedSale(a, 0, 0);
    // Otro negocio, aunque conozca el id del empleado, no ve nada.
    expect((await daySales(b.owner, { day: today(), scope: 'employee', employeeId: a.ana.id })).json<CashDaySalesPage>()).toMatchObject({ data: [], summary: { completedCount: 0 } });
    expect((await daySales(b.owner, { day: today(), scope: 'unattributed' })).json<CashDaySalesPage>().data).toEqual([]);
    // Un empleado no consulta el detalle del cierre.
    expect((await daySales(a.anaSession, { day: today(), scope: 'employee', employeeId: a.ana.id })).statusCode).toBe(403);
    expect((await daySales(a.owner, { day: today(), scope: 'employee' })).statusCode).toBe(400);
    expect((await daySales(a.owner, { day: 'hoy', scope: 'unattributed' })).statusCode).toBe(400);
  });
});

describe('"Ver más": gastos del día (lo que consulta el detalle)', () => {
  const expensesPage = (session: AuthSession, query: Record<string, string>) => send(session, 'GET', `/api/expenses/page?${new URLSearchParams(query).toString()}`);

  it('registrado por una persona y pagado a otra; anulados incluidos y marcados; ajuste posterior al cierre visible', async () => {
    const s = await setup('GastosDetalle');
    const cashier = await createEmployee(app, s.owner, ['finance']);
    expect((await send(s.owner, 'POST', '/api/cash/opening', { amount: 100_000 })).statusCode).toBe(201);
    // Nómina: la registra la cajera (permiso Finanzas) y se le paga a Ana.
    const payroll = await send(cashier.session, 'POST', '/api/expenses', { amount: 300_000, description: 'Pago quincena', method: 'bank_transfer', type: 'payroll', category: 'salary', employeeId: s.ana.id });
    expect(payroll.statusCode, payroll.body).toBe(201);
    const supplies = await send(s.owner, 'POST', '/api/expenses', { amount: 20_000, description: 'Insumos', method: 'cash' });
    expect(supplies.statusCode).toBe(201);
    const wrong = await send(s.owner, 'POST', '/api/expenses', { amount: 5_000, description: 'Duplicado', method: 'nequi' });
    expect((await send(s.owner, 'POST', `/api/expenses/${wrong.json<{ id: string }>().id}/void`, { reason: 'Duplicado' })).statusCode).toBe(200);

    const page = (await expensesPage(s.owner, { from: today(), to: today(), status: 'all' })).json<{ data: Array<{ id: string; createdByName: string; employeeName: string | null; status: string; paidFromCash: boolean; createdAt: string }>; summary: { count: number; activeCount: number; activeTotal: number } }>();
    expect(page.summary).toEqual({ count: 3, activeCount: 2, activeTotal: 320_000 });
    const pay = page.data.find((e) => e.id === payroll.json<{ id: string }>().id)!;
    expect(pay.createdByName).toBe(cashier.employee.name);
    expect(pay.employeeName).toBe(s.ana.name);
    expect(pay.createdByName).not.toBe(pay.employeeName);
    expect(page.data.find((e) => e.id === wrong.json<{ id: string }>().id)!.status).toBe('voided');
    expect(page.data.find((e) => e.id === supplies.json<{ id: string }>().id)!.paidFromCash).toBe(true);

    // Filtro por beneficiario.
    const onlyAna = (await expensesPage(s.owner, { from: today(), to: today(), status: 'all', employeeId: s.ana.id })).json<{ data: Array<{ id: string }> }>();
    expect(onlyAna.data.map((e) => e.id)).toEqual([payroll.json<{ id: string }>().id]);

    // Cerrar y luego anular un gasto que salió de la caja: queda como ajuste; el cierre firmado no cambia.
    const closed = await send(s.owner, 'POST', '/api/cash/close', { day: today(), countedAmount: 80_000 });
    expect(closed.statusCode).toBe(201);
    const voidAfter = await send(s.owner, 'POST', `/api/expenses/${supplies.json<{ id: string }>().id}/void`, { reason: 'Error', adjustmentReason: 'Se registró dos veces' });
    expect(voidAfter.statusCode, voidAfter.body).toBe(200);
    const detail = (await send(s.owner, 'GET', `/api/cash/closings/${closed.json<CashClosingDto>().id}`)).json<CashClosingDto>();
    expect(detail.totalExpenses).toBe(closed.json<CashClosingDto>().totalExpenses);
    expect(detail.summary!.adjustmentsAfterClose).toEqual([expect.objectContaining({ kind: 'void', amountBefore: 20_000, amountAfter: 0, reason: 'Se registró dos veces' })]);
  });

  it('aislamiento y permisos de los gastos del detalle', async () => {
    const a = await setup('GastosA');
    const b = await setup('GastosB');
    expect((await send(a.owner, 'POST', '/api/expenses', { amount: 1_000, description: 'Café', method: 'cash' })).statusCode).toBe(201);
    expect((await expensesPage(b.owner, { from: today(), to: today(), status: 'all' })).json<{ data: unknown[] }>().data).toEqual([]);
    expect((await expensesPage(a.anaSession, { from: today(), to: today(), status: 'all' })).statusCode).toBe(403);
  });
});
