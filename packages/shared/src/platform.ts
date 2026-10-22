import { z } from 'zod';
import type { SubscriptionStatus } from './subscription';

/**
 * Panel del fundador / administración de la PLATAFORMA (no de un negocio). Contrato compartido entre la API
 * (apps/api/src/routes/platform.ts) y la app (apps/mobile/src/app/platform). Ver docs/platform-admin.md.
 */

/** Permisos de plataforma. Por defecto-denegar: un administrador sin el permiso recibe 403 (el fundador los tiene todos). */
export const PLATFORM_PERMISSIONS = [
  /** Indicadores agregados de la plataforma (sin datos personales). */
  'metrics_view',
  /** Buscar negocios y ver su ficha (incluye el correo del dueño, enmascarado). Cada consulta queda en la bitácora. */
  'businesses_view',
  /** Suspender y reactivar el acceso de un negocio. */
  'business_access_manage',
  /** Conceder (o revocar) días/meses de acceso de cortesía. */
  'business_extend',
  /** Baja lógica (desactivación recuperable) y su recuperación. Acción de máximo riesgo. */
  'business_deactivate',
  /** Leer la bitácora de la plataforma. */
  'audit_view',
] as const;
export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[number];

export const normalizePlatformPermissions = (raw: unknown): PlatformPermission[] =>
  Array.isArray(raw) ? PLATFORM_PERMISSIONS.filter((p) => raw.includes(p)) : [];

/** Acceso a XIRO decidido por la plataforma. Independiente del pago (eso es `Subscription`). */
export const BUSINESS_ACCESS_STATUSES = ['active', 'suspended', 'deactivated'] as const;
export type BusinessAccessStatus = (typeof BUSINESS_ACCESS_STATUSES)[number];

export interface PlatformAdminDto {
  id: string;
  name: string;
  email: string;
  isFounder: boolean;
  permissions: PlatformPermission[];
}

export interface PlatformSessionDto {
  token: string;
  expiresAt: string;
  admin: PlatformAdminDto;
}

/* ---------- Indicadores: siempre con su fuente, fórmula y estado ---------- */

/**
 * `ok`: valor consultado ahora (un 0 con `ok` es un cero real). `unavailable`: no existe una fuente confiable para calcularlo.
 * `unknown`: hay algo configurado pero no se puede comprobar de verdad. `error`: la consulta falló (no se inventa un valor).
 */
export type IndicatorState = 'ok' | 'unavailable' | 'unknown' | 'error';

export interface Indicator<T> {
  state: IndicatorState;
  value: T | null;
  /** De dónde sale (tabla, proceso…). */
  source: string;
  /** Cómo se calcula, en palabras. */
  formula: string;
  /** Hora UTC en que se consultó. */
  asOf: string;
  /** Advertencias de alcance (p. ej. "solo esta instancia, desde su arranque"). */
  note?: string;
}

export type SubscriptionBreakdown = Record<SubscriptionStatus | 'none', number> & { withAccess: number };

export interface HealthCheck {
  name: string;
  state: 'up' | 'down' | 'not_configured' | 'unknown';
  latencyMs: number | null;
  detail: string;
}

export interface TrafficSnapshot {
  /** Arranque del proceso que respondió. */
  since: string;
  requests: number;
  errors4xx: number;
  errors5xx: number;
  /** Cotas superiores del bucket del histograma donde cae el percentil (aproximado, no exacto). */
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
}

export interface PlatformOverview {
  generatedAt: string;
  period: { from: string; to: string; timezone: string };
  businesses: {
    total: Indicator<number>;
    byAccessStatus: Indicator<Record<BusinessAccessStatus, number>>;
    newInPeriod: Indicator<number>;
  };
  subscriptions: {
    byStatus: Indicator<SubscriptionBreakdown>;
    renewingNext7Days: Indicator<number>;
    cancelAtPeriodEnd: Indicator<number>;
    activeAccessGrants: Indicator<number>;
    paymentsInPeriod: Indicator<Array<{ currency: string; count: number; amount: number }>>;
  };
  health: HealthCheck[];
  traffic: Indicator<TrafficSnapshot>;
  databasePool: Indicator<{ total: number; idle: number; waiting: number }>;
  /** Indicadores pedidos que NO se pueden calcular hoy, y por qué. */
  unavailable: Array<{ key: string; reason: string }>;
}

