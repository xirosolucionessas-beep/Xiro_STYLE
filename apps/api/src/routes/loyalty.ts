import { and, asc, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { can, loyaltyProgramUpdateSchema, pageQuerySchema, type LoyaltyClientProgress, type LoyaltyProgram, type LoyaltyRedemption, type LoyaltySummary, type Page } from '@xiro/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../context';
import { clients, items, loyaltyProgramItems, loyaltyPrograms, loyaltyProgress, loyaltyRedemptions } from '../db/schema';
import { AppError, notFound, parse, uuid } from '../errors';
import { decodeCursor, escapeLike, toPage } from '../pagination';
import { clientSearchText } from '../db/search';

const progressQuery = pageQuerySchema.extend({ q: z.string().trim().max(80).optional() });
const redemptionsQuery = pageQuerySchema.extend({ clientId: z.string().max(64).optional() });

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
      // Solo artículos de ESTE negocio: la llave foránea acepta cualquier artículo existente (de cualquier negocio), así
      // que sin esta comprobación se podía enlazar un artículo ajeno (BOLA) y un id inexistente terminaba en error 500.
      if (itemIds.length > 0) {
        const owned = await tx.select({ id: items.id }).from(items).where(and(eq(items.businessId, businessId), inArray(items.id, itemIds)));
        if (owned.length !== itemIds.length) throw notFound();
      }
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

  /**
   * Indicadores de Fidelización sin descargar listas: clientes con premio disponible y canjes registrados (este último
   * solo para quien puede ver el historial de canjes, igual que `/loyalty/redemptions`).
   */
  app.get('/loyalty/summary', async (request): Promise<LoyaltySummary> => {
    const businessId = businessOf(request);
    const loaded = await loadProgram(businessId);
    const goal = loaded?.program.goal ?? DEFAULT_PROGRAM.goal;
    const [rewards] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(loyaltyProgress)
      .innerJoin(clients, and(eq(clients.id, loyaltyProgress.clientId), eq(clients.businessId, businessId)))
      .where(and(eq(loyaltyProgress.businessId, businessId), sql`${loyaltyProgress.count} >= ${goal}`));
    let redeemed: number | null = null;
    if (can(request.actor, 'loyalty_redeem')) {
      const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(loyaltyRedemptions).where(eq(loyaltyRedemptions.businessId, businessId));
      redeemed = row?.count ?? 0;
    }
    return { rewardsAvailable: rewards?.count ?? 0, redeemed };
  });

  /** Progreso por cliente, paginado por cursor (más visitas primero, luego A–Z) y con búsqueda opcional por nombre/teléfono. */
  app.get('/loyalty/clients', async (request): Promise<Page<LoyaltyClientProgress>> => {
    const { q, limit, cursor } = parse(progressQuery, request.query);
    const businessId = businessOf(request);
    const loaded = await loadProgram(businessId);
    const goal = loaded?.program.goal ?? DEFAULT_PROGRAM.goal;
    const count = sql<number>`coalesce(${loyaltyProgress.count}, 0)::int`;
    const lowerName = sql<string>`lower(${clients.name})`;
    const pattern = q ? `%${escapeLike(q)}%` : undefined;
    const after = decodeCursor(cursor, ['number', 'string', 'string']);
    const rows = await db
      .select({ clientId: clients.id, clientName: clients.name, clientPhone: clients.phone, count, lowerName })
      .from(clients)
      .leftJoin(loyaltyProgress, and(eq(loyaltyProgress.clientId, clients.id), eq(loyaltyProgress.businessId, businessId)))
      .where(
        and(
          eq(clients.businessId, businessId),
          // La unión nombre/correo/teléfono usa clients_search_trgm_idx; luego solo nombre o teléfono, como siempre.
          pattern ? and(ilike(clientSearchText(clients.name, clients.email, clients.phone), pattern), or(ilike(clients.name, pattern), ilike(clients.phone, pattern))) : undefined,
          // Más visitas primero; a igual número, A–Z y luego id.
          after
            ? sql`(${count} < ${after[0]}::int OR (${count} = ${after[0]}::int AND (lower(${clients.name}), ${clients.id}) > (${after[1]}, ${after[2]}::uuid)))`
            : undefined,
        ),
      )
      .orderBy(desc(count), asc(lowerName), asc(clients.id))
      .limit(limit + 1);
    return toPage(rows, limit, (r) => [r.count, r.lowerName, r.clientId], (r) => ({ clientId: r.clientId, clientName: r.clientName, clientPhone: r.clientPhone, count: r.count, goal, rewardAvailable: r.count >= goal }));
  });

  /** Historial de canjes paginado por cursor (los más recientes primero); antes se cortaba en 200 sin avisar. */
  app.get('/loyalty/redemptions', async (request): Promise<Page<LoyaltyRedemption>> => {
    const businessId = businessOf(request);
    const query = parse(redemptionsQuery, request.query);
    const redeemedText = sql<string>`${loyaltyRedemptions.redeemedAt}::text`;
    const after = decodeCursor(query.cursor, ['string', 'string']);
    const rows = await db
      .select({ redemption: loyaltyRedemptions, clientName: clients.name, redeemedText })
      .from(loyaltyRedemptions)
      .innerJoin(clients, eq(clients.id, loyaltyRedemptions.clientId))
      .where(
        and(
          eq(loyaltyRedemptions.businessId, businessId),
          query.clientId ? eq(loyaltyRedemptions.clientId, uuid(query.clientId)) : undefined,
          after ? sql`(${loyaltyRedemptions.redeemedAt}, ${loyaltyRedemptions.id}) < (${after[0]}::timestamptz, ${after[1]}::uuid)` : undefined,
        ),
      )
      .orderBy(desc(loyaltyRedemptions.redeemedAt), desc(loyaltyRedemptions.id))
      .limit(query.limit + 1);
    return toPage(rows, query.limit, (row) => [row.redeemedText, row.redemption.id], ({ redemption, clientName }) => ({
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
      // FOR UPDATE: dos canjes simultáneos del mismo premio se ordenan; el segundo ya ve el contador reiniciado.
      const [progress] = await tx
        .select()
        .from(loyaltyProgress)
        .where(and(eq(loyaltyProgress.businessId, businessId), eq(loyaltyProgress.clientId, clientId)))
        .limit(1)
        .for('update');
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
