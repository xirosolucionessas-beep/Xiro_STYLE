import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AuthSession, Item, PublicCatalog } from '@xiro/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app';
import type { Notifier, OtpMessage } from '../src/notifier';
import { createTestDatabase, testAppConfig, type TestDatabase } from './helpers/db';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

let app: FastifyInstance;
let dataDir: string;
let testDb: TestDatabase;
let cleanupConfig: () => void;
const sentOtps: OtpMessage[] = [];
const notifier: Notifier = { sendOtp: async (message) => void sentOtps.push(message) };

beforeAll(async () => {
  testDb = await createTestDatabase();
  const { config, cleanup } = testAppConfig({ corsOrigins: ['http://localhost:8081'] });
  cleanupConfig = cleanup;
  dataDir = config.dataDir!;
  app = await buildApp({ db: testDb.db, notifier, config });
});

afterAll(async () => {
  await app.close();
  cleanupConfig();
  await testDb.drop();
});

let counter = 0;
async function register(overrides: Record<string, unknown> = {}): Promise<AuthSession> {
  counter += 1;
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      name: 'Ana Pérez',
      businessName: `Studio Ana ${counter}`,
      businessType: 'beauty_salon',
      email: `ana${counter}@correo.com`,
      password: 'Secreta123',
      acceptTerms: true,
      language: 'es',
      ...overrides,
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json<AuthSession>();
}

const auth = (session: AuthSession) => ({ authorization: `Bearer ${session.accessToken}` });

async function firstCategoryId(session: AuthSession): Promise<string> {
  const res = await app.inject({ method: 'GET', url: '/api/categories', headers: auth(session) });
  return res.json<Array<{ id: string }>>()[0]!.id;
}

async function createItem(session: AuthSession, overrides: Record<string, unknown> = {}): Promise<Item> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/items',
    headers: auth(session),
    payload: {
      name: 'Corte Ejecutivo',
      categoryId: await firstCategoryId(session),
      shortDescription: 'Corte clásico',
      description: 'Corte con lavado',
      detail: '45 min',
      price: 35000,
      referenceCode: 'SRV-SECRETO-01',
      internalUnitCost: 15000,
      stock: 15,
      internalNotes: 'NOTA-INTERNA-CONFIDENCIAL',
      ...overrides,
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json<Item>();
}

async function createClient(session: AuthSession, overrides: Record<string, unknown> = {}): Promise<{ id: string; name: string }> {
  const res = await app.inject({ method: 'POST', url: '/api/clients', headers: auth(session), payload: { name: 'Valentina Rojas', ...overrides } });
  expect(res.statusCode).toBe(201);
  return res.json();
}

function multipart(file: Buffer, filename = 'foto.png', type = 'image/png') {
  const form = new FormData();
  form.append('photo', new Blob([new Uint8Array(file)], { type }), filename);
  const response = new Response(form);
  return response.arrayBuffer().then((buffer) => ({
    payload: Buffer.from(buffer),
    headers: { 'content-type': response.headers.get('content-type')! },
  }));
}

describe('auth', () => {
  it('registers a business owner with default categories and a session', async () => {
    const session = await register();
    expect(session.user.businessId).toBe(session.business.id);
    expect(session.business.slug).toMatch(/^studio-ana/);
    const categories = await app.inject({ method: 'GET', url: '/api/categories', headers: auth(session) });
    expect(categories.json<unknown[]>()).toHaveLength(3);
  });

  it('rejects duplicate accounts, weak passwords and missing contact', async () => {
    const session = await register();
    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { name: 'X', businessName: 'Otro', email: session.user.email, password: 'Secreta123', acceptTerms: true },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().code).toBe('account_exists');

    const weak = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { name: 'X', businessName: 'Otro', email: 'weak@correo.com', password: 'abc', acceptTerms: true },
    });
    expect(weak.statusCode).toBe(400);
    expect(weak.json().issues[0].message).toBe('password_weak');

    const noContact = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { name: 'X', businessName: 'Otro', password: 'Secreta123', acceptTerms: true },
    });
    expect(noContact.statusCode).toBe(400);
  });

  it('logs in by email or phone and rejects wrong credentials', async () => {
    const session = await register({ email: undefined, phone: '3001112233' });
    const byPhone = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { identifier: '300 111 2233', password: 'Secreta123' } });
    expect(byPhone.statusCode).toBe(200);
    expect(byPhone.json<AuthSession>().user.id).toBe(session.user.id);

    const wrong = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { identifier: '3001112233', password: 'Incorrecta1' } });
    expect(wrong.statusCode).toBe(401);
    const unknown = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { identifier: 'nadie@correo.com', password: 'Secreta123' } });
    expect(unknown.statusCode).toBe(401);
    expect(unknown.json().code).toBe(wrong.json().code);
  });

  it('rotates refresh tokens: each one works once', async () => {
    const session = await register();
    const first = await app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: session.refreshToken } });
    expect(first.statusCode).toBe(200);
    const reuse = await app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: session.refreshToken } });
    expect(reuse.statusCode).toBe(401);
    const next = first.json<AuthSession>();
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: auth(next) });
    expect(me.statusCode).toBe(200);
  });

  it('requires a valid token on protected routes', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/items' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/items', headers: { authorization: 'Bearer nope' } })).statusCode).toBe(401);
  });
});

