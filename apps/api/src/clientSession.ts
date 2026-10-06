import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Database } from './db/client';
import { clientAccounts, clientSessions } from './db/schema';
import { hmac } from './security';
import type { BusinessRow } from './serializers';

export const CLIENT_COOKIE_NAME = 'xpc'; // "xiro public client" — el aislamiento por negocio lo da el Path de la cookie, no el nombre
export const CLIENT_SESSION_REMEMBER_TTL_MS = 180 * 24 * 60 * 60 * 1000; // "sesión permanente": 180 días, deslizante
export const CLIENT_SESSION_VISIT_TTL_MS = 24 * 60 * 60 * 1000; // sin "mantener sesión": tope de seguridad del servidor
const SLIDING_RENEWAL_MS = 60 * 60 * 1000; // no reescribe la sesión en CADA petición, solo si ha pasado al menos una hora

export type ClientAccountRow = typeof clientAccounts.$inferSelect;

export function clientSessionTokenHash(jwtSecret: string, token: string): string {
  return hmac(jwtSecret, `client-session:${token}`);
}

export function clientAccountPath(slug: string): string {
  return `/api/public/booking/${slug}`;
}

/** Cuenta de la sesión actual (cookie `xpc`), validada contra ESTE negocio; `null` sin sesión — no es un error, casi
 * toda la página pública sirve igual a invitados. Hace la renovación deslizante de la sesión de paso. */
export async function resolveClientAccount(db: Database, jwtSecret: string, cookieToken: string | undefined, business: BusinessRow): Promise<ClientAccountRow | null> {
  if (!cookieToken) return null;
  const hash = clientSessionTokenHash(jwtSecret, cookieToken);
  const now = new Date();
  const [row] = await db
    .select({ session: clientSessions, account: clientAccounts })
    .from(clientSessions)
    .innerJoin(clientAccounts, eq(clientAccounts.id, clientSessions.accountId))
    .where(and(eq(clientSessions.tokenHash, hash), isNull(clientSessions.revokedAt), gt(clientSessions.expiresAt, now)))
    .limit(1);
  if (!row || row.account.businessId !== business.id || row.account.disabledAt) return null;
  if (now.getTime() - row.session.lastUsedAt.getTime() > SLIDING_RENEWAL_MS) {
    const wasRemembered = row.session.expiresAt.getTime() - row.session.createdAt.getTime() >= CLIENT_SESSION_REMEMBER_TTL_MS - 60_000;
    const ttl = wasRemembered ? CLIENT_SESSION_REMEMBER_TTL_MS : CLIENT_SESSION_VISIT_TTL_MS;
    await db.update(clientSessions).set({ lastUsedAt: now, expiresAt: new Date(now.getTime() + ttl) }).where(eq(clientSessions.id, row.session.id));
  }
  return row.account;
}
