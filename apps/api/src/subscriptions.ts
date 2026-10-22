import { and, desc, eq, lte } from 'drizzle-orm';
import {
  deriveEffectiveStatus,
  subscriptionHasAccess,
  GRACE_PERIOD_DAYS,
  SUBSCRIPTION_PRICING,
  type PaymentMethod,
  type Subscription,
  type SubscriptionInvoiceDto,
  type SubscriptionPlan,
  type SubscriptionPlatform,
  type SubscriptionStatus,
} from '@xiro/shared';
import type { DbExecutor } from './db/client';
import { subscriptionEvents, subscriptionInvoices, subscriptions } from './db/schema';
import { accessGrantStatus } from './platform/grants';

export type SubscriptionRow = typeof subscriptions.$inferSelect;

export const addDays = (date: Date, days: number): Date => new Date(date.getTime() + days * 86_400_000);

/** Fecha de fin de gracia a partir de AHORA (no desde el vencimiento): siempre da los días completos de gracia prometidos. */
export const graceDeadline = (now: Date = new Date()): Date => addDays(now, GRACE_PERIOD_DAYS);

export async function getSubscriptionRow(db: DbExecutor, businessId: string): Promise<SubscriptionRow | null> {
  const [row] = await db.select().from(subscriptions).where(eq(subscriptions.businessId, businessId)).limit(1);
  return row ?? null;
}

/**
 * Política de bloqueo del servidor (ver `authenticate` en app.ts): SIN escribir nada (a diferencia de
 * `toSubscriptionResponse`, pensada para `GET /api/subscription`), así que es segura de llamar en CADA petición
 * autenticada.
 *
 * DELIBERADAMENTE CONSERVADORA — solo bloquea cuando el estado derivado a HOY es `expired` (tuvo acceso y se le
 * acabó, incluida la gracia): es el único caso que la propia interfaz ya trata como bloqueo real (ver
 * `subscriptionNotice` en packages/shared/subscription.ts, que devuelve `'blocked'` solo para `expired`/`past_due`
 * sin acceso). Dos estados con `hasAccess: false` se dejan pasar a propósito, sin bloquear, porque bloquearlos sería
 * una decisión de producto nueva que esta corrección no debe tomar en silencio:
 *   - `none` (el negocio se registró pero todavía no eligió un plan ni empezó la prueba): bloquearlo dejaría a
 *     CUALQUIER negocio recién registrado sin poder usar nada hasta iniciar su prueba explícitamente.
 *   - `canceled` (cancelación ya confirmada por el proveedor, no "se cancela al final del período" — eso sigue
 *     `active` hasta que el período termina): la propia interfaz tampoco lo marca como bloqueado hoy.
 * Ver el informe de la Fase 1 para la decisión pendiente sobre estos dos casos.
 *
 * Antes de bloquear por vencimiento, revisa si una concesión del fundador (`accessGrantStatus`) cubre este instante
 * — eso SIEMPRE da acceso, sin importar el estado de pago.
 */
export async function isAccessBlocked(db: DbExecutor, businessId: string, now: Date = new Date()): Promise<boolean> {
  const row = await getSubscriptionRow(db, businessId);
  if (!row) return false; // "none": ver nota arriba, no se bloquea en esta corrección
  const status = deriveEffectiveStatus({ status: row.status as SubscriptionStatus, trialEndsAt: row.trialEndsAt, currentPeriodEnd: row.currentPeriodEnd, gracePeriodEndsAt: row.gracePeriodEndsAt }, now);
  if (status !== 'expired') return false;
  const grant = await accessGrantStatus(db, businessId, now);
  return !grant.coversNow;
}

/**
 * Serializa la fila para el cliente. Si el estado guardado quedó desactualizado (venció el trial/período sin que
 * llegara el webhook todavía), lo corrige aquí mismo antes de responder — así ninguna de las 3 apps ve nunca un
 * estado "activo" que en realidad ya venció, sin depender de que el job diario haya corrido a tiempo.
 */
