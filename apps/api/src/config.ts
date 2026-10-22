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
  /**
   * Cómo se aplican `statement_timeout` e `idle_in_transaction_session_timeout`:
   *  - `startup` (por defecto): como parámetros al abrir cada conexión (conexión directa a PostgreSQL).
   *  - `none`: no se envían. Necesario detrás de PgBouncer en modo transacción o del pooler de un proveedor, que
   *    rechazan parámetros de arranque desconocidos; en ese caso se configuran en el rol (ver docs/database-pooling.md).
   */
  sessionParams?: 'startup' | 'none';
  /**
   * Conexión DIRECTA a PostgreSQL (sin pooler) para lo que necesita una sesión fija: LISTEN de la agenda en tiempo real,
   * la cola pg-boss y el candado de las migraciones. Sin definir = la misma `url`.
   */
  directUrl?: string;
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
  /** Hashes de contraseña simultáneos (argon2id) y cuántos pueden esperar antes de responder 503. */
  hashConcurrency: number;
  hashQueueMax: number;
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
  /** Si no está vacía, solo estas IPs pueden usar /api/admin. */
  adminAllowedIps: string[];
}

/** Panel de administración de la plataforma (ver docs/platform-admin.md). Sin PLATFORM_ADMIN_KEY no existe: todas sus rutas responden 404. */
export interface PlatformConfig {
  /** Clave (≥ 32 caracteres) con la que se cifran los secretos TOTP de los administradores. Cambiarla invalida su MFA. */
  adminKey: string | null;
  /** Si no está vacía, solo estas IPs llegan a /api/platform (el resto recibe 404). */
  allowedIps: string[];
  /** Vida máxima de una sesión de administrador (horas) y cierre por inactividad (minutos). */
  sessionHours: number;
  idleMinutes: number;
  /** Las acciones sensibles exigen haber verificado el código TOTP hace menos de esto (minutos). */
  stepUpMinutes: number;
  /** SOLO desarrollo local: entrar al panel sin código TOTP. La API se niega a arrancar con esto en producción. */
  devSkipTotp: boolean;
  /** SOLO desarrollo local: además del código TOTP real, también vale "123456". La API se niega a arrancar con
   * esto en producción (igual que `devSkipTotp`); a diferencia de antes, esto ya no depende solo de NODE_ENV: hay
   * que activarlo explícitamente, para que ningún análisis estático o build accidental lo deje habilitado. */
  devMasterTotp: boolean;
}

/** Par de claves VAPID para Web Push (genéralas una vez con `npx web-push generate-vapid-keys` y no las cambies:
 * cambiar la clave pública invalida todas las suscripciones ya guardadas). Sin esto, el push en la Web queda apagado. */
export interface VapidConfig {
  vapidPublicKey: string | null;
  vapidPrivateKey: string | null;
  /** Contacto "mailto:" exigido por el protocolo Web Push (para que el proveedor del navegador pueda escribirte si abusas del envío). */
  vapidSubject: string | null;
}

/**
 * Proveedor de los mensajes al usuario (códigos de verificación, recordatorios de cita, lista de espera, reseñas).
 * `console` solo los escribe en el log: vale para desarrollo, NUNCA para producción (la API no arranca así:
 * imprimiría códigos de verificación en los logs). Con un proveedor real, cada variante trae las credenciales que
 * ese proveedor necesita (validadas en `loadConfig`: sin ellas, la API no arranca en vez de fallar en silencio al
 * primer envío — ver notifier.ts `createNotifier`).
 */
export type NotificationsConfig = VapidConfig &
  (
    | { provider: 'console' }
    | { provider: 'resend'; resendApiKey: string; notifierFromEmail: string }
    | { provider: 'twilio'; twilioAccountSid: string; twilioAuthToken: string; twilioWhatsappFrom: string; twilioSmsFrom: string }
    | {
        provider: 'resend+twilio';
        resendApiKey: string;
        notifierFromEmail: string;
        twilioAccountSid: string;
        twilioAuthToken: string;
        twilioWhatsappFrom: string;
        twilioSmsFrom: string;
      }
  );

