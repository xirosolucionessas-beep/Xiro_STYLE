import { and, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { serviceRecordInputSchema, serviceRecordsByClientQuerySchema, serviceRecordsQuerySchema, serviceRecordsSummaryQuerySchema, type ClientVisits, type Page, type ServiceRecord, type ServiceRecordsSummary } from '@xiro/shared';
import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../context';
import { clients, items, serviceRecords } from '../db/schema';
import { AppError, notFound, parse, uuid } from '../errors';
import { decodeCursor, descNullsLast, toPage } from '../pagination';
import { notifyBusiness } from '../push';
import { recordService } from '../serviceRecording';

/** Rango [from, to) opcional: ambos o ninguno, y `from` antes que `to`. */
function rangeOf(from: string | undefined, to: string | undefined) {
  if ((from === undefined) !== (to === undefined) || (from && to && !(new Date(from) < new Date(to)))) throw new AppError(400, 'date_invalid');
  return from && to ? and(gte(serviceRecords.createdAt, new Date(from)), lt(serviceRecords.createdAt, new Date(to))) : undefined;
}

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

  /**
   * Historial paginado por cursor (los más recientes primero; `?limit` 1–100, por defecto 50), opcionalmente de un
   * cliente y/o de un rango [from, to). Antes se cortaba en 200 sin avisar; ahora se recorre página a página.
   */
  app.get('/service-records', async (request): Promise<Page<ServiceRecord>> => {
    const { clientId, from, to, limit, cursor } = parse(serviceRecordsQuerySchema, request.query);
    const businessId = businessOf(request);
    const createdText = sql<string>`${serviceRecords.createdAt}::text`;
    const after = decodeCursor(cursor, ['string', 'string']);
    const rows = await db
      .select({ record: serviceRecords, clientName: clients.name, createdText })
      .from(serviceRecords)
      .innerJoin(clients, eq(clients.id, serviceRecords.clientId))
      .where(
        and(
          eq(serviceRecords.businessId, businessId),
          eq(serviceRecords.voided, false),
          clientId ? eq(serviceRecords.clientId, clientId) : undefined,
          rangeOf(from, to),
          after ? sql`(${serviceRecords.createdAt}, ${serviceRecords.id}) < (${after[0]}::timestamptz, ${after[1]}::uuid)` : undefined,
        ),
      )
      .orderBy(descNullsLast(serviceRecords.createdAt), desc(serviceRecords.id))
      .limit(limit + 1);
    return toPage(rows, limit, (row) => [row.createdText, row.record.id], ({ record, clientName }) => toServiceRecord(record, clientName));
  });

  /**
   * Cifras sin descargar el historial: cantidad, total, ticket promedio, último registro y el servicio más pedido
   * (`null` si hay empate). Mismos criterios que la app (`daySummary`, `clientHistory`); solo registros no anulados.
   */
  /**
   * Visitas (cantidad y último servicio) de los clientes visibles en una página del directorio — en una sola consulta
   * agrupada, sin descargar historiales. Un id de otro negocio simplemente no aparece (filtro por `business_id`).
   */
  app.get('/service-records/by-client', async (request): Promise<ClientVisits[]> => {
    const { clientIds } = parse(serviceRecordsByClientQuerySchema, request.query);
    const rows = await db
      .select({ clientId: serviceRecords.clientId, count: sql<number>`count(*)::int`, lastAt: sql<string | null>`max(${serviceRecords.createdAt})` })
      .from(serviceRecords)
      .where(and(eq(serviceRecords.businessId, businessOf(request)), eq(serviceRecords.voided, false), inArray(serviceRecords.clientId, clientIds)))
      .groupBy(serviceRecords.clientId);
    return rows.map((row) => ({ clientId: row.clientId, count: row.count, lastAt: row.lastAt ? new Date(row.lastAt).toISOString() : null }));
  });

  app.get('/service-records/summary', async (request): Promise<ServiceRecordsSummary> => {
    const { clientId, kind, from, to } = parse(serviceRecordsSummaryQuerySchema, request.query);
    const where = and(eq(serviceRecords.businessId, businessOf(request)), eq(serviceRecords.voided, false), clientId ? eq(serviceRecords.clientId, clientId) : undefined, kind ? eq(serviceRecords.kind, kind) : undefined, rangeOf(from, to));
    const [totals] = await db
      .select({ count: sql<number>`count(*)::int`, total: sql<string>`coalesce(sum(${serviceRecords.amount}), 0)::text`, lastAt: sql<string | null>`max(${serviceRecords.createdAt})` })
      .from(serviceRecords)
      .where(where);
    const top = await db
      .select({ label: serviceRecords.label, count: sql<number>`count(*)::int` })
      .from(serviceRecords)
      .where(where)
      .groupBy(serviceRecords.label)
      .orderBy(desc(sql`count(*)`), serviceRecords.label)
      .limit(2);
    const count = totals?.count ?? 0;
    const total = Number(totals?.total ?? 0);
    const topLabel = top.length === 1 || (top.length === 2 && top[0]!.count > top[1]!.count) ? top[0]!.label : null;
    return { count, total, average: count > 0 ? Math.round(total / count) : null, lastAt: totals?.lastAt ? new Date(totals.lastAt).toISOString() : null, topLabel };
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