export const PLATFORM_SERIES = ['new_businesses', 'trials_started', 'payments', 'access_grants'] as const;
export type PlatformSeries = (typeof PLATFORM_SERIES)[number];
export const PLATFORM_GROUPINGS = ['day', 'week', 'month'] as const;
export type PlatformGrouping = (typeof PLATFORM_GROUPINGS)[number];
/** Tope de barras por gráfica: evita consultas y respuestas desmedidas. */
export const PLATFORM_MAX_BUCKETS: Record<PlatformGrouping, number> = { day: 400, week: 260, month: 120 };

export interface PlatformSeriesDto {
  metric: PlatformSeries;
  grouping: PlatformGrouping;
  timezone: string;
  /** Inicio de cada período en la zona pedida (AAAA-MM-DD). Un 0 es un cero real: la fuente registra cada evento con su fecha. */
  buckets: Array<{ start: string; value: number }>;
  source: string;
  formula: string;
  asOf: string;
}

/* ---------- Negocios ---------- */

export const PLATFORM_SEARCH_KINDS = ['email', 'name', 'id', 'slug'] as const;
export type PlatformSearchKind = (typeof PLATFORM_SEARCH_KINDS)[number];

export interface PlatformBusinessSummary {
  id: string;
  name: string;
  slug: string;
  accessStatus: BusinessAccessStatus;
  createdAt: string;
  /** Logo del negocio (el mismo que usa su página pública), ya resuelto a una URL; `null` si no subió uno. */
  logoUrl: string | null;
}

export interface PlatformSearchResult {
  results: PlatformBusinessSummary[];
  /** true = hay más coincidencias que el límite: afina la búsqueda. */
  truncated: boolean;
}

/* ---------- Listado paginado (pantalla "Ver más" de Negocios registrados) ---------- */

export const PLATFORM_BUSINESS_SORTS = ['name_asc', 'name_desc', 'created_desc', 'created_asc'] as const;
export type PlatformBusinessSort = (typeof PLATFORM_BUSINESS_SORTS)[number];

export const PLATFORM_BUSINESS_LIST_PAGE_SIZE_MAX = 50;

export interface PlatformBusinessListItem extends PlatformBusinessSummary {
  /** Correo del dueño más antiguo del negocio, ENMASCARADO (misma política que la ficha: ver `owners[].emailMasked` en
   * `PlatformBusinessDetail`). `null` si el negocio no tiene ningún dueño con correo registrado. */
  ownerEmailMasked: string | null;
}

