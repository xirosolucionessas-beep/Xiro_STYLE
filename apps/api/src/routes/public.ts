import type { PublicCatalog, PublicItem } from '@xiro/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../context';
import { businessSettings } from '../db/schema';
import { isUuid, notFound, parse } from '../errors';
import { mediaUrl } from '../media';
import { resolveSlug } from '../booking/view';
import { loadItems, toPublicItem, type BusinessRow } from '../serializers';

const slugParams = z.object({ slug: z.string().min(1).max(60) });
const catalogQuery = z.object({ category: z.string().trim().max(60).optional() });

/**
 * Contrato del catálogo público (sin autenticación). Solo expone la lista blanca de `toPublicItem`
 * y únicamente artículos publicados. Las respuestas se guardan en la caché pública (iguales para cualquier visitante)
 * y se invalidan en cuanto el negocio guarda un cambio, así que los enlaces compartidos muestran el estado actual.
 */
export function publicRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db } = ctx;

  const loadBusiness = async (slug: string) => {
    // Una dirección anterior del negocio (que cambió su slug) sigue mostrando su catálogo.
    const resolved = await resolveSlug(db, slug);
    if (!resolved) throw notFound();
    return resolved.business;
  };

  const describe = (business: BusinessRow): PublicCatalog['business'] => ({
    name: business.name,
    slug: business.slug,
    whatsapp: business.whatsapp,
    currency: business.currency as PublicCatalog['business']['currency'],
    logoUrl: business.logoFile ? mediaUrl(business.logoFile) : null,
  });

  /** El negocio puede pedir que un producto agotado desaparezca del catálogo público en vez de quedar marcado "Agotado". */
  const hidesOutOfStock = async (businessId: string): Promise<boolean> => {
    const [row] = await db.select({ hide: businessSettings.hideOutOfStockInCatalog }).from(businessSettings).where(eq(businessSettings.businessId, businessId)).limit(1);
    return row?.hide ?? false;
  };
  const visible = (items: PublicItem[], hideSoldOut: boolean): PublicItem[] => (hideSoldOut ? items.filter((item) => !item.soldOut) : items);

  app.addHook('onSend', async (_request, reply) => {
    reply.header('Cache-Control', 'public, max-age=15');
  });

  app.get('/catalog/:slug', async (request): Promise<PublicCatalog> => {
    const { slug } = parse(slugParams, request.params);
    const { category } = parse(catalogQuery, request.query);
    const business = await loadBusiness(slug);
    return ctx.publicCache.wrap(business.id, `catalog:${category?.toLowerCase() ?? ''}`, async () => {
      const items = visible(
        (await loadItems(db, business.id, { publishedOnly: true })).filter((item) => !category || item.categoryName.toLowerCase() === category.toLowerCase()).map(toPublicItem),
        await hidesOutOfStock(business.id),
      );
      return { business: describe(business), items };
    });
  });

  app.get('/catalog/:slug/items/:id', async (request) => {
    const { slug } = parse(slugParams, request.params);
    const id = (request.params as { id?: string }).id;
    if (!isUuid(id)) throw notFound();
    const business = await loadBusiness(slug);
    return ctx.publicCache.wrap(business.id, `item:${id.toLowerCase()}`, async () => {
      const [item] = await loadItems(db, business.id, { id: id.toLowerCase(), publishedOnly: true });
      if (!item) throw notFound();
      const publicItem = toPublicItem(item);
      // Oculto = oculto también por enlace directo (mismo trato que un artículo sin publicar): no hay una segunda puerta.
      if (publicItem.soldOut && (await hidesOutOfStock(business.id))) throw notFound();
      return { business: describe(business), item: publicItem };
    });
  });
}
