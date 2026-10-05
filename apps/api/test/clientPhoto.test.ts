import type { AuthSession, Client } from '@xiro/shared';
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

async function createClient(app: FastifyInstance, session: AuthSession, name = 'Ana Pérez'): Promise<Client> {
  const res = await app.inject({ method: 'POST', url: '/api/clients', headers: auth(session), payload: { name } });
  expect(res.statusCode).toBe(201);
  return res.json<Client>();
}

async function upload(app: FastifyInstance, session: { accessToken: string }, id: string, buffer: Buffer) {
  const { payload, contentType } = await photoForm(buffer);
  return app.inject({ method: 'PUT', url: `/api/clients/${id}/photo`, headers: { ...auth(session), 'content-type': contentType }, payload });
}

describe('foto de un cliente: subir, cambiar, quitar (100% opcional)', () => {
  it('sin foto se mantiene el avatar con iniciales (photoUrl en null)', async () => {
    const { app } = await makeApp();
    const session = await register(app, 'SinFotoCliente');
    const client = await createClient(app, session);
    expect(client.photoUrl).toBeNull();
    const fetched = (await app.inject({ method: 'GET', url: `/api/clients/${client.id}`, headers: auth(session) })).json<Client>();
    expect(fetched.photoUrl).toBeNull();
  });

  it('subir una foto real: se recorta a 400×400 WebP y queda reflejada de inmediato', async () => {
    const { app, mediaDir } = await makeApp();
    const session = await register(app, 'ConFotoCliente');
    const client = await createClient(app, session);
    const res = await upload(app, session, client.id, await realJpeg());
    expect(res.statusCode).toBe(200);
    const dto = res.json<Client>();
    expect(dto.photoUrl).toMatch(/^\/media\/.+\.webp$/);

    const meta = await sharp(await readFile(path.join(mediaDir, path.basename(dto.photoUrl!)))).metadata();
    expect(meta).toMatchObject({ width: 400, height: 400, format: 'webp' });
  });

  it('reemplazar la foto borra la anterior del disco (sin archivos huérfanos)', async () => {
    const { app, mediaDir } = await makeApp();
    const session = await register(app, 'ReemplazoCliente');
    const client = await createClient(app, session);
    const first = (await upload(app, session, client.id, await realJpeg())).json<Client>();
    const firstFile = path.basename(first.photoUrl!);
    const second = (await upload(app, session, client.id, await realJpeg(500, 900))).json<Client>();
    expect(second.photoUrl).not.toBe(first.photoUrl);
    const files = await readdir(mediaDir);
    expect(files).not.toContain(firstFile);
    expect(files).toContain(path.basename(second.photoUrl!));
  });

  it('quitar la foto vuelve al avatar con iniciales y borra el archivo; quitarla de nuevo no falla', async () => {
    const { app, mediaDir } = await makeApp();
    const session = await register(app, 'QuitarCliente');
    const client = await createClient(app, session);
    const uploaded = (await upload(app, session, client.id, await realJpeg())).json<Client>();
    const file = path.basename(uploaded.photoUrl!);

    const removed = await app.inject({ method: 'DELETE', url: `/api/clients/${client.id}/photo`, headers: auth(session) });
    expect(removed.statusCode).toBe(200);
    expect(removed.json<Client>().photoUrl).toBeNull();
    expect(await readdir(mediaDir)).not.toContain(file);

    const again = await app.inject({ method: 'DELETE', url: `/api/clients/${client.id}/photo`, headers: auth(session) });
    expect(again.statusCode).toBe(200);
    expect(again.json<Client>().photoUrl).toBeNull();
  });

  it('archivo que no es una imagen se rechaza y no queda nada guardado', async () => {
    const { app, mediaDir } = await makeApp();
    const session = await register(app, 'InvalidaCliente');
    const client = await createClient(app, session);
    const notAnImage = await upload(app, session, client.id, Buffer.from('esto no es una imagen'));
    expect(notAnImage.statusCode).toBe(400);
    expect(notAnImage.json().code).toBe('photo_invalid');
    await expect(readdir(mediaDir)).resolves.toEqual([]);
  });

  it('un empleado sin "clientes: gestionar" no puede subir ni quitar; con el permiso, sí', async () => {
    const { app } = await makeApp();
    const session = await register(app, 'PermisosCliente');
    const client = await createClient(app, session);
    const sinPermiso = await createEmployee(app, session, ['clients_view']);
    const conPermiso = await createEmployee(app, session, ['clients_manage']);

    expect((await upload(app, sinPermiso.session, client.id, await realJpeg())).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: `/api/clients/${client.id}/photo`, headers: auth(sinPermiso.session) })).statusCode).toBe(403);
    expect((await upload(app, conPermiso.session, client.id, await realJpeg())).statusCode).toBe(200);
  });

  it('aislamiento entre negocios: ni sube ni quita la foto de un cliente de OTRO negocio (404)', async () => {
    const { app } = await makeApp();
    const sessionA = await register(app, 'NegocioClienteA');
    const sessionB = await register(app, 'NegocioClienteB');
    const clientB = await createClient(app, sessionB);

    expect((await upload(app, sessionA, clientB.id, await realJpeg())).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/api/clients/${clientB.id}/photo`, headers: auth(sessionA) })).statusCode).toBe(404);

    const untouched = (await app.inject({ method: 'GET', url: `/api/clients/${clientB.id}`, headers: auth(sessionB) })).json<Client>();
    expect(untouched.photoUrl).toBeNull();
  });

  it('el derecho de supresión (anonymize) también borra la foto del cliente, del disco incluido', async () => {
    const { app, mediaDir } = await makeApp();
    const session = await register(app, 'AnonimizarCliente');
    const client = await createClient(app, session);
    const uploaded = (await upload(app, session, client.id, await realJpeg())).json<Client>();
    const file = path.basename(uploaded.photoUrl!);

    const anonymized = await app.inject({ method: 'POST', url: `/api/clients/${client.id}/anonymize`, headers: auth(session) });
    expect(anonymized.statusCode).toBe(200);
    expect(anonymized.json<Client>().photoUrl).toBeNull();
    expect(await readdir(mediaDir)).not.toContain(file);
  });

  it('eliminar el cliente borra también su foto del disco', async () => {
    const { app, mediaDir } = await makeApp();
    const session = await register(app, 'EliminarCliente');
    const client = await createClient(app, session);
    const uploaded = (await upload(app, session, client.id, await realJpeg())).json<Client>();
    const file = path.basename(uploaded.photoUrl!);

    const deleted = await app.inject({ method: 'DELETE', url: `/api/clients/${client.id}`, headers: auth(session) });
    expect(deleted.statusCode).toBe(204);
    expect(await readdir(mediaDir)).not.toContain(file);
  });
});
