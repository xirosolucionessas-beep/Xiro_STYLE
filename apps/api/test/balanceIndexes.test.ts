import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { balanceTotals } from '../src/booking/balance';
import { withBusiness } from '../src/booking/scope';
import { addDays, localDate } from '../src/booking/time';
import { register, TZ } from './helpers/booking';
import { createTestDatabase, testAppConfig, type TestDatabase } from './helpers/db';

/**
 * Migración 0036 — índices parciales de cobertura del Balance general (docs/finance-capacity.md): existen con su definición
 * exacta y PostgreSQL los usa en la consulta REAL de totales (con el rol restringido y RLS, como la ruta).
 */
let testDb: TestDatabase;
let cleanup: () => void;
let businessId: string;

beforeAll(async () => {
  testDb = await createTestDatabase();
  const created = testAppConfig();
  cleanup = created.cleanup;
  const app = await buildApp({ db: testDb.db, config: created.config });
  const target = await register(app, 'Índices balance');
  const other = await register(app, 'Otro negocio');
  await app.close();
  businessId = target.business.id;
  const { rows } = await testDb.pool.query<{ id: string; bid: string }>(
    `insert into clients (business_id, name) values ($1, 'C1'), ($2, 'C2') returning id, business_id as bid`,
    [target.business.id, other.business.id],
  );
  const clientOf = (bid: string) => rows.find((r) => r.bid === bid)!.id;
  // Un año de cobros y ventas del negocio medido, y cuatro veces más de otro negocio (el filtro por negocio importa).
  for (const [session, n] of [[target, 40_000], [other, 160_000]] as const) {
    await testDb.pool.query(
      `insert into service_records (business_id, client_id, label, amount, kind, voided, created_by, created_at)
       select $1, $2, 'Corte', 30000, case when g % 3 = 0 then 'product' else 'service' end, (g % 50 = 0), $3, now() - make_interval(secs => g * 788)
       from generate_series(1, $4::int) g`,
      [session.business.id, clientOf(session.business.id), session.user.id, n],
    );
    await testDb.pool.query(
      `insert into sales (business_id, subtotal, discount, tip, total, status, void_reason, voided_by, voided_at, created_by, created_at)
       select $1, 30000, 1000, 500, 29500, case when g % 50 = 0 then 'voided' else 'completed' end, case when g % 50 = 0 then 'x' else '' end,
              case when g % 50 = 0 then $2::uuid end, case when g % 50 = 0 then now() end, $2, now() - make_interval(secs => g * 1051)
       from generate_series(1, $3::int) g`,
      [session.business.id, session.user.id, Math.round(n * 0.75)],
    );
  }
  await testDb.pool.query('vacuum analyze service_records');
  await testDb.pool.query('vacuum analyze sales');
}, 300_000);

afterAll(async () => {
  cleanup();
  await testDb.drop();
});

describe('índices del balance (0036)', () => {
  it('existen con su definición exacta (parciales y con columnas incluidas)', async () => {
    const { rows } = await testDb.pool.query<{ indexname: string; indexdef: string }>("select indexname, indexdef from pg_indexes where indexname in ('service_records_balance_idx', 'sales_balance_idx') order by indexname");
    expect(rows.map((r) => r.indexname)).toEqual(['sales_balance_idx', 'service_records_balance_idx']);
    expect(rows.find((r) => r.indexname === 'service_records_balance_idx')!.indexdef).toMatch(/\(business_id, created_at\) INCLUDE \(amount, kind\) WHERE \(voided = false\)/);
    expect(rows.find((r) => r.indexname === 'sales_balance_idx')!.indexdef).toMatch(/\(business_id, created_at\) INCLUDE \(discount, tip\) WHERE \(status = 'completed'::text\)/);
  });

  it('la consulta real de totales de 12 meses los usa (sin leer la tabla) y da las mismas cifras', async () => {
    const to = localDate(new Date(), TZ);
    const from = addDays(to, -364);
    // El SQL exacto que arma balanceTotals, capturado y explicado bajo el mismo rol y RLS de la ruta.
    let captured: { text: string; values: unknown[] } | null = null;
    const pg = await import('pg');
    const original = pg.default.Client.prototype.query;
    pg.default.Client.prototype.query = function (this: unknown, config: unknown, values?: unknown, cb?: unknown) {
      const text = typeof config === 'string' ? config : (config as { text?: string })?.text;
      if (text?.includes('from service_records') && text.includes('sum(discount)')) captured = { text, values: ((config as { values?: unknown[] })?.values ?? values) as unknown[] };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (original as any).call(this, config, values, cb);
    } as typeof original;
    let totals;
    try {
      totals = await withBusiness(testDb.db, businessId, (tx) => balanceTotals(tx, businessId, from, to, TZ));
    } finally {
      pg.default.Client.prototype.query = original;
    }
    expect(captured).not.toBeNull();
    const plan = await withBusiness(testDb.db, businessId, (tx) => tx.execute(sql.raw(`explain (format json) ${captured!.text.replace(/\$(\d+)/g, (_, i) => `'${String(captured!.values[Number(i) - 1] instanceof Date ? (captured!.values[Number(i) - 1] as Date).toISOString() : captured!.values[Number(i) - 1])}'`)}`)));
    const text = JSON.stringify(plan.rows);
    expect(text).toContain('service_records_balance_idx');
    expect(text).toContain('sales_balance_idx');
    expect(text).toMatch(/Index Only Scan/);
    // Y las cifras son las de siempre (lo vigente del último año del negocio medido).
    const { rows } = await testDb.pool.query(
      `select coalesce(sum(amount) filter (where kind = 'service'), 0)::int as services, coalesce(sum(amount) filter (where kind = 'product'), 0)::int as products
       from service_records where business_id = $1 and voided = false and created_at >= $2 and created_at < $3`,
      [businessId, captured!.values[1], captured!.values[2]],
    );
    expect({ services: totals.services, products: totals.products }).toEqual(rows[0]);
  });
});
