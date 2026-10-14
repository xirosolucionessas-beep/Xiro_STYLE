import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { AuthSession, ExpenseDto } from '@xiro/shared';
import ExcelJS from 'exceljs';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { ExportPool } from '../src/exports/pool';
import { addDays, localDate } from '../src/booking/time';
import { auth, register, TZ } from './helpers/booking';
import { createTestDatabase, testAppConfig, type TestDatabase } from './helpers/db';

/**
 * Fase 6 — las descargas PDF/Excel se generan en hilos de trabajo (exports/pool.ts): mismos archivos que en el hilo
 * principal, sin bloquearlo, con cola acotada (503 "server_busy" al llenarse) y tiempo máximo por archivo.
 */
let testDb: TestDatabase;
let inline: FastifyInstance;
let threaded: FastifyInstance;
let busy: FastifyInstance;
const cleanups: Array<() => void> = [];
let owner: AuthSession;

const today = () => localDate(new Date(), TZ);
const range = () => `from=${addDays(today(), -29)}&to=${today()}`;

beforeAll(async () => {
  testDb = await createTestDatabase();
  const make = async (spec: { workers: number; queueMax: number; timeoutMs: number }) => {
    const exports = { ...spec, workerMemoryMb: 256 };
    // Sin la protección por retraso del hilo (under-pressure): esta prueba MIDE ese retraso. Con ella, el Excel generado en
    // el hilo principal (la variante "antes") la dispararía y las peticiones siguientes recibirían 503: justo lo que se corrige.
    const { config, cleanup } = testAppConfig({ exports, observability: { ...loadConfig({ NODE_ENV: 'test' } as NodeJS.ProcessEnv).observability, maxEventLoopDelayMs: 0 } });
    cleanups.push(cleanup);
    return buildApp({ db: testDb.db, config });
  };
  inline = await make({ workers: 0, queueMax: 20, timeoutMs: 60_000 });
  threaded = await make({ workers: 1, queueMax: 20, timeoutMs: 60_000 });
  busy = await make({ workers: 1, queueMax: 0, timeoutMs: 60_000 });
  owner = await register(inline, 'Hilos de descarga');
  // 20.000 gastos: un Excel que en el hilo principal lo bloquea de forma medible.
  await testDb.pool.query(
    `insert into expenses (business_id, amount, description, method, created_by, category, expense_date)
     select $1, 1000 + g, 'Gasto ' || g, 'bank_transfer', $2, 'supplies', $3::date - (g % 30) from generate_series(1, 20000) g`,
    [owner.business.id, owner.user.id, today()],
  );
}, 180_000);

afterAll(async () => {
  for (const app of [inline, threaded, busy]) await app.close();
  for (const cleanup of cleanups) cleanup();
  await testDb.drop();
});

async function cells(body: Buffer): Promise<unknown[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(body as unknown as ExcelJS.Buffer);
  const out: unknown[][] = [];
  for (const sheet of wb.worksheets) sheet.eachRow((row) => out.push([sheet.name, ...(row.values as unknown[]).slice(1).map((v) => (v instanceof Date ? v.toISOString() : v))]));
  return out;
}

/** Descarga midiendo cuánto se bloqueó el hilo principal mientras tanto. */
async function download(app: FastifyInstance, url: string) {
  const loop = monitorEventLoopDelay({ resolution: 5 });
  loop.enable();
  const res = await app.inject({ method: 'GET', url, headers: auth(owner) });
  await new Promise((resolve) => setTimeout(resolve, 30)); // que el medidor registre el último retraso
  loop.disable();
  return { res, blockedMs: loop.max / 1e6 };
}

describe('descargas en hilos de trabajo', () => {
  it('producen los mismos archivos que en el hilo principal (Excel de gastos y del balance; PDF válido)', async () => {
    for (const url of [`/api/expenses/export.xlsx?${range()}`, `/api/reports/balance/export.xlsx?from=${today()}&to=${today()}`]) {
      const [a, b] = [await inline.inject({ method: 'GET', url, headers: auth(owner) }), await threaded.inject({ method: 'GET', url, headers: auth(owner) })];
      expect([a.statusCode, b.statusCode], url).toEqual([200, 200]);
      // El momento de generación ("Generado el…") puede cambiar de un minuto a otro: se compara todo lo demás.
      const strip = (rows: unknown[][]) => rows.filter((r) => !String(r[1]).startsWith('Generado el'));
      expect(strip(await cells(b.rawPayload)), url).toEqual(strip(await cells(a.rawPayload)));
    }
    const pdf = await threaded.inject({ method: 'GET', url: `/api/reports/balance/export.pdf?${range()}`, headers: auth(owner) });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
  }, 120_000);

  it('el hilo principal deja de bloquearse mientras se genera el PDF (pdfkit arma el documento de forma síncrona)', async () => {
    // El caso real medido en docs/finance-capacity.md: el PDF de 30 días (2.000 movimientos) bloqueaba ~600 ms el hilo.
    const url = `/api/reports/balance/export.pdf?${range()}`;
    for (const app of [inline, threaded]) await download(app, url); // calienta (módulos, fuentes, hilo de trabajo)
    const main = await download(inline, url);
    const worker = await download(threaded, url);
    expect([main.res.statusCode, worker.res.statusCode]).toEqual([200, 200]);
    expect(worker.blockedMs, `principal ${main.blockedMs} ms, hilo ${worker.blockedMs} ms`).toBeLessThan(main.blockedMs / 2);
  }, 120_000);

  it('con la cola llena responde 503 "server_busy" con Retry-After (nunca acumula archivos sin límite)', async () => {
    const url = `/api/expenses/export.xlsx?${range()}`;
    const results = await Promise.all([busy.inject({ method: 'GET', url, headers: auth(owner) }), busy.inject({ method: 'GET', url, headers: auth(owner) })]);
    const statuses = results.map((r) => r.statusCode).sort();
    expect(statuses).toEqual([200, 503]);
    const rejected = results.find((r) => r.statusCode === 503)!;
    expect(rejected.json()).toMatchObject({ code: 'server_busy' });
    expect(rejected.headers['retry-after']).toBe('5');
  }, 120_000);
});

