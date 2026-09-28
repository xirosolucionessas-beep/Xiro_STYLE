import { and, eq, inArray } from 'drizzle-orm';
import { translate, type Language, type TranslationKey } from '@xiro/shared';
import webpush from 'web-push';
import type { Config } from './config';
import type { Database } from './db/client';
import { notificationSettings, pushTokens, users } from './db/schema';
import { AppError } from './errors';

export interface PushEvent {
  titleKey: TranslationKey;
  bodyKey: TranslationKey;
  params?: Record<string, string | number>;
  data?: Record<string, string>;
}

interface PushCtx {
  db: Database;
  config: Config;
}

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

interface ExpoTicket {
  status: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
}

/** Envía hasta 100 mensajes por lote (límite de Expo). Un `DeviceNotRegistered` marca el token para borrarlo. */
async function sendExpoBatch(messages: Array<{ to: string; title: string; body: string; data?: Record<string, string> }>): Promise<Array<{ token: string; ok: boolean; shouldRemove: boolean }>> {
  if (messages.length === 0) return [];
  let tickets: ExpoTicket[] = [];
  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages),
    });
    const body = (await res.json().catch(() => null)) as { data?: ExpoTicket[] } | null;
    tickets = body?.data ?? [];
  } catch {
    // Sin red o Expo caído: ningún token se marca inválido (es transitorio, no un problema del token).
    return messages.map((m) => ({ token: m.to, ok: false, shouldRemove: false }));
  }
  return messages.map((m, i) => {
    const ticket = tickets[i];
    const ok = ticket?.status === 'ok';
    return { token: m.to, ok, shouldRemove: !ok && ticket?.details?.error === 'DeviceNotRegistered' };
  });
}

/** Una suscripción Web Push ya cancelada por el navegador responde 404/410: se borra en vez de reintentar para siempre. */
async function sendWebOne(sub: { token: string; p256dh: string; auth: string }, payload: { title: string; body: string }): Promise<{ token: string; ok: boolean; shouldRemove: boolean }> {
  try {
    await webpush.sendNotification({ endpoint: sub.token, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload));
    return { token: sub.token, ok: true, shouldRemove: false };
  } catch (error) {
    const statusCode = (error as { statusCode?: number }).statusCode;
    return { token: sub.token, ok: false, shouldRemove: statusCode === 404 || statusCode === 410 };
  }
}

type TokenRow = typeof pushTokens.$inferSelect;

async function sendToTokens(ctx: PushCtx, rows: TokenRow[], event: PushEvent): Promise<{ sent: number; pruned: number }> {
  const { db, config } = ctx;
  if (rows.length === 0) return { sent: 0, pruned: 0 };

  const userIds = [...new Set(rows.map((r) => r.userId))];
  const langRows = await db.select({ id: users.id, language: users.language }).from(users).where(inArray(users.id, userIds));
  const langOf = new Map(langRows.map((r) => [r.id, (r.language as Language) ?? 'es']));
  const textFor = (row: TokenRow) => ({
    title: translate(langOf.get(row.userId) ?? 'es', event.titleKey, event.params),
    body: translate(langOf.get(row.userId) ?? 'es', event.bodyKey, event.params),
  });

  let sent = 0;
  const toRemove: string[] = [];

  const expoRows = rows.filter((r) => r.platform === 'expo');
  for (const batch of chunk(expoRows, 90)) {
    const messages = batch.map((r) => ({ to: r.token, ...textFor(r), data: event.data }));
    const results = await sendExpoBatch(messages);
    for (const r of results) {
      if (r.ok) sent += 1;
      if (r.shouldRemove) toRemove.push(r.token);
    }
  }

  const webRows = rows.filter((r) => r.platform === 'web' && r.p256dh && r.auth);
  const { vapidPublicKey, vapidPrivateKey, vapidSubject } = config.notifications;
  if (webRows.length > 0 && vapidPublicKey && vapidPrivateKey && vapidSubject) {
    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
    for (const row of webRows) {
      const result = await sendWebOne({ token: row.token, p256dh: row.p256dh!, auth: row.auth! }, textFor(row));
      if (result.ok) sent += 1;
      if (result.shouldRemove) toRemove.push(result.token);
    }
  }

  if (toRemove.length > 0) await db.delete(pushTokens).where(inArray(pushTokens.token, toRemove));
  return { sent, pruned: toRemove.length };
}

