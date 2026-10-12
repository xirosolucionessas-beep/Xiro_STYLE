import type { AuthSession, Client, ClientsSummary, Employee, EmployeePermission, Item, ItemsSummary, Page, ServiceRecord, ServiceRecordsSummary } from '@xiro/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import type { Notifier } from '../src/notifier';
import { createTestDatabase, testAppConfig, type TestDatabase } from './helpers/db';

/**
 * Paginación por cursor de los listados (Fase 1): orden estable sin saltos ni duplicados, límites validados, cursores
 * alterados rechazados con 400, filtros en el servidor, resúmenes que coinciden con lo que calculaba la app y, sobre
 * todo, aislamiento entre negocios (un cursor o un id de otro negocio nunca devuelve datos ajenos).
 */
let app: FastifyInstance;
let testDb: TestDatabase;
let cleanupConfig: () => void;
const notifier: Notifier = { sendOtp: async () => undefined, sendAppointmentReminder: async () => undefined };

beforeAll(async () => {
  testDb = await createTestDatabase();
  const { config, cleanup } = testAppConfig();
  cleanupConfig = cleanup;
  app = await buildApp({ db: testDb.db, notifier, config });
});

afterAll(async () => {
  await app.close();
  cleanupConfig();
  await testDb.drop();
});

const PASSWORD = 'Secreta123';
let counter = 0;
async function register(): Promise<AuthSession> {
  counter += 1;
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { name: 'Dueña', businessName: `Negocio Paginado ${counter}`, businessType: 'beauty_salon', email: `pag${counter}@correo.com`, password: PASSWORD, acceptTerms: true, language: 'es' },
  });
  expect(response.statusCode).toBe(201);
  return response.json<AuthSession>();
}
const auth = (session: AuthSession) => ({ authorization: `Bearer ${session.accessToken}` });
const get = async <T>(session: AuthSession, url: string) => {
  const response = await app.inject({ method: 'GET', url, headers: auth(session) });
  return { status: response.statusCode, body: response.json<T>() };
};

async function createEmployee(owner: AuthSession, permissions: EmployeePermission[]): Promise<AuthSession> {
  counter += 1;
  const email = `emp-pag${counter}@correo.com`;
  const created = await app.inject({ method: 'POST', url: '/api/employees', headers: auth(owner), payload: { name: 'Empleado', email, password: PASSWORD, permissions } });
  expect(created.statusCode).toBe(201);
  expect(created.json<Employee>().id).toBeTruthy();
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { identifier: email, password: PASSWORD } });
  expect(login.statusCode).toBe(200);
  return login.json<AuthSession>();
}

async function createClient(session: AuthSession, name: string, phone?: string): Promise<Client> {
  const res = await app.inject({ method: 'POST', url: '/api/clients', headers: auth(session), payload: { name, ...(phone ? { phone } : {}) } });
  expect(res.statusCode).toBe(201);
  return res.json<Client>();
}

async function categoryId(session: AuthSession): Promise<string> {
  return (await get<Array<{ id: string }>>(session, '/api/categories')).body[0]!.id;
}

async function createItem(session: AuthSession, payload: Record<string, unknown>): Promise<Item> {
  const res = await app.inject({ method: 'POST', url: '/api/items', headers: auth(session), payload: { categoryId: await categoryId(session), price: 10000, ...payload } });
  expect(res.statusCode).toBe(201);
  return res.json<Item>();
}

