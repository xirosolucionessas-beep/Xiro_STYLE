import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { PaymentMethod, SubscriptionPlan, SubscriptionStatus } from '@xiro/shared';
import { GRACE_PERIOD_DAYS } from '@xiro/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import Stripe from 'stripe';
import type { Ctx } from '../context';
import { businesses, subscriptions } from '../db/schema';
import { AppError, isUuid } from '../errors';
import { verifyPayPalWebhook } from '../paypal';
import { notifyBusiness } from '../push';
import { safeEqualSecret } from '../security';
import { addDays, addPlanInterval, applyProviderEvent, recordProviderEventOnce, recordSubscriptionInvoice, type ProviderPatch } from '../subscriptions';

/**
 * Avisa por push cuando un webhook deja la suscripción en problemas: mismos casos que ya muestra SubscriptionGate
 * en pantalla — 'expired' y 'canceled' bloquean el acceso igual (ver subscriptionHasAccess en packages/shared).
 * `externalEventId` arma la clave de idempotencia del centro de notificaciones: un webhook reenviado (los tres
 * proveedores lo hacen) nunca duplica el aviso, solo el envío real de push ya protegido por `applyProviderEvent`.
 */
async function notifyBillingIfNeeded(ctx: Ctx, businessId: string, patch: ProviderPatch | null, externalEventId: string): Promise<void> {
  if (patch?.status === 'past_due') void notifyBusiness(ctx, businessId, 'billing', { titleKey: 'push_billing_issue_title', bodyKey: 'push_billing_issue_body', dedupeKey: `billing:${externalEventId}`, href: '/subscription' });
  else if (patch?.status === 'expired' || patch?.status === 'canceled') void notifyBusiness(ctx, businessId, 'billing', { titleKey: 'push_billing_expired_title', bodyKey: 'push_billing_expired_body', dedupeKey: `billing:${externalEventId}`, href: '/subscription' });
}

/** `xiro_monthly` / `xiro_yearly`: nombres de producto a configurar igual en App Store Connect y Google Play Console. */
function planFromProductId(productId: string): SubscriptionPlan | null {
  if (productId.includes('year')) return 'yearly';
  if (productId.includes('month')) return 'monthly';
  return null;
}

/**
 * Cuerpo del webhook de RevenueCat, validado (antes se usaba tal cual: un campo con otro tipo terminaba en error 500 y
 * RevenueCat reintentaba sin fin). Los campos que no usamos se conservan (`passthrough`) para el registro de auditoría.
 */
const revenueCatSchema = z
  .object({
    event: z
      .object({
        id: z.string().min(1).max(200),
        type: z.string().min(1).max(80),
        app_user_id: z.string().min(1).max(200), // = nuestro businessId (así se inicializa el SDK cliente)
        product_id: z.string().max(200).nullish(),
        store: z.string().max(40).nullish(),
        expiration_at_ms: z.number().int().nonnegative().nullish(),
        purchased_at_ms: z.number().int().nonnegative().nullish(),
      })
      .passthrough(),
  })
  .passthrough();

/** JSON del proveedor: uno malformado es un 400 (no un 500 que el proveedor reintentaría sin fin). */
function parseJson(raw: unknown): unknown {
  try {
    return JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw));
  } catch {
    throw new AppError(400, 'invalid_payload');
  }
}

/**
 * El negocio que dice el proveedor existe. Un id que no es nuestro (p. ej. un usuario anónimo de RevenueCat, o datos de
 * otro entorno) se ignora con 200 en vez de reventar con la llave foránea y provocar reintentos infinitos.
 */
async function knownBusiness(ctx: Ctx, id: unknown): Promise<string | null> {
  if (!isUuid(id)) return null;
  const [row] = await ctx.db.select({ id: businesses.id }).from(businesses).where(eq(businesses.id, id.toLowerCase())).limit(1);
  return row?.id ?? null;
}

/**
 * RevenueCat es la fuente de verdad ÚNICA para iOS + Android (unifica StoreKit 2 y Play Billing): un solo webhook
 * en vez de mantener App Store Server Notifications V2 y Real-time Developer Notifications por separado.
 * Referencia: https://www.revenuecat.com/docs/integrations/webhooks
 */
