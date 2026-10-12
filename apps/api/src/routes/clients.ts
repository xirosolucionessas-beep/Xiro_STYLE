import { and, asc, desc, eq, gte, ilike, lt, or, sql } from 'drizzle-orm';
import { clientInputSchema, clientsQuerySchema, clientsSummaryQuerySchema, resetClientPasswordSchema, type Client, type ClientsSummary, type Page } from '@xiro/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../context';
import { businesses, clientAccounts, clientAuditLog, clientSessions, clients, serviceRecords } from '../db/schema';
import { anonymizeClient } from '../booking/privacy';
import { AppError, notFound, parse, uuid } from '../errors';
import { removeMedia, saveAvatarImage } from '../media';
import { decodeCursor, escapeLike, toPage } from '../pagination';
import { clientSearchText } from '../db/search';
import { notifyBusiness } from '../push';
import { hashPassword, readableTempPassword } from '../security';
import { toClient } from '../serializers';

const TEMP_PASSWORD_TTL_MS = 7 * 24 * 60 * 60 * 1000;


export function clientRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db, config } = ctx;
  const resetLimiter = ctx.rates.limiter('client-reset-password', 60 * 60 * 1000);
  const businessOf = (request: { user: { bid: string } }) => request.user.bid;
  const ownedBy = (businessId: string, id: string) => and(eq(clients.id, id), eq(clients.businessId, businessId));

  /**
   * Directorio paginado por cursor (`?limit` 1–100, por defecto 50). `sort=name`: A–Z por nombre (clave
   * `lower(name)` + id, la del índice clients_business_name_idx). `sort=recent`: los últimos creados primero (actividad
   * del Inicio). Siempre acotado al negocio de la sesión.
   */
  app.get('/clients', async (request): Promise<Page<Client>> => {
    const { q, sort, limit, cursor, createdFrom, createdTo } = parse(clientsQuerySchema, request.query);
    const pattern = q ? `%${escapeLike(q)}%` : undefined;
    const lowerName = sql<string>`lower(${clients.name})`;
    const createdText = sql<string>`${clients.createdAt}::text`;
    const after = decodeCursor(cursor, ['string', 'string']);
    const keyset = after
      ? sort === 'recent'
        ? sql`(${clients.createdAt}, ${clients.id}) < (${after[0]}::timestamptz, ${after[1]}::uuid)`
        : sql`(lower(${clients.name}), ${clients.id}) > (${after[0]}, ${after[1]}::uuid)`
      : undefined;
    const rows = await db
      .select({ client: clients, lowerName, createdText })
      .from(clients)
      // El cliente "de mostrador" compartido (ventas sin ficha) nunca aparece en el directorio ni en el buscador.
      .where(
        and(
          eq(clients.businessId, businessOf(request)),
          eq(clients.isOccasional, false),
          // Primero la unión de los tres campos (usa clients_search_trgm_idx), luego cada campo: mismo resultado de siempre.
          pattern ? and(ilike(clientSearchText(clients.name, clients.email, clients.phone), pattern), or(ilike(clients.name, pattern), ilike(clients.email, pattern), ilike(clients.phone, pattern))) : undefined,
          createdFrom ? gte(clients.createdAt, new Date(createdFrom)) : undefined,
          createdTo ? lt(clients.createdAt, new Date(createdTo)) : undefined,
          keyset,
        ),
      )
      .orderBy(...(sort === 'recent' ? [desc(clients.createdAt), desc(clients.id)] : [asc(lowerName), asc(clients.id)]))
      .limit(limit + 1);
    return toPage(rows, limit, (row) => (sort === 'recent' ? [row.createdText, row.client.id] : [row.lowerName, row.client.id]), (row) => toClient(row.client));
  });

  /**
   * Indicadores del directorio sin descargar la lista: total, nuevos (hoy, ayer, este mes — en la zona horaria del
   * negocio), activos en 30 días (con algún servicio no anulado) y, si se pide un rango [from, to), los nuevos del periodo.
   */
  app.get('/clients/summary', async (request): Promise<ClientsSummary> => {
    const { from, to } = parse(clientsSummaryQuerySchema, request.query);
    if ((from === undefined) !== (to === undefined) || (from && to && !(new Date(from) < new Date(to)))) throw new AppError(400, 'date_invalid');
    const businessId = businessOf(request);
    const [business] = await db.select({ timezone: businesses.timezone }).from(businesses).where(eq(businesses.id, businessId)).limit(1);
    if (!business) throw notFound();
    const tz = business.timezone;
    const localDay = sql`(${clients.createdAt} AT TIME ZONE ${tz})::date`;
    const today = sql`(now() AT TIME ZONE ${tz})::date`;
    const [counts] = await db
      .select({
        total: sql<number>`count(*)::int`,
        newToday: sql<number>`(count(*) FILTER (WHERE ${localDay} = ${today}))::int`,
        newYesterday: sql<number>`(count(*) FILTER (WHERE ${localDay} = ${today} - 1))::int`,
        newThisMonth: sql<number>`(count(*) FILTER (WHERE date_trunc('month', ${clients.createdAt} AT TIME ZONE ${tz}) = date_trunc('month', now() AT TIME ZONE ${tz})))::int`,
        newInRange: from && to ? sql<number>`(count(*) FILTER (WHERE ${clients.createdAt} >= ${from}::timestamptz AND ${clients.createdAt} < ${to}::timestamptz))::int` : sql<null>`NULL`,
      })
      .from(clients)
      .where(and(eq(clients.businessId, businessId), eq(clients.isOccasional, false)));
    const [active] = await db
      .select({ count: sql<number>`count(DISTINCT ${serviceRecords.clientId})::int` })
      .from(serviceRecords)
      .where(and(eq(serviceRecords.businessId, businessId), eq(serviceRecords.voided, false), sql`${serviceRecords.createdAt} >= now() - interval '30 days'`));
    return { total: counts?.total ?? 0, newToday: counts?.newToday ?? 0, newYesterday: counts?.newYesterday ?? 0, newThisMonth: counts?.newThisMonth ?? 0, active30d: active?.count ?? 0, newInRange: counts?.newInRange ?? null };
  });

  app.get('/clients/:id', async (request) => {
    const [row] = await db.select().from(clients).where(ownedBy(businessOf(request), uuid((request.params as { id?: string }).id))).limit(1);
    if (!row) throw notFound();
    const [account] = await db.select({ lastLoginAt: clientAccounts.lastLoginAt }).from(clientAccounts).where(eq(clientAccounts.clientId, row.id)).limit(1);
    return { ...toClient(row), onlineAccount: account ? { lastLoginAt: account.lastLoginAt?.toISOString() ?? null } : null };
  });

  app.post('/clients', async (request, reply) => {
    const input = parse(clientInputSchema, request.body);
    const businessId = businessOf(request);
    const [row] = await db
      .insert(clients)
      .values({ businessId, name: input.name, email: input.email ?? null, phone: input.phone ?? null, address: input.address, notes: input.notes })
      .returning();
    // Si fue el propio dueño quien lo registró, no hace falta avisarle a él mismo (`skipUserId`).
    void notifyBusiness(ctx, businessId, 'clients', { titleKey: 'push_client_new_title', bodyKey: 'push_client_new_body', params: { name: row!.name }, dedupeKey: `client_new:${row!.id}`, href: `/client/${row!.id}` }, request.actor.id);
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
    const id = uuid((request.params as { id?: string }).id);
    const businessId = businessOf(request);
    const [existing] = await db.select({ photoFile: clients.photoFile }).from(clients).where(ownedBy(businessId, id)).limit(1);
    const deleted = await db.delete(clients).where(ownedBy(businessId, id)).returning({ id: clients.id });
    if (deleted.length === 0) throw notFound();
    await removeMedia(ctx.media, existing?.photoFile ?? null);
    return reply.status(204).send();
  });

  /** Foto opcional del cliente: igual procesamiento (cuadrada, 400×400, WebP) que la de un profesional o la propia cuenta. */
  app.put('/clients/:id/photo', async (request) => {
    const id = uuid((request.params as { id?: string }).id);
    const businessId = businessOf(request);
    const part = await request.file();
    if (!part) throw new AppError(400, 'photo_invalid');
    const file = await saveAvatarImage(ctx.media, await part.toBuffer());
    if (!file) throw new AppError(400, 'photo_invalid');
    try {
      const [existing] = await db.select({ photoFile: clients.photoFile }).from(clients).where(ownedBy(businessId, id)).limit(1);
      if (!existing) throw notFound();
      const [row] = await db.update(clients).set({ photoFile: file }).where(ownedBy(businessId, id)).returning();
      // Se borra la anterior DESPUÉS de confirmar la nueva: si algo falla antes, el cliente conserva la foto que ya tenía.
      await removeMedia(ctx.media, existing.photoFile);
      return toClient(row!);
    } catch (error) {
      await removeMedia(ctx.media, file);
      throw error;
    }
  });

  app.delete('/clients/:id/photo', async (request) => {
    const id = uuid((request.params as { id?: string }).id);
    const businessId = businessOf(request);
    const [existing] = await db.select({ photoFile: clients.photoFile }).from(clients).where(ownedBy(businessId, id)).limit(1);
    if (!existing) throw notFound();
    const [row] = existing.photoFile ? await db.update(clients).set({ photoFile: null }).where(ownedBy(businessId, id)).returning() : await db.select().from(clients).where(ownedBy(businessId, id));
    await removeMedia(ctx.media, existing.photoFile);
    return toClient(row!);
  });

  /** Derecho de supresión (Ley 1581): borra los datos identificables del cliente y conserva las citas como registro contable. */
  app.post('/clients/:id/anonymize', async (request): Promise<Client> => {
    const id = uuid((request.params as { id?: string }).id);
    const businessId = businessOf(request);
    const result = await db.transaction((tx) => anonymizeClient(tx, businessId, id));
    if (!result) throw notFound();
    await removeMedia(ctx.media, result.previousPhotoFile);
    const [row] = await db.select().from(clients).where(ownedBy(businessId, id)).limit(1);
    return toClient(row!);
  });

  /**
   * Restablecer la contraseña de la cuenta en línea de un cliente (8.10 del encargo): la ÚNICA credencial que el
   * negocio puede tocar — nunca ve la actual, y desde aquí no cambia teléfono, nombre ni foto (eso sigue siendo
   * Clientes normal). Solo el Propietario. Genera una temporal de 7 días que obliga a elegir una propia al entrar,
   * cierra todas las sesiones abiertas de ese cliente y deja auditoría; la temporal se devuelve UNA sola vez y
   * nunca se guarda en claro.
   */
  app.post('/clients/:id/reset-password', async (request) => {
    // El dueño es el único que puede llamar esta ruta — lo exige authz.ts (POLICY), no una comprobación aquí.
    const id = uuid((request.params as { id?: string }).id);
    const businessId = businessOf(request);
    const input = parse(resetClientPasswordSchema, request.body ?? {});

    const key = `client-reset-password:${id}`;
    if ((await resetLimiter.hit(key)) > 5) throw new AppError(429, 'too_many_requests', undefined, { 'Retry-After': String(await resetLimiter.retryAfterSeconds(key)) });

    const [client] = await db.select({ id: clients.id }).from(clients).where(ownedBy(businessId, id)).limit(1);
    if (!client) throw notFound();
    const [account] = await db.select().from(clientAccounts).where(eq(clientAccounts.clientId, id)).limit(1);
    if (!account) throw new AppError(404, 'no_online_account');

    const tempPassword = input.password ?? readableTempPassword(10);
    const passwordHash = await hashPassword(tempPassword);
    await db.transaction(async (tx) => {
      await tx.update(clientAccounts).set({ passwordHash, mustChangePassword: true, tempPasswordExpiresAt: new Date(Date.now() + TEMP_PASSWORD_TTL_MS) }).where(eq(clientAccounts.id, account.id));
      await tx.update(clientSessions).set({ revokedAt: new Date() }).where(eq(clientSessions.accountId, account.id));
      await tx.insert(clientAuditLog).values({ businessId, accountId: account.id, action: 'password_reset', actorUserId: request.actor.id });
    });
    return { tempPassword };
  });
}