/** Recorre todas las páginas siguiendo `nextCursor`; falla si alguna página excede el límite. */
async function collect<T>(session: AuthSession, baseUrl: string, limit: number): Promise<{ all: T[]; pages: number }> {
  const all: T[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const separator = baseUrl.includes('?') ? '&' : '?';
    const url: string = `${baseUrl}${separator}limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const { status, body } = await get<Page<T>>(session, url);
    expect(status).toBe(200);
    expect(body.data.length).toBeLessThanOrEqual(limit);
    all.push(...body.data);
    cursor = body.nextCursor;
    pages += 1;
    expect(pages).toBeLessThan(100);
  } while (cursor);
  return { all, pages };
}

describe('paginación de clientes', () => {
  it('recorre el directorio A–Z sin saltos ni duplicados y termina con nextCursor null', async () => {
    const session = await register();
    const names = ['zoe', 'Ana', 'beto', 'Carla', 'Bruno', 'Diego', 'eva'];
    for (const name of names) await createClient(session, name);

    const { all, pages } = await collect<Client>(session, '/api/clients', 3);
    expect(pages).toBe(3);
    expect(all).toHaveLength(names.length);
    expect(new Set(all.map((c) => c.id)).size).toBe(names.length);
    // Mismo orden que antes de paginar: lower(name) (el índice clients_business_name_idx).
    const lowered = all.map((c) => c.name.toLowerCase());
    expect(lowered).toEqual([...lowered].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  });

  it('sort=recent devuelve los últimos creados primero', async () => {
    const session = await register();
    const created: Client[] = [];
    for (const name of ['Primero', 'Segundo', 'Tercero', 'Cuarto']) created.push(await createClient(session, name));
    const { all } = await collect<Client>(session, '/api/clients?sort=recent', 2);
    expect(all.map((c) => c.id)).toEqual(created.map((c) => c.id).reverse());
  });

  it('la búsqueda se pagina igual y sigue escapando comodines', async () => {
    const session = await register();
    for (let i = 0; i < 5; i += 1) await createClient(session, `Valentina ${i}`);
    await createClient(session, 'Mateo');
    const { all } = await collect<Client>(session, '/api/clients?q=valen', 2);
    expect(all).toHaveLength(5);
    expect((await get<Page<Client>>(session, '/api/clients?q=%25')).body.data).toHaveLength(0);
  });

  it('valida limit (1–100, por defecto 50) y rechaza cursores alterados con 400', async () => {
    const session = await register();
    for (let i = 0; i < 3; i += 1) await createClient(session, `Cliente ${i}`);
    expect((await get(session, '/api/clients?limit=0')).status).toBe(400);
    expect((await get(session, '/api/clients?limit=101')).status).toBe(400);
    expect((await get(session, '/api/clients?limit=abc')).status).toBe(400);
    expect((await get(session, '/api/clients?cursor=no-es-un-cursor')).status).toBe(400);
    expect((await get(session, `/api/clients?cursor=${Buffer.from('[1,2]').toString('base64url')}`)).status).toBe(400);
    expect((await get(session, '/api/clients?sort=otro')).status).toBe(400);
    const defaults = await get<Page<Client>>(session, '/api/clients');
    expect(defaults.body.data).toHaveLength(3);
    expect(defaults.body.nextCursor).toBeNull();
  });

  it('un cursor de otro negocio nunca devuelve datos ajenos', async () => {
    const a = await register();
    const b = await register();
    for (let i = 0; i < 4; i += 1) await createClient(a, `A ${i}`);
    await createClient(b, 'B solo');
    const firstPage = await get<Page<Client>>(a, '/api/clients?limit=2');
    expect(firstPage.body.nextCursor).not.toBeNull();
    const withForeignCursor = await get<Page<Client>>(b, `/api/clients?limit=2&cursor=${encodeURIComponent(firstPage.body.nextCursor!)}`);
    expect(withForeignCursor.status).toBe(200);
    expect(withForeignCursor.body.data.every((c) => c.name === 'B solo')).toBe(true);
    const everyB = await collect<Client>(b, '/api/clients', 100);
    expect(everyB.all.map((c) => c.name)).toEqual(['B solo']);
  });
});

describe('resumen de clientes', () => {
  it('cuenta total, nuevos (hoy/mes/rango) y activos en 30 días, solo del propio negocio', async () => {
    const session = await register();
    const other = await register();
    const ana = await createClient(session, 'Ana');
    await createClient(session, 'Beto');
    await createClient(other, 'Ajeno');
    const item = await createItem(session, { name: 'Corte', kind: 'service', durationMinutes: 30 });
    expect((await app.inject({ method: 'POST', url: '/api/service-records', headers: auth(session), payload: { clientId: ana.id, itemId: item.id } })).statusCode).toBe(201);

    const now = Date.now();
    const range = `from=${new Date(now - 60_000).toISOString()}&to=${new Date(now + 60_000).toISOString()}`;
    const { status, body } = await get<ClientsSummary>(session, `/api/clients/summary?${range}`);
    expect(status).toBe(200);
    expect(body).toEqual({ total: 2, newToday: 2, newYesterday: 0, newThisMonth: 2, active30d: 1, newInRange: 2 });

    const noRange = await get<ClientsSummary>(session, '/api/clients/summary');
    expect(noRange.body.newInRange).toBeNull();
    expect((await get(session, '/api/clients/summary?from=2026-01-02T00:00:00.000Z')).status).toBe(400); // solo uno de los dos
    expect((await get(session, '/api/clients/summary?from=2026-01-02T00:00:00.000Z&to=2026-01-01T00:00:00.000Z')).status).toBe(400);
    expect((await get<ClientsSummary>(other, '/api/clients/summary')).body).toMatchObject({ total: 1, active30d: 0 });
  });
});

describe('paginación de artículos', () => {
  it('recorre el catálogo completo con el orden de siempre (editados recientemente primero) sin duplicados', async () => {
    const session = await register();
    const created: Item[] = [];
    for (let i = 0; i < 7; i += 1) created.push(await createItem(session, { name: `Artículo ${i}` }));
    const { all, pages } = await collect<Item>(session, '/api/items', 3);
    expect(pages).toBe(3);
    expect(new Set(all.map((i) => i.id))).toEqual(new Set(created.map((i) => i.id)));
    expect(all.map((i) => i.id)).toEqual(created.map((i) => i.id).reverse());
  });

  it('busca sin tildes ni mayúsculas (como la app) y filtra en el servidor', async () => {
    const session = await register();
    await createItem(session, { name: 'Peluquería Infantil', kind: 'service', durationMinutes: 30, published: true });
    await createItem(session, { name: 'Champú', kind: 'product', stock: 0, published: false });
    await createItem(session, { name: 'Cera', kind: 'product', stock: 2, published: true });
    await createItem(session, { name: 'Gel', kind: 'product', stock: 50, published: true });

    const names = async (query: string) => (await collect<Item>(session, `/api/items?${query}`, 100)).all.map((i) => i.name).sort();
    expect(await names('q=PELUQUERIA')).toEqual(['Peluquería Infantil']);
    expect(await names('q=champu')).toEqual(['Champú']);
    expect(await names('q=100%25')).toEqual([]);
    expect(await names('kind=service')).toEqual(['Peluquería Infantil']);
    expect(await names('published=false')).toEqual(['Champú']);
    expect(await names('tracked=true')).toEqual(['Cera', 'Champú', 'Gel']);
    expect(await names('low=true')).toEqual(['Cera', 'Champú']);
    // Como la pantalla Inventario: solo lo que lleva inventario y, de eso, los agotados (un servicio también tiene estado).
    expect(await names('tracked=true&stockStatus=out_of_stock')).toEqual(['Champú']);

    const byStock = await collect<Item>(session, '/api/items?low=true&sort=stock', 1);
    expect(byStock.all.map((i) => i.name)).toEqual(['Champú', 'Cera']); // menos unidades primero
    expect((await get(session, '/api/items?published=si')).status).toBe(400);
    expect((await get(session, '/api/items?categoryId=no-uuid')).status).toBe(400);
  });

  it('el listado paginado sigue ocultando costo y notas internas a quien no gestiona el catálogo', async () => {
    const owner = await register();
    await createItem(owner, { name: 'Tinte', kind: 'product', stock: 4, internalUnitCost: 9000, internalNotes: 'NOTA-SECRETA' });
    const viewer = await createEmployee(owner, ['catalog_view']);
    const page = await get<Page<Item>>(viewer, '/api/items');
    expect(page.body.data).toHaveLength(1);
    expect(page.body.data[0]).toMatchObject({ internalUnitCost: 0, internalNotes: '' });
  });

  it('el resumen coincide con los criterios de la app y no revela el valor a costo sin catalog_manage', async () => {
    const owner = await register();
    await createItem(owner, { name: 'Corte', kind: 'service', durationMinutes: 30, price: 30000, published: true });
    await createItem(owner, { name: 'Cera', kind: 'product', stock: 2, price: 20000, internalUnitCost: 5000, published: true });
    await createItem(owner, { name: 'Gel', kind: 'product', stock: 0, price: 10000, internalUnitCost: 0, published: false });
    const summary = await get<ItemsSummary>(owner, '/api/items/summary');
    expect(summary.body).toEqual({ total: 3, published: 2, hidden: 1, averagePrice: 20000, stock: { total: 2, available: 0, reorder: 1, outOfStock: 1 }, inventoryValue: 10000 });

    const viewer = await createEmployee(owner, ['catalog_view']);
    expect((await get<ItemsSummary>(viewer, '/api/items/summary')).body.inventoryValue).toBeNull();
    const empty = await register();
    expect((await get<ItemsSummary>(empty, '/api/items/summary')).body).toMatchObject({ total: 0, averagePrice: null, inventoryValue: null });
  });
});

describe('registros de servicio', () => {
  it('se paginan (ya no se cortan en 200) y el resumen da cantidad, total, promedio, último y el más pedido', async () => {
    const session = await register();
    const client = await createClient(session, 'Ana');
    const corte = await createItem(session, { name: 'Corte', kind: 'service', durationMinutes: 30, price: 30000 });
    const tinte = await createItem(session, { name: 'Tinte', kind: 'service', durationMinutes: 60, price: 80000 });
    for (const itemId of [corte.id, corte.id, tinte.id]) {
      expect((await app.inject({ method: 'POST', url: '/api/service-records', headers: auth(session), payload: { clientId: client.id, itemId } })).statusCode).toBe(201);
    }
    const { all } = await collect<ServiceRecord>(session, `/api/service-records?clientId=${client.id}`, 2);
    expect(all).toHaveLength(3);
    expect(new Set(all.map((r) => r.id)).size).toBe(3);

    const summary = await get<ServiceRecordsSummary>(session, `/api/service-records/summary?clientId=${client.id}`);
    expect(summary.body).toMatchObject({ count: 3, total: 140000, average: 46667, topLabel: 'Corte' });
    expect(summary.body.lastAt).toBe(all[0]!.createdAt);

    expect((await app.inject({ method: 'POST', url: '/api/service-records', headers: auth(session), payload: { clientId: client.id, itemId: tinte.id } })).statusCode).toBe(201);
    expect((await get<ServiceRecordsSummary>(session, '/api/service-records/summary')).body.topLabel).toBeNull(); // empate 2–2: no se elige uno al azar

    const now = Date.now();
    const future = await get<ServiceRecordsSummary>(session, `/api/service-records/summary?from=${new Date(now + 3_600_000).toISOString()}&to=${new Date(now + 7_200_000).toISOString()}`);
    expect(future.body).toEqual({ count: 0, total: 0, average: null, lastAt: null, topLabel: null });

    const other = await register();
    expect((await get<ServiceRecordsSummary>(other, `/api/service-records/summary?clientId=${client.id}`)).body.count).toBe(0);
  });
});

describe('fidelización paginada', () => {
  it('el progreso por cliente se pagina (más visitas primero) y busca por nombre', async () => {
    const session = await register();
    const item = await createItem(session, { name: 'Corte', kind: 'service', durationMinutes: 30 });
    await app.inject({ method: 'PUT', url: '/api/loyalty/program', headers: auth(session), payload: { enabled: true, goal: 5, resetOnRedeem: true, rewardMessage: '', itemIds: [item.id] } });
    const clients: Client[] = [];
    for (const name of ['Carla', 'Beto', 'Ana', 'Diana']) clients.push(await createClient(session, name));
    for (let i = 0; i < 2; i += 1) await app.inject({ method: 'POST', url: '/api/service-records', headers: auth(session), payload: { clientId: clients[3]!.id, itemId: item.id } });
    await app.inject({ method: 'POST', url: '/api/service-records', headers: auth(session), payload: { clientId: clients[0]!.id, itemId: item.id } });

    const { all } = await collect<{ clientName: string; count: number }>(session, '/api/loyalty/clients', 2);
    expect(all.map((c) => `${c.clientName}:${c.count}`)).toEqual(['Diana:2', 'Carla:1', 'Ana:0', 'Beto:0']);
    expect((await collect<{ clientName: string }>(session, '/api/loyalty/clients?q=bet', 10)).all.map((c) => c.clientName)).toEqual(['Beto']);
  });
});

describe('endpoints que reemplazan listas completas en las pantallas', () => {
  it('visitas por cliente: solo de los ids pedidos y nunca de otro negocio', async () => {
    const session = await register();
    const other = await register();
    const ana = await createClient(session, 'Ana');
    const beto = await createClient(session, 'Beto');
    const ajeno = await createClient(other, 'Ajeno');
    const corte = await createItem(session, { name: 'Corte', kind: 'service', durationMinutes: 30 });
    for (let i = 0; i < 2; i += 1) await app.inject({ method: 'POST', url: '/api/service-records', headers: auth(session), payload: { clientId: ana.id, itemId: corte.id } });
    const visits = await get<Array<{ clientId: string; count: number; lastAt: string | null }>>(session, `/api/service-records/by-client?clientIds=${ana.id},${beto.id},${ajeno.id}`);
    expect(visits.status).toBe(200);
    expect(visits.body).toHaveLength(1); // Beto sin servicios no aparece; el cliente ajeno tampoco
    expect(visits.body[0]).toMatchObject({ clientId: ana.id, count: 2 });
    expect((await get(session, '/api/service-records/by-client?clientIds=no-uuid')).status).toBe(400);
    expect((await get(session, '/api/service-records/by-client')).status).toBe(400);
    const tooMany = Array.from({ length: 101 }, () => ana.id).join(',');
    expect((await get(session, `/api/service-records/by-client?clientIds=${tooMany}`)).status).toBe(400);
  });

  it('createdFrom/createdTo filtran por fecha de alta ("clientes nuevos hoy")', async () => {
    const session = await register();
    await createClient(session, 'Hoy');
    const now = Date.now();
    const inRange = await get<Page<Client>>(session, `/api/clients?createdFrom=${new Date(now - 60_000).toISOString()}&createdTo=${new Date(now + 60_000).toISOString()}`);
    expect(inRange.body.data.map((c) => c.name)).toEqual(['Hoy']);
    const past = await get<Page<Client>>(session, `/api/clients?createdFrom=2020-01-01T00:00:00.000Z&createdTo=2020-01-02T00:00:00.000Z`);
    expect(past.body.data).toEqual([]);
  });

  it('el resumen de registros separa servicios de productos (Inicio web)', async () => {
    const session = await register();
    const client = await createClient(session, 'Ana');
    const corte = await createItem(session, { name: 'Corte', kind: 'service', durationMinutes: 30, price: 30000 });
    await app.inject({ method: 'POST', url: '/api/service-records', headers: auth(session), payload: { clientId: client.id, itemId: corte.id } });
    expect((await get<ServiceRecordsSummary>(session, '/api/service-records/summary?kind=service')).body).toMatchObject({ count: 1, total: 30000 });
    expect((await get<ServiceRecordsSummary>(session, '/api/service-records/summary?kind=product')).body).toMatchObject({ count: 0, total: 0 });
    expect((await get(session, '/api/service-records/summary?kind=otro')).status).toBe(400);
  });

  it('el resumen de fidelización cuenta premios y canjes en el servidor; los canjes solo con permiso de canjear', async () => {
    const owner = await register();
    const item = await createItem(owner, { name: 'Corte', kind: 'service', durationMinutes: 30 });
    await app.inject({ method: 'PUT', url: '/api/loyalty/program', headers: auth(owner), payload: { enabled: true, goal: 1, resetOnRedeem: true, rewardMessage: '', itemIds: [item.id] } });
    const ana = await createClient(owner, 'Ana');
    const beto = await createClient(owner, 'Beto');
    for (const client of [ana, beto]) await app.inject({ method: 'POST', url: '/api/service-records', headers: auth(owner), payload: { clientId: client.id, itemId: item.id } });
    expect((await app.inject({ method: 'POST', url: `/api/loyalty/clients/${ana.id}/redeem`, headers: auth(owner) })).statusCode).toBe(200);

    expect((await get(owner, '/api/loyalty/summary')).body).toEqual({ rewardsAvailable: 1, redeemed: 1 });
    const worker = await createEmployee(owner, ['services_record']);
    expect((await get(worker, '/api/loyalty/summary')).body).toEqual({ rewardsAvailable: 1, redeemed: null });
    const other = await register();
    expect((await get(other, '/api/loyalty/summary')).body).toEqual({ rewardsAvailable: 0, redeemed: 0 });
  });
});