export async function toSubscriptionResponse(db: DbExecutor, row: SubscriptionRow | null, now: Date = new Date()): Promise<Subscription> {
  if (!row) {
    return { plan: null, status: 'none', platform: null, paymentMethod: null, trialEndsAt: null, currentPeriodEnd: null, nextBillingAt: null, cancelAtPeriodEnd: false, gracePeriodEndsAt: null, hasAccess: false };
  }
  const stored = row.status as SubscriptionStatus;
  const effective = deriveEffectiveStatus({ status: stored, trialEndsAt: row.trialEndsAt, currentPeriodEnd: row.currentPeriodEnd, gracePeriodEndsAt: row.gracePeriodEndsAt }, now);
  let gracePeriodEndsAt = row.gracePeriodEndsAt;
  if (effective !== stored) {
    // Recién entra en gracia (trial o período pagado vencieron ahora mismo): le abre su ventana de gracia completa.
    if (effective === 'past_due' && !gracePeriodEndsAt) gracePeriodEndsAt = graceDeadline(now);
    await db
      .update(subscriptions)
      .set({ status: effective, gracePeriodEndsAt, updatedAt: now })
      .where(and(eq(subscriptions.id, row.id), eq(subscriptions.status, stored))); // solo si nadie más lo cambió mientras tanto
    await db.insert(subscriptionEvents).values({ businessId: row.businessId, type: `auto_${effective}`, source: 'system', payload: { from: stored, to: effective } });
  }
  return {
    plan: row.plan as SubscriptionPlan | null,
    status: effective,
    platform: row.platform as SubscriptionPlatform,
    paymentMethod: row.paymentMethod as PaymentMethod | null,
    trialEndsAt: row.trialEndsAt?.toISOString() ?? null,
    currentPeriodEnd: row.currentPeriodEnd?.toISOString() ?? null,
    nextBillingAt: row.nextBillingAt?.toISOString() ?? null,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    gracePeriodEndsAt: gracePeriodEndsAt?.toISOString() ?? null,
    hasAccess: subscriptionHasAccess(effective, gracePeriodEndsAt, now),
  };
}

/** Anti-abuso (sección 2): una vez que existe la fila, el trial de ese negocio ya se reclamó — sin importar qué pase después. */
export async function hasClaimedTrial(db: DbExecutor, businessId: string): Promise<boolean> {
  return (await getSubscriptionRow(db, businessId)) !== null;
}

export async function startTrial(db: DbExecutor, businessId: string, userId: string, plan: SubscriptionPlan, platform: SubscriptionPlatform, trialDays: number, now: Date = new Date()): Promise<SubscriptionRow> {
  const trialEndsAt = addDays(now, trialDays);
  const [row] = await db
    .insert(subscriptions)
    .values({ businessId, plan, status: 'trial', platform, trialStartedAt: now, trialEndsAt, trialClaimedByUserId: userId, nextBillingAt: trialEndsAt })
    .returning();
  await db.insert(subscriptionEvents).values({ businessId, type: 'trial_started', source: 'system', payload: { plan, platform } });
  return row!;
}

export interface ProviderPatch {
  plan?: SubscriptionPlan;
  status: SubscriptionStatus;
  platform: SubscriptionPlatform;
  paymentMethod?: PaymentMethod;
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
  nextBillingAt?: Date | null;
  cancelAtPeriodEnd?: boolean;
  gracePeriodEndsAt?: Date | null;
  externalCustomerId?: string;
  externalSubscriptionId?: string;
}

/**
 * Único punto de entrada para los 3 webhooks (RevenueCat = iOS/Android, Stripe/PayPal = Web): aplica el cambio de
 * estado y deja el registro de auditoría, de forma idempotente (un mismo evento reenviado por el proveedor no se
 * aplica dos veces) gracias al índice único (source, externalEventId) — ver sub_events_external_uq en el esquema.
 * Registrar el evento y aplicar el cambio van en UNA transacción: si aplicar fallara, el evento tampoco queda
 * registrado y el reintento del proveedor lo vuelve a procesar (antes quedaba "duplicado" sin haberse aplicado nunca).
 */
export async function applyProviderEvent(
  db: DbExecutor,
  businessId: string,
  source: 'revenuecat' | 'stripe' | 'paypal',
  type: string,
  patch: ProviderPatch,
  externalEventId: string | null,
  payload: unknown,
): Promise<'applied' | 'duplicate'> {
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(subscriptionEvents)
      .values({ businessId, type, source, externalEventId, payload: payload as object })
      .onConflictDoNothing({ target: [subscriptionEvents.source, subscriptionEvents.externalEventId] })
      .returning();
    if (externalEventId && inserted.length === 0) return 'duplicate' as const; // el proveedor ya nos había avisado de este evento

    const existing = await getSubscriptionRow(tx, businessId);
    if (!existing) {
      await tx.insert(subscriptions).values({ businessId, ...patch });
    } else {
      await tx.update(subscriptions).set({ ...patch, updatedAt: new Date() }).where(eq(subscriptions.businessId, businessId));
    }
    return 'applied' as const;
  });
}