async function handleRevenueCat(request: FastifyRequest, ctx: Ctx) {
  const { config, db } = ctx;
  if (!config.subscriptions.revenueCatWebhookAuth) throw new AppError(503, 'revenuecat_not_configured');
  // Comparación en tiempo constante: `!==` deja medir cuántos caracteres del secreto coinciden.
  if (!safeEqualSecret(request.headers.authorization ?? '', config.subscriptions.revenueCatWebhookAuth)) throw new AppError(401, 'unauthorized');

  const parsed = revenueCatSchema.safeParse(request.body);
  if (!parsed.success) throw new AppError(400, 'invalid_payload');
  const body = parsed.data;
  const event = body.event;
  const businessId = await knownBusiness(ctx, event.app_user_id);
  if (!businessId) return { ok: true, ignored: 'unknown app_user_id' };
  const platform = event.store === 'APP_STORE' ? ('ios' as const) : ('android' as const);
  const plan = event.product_id ? planFromProductId(event.product_id) : null;
  const expiresAt = event.expiration_at_ms ? new Date(event.expiration_at_ms) : undefined;

  let patch: ProviderPatch | null = null;
  switch (event.type) {
    case 'INITIAL_PURCHASE':
    case 'RENEWAL':
    case 'UNCANCELLATION':
    case 'PRODUCT_CHANGE':
      patch = { status: 'active', platform, paymentMethod: 'card', cancelAtPeriodEnd: false, gracePeriodEndsAt: null, currentPeriodEnd: expiresAt, nextBillingAt: expiresAt, externalCustomerId: businessId, externalSubscriptionId: event.id, ...(plan ? { plan } : {}) };
      break;
    case 'CANCELLATION':
      // Sigue con acceso hasta que termine el período ya pagado (no se revoca de inmediato).
      patch = { status: 'active', platform, cancelAtPeriodEnd: true, currentPeriodEnd: expiresAt, nextBillingAt: null };
      break;
    case 'BILLING_ISSUE':
      patch = { status: 'past_due', platform, gracePeriodEndsAt: addDays(new Date(), GRACE_PERIOD_DAYS) };
      break;
    case 'EXPIRATION':
      // Apple/Google ya aplicaron sus propios reintentos antes de avisar esto: sin período de gracia adicional.
      patch = { status: 'expired', platform, gracePeriodEndsAt: null, nextBillingAt: null };
      break;
    default:
      return { ok: true, ignored: event.type }; // p. ej. TRANSFER, TEST — no cambian el estado de acceso
  }
  const applied = patch;
  // Evento, cambio de estado y comprobante en UNA transacción: o queda todo, o nada (y el reintento lo rehace).
  const result = await db.transaction(async (tx) => {
    const outcome = await applyProviderEvent(tx, businessId, 'revenuecat', event.type, applied, event.id, body);
    // Comprobante solo en los eventos que SÍ representan un cobro real — no al reactivar ni al cambiar de plan,
    // que solo tomarán efecto (y cobrarán) en la próxima renovación.
    if (outcome === 'applied' && plan && (event.type === 'INITIAL_PURCHASE' || event.type === 'RENEWAL')) {
      const periodStart = event.purchased_at_ms ? new Date(event.purchased_at_ms) : new Date();
      await recordSubscriptionInvoice(tx, { businessId, plan, paymentMethod: 'card', periodStart, periodEnd: expiresAt, externalPaymentId: event.id });
    }
    return outcome;
  });
  if (result === 'applied') void notifyBillingIfNeeded(ctx, businessId, patch, event.id);
  return { ok: true, result };
}

/**
 * Stripe requiere el cuerpo SIN parsear para verificar la firma (por eso este archivo registra su propio
 * content-type parser de solo lectura, ver `webhookRoutes`) — nunca confiar en un webhook sin verificar la firma.
 */
