import { and, asc, desc, eq, ilike, inArray, isNull, or, type SQL, sql } from 'drizzle-orm';
import {
  deriveEffectiveStatus,
  grantEnd,
  grantStart,
  maskEmail,
  maskPhone,
  subscriptionHasAccess,
  type AccessGrantDto,
  type BusinessAccessStatus,
  type PlatformAuditEntryDto,
  type PlatformBusinessDetail,
  type PlatformBusinessListItem,
  type PlatformBusinessListQuery,
  type PlatformBusinessListResult,
  type PlatformBusinessSummary,
  type PlatformCreateBusinessInput,
  type PlatformCreateBusinessResult,
  type PlatformDeletedBusinessDto,
  type PlatformGrantInput,
  type PlatformGrantPreview,
  type PlatformSearchKind,
  type PlatformSearchResult,
  type SubscriptionStatus,
} from '@xiro/shared';
import type { FastifyRequest } from 'fastify';
import { createBusinessWithOwner } from '../accounts';
import type { Database, DbExecutor } from '../db/client';
import { businessAccessGrants, businessSlugHistory, businesses, platformAdmins, platformAuditLog, refreshTokens, subscriptions, users } from '../db/schema';
import { isUniqueViolation } from '../db/errors';
import { AppError, isUuid, notFound } from '../errors';
import { mediaUrl } from '../media';
import { escapeLike } from '../pagination';
import { hashPassword, randomToken } from '../security';
import { recordPlatformAudit } from './audit';
import { accessGrantStatus } from './grants';

const SEARCH_LIMIT = 20;
const HISTORY_LIMIT = 50;
const GRANTS_LIMIT = 50;

type BusinessRow = typeof businesses.$inferSelect;

const summary = (b: Pick<BusinessRow, 'id' | 'name' | 'slug' | 'accessStatus' | 'createdAt' | 'logoFile'>): PlatformBusinessSummary => ({
  id: b.id,
  name: b.name,
  slug: b.slug,
  accessStatus: b.accessStatus as BusinessAccessStatus,
  createdAt: b.createdAt.toISOString(),
  logoUrl: b.logoFile ? mediaUrl(b.logoFile) : null,
});

const summaryColumns = { id: businesses.id, name: businesses.name, slug: businesses.slug, accessStatus: businesses.accessStatus, createdAt: businesses.createdAt, logoFile: businesses.logoFile };

/** Búsqueda acotada (máx. 20) por correo exacto de cualquier persona del negocio, nombre (contiene), id o slug exactos. */
export async function searchBusinesses(db: DbExecutor, kind: PlatformSearchKind, rawQuery: string): Promise<PlatformSearchResult> {
  const q = rawQuery.trim();
  let rows: Array<Parameters<typeof summary>[0]> = [];
  if (kind === 'id') {
    if (!isUuid(q)) return { results: [], truncated: false };
    rows = await db.select(summaryColumns).from(businesses).where(eq(businesses.id, q.toLowerCase())).limit(1);
  } else if (kind === 'slug') {
    const slug = q.toLowerCase();
    rows = await db.select(summaryColumns).from(businesses).where(eq(businesses.slug, slug)).limit(1);
    if (rows.length === 0) {
      rows = await db.select(summaryColumns).from(businessSlugHistory).innerJoin(businesses, eq(businesses.id, businessSlugHistory.businessId)).where(eq(businessSlugHistory.slug, slug)).limit(1);
    }
  } else if (kind === 'email') {
    // Índice único users_email_uq. Correo exacto (en minúsculas, como se guarda al registrarse).
    rows = await db.select(summaryColumns).from(users).innerJoin(businesses, eq(businesses.id, users.businessId)).where(eq(users.email, q.toLowerCase())).limit(SEARCH_LIMIT + 1);
  } else {
    if (q.length < 2) return { results: [], truncated: false };
    rows = await db
      .select(summaryColumns)
      .from(businesses)
      .where(ilike(businesses.name, `%${escapeLike(q)}%`))
      .orderBy(desc(businesses.createdAt), desc(businesses.id))
      .limit(SEARCH_LIMIT + 1);
  }
  return { results: rows.slice(0, SEARCH_LIMIT).map(summary), truncated: rows.length > SEARCH_LIMIT };
}

