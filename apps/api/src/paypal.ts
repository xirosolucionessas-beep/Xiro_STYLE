import type { SubscriptionsConfig } from './config';

/**
 * Cliente mínimo de PayPal (OAuth2 + Subscriptions API + verificación de webhooks) por fetch directo: PayPal no
 * tiene un SDK de Node tan estándar como el de Stripe, y la superficie que necesitamos es chica. Todo lo que
 * necesita PAYPAL_CLIENT_ID/SECRET configurados; sin ellos, cada función lanza con un mensaje claro (ver routes).
 */

type PayPalConfig = Pick<SubscriptionsConfig, 'paypalClientId' | 'paypalClientSecret' | 'paypalWebhookId' | 'paypalEnv'>;

const baseUrl = (env: PayPalConfig['paypalEnv']) => (env === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com');

export class PayPalNotConfiguredError extends Error {
  constructor() {
    super('PayPal no está configurado (faltan PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET).');
  }
}

async function accessToken(config: PayPalConfig): Promise<string> {
  if (!config.paypalClientId || !config.paypalClientSecret) throw new PayPalNotConfiguredError();
  const res = await fetch(`${baseUrl(config.paypalEnv)}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.paypalClientId}:${config.paypalClientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`PayPal OAuth falló: ${res.status}`);
  const body = (await res.json()) as { access_token: string };
  return body.access_token;
}

export interface CreateSubscriptionInput {
  planId: string;
  businessId: string;
  returnUrl: string;
  cancelUrl: string;
  brandName: string;
}

/** Crea la suscripción en PayPal y devuelve la URL de aprobación a la que redirigir al negocio. */
export async function createPayPalSubscription(config: PayPalConfig, input: CreateSubscriptionInput): Promise<string> {
  const token = await accessToken(config);
  const res = await fetch(`${baseUrl(config.paypalEnv)}/v1/billing/subscriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      plan_id: input.planId,
      custom_id: input.businessId,
      application_context: { brand_name: input.brandName, return_url: input.returnUrl, cancel_url: input.cancelUrl, user_action: 'SUBSCRIBE_NOW' },
    }),
  });
  if (!res.ok) throw new Error(`No se pudo crear la suscripción en PayPal: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { links: Array<{ rel: string; href: string }> };
  const approve = body.links.find((link) => link.rel === 'approve')?.href;
  if (!approve) throw new Error('PayPal no devolvió un enlace de aprobación.');
  return approve;
}

export interface WebhookVerificationInput {
  transmissionId: string;
  transmissionTime: string;
  certUrl: string;
  authAlgo: string;
  transmissionSig: string;
  webhookEvent: unknown;
}

/** https://developer.paypal.com/api/rest/webhooks/rest/#link-verifywebhooksignature — nunca confiar en un webhook sin esto. */
export async function verifyPayPalWebhook(config: PayPalConfig, input: WebhookVerificationInput): Promise<boolean> {
  if (!config.paypalWebhookId) throw new PayPalNotConfiguredError();
  const token = await accessToken(config);
  const res = await fetch(`${baseUrl(config.paypalEnv)}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      transmission_id: input.transmissionId,
      transmission_time: input.transmissionTime,
      cert_url: input.certUrl,
      auth_algo: input.authAlgo,
      transmission_sig: input.transmissionSig,
      webhook_id: config.paypalWebhookId,
      webhook_event: input.webhookEvent,
    }),
  });
  if (!res.ok) return false;
  const body = (await res.json()) as { verification_status: string };
  return body.verification_status === 'SUCCESS';
}
