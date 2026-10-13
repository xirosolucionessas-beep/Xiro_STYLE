import { waitlistQuerySchema, type WaitlistEntryDto } from '@xiro/shared';
import { and, asc, eq, gte } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { loadContext } from '../booking/availability';
import { withBusiness } from '../booking/scope';
import { localDate } from '../booking/time';
import { loadWaitlistDtos } from '../booking/waitlist';
import type { Ctx } from '../context';
import { waitlistEntries } from '../db/schema';
import { AppError, notFound, parse, uuid } from '../errors';

/**
 * Lista de espera en el panel (Fase 4): quién espera qué día, para llamarle o agendarle a mano. Todo con `withBusiness` (RLS):
 * el negocio sale de la sesión y nunca del cliente.
 */
export function waitlistRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db } = ctx;

  app.get('/waitlist', async (request): Promise<WaitlistEntryDto[]> => {
    const query = parse(waitlistQuerySchema, request.query);
    const businessId = request.user.bid;
    return withBusiness(db, businessId, async (tx) => {
      const from = query.from ?? localDate(new Date(), (await loadContext(tx, businessId)).business.timezone);
      const rows = await tx
        .select()
        .from(waitlistEntries)
        .where(and(eq(waitlistEntries.businessId, businessId), gte(waitlistEntries.date, from), query.status ? eq(waitlistEntries.status, query.status) : undefined))
        .orderBy(asc(waitlistEntries.date), asc(waitlistEntries.createdAt))
        .limit(300);
      return loadWaitlistDtos(tx, businessId, rows);
    });
  });

  /** Quitar a alguien de la lista (ya se le agendó, o no quiere esperar). */
  app.post('/waitlist/:id/cancel', async (request): Promise<WaitlistEntryDto> => {
    const id = uuid((request.params as { id?: string }).id);
    const businessId = request.user.bid;
    return withBusiness(db, businessId, async (tx) => {
      const [current] = await tx.select().from(waitlistEntries).where(and(eq(waitlistEntries.id, id), eq(waitlistEntries.businessId, businessId))).limit(1);
      if (!current) throw notFound();
      if (current.status === 'cancelled') throw new AppError(409, 'invalid_transition');
      const [row] = await tx.update(waitlistEntries).set({ status: 'cancelled' }).where(and(eq(waitlistEntries.id, id), eq(waitlistEntries.businessId, businessId))).returning();
      return (await loadWaitlistDtos(tx, businessId, [row!]))[0]!;
    });
  });
}