const LIST_SORTS: Record<PlatformBusinessListQuery['sort'], SQL> = {
  name_asc: asc(businesses.name),
  name_desc: desc(businesses.name),
  created_asc: asc(businesses.createdAt),
  created_desc: desc(businesses.createdAt),
};

/**
 * Página de TODOS los negocios (pantalla "Ver más" de Negocios registrados), con búsqueda y orden opcionales.
 * `q` sin "kind" explícito: id exacto (si parece un uuid), correo exacto de cualquier persona del negocio (si trae
 * "@", mismo alcance que `searchBusinesses(kind: 'email')`), o si no, nombre (contiene) o slug (exacto).
 */
export async function listBusinesses(db: DbExecutor, query: PlatformBusinessListQuery): Promise<PlatformBusinessListResult> {
  const q = query.q?.trim();
  let where: SQL | undefined;
  if (q) {
    // `isUuid` es un type guard hacia `string`; con `q` ya en `string`, TypeScript sigue el alias hasta `q` y reduce el
    // `else` a `never`, incluso guardando el resultado aparte. Se widening a `unknown` para la comprobación rompe ese alias.
    if (isUuid(q as unknown)) {
      where = eq(businesses.id, q.toLowerCase());
    } else if (q.includes('@')) {
      const matches = await db.select({ id: users.businessId }).from(users).where(eq(users.email, q.toLowerCase()));
      const ids = [...new Set(matches.map((m) => m.id))];
      where = ids.length > 0 ? inArray(businesses.id, ids) : sql`false`;
    } else {
      where = or(ilike(businesses.name, `%${escapeLike(q)}%`), eq(businesses.slug, q.toLowerCase()));
    }
  }

  const [countRow] = await db.select({ total: sql<number>`count(*)::int` }).from(businesses).where(where);
  const total = countRow?.total ?? 0;
  const rows = await db
    .select(summaryColumns)
    .from(businesses)
    .where(where)
    .orderBy(LIST_SORTS[query.sort], desc(businesses.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);

  // Dueño más antiguo de cada negocio de esta página, en un solo viaje (no uno por fila).
  const ids = rows.map((r) => r.id);
  const owners =
    ids.length === 0 ? [] : await db.select({ businessId: users.businessId, email: users.email, createdAt: users.createdAt }).from(users).where(and(inArray(users.businessId, ids), eq(users.role, 'owner')));
  const firstOwnerEmail = new Map<string, string | null>();
  for (const o of [...owners].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    if (!firstOwnerEmail.has(o.businessId)) firstOwnerEmail.set(o.businessId, o.email);
  }

  const results: PlatformBusinessListItem[] = rows.map((r) => ({ ...summary(r), ownerEmailMasked: maskEmail(firstOwnerEmail.get(r.id) ?? null) }));
  return { results, page: query.page, pageSize: query.pageSize, total, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) };
}

/** Misma regla de acceso que GET /api/subscription (deriveEffectiveStatus + subscriptionHasAccess), SIN escribir nada. */
function paidSubscription(row: typeof subscriptions.$inferSelect | undefined, now: Date) {
  if (!row) return { status: 'none' as const, row: null, paidAccess: false };
  const status = deriveEffectiveStatus({ status: row.status as SubscriptionStatus, trialEndsAt: row.trialEndsAt, currentPeriodEnd: row.currentPeriodEnd, gracePeriodEndsAt: row.gracePeriodEndsAt }, now);
  // Recién vencida (trial/activa -> past_due) y sin fecha de gracia: GET /api/subscription le abriría la gracia completa en
  // ese momento, así que tiene acceso. Aquí solo se informa (el panel no modifica la fila).
  const entersGraceNow = status === 'past_due' && row.status !== 'past_due' && !row.gracePeriodEndsAt;
  const paidAccess = entersGraceNow || subscriptionHasAccess(status, row.gracePeriodEndsAt, now);
  return { status, row, paidAccess };
}

