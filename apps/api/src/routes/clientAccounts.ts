import {
  clientChangePasswordSchema,
  clientDeleteAccountSchema,
  clientLoginSchema,
  clientRecoverRequestSchema,
  clientRecoverResetSchema,
  clientRecoverVerifySchema,
  clientRegisterSchema,
  clientUpdateProfileSchema,
  type ClientAccountDto,
  type ClientSessionDeviceDto,
  type Language,
  type PublicAppointmentDto,
} from '@xiro/shared';
import { and, desc, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { toPublicAppointment } from '../booking/appointments';
import { loadContext } from '../booking/availability';
import { withBusiness, type Tx } from '../booking/scope';
import { loadProfileRow, resolveSlug } from '../booking/view';
import { CLIENT_COOKIE_NAME as COOKIE_NAME, CLIENT_SESSION_REMEMBER_TTL_MS as REMEMBER_TTL_MS, CLIENT_SESSION_VISIT_TTL_MS as VISIT_TTL_MS, clientAccountPath as accountPath, clientSessionTokenHash, resolveClientAccount, type ClientAccountRow as AccountRow } from '../clientSession';
import type { Ctx } from '../context';
import { expiredSessionCookie, parseCookies, serializeSessionCookie } from '../cookies';
import { isUniqueViolation } from '../db/errors';
import { appointments, clientAccounts, clientRecoveryCodes, clientResetTokens, clientSessions, clients, loyaltyPrograms, loyaltyProgress } from '../db/schema';
import { AppError, notFound, parse } from '../errors';
import { mediaUrl } from '../media';
import { DUMMY_HASH, hashPassword, hmac, randomToken, safeEqualHex, sixDigitCode, verifyPassword } from '../security';
import type { BusinessRow } from '../serializers';

const RECOVERY_TTL_MS = 10 * 60 * 1000;
const RESET_TTL_MS = 15 * 60 * 1000;
const MAX_RECOVERY_ATTEMPTS = 5;

const slugParams = z.object({ slug: z.string().min(1).max(60) });

function toAccountDto(account: AccountRow): ClientAccountDto {
  return {
    id: account.id,
    name: account.name,
    phone: account.phoneE164,
    email: account.email,
    photoUrl: account.photoFile ? mediaUrl(account.photoFile) : null,
    mustChangePassword: account.mustChangePassword,
  };
}

/**
 * Cuentas de cliente final (opcionales) para la página pública: registro, inicio de sesión, "Mi cuenta" y
 * recuperación de acceso. Nunca obligatorias — agendar como invitado sigue intacto (ver publicBooking.ts).
 *
 * Aislamiento entre negocios (crítico, ver sección 13 del encargo): una cuenta pertenece a UN negocio
 * (`client_accounts_business_phone_uq`); la sesión se guarda en una cookie cuyo `Path` es el de ESTE negocio
 * (`/api/public/booking/<slug>`), así el navegador nunca la envía en peticiones a otro negocio; y, por si acaso,
 * cada ruta protegida vuelve a comprobar que la cuenta de la sesión pertenece al negocio resuelto de la URL.
 */
export function clientAccountRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db, config } = ctx;
  const limit = (max: number) => ({ config: { rateLimit: { max, timeWindow: '1 minute' } } });
  const recoveryLimiter = ctx.accountLimiter;
  const attempts = config.rateLimit.accountAttempts;

  const guardAccount = (key: string) => {
    if (config.rateLimit.enabled && recoveryLimiter.count(key) >= attempts) {
      throw new AppError(429, 'too_many_requests', undefined, { 'Retry-After': String(recoveryLimiter.retryAfterSeconds(key)) });
    }
  };
  const failAccount = (key: string) => {
    if (config.rateLimit.enabled) recoveryLimiter.hit(key);
  };

  async function publishedBusiness(slug: string): Promise<BusinessRow> {
    const resolved = await resolveSlug(db, slug);
    if (!resolved) throw notFound();
    const profile = await loadProfileRow(db, resolved.business.id);
    if (!profile?.published) throw notFound();
    return resolved.business;
  }

  const tokenHash = (token: string) => clientSessionTokenHash(config.jwtSecret, token);
  const codeHash = (accountId: string, code: string) => hmac(config.jwtSecret, `client-otp:${accountId}:${code}`);

  async function findAccount(businessId: string, phoneE164: string): Promise<AccountRow | undefined> {
    const [row] = await db.select().from(clientAccounts).where(and(eq(clientAccounts.businessId, businessId), eq(clientAccounts.phoneE164, phoneE164))).limit(1);
    return row;
  }

  async function issueSession(reply: import('fastify').FastifyReply, business: BusinessRow, account: AccountRow, remember: boolean): Promise<void> {
    const token = randomToken(32);
    const ttl = remember ? REMEMBER_TTL_MS : VISIT_TTL_MS;
    await db.insert(clientSessions).values({ accountId: account.id, tokenHash: tokenHash(token), expiresAt: new Date(Date.now() + ttl) });
    const cookie = remember
      ? serializeSessionCookie(COOKIE_NAME, token, accountPath(business.slug), Math.floor(ttl / 1000), config.production)
      : // Cookie de sesión del navegador (sin Max-Age): se va al cerrarlo; el tope del servidor (VISIT_TTL_MS) es un respaldo.
        [`${COOKIE_NAME}=${encodeURIComponent(token)}`, `Path=${accountPath(business.slug)}`, 'HttpOnly', 'SameSite=Lax', ...(config.production ? ['Secure'] : [])].join('; ');
    reply.header('Set-Cookie', cookie);
  }

  const currentAccount = (request: FastifyRequest, business: BusinessRow) => resolveClientAccount(db, config.jwtSecret, parseCookies(request.headers.cookie)[COOKIE_NAME], business);

  async function requireAccount(request: FastifyRequest, business: BusinessRow): Promise<AccountRow> {
    const account = await currentAccount(request, business);
    if (!account) throw new AppError(401, 'unauthorized');
    return account;
  }

  /* ---------- Registro, ingreso, sesión ---------- */

  app.post('/:slug/account/register', limit(10), async (request, reply) => {
    const { slug } = parse(slugParams, request.params);
    const business = await publishedBusiness(slug);
    const input = parse(clientRegisterSchema, request.body);
    const passwordHash = await hashPassword(input.password);

    let account: AccountRow;
    try {
      account = await db.transaction(async (tx) => {
        // Se vincula a un `clients` existente con ese teléfono (lo creó el negocio antes) o se crea uno nuevo —
        // así el cliente queda en el directorio del negocio igual que si lo hubiera registrado un empleado. Nunca
        // al cliente "de mostrador" (isOccasional): es una fila compartida para ventas sin ficha, no una persona.
        const [existingClient] = await tx.select().from(clients).where(and(eq(clients.businessId, business.id), eq(clients.phone, input.phone), eq(clients.isOccasional, false))).limit(1);
        const client = existingClient ?? (await tx.insert(clients).values({ businessId: business.id, name: input.name, phone: input.phone, email: input.email ?? null }).returning())[0]!;
        const [created] = await tx
          .insert(clientAccounts)
          .values({ businessId: business.id, clientId: client.id, phoneE164: input.phone, passwordHash, name: input.name, email: input.email ?? null })
          .returning();
        return created!;
      });
    } catch (error) {
      if (isUniqueViolation(error, 'client_accounts_business_phone_uq')) throw new AppError(409, 'account_exists');
      throw error;
    }
    await issueSession(reply, business, account, input.remember);
    return reply.status(201).send(toAccountDto(account));
  });

  app.post('/:slug/account/login', limit(20), async (request, reply) => {
    const { slug } = parse(slugParams, request.params);
    const business = await publishedBusiness(slug);
    const input = parse(clientLoginSchema, request.body);
    const key = `client-login:${business.id}:${input.phone}`;
    guardAccount(key);

    const account = await findAccount(business.id, input.phone);
    const valid = await verifyPassword(input.password, account?.passwordHash ?? DUMMY_HASH);
    if (!account || !valid) {
      failAccount(key);
      throw new AppError(401, 'invalid_credentials');
    }
    recoveryLimiter.reset(key);
    if (account.disabledAt) throw new AppError(403, 'account_disabled');

    await db.update(clientAccounts).set({ lastLoginAt: new Date() }).where(eq(clientAccounts.id, account.id));
    await issueSession(reply, business, account, input.remember);
    return toAccountDto(account);
  });

  app.post('/:slug/account/logout', async (request, reply) => {
    const { slug } = parse(slugParams, request.params);
    const business = await publishedBusiness(slug);
    const token = parseCookies(request.headers.cookie)[COOKIE_NAME];
    if (token) await db.update(clientSessions).set({ revokedAt: new Date() }).where(eq(clientSessions.tokenHash, tokenHash(token)));
    reply.header('Set-Cookie', expiredSessionCookie(COOKIE_NAME, accountPath(business.slug), config.production));
    return reply.status(204).send();
  });

  /* ---------- Mi cuenta ---------- */

  app.get('/:slug/account/me', async (request, reply) => {
    const { slug } = parse(slugParams, request.params);
    const business = await publishedBusiness(slug);
    const account = await currentAccount(request, business);
    if (!account) return reply.status(204).send(); // sin sesión: la página sigue para invitados, no es un error
    return toAccountDto(account);
  });

  app.put('/:slug/account/me', async (request): Promise<ClientAccountDto> => {
    const { slug } = parse(slugParams, request.params);
    const business = await publishedBusiness(slug);
    const account = await requireAccount(request, business);
    const input = parse(clientUpdateProfileSchema, request.body);
    const [updated] = await db
      .update(clientAccounts)
      .set({ ...(input.name !== undefined ? { name: input.name } : {}), ...(input.email !== undefined ? { email: input.email } : {}) })
      .where(eq(clientAccounts.id, account.id))
      .returning();
    return toAccountDto(updated!);
  });

  app.post('/:slug/account/change-password', async (request) => {
    const { slug } = parse(slugParams, request.params);
    const business = await publishedBusiness(slug);
    const account = await requireAccount(request, business);
    const input = parse(clientChangePasswordSchema, request.body);
    if (!(await verifyPassword(input.currentPassword, account.passwordHash))) throw new AppError(401, 'invalid_credentials');
    const passwordHash = await hashPassword(input.newPassword);
    await db.update(clientAccounts).set({ passwordHash, mustChangePassword: false, tempPasswordExpiresAt: null }).where(eq(clientAccounts.id, account.id));
    return { ok: true };
  });

  app.delete('/:slug/account', async (request, reply) => {
    const { slug } = parse(slugParams, request.params);
    const business = await publishedBusiness(slug);
    const account = await requireAccount(request, business);
    const input = parse(clientDeleteAccountSchema, request.body);
    if (!(await verifyPassword(input.password, account.passwordHash))) throw new AppError(401, 'invalid_credentials');
    // Se borran las credenciales y la foto; el registro de `clients` del negocio se conserva (su historial de citas sigue siendo del negocio).
    await db.delete(clientAccounts).where(eq(clientAccounts.id, account.id));
    reply.header('Set-Cookie', expiredSessionCookie(COOKIE_NAME, accountPath(business.slug), config.production));
    return reply.status(204).send();
  });

  app.get('/:slug/account/sessions', async (request): Promise<ClientSessionDeviceDto[]> => {
    const { slug } = parse(slugParams, request.params);
    const business = await publishedBusiness(slug);
    const account = await requireAccount(request, business);
    const currentToken = parseCookies(request.headers.cookie)[COOKIE_NAME];
    const currentHash = currentToken ? tokenHash(currentToken) : null;
    const rows = await db
      .select()
      .from(clientSessions)
      .where(and(eq(clientSessions.accountId, account.id), isNull(clientSessions.revokedAt), gt(clientSessions.expiresAt, new Date())))
      .orderBy(desc(clientSessions.lastUsedAt));
    return rows.map((row) => ({ id: row.id, deviceLabel: row.deviceLabel || 'Dispositivo', createdAt: row.createdAt.toISOString(), lastUsedAt: row.lastUsedAt.toISOString(), current: row.tokenHash === currentHash }));
  });

  app.delete('/:slug/account/sessions/:id', async (request, reply) => {
    const { slug, id } = parse(slugParams.extend({ id: z.string().uuid() }), request.params);
    const business = await publishedBusiness(slug);
    const account = await requireAccount(request, business);
    await db.update(clientSessions).set({ revokedAt: new Date() }).where(and(eq(clientSessions.id, id), eq(clientSessions.accountId, account.id)));
    return reply.status(204).send();
  });

  /* ---------- Olvidé mi contraseña (igual patrón de un solo uso que el de users en auth.ts) ---------- */

  app.post('/:slug/account/recover/request', limit(5), async (request, reply) => {
    const { slug } = parse(slugParams, request.params);
    const business = await publishedBusiness(slug);
    const input = parse(clientRecoverRequestSchema, request.body);
    const key = `client-otp-request:${business.id}:${input.phone}`;
    if (config.rateLimit.enabled && recoveryLimiter.hit(key) > attempts) {
      throw new AppError(429, 'too_many_requests', undefined, { 'Retry-After': String(recoveryLimiter.retryAfterSeconds(key)) });
    }

    const account = await findAccount(business.id, input.phone);
    let devCode: string | undefined;
    if (account && !account.disabledAt) {
      const code = sixDigitCode();
      await db.transaction(async (tx) => {
        await tx.delete(clientRecoveryCodes).where(eq(clientRecoveryCodes.accountId, account.id));
        await tx.insert(clientRecoveryCodes).values({ accountId: account.id, codeHash: codeHash(account.id, code), channel: 'sms', expiresAt: new Date(Date.now() + RECOVERY_TTL_MS) });
      });
      await ctx.notifier.sendOtp({ channel: 'sms', to: account.phoneE164, code, language: (account.language as Language) ?? 'es' });
      if (config.exposeDevOtp) devCode = code;
    }
    // Respuesta idéntica exista o no la cuenta: no revela si ese teléfono tiene cuenta en este negocio.
    return reply.status(202).send({ ok: true, ...(devCode ? { devCode } : {}) });
  });

  app.post('/:slug/account/recover/verify', limit(10), async (request) => {
    const { slug } = parse(slugParams, request.params);
    const business = await publishedBusiness(slug);
    const input = parse(clientRecoverVerifySchema, request.body);
    const key = `client-otp-verify:${business.id}:${input.phone}`;
    guardAccount(key);

    const account = await findAccount(business.id, input.phone);
    const now = new Date();
    const [code] = account
      ? await db.select().from(clientRecoveryCodes).where(and(eq(clientRecoveryCodes.accountId, account.id), isNull(clientRecoveryCodes.usedAt), gt(clientRecoveryCodes.expiresAt, now))).orderBy(desc(clientRecoveryCodes.createdAt)).limit(1)
      : [];
    if (!account || !code) {
      failAccount(key);
      throw new AppError(400, 'otp_invalid');
    }

    const [counted] = await db
      .update(clientRecoveryCodes)
      .set({ attempts: sql`${clientRecoveryCodes.attempts} + 1` })
      .where(and(eq(clientRecoveryCodes.id, code.id), isNull(clientRecoveryCodes.usedAt), lt(clientRecoveryCodes.attempts, MAX_RECOVERY_ATTEMPTS)))
      .returning({ attempts: clientRecoveryCodes.attempts });
    if (!counted || !safeEqualHex(code.codeHash, codeHash(account.id, input.code))) {
      failAccount(key);
      throw new AppError(400, 'otp_invalid');
    }

    // El código se canjea exactamente una vez, aunque lleguen varias peticiones correctas a la vez.
    const [redeemed] = await db.update(clientRecoveryCodes).set({ usedAt: now }).where(and(eq(clientRecoveryCodes.id, code.id), isNull(clientRecoveryCodes.usedAt))).returning({ id: clientRecoveryCodes.id });
    if (!redeemed) throw new AppError(400, 'otp_invalid');

    const resetToken = randomToken(32);
    await db.transaction(async (tx) => {
      await tx.delete(clientResetTokens).where(eq(clientResetTokens.accountId, account.id));
      await tx.insert(clientResetTokens).values({ tokenHash: tokenHash(resetToken), accountId: account.id, expiresAt: new Date(Date.now() + RESET_TTL_MS) });
      await tx.update(clientAccounts).set({ phoneVerifiedAt: now }).where(eq(clientAccounts.id, account.id));
    });
    recoveryLimiter.reset(key);
    return { resetToken };
  });

  app.post('/:slug/account/recover/reset', limit(10), async (request) => {
    const { slug } = parse(slugParams, request.params);
    const business = await publishedBusiness(slug);
    const input = parse(clientRecoverResetSchema, request.body);
    const passwordHash = await hashPassword(input.newPassword);

    await db.transaction(async (tx) => {
      // DELETE ... RETURNING: el token de restablecimiento sirve una sola vez incluso bajo concurrencia.
      const [token] = await tx.delete(clientResetTokens).where(and(eq(clientResetTokens.tokenHash, tokenHash(input.resetToken)), gt(clientResetTokens.expiresAt, new Date()))).returning();
      if (!token) throw new AppError(400, 'reset_token_invalid');
      const [row] = await tx.update(clientAccounts).set({ passwordHash, mustChangePassword: false, tempPasswordExpiresAt: null }).where(and(eq(clientAccounts.id, token.accountId), eq(clientAccounts.businessId, business.id))).returning({ id: clientAccounts.id });
      if (!row) throw new AppError(400, 'reset_token_invalid');
      await tx.update(clientSessions).set({ revokedAt: new Date() }).where(eq(clientSessions.accountId, row.id)); // cierra todas las sesiones abiertas
    });
    return { ok: true };
  });

  /* ---------- Mis citas y fidelización (solo lectura) ---------- */

  app.get('/:slug/account/appointments', async (request): Promise<PublicAppointmentDto[]> => {
    const { slug } = parse(slugParams, request.params);
    const business = await publishedBusiness(slug);
    const account = await requireAccount(request, business);
    return withBusiness(db, business.id, async (tx: Tx) => {
      const rows = await tx.select().from(appointments).where(and(eq(appointments.businessId, business.id), eq(appointments.clientAccountId, account.id))).orderBy(desc(appointments.startsAt)).limit(100);
      const bookingContext = await loadContext(tx, business.id);
      const profile = await loadProfileRow(tx, business.id);
      const now = new Date();
      return Promise.all(rows.map((row) => toPublicAppointment(tx, bookingContext, business.id, row, now, profile)));
    });
  });

  app.get('/:slug/account/loyalty', async (request) => {
    const { slug } = parse(slugParams, request.params);
    const business = await publishedBusiness(slug);
    const account = await requireAccount(request, business);
    const [program] = await db.select().from(loyaltyPrograms).where(eq(loyaltyPrograms.businessId, business.id)).limit(1);
    if (!program?.enabled) return { active: false as const };
    const [progress] = await db.select().from(loyaltyProgress).where(and(eq(loyaltyProgress.businessId, business.id), eq(loyaltyProgress.clientId, account.clientId))).limit(1);
    const count = progress?.count ?? 0;
    return { active: true as const, count, goal: program.goal, rewardAvailable: count >= program.goal, rewardMessage: program.rewardMessage };
  });
}
