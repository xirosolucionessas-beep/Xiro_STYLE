import type { AuthSession, User } from '@xiro/shared';
import type { FastifyInstance } from 'fastify';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type BuildOptions } from '../src/app';
import { auth, createEmployee, register } from './helpers/booking';
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

async function upload(app: FastifyInstance, session: { accessToken: string }, buffer: Buffer) {
  const { payload, contentType } = await photoForm(buffer);
  return app.inject({ method: 'PUT', url: '/api/me/photo', headers: { ...auth(session), 'content-type': contentType }, payload });
}

describe('foto de la propia cuenta (dueño o empleado)', () => {
  it('sin foto, /me trae photoUrl en null (opcional de verdad)', async () => {
    const { app } = await makeApp();
    const session = await register(app, 'SinFoto');
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: auth(session) });
    expect(me.json<{ user: User }>().user.photoUrl).toBeNull();
  });

  it('el dueño sube, cambia y quita su foto; el archivo anterior no queda huérfano', async () => {
    const { app, mediaDir } = await makeApp();
    const session = await register(app, 'ConFoto');

    const first = await upload(app, session, await realJpeg());
    expect(first.statusCode).toBe(200);
    const firstUser = first.json<User>();
    expect(firstUser.photoUrl).toMatch(/^\/media\/.+\.webp$/);
    const meta = await sharp(await readFile(path.join(mediaDir, path.basename(firstUser.photoUrl!)))).metadata();
    expect(meta).toMatchObject({ width: 400, height: 400, format: 'webp' });

    const second = await upload(app, session, await realJpeg(500, 900));
    expect(second.json<User>().photoUrl).not.toBe(firstUser.photoUrl);
    expect(await readdir(mediaDir)).not.toContain(path.basename(firstUser.photoUrl!)); // sin huérfanos al reemplazar

    const removed = await app.inject({ method: 'DELETE', url: '/api/me/photo', headers: auth(session) });
    expect(removed.statusCode).toBe(200);
    expect(removed.json<User>().photoUrl).toBeNull();
    expect(await readdir(mediaDir)).toEqual([]); // sin huérfanos al quitarla

    // Quitarla de nuevo (ya no hay ninguna): no revienta.
    const again = await app.inject({ method: 'DELETE', url: '/api/me/photo', headers: auth(session) });
    expect(again.statusCode).toBe(200);
    expect(again.json<User>().photoUrl).toBeNull();
  });

  it('un empleado también puede poner su propia foto, y solo afecta a SU cuenta', async () => {
    const { app } = await makeApp();
    const owner = await register(app, 'Equipo');
    const { session: employee } = await createEmployee(app, owner, []);

    const uploaded = await upload(app, employee, await realJpeg());
    expect(uploaded.statusCode).toBe(200);
    expect(uploaded.json<User>().photoUrl).toMatch(/^\/media\//);

    const ownerMe = await app.inject({ method: 'GET', url: '/api/me', headers: auth(owner) });
    expect(ownerMe.json<{ user: User }>().user.photoUrl).toBeNull(); // el dueño no se ve afectado
  });

  it('archivo que no es una imagen: se rechaza y no toca la foto que ya tenía', async () => {
    const { app } = await makeApp();
    const session = await register(app, 'Invalida');
    const good = await upload(app, session, await realJpeg());
    const goodUrl = good.json<User>().photoUrl;

    const bad = await upload(app, session, Buffer.from('esto no es una imagen'));
    expect(bad.statusCode).toBe(400);
    expect(bad.json().code).toBe('photo_invalid');

    const me = await app.inject({ method: 'GET', url: '/api/me', headers: auth(session) });
    expect(me.json<{ user: User }>().user.photoUrl).toBe(goodUrl); // conserva la anterior
  });

  it('una sesión de OTRO negocio no ve ni puede afectar esta foto', async () => {
    const { app } = await makeApp();
    const mine = await register(app, 'MiNegocio');
    const other: AuthSession = await register(app, 'OtroNegocio');
    await upload(app, mine, await realJpeg());

    const otherMe = await app.inject({ method: 'GET', url: '/api/me', headers: auth(other) });
    expect(otherMe.json<{ user: User }>().user.photoUrl).toBeNull();
  });
});