export interface PlatformBusinessListResult {
  results: PlatformBusinessListItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/**
 * `q`: coincide por id exacto (si parece un uuid), por correo exacto de cualquier persona del negocio (si contiene "@",
 * mismo alcance que `GET /businesses/search?kind=email`) o, si no, por nombre (contiene) o slug (exacto). Sin "kind"
 * explícito: una sola caja de búsqueda para la lista, igual que pide la pantalla.
 */
export const platformBusinessListQuerySchema = z
  .object({
    q: z.string().trim().max(254).optional(),
    sort: z.enum(PLATFORM_BUSINESS_SORTS).default('created_desc'),
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(PLATFORM_BUSINESS_LIST_PAGE_SIZE_MAX).default(25),
  })
  .strict();
export type PlatformBusinessListQuery = z.infer<typeof platformBusinessListQuerySchema>;

export interface AccessGrantDto {
  id: string;
  unit: 'days' | 'months';
  amount: number;
  startsAt: string;
  endsAt: string;
  reason: string;
  supportRef: string | null;
  createdAt: string;
  adminName: string;
  revokedAt: string | null;
  revokeReason: string | null;
}

export interface PlatformAuditEntryDto {
  id: string;
  action: string;
  outcome: 'success' | 'denied' | 'error';
  adminName: string | null;
  businessId: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}

/**
 * Una fila de "negocios eliminados" (panel del fundador): el dueño eliminó su propio negocio desde /profile — ver
 * accountDeletion.ts. Sale del mismo `platform_audit_log` que `PlatformAuditEntryDto` (acción `business.self_delete`),
 * ya con sus campos reconocidos; `null` = ese dato no estaba disponible (nunca se inventa).
 */
export interface PlatformDeletedBusinessDto {
  id: string;
  businessId: string | null;
  businessName: string | null;
  requestedByUserId: string | null;
  requestedByName: string | null;
  requestedByEmail: string | null;
  requestedByRole: string | null;
  outcome: 'success' | 'error';
  createdAt: string;
}

export interface PlatformBusinessDetail extends PlatformBusinessSummary {
  type: string;
  city: string;
  country: string;
  timezone: string;
  accessStatusChangedAt: string | null;
  /** Dueño(s): nombre y correo ENMASCARADO (para confirmar que es la cuenta correcta, sin exponerlo completo). */
  owners: Array<{ name: string; emailMasked: string | null; phoneMasked: string | null }>;
  /** Última renovación de sesión conocida de cualquier persona del negocio (refresh_tokens). Puede subestimar: cerrar sesión borra el registro. */
  lastActivityAt: Indicator<string>;
  /** Suscripción calculada con la misma regla que el resto del sistema, sin modificarla. */
  subscription: {
    status: SubscriptionStatus | 'none';
    plan: string | null;
    platform: string | null;
    paymentMethod: string | null;
    trialEndsAt: string | null;
    currentPeriodEnd: string | null;
    gracePeriodEndsAt: string | null;
    cancelAtPeriodEnd: boolean;
    paidAccess: boolean;
  };
  /** Concesión vigente (si hay) y acceso total resultante (pago O concesión, y siempre que el negocio no esté suspendido/desactivado). */
  grantAccessEndsAt: string | null;
  effectiveAccess: boolean;
  employees: Indicator<{ owners: number; employeesActive: number; employeesInactive: number }>;
  employeeHistory: Indicator<never>;
  incidents: Indicator<never>;
  grants: AccessGrantDto[];
  history: PlatformAuditEntryDto[];
}

/* ---------- Entradas (validadas igual en la API y en la app) ---------- */

const reason = z.string().trim().min(10, 'reason_too_short').max(500);
/** Confirmación reforzada: hay que escribir el slug exacto del negocio. */
const confirmSlug = z.string().trim().min(1).max(60);

export const platformLoginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(200),
  totp: z.string().regex(/^\d{6}$/),
});
export const platformStepUpSchema = z.object({ totp: z.string().regex(/^\d{6}$/) });

export const platformStatusChangeSchema = z.object({ reason, confirmSlug }).strict();

export const platformGrantSchema = z
  .object({
    unit: z.enum(['days', 'months']),
    amount: z.number().int().min(1),
    reason,
    supportRef: z.string().trim().max(120).optional(),
    /** Generada por la app UNA vez por formulario: un reintento o doble clic con la misma clave no duplica la concesión. */
    idempotencyKey: z.uuid(),
    confirmSlug,
  })
  .strict()
  .refine((v) => (v.unit === 'days' ? v.amount <= 366 : v.amount <= 24), { message: 'amount_out_of_range', path: ['amount'] });
export type PlatformGrantInput = z.infer<typeof platformGrantSchema>;

export const platformRevokeGrantSchema = z.object({ reason }).strict();

/** Vista previa de una concesión (mismas reglas que al concederla; no escribe nada). */
export const platformGrantPreviewQuerySchema = z
  .object({ unit: z.enum(['days', 'months']), amount: z.coerce.number().int().min(1) })
  .strict()
  .refine((v) => (v.unit === 'days' ? v.amount <= 366 : v.amount <= 24), { message: 'amount_out_of_range', path: ['amount'] });

