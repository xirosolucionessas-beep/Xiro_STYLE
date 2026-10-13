import type { PublicWaitlistDto, WaitlistEntryDto, WaitlistStatus } from '@xiro/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Ctx } from '../context';
import { items, waitlistEntries } from '../db/schema';
import { AppError, notFound } from '../errors';
import { notifyBusiness } from '../push';
import { randomToken } from '../security';
import type { BusinessRow } from '../serializers';
import { findOrCreateClient, hashToken } from './appointments';
import { loadContext, prepare, slotsForDays, type BookingContext } from './availability';
import { withBusiness, type Tx } from './scope';
import { addDays, isRealDate, localDate } from './time';

export type WaitlistRow = typeof waitlistEntries.$inferSelect;

/** Máximo de esperas activas por cliente (un bot no llena la lista de un negocio). */
const MAX_WAITING_PER_CLIENT = 3;
/** A cuántas personas se avisa cada vez que se libera algo ese día (en orden de llegada): pocas, para no crear una carrera. */
const NOTIFY_PER_RELEASE = 3;

const selectionFor = (serviceIds: string[]) => ({ services: serviceIds.map((itemId) => ({ itemId, variantId: null })), packages: [], products: [] });

export interface CreateWaitlistInput {
  date: string;
  serviceIds: string[];
  professionalId: string;
  customer: { name: string; phone: string; email?: string | undefined };
  now: Date;
  termsIp: string | null;
}

/**
 * Anota a alguien en la lista de un día. Valida como una reserva: servicios reservables de ESTE negocio, profesional apto y
 * día dentro del horizonte. Si ya esperaba ese día, se renueva su enlace (no se duplica). Devuelve el enlace personal UNA vez.
 */
export async function joinWaitlist(tx: Tx, businessId: string, context: BookingContext, input: CreateWaitlistInput): Promise<{ row: WaitlistRow; token: string }> {
  const today = localDate(input.now, context.business.timezone);
  if (!isRealDate(input.date) || input.date < today || input.date > addDays(today, context.settings.maxDaysAhead)) throw new AppError(400, 'date_invalid');
  // Mismas reglas que reservar: si el servicio no se ofrece en línea o ese profesional no lo hace, no hay a qué esperar.
  await prepare(tx, businessId, { selection: selectionFor(input.serviceIds), professionalId: input.professionalId, staff: false, ctx: context });
  const clientId = await findOrCreateClient(tx, businessId, { name: input.customer.name, phone: input.customer.phone, email: input.customer.email });
  const token = randomToken(32);

  const [existing] = await tx.select().from(waitlistEntries).where(and(eq(waitlistEntries.businessId, businessId), eq(waitlistEntries.clientId, clientId), eq(waitlistEntries.date, input.date), eq(waitlistEntries.status, 'waiting'))).limit(1);
  if (existing) {
    const [row] = await tx
      .update(waitlistEntries)
      .set({ tokenHash: hashToken(token), serviceIds: input.serviceIds, professionalId: input.professionalId === 'any' ? null : input.professionalId })
      .where(and(eq(waitlistEntries.id, existing.id), eq(waitlistEntries.businessId, businessId)))
      .returning();
    return { row: row!, token };
  }
  const [open] = await tx.select({ n: sql<number>`count(*)::int` }).from(waitlistEntries).where(and(eq(waitlistEntries.businessId, businessId), eq(waitlistEntries.clientId, clientId), eq(waitlistEntries.status, 'waiting')));
  if ((open?.n ?? 0) >= MAX_WAITING_PER_CLIENT) throw new AppError(429, 'too_many_pending');
  const [row] = await tx
    .insert(waitlistEntries)
    .values({
      businessId,
      clientId,
      date: input.date,
      serviceIds: input.serviceIds,
      professionalId: input.professionalId === 'any' ? null : input.professionalId,
      customerName: input.customer.name,
      customerPhone: input.customer.phone,
      customerEmail: input.customer.email ?? null,
      tokenHash: hashToken(token),
      termsAcceptedAt: input.now,
      termsAcceptedIp: input.termsIp,
    })
    .returning();
  return { row: row!, token };
}

async function serviceNames(tx: Tx, businessId: string, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await tx.select({ id: items.id, name: items.name }).from(items).where(and(eq(items.businessId, businessId), inArray(items.id, [...new Set(ids)])));
  return new Map(rows.map((r) => [r.id, r.name]));
}

