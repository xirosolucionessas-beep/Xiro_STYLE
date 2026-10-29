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
  adminAllowedIps: [],
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
  const ADMIN_SECRET = 'test-admin-secret-con-mas-de-32-caracteres';
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
    const confirmed = confirm.json<{ subscription: Subscription; invoiceId: string }>();
    expect(confirmed.subscription).toMatchObject({ status: 'active', plan: 'yearly', paymentMethod: 'bank_transfer', hasAccess: true });
    expect(confirmed.invoiceId).toBeTruthy();

    const after = await bankApp.inject({ method: 'GET', url: '/api/subscription', headers: auth(session) });
    expect(after.json<Subscription>().status).toBe('active');

    const invoices = await bankApp.inject({ method: 'GET', url: '/api/subscription/invoices', headers: auth(session) });
    expect(invoices.statusCode).toBe(200);
    const invoiceList = invoices.json<{ invoices: Array<{ id: string; plan: string; amount: number; paymentMethod: string }> }>().invoices;
    expect(invoiceList).toHaveLength(1);
    expect(invoiceList[0]).toMatchObject({ id: confirmed.invoiceId, plan: 'yearly', paymentMethod: 'bank_transfer', amount: 349_000 });
  });
});

describe('endpoint de administración endurecido', () => {
  const ADMIN_SECRET = 'otro-secreto-de-administracion-muy-largo-123';
  let adminApp: FastifyInstance;
  let allowApp: FastifyInstance;
  const confirm = (target: FastifyInstance, secret: string | undefined, businessId: string, ip = '203.0.113.10') =>
    target.inject({ method: 'POST', url: '/api/admin/subscription/confirm-bank-transfer', headers: secret === undefined ? {} : { 'x-admin-secret': secret }, payload: { businessId, plan: 'monthly' }, remoteAddress: ip });

  beforeAll(async () => {
    const { config } = testAppConfig({ rateLimit: { enabled: true, globalPerMinute: 10_000, userPerMinute: 10_000, authPerMinute: 1_000 } });
    adminApp = await buildApp({ db: testDb.db, config: { ...config, subscriptions: { ...subscriptionsConfig, adminSecret: ADMIN_SECRET } } });
    allowApp = await buildApp({ db: testDb.db, config: { ...testAppConfig().config, subscriptions: { ...subscriptionsConfig, adminSecret: ADMIN_SECRET, adminAllowedIps: ['10.0.0.5'] } } });
  });
  afterAll(async () => {
    await adminApp.close();
    await allowApp.close();
  });

  it('rechaza sin secreto, con uno parecido o con el correcto + 1 caracter (comparación exacta en tiempo constante)', async () => {
    const id = '00000000-0000-4000-8000-000000000001';
    for (const secret of [undefined, '', ADMIN_SECRET.slice(0, -1), ADMIN_SECRET + 'x', ADMIN_SECRET.toUpperCase()]) expect((await confirm(adminApp, secret, id, '198.51.100.' + Math.floor(Math.random() * 200))).statusCode).toBe(401);
  });

  it('un negocio inexistente responde 404 (antes era un 500 por la llave foránea)', async () => {
    expect((await confirm(adminApp, ADMIN_SECRET, '00000000-0000-4000-8000-0000000000ff', '198.51.100.250')).statusCode).toBe(404);
  });

  it('límite estricto por IP: 5 intentos cada 15 minutos', async () => {
    const ip = '192.0.2.200';
    for (let i = 0; i < 5; i += 1) expect((await confirm(adminApp, 'incorrecto', '00000000-0000-4000-8000-000000000002', ip)).statusCode).toBe(401);
    const blocked = await confirm(adminApp, ADMIN_SECRET, '00000000-0000-4000-8000-000000000002', ip);
    expect(blocked.statusCode).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('con lista blanca, otra IP recibe 404 aunque traiga el secreto correcto', async () => {
    expect((await confirm(allowApp, ADMIN_SECRET, '00000000-0000-4000-8000-000000000003', '203.0.113.77')).statusCode).toBe(404);
    expect((await confirm(allowApp, ADMIN_SECRET, '00000000-0000-4000-8000-000000000003', '10.0.0.5')).statusCode).toBe(404); // IP permitida: llega a validar y el negocio no existe
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

    const invoices = await app.inject({ method: 'GET', url: '/api/subscription/invoices', headers: auth(session) });
    const invoiceList = invoices.json<{ invoices: Array<{ plan: string; paymentMethod: string }> }>().invoices;
    expect(invoiceList).toHaveLength(1);
    expect(invoiceList[0]).toMatchObject({ plan: 'yearly', paymentMethod: 'card' });
  });

  it('es idempotente: el mismo evento reenviado no duplica el registro de auditoría ni el comprobante', async () => {
    const session = await register();
    const payload = { event: { id: 'evt_dup_1', type: 'INITIAL_PURCHASE', app_user_id: session.business.id, product_id: 'xiro_monthly', store: 'PLAY_STORE', expiration_at_ms: Date.now() + 30 * 86_400_000 } };
    await app.inject({ method: 'POST', url: '/api/webhooks/revenuecat', headers: { authorization: REVENUECAT_AUTH }, payload });
    const second = await app.inject({ method: 'POST', url: '/api/webhooks/revenuecat', headers: { authorization: REVENUECAT_AUTH }, payload });
    expect(second.statusCode).toBe(200);
    expect(second.json().result).toBe('duplicate');

    const invoices = await app.inject({ method: 'GET', url: '/api/subscription/invoices', headers: auth(session) });
    expect(invoices.json<{ invoices: unknown[] }>().invoices).toHaveLength(1);
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

  it('RENEWAL genera un segundo comprobante; UNCANCELLATION (sin cobro de por medio) no genera ninguno', async () => {
    const session = await register();
    await app.inject({ method: 'POST', url: '/api/webhooks/revenuecat', headers: { authorization: REVENUECAT_AUTH }, payload: { event: { id: 'evt_r1', type: 'INITIAL_PURCHASE', app_user_id: session.business.id, product_id: 'xiro_monthly', store: 'APP_STORE', expiration_at_ms: Date.now() + 30 * 86_400_000 } } });
    await app.inject({ method: 'POST', url: '/api/webhooks/revenuecat', headers: { authorization: REVENUECAT_AUTH }, payload: { event: { id: 'evt_r2', type: 'UNCANCELLATION', app_user_id: session.business.id, product_id: 'xiro_monthly', store: 'APP_STORE', expiration_at_ms: Date.now() + 30 * 86_400_000 } } });
    await app.inject({ method: 'POST', url: '/api/webhooks/revenuecat', headers: { authorization: REVENUECAT_AUTH }, payload: { event: { id: 'evt_r3', type: 'RENEWAL', app_user_id: session.business.id, product_id: 'xiro_monthly', store: 'APP_STORE', expiration_at_ms: Date.now() + 60 * 86_400_000 } } });

    const invoices = await app.inject({ method: 'GET', url: '/api/subscription/invoices', headers: auth(session) });
    expect(invoices.json<{ invoices: unknown[] }>().invoices).toHaveLength(2); // INITIAL_PURCHASE + RENEWAL, no uno por UNCANCELLATION
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

  it('BILLING_ISSUE queda en el centro de notificaciones del dueño, y un reenvío del mismo webhook (retry típico del proveedor) no lo duplica', async () => {
    const session = await register();
    await withPushEnabled(session);
    const fetchMock = vi.fn(async (..._args: Parameters<typeof fetch>) => new Response(JSON.stringify({ data: [{ status: 'ok', id: 'ticket-1' }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const purchase = { event: { id: 'evt_notif_issue1', type: 'INITIAL_PURCHASE', app_user_id: session.business.id, product_id: 'xiro_monthly', store: 'APP_STORE', expiration_at_ms: Date.now() + 30 * 86_400_000 } };
    const issue = { event: { id: 'evt_notif_issue2', type: 'BILLING_ISSUE', app_user_id: session.business.id } };
    await app.inject({ method: 'POST', url: '/api/webhooks/revenuecat', headers: { authorization: REVENUECAT_AUTH }, payload: purchase });
    await app.inject({ method: 'POST', url: '/api/webhooks/revenuecat', headers: { authorization: REVENUECAT_AUTH }, payload: issue });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const list = await app.inject({ method: 'GET', url: '/api/notifications', headers: auth(session) });
    const body = list.json<{ notifications: Array<{ category: string; titleKey: string; read: boolean }>; unread: number }>();
    expect(body.unread).toBe(1);
    expect(body.notifications).toMatchObject([{ category: 'billing', titleKey: 'push_billing_issue_title', read: false }]);

    // El mismo evento reenviado (p. ej. un retry del proveedor) no debe producir una segunda notificación igual.
    await app.inject({ method: 'POST', url: '/api/webhooks/revenuecat', headers: { authorization: REVENUECAT_AUTH }, payload: issue });
    const again = await app.inject({ method: 'GET', url: '/api/notifications', headers: auth(session) });
    expect(again.json<{ notifications: unknown[] }>().notifications).toHaveLength(1);
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

describe('webhooks endurecidos (Fase 3)', () => {
  const revenuecat = (payload: unknown, raw = false) =>
    app.inject({ method: 'POST', url: '/api/webhooks/revenuecat', headers: { authorization: REVENUECAT_AUTH, 'content-type': 'application/json' }, payload: raw ? (payload as string) : JSON.stringify(payload) });
  const eventsFor = async (externalEventId: string) => (await testDb.pool.query('select count(*)::int as n from subscription_events where external_event_id = $1', [externalEventId])).rows[0].n as number;

  it('JSON malformado o campos con otro tipo → 400 (no 500 que el proveedor reintentaría sin fin)', async () => {
    expect((await revenuecat('{"event": {"id": ', true)).statusCode).toBe(400);
    const session = await register();
    const wrongType = await revenuecat({ event: { id: 'evt_tipo', type: 'RENEWAL', app_user_id: session.business.id, expiration_at_ms: 'mañana' } });
    expect(wrongType.statusCode).toBe(400);
    expect(await eventsFor('evt_tipo')).toBe(0);
  });

  it('un app_user_id que no es un negocio nuestro se ignora con 200 (sin error de llave foránea ni registro)', async () => {
    for (const [id, appUserId] of [['evt_anon', '$RCAnonymousID:abc123'], ['evt_ajeno', '00000000-0000-4000-8000-0000000000aa']]) {
      const res = await revenuecat({ event: { id, type: 'INITIAL_PURCHASE', app_user_id: appUserId, product_id: 'xiro_monthly' } });
      expect(res.statusCode, appUserId).toBe(200);
      expect(res.json()).toMatchObject({ ok: true, ignored: 'unknown app_user_id' });
      expect(await eventsFor(id!)).toBe(0);
    }
  });

  it('registrar el evento y aplicarlo es atómico: si aplicar falla, el reintento del proveedor sí lo procesa', async () => {
    const { applyProviderEvent } = await import('../src/subscriptions');
    const session = await register();
    await expect(applyProviderEvent(testDb.db, session.business.id, 'revenuecat', 'RENEWAL', { status: 'active', platform: 'ios', paymentMethod: 'card', plan: 'monthly', currentPeriodEnd: new Date(Number.NaN) }, 'evt_atomico', {})).rejects.toThrow();
    expect(await eventsFor('evt_atomico')).toBe(0); // antes quedaba registrado y el reintento salía como "duplicado"
    expect(await applyProviderEvent(testDb.db, session.business.id, 'revenuecat', 'RENEWAL', { status: 'active', platform: 'ios', paymentMethod: 'card', plan: 'monthly' }, 'evt_atomico', {})).toBe('applied');
    expect(await eventsFor('evt_atomico')).toBe(1);
  });
});

describe('checkout: la URL de retorno solo usa orígenes permitidos (Fase 3, redirección abierta)', () => {
  it('Origin ajeno → vuelve al propio servidor; Origin de CORS_ORIGINS → se respeta', async () => {
    const created = testAppConfig({ corsOrigins: ['https://app.xirostyle.com'] });
    const paypalApp = await buildApp({ db: testDb.db, config: { ...created.config, subscriptions: { ...subscriptionsConfig, paypalClientId: 'id', paypalClientSecret: 'secret', paypalPlanMonthly: 'P-MONTH' } } });
    try {
      const session = await (async () => {
        counter += 1;
        const res = await paypalApp.inject({ method: 'POST', url: '/api/auth/register', payload: { name: 'Ana', businessName: `Retorno ${counter}`, businessType: 'beauty_salon', email: `retorno${counter}@correo.com`, password: 'Secreta123', acceptTerms: true, language: 'es' } });
        return res.json<AuthSession>();
      })();
      const returnUrls: string[] = [];
      vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        if (String(url).endsWith('/v1/oauth2/token')) return new Response(JSON.stringify({ access_token: 't' }), { status: 200 });
        returnUrls.push(JSON.parse(String(init!.body)).application_context.return_url);
        return new Response(JSON.stringify({ links: [{ rel: 'approve', href: 'https://www.sandbox.paypal.com/approve' }] }), { status: 201 });
      }));
      const checkout = (origin: string) => paypalApp.inject({ method: 'POST', url: '/api/subscription/checkout/paypal', headers: { ...auth(session), origin, host: 'api.xirostyle.com' }, payload: { plan: 'monthly' } });
      expect((await checkout('https://sitio-malicioso.example')).statusCode).toBe(200);
      expect((await checkout('https://app.xirostyle.com')).statusCode).toBe(200);
      expect(returnUrls[0]).toBe('http://api.xirostyle.com/subscription?checkout=success');
      expect(returnUrls[1]).toBe('https://app.xirostyle.com/subscription?checkout=success');
    } finally {
      vi.unstubAllGlobals();
      await paypalApp.close();
      created.cleanup();
    }
  });
});