describe('password recovery', () => {
  it('does not reveal whether the account exists', async () => {
    const before = sentOtps.length;
    const unknown = await app.inject({ method: 'POST', url: '/api/auth/recover/request', payload: { identifier: 'fantasma@correo.com', channel: 'email' } });
    expect(unknown.statusCode).toBe(202);
    expect(unknown.json()).toEqual({ ok: true });
    expect(sentOtps.length).toBe(before);
  });

  it('verifies the code, resets the password and revokes sessions', async () => {
    const session = await register();
    const identifier = session.user.email!;
    await app.inject({ method: 'POST', url: '/api/auth/recover/request', payload: { identifier, channel: 'email' } });
    const message = sentOtps.at(-1)!;
    expect(message.to).toBe(identifier);

    const wrong = await app.inject({ method: 'POST', url: '/api/auth/recover/verify', payload: { identifier, code: message.code === '000000' ? '111111' : '000000' } });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().code).toBe('otp_invalid');

    const verified = await app.inject({ method: 'POST', url: '/api/auth/recover/verify', payload: { identifier, code: message.code } });
    expect(verified.statusCode).toBe(200);
    const { resetToken } = verified.json<{ resetToken: string }>();

    const weak = await app.inject({ method: 'POST', url: '/api/auth/recover/reset', payload: { resetToken, newPassword: 'débil' } });
    expect(weak.statusCode).toBe(400);

    const reset = await app.inject({ method: 'POST', url: '/api/auth/recover/reset', payload: { resetToken, newPassword: 'NuevaClave9' } });
    expect(reset.statusCode).toBe(200);
    const again = await app.inject({ method: 'POST', url: '/api/auth/recover/reset', payload: { resetToken, newPassword: 'OtraClave99' } });
    expect(again.statusCode).toBe(400);

    expect((await app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: session.refreshToken } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { identifier, password: 'Secreta123' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { identifier, password: 'NuevaClave9' } })).statusCode).toBe(200);
  });

  it('locks a code after too many wrong attempts', async () => {
    const session = await register();
    const identifier = session.user.email!;
    await app.inject({ method: 'POST', url: '/api/auth/recover/request', payload: { identifier, channel: 'email' } });
    const { code } = sentOtps.at(-1)!;
    const wrongCode = code === '123456' ? '654321' : '123456';
    for (let i = 0; i < 5; i += 1) {
      await app.inject({ method: 'POST', url: '/api/auth/recover/verify', payload: { identifier, code: wrongCode } });
    }
    const late = await app.inject({ method: 'POST', url: '/api/auth/recover/verify', payload: { identifier, code } });
    expect(late.statusCode).toBe(400);
  });
});

describe('phone change', () => {
  it('requires a valid session', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/me/phone/request', payload: { phone: '3001234567' } })).statusCode).toBe(401);
  });

  it('sends the code to the NEW number and only applies it after confirming', async () => {
    const session = await register();
    const before = sentOtps.length;
    const requested = await app.inject({ method: 'POST', url: '/api/me/phone/request', headers: auth(session), payload: { phone: '3001234567' } });
    expect(requested.statusCode).toBe(202);
    expect(sentOtps.length).toBe(before + 1);
    const message = sentOtps.at(-1)!;
    expect(message.channel).toBe('sms');
    expect(message.to).toBe('573001234567');

    // El número aún no cambia hasta confirmar el código.
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: auth(session) });
    expect(me.json<{ user: { phone: string | null } }>().user.phone).not.toBe('573001234567');

    const wrong = await app.inject({ method: 'POST', url: '/api/me/phone/confirm', headers: auth(session), payload: { code: message.code === '000000' ? '111111' : '000000' } });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().code).toBe('otp_invalid');

    const confirmed = await app.inject({ method: 'POST', url: '/api/me/phone/confirm', headers: auth(session), payload: { code: message.code } });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json<{ phone: string | null }>().phone).toBe('573001234567');

    // El código ya se canjeó: no sirve una segunda vez.
    const reused = await app.inject({ method: 'POST', url: '/api/me/phone/confirm', headers: auth(session), payload: { code: message.code } });
    expect(reused.statusCode).toBe(400);
  });

  it('rejects a number already used by another account', async () => {
    const owner = await register({ phone: '3009999999' });
    const other = await register();
    const clash = await app.inject({ method: 'POST', url: '/api/me/phone/request', headers: auth(other), payload: { phone: owner.user.phone } });
    expect(clash.statusCode).toBe(409);
    expect(clash.json().code).toBe('phone_taken');
  });

  it('locks a code after too many wrong attempts', async () => {
    const session = await register();
    await app.inject({ method: 'POST', url: '/api/me/phone/request', headers: auth(session), payload: { phone: '3002223344' } });
    const { code } = sentOtps.at(-1)!;
    const wrongCode = code === '123456' ? '654321' : '123456';
    for (let i = 0; i < 5; i += 1) {
      await app.inject({ method: 'POST', url: '/api/me/phone/confirm', headers: auth(session), payload: { code: wrongCode } });
    }
    const late = await app.inject({ method: 'POST', url: '/api/me/phone/confirm', headers: auth(session), payload: { code } });
    expect(late.statusCode).toBe(400);
  });
});