async function loadGrants(db: DbExecutor, businessId: string): Promise<AccessGrantDto[]> {
  const rows = await db
    .select({ g: businessAccessGrants, adminName: platformAdmins.name })
    .from(businessAccessGrants)
    .innerJoin(platformAdmins, eq(platformAdmins.id, businessAccessGrants.adminId))
    .where(eq(businessAccessGrants.businessId, businessId))
    .orderBy(desc(businessAccessGrants.createdAt))
    .limit(GRANTS_LIMIT);
  return rows.map(({ g, adminName }) => ({
    id: g.id,
    unit: g.unit as 'days' | 'months',
    amount: g.amount,
    startsAt: g.startsAt.toISOString(),
    endsAt: g.endsAt.toISOString(),
    reason: g.reason,
    supportRef: g.supportRef,
    createdAt: g.createdAt.toISOString(),
    adminName,
    revokedAt: g.revokedAt?.toISOString() ?? null,
    revokeReason: g.revokeReason,
  }));
}

export async function loadAuditEntries(db: DbExecutor, where: { businessId?: string; limit: number; before?: Date }): Promise<PlatformAuditEntryDto[]> {
  const conditions = [where.businessId ? eq(platformAuditLog.businessId, where.businessId) : undefined, where.before ? sql`${platformAuditLog.createdAt} < ${where.before}` : undefined].filter(Boolean);
  const rows = await db
    .select({ a: platformAuditLog, adminName: platformAdmins.name })
    .from(platformAuditLog)
    .leftJoin(platformAdmins, eq(platformAdmins.id, platformAuditLog.adminId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(platformAuditLog.createdAt))
    .limit(where.limit);
  return rows.map(({ a, adminName }) => ({
    id: a.id,
    action: a.action,
    outcome: a.outcome as PlatformAuditEntryDto['outcome'],
    adminName,
    businessId: a.businessId,
    details: a.details,
    createdAt: a.createdAt.toISOString(),
  }));
}

/** Acción con la que `accountDeletion.ts` registra la eliminación que hace un dueño de su propio negocio. */
export const BUSINESS_SELF_DELETE_ACTION = 'business.self_delete';

function detailString(details: Record<string, unknown>, key: string): string | null {
  const value = details[key];
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/**
 * Negocios eliminados por su propio dueño (panel del fundador) — ver accountDeletion.ts. El negocio ya no existe
 * (se borró de verdad), así que todo lo que se muestra sale de `details` guardado al momento del borrado, NUNCA de
 * un JOIN a `businesses`; un campo ausente se muestra como tal (`null`), nunca inventado.
 */
export async function loadDeletedBusinesses(db: DbExecutor, where: { limit: number; before?: Date }): Promise<PlatformDeletedBusinessDto[]> {
  const conditions = [eq(platformAuditLog.action, BUSINESS_SELF_DELETE_ACTION), where.before ? sql`${platformAuditLog.createdAt} < ${where.before}` : undefined].filter(Boolean);
  const rows = await db
    .select()
    .from(platformAuditLog)
    .where(and(...conditions))
    .orderBy(desc(platformAuditLog.createdAt))
    .limit(where.limit);
  return rows.map((row) => {
    const details = row.details ?? {};
    return {
      id: row.id,
      businessId: row.businessId,
      businessName: detailString(details, 'businessName'),
      requestedByUserId: detailString(details, 'requestedByUserId'),
      requestedByName: detailString(details, 'requestedByName'),
      requestedByEmail: detailString(details, 'requestedByEmail'),
      requestedByRole: detailString(details, 'requestedByRole'),
      outcome: row.outcome === 'error' ? 'error' : 'success',
      createdAt: row.createdAt.toISOString(),
    };
  });
}

/** Ficha de un negocio. Toda consulta va acotada por `business_id` (el id validado de la URL). */
export async function businessDetail(db: DbExecutor, businessId: string, now: Date = new Date()): Promise<PlatformBusinessDetail> {
  const [business] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!business) throw notFound();
  const asOf = now.toISOString();

  const [counts] = await db
    .select({
      owners: sql<number>`count(*) filter (where ${users.role} = 'owner')::int`,
      employeesActive: sql<number>`count(*) filter (where ${users.role} = 'employee' and ${users.active})::int`,
      employeesInactive: sql<number>`count(*) filter (where ${users.role} = 'employee' and not ${users.active})::int`,
    })
    .from(users)
    .where(eq(users.businessId, businessId));
  const owners = await db.select({ name: users.name, email: users.email, phone: users.phone }).from(users).where(and(eq(users.businessId, businessId), eq(users.role, 'owner'))).limit(5);
  const [activity] = await db
    .select({ last: sql<Date | null>`max(${refreshTokens.createdAt})` })
    .from(refreshTokens)
    .innerJoin(users, eq(users.id, refreshTokens.userId))
    .where(eq(users.businessId, businessId));
  const [subRow] = await db.select().from(subscriptions).where(eq(subscriptions.businessId, businessId)).limit(1);
  const paid = paidSubscription(subRow, now);
  const grant = await accessGrantStatus(db, businessId, now);
  const lastActivity = activity?.last ? new Date(activity.last) : null;

  return {
    ...summary(business),
    type: business.type,
    city: business.city,
    country: business.country,
    timezone: business.timezone,
    accessStatusChangedAt: business.accessStatusChangedAt?.toISOString() ?? null,
    owners: owners.map((o) => ({ name: o.name, emailMasked: maskEmail(o.email), phoneMasked: maskPhone(o.phone) })),
    lastActivityAt: {
      state: lastActivity ? 'ok' : 'unavailable',
      value: lastActivity?.toISOString() ?? null,
      source: 'refresh_tokens.created_at de las personas del negocio',
      formula: 'Máximo de la fecha de emisión de sesiones (inicio de sesión o renovación cada ~15 min de uso).',
      asOf,
      note: 'Cerrar sesión o detectar robo borra esos registros: puede subestimar la actividad. Sin registros = desconocida, no "nunca".',
    },
    subscription: {
      status: paid.status,
      plan: paid.row?.plan ?? null,
      platform: paid.row?.platform ?? null,
      paymentMethod: paid.row?.paymentMethod ?? null,
      trialEndsAt: paid.row?.trialEndsAt?.toISOString() ?? null,
      currentPeriodEnd: paid.row?.currentPeriodEnd?.toISOString() ?? null,
      gracePeriodEndsAt: paid.row?.gracePeriodEndsAt?.toISOString() ?? null,
      cancelAtPeriodEnd: paid.row?.cancelAtPeriodEnd ?? false,
      paidAccess: paid.paidAccess,
    },
    grantAccessEndsAt: grant.until?.toISOString() ?? null,
    effectiveAccess: business.accessStatus === 'active' && (paid.paidAccess || grant.coversNow),
    employees: {
      state: 'ok',
      value: { owners: counts?.owners ?? 0, employeesActive: counts?.employeesActive ?? 0, employeesInactive: counts?.employeesInactive ?? 0 },
      source: 'users (business_id = este negocio)',
      formula: "Dueños: role = 'owner'. Empleados activos: role = 'employee' y active. Inactivos: role = 'employee' y no active (desactivados por el dueño).",
      asOf,
    },
    employeeHistory: {
      state: 'unavailable',
      value: null,
      source: 'users',
      formula: '—',
      asOf,
      note: 'No se registra cuándo se desactiva o reactiva un empleado: no hay historial confiable para graficar. Solo el conteo actual.',
    },
    incidents: {
      state: 'unavailable',
      value: null,
      source: '—',
      formula: '—',
      asOf,
      note: 'Los errores (Sentry/logs) no se guardan por negocio en la base: no se pueden vincular de forma verificable.',
    },
    grants: await loadGrants(db, businessId),
    history: await loadAuditEntries(db, { businessId, limit: HISTORY_LIMIT }),
  };
}

/* ---------- Cambios de acceso: suspender, reactivar, baja lógica, recuperar ---------- */

export type StatusAction = 'suspend' | 'reactivate' | 'deactivate' | 'restore';

const TRANSITIONS: Record<StatusAction, { from: BusinessAccessStatus[]; to: BusinessAccessStatus }> = {
  suspend: { from: ['active'], to: 'suspended' },
  reactivate: { from: ['suspended'], to: 'active' },
  deactivate: { from: ['active', 'suspended'], to: 'deactivated' },
  restore: { from: ['deactivated'], to: 'active' },
};

async function lockBusiness(tx: DbExecutor, businessId: string, confirmSlug: string): Promise<BusinessRow> {
  const [business] = await tx.select().from(businesses).where(eq(businesses.id, businessId)).for('update').limit(1);
  if (!business) throw notFound();
  // Confirmación reforzada: el slug escrito a mano debe coincidir con el del negocio que se va a tocar.
  if (confirmSlug.trim().toLowerCase() !== business.slug) throw new AppError(422, 'confirmation_mismatch', 'El texto de confirmación no coincide con el negocio.');
  return business;
}

/**
 * Cambia el acceso de un negocio. En UNA transacción: bloqueo de la fila, transición válida, cambio, cierre de las sesiones
 * de todas sus personas (si deja de estar activo) y registro de auditoría con valores anteriores y nuevos. NO toca la
 * suscripción ni el proveedor de pagos, ni borra datos.
 */
export async function changeAccessStatus(
  db: Database,
  request: FastifyRequest,
  businessId: string,
  action: StatusAction,
  input: { reason: string; confirmSlug: string },
  now: Date = new Date(),
): Promise<{ from: BusinessAccessStatus; to: BusinessAccessStatus; sessionsRevoked: number }> {
  const rule = TRANSITIONS[action];
  return db.transaction(async (tx) => {
    const business = await lockBusiness(tx, businessId, input.confirmSlug);
    const from = business.accessStatus as BusinessAccessStatus;
    if (!rule.from.includes(from)) throw new AppError(409, 'invalid_transition', `No se puede ${action} un negocio en estado ${from}.`);
    await tx.update(businesses).set({ accessStatus: rule.to, accessStatusChangedAt: now }).where(eq(businesses.id, businessId));
    let sessionsRevoked = 0;
    if (rule.to !== 'active') {
      // Sesiones abiertas: los refresh tokens se borran (no pueden renovarse) y cada petición con un access token vigente ya
      // se rechaza en `authenticate` porque lee el estado del negocio en cada petición.
      const people = tx.select({ id: users.id }).from(users).where(eq(users.businessId, businessId));
      const deleted = await tx.delete(refreshTokens).where(inArray(refreshTokens.userId, people)).returning({ hash: refreshTokens.tokenHash });
      sessionsRevoked = deleted.length;
    }
    await recordPlatformAudit(tx, request, {
      adminId: request.platformAdmin.id,
      action: `business.${action}`,
      businessId,
      outcome: 'success',
      details: {
        before: { accessStatus: from },
        after: { accessStatus: rule.to },
        reason: input.reason,
        sessionsRevoked,
        ...(action === 'deactivate' ? { physicalDeletion: 'no_programada: no existe política aprobada de conservación y borrado' } : {}),
      },
    });
    return { from, to: rule.to, sessionsRevoked };
  });
}

/* ---------- Concesiones de acceso ---------- */

/**
 * Ventana de una concesión nueva: empieza en lo más tardío entre ahora, el fin de la última concesión vigente y el fin del
 * período pagado o de prueba vigente. Única fuente de la regla: la usan la concesión real y su vista previa.
 */
async function grantWindow(tx: DbExecutor, businessId: string, unit: 'days' | 'months', amount: number, now: Date) {
  const grants = await accessGrantStatus(tx, businessId, now);
  const [subRow] = await tx.select().from(subscriptions).where(eq(subscriptions.businessId, businessId)).limit(1);
  const paid = paidSubscription(subRow, now);
  const paidEnd = paid.status === 'trial' ? subRow?.trialEndsAt : paid.status === 'active' ? subRow?.currentPeriodEnd : null;
  const startsAt = grantStart(now, [grants.latestEnd, paidEnd]);
  const endsAt = grantEnd(startsAt, unit, amount);
  return { grants, paid, paidEnd: paidEnd ?? null, startsAt, endsAt };
}

/** Lo que pasaría al conceder `amount` `unit` ahora (no escribe nada). */
export async function previewAccessGrant(db: DbExecutor, businessId: string, unit: 'days' | 'months', amount: number, now: Date = new Date()): Promise<PlatformGrantPreview> {
  const [business] = await db.select({ id: businesses.id }).from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!business) throw notFound();
  const { grants, paid, paidEnd, startsAt, endsAt } = await grantWindow(db, businessId, unit, amount, now);
  const hasCurrent = startsAt.getTime() > now.getTime();
  const source: PlatformGrantPreview['currentAccessSource'] = !hasCurrent
    ? 'none'
    : grants.latestEnd && grants.latestEnd.getTime() === startsAt.getTime()
      ? 'grant'
      : paidEnd && paidEnd.getTime() === startsAt.getTime()
        ? paid.status === 'trial'
          ? 'trial'
          : 'paid'
        : 'grant';
  return { currentAccessEndsAt: hasCurrent ? startsAt.toISOString() : null, currentAccessSource: source, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() };
}

