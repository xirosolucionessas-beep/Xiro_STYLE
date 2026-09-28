import type { BookingAdminSettings, ProfessionalDto, PublicTeamMemberDto } from '@xiro/shared';
import type { FastifyInstance } from 'fastify';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type BuildOptions } from '../src/app';
import { auth, createEmployee, setupBiz } from './helpers/booking';
import { createTestDatabase, testAppConfig, type TestDatabase } from './helpers/db';

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

/** Una imagen real (sharp la puede decodificar de verdad), para que el recorte/redimensionado del servidor no falle. */
async function realJpeg(width = 900, height = 500): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 180, g: 90, b: 30 } } })
    .jpeg()
    .toBuffer();
}

async function photoForm(buffer: Buffer, filename = 'foto.jpg'): Promise<{ payload: Buffer; contentType: string }> {
  const data = new FormData();
  data.append('photo', new Blob([new Uint8Array(buffer)], { type: 'image/jpeg' }), filename);
  const response = new Response(data);
  return { payload: Buffer.from(await response.arrayBuffer()), contentType: response.headers.get('content-type')! };
}

async function upload(app: FastifyInstance, session: { accessToken: string }, id: string, buffer: Buffer) {
  const { payload, contentType } = await photoForm(buffer);
  return app.inject({ method: 'PUT', url: `/api/professionals/${id}/photo`, headers: { ...auth(session), 'content-type': contentType }, payload });
}

