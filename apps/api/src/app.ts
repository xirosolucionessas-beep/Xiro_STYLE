import { mkdirSync } from 'node:fs';
import { normalizePermissions, type Actor } from '@xiro/shared';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { eq, sql } from 'drizzle-orm';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import type { PgBoss } from 'pg-boss';
import { loadConfig, type Config } from './config';
import { assertPolicyCovers, authorize } from './authz';
import { recordAudit } from './audit';
import { GoogleMapsClient, type GoogleMaps } from './booking/google';
import type { Ctx } from './context';
import type { Database } from './db/client';
import { users } from './db/schema';
import { AppError, containsNul, installErrorHandler, isUuid } from './errors';
import { MAX_IMAGE_BYTES } from './media';
import { ConsoleNotifier, type Notifier } from './notifier';
import { accountRoutes } from './routes/account';
import { authRoutes } from './routes/auth';
import { bookingRoutes } from './routes/booking';
import { bookingConfigRoutes } from './routes/bookingConfig';
import { cashRoutes } from './routes/cash';
import { catalogRoutes } from './routes/catalog';
import { clientRoutes } from './routes/clients';
import { employeeRoutes } from './routes/employees';
import { loyaltyRoutes } from './routes/loyalty';
import { messagesRoutes } from './routes/messages';
import { notificationRoutes } from './routes/notifications';
import { placesRoutes } from './routes/places';
import { publicRoutes } from './routes/public';
import { clientAccountRoutes } from './routes/clientAccounts';
import { publicBookingRoutes } from './routes/publicBooking';
import { realtimeRoutes } from './routes/realtime';
import { salesRoutes } from './routes/sales';
import { serviceRecordRoutes } from './routes/serviceRecords';
import type { RealtimeBus } from './realtime';
import { adminSubscriptionRoutes, subscriptionRoutes } from './routes/subscriptions';
import { webRoutes } from './routes/web';
import { webhookRoutes } from './routes/webhooks';
import { WindowCounter } from './security';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; bid: string };
    user: { sub: string; bid: string; iat: number; exp?: number };
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Quién hace la petición, con rol y permisos leídos de la base de datos (solo en rutas autenticadas). */
    actor: Actor & { id: string };
  }
}

export interface BuildOptions {
  config?: Partial<Omit<Config, 'database' | 'rateLimit' | 'security' | 'booking'>> & {
    booking?: Partial<Config['booking']>;
    database?: Partial<Config['database']>;
    rateLimit?: Partial<Config['rateLimit']>;
    security?: Partial<Config['security']>;
  };
  /** Conexión a PostgreSQL ya creada (el llamador es dueño del pool y lo cierra). */
  db: Database;
  notifier?: Notifier;
  /** Cola de recordatorios de citas ya arrancada por `server.ts`. Sin ella (pruebas, o un arranque que no la usa),
   * programar o cancelar un recordatorio es un no-op silencioso — ver jobs/reminders.ts. */
  boss?: PgBoss | null;
  /** Bus de LISTEN/NOTIFY ya arrancado por `server.ts`, para el stream de la Agenda en tiempo real — ver realtime.ts. */
  realtime?: RealtimeBus | null;
  /** Sustituto de Google Maps (pruebas). Sin él se crea el cliente real si hay `GOOGLE_MAPS_SERVER_KEY`; si no, queda en null. */
  maps?: GoogleMaps | null;
  logger?: boolean;
}

export function mergeConfig(base: Config, overrides: BuildOptions['config'] = {}): Config {
  return {
    ...base,
    ...overrides,
    database: { ...base.database, ...overrides.database },
    rateLimit: { ...base.rateLimit, ...overrides.rateLimit },
    security: { ...base.security, ...overrides.security },
    booking: { ...base.booking, ...overrides.booking },
  } as Config;
}

