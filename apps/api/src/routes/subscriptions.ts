import { eq } from 'drizzle-orm';
import { SUBSCRIPTION_PLANS, SUBSCRIPTION_PLATFORMS, TRIAL_DAYS, type Subscription, type SubscriptionPlan } from '@xiro/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../context';
import { businesses, subscriptionEvents, subscriptions } from '../db/schema';
import { AppError, parse } from '../errors';
import { createPayPalSubscription } from '../paypal';
import Stripe from 'stripe';
import { addDays, getSubscriptionRow, hasClaimedTrial, startTrial, toSubscriptionResponse } from '../subscriptions';

const trialSchema = z.object({ plan: z.enum(SUBSCRIPTION_PLANS), platform: z.enum(SUBSCRIPTION_PLATFORMS) });
const checkoutSchema = z.object({ plan: z.enum(SUBSCRIPTION_PLANS) });
const confirmBankTransferSchema = z.object({ businessId: z.string(), plan: z.enum(SUBSCRIPTION_PLANS) });

/** 30 días de "mes" para el primer período: coincide con la práctica habitual de facturación mensual/anual. */
const PERIOD_DAYS: Record<SubscriptionPlan, number> = { monthly: 30, yearly: 365 };

export function subscriptionRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db, config } = ctx;

  app.get('/subscription', async (request) => {
    const row = await getSubscriptionRow(db, request.user.bid);
    const full = await toSubscriptionResponse(db, row);
    if (request.actor.role === 'owner') return full;
    // Un empleado solo necesita saber si la cuenta tiene acceso: nada de plan, precios, fechas de cobro ni método de pago.
    return { plan: null, status: full.status, platform: null, paymentMethod: null, trialEndsAt: null, currentPeriodEnd: null, nextBillingAt: null, cancelAtPeriodEnd: false, gracePeriodEndsAt: full.gracePeriodEndsAt, hasAccess: full.hasAccess } satisfies Subscription;
  });

  /** Reclama la prueba gratuita de 7 días (sección 2). Un negocio solo puede hacerlo una vez, para siempre. */
  app.post('/subscription/trial', async (request, reply) => {
    const input = parse(trialSchema, request.body);
    if (await hasClaimedTrial(db, request.user.bid)) throw new AppError(409, 'trial_already_claimed');
    const row = await startTrial(db, request.user.bid, request.user.sub, input.plan, input.platform, TRIAL_DAYS);
    return reply.status(201).send(await toSubscriptionResponse(db, row));
  });

  /**
   * Checkout de tarjeta (Web) vía Stripe: crea una sesión y devuelve la URL a la que redirigir. El trial (si aplica)
   * lo configura la propia sesión de Stripe (`trial_period_days`): el primer cobro se dispara solo al terminar.
   */
  app.post('/subscription/checkout/stripe', async (request) => {
    const input = parse(checkoutSchema, request.body);
    const { stripeSecretKey, stripePriceMonthly, stripePriceYearly } = config.subscriptions;
    if (!stripeSecretKey) throw new AppError(503, 'stripe_not_configured', 'Stripe no está configurado todavía (falta STRIPE_SECRET_KEY).');
    const priceId = input.plan === 'monthly' ? stripePriceMonthly : stripePriceYearly;
    if (!priceId) throw new AppError(503, 'stripe_not_configured', `Falta el price id de Stripe para el plan ${input.plan}.`);

    const [business] = await db.select().from(businesses).where(eq(businesses.id, request.user.bid)).limit(1);
    if (!business) throw new AppError(401, 'unauthorized');
    const eligibleForTrial = !(await hasClaimedTrial(db, request.user.bid));

    const stripe = new Stripe(stripeSecretKey);
    const origin = request.headers.origin ?? `${request.protocol}://${request.hostname}`;
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: eligibleForTrial ? { trial_period_days: TRIAL_DAYS, metadata: { businessId: business.id, userId: request.user.sub, plan: input.plan } } : { metadata: { businessId: business.id, userId: request.user.sub, plan: input.plan } },
      client_reference_id: business.id,
      metadata: { businessId: business.id, userId: request.user.sub, plan: input.plan },
      success_url: `${origin}/subscription?checkout=success`,
      cancel_url: `${origin}/subscription?checkout=cancelled`,
    });
    if (!session.url) throw new AppError(502, 'stripe_error', 'Stripe no devolvió una URL de checkout.');
    return { url: session.url };
  });

  /** Checkout con PayPal: crea la suscripción en PayPal y devuelve la URL de aprobación a la que redirigir. */
  app.post('/subscription/checkout/paypal', async (request) => {
    const input = parse(checkoutSchema, request.body);
    const { paypalPlanMonthly, paypalPlanYearly } = config.subscriptions;
    const planId = input.plan === 'monthly' ? paypalPlanMonthly : paypalPlanYearly;
    if (!planId) throw new AppError(503, 'paypal_not_configured', 'PayPal no está configurado todavía (falta el billing plan de PayPal para este plan).');
    const [business] = await db.select().from(businesses).where(eq(businesses.id, request.user.bid)).limit(1);
    if (!business) throw new AppError(401, 'unauthorized');

    const origin = request.headers.origin ?? `${request.protocol}://${request.hostname}`;
    try {
      const url = await createPayPalSubscription(config.subscriptions, {
        planId,
        businessId: business.id,
        brandName: 'Xiro Style',
        returnUrl: `${origin}/subscription?checkout=success`,
        cancelUrl: `${origin}/subscription?checkout=cancelled`,
      });
      return { url };
    } catch (error) {
      throw new AppError(502, 'paypal_error', error instanceof Error ? error.message : 'Error de PayPal.');
    }
  });

  /**
   * Transferencia bancaria (sección Web, punto 3): no es instantánea, así que aquí solo se devuelven los datos de
   * la cuenta para que el negocio transfiera — la suscripción queda pendiente hasta que alguien la confirme abajo.
   */
  app.post('/subscription/checkout/bank-transfer', async (request) => {
    const input = parse(checkoutSchema, request.body);
    if (!config.subscriptions.bankTransferInstructions) throw new AppError(503, 'bank_transfer_not_configured', 'Todavía no hay datos de cuenta bancaria configurados (BANK_TRANSFER_INSTRUCTIONS).');
    await db.insert(subscriptionEvents).values({ businessId: request.user.bid, type: 'bank_transfer_requested', source: 'system', payload: { plan: input.plan, userId: request.user.sub } });
    return { instructions: config.subscriptions.bankTransferInstructions, plan: input.plan };
  });

  /**
   * Cancela SOLO suscripciones gestionadas desde Web (Stripe): Apple y Google exigen que el usuario cancele desde
   * la propia tienda (App Store / Play Store), nunca desde una API de terceros — para iOS/Android el cliente debe
   * enlazar a la pantalla de gestión de suscripciones del sistema operativo en su lugar.
   */
  app.post('/subscription/cancel', async (request) => {
    const row = await getSubscriptionRow(db, request.user.bid);
    if (!row) throw new AppError(404, 'not_found');
    if (row.platform !== 'web') throw new AppError(409, 'manage_in_store', 'Esta suscripción se gestiona desde la tienda de la app (App Store / Play Store), no desde aquí.');
    if (!config.subscriptions.stripeSecretKey || !row.externalSubscriptionId) throw new AppError(503, 'stripe_not_configured');
    const stripe = new Stripe(config.subscriptions.stripeSecretKey);
    await stripe.subscriptions.update(row.externalSubscriptionId, { cancel_at_period_end: true });
    // Se guarda aquí mismo (no solo se espera el webhook de Stripe): el negocio ve el cambio de inmediato aunque
    // el webhook tarde o el servidor todavía no sea alcanzable públicamente desde Stripe (p. ej. en desarrollo).
    const [updated] = await db.update(subscriptions).set({ cancelAtPeriodEnd: true, updatedAt: new Date() }).where(eq(subscriptions.id, row.id)).returning();
    await db.insert(subscriptionEvents).values({ businessId: row.businessId, type: 'cancel_at_period_end', source: 'system', payload: { userId: request.user.sub } });
    return toSubscriptionResponse(db, updated!);
  });
}

