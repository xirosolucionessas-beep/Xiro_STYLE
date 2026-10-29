import { formatMoney, type AuthSession, type BalanceDto, type ExpenseDto } from '@xiro/shared';
import ExcelJS from 'exceljs';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { buildBalancePdf, loadBalanceExport, percentLabel } from '../src/booking/balanceExport';
import { withBusinessTrusted } from '../src/booking/scope';
import { addDays, localDate } from '../src/booking/time';
import { auth, createEmployee, createService, register, TZ } from './helpers/booking';
import { createTestDatabase, testAppConfig, type TestDatabase } from './helpers/db';

/**
 * Finanzas, fase 6 — descargas del Balance general (PDF y Excel) y de la lista de Gastos (Excel), generadas en el servidor.
 * Lo esencial: los totales del archivo son EXACTAMENTE los de la pantalla; solo dueño o "Finanzas"; máximo 12 meses.
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
const money = (amount: number) => formatMoney(amount, 'COP');

/** Mismo negocio de prueba que el balance: venta con servicio, 2 productos, descuento y propina, más gastos. */
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
  await send(owner, 'POST', '/api/expenses', { amount: 3000, description: 'Más insumos', method: 'bank_transfer', category: 'supplies', expenseDate: addDays(today(), -1) });
  const { employee } = await createEmployee(app, owner, []);
  await send(owner, 'POST', '/api/expenses', { amount: 20000, description: 'Comisión', method: 'bank_transfer', type: 'payroll', category: 'commission', employeeId: employee.id });
  return owner;
}

async function workbook(body: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(body as unknown as ExcelJS.Buffer);
  return wb;
}

/** Valores de una hoja como filas de celdas (sin estilos). */
function rowsOf(sheet: ExcelJS.Worksheet): unknown[][] {
  const out: unknown[][] = [];
  // Celda vacía y celda con texto vacío se ven igual en Excel (el libro escrito por flujo no guarda las segundas).
  sheet.eachRow({ includeEmpty: false }, (row) => out.push(Array.from(row.values as unknown[]).slice(1).map((v) => v ?? '')));
  return out;
}

/** Texto de un PDF generado sin comprimir: pdfkit escribe cada línea como cadenas hexadecimales dentro de `[...] TJ`. */
function pdfText(pdf: Buffer): string {
  const raw = pdf.toString('latin1');
  return [...raw.matchAll(/\[([^\]]*)\]\s*TJ/g)]
    .map((m) => [...m[1]!.matchAll(/<([0-9a-fA-F]*)>/g)].map((h) => Buffer.from(h[1]!, 'hex').toString('latin1')).join(''))
    .join('\n');
}

describe('permisos y límites de las descargas', () => {
  it('un empleado sin "Finanzas" recibe 403 en las tres descargas; con "Finanzas", 200', async () => {
    const owner = await register(app, 'Permisos descargas');
    const { session: worker } = await createEmployee(app, owner, ['services_record', 'clients_view']);
    const { session: admin } = await createEmployee(app, owner, ['finance']);
    const q = `from=${today()}&to=${today()}`;
    for (const url of [`/api/reports/balance/export.pdf?${q}`, `/api/reports/balance/export.xlsx?${q}`, `/api/expenses/export.xlsx?${q}`]) {
      expect((await send(worker, 'GET', url)).statusCode, url).toBe(403);
      expect((await send(admin, 'GET', url)).statusCode, url).toBe(200);
    }
  });

  it('más de 12 meses, fechas futuras o inicio > fin se rechazan', async () => {
    const owner = await register(app, 'Límites descargas');
    const cases = [
      ['/api/reports/balance/export.pdf?from=2025-01-01&to=2026-01-01', 'export_range_too_long'],
      ['/api/reports/balance/export.xlsx?from=2025-01-01&to=2026-01-01', 'export_range_too_long'],
      ['/api/expenses/export.xlsx?from=2025-01-01&to=2026-01-01', 'export_range_too_long'],
      [`/api/reports/balance/export.pdf?from=${today()}&to=${addDays(today(), 1)}`, 'range_future'],
      ['/api/reports/balance/export.xlsx?from=2026-05-10&to=2026-05-01', 'range_invalid'],
    ] as const;
    for (const [url, code] of cases) {
      const res = await send(owner, 'GET', url);
      expect(res.statusCode, url).toBe(400);
      expect(res.body, url).toContain(code);
    }
    // Justo 12 meses sí se puede, también en un año bisiesto (366 días) y empezando a mitad de mes.
    for (const range of ['from=2025-01-01&to=2025-12-31', 'from=2024-01-01&to=2024-12-31', 'from=2025-03-15&to=2026-03-14']) {
      expect((await send(owner, 'GET', `/api/reports/balance/export.xlsx?${range}`)).statusCode, range).toBe(200);
    }
    expect((await send(owner, 'GET', '/api/reports/balance/export.xlsx?from=2025-03-15&to=2026-03-15')).statusCode).toBe(400);
  });
});

