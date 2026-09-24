import { and, eq, lte } from 'drizzle-orm';
import {
  deriveEffectiveStatus,
  subscriptionHasAccess,
  GRACE_PERIOD_DAYS,
  type PaymentMethod,
  type Subscription,
  type SubscriptionPlan,
  type SubscriptionPlatform,
  type SubscriptionStatus,
} from '@xiro/shared';
import type { DbExecutor } from './db/client';
import { subscriptionEvents, subscriptions } from './db/schema';

export type SubscriptionRow = typeof subscriptions.$inferSelect;

export const addDays = (date: Date, days: number): Date => new Date(date.getTime() + days * 86_400_000);

/** Fecha de fin de gracia a partir de AHORA (no desde el vencimiento): siempre da los días completos de gracia prometidos. */
export const graceDeadline = (now: Date = new Date()): Date => addDays(now, GRACE_PERIOD_DAYS);

export async function getSubscriptionRow(db: DbExecutor, businessId: string): Promise<SubscriptionRow | null> {
  const [row] = await db.select().from(subscriptions).where(eq(subscriptions.businessId, businessId)).limit(1);
  return row ?? null;
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
  const inserted = await db
    .insert(subscriptionEvents)
    .values({ businessId, type, source, externalEventId, payload: payload as object })
    .onConflictDoNothing({ target: [subscriptionEvents.source, subscriptionEvents.externalEventId] })
    .returning();
  if (externalEventId && inserted.length === 0) return 'duplicate'; // el proveedor ya nos había avisado de este evento

  const existing = await getSubscriptionRow(db, businessId);
  if (!existing) {
    await db.insert(subscriptions).values({ businessId, ...patch });
  } else {
    await db.update(subscriptions).set({ ...patch, updatedAt: new Date() }).where(eq(subscriptions.businessId, businessId));
  }
  return 'applied';
}

/** Negocios cuyo trial o período pagado vence dentro de `withinDays` (para el recordatorio preventivo del job diario). */
export async function findExpiringSoon(db: DbExecutor, withinDays: number, now: Date = new Date()): Promise<SubscriptionRow[]> {
  const cutoff = addDays(now, withinDays);
  return db
    .select()
    .from(subscriptions)
    .where(and(lte(subscriptions.nextBillingAt, cutoff), eq(subscriptions.cancelAtPeriodEnd, false)));
}
