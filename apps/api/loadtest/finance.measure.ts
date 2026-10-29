import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import type { AuthSession } from '@xiro/shared';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, it } from 'vitest';
import { buildApp } from '../src/app';
import { addDays, localDate } from '../src/booking/time';
import { loadConfig } from '../src/config';
import { auth, register, TZ } from '../test/helpers/booking';
import { createTestDatabase, testAppConfig, type TestDatabase } from '../test/helpers/db';

/**
 * Fase 6 de la auditoría — MEDICIÓN de consultas y capacidad de los reportes financieros (no es una prueba: no falla por
 * tiempos; registra números). Corre sobre el PostgreSQL efímero de las pruebas, nunca sobre desarrollo ni producción:
 *
 *   npx vitest run --config loadtest/vitest.measure.config.ts        (desde apps/api)
 *
 * Datos sintéticos: un negocio GRANDE con dos años de actividad y otros negocios con datos propios (para que el filtro por
 * negocio importe). Mide el SQL REAL que ejecuta la API (capturado al vuelo) con EXPLAIN (ANALYZE, BUFFERS) bajo el mismo
 * rol y RLS que usa cada ruta, los tiempos de punta a punta, y una ráfaga concurrente de descargas (CPU, memoria, pool,
 * esperas y bloqueos de PostgreSQL). Resultados: data/medicion/finanzas-<fecha>.{json,md}.
 */
const BIG = { days: 730, salesPerDay: 250, unbilledPerDay: 30, expensesPerDay: 15 };
const OTHERS = { count: 20, days: 365, salesPerDay: 40, unbilledPerDay: 5, expensesPerDay: 3 };
const REPEAT = 5;

let app: FastifyInstance;
let testDb: TestDatabase;
let cleanupConfig: () => void;
let big: AuthSession;
const results: Record<string, unknown> = {};

