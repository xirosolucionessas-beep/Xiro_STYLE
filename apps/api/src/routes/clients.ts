import { and, asc, eq, ilike, or, sql } from 'drizzle-orm';
import { clientInputSchema, type Client } from '@xiro/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../context';
import { clients } from '../db/schema';
import { anonymizeClient } from '../booking/privacy';
import { notFound, parse, uuid } from '../errors';
import { toClient } from '../serializers';

const listQuery = z.object({ q: z.string().trim().max(80).optional() });

/** Escapa los comodines de LIKE para que la búsqueda sea literal (p. ej. "%" no coincide con todo). */
const escapeLike = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`);

export function clientRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db } = ctx;
  const businessOf = (request: { user: { bid: string } }) => request.user.bid;
  const ownedBy = (businessId: string, id: string) => and(eq(clients.id, id), eq(clients.businessId, businessId));

  app.get('/clients', async (request) => {
    const { q } = parse(listQuery, request.query);
    const pattern = q ? `%${escapeLike(q)}%` : undefined;
    const rows = await db
      .select()
      .from(clients)
      .where(and(eq(clients.businessId, businessOf(request)), pattern ? or(ilike(clients.name, pattern), ilike(clients.email, pattern), ilike(clients.phone, pattern)) : undefined))
      .orderBy(asc(sql`lower(${clients.name})`));
    return rows.map(toClient);
  });

  app.get('/clients/:id', async (request) => {
    const [row] = await db.select().from(clients).where(ownedBy(businessOf(request), uuid((request.params as { id?: string }).id))).limit(1);
    if (!row) throw notFound();
    return toClient(row);
  });

  app.post('/clients', async (request, reply) => {
    const input = parse(clientInputSchema, request.body);
    const [row] = await db
      .insert(clients)
      .values({ businessId: businessOf(request), name: input.name, email: input.email ?? null, phone: input.phone ?? null, address: input.address, notes: input.notes })
      .returning();
    return reply.status(201).send(toClient(row!));
  });

  app.put('/clients/:id', async (request) => {
    const id = uuid((request.params as { id?: string }).id);
    const input = parse(clientInputSchema, request.body);
    const [row] = await db
      .update(clients)
      .set({ name: input.name, email: input.email ?? null, phone: input.phone ?? null, address: input.address, notes: input.notes })
      .where(ownedBy(businessOf(request), id))
      .returning();
    if (!row) throw notFound();
    return toClient(row);
  });

  app.delete('/clients/:id', async (request, reply) => {
    const deleted = await db.delete(clients).where(ownedBy(businessOf(request), uuid((request.params as { id?: string }).id))).returning({ id: clients.id });
    if (deleted.length === 0) throw notFound();
    return reply.status(204).send();
  });

  /** Derecho de supresión (Ley 1581): borra los datos identificables del cliente y conserva las citas como registro contable. */
  app.post('/clients/:id/anonymize', async (request): Promise<Client> => {
    const id = uuid((request.params as { id?: string }).id);
    const businessId = businessOf(request);
    const ok = await db.transaction((tx) => anonymizeClient(tx, businessId, id));
    if (!ok) throw notFound();
    const [row] = await db.select().from(clients).where(ownedBy(businessId, id)).limit(1);
    return toClient(row!);
  });
}
