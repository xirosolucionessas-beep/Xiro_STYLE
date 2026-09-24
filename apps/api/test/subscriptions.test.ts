import type { AuthSession, Subscription } from '@xiro/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app';
import type { SubscriptionsConfig } from '../src/config';
import { subscriptions } from '../src/db/schema';
import { createTestDatabase, testAppConfig, type TestDatabase } from './helpers/db';

const REVENUECAT_AUTH = 'test-revenuecat-shared-secret';

const subscriptionsConfig: SubscriptionsConfig = {
  revenueCatWebhookAuth: REVENUECAT_AUTH,
  stripeSecretKey: null,
  stripeWebhookSecret: null,
  stripePriceMonthly: null,
  stripePriceYearly: null,
  paypalClientId: null,
  paypalClientSecret: null,
  paypalWebhookId: null,
  paypalPlanMonthly: null,
  paypalPlanYearly: null,
  paypalEnv: 'sandbox',
  bankTransferInstructions: null,
  adminSecret: null,
};

let app: FastifyInstance;
let testDb: TestDatabase;
let cleanupConfig: () => void;

beforeAll(async () => {
  testDb = await createTestDatabase();
  const { config, cleanup } = testAppConfig({ corsOrigins: ['http://localhost:8081'] });
  cleanupConfig = cleanup;
  app = await buildApp({ db: testDb.db, config: { ...config, subscriptions: subscriptionsConfig } });
});

afterAll(async () => {
  await app.close();
  cleanupConfig();
  await testDb.drop();
});

let counter = 0;
async function register(): Promise<AuthSession> {
  counter += 1;
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { name: 'Ana Pérez', businessName: `Studio Sub ${counter}`, businessType: 'beauty_salon', email: `sub${counter}@correo.com`, password: 'Secreta123', acceptTerms: true, language: 'es' },
  });
  expect(response.statusCode).toBe(201);
  return response.json<AuthSession>();
}
const auth = (session: AuthSession) => ({ authorization: `Bearer ${session.accessToken}` });

