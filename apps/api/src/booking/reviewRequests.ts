import { timingSafeEqual } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { Ctx } from '../context';
import { appointments, clients } from '../db/schema';
import { notFound } from '../errors';
import { deriveToken } from '../security';
import { loadContext } from './availability';
import { withBusinessTrusted } from './scope';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Enlace para reseñar UNA cita (Fase 4): `<id de la cita>.<firma HMAC>`. Se recalcula con el secreto del servidor, así que no
 * hace falta guardarlo, y SOLO sirve para dejar la reseña (no para cancelar ni mover: eso sigue siendo del enlace de gestión,
 * que no se puede reconstruir porque solo se guarda su hash). Está ligado al negocio: con otro negocio no vale.
 */
export function reviewToken(secret: string, businessId: string, appointmentId: string): string {
  return `${appointmentId}.${deriveToken(secret, 'review', businessId, appointmentId)}`;
}

/** El id de la cita si la firma es válida para ESTE negocio; si no, 404 como si no existiera. */
export function verifyReviewToken(secret: string, businessId: string, token: string): string {
  const [id, signature] = token.split('.');
  if (!id || !signature || !UUID.test(id)) throw notFound();
  const expected = Buffer.from(deriveToken(secret, 'review', businessId, id));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw notFound();
  return id;
}

/**
 * Tras completar una cita: si el negocio activó "pedir reseña" y la persona aceptó recibir avisos, se le envía el enlace para
 * reseñar por su canal. Mejor esfuerzo: nunca lanza ni frena el cobro.
 */
export async function requestReview(ctx: Pick<Ctx, 'db' | 'config' | 'notifier'>, businessId: string, appointmentId: string): Promise<boolean> {
  if (!ctx.notifier.sendReviewRequest) return false;
  try {
    const message = await withBusinessTrusted(ctx.db, businessId, async (tx) => {
      const context = await loadContext(tx, businessId);
      if (!context.settings.reviewRequestsEnabled) return null;
      const [row] = await tx.select().from(appointments).where(and(eq(appointments.id, appointmentId), eq(appointments.businessId, businessId))).limit(1);
      if (!row || row.status !== 'completed' || !row.remindersOptIn) return null;
      const [client] = await tx.select({ name: clients.name, phone: clients.phone, email: clients.email }).from(clients).where(and(eq(clients.id, row.clientId), eq(clients.businessId, businessId))).limit(1);
      const channel: 'whatsapp' | 'email' | null = client?.phone ? 'whatsapp' : client?.email ? 'email' : null;
      if (!client || !channel) return null;
      return {
        channel,
        to: (channel === 'whatsapp' ? client.phone : client.email)!,
        clientName: client.name,
        businessName: context.business.name,
        reviewPath: `/reservar/${context.business.slug}/resena/${reviewToken(ctx.config.jwtSecret, businessId, appointmentId)}`,
      };
    });
    if (!message) return false;
    await ctx.notifier.sendReviewRequest(message);
    return true;
  } catch {
    return false;
  }
}
