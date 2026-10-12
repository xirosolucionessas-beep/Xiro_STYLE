import { and, desc, eq, inArray, isNull, ne, or } from 'drizzle-orm';
import { sendMessageInputSchema, startConversationInputSchema, type ConversationDto, type MessageDto, type MessagePerson } from '@xiro/shared';
import type { FastifyInstance } from 'fastify';
import { withBusiness, type Tx } from '../booking/scope';
import type { Ctx } from '../context';
import { isUniqueViolation } from '../db/errors';
import { conversations, messages, users } from '../db/schema';
import { AppError, notFound, parse, uuid } from '../errors';
import { mediaUrl } from '../media';

/** Cuántos mensajes recientes del negocio se leen para armar "el último mensaje" de cada chat: de sobra para un equipo normal. */
const RECENT_MESSAGES_FOR_PREVIEW = 300;

function toPerson(row: typeof users.$inferSelect): MessagePerson {
  return { id: row.id, name: row.name, photoUrl: row.photoFile ? mediaUrl(row.photoFile) : null, isOwner: row.role === 'owner' };
}

function toMessage(row: typeof messages.$inferSelect): MessageDto {
  return { id: row.id, conversationId: row.conversationId, senderId: row.senderId, content: row.content, createdAt: row.createdAt.toISOString(), readAt: row.readAt?.toISOString() ?? null };
}

/**
 * Chat interno 1 a 1 entre personas del MISMO negocio (dueño y empleados; nunca con un cliente, que no inicia sesión —
 * para eso ya está WhatsApp, visible en toda la app). Con Row Level Security desde que nace (ver 0013_messages.sql):
 * aunque una consulta olvidara el filtro por negocio, Postgres no dejaría ver ni escribir filas de otro negocio.
 */
