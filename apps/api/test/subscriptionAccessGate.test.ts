import type { AuthSession } from '@xiro/shared';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { businessAccessGrants, businesses, platformAdmins, subscriptions } from '../src/db/schema';
import { createTestDatabase, testAppConfig, type TestDatabase } from './helpers/db';

/**
 * Fase 1 (seguridad): antes de este cambio, una suscripción vencida más allá del período de gracia no le quitaba
 * acceso a la API — solo la interfaz "sugería" un bloqueo (ver subscriptionNotice) sin que el servidor lo exigiera.
 * Estas pruebas confirman el gateo real en `authenticate` (app.ts) y que las rutas esenciales (consultar la cuenta,
 * ver/pagar/cancelar la suscripción) siguen abiertas incluso bloqueado.
 */

let app: FastifyInstance;
let testDb: TestDatabase;
let cleanupConfig: () => void;

beforeAll(async () => {
  testDb = await createTestDatabase();
  const { config, cleanup } = testAppConfig();
  cleanupConfig = cleanup;
  app = await buildApp({ db: testDb.db, config });
});

afterAll(async () => {
  await app.close();
  cleanupConfig();
  await testDb.drop();
});

let counter = 0;
async function register(): Promise<AuthSession> {
  counter += 1;
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { name: 'Ana Pérez', businessName: `Gate ${counter}`, businessType: 'beauty_salon', email: `gate${counter}@correo.com`, password: 'Secreta123', acceptTerms: true, language: 'es' },
  });
  expect(res.statusCode).toBe(201);
  return res.json<AuthSession>();
}
const auth = (session: AuthSession) => ({ authorization: `Bearer ${session.accessToken}` });

async function expireSubscription(session: AuthSession) {
  await app.inject({ method: 'POST', url: '/api/subscription/trial', headers: auth(session), payload: { plan: 'monthly', platform: 'web' } });
  // `deriveEffectiveStatus` solo avanza UN escalón por llamada (trial→past_due o past_due→expired): en producción el
  // primer salto ya quedó grabado (por el job diario o una lectura previa) antes de que la gracia también se agote.
  // Por eso acá hay que fijar `status: 'past_due'` directamente, no solo las fechas, para llegar a "expired" de una vez.
  const past = new Date(Date.now() - 1000);
  await testDb.db.update(subscriptions).set({ status: 'past_due', trialEndsAt: past, gracePeriodEndsAt: past }).where(eq(subscriptions.businessId, session.business.id));
  // Confirma que ya quedó "expired" (self-heal al leer), antes de medir el bloqueo en las demás rutas.
  const check = await app.inject({ method: 'GET', url: '/api/subscription', headers: auth(session) });
  expect(check.json()).toMatchObject({ status: 'expired', hasAccess: false });
}

describe('gateo de acceso del servidor por suscripción vencida (Fase 1)', () => {
  it('con la suscripción vencida más allá de la gracia, una ruta normal del negocio responde 402 subscription_required', async () => {
    const session = await register();
    await expireSubscription(session);
    const res = await app.inject({ method: 'GET', url: '/api/clients', headers: auth(session) });
    expect(res.statusCode).toBe(402);
    expect(res.json().code).toBe('subscription_required');
  });

  it('bloqueado, GET /api/me y todo /api/subscription/* siguen respondiendo (consultar, pagar, cancelar)', async () => {
    const session = await register();
    await expireSubscription(session);
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: auth(session) });
    expect(me.statusCode).toBe(200);
    const sub = await app.inject({ method: 'GET', url: '/api/subscription', headers: auth(session) });
    expect(sub.statusCode).toBe(200);
    const invoices = await app.inject({ method: 'GET', url: '/api/subscription/invoices', headers: auth(session) });
    expect(invoices.statusCode).toBe(200);
    // El checkout bancario no depende del gateo: puede fallar por otra razón (sin proveedor listo en pruebas), pero
    // NUNCA con el código del bloqueo — confirma que la ruta no quedó atrapada por `authenticate`.
    const checkout = await app.inject({ method: 'POST', url: '/api/subscription/checkout/bank-transfer', headers: auth(session), payload: { plan: 'monthly' } });
    expect(checkout.statusCode).not.toBe(402);
  });

  it('una concesión vigente del fundador restaura el acceso aunque la suscripción siga vencida', async () => {
    const session = await register();
    await expireSubscription(session);
    const blocked = await app.inject({ method: 'GET', url: '/api/clients', headers: auth(session) });
    expect(blocked.statusCode).toBe(402);

    const now = new Date();
    const [admin] = await testDb.db.insert(platformAdmins).values({ email: `admin${counter}@xiro.co`, name: 'Admin Prueba', passwordHash: 'x', totpSecretEnc: 'x' }).returning({ id: platformAdmins.id });
    await testDb.db.insert(businessAccessGrants).values({
      businessId: session.business.id,
      adminId: admin!.id,
      unit: 'days',
      amount: 7,
      startsAt: new Date(now.getTime() - 1000),
      endsAt: new Date(now.getTime() + 7 * 86_400_000),
      reason: 'Prueba de la política de gateo',
      supportRef: '',
      idempotencyKey: randomUUID(),
    });

    const withGrant = await app.inject({ method: 'GET', url: '/api/clients', headers: auth(session) });
    expect(withGrant.statusCode).toBe(200);
  });

  it('un negocio que nunca eligió plan ("none") NO queda bloqueado — decisión deliberadamente conservadora', async () => {
    const session = await register();
    const sub = await app.inject({ method: 'GET', url: '/api/subscription', headers: auth(session) });
    expect(sub.json()).toMatchObject({ status: 'none', hasAccess: false });
    const res = await app.inject({ method: 'GET', url: '/api/clients', headers: auth(session) });
    expect(res.statusCode).toBe(200);
  });

  it('un negocio suspendido por el fundador sigue dando "business_suspended" (403), distinto del vencimiento (402)', async () => {
    const session = await register();
    await testDb.db.update(businesses).set({ accessStatus: 'suspended' }).where(eq(businesses.id, session.business.id));
    const res = await app.inject({ method: 'GET', url: '/api/clients', headers: auth(session) });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('business_suspended');
  });

  it('con la suscripción al día, no hay ningún bloqueo', async () => {
    const session = await register();
    await app.inject({ method: 'POST', url: '/api/subscription/trial', headers: auth(session), payload: { plan: 'monthly', platform: 'web' } });
    const res = await app.inject({ method: 'GET', url: '/api/clients', headers: auth(session) });
    expect(res.statusCode).toBe(200);
  });
});
