import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { POLICY } from '../src/authz';
import { appointments, reviews } from '../src/db/schema';
import { auth, book, createEmployee, createService, firstCategoryId, nextPhone, at, setupBiz, workday, type Biz } from './helpers/booking';
import { createTestDatabase, testAppConfig, type TestDatabase } from './helpers/db';

/**
 * BOLA/IDOR exhaustivo (Fase 3, OWASP API1): el dueño del negocio A llama a TODAS las rutas autenticadas de la política
 * (authz.ts, que es la lista completa: una ruta sin política no arranca) con TODOS los ids del negocio B en la ruta,
 * en la consulta y en el cuerpo. Se exige:
 *   1. ninguna respuesta filtra datos de B (ni sus textos marcados ni sus ids) y ninguna es 2xx ni 5xx con ids de B;
 *   2. al terminar, TODAS las filas de B están idénticas (nada se modificó ni borró);
 *   3. ninguna fila de A quedó apuntando a algo de B (referencias cruzadas por el cuerpo);
 *   4. control: el mismo cuerpo con los ids PROPIOS de A sí funciona (si no, el 404 de arriba no probaría nada).
 * Una ruta nueva entra sola en el barrido; si es de escritura con id y no tiene cuerpo aquí, la prueba lo exige.
 */
const MARK = 'VICTIMA';
let app: FastifyInstance;
let testDb: TestDatabase;
let cleanup: () => void;

interface Seeded {
  biz: Biz;
  categoryId: string;
  productId: string;
  clientId: string;
  employee: Awaited<ReturnType<typeof createEmployee>>;
  galleryFile: string;
}

const png = () => sharp({ create: { width: 12, height: 12, channels: 3, background: '#3366ff' } }).png().toBuffer();
async function multipart(file: Buffer) {
  const data = new FormData();
  data.append('photo', new Blob([new Uint8Array(file)], { type: 'image/png' }), 'foto.png');
  const response = new Response(data);
  return { payload: Buffer.from(await response.arrayBuffer()), contentType: response.headers.get('content-type')! };
}
const send = (token: { accessToken: string }, method: string, url: string, payload?: unknown) =>
  app.inject({ method: method as 'GET', url, headers: auth(token), ...(payload === undefined ? {} : { payload: payload as object }) });