export interface BookingConfig {
  /** Peticiones por minuto a la página pública de UN negocio (todas las IP juntas): frena el abuso dirigido a un solo negocio. */
  publicPerMinutePerBusiness: number;
  /** Secreto de Cloudflare Turnstile. Sin él la verificación anti-bots queda apagada (siguen el campo trampa y los límites). */
  turnstileSecret: string | null;
  /** Clave PÚBLICA de Turnstile (no es secreta): la página de reservas la necesita para dibujar el widget. Sin ella no se muestra ningún widget. */
  turnstileSiteKey: string | null;
  /** Clave de Google Maps Platform SOLO del servidor (Places, Geocoding, Static Maps): nunca sale en una respuesta. Sin ella el
   * selector de ubicación avisa que no está configurado y la página pública muestra solo dirección y botones, sin mapa. */
  googleServerKey: string | null;
  /** Clave de Google Maps JavaScript API para el mapa con pin arrastrable de la app web. SÍ viaja al navegador de quien
   * gestiona la página, así que debe restringirse por dominio (referrer) en Google Cloud; ver docs/GOOGLE_MAPS.md. */
  googleBrowserKey: string | null;
}

/** Monitoreo, métricas y protección contra sobrecarga (Fase 4). Ver docs/deploy.md. */
export interface ObservabilityConfig {
  /** Sentry: sin DSN no se carga nada (ni el SDK). */
  sentryDsn: string | null;
  sentryEnvironment: string;
  /** Versión desplegada (p. ej. el commit): agrupa los errores por despliegue en Sentry y sale en /api/health. */
  release: string | null;
  /** Token para GET /api/metrics (Prometheus). Sin él la ruta no existe (404). */
  metricsToken: string | null;
  /** Comprime (gzip) las respuestas JSON grandes. Apágala si un proxy/CDN delante ya comprime. */
  compression: boolean;
  /** Bajo sobrecarga se responde 503 + Retry-After en vez de degradar a todos: demora del event loop (ms) y heap (MB, 0 = sin tope). */
  maxEventLoopDelayMs: number;
  maxHeapUsedMb: number;
  /** Mayor que el keep-alive del balanceador (60 s en la mayoría) para que nunca cierre el servidor una conexión que el balanceador reutiliza. */
  keepAliveTimeoutMs: number;
}

/** Proveedores disponibles: `resend` (correo), `twilio` (sms + whatsapp, una sola cuenta cubre los dos canales de
 * teléfono de RECOVERY_CHANNELS) o ambos a la vez (`resend+twilio`). */
export const NOTIFIER_PROVIDERS = ['console', 'resend', 'twilio', 'resend+twilio'] as const;
export type NotifierProvider = (typeof NOTIFIER_PROVIDERS)[number];