describe('GET /api/subscription', () => {
  it('sin plan elegido: status "none" y sin acceso', async () => {
    const session = await register();
    const res = await app.inject({ method: 'GET', url: '/api/subscription', headers: auth(session) });
    expect(res.statusCode).toBe(200);
    const body = res.json<Subscription>();
    expect(body).toMatchObject({ plan: null, status: 'none', hasAccess: false });
  });

  it('exige autenticación', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/subscription' });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /api/subscription/trial', () => {
  it('inicia la prueba de 7 días con acceso inmediato', async () => {
    const session = await register();
    const res = await app.inject({ method: 'POST', url: '/api/subscription/trial', headers: auth(session), payload: { plan: 'monthly', platform: 'web' } });
    expect(res.statusCode).toBe(201);
    const body = res.json<Subscription>();
    expect(body.status).toBe('trial');
    expect(body.plan).toBe('monthly');
    expect(body.hasAccess).toBe(true);
    const days = (new Date(body.trialEndsAt!).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
  });

  it('anti-abuso: un negocio no puede reclamar la prueba dos veces', async () => {
    const session = await register();
    await app.inject({ method: 'POST', url: '/api/subscription/trial', headers: auth(session), payload: { plan: 'monthly', platform: 'web' } });
    const second = await app.inject({ method: 'POST', url: '/api/subscription/trial', headers: auth(session), payload: { plan: 'yearly', platform: 'web' } });
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe('trial_already_claimed');
  });

  it('rechaza un plan inválido', async () => {
    const session = await register();
    const res = await app.inject({ method: 'POST', url: '/api/subscription/trial', headers: auth(session), payload: { plan: 'lifetime', platform: 'web' } });
    expect(res.statusCode).toBe(400);
  });
});

describe('auto-corrección de estado (self-heal) al leer', () => {
  it('un trial vencido sin webhook pasa solo a "past_due" (con gracia) y luego a "expired" al agotarse la gracia', async () => {
    const session = await register();
    await app.inject({ method: 'POST', url: '/api/subscription/trial', headers: auth(session), payload: { plan: 'monthly', platform: 'web' } });

    // Simula que el trial ya venció (nadie llamó al webhook de conversión a pago).
    await testDb.db.update(subscriptions).set({ trialEndsAt: new Date(Date.now() - 1000) }).where(eq(subscriptions.businessId, session.business.id));
    const pastDue = await app.inject({ method: 'GET', url: '/api/subscription', headers: auth(session) });
    const pastDueBody = pastDue.json<Subscription>();
    expect(pastDueBody.status).toBe('past_due');
    expect(pastDueBody.hasAccess).toBe(true); // todavía dentro del período de gracia
    expect(pastDueBody.gracePeriodEndsAt).toBeTruthy();

    // Simula que también se agotó el período de gracia.
    await testDb.db.update(subscriptions).set({ gracePeriodEndsAt: new Date(Date.now() - 1000) }).where(eq(subscriptions.businessId, session.business.id));
    const expired = await app.inject({ method: 'GET', url: '/api/subscription', headers: auth(session) });
    const expiredBody = expired.json<Subscription>();
    expect(expiredBody.status).toBe('expired');
    expect(expiredBody.hasAccess).toBe(false);
  });
});

describe('checkout sin proveedores configurados', () => {
  it('Stripe responde 503 honesto en vez de fallar como error interno', async () => {
    const session = await register();
    const res = await app.inject({ method: 'POST', url: '/api/subscription/checkout/stripe', headers: auth(session), payload: { plan: 'monthly' } });
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe('stripe_not_configured');
  });

  it('PayPal y transferencia bancaria responden 503 (todavía sin conectar)', async () => {
    const session = await register();
    const paypal = await app.inject({ method: 'POST', url: '/api/subscription/checkout/paypal', headers: auth(session), payload: { plan: 'monthly' } });
    expect(paypal.statusCode).toBe(503);
    expect(paypal.json().code).toBe('paypal_not_configured');
    const bank = await app.inject({ method: 'POST', url: '/api/subscription/checkout/bank-transfer', headers: auth(session), payload: { plan: 'monthly' } });
    expect(bank.statusCode).toBe(503);
    expect(bank.json().code).toBe('bank_transfer_not_configured');
  });

  it('admin/confirm-bank-transfer responde 503 sin ADMIN_SECRET configurado', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/admin/subscription/confirm-bank-transfer', payload: { businessId: 'x', plan: 'monthly' } });
    expect(res.statusCode).toBe(503);
  });
});

describe('transferencia bancaria de punta a punta (con ADMIN_SECRET configurado)', () => {
  const ADMIN_SECRET = 'test-admin-secret';
  let bankApp: FastifyInstance;

  beforeAll(async () => {
    const { config } = testAppConfig({ corsOrigins: ['http://localhost:8081'] });
    bankApp = await buildApp({ db: testDb.db, config: { ...config, subscriptions: { ...subscriptionsConfig, bankTransferInstructions: 'Banco X, cuenta 123-456', adminSecret: ADMIN_SECRET } } });
  });
  afterAll(async () => bankApp.close());

  it('pedir instrucciones no activa nada; el admin confirma y recién ahí queda activa', async () => {
    const reg = await bankApp.inject({ method: 'POST', url: '/api/auth/register', payload: { name: 'Ana', businessName: `Bank ${Date.now()}`, businessType: 'other', email: `bank${Date.now()}@correo.com`, password: 'Secreta123', acceptTerms: true } });
    const session = reg.json<AuthSession>();

    const request = await bankApp.inject({ method: 'POST', url: '/api/subscription/checkout/bank-transfer', headers: auth(session), payload: { plan: 'yearly' } });
    expect(request.statusCode).toBe(200);
    expect(request.json().instructions).toContain('Banco X');
    const beforeConfirm = await bankApp.inject({ method: 'GET', url: '/api/subscription', headers: auth(session) });
    expect(beforeConfirm.json<Subscription>().status).toBe('none'); // pedir instrucciones no activa nada por sí solo

    const unauthorized = await bankApp.inject({ method: 'POST', url: '/api/admin/subscription/confirm-bank-transfer', headers: { 'x-admin-secret': 'incorrecto' }, payload: { businessId: session.business.id, plan: 'yearly' } });
    expect(unauthorized.statusCode).toBe(401);

    const confirm = await bankApp.inject({ method: 'POST', url: '/api/admin/subscription/confirm-bank-transfer', headers: { 'x-admin-secret': ADMIN_SECRET }, payload: { businessId: session.business.id, plan: 'yearly' } });
    expect(confirm.statusCode).toBe(200);
    const confirmed = confirm.json<Subscription>();
    expect(confirmed).toMatchObject({ status: 'active', plan: 'yearly', paymentMethod: 'bank_transfer', hasAccess: true });

    const after = await bankApp.inject({ method: 'GET', url: '/api/subscription', headers: auth(session) });
    expect(after.json<Subscription>().status).toBe('active');
  });
});

describe('webhook RevenueCat (fuente de verdad iOS + Android)', () => {
  it('rechaza sin el secreto correcto', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/webhooks/revenuecat', headers: { authorization: 'algo-incorrecto' }, payload: { event: { id: 'evt_1', type: 'INITIAL_PURCHASE', app_user_id: 'x' } } });
    expect(res.statusCode).toBe(401);
  });

  it('INITIAL_PURCHASE activa la suscripción del negocio (app_user_id = businessId)', async () => {
    const session = await register();
    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks/revenuecat',
      headers: { authorization: REVENUECAT_AUTH },
      payload: { event: { id: 'evt_ios_1', type: 'INITIAL_PURCHASE', app_user_id: session.business.id, product_id: 'xiro_yearly', store: 'APP_STORE', expiration_at_ms: Date.now() + 365 * 86_400_000 } },
    });
    expect(res.statusCode).toBe(200);
    const status = await app.inject({ method: 'GET', url: '/api/subscription', headers: auth(session) });
    const body = status.json<Subscription>();
    expect(body).toMatchObject({ status: 'active', plan: 'yearly', platform: 'ios', hasAccess: true });
  });

  it('es idempotente: el mismo evento reenviado no duplica el registro de auditoría', async () => {
    const session = await register();
    const payload = { event: { id: 'evt_dup_1', type: 'INITIAL_PURCHASE', app_user_id: session.business.id, product_id: 'xiro_monthly', store: 'PLAY_STORE', expiration_at_ms: Date.now() + 30 * 86_400_000 } };
    await app.inject({ method: 'POST', url: '/api/webhooks/revenuecat', headers: { authorization: REVENUECAT_AUTH }, payload });
    const second = await app.inject({ method: 'POST', url: '/api/webhooks/revenuecat', headers: { authorization: REVENUECAT_AUTH }, payload });
    expect(second.statusCode).toBe(200);
    expect(second.json().result).toBe('duplicate');
  });

  it('CANCELLATION conserva el acceso hasta el fin del período ya pagado', async () => {
    const session = await register();
    const periodEnd = Date.now() + 10 * 86_400_000;
    await app.inject({ method: 'POST', url: '/api/webhooks/revenuecat', headers: { authorization: REVENUECAT_AUTH }, payload: { event: { id: 'evt_c1', type: 'INITIAL_PURCHASE', app_user_id: session.business.id, product_id: 'xiro_monthly', store: 'APP_STORE', expiration_at_ms: periodEnd } } });
    await app.inject({ method: 'POST', url: '/api/webhooks/revenuecat', headers: { authorization: REVENUECAT_AUTH }, payload: { event: { id: 'evt_c2', type: 'CANCELLATION', app_user_id: session.business.id, expiration_at_ms: periodEnd } } });
    const status = await app.inject({ method: 'GET', url: '/api/subscription', headers: auth(session) });
    const body = status.json<Subscription>();
    expect(body).toMatchObject({ status: 'active', cancelAtPeriodEnd: true, hasAccess: true });
  });

  it('EXPIRATION revoca el acceso sin gracia adicional (Apple/Google ya la aplicaron)', async () => {
    const session = await register();
    await app.inject({ method: 'POST', url: '/api/webhooks/revenuecat', headers: { authorization: REVENUECAT_AUTH }, payload: { event: { id: 'evt_e1', type: 'INITIAL_PURCHASE', app_user_id: session.business.id, product_id: 'xiro_monthly', store: 'APP_STORE', expiration_at_ms: Date.now() + 86_400_000 } } });
    await app.inject({ method: 'POST', url: '/api/webhooks/revenuecat', headers: { authorization: REVENUECAT_AUTH }, payload: { event: { id: 'evt_e2', type: 'EXPIRATION', app_user_id: session.business.id } } });
    const status = await app.inject({ method: 'GET', url: '/api/subscription', headers: auth(session) });
    expect(status.json<Subscription>()).toMatchObject({ status: 'expired', hasAccess: false });
  });
});

