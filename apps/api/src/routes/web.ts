import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Ctx } from '../context';
import { eq } from 'drizzle-orm';
import { businesses } from '../db/schema';
import { isUuid } from '../errors';
import { loadItems } from '../serializers';

const catalogDir = fileURLToPath(new URL('../../public/catalog/', import.meta.url));

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const CATALOG_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/**
 * Catálogo público (HTML), fotos subidas y —si existe— la app web exportada por Expo.
 * Devuelve el index.html de la app web (para el fallback de rutas del cliente) o null si no hay build web.
 */
export function webRoutes(app: FastifyInstance, ctx: Ctx): string | null {
  const { db, config } = ctx;
  const template = readFileSync(path.join(catalogDir, 'index.html'), 'utf8');

  app.register(fastifyStatic, {
    root: catalogDir,
    prefix: '/catalog-assets/',
    index: false,
    decorateReply: false,
    setHeaders: (res) => res.header('Cache-Control', 'public, max-age=300'),
  });

  app.register(fastifyStatic, {
    root: config.mediaDir,
    prefix: '/media/',
    index: false,
    decorateReply: false,
    setHeaders: (res) => res.header('Cache-Control', 'public, max-age=31536000, immutable'),
  });

  async function ogTags(request: FastifyRequest, slug: string, itemId: string | null): Promise<string> {
    const [business] = await db.select().from(businesses).where(eq(businesses.slug, slug.slice(0, 60))).limit(1);
    if (!business) return '<title>Catálogo | Xiro Style</title><meta name="robots" content="noindex">';
    const origin = `${request.protocol}://${request.host}`;
    const item = itemId && isUuid(itemId) ? (await loadItems(db, business.id, { id: itemId.toLowerCase(), publishedOnly: true }))[0] : undefined;
    const title = item ? `${item.name} | ${business.name}` : `${business.name} | Catálogo`;
    const description = item ? item.shortDescription || item.description : 'Servicios y productos para tu estilo.';
    const image = item?.photos[0]?.url ?? (business.logoFile ? `/media/${business.logoFile}` : null);
    const tags = [
      `<title>${escapeHtml(title)}</title>`,
      `<meta property="og:type" content="website">`,
      `<meta property="og:title" content="${escapeHtml(title)}">`,
      `<meta property="og:description" content="${escapeHtml(description.slice(0, 200))}">`,
      `<meta name="description" content="${escapeHtml(description.slice(0, 200))}">`,
    ];
    if (image) tags.push(`<meta property="og:image" content="${escapeHtml(origin + image)}">`);
    return tags.join('\n  ');
  }

  async function catalogPage(request: FastifyRequest<{ Params: { slug: string; id?: string } }>, reply: FastifyReply) {
    const { slug, id } = request.params;
    const tags = await ogTags(request, slug, id ?? null);
    return reply
      .header('Content-Security-Policy', CATALOG_CSP)
      .header('Cache-Control', 'no-cache')
      .type('text/html; charset=utf-8')
      .send(template.replace('<!--OG_TAGS-->', tags));
  }

  app.get<{ Params: { slug: string } }>('/catalog/:slug', catalogPage);
  app.get<{ Params: { slug: string; id: string } }>('/catalog/:slug/item/:id', catalogPage);

  /* App web (Expo export) con fallback a index.html para las rutas del cliente. */
  if (config.webDir && existsSync(path.join(config.webDir, 'index.html'))) {
    const webDir = config.webDir;
    const indexHtml = readFileSync(path.join(webDir, 'index.html'), 'utf8');
    app.register(fastifyStatic, {
      root: webDir,
      prefix: '/',
      index: false,
      wildcard: false,
      decorateReply: false,
      setHeaders: (res, filePath) => {
        const hashed = filePath.includes(`${path.sep}_expo${path.sep}`) || filePath.includes(`${path.sep}assets${path.sep}`);
        res.header('Cache-Control', hashed ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
    app.get('/', (_request, reply) => reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-cache').send(indexHtml));
    return indexHtml;
  }
  return null;
}