describe('inventory and categories', () => {
  it('creates items, suggests stock status and protects categories in use', async () => {
    const session = await register();
    const soldOut = await createItem(session, { stock: 0 });
    const reorder = await createItem(session, { name: 'Cera', stock: 3 });
    const override = await createItem(session, { name: 'Gel', stock: 50, stockStatus: 'reorder' });
    expect(soldOut.stockStatus).toBe('out_of_stock');
    expect(reorder.stockStatus).toBe('reorder');
    expect(override.stockStatus).toBe('reorder');

    const del = await app.inject({ method: 'DELETE', url: `/api/categories/${soldOut.categoryId}`, headers: auth(session) });
    expect(del.statusCode).toBe(409);
    expect(del.json().code).toBe('category_in_use');
  });

  it('renames categories and rejects duplicates case-insensitively', async () => {
    const session = await register();
    const created = await app.inject({ method: 'POST', url: '/api/categories', headers: auth(session), payload: { name: 'Barba' } });
    expect(created.statusCode).toBe(201);
    const dup = await app.inject({ method: 'POST', url: '/api/categories', headers: auth(session), payload: { name: 'barba' } });
    expect(dup.statusCode).toBe(409);
    const renamed = await app.inject({ method: 'PATCH', url: `/api/categories/${created.json().id}`, headers: auth(session), payload: { name: 'Barba y Cuidado' } });
    expect(renamed.json().name).toBe('Barba y Cuidado');
  });

  it('updates and deletes items', async () => {
    const session = await register();
    const item = await createItem(session);
    const updated = await app.inject({
      method: 'PUT',
      url: `/api/items/${item.id}`,
      headers: auth(session),
      payload: { name: 'Corte Premium', categoryId: item.categoryId, price: 40000, stock: 2 },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ name: 'Corte Premium', price: 40000, stockStatus: 'reorder' });
    expect((await app.inject({ method: 'DELETE', url: `/api/items/${item.id}`, headers: auth(session) })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: `/api/items/${item.id}`, headers: auth(session) })).statusCode).toBe(404);
  });

  it('isolates businesses from each other', async () => {
    const owner = await register();
    const intruder = await register();
    const item = await createItem(owner);
    expect((await app.inject({ method: 'GET', url: `/api/items/${item.id}`, headers: auth(intruder) })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/api/items/${item.id}`, headers: auth(intruder) })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/items', headers: auth(intruder) })).json()).toEqual([]);
    const foreignCategory = await app.inject({
      method: 'POST',
      url: '/api/items',
      headers: auth(intruder),
      payload: { name: 'X', categoryId: item.categoryId, price: 1 },
    });
    expect(foreignCategory.statusCode).toBe(400);
  });
});

describe('photos', () => {
  it('accepts real images, rejects fakes and enforces the 4-photo limit', async () => {
    const session = await register();
    const item = await createItem(session);

    const fake = await multipart(Buffer.from('esto no es una imagen, solo texto largo'), 'malware.png');
    const rejected = await app.inject({ method: 'POST', url: `/api/items/${item.id}/photos`, headers: { ...auth(session), ...fake.headers }, payload: fake.payload });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json().code).toBe('photo_invalid');

    let current: Item = item;
    for (let i = 0; i < 4; i += 1) {
      const form = await multipart(PNG);
      const ok = await app.inject({ method: 'POST', url: `/api/items/${item.id}/photos`, headers: { ...auth(session), ...form.headers }, payload: form.payload });
      expect(ok.statusCode).toBe(201);
      current = ok.json<Item>();
    }
    expect(current.photos).toHaveLength(4);
    expect(current.photos[0]!.url).toMatch(/^\/media\/[0-9a-f-]+\.png$/);

    const form = await multipart(PNG);
    const over = await app.inject({ method: 'POST', url: `/api/items/${item.id}/photos`, headers: { ...auth(session), ...form.headers }, payload: form.payload });
    expect(over.json().code).toBe('photo_limit');

    const served = await app.inject({ method: 'GET', url: current.photos[0]!.url });
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toBe('image/png');

    const lastId = current.photos[3]!.id;
    const promoted = await app.inject({ method: 'POST', url: `/api/items/${item.id}/photos/${lastId}/primary`, headers: auth(session) });
    expect(promoted.json<Item>().photos[0]!.id).toBe(lastId);

    const urls = current.photos.map((p) => p.url);
    await app.inject({ method: 'DELETE', url: `/api/items/${item.id}`, headers: auth(session) });
    for (const url of urls) expect((await app.inject({ method: 'GET', url })).statusCode).toBe(404);
    expect(readdirSync(path.join(dataDir, 'media'))).not.toContain(path.basename(urls[0]!));
  });
});

describe('public catalog', () => {
  it('exposes only published items and never internal fields', async () => {
    const session = await register();
    const visible = await createItem(session, { name: 'Visible', published: true });
    await createItem(session, { name: 'Oculto', published: false });

    const res = await app.inject({ method: 'GET', url: `/api/public/catalog/${session.business.slug}` });
    expect(res.statusCode).toBe(200);
    const body = res.json<PublicCatalog>();
    expect(body.items.map((i) => i.name)).toEqual(['Visible']);
    expect(Object.keys(body.items[0]!).sort()).toEqual(
      ['category', 'description', 'detail', 'gallery', 'id', 'image', 'name', 'price', 'shortDescription'].sort(),
    );
    const raw = res.body;
    for (const secret of ['NOTA-INTERNA-CONFIDENCIAL', 'SRV-SECRETO-01', 'internalUnitCost', 'stock', 'referenceCode', session.user.email!]) {
      expect(raw).not.toContain(secret);
    }
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['cache-control']).toContain('max-age=15');

    const one = await app.inject({ method: 'GET', url: `/api/public/catalog/${session.business.slug}/items/${visible.id}` });
    expect(one.statusCode).toBe(200);
    expect(one.body).not.toContain('NOTA-INTERNA-CONFIDENCIAL');
  });

  it('filters by category, 404s unknown slugs, unpublished and foreign items', async () => {
    const a = await register();
    const b = await register();
    const itemA = await createItem(a, { name: 'De A' });
    const hidden = await createItem(a, { name: 'Oculto', published: false });

    const filtered = await app.inject({ method: 'GET', url: `/api/public/catalog/${a.business.slug}?category=${encodeURIComponent(itemA.categoryName.toUpperCase())}` });
    expect(filtered.json<PublicCatalog>().items).toHaveLength(1);
    const none = await app.inject({ method: 'GET', url: `/api/public/catalog/${a.business.slug}?category=Inexistente` });
    expect(none.json<PublicCatalog>().items).toHaveLength(0);

    expect((await app.inject({ method: 'GET', url: '/api/public/catalog/no-existe' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/public/catalog/${a.business.slug}/items/${hidden.id}` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/public/catalog/${b.business.slug}/items/${itemA.id}` })).statusCode).toBe(404);
  });

  it('serves the shareable catalog page with escaped social tags and a strict CSP', async () => {
    const session = await register();
    const item = await createItem(session, { name: '<script>alert(1)</script> "Corte"', published: true });
    const page = await app.inject({ method: 'GET', url: `/catalog/${session.business.slug}/item/${item.id}` });
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.headers['content-security-policy']).toContain("script-src 'self'");
    expect(page.body).not.toContain('<script>alert(1)</script>');
    expect(page.body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(page.body).toContain('og:title');

    const list = await app.inject({ method: 'GET', url: `/catalog/${session.business.slug}` });
    expect(list.statusCode).toBe(200);
    const assets = await app.inject({ method: 'GET', url: '/catalog-assets/catalog.js' });
    expect(assets.statusCode).toBe(200);
  });
});

describe('account', () => {
  it('updates profile, business data and the cash opening of the day', async () => {
    const session = await register();
    const profile = await app.inject({ method: 'PATCH', url: '/api/me', headers: auth(session), payload: { language: 'en', theme: 'light' } });
    expect(profile.json()).toMatchObject({ language: 'en', theme: 'light' });

    const business = await app.inject({
      method: 'PATCH',
      url: '/api/business',
      headers: auth(session),
      payload: { whatsapp: '300 999 8877', city: 'Medellín', currency: 'USD' },
    });
    expect(business.json()).toMatchObject({ whatsapp: '573009998877', city: 'Medellín', currency: 'USD' });

    expect((await app.inject({ method: 'GET', url: '/api/cash/today', headers: auth(session) })).json()).toEqual({ opening: null });
    await app.inject({ method: 'POST', url: '/api/cash/opening', headers: auth(session), payload: { amount: 100000 } });
    const second = await app.inject({ method: 'POST', url: '/api/cash/opening', headers: auth(session), payload: { amount: 150000, note: 'ajuste' } });
    expect(second.json().opening).toMatchObject({ amount: 150000, note: 'ajuste' });
    expect((await app.inject({ method: 'GET', url: '/api/cash/today', headers: auth(session) })).json().opening.amount).toBe(150000);

    const negative = await app.inject({ method: 'POST', url: '/api/cash/opening', headers: auth(session), payload: { amount: -5 } });
    expect(negative.statusCode).toBe(400);
  });

  it('manages clients with search', async () => {
    const session = await register();
    const created = await app.inject({ method: 'POST', url: '/api/clients', headers: auth(session), payload: { name: 'Valentina Rojas', phone: '300 123 4567', email: '' } });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ name: 'Valentina Rojas', phone: '573001234567', email: null });
    await app.inject({ method: 'POST', url: '/api/clients', headers: auth(session), payload: { name: 'Mateo Gómez' } });

    const search = await app.inject({ method: 'GET', url: '/api/clients?q=valen', headers: auth(session) });
    expect(search.json<unknown[]>()).toHaveLength(1);
    const wildcard = await app.inject({ method: 'GET', url: '/api/clients?q=%25', headers: auth(session) });
    expect(wildcard.json<unknown[]>()).toHaveLength(0);
    const other = await register();
    expect((await app.inject({ method: 'GET', url: '/api/clients', headers: auth(other) })).json()).toEqual([]);
  });
});

describe('loyalty and service records', () => {
  it('has a disabled default program until the business configures one', async () => {
    const session = await register();
    const program = await app.inject({ method: 'GET', url: '/api/loyalty/program', headers: auth(session) });
    expect(program.json()).toEqual({ enabled: false, goal: 10, resetOnRedeem: true, rewardMessage: '', itemIds: [] });
  });

  it('configures the program (goal, eligible items, message) and persists it', async () => {
    const session = await register();
    const item = await createItem(session);
    const saved = await app.inject({
      method: 'PUT',
      url: '/api/loyalty/program',
      headers: auth(session),
      payload: { enabled: true, goal: 3, resetOnRedeem: true, rewardMessage: '¡Tu próximo corte es gratis!', itemIds: [item.id] },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toEqual({ enabled: true, goal: 3, resetOnRedeem: true, rewardMessage: '¡Tu próximo corte es gratis!', itemIds: [item.id] });

    const reloaded = await app.inject({ method: 'GET', url: '/api/loyalty/program', headers: auth(session) });
    expect(reloaded.json()).toEqual(saved.json());

    // Guardar de nuevo con una lista distinta de items REEMPLAZA la anterior (no la acumula).
    const otherItem = await createItem(session, { name: 'Manicure' });
    const replaced = await app.inject({ method: 'PUT', url: '/api/loyalty/program', headers: auth(session), payload: { enabled: true, goal: 3, resetOnRedeem: true, rewardMessage: '', itemIds: [otherItem.id] } });
    expect(replaced.json<{ itemIds: string[] }>().itemIds).toEqual([otherItem.id]);
  });

  it('recording an eligible service adds exactly one stamp; a non-eligible item adds none; each request counts once', async () => {
    const session = await register();
    const eligible = await createItem(session, { name: 'Corte' });
    const notEligible = await createItem(session, { name: 'Producto' });
    const client = await createClient(session);
    await app.inject({ method: 'PUT', url: '/api/loyalty/program', headers: auth(session), payload: { enabled: true, goal: 3, resetOnRedeem: true, rewardMessage: '', itemIds: [eligible.id] } });

    const recordedNonEligible = await app.inject({ method: 'POST', url: '/api/service-records', headers: auth(session), payload: { clientId: client.id, itemId: notEligible.id } });
    expect(recordedNonEligible.statusCode).toBe(201);
    expect(recordedNonEligible.json()).toMatchObject({ loyaltyCounted: false, rewardJustEarned: false });

    let progress = await app.inject({ method: 'GET', url: '/api/loyalty/clients', headers: auth(session) });
    expect(progress.json<Array<{ clientId: string; count: number }>>().find((c) => c.clientId === client.id)?.count).toBe(0);

    const first = await app.inject({ method: 'POST', url: '/api/service-records', headers: auth(session), payload: { clientId: client.id, itemId: eligible.id } });
    expect(first.json()).toMatchObject({ loyaltyCounted: true, rewardJustEarned: false, amount: 35000, label: 'Corte' });
    const second = await app.inject({ method: 'POST', url: '/api/service-records', headers: auth(session), payload: { clientId: client.id, itemId: eligible.id, amount: 1 } });
    expect(second.json()).toMatchObject({ loyaltyCounted: true, amount: 1 }); // amount explícito sobreescribe el precio del item
    const third = await app.inject({ method: 'POST', url: '/api/service-records', headers: auth(session), payload: { clientId: client.id, itemId: eligible.id } });
    expect(third.json()).toMatchObject({ rewardJustEarned: true }); // la 3ª de 3 alcanza la meta

    progress = await app.inject({ method: 'GET', url: '/api/loyalty/clients', headers: auth(session) });
    const mine = progress.json<Array<{ clientId: string; count: number; goal: number; rewardAvailable: boolean }>>().find((c) => c.clientId === client.id)!;
    expect(mine).toMatchObject({ count: 3, goal: 3, rewardAvailable: true });

    const history = await app.inject({ method: 'GET', url: `/api/service-records?clientId=${client.id}`, headers: auth(session) });
    expect(history.json<unknown[]>()).toHaveLength(4); // 1 no elegible + 3 elegibles
  });

  it('redeeming resets the counter (resetOnRedeem: true), records history, and rejects redeeming below the goal', async () => {
    const session = await register();
    const item = await createItem(session);
    const client = await createClient(session);
    await app.inject({ method: 'PUT', url: '/api/loyalty/program', headers: auth(session), payload: { enabled: true, goal: 2, resetOnRedeem: true, rewardMessage: '', itemIds: [item.id] } });

    const early = await app.inject({ method: 'POST', url: `/api/loyalty/clients/${client.id}/redeem`, headers: auth(session) });
    expect(early.statusCode).toBe(400);
    expect(early.json().code).toBe('loyalty_reward_unavailable');

    await app.inject({ method: 'POST', url: '/api/service-records', headers: auth(session), payload: { clientId: client.id, itemId: item.id } });
    await app.inject({ method: 'POST', url: '/api/service-records', headers: auth(session), payload: { clientId: client.id, itemId: item.id } });

    const redeemed = await app.inject({ method: 'POST', url: `/api/loyalty/clients/${client.id}/redeem`, headers: auth(session) });
    expect(redeemed.statusCode).toBe(200);
    expect(redeemed.json()).toMatchObject({ count: 0, rewardAvailable: false });

    const history = await app.inject({ method: 'GET', url: '/api/loyalty/redemptions', headers: auth(session) });
    expect(history.json()).toMatchObject([{ clientId: client.id, goalAtRedemption: 2 }]);

    const again = await app.inject({ method: 'POST', url: `/api/loyalty/clients/${client.id}/redeem`, headers: auth(session) });
    expect(again.statusCode).toBe(400); // ya en 0, no vuelve a alcanzar la meta sin más servicios
  });

  it('redeeming without resetOnRedeem only subtracts the goal, keeping any overflow', async () => {
    const session = await register();
    const item = await createItem(session);
    const client = await createClient(session);
    await app.inject({ method: 'PUT', url: '/api/loyalty/program', headers: auth(session), payload: { enabled: true, goal: 2, resetOnRedeem: false, rewardMessage: '', itemIds: [item.id] } });
    for (let i = 0; i < 3; i += 1) await app.inject({ method: 'POST', url: '/api/service-records', headers: auth(session), payload: { clientId: client.id, itemId: item.id } });

    const redeemed = await app.inject({ method: 'POST', url: `/api/loyalty/clients/${client.id}/redeem`, headers: auth(session) });
    expect(redeemed.json()).toMatchObject({ count: 1, rewardAvailable: false }); // 3 - meta(2) = 1, no alcanza otra vez todavía
  });

  it('redeeming requires the program to be enabled', async () => {
    const session = await register();
    const client = await createClient(session);
    const disabled = await app.inject({ method: 'POST', url: `/api/loyalty/clients/${client.id}/redeem`, headers: auth(session) });
    expect(disabled.statusCode).toBe(400);
    expect(disabled.json().code).toBe('loyalty_disabled');
  });

  it('never sees another business’ clients, items, program or history (data isolation)', async () => {
    const session = await register();
    const item = await createItem(session);
    const client = await createClient(session);
    await app.inject({ method: 'PUT', url: '/api/loyalty/program', headers: auth(session), payload: { enabled: true, goal: 1, resetOnRedeem: true, rewardMessage: '', itemIds: [item.id] } });
    await app.inject({ method: 'POST', url: '/api/service-records', headers: auth(session), payload: { clientId: client.id, itemId: item.id } });

    const other = await register();
    expect((await app.inject({ method: 'GET', url: '/api/loyalty/clients', headers: auth(other) })).json()).toEqual([]);
    expect((await app.inject({ method: 'GET', url: '/api/loyalty/program', headers: auth(other) })).json<{ enabled: boolean }>().enabled).toBe(false);
    expect((await app.inject({ method: 'GET', url: '/api/service-records', headers: auth(other) })).json()).toEqual([]);
    // No puede registrar un servicio contra un cliente o item de otro negocio.
    expect((await app.inject({ method: 'POST', url: '/api/service-records', headers: auth(other), payload: { clientId: client.id, itemId: item.id } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/api/loyalty/clients/${client.id}/redeem`, headers: auth(other) })).statusCode).toBe(400); // sin programa propio: loyalty_disabled antes de llegar a buscar el cliente
  });

  it('requires authentication on every loyalty/service-record route', async () => {
    for (const req of [
      { method: 'GET' as const, url: '/api/loyalty/program' },
      { method: 'PUT' as const, url: '/api/loyalty/program' },
      { method: 'GET' as const, url: '/api/loyalty/clients' },
      { method: 'GET' as const, url: '/api/loyalty/redemptions' },
      { method: 'POST' as const, url: '/api/loyalty/clients/00000000-0000-0000-0000-000000000000/redeem' },
      { method: 'GET' as const, url: '/api/service-records' },
      { method: 'POST' as const, url: '/api/service-records' },
    ]) {
      expect((await app.inject(req)).statusCode).toBe(401);
    }
  });
});