/** Un negocio con datos en (casi) todas las tablas, creados por la API como lo haría la app. */
async function seed(label: string): Promise<Seeded> {
  const biz = await setupBiz(app, `${label} Negocio`);
  const s = biz.session;
  const ok = async (res: Awaited<ReturnType<typeof send>>, what: string) => {
    expect(res.statusCode, `${what}: ${res.body}`).toBeLessThan(300);
    return res.json<{ id: string }>();
  };
  const categoryId = await firstCategoryId(app, s);
  await ok(await send(s, 'POST', '/api/categories', { name: `Cat ${label}` }), 'categoría');
  const product = await ok(await send(s, 'POST', '/api/items', { name: `Champú ${label}`, categoryId, price: 20000, kind: 'product', stock: 10 }), 'producto');
  await createService(app, s, { name: `Barba ${label}` });
  const client = await ok(await send(s, 'POST', '/api/clients', { name: `Cliente ${label}`, phone: nextPhone(), email: `${label.toLowerCase()}@correo.com`, notes: `Nota ${label}` }), 'cliente');
  const photo = await multipart(await png());
  await ok(await app.inject({ method: 'POST', url: `/api/items/${product.id}/photos`, headers: { ...auth(s), 'content-type': photo.contentType }, payload: photo.payload }), 'foto de artículo');
  const gallery = await multipart(await png());
  const galleryRes = await app.inject({ method: 'POST', url: '/api/booking/profile/gallery', headers: { ...auth(s), 'content-type': gallery.contentType }, payload: gallery.payload });
  expect(galleryRes.statusCode, galleryRes.body).toBe(201);
  const galleryFile = String(JSON.stringify(galleryRes.json()).match(/[0-9a-f-]{36}\.(png|webp|jpg)/)![0]);
  await ok(await send(s, 'POST', `/api/items/${biz.serviceId}/variants`, { name: `Fade ${label}`, price: 40000 }), 'variante');
  await ok(await send(s, 'POST', '/api/packages', { name: `Combo ${label}`, price: 50000, entries: [{ itemId: biz.serviceId }] }), 'paquete');
  await ok(await send(s, 'POST', '/api/sales', { clientId: client.id, lines: [{ kind: 'service', itemId: biz.serviceId }], payments: [{ method: 'cash', amount: 30000 }] }), 'venta');
  await ok(await send(s, 'POST', '/api/service-records', { clientId: client.id, itemId: biz.serviceId }), 'registro de servicio');
  await ok(await send(s, 'POST', '/api/booking/closures', { date: workday(20), reason: `Cierre ${label}` }), 'cierre');
  await ok(await send(s, 'POST', `/api/professionals/${biz.ownerId}/time-off`, { startsAt: at(workday(9), '09:00'), endsAt: at(workday(9), '10:00'), reason: `Libre ${label}` }), 'tiempo libre');
  await ok(await send(s, 'POST', '/api/cash/opening', { amount: 100000, note: `Base ${label}` }), 'apertura de caja');
  await ok(await send(s, 'POST', '/api/expenses', { amount: 5000, description: `Gasto ${label}`, method: 'cash' }), 'gasto');
  const employee = await createEmployee(app, s, ['clients_view']);
  const conversation = await ok(await send(s, 'POST', '/api/messages/conversations', { userId: employee.employee.id }), 'conversación');
  await ok(await send(s, 'POST', `/api/messages/conversations/${conversation.id}/messages`, { content: `Hola ${label}` }), 'mensaje');
  await ok(await send(s, 'POST', '/api/notifications/register', { platform: 'expo', token: `ExponentPushToken[${label}]` }), 'push');
  // Cita pública → completada (genera notificación, eventos, progreso de fidelización) → reseña.
  const booked = await book(app, biz, workday(2), '10:00', { customer: { firstName: 'Ana', lastName: label, email: `ana.${label.toLowerCase()}@correo.com`, phone: nextPhone(), notes: `Cita ${label}`, custom: {} } });
  expect(booked.statusCode, booked.body).toBe(201);
  const [appt] = await testDb.db.select({ id: appointments.id }).from(appointments).where(eqBusiness(biz)).limit(1);
  await send(s, 'POST', `/api/appointments/${appt!.id}/status`, { status: 'completed' });
  await testDb.db.insert(reviews).values({ businessId: biz.session.business.id, appointmentId: appt!.id, rating: 5, comment: `Reseña ${label}`, authorName: `Autor ${label}` });
  await ok(await send(s, 'POST', '/api/cash/close', { day: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date()), /* día del negocio, no UTC */ countedAmount: 95000, note: `Cierre caja ${label}` }), 'cierre de caja');
  return { biz, categoryId, productId: product.id, clientId: client.id, employee, galleryFile };
}
const eqBusiness = (biz: Biz) => eq(appointments.businessId, biz.session.business.id);

/** Tablas con business_id (se descubren en la base, así una tabla nueva entra sola). */
async function tenantTables(): Promise<string[]> {
  const { rows } = await testDb.pool.query<{ table_name: string }>(
    `select table_name from information_schema.columns where table_schema = 'public' and column_name = 'business_id' order by table_name`,
  );
  return rows.map((r) => r.table_name);
}
/** Tablas sin business_id: pertenecen a un negocio a través de su padre (fotos → artículo, tokens → usuario…). */
const CHILDREN: Record<string, string> = {
  item_photos: 'item_id in (select id from items where business_id = $1)',
  loyalty_program_items: 'program_id in (select id from loyalty_programs where business_id = $1)',
  refresh_tokens: 'user_id in (select id from users where business_id = $1)',
  reset_tokens: 'user_id in (select id from users where business_id = $1)',
  otp_codes: 'user_id in (select id from users where business_id = $1)',
  phone_changes: 'user_id in (select id from users where business_id = $1)',
  client_sessions: 'account_id in (select id from client_accounts where business_id = $1)',
  client_reset_tokens: 'account_id in (select id from client_accounts where business_id = $1)',
  client_recovery_codes: 'account_id in (select id from client_accounts where business_id = $1)',
};
const ownedBy = async (): Promise<Array<[string, string]>> => [
  ...(await tenantTables()).map((t): [string, string] => [t, 'business_id = $1']),
  ['businesses', 'id = $1'],
  ...Object.entries(CHILDREN),
];

