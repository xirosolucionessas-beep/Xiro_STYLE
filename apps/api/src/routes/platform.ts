import { and, eq, lt } from 'drizzle-orm';
import {
  PLATFORM_GROUPINGS,
  PLATFORM_SEARCH_KINDS,
  PLATFORM_SERIES,
  platformGrantSchema,
  platformLoginSchema,
  platformRevokeGrantSchema,
  platformStatusChangeSchema,
  platformStepUpSchema,
  type PlatformSessionDto,
} from '@xiro/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../context';
import { platformAdminSessions, platformAdmins } from '../db/schema';
import { AppError, notFound, parse, uuid } from '../errors';
import type { Metrics } from '../metrics';
import { businessDetail, changeAccessStatus, createAccessGrant, loadAuditEntries, revokeAccessGrant, searchBusinesses, type StatusAction } from '../platform/businesses';
import { recordPlatformAudit } from '../platform/audit';
import { decryptSecret, verifyTotp } from '../platform/crypto';
import { parsePeriod, platformOverview, platformSeries } from '../platform/metrics';
import { createPlatformSession, platformAuthenticator, requirePermission, requireRecentMfa, toAdminDto } from '../platform/session';
import { DUMMY_HASH, verifyPassword } from '../security';

const periodQuery = z.object({ from: z.string().max(10).optional(), to: z.string().max(10).optional(), tz: z.string().max(64).optional() }).strict();
const seriesQuery = periodQuery.extend({ metric: z.enum(PLATFORM_SERIES), grouping: z.enum(PLATFORM_GROUPINGS).default('day') }).strict();
const searchQuery = z.object({ kind: z.enum(PLATFORM_SEARCH_KINDS), q: z.string().trim().min(1).max(254) }).strict();
const auditQuery = z.object({ before: z.iso.datetime().optional() }).strict();
const AUDIT_PAGE = 50;
/** Peticiones por minuto de una sesión de administrador: uso humano; frena un script con un token robado. */
const ADMIN_PER_MINUTE = 120;

export interface PlatformRouteDeps {
  metrics: Metrics;
}

/**
 * Panel del fundador (prefijo /api/platform). Solo existe con PLATFORM_ADMIN_KEY configurada (ver app.ts). Totalmente
 * separado de la autenticación de los negocios: token propio, permisos propios, bitácora propia. Ver docs/platform-admin.md.
 */
