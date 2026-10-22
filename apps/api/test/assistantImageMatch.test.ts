import { fingerprintImage, imageSimilarity } from '../src/assistant/imageMatch';
import type { AuthSession, ImageMatchResult } from '@xiro/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { items } from '../src/db/schema';
import { auth, createEmployee, firstCategoryId, register } from './helpers/booking';
import { createTestDatabase, testAppConfig, type TestDatabase } from './helpers/db';
import { photoForm } from './helpers/media';

/**
 * "Asistente de IA" — foto de un producto comparada con el inventario, EN LOCAL (ver src/assistant/imageMatch.ts):
 * decisión explícita del negocio de no mandar la foto a ningún servicio externo. Reconoce la MISMA foto (o una
 * recomprimida/reescalada), no hace reconocimiento semántico de objetos — por eso las pruebas usan imágenes con
 * estructura real (dos mitades de color), no un solo color plano (ahí el "hash de diferencia" no distingue nada).
 */
let app: FastifyInstance;
let testDb: TestDatabase;
let cleanupConfig: () => void;

beforeAll(async () => {
  testDb = await createTestDatabase();
  const { config, cleanup } = testAppConfig();
  cleanupConfig = cleanup;
  app = await buildApp({ db: testDb.db, config });
});
afterAll(async () => {
  await app.close();
  cleanupConfig();
  await testDb.drop();
});

type Color = { r: number; g: number; b: number };

/** Imagen con estructura real (dos mitades de color, una junto a la otra): a diferencia de un color plano, esto le
 * da al "hash de diferencia" bordes de verdad que comparar. */
async function splitImage(left: Color, right: Color, width = 400, height = 300): Promise<Buffer> {
  const halfWidth = Math.floor(width / 2);
  const rightHalf = await sharp({ create: { width: width - halfWidth, height, channels: 3, background: right } })
    .png()
    .toBuffer();
  return sharp({ create: { width, height, channels: 3, background: left } })
    .composite([{ input: rightHalf, left: halfWidth, top: 0 }])
    .jpeg()
    .toBuffer();
}

const ORANGE: Color = { r: 200, g: 110, b: 20 };
const BLUE: Color = { r: 20, g: 60, b: 200 };
const BLACK: Color = { r: 5, g: 5, b: 5 };
const WHITE: Color = { r: 250, g: 250, b: 250 };

async function createProduct(session: AuthSession, name: string, price: number, stock: number): Promise<string> {
  const categoryId = await firstCategoryId(app, session);
  const res = await app.inject({ method: 'POST', url: '/api/items', headers: auth(session), payload: { name, categoryId, price, kind: 'product', stock } });
  expect(res.statusCode).toBe(201);
  return res.json<{ id: string }>().id;
}

async function attachPhoto(session: { accessToken: string }, itemId: string, buffer: Buffer) {
  const { payload, contentType } = await photoForm(buffer);
  const res = await app.inject({ method: 'POST', url: `/api/items/${itemId}/photos`, headers: { ...auth(session), 'content-type': contentType }, payload });
  expect(res.statusCode).toBe(201);
}

const matchImage = (session: { accessToken: string }, buffer: Buffer) =>
  photoForm(buffer, 'photo', 'consulta.jpg').then(({ payload, contentType }) =>
    app.inject({ method: 'POST', url: '/api/assistant/image-match', headers: { ...auth(session), 'content-type': contentType }, payload }),
  );

describe('imageSimilarity / fingerprintImage: funciones puras, sin red ni base de datos', () => {
  it('la misma imagen (incluso recomprimida/reescalada) obtiene un puntaje muy alto', async () => {
    const original = await splitImage(ORANGE, BLUE);
    const recompressed = await sharp(original).resize(200, 150).jpeg({ quality: 60 }).toBuffer();
    const fpA = await fingerprintImage(original);
    const fpB = await fingerprintImage(recompressed);
    expect(fpA).not.toBeNull();
    expect(fpB).not.toBeNull();
    expect(imageSimilarity(fpA!, fpB!)).toBeGreaterThanOrEqual(90);
  });

  it('dos imágenes con una estructura claramente distinta obtienen un puntaje bajo', async () => {
    const a = await fingerprintImage(await splitImage(BLACK, WHITE));
    const b = await fingerprintImage(await splitImage(ORANGE, BLUE));
    expect(imageSimilarity(a!, b!)).toBeLessThan(65);
  });

  it('un archivo que no es una imagen real: null, nunca una excepción', async () => {
    expect(await fingerprintImage(Buffer.from('esto no es una imagen'))).toBeNull();
  });
});