/**
 * Confirma una transferencia bancaria ya recibida y activa la suscripción. Registrado FUERA del scope autenticado
 * (no exige el JWT de un negocio — quien confirma pagos no tiene por qué tener cuenta): no hay panel de
 * administración en este proyecto todavía (ver la guía de cuentas), así que se protege con un secreto compartido
 * en vez de un rol de administrador. Trata ADMIN_SECRET como una credencial sensible: con ella se puede activar
 * la suscripción de cualquier negocio.
 */
export function adminSubscriptionRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db, config } = ctx;
  app.post('/subscription/confirm-bank-transfer', async (request) => {
    if (!config.subscriptions.adminSecret) throw new AppError(503, 'admin_not_configured', 'Falta configurar ADMIN_SECRET para poder confirmar pagos manuales.');
    if (request.headers['x-admin-secret'] !== config.subscriptions.adminSecret) throw new AppError(401, 'unauthorized');
    const input = parse(confirmBankTransferSchema, request.body);
    const now = new Date();
    const currentPeriodEnd = addDays(now, PERIOD_DAYS[input.plan]);
    const patch = { status: 'active' as const, plan: input.plan, platform: 'web' as const, paymentMethod: 'bank_transfer' as const, cancelAtPeriodEnd: false, gracePeriodEndsAt: null, currentPeriodStart: now, currentPeriodEnd, nextBillingAt: currentPeriodEnd };
    const existing = await getSubscriptionRow(db, input.businessId);
    if (!existing) await db.insert(subscriptions).values({ businessId: input.businessId, ...patch });
    else await db.update(subscriptions).set({ ...patch, updatedAt: now }).where(eq(subscriptions.businessId, input.businessId));
    await db.insert(subscriptionEvents).values({ businessId: input.businessId, type: 'bank_transfer_confirmed', source: 'admin', payload: { plan: input.plan } });
    return toSubscriptionResponse(db, await getSubscriptionRow(db, input.businessId));
  });
}