export async function createAccessGrant(db: Database, request: FastifyRequest, businessId: string, input: PlatformGrantInput, now: Date = new Date()): Promise<{ grant: AccessGrantDto; replayed: boolean }> {
  const run = () =>
    db.transaction(async (tx) => {
      // El bloqueo del negocio serializa concesiones simultáneas: cada una ve la anterior y se encadena tras ella.
      const business = await lockBusiness(tx, businessId, input.confirmSlug);
      const [existing] = await tx.select().from(businessAccessGrants).where(eq(businessAccessGrants.idempotencyKey, input.idempotencyKey)).limit(1);
      if (existing) {
        const same = existing.businessId === businessId && existing.unit === input.unit && existing.amount === input.amount;
        if (!same) throw new AppError(409, 'idempotency_conflict', 'Esa clave ya se usó para otra concesión.');
        return { id: existing.id, replayed: true };
      }
      if (business.accessStatus === 'deactivated') throw new AppError(409, 'business_deactivated', 'Recupera primero el negocio dado de baja.');

      const { grants, paid, startsAt, endsAt } = await grantWindow(tx, businessId, input.unit, input.amount, now);
      const [created] = await tx
        .insert(businessAccessGrants)
        .values({ businessId, adminId: request.platformAdmin.id, unit: input.unit, amount: input.amount, startsAt, endsAt, reason: input.reason, supportRef: input.supportRef || null, idempotencyKey: input.idempotencyKey })
        .returning({ id: businessAccessGrants.id });
      await recordPlatformAudit(tx, request, {
        adminId: request.platformAdmin.id,
        action: 'business.grant_access',
        businessId,
        outcome: 'success',
        details: {
          grantId: created!.id,
          unit: input.unit,
          amount: input.amount,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          reason: input.reason,
          supportRef: input.supportRef ?? null,
          before: {
            grantAccessUntil: grants.until?.toISOString() ?? null,
            subscriptionStatus: paid.status,
            // Hasta cuándo tenía acceso antes (fin de prueba, período pagado o cortesía); null = sin acceso vigente.
            accessEndsAt: startsAt.getTime() > now.getTime() ? startsAt.toISOString() : null,
          },
          after: { accessEndsAt: endsAt.toISOString() },
          note: 'Concesión administrativa: no es un pago ni modifica la suscripción o el proveedor.',
        },
      });
      return { id: created!.id, replayed: false };
    });
  let result: { id: string; replayed: boolean };
  try {
    result = await run();
  } catch (error) {
    // Misma clave enviada a la vez para DOS negocios distintos: el índice único deja pasar una.
    if (isUniqueViolation(error, 'access_grants_idempotency_uq')) throw new AppError(409, 'idempotency_conflict');
    throw error;
  }
  const grant = (await loadGrants(db, businessId)).find((g) => g.id === result.id);
  if (!grant) throw new AppError(500, 'internal_error');
  return { grant, replayed: result.replayed };
}