/** Huella de TODAS las filas de un negocio (más su fila en businesses y las de sus tablas hijas). */
async function fingerprint(businessId: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [table, where] of await ownedBy()) {
    const { rows } = await testDb.pool.query<{ n: number; h: string | null }>(`select count(*)::int as n, md5(string_agg(t::text, '|' order by t::text)) as h from "${table}" t where ${where}`, [businessId]);
    out[table] = `${rows[0]!.n}:${rows[0]!.h}`;
  }
  return out;
}
/** Todos los uuid de las filas de un negocio (cualquier columna). */
async function allIds(businessId: string): Promise<string[]> {
  const ids = new Set<string>([businessId]);
  for (const [table, where] of await ownedBy()) {
    const { rows } = await testDb.pool.query<{ t: string }>(`select t::text as t from "${table}" t where ${where}`, [businessId]);
    for (const row of rows) for (const id of row.t.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? []) ids.add(id);
  }
  return [...ids];
}

const DAY = () => workday(4);
const isoDay = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

/**
 * Consulta VÁLIDA de cada lectura que recibe ids en la consulta, armada con los ids de un negocio. Con los de A es el
 * control (debe responder 2xx); con los de B es el ataque. Sin esto, una consulta mal formada daría 400 y la ruta no
 * llegaría a probarse de verdad.
 */
function queryFor(key: string, s: Seeded): Record<string, string> {
  const client = s.clientId;
  const professional = s.biz.ownerId;
  const service = s.biz.serviceId;
  switch (key) {
    case 'GET /cash/openings':
    case 'GET /expenses':
    case 'GET /cash/closings':
      return { from: isoDay(-30), to: isoDay(1) };
    case 'GET /cash/close-summary':
      return { day: isoDay(0) };
    case 'GET /sales':
      return { from: `${isoDay(-30)}T00:00:00.000Z`, to: `${isoDay(1)}T00:00:00.000Z` };
    case 'GET /service-records':
    case 'GET /service-records/summary':
      return { clientId: client };
    case 'GET /service-records/by-client':
      return { clientIds: client };
    case 'GET /appointments':
      return { from: `${isoDay(-1)}T00:00:00.000Z`, to: `${isoDay(20)}T00:00:00.000Z`, professionalId: professional };
    case 'GET /booking/availability':
      return { date: DAY(), services: service, professionalId: professional };
    case 'GET /booking/days':
      return { from: DAY(), days: '7', services: service, professionalId: professional };
    case 'GET /booking/slug/check':
      return { slug: 'una-direccion-libre' };
    case 'GET /audit-logs':
      return { userId: s.employee.employee.id };
    default:
      return {};
  }
}
/** Proxies de Google Maps: sin datos del negocio y sin clave en las pruebas (no aplican). */
const EXTERNAL = new Set(['GET /booking/places/autocomplete', 'GET /booking/places/details', 'GET /booking/places/reverse', 'GET /booking/places/static-map']);
/** Cuerpo válido de cada escritura con id en la ruta (se usa contra B y, como control, contra A). */
const BODIES: Record<string, (a: Seeded) => unknown> = {
  'PATCH /categories/:id': () => ({ name: 'Cambiada' }),
  'PUT /items/:id': (a) => ({ name: 'Cambiado', categoryId: a.categoryId, price: 1000, kind: 'service', durationMinutes: 30 }),
  'POST /items/:id/stock-adjustments': () => ({ delta: 1 }),
  'POST /items/:id/photos/:photoId/primary': () => ({}),
  'PUT /clients/:id': () => ({ name: 'Cambiado' }),
  'POST /clients/:id/anonymize': () => ({}),
  'POST /clients/:id/reset-password': () => ({}),
  'POST /sales/:id/void': () => ({ reason: 'prueba' }),
  'POST /cash/closings/:id/void': () => ({ reason: 'prueba' }),
  'POST /loyalty/clients/:clientId/redeem': () => ({}),
  'POST /notifications/:id/read': () => ({}),
  'PATCH /appointments/:id': () => ({ internalNotes: 'cambio' }),
  'POST /appointments/:id/status': () => ({ status: 'cancelled', reason: 'prueba' }),
  'PATCH /professionals/:id': () => ({ bio: 'cambio' }),
  'PUT /professionals/:id/schedule': () => ({ blocks: [] }),
  'PUT /professionals/:id/services': () => ({ services: [] }),
  'POST /professionals/:id/time-off': () => ({ startsAt: at(DAY(), '15:00'), endsAt: at(DAY(), '16:00') }),
  'POST /items/:id/variants': () => ({ name: 'Nueva', price: 1 }),
  'PUT /variants/:id': () => ({ name: 'Cambiada', price: 1 }),
  'PUT /packages/:id': (a) => ({ name: 'Cambiado', price: 1, entries: [{ itemId: a.biz.serviceId }] }),
  'PATCH /booking/reviews/:id': () => ({ status: 'hidden' }),
  'PATCH /employees/:id': () => ({ name: 'Cambiado' }),
  'POST /messages/conversations/:id/messages': () => ({ content: 'hola' }),
  'POST /messages/conversations/:id/read': () => ({}),
};
/** Rutas que reciben una foto (multipart). */
const MULTIPART = new Set(['PUT /clients/:id/photo', 'PUT /professionals/:id/photo', 'PUT /employees/:id/photo', 'POST /items/:id/photos']);