export async function toPublicWaitlist(tx: Tx, business: BusinessRow, row: WaitlistRow, displayName: string): Promise<PublicWaitlistDto> {
  const names = await serviceNames(tx, business.id, row.serviceIds);
  return { date: row.date, status: row.status as WaitlistStatus, services: row.serviceIds.map((id) => names.get(id) ?? '').filter(Boolean), business: { name: displayName || business.name, slug: business.slug } };
}

export async function loadWaitlistDtos(tx: Tx, businessId: string, rows: WaitlistRow[]): Promise<WaitlistEntryDto[]> {
  const names = await serviceNames(tx, businessId, rows.flatMap((r) => r.serviceIds));
  return rows.map((row) => ({
    id: row.id,
    date: row.date,
    status: row.status as WaitlistStatus,
    clientId: row.clientId,
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    customerEmail: row.customerEmail,
    services: row.serviceIds.map((id) => ({ id, name: names.get(id) ?? '' })),
    professionalId: row.professionalId,
    notifiedAt: row.notifiedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }));
}

/** El lugar de alguien por su enlace personal, SOLO si es de este negocio (si no, 404 como si no existiera). */
export async function waitlistByToken(tx: Tx, businessId: string, token: string): Promise<WaitlistRow> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw notFound();
  const [row] = await tx.select().from(waitlistEntries).where(and(eq(waitlistEntries.tokenHash, hashToken(token)), eq(waitlistEntries.businessId, businessId))).limit(1);
  if (!row) throw notFound();
  return row;
}

/**
 * Se liberó algo el día `date` (local del negocio): para las primeras personas que esperan ese día, en orden de llegada, se
 * comprueba si hay un horario libre que les SIRVA (sus servicios y su profesional) y se les avisa — al negocio por push y a la
 * persona por su canal. Cada persona se avisa una sola vez (pasa a `notified`). Mejor esfuerzo: nunca lanza.
 */
export async function processWaitlist(ctx: Ctx, businessId: string, date: string, now = new Date()): Promise<WaitlistRow[]> {
  try {
    const result = await withBusiness(ctx.db, businessId, async (tx) => {
      const context = await loadContext(tx, businessId);
      if (!context.settings.waitlistEnabled || date < localDate(now, context.business.timezone)) return { notified: [] as WaitlistRow[], context };
      const waiting = await tx
        .select()
        .from(waitlistEntries)
        .where(and(eq(waitlistEntries.businessId, businessId), eq(waitlistEntries.date, date), eq(waitlistEntries.status, 'waiting')))
        .orderBy(asc(waitlistEntries.createdAt))
        .limit(20);
      const notified: WaitlistRow[] = [];
      for (const entry of waiting) {
        if (notified.length >= NOTIFY_PER_RELEASE) break;
        const fits = await prepare(tx, businessId, { selection: selectionFor(entry.serviceIds), professionalId: entry.professionalId ?? 'any', staff: false, ctx: context })
          .then(async (p) => (await slotsForDays(tx, businessId, p, now, date, 1))[0]?.slots.some((s) => s.state === 'available') ?? false)
          .catch(() => false); // un servicio que ya no se ofrece: esa espera simplemente no aplica
        if (!fits) continue;
        const [marked] = await tx
          .update(waitlistEntries)
          .set({ status: 'notified', notifiedAt: now })
          .where(and(eq(waitlistEntries.id, entry.id), eq(waitlistEntries.businessId, businessId), eq(waitlistEntries.status, 'waiting')))
          .returning();
        if (marked) notified.push(marked);
      }
      return { notified, context };
    });
    for (const entry of result.notified) {
      void notifyBusiness(ctx, businessId, 'appointments', {
        titleKey: 'push_waitlist_title',
        bodyKey: 'push_waitlist_body',
        params: { name: entry.customerName, date: entry.date },
        dedupeKey: `waitlist:${entry.id}`,
        href: '/booking',
      });
      const channel: 'whatsapp' | 'email' = entry.customerPhone ? 'whatsapp' : 'email';
      void ctx.notifier
        .sendWaitlistAvailable?.({ channel, to: entry.customerPhone || entry.customerEmail || '', clientName: entry.customerName, businessName: result.context.business.name, date: entry.date, bookingPath: `/reservar/${result.context.business.slug}` })
        .catch(() => undefined);
    }
    return result.notified;
  } catch {
    return [];
  }
}

/** Un horario de una cita quedó libre (se canceló o se movió de ese instante): revisa la lista de espera de ese día. */
export function onSlotReleased(ctx: Ctx, businessId: string, startsAt: Date | string, timezone: string): Promise<WaitlistRow[]> {
  return processWaitlist(ctx, businessId, localDate(new Date(startsAt), timezone));
}