export async function revokeAccessGrant(db: Database, request: FastifyRequest, businessId: string, grantId: string, reason: string, now: Date = new Date()): Promise<void> {
  await db.transaction(async (tx) => {
    const [grant] = await tx
      .update(businessAccessGrants)
      .set({ revokedAt: now, revokedBy: request.platformAdmin.id, revokeReason: reason })
      .where(and(eq(businessAccessGrants.id, grantId), eq(businessAccessGrants.businessId, businessId), isNull(businessAccessGrants.revokedAt)))
      .returning();
    if (!grant) throw notFound();
    await recordPlatformAudit(tx, request, {
      adminId: request.platformAdmin.id,
      action: 'business.revoke_grant',
      businessId,
      outcome: 'success',
      details: { grantId, reason, before: { endsAt: grant.endsAt.toISOString(), revokedAt: null }, after: { revokedAt: now.toISOString() } },
    });
  });
}

/* ---------- Alta de un negocio desde el panel (solo el fundador) ---------- */

const CREATE_ACTION = 'business.create';

/** Alta ya procesada con esta clave (reintento, doble clic o respuesta perdida): se devuelve la misma, sin crear otra. */
async function priorCreation(db: DbExecutor, input: PlatformCreateBusinessInput): Promise<PlatformCreateBusinessResult | null> {
  const [entry] = await db
    .select({ businessId: platformAuditLog.businessId, details: platformAuditLog.details })
    .from(platformAuditLog)
    .where(and(eq(platformAuditLog.action, CREATE_ACTION), eq(platformAuditLog.outcome, 'success'), sql`${platformAuditLog.details}->>'idempotencyKey' = ${input.idempotencyKey}`))
    .limit(1);
  if (!entry?.businessId) return null;
  const [business] = await db.select(summaryColumns).from(businesses).where(eq(businesses.id, entry.businessId)).limit(1);
  const [owner] = await db.select({ email: users.email }).from(users).where(and(eq(users.businessId, entry.businessId), eq(users.role, 'owner'))).limit(1);
  // Misma clave con OTROS datos: no es un reintento de esta alta.
  if (!business || owner?.email !== input.ownerEmail) throw new AppError(409, 'idempotency_conflict', 'Esa clave ya se usó para otra alta.');
  const endsAt = entry.details.initialAccessEndsAt;
  return { business: summary(business), ownerEmailMasked: maskEmail(owner.email), initialAccessEndsAt: typeof endsAt === 'string' ? endsAt : null, replayed: true };
}

