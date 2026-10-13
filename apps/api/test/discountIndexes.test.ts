import type { DiscountCodeDto } from '@xiro/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { auth, setupBiz, type Biz } from './helpers/booking';
import { createTestDatabase, testAppConfig, type TestDatabase } from './helpers/db';

/**
 * Fase 5 del plan: borrar un código de descuento pone NULL en las citas y pedidos que lo usaron (llave foránea ON DELETE SET
 * NULL). Sin índice en esa columna, Postgres recorre TODAS las citas de TODOS los negocios en cada borrado. Medido con
 * EXPLAIN ANALYZE antes (sin el índice, dentro de una transacción que se revierte) y después (con el índice de 0031).
 *   EXPLAIN_REPORT=1 npx vitest run test/discountIndexes.test.ts   → imprime ambos planes y tiempos.
 */
const report = process.env.EXPLAIN_REPORT === '1';
let app: FastifyInstance;
let testDb: TestDatabase;
let cleanup: () => void;
let biz: Biz;
let code: DiscountCodeDto;

beforeAll(async () => {
  testDb = await createTestDatabase();
  const created = testAppConfig();
  cleanup = created.cleanup;
  app = await buildApp({ db: testDb.db, config: created.config });
  biz = await setupBiz(app, 'Índices descuento');
  await app.inject({ method: 'PUT', url: '/api/booking/settings', headers: auth(biz.session), payload: { discountCodesEnabled: true } });
  code = (await app.inject({ method: 'POST', url: '/api/discount-codes', headers: auth(biz.session), payload: { code: 'MEDIR', kind: 'percent', value: 10 } })).json<DiscountCodeDto>();
  const businessId = biz.session.business.id;
  const { rows } = await testDb.pool.query<{ id: string }>(`insert into clients (business_id, name, phone) values ($1, 'Cliente carga', '573009999999') returning id`, [businessId]);
  // 80.000 citas completadas (sin cruces: una por hora hacia atrás); 1 de cada 100 usó el código.
  await testDb.pool.query(
    `insert into appointments (business_id, client_id, professional_id, starts_at, ends_at, busy_until, status, source, total_price, duration_minutes, discount_code_id, discount_amount)
     select $1, $2, $3, now() - (g || ' hours')::interval, now() - (g || ' hours')::interval + interval '30 minutes', now() - (g || ' hours')::interval + interval '30 minutes',
            'completed', 'web', 30000, 30, case when g % 100 = 0 then $4::uuid else null end, case when g % 100 = 0 then 3000 else 0 end
     from generate_series(1, 80000) g`,
    [businessId, rows[0]!.id, biz.ownerId, code.id],
  );
  await testDb.pool.query('analyze appointments');
}, 180_000);

afterAll(async () => {
  await app.close();
  cleanup();
  await testDb.drop();
});

const FK_UPDATE = 'update appointments set discount_code_id = null where discount_code_id = $1';

async function explain(dropIndex: boolean): Promise<{ plan: string; ms: number }> {
  const client = await testDb.pool.connect();
  try {
    await client.query('begin');
    if (dropIndex) await client.query('drop index appointments_discount_code_idx');
    await client.query('select count(*) from appointments where discount_code_id = $1', [code.id]); // en caliente (sin modificar nada)
    const { rows } = await client.query<{ 'QUERY PLAN': string }>(`explain (analyze, costs off) ${FK_UPDATE}`, [code.id]);
    const plan = rows.map((r) => r['QUERY PLAN']).join('\n');
    return { plan, ms: Number(/Execution Time: ([\d.]+) ms/.exec(plan)?.[1] ?? NaN) };
  } finally {
    await client.query('rollback'); // nada de lo medido se guarda: ni el NULL ni la falta del índice
    client.release();
  }
}

describe('índice de la llave foránea al código de descuento (0031)', () => {
  it('sin el índice se recorre la tabla entera; con él, solo las citas que usaron el código', async () => {
    const before = await explain(true);
    const after = await explain(false);
    if (report) console.log(`\n=== ANTES (${before.ms} ms)\n${before.plan}\n\n=== DESPUÉS (${after.ms} ms)\n${after.plan}`);
    expect(before.plan).toMatch(/Seq Scan on appointments/);
    expect(after.plan).toMatch(/appointments_discount_code_idx/);
  });

  it('borrar el código sigue funcionando igual: las citas conservan su monto descontado', async () => {
    expect((await app.inject({ method: 'DELETE', url: `/api/discount-codes/${code.id}`, headers: auth(biz.session) })).statusCode).toBe(204);
    const { rows } = await testDb.pool.query<{ n: number; total: number }>(
      'select count(*)::int as n, sum(discount_amount)::int as total from appointments where business_id = $1 and discount_amount > 0 and discount_code_id is null',
      [biz.session.business.id],
    );
    expect(rows[0]).toEqual({ n: 800, total: 800 * 3000 });
  });
});
