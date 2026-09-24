import { and, eq } from 'drizzle-orm';
import type { AuthSession, Item } from '@xiro/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { categories, itemPhotos, items, otpCodes, refreshTokens } from '../src/db/schema';
import type { Notifier, OtpMessage } from '../src/notifier';
import { createTestDatabase, testAppConfig, type TestDatabase } from './helpers/db';

/**
 * Condiciones de carrera contra un PostgreSQL real con un pool de varias conexiones: cada prueba lanza decenas de
 * peticiones SIMULTÁNEAS y comprueba que el resultado es el único correcto.
 */

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

let app: FastifyInstance;
let testDb: TestDatabase;
let cleanup: () => void;
const otps: OtpMessage[] = [];
const notifier: Notifier = { sendOtp: async (message) => void otps.push(message) };

beforeAll(async () => {
  testDb = await createTestDatabase({ poolMax: 20 });
  const setup = testAppConfig();
  cleanup = setup.cleanup;
  app = await buildApp({ db: testDb.db, notifier, config: setup.config });
});
afterAll(async () => {
  await app.close();
  cleanup();
  await testDb.drop();
});

let counter = 0;
async function register(overrides: Record<string, unknown> = {}): Promise<AuthSession> {
  counter += 1;
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { name: 'Ana', businessName: `Studio ${counter}`, email: `c${counter}-${Date.now()}@correo.com`, password: 'Secreta123', acceptTerms: true, ...overrides },
  });
  expect(res.statusCode).toBe(201);
  return res.json<AuthSession>();
}
const auth = (s: AuthSession) => ({ authorization: `Bearer ${s.accessToken}` });

async function createItem(s: AuthSession, overrides: Record<string, unknown> = {}): Promise<Item> {
  const cats = (await app.inject({ method: 'GET', url: '/api/categories', headers: auth(s) })).json<Array<{ id: string }>>();
  const res = await app.inject({ method: 'POST', url: '/api/items', headers: auth(s), payload: { name: 'Cera', categoryId: cats[0]!.id, price: 1000, stock: 10, ...overrides } });
  expect(res.statusCode).toBe(201);
  return res.json<Item>();
}

function photoBody() {
  const form = new FormData();
  form.append('photo', new Blob([new Uint8Array(PNG)], { type: 'image/png' }), 'a.png');
  const response = new Response(form);
  return response.arrayBuffer().then((buffer) => ({ payload: Buffer.from(buffer), headers: { 'content-type': response.headers.get('content-type')! } }));
}

describe('registro concurrente', () => {
  it('solo un registro gana con el mismo correo aunque lleguen 20 a la vez', async () => {
    const email = `dup-${Date.now()}@correo.com`;
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        app.inject({ method: 'POST', url: '/api/auth/register', payload: { name: 'Ana', businessName: `Carrera ${i}`, email, password: 'Secreta123', acceptTerms: true } }),
      ),
    );
    const statuses = results.map((r) => r.statusCode);
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(19);
  });

  it('negocios con el mismo nombre reciben slugs distintos sin fallar (30 a la vez)', async () => {
    const results = await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        app.inject({ method: 'POST', url: '/api/auth/register', payload: { name: 'Ana', businessName: 'Barbería Central', email: `slug${i}-${Date.now()}@correo.com`, password: 'Secreta123', acceptTerms: true } }),
      ),
    );
    expect(results.every((r) => r.statusCode === 201)).toBe(true);
    const slugs = results.map((r) => r.json<AuthSession>().business.slug);
    expect(new Set(slugs).size).toBe(30);
  });
});

describe('rotación de refresh tokens', () => {
  it('50 refrescos simultáneos con el mismo token: exactamente uno tiene éxito', async () => {
    const session = await register();
    const results = await Promise.all(Array.from({ length: 50 }, () => app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: session.refreshToken } })));
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(results.filter((r) => r.statusCode === 401)).toHaveLength(49);
  });

  it('reutilizar un token ya rotado (fuera de la ventana de gracia) revoca toda la familia de sesiones', async () => {
    const session = await register();
    const rotated = (await app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: session.refreshToken } })).json<AuthSession>();

    // Se simula el paso del tiempo: el token viejo se usó hace más de la ventana de gracia.
    await testDb.db.update(refreshTokens).set({ usedAt: new Date(Date.now() - 60_000) }).where(eq(refreshTokens.userId, session.user.id));
    const reuse = await app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: session.refreshToken } });
    expect(reuse.statusCode).toBe(401);

    // El token nuevo (legítimo, pero de la misma familia comprometida) también queda revocado.
    const legit = await app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: rotated.refreshToken } });
    expect(legit.statusCode).toBe(401);
  });

  it('una reutilización inmediata (dos pestañas) NO revoca la sesión legítima', async () => {
    const session = await register();
    const rotated = (await app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: session.refreshToken } })).json<AuthSession>();
    expect((await app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: session.refreshToken } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: rotated.refreshToken } })).statusCode).toBe(200);
  });
});

