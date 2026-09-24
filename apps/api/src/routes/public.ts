import { eq } from 'drizzle-orm';
import type { PublicCatalog } from '@xiro/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../context';
import { businesses } from '../db/schema';
import { isUuid, notFound, parse } from '../errors';
import { mediaUrl } from '../media';
import { loadItems, toPublicItem, type BusinessRow } from '../serializers';

const slugParams = z.object({ slug: z.string().min(1).max(60) });
const catalogQuery = z.object({ category: z.string().trim().max(60).optional() });

/**
 * Contrato del catálogo público (sin autenticación). Solo expone la lista blanca de `toPublicItem`
 * y únicamente artículos publicados; los enlaces compartidos siempre consultan el estado actual.
 */
export function publicRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db } = ctx;

  const loadBusiness = async (slug: string) => {
    const [business] = await db.select().from(businesses).where(eq(businesses.slug, slug)).limit(1);
    if (!business) throw notFound();
    return business;
  };

  const describe = (business: BusinessRow): PublicCatalog['business'] => ({
    name: business.name,
    slug: business.slug,
    whatsapp: business.whatsapp,
    currency: business.currency as PublicCatalog['business']['currency'],
    logoUrl: business.logoFile ? mediaUrl(business.logoFile) : null,
  });

  app.addHook('onSend', async (_request, reply) => {
    reply.header('Cache-Control', 'public, max-age=15');
  });

  app.get('/catalog/:slug', async (request): Promise<PublicCatalog> => {
    const { slug } = parse(slugParams, request.params);
    const { category } = parse(catalogQuery, request.query);
    const business = await loadBusiness(slug);
    const items = (await loadItems(db, business.id, { publishedOnly: true }))
      .filter((item) => !category || item.categoryName.toLowerCase() === category.toLowerCase())
      .map(toPublicItem);
    return { business: describe(business), items };
  });

  app.get('/catalog/:slug/items/:id', async (request) => {
    const { slug } = parse(slugParams, request.params);
    const id = (request.params as { id?: string }).id;
    if (!isUuid(id)) throw notFound();
    const business = await loadBusiness(slug);
    const [item] = await loadItems(db, business.id, { id: id.toLowerCase(), publishedOnly: true });
    if (!item) throw notFound();
    return { business: describe(business), item: toPublicItem(item) };
  });
}