/** Rutas que consultan la base de datos y por tanto se limitan por IP (los archivos estáticos no). */
const isLimitedPath = (url: string) => (url.startsWith('/api/') && !url.startsWith('/api/health')) || url.startsWith('/catalog/') || url.startsWith('/reservar/');
const SERVER_PATHS = /^\/(api|media|catalog-assets)(\/|$)|^\/catalog\/[^/?#]|^\/reservar(\/|$)/;

export async function buildApp(options: BuildOptions): Promise<FastifyInstance> {
  const config = mergeConfig(loadConfig(), options.config);
  mkdirSync(config.mediaDir, { recursive: true });
  const { db } = options;

  const app = Fastify({
    logger: options.logger ? { level: process.env.LOG_LEVEL ?? 'info', redact: ['req.headers.authorization', 'req.headers.cookie'] } : false,
    // Un número = saltos de proxy confiables (p. ej. 1 detrás de un solo balanceador): evita que un cliente falsifique su IP.
    trustProxy: typeof config.trustProxy === 'number' ? (_address: string, hop: number) => hop <= (config.trustProxy as number) : config.trustProxy,
    bodyLimit: 1024 * 1024,
    routerOptions: { maxParamLength: 100 },
    // Protección básica contra conexiones lentas (slowloris).
    requestTimeout: 30_000,
    connectionTimeout: 60_000,
  });
  const ctx: Ctx = {
    db,
    config,
    notifier: options.notifier ?? new ConsoleNotifier((line) => app.log.info(line)),
    accountLimiter: new WindowCounter(config.rateLimit.accountWindowMinutes * 60_000),
    bookingLimiter: new WindowCounter(60_000),
    boss: options.boss ?? null,
    realtime: options.realtime ?? null,
    maps: options.maps !== undefined ? options.maps : config.booking.googleServerKey ? new GoogleMapsClient(config.booking.googleServerKey) : null,
  };

  app.decorateRequest('actor', null as never);
  installErrorHandler(app);

  /* ---------- Cabeceras de seguridad ---------- */
  const { security } = config;
  // El mapa con pin arrastrable de la app web carga la API de JavaScript de Google. Esos orígenes se permiten SOLO si hay clave
  // de navegador configurada (sin ella la política queda exactamente como antes) y solo aquí: la página pública /reservar
  // tiene su propia política y no carga ningún script de Google (su mapa es una imagen servida por este mismo servidor).
  const google = config.booking.googleBrowserKey;
  await app.register(helmet, {
    contentSecurityPolicy: security.csp
      ? {
          useDefaults: false,
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", ...(google ? ['https://maps.googleapis.com', 'https://maps.gstatic.com'] : [])],
            // react-native-web y el sistema de diseño inyectan hojas de estilo en línea.
            styleSrc: ["'self'", "'unsafe-inline'", ...(google ? ['https://fonts.googleapis.com'] : [])],
            imgSrc: ["'self'", 'data:', 'blob:', ...(google ? ['https://maps.googleapis.com', 'https://maps.gstatic.com', 'https://*.googleusercontent.com'] : []), ...security.cspImg],
            fontSrc: ["'self'", 'data:', ...(google ? ['https://fonts.gstatic.com'] : [])],
            // blob: — la app web prepara las fotos en el navegador y las lee con fetch() antes de subirlas.
            connectSrc: ["'self'", 'blob:', ...(google ? ['https://maps.googleapis.com'] : []), ...security.cspConnect],
            workerSrc: ["'self'", 'blob:'],
            objectSrc: ["'none'"],
            baseUri: ["'none'"],
            formAction: ["'self'"],
            frameAncestors: ["'none'"],
            ...(config.production ? { upgradeInsecureRequests: [] } : {}),
          },
        }
      : false,
    hsts: security.hsts ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    frameguard: { action: 'deny' },
    // Las fotos y el catálogo público se muestran desde otros orígenes (la app en otro dominio, vistas previas).
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  });
  app.addHook('onSend', async (_request, reply) => {
    reply.header('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=(), payment=(), usb=()');
  });

  await app.register(cors, {
    delegator: (request, callback) => {
      const isPublic = request.url?.startsWith('/api/public/');
      callback(null, {
        origin: isPublic ? '*' : config.corsOrigins.length > 0 ? config.corsOrigins : false,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
        allowedHeaders: ['Content-Type', 'Authorization'],
        credentials: false,
        maxAge: 600,
      });
    },
  });

  /* ---------- Límite de peticiones por IP ---------- */
  if (config.rateLimit.enabled) {
    // global: false + hook en la raíz: el límite por IP se evalúa ANTES que cualquier hook de ámbito (p. ej. la autenticación),
    // así las peticiones con token inválido o sin token también consumen cuota. Las rutas de /api/auth añaden su propio tope, más estricto.
    await app.register(rateLimit, { global: false });
    // (createRateLimit y no rateLimit: este último marca la petición como ya evaluada y omitiría el tope propio de las rutas de /api/auth.)
    const checkIp = app.createRateLimit({
      max: config.rateLimit.globalPerMinute,
      timeWindow: '1 minute',
      keyGenerator: (request) => request.ip,
      allowList: (request) => !isLimitedPath(request.url),
    });
    app.addHook('onRequest', async (request) => {
      const result = await checkIp(request);
      if (result.isAllowed) return;
      if (result.isExceeded) throw new AppError(429, 'too_many_requests', undefined, { 'Retry-After': String(result.ttlInSeconds) });
    });
  }

  /* ---------- Sesiones: JWT con algoritmo, emisor y audiencia fijados ---------- */
  await app.register(jwt, {
    secret: config.jwtSecret,
    sign: { algorithm: 'HS256', iss: config.jwtIssuer, aud: config.jwtAudience, expiresIn: config.accessTokenTtl },
    // Se acepta ÚNICAMENTE HS256 (bloquea "alg: none" y la confusión de algoritmos) y solo tokens de este emisor/audiencia.
    verify: { algorithms: ['HS256'], allowedIss: config.jwtIssuer, allowedAud: config.jwtAudience },
  });
  await app.register(multipart, { limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 5 } });

  /* ---------- Sanitización en la frontera ---------- */
  app.addHook('preValidation', async (request) => {
    if (request.body && typeof request.body === 'object' && !request.isMultipart() && containsNul(request.body)) {
      throw new AppError(400, 'validation_error', 'Invalid characters');
    }
  });

  /**
   * Un token válido no basta: el usuario debe existir y el token no puede ser anterior a su último cambio de contraseña
   * (así restablecer la contraseña invalida también los access tokens ya emitidos).
   */
  const authenticate = async (request: FastifyRequest) => {
    try {
      await request.jwtVerify();
    } catch {
      throw new AppError(401, 'unauthorized');
    }
    const { sub, bid, iat, exp } = request.user;
    // La librería no exige `exp`: un token sin caducidad sería eterno, así que se exige aquí.
    if (!isUuid(sub) || !isUuid(bid) || typeof exp !== 'number' || typeof iat !== 'number') throw new AppError(401, 'unauthorized');
    const [row] = await db
      .select({ changedAt: users.passwordChangedAt, businessId: users.businessId, role: users.role, permissions: users.permissions, active: users.active })
      .from(users)
      .where(eq(users.id, sub))
      .limit(1);
    // Un empleado desactivado pierde el acceso al instante, aunque su token aún no haya vencido.
    if (!row || !row.active || row.businessId !== bid || iat * 1000 + 1000 <= row.changedAt.getTime()) throw new AppError(401, 'unauthorized');
    // Rol y permisos se leen de la base de datos en CADA petición (nunca del token): un cambio del dueño aplica de inmediato.
    request.actor = { id: sub, role: row.role === 'employee' ? 'employee' : 'owner', permissions: normalizePermissions(row.permissions) };
    authorize(request.actor, request.method, request.routeOptions.url ?? '');
  };

  app.get('/api/health', async () => ({ status: 'ok' }));
  // Para balanceadores y orquestadores: comprueba de verdad que la base de datos responde.
  app.get('/api/health/ready', async (_request, reply) => {
    try {
      await db.execute(sql`select 1`);
      return { status: 'ok', database: 'up' };
    } catch {
      return reply.status(503).send({ status: 'unavailable', database: 'down' });
    }
  });

  await app.register(
    async (scope) => {
      scope.addHook('onSend', async (_request, reply) => void reply.header('Cache-Control', 'no-store'));
      authRoutes(scope, ctx);
    },
    { prefix: '/api/auth' },
  );
  await app.register(async (scope) => publicRoutes(scope, ctx), { prefix: '/api/public' });
  await app.register(async (scope) => publicBookingRoutes(scope, ctx), { prefix: '/api/public/booking' });
  await app.register(async (scope) => clientAccountRoutes(scope, ctx), { prefix: '/api/public/booking' });
  // Sin `authenticate`: `EventSource` no puede mandar el header de sesión. La única llave es el ticket de un solo uso
  // que emite `POST /api/booking/events/ticket`, esa sí dentro del grupo autenticado de más abajo.
  await app.register(async (scope) => realtimeRoutes(scope, ctx), { prefix: '/api' });
  // Sin `authenticate`: los webhooks los llama el proveedor (RevenueCat/Stripe/PayPal), no un usuario con sesión.
  // Cada handler verifica la firma/secreto propio del proveedor en vez de depender del JWT de la app.
  await app.register(
    async (scope) => {
      scope.addHook('onSend', async (_request, reply) => void reply.header('Cache-Control', 'no-store'));
      webhookRoutes(scope, ctx);
    },
    { prefix: '/api/webhooks' },
  );
  // Sin `authenticate`: lo llama quien confirma pagos manuales (transferencia bancaria), no tiene por qué tener
  // cuenta de negocio. Se protege con ADMIN_SECRET dentro de la propia ruta (ver adminSubscriptionRoutes).
  await app.register(
    async (scope) => {
      scope.addHook('onSend', async (_request, reply) => void reply.header('Cache-Control', 'no-store'));
      adminSubscriptionRoutes(scope, ctx);
    },
    { prefix: '/api/admin' },
  );

  const userLimiter = new WindowCounter(60_000);
  await app.register(
    async (scope) => {
      // Fallo al arrancar (no en producción a las 3 a. m.) si alguien añade una ruta autenticada sin decidir quién la puede usar.
      scope.addHook('onRoute', (route) => {
        for (const method of [route.method].flat()) assertPolicyCovers(method, route.url);
      });
      scope.addHook('onRequest', authenticate);
      // Bitácora: toda escritura de un empleado y todo intento suyo denegado (403), con ruta e id — sin cuerpo ni datos personales.
      scope.addHook('onResponse', async (request, reply) => {
        const actor = request.actor;
        if (!actor || actor.role !== 'employee') return;
        const writes = !['GET', 'HEAD', 'OPTIONS'].includes(request.method) && reply.statusCode < 400;
        if (!writes && reply.statusCode !== 403) return;
        const params = request.params as { id?: string; clientId?: string } | undefined;
        await recordAudit(db, { businessId: request.user.bid, userId: actor.id, action: `${request.method} ${(request.routeOptions.url ?? '').replace(/^\/api/, '')}`, entityId: params?.id ?? params?.clientId ?? null, status: reply.statusCode }, (error) => request.log.error(error));
      });
      // Límite por usuario autenticado (además del límite por IP): un cliente abusivo no agota a los demás.
      scope.addHook('preHandler', async (request, reply) => {
        if (!config.rateLimit.enabled) return;
        const key = request.user.sub;
        const used = userLimiter.hit(key);
        reply.header('X-RateLimit-Limit', String(config.rateLimit.userPerMinute));
        if (used > config.rateLimit.userPerMinute) {
          throw new AppError(429, 'too_many_requests', undefined, { 'Retry-After': String(userLimiter.retryAfterSeconds(key)) });
        }
      });
      scope.addHook('onSend', async (_request, reply) => void reply.header('Cache-Control', 'no-store'));
      accountRoutes(scope, ctx);
      catalogRoutes(scope, ctx);
      clientRoutes(scope, ctx);
      subscriptionRoutes(scope, ctx);
      salesRoutes(scope, ctx);
      cashRoutes(scope, ctx);
      serviceRecordRoutes(scope, ctx);
      loyaltyRoutes(scope, ctx);
      notificationRoutes(scope, ctx);
      employeeRoutes(scope, ctx);
      bookingRoutes(scope, ctx);
      bookingConfigRoutes(scope, ctx);
      placesRoutes(scope, ctx);
      messagesRoutes(scope, ctx);
    },
    { prefix: '/api' },
  );

  const spaIndex = webRoutes(app, ctx);
  // Rutas del servidor (no del cliente): API, fotos, assets del catálogo y /catalog/<negocio>. El `/catalog` a secas es una pantalla de la app.
  app.setNotFoundHandler((request, reply) => {
    const isClientRoute = spaIndex !== null && request.method === 'GET' && !SERVER_PATHS.test(request.raw.url ?? '');
    if (isClientRoute) return reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-cache').send(spaIndex);
    return reply.status(404).send({ code: 'not_found', message: 'Not found' });
  });

  return app;
}