export interface Config {
  port: number;
  host: string;
  production: boolean;
  dataDir: string;
  mediaDir: string;
  /** Dónde se guardan las imágenes: carpeta local (desarrollo) o almacén S3/R2 (producción, obligatorio). */
  media: { storage: 'local' } | { storage: 's3'; endpoint: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string };
  /** Subidas de imágenes por negocio en 24 h (frena el abuso del almacenamiento). */
  mediaUploadsPerDay: number;
  /** Segundos que se guardan las lecturas públicas (página de reservas, catálogo compartido); 0 la apaga. Ver publicCache.ts. */
  publicCacheTtlSeconds: number;
  database: DatabaseConfig;
  /** Tope del cierre ordenado (SIGTERM) antes de forzar la salida. */
  shutdownTimeoutMs: number;
  /**
   * Descargas PDF/Excel (Balance, Gastos): se generan en hilos de trabajo (worker_threads) para no bloquear el hilo principal
   * (medido: un Excel de 30 días lo bloqueaba ~1,2 s; ver docs/finance-capacity.md). `workers` 0 = en el hilo principal.
   */
  exports: { workers: number; queueMax: number; timeoutMs: number; workerMemoryMb: number };
  autoMigrate: boolean;
  jwtSecret: string;
  jwtIssuer: string;
  jwtAudience: string;
  accessTokenTtl: string;
  corsOrigins: string[];
  webDir: string | null;
  /** Carpeta de la página pública de reservas exportada por Vite (apps/public/dist). Sin ella, /reservar responde 404. */
  publicWebDir: string | null;
  exposeDevOtp: boolean;
  /** true = confía en X-Forwarded-For · número = saltos de proxy confiables. */
  trustProxy: boolean | number;
  rateLimit: RateLimitConfig;
  /** Redis compartido (límites de abuso entre instancias y caché pública). `null` = memoria del proceso (solo desarrollo). */
  redis: { url: string | null };
  security: SecurityConfig;
  subscriptions: SubscriptionsConfig;
  notifications: NotificationsConfig;
  platform: PlatformConfig;
  booking: BookingConfig;
  observability: ObservabilityConfig;
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
  DATABASE_DIRECT_URL: z.string().optional(),
  DB_POOL_MAX: int('DB_POOL_MAX', 10, 1, 200),
  DB_POOL_MIN: int('DB_POOL_MIN', 0, 0, 100),
  DB_IDLE_TIMEOUT_MS: int('DB_IDLE_TIMEOUT_MS', 30_000, 1_000, 3_600_000),
  DB_CONNECTION_TIMEOUT_MS: int('DB_CONNECTION_TIMEOUT_MS', 5_000, 500, 60_000),
  DB_STATEMENT_TIMEOUT_MS: int('DB_STATEMENT_TIMEOUT_MS', 15_000, 500, 300_000),
  DB_MAX_LIFETIME_SECONDS: int('DB_MAX_LIFETIME_SECONDS', 1_800, 0, 86_400),
  DB_SESSION_PARAMS: z.enum(['startup', 'none']).default('startup'),
  /** Tope para el cierre ordenado (SIGTERM): pasado este tiempo el proceso termina aunque algo siga colgado. */
  SHUTDOWN_TIMEOUT_MS: int('SHUTDOWN_TIMEOUT_MS', 25_000, 1_000, 300_000),
  SENTRY_DSN: z.string().url().optional(),
  SENTRY_ENVIRONMENT: z.string().max(40).optional(),
  RELEASE: z.string().max(80).optional(),
  METRICS_TOKEN: z.string().optional(),
  COMPRESSION: z.enum(['on', 'off']).default('on'),
  MAX_EVENT_LOOP_DELAY_MS: int('MAX_EVENT_LOOP_DELAY_MS', 1_000, 0, 60_000),
  MAX_HEAP_USED_MB: int('MAX_HEAP_USED_MB', 0, 0, 65_536),
  KEEP_ALIVE_TIMEOUT_MS: int('KEEP_ALIVE_TIMEOUT_MS', 72_000, 1_000, 600_000),
  HASH_CONCURRENCY: int('HASH_CONCURRENCY', 2, 1, 16),
  EXPORT_WORKERS: int('EXPORT_WORKERS', 2, 0, 16),
  EXPORT_QUEUE_MAX: int('EXPORT_QUEUE_MAX', 20, 0, 1_000),
  EXPORT_TIMEOUT_MS: int('EXPORT_TIMEOUT_MS', 60_000, 1_000, 600_000),
  EXPORT_WORKER_MEMORY_MB: int('EXPORT_WORKER_MEMORY_MB', 256, 64, 4_096),
  REDIS_URL: z.string().optional(),
  MEDIA_STORAGE: z.enum(['local', 's3']).optional(),
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().min(1).default('auto'),
  S3_BUCKET: z.string().min(1).optional(),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  MEDIA_UPLOADS_PER_DAY: int('MEDIA_UPLOADS_PER_DAY', 300, 1, 100_000),
  PUBLIC_CACHE_TTL_SECONDS: int('PUBLIC_CACHE_TTL_SECONDS', 300, 0, 3600),
  HASH_QUEUE_MAX: int('HASH_QUEUE_MAX', 200, 0, 10_000),
  AUTO_MIGRATE: z.enum(['true', 'false']).optional(),
  JWT_SECRET: z.string().optional(),
  JWT_ISSUER: z.string().min(1).default('xiro-style-api'),
  JWT_AUDIENCE: z.string().min(1).default('xiro-style-app'),
  JWT_ACCESS_TTL: z.string().regex(/^\d+[smh]$/, 'JWT_ACCESS_TTL debe ser como 15m, 30s o 1h').default('15m'),
  CORS_ORIGINS: z.string().optional(),
  WEB_DIR: z.string().optional(),
  PUBLIC_WEB_DIR: z.string().optional(),
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
  BOOKING_PUBLIC_PER_MIN_BUSINESS: int('BOOKING_PUBLIC_PER_MIN_BUSINESS', 240, 1, 100_000),
  TURNSTILE_SECRET: z.string().optional(),
  TURNSTILE_SITE_KEY: z.string().optional(),
  GOOGLE_MAPS_SERVER_KEY: z.string().optional(),
  GOOGLE_MAPS_BROWSER_KEY: z.string().optional(),
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
  NOTIFIER_PROVIDER: z.enum(NOTIFIER_PROVIDERS).default('console'),
  RESEND_API_KEY: z.string().optional(),
  NOTIFIER_FROM_EMAIL: z.string().email().default('no-reply@xirostyle.com'),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_WHATSAPP_FROM: z.string().optional(),
  TWILIO_SMS_FROM: z.string().optional(),
  /** IPs (separadas por coma) desde las que se aceptan las rutas /api/admin; vacío = cualquiera (con secreto y límite estricto). */
  ADMIN_ALLOWED_IPS: z.string().optional(),
  PLATFORM_ADMIN_KEY: z.string().optional(),
  PLATFORM_ADMIN_ALLOWED_IPS: z.string().optional(),
  PLATFORM_SESSION_HOURS: int('PLATFORM_SESSION_HOURS', 8, 1, 24),
  PLATFORM_IDLE_MINUTES: int('PLATFORM_IDLE_MINUTES', 30, 5, 240),
  PLATFORM_STEP_UP_MINUTES: int('PLATFORM_STEP_UP_MINUTES', 5, 1, 30),
  PLATFORM_DEV_SKIP_TOTP: z.enum(['true', 'false']).optional(),
  PLATFORM_DEV_TOTP_MOCK: z.enum(['true', 'false']).optional(),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().optional(),
});