describe('notifications', () => {
  afterEach(() => vi.unstubAllGlobals());
  const okTicket = async (..._args: Parameters<typeof fetch>) => new Response(JSON.stringify({ data: [{ status: 'ok', id: 't1' }] }), { status: 200 });

  it('defaults to off, with both categories on, until the business saves its own settings', async () => {
    const session = await register();
    const res = await app.inject({ method: 'GET', url: '/api/notifications/settings', headers: auth(session) });
    expect(res.json()).toEqual({ enabled: false, loyaltyEnabled: true, billingEnabled: true });
  });

  it('saves settings and reloads them', async () => {
    const session = await register();
    const saved = await app.inject({ method: 'PUT', url: '/api/notifications/settings', headers: auth(session), payload: { enabled: true, loyaltyEnabled: false, billingEnabled: true } });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toEqual({ enabled: true, loyaltyEnabled: false, billingEnabled: true });
    const reloaded = await app.inject({ method: 'GET', url: '/api/notifications/settings', headers: auth(session) });
    expect(reloaded.json()).toEqual(saved.json());
  });

  it('reports no VAPID public key when Web Push isn\'t configured (honest, no fake key)', async () => {
    const session = await register();
    const res = await app.inject({ method: 'GET', url: '/api/notifications/vapid-public-key', headers: auth(session) });
    expect(res.json()).toEqual({ publicKey: null });
  });

  it('registers an Expo token, and registering the same token again upserts instead of failing', async () => {
    const session = await register();
    const first = await app.inject({ method: 'POST', url: '/api/notifications/register', headers: auth(session), payload: { platform: 'expo', token: 'ExponentPushToken[dup]' } });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({ method: 'POST', url: '/api/notifications/register', headers: auth(session), payload: { platform: 'expo', token: 'ExponentPushToken[dup]' } });
    expect(second.statusCode).toBe(200);
  });

  it('registers a Web Push subscription (endpoint + keys)', async () => {
    const session = await register();
    const res = await app.inject({
      method: 'POST',
      url: '/api/notifications/register',
      headers: auth(session),
      payload: { platform: 'web', endpoint: 'https://fcm.googleapis.com/fcm/send/abc123', keys: { p256dh: 'p256dh-value', auth: 'auth-value' } },
    });
    expect(res.statusCode).toBe(200);
  });

  it('unregister removes the token: a test-send afterwards finds no devices', async () => {
    const session = await register();
    await app.inject({ method: 'POST', url: '/api/notifications/register', headers: auth(session), payload: { platform: 'expo', token: 'ExponentPushToken[gone]' } });
    await app.inject({ method: 'DELETE', url: '/api/notifications/register', headers: auth(session), payload: { token: 'ExponentPushToken[gone]' } });
    const res = await app.inject({ method: 'POST', url: '/api/notifications/test', headers: auth(session) });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('push_no_devices');
  });

  it('test-send with no registered device fails honestly instead of pretending it sent something', async () => {
    const session = await register();
    const res = await app.inject({ method: 'POST', url: '/api/notifications/test', headers: auth(session) });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('push_no_devices');
  });

  it('test-send works even if the general/category toggles are off (it is a direct action, not an automated event)', async () => {
    const session = await register();
    await app.inject({ method: 'POST', url: '/api/notifications/register', headers: auth(session), payload: { platform: 'expo', token: 'ExponentPushToken[test-direct]' } });
    vi.stubGlobal('fetch', vi.fn(okTicket));
    const res = await app.inject({ method: 'POST', url: '/api/notifications/test', headers: auth(session) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ sent: 1, pruned: 0 });
  });

  it('an invalid token (DeviceNotRegistered) is pruned automatically after a failed send', async () => {
    const session = await register();
    await app.inject({ method: 'POST', url: '/api/notifications/register', headers: auth(session), payload: { platform: 'expo', token: 'ExponentPushToken[stale]' } });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [{ status: 'error', details: { error: 'DeviceNotRegistered' } }] }), { status: 200 })));
    const res = await app.inject({ method: 'POST', url: '/api/notifications/test', headers: auth(session) });
    expect(res.json()).toEqual({ sent: 0, pruned: 1 });
    // Ya no está: un segundo intento no encuentra dispositivos.
    const again = await app.inject({ method: 'POST', url: '/api/notifications/test', headers: auth(session) });
    expect(again.json().code).toBe('push_no_devices');
  });

  it('recording a service that reaches the loyalty goal pushes the business owner (closes the loop with Fase 2)', async () => {
    const session = await register();
    const item = await createItem(session);
    const client = await createClient(session);
    await app.inject({ method: 'PUT', url: '/api/loyalty/program', headers: auth(session), payload: { enabled: true, goal: 1, resetOnRedeem: true, rewardMessage: '', itemIds: [item.id] } });
    await app.inject({ method: 'PUT', url: '/api/notifications/settings', headers: auth(session), payload: { enabled: true, loyaltyEnabled: true, billingEnabled: true } });
    await app.inject({ method: 'POST', url: '/api/notifications/register', headers: auth(session), payload: { platform: 'expo', token: 'ExponentPushToken[loyalty]' } });
    const fetchMock = vi.fn(okTicket);
    vi.stubGlobal('fetch', fetchMock);

    await app.inject({ method: 'POST', url: '/api/service-records', headers: auth(session), payload: { clientId: client.id, itemId: item.id } });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls.at(-1)!;
    const sent = JSON.parse(init!.body as string);
    expect(sent).toMatchObject([{ to: 'ExponentPushToken[loyalty]', title: '🎉 Premio de fidelización', body: `${client.name} ya alcanzó la meta de fidelización.` }]);
  });

  it('reaching the goal without notifications enabled never touches the network', async () => {
    const session = await register();
    const item = await createItem(session);
    const client = await createClient(session);
    await app.inject({ method: 'PUT', url: '/api/loyalty/program', headers: auth(session), payload: { enabled: true, goal: 1, resetOnRedeem: true, rewardMessage: '', itemIds: [item.id] } });
    await app.inject({ method: 'POST', url: '/api/notifications/register', headers: auth(session), payload: { platform: 'expo', token: 'ExponentPushToken[unused]' } });
    const fetchMock = vi.fn(okTicket);
    vi.stubGlobal('fetch', fetchMock);

    const res = await app.inject({ method: 'POST', url: '/api/service-records', headers: auth(session), payload: { clientId: client.id, itemId: item.id } });
    expect(res.json()).toMatchObject({ rewardJustEarned: true }); // el sello y el premio se registran igual...
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetchMock).not.toHaveBeenCalled(); // ...pero sin el interruptor activado, nunca se intenta avisar por push.
  });

  it('settings, tokens and test-sends are isolated per business', async () => {
    const a = await register();
    await app.inject({ method: 'PUT', url: '/api/notifications/settings', headers: auth(a), payload: { enabled: true, loyaltyEnabled: true, billingEnabled: true } });
    await app.inject({ method: 'POST', url: '/api/notifications/register', headers: auth(a), payload: { platform: 'expo', token: 'ExponentPushToken[business-a]' } });

    const b = await register();
    const bSettings = await app.inject({ method: 'GET', url: '/api/notifications/settings', headers: auth(b) });
    expect(bSettings.json()).toEqual({ enabled: false, loyaltyEnabled: true, billingEnabled: true }); // no ve lo que A activó
    const bTest = await app.inject({ method: 'POST', url: '/api/notifications/test', headers: auth(b) });
    expect(bTest.json().code).toBe('push_no_devices'); // no hereda el token de A
    // B no puede borrar el token de A a ciegas (solo borra los suyos, no hay error si no encuentra nada).
    const bDelete = await app.inject({ method: 'DELETE', url: '/api/notifications/register', headers: auth(b), payload: { token: 'ExponentPushToken[business-a]' } });
    expect(bDelete.statusCode).toBe(200);
    vi.stubGlobal('fetch', vi.fn(okTicket));
    expect((await app.inject({ method: 'POST', url: '/api/notifications/test', headers: auth(a) })).statusCode).toBe(200); // el token de A sigue ahí
  });

  it('requires authentication on every notifications route', async () => {
    for (const req of [
      { method: 'GET' as const, url: '/api/notifications/settings' },
      { method: 'PUT' as const, url: '/api/notifications/settings' },
      { method: 'GET' as const, url: '/api/notifications/vapid-public-key' },
      { method: 'POST' as const, url: '/api/notifications/register' },
      { method: 'DELETE' as const, url: '/api/notifications/register' },
      { method: 'POST' as const, url: '/api/notifications/test' },
    ]) {
      expect((await app.inject(req)).statusCode).toBe(401);
    }
  });
});