describe('grupo de hilos', () => {
  const rows = (n: number): ExpenseDto[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `id-${i}`,
      amount: 1000 + i,
      description: `Gasto ${i}`,
      method: 'bank_transfer',
      createdByName: 'Dueña',
      createdAt: new Date().toISOString(),
      type: 'operating',
      category: 'supplies',
      expenseDate: today(),
      employeeId: null,
      employeeName: null,
      notes: '',
      paidFromCash: false,
      status: 'active',
      voidReason: '',
      voidedByName: null,
      voidedAt: null,
      updatedAt: new Date().toISOString(),
      cashDayClosed: false,
    }));
  const job = (n: number) => ({ kind: 'expenses-xlsx' as const, rows: rows(n), business: { name: 'X', address: '', city: '', currency: 'COP' as const, timezone: TZ }, range: { from: today(), to: today() }, lang: 'es' as const });

  it('un archivo que pasa del tiempo máximo se corta (503) y el siguiente funciona con un hilo nuevo', async () => {
    const pool = new ExportPool({ workers: 1, queueMax: 5, timeoutMs: 50 });
    try {
      await expect(pool.run(job(60_000))).rejects.toMatchObject({ status: 503, code: 'server_busy' });
      const relaxed = new ExportPool({ workers: 1, queueMax: 5, timeoutMs: 60_000 });
      try {
        const file = await relaxed.run(job(10));
        expect(file.subarray(0, 2).toString()).toBe('PK'); // un .xlsx es un zip
      } finally {
        await relaxed.close();
      }
      expect(pool.stats()).toMatchObject({ running: 0, waiting: 0 });
    } finally {
      await pool.close();
    }
  }, 120_000);

  it('el peor caso permitido (Excel del balance con 50.000 movimientos) cabe con holgura en un hilo de 128 MB', async () => {
    // Armado en memoria pedía ~450 MB de heap (y tumbaba el proceso); escrito por flujo usa ~35 MB (docs/finance-capacity.md).
    const movements = Array.from({ length: 50_000 }, (_, i) => ({ id: `m${i}`, at: new Date(Date.now() - i * 60_000).toISOString(), direction: 'in' as const, kind: 'service' as const, category: null, description: `Movimiento de prueba ${i}`, amount: 10_000 + i }));
    const totals = { services: 1, products: 0, discounts: 0, income: 1, tips: 0, operating: 0, payroll: 0, net: 1, margin: 100 };
    const data = {
      business: { name: 'Peor caso', address: '', city: '', currency: 'COP' as const, timezone: TZ },
      balance: { from: addDays(today(), -364), to: today(), previous: { from: addDays(today(), -729), to: addDays(today(), -365), totals }, totals, comparison: { income: null, operating: null, payroll: null, net: null }, series: { grouping: 'month' as const, buckets: [] }, expenseBreakdown: [] },
      movements,
      movementsTotal: movements.length,
      generatedAt: new Date(),
    };
    const pool = new ExportPool({ workers: 1, queueMax: 1, timeoutMs: 120_000, workerMemoryMb: 128 });
    try {
      const file = await pool.run({ kind: 'balance-xlsx', data, lang: 'es' });
      expect(file.subarray(0, 2).toString()).toBe('PK');
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(file as unknown as ExcelJS.Buffer);
      expect(wb.getWorksheet('Movimientos')!.rowCount).toBe(50_000 + 2); // encabezado + filas + total
    } finally {
      await pool.close();
    }
  }, 180_000);

  it('nunca genera más archivos a la vez que hilos; los demás esperan su turno y todos terminan', async () => {
    const pool = new ExportPool({ workers: 2, queueMax: 10, timeoutMs: 60_000 });
    try {
      let maxRunning = 0;
      const watch = setInterval(() => (maxRunning = Math.max(maxRunning, pool.stats().running)), 5);
      const files = await Promise.all(Array.from({ length: 6 }, () => pool.run(job(2_000))));
      clearInterval(watch);
      expect(files.every((f) => f.subarray(0, 2).toString() === 'PK')).toBe(true);
      expect(maxRunning).toBeLessThanOrEqual(2);
      expect(pool.stats()).toMatchObject({ running: 0, waiting: 0, activeWorkers: 2 });
    } finally {
      await pool.close();
    }
  }, 120_000);
});
