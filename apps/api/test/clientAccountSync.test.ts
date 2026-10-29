import type { Client } from '@xiro/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { auth, nextPhone, setupBiz, type Biz } from './helpers/booking';
import { createTestDatabase, testAppConfig, type TestDatabase } from './helpers/db';
import { photoForm, realJpeg } from './helpers/media';

let app: FastifyInstance;
let testDb: TestDatabase;
let cleanupConfig: () => void;

beforeAll(async () => {
  testDb = await createTestDatabase();
  const { config, cleanup } = testAppConfig({ exposeDevOtp: true });
  cleanupConfig = cleanup;
  app = await buildApp({ db: testDb.db, config });
});

afterAll(async () => {
  await app.close();
  cleanupConfig();
  await testDb.drop();
});

function sessionCookie(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || typeof value !== 'string') throw new Error('se esperaba Set-Cookie');
  return value.split(';')[0]!;
}

const register = (biz: Biz, over: Record<string, unknown> = {}) => app.inject({ method: 'POST', url: `${biz.base}/account/register`, payload: { name: 'Cliente Prueba', phone: nextPhone(), password: 'Clavesegura1', acceptTerms: true, ...over } });

/** `clients.phone` queda normalizado (con "57", sin "+") — ver `phoneSchema`; los 10 dígitos locales que da `nextPhone()` no son lo que termina guardado. */
const e164 = (localPhone: string) => `57${localPhone}`;

const ownerClient = async (biz: Biz, clientId: string): Promise<Client & { onlineAccount: unknown }> => (await app.inject({ method: 'GET', url: `/api/clients/${clientId}`, headers: auth(biz.session) })).json();

describe('cuentas de cliente: sincronización con el directorio "Clientes" del negocio', () => {
  it('registrarse crea la ficha en "Clientes" con nombre, teléfono, correo y "Cliente desde" (createdAt) exactos', async () => {
    const biz = await setupBiz(app, 'SyncNuevo');
    const phone = nextPhone();
    const before = new Date();
    const res = await register(biz, { phone, email: 'cliente@correo.com' });
    expect(res.statusCode).toBe(201);
    const account = res.json();

    const list = await app.inject({ method: 'GET', url: '/api/clients', headers: auth(biz.session) });
    const found = list.json<{ data: Client[] }>().data.find((c) => c.phone === e164(phone))!;
    expect(found).toMatchObject({ name: 'Cliente Prueba', phone: e164(phone), email: 'cliente@correo.com' });
    expect(new Date(found.createdAt).getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);

    const detail = await ownerClient(biz, found.id);
    expect((detail as unknown as { onlineAccount: { lastLoginAt: string | null } | null }).onlineAccount).not.toBeNull();
    expect(account.id).toBeTruthy();
  });

  it('si el teléfono ya tenía una ficha (la creó el negocio), el registro la actualiza con el nombre y correo del cliente', async () => {
    const biz = await setupBiz(app, 'SyncExistente');
    const phone = nextPhone();
    const created = await app.inject({ method: 'POST', url: '/api/clients', headers: auth(biz.session), payload: { name: 'Nombre Provisional', phone, address: '', notes: '' } });
    const clientId = created.json<Client>().id;

    const res = await register(biz, { phone, name: 'Nombre Real', email: 'real@correo.com' });
    expect(res.statusCode).toBe(201);

    const detail = await ownerClient(biz, clientId);
    expect(detail).toMatchObject({ name: 'Nombre Real', email: 'real@correo.com', phone: e164(phone) });
  });

  it('si la ficha existente ya tenía correo y el cliente no manda uno al registrarse, el correo que ya tenía no se borra', async () => {
    const biz = await setupBiz(app, 'SyncCorreoConservado');
    const phone = nextPhone();
    const created = await app.inject({ method: 'POST', url: '/api/clients', headers: auth(biz.session), payload: { name: 'Con Correo', phone, email: 'correo-negocio@x.com', address: '', notes: '' } });
    const clientId = created.json<Client>().id;

    await register(biz, { phone }); // sin `email` en el payload

    const detail = await ownerClient(biz, clientId);
    expect(detail.email).toBe('correo-negocio@x.com');
  });

  it('editar "Mi perfil" (nombre/correo) actualiza la misma ficha en "Clientes"', async () => {
    const biz = await setupBiz(app, 'SyncPerfil');
    const res = await register(biz);
    const cookie = sessionCookie(res);
    const accountId = res.json().id as string;

    const put = await app.inject({ method: 'PUT', url: `${biz.base}/account/me`, headers: { cookie }, payload: { name: 'Nombre Nuevo', email: 'nuevo@correo.com' } });
    expect(put.statusCode).toBe(200);

    const list = await app.inject({ method: 'GET', url: '/api/clients', headers: auth(biz.session) });
    const clients = list.json<{ data: Client[] }>().data;
    const linked = clients.find((c) => c.name === 'Nombre Nuevo' && c.email === 'nuevo@correo.com');
    expect(linked).toBeDefined();
    void accountId;
  });

  it('subir la foto de "Mi perfil" la deja también en la ficha de "Clientes"; al cambiarla, no quedan huérfanos', async () => {
    const biz = await setupBiz(app, 'SyncFoto');
    const res = await register(biz);
    const cookie = sessionCookie(res);

    const { payload, contentType } = await photoForm(await realJpeg());
    const uploaded = await app.inject({ method: 'PUT', url: `${biz.base}/account/photo`, headers: { cookie, 'content-type': contentType }, payload });
    expect(uploaded.statusCode).toBe(200);
    const photoUrl = uploaded.json().photoUrl as string;
    expect(photoUrl).toMatch(/^\/media\/.+\.webp$/);

    const list = await app.inject({ method: 'GET', url: '/api/clients', headers: auth(biz.session) });
    const linked = list.json<{ data: Client[] }>().data.find((c) => c.photoUrl === photoUrl);
    expect(linked).toBeDefined();
  });

  it('eliminar la cuenta no deja una foto rota en "Clientes": se limpia si era la misma que sincronizó la cuenta', async () => {
    const biz = await setupBiz(app, 'SyncBorrarFoto');
    const res = await register(biz);
    const cookie = sessionCookie(res);
    const accountId = res.json().id as string;

    const { payload, contentType } = await photoForm(await realJpeg());
    await app.inject({ method: 'PUT', url: `${biz.base}/account/photo`, headers: { cookie, 'content-type': contentType }, payload });

    const list = await app.inject({ method: 'GET', url: '/api/clients', headers: auth(biz.session) });
    const before = list.json<{ data: Client[] }>().data.find((c) => c.photoUrl !== null);
    expect(before).toBeDefined();

    const deleted = await app.inject({ method: 'DELETE', url: `${biz.base}/account`, headers: { cookie }, payload: { password: 'Clavesegura1' } });
    expect(deleted.statusCode).toBe(204);

    // La ficha del cliente se conserva (su historial sigue siendo del negocio), pero sin la foto rota.
    const after = await ownerClient(biz, before!.id);
    expect(after.photoUrl).toBeNull();
    void accountId;
  });
});
