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
  /**
   * Fin del acceso de cortesía concedido por la administración de Xiro (panel del fundador), si cubre este momento. NO es un
   * pago ni cambia `status`: solo hace `hasAccess` verdadero mientras dure. Ausente o null = sin concesión vigente.
   */
  accessGrantEndsAt?: string | null;
  /**
   * Cortesía ya concedida que todavía NO cubre este momento (empieza al terminar la prueba o el período pagado vigente).
   * Ausente o null = no hay ninguna programada. Solo informativa: el acceso lo sigue decidiendo `hasAccess`.
   */
  accessGrantUpcoming?: { startsAt: string; endsAt: string } | null;
}

/**
 * Qué mostrarle al negocio sobre su acceso (tarjeta "Suscripción y estado de cuenta"). Solo usa campos reales de
 * `Subscription` y la MISMA prioridad que el servidor al decidir `hasAccess`; nunca inventa una fecha:
 * - `endsAt` es el fin del acceso del estado mostrado (fin de prueba, de período pagado, de gracia o de cortesía); null si
 *   no aplica o no se conoce.
 * - `renews` = el período pagado se renovará solo (su fin NO es un vencimiento del acceso).
 */
export type AccountAccessKind = 'trial' | 'active' | 'grace' | 'courtesy' | 'expired' | 'canceled' | 'no_plan' | 'no_access';

export interface AccountAccessSummary {
  kind: AccountAccessKind;
  hasAccess: boolean;
  endsAt: string | null;
  /** Días de calendario que faltan hasta `endsAt` (null si no hay fecha). Nunca negativo mientras haya acceso. */
  daysLeft: number | null;
  renews: boolean;
  /** Cortesía que cubre el presente además del plan (p. ej. concedida antes de empezar la prueba). */
  courtesyEndsAt: string | null;
  /** Cortesía programada para después del período actual. */
  upcomingCourtesy: { startsAt: string; endsAt: string } | null;
}

/** Claves de traducción (i18n.ts) para presentar un resumen: iguales en web, Android e iOS. */
export function accountAccessTextKeys(summary: AccountAccessSummary): { title: string; description: string; dateLabel: string | null; days: { key: string; n?: number } | null } {
  const variant = summary.kind === 'active' ? (summary.renews ? 'active_renews' : 'active_ends') : summary.kind;
  const dated: Partial<Record<AccountAccessKind, string>> = { trial: 'trial', active: variant, grace: 'grace', courtesy: 'courtesy', expired: 'expired' };
  const dateKey = dated[summary.kind];
  let days: { key: string; n?: number } | null = null;
  if (summary.hasAccess && summary.daysLeft !== null) {
    days = summary.daysLeft <= 0 ? { key: 'account_access_last_day' } : summary.daysLeft === 1 ? { key: 'account_access_day_left' } : { key: 'account_access_days_left', n: summary.daysLeft };
  }
  return {
    title: `account_access_kind_${summary.kind}`,
    description: `account_access_desc_${summary.kind === 'active' ? variant : summary.kind}`,
    dateLabel: dateKey ? `account_access_date_${dateKey}` : null,
    days,
  };
}

export function accountAccessSummary(subscription: Subscription, now: Date = new Date()): AccountAccessSummary {
  const grantEnd = subscription.accessGrantEndsAt ?? null;
  const upcomingCourtesy = subscription.accessGrantUpcoming ?? null;
  const base = { hasAccess: subscription.hasAccess, renews: false, courtesyEndsAt: null as string | null, upcomingCourtesy };
  const days = (endsAt: string | null) => {
    const d = daysUntil(endsAt, now);
    return d === null ? null : Math.max(0, d);
  };
  const { status } = subscription;
  if (subscription.hasAccess) {
    if (status === 'trial') return { ...base, kind: 'trial', endsAt: subscription.trialEndsAt, daysLeft: days(subscription.trialEndsAt), courtesyEndsAt: grantEnd };
    if (status === 'active') {
      return { ...base, kind: 'active', endsAt: subscription.currentPeriodEnd, daysLeft: days(subscription.currentPeriodEnd), renews: !subscription.cancelAtPeriodEnd, courtesyEndsAt: grantEnd };
    }
    // Plan vencido, cancelado o inexistente, pero con cortesía vigente: el acceso lo da la cortesía.
    if (grantEnd) return { ...base, kind: 'courtesy', endsAt: grantEnd, daysLeft: days(grantEnd) };
    if (status === 'past_due') return { ...base, kind: 'grace', endsAt: subscription.gracePeriodEndsAt, daysLeft: days(subscription.gracePeriodEndsAt) };
  }
  if (status === 'none') return { ...base, kind: 'no_plan', endsAt: null, daysLeft: null };
  if (status === 'expired') return { ...base, kind: 'expired', endsAt: subscription.gracePeriodEndsAt, daysLeft: null };
  if (status === 'canceled') return { ...base, kind: 'canceled', endsAt: null, daysLeft: null };
  return { ...base, kind: 'no_access', endsAt: null, daysLeft: null };
}

/** Un comprobante de pago ya confirmado (Tarea de facturación de suscripción): monto y fechas congelados al momento del pago. */
export interface SubscriptionInvoiceDto {
  id: string;
  plan: SubscriptionPlan;
  amount: number;
  currency: string;
  paymentMethod: PaymentMethod;
  periodStart: string;
  periodEnd: string;
  createdAt: string;
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
  subscription: Pick<Subscription, 'status' | 'hasAccess' | 'trialEndsAt' | 'currentPeriodEnd' | 'gracePeriodEndsAt' | 'cancelAtPeriodEnd' | 'accessGrantEndsAt'>,
  now: Date = new Date(),
): SubscriptionNotice {
  // Acceso de cortesía concedido por Xiro sobre un plan vencido: no se avisa de "gracia" ni de bloqueo mientras dure.
  if (subscription.hasAccess && subscription.accessGrantEndsAt && subscription.status !== 'trial' && subscription.status !== 'active') return null;
  if (!subscription.hasAccess) return subscription.status === 'past_due' || subscription.status === 'expired' ? 'blocked' : null;
  if (subscription.status === 'past_due') return 'grace';
  if (subscription.cancelAtPeriodEnd) return null; // ya decidió no renovar: no hace falta agobiarlo con la cuenta regresiva
  const dueDate = subscription.status === 'trial' ? subscription.trialEndsAt : subscription.currentPeriodEnd;
  const days = daysUntil(dueDate, now);
  return days !== null && days >= 0 && days <= EXPIRING_SOON_DAYS ? 'expiring_soon' : null;
}
