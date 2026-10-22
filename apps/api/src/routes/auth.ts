import { randomUUID } from 'node:crypto';
import { and, desc, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import {
  loginSchema,
  recoverRequestSchema,
  recoverResetSchema,
  recoverVerifySchema,
  refreshSchema,
  registerSchema,
  type AuthSession,
  type Language,
} from '@xiro/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createBusinessWithOwner } from '../accounts';
import type { Ctx } from '../context';
import { parseCookies } from '../cookies';
import { businesses, otpCodes, refreshTokens, resetTokens, users } from '../db/schema';
import { AppError, parse } from '../errors';
import { notifyUser } from '../push';
import { toBusiness, toUser, type UserRow } from '../serializers';
import { DUMMY_HASH, hashPassword, hmac, needsRehash, randomToken, safeEqualHex, sixDigitCode, verifyPassword } from '../security';

const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const OTP_TTL_MS = 10 * 60 * 1000;
const RESET_TTL_MS = 15 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;
/** Ventana en la que reusar un refresh token recién rotado se considera una carrera legítima (p. ej. dos pestañas) y no un robo. */
const REUSE_GRACE_MS = 10_000;
/** Una IP puede fallar este múltiplo de los intentos por cuenta antes de bloquearse (redes compartidas: oficinas, NAT móvil). */
const IP_ATTEMPTS_FACTOR = 5;

/**
 * Sesión del PANEL WEB en cookie (Fase 3): el refresh token (30 días) ya no queda en localStorage, donde cualquier XSS
 * podía leerlo. El navegador lo pide con `X-Xiro-Session: cookie` y recibe una cookie HttpOnly (JavaScript no la ve),
 * SameSite=Strict y limitada a /api/auth; el JSON trae `refreshToken: ''`. La app móvil no manda esa cabecera y sigue
 * recibiendo el token en el cuerpo (lo guarda en Keychain/Keystore). Leer la cookie EXIGE la cabecera: un sitio ajeno no
 * puede ponerla sin pasar por CORS (lista blanca), así que no sirve para CSRF.
 */
export const REFRESH_COOKIE = 'xrt';
const REFRESH_COOKIE_PATH = '/api/auth';
export const SESSION_MODE_HEADER = 'x-xiro-session';
/** `0` = "Recordarme" desmarcado: cookie de sesión del navegador (sin Max-Age), se borra al cerrarlo. */
export const REMEMBER_HEADER = 'x-xiro-remember';

export function authRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db, config } = ctx;
  const limit = (max: number) => ({ config: { rateLimit: { max, timeWindow: '1 minute' } } });
  const authLimit = limit(config.rateLimit.authPerMinute);
  const tokenHash = (token: string) => hmac(config.jwtSecret, `token:${token}`);

  const attempts = config.rateLimit.accountAttempts;
  // Bloqueo temporal por CUENTA (aunque cambie la IP) y por IP (una IP probando muchas cuentas distintas).
  const ipLimiter = ctx.rates.limiter('login-ip', config.rateLimit.accountWindowMinutes * 60_000);
  const ipAttempts = attempts * IP_ATTEMPTS_FACTOR;
  /**
   * El intento por CUENTA se reserva (incremento atómico) ANTES de evaluar la contraseña o el código, y un acierto lo
   * devuelve con `reset`. Antes se contaba y se sumaba después de argon2 (~50 ms): N intentos simultáneos desde IP
   * distintas pasaban todos el control y se evaluaban ~2× el máximo (Fase 5, loadtest/security.ts). El límite por IP sigue
   * sumando solo fallos: una recepción donde varias personas inician sesión bien desde la misma IP no se bloquea.
   */
  const guardAccount = async (key: string, ip?: string) => {
    if (!config.rateLimit.enabled) return;
    if (ip && (await ipLimiter.count(ip)) >= ipAttempts) {
      throw new AppError(429, 'too_many_requests', undefined, { 'Retry-After': String(await ipLimiter.retryAfterSeconds(ip)) });
    }
    if ((await ctx.accountLimiter.hit(key)) > attempts) {
      throw new AppError(429, 'too_many_requests', undefined, { 'Retry-After': String(await ctx.accountLimiter.retryAfterSeconds(key)) });
    }
  };
  /** Fallo: el intento de la cuenta ya quedó contado en guardAccount; se suma el de la IP. */
  const failAccount = async (_key: string, ip?: string) => {
    if (!config.rateLimit.enabled) return;
    if (ip) await ipLimiter.hit(ip);
  };

  /** Acceso decidido por la plataforma (suspensión o baja lógica desde el panel del fundador). */
  async function businessIsActive(businessId: string): Promise<boolean> {
    const [row] = await db.select({ status: businesses.accessStatus }).from(businesses).where(eq(businesses.id, businessId)).limit(1);
    return row?.status === 'active';
  }

  async function findUser(identifier: { kind: 'email' | 'phone'; value: string }): Promise<UserRow | undefined> {
    const [row] = await db.select().from(users).where(eq(identifier.kind === 'email' ? users.email : users.phone, identifier.value)).limit(1);
    return row;
  }

  const wantsCookie = (request: FastifyRequest) => request.headers[SESSION_MODE_HEADER] === 'cookie';
  const refreshCookie = (value: string, maxAgeSeconds: number | null) =>
    [`${REFRESH_COOKIE}=${encodeURIComponent(value)}`, `Path=${REFRESH_COOKIE_PATH}`, 'HttpOnly', 'SameSite=Strict', ...(maxAgeSeconds === null ? [] : [`Max-Age=${maxAgeSeconds}`]), ...(config.production ? ['Secure'] : [])].join('; ');
  const expiredRefreshCookie = () => refreshCookie('', 0);

  /** Entrega la sesión: en el cuerpo (app móvil) o, si el navegador lo pide, con el refresh token en cookie HttpOnly. */
  function deliver(request: FastifyRequest, reply: FastifyReply, session: AuthSession): AuthSession {
    if (!wantsCookie(request)) return session;
    const remember = request.headers[REMEMBER_HEADER] !== '0';
    reply.header('Set-Cookie', refreshCookie(session.refreshToken, remember ? REFRESH_TTL_MS / 1000 : null));
    return { ...session, refreshToken: '' };
  }

  /** El refresh token presentado: en el cuerpo (app móvil, y la web la primera vez al migrar) o en la cookie (web). */
  function presentedRefreshToken(request: FastifyRequest): string {
    const { refreshToken } = parse(refreshSchema.partial(), request.body ?? {});
    if (refreshToken) return refreshToken;
    const fromCookie = wantsCookie(request) ? parseCookies(request.headers.cookie)[REFRESH_COOKIE] : undefined;
    if (fromCookie && refreshSchema.safeParse({ refreshToken: fromCookie }).success) return fromCookie;
    throw new AppError(401, 'unauthorized', undefined, wantsCookie(request) ? { 'Set-Cookie': expiredRefreshCookie() } : undefined);
  }

  async function issueSession(user: UserRow, familyId: string = randomUUID()): Promise<AuthSession> {
    const [business] = await db.select().from(businesses).where(eq(businesses.id, user.businessId)).limit(1);
    if (!business) throw new AppError(500, 'internal_error');
    const refreshToken = randomToken(32);
    await db.insert(refreshTokens).values({ tokenHash: tokenHash(refreshToken), userId: user.id, familyId, expiresAt: new Date(Date.now() + REFRESH_TTL_MS) });
    return {
      accessToken: app.jwt.sign({ sub: user.id, bid: user.businessId }),
      refreshToken,
      user: toUser(user),
      business: toBusiness(business),
    };
  }

  app.post('/register', authLimit, async (request, reply) => {
    const input = parse(registerSchema, request.body);
    const passwordHash = await hashPassword(input.password);
    const { owner } = await createBusinessWithOwner(db, {
      businessName: input.businessName,
      businessType: input.businessType,
      ownerName: input.name,
      email: input.email ?? null,
      phone: input.phone ?? null,
      passwordHash,
      language: input.language,
    });
    return reply.status(201).send(deliver(request, reply, await issueSession(owner)));
  });

  app.post('/login', authLimit, async (request, reply) => {
    const input = parse(loginSchema, request.body);
    const key = `login:${input.identifier.kind}:${input.identifier.value}`;
    await guardAccount(key, request.ip);

    const user = await findUser(input.identifier);
    const valid = await verifyPassword(input.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !valid) {
      await failAccount(key, request.ip);
      throw new AppError(401, 'invalid_credentials');
    }
    await ctx.accountLimiter.reset(key);
    // Hash anterior (scrypt) o parámetros viejos: se re-hashea a argon2id con la contraseña que acaba de validarse.
    // Solo cambia el hash (NO passwordChangedAt): las sesiones abiertas de la persona siguen válidas.
    if (needsRehash(user.passwordHash)) await db.update(users).set({ passwordHash: await hashPassword(input.password) }).where(eq(users.id, user.id));
    // Se revela solo con la contraseña correcta: así no sirve para averiguar qué cuentas existen.
    if (!user.active) throw new AppError(403, 'account_disabled');
    if (!(await businessIsActive(user.businessId))) throw new AppError(403, 'business_suspended');
    return deliver(request, reply, await issueSession(user));
  });

  /**
   * Rotación de un solo uso y ATÓMICA: el UPDATE ... RETURNING deja pasar a una única petición aunque lleguen 50 a la vez.
   * Un token ya usado que reaparece pasada la ventana de gracia indica robo: se revoca toda la familia de sesiones.
   */
  app.post('/refresh', limit(30), async (request, reply) => {
    const refreshToken = presentedRefreshToken(request);
    const hash = tokenHash(refreshToken);
    // Si la cookie no sirve (vencida, revocada), se borra del navegador junto con el 401.
    const unauthorized = () => new AppError(401, 'unauthorized', undefined, wantsCookie(request) ? { 'Set-Cookie': expiredRefreshCookie() } : undefined);
    const now = new Date();

    const [consumed] = await db
      .update(refreshTokens)
      .set({ usedAt: now })
      .where(and(eq(refreshTokens.tokenHash, hash), isNull(refreshTokens.usedAt), gt(refreshTokens.expiresAt, now)))
      .returning();

    if (!consumed) {
      const [seen] = await db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, hash)).limit(1);
      if (seen?.usedAt && now.getTime() - seen.usedAt.getTime() > REUSE_GRACE_MS) {
        await db.delete(refreshTokens).where(eq(refreshTokens.familyId, seen.familyId));
      }
      throw unauthorized();
    }

    const [user] = await db.select().from(users).where(eq(users.id, consumed.userId)).limit(1);
    if (!user || !user.active || !(await businessIsActive(user.businessId))) throw unauthorized();
    return deliver(request, reply, await issueSession(user, consumed.familyId));
  });

  app.post('/logout', async (request, reply) => {
    if (wantsCookie(request)) reply.header('Set-Cookie', expiredRefreshCookie());
    let refreshToken: string;
    try {
      refreshToken = presentedRefreshToken(request);
    } catch {
      return reply.status(204).send(); // sin sesión que cerrar: cerrar sesión siempre "funciona"
    }
    const [row] = await db.select({ familyId: refreshTokens.familyId }).from(refreshTokens).where(eq(refreshTokens.tokenHash, tokenHash(refreshToken))).limit(1);
    if (row) await db.delete(refreshTokens).where(eq(refreshTokens.familyId, row.familyId));
    return reply.status(204).send();
  });

  /* Recuperación de acceso: la respuesta es idéntica exista o no la cuenta (sin enumeración de usuarios). */
  app.post('/recover/request', limit(5), async (request, reply) => {
    const input = parse(recoverRequestSchema, request.body);
    // Se cuenta cada solicitud por identificador (exista o no) para no permitir spam de SMS/correo.
    if (config.rateLimit.enabled) {
      const key = `otp-request:${input.identifier.value}`;
      if ((await ctx.accountLimiter.hit(key)) > attempts) {
        throw new AppError(429, 'too_many_requests', undefined, { 'Retry-After': String(await ctx.accountLimiter.retryAfterSeconds(key)) });
      }
    }

    const user = await findUser(input.identifier);
    let devCode: string | undefined;

    if (user) {
      const to = input.channel === 'email' ? user.email : user.phone;
      if (to) {
        const code = sixDigitCode();
        await db.transaction(async (tx) => {
          await tx.delete(otpCodes).where(eq(otpCodes.userId, user.id));
          await tx.insert(otpCodes).values({ userId: user.id, codeHash: hmac(config.jwtSecret, `otp:${user.id}:${code}`), expiresAt: new Date(Date.now() + OTP_TTL_MS) });
        });
        await ctx.notifier.sendOtp({ channel: input.channel, to, code, language: user.language as Language });
        if (config.exposeDevOtp) devCode = code;
      }
    }
    return reply.status(202).send({ ok: true, ...(devCode ? { devCode } : {}) });
  });

  app.post('/recover/verify', limit(10), async (request) => {
    const input = parse(recoverVerifySchema, request.body);
    const key = `otp-verify:${input.identifier.value}`;
    await guardAccount(key);

    const user = await findUser(input.identifier);
    const now = new Date();
    const [otp] = user
      ? await db
          .select()
          .from(otpCodes)
          .where(and(eq(otpCodes.userId, user.id), eq(otpCodes.used, false), gt(otpCodes.expiresAt, now)))
          .orderBy(desc(otpCodes.createdAt))
          .limit(1)
      : [];
    if (!user || !otp) {
      await failAccount(key);
      throw new AppError(400, 'otp_invalid');
    }

    // Cada intento se contabiliza en la base de datos y solo mientras queden intentos: 50 conjeturas simultáneas no superan el máximo.
    const [counted] = await db
      .update(otpCodes)
      .set({ attempts: sql`${otpCodes.attempts} + 1` })
      .where(and(eq(otpCodes.id, otp.id), eq(otpCodes.used, false), lt(otpCodes.attempts, MAX_OTP_ATTEMPTS)))
      .returning({ attempts: otpCodes.attempts });
    if (!counted || !safeEqualHex(otp.codeHash, hmac(config.jwtSecret, `otp:${user.id}:${input.code}`))) {
      await failAccount(key);
      throw new AppError(400, 'otp_invalid');
    }

    // El código se canjea exactamente una vez, aunque lleguen varias peticiones correctas a la vez.
    const [redeemed] = await db.update(otpCodes).set({ used: true }).where(and(eq(otpCodes.id, otp.id), eq(otpCodes.used, false))).returning({ id: otpCodes.id });
    if (!redeemed) throw new AppError(400, 'otp_invalid');

    const resetToken = randomToken(32);
    await db.transaction(async (tx) => {
      await tx.delete(resetTokens).where(eq(resetTokens.userId, user.id));
      await tx.insert(resetTokens).values({ tokenHash: tokenHash(resetToken), userId: user.id, expiresAt: new Date(Date.now() + RESET_TTL_MS) });
    });
    await ctx.accountLimiter.reset(key);
    return { resetToken };
  });

  app.post('/recover/reset', limit(10), async (request) => {
    const input = parse(recoverResetSchema, request.body);
    const passwordHash = await hashPassword(input.newPassword);

    const changed = await db.transaction(async (tx) => {
      // DELETE ... RETURNING: el token de restablecimiento sirve una sola vez incluso bajo concurrencia.
      const [token] = await tx
        .delete(resetTokens)
        .where(and(eq(resetTokens.tokenHash, tokenHash(input.resetToken)), gt(resetTokens.expiresAt, new Date())))
        .returning();
      if (!token) throw new AppError(400, 'reset_token_invalid');

      const [row] = await tx.update(users).set({ passwordHash, passwordChangedAt: new Date() }).where(eq(users.id, token.userId)).returning({ businessId: users.businessId });
      await tx.delete(refreshTokens).where(eq(refreshTokens.userId, token.userId)); // cierra todas las sesiones abiertas
      return { userId: token.userId, businessId: row!.businessId };
    });
    // Aviso de seguridad de mejor esfuerzo, fuera de la transacción: quien cambió su contraseña (o un token robado)
    // debe poder notarlo. No tiene sesión en este punto (es la recuperación de acceso), pero SÍ puede tener push
    // registrado de antes: la clave de deduplicación evita que un reintento del mismo cambio avise dos veces.
    void notifyUser(ctx, changed.businessId, changed.userId, 'security', { titleKey: 'push_security_password_changed_title', bodyKey: 'push_security_password_changed_body', dedupeKey: `security_pwd:${tokenHash(input.resetToken)}`, href: '/profile' });
    return { ok: true };
  });
}
