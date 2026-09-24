import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';

export type SslMode = 'disable' | 'require' | 'no-verify';

export interface DatabaseConfig {
  url: string;
  /** disable = sin TLS · require = TLS con verificación del certificado · no-verify = TLS sin verificar (solo redes privadas). */
  ssl: SslMode;
  poolMax: number;
  poolMin: number;
  idleTimeoutMs: number;
  connectionTimeoutMs: number;
  /** Corta en el servidor cualquier consulta que tarde más (protege al pool de consultas atascadas). */
  statementTimeoutMs: number;
  /** Recicla conexiones viejas (útil tras failovers y balanceadores). 0 = sin límite. */
  maxLifetimeSeconds: number;
  applicationName: string;
}

export interface RateLimitConfig {
  enabled: boolean;
  /** Peticiones por minuto y por IP (todas las rutas). */
  globalPerMinute: number;
  /** Peticiones por minuto y por usuario autenticado. */
  userPerMinute: number;
  /** Intentos por minuto y por IP en endpoints de autenticación. */
  authPerMinute: number;
  /** Intentos fallidos de inicio de sesión / OTP por cuenta dentro de la ventana (frena la fuerza bruta distribuida). */
  accountAttempts: number;
  accountWindowMinutes: number;
}

export interface SecurityConfig {
  /** Content-Security-Policy para la app web. */
  csp: boolean;
  hsts: boolean;
  /** Orígenes extra permitidos en connect-src / img-src (p. ej. la API en otro dominio o un CDN de fotos). */
  cspConnect: string[];
  cspImg: string[];
}

export interface SubscriptionsConfig {
  /** Secreto compartido que RevenueCat envía en el header Authorization de cada webhook (lo defines tú en su panel). */
  revenueCatWebhookAuth: string | null;
  stripeSecretKey: string | null;
  stripeWebhookSecret: string | null;
  stripePriceMonthly: string | null;
  stripePriceYearly: string | null;
  paypalClientId: string | null;
  paypalClientSecret: string | null;
  paypalWebhookId: string | null;
  /** Ids de los "Billing Plans" ya creados en el panel de PayPal (uno por plan, igual que los price id de Stripe). */
  paypalPlanMonthly: string | null;
  paypalPlanYearly: string | null;
  /** 'live' fuerza credenciales reales de PayPal; 'sandbox' usa api-m.sandbox.paypal.com. */
  paypalEnv: 'sandbox' | 'live';
  /** Datos de la cuenta a mostrar para transferencia bancaria (sin esto, esa opción queda oculta). */
  bankTransferInstructions: string | null;
  /** Secreto para confirmar transferencias a mano (no hay panel de administración todavía: ver la guía de cuentas). */
  adminSecret: string | null;
}

export interface NotificationsConfig {
  /** Par de claves VAPID para Web Push (genéralas una vez con `npx web-push generate-vapid-keys` y no las cambies:
   * cambiar la clave pública invalida todas las suscripciones ya guardadas). Sin esto, el push en la Web queda apagado. */
  vapidPublicKey: string | null;
  vapidPrivateKey: string | null;
  /** Contacto "mailto:" exigido por el protocolo Web Push (para que el proveedor del navegador pueda escribirte si abusas del envío). */
  vapidSubject: string | null;
}

export interface Config {
  port: number;
  host: string;
  production: boolean;
  dataDir: string;
  mediaDir: string;
  database: DatabaseConfig;
  autoMigrate: boolean;
  jwtSecret: string;
  jwtIssuer: string;
  jwtAudience: string;
  accessTokenTtl: string;
  corsOrigins: string[];
  webDir: string | null;
  exposeDevOtp: boolean;
  /** true = confía en X-Forwarded-For · número = saltos de proxy confiables. */
  trustProxy: boolean | number;
  rateLimit: RateLimitConfig;
  security: SecurityConfig;
  subscriptions: SubscriptionsConfig;
  notifications: NotificationsConfig;
}

const DEV_DATABASE_URL = 'postgres://xiro:xiro@localhost:54320/xiro';

const int = (name: string, fallback: number, min: number, max: number) =>
  z.coerce.number().int().min(min, `${name} ≥ ${min}`).max(max, `${name} ≤ ${max}`).default(fallback);

const csv = (value: string | undefined) => (value ?? '').split(',').map((v) => v.trim()).filter(Boolean);

