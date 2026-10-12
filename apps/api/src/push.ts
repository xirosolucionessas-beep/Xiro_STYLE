import { and, eq, inArray } from 'drizzle-orm';
import { isAllowedPushEndpoint, translate, type Language, type NotificationCategory, type TranslationKey } from '@xiro/shared';
import webpush from 'web-push';
import type { Config } from './config';
import type { Database } from './db/client';
import { notifications, notificationSettings, pushTokens, users } from './db/schema';
import { AppError } from './errors';

export interface PushEvent {
  titleKey: TranslationKey;
  bodyKey: TranslationKey;
  params?: Record<string, string | number>;
  data?: Record<string, string>;
  /**
   * Clave de idempotencia para el CENTRO de notificaciones (no para el push en sí): el mismo evento real reenviado
   * (p. ej. un webhook reintentado) nunca crea una segunda fila para la misma persona. Sin esta clave, el evento
   * se envía por push igual (si corresponde) pero no queda guardado en el centro — úsala siempre que el evento
   * tenga una identidad estable (id de cita, id de registro de servicio, id de evento del proveedor de pago…).
   */
  dedupeKey?: string;
  /** Ruta dentro de la app a la que llevar al tocar la notificación (sección "Deep linking"); sin ella, no hay destino específico. */
  href?: string;
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
async function sendWebOne(sub: { token: string; p256dh: string; auth: string }, payload: { title: string; body: string; data?: Record<string, string> }): Promise<{ token: string; ok: boolean; shouldRemove: boolean }> {
  // Defensa en profundidad (SSRF): solo servicios de push reales, aunque la fila venga de antes de validar al registrar.
  if (!isAllowedPushEndpoint(sub.token)) return { token: sub.token, ok: false, shouldRemove: true };
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
  // La ruta de destino (sección "Deep linking") viaja en `data.url` del propio aviso push, no solo en el centro:
  // así el Service Worker (web) y el manejador de toque (nativo) saben a dónde navegar sin pedir nada más.
  const data = event.href ? { ...event.data, url: event.href } : event.data;

  let sent = 0;
  const toRemove: string[] = [];

  const expoRows = rows.filter((r) => r.platform === 'expo');
  for (const batch of chunk(expoRows, 90)) {
    const messages = batch.map((r) => ({ to: r.token, ...textFor(r), data }));
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
      // `data` (p. ej. la ruta de destino para el clic) ahora SÍ viaja al navegador, igual que ya viajaba a Expo — antes se perdía aquí.
      const result = await sendWebOne({ token: row.token, p256dh: row.p256dh!, auth: row.auth! }, { ...textFor(row), data });
      if (result.ok) sent += 1;
      if (result.shouldRemove) toRemove.push(result.token);
    }
  }

  if (toRemove.length > 0) await db.delete(pushTokens).where(inArray(pushTokens.token, toRemove));
  return { sent, pruned: toRemove.length };
}

/**
 * Guarda la notificación en el centro de la app para UNA persona, siempre (nunca depende de sus preferencias de
 * push: esas solo deciden si ADEMÁS se le manda un aviso al dispositivo). Sin `dedupeKey` no hay garantía de no
 * duplicar, así que se omite el guardado en ese caso (el único llamador sin clave es la notificación de prueba,
 * que no tiene sentido guardar en el historial). Un fallo aquí nunca debe tumbar la operación que lo disparó.
 */
async function persistNotification(db: Database, businessId: string, userId: string, category: NotificationCategory, event: PushEvent): Promise<void> {
  if (!event.dedupeKey) return;
  try {
    await db
      .insert(notifications)
      .values({ businessId, userId, category, titleKey: event.titleKey, bodyKey: event.bodyKey, params: event.params ?? {}, href: event.href ?? null, dedupeKey: event.dedupeKey })
      .onConflictDoNothing({ target: [notifications.userId, notifications.dedupeKey] });
  } catch {
    // Ver nota arriba: un fallo al guardar nunca debe propagarse al llamador.
  }
}

/** Qué interruptor de `notification_settings` (además del general `enabled`) manda en cada categoría. */
const CATEGORY_SETTING = {
  appointments: 'appointmentsEnabled',
  reviews: 'reviewsEnabled',
  loyalty: 'loyaltyEnabled',
  billing: 'billingEnabled',
  clients: 'clientsEnabled',
  sales: 'salesEnabled',
  inventory: 'inventoryEnabled',
  employees: 'employeesEnabled',
  security: 'securityEnabled',
} as const satisfies Record<NotificationCategory, keyof typeof notificationSettings.$inferSelect>;

/**
 * Aviso de UNA persona concreta (dueño o empleado, el que sea): se guarda SIEMPRE en su centro de notificaciones, y
 * ADEMÁS se manda por push a sus dispositivos si el negocio activó notificaciones y esa categoría en particular. No
 * lanza errores: un fallo aquí nunca debe tumbar la operación de negocio que lo disparó (una venta, un webhook…).
 * Base de `notifyBusiness` (todos los dueños) y `notifyAppointment` (el profesional de una cita).
 */