export interface PlatformGrantPreview {
  /** Hasta cuándo tiene acceso hoy (pago, prueba o cortesía vigente); null = sin acceso vigente. */
  currentAccessEndsAt: string | null;
  /** De dónde sale esa fecha. */
  currentAccessSource: 'trial' | 'paid' | 'grant' | 'none';
  startsAt: string;
  endsAt: string;
}

/**
 * Alta de un negocio desde el panel (solo el fundador). El fundador NUNCA fija ni ve la contraseña: la cuenta nace con una
 * contraseña aleatoria que nadie conoce y el dueño pone la suya con "¿Olvidaste tu contraseña?" (código a su correo).
 * `.strict()`: cualquier campo extra (rol, permisos, negocio…) se rechaza (sin asignación masiva).
 */
export const platformCreateBusinessSchema = z
  .object({
    businessName: z.string().trim().min(2, 'required').max(80),
    businessType: z.enum(['barbershop', 'beauty_salon', 'spa', 'nails', 'other']),
    ownerName: z.string().trim().min(2, 'required').max(80),
    ownerEmail: z.string().trim().toLowerCase().max(254).pipe(z.email('email_invalid')),
    language: z.enum(['es', 'en']),
    /** Acceso inicial de cortesía opcional (una concesión normal: no es un pago). */
    initialAccess: z
      .object({ unit: z.enum(['days', 'months']), amount: z.number().int().min(1) })
      .strict()
      .refine((v) => (v.unit === 'days' ? v.amount <= 366 : v.amount <= 24), { message: 'amount_out_of_range', path: ['amount'] })
      .optional(),
    reason,
    idempotencyKey: z.uuid(),
  })
  .strict();
export type PlatformCreateBusinessInput = z.infer<typeof platformCreateBusinessSchema>;

export interface PlatformCreateBusinessResult {
  business: PlatformBusinessSummary;
  ownerEmailMasked: string | null;
  /** Concesión inicial, si se pidió. */
  initialAccessEndsAt: string | null;
  /** true = la misma solicitud ya se había procesado (reintento o doble clic): no se creó otra cuenta. */
  replayed: boolean;
}

/* ---------- Reglas de fechas de una concesión ---------- */

/**
 * Suma meses CALENDARIO en UTC conservando la hora; si el día no existe en el mes destino, cae en el último día de ese mes
 * (31 ene + 1 mes = 28/29 feb; 31 mar + 1 mes = 30 abr). Así un "mes" nunca se convierte en 30 días ni se desborda.
 */
export function addCalendarMonthsUtc(date: Date, months: number): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + months;
  const targetYear = y + Math.floor(m / 12);
  const targetMonth = ((m % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(targetYear, targetMonth, Math.min(date.getUTCDate(), lastDay), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds()));
}

/** Días = bloques exactos de 24 h en UTC. */
export function grantEnd(start: Date, unit: 'days' | 'months', amount: number): Date {
  return unit === 'days' ? new Date(start.getTime() + amount * 86_400_000) : addCalendarMonthsUtc(start, amount);
}

/**
 * Desde cuándo corre una concesión nueva: lo más tardío entre AHORA, el fin de la última concesión vigente y el fin del
 * acceso que el negocio ya tiene por prueba o período pagado. Así una concesión siempre SUMA tiempo (nunca se solapa con lo
 * que ya tenía) y una cuenta vencida empieza a contar desde hoy (no se "devuelve" el tiempo vencido).
 */
export function grantStart(now: Date, candidates: Array<Date | null | undefined>): Date {
  return candidates.reduce<Date>((latest, c) => (c && c > latest ? c : latest), now);
}

/** j***@dominio.com — suficiente para confirmar la cuenta sin exponer el correo completo. */
export function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  return `${email[0]}***${email.slice(at)}`;
}

/** ***1234 */
export function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  return phone.length <= 4 ? '***' : `***${phone.slice(-4)}`;
}