describe('POST /api/subscription/cancel', () => {
  it('una suscripción de tienda (iOS/Android) no se puede cancelar desde la API', async () => {
    const session = await register();
    await app.inject({ method: 'POST', url: '/api/webhooks/revenuecat', headers: { authorization: REVENUECAT_AUTH }, payload: { event: { id: 'evt_cancel_1', type: 'INITIAL_PURCHASE', app_user_id: session.business.id, product_id: 'xiro_monthly', store: 'APP_STORE', expiration_at_ms: Date.now() + 30 * 86_400_000 } } });
    const res = await app.inject({ method: 'POST', url: '/api/subscription/cancel', headers: auth(session) });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('manage_in_store');
  });

  it('sin ninguna suscripción responde 404', async () => {
    const session = await register();
    const res = await app.inject({ method: 'POST', url: '/api/subscription/cancel', headers: auth(session) });
    expect(res.statusCode).toBe(404);
  });
});

describe('push de facturación al recibir un webhook', () => {
  afterEach(() => vi.unstubAllGlobals());

  async function withPushEnabled(session: AuthSession): Promise<void> {
    await app.inject({ method: 'PUT', url: '/api/notifications/settings', headers: auth(session), payload: { enabled: true, loyaltyEnabled: true, billingEnabled: true } });
    await app.inject({ method: 'POST', url: '/api/notifications/register', headers: auth(session), payload: { platform: 'expo', token: 'ExponentPushToken[test-token]' } });
  }

  it('BILLING_ISSUE avisa por push (mismo aviso "problema con tu pago" que ve la persona en pantalla)', async () => {
    const session = await register();
    await withPushEnabled(session);
    const fetchMock = vi.fn(async (..._args: Parameters<typeof fetch>) => new Response(JSON.stringify({ data: [{ status: 'ok', id: 'ticket-1' }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await app.inject({ method: 'POST', url: '/api/webhooks/revenuecat', headers: { authorization: REVENUECAT_AUTH }, payload: { event: { id: 'evt_push_issue', type: 'INITIAL_PURCHASE', app_user_id: session.business.id, product_id: 'xiro_monthly', store: 'APP_STORE', expiration_at_ms: Date.now() + 30 * 86_400_000 } } });
    await app.inject({ method: 'POST', url: '/api/webhooks/revenuecat', headers: { authorization: REVENUECAT_AUTH }, payload: { event: { id: 'evt_push_issue2', type: 'BILLING_ISSUE', app_user_id: session.business.id } } });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls.at(-1)!;
    const sent = JSON.parse(init!.body as string);
    expect(sent).toMatchObject([{ to: 'ExponentPushToken[test-token]', title: 'Problema con tu pago' }]);
  });

  it('EXPIRATION avisa por push ("tu suscripción venció")', async () => {
    const session = await register();
    await withPushEnabled(session);
    const fetchMock = vi.fn(async (..._args: Parameters<typeof fetch>) => new Response(JSON.stringify({ data: [{ status: 'ok', id: 'ticket-1' }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await app.inject({ method: 'POST', url: '/api/webhooks/revenuecat', headers: { authorization: REVENUECAT_AUTH }, payload: { event: { id: 'evt_push_exp1', type: 'INITIAL_PURCHASE', app_user_id: session.business.id, product_id: 'xiro_monthly', store: 'APP_STORE', expiration_at_ms: Date.now() + 86_400_000 } } });
    await app.inject({ method: 'POST', url: '/api/webhooks/revenuecat', headers: { authorization: REVENUECAT_AUTH }, payload: { event: { id: 'evt_push_exp2', type: 'EXPIRATION', app_user_id: session.business.id } } });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls.at(-1)!;
    const sent = JSON.parse(init!.body as string);
    expect(sent).toMatchObject([{ to: 'ExponentPushToken[test-token]', title: 'Tu suscripción venció' }]);
  });

  it('sin notificaciones activadas, el webhook no intenta enviar nada', async () => {
    const session = await register();
    // Registra un dispositivo pero deja el interruptor general apagado (valor por defecto).
    await app.inject({ method: 'POST', url: '/api/notifications/register', headers: auth(session), payload: { platform: 'expo', token: 'ExponentPushToken[off-token]' } });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await app.inject({ method: 'POST', url: '/api/webhooks/revenuecat', headers: { authorization: REVENUECAT_AUTH }, payload: { event: { id: 'evt_push_off1', type: 'INITIAL_PURCHASE', app_user_id: session.business.id, product_id: 'xiro_monthly', store: 'APP_STORE', expiration_at_ms: Date.now() + 86_400_000 } } });
    await app.inject({ method: 'POST', url: '/api/webhooks/revenuecat', headers: { authorization: REVENUECAT_AUTH }, payload: { event: { id: 'evt_push_off2', type: 'EXPIRATION', app_user_id: session.business.id } } });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
