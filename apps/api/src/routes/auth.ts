import { randomUUID } from 'node:crypto';
import { and, desc, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import {
  defaultBusinessHours,
  loginSchema,
  recoverRequestSchema,
  recoverResetSchema,
  recoverVerifySchema,
  refreshSchema,
  registerSchema,
  type AuthSession,
  type Language,
} from '@xiro/shared';
import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../context';
import { isUniqueViolation } from '../db/errors';
import { businesses, categories, otpCodes, refreshTokens, resetTokens, users } from '../db/schema';
import { AppError, parse } from '../errors';
import { toBusiness, toUser, type UserRow } from '../serializers';
import { DUMMY_HASH, hashPassword, hmac, randomToken, safeEqualHex, sixDigitCode, slugify, verifyPassword } from '../security';

const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const OTP_TTL_MS = 10 * 60 * 1000;
const RESET_TTL_MS = 15 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;
/** Ventana en la que reusar un refresh token recién rotado se considera una carrera legítima (p. ej. dos pestañas) y no un robo. */
const REUSE_GRACE_MS = 10_000;
const SLUG_ATTEMPTS = 6;

const DEFAULT_CATEGORIES: Record<Language, string[]> = {
  es: ['Servicios', 'Productos', 'Tratamientos'],
  en: ['Services', 'Products', 'Treatments'],
};

const slugCandidate = (base: string, attempt: number) => (attempt === 0 ? base : `${base}-${randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, 'x')}`);

export function authRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db, config } = ctx;
  const limit = (max: number) => ({ config: { rateLimit: { max, timeWindow: '1 minute' } } });
  const authLimit = limit(config.rateLimit.authPerMinute);
  const tokenHash = (token: string) => hmac(config.jwtSecret, `token:${token}`);

  const attempts = config.rateLimit.accountAttempts;
  const guardAccount = (key: string) => {
    if (config.rateLimit.enabled && ctx.accountLimiter.count(key) >= attempts) {
      throw new AppError(429, 'too_many_requests', undefined, { 'Retry-After': String(ctx.accountLimiter.retryAfterSeconds(key)) });
    }
  };
  const failAccount = (key: string) => {
    if (config.rateLimit.enabled) ctx.accountLimiter.hit(key);
  };

  async function findUser(identifier: { kind: 'email' | 'phone'; value: string }): Promise<UserRow | undefined> {
    const [row] = await db.select().from(users).where(eq(identifier.kind === 'email' ? users.email : users.phone, identifier.value)).limit(1);
    return row;
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
    const base = slugify(input.businessName);

    // La unicidad de correo, teléfono y slug la garantizan los índices únicos: sin "consultar y luego insertar" (carrera).
    let user: UserRow | undefined;
    for (let attempt = 0; attempt < SLUG_ATTEMPTS && !user; attempt += 1) {
      try {
        user = await db.transaction(async (tx) => {
          const [business] = await tx
            .insert(businesses)
            .values({ name: input.businessName, slug: slugCandidate(base, attempt), type: input.businessType, whatsapp: input.phone ?? null, hours: defaultBusinessHours() })
            .returning();
          const [created] = await tx
            .insert(users)
            .values({ businessId: business!.id, name: input.name, email: input.email ?? null, phone: input.phone ?? null, passwordHash, language: input.language })
            .returning();
          await tx.insert(categories).values(DEFAULT_CATEGORIES[input.language].map((name) => ({ businessId: business!.id, name })));
          return created!;
        });
      } catch (error) {
        if (isUniqueViolation(error, 'users_email_uq') || isUniqueViolation(error, 'users_phone_uq')) throw new AppError(409, 'account_exists');
        if (isUniqueViolation(error, 'businesses_slug_uq')) continue; // otro registro tomó ese slug a la vez: se reintenta con sufijo
        throw error;
      }
    }
    if (!user) throw new AppError(503, 'service_unavailable');
    return reply.status(201).send(await issueSession(user));
  });

  app.post('/login', authLimit, async (request) => {
    const input = parse(loginSchema, request.body);
    const key = `login:${input.identifier.kind}:${input.identifier.value}`;
    guardAccount(key);

    const user = await findUser(input.identifier);
    const valid = await verifyPassword(input.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !valid) {
      failAccount(key);
      throw new AppError(401, 'invalid_credentials');
    }
    ctx.accountLimiter.reset(key);
    // Se revela solo con la contraseña correcta: así no sirve para averiguar qué cuentas existen.
    if (!user.active) throw new AppError(403, 'account_disabled');
    return issueSession(user);
  });

  /**
   * Rotación de un solo uso y ATÓMICA: el UPDATE ... RETURNING deja pasar a una única petición aunque lleguen 50 a la vez.
   * Un token ya usado que reaparece pasada la ventana de gracia indica robo: se revoca toda la familia de sesiones.
   */
  app.post('/refresh', limit(30), async (request) => {
    const { refreshToken } = parse(refreshSchema, request.body);
    const hash = tokenHash(refreshToken);
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
      throw new AppError(401, 'unauthorized');
    }

    const [user] = await db.select().from(users).where(eq(users.id, consumed.userId)).limit(1);
    if (!user || !user.active) throw new AppError(401, 'unauthorized');
    return issueSession(user, consumed.familyId);
  });

  app.post('/logout', async (request, reply) => {
    const { refreshToken } = parse(refreshSchema, request.body);
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
      if (ctx.accountLimiter.hit(key) > attempts) {
        throw new AppError(429, 'too_many_requests', undefined, { 'Retry-After': String(ctx.accountLimiter.retryAfterSeconds(key)) });
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
    guardAccount(key);

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
      failAccount(key);
      throw new AppError(400, 'otp_invalid');
    }

    // Cada intento se contabiliza en la base de datos y solo mientras queden intentos: 50 conjeturas simultáneas no superan el máximo.
    const [counted] = await db
      .update(otpCodes)
      .set({ attempts: sql`${otpCodes.attempts} + 1` })
      .where(and(eq(otpCodes.id, otp.id), eq(otpCodes.used, false), lt(otpCodes.attempts, MAX_OTP_ATTEMPTS)))
      .returning({ attempts: otpCodes.attempts });
    if (!counted || !safeEqualHex(otp.codeHash, hmac(config.jwtSecret, `otp:${user.id}:${input.code}`))) {
      failAccount(key);
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
    ctx.accountLimiter.reset(key);
    return { resetToken };
  });

  app.post('/recover/reset', limit(10), async (request) => {
    const input = parse(recoverResetSchema, request.body);
    const passwordHash = await hashPassword(input.newPassword);

    await db.transaction(async (tx) => {
      // DELETE ... RETURNING: el token de restablecimiento sirve una sola vez incluso bajo concurrencia.
      const [token] = await tx
        .delete(resetTokens)
        .where(and(eq(resetTokens.tokenHash, tokenHash(input.resetToken)), gt(resetTokens.expiresAt, new Date())))
        .returning();
      if (!token) throw new AppError(400, 'reset_token_invalid');

      await tx.update(users).set({ passwordHash, passwordChangedAt: new Date() }).where(eq(users.id, token.userId));
      await tx.delete(refreshTokens).where(eq(refreshTokens.userId, token.userId)); // cierra todas las sesiones abiertas
    });
    return { ok: true };
  });
}