let A: Seeded;
let B: Seeded;
let bIds: string[];
let bFingerprint: Record<string, string>;
const findings: string[] = [];

beforeAll(async () => {
  testDb = await createTestDatabase();
  const created = testAppConfig();
  cleanup = created.cleanup;
  app = await buildApp({ db: testDb.db, notifier: { sendOtp: async () => undefined, sendAppointmentReminder: async () => undefined }, config: created.config });
  A = await seed('ATACANTE');
  B = await seed(MARK);
  bIds = await allIds(B.biz.session.business.id);
  bFingerprint = await fingerprint(B.biz.session.business.id);
}, 240_000);
afterAll(async () => {
  await app.close();
  cleanup();
  await testDb.drop();
});

/** Revisa una respuesta del atacante: nunca 5xx, nunca datos de B; con ids de B en la ruta, nunca 2xx. */
function inspect(label: string, res: { statusCode: number; body: string }, targetsB: boolean) {
  if (res.statusCode >= 500) findings.push(`${label} → ${res.statusCode} ${res.body.slice(0, 160)}`);
  if (targetsB && res.statusCode < 300) findings.push(`${label} → ${res.statusCode} (aceptó un id de otro negocio)`);
  if (res.body.includes(MARK)) findings.push(`${label} → la respuesta contiene datos de B`);
  const leaked = bIds.find((id) => res.body.includes(id) && !label.includes(id));
  if (leaked) findings.push(`${label} → la respuesta contiene el id ${leaked} de B`);
}

async function attack(method: string, url: string, key: string, targetsB: boolean) {
  if (MULTIPART.has(key)) {
    const form = await multipart(await png());
    return app.inject({ method: method as 'PUT', url, headers: { ...auth(A.biz.session), 'content-type': form.contentType }, payload: form.payload }).then((res) => inspect(`${method} ${url}`, res, targetsB));
  }
  const body = ['GET', 'DELETE'].includes(method) ? undefined : (BODIES[key]?.(A) ?? {});
  return send(A.biz.session, method, url, body).then((res) => inspect(`${method} ${url}`, res, targetsB));
}