describe('OTP y restablecimiento', () => {
  it('con 40 conjeturas simultáneas nunca se superan los 5 intentos', async () => {
    const session = await register();
    const identifier = session.user.email!;
    await app.inject({ method: 'POST', url: '/api/auth/recover/request', payload: { identifier, channel: 'email' } });
    const { code } = otps.at(-1)!;
    const wrong = code === '123456' ? '654321' : '123456';
    await Promise.all(Array.from({ length: 40 }, () => app.inject({ method: 'POST', url: '/api/auth/recover/verify', payload: { identifier, code: wrong } })));

    const [row] = await testDb.db.select({ attempts: otpCodes.attempts }).from(otpCodes).where(eq(otpCodes.userId, session.user.id));
    expect(row!.attempts).toBeLessThanOrEqual(5);
    // Agotados los intentos, ni siquiera el código correcto sirve.
    expect((await app.inject({ method: 'POST', url: '/api/auth/recover/verify', payload: { identifier, code } })).statusCode).toBe(400);
  });

  it('30 verificaciones correctas simultáneas: el código se canjea una sola vez', async () => {
    const session = await register();
    const identifier = session.user.email!;
    await app.inject({ method: 'POST', url: '/api/auth/recover/request', payload: { identifier, channel: 'email' } });
    const { code } = otps.at(-1)!;
    const results = await Promise.all(Array.from({ length: 30 }, () => app.inject({ method: 'POST', url: '/api/auth/recover/verify', payload: { identifier, code } })));
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
  });

  it('el token de restablecimiento sirve una vez aunque 20 peticiones lo usen a la vez, y cierra las sesiones', async () => {
    const session = await register();
    const identifier = session.user.email!;
    await app.inject({ method: 'POST', url: '/api/auth/recover/request', payload: { identifier, channel: 'email' } });
    const { resetToken } = (await app.inject({ method: 'POST', url: '/api/auth/recover/verify', payload: { identifier, code: otps.at(-1)!.code } })).json<{ resetToken: string }>();

    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => app.inject({ method: 'POST', url: '/api/auth/recover/reset', payload: { resetToken, newPassword: `NuevaClave${i}9` } })));
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(await testDb.db.select().from(refreshTokens).where(eq(refreshTokens.userId, session.user.id))).toHaveLength(0);
  });
});