describe('Excel del balance', () => {
  it('los totales del archivo son exactamente los de la pantalla', async () => {
    const owner = await businessWithActivity('Excel balance');
    const from = addDays(today(), -6);
    const q = `from=${from}&to=${today()}`;
    const screen = (await send(owner, 'GET', `/api/reports/balance?${q}`)).json<BalanceDto>();
    const res = await send(owner, 'GET', `/api/reports/balance/export.xlsx?${q}`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['content-disposition']).toMatch(new RegExp(`attachment; filename="balance-[a-z0-9-]+-${from}_${today()}\\.xlsx"`));
    expect(res.headers['cache-control']).toBe('no-store');
    const wb = await workbook(res.rawPayload);
    expect(wb.worksheets.map((s) => s.name)).toEqual(['Resumen', 'Por periodo', 'Gastos por categoría', 'Movimientos']);

    const summary = rowsOf(wb.getWorksheet('Resumen')!);
    const line = (label: string) => summary.find((r) => r[0] === label)!;
    expect(line('Ingresos')[1]).toBe(screen.totals.income);
    expect(line('Gastos operativos')[1]).toBe(-screen.totals.operating);
    expect(line('Nómina')[1]).toBe(-screen.totals.payroll);
    expect(line('Utilidad neta')[1]).toBe(screen.totals.net);
    expect(line('Margen')[1]).toBeCloseTo(screen.totals.margin! / 100, 6);
    expect(line('Propinas (del personal, no suman al ingreso)')[1]).toBe(screen.totals.tips);

    const periods = rowsOf(wb.getWorksheet('Por periodo')!).slice(1);
    const periodTotal = periods.at(-1)!;
    expect(periods).toHaveLength(screen.series.buckets.length + 1);
    expect(periodTotal.slice(2)).toEqual([screen.totals.income, screen.totals.operating + screen.totals.payroll, screen.totals.net]);
    expect(periods.slice(0, -1).reduce((sum, r) => sum + Number(r[4]), 0)).toBe(screen.totals.net);

    const categories = rowsOf(wb.getWorksheet('Gastos por categoría')!).slice(1);
    expect(categories.map((r) => [r[0], r[2]])).toEqual([
      ['Comisión', 20000],
      ['Insumos', 15000],
      ['Total', 35000],
    ]);

    const moves = rowsOf(wb.getWorksheet('Movimientos')!).slice(1);
    const total = moves.at(-1)!;
    // Entradas = servicios + productos; salidas = descuentos + gastos. La diferencia es la utilidad de la pantalla.
    expect(total[4]).toBe(screen.totals.services + screen.totals.products);
    expect(total[5]).toBe(screen.totals.discounts + screen.totals.operating + screen.totals.payroll);
    expect(Number(total[4]) - Number(total[5])).toBe(screen.totals.net);
  });

  it('en inglés, si se pide', async () => {
    const owner = await register(app, 'Excel inglés');
    const res = await send(owner, 'GET', `/api/reports/balance/export.xlsx?from=${today()}&to=${today()}&lang=en`);
    expect((await workbook(res.rawPayload)).worksheets.map((s) => s.name)).toEqual(['Summary', 'By period', 'Expenses by category', 'Transactions']);
  });
});

