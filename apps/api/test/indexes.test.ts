import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { AuthSession } from '@xiro/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { runMigrations } from '../src/db/migrate';
import type { Notifier } from '../src/notifier';
import { createTestDatabase, testAppConfig, type TestDatabase } from './helpers/db';

/**
 * Índices de las consultas calientes (Fase 2, punto 10), medidos con EXPLAIN ANALYZE sobre datos realistas: un negocio
 * con 20.000 clientes y 5.000 artículos, y "ruido" de otros negocios (50.000 clientes, 45.000 artículos) — el
 * aislamiento multi-negocio cambia los planes. Las consultas son las mismas que arma la API (mismos filtros y orden).
 *
 *   EXPLAIN_REPORT=1 npx vitest run test/indexes.test.ts   → imprime plan y tiempo de cada consulta.
 *
 * Además es una prueba de regresión: exige que cada consulta use su índice, y que la migración 0024 se pueda revertir y
 * volver a aplicar sin cambiar ni un resultado de búsqueda.
 */
const report = process.env.EXPLAIN_REPORT === '1';
let app: FastifyInstance;
let testDb: TestDatabase;
let cleanup: () => void;
let session: AuthSession;
let target: string;
const notifier: Notifier = { sendOtp: async () => undefined, sendAppointmentReminder: async () => undefined };
const FOLD = `'áàâäãéèêëíìîïóòôöõúùûüñç', 'aaaaaeeeeiiiiooooouuuunc'`;

async function register(n: number): Promise<AuthSession> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { name: 'Dueña', businessName: `Índices ${n}`, businessType: 'beauty_salon', email: `idx${n}@correo.com`, password: 'Secreta123', acceptTerms: true, language: 'es' } });
  expect(res.statusCode).toBe(201);
  return res.json<AuthSession>();
}

async function seed(businessId: string, clients: number, items: number, tag: string) {
  const pool = testDb.pool;
  await pool.query(
    `insert into clients (business_id, name, email, phone, created_at)
     select $1, initcap(n.first) || ' ' || initcap(n.last) || ' ' || g, case when g % 5 = 0 then null else lower(n.first) || g || '@correo.com' end,
            case when g % 7 = 0 then null else '57300' || lpad(g::text, 7, '0') end, now() - (g || ' minutes')::interval
     from generate_series(1, $2::int) g
     cross join lateral (select (array['valentina','mateo','sofía','santiago','camila','andrés','lucía','juan'])[1 + g % 8] as first,
                                (array['rojas','gómez','pérez','díaz','martínez','lópez','garcía','torres'])[1 + (g / 8) % 8] as last) n`,
    [businessId, clients],
  );
  // Los artículos se reparten entre las categorías del negocio (la búsqueda también encuentra por categoría).
  const { rows } = await pool.query<{ ids: string[] }>('select array_agg(id order by name) as ids from categories where business_id = $1', [businessId]);
  await pool.query(
    `insert into items (business_id, category_id, name, reference_code, price, stock, stock_status, kind, kind_confirmed, updated_at)
     select $1, ($2::uuid[])[1 + g % cardinality($2::uuid[])], (array['Corte','Peluquería','Tinte','Champú','Cera','Manicure','Pedicure','Barba'])[1 + g % 8] || ' ${tag} ' || g,
            case when g % 3 = 0 then 'REF-' || g else '' end, 10000 + g, g % 30,
            case when g % 30 = 0 then 'out_of_stock' when g % 30 <= 5 then 'reorder' else 'available' end,
            case when g % 2 = 0 then 'service' else 'product' end, true, now() - (g || ' seconds')::interval
     from generate_series(1, $3::int) g`,
    [businessId, rows[0]!.ids, items],
  );
}

beforeAll(async () => {
  testDb = await createTestDatabase();
  const created = testAppConfig();
  cleanup = created.cleanup;
  app = await buildApp({ db: testDb.db, notifier, config: created.config });
  session = await register(1);
  target = session.business.id;
  await seed(target, 20_000, 5_000, 'principal');
  for (let i = 2; i <= 4; i += 1) await seed((await register(i)).business.id, 16_667, 15_000, `ruido${i}`);
  await testDb.pool.query('analyze');
}, 180_000);

afterAll(async () => {
  await app.close();
  cleanup();
  await testDb.drop();
});

/** Ejecuta EXPLAIN ANALYZE y devuelve el plan en texto y el tiempo de ejecución (ms). */
async function explain(sql: string, params: unknown[]): Promise<{ plan: string; ms: number }> {
  const { rows } = await testDb.pool.query<{ 'QUERY PLAN': string }>(`explain (analyze, buffers, costs off, timing on) ${sql}`, params);
  const plan = rows.map((row) => row['QUERY PLAN']).join('\n');
  const ms = Number(/Execution Time: ([\d.]+) ms/.exec(plan)?.[1] ?? NaN);
  return { plan, ms };
}

