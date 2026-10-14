import { EXPORT_MAX_ROWS, type AuthSession, type ExpenseDto, type ExpensesPage } from '@xiro/shared';
import ExcelJS from 'exceljs';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { buildBalancePdf, loadBalanceExport, PDF_MAX_MOVEMENTS } from '../src/booking/balanceExport';
import { withBusinessTrusted } from '../src/booking/scope';
import { addDays, localDate } from '../src/booking/time';
import { auth, register, TZ } from './helpers/booking';
import { createTestDatabase, testAppConfig, type TestDatabase } from './helpers/db';

/**
 * Finanzas — los Gastos nunca se presentan incompletos: listado paginado con cursor estable y totales calculados por el
 * servidor sobre TODO el rango; descargas en Excel completas (o rechazadas con un mensaje claro si pasan del tope); PDF del
 * balance con tope de movimientos avisado.
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
const send = (session: AuthSession, url: string, method: 'GET' | 'POST' = 'GET', payload?: Record<string, unknown>) =>
  app.inject({ method, url, headers: auth(session), ...(payload === undefined ? {} : { payload: payload as InjectOptions['payload'] }) });
const range = () => `from=${addDays(today(), -29)}&to=${today()}`;

/**
 * Siembra `count` gastos de golpe (una sola sentencia: todos con el MISMO created_at, así el desempate por id se pone a
 * prueba). Montos 1..1000, fechas repartidas en 30 días, uno de cada diez anulado y uno de cada cuatro de nómina.
 */
async function seed(owner: AuthSession, count: number, offset = 0) {
  await testDb.pool.query(
    `insert into expenses (business_id, amount, description, method, created_by, type, category, expense_date, status, void_reason, voided_by, voided_at, employee_id)
     select $1, (g % 1000) + 1, 'Gasto ' || g, 'bank_transfer', $2,
            case when g % 4 = 0 then 'payroll' else 'operating' end,
            case when g % 4 = 0 then 'salary' else 'supplies' end,
            $3::date - (g % 30),
            case when g % 10 = 0 then 'voided' else 'active' end,
            case when g % 10 = 0 then 'Prueba' else '' end,
            case when g % 10 = 0 then $2::uuid end,
            case when g % 10 = 0 then now() end,
            case when g % 4 = 0 then $2::uuid end
     from generate_series($4::int + 1, $4::int + $5::int) as g`,
    [owner.business.id, owner.user.id, today(), offset, count],
  );
}

/** Lo esperado para la siembra [offset+1 .. offset+count]. */
function expected(count: number, offset = 0, filter: (g: number) => boolean = () => true) {
  let total = 0;
  let activeCount = 0;
  let all = 0;
  for (let g = offset + 1; g <= offset + count; g++) {
    if (!filter(g)) continue;
    all++;
    if (g % 10 !== 0) {
      activeCount++;
      total += (g % 1000) + 1;
    }
  }
  return { count: all, activeCount, activeTotal: total };
}

