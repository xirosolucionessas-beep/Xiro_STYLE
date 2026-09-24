import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { loyaltyProgramUpdateSchema, type LoyaltyClientProgress, type LoyaltyProgram, type LoyaltyRedemption } from '@xiro/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../context';
import { clients, loyaltyProgramItems, loyaltyPrograms, loyaltyProgress, loyaltyRedemptions } from '../db/schema';
import { AppError, notFound, parse, uuid } from '../errors';

const DEFAULT_PROGRAM: LoyaltyProgram = { enabled: false, goal: 10, resetOnRedeem: true, rewardMessage: '', itemIds: [] };

/**
 * Programa de fidelización: configuración por negocio, progreso por cliente y canje. El contador (loyalty_progress)
 * solo lo mueve serviceRecords.ts al registrar un servicio elegible — aquí no hay forma de sumarlo a mano, así que
 * nunca se duplica un sello por accidente.
 */
export function loyaltyRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db } = ctx;
  const businessOf = (request: { user: { bid: string; sub: string } }) => request.user.bid;

  async function loadProgram(businessId: string) {
    const [program] = await db.select().from(loyaltyPrograms).where(eq(loyaltyPrograms.businessId, businessId)).limit(1);
    if (!program) return null;
    const links = await db.select({ itemId: loyaltyProgramItems.itemId }).from(loyaltyProgramItems).where(eq(loyaltyProgramItems.programId, program.id));
    return { program, itemIds: links.map((link) => link.itemId) };
  }

  app.get('/loyalty/program', async (request): Promise<LoyaltyProgram> => {
    const loaded = await loadProgram(businessOf(request));
    if (!loaded) return DEFAULT_PROGRAM;
    return { enabled: loaded.program.enabled, goal: loaded.program.goal, resetOnRedeem: loaded.program.resetOnRedeem, rewardMessage: loaded.program.rewardMessage, itemIds: loaded.itemIds };
  });

  app.put('/loyalty/program', async (request): Promise<LoyaltyProgram> => {
    const businessId = businessOf(request);
    const input = parse(loyaltyProgramUpdateSchema, request.body);
    const itemIds = [...new Set(input.itemIds)].map((id) => uuid(id));

    await db.transaction(async (tx) => {
      const [program] = await tx
        .insert(loyaltyPrograms)
        .values({ businessId, enabled: input.enabled, goal: input.goal, resetOnRedeem: input.resetOnRedeem, rewardMessage: input.rewardMessage })
        .onConflictDoUpdate({
          target: loyaltyPrograms.businessId,
          set: { enabled: input.enabled, goal: input.goal, resetOnRedeem: input.resetOnRedeem, rewardMessage: input.rewardMessage, updatedAt: new Date() },
        })
        .returning();
      // Se reemplaza la lista completa: más simple y seguro que calcular un diff, y son pocas filas (un checklist del catálogo).
      await tx.delete(loyaltyProgramItems).where(eq(loyaltyProgramItems.programId, program!.id));
      if (itemIds.length > 0) await tx.insert(loyaltyProgramItems).values(itemIds.map((itemId) => ({ programId: program!.id, itemId })));
    });

    const loaded = (await loadProgram(businessId))!;
    return { enabled: loaded.program.enabled, goal: loaded.program.goal, resetOnRedeem: loaded.program.resetOnRedeem, rewardMessage: loaded.program.rewardMessage, itemIds: loaded.itemIds };
  });

  app.get('/loyalty/clients', async (request): Promise<LoyaltyClientProgress[]> => {
    const businessId = businessOf(request);
    const loaded = await loadProgram(businessId);
    const goal = loaded?.program.goal ?? DEFAULT_PROGRAM.goal;
    const rows = await db
      .select({ clientId: clients.id, clientName: clients.name, clientPhone: clients.phone, count: loyaltyProgress.count })
      .from(clients)
      .leftJoin(loyaltyProgress, and(eq(loyaltyProgress.clientId, clients.id), eq(loyaltyProgress.businessId, businessId)))
      .where(eq(clients.businessId, businessId))
      .orderBy(desc(loyaltyProgress.count), asc(sql`lower(${clients.name})`));
    return rows.map((r) => ({ clientId: r.clientId, clientName: r.clientName, clientPhone: r.clientPhone, count: r.count ?? 0, goal, rewardAvailable: (r.count ?? 0) >= goal }));
  });

  app.get('/loyalty/redemptions', async (request): Promise<LoyaltyRedemption[]> => {
    const businessId = businessOf(request);
    const query = parse(z.object({ clientId: z.string().optional() }), request.query);
    const rows = await db
      .select({ redemption: loyaltyRedemptions, clientName: clients.name })
      .from(loyaltyRedemptions)
      .innerJoin(clients, eq(clients.id, loyaltyRedemptions.clientId))
      .where(and(eq(loyaltyRedemptions.businessId, businessId), query.clientId ? eq(loyaltyRedemptions.clientId, uuid(query.clientId)) : undefined))
      .orderBy(desc(loyaltyRedemptions.redeemedAt))
      .limit(200);
    return rows.map(({ redemption, clientName }) => ({
      id: redemption.id,
      clientId: redemption.clientId,
      clientName,
      goalAtRedemption: redemption.goalAtRedemption,
      redeemedAt: redemption.redeemedAt.toISOString(),
    }));
  });

  app.post('/loyalty/clients/:clientId/redeem', async (request): Promise<LoyaltyClientProgress> => {
    const businessId = businessOf(request);
    const clientId = uuid((request.params as { clientId?: string }).clientId);
    const loaded = await loadProgram(businessId);
    if (!loaded || !loaded.program.enabled) throw new AppError(400, 'loyalty_disabled');

    const [client] = await db.select({ id: clients.id, name: clients.name, phone: clients.phone }).from(clients).where(and(eq(clients.id, clientId), eq(clients.businessId, businessId))).limit(1);
    if (!client) throw notFound();

    const nextCount = await db.transaction(async (tx) => {
      const [progress] = await tx
        .select()
        .from(loyaltyProgress)
        .where(and(eq(loyaltyProgress.businessId, businessId), eq(loyaltyProgress.clientId, clientId)))
        .limit(1);
      const count = progress?.count ?? 0;
      if (count < loaded.program.goal) throw new AppError(400, 'loyalty_reward_unavailable');

      const updatedCount = loaded.program.resetOnRedeem ? 0 : count - loaded.program.goal;
      await tx.update(loyaltyProgress).set({ count: updatedCount, updatedAt: new Date() }).where(and(eq(loyaltyProgress.businessId, businessId), eq(loyaltyProgress.clientId, clientId)));
      await tx.insert(loyaltyRedemptions).values({ businessId, clientId, goalAtRedemption: loaded.program.goal, redeemedBy: request.user.sub });
      return updatedCount;
    });

    return { clientId: client.id, clientName: client.name, clientPhone: client.phone, count: nextCount, goal: loaded.program.goal, rewardAvailable: nextCount >= loaded.program.goal };
  });
}