// Mismas condiciones que GET /clients y GET /items (ver src/db/search.ts).
const CLIENT_SEARCH = `select id from clients where business_id = $1 and is_occasional = false
  and (name || ' ' || coalesce(email, '') || ' ' || coalesce(phone, '')) ilike $2 and (name ilike $2 or email ilike $2 or phone ilike $2)
  order by lower(name), id limit 51`;
const ITEM_SEARCH = `select i.id from items i join categories c on c.id = i.category_id where i.business_id = $1
  and i.id in (select m.id from items m where m.business_id = $1 and translate(lower(m.name || ' ' || m.reference_code), ${FOLD}) ilike $2
                 and (translate(lower(m.name), ${FOLD}) ilike $2 or translate(lower(m.reference_code), ${FOLD}) ilike $2)
               union all
               select m.id from items m where m.business_id = $1 and m.category_id = any(array(select id from categories where business_id = $1 and translate(lower(name), ${FOLD}) ilike $2)))
  order by i.updated_at desc nulls last, i.name, i.id limit 51`;

const QUERIES = {
  'clientes: búsqueda concreta "%19993%" (nombre/correo/teléfono)': { sql: CLIENT_SEARCH, params: () => [target, '%19993%'], index: /clients_search_trgm_idx/ },
  'clientes: búsqueda sin resultados "%zzqx%" (peor caso)': { sql: CLIENT_SEARCH, params: () => [target, '%zzqx%'], index: /clients_search_trgm_idx/ },
  'clientes: recientes (actividad del Inicio)': {
    sql: `select id from clients where business_id = $1 and is_occasional = false order by created_at desc, id desc limit 51`,
    params: () => [target],
    index: /clients_business_created_idx/,
  },
  'clientes: por teléfono (deduplicar en cada reserva)': {
    sql: `select id from clients where business_id = $1 and phone = $2 limit 1`,
    params: () => [target, '573000012345'],
    index: /clients_business_phone_idx/,
  },
  'artículos: búsqueda sin tildes "%peluqueria principal 49%"': { sql: ITEM_SEARCH, params: () => [target, '%peluqueria principal 49%'], index: /items_search_trgm_idx/ },
  'artículos: búsqueda sin resultados "%zzqx%" (peor caso)': { sql: ITEM_SEARCH, params: () => [target, '%zzqx%'], index: /items_search_trgm_idx/ },
  'clientes: nuevos de hoy (resumen)': {
    sql: `select count(*) from clients where business_id = $1 and is_occasional = false and created_at >= now() - interval '1 day'`,
    params: () => [target],
    index: /clients_business_created_idx/,
  },
} as const;

describe('índices de las consultas calientes (EXPLAIN ANALYZE)', () => {
  const results: Array<{ name: string; ms: number; usesIndex: boolean }> = [];
  afterAll(() => {
    if (report) console.table(results.map((r) => ({ consulta: r.name, 'ms (ejecución)': r.ms, 'usa su índice': r.usesIndex })));
  });

  for (const [name, query] of Object.entries(QUERIES)) {
    it(name, async () => {
      // Se repite para medir en caliente (la primera ejecución carga páginas en memoria).
      await explain(query.sql, query.params());
      const { plan, ms } = await explain(query.sql, query.params());
      const usesIndex = query.index.test(plan);
      results.push({ name, ms, usesIndex });
      if (report) console.log(`\n=== ${name} (${ms} ms)\n${plan}`);
      if (!report) expect(usesIndex, plan).toBe(true);
    });
  }
});

