import { and, desc, eq, sql } from 'drizzle-orm';
import { serviceRecordInputSchema, type ServiceRecord } from '@xiro/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../context';
import { clients, items, loyaltyProgramItems, loyaltyPrograms, loyaltyProgress, serviceRecords } from '../db/schema';
import { notFound, parse, uuid } from '../errors';
import { notifyBusiness } from '../push';

const listQuery = z.object({ clientId: z.string().optional() });

function toServiceRecord(row: typeof serviceRecords.$inferSelect, clientName: string): ServiceRecord {
  return {
    id: row.id,
    clientId: row.clientId,
    clientName,
    itemId: row.itemId,
    label: row.label,
    amount: row.amount,
    note: row.note,
    loyaltyCounted: row.loyaltyCounted,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Registro mínimo de "servicio realizado y cobrado" (todavía no hay un módulo de citas/ventas): cliente + item del
 * catálogo + monto. Es el único disparador de fidelización — ver loyalty.ts. Sección "Fidelización".
 */
export function serviceRecordRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db } = ctx;
  const businessOf = (request: { user: { bid: string; sub: string } }) => request.user.bid;

  app.get('/service-records', async (request) => {
    const { clientId } = parse(listQuery, request.query);
    const businessId = businessOf(request);
    const rows = await db
      .select({ record: serviceRecords, clientName: clients.name })
      .from(serviceRecords)
      .innerJoin(clients, eq(clients.id, serviceRecords.clientId))
      .where(and(eq(serviceRecords.businessId, businessId), clientId ? eq(serviceRecords.clientId, uuid(clientId)) : undefined))
      .orderBy(desc(serviceRecords.createdAt))
      .limit(200);
    return rows.map(({ record, clientName }) => toServiceRecord(record, clientName));
  });

  app.post('/service-records', async (request, reply) => {
    const businessId = businessOf(request);
    const input = parse(serviceRecordInputSchema, request.body);
    const clientId = uuid(input.clientId);
    const itemId = uuid(input.itemId);

    const [client] = await db.select({ id: clients.id, name: clients.name }).from(clients).where(and(eq(clients.id, clientId), eq(clients.businessId, businessId))).limit(1);
    if (!client) throw notFound();
    const [item] = await db.select({ id: items.id, name: items.name, price: items.price }).from(items).where(and(eq(items.id, itemId), eq(items.businessId, businessId))).limit(1);
    if (!item) throw notFound();

    const amount = input.amount ?? item.price;

    const outcome = await db.transaction(async (tx) => {
      const [program] = await tx.select().from(loyaltyPrograms).where(eq(loyaltyPrograms.businessId, businessId)).limit(1);
      let eligible = false;
      if (program?.enabled) {
        const [link] = await tx
          .select()
          .from(loyaltyProgramItems)
          .where(and(eq(loyaltyProgramItems.programId, program.id), eq(loyaltyProgramItems.itemId, itemId)))
          .limit(1);
        eligible = Boolean(link);
      }

      const [record] = await tx
        .insert(serviceRecords)
        .values({ businessId, clientId, itemId, label: item.name, amount, note: input.note, loyaltyCounted: eligible, createdBy: request.user.sub })
        .returning();

      let rewardJustEarned = false;
      if (eligible) {
        const [updated] = await tx
          .insert(loyaltyProgress)
          .values({ businessId, clientId, count: 1 })
          .onConflictDoUpdate({ target: [loyaltyProgress.businessId, loyaltyProgress.clientId], set: { count: sql`${loyaltyProgress.count} + 1`, updatedAt: new Date() } })
          .returning();
        rewardJustEarned = updated!.count >= program!.goal;
      }
      return { record: record!, rewardJustEarned };
    });

    // Fuera de la transacción: el envío de push es un aviso de mejor esfuerzo, nunca debe bloquear ni revertir el registro.
    if (outcome.rewardJustEarned) {
      void notifyBusiness({ db, config: ctx.config }, businessId, 'loyalty', { titleKey: 'push_loyalty_reward_title', bodyKey: 'push_loyalty_reward_body', params: { client: client.name } });
    }

    return reply.status(201).send({ ...toServiceRecord(outcome.record, client.name), rewardJustEarned: outcome.rewardJustEarned });
  });
}
