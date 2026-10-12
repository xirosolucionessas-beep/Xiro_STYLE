import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { auth, createService, register, setupBiz, type Biz } from './helpers/booking';
import { createTestDatabase, testAppConfig, type TestDatabase } from './helpers/db';

/**
 * Fase 2 del plan: "Ver página pública" de un artículo llevaba al catálogo antiguo. Ahora la ruta canónica es
 * /reservar/<negocio>/articulo/<id> (página moderna con el detalle abierto y su propia vista previa), y los enlaces viejos
 * /catalog/<negocio>/item/<id> se redirigen allí CUANDO el artículo se ve en la página moderna. Si no, el catálogo de siempre
 * lo sigue mostrando: ningún enlace ya compartido se rompe, y nunca hay bucles de redirección.
 */
let app: FastifyInstance;
let testDb: TestDatabase;
let cleanupConfig: () => void;
let publicDir: string;

beforeAll(async () => {
  testDb = await createTestDatabase();
  // Un build mínimo de la página moderna (apps/public): con él el servidor sirve /reservar.
  publicDir = mkdtempSync(path.join(tmpdir(), 'xiro-public-'));
  writeFileSync(path.join(publicDir, 'index.html'), '<!doctype html><html><head><!--OG_TAGS--><script>document.documentElement.dataset.t="x"</script></head><body><div id="root"></div></body></html>');
  const { config, cleanup } = testAppConfig({ publicWebDir: publicDir });
  cleanupConfig = cleanup;
  app = await buildApp({ db: testDb.db, config });
});

afterAll(async () => {
  await app.close();
  cleanupConfig();
  rmSync(publicDir, { recursive: true, force: true });
  await testDb.drop();
});

const get = (url: string) => app.inject({ method: 'GET', url });
const legacy = (biz: Biz, id: string) => `/catalog/${biz.slug}/item/${id}`;
const modern = (biz: Biz, id: string) => `/reservar/${biz.slug}/articulo/${id}`;

/** Sigue redirecciones (máximo 5) y devuelve la URL final y cuántos saltos hubo. */
async function follow(url: string): Promise<{ url: string; hops: number; status: number }> {
  let current = url;
  for (let hops = 0; hops < 5; hops += 1) {
    const res = await get(current);
    if (res.statusCode !== 302) return { url: current, hops, status: res.statusCode };
    current = String(res.headers.location);
  }
  throw new Error(`bucle de redirecciones desde ${url}`);
}

describe('enlace de un artículo: la ruta canónica moderna, sin romper los enlaces viejos', () => {
  it('artículo visible en la página moderna: el enlace viejo redirige (302, sin caché) y la ruta moderna lo sirve con SU vista previa', async () => {
    const biz = await setupBiz(app, 'Enlaces');
    const res = await get(legacy(biz, biz.serviceId));
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(modern(biz, biz.serviceId));
    expect(res.headers['cache-control']).toBe('no-store');

    const page = await get(modern(biz, biz.serviceId));
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.body).toContain('<meta property="og:title" content="Corte | ');
    expect(page.headers['content-security-policy']).toContain("frame-ancestors 'none'");
  });

  it('un producto visible también va a la página moderna', async () => {
    const biz = await setupBiz(app, 'Producto visible');
    const product = await createService(app, biz.session, { name: 'Champú', price: 15000, kind: 'product', stock: 3 });
    expect((await follow(legacy(biz, product.id))).url).toBe(modern(biz, product.id));
  });

  it('artículo NO reservable, página sin publicar o agotado oculto: se queda en el catálogo de siempre (y la ruta moderna lleva allí)', async () => {
    const biz = await setupBiz(app, 'Se queda');
    const hiddenOnline = await createService(app, biz.session, { name: 'Solo en el local', bookable: false });
    for (const url of [legacy(biz, hiddenOnline.id), modern(biz, hiddenOnline.id)]) {
      const end = await follow(url);
      expect(end).toMatchObject({ url: legacy(biz, hiddenOnline.id), status: 200 });
    }

    // Agotado con "ocultar agotados" activo.
    const soldOut = await createService(app, biz.session, { name: 'Agotado', price: 5000, kind: 'product', stock: 0 });
    expect((await follow(legacy(biz, soldOut.id))).url).toBe(modern(biz, soldOut.id)); // visible marcado "Agotado"
    expect((await app.inject({ method: 'PUT', url: '/api/booking/settings', headers: auth(biz.session), payload: { hideOutOfStockInCatalog: true } })).statusCode).toBe(200);
    expect((await follow(legacy(biz, soldOut.id))).url).toBe(legacy(biz, soldOut.id));

    // Página despublicada: todo vuelve al catálogo de siempre (que no depende de publicar la página de reservas).
    expect((await app.inject({ method: 'PUT', url: '/api/booking/profile', headers: auth(biz.session), payload: { published: false } })).statusCode).toBe(200);
    expect(await follow(modern(biz, biz.serviceId))).toMatchObject({ url: legacy(biz, biz.serviceId), status: 200 });
  });

  it('un negocio que nunca publicó su página de reservas conserva su catálogo y sus enlaces de artículo tal cual', async () => {
    const session = await register(app, 'Solo catálogo');
    const item = await createService(app, session, { name: 'Manicure' });
    const res = await get(`/catalog/${session.business.slug}/item/${item.id}`);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('og:title');
    expect((await get(`/catalog/${session.business.slug}`)).statusCode).toBe(200); // el catálogo completo no se toca
  });

  it('id de OTRO negocio, inexistente o mal formado: nunca se muestra en la página moderna de este, y nunca hay bucles', async () => {
    const mine = await setupBiz(app, 'Mío links');
    const other = await setupBiz(app, 'Ajeno links');
    for (const id of [other.serviceId, '00000000-0000-4000-8000-000000000000', 'no-es-un-id', '..%2F..%2Fetc']) {
      for (const url of [legacy(mine, id), modern(mine, id)]) {
        const end = await follow(url);
        expect(end.hops, url).toBeLessThanOrEqual(1);
        expect(end.url, url).not.toContain('/reservar/');
      }
    }
  });

  it('la vista previa escapa el nombre del artículo (sin inyectar HTML en la página)', async () => {
    const biz = await setupBiz(app, 'Escape');
    const evil = await createService(app, biz.session, { name: '"><script>alert(1)</script>' });
    const page = await get(modern(biz, evil.id));
    expect(page.statusCode).toBe(200);
    expect(page.body).not.toContain('<script>alert(1)</script>');
    expect(page.body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});
