import type { AuthSession, Employee, EmployeePermission, User } from '@xiro/shared';
import type { FastifyInstance } from 'fastify';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type BuildOptions } from '../src/app';
import { auth, register } from './helpers/booking';
import { createTestDatabase, testAppConfig, type TestDatabase } from './helpers/db';
import { photoForm, realJpeg } from './helpers/media';

let testDb: TestDatabase;
let cleanups: Array<() => void> = [];
const apps: FastifyInstance[] = [];
let counter = 0;

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

async function createEmployee(app: FastifyInstance, owner: AuthSession, permissions: EmployeePermission[] = []): Promise<{ employee: Employee; email: string }> {
  counter += 1;
  const email = `empphoto${counter}@correo.com`;
  const created = await app.inject({ method: 'POST', url: '/api/employees', headers: auth(owner), payload: { name: `Empleado ${counter}`, email, password: 'Secreta123', permissions } });
  expect(created.statusCode).toBe(201);
  return { employee: created.json<Employee>(), email };
}

async function loginAs(app: FastifyInstance, email: string): Promise<AuthSession> {
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { identifier: email, password: 'Secreta123' } });
  expect(login.statusCode).toBe(200);
  return login.json<AuthSession>();
}

async function upload(app: FastifyInstance, session: { accessToken: string }, id: string, buffer: Buffer) {
  const { payload, contentType } = await photoForm(buffer);
  return app.inject({ method: 'PUT', url: `/api/employees/${id}/photo`, headers: { ...auth(session), 'content-type': contentType }, payload });
}

describe('foto de cuenta de un empleado, puesta por el dueño desde el panel', () => {
  it('sin foto se mantiene el avatar con iniciales (photoUrl en null)', async () => {
    const { app } = await makeApp();
    const owner = await register(app, 'SinFotoEmp');
    const { employee } = await createEmployee(app, owner);
    expect(employee.photoUrl).toBeNull();
  });

  it('el dueño sube una foto real: se recorta a 400×400 WebP y queda reflejada de inmediato en /employees', async () => {
    const { app, mediaDir } = await makeApp();
    const owner = await register(app, 'ConFotoEmp');
    const { employee } = await createEmployee(app, owner);
    const res = await upload(app, owner, employee.id, await realJpeg());
    expect(res.statusCode).toBe(200);
    const dto = res.json<Employee>();
    expect(dto.photoUrl).toMatch(/^\/media\/.+\.webp$/);

    const meta = await sharp(await readFile(path.join(mediaDir, path.basename(dto.photoUrl!)))).metadata();
    expect(meta).toMatchObject({ width: 400, height: 400, format: 'webp' });

    const list = (await app.inject({ method: 'GET', url: '/api/employees', headers: auth(owner) })).json<Employee[]>();
    expect(list.find((e) => e.id === employee.id)?.photoUrl).toBe(dto.photoUrl);
  });

  it('es la MISMA foto que el propio empleado ve y puede cambiar desde /me (una sola columna, un solo avatar)', async () => {
    const { app } = await makeApp();
    const owner = await register(app, 'MismaFotoEmp');
    const { employee, email } = await createEmployee(app, owner);
    const session = await loginAs(app, email);

    const byOwner = (await upload(app, owner, employee.id, await realJpeg())).json<Employee>();
    const me = (await app.inject({ method: 'GET', url: '/api/me', headers: auth(session) })).json<{ user: User }>().user;
    expect(me.photoUrl).toBe(byOwner.photoUrl);

    // El propio empleado también puede quitarla usando /me/photo (ya existente): ambos caminos tocan la misma columna.
    const removedBySelf = await app.inject({ method: 'DELETE', url: '/api/me/photo', headers: auth(session) });
    expect(removedBySelf.statusCode).toBe(200);
    const list = (await app.inject({ method: 'GET', url: '/api/employees', headers: auth(owner) })).json<Employee[]>();
    expect(list.find((e) => e.id === employee.id)?.photoUrl).toBeNull();
  });

  it('reemplazar la foto borra la anterior del disco; quitarla también la borra y no falla si ya estaba vacía', async () => {
    const { app, mediaDir } = await makeApp();
    const owner = await register(app, 'ReemplazoEmp');
    const { employee } = await createEmployee(app, owner);
    const first = (await upload(app, owner, employee.id, await realJpeg())).json<Employee>();
    const firstFile = path.basename(first.photoUrl!);
    const second = (await upload(app, owner, employee.id, await realJpeg(500, 900))).json<Employee>();
    expect(await readdir(mediaDir)).not.toContain(firstFile);
    expect(await readdir(mediaDir)).toContain(path.basename(second.photoUrl!));

    const removed = await app.inject({ method: 'DELETE', url: `/api/employees/${employee.id}/photo`, headers: auth(owner) });
    expect(removed.json<Employee>().photoUrl).toBeNull();
    expect(await readdir(mediaDir)).toEqual([]);
    const again = await app.inject({ method: 'DELETE', url: `/api/employees/${employee.id}/photo`, headers: auth(owner) });
    expect(again.statusCode).toBe(200);
  });

  it('archivo que no es una imagen se rechaza y no queda nada guardado', async () => {
    const { app, mediaDir } = await makeApp();
    const owner = await register(app, 'InvalidaEmp');
    const { employee } = await createEmployee(app, owner);
    const bad = await upload(app, owner, employee.id, Buffer.from('no es una imagen'));
    expect(bad.statusCode).toBe(400);
    expect(bad.json().code).toBe('photo_invalid');
    await expect(readdir(mediaDir)).resolves.toEqual([]);
  });

  it('solo el dueño puede subir o quitar la foto de un empleado por esta ruta (ni otro empleado, ni el propio)', async () => {
    const { app } = await makeApp();
    const owner = await register(app, 'PermisosEmp');
    const { employee, email } = await createEmployee(app, owner, ['clients_manage']);
    await createEmployee(app, owner, []); // otro empleado cualquiera, para no confundirlo con "employee"
    const selfSession = await loginAs(app, email);

    expect((await upload(app, selfSession, employee.id, await realJpeg())).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: `/api/employees/${employee.id}/photo`, headers: auth(selfSession) })).statusCode).toBe(403);
  });

  it('aislamiento entre negocios: ni sube ni quita la foto de un empleado de OTRO negocio (404)', async () => {
    const { app } = await makeApp();
    const ownerA = await register(app, 'NegocioEmpA');
    const ownerB = await register(app, 'NegocioEmpB');
    const { employee: employeeB } = await createEmployee(app, ownerB);

    expect((await upload(app, ownerA, employeeB.id, await realJpeg())).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/api/employees/${employeeB.id}/photo`, headers: auth(ownerA) })).statusCode).toBe(404);
  });
});
