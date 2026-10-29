import { productOrderCancelInputSchema, productOrdersQuerySchema, type Page, type ProductOrderDto, type ProductOrdersSummary } from '@xiro/shared';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { loadProductOrderDtos, lockProductOrder, orderStatusFilter, transitionProductOrder } from '../booking/orders';
import { withBusiness } from '../booking/scope';
import type { Ctx } from '../context';
import { productOrders } from '../db/schema';
import { parse, uuid } from '../errors';
import { decodeCursor, toPage } from '../pagination';

/**
 * Pedidos de solo productos que llegan desde la página pública (panel del negocio, web y app). Todo dentro de `withBusiness`:
 * el negocio sale de la sesión y la base (RLS) rechaza filas de otro negocio aunque una consulta olvidara filtrar.
 * Entregar se hace registrando la venta (POST /sales con `productOrderId`), que es la que descuenta el inventario.
 */
export function orderRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db } = ctx;
  const scoped = <T>(request: { user: { bid: string } }, fn: Parameters<typeof withBusiness<T>>[2]) => withBusiness(db, request.user.bid, fn);

  /** Los más recientes primero, por cursor (`createdAt` + id). `status=open` = nuevos y listos (lo que falta atender). */
  app.get('/orders', async (request): Promise<Page<ProductOrderDto>> => {
    const { status, limit, cursor } = parse(productOrdersQuerySchema, request.query);
    const after = decodeCursor(cursor, ['string', 'string']);
    return scoped(request, async (tx) => {
      const createdText = sql<string>`${productOrders.createdAt}::text`;
      const rows = await tx
        .select({ order: productOrders, createdText })
        .from(productOrders)
        .where(
          and(
            eq(productOrders.businessId, request.user.bid),
            orderStatusFilter(status),
            after ? sql`(${productOrders.createdAt}, ${productOrders.id}) < (${after[0]}::timestamptz, ${after[1]}::uuid)` : undefined,
          ),
        )
        .orderBy(desc(productOrders.createdAt), desc(productOrders.id))
        .limit(limit + 1);
      const dtos = await loadProductOrderDtos(tx, request.user.bid, rows.slice(0, limit).map((r) => r.order));
      const byId = new Map(dtos.map((dto) => [dto.id, dto]));
      return toPage(rows, limit, (row) => [row.createdText, row.order.id], (row) => byId.get(row.order.id)!);
    });
  });

  /** Cuántos faltan por atender (insignia del menú "Pedidos"). */
  app.get('/orders/summary', async (request): Promise<ProductOrdersSummary> =>
    scoped(request, async (tx) => {
      const rows = await tx
        .select({ status: productOrders.status, n: sql<number>`count(*)::int` })
        .from(productOrders)
        .where(and(eq(productOrders.businessId, request.user.bid), orderStatusFilter('open')))
        .groupBy(productOrders.status);
      const count = (status: string) => rows.find((r) => r.status === status)?.n ?? 0;
      return { pending: count('pending'), ready: count('ready') };
    }),
  );

  app.get('/orders/:id', async (request): Promise<ProductOrderDto> => {
    const id = uuid((request.params as { id?: string }).id);
    return scoped(request, async (tx) => {
      const row = await lockProductOrder(tx, request.user.bid, id);
      return (await loadProductOrderDtos(tx, request.user.bid, [row]))[0]!;
    });
  });

  /** Listo para recoger. */
  app.post('/orders/:id/ready', async (request): Promise<ProductOrderDto> => {
    const id = uuid((request.params as { id?: string }).id);
    return scoped(request, async (tx) => (await loadProductOrderDtos(tx, request.user.bid, [await transitionProductOrder(tx, request.user.bid, id, 'ready')]))[0]!);
  });

  app.post('/orders/:id/cancel', async (request): Promise<ProductOrderDto> => {
    const id = uuid((request.params as { id?: string }).id);
    const { reason } = parse(productOrderCancelInputSchema, request.body ?? {});
    return scoped(request, async (tx) => (await loadProductOrderDtos(tx, request.user.bid, [await transitionProductOrder(tx, request.user.bid, id, 'cancelled', reason)]))[0]!);
  });
}