describe('aislamiento multi-negocio (BOLA/IDOR) en todas las rutas autenticadas', () => {
  const routes = Object.keys(POLICY).map((key) => {
    const [method, path] = key.split(' ') as [string, string];
    return { key, method, path, params: [...path.matchAll(/:(\w+)/g)].map((m) => m[1]!) };
  });

  it('toda escritura con id en la ruta tiene un cuerpo válido definido aquí (para que el barrido la pruebe de verdad)', () => {
    const missing = routes.filter((r) => r.params.length > 0 && !['GET', 'DELETE'].includes(r.method) && !BODIES[r.key] && !MULTIPART.has(r.key)).map((r) => r.key);
    expect(missing).toEqual([]);
  });

  it('con ids de B en la ruta: nada se lee, cambia ni borra', async () => {
    for (const route of routes.filter((r) => r.params.length > 0)) {
      const values = route.params.includes('file') ? [B.galleryFile] : bIds;
      if (route.params.length === 1) {
        for (const id of values) await attack(route.method, `/api${route.path.replace(/:\w+/, id)}`, route.key, true);
      } else {
        // Dos parámetros (artículo + foto): todas las combinaciones de ids de B, y B con lo propio de A.
        for (const first of [...values, A.productId]) for (const second of values) await attack(route.method, `/api${route.path.replace(/:\w+/, first).replace(/:\w+/, second)}`, route.key, true);
      }
    }
    expect(findings).toEqual([]);
  }, 300_000);

  it('con ids de B en la consulta (?clientId=…): las listas nunca devuelven datos de B', async () => {
    const lists = routes.filter((r) => r.method === 'GET' && r.params.length === 0 && !EXTERNAL.has(r.key));
    for (const route of lists) {
      // 1) La consulta válida de la ruta con los ids de B (cliente, profesional, servicio, empleado de B).
      const typed = queryFor(route.key, B);
      if (Object.keys(typed).length > 0) await attack('GET', `/api${route.path}?${new URLSearchParams(typed)}`, route.key, false);
      // 2) Cada id de B en todos los nombres de parámetro habituales.
      for (const id of bIds) {
        const query = new URLSearchParams({ from: '2020-01-01T00:00:00.000Z', to: '2035-01-01T00:00:00.000Z', clientId: id, professionalId: id, itemId: id, categoryId: id, id, date: DAY(), services: id });
        await attack('GET', `/api${route.path}?${query}`, route.key, false);
      }
    }
    expect(findings).toEqual([]);
  }, 300_000);

  it('con ids de B dentro del cuerpo: no se crean referencias a otro negocio', async () => {
    const bService = B.biz.serviceId;
    const cases: Array<[string, string, unknown]> = [
      ['POST', '/api/sales', { lines: [{ kind: 'service', itemId: bService }], payments: [{ method: 'cash', amount: 30000 }] }],
      ['POST', '/api/sales', { clientId: B.clientId, lines: [{ kind: 'service', itemId: A.biz.serviceId }], payments: [{ method: 'cash', amount: 30000 }] }],
      ['POST', '/api/sales', { lines: [{ kind: 'product', itemId: B.productId }], payments: [{ method: 'cash', amount: 20000 }] }],
      ['POST', '/api/service-records', { clientId: B.clientId, itemId: A.biz.serviceId }],
      ['POST', '/api/service-records', { clientId: A.clientId, itemId: bService }],
      ['POST', '/api/packages', { name: 'x', price: 1, entries: [{ itemId: bService }] }],
      ['POST', '/api/items', { name: 'x', categoryId: B.categoryId, price: 1, kind: 'service', durationMinutes: 30 }],
      ['POST', '/api/items/bulk-publish', { ids: [bService, B.productId], published: false }],
      ['POST', '/api/items/classification', { entries: [{ itemId: bService, kind: 'product' }] }],
      ['POST', '/api/messages/conversations', { userId: B.biz.ownerId }],
      ['POST', '/api/messages/conversations', { userId: B.employee.employee.id }],
      ['POST', '/api/appointments', { professionalId: B.biz.ownerId, startsAt: at(DAY(), '11:00'), selection: { services: [{ itemId: A.biz.serviceId }], packages: [], products: [] }, newClient: { name: 'x', phone: nextPhone() } }],
      ['POST', '/api/appointments', { professionalId: A.biz.ownerId, startsAt: at(DAY(), '12:00'), selection: { services: [{ itemId: bService }], packages: [], products: [] }, newClient: { name: 'x', phone: nextPhone() } }],
      ['POST', '/api/appointments', { professionalId: A.biz.ownerId, startsAt: at(DAY(), '13:00'), selection: { services: [{ itemId: A.biz.serviceId }], packages: [], products: [] }, clientId: B.clientId }],
      ['PUT', `/api/professionals/${A.biz.ownerId}/services`, { services: [{ itemId: bService }] }],
      ['PUT', '/api/loyalty/program', { enabled: true, goal: 5, itemIds: [bService] }],
      // Un id que no existe en ningún negocio: 404, no un 500 por la llave foránea (y sin distinguir si existe en otro).
      ['PUT', '/api/loyalty/program', { enabled: true, goal: 5, itemIds: ['00000000-0000-4000-8000-000000000000'] }],
      ['PATCH', `/api/appointments/${(await firstAppointment(A))}`, { professionalId: B.biz.ownerId }],
    ];
    for (const [method, url, body] of cases) {
      const res = await send(A.biz.session, method, url, body);
      inspect(`${method} ${url} ${JSON.stringify(body)}`, res, false);
    }
    // Ninguna fila de A apunta a un id de B.
    const aIds = new Set(await allIds(A.biz.session.business.id));
    const crossed: string[] = [];
    for (const id of bIds.filter((bId) => aIds.has(bId))) {
      for (const [table, where] of await ownedBy()) {
        const { rows } = await testDb.pool.query<{ t: string }>(`select t::text as t from "${table}" t where ${where} and t::text like '%' || $2 || '%'`, [A.biz.session.business.id, id]);
        for (const row of rows) crossed.push(`${table}: ${row.t.slice(0, 200)} (id de B ${id})`);
      }
    }
    expect(crossed, 'filas de A que referencian ids de B').toEqual([]);
    expect(findings).toEqual([]);
  }, 120_000);

  it('B quedó intacto: todas sus filas, sin excepción', async () => {
    expect(await fingerprint(B.biz.session.business.id)).toEqual(bFingerprint);
  });

  it('control: con los ids PROPIOS de A esas mismas escrituras sí funcionan (el 404 de arriba no era un error de validación)', async () => {
    const own = async (table: string, extra = '') =>
      (await testDb.pool.query<{ id: string }>(`select id from "${table}" where business_id = $1 ${extra} limit 1`, [A.biz.session.business.id])).rows[0]!.id;
    const a = A.biz.session.business.id;
    const conversation = await own('conversations');
    const ids: Record<string, string> = {
      'PATCH /categories/:id': await own('categories'),
      'PUT /items/:id': A.biz.serviceId,
      'POST /items/:id/stock-adjustments': A.productId,
      'PUT /clients/:id': A.clientId,
      'POST /sales/:id/void': await own('sales', "and status = 'completed'"),
      'POST /cash/closings/:id/void': await own('cash_closings'),
      'POST /notifications/:id/read': (await testDb.pool.query<{ id: string }>('select id from notifications where business_id = $1 and user_id = $2 limit 1', [a, A.biz.ownerId])).rows[0]?.id ?? '',
      'PATCH /appointments/:id': await firstAppointment(A),
      'PATCH /professionals/:id': A.biz.ownerId,
      'PUT /professionals/:id/services': A.biz.ownerId,
      'POST /professionals/:id/time-off': A.biz.ownerId,
      'POST /items/:id/variants': A.biz.serviceId,
      'PUT /variants/:id': await own('service_variants'),
      'PUT /packages/:id': await own('service_packages'),
      'PATCH /booking/reviews/:id': await own('reviews'),
      'PATCH /employees/:id': A.employee.employee.id,
      'POST /messages/conversations/:id/messages': conversation,
      'POST /messages/conversations/:id/read': conversation,
    };
    const failures: string[] = [];
    for (const [key, id] of Object.entries(ids)) {
      if (!id) continue;
      const [method, path] = key.split(' ') as [string, string];
      const res = await send(A.biz.session, method, `/api${path.replace(/:\w+/, id)}`, BODIES[key]!(A));
      if (res.statusCode >= 300) failures.push(`${key} → ${res.statusCode} ${res.body.slice(0, 160)}`);
    }
    const photo = (await testDb.pool.query<{ id: string }>('select id from item_photos where item_id = $1 limit 1', [A.productId])).rows[0]!.id;
    const primary = await send(A.biz.session, 'POST', `/api/items/${A.productId}/photos/${photo}/primary`, {});
    if (primary.statusCode >= 300) failures.push(`foto principal → ${primary.statusCode} ${primary.body.slice(0, 160)}`);
    expect(failures).toEqual([]);
  }, 120_000);
});