async function walk(owner: AuthSession, query: string, limit: number) {
  const ids: string[] = [];
  const pages: ExpensesPage[] = [];
  let cursor: string | null = null;
  do {
    const res = await send(owner, `/api/expenses/page?${query}&limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    expect(res.statusCode, res.body).toBe(200);
    const page = res.json<ExpensesPage>();
    pages.push(page);
    ids.push(...page.data.map((e) => e.id));
    cursor = page.nextCursor;
  } while (cursor);
  return { ids, pages };
}

describe('listado paginado', () => {
  it('menos filas que el límite: una sola página, sin cursor, y los totales del servidor', async () => {
    const owner = await register(app, 'Pocas filas');
    await seed(owner, 30);
    const { pages } = await walk(owner, `${range()}&status=all`, 50);
    expect(pages).toHaveLength(1);
    expect(pages[0]!.data).toHaveLength(30);
    expect(pages[0]!.nextCursor).toBeNull();
    expect(pages[0]!.summary).toEqual(expected(30));
  });

  it('exactamente el límite: una sola página y sin "cargar más" vacío', async () => {
    const owner = await register(app, 'Justo el límite');
    await seed(owner, 50);
    const { pages } = await walk(owner, `${range()}&status=all`, 50);
    expect(pages).toHaveLength(1);
    expect(pages[0]!.nextCursor).toBeNull();
  });

  it('más filas que el límite anterior (1.234): se recorre todo, sin repetidos ni omitidos, en orden estable', async () => {
    const owner = await register(app, 'Muchas filas');
    await seed(owner, 1234);
    const { ids, pages } = await walk(owner, `${range()}&status=all`, 100);
    expect(ids).toHaveLength(1234);
    expect(new Set(ids).size).toBe(1234);
    expect(pages).toHaveLength(13);
    // Totales sobre TODO el rango (antes la pantalla sumaba solo lo cargado), y solo en la primera página.
    expect(pages[0]!.summary).toEqual(expected(1234));
    expect(pages.slice(1).every((p) => p.summary === null)).toBe(true);
    // Orden: fecha del gasto descendente en todo el recorrido.
    const dates = pages.flatMap((p) => p.data.map((e) => e.expenseDate));
    expect(dates).toEqual([...dates].sort().reverse());
    // El listado anterior se conserva (versiones ya instaladas): hasta 1.000 filas.
    expect((await send(owner, `/api/expenses?${range()}&status=all`)).json<ExpenseDto[]>()).toHaveLength(1000);
  });

  it('si se registran gastos mientras se navega, las filas que ya estaban no se repiten ni se saltan', async () => {
    const owner = await register(app, 'Altas en medio');
    await seed(owner, 250);
    const first = (await send(owner, `/api/expenses/page?${range()}&status=all&limit=100`)).json<ExpensesPage>();
    // Llegan 40 gastos nuevos (los más recientes: quedarían "antes" de la página ya vista).
    await seed(owner, 40, 10_000);
    const ids = first.data.map((e) => e.id);
    let cursor = first.nextCursor;
    while (cursor) {
      const page = (await send(owner, `/api/expenses/page?${range()}&status=all&limit=100&cursor=${encodeURIComponent(cursor)}`)).json<ExpensesPage>();
      ids.push(...page.data.map((e) => e.id));
      cursor = page.nextCursor;
    }
    const original = await testDb.pool.query<{ id: string }>("select id from expenses where business_id = $1 and (substring(description from 7))::int <= 250", [owner.business.id]);
    expect(original.rows).toHaveLength(250);
    // Ninguna fila repetida, y TODAS las que existían al empezar están (las nuevas pueden o no aparecer según su orden).
    expect(new Set(ids).size).toBe(ids.length);
    for (const { id } of original.rows) expect(ids).toContain(id);
  });

  it('los filtros se aplican igual a las filas y a los totales', async () => {
    const owner = await register(app, 'Filtros');
    await seed(owner, 400);
    const { ids, pages } = await walk(owner, `${range()}&type=payroll`, 50);
    const payrollActive = expected(400, 0, (g) => g % 4 === 0 && g % 10 !== 0);
    expect(ids).toHaveLength(payrollActive.count);
    expect(pages[0]!.summary).toEqual(payrollActive);
    expect(pages.flatMap((p) => p.data).every((e) => e.type === 'payroll' && e.status === 'active')).toBe(true);
  });

  it('un cursor alterado es un 400 (nunca un 500) y el negocio B no ve nada del A', async () => {
    const a = await register(app, 'Cursor A');
    await seed(a, 120);
    expect((await send(a, `/api/expenses/page?${range()}&cursor=no-es-un-cursor`)).statusCode).toBe(400);
    const b = await register(app, 'Cursor B');
    const page = (await send(b, `/api/expenses/page?${range()}&status=all`)).json<ExpensesPage>();
    expect(page.data).toEqual([]);
    expect(page.summary).toEqual({ count: 0, activeCount: 0, activeTotal: 0 });
    // Un cursor del A usado por B no le muestra filas del A.
    const cursorA = (await send(a, `/api/expenses/page?${range()}&status=all&limit=50`)).json<ExpensesPage>().nextCursor!;
    expect((await send(b, `/api/expenses/page?${range()}&status=all&cursor=${encodeURIComponent(cursorA)}`)).json<ExpensesPage>().data).toEqual([]);
  });

  it('un empleado sin "Finanzas" recibe 403', async () => {
    const owner = await register(app, 'Permiso página');
    const { createEmployee } = await import('./helpers/booking');
    const { session } = await createEmployee(app, owner, ['services_record']);
    expect((await send(session, `/api/expenses/page?${range()}`)).statusCode).toBe(403);
  });
});

async function workbookRows(body: Buffer): Promise<unknown[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(body as unknown as ExcelJS.Buffer);
  const out: unknown[][] = [];
  wb.worksheets[0]!.eachRow({ includeEmpty: false }, (row) => out.push((row.values as unknown[]).slice(1)));
  return out;
}

describe('descargas completas', () => {
  it('Excel de gastos con 6.000 filas: las trae TODAS (antes se cortaba en 5.000) y el total coincide', async () => {
    const owner = await register(app, 'Excel 6000');
    await seed(owner, 6000);
    const res = await send(owner, `/api/expenses/export.xlsx?${range()}&status=all`);
    expect(res.statusCode).toBe(200);
    const rows = (await workbookRows(res.rawPayload)).slice(2); // título + encabezado
    expect(rows).toHaveLength(6000 + 1); // + fila de total
    expect(rows.at(-1)![8]).toBe(expected(6000).activeTotal);
  }, 60_000);

  it(`más de ${EXPORT_MAX_ROWS.toLocaleString('es-CO')} filas: 400 export_too_many_rows con la cantidad (nunca un archivo cortado)`, async () => {
    const owner = await register(app, 'Excel enorme');
    // 56.000 filas (10 % anuladas): pasan del tope tanto los gastos (56.000) como los movimientos vigentes del balance (50.400).
    await seed(owner, 56_000);
    const res = await send(owner, `/api/expenses/export.xlsx?${range()}&status=all`);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'export_too_many_rows', count: 56_000, max: EXPORT_MAX_ROWS });
    const balance = await send(owner, `/api/reports/balance/export.xlsx?${range()}`);
    expect(balance.statusCode).toBe(400);
    expect(balance.json()).toMatchObject({ code: 'export_too_many_rows' });
  }, 120_000);

  it('Excel del balance con más de 5.000 movimientos: los trae todos; el PDF incluye los primeros 2.000 y lo dice', async () => {
    const owner = await register(app, 'Balance grande');
    await seed(owner, 5500);
    const xlsx = await send(owner, `/api/reports/balance/export.xlsx?${range()}`);
    expect(xlsx.statusCode).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx.rawPayload as unknown as ExcelJS.Buffer);
    let moves = 0;
    wb.getWorksheet('Movimientos')!.eachRow(() => moves++);
    const active = expected(5500).activeCount;
    expect(moves).toBe(active + 2); // encabezado + total (sin aviso de recorte)

    const data = await withBusinessTrusted(testDb.db, owner.business.id, (tx) =>
      loadBalanceExport(tx, owner.business.id, { name: 'X', address: '', city: '', currency: 'COP', timezone: TZ }, addDays(today(), -29), today(), PDF_MAX_MOVEMENTS),
    );
    expect(data.movements).toHaveLength(PDF_MAX_MOVEMENTS);
    expect(data.movementsTotal).toBe(active);
    // Los totales del PDF siguen siendo del periodo COMPLETO.
    expect(data.balance.totals.operating + data.balance.totals.payroll).toBe(expected(5500).activeTotal);
    const pdf = (await buildBalancePdf(data, 'es', { compress: false })).toString('latin1');
    const text = [...pdf.matchAll(/\[([^\]]*)\]\s*TJ/g)].map((m) => [...m[1]!.matchAll(/<([0-9a-fA-F]*)>/g)].map((h) => Buffer.from(h[1]!, 'hex').toString('latin1')).join('')).join('\n');
    expect(text).toContain('Se incluyen los primeros 2000 movimientos del periodo; el Excel los trae todos.');
    expect(text).toContain('Total de lo incluido');
  }, 120_000);
});