async function handleStripe(request: FastifyRequest, ctx: Ctx) {
  const { config, db } = ctx;
  const { stripeSecretKey, stripeWebhookSecret } = config.subscriptions;
  if (!stripeSecretKey || !stripeWebhookSecret) throw new AppError(503, 'stripe_not_configured');
  const signature = request.headers['stripe-signature'];
  if (typeof signature !== 'string') throw new AppError(400, 'missing_signature');

  const stripe = new Stripe(stripeSecretKey);
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(request.body as Buffer, signature, stripeWebhookSecret);
  } catch {
    throw new AppError(400, 'invalid_signature');
  }

  const statusMap: Record<Stripe.Subscription.Status, SubscriptionStatus> = {
    trialing: 'trial',
    active: 'active',
    past_due: 'past_due',
    unpaid: 'past_due',
    incomplete: 'past_due',
    incomplete_expired: 'expired',
    canceled: 'canceled',
    paused: 'past_due',
  };

  if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    const sub = event.data.object as Stripe.Subscription;
    const businessId = await knownBusiness(ctx, sub.metadata?.businessId);
    if (!businessId) return { ok: true, ignored: 'unknown businessId in metadata' };
    const plan = (sub.metadata?.plan as SubscriptionPlan | undefined) ?? null;
    // Estado no reconocido (p. ej. Stripe agrega uno nuevo): trata como "vencido con gracia" — ni bloquea de golpe
    // ni deja acceso indefinido sin saber qué está pasando de verdad.
    const status = statusMap[sub.status] ?? 'past_due';
    const item = sub.items.data[0];
    const currentPeriodEnd = item ? new Date(item.current_period_end * 1000) : undefined;
    const patch: ProviderPatch = {
      status,
      platform: 'web',
      paymentMethod: 'card' as PaymentMethod,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      currentPeriodEnd,
      nextBillingAt: sub.cancel_at_period_end ? null : currentPeriodEnd,
      gracePeriodEndsAt: status === 'past_due' ? addDays(new Date(), GRACE_PERIOD_DAYS) : null,
      externalCustomerId: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
      externalSubscriptionId: sub.id,
      ...(plan ? { plan } : {}),
    };
    const result = await applyProviderEvent(db, businessId, 'stripe', event.type, patch, event.id, event);
    if (result === 'applied') void notifyBillingIfNeeded(ctx, businessId, patch, event.id);
    return { ok: true };
  }

  /**
   * El comprobante se genera aquí, no en `customer.subscription.*` arriba: ese evento puede llegar varias veces sin
   * que haya un cobro nuevo de por medio (p. ej. al solo actualizar metadata). `invoice.payment_succeeded` SÍ es,
   * uno a uno, "este pago se cobró" — y trae el monto real cobrado por Stripe (en pesos, COP es zero-decimal ahí).
   */
  if (event.type === 'invoice.payment_succeeded') {
    const invoice = event.data.object as Stripe.Invoice;
    // Desde la API 2025-03-31, Stripe mueve el id de la suscripción a `parent.subscription_details` (ya no hay `invoice.subscription`).
    const subscriptionRef = invoice.parent?.subscription_details?.subscription;
    const subscriptionId = typeof subscriptionRef === 'string' ? subscriptionRef : subscriptionRef?.id;
    if (!subscriptionId) return { ok: true, ignored: 'no subscription on invoice' };
    const [row] = await db.select().from(subscriptions).where(eq(subscriptions.externalSubscriptionId, subscriptionId)).limit(1);
    if (!row?.plan) return { ok: true, ignored: 'unknown subscription' };
    // Evento y comprobante en UNA transacción (si el comprobante fallara, el reintento de Stripe lo vuelve a intentar).
    await db.transaction(async (tx) => {
      if ((await recordProviderEventOnce(tx, row.businessId, 'stripe', event.type, event.id, event)) !== 'applied') return;
      const line = invoice.lines.data[0];
      const periodStart = line ? new Date(line.period.start * 1000) : new Date();
      const periodEnd = line ? new Date(line.period.end * 1000) : addPlanInterval(periodStart, row.plan as SubscriptionPlan);
      await recordSubscriptionInvoice(tx, {
        businessId: row.businessId,
        plan: row.plan as SubscriptionPlan,
        paymentMethod: 'card',
        periodStart,
        periodEnd,
        amount: invoice.amount_paid,
        currency: invoice.currency.toUpperCase(),
        externalPaymentId: invoice.id,
      });
    });
  }
  return { ok: true };
}

interface PayPalEvent {
  id: string;
  event_type: string;
  resource: {
    id: string;
    custom_id?: string;
    plan_id?: string;
    billing_info?: { next_billing_time?: string };
    /** Solo en PAYMENT.SALE.COMPLETED: el id de la suscripción que generó el cobro (no trae custom_id). */
    billing_agreement_id?: string;
    amount?: { total?: string; currency?: string };
  };
}

/**
 * PayPal Subscriptions. Verifica la firma con la propia API de PayPal (`verify-webhook-signature`) antes de tocar
 * nada — nunca confiar en un webhook sin verificar. Responde 200 (no 503) cuando no está configurado a propósito:
 * PayPal reintenta agresivamente los webhooks que fallan, y no hay nada que reintentar hasta que exista la cuenta.
 * A diferencia de Stripe, PayPal no tiene "cancelar al final del período": CANCELLED se trata como definitivo.
 */