async function firstAppointment(s: Seeded): Promise<string> {
  const [row] = await testDb.db.select({ id: appointments.id }).from(appointments).where(eqBusiness(s.biz)).limit(1);
  return row!.id;
}

/**
 * Exposición excesiva de datos (OWASP API3): ninguna respuesta de lectura —privada o pública— lleva hashes,
 * contraseñas, secretos, códigos OTP ni tokens. Se revisan los NOMBRES de todos los campos, en cualquier nivel.
 */
describe('las respuestas nunca exponen campos sensibles', () => {
  const SENSITIVE = /(password|hash|secret|salt|otp|^code$|token|apikey|api_key|private)/i;
  // Campos públicos por diseño: la clave pública VAPID (para notificaciones web) y la del captcha.
  const ALLOWED = new Set(['vapidPublicKey', 'publicKey', 'turnstileSiteKey', 'captchaSiteKey']);
  const keysOf = (value: unknown, path = '', out: string[] = []): string[] => {
    if (Array.isArray(value)) value.forEach((v) => keysOf(v, `${path}[]`, out));
    else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) { out.push(`${path}.${k}`); keysOf(v, `${path}.${k}`, out); }
    return out;
  };

  it('en todas las lecturas autenticadas (dueño) y en las páginas públicas', async () => {
    const exposed: string[] = [];
    let checked = 0;
    const check = (url: string, body: string) => {
      let json: unknown;
      try { json = JSON.parse(body); } catch { return; }
      checked += 1;
      for (const key of keysOf(json)) {
        const leaf = key.split('.').pop()!.replace('[]', '');
        if (SENSITIVE.test(leaf) && !ALLOWED.has(leaf)) exposed.push(`${url} → ${key}`);
      }
    };
    const a = A.biz.session.business.id;
    const first = async (sql: string) => (await testDb.pool.query<{ id: string }>(sql, [a])).rows[0]!.id;
    // Id PROPIO de A del tipo que espera cada ruta (por su prefijo).
    const idFor: Array<[RegExp, string]> = [
      [/^\/items\//, A.biz.serviceId],
      [/^\/clients\//, A.clientId],
      [/^\/sales\//, await first('select id from sales where business_id = $1')],
      [/^\/cash\/closings\//, await first('select id from cash_closings where business_id = $1')],
      [/^\/appointments\//, await first('select id from appointments where business_id = $1')],
      [/^\/messages\/conversations\//, await first('select id from conversations where business_id = $1')],
      [/^\/professionals\//, A.biz.ownerId],
    ];
    const failed: string[] = [];
    for (const key of Object.keys(POLICY).filter((k) => k.startsWith('GET ') && !EXTERNAL.has(k))) {
      const route = key.slice(4);
      const path = route.replace(/:\w+/g, () => idFor.find(([re]) => re.test(route))?.[1] ?? A.biz.ownerId);
      const query = new URLSearchParams(queryFor(key, A));
      const res = await send(A.biz.session, 'GET', `/api${path}?${query}`);
      if (res.statusCode < 300) check(path, res.body);
      else failed.push(`${key} → ${res.statusCode} ${res.body.slice(0, 120)}`);
    }
    const base = A.biz.base;
    for (const url of [base, `${base}/catalog`, `${base}/team`, `${base}/reviews`, `/api/public/catalog/${A.biz.slug}`]) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(200);
      check(url, res.body);
    }
    expect(exposed).toEqual([]);
    // Toda lectura respondió con datos (si alguna fallara, sus campos quedarían sin revisar).
    expect(failed).toEqual([]);
    expect(checked).toBeGreaterThan(40);
  }, 120_000);
});

/**
 * Control de acceso por rol (OWASP API5), sobre TODA la política: un empleado sin permisos recibe 403 en todo lo que
 * no es 'any'; con uno de los permisos que pide la regla deja de recibir 403; lo 'owner' nunca se abre a un empleado.
 */
describe('control de acceso por rol en todas las rutas', () => {
  it('empleado sin permisos → 403 salvo en lo de "cualquiera"; con el permiso → pasa; lo del dueño, nunca', async () => {
    const { EMPLOYEE_PERMISSIONS } = await import('@xiro/shared');
    const owner = A.biz.session;
    const nobody = (await createEmployee(app, owner, [])).session;
    const withPermission = new Map<string, { session: { accessToken: string }; id: string }>();
    for (const permission of EMPLOYEE_PERMISSIONS) {
      const created = await createEmployee(app, owner, [permission]);
      withPermission.set(permission, { session: created.session, id: created.employee.id });
    }
    const everything = (await createEmployee(app, owner, [...EMPLOYEE_PERMISSIONS])).session;

    const problems: string[] = [];
    const call = (session: { accessToken: string }, method: string, path: string, id = '00000000-0000-4000-8000-000000000000') =>
      send(session, method, `/api${path.replace(/:\w+/g, id)}`, ['GET', 'DELETE'].includes(method) ? undefined : {});
    for (const [key, rule] of Object.entries(POLICY)) {
      const [method, path] = key.split(' ') as [string, string];
      const denied = (await call(nobody, method, path)).statusCode === 403;
      if (rule === 'any' && denied) problems.push(`${key}: 'any' pero negó a un empleado`);
      if (rule !== 'any' && !denied) problems.push(`${key}: debía negar a un empleado sin permisos`);
      if (rule === 'owner' && (await call(everything, method, path)).statusCode !== 403) problems.push(`${key}: es del dueño y lo abrió a un empleado con TODOS los permisos`);
      if (Array.isArray(rule)) {
        for (const permission of rule) {
          const employee = withPermission.get(permission)!;
          // Las rutas de una persona (/professionals/:id/…) se prueban sobre sí misma: con 'agenda_own' solo lo propio.
          const self = path.startsWith('/professionals/:id') ? employee.id : undefined;
          if ((await call(employee.session, method, path, self)).statusCode === 403) problems.push(`${key}: negó a un empleado con ${permission}`);
        }
        if (rule.length === 1 && rule[0] === 'agenda_own' && path.startsWith('/professionals/:id')) {
          const own = withPermission.get('agenda_own')!;
          // Con un cuerpo VÁLIDO (si no, un 400 de validación ocultaría si la regla de "lo propio" se cumple).
          const body = ['GET', 'DELETE'].includes(method) ? undefined : BODIES[key]?.(A);
          const res = await send(own.session, method, `/api${path.replace(/:\w+/, A.biz.ownerId)}`, body);
          if (res.statusCode !== 403) problems.push(`${key}: con agenda_own, sobre OTRA persona respondió ${res.statusCode} (debía ser 403)`);
        }
      }
    }
    expect(problems).toEqual([]);
  }, 300_000);
});