type Env = z.infer<typeof envSchema>;

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

/**
 * Comprobaciones de "listo para atender usuarios" que se hacen al ARRANCAR el servidor (server.ts), separadas de
 * `loadConfig` (que valida los valores): hoy no existe proveedor real de mensajes, y aun así la configuración de
 * producción debe poder validarse y probarse. En producción, sin un proveedor real la API no arranca.
 */
export function assertStartupReady(config: Config): void {
  // Sin un proveedor real, los códigos de verificación (OTP) acabarían en los logs y nadie los recibiría.
  if (config.production && config.notifications.provider === 'console') {
    throw new Error('NOTIFIER_PROVIDER=console no puede usarse en producción: imprimiría códigos de verificación en los logs y los usuarios no los recibirían. Configura un proveedor real de correo/WhatsApp (ver docs).');
  }
}

/** Arma `NotificationsConfig` según `NOTIFIER_PROVIDER`, exigiendo (fail-closed) las credenciales que ese proveedor
 * necesita: sin ellas, `loadConfig` lanza aquí mismo en vez de que `notifier.ts` falle en silencio al primer envío. */
function buildNotificationsConfig(e: Env): NotificationsConfig {
  const vapid: VapidConfig = { vapidPublicKey: e.VAPID_PUBLIC_KEY ?? null, vapidPrivateKey: e.VAPID_PRIVATE_KEY ?? null, vapidSubject: e.VAPID_SUBJECT ?? null };
  const resend = () => {
    if (!e.RESEND_API_KEY) throw new Error('NOTIFIER_PROVIDER incluye Resend pero falta RESEND_API_KEY.');
    return { resendApiKey: e.RESEND_API_KEY, notifierFromEmail: e.NOTIFIER_FROM_EMAIL };
  };
  const twilio = () => {
    const missing = (['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_WHATSAPP_FROM', 'TWILIO_SMS_FROM'] as const).filter((key) => !e[key]);
    if (missing.length > 0) throw new Error(`NOTIFIER_PROVIDER incluye Twilio pero faltan: ${missing.join(', ')}.`);
    return { twilioAccountSid: e.TWILIO_ACCOUNT_SID!, twilioAuthToken: e.TWILIO_AUTH_TOKEN!, twilioWhatsappFrom: e.TWILIO_WHATSAPP_FROM!, twilioSmsFrom: e.TWILIO_SMS_FROM! };
  };
  switch (e.NOTIFIER_PROVIDER) {
    case 'console':
      return { provider: 'console', ...vapid };
    case 'resend':
      return { provider: 'resend', ...resend(), ...vapid };
    case 'twilio':
      return { provider: 'twilio', ...twilio(), ...vapid };
    case 'resend+twilio':
      return { provider: 'resend+twilio', ...resend(), ...twilio(), ...vapid };
  }
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
  if (production && e.PLATFORM_DEV_SKIP_TOTP === 'true') throw new Error('PLATFORM_DEV_SKIP_TOTP no puede activarse en producción.');
  if (production && e.PLATFORM_DEV_TOTP_MOCK === 'true') throw new Error('PLATFORM_DEV_TOTP_MOCK no puede activarse en producción.');
  if (production && e.RATE_LIMIT === 'off') throw new Error('RATE_LIMIT=off no puede usarse en producción.');
  if (production && !e.DATABASE_URL) throw new Error('DATABASE_URL es obligatoria en producción (postgres://usuario:clave@host:5432/base).');

  const url = e.DATABASE_URL ?? DEV_DATABASE_URL;
  if (!/^postgres(ql)?:\/\//.test(url)) throw new Error('DATABASE_URL debe empezar por postgres:// o postgresql://');
  if (e.DATABASE_DIRECT_URL !== undefined && !/^postgres(ql)?:\/\//.test(e.DATABASE_DIRECT_URL)) throw new Error('DATABASE_DIRECT_URL debe empezar por postgres:// o postgresql://');
  // Imágenes: en producción deben vivir fuera del disco del servidor (se pierden al reemplazarlo y no las ven otras instancias).
  const mediaStorage = e.MEDIA_STORAGE ?? (production ? 's3' : 'local');
  if (production && mediaStorage !== 's3') throw new Error('En producción las imágenes deben ir a un almacén S3/R2 (MEDIA_STORAGE=s3): el disco del servidor no se comparte entre instancias ni sobrevive a reemplazarlo.');
  if (mediaStorage === 's3' && !(e.S3_ENDPOINT && e.S3_BUCKET && e.S3_ACCESS_KEY_ID && e.S3_SECRET_ACCESS_KEY)) {
    throw new Error('MEDIA_STORAGE=s3 requiere S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID y S3_SECRET_ACCESS_KEY (en Cloudflare R2: https://<account-id>.r2.cloudflarestorage.com).');
  }
  if (e.PLATFORM_ADMIN_KEY !== undefined && e.PLATFORM_ADMIN_KEY.length < 32) throw new Error('PLATFORM_ADMIN_KEY debe tener al menos 32 caracteres (genera una con: openssl rand -base64 48).');
  // Un secreto de administración débil o de ejemplo es peor que no tenerlo: la API no arranca con él (en ningún entorno).
  if (e.ADMIN_SECRET !== undefined) {
    if (e.ADMIN_SECRET.length < 32) throw new Error('ADMIN_SECRET debe tener al menos 32 caracteres (genera uno con: openssl rand -base64 48).');
    if (/^(changeme|change-me|secret|admin|password|xxx+|test)/i.test(e.ADMIN_SECRET)) throw new Error('ADMIN_SECRET parece un valor de ejemplo: genera uno aleatorio (openssl rand -base64 48).');
  }
  if (e.REDIS_URL && !/^rediss?:\/\//.test(e.REDIS_URL)) throw new Error('REDIS_URL debe empezar por redis:// o rediss:// (TLS).');
  // Con varias instancias, límites en memoria = cada una cuenta por separado (el atacante multiplica su cuota) y se
  // reinician con cada despliegue. En producción Redis es obligatorio.
  if (production && !e.REDIS_URL && e.RATE_LIMIT !== 'off') throw new Error('REDIS_URL es obligatoria en producción: los límites de abuso deben compartirse entre instancias.');
  if (e.DB_SESSION_PARAMS === 'none' && production && !e.DATABASE_DIRECT_URL) {
    throw new Error('Con DB_SESSION_PARAMS=none (PgBouncer/pooler) define DATABASE_DIRECT_URL: LISTEN, pg-boss y las migraciones necesitan una conexión directa.');
  }
  if (e.DB_POOL_MIN > e.DB_POOL_MAX) throw new Error('DB_POOL_MIN no puede ser mayor que DB_POOL_MAX.');
  if (e.METRICS_TOKEN !== undefined && e.METRICS_TOKEN.length < 32) throw new Error('METRICS_TOKEN debe tener al menos 32 caracteres (genera uno con: openssl rand -base64 32).');

  return {
    port: e.PORT,
    host: e.HOST,
    production,
    dataDir,
    mediaDir: path.join(dataDir, 'media'),
    media:
      mediaStorage === 's3'
        ? { storage: 's3', endpoint: e.S3_ENDPOINT!, region: e.S3_REGION, bucket: e.S3_BUCKET!, accessKeyId: e.S3_ACCESS_KEY_ID!, secretAccessKey: e.S3_SECRET_ACCESS_KEY! }
        : { storage: 'local' },
    mediaUploadsPerDay: e.MEDIA_UPLOADS_PER_DAY,
    publicCacheTtlSeconds: e.PUBLIC_CACHE_TTL_SECONDS,
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
      sessionParams: e.DB_SESSION_PARAMS,
      directUrl: e.DATABASE_DIRECT_URL,
    },
    shutdownTimeoutMs: e.SHUTDOWN_TIMEOUT_MS,
    exports: { workers: e.EXPORT_WORKERS, queueMax: e.EXPORT_QUEUE_MAX, timeoutMs: e.EXPORT_TIMEOUT_MS, workerMemoryMb: e.EXPORT_WORKER_MEMORY_MB },
    observability: {
      sentryDsn: e.SENTRY_DSN ?? null,
      sentryEnvironment: e.SENTRY_ENVIRONMENT ?? (production ? 'production' : (env.NODE_ENV ?? 'development')),
      release: e.RELEASE ?? null,
      metricsToken: e.METRICS_TOKEN ?? null,
      compression: e.COMPRESSION === 'on',
      maxEventLoopDelayMs: e.MAX_EVENT_LOOP_DELAY_MS,
      maxHeapUsedMb: e.MAX_HEAP_USED_MB,
      keepAliveTimeoutMs: e.KEEP_ALIVE_TIMEOUT_MS,
    },
    redis: { url: e.REDIS_URL ?? null },
    autoMigrate: e.AUTO_MIGRATE ? e.AUTO_MIGRATE === 'true' : !production,
    jwtSecret,
    jwtIssuer: e.JWT_ISSUER,
    jwtAudience: e.JWT_AUDIENCE,
    accessTokenTtl: e.JWT_ACCESS_TTL,
    corsOrigins: validateOrigins(csv(e.CORS_ORIGINS), production),
    webDir: e.WEB_DIR ? path.resolve(e.WEB_DIR) : path.resolve('../mobile/dist'),
    publicWebDir: e.PUBLIC_WEB_DIR ? path.resolve(e.PUBLIC_WEB_DIR) : path.resolve('../public/dist'),
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
      hashConcurrency: e.HASH_CONCURRENCY,
      hashQueueMax: e.HASH_QUEUE_MAX,
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
      adminAllowedIps: csv(e.ADMIN_ALLOWED_IPS),
    },
    platform: {
      adminKey: e.PLATFORM_ADMIN_KEY || null,
      allowedIps: csv(e.PLATFORM_ADMIN_ALLOWED_IPS),
      sessionHours: e.PLATFORM_SESSION_HOURS,
      idleMinutes: e.PLATFORM_IDLE_MINUTES,
      stepUpMinutes: e.PLATFORM_STEP_UP_MINUTES,
      devSkipTotp: e.PLATFORM_DEV_SKIP_TOTP === 'true',
      devMasterTotp: e.PLATFORM_DEV_TOTP_MOCK === 'true',
    },
    booking: {
      publicPerMinutePerBusiness: e.BOOKING_PUBLIC_PER_MIN_BUSINESS,
      turnstileSecret: e.TURNSTILE_SECRET ?? null,
      turnstileSiteKey: e.TURNSTILE_SITE_KEY ?? null,
      googleServerKey: e.GOOGLE_MAPS_SERVER_KEY || null,
      googleBrowserKey: e.GOOGLE_MAPS_BROWSER_KEY || null,
    },
    notifications: buildNotificationsConfig(e),
  };
}
