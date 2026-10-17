import { and, asc, eq, gt, isNull } from 'drizzle-orm';
import type { DbExecutor } from '../db/client';
import { businessAccessGrants } from '../db/schema';

/**
 * Estado de las concesiones de acceso de un negocio en `now`. Las concesiones se encadenan (cada una empieza donde termina
 * la anterior, ver grantStart en @xiro/shared), pero una revocada en medio deja un hueco: por eso se recorre la cadena desde
 * AHORA y `until` es el fin del tramo continuo que cubre este instante (no simplemente la fecha más lejana).
 */
export async function accessGrantStatus(db: DbExecutor, businessId: string, now: Date = new Date()): Promise<{ coversNow: boolean; until: Date | null; latestEnd: Date | null }> {
  const rows = await db
    .select({ startsAt: businessAccessGrants.startsAt, endsAt: businessAccessGrants.endsAt })
    .from(businessAccessGrants)
    .where(and(eq(businessAccessGrants.businessId, businessId), isNull(businessAccessGrants.revokedAt), gt(businessAccessGrants.endsAt, now)))
    .orderBy(asc(businessAccessGrants.startsAt))
    .limit(200);
  const latestEnd = rows.reduce<Date | null>((max, r) => (!max || r.endsAt > max ? r.endsAt : max), null);
  let until: Date | null = null;
  for (const row of rows) {
    const reachable = until ?? now;
    if (row.startsAt.getTime() > reachable.getTime()) break; // hueco: lo que sigue no cubre el presente
    if (!until || row.endsAt > until) until = row.endsAt;
  }
  return { coversNow: until !== null, until, latestEnd };
}
