import { and, asc, eq, gt, isNull } from 'drizzle-orm';
import type { DbExecutor } from '../db/client';
import { businessAccessGrants } from '../db/schema';

/**
 * Estado de las concesiones de acceso de un negocio en `now`. Las concesiones se encadenan (cada una empieza donde termina
 * la anterior, ver grantStart en @xiro/shared), pero una revocada en medio deja un hueco: por eso se recorre la cadena desde
 * AHORA y `until` es el fin del tramo continuo que cubre este instante (no simplemente la fecha más lejana).
 */
export async function accessGrantStatus(
  db: DbExecutor,
  businessId: string,
  now: Date = new Date(),
): Promise<{ coversNow: boolean; until: Date | null; latestEnd: Date | null; upcoming: { startsAt: Date; endsAt: Date } | null }> {
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
  // Cortesía PROGRAMADA (aún no cubre el presente, p. ej. concedida a un negocio que paga o está en prueba: empieza cuando
  // termina ese período). Se informa el primer tramo continuo para que el negocio sepa que la tiene y hasta cuándo.
  let upcoming: { startsAt: Date; endsAt: Date } | null = null;
  if (until === null && rows.length > 0) {
    upcoming = { startsAt: rows[0]!.startsAt, endsAt: rows[0]!.endsAt };
    for (const row of rows.slice(1)) {
      if (row.startsAt.getTime() > upcoming.endsAt.getTime()) break;
      if (row.endsAt > upcoming.endsAt) upcoming.endsAt = row.endsAt;
    }
  }
  return { coversNow: until !== null, until, latestEnd, upcoming };
}