async function handlePayPal(request: FastifyRequest, ctx: Ctx) {
  const { config, db } = ctx;
  if (!config.subscriptions.paypalWebhookId) {
    request.log.warn('Webhook de PayPal recibido pero PAYPAL_WEBHOOK_ID no está configurado — ignorado.');
    return { ok: true, configured: false };
  }
  const body = parseJson(request.body) as PayPalEvent;
  if (!body || typeof body !== 'object' || typeof body.id !== 'string' || typeof body.event_type !== 'string' || !body.resource || typeof body.resource !== 'object') {
    throw new AppError(400, 'invalid_payload');
  }
  const headers = request.headers;
  const verified = await verifyPayPalWebhook(config.subscriptions, {
    transmissionId: String(headers['paypal-transmission-id'] ?? ''),
    transmissionTime: String(headers['paypal-transmission-time'] ?? ''),
    certUrl: String(headers['paypal-cert-url'] ?? ''),
    authAlgo: String(headers['paypal-auth-algo'] ?? ''),
    transmissionSig: String(headers['paypal-transmission-sig'] ?? ''),
    webhookEvent: body,
  });
  if (!verified) throw new AppError(400, 'invalid_signature');

  /**
   * El cobro real llega en PAYMENT.SALE.COMPLETED, no en BILLING.SUBSCRIPTION.ACTIVATED (ese solo marca "aprobada").
   * Este evento no trae `custom_id`, así que la suscripción se busca por `billing_agreement_id` (= nuestro
   * externalSubscriptionId, guardado cuando se activó la suscripción).
   */
  if (body.event_type === 'PAYMENT.SALE.COMPLETED') {
    const subscriptionId = body.resource.billing_agreement_id;
    if (!subscriptionId) return { ok: true, ignored: 'no billing_agreement_id' };
    const [row] = await db.select().from(subscriptions).where(eq(subscriptions.externalSubscriptionId, subscriptionId)).limit(1);
    if (!row?.plan) return { ok: true, ignored: 'unknown subscription' };
    // Evento y comprobante en UNA transacción (si el comprobante fallara, el reintento de PayPal lo vuelve a intentar).
    const result = await db.transaction(async (tx) => {
      const outcome = await recordProviderEventOnce(tx, row.businessId, 'paypal', body.event_type, body.id, body);
      if (outcome !== 'applied') return outcome;
      const plan = row.plan as SubscriptionPlan;
      const parsedTotal = body.resource.amount?.total ? Math.round(parseFloat(body.resource.amount.total)) : NaN;
      const periodStart = new Date();
      await recordSubscriptionInvoice(tx, {
        businessId: row.businessId,
        plan,
        paymentMethod: 'paypal',
        periodStart,
        periodEnd: addPlanInterval(periodStart, plan),
        ...(Number.isFinite(parsedTotal) ? { amount: parsedTotal } : {}),
        ...(body.resource.amount?.currency ? { currency: body.resource.amount.currency } : {}),
        externalPaymentId: body.resource.id,
      });
      return outcome;
    });
    return { ok: true, result };
  }

  const businessId = await knownBusiness(ctx, body.resource.custom_id);
  if (!businessId) return { ok: true, ignored: 'unknown businessId in custom_id' };
  const plan = body.resource.plan_id === config.subscriptions.paypalPlanYearly ? 'yearly' : body.resource.plan_id === config.subscriptions.paypalPlanMonthly ? 'monthly' : null;
  const nextBillingAt = body.resource.billing_info?.next_billing_time ? new Date(body.resource.billing_info.next_billing_time) : undefined;

  let patch: ProviderPatch | null = null;
  switch (body.event_type) {
    case 'BILLING.SUBSCRIPTION.ACTIVATED':
    case 'BILLING.SUBSCRIPTION.RE-ACTIVATED':
      patch = { status: 'active', platform: 'web', paymentMethod: 'paypal', cancelAtPeriodEnd: false, gracePeriodEndsAt: null, currentPeriodEnd: nextBillingAt, nextBillingAt, externalCustomerId: businessId, externalSubscriptionId: body.resource.id, ...(plan ? { plan } : {}) };
      break;
    case 'BILLING.SUBSCRIPTION.SUSPENDED':
      patch = { status: 'past_due', platform: 'web', gracePeriodEndsAt: addDays(new Date(), GRACE_PERIOD_DAYS) };
      break;
    case 'BILLING.SUBSCRIPTION.CANCELLED':
    case 'BILLING.SUBSCRIPTION.EXPIRED':
      patch = { status: 'canceled', platform: 'web', cancelAtPeriodEnd: false, nextBillingAt: null };
      break;
    default:
      return { ok: true, ignored: body.event_type };
  }
  const result = await applyProviderEvent(db, businessId, 'paypal', body.event_type, patch, body.id, body);
  if (result === 'applied') void notifyBillingIfNeeded(ctx, businessId, patch, body.id);
  return { ok: true, result };
}

export function webhookRoutes(app: FastifyInstance, ctx: Ctx): void {
  // El body de Stripe debe llegar como Buffer crudo (sin parsear) para poder verificar su firma HMAC.
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_request, body, done) => done(null, body));

  app.post('/revenuecat', async (request, reply) => {
    // Único endpoint de este archivo que SÍ necesita el body ya parseado como JSON (no lleva firma sobre bytes crudos).
    request.body = parseJson(request.body);
    return reply.send(await handleRevenueCat(request, ctx));
  });
  app.post('/stripe', async (request, reply) => reply.send(await handleStripe(request, ctx)));
  app.post('/paypal', async (request, reply) => reply.send(await handlePayPal(request, ctx)));
}