describe('foto de un profesional: subir, cambiar, quitar', () => {
  it('sin foto la inicial sigue funcionando en el panel y en la página pública (opcional de verdad)', async () => {
    const { app } = await makeApp();
    const biz = await setupBiz(app, 'SinFoto');
    const list = (await app.inject({ method: 'GET', url: '/api/professionals', headers: auth(biz.session) })).json<ProfessionalDto[]>();
    expect(list[0]).toMatchObject({ photoUrl: null });
    const team = (await app.inject({ method: 'GET', url: `${biz.base}/team` })).json<PublicTeamMemberDto[]>();
    expect(team[0]).toMatchObject({ photoUrl: null });
  });

  it('subir una foto real: se recorta a 400×400 WebP, se refleja de inmediato en el panel y en la página pública', async () => {
    const { app, mediaDir } = await makeApp();
    const biz = await setupBiz(app, 'ConFoto');
    const res = await upload(app, biz.session, biz.ownerId, await realJpeg());
    expect(res.statusCode).toBe(200);
    const dto = res.json<ProfessionalDto>();
    expect(dto.photoUrl).toMatch(/^\/media\/.+\.webp$/);

    const meta = await sharp(await readFile(path.join(mediaDir, path.basename(dto.photoUrl!)))).metadata();
    expect(meta).toMatchObject({ width: 400, height: 400, format: 'webp' });

    // Sin recargar nada más: el mismo GET ya trae la foto.
    const team = (await app.inject({ method: 'GET', url: `${biz.base}/team` })).json<PublicTeamMemberDto[]>();
    expect(team[0]!.photoUrl).toBe(dto.photoUrl);
  });

  it('reemplazar la foto borra la anterior del disco (sin archivos huérfanos)', async () => {
    const { app, mediaDir } = await makeApp();
    const biz = await setupBiz(app, 'Reemplazo');
    const first = (await upload(app, biz.session, biz.ownerId, await realJpeg())).json<ProfessionalDto>();
    const firstFile = path.basename(first.photoUrl!);
    const second = (await upload(app, biz.session, biz.ownerId, await realJpeg(500, 900))).json<ProfessionalDto>();
    expect(second.photoUrl).not.toBe(first.photoUrl);
    const files = await readdir(mediaDir);
    expect(files).not.toContain(firstFile);
    expect(files).toContain(path.basename(second.photoUrl!));
  });

  it('quitar la foto vuelve a la inicial y borra el archivo; quitarla de nuevo no falla', async () => {
    const { app, mediaDir } = await makeApp();
    const biz = await setupBiz(app, 'Quitar');
    const uploaded = (await upload(app, biz.session, biz.ownerId, await realJpeg())).json<ProfessionalDto>();
    const file = path.basename(uploaded.photoUrl!);

    const removed = await app.inject({ method: 'DELETE', url: `/api/professionals/${biz.ownerId}/photo`, headers: auth(biz.session) });
    expect(removed.statusCode).toBe(200);
    expect(removed.json<ProfessionalDto>().photoUrl).toBeNull();
    expect(await readdir(mediaDir)).not.toContain(file);

    // Sin foto que quitar: no revienta, y sigue en null.
    const again = await app.inject({ method: 'DELETE', url: `/api/professionals/${biz.ownerId}/photo`, headers: auth(biz.session) });
    expect(again.statusCode).toBe(200);
    expect(again.json<ProfessionalDto>().photoUrl).toBeNull();
  });

  it('archivo que no es una imagen, o pesa de más: se rechaza con un mensaje claro y no queda nada guardado', async () => {
    const { app, mediaDir } = await makeApp();
    const biz = await setupBiz(app, 'Invalida');
    const notAnImage = await upload(app, biz.session, biz.ownerId, Buffer.from('esto no es una imagen, es solo texto'));
    expect(notAnImage.statusCode).toBe(400);
    expect(notAnImage.json().code).toBe('photo_invalid');

    // Más de 5 MB: el propio servidor de multipart lo corta (413), igual que en las demás subidas de fotos de la app.
    const tooBig = Buffer.concat([await realJpeg(4000, 4000), Buffer.alloc(6 * 1024 * 1024)]);
    const oversize = await upload(app, biz.session, biz.ownerId, tooBig);
    expect(oversize.statusCode).toBe(413);
    expect(oversize.json().code).toBe('photo_invalid');

    await expect(readdir(mediaDir)).resolves.toEqual([]);
  });

  it('solo el dueño, o un empleado con el permiso de la página pública, puede subir o quitar fotos', async () => {
    const { app } = await makeApp();
    const biz = await setupBiz(app, 'Permisos');
    const sinPermiso = await createEmployee(app, biz.session, []);
    const conPermiso = await createEmployee(app, biz.session, ['public_page_manage']);

    expect((await upload(app, sinPermiso.session, biz.ownerId, await realJpeg())).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: `/api/professionals/${biz.ownerId}/photo`, headers: auth(sinPermiso.session) })).statusCode).toBe(403);

    const ok = await upload(app, conPermiso.session, biz.ownerId, await realJpeg());
    expect(ok.statusCode).toBe(200);
  });

  it('aislamiento entre negocios: ni sube ni quita la foto de un profesional de OTRO negocio (404, sin confirmar que exista)', async () => {
    const { app } = await makeApp();
    const biz = await setupBiz(app, 'NegocioA');
    const other = await setupBiz(app, 'NegocioB');

    const upl = await upload(app, biz.session, other.ownerId, await realJpeg());
    expect(upl.statusCode).toBe(404);
    const del = await app.inject({ method: 'DELETE', url: `/api/professionals/${other.ownerId}/photo`, headers: auth(biz.session) });
    expect(del.statusCode).toBe(404);

    // La del otro negocio sigue intacta.
    const untouched = (await app.inject({ method: 'GET', url: '/api/professionals', headers: auth(other.session) })).json<ProfessionalDto[]>();
    expect(untouched.find((p) => p.id === other.ownerId)?.photoUrl).toBeNull();
  });

  it('un empleado no puede tocar la foto de otra persona sin "toda la agenda" ni "página pública"', async () => {
    const { app } = await makeApp();
    const biz = await setupBiz(app, 'EntreEmpleados');
    const luis = await createEmployee(app, biz.session, ['agenda_own']);
    expect((await upload(app, luis.session, biz.ownerId, await realJpeg())).statusCode).toBe(403);
  });

  it('más de 20 subidas o borrados en un minuto, para el mismo negocio: 429 con Retry-After', async () => {
    const { app } = await makeApp({ rateLimit: { enabled: true, globalPerMinute: 100_000, userPerMinute: 100_000, authPerMinute: 100_000 } });
    const biz = await setupBiz(app, 'LimiteFotos');
    const image = await realJpeg();
    const codes: number[] = [];
    for (let i = 0; i < 22; i += 1) codes.push((await upload(app, biz.session, biz.ownerId, image)).statusCode);
    expect(codes.slice(0, 20).every((c) => c === 200)).toBe(true);
    expect(codes.slice(20)).toEqual([429, 429]);
    const blocked = await upload(app, biz.session, biz.ownerId, image);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['retry-after']).toBeTruthy();
  });
});