export function platformRoutes(app: FastifyInstance, ctx: Ctx, deps: PlatformRouteDeps): void {
  const { db, config } = ctx;
  const adminKey = config.platform.adminKey!;
  const loginIpLimiter = ctx.rates.limiter('platform-login-ip', config.rateLimit.accountWindowMinutes * 60_000);
  const sessionLimiter = ctx.rates.limiter('platform-session', 60_000);

  app.decorateRequest('platformAdmin', null as never);
  app.addHook('onSend', async (_request, reply) => void reply.header('Cache-Control', 'no-store'));
  // Lista blanca opcional de IPs: fuera de ella el panel "no existe" (404, sin revelar nada).
  app.addHook('onRequest', async (request) => {
    if (config.platform.allowedIps.length > 0 && !config.platform.allowedIps.includes(request.ip)) throw notFound();
  });

  /** Valida contraseña y código TOTP; devuelve el administrador solo si TODO es correcto (mismo error en cualquier fallo). */
  async function verifyCredentials(email: string, password: string, totp: string) {
    const [admin] = await db.select().from(platformAdmins).where(eq(platformAdmins.email, email)).limit(1);
    // Siempre se evalúa una contraseña (con un hash ficticio si no hay cuenta): mismo costo exista o no.
    const passwordOk = await verifyPassword(password, admin?.passwordHash ?? DUMMY_HASH);
    if (!admin || !passwordOk || !admin.active) return { admin: admin ?? null, ok: false as const };
    const step = verifyTotp(decryptSecret(adminKey, admin.totpSecretEnc), totp, admin.totpLastStep);
    if (step === null) return { admin, ok: false as const };
    // Consumo ATÓMICO del paso TOTP: dos inicios de sesión simultáneos con el mismo código, solo uno gana.
    const [consumed] = await db.update(platformAdmins).set({ totpLastStep: step }).where(and(eq(platformAdmins.id, admin.id), lt(platformAdmins.totpLastStep, step))).returning({ id: platformAdmins.id });
    return { admin, ok: Boolean(consumed) as boolean };
  }

  app.post('/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request): Promise<PlatformSessionDto> => {
    const input = parse(platformLoginSchema, request.body);
    const accountKey = `platform-login:${input.email}`;
    if (config.rateLimit.enabled) {
      if ((await loginIpLimiter.count(request.ip)) >= config.rateLimit.accountAttempts * 2) {
        throw new AppError(429, 'too_many_requests', undefined, { 'Retry-After': String(await loginIpLimiter.retryAfterSeconds(request.ip)) });
      }
      // El intento se reserva ANTES de verificar (igual que el login de negocios): intentos simultáneos no superan el máximo.
      if ((await ctx.accountLimiter.hit(accountKey)) > config.rateLimit.accountAttempts) {
        throw new AppError(429, 'too_many_requests', undefined, { 'Retry-After': String(await ctx.accountLimiter.retryAfterSeconds(accountKey)) });
      }
    }
    const { admin, ok } = await verifyCredentials(input.email, input.password, input.totp);
    if (!ok || !admin) {
      if (config.rateLimit.enabled) await loginIpLimiter.hit(request.ip);
      await recordPlatformAudit(db, request, { adminId: admin?.id ?? null, action: 'auth.login', outcome: 'denied', details: { reason: admin && !admin.active ? 'admin_inactive' : 'invalid_credentials' } });
      throw new AppError(401, 'invalid_credentials');
    }
    if (config.rateLimit.enabled) await ctx.accountLimiter.reset(accountKey);
    const session = await createPlatformSession(db, config, admin.id, request.ip);
    await recordPlatformAudit(db, request, { adminId: admin.id, action: 'auth.login', outcome: 'success' });
    return { token: session.token, expiresAt: session.expiresAt.toISOString(), admin: toAdminDto(admin) };
  });

  app.register(async (scope) => {
    scope.addHook('onRequest', platformAuthenticator(db, config));
    scope.addHook('preHandler', async (request) => {
      if (!config.rateLimit.enabled) return;
      const key = request.platformAdmin.sessionId;
      if ((await sessionLimiter.hit(key)) > ADMIN_PER_MINUTE) throw new AppError(429, 'too_many_requests', undefined, { 'Retry-After': String(await sessionLimiter.retryAfterSeconds(key)) });
    });
    const audit = (request: FastifyRequest, action: string, businessId: string | null, details: Record<string, unknown> = {}, outcome: 'success' | 'denied' | 'error' = 'success') =>
      recordPlatformAudit(db, request, { adminId: request.platformAdmin.id, action, businessId, outcome, details });

    scope.get('/auth/me', async (request) => {
      const { sessionId: _s, mfaAt, ...admin } = request.platformAdmin;
      return { admin, mfaAt: mfaAt.toISOString(), stepUpMinutes: config.platform.stepUpMinutes };
    });

    /** Reautenticación para acciones sensibles: un código TOTP nuevo renueva `mfaAt` de ESTA sesión. */
    scope.post('/auth/step-up', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request) => {
      const { totp } = parse(platformStepUpSchema, request.body);
      const [admin] = await db.select().from(platformAdmins).where(eq(platformAdmins.id, request.platformAdmin.id)).limit(1);
      const step = admin ? verifyTotp(decryptSecret(adminKey, admin.totpSecretEnc), totp, admin.totpLastStep) : null;
      const consumed = step !== null && (await db.update(platformAdmins).set({ totpLastStep: step }).where(and(eq(platformAdmins.id, admin!.id), lt(platformAdmins.totpLastStep, step))).returning({ id: platformAdmins.id })).length > 0;
      if (!consumed) {
        await audit(request, 'auth.step_up', null, {}, 'denied');
        throw new AppError(401, 'invalid_code');
      }
      const now = new Date();
      await db.update(platformAdminSessions).set({ mfaAt: now }).where(eq(platformAdminSessions.id, request.platformAdmin.sessionId));
      await audit(request, 'auth.step_up', null);
      return { mfaAt: now.toISOString() };
    });

    scope.post('/auth/logout', async (request, reply) => {
      await db.update(platformAdminSessions).set({ revokedAt: new Date() }).where(eq(platformAdminSessions.id, request.platformAdmin.sessionId));
      await audit(request, 'auth.logout', null);
      return reply.status(204).send();
    });

    /* ---------- Métricas (agregadas, sin datos personales: no se registra cada consulta) ---------- */

    scope.get('/metrics/overview', async (request) => {
      await requirePermission(db, request, 'metrics_view');
      const period = parsePeriod(parse(periodQuery, request.query));
      return platformOverview({ db, config, metrics: deps.metrics, redis: ctx.redis, media: ctx.media, log: (error) => request.log.error({ err: error }, 'platform: indicador falló') }, period);
    });

    scope.get('/metrics/series', async (request) => {
      await requirePermission(db, request, 'metrics_view');
      const query = parse(seriesQuery, request.query);
      return platformSeries(db, query.metric, query.grouping, parsePeriod(query));
    });

    /* ---------- Negocios (lecturas sensibles: quedan en la bitácora) ---------- */

    scope.get('/businesses/search', async (request) => {
      await requirePermission(db, request, 'businesses_view');
      const { kind, q } = parse(searchQuery, request.query);
      const result = await searchBusinesses(db, kind, q);
      // El correo buscado es un dato personal: no se guarda en la bitácora (sí el tipo de búsqueda y cuántos resultados hubo).
      await audit(request, 'business.search', result.results.length === 1 ? result.results[0]!.id : null, { kind, ...(kind === 'email' ? {} : { query: q }), results: result.results.length });
      return result;
    });

    scope.get('/businesses/:id', async (request) => {
      await requirePermission(db, request, 'businesses_view');
      const id = uuid((request.params as { id: string }).id);
      const detail = await businessDetail(db, id);
      await audit(request, 'business.view', id);
      return detail;
    });

    const statusRoute = (action: StatusAction, permission: 'business_access_manage' | 'business_deactivate') =>
      scope.post(`/businesses/:id/${action}`, async (request) => {
        const id = uuid((request.params as { id: string }).id);
        await requirePermission(db, request, permission, id);
        requireRecentMfa(config, request);
        const input = parse(platformStatusChangeSchema, request.body);
        try {
          const result = await changeAccessStatus(db, request, id, action, input);
          await ctx.publicCache.invalidate(id); // la página pública deja (o vuelve) a mostrarse al instante
          return result;
        } catch (error) {
          if (error instanceof AppError && error.status < 500 && error.status !== 404) await audit(request, `business.${action}`, id, { error: error.code }, 'denied');
          throw error;
        }
      });
    statusRoute('suspend', 'business_access_manage');
    statusRoute('reactivate', 'business_access_manage');
    statusRoute('deactivate', 'business_deactivate');
    statusRoute('restore', 'business_deactivate');

    scope.post('/businesses/:id/grants', async (request, reply) => {
      const id = uuid((request.params as { id: string }).id);
      await requirePermission(db, request, 'business_extend', id);
      requireRecentMfa(config, request);
      const input = parse(platformGrantSchema, request.body);
      try {
        const { grant, replayed } = await createAccessGrant(db, request, id, input);
        return reply.status(replayed ? 200 : 201).send({ grant, replayed });
      } catch (error) {
        if (error instanceof AppError && error.status < 500 && error.status !== 404) await audit(request, 'business.grant_access', id, { error: error.code }, 'denied');
        throw error;
      }
    });

    scope.post('/businesses/:id/grants/:grantId/revoke', async (request, reply) => {
      const params = request.params as { id: string; grantId: string };
      const id = uuid(params.id);
      const grantId = uuid(params.grantId);
      await requirePermission(db, request, 'business_extend', id);
      requireRecentMfa(config, request);
      const { reason } = parse(platformRevokeGrantSchema, request.body);
      await revokeAccessGrant(db, request, id, grantId, reason);
      return reply.status(204).send();
    });

    /* ---------- Bitácora ---------- */

    scope.get('/audit', async (request) => {
      await requirePermission(db, request, 'audit_view');
      const { before } = parse(auditQuery, request.query);
      const entries = await loadAuditEntries(db, { limit: AUDIT_PAGE + 1, before: before ? new Date(before) : undefined });
      await audit(request, 'audit.view', null, { before: before ?? null });
      return { entries: entries.slice(0, AUDIT_PAGE), nextBefore: entries.length > AUDIT_PAGE ? entries[AUDIT_PAGE - 1]!.createdAt : null };
    });
  });
}