describe('POST /assistant/image-match: nunca inventa un producto, siempre con datos actuales', () => {
  it('coincidencia: la misma foto (reescalada) sube con el producto correcto y sus datos de HOY', async () => {
    const owner = await register(app, 'Imagen coincidencia');
    const photo = await splitImage(ORANGE, BLUE);
    const itemId = await createProduct(owner, 'Shampoo premium', 45_000, 7);
    await attachPhoto(owner, itemId, photo);

    const query = await sharp(photo).resize(220, 160).jpeg({ quality: 70 }).toBuffer();
    const res = await matchImage(owner, query);
    expect(res.statusCode).toBe(200);
    const body = res.json<ImageMatchResult>();
    expect(body).toMatchObject({ ok: true, kind: 'match' });
    if (body.ok && body.kind === 'match') {
      expect(body.items[0]).toMatchObject({ id: itemId, name: 'Shampoo premium', price: 45_000, stock: 7, stockStatus: 'available' });
    }

    // Cambia el stock DESPUÉS de subir la foto: la respuesta debe reflejar el valor de ahora, no uno guardado al subirla.
    await testDb.db.update(items).set({ stock: 0, stockStatus: 'out_of_stock' }).where(eq(items.id, itemId));
    const afterChange = (await matchImage(owner, query)).json<ImageMatchResult>();
    if (afterChange.ok && afterChange.kind === 'match') expect(afterChange.items[0]).toMatchObject({ stock: 0, stockStatus: 'out_of_stock' });
  });

  it('ninguna coincidencia confiable: el inventario tiene fotos, pero ninguna se parece — nunca inventa una', async () => {
    const owner = await register(app, 'Imagen sin parecido');
    const itemId = await createProduct(owner, 'Crema facial', 30_000, 3);
    await attachPhoto(owner, itemId, await splitImage(BLACK, WHITE));

    const res = await matchImage(owner, await splitImage(ORANGE, BLUE));
    expect(res.statusCode).toBe(200);
    expect(res.json<ImageMatchResult>()).toEqual({ ok: true, kind: 'none' });
  });

  it('sin ninguna foto de producto en el inventario: lo dice, en vez de responder "ninguna coincidencia"', async () => {
    const owner = await register(app, 'Imagen sin inventario');
    const res = await matchImage(owner, await splitImage(ORANGE, BLUE));
    expect(res.statusCode).toBe(200);
    expect(res.json<ImageMatchResult>()).toEqual({ ok: false, reason: 'no_inventory' });
  });

  it('un servicio (no un producto) con la misma foto nunca aparece: los servicios no tienen existencias', async () => {
    const owner = await register(app, 'Imagen solo servicios');
    const photo = await splitImage(ORANGE, BLUE);
    const categoryId = await firstCategoryId(app, owner);
    const service = await app.inject({ method: 'POST', url: '/api/items', headers: auth(owner), payload: { name: 'Corte', categoryId, price: 20_000, kind: 'service', durationMinutes: 30 } });
    expect(service.statusCode).toBe(201);
    await attachPhoto(owner, service.json<{ id: string }>().id, photo);

    const res = await matchImage(owner, photo);
    expect(res.json<ImageMatchResult>()).toEqual({ ok: false, reason: 'no_inventory' });
  });

  it('una imagen inválida: lo dice con claridad, nunca un error de servidor', async () => {
    const owner = await register(app, 'Imagen inválida');
    const { payload, contentType } = await photoForm(Buffer.from('no soy una imagen'), 'photo', 'nota.txt');
    const res = await app.inject({ method: 'POST', url: '/api/assistant/image-match', headers: { ...auth(owner), 'content-type': contentType }, payload });
    expect(res.statusCode).toBe(200);
    expect(res.json<ImageMatchResult>()).toEqual({ ok: false, reason: 'invalid_image' });
  });

  it('permiso: igual que ver el inventario (catalog_view) — sin él, 403', async () => {
    const owner = await register(app, 'Imagen permiso');
    const nobody = (await createEmployee(app, owner, [])).session;
    const withPerm = (await createEmployee(app, owner, ['catalog_view'])).session;
    const photo = await splitImage(ORANGE, BLUE);
    expect((await matchImage(nobody, photo)).statusCode).toBe(403);
    expect((await matchImage(withPerm, photo)).statusCode).toBe(200);
  });

  it('aislamiento entre negocios: el producto de otro negocio nunca aparece, aunque la foto sea idéntica', async () => {
    const a = await register(app, 'Imagen aislamiento A');
    const b = await register(app, 'Imagen aislamiento B');
    const photo = await splitImage(ORANGE, BLUE);
    const itemIdB = await createProduct(b, 'Producto de B', 99_000, 1);
    await attachPhoto(b, itemIdB, photo);

    // El negocio A no tiene NINGÚN producto con foto: su propia consulta debe decir "sin inventario", nunca el de B.
    const res = await matchImage(a, photo);
    expect(res.json<ImageMatchResult>()).toEqual({ ok: false, reason: 'no_inventory' });
  });
});