export interface RecordInvoiceInput {
  businessId: string;
  plan: SubscriptionPlan;
  paymentMethod: PaymentMethod;
  periodStart: Date;
  /** Si no se da (proveedor externo que ya trae su propio corte), se calcula sumando 1 mes o 1 año a `periodStart`. */
  periodEnd?: Date;
  /** Monto real reportado por el proveedor (p.ej. la factura de Stripe); si falta, se usa el precio de tabla del plan. */
  amount?: number;
  currency?: string;
  externalPaymentId?: string | null;
}

/** +1 mes o +1 año calendario exacto (no "30 días"): el día 31 de un mes corto cae en el último día del mes siguiente. */
export function addPlanInterval(date: Date, plan: SubscriptionPlan): Date {
  const next = new Date(date);
  if (plan === 'monthly') next.setMonth(next.getMonth() + 1);
  else next.setFullYear(next.getFullYear() + 1);
  return next;
}

/**
 * Un comprobante por cada pago CONFIRMADO. El monto y las fechas quedan congelados aquí mismo — nunca se recalculan
 * después, aunque cambie el precio del plan. Llamar una sola vez por pago real (ver cada sitio que la invoca para
 * la garantía de no-duplicado: el índice único de subscriptionEvents ya filtra reintentos del mismo webhook).
 */
export async function recordSubscriptionInvoice(db: DbExecutor, input: RecordInvoiceInput): Promise<string> {
  const pricing = SUBSCRIPTION_PRICING[input.plan];
  const periodEnd = input.periodEnd ?? addPlanInterval(input.periodStart, input.plan);
  const [row] = await db
    .insert(subscriptionInvoices)
    .values({
      businessId: input.businessId,
      plan: input.plan,
      amount: input.amount ?? pricing.amount,
      currency: input.currency ?? pricing.currency,
      paymentMethod: input.paymentMethod,
      externalPaymentId: input.externalPaymentId ?? null,
      periodStart: input.periodStart,
      periodEnd,
    })
    .returning({ id: subscriptionInvoices.id });
  return row!.id;
}

export async function listSubscriptionInvoices(db: DbExecutor, businessId: string): Promise<SubscriptionInvoiceDto[]> {
  const rows = await db
    .select()
    .from(subscriptionInvoices)
    .where(eq(subscriptionInvoices.businessId, businessId))
    .orderBy(desc(subscriptionInvoices.createdAt));
  return rows.map((row) => ({
    id: row.id,
    plan: row.plan as SubscriptionPlan,
    amount: row.amount,
    currency: row.currency,
    paymentMethod: row.paymentMethod as PaymentMethod,
    periodStart: row.periodStart.toISOString(),
    periodEnd: row.periodEnd.toISOString(),
    createdAt: row.createdAt.toISOString(),
  }));
}

/**
 * Igual que `applyProviderEvent` pero sin tocar la fila de `subscriptions` — para eventos de "este pago ya se
 * cobró" (invoice.payment_succeeded de Stripe, PAYMENT.SALE.COMPLETED de PayPal) que NO cambian el estado de acceso
 * por sí mismos (eso ya lo hace el webhook de cambio de suscripción) pero sí deben generar un comprobante, una sola
 * vez, aunque el proveedor reenvíe el mismo evento.
 */
export async function recordProviderEventOnce(
  db: DbExecutor,
  businessId: string,
  source: 'revenuecat' | 'stripe' | 'paypal',
  type: string,
  externalEventId: string | null,
  payload: unknown,
): Promise<'applied' | 'duplicate'> {
  const inserted = await db
    .insert(subscriptionEvents)
    .values({ businessId, type, source, externalEventId, payload: payload as object })
    .onConflictDoNothing({ target: [subscriptionEvents.source, subscriptionEvents.externalEventId] })
    .returning();
  return externalEventId && inserted.length === 0 ? 'duplicate' : 'applied';
}

/** Negocios cuyo trial o período pagado vence dentro de `withinDays` (para el recordatorio preventivo del job diario). */
export async function findExpiringSoon(db: DbExecutor, withinDays: number, now: Date = new Date()): Promise<SubscriptionRow[]> {
  const cutoff = addDays(now, withinDays);
  return db
    .select()
    .from(subscriptions)
    .where(and(lte(subscriptions.nextBillingAt, cutoff), eq(subscriptions.cancelAtPeriodEnd, false)));
}
