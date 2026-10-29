import { eq } from 'drizzle-orm';
import { normalizePlatformPermissions, type PlatformPermission } from '@xiro/shared';
import type { DbExecutor } from '../db/client';
import { platformAdminSessions, platformAdmins, platformAuditLog } from '../db/schema';
import { hashPassword, readableTempPassword } from '../security';
import { encryptSecret, newTotpSecret, otpauthUri } from './crypto';

/**
 * Alta y mantenimiento de administradores. SOLO se usa desde la consola del servidor (scripts/platform-admin.ts): no hay
 * ninguna ruta HTTP que cree administradores o les dé permisos, así que nadie puede escalar privilegios desde la API.
 */

export interface Enrollment {
  email: string;
  /** Se muestran UNA vez en la consola; no se guardan en claro en ningún sitio. */
  password: string;
  otpauthUri: string;
  totpSecret: string;
}

const MIN_PASSWORD = 14;

function resolvePassword(provided?: string): string {
  if (provided === undefined) return readableTempPassword(20);
  if (provided.length < MIN_PASSWORD) throw new Error(`La contraseña de administrador debe tener al menos ${MIN_PASSWORD} caracteres.`);
  return provided;
}

async function cliAudit(db: DbExecutor, adminId: string, action: string, details: Record<string, unknown> = {}) {
  await db.insert(platformAuditLog).values({ adminId, action: `cli.${action}`, outcome: 'success', requestId: 'cli', details });
}

export async function createAdmin(
  db: DbExecutor,
  adminKey: string,
  input: { email: string; name: string; founder?: boolean; permissions?: string[]; password?: string },
): Promise<Enrollment> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Correo inválido.');
  const password = resolvePassword(input.password);
  const secret = newTotpSecret();
  const permissions: PlatformPermission[] = normalizePlatformPermissions(input.permissions ?? []);
  const [row] = await db
    .insert(platformAdmins)
    .values({ email, name: input.name.trim(), passwordHash: await hashPassword(password), totpSecretEnc: encryptSecret(adminKey, secret), isFounder: Boolean(input.founder), permissions })
    .returning({ id: platformAdmins.id });
  await cliAudit(db, row!.id, 'create_admin', { founder: Boolean(input.founder), permissions });
  return { email, password, otpauthUri: otpauthUri(secret, email), totpSecret: secret };
}

async function findAdmin(db: DbExecutor, email: string) {
  const [row] = await db.select().from(platformAdmins).where(eq(platformAdmins.email, email.trim().toLowerCase())).limit(1);
  if (!row) throw new Error('No existe un administrador con ese correo.');
  return row;
}

const revokeAll = (db: DbExecutor, adminId: string) => db.update(platformAdminSessions).set({ revokedAt: new Date() }).where(eq(platformAdminSessions.adminId, adminId));

export async function resetAdminPassword(db: DbExecutor, email: string, password?: string): Promise<string> {
  const admin = await findAdmin(db, email);
  const next = resolvePassword(password);
  await db.update(platformAdmins).set({ passwordHash: await hashPassword(next), updatedAt: new Date() }).where(eq(platformAdmins.id, admin.id));
  await revokeAll(db, admin.id);
  await cliAudit(db, admin.id, 'reset_password');
  return next;
}

export async function resetAdminMfa(db: DbExecutor, adminKey: string, email: string): Promise<{ otpauthUri: string; totpSecret: string }> {
  const admin = await findAdmin(db, email);
  const secret = newTotpSecret();
  await db.update(platformAdmins).set({ totpSecretEnc: encryptSecret(adminKey, secret), totpLastStep: 0, updatedAt: new Date() }).where(eq(platformAdmins.id, admin.id));
  await revokeAll(db, admin.id);
  await cliAudit(db, admin.id, 'reset_mfa');
  return { otpauthUri: otpauthUri(secret, admin.email), totpSecret: secret };
}

export async function setAdminActive(db: DbExecutor, email: string, active: boolean): Promise<void> {
  const admin = await findAdmin(db, email);
  await db.update(platformAdmins).set({ active, updatedAt: new Date() }).where(eq(platformAdmins.id, admin.id));
  if (!active) await revokeAll(db, admin.id);
  await cliAudit(db, admin.id, active ? 'enable_admin' : 'disable_admin');
}

export async function setAdminPermissions(db: DbExecutor, email: string, permissions: string[]): Promise<PlatformPermission[]> {
  const admin = await findAdmin(db, email);
  const normalized = normalizePlatformPermissions(permissions);
  await db.update(platformAdmins).set({ permissions: normalized, updatedAt: new Date() }).where(eq(platformAdmins.id, admin.id));
  await cliAudit(db, admin.id, 'set_permissions', { before: admin.permissions, after: normalized });
  return normalized;
}

export async function listAdmins(db: DbExecutor) {
  return db.select({ email: platformAdmins.email, name: platformAdmins.name, isFounder: platformAdmins.isFounder, permissions: platformAdmins.permissions, active: platformAdmins.active, createdAt: platformAdmins.createdAt }).from(platformAdmins);
}
