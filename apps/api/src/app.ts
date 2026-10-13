import { mkdirSync } from 'node:fs';
import { normalizePermissions, type Actor } from '@xiro/shared';
import compress from '@fastify/compress';
import cors from '@fastify/cors';
import underPressure, { type FastifyUnderPressureOptions } from '@fastify/under-pressure';
import { randomUUID } from 'node:crypto';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { eq, sql } from 'drizzle-orm';
import Fastify, { LogController, type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
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
import { createNotifier, type Notifier } from './notifier';
import { loggerOptions } from './logging';
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
import { discountRoutes } from './routes/discounts';
import { waitlistRoutes } from './routes/waitlist';
import { orderRoutes } from './routes/orders';
import { salesRoutes } from './routes/sales';
import { serviceRecordRoutes } from './routes/serviceRecords';
import type { RealtimeBus } from './realtime';
import { adminSubscriptionRoutes, subscriptionRoutes } from './routes/subscriptions';
import { webRoutes } from './routes/web';
import { webhookRoutes } from './routes/webhooks';
import { configurePasswordHashing } from './passwords';
import type { Redis } from 'ioredis';
import { FallbackRateStore, MemoryRateStore, RateLimits, RedisRateStore } from './rateStore';
import { Metrics } from './metrics';
import { MemoryCacheBackend, PublicCache, RedisCacheBackend } from './publicCache';
import { redisHealthy } from './redis';
import { safeEqualSecret } from './security';
import { LocalMediaStore, S3MediaStore, type MediaStore } from './storage';

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
  /** Redis ya conectado por `server.ts` (el llamador lo cierra). Sin él: límites en memoria del proceso. */
  redis?: Redis | null;
  /** Almacén de imágenes ya creado (pruebas). Sin él se crea según la configuración. */
  media?: MediaStore;
  /** Solo pruebas: activa el logger escribiendo en este flujo (para comprobar que no se registran secretos). */
  logStream?: NodeJS.WritableStream;
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
/** Id de petición recibido de un proxy/balanceador (X-Request-Id): solo si tiene una forma razonable; si no, uno nuevo. */
const REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;

export async function buildApp(options: BuildOptions): Promise<FastifyInstance> {
  const config = mergeConfig(loadConfig(), options.config);
  mkdirSync(config.mediaDir, { recursive: true });
  const { db } = options;

  const app = Fastify({
    logger: options.logger || options.logStream ? { ...loggerOptions(process.env.LOG_LEVEL ?? 'info'), ...(options.logStream ? { stream: options.logStream } : {}) } : false,
    // Un número = saltos de proxy confiables (p. ej. 1 detrás de un solo balanceador): evita que un cliente falsifique su IP.
    trustProxy: typeof config.trustProxy === 'number' ? (_address: string, hop: number) => hop <= (config.trustProxy as number) : config.trustProxy,
    bodyLimit: 1024 * 1024,
    routerOptions: { maxParamLength: 100 },
    // Protección básica contra conexiones lentas (slowloris).
    requestTimeout: 30_000,
    connectionTimeout: 60_000,
    // Mayor que el keep-alive del balanceador: si el servidor cerrara primero, el balanceador reusaría una conexión muerta (502).
    keepAliveTimeout: config.observability.keepAliveTimeoutMs,
    // Cada petición lleva un id: sale en cada línea de log, en la cabecera X-Request-Id y en los errores de Sentry. Se respeta
    // el del proxy (para seguir una petición de punta a punta) solo si es válido: nunca texto arbitrario en los logs.
    requestIdHeader: false,
    logController: new LogController({ requestIdLogLabel: 'requestId' }),
    genReqId: (request) => {
      const incoming = request.headers['x-request-id'];
      return typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : randomUUID();
    },
  });
  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Request-Id', request.id);
  });
  // Límites compartidos: Redis (con respaldo en memoria si se cae) o, sin Redis, memoria del proceso.
  const rateStore = options.redis
    ? new FallbackRateStore(new RedisRateStore(options.redis), new MemoryRateStore(), (error) => app.log.error({ err: error }, 'Redis no responde: límites de abuso en memoria del proceso hasta que vuelva'))
    : new MemoryRateStore();
  const rates = new RateLimits(rateStore);
  // Caché pública: Redis compartido o, sin Redis, memoria de este proceso (una sola instancia).
  const publicCache = new PublicCache(
    config.publicCacheTtlSeconds > 0 ? (options.redis ? new RedisCacheBackend(options.redis) : new MemoryCacheBackend()) : null,
    config.publicCacheTtlSeconds,
    (error) => app.log.warn({ err: error }, 'Caché pública no disponible: se responde sin caché'),
  );
  const ctx: Ctx = {
    db,
    config,
    notifier: options.notifier ?? createNotifier(config, (line) => app.log.info(line)),
    accountLimiter: rates.limiter('account', config.rateLimit.accountWindowMinutes * 60_000),
    bookingLimiter: rates.limiter('booking-business', 60_000),
    rates,
    redis: options.redis ?? null,
    publicCache,
    media: options.media ?? (config.media.storage === 's3' ? new S3MediaStore(config.media) : new LocalMediaStore(config.mediaDir)),
    boss: options.boss ?? null,
    realtime: options.realtime ?? null,
    maps: options.maps !== undefined ? options.maps : config.booking.googleServerKey ? new GoogleMapsClient(config.booking.googleServerKey) : null,
  };

  configurePasswordHashing({ concurrency: config.security.hashConcurrency, maxQueue: config.security.hashQueueMax });

  /* ---------- Métricas, sobrecarga y compresión (Fase 4) ---------- */
  const metrics = new Metrics((db as unknown as { $client?: import('pg').Pool }).$client ?? null);
  app.addHook('onResponse', async (request, reply) => {
    metrics.observe(request.method, request.routeOptions.url ?? 'sin_ruta', reply.statusCode, reply.elapsedTime / 1000);
  });
  app.addHook('onClose', async () => metrics.close());
  const isHealthCheck = (url: string | undefined) => url?.startsWith('/api/health') ?? false;
  // Bajo sobrecarga (event loop atascado o memoria al tope) se responde 503 + Retry-After en vez de hacer esperar a todos.
  // Las rutas de salud siguen respondiendo: el orquestador decide con /api/health/ready, no por un 503 de sobrecarga.
  await app.register(underPressure, {
    maxEventLoopDelay: config.observability.maxEventLoopDelayMs,
    maxHeapUsedBytes: config.observability.maxHeapUsedMb * 1024 * 1024,
    retryAfter: 5,
    // El plugin (index.js, handlePressure): devolver null/undefined deja seguir la petición; devolver un objeto lo envía
    // como respuesta. Sus tipos dicen `void`, de ahí la conversión.
    pressureHandler: ((request: FastifyRequest, reply: FastifyReply) => {
      if (isHealthCheck(request.url)) return undefined;
      reply.status(503).header('Retry-After', '5');
      return { code: 'server_busy', message: 'Server busy' };
    }) as unknown as NonNullable<FastifyUnderPressureOptions['pressureHandler']>,
  });
  if (config.observability.compression) {
    // Solo JSON/HTML/JS grandes (las imágenes ya vienen comprimidas). gzip: buen ahorro con poco CPU.
    await app.register(compress, { global: true, threshold: 1024, encodings: ['gzip'] });
  }
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
      // Solo /api/auth lleva credenciales (la cookie HttpOnly del refresh token del panel web, ver routes/auth.ts) y
      // solo para los orígenes de la lista blanca; el resto de la API sigue con Bearer y sin credenciales.
      const isAuth = request.url?.startsWith('/api/auth/') ?? false;
      callback(null, {
        origin: isPublic ? '*' : config.corsOrigins.length > 0 ? config.corsOrigins : false,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
        allowedHeaders: ['Content-Type', 'Authorization', ...(isAuth ? ['X-Xiro-Session', 'X-Xiro-Remember'] : [])],
        credentials: isAuth && config.corsOrigins.length > 0,
        maxAge: 600,
      });
    },
  });

  /* ---------- Límite de peticiones por IP ---------- */
  if (config.rateLimit.enabled) {
    // global: false + hook en la raíz: el límite por IP se evalúa ANTES que cualquier hook de ámbito (p. ej. la autenticación),
    // así las peticiones con token inválido o sin token también consumen cuota. Las rutas de /api/auth añaden su propio tope, más estricto.
    // Con Redis, el plugin también guarda sus contadores ahí (todas las instancias comparten la cuota por IP y por ruta).
    // skipOnError: si Redis falla, el plugin deja pasar y los límites propios (FallbackRateStore) siguen protegiendo.
    await app.register(rateLimit, { global: false, ...(options.redis ? { redis: options.redis, nameSpace: 'xiro:frl:', skipOnError: true } : {}) });
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

  // Liveness: el proceso está vivo y atiende (no toca dependencias: si la base cae, reiniciar la API no la arregla).
  app.get('/api/health', async () => ({ status: 'ok' }));
  // Readiness: ¿puede atender tráfico? Base de datos y, si está configurado, Redis. 503 = el balanceador deja de enviarle
  // peticiones hasta que se recupere. Respuesta mínima: no describe la infraestructura a quien no la necesita.
  app.get('/api/health/ready', async (_request, reply) => {
    const database = await db
      .execute(sql`select 1`)
      .then(() => 'up' as const)
      .catch(() => 'down' as const);
    const redis = options.redis ? ((await redisHealthy(options.redis)) ? ('up' as const) : ('down' as const)) : ('not_configured' as const);
    const ready = database === 'up' && redis !== 'down';
    return reply.status(ready ? 200 : 503).send({ status: ready ? 'ok' : 'unavailable', database, redis });
  });
  // Métricas Prometheus: solo con METRICS_TOKEN configurado y presentado (Authorization: Bearer …); si no, 404.
  app.get('/api/metrics', async (request, reply) => {
    const token = config.observability.metricsToken;
    const presented = request.headers.authorization?.replace(/^Bearer\s+/i, '') ?? '';
    if (!token || !safeEqualSecret(presented, token)) return reply.status(404).send({ code: 'not_found', message: 'Not found' });
    return reply.header('Cache-Control', 'no-store').type('text/plain; version=0.0.4; charset=utf-8').send(metrics.render());
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

  const userLimiter = rates.limiter('user', 60_000);
  const uploadLimiter = rates.limiter('media-uploads', 24 * 60 * 60_000);
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
        const used = await userLimiter.hit(key);
        reply.header('X-RateLimit-Limit', String(config.rateLimit.userPerMinute));
        if (used > config.rateLimit.userPerMinute) {
          throw new AppError(429, 'too_many_requests', undefined, { 'Retry-After': String(await userLimiter.retryAfterSeconds(key)) });
        }
      });
      // Cuota diaria de subidas de imágenes por NEGOCIO (todas las personas del equipo juntas): frena el abuso del
      // almacenamiento aunque cada subida individual sea válida. Compartida entre instancias (Redis).
      scope.addHook('preHandler', async (request) => {
        if (!config.rateLimit.enabled || !request.isMultipart()) return;
        const key = request.user.bid;
        if ((await uploadLimiter.hit(key)) > config.mediaUploadsPerDay) {
          throw new AppError(429, 'too_many_requests', undefined, { 'Retry-After': String(await uploadLimiter.retryAfterSeconds(key)) });
        }
      });
      // Toda escritura exitosa de un negocio invalida su caché pública ANTES de responder: quien guarda un cambio y abre
      // su página pública ya lo ve. (Invalida de más a propósito: es una sola operación y nunca deja datos viejos.)
      scope.addHook('onSend', async (request, reply) => {
        if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && reply.statusCode < 400 && request.user?.bid) await publicCache.invalidate(request.user.bid);
      });
      scope.addHook('onSend', async (_request, reply) => void reply.header('Cache-Control', 'no-store'));
      accountRoutes(scope, ctx);
      catalogRoutes(scope, ctx);
      clientRoutes(scope, ctx);
      subscriptionRoutes(scope, ctx);
      salesRoutes(scope, ctx);
      orderRoutes(scope, ctx);
      discountRoutes(scope, ctx);
      waitlistRoutes(scope, ctx);
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