/**
 * Envía un evento del negocio (premio de fidelización, problema de facturación…) a todos los dispositivos
 * registrados, SOLO si el negocio activó notificaciones y esa categoría en particular. No lanza errores: un
 * fallo al enviar push nunca debe tumbar la operación de negocio que lo disparó (registrar un servicio, un webhook).
 */
export async function notifyBusiness(ctx: PushCtx, businessId: string, category: 'loyalty' | 'billing', event: PushEvent): Promise<void> {
  const { db } = ctx;
  const [settings] = await db.select().from(notificationSettings).where(eq(notificationSettings.businessId, businessId)).limit(1);
  if (!settings?.enabled) return;
  if (category === 'loyalty' && !settings.loyaltyEnabled) return;
  if (category === 'billing' && !settings.billingEnabled) return;
  try {
    // Estos avisos (premios, facturación) son del dueño: los dispositivos de empleados nunca los reciben.
    const rows = await db
      .select({ token: pushTokens })
      .from(pushTokens)
      .innerJoin(users, eq(users.id, pushTokens.userId))
      .where(and(eq(pushTokens.businessId, businessId), eq(users.role, 'owner')));
    await sendToTokens(ctx, rows.map((r) => r.token), event);
  } catch {
    // Ver nota arriba: un fallo de red hacia Expo/el navegador no debe propagarse al llamador.
  }
}

/** Fecha/hora corta en formato fijo (día/mes, 24h) para el cuerpo de un aviso: no depende del idioma de quien lo recibe,
 * a diferencia del resto del texto (que sí se traduce por dispositivo en `sendToTokens`). */
export function formatPushMoment(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('es-CO', { timeZone: timezone, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
}

/**
 * Aviso de un evento de UNA cita (reserva nueva, cancelación, cambio de horario, reseña) a los dispositivos del
 * profesional asignado — nunca al cliente, que no tiene la app. Se salta cuando quien originó el cambio es ese mismo
 * profesional (ya lo sabe, lo acaba de hacer) y cuando el negocio desactivó la categoría correspondiente.
 */
export async function notifyAppointment(ctx: PushCtx, businessId: string, professionalId: string, skipUserId: string | null, category: 'appointments' | 'reviews', event: PushEvent): Promise<void> {
  if (professionalId === skipUserId) return;
  const { db } = ctx;
  const [settings] = await db.select().from(notificationSettings).where(eq(notificationSettings.businessId, businessId)).limit(1);
  if (!settings?.enabled) return;
  if (category === 'appointments' && !settings.appointmentsEnabled) return;
  if (category === 'reviews' && !settings.reviewsEnabled) return;
  try {
    const rows = await db.select().from(pushTokens).where(and(eq(pushTokens.businessId, businessId), eq(pushTokens.userId, professionalId)));
    await sendToTokens(ctx, rows, event);
  } catch {
    // Ver nota en notifyBusiness: un fallo de red hacia Expo/el navegador no debe propagarse al llamador.
  }
}

/** Envío explícito a los dispositivos del usuario que lo pide (botón "Enviar notificación de prueba"): SIEMPRE se
 * intenta, sin mirar los interruptores — es una acción directa de la persona, no un evento automático. */
export async function sendTestNotification(ctx: PushCtx, businessId: string, userId: string): Promise<{ sent: number; pruned: number }> {
  const rows = await ctx.db.select().from(pushTokens).where(eq(pushTokens.userId, userId));
  if (rows.length === 0) throw new AppError(400, 'push_no_devices');
  const ownRows = rows.filter((r) => r.businessId === businessId);
  return sendToTokens(ctx, ownRows, { titleKey: 'push_test_title', bodyKey: 'push_test_body' });
}
