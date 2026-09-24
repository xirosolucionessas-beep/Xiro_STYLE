export const SUBSCRIPTION_PLANS = ['monthly', 'yearly'] as const;
export type SubscriptionPlan = (typeof SUBSCRIPTION_PLANS)[number];

/** `past_due` = vencido pero todavía dentro del período de gracia (con acceso). `expired` = gracia agotada, sin acceso. */
export const SUBSCRIPTION_STATUSES = ['trial', 'active', 'past_due', 'expired', 'canceled'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const SUBSCRIPTION_PLATFORMS = ['ios', 'android', 'web'] as const;
export type SubscriptionPlatform = (typeof SUBSCRIPTION_PLATFORMS)[number];

export const PAYMENT_METHODS = ['card', 'paypal', 'bank_transfer'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const TRIAL_DAYS = 7;
/** Días de acceso tras un fallo de cobro antes de bloquear funciones premium. */
export const GRACE_PERIOD_DAYS = 7;
/** A cuántos días del vencimiento se muestra el recordatorio preventivo (sección 4, punto "a"). */
export const EXPIRING_SOON_DAYS = 3;

export const SUBSCRIPTION_PRICING: Record<SubscriptionPlan, { amount: number; currency: 'COP' }> = {
  monthly: { amount: 34_900, currency: 'COP' },
  yearly: { amount: 349_000, currency: 'COP' },
};

/** Ahorro real del plan anual frente a pagar el mensual 12 veces (para mostrarlo sin tener que recalcularlo en cada cliente). */
export const YEARLY_SAVINGS_PCT = Math.round((1 - SUBSCRIPTION_PRICING.yearly.amount / (SUBSCRIPTION_PRICING.monthly.amount * 12)) * 100);

export interface Subscription {
  plan: SubscriptionPlan | null;
  /** `none` = el negocio nunca ha elegido un plan (no existe fila en la base todavía). */
  status: SubscriptionStatus | 'none';
  platform: SubscriptionPlatform | null;
  paymentMethod: PaymentMethod | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  nextBillingAt: string | null;
  cancelAtPeriodEnd: boolean;
  gracePeriodEndsAt: string | null;
  /** Derivado en el servidor (nunca confiar en un cliente para esto): ¿tiene acceso a funciones premium ahora mismo? */
  hasAccess: boolean;
}

/** Única regla de acceso del sistema: úsala tanto en el servidor (para derivar `hasAccess`) como al decidir qué mostrar. */
export function subscriptionHasAccess(status: SubscriptionStatus | 'none', gracePeriodEndsAt: Date | string | null, now: Date = new Date()): boolean {
  if (status === 'trial' || status === 'active') return true;
  if (status !== 'past_due') return false; // expired, canceled, none
  if (!gracePeriodEndsAt) return false;
  const grace = typeof gracePeriodEndsAt === 'string' ? new Date(gracePeriodEndsAt) : gracePeriodEndsAt;
  return now <= grace;
}

/** Días de calendario hasta `date` (negativo si ya pasó). `null` si `date` es `null` (nada que contar). */
export function daysUntil(date: Date | string | null, now: Date = new Date()): number | null {
  if (!date) return null;
  const target = typeof date === 'string' ? new Date(date) : date;
  return Math.ceil((target.getTime() - now.getTime()) / 86_400_000);
}

export interface SubscriptionClock {
  status: SubscriptionStatus;
  trialEndsAt: Date | string | null;
  currentPeriodEnd: Date | string | null;
  gracePeriodEndsAt: Date | string | null;
}

/**
 * El estado guardado en la fila puede quedar desactualizado si el webhook del proveedor nunca llega (o el job diario
 * todavía no corrió). Esta función deriva el estado REAL a partir de las fechas guardadas, para que una lectura
 * (`GET /api/subscription`) nunca dependa de que un cron haya corrido exactamente a tiempo — es la misma regla que
 * usa el job diario, así que ambos caminos siempre coinciden.
 */
export function deriveEffectiveStatus(row: SubscriptionClock, now: Date = new Date()): SubscriptionStatus {
  const d = (v: Date | string | null) => (v ? (typeof v === 'string' ? new Date(v) : v) : null);
  const trialEndsAt = d(row.trialEndsAt);
  const currentPeriodEnd = d(row.currentPeriodEnd);
  const gracePeriodEndsAt = d(row.gracePeriodEndsAt);
  if (row.status === 'trial' && trialEndsAt && now > trialEndsAt) return 'past_due'; // sin webhook de conversión a pago
  if (row.status === 'active' && currentPeriodEnd && now > currentPeriodEnd) return 'past_due';
  if (row.status === 'past_due' && gracePeriodEndsAt && now > gracePeriodEndsAt) return 'expired';
  return row.status;
}

/**
 * `blocked` = sin acceso, el modal no se puede descartar (solo renovar, ver planes o cerrar sesión).
 * `grace` = vencido pero todavía con acceso (período de gracia): se avisa, no se bloquea.
 * `expiring_soon` = activo/en prueba pero a pocos días de cobrar/vencer: recordatorio preventivo, descartable.
 * `null` = nada que avisar (todo al día, ya canceló a propósito, o nunca ha tenido plan — ver sección 4 del contrato).
 */
export type SubscriptionNotice = 'blocked' | 'grace' | 'expiring_soon' | null;

export function subscriptionNotice(
  subscription: Pick<Subscription, 'status' | 'hasAccess' | 'trialEndsAt' | 'currentPeriodEnd' | 'gracePeriodEndsAt' | 'cancelAtPeriodEnd'>,
  now: Date = new Date(),
): SubscriptionNotice {
  if (!subscription.hasAccess) return subscription.status === 'past_due' || subscription.status === 'expired' ? 'blocked' : null;
  if (subscription.status === 'past_due') return 'grace';
  if (subscription.cancelAtPeriodEnd) return null; // ya decidió no renovar: no hace falta agobiarlo con la cuenta regresiva
  const dueDate = subscription.status === 'trial' ? subscription.trialEndsAt : subscription.currentPeriodEnd;
  const days = daysUntil(dueDate, now);
  return days !== null && days >= 0 && days <= EXPIRING_SOON_DAYS ? 'expiring_soon' : null;
}
