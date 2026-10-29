import { discountCodeInputSchema, type DiscountCodeDto } from '@xiro/shared';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { toDiscountDto } from '../booking/discounts';
import { withBusiness } from '../booking/scope';
import type { Ctx } from '../context';
import { isUniqueViolation } from '../db/errors';
import { discountCodes } from '../db/schema';
import { AppError, notFound, parse, uuid } from '../errors';

/**
 * Códigos de descuento del negocio (Fase 4), en el panel. Todo con `withBusiness` (RLS): el negocio sale de la sesión. Borrar
 * un código no cambia las citas o pedidos que ya lo usaron (conservan el monto descontado; solo pierden el enlace al código).
 */
export function discountRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db } = ctx;
  const scoped = <T>(request: { user: { bid: string } }, fn: Parameters<typeof withBusiness<T>>[2]) => withBusiness(db, request.user.bid, fn);
  const values = (input: ReturnType<typeof discountCodeInputSchema.parse>) => ({
    ...input,
    startsAt: input.startsAt ? new Date(input.startsAt) : null,
    endsAt: input.endsAt ? new Date(input.endsAt) : null,
  });
  // El mismo código dos veces en un negocio: error claro en vez de un 500.
  const duplicate = (error: unknown) => {
    if (isUniqueViolation(error, 'discount_codes_business_code_uq')) throw new AppError(409, 'discount_code_exists');
    throw error;
  };

  app.get('/discount-codes', async (request): Promise<DiscountCodeDto[]> =>
    scoped(request, async (tx) => (await tx.select().from(discountCodes).where(eq(discountCodes.businessId, request.user.bid)).orderBy(desc(discountCodes.createdAt)).limit(200)).map(toDiscountDto)),
  );

  app.post('/discount-codes', async (request, reply) => {
    const input = parse(discountCodeInputSchema, request.body);
    const row = await scoped(request, async (tx) => (await tx.insert(discountCodes).values({ businessId: request.user.bid, ...values(input) }).returning())[0]!).catch(duplicate);
    return reply.status(201).send(toDiscountDto(row));
  });

  app.put('/discount-codes/:id', async (request): Promise<DiscountCodeDto> => {
    const id = uuid((request.params as { id?: string }).id);
    const input = parse(discountCodeInputSchema, request.body);
    const row = await scoped(request, async (tx) => {
      const [updated] = await tx
        .update(discountCodes)
        .set({ ...values(input), updatedAt: new Date() })
        .where(and(eq(discountCodes.id, id), eq(discountCodes.businessId, request.user.bid)))
        .returning();
      if (!updated) throw notFound();
      return updated;
    }).catch(duplicate);
    return toDiscountDto(row);
  });

  app.delete('/discount-codes/:id', async (request, reply) => {
    const id = uuid((request.params as { id?: string }).id);
    await scoped(request, async (tx) => {
      const [deleted] = await tx.delete(discountCodes).where(and(eq(discountCodes.id, id), eq(discountCodes.businessId, request.user.bid))).returning({ id: discountCodes.id });
      if (!deleted) throw notFound();
    });
    return reply.status(204).send();
  });
}