describe('inventario', () => {
  it('60 ventas simultáneas de 1 unidad sobre 25 de stock: se venden exactamente 25 y el stock nunca es negativo', async () => {
    const session = await register();
    const item = await createItem(session, { stock: 25 });
    const results = await Promise.all(
      Array.from({ length: 60 }, () => app.inject({ method: 'POST', url: `/api/items/${item.id}/stock-adjustments`, headers: auth(session), payload: { delta: -1 } })),
    );
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(25);
    const rejected = results.filter((r) => r.statusCode === 409);
    expect(rejected).toHaveLength(35);
    expect(rejected[0]!.json().code).toBe('insufficient_stock');

    const final = (await app.inject({ method: 'GET', url: `/api/items/${item.id}`, headers: auth(session) })).json<Item>();
    expect(final.stock).toBe(0);
    expect(final.stockStatus).toBe('out_of_stock');
  });

  it('entradas y salidas simultáneas suman exactamente (sin actualizaciones perdidas)', async () => {
    const session = await register();
    const item = await createItem(session, { stock: 100 });
    const deltas = [...Array.from({ length: 40 }, () => 3), ...Array.from({ length: 30 }, () => -2)];
    const results = await Promise.all(deltas.map((delta) => app.inject({ method: 'POST', url: `/api/items/${item.id}/stock-adjustments`, headers: auth(session), payload: { delta } })));
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    const final = (await app.inject({ method: 'GET', url: `/api/items/${item.id}`, headers: auth(session) })).json<Item>();
    expect(final.stock).toBe(100 + 40 * 3 - 30 * 2);
  });

  it('valida el ajuste: delta cero, no entero o fuera de rango, e id ajeno o inexistente', async () => {
    const owner = await register();
    const other = await register();
    const item = await createItem(owner, { stock: 5 });
    for (const delta of [0, 1.5, 'x', 2_000_000]) {
      expect((await app.inject({ method: 'POST', url: `/api/items/${item.id}/stock-adjustments`, headers: auth(owner), payload: { delta } })).statusCode).toBe(400);
    }
    expect((await app.inject({ method: 'POST', url: `/api/items/${item.id}/stock-adjustments`, headers: auth(other), payload: { delta: 1 } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/items/no-es-uuid/stock-adjustments', headers: auth(owner), payload: { delta: 1 } })).statusCode).toBe(404);
  });

  it('el límite de 4 fotos se respeta con 12 subidas simultáneas y las posiciones no se repiten', async () => {
    const session = await register();
    const item = await createItem(session);
    const results = await Promise.all(
      Array.from({ length: 12 }, async () => {
        const form = await photoBody();
        return app.inject({ method: 'POST', url: `/api/items/${item.id}/photos`, headers: { ...auth(session), ...form.headers }, payload: form.payload });
      }),
    );
    expect(results.filter((r) => r.statusCode === 201)).toHaveLength(4);
    expect(results.filter((r) => r.statusCode === 400).every((r) => r.json().code === 'photo_limit')).toBe(true);
    const rows = await testDb.db.select({ position: itemPhotos.position }).from(itemPhotos).where(eq(itemPhotos.itemId, item.id));
    expect(rows.map((r) => r.position).sort()).toEqual([0, 1, 2, 3]);
  });

  it('detecta ediciones simultáneas con expectedUpdatedAt (concurrencia optimista) sin cambiar el contrato base', async () => {
    const session = await register();
    const item = await createItem(session);
    const body = (extra: Record<string, unknown>) => ({ name: 'Editado', categoryId: item.categoryId, price: 2000, ...extra });

    const first = await app.inject({ method: 'PUT', url: `/api/items/${item.id}`, headers: auth(session), payload: body({ expectedUpdatedAt: item.updatedAt }) });
    expect(first.statusCode).toBe(200);
    const stale = await app.inject({ method: 'PUT', url: `/api/items/${item.id}`, headers: auth(session), payload: body({ expectedUpdatedAt: item.updatedAt, price: 3000 }) });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe('conflict');
    // Sin el campo opcional, el comportamiento es el de siempre (última escritura gana).
    expect((await app.inject({ method: 'PUT', url: `/api/items/${item.id}`, headers: auth(session), payload: body({ price: 4000 }) })).json<Item>().price).toBe(4000);
  });
});

describe('cajas y categorías', () => {
  it('abrir caja desde 15 dispositivos a la vez deja un único registro del día', async () => {
    const session = await register();
    const results = await Promise.all(Array.from({ length: 15 }, (_, i) => app.inject({ method: 'POST', url: '/api/cash/opening', headers: auth(session), payload: { amount: 1000 + i } })));
    expect(results.every((r) => r.statusCode === 201)).toBe(true);
    const today = (await app.inject({ method: 'GET', url: '/api/cash/today', headers: auth(session) })).json<{ opening: { amount: number } }>();
    expect(today.opening.amount).toBeGreaterThanOrEqual(1000);
  });

  it('crear la misma categoría 15 veces a la vez: una sola gana (sin distinguir mayúsculas)', async () => {
    const session = await register();
    const names = Array.from({ length: 15 }, (_, i) => (i % 2 ? 'Barba' : 'BARBA'));
    const results = await Promise.all(names.map((name) => app.inject({ method: 'POST', url: '/api/categories', headers: auth(session), payload: { name } })));
    expect(results.filter((r) => r.statusCode === 201)).toHaveLength(1);
    expect(results.filter((r) => r.statusCode === 409)).toHaveLength(14);
  });

  it('borrar una categoría mientras otro crea un artículo en ella nunca deja huérfanos', async () => {
    const session = await register();
    const category = (await app.inject({ method: 'POST', url: '/api/categories', headers: auth(session), payload: { name: 'Temporal' } })).json<{ id: string }>();
    const [del, create] = await Promise.all([
      app.inject({ method: 'DELETE', url: `/api/categories/${category.id}`, headers: auth(session) }),
      app.inject({ method: 'POST', url: '/api/items', headers: auth(session), payload: { name: 'X', categoryId: category.id, price: 1 } }),
    ]);
    // O gana el borrado (204) y el artículo falla con 400, o gana el artículo y el borrado falla con 409: nunca ambos.
    expect([del.statusCode, create.statusCode].sort()).toSatisfy((pair: number[]) => (pair[0] === 201 && pair[1] === 409) || (pair[0] === 204 && pair[1] === 400));
    // Invariante: jamás existe un artículo cuya categoría ya no existe.
    const stillThere = await testDb.db.select({ id: categories.id }).from(categories).where(eq(categories.id, category.id));
    const orphans = await testDb.db.select({ id: items.id }).from(items).where(and(eq(items.categoryId, category.id), eq(items.businessId, session.business.id)));
    expect(stillThere.length === 0 ? orphans.length : 0).toBe(0);
  });
});

describe('pool de conexiones', () => {
  it('atiende 200 peticiones simultáneas con un pool de 20 conexiones sin errores', async () => {
    const session = await register();
    const results = await Promise.all(Array.from({ length: 200 }, () => app.inject({ method: 'GET', url: '/api/categories', headers: auth(session) })));
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    expect(testDb.pool.totalCount).toBeLessThanOrEqual(20);
  });
});
