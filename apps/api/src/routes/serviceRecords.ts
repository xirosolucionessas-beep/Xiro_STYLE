import { and, desc, eq } from 'drizzle-orm';
import { serviceRecordInputSchema, type ServiceRecord } from '@xiro/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../context';
import { clients, items, serviceRecords } from '../db/schema';
import { notFound, parse, uuid } from '../errors';
import { notifyBusiness } from '../push';
import { recordService } from '../serviceRecording';

const listQuery = z.object({ clientId: z.string().optional() });

function toServiceRecord(row: typeof serviceRecords.$inferSelect, clientName: string): ServiceRecord {
  return {
    id: row.id,
    clientId: row.clientId,
    clientName,
    itemId: row.itemId,
    label: row.label,
    amount: row.amount,
    kind: row.kind as ServiceRecord['kind'],
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
      .where(and(eq(serviceRecords.businessId, businessId), eq(serviceRecords.voided, false), clientId ? eq(serviceRecords.clientId, uuid(clientId)) : undefined))
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
    const [item] = await db.select({ id: items.id, name: items.name, price: items.price, kind: items.kind }).from(items).where(and(eq(items.id, itemId), eq(items.businessId, businessId))).limit(1);
    if (!item) throw notFound();

    const amount = input.amount ?? item.price;

    const outcome = await db.transaction((tx) => recordService(tx, { businessId, clientId, itemId, label: item.name, amount, kind: item.kind as 'service' | 'product', note: input.note, createdBy: request.user.sub }));

    // Fuera de la transacción: el envío de push es un aviso de mejor esfuerzo, nunca debe bloquear ni revertir el registro.
    if (outcome.rewardJustEarned) {
      void notifyBusiness({ db, config: ctx.config }, businessId, 'loyalty', { titleKey: 'push_loyalty_reward_title', bodyKey: 'push_loyalty_reward_body', params: { client: client.name }, dedupeKey: `loyalty:${outcome.record.id}`, href: `/client/${client.id}` });
    }

    return reply.status(201).send({ ...toServiceRecord(outcome.record, client.name), rewardJustEarned: outcome.rewardJustEarned });
  });
}