describe('PDF del balance', () => {
  it('se descarga como PDF y muestra los mismos totales que la pantalla', async () => {
    const owner = await businessWithActivity('PDF balance');
    const q = `from=${addDays(today(), -6)}&to=${today()}`;
    const res = await send(owner, 'GET', `/api/reports/balance/export.pdf?${q}`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="balance-.+\.pdf"$/);
    expect(res.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');

    // El mismo documento sin comprimir, para leer su texto.
    const screen = (await send(owner, 'GET', `/api/reports/balance?${q}`)).json<BalanceDto>();
    const data = await withBusinessTrusted(testDb.db, owner.business.id, (tx) =>
      loadBalanceExport(tx, owner.business.id, { name: owner.business.name, address: '', city: '', currency: 'COP', timezone: TZ }, screen.from, screen.to),
    );
    const text = pdfText(await buildBalancePdf(data, 'es', { compress: false }));
    for (const amount of [screen.totals.income, screen.totals.net, screen.totals.services, screen.totals.products, screen.totals.tips]) expect(text, money(amount)).toContain(money(amount));
    expect(text).toContain(money(-screen.totals.operating).replace('−', '-'));
    expect(text).toContain(percentLabel(screen.totals.margin!, 'es')); // "49,2 %": coma decimal en español
    expect(text).not.toContain('-$ 0'); // un cero nunca sale como negativo
    expect(text).toContain('Balance general');
    expect(text).toMatch(/Página 1 de \d+/);
  });
});

describe('Excel de Gastos', () => {
  it('respeta los filtros de la pantalla y su total vigente es el de la lista', async () => {
    const owner = await businessWithActivity('Excel gastos');
    const from = addDays(today(), -6);
    const [insumos] = (await send(owner, 'GET', `/api/expenses?from=${today()}&to=${today()}&category=supplies`)).json<ExpenseDto[]>();
    await send(owner, 'POST', `/api/expenses/${insumos!.id}/void`, { reason: 'Duplicado' });

    const list = (await send(owner, 'GET', `/api/expenses?from=${from}&to=${today()}&status=all`)).json<ExpenseDto[]>();
    const res = await send(owner, 'GET', `/api/expenses/export.xlsx?from=${from}&to=${today()}&status=all`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/filename="gastos-.+\.xlsx"/);
    const rows = rowsOf((await workbook(res.rawPayload)).worksheets[0]!).slice(2); // título + encabezado
    expect(rows).toHaveLength(list.length + 1);
    expect(rows.at(-1)![8]).toBe(list.filter((e) => e.status === 'active').reduce((s, e) => s + e.amount, 0));
    expect(rows.some((r) => r[7] === 'Anulado' && r[10] === 'Duplicado')).toBe(true);

    // Solo nómina.
    const payroll = await send(owner, 'GET', `/api/expenses/export.xlsx?from=${from}&to=${today()}&type=payroll`);
    const payrollRows = rowsOf((await workbook(payroll.rawPayload)).worksheets[0]!).slice(2, -1);
    expect(payrollRows.map((r) => r[2])).toEqual(['Comisión']);
  });
});

describe('aislamiento entre negocios en los archivos', () => {
  // El barrido general busca datos de otro negocio en el TEXTO de la respuesta; un Excel o un PDF van comprimidos, así que
  // aquí se abren los archivos y se revisa su contenido.
  it('los archivos del negocio B no traen nada del negocio A', async () => {
    const a = await businessWithActivity('Archivos A');
    await send(a, 'POST', '/api/expenses', { amount: 777000, description: 'MARCA-DEL-NEGOCIO-A', method: 'bank_transfer', category: 'rent' });
    const b = await register(app, 'Archivos B');
    const q = `from=${addDays(today(), -6)}&to=${today()}`;

    const balanceBook = await workbook((await send(b, 'GET', `/api/reports/balance/export.xlsx?${q}`)).rawPayload);
    const allCells = balanceBook.worksheets.flatMap((s) => rowsOf(s).flat());
    expect(allCells.some((v) => String(v).includes('MARCA-DEL-NEGOCIO-A'))).toBe(false);
    expect(allCells).not.toContain(777000);
    const summary = rowsOf(balanceBook.getWorksheet('Resumen')!);
    for (const label of ['Ingresos', 'Gastos operativos', 'Nómina', 'Utilidad neta']) expect(Math.abs(Number(summary.find((r) => r[0] === label)![1]))).toBe(0);
    expect(rowsOf(balanceBook.getWorksheet('Movimientos')!)).toHaveLength(2); // encabezado + total en cero

    const expensesBook = await workbook((await send(b, 'GET', `/api/expenses/export.xlsx?${q}&status=all`)).rawPayload);
    expect(rowsOf(expensesBook.worksheets[0]!).slice(2)).toEqual([['Total vigente', '', '', '', '', '', '', '', 0]]);

    const data = await withBusinessTrusted(testDb.db, b.business.id, (tx) =>
      loadBalanceExport(tx, b.business.id, { name: b.business.name, address: '', city: '', currency: 'COP', timezone: TZ }, addDays(today(), -6), today()),
    );
    const pdf = pdfText(await buildBalancePdf(data, 'es', { compress: false }));
    expect(pdf).not.toContain('MARCA-DEL-NEGOCIO-A');
    expect(pdf).not.toContain(money(777000));
  });
});