export async function notifyUser(ctx: PushCtx, businessId: string, userId: string, category: NotificationCategory, event: PushEvent): Promise<void> {
  const { db } = ctx;
  try {
    await persistNotification(db, businessId, userId, category, event);

    const [settings] = await db.select().from(notificationSettings).where(eq(notificationSettings.businessId, businessId)).limit(1);
    if (!settings?.enabled || !settings[CATEGORY_SETTING[category]]) return;
    const rows = await db.select().from(pushTokens).where(and(eq(pushTokens.businessId, businessId), eq(pushTokens.userId, userId)));
    await sendToTokens(ctx, rows, event);
  } catch {
    // Mejor esfuerzo de punta a punta (guardar en el centro + enviar push): ningún fallo aquí debe propagarse al
    // llamador, que siempre invoca esto con `void notifyUser(...)` (directo o a través de notifyBusiness/notifyAppointment).
  }
}

/**
 * Evento del negocio (premio de fidelización, problema de facturación, cliente/venta nueva…): llega a TODOS los
 * dueños del negocio (en la práctica siempre uno solo). `skipUserId` evita avisarle a quien acaba de causarlo él
 * mismo (p. ej. el propio dueño registrando un cliente): ya lo sabe, no hace falta decírselo.
 */
export async function notifyBusiness(ctx: PushCtx, businessId: string, category: NotificationCategory, event: PushEvent, skipUserId?: string | null): Promise<void> {
  try {
    const owners = await ctx.db.select({ id: users.id }).from(users).where(and(eq(users.businessId, businessId), eq(users.role, 'owner')));
    await Promise.all(owners.filter((owner) => owner.id !== skipUserId).map((owner) => notifyUser(ctx, businessId, owner.id, category, event)));
  } catch {
    // Ver nota en notifyUser: ningún fallo aquí debe propagarse al llamador (`void notifyBusiness(...)`).
  }
}

/** Fecha/hora corta en formato fijo (día/mes, 24h) para el cuerpo de un aviso: no depende del idioma de quien lo recibe,
 * a diferencia del resto del texto (que sí se traduce por dispositivo en `sendToTokens`). */
export function formatPushMoment(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('es-CO', { timeZone: timezone, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
}

/**
 * Aviso de un evento de UNA cita (reserva nueva, cancelación, cambio de horario, reseña): se guarda SIEMPRE en el
 * centro de notificaciones del profesional asignado — nunca al cliente, que no tiene la app — y ADEMÁS se manda por
 * push a sus dispositivos si el negocio activó notificaciones y esa categoría en particular. Se salta todo (ni
 * centro ni push) cuando quien originó el cambio es ese mismo profesional: ya lo sabe, lo acaba de hacer.
 */
export async function notifyAppointment(ctx: PushCtx, businessId: string, professionalId: string, skipUserId: string | null, category: 'appointments' | 'reviews', event: PushEvent): Promise<void> {
  if (professionalId === skipUserId) return;
  await notifyUser(ctx, businessId, professionalId, category, event);
}

const LOW_STOCK_STATUSES = new Set(['reorder', 'out_of_stock']);

/**
 * Avisa de bajo inventario/agotado SOLO cuando el estado resultante de un movimiento de stock (ajuste manual o venta)
 * ya es 'reorder' u 'out_of_stock' — nunca al recuperarse. `dedupeKey` incluye el estado resultante: mientras el
 * producto SIGA en el mismo estado no se repite el aviso (ver sección "no duplicar"), pero una caída más severa
 * ('reorder' → 'out_of_stock') sí avisa de nuevo, porque es una situación distinta y peor.
 * A diferencia de "cliente nuevo"/"venta nueva", NUNCA se salta a quien hizo el movimiento: es un estado del
 * inventario, no "algo que la persona acaba de hacer y ya sabe" — el dueño casi siempre es quien ajusta el stock él
 * mismo, y precisamente a él es a quien hay que avisarle que quedó bajo.
 */
export async function notifyLowStockIfNeeded(ctx: PushCtx, businessId: string, item: { id: string; name: string; stockStatus: string }): Promise<void> {
  if (!LOW_STOCK_STATUSES.has(item.stockStatus)) return;
  await notifyBusiness(ctx, businessId, 'inventory', {
    titleKey: item.stockStatus === 'out_of_stock' ? 'push_inventory_out_title' : 'push_inventory_low_title',
    bodyKey: item.stockStatus === 'out_of_stock' ? 'push_inventory_out_body' : 'push_inventory_low_body',
    params: { name: item.name },
    dedupeKey: `inventory:${item.id}:${item.stockStatus}`,
    href: `/inventory?status=${item.stockStatus}`,
  });
}

/** Envío explícito a los dispositivos del usuario que lo pide (botón "Enviar notificación de prueba"): SIEMPRE se
 * intenta, sin mirar los interruptores — es una acción directa de la persona, no un evento automático. */
export async function sendTestNotification(ctx: PushCtx, businessId: string, userId: string): Promise<{ sent: number; pruned: number }> {
  const rows = await ctx.db.select().from(pushTokens).where(eq(pushTokens.userId, userId));
  if (rows.length === 0) throw new AppError(400, 'push_no_devices');
  const ownRows = rows.filter((r) => r.businessId === businessId);
  return sendToTokens(ctx, ownRows, { titleKey: 'push_test_title', bodyKey: 'push_test_body' });
}
