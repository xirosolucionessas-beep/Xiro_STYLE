import type { ClientAccountDto } from '@xiro/shared';
import type { FastifyInstance } from 'fastify';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type BuildOptions } from '../src/app';
import { setupBiz, type Biz } from './helpers/booking';
import { createTestDatabase, testAppConfig, type TestDatabase } from './helpers/db';
import { photoForm, realJpeg } from './helpers/media';

let testDb: TestDatabase;
let cleanups: Array<() => void> = [];
const apps: FastifyInstance[] = [];

async function makeApp(config: BuildOptions['config'] = {}) {
  const setup = testAppConfig(config);
  cleanups.push(setup.cleanup);
  const instance = await buildApp({ db: testDb.db, config: setup.config });
  apps.push(instance);
  return { app: instance, mediaDir: setup.config.mediaDir! };
}

beforeAll(async () => {
  testDb = await createTestDatabase();
});
afterAll(async () => {
  await Promise.all(apps.map((a) => a.close()));
  cleanups.forEach((fn) => fn());
  await testDb.drop();
});

function sessionCookie(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || typeof value !== 'string') throw new Error('se esperaba Set-Cookie');
  return value.split(';')[0]!;
}

async function registerClient(app: FastifyInstance, biz: Biz): Promise<string> {
  const res = await app.inject({ method: 'POST', url: `${biz.base}/account/register`, payload: { name: 'Cliente Prueba', phone: `3${Math.floor(100000000 + Math.random() * 899999999)}`, password: 'Clavesegura1', acceptTerms: true } });
  expect(res.statusCode).toBe(201);
  return sessionCookie(res);
}

async function upload(app: FastifyInstance, biz: Biz, cookie: string, buffer: Buffer) {
  const { payload, contentType } = await photoForm(buffer);
  return app.inject({ method: 'PUT', url: `${biz.base}/account/photo`, headers: { cookie, 'content-type': contentType }, payload });
}

describe('foto de perfil de la cuenta de cliente (opcional, página pública)', () => {
  it('sin foto, /account/me trae photoUrl en null', async () => {
    const { app } = await makeApp();
    const biz = await setupBiz(app, 'SinFotoCliente');
    const cookie = await registerClient(app, biz);
    const me = await app.inject({ method: 'GET', url: `${biz.base}/account/me`, headers: { cookie } });
    expect(me.json<ClientAccountDto>().photoUrl).toBeNull();
  });

  it('sube y cambia su foto; la anterior no queda huérfana en disco', async () => {
    const { app, mediaDir } = await makeApp();
    const biz = await setupBiz(app, 'ConFotoCliente');
    const cookie = await registerClient(app, biz);

    const first = await upload(app, biz, cookie, await realJpeg());
    expect(first.statusCode).toBe(200);
    const firstAccount = first.json<ClientAccountDto>();
    expect(firstAccount.photoUrl).toMatch(/^\/media\/.+\.webp$/);
    const meta = await sharp(await readFile(path.join(mediaDir, path.basename(firstAccount.photoUrl!)))).metadata();
    expect(meta).toMatchObject({ width: 400, height: 400, format: 'webp' });

    const second = await upload(app, biz, cookie, await realJpeg(500, 900));
    expect(second.statusCode).toBe(200);
    expect(second.json<ClientAccountDto>().photoUrl).not.toBe(firstAccount.photoUrl);
    expect(await readdir(mediaDir)).not.toContain(path.basename(firstAccount.photoUrl!)); // sin huérfanos al reemplazar
  });

  it('un archivo que no es una imagen se rechaza y no toca la foto que ya tenía', async () => {
    const { app } = await makeApp();
    const biz = await setupBiz(app, 'FotoInvalidaCliente');
    const cookie = await registerClient(app, biz);
    const good = await upload(app, biz, cookie, await realJpeg());
    const goodUrl = good.json<ClientAccountDto>().photoUrl;

    const bad = await upload(app, biz, cookie, Buffer.from('esto no es una imagen'));
    expect(bad.statusCode).toBe(400);
    expect(bad.json().code).toBe('photo_invalid');

    const me = await app.inject({ method: 'GET', url: `${biz.base}/account/me`, headers: { cookie } });
    expect(me.json<ClientAccountDto>().photoUrl).toBe(goodUrl);
  });

  it('sin sesión, la subida se rechaza (no se puede poner foto a una cuenta ajena ni anónima)', async () => {
    const { app } = await makeApp();
    const biz = await setupBiz(app, 'SinSesionCliente');
    const { payload, contentType } = await photoForm(await realJpeg());
    const res = await app.inject({ method: 'PUT', url: `${biz.base}/account/photo`, headers: { 'content-type': contentType }, payload });
    expect(res.statusCode).toBe(401);
  });

  it('eliminar la cuenta borra también el archivo de la foto (sin huérfanos)', async () => {
    const { app, mediaDir } = await makeApp();
    const biz = await setupBiz(app, 'BorraFotoCliente');
    const cookie = await registerClient(app, biz);
    const uploaded = await upload(app, biz, cookie, await realJpeg());
    const photoUrl = uploaded.json<ClientAccountDto>().photoUrl!;
    expect(await readdir(mediaDir)).toContain(path.basename(photoUrl));

    const deleted = await app.inject({ method: 'DELETE', url: `${biz.base}/account`, headers: { cookie }, payload: { password: 'Clavesegura1' } });
    expect(deleted.statusCode).toBe(204);
    expect(await readdir(mediaDir)).not.toContain(path.basename(photoUrl));
  });

  it('una sesión de OTRO negocio no puede poner ni ver esta foto', async () => {
    const { app } = await makeApp();
    const bizA = await setupBiz(app, 'NegocioFotoA');
    const bizB = await setupBiz(app, 'NegocioFotoB');
    const cookieA = await registerClient(app, bizA);
    await upload(app, bizA, cookieA, await realJpeg());

    // La cookie de A tiene Path=/api/public/booking/<slugA>: un navegador real nunca la mandaría a B. Simulamos el
    // intento igual (reenviándola a mano) para confirmar que el servidor también lo rechaza, no solo el navegador.
    const crossAttempt = await upload(app, bizB, cookieA, await realJpeg());
    expect(crossAttempt.statusCode).toBe(401);
  });
});