describe('platform', () => {
  it('sets security headers and a CORS allowlist for private routes', async () => {
    const health = await app.inject({ method: 'GET', url: '/api/health' });
    expect(health.headers['x-content-type-options']).toBe('nosniff');
    const allowed = await app.inject({ method: 'OPTIONS', url: '/api/items', headers: { origin: 'http://localhost:8081', 'access-control-request-method': 'GET' } });
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:8081');
    const denied = await app.inject({ method: 'OPTIONS', url: '/api/items', headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' } });
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('returns JSON 404s for unknown API routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('not_found');
  });
});

describe('web app fallback', () => {
  it('serves the client app for its own routes (including /catalog) but keeps server paths as 404 JSON', async () => {
    const webDir = mkdtempSync(path.join(tmpdir(), 'xiro-web-'));
    writeFileSync(path.join(webDir, 'index.html'), '<!doctype html><title>Xiro app</title><div id="root"></div>');
    const web = await buildApp({
      db: testDb.db,
      config: { dataDir, mediaDir: path.join(dataDir, 'media'), jwtSecret: 'test-secret-test-secret-test-secret-123', rateLimit: { enabled: false }, webDir, exposeDevOtp: false },
    });
    try {
      for (const url of ['/', '/clients', '/catalog', '/catalog?x=1', '/catalog-item/abc', '/item/form?id=1']) {
        const res = await web.inject({ method: 'GET', url });
        expect(res.statusCode, url).toBe(200);
        expect(res.body, url).toContain('Xiro app');
      }
      // Catálogo público de un negocio: su propia página, no la app.
      const page = await web.inject({ method: 'GET', url: '/catalog/algun-negocio' });
      expect(page.statusCode).toBe(200);
      expect(page.body).not.toContain('Xiro app');
      expect(page.body).toContain('catalog.js');
      for (const url of ['/api/nope', '/media/none.png', '/catalog-assets/none.js']) {
        const res = await web.inject({ method: 'GET', url });
        expect(res.statusCode, url).toBe(404);
        expect(res.headers['content-type'], url).toContain('application/json');
      }
    } finally {
      await web.close();
      rmSync(webDir, { recursive: true, force: true });
    }
  });
});