/**
 * Crea negocio + dueño (+ concesión inicial opcional) + registro en la bitácora, TODO en una transacción: o queda la
 * cuenta completa con su rastro, o nada. El dueño nace con rol `owner` sin permisos extra, en su propio negocio (nuevo
 * `business_id`), y con una contraseña aleatoria que nadie conoce ni se muestra: la pone él con la recuperación de acceso.
 */
export async function createBusinessAccount(db: Database, request: FastifyRequest, input: PlatformCreateBusinessInput, now: Date = new Date()): Promise<PlatformCreateBusinessResult> {
  const prior = await priorCreation(db, input);
  if (prior) return prior;
  try {
    const { owner, extra } = await createBusinessWithOwner(
      db,
      {
        businessName: input.businessName,
        businessType: input.businessType,
        ownerName: input.ownerName,
        email: input.ownerEmail,
        phone: null,
        passwordHash: await hashPassword(randomToken(32)),
        language: input.language,
      },
      async (tx, created) => {
        let initialAccessEndsAt: string | null = null;
        if (input.initialAccess) {
          const { startsAt, endsAt } = await grantWindow(tx, created.businessId, input.initialAccess.unit, input.initialAccess.amount, now);
          await tx.insert(businessAccessGrants).values({
            businessId: created.businessId,
            adminId: request.platformAdmin.id,
            unit: input.initialAccess.unit,
            amount: input.initialAccess.amount,
            startsAt,
            endsAt,
            reason: input.reason,
            idempotencyKey: input.idempotencyKey,
          });
          initialAccessEndsAt = endsAt.toISOString();
        }
        await recordPlatformAudit(tx, request, {
          adminId: request.platformAdmin.id,
          action: CREATE_ACTION,
          businessId: created.businessId,
          outcome: 'success',
          details: {
            idempotencyKey: input.idempotencyKey,
            businessName: input.businessName,
            businessType: input.businessType,
            ownerEmailMasked: maskEmail(input.ownerEmail),
            language: input.language,
            reason: input.reason,
            initialAccess: input.initialAccess ?? null,
            initialAccessEndsAt,
            accessSetup: 'el dueño define su contraseña con la recuperación de acceso (el panel no la conoce)',
          },
        });
        return initialAccessEndsAt;
      },
    );
    const [business] = await db.select(summaryColumns).from(businesses).where(eq(businesses.id, owner.businessId)).limit(1);
    return { business: summary(business!), ownerEmailMasked: maskEmail(owner.email), initialAccessEndsAt: extra ?? null, replayed: false };
  } catch (error) {
    // Misma clave enviada a la vez: la otra petición ganó con este mismo correo; se devuelve su resultado.
    if (error instanceof AppError && error.code === 'account_exists') {
      const raced = await priorCreation(db, input);
      if (raced) return raced;
    }
    // La clave ya la usó otra concesión: la transacción se revirtió entera (no queda cuenta a medias).
    if (isUniqueViolation(error, 'access_grants_idempotency_uq')) throw new AppError(409, 'idempotency_conflict');
    throw error;
  }
}