export function messagesRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db } = ctx;
  const scoped = <T>(request: { user: { bid: string } }, fn: (tx: Tx) => Promise<T>) => withBusiness(db, request.user.bid, fn);

  /** La conversación pedida, solo si quien pregunta es una de las dos personas (si no, 404: no confirma que exista). */
  async function requireConversation(tx: Tx, businessId: string, id: string, me: string) {
    const [row] = await tx.select().from(conversations).where(and(eq(conversations.id, id), eq(conversations.businessId, businessId))).limit(1);
    if (!row || (row.userAId !== me && row.userBId !== me)) throw notFound();
    return row;
  }

  app.get('/messages/people', async (request): Promise<MessagePerson[]> => {
    return scoped(request, async (tx) => {
      const rows = await tx
        .select()
        .from(users)
        .where(and(eq(users.businessId, request.user.bid), eq(users.active, true), ne(users.id, request.user.sub)))
        .orderBy(users.name);
      return rows.map(toPerson);
    });
  });

  // Sin paginar a propósito: hay como mucho UNA conversación por cada par de personas del equipo, así que la lista de
  // cada usuario está acotada por el tamaño del equipo (no crece con clientes, ventas ni mensajes).
  app.get('/messages/conversations', async (request): Promise<ConversationDto[]> => {
    return scoped(request, async (tx) => {
      const me = request.user.sub;
      const convRows = await tx
        .select()
        .from(conversations)
        .where(and(eq(conversations.businessId, request.user.bid), or(eq(conversations.userAId, me), eq(conversations.userBId, me))))
        .orderBy(desc(conversations.lastMessageAt));
      if (convRows.length === 0) return [];

      const peerIds = convRows.map((c) => (c.userAId === me ? c.userBId : c.userAId));
      const peopleRows = await tx.select().from(users).where(and(eq(users.businessId, request.user.bid), inArray(users.id, peerIds)));
      const peopleById = new Map(peopleRows.map((row) => [row.id, toPerson(row)]));

      const convIds = convRows.map((c) => c.id);
      // "Último mensaje" de cada chat: se aproxima con los más recientes del negocio (de sobra para un equipo normal).
      const recent = await tx
        .select()
        .from(messages)
        .where(and(eq(messages.businessId, request.user.bid), inArray(messages.conversationId, convIds)))
        .orderBy(desc(messages.createdAt))
        .limit(RECENT_MESSAGES_FOR_PREVIEW);
      const lastByConv = new Map<string, (typeof recent)[number]>();
      for (const m of recent) if (!lastByConv.has(m.conversationId)) lastByConv.set(m.conversationId, m);

      // Sin leer: cálculo exacto (no una muestra), lo que la otra persona escribió y yo no he abierto.
      const unread = await tx
        .select({ conversationId: messages.conversationId })
        .from(messages)
        .where(and(eq(messages.businessId, request.user.bid), inArray(messages.conversationId, convIds), isNull(messages.readAt), ne(messages.senderId, me)));
      const unreadByConv = new Map<string, number>();
      for (const m of unread) unreadByConv.set(m.conversationId, (unreadByConv.get(m.conversationId) ?? 0) + 1);

      return convRows.map((c): ConversationDto => {
        const peerId = c.userAId === me ? c.userBId : c.userAId;
        const last = lastByConv.get(c.id);
        return {
          id: c.id,
          peer: peopleById.get(peerId) ?? { id: peerId, name: '', photoUrl: null, isOwner: false },
          lastMessage: last ? { content: last.content, senderId: last.senderId, createdAt: last.createdAt.toISOString() } : null,
          unreadCount: unreadByConv.get(c.id) ?? 0,
          updatedAt: c.lastMessageAt.toISOString(),
        };
      });
    });
  });

  /** Empieza (o retoma) el chat con esa persona: mismo par, siempre la misma conversación, sin importar quién la abre primero. */
  app.post('/messages/conversations', async (request): Promise<ConversationDto> => {
    const { userId: rawUserId } = parse(startConversationInputSchema, request.body);
    const userId = rawUserId.toLowerCase(); // mismo orden que Postgres (que guarda y compara el uuid ya normalizado)
    return scoped(request, async (tx) => {
      const me = request.user.sub;
      if (userId === me) throw new AppError(400, 'validation_error');
      const [peerRow] = await tx.select().from(users).where(and(eq(users.id, userId), eq(users.businessId, request.user.bid), eq(users.active, true))).limit(1);
      if (!peerRow) throw notFound();
      const [userAId, userBId] = [me, userId].sort();

      async function existing() {
        const [row] = await tx
          .select()
          .from(conversations)
          .where(and(eq(conversations.businessId, request.user.bid), eq(conversations.userAId, userAId!), eq(conversations.userBId, userBId!)))
          .limit(1);
        return row;
      }

      let row = await existing();
      if (!row) {
        try {
          [row] = await tx.insert(conversations).values({ businessId: request.user.bid, userAId: userAId!, userBId: userBId! }).returning();
        } catch (error) {
          if (!isUniqueViolation(error, 'conversations_pair_uq')) throw error;
          row = await existing(); // otro mensaje al mismo tiempo ya la creó: se usa esa
        }
      }
      return { id: row!.id, peer: toPerson(peerRow), lastMessage: null, unreadCount: 0, updatedAt: row!.lastMessageAt.toISOString() };
    });
  });

  app.get('/messages/conversations/:id/messages', async (request): Promise<MessageDto[]> => {
    const id = uuid((request.params as { id?: string }).id);
    return scoped(request, async (tx) => {
      await requireConversation(tx, request.user.bid, id, request.user.sub);
      const rows = await tx.select().from(messages).where(and(eq(messages.businessId, request.user.bid), eq(messages.conversationId, id))).orderBy(messages.createdAt).limit(200);
      return rows.map(toMessage);
    });
  });

  app.post('/messages/conversations/:id/messages', async (request, reply): Promise<MessageDto> => {
    const id = uuid((request.params as { id?: string }).id);
    const { content } = parse(sendMessageInputSchema, request.body);
    const message = await scoped(request, async (tx) => {
      await requireConversation(tx, request.user.bid, id, request.user.sub);
      const [row] = await tx.insert(messages).values({ businessId: request.user.bid, conversationId: id, senderId: request.user.sub, content }).returning();
      await tx.update(conversations).set({ lastMessageAt: row!.createdAt }).where(eq(conversations.id, id));
      return row!;
    });
    return reply.status(201).send(toMessage(message));
  });

  app.post('/messages/conversations/:id/read', async (request): Promise<{ ok: true }> => {
    const id = uuid((request.params as { id?: string }).id);
    await scoped(request, async (tx) => {
      const me = request.user.sub;
      await requireConversation(tx, request.user.bid, id, me);
      await tx
        .update(messages)
        .set({ readAt: new Date() })
        .where(and(eq(messages.businessId, request.user.bid), eq(messages.conversationId, id), isNull(messages.readAt), ne(messages.senderId, me)));
    });
    return { ok: true };
  });
}
