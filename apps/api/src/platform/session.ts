import { and, eq, gt, isNull } from 'drizzle-orm';
import { normalizePlatformPermissions, PLATFORM_PERMISSIONS, type PlatformAdminDto, type PlatformPermission } from '@xiro/shared';
import type { FastifyRequest } from 'fastify';
import type { Config } from '../config';
import type { Database } from '../db/client';
import { platformAdminSessions, platformAdmins } from '../db/schema';
import { AppError } from '../errors';
import { hmac, randomToken } from '../security';
import { recordPlatformAudit } from './audit';

/** Prefijo propio: un token de plataforma nunca se confunde con un JWT de negocio (y viceversa, cada lado rechaza al otro). */
const TOKEN_PREFIX = 'xpa_';
/** `last_seen_at` se actualiza como mucho una vez por minuto (no una escritura por petición). */
const TOUCH_EVERY_MS = 60_000;

export interface PlatformActor extends PlatformAdminDto {
  sessionId: string;
  mfaAt: Date;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Administrador de plataforma autenticado (solo en las rutas /api/platform protegidas). */
    platformAdmin: PlatformActor;
  }
}

type AdminRow = typeof platformAdmins.$inferSelect;

export const toAdminDto = (row: AdminRow): PlatformAdminDto => ({
  id: row.id,
  name: row.name,
  email: row.email,
  isFounder: row.isFounder,
  permissions: row.isFounder ? [...PLATFORM_PERMISSIONS] : normalizePlatformPermissions(row.permissions),
});

export const sessionTokenHash = (config: Config, token: string) => hmac(config.jwtSecret, `platform-session:${token}`);

export async function createPlatformSession(db: Database, config: Config, adminId: string, ip: string, now = new Date()): Promise<{ token: string; expiresAt: Date }> {
  const token = `${TOKEN_PREFIX}${randomToken(32)}`;
  const expiresAt = new Date(now.getTime() + config.platform.sessionHours * 3_600_000);
  await db.insert(platformAdminSessions).values({ adminId, tokenHash: sessionTokenHash(config, token), expiresAt, lastSeenAt: now, mfaAt: now, ip });
  return { token, expiresAt };
}

export function presentedToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  const token = match?.[1];
  return token && token.startsWith(TOKEN_PREFIX) && token.length < 200 ? token : null;
}

/**
 * Autentica CADA petición contra la base: sesión existente, no revocada, sin vencer (absoluto e inactividad) y
 * administrador activo. Permisos leídos de la base en cada petición: un cambio o una baja aplican al instante.
 */
export function platformAuthenticator(db: Database, config: Config) {
  return async (request: FastifyRequest): Promise<void> => {
    const token = presentedToken(request);
    if (!token) throw new AppError(401, 'unauthorized');
    const now = new Date();
    const [row] = await db
      .select({ session: platformAdminSessions, admin: platformAdmins })
      .from(platformAdminSessions)
      .innerJoin(platformAdmins, eq(platformAdmins.id, platformAdminSessions.adminId))
      .where(and(eq(platformAdminSessions.tokenHash, sessionTokenHash(config, token)), isNull(platformAdminSessions.revokedAt), gt(platformAdminSessions.expiresAt, now)))
      .limit(1);
    const idleLimit = config.platform.idleMinutes * 60_000;
    if (!row || !row.admin.active || now.getTime() - row.session.lastSeenAt.getTime() > idleLimit) throw new AppError(401, 'unauthorized');
    if (now.getTime() - row.session.lastSeenAt.getTime() > TOUCH_EVERY_MS) {
      await db.update(platformAdminSessions).set({ lastSeenAt: now }).where(eq(platformAdminSessions.id, row.session.id));
    }
    request.platformAdmin = { ...toAdminDto(row.admin), sessionId: row.session.id, mfaAt: row.session.mfaAt };
  };
}

/** Por defecto-denegar: sin el permiso, 403 y queda registrado el intento. */
export async function requirePermission(db: Database, request: FastifyRequest, permission: PlatformPermission, businessId?: string): Promise<void> {
  const admin = request.platformAdmin;
  if (admin.isFounder || admin.permissions.includes(permission)) return;
  await recordPlatformAudit(db, request, { adminId: admin.id, action: `denied:${request.routeOptions.url ?? ''}`, businessId: businessId ?? null, outcome: 'denied', details: { missingPermission: permission, method: request.method } });
  throw new AppError(403, 'forbidden');
}

/** Acciones sensibles: el código TOTP debe haberse verificado hace poco (POST /auth/step-up). */
export function requireRecentMfa(config: Config, request: FastifyRequest, now = new Date()): void {
  if (config.platform.devSkipTotp) return; // solo desarrollo local; rechazado en producción por loadConfig
  if (now.getTime() - request.platformAdmin.mfaAt.getTime() > config.platform.stepUpMinutes * 60_000) {
    throw new AppError(403, 'step_up_required', 'Confirma tu código de verificación para continuar.');
  }
}