describe('migración 0024: reversible y sin cambiar resultados', () => {
  const INDEXES = ['clients_search_trgm_idx', 'clients_business_created_idx', 'clients_business_phone_idx', 'items_search_trgm_idx', 'loyalty_redemptions_business_idx'];
  const SEARCHES = [
    '/api/clients?q=19993', '/api/clients?q=VALENTINA%20R', '/api/clients?q=sof%C3%ADa', '/api/clients?q=%40correo', '/api/clients?q=5730000123', '/api/clients?q=zzqx',
    '/api/clients?q=100%25', '/api/clients?q=a_b', '/api/clients?q=juan&sort=recent',
    '/api/items?q=peluqueria%20principal%2049', '/api/items?q=PELUQUER%C3%8DA', '/api/items?q=ref-49', '/api/items?q=servicios', '/api/items?q=tratamient', '/api/items?q=zzqx', '/api/items?q=50%25',
    '/api/loyalty/clients?q=mateo', '/api/loyalty/clients?q=57300000',
  ];

  async function snapshot(): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    for (const url of SEARCHES) {
      const res = await app.inject({ method: 'GET', url: `${url}&limit=100`, headers: { authorization: `Bearer ${session.accessToken}` } });
      expect(res.statusCode, url).toBe(200);
      const page = res.json<{ data: Array<{ id?: string; clientId?: string }>; nextCursor: string | null }>();
      out[url] = { ids: page.data.map((row) => row.id ?? row.clientId), more: page.nextCursor !== null };
    }
    return out;
  }
  const existing = async () => (await testDb.pool.query<{ indexname: string }>('select indexname from pg_indexes where indexname = any($1) order by indexname', [INDEXES])).rows.map((r) => r.indexname);
  const counts = async () => (await testDb.pool.query('select (select count(*) from clients) as clients, (select count(*) from items) as items')).rows[0];

  it('la forma nueva de la búsqueda (candidatos por índice + condición exacta) devuelve lo mismo que la anterior', async () => {
    const OLD_CLIENTS = `select id from clients where business_id = $1 and is_occasional = false and (name ilike $2 or email ilike $2 or phone ilike $2) order by lower(name), id`;
    const OLD_ITEMS = `select i.id from items i join categories c on c.id = i.category_id where i.business_id = $1
      and (translate(lower(i.name), ${FOLD}) ilike $2 or translate(lower(i.reference_code), ${FOLD}) ilike $2 or translate(lower(c.name), ${FOLD}) ilike $2)
      order by i.updated_at desc nulls last, i.name, i.id`;
    const all = (sql: string) => sql.replace(/ limit 51$/, '');
    const ids = async (sql: string, term: string) => (await testDb.pool.query<{ id: string }>(sql, [target, term])).rows.map((r) => r.id);
    // Incluye términos que cruzarían de un campo a otro en el texto unido ("rojas 1 valentina", "1@correo.com 57300"):
    // la condición exacta los descarta, igual que antes.
    for (const term of ['%19993%', '%valentina r%', '%sofía%', '%@correo.com 5730%', '%rojas 1 valentina%', '%3000001%', '%zzqx%', '% %']) {
      expect(await ids(all(CLIENT_SEARCH), term), term).toEqual(await ids(OLD_CLIENTS, term));
    }
    for (const term of ['%peluqueria principal 49%', '%ref-4%', '%servicios%', '%productos%', '%principal 1 ref%', '%zzqx%', '%corte%']) {
      expect(await ids(all(ITEM_SEARCH), term), term).toEqual(await ids(OLD_ITEMS, term));
    }
    // Y la API real (no solo el SQL de esta prueba) devuelve la primera página igual que la consulta anterior.
    const api = async (url: string) => (await app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${session.accessToken}` } })).json<{ data: Array<{ id: string }> }>().data.map((row) => row.id);
    for (const term of ['19993', 'valentina r', 'rojas 1 valentina', '@correo.com 5730']) {
      expect(await api(`/api/clients?limit=100&q=${encodeURIComponent(term)}`), term).toEqual((await ids(OLD_CLIENTS, `%${term}%`)).slice(0, 100));
    }
    for (const [query, term] of [['Peluquería principal 49', 'peluqueria principal 49'], ['ref-4', 'ref-4'], ['SERVICIOS', 'servicios'], ['principal 1 ref', 'principal 1 ref']]) {
      expect(await api(`/api/items?limit=100&q=${encodeURIComponent(query!)}`), query).toEqual((await ids(OLD_ITEMS, `%${term}%`)).slice(0, 100));
    }
  }, 120_000);

  it('revertir quita solo los índices y reaplicar los recrea; la API responde igual en los tres estados', async () => {
    const before = await snapshot();
    // Al menos algunas búsquedas encuentran algo (si todas vinieran vacías la comparación no probaría nada).
    expect(Object.values(before).filter((r) => (r as { ids: unknown[] }).ids.length > 0).length).toBeGreaterThan(8);
    expect(await existing()).toEqual([...INDEXES].sort());
    const dataBefore = await counts();

    // Las reversiones van en ORDEN INVERSO: el migrador solo aplica lo posterior a la ÚLTIMA migración registrada, así que
    // para revertir 0024 primero se revierte lo que vino después, de la más nueva a la más vieja (0030 lista de espera, 0029 códigos, 0028 opciones de la Fase 4, 0027 especialidad, 0026 marca, 0025 pedidos).
    await testDb.pool.query(readFileSync(path.join(__dirname, '../drizzle/rollback/0030_waitlist.down.sql'), 'utf8'));
    await testDb.pool.query(readFileSync(path.join(__dirname, '../drizzle/rollback/0029_discount_codes.down.sql'), 'utf8'));
    await testDb.pool.query(readFileSync(path.join(__dirname, '../drizzle/rollback/0028_phase4_feature_flags.down.sql'), 'utf8'));
    await testDb.pool.query(readFileSync(path.join(__dirname, '../drizzle/rollback/0027_professional_specialty.down.sql'), 'utf8'));
    await testDb.pool.query(readFileSync(path.join(__dirname, '../drizzle/rollback/0026_business_branding.down.sql'), 'utf8'));
    await testDb.pool.query(readFileSync(path.join(__dirname, '../drizzle/rollback/0025_product_orders.down.sql'), 'utf8'));
    await testDb.pool.query(readFileSync(path.join(__dirname, '../drizzle/rollback/0024_search_and_tenant_indexes.down.sql'), 'utf8'));
    expect(await existing()).toEqual([]);
    expect(await counts()).toEqual(dataBefore);
    expect(await snapshot()).toEqual(before);

    await runMigrations(testDb);
    expect(await existing()).toEqual([...INDEXES].sort());
    expect(await snapshot()).toEqual(before);
  }, 120_000);
});