const envSchema = z.object({
  PORT: int('PORT', 3000, 1, 65535),
  HOST: z.string().default('0.0.0.0'),
  DATA_DIR: z.string().default('./data'),
  DATABASE_URL: z.string().optional(),
  DATABASE_SSL: z.enum(['disable', 'require', 'no-verify']).optional(),
  DB_POOL_MAX: int('DB_POOL_MAX', 10, 1, 200),
  DB_POOL_MIN: int('DB_POOL_MIN', 0, 0, 100),
  DB_IDLE_TIMEOUT_MS: int('DB_IDLE_TIMEOUT_MS', 30_000, 1_000, 3_600_000),
  DB_CONNECTION_TIMEOUT_MS: int('DB_CONNECTION_TIMEOUT_MS', 5_000, 500, 60_000),
  DB_STATEMENT_TIMEOUT_MS: int('DB_STATEMENT_TIMEOUT_MS', 15_000, 500, 300_000),
  DB_MAX_LIFETIME_SECONDS: int('DB_MAX_LIFETIME_SECONDS', 1_800, 0, 86_400),
  AUTO_MIGRATE: z.enum(['true', 'false']).optional(),
  JWT_SECRET: z.string().optional(),
  JWT_ISSUER: z.string().min(1).default('xiro-style-api'),
  JWT_AUDIENCE: z.string().min(1).default('xiro-style-app'),
  JWT_ACCESS_TTL: z.string().regex(/^\d+[smh]$/, 'JWT_ACCESS_TTL debe ser como 15m, 30s o 1h').default('15m'),
  CORS_ORIGINS: z.string().optional(),
  WEB_DIR: z.string().optional(),
  EXPOSE_DEV_OTP: z.enum(['true', 'false']).optional(),
  TRUST_PROXY: z.string().optional(),
  RATE_LIMIT: z.enum(['on', 'off']).default('on'),
  RATE_LIMIT_GLOBAL_PER_MIN: int('RATE_LIMIT_GLOBAL_PER_MIN', 300, 1, 100_000),
  RATE_LIMIT_USER_PER_MIN: int('RATE_LIMIT_USER_PER_MIN', 600, 1, 100_000),
  RATE_LIMIT_AUTH_PER_MIN: int('RATE_LIMIT_AUTH_PER_MIN', 10, 1, 10_000),
  RATE_LIMIT_ACCOUNT_ATTEMPTS: int('RATE_LIMIT_ACCOUNT_ATTEMPTS', 10, 1, 1_000),
  RATE_LIMIT_ACCOUNT_WINDOW_MIN: int('RATE_LIMIT_ACCOUNT_WINDOW_MIN', 15, 1, 1_440),
  SECURITY_CSP: z.enum(['on', 'off']).default('on'),
  SECURITY_HSTS: z.enum(['on', 'off']).optional(),
  CSP_CONNECT_SRC: z.string().optional(),
  CSP_IMG_SRC: z.string().optional(),
  REVENUECAT_WEBHOOK_AUTH: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_MONTHLY: z.string().optional(),
  STRIPE_PRICE_YEARLY: z.string().optional(),
  PAYPAL_CLIENT_ID: z.string().optional(),
  PAYPAL_CLIENT_SECRET: z.string().optional(),
  PAYPAL_WEBHOOK_ID: z.string().optional(),
  PAYPAL_PLAN_MONTHLY: z.string().optional(),
  PAYPAL_PLAN_YEARLY: z.string().optional(),
  PAYPAL_ENV: z.enum(['sandbox', 'live']).default('sandbox'),
  BANK_TRANSFER_INSTRUCTIONS: z.string().optional(),
  ADMIN_SECRET: z.string().optional(),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().optional(),
});

function parseTrustProxy(value: string | undefined): boolean | number {
  if (!value || value === 'false') return false;
  if (value === 'true') return true;
  const hops = Number(value);
  if (Number.isInteger(hops) && hops > 0) return hops;
  throw new Error('TRUST_PROXY debe ser true, false o un número de saltos (p. ej. 1).');
}