/* ---------- Captura del SQL que ejecuta la API (para EXPLAIN) ---------- */
type Captured = { text: string; values: unknown[] };
let capturing: Captured[] | null = null;
const originalQuery = pg.Client.prototype.query;
pg.Client.prototype.query = function patched(this: pg.Client, config: unknown, values?: unknown, callback?: unknown) {
  if (capturing) {
    const text = typeof config === 'string' ? config : (config as { text?: string })?.text;
    // node-postgres acepta los valores dentro del objeto o como segundo argumento (Drizzle usa el segundo).
    const vals = typeof config === 'string' ? values : ((config as { values?: unknown[] })?.values ?? values);
    if (text && /\b(service_records|sales|sale_items|sale_payments|expenses|cash_closings|cash_openings)\b/.test(text) && !/^\s*(insert|update|delete)/i.test(text)) {
      capturing.push({ text, values: Array.isArray(vals) ? vals : [] });
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (originalQuery as any).call(this, config, values, callback);
} as typeof pg.Client.prototype.query;

const today = () => localDate(new Date(), TZ);
const ms = (n: number) => Math.round(n * 10) / 10;
const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;

/** Siembra con SQL directo (sin statement_timeout de la API) un negocio con `days` días de actividad. */
async function seed(client: pg.Client, session: AuthSession, plan: typeof BIG) {
  const b = session.business.id;
  const u = session.user.id;
  const clientRow = await app.inject({ method: 'POST', url: '/api/clients', headers: auth(session), payload: { name: 'Cliente de carga' } });
  const c = clientRow.json<{ id: string }>().id;
  const n = plan.days * plan.salesPerDay;
  const step = (plan.days * 86_400) / n;
  await client.query('drop table if exists seed_s');
  await client.query(
    `create temp table seed_s as
     select gen_random_uuid() as sid, gen_random_uuid() as r1, gen_random_uuid() as r2, g,
            now() - make_interval(secs => g * $1::float8) as ts,
            (g % 50 = 0) as voided, (g % 3 = 0) as has_product,
            30000 + (g % 5) * 5000 as svc, case when g % 3 = 0 then 12000 else 0 end as prod,
            case when g % 10 = 0 then 2000 else 0 end as discount, case when g % 7 = 0 then 3000 else 0 end as tip
     from generate_series(1, $2::int) g`,
    [step, n],
  );
  await client.query(
    `insert into sales (id, business_id, client_id, client_label, subtotal, discount, tip, total, status, void_reason, voided_by, voided_at, created_by, created_at)
     select sid, $1::uuid, null, 'Ocasional', svc + prod, discount, tip, svc + prod - discount + tip,
            case when voided then 'voided' else 'completed' end, case when voided then 'Carga' else '' end,
            case when voided then $2::uuid end, case when voided then ts end, $2::uuid, ts from seed_s`,
    [b, u],
  );
  await client.query(
    `insert into service_records (id, business_id, client_id, label, amount, kind, voided, created_by, created_at)
     select r1, $1::uuid, $2::uuid, 'Corte', svc, 'service', voided, $3::uuid, ts from seed_s
     union all select r2, $1::uuid, $2::uuid, 'Cera', prod, 'product', voided, $3::uuid, ts from seed_s where has_product`,
    [b, c, u],
  );
  await client.query(
    `insert into sale_items (sale_id, business_id, kind, name, unit_price, quantity, total, service_record_id, created_at)
     select sid, $1::uuid, 'service', 'Corte', svc, 1, svc, r1, ts from seed_s
     union all select sid, $1::uuid, 'product', 'Cera', prod, 1, prod, r2, ts from seed_s where has_product`,
    [b],
  );
  await client.query(
    `insert into sale_payments (sale_id, business_id, method, amount, created_at)
     select sid, $1::uuid, (array['cash','card','nequi','bank_transfer'])[1 + g % 4], svc + prod - discount + tip, ts from seed_s`,
    [b],
  );
  // Cobros sin venta (citas completadas, servicios a mano).
  const unbilled = plan.days * plan.unbilledPerDay;
  await client.query(
    `insert into service_records (business_id, client_id, label, amount, kind, created_by, created_at)
     select $1::uuid, $2::uuid, 'Cita', 40000, 'service', $3::uuid, now() - make_interval(secs => g * $4::float8) from generate_series(1, $5::int) g`,
    [b, c, u, (plan.days * 86_400) / unbilled, unbilled],
  );
  // Gastos repartidos en los días (fecha local), 1 de cada 8 de nómina, 1 de cada 4 desde caja, 1 de cada 20 anulado.
  const expensesN = plan.days * plan.expensesPerDay;
  await client.query(
    `insert into expenses (business_id, amount, description, method, created_by, type, category, expense_date, employee_id, paid_from_cash, status, void_reason, voided_by, voided_at, created_at)
     select $1::uuid, 1000 + (g % 200) * 500, 'Gasto ' || g, case when g % 4 = 0 then 'cash' else 'bank_transfer' end, $2::uuid,
            case when g % 8 = 0 then 'payroll' else 'operating' end, case when g % 8 = 0 then 'salary' else (array['rent','supplies','cleaning','utilities_power'])[1 + g % 4] end,
            (now() at time zone 'America/Bogota')::date - (g % $3::int), case when g % 8 = 0 then $2::uuid end, (g % 4 = 0),
            case when g % 20 = 0 then 'voided' else 'active' end, case when g % 20 = 0 then 'Carga' else '' end,
            case when g % 20 = 0 then $2::uuid end, case when g % 20 = 0 then now() end, now()
     from generate_series(1, $4::int) g`,
    [b, u, plan.days, expensesN],
  );
}

/** EXPLAIN (ANALYZE, BUFFERS) de cada sentencia capturada, con el mismo rol/RLS que la ruta. */
async function explainAll(client: pg.Client, statements: Captured[], rls: string | null) {
  const out: Array<{ sql: string; executionMs: number; planningMs: number; scans: string[]; sharedReadBlocks: number }> = [];
  for (const { text, values } of statements) {
    await client.query('begin');
    try {
      if (rls) await client.query(`select set_config('role', 'xiro_app', true), set_config('app.business_id', $1, true)`, [rls]);
      const { rows } = await client.query(`explain (analyze, buffers, format json) ${text}`, values);
      const plan = (rows[0] as { 'QUERY PLAN': Array<{ Plan: PlanNode; 'Execution Time': number; 'Planning Time': number }> })['QUERY PLAN'][0]!;
      const scans: string[] = [];
      let reads = 0;
      const walk = (node: PlanNode) => {
        reads += node['Shared Read Blocks'] ?? 0;
        if (/Scan/.test(node['Node Type']) && node['Relation Name']) {
          scans.push(`${node['Node Type']} ${node['Relation Name']}${node['Index Name'] ? ` (${node['Index Name']})` : ''} → ${node['Actual Rows'] * (node['Actual Loops'] ?? 1)} filas`);
        }
        if (node['Sort Method']) scans.push(`Sort ${node['Sort Method']} ${node['Sort Space Used'] ?? ''}${node['Sort Space Type'] ? ` kB ${node['Sort Space Type']}` : ''}`);
        for (const child of node.Plans ?? []) walk(child);
      };
      walk(plan.Plan);
      out.push({ sql: text.replace(/\s+/g, ' ').trim().slice(0, 140), executionMs: ms(plan['Execution Time']), planningMs: ms(plan['Planning Time']), scans, sharedReadBlocks: reads });
    } finally {
      await client.query('rollback');
    }
  }
  return out;
}
interface PlanNode {
  'Node Type': string;
  'Relation Name'?: string;
  'Index Name'?: string;
  'Actual Rows': number;
  'Actual Loops'?: number;
  'Shared Read Blocks'?: number;
  'Sort Method'?: string;
  'Sort Space Used'?: number;
  'Sort Space Type'?: string;
  Plans?: PlanNode[];
}

/** Tiempo de punta a punta de una ruta (REPEAT veces, la primera calienta). */
async function timeRoute(url: string) {
  const times: number[] = [];
  let status = 0;
  let bytes = 0;
  // Cuánto se bloquea el hilo de Node mientras se atiende (lo que sufren las DEMÁS peticiones de la instancia).
  const loop = monitorEventLoopDelay({ resolution: 10 });
  for (let i = 0; i <= REPEAT; i++) {
    // La primera llamada calienta (carga de módulos, fuentes del PDF): NO cuenta para el bloqueo ni para los tiempos.
    if (i === 1) loop.enable();
    const t0 = performance.now();
    const res = await app.inject({ method: 'GET', url, headers: auth(big) });
    const elapsed = performance.now() - t0;
    status = res.statusCode;
    bytes = res.rawPayload.length;
    if (i > 0) times.push(elapsed);
  }
  await new Promise((resolve) => setTimeout(resolve, 30)); // que el medidor registre el último retraso
  loop.disable();
  times.sort((x, y) => x - y);
  return { status, bytes, p50: ms(pct(times, 50)), p95: ms(pct(times, 95)), max: ms(times.at(-1)!), loopBlockMaxMs: ms(loop.max / 1e6) };
}

beforeAll(async () => {
  testDb = await createTestDatabase({ poolMax: 10 });
  // Sin la protección por retraso del hilo (under-pressure): aquí se MIDE ese retraso; con ella, la instancia respondería 503.
  const { config, cleanup } = testAppConfig({
    observability: { ...loadConfig({ NODE_ENV: 'test' } as NodeJS.ProcessEnv).observability, maxEventLoopDelayMs: 0 },
    // Como en producción: descargas en hilos de trabajo (EXPORT_WORKERS, por defecto 2). MEASURE_EXPORT_WORKERS=0 mide sin hilos.
    exports: { workers: Number(process.env.MEASURE_EXPORT_WORKERS ?? 2), queueMax: 50, timeoutMs: 120_000, workerMemoryMb: 256 },
  });
  cleanupConfig = cleanup;
  app = await buildApp({ db: testDb.db, config });
}, 60 * 60_000);

afterAll(async () => {
  await app.close();
  cleanupConfig();
  await testDb.drop();
});

it('mide consultas y capacidad de los reportes financieros', async () => {
  const seeder = new pg.Client({ connectionString: testDb.url });
  seeder.on('error', () => undefined);
  await seeder.connect();
  const t0 = performance.now();
  big = await register(app, 'Negocio grande');
  await seed(seeder, big, BIG);
  for (let i = 0; i < OTHERS.count; i++) await seed(seeder, await register(app, `Otro ${i}`), OTHERS);
  await app.inject({ method: 'POST', url: '/api/cash/opening', headers: auth(big), payload: { amount: 200000 } });
  // Estado estable, como en producción tras el autovacuum: estadísticas y mapa de visibilidad al día.
  await seeder.query('vacuum analyze');
  const counts = (await seeder.query(`select (select count(*) from sales)::int sales, (select count(*) from service_records)::int records, (select count(*) from sale_items)::int items, (select count(*) from expenses)::int expenses, (select count(*) from businesses)::int businesses,
    (select count(*) from sales where business_id = $1)::int big_sales, (select count(*) from service_records where business_id = $1)::int big_records, (select count(*) from expenses where business_id = $1)::int big_expenses,
    pg_size_pretty(pg_database_size(current_database())) size`, [big.business.id])).rows[0];
  results.data = { ...counts, seedSeconds: ms((performance.now() - t0) / 1000) };

  const d = today();
  const ranges = { '1 día': [d, d], '30 días': [addDays(d, -29), d], '12 meses': [addDays(d, -364), d], '3 años (máximo)': [addDays(d, -1094), d] } as const;

  // 1) EXPLAIN del SQL real de cada ruta.
  const explain: Record<string, unknown> = {};
  const capture = async (label: string, url: string, rls: string | null) => {
    capturing = [];
    const res = await app.inject({ method: 'GET', url, headers: auth(big) });
    const statements = capturing;
    capturing = null;
    explain[label] = { status: res.statusCode, statements: await explainAll(seeder, statements, rls) };
  };
  for (const [label, [from, to]] of Object.entries(ranges)) await capture(`balance ${label}`, `/api/reports/balance?from=${from}&to=${to}`, big.business.id);
  const [yFrom, yTo] = ranges['12 meses'];
  const movements = (await app.inject({ method: 'GET', url: `/api/reports/balance/movements?from=${yFrom}&to=${yTo}&pageSize=50`, headers: auth(big) })).json<{ total: number }>();
  const lastPage = Math.max(1, Math.ceil(movements.total / 50));
  await capture('movimientos 12 meses · página 1 (fecha)', `/api/reports/balance/movements?from=${yFrom}&to=${yTo}&pageSize=50`, big.business.id);
  await capture('movimientos 12 meses · página 1 (monto)', `/api/reports/balance/movements?from=${yFrom}&to=${yTo}&pageSize=50&sort=amount`, big.business.id);
  await capture(`movimientos 12 meses · última página (${lastPage})`, `/api/reports/balance/movements?from=${yFrom}&to=${yTo}&pageSize=50&page=${lastPage}`, big.business.id);
  await capture('gastos · primera página + totales (12 meses)', `/api/expenses/page?from=${yFrom}&to=${yTo}&status=all`, big.business.id);
  await capture('cierre de caja · resumen de hoy', `/api/cash/close-summary?day=${d}`, null);
  results.explain = explain;
  results.movementsTotal12m = movements.total;

  // 1b) Experimentos (dentro de transacciones que se REVIERTEN: no cambian el esquema): índices candidatos y una variante del
  // conteo de movimientos. Se compara el mismo SQL capturado, con el mismo rol y RLS, antes y después.
  const candidates = {
    'índice parcial service_records (negocio, fecha) INCLUDE (monto, tipo) WHERE vigente':
      'create index on service_records (business_id, created_at) include (amount, kind) where voided = false',
    'índice parcial sales (negocio, fecha) INCLUDE (descuento, propina) WHERE completada':
      "create index on sales (business_id, created_at) include (discount, tip) where status = 'completed'",
  };
  const experiment = async (label: string, url: string, ddl: string[]) => {
    capturing = [];
    await app.inject({ method: 'GET', url, headers: auth(big) });
    const statements = capturing;
    capturing = null;
    const measure = async (withDdl: boolean) => {
      const out: number[] = [];
      for (const { text, values } of statements) {
        await seeder.query('begin');
        try {
          if (withDdl) for (const stmt of ddl) await seeder.query(stmt);
          await seeder.query(`select set_config('role', 'xiro_app', true), set_config('app.business_id', $1, true)`, [big.business.id]);
          // Dos corridas: la primera calienta la caché; se registra la segunda.
          await seeder.query(`explain (analyze, format json) ${text}`, values);
          const { rows } = await seeder.query(`explain (analyze, format json) ${text}`, values);
          out.push(ms((rows[0] as { 'QUERY PLAN': Array<{ 'Execution Time': number }> })['QUERY PLAN'][0]!['Execution Time']));
        } finally {
          await seeder.query('rollback');
        }
      }
      return out;
    };
    return { label, sinCambios: await measure(false), conIndices: await measure(true) };
  };
  const ddl = Object.values(candidates);
  results.experiments = {
    candidatos: Object.keys(candidates),
    casos: [
      await experiment('balance 12 meses', `/api/reports/balance?from=${yFrom}&to=${yTo}`, ddl),
      await experiment('balance 3 años', `/api/reports/balance?from=${ranges['3 años (máximo)'][0]}&to=${d}`, ddl),
      await experiment('movimientos 12m · página 1 (fecha)', `/api/reports/balance/movements?from=${yFrom}&to=${yTo}&pageSize=50`, ddl),
      await experiment('movimientos 12m · página 1 (monto)', `/api/reports/balance/movements?from=${yFrom}&to=${yTo}&pageSize=50&sort=amount`, ddl),
    ],
  };
  // Variante del conteo: el total con count(*) over () en la MISMA consulta de la página, en vez de una segunda consulta.
  {
    capturing = [];
    await app.inject({ method: 'GET', url: `/api/reports/balance/movements?from=${yFrom}&to=${yTo}&pageSize=50`, headers: auth(big) });
    const [pageSql, countSql] = capturing;
    capturing = null;
    const run = async (text: string, values: unknown[]) => {
      await seeder.query('begin');
      try {
        await seeder.query(`select set_config('role', 'xiro_app', true), set_config('app.business_id', $1, true)`, [big.business.id]);
        await seeder.query(`explain (analyze, format json) ${text}`, values);
        const { rows } = await seeder.query(`explain (analyze, format json) ${text}`, values);
        return ms((rows[0] as { 'QUERY PLAN': Array<{ 'Execution Time': number }> })['QUERY PLAN'][0]!['Execution Time']);
      } finally {
        await seeder.query('rollback');
      }
    };
    const windowed = pageSql!.text.replace(/^select \* from/, 'select *, count(*) over () as total_count from');
    results.movementsCountVariant = { 'página + COUNT aparte (actual)': ms((await run(pageSql!.text, pageSql!.values)) + (await run(countSql!.text, countSql!.values))), 'una consulta con count(*) over ()': await run(windowed, pageSql!.values) };
  }

  // 2) Tiempos de punta a punta (p50/p95 de REPEAT llamadas, tras una de calentamiento).
  const timing: Record<string, unknown> = {};
  for (const [label, [from, to]] of Object.entries(ranges)) timing[`balance ${label}`] = await timeRoute(`/api/reports/balance?from=${from}&to=${to}`);
  timing['movimientos 12m · página 1'] = await timeRoute(`/api/reports/balance/movements?from=${yFrom}&to=${yTo}&pageSize=50`);
  timing[`movimientos 12m · página ${lastPage} (OFFSET alto)`] = await timeRoute(`/api/reports/balance/movements?from=${yFrom}&to=${yTo}&pageSize=50&page=${lastPage}`);
  timing['gastos · página 1 (12m)'] = await timeRoute(`/api/expenses/page?from=${yFrom}&to=${yTo}&status=all`);
  timing['cierre de caja · hoy'] = await timeRoute(`/api/cash/close-summary?day=${d}`);
  const [mFrom, mTo] = ranges['30 días'];
  timing['Excel balance 30 días'] = await timeRoute(`/api/reports/balance/export.xlsx?from=${mFrom}&to=${mTo}`);
  timing['PDF balance 30 días'] = await timeRoute(`/api/reports/balance/export.pdf?from=${mFrom}&to=${mTo}`);
  timing['Excel gastos 12 meses'] = await timeRoute(`/api/expenses/export.xlsx?from=${yFrom}&to=${yTo}&status=all`);
  // 12 meses de movimientos del negocio grande pasan del tope de 50.000 filas del Excel: se mide que responda rápido el 400.
  timing['Excel balance 12 meses (sobre el tope → 400)'] = await timeRoute(`/api/reports/balance/export.xlsx?from=${yFrom}&to=${yTo}`);
  timing['PDF balance 12 meses (2.000 movimientos)'] = await timeRoute(`/api/reports/balance/export.pdf?from=${yFrom}&to=${yTo}`);
  results.timing = timing;

  // 3) Ráfaga concurrente: 4 Excel de 30 días + 4 PDF de 12 meses + 8 balances de 12 meses + 4 Excel de gastos de 12 meses.
  const monitor = new pg.Client({ connectionString: testDb.url });
  monitor.on('error', () => undefined);
  await monitor.connect();
  const samples = { rssMaxMb: 0, heapMaxMb: 0, poolTotalMax: 0, poolWaitingMax: 0, pgActiveMax: 0, pgLockWaitsMax: 0, pgWaitEvents: {} as Record<string, number> };
  const memBefore = process.memoryUsage();
  let stop = false;
  const sampler = (async () => {
    while (!stop) {
      const m = process.memoryUsage();
      samples.rssMaxMb = Math.max(samples.rssMaxMb, Math.round(m.rss / 1e6));
      samples.heapMaxMb = Math.max(samples.heapMaxMb, Math.round(m.heapUsed / 1e6));
      samples.poolTotalMax = Math.max(samples.poolTotalMax, testDb.pool.totalCount);
      samples.poolWaitingMax = Math.max(samples.poolWaitingMax, testDb.pool.waitingCount);
      const act = (await monitor.query(`select count(*) filter (where state = 'active')::int active, count(*) filter (where wait_event_type = 'Lock')::int lock_waits, string_agg(distinct coalesce(wait_event_type || ':' || wait_event, ''), ',') events from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid()`)).rows[0];
      samples.pgActiveMax = Math.max(samples.pgActiveMax, act.active);
      samples.pgLockWaitsMax = Math.max(samples.pgLockWaitsMax, act.lock_waits);
      for (const e of String(act.events ?? '').split(',').filter(Boolean)) samples.pgWaitEvents[e] = (samples.pgWaitEvents[e] ?? 0) + 1;
      await new Promise((r) => setTimeout(r, 50));
    }
  })();
  const cpu0 = process.cpuUsage();
  const w0 = performance.now();
  const burst = [
    ...Array.from({ length: 4 }, () => `/api/reports/balance/export.xlsx?from=${mFrom}&to=${mTo}`),
    ...Array.from({ length: 4 }, () => `/api/reports/balance/export.pdf?from=${yFrom}&to=${yTo}`),
    ...Array.from({ length: 8 }, () => `/api/reports/balance?from=${yFrom}&to=${yTo}`),
    ...Array.from({ length: 4 }, () => `/api/expenses/export.xlsx?from=${yFrom}&to=${yTo}&status=all`),
  ];
  const each = await Promise.all(
    burst.map(async (url) => {
      const t = performance.now();
      const res = await app.inject({ method: 'GET', url, headers: auth(big) });
      return { kind: url.split('?')[0], status: res.statusCode, ms: performance.now() - t };
    }),
  );
  const wall = performance.now() - w0;
  const cpu = process.cpuUsage(cpu0);
  stop = true;
  await sampler;
  await monitor.end();
  const byKind: Record<string, { n: number; statuses: number[]; p50: number; max: number }> = {};
  for (const e of each) {
    const k = (byKind[e.kind!] ??= { n: 0, statuses: [], p50: 0, max: 0 });
    k.n++;
    k.statuses.push(e.status);
  }
  for (const [kind, v] of Object.entries(byKind)) {
    const t = each.filter((e) => e.kind === kind).map((e) => e.ms).sort((x, y) => x - y);
    v.p50 = ms(pct(t, 50));
    v.max = ms(t.at(-1)!);
    v.statuses = [...new Set(v.statuses)];
  }
  results.burst = {
    requests: burst.length,
    wallMs: ms(wall),
    apiCpuMs: ms((cpu.user + cpu.system) / 1000),
    apiCpuCoresAvg: ms((cpu.user + cpu.system) / 1000 / wall),
    rssBeforeMb: Math.round(memBefore.rss / 1e6),
    ...samples,
    byKind,
  };
  await seeder.end();

  // Resultados
  const dir = path.join(__dirname, '..', 'data', 'medicion');
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  writeFileSync(path.join(dir, `finanzas-${stamp}.json`), JSON.stringify(results, null, 2));
  const md: string[] = [`# Medición finanzas ${stamp}`, '', '## Datos', '```', JSON.stringify(results.data, null, 2), '```', '', '## EXPLAIN'];
  for (const [label, v] of Object.entries(results.explain as Record<string, { status: number; statements: Array<{ sql: string; executionMs: number; planningMs: number; scans: string[]; sharedReadBlocks: number }> }>)) {
    md.push(`### ${label} (HTTP ${v.status})`);
    for (const s of v.statements) md.push(`- ${s.executionMs} ms (plan ${s.planningMs} ms, lecturas ${s.sharedReadBlocks}) · \`${s.sql}\``, ...s.scans.map((x) => `  - ${x}`));
  }
  md.push('', '## Tiempos (p50 / p95 / máx, ms) y bloqueo máximo del hilo de Node', '| Ruta | HTTP | bytes | p50 | p95 | máx | hilo bloqueado máx |', '|---|---|---|---|---|---|---|');
  for (const [label, t] of Object.entries(results.timing as Record<string, { status: number; bytes: number; p50: number; p95: number; max: number; loopBlockMaxMs: number }>)) md.push(`| ${label} | ${t.status} | ${t.bytes} | ${t.p50} | ${t.p95} | ${t.max} | ${t.loopBlockMaxMs} |`);
  md.push('', '## Experimentos (transacciones revertidas)', '```', JSON.stringify({ experiments: results.experiments, movementsCountVariant: results.movementsCountVariant }, null, 2), '```');
  md.push('', '## Ráfaga concurrente', '```', JSON.stringify(results.burst, null, 2), '```');
  writeFileSync(path.join(dir, `finanzas-${stamp}.md`), md.join('\n'));
});