function validateOrigins(origins: string[], production: boolean): string[] {
  for (const origin of origins) {
    if (origin === '*') throw new Error('CORS_ORIGINS no admite "*": lista los orígenes exactos.');
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error(`CORS_ORIGINS contiene un origen inválido: ${origin}`);
    }
    if (parsed.origin !== origin) throw new Error(`CORS_ORIGINS debe ser solo el origen (esquema + host + puerto), sin ruta: ${origin}`);
    if (production && parsed.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(parsed.hostname)) {
      throw new Error(`En producción CORS_ORIGINS debe usar https: ${origin}`);
    }
  }
  return origins;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Configuración inválida:\n${parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n')}`);
  }
  const e = parsed.data;
  const production = env.NODE_ENV === 'production';
  const dataDir = path.resolve(e.DATA_DIR);

  let jwtSecret = e.JWT_SECRET?.trim() ?? '';
  if (production && jwtSecret.length < 32) throw new Error('JWT_SECRET (mínimo 32 caracteres) es obligatorio en producción.');
  if (!jwtSecret) jwtSecret = randomBytes(32).toString('hex'); // efímero: solo desarrollo, las sesiones no sobreviven a un reinicio

  if (production && e.EXPOSE_DEV_OTP === 'true') throw new Error('EXPOSE_DEV_OTP no puede activarse en producción.');
  if (production && e.RATE_LIMIT === 'off') throw new Error('RATE_LIMIT=off no puede usarse en producción.');
  if (production && !e.DATABASE_URL) throw new Error('DATABASE_URL es obligatoria en producción (postgres://usuario:clave@host:5432/base).');

  const url = e.DATABASE_URL ?? DEV_DATABASE_URL;
  if (!/^postgres(ql)?:\/\//.test(url)) throw new Error('DATABASE_URL debe empezar por postgres:// o postgresql://');
  if (e.DB_POOL_MIN > e.DB_POOL_MAX) throw new Error('DB_POOL_MIN no puede ser mayor que DB_POOL_MAX.');

  return {
    port: e.PORT,
    host: e.HOST,
    production,
    dataDir,
    mediaDir: path.join(dataDir, 'media'),
    database: {
      url,
      ssl: e.DATABASE_SSL ?? (production ? 'require' : 'disable'),
      poolMax: e.DB_POOL_MAX,
      poolMin: e.DB_POOL_MIN,
      idleTimeoutMs: e.DB_IDLE_TIMEOUT_MS,
      connectionTimeoutMs: e.DB_CONNECTION_TIMEOUT_MS,
      statementTimeoutMs: e.DB_STATEMENT_TIMEOUT_MS,
      maxLifetimeSeconds: e.DB_MAX_LIFETIME_SECONDS,
      applicationName: 'xiro-api',
    },
    autoMigrate: e.AUTO_MIGRATE ? e.AUTO_MIGRATE === 'true' : !production,
    jwtSecret,
    jwtIssuer: e.JWT_ISSUER,
    jwtAudience: e.JWT_AUDIENCE,
    accessTokenTtl: e.JWT_ACCESS_TTL,
    corsOrigins: validateOrigins(csv(e.CORS_ORIGINS), production),
    webDir: e.WEB_DIR ? path.resolve(e.WEB_DIR) : path.resolve('../mobile/dist'),
    exposeDevOtp: e.EXPOSE_DEV_OTP === 'true',
    trustProxy: parseTrustProxy(e.TRUST_PROXY),
    rateLimit: {
      enabled: e.RATE_LIMIT === 'on',
      globalPerMinute: e.RATE_LIMIT_GLOBAL_PER_MIN,
      userPerMinute: e.RATE_LIMIT_USER_PER_MIN,
      authPerMinute: e.RATE_LIMIT_AUTH_PER_MIN,
      accountAttempts: e.RATE_LIMIT_ACCOUNT_ATTEMPTS,
      accountWindowMinutes: e.RATE_LIMIT_ACCOUNT_WINDOW_MIN,
    },
    security: {
      csp: e.SECURITY_CSP === 'on',
      hsts: (e.SECURITY_HSTS ?? (production ? 'on' : 'off')) === 'on',
      cspConnect: csv(e.CSP_CONNECT_SRC),
      cspImg: csv(e.CSP_IMG_SRC),
    },
    // Cada proveedor es independiente y opcional: un negocio puede lanzar con Stripe + RevenueCat y sumar
    // PayPal después, sin que falte una variable tumbe el arranque del servidor entero.
    subscriptions: {
      revenueCatWebhookAuth: e.REVENUECAT_WEBHOOK_AUTH ?? null,
      stripeSecretKey: e.STRIPE_SECRET_KEY ?? null,
      stripeWebhookSecret: e.STRIPE_WEBHOOK_SECRET ?? null,
      stripePriceMonthly: e.STRIPE_PRICE_MONTHLY ?? null,
      stripePriceYearly: e.STRIPE_PRICE_YEARLY ?? null,
      paypalClientId: e.PAYPAL_CLIENT_ID ?? null,
      paypalClientSecret: e.PAYPAL_CLIENT_SECRET ?? null,
      paypalWebhookId: e.PAYPAL_WEBHOOK_ID ?? null,
      paypalPlanMonthly: e.PAYPAL_PLAN_MONTHLY ?? null,
      paypalPlanYearly: e.PAYPAL_PLAN_YEARLY ?? null,
      paypalEnv: e.PAYPAL_ENV,
      bankTransferInstructions: e.BANK_TRANSFER_INSTRUCTIONS ?? null,
      adminSecret: e.ADMIN_SECRET ?? null,
    },
    notifications: {
      vapidPublicKey: e.VAPID_PUBLIC_KEY ?? null,
      vapidPrivateKey: e.VAPID_PRIVATE_KEY ?? null,
      vapidSubject: e.VAPID_SUBJECT ?? null,
    },
  };
}
