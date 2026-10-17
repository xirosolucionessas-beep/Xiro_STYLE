import { access, constants } from 'node:fs/promises';
import { sql } from 'drizzle-orm';
import {
  PLATFORM_MAX_BUCKETS,
  type HealthCheck,
  type Indicator,
  type PlatformGrouping,
  type PlatformOverview,
  type PlatformSeries,
  type PlatformSeriesDto,
  type SubscriptionBreakdown,
} from '@xiro/shared';
import type { Config } from '../config';
import type { Database } from '../db/client';
import { AppError } from '../errors';
import type { Metrics } from '../metrics';
import { redisHealthy } from '../redis';
import type { Redis } from 'ioredis';
import type { MediaStore } from '../storage';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function validTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(tz) || tz === 'UTC';
  } catch {
    return false;
  }
}

export interface Period {
  from: string;
  to: string;
  timezone: string;
}

/** Período por días CALENDARIO de la zona pedida, ambos extremos incluidos. Rango máximo: 10 años. */
export function parsePeriod(input: { from?: string; to?: string; tz?: string }, now: Date = new Date()): Period {
  const timezone = input.tz ?? 'America/Bogota';
  if (!validTimezone(timezone)) throw new AppError(400, 'validation_error', 'Zona horaria inválida.');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const to = input.to ?? today;
  const from = input.from ?? new Date(Date.parse(`${to}T00:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10);
  if (!DAY.test(from) || !DAY.test(to) || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) throw new AppError(400, 'validation_error', 'Fechas inválidas (AAAA-MM-DD).');
  const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
  if (days < 0 || days > 3660) throw new AppError(400, 'validation_error', 'El rango debe ir de 1 día a 10 años.');
  return { from, to, timezone };
}

/** Límites del período como instantes: [inicio del día `from`, inicio del día siguiente a `to`) en la zona del período. */
const bounds = (p: Period) => ({
  start: sql`((${p.from}::date)::timestamp at time zone ${p.timezone})`,
  end: sql`(((${p.to}::date) + 1)::timestamp at time zone ${p.timezone})`,
});

async function measured<T>(fn: () => Promise<T>, meta: Omit<Indicator<T>, 'state' | 'value' | 'asOf'>, onError: (e: unknown) => void): Promise<Indicator<T>> {
  const asOf = new Date().toISOString();
  try {
    return { state: 'ok', value: await fn(), asOf, ...meta };
  } catch (error) {
    onError(error);
    return { state: 'error', value: null, asOf, ...meta };
  }
}

const rows = <T>(result: { rows: unknown[] }) => result.rows as T[];

export interface OverviewDeps {
  db: Database;
  config: Config;
  metrics: Metrics;
  redis: Redis | null;
  media: MediaStore;
  log: (error: unknown) => void;
}

async function check(name: string, run: () => Promise<boolean>, detail: string): Promise<HealthCheck> {
  const started = performance.now();
  try {
    const ok = await run();
    return { name, state: ok ? 'up' : 'down', latencyMs: Math.round(performance.now() - started), detail };
  } catch {
    return { name, state: 'down', latencyMs: Math.round(performance.now() - started), detail };
  }
}

/**
 * Indicadores agregados de la plataforma. ~7 consultas agregadas sobre tablas pequeñas (una fila por negocio o por
 * pago); cada una en su propia `measured` para que una que falle muestre "error" sin tumbar las demás. Sin caché: se
 * consultan al pedirlos y la app refresca como mucho cada 60 s (ver docs/platform-admin.md, sección de rendimiento).
 */
export async function platformOverview(deps: OverviewDeps, period: Period, now: Date = new Date()): Promise<PlatformOverview> {
  const { db, config, metrics, redis, media, log } = deps;
  const { start, end } = bounds(period);

  const businessCounts = await measured(
    async () => {
      const [r] = rows<{ total: number; active: number; suspended: number; deactivated: number; created: number }>(
        await db.execute(sql`
          select count(*)::int as total,
                 count(*) filter (where access_status = 'active')::int as active,
                 count(*) filter (where access_status = 'suspended')::int as suspended,
                 count(*) filter (where access_status = 'deactivated')::int as deactivated,
                 count(*) filter (where created_at >= ${start} and created_at < ${end})::int as created
          from businesses`),
      );
      return r!;
    },
    { source: 'businesses', formula: 'Conteo de filas; por access_status; altas = created_at dentro del período.' },
    log,
  );
  type Counts = NonNullable<typeof businessCounts.value>;
  const pick = <R,>(f: (v: Counts) => R): Indicator<R> => ({ ...businessCounts, value: businessCounts.value ? f(businessCounts.value) : null });

  // Estado EFECTIVO con la misma regla que deriveEffectiveStatus (@xiro/shared): una fila vencida sin webhook no cuenta como activa.
  const effective = sql.raw(`case
      when s.status = 'trial' and s.trial_ends_at < now() then 'past_due'
      when s.status = 'active' and s.current_period_end < now() then 'past_due'
      when s.status = 'past_due' and s.grace_period_ends_at < now() then 'expired'
      else s.status end`);
  const subscriptionsByStatus = await measured(
    async () => {
      const [r] = rows<SubscriptionBreakdown>(
        await db.execute(sql`
          with e as (select ${effective} as status, s.status as stored, s.grace_period_ends_at as grace from subscriptions s)
          select (select count(*) from businesses)::int - count(*)::int as none,
                 count(*) filter (where status = 'trial')::int as trial,
                 count(*) filter (where status = 'active')::int as active,
                 count(*) filter (where status = 'past_due')::int as past_due,
                 count(*) filter (where status = 'expired')::int as expired,
                 count(*) filter (where status = 'canceled')::int as canceled,
                 count(*) filter (where status in ('trial','active')
                                   or (status = 'past_due' and (grace >= now() or (grace is null and stored <> 'past_due'))))::int as "withAccess"
          from e`),
      );
      return r!;
    },
    {
      source: 'subscriptions + businesses',
      formula: 'Estado efectivo por fechas (misma regla que la app). "none" = negocios sin fila de suscripción. "withAccess" = acceso PAGADO o de prueba (sin contar concesiones administrativas).',
    },
    log,
  );
  const renewing = await measured(
    async () =>
      rows<{ n: number }>(
        await db.execute(sql`select count(*)::int as n from subscriptions s where ${effective} in ('trial','active') and not s.cancel_at_period_end and s.next_billing_at >= now() and s.next_billing_at < now() + interval '7 days'`),
      )[0]!.n,
    { source: 'subscriptions.next_billing_at', formula: 'Suscripciones vigentes, sin cancelación programada, con próximo cobro en los próximos 7 días.', note: 'Es el cobro PROGRAMADO, no un cobro confirmado.' },
    log,
  );
  const cancelling = await measured(
    async () => rows<{ n: number }>(await db.execute(sql`select count(*)::int as n from subscriptions s where ${effective} in ('trial','active') and s.cancel_at_period_end`))[0]!.n,
    { source: 'subscriptions.cancel_at_period_end', formula: 'Vigentes que no se renovarán al terminar su período.' },
    log,
  );
  const grants = await measured(
    async () =>
      rows<{ n: number }>(await db.execute(sql`select count(distinct business_id)::int as n from business_access_grants where revoked_at is null and starts_at <= now() and ends_at > now()`))[0]!.n,
    { source: 'business_access_grants', formula: 'Negocios con una concesión administrativa vigente ahora (no son pagos).' },
    log,
  );
  const payments = await measured(
    async () =>
      rows<{ currency: string; count: number; amount: number }>(
        await db.execute(sql`select currency, count(*)::int as count, coalesce(sum(amount), 0)::bigint::float8 as amount from subscription_invoices where created_at >= ${start} and created_at < ${end} group by currency order by currency`),
      ),
    { source: 'subscription_invoices', formula: 'Comprobantes de pagos CONFIRMADOS (webhook del proveedor o transferencia confirmada) emitidos en el período, por moneda.' },
    log,
  );

  const health: HealthCheck[] = await Promise.all([
    check('database', async () => (await db.execute(sql`select 1`), true), 'select 1 en el pool de la API'),
    redis ? check('redis', () => redisHealthy(redis), 'PING') : Promise.resolve<HealthCheck>({ name: 'redis', state: 'not_configured', latencyMs: null, detail: 'Sin REDIS_URL: límites y caché en memoria de cada proceso.' }),
    check(
      `storage:${media.kind}`,
      async () => {
        if (media.kind === 'local') await access(config.mediaDir, constants.W_OK);
        else await media.exists('00000000-0000-0000-0000-000000000000.webp'); // HEAD real al almacén; el archivo no existe
        return true;
      },
      media.kind === 'local' ? 'Carpeta de medios con permiso de escritura' : 'HEAD de un objeto en el bucket',
    ),
    ...(
      [
        ['stripe', config.subscriptions.stripeSecretKey],
        ['paypal', config.subscriptions.paypalClientId],
        ['revenuecat', config.subscriptions.revenueCatWebhookAuth],
        ['google_maps', config.booking.googleServerKey],
        ['sentry', config.observability.sentryDsn],
      ] as const
    ).map(([name, configured]): HealthCheck => ({
      name,
      state: configured ? 'unknown' : 'not_configured',
      latencyMs: null,
      detail: configured ? 'Configurado. Sin comprobación activa desde el panel (no se llama al proveedor para no consumir cuota).' : 'No configurado.',
    })),
  ]);

  const traffic = metrics.snapshot();
  const pool = metrics.poolStats();
  const asOf = now.toISOString();
  return {
    generatedAt: asOf,
    period,
    businesses: {
      total: pick((v) => v.total),
      byAccessStatus: pick((v) => ({ active: v.active, suspended: v.suspended, deactivated: v.deactivated })),
      newInPeriod: pick((v) => v.created),
    },
    subscriptions: { byStatus: subscriptionsByStatus, renewingNext7Days: renewing, cancelAtPeriodEnd: cancelling, activeAccessGrants: grants, paymentsInPeriod: payments },
    health,
    traffic: {
      state: 'ok',
      value: { ...traffic, since: traffic.since.toISOString() },
      source: 'Métricas en memoria del proceso que respondió (las mismas de /api/metrics)',
      formula: 'Peticiones por clase de estado; percentiles = cota superior del bucket del histograma.',
      asOf,
      note: 'Solo ESTA instancia y desde su arranque. Con varias instancias, la cifra global está en Prometheus/Grafana (GET /api/metrics de cada una).',
    },
    databasePool: { state: pool ? 'ok' : 'unavailable', value: pool, source: 'pg.Pool de este proceso', formula: 'Conexiones totales, ociosas y peticiones esperando conexión.', asOf, note: 'Solo esta instancia.' },
    unavailable: [
      { key: 'active_users_now', reason: 'No existe registro de usuarios conectados/concurrentes: las sesiones son tokens de 15 min sin estado. Medirlo exige instrumentación (p. ej. contador en Redis por usuario activo en los últimos N minutos).' },
      { key: 'traffic_history', reason: 'La API no guarda series de tiempo de peticiones/errores/latencias: el historial vive en Prometheus si está configurado.' },
      { key: 'subscription_status_history', reason: 'No hay fotos históricas del estado de cada suscripción; solo eventos sueltos de proveedores. Se grafican las pruebas iniciadas, pagos y concesiones (eventos con fecha).' },
      { key: 'external_services_health', reason: 'Stripe, PayPal, RevenueCat y Google no se consultan desde el panel (cuota y latencia); solo se informa si están configurados.' },
    ],
  };
}

/* ---------- Series históricas ---------- */

const SERIES: Record<PlatformSeries, { table: string; where: string; source: string; formula: string }> = {
  new_businesses: { table: 'businesses', where: 'true', source: 'businesses.created_at', formula: 'Negocios registrados por período.' },
  trials_started: { table: 'subscription_events', where: "type = 'trial_started'", source: "subscription_events (type = 'trial_started')", formula: 'Pruebas gratuitas iniciadas por período.' },
  payments: { table: 'subscription_invoices', where: 'true', source: 'subscription_invoices.created_at', formula: 'Pagos confirmados por período (cantidad; los montos se ven por moneda en el resumen).' },
  access_grants: { table: 'business_access_grants', where: 'true', source: 'business_access_grants.created_at', formula: 'Concesiones administrativas creadas por período (incluye las luego revocadas).' },
};

export function bucketCount(period: Period, grouping: PlatformGrouping): number {
  const days = (Date.parse(period.to) - Date.parse(period.from)) / 86_400_000 + 1;
  return grouping === 'day' ? days : grouping === 'week' ? Math.ceil(days / 7) + 1 : Math.ceil(days / 28) + 1;
}

/**
 * Una barra por día/semana (lunes)/mes de la zona pedida. Cada fuente guarda la fecha de cada evento, así que un período
 * sin filas es un CERO REAL, no un dato faltante. El primer y el último período pueden ser parciales (se recortan al rango).
 */
export async function platformSeries(db: Database, metric: PlatformSeries, grouping: PlatformGrouping, period: Period): Promise<PlatformSeriesDto> {
  if (bucketCount(period, grouping) > PLATFORM_MAX_BUCKETS[grouping]) throw new AppError(400, 'range_too_large', `Demasiados períodos para agrupar por ${grouping}: acorta el rango o agrupa más grueso.`);
  const spec = SERIES[metric];
  const { start, end } = bounds(period);
  const unit = sql.raw(`'${grouping}'`);
  const step = sql.raw(`'1 ${grouping}'::interval`);
  const result = await db.execute(sql`
    with b as (
      select generate_series(date_trunc(${unit}, ${period.from}::date::timestamp), ${period.to}::date::timestamp, ${step}) as k
    ), c as (
      select date_trunc(${unit}, created_at at time zone ${period.timezone}) as k, count(*)::int as n
      from ${sql.raw(spec.table)}
      where ${sql.raw(spec.where)} and created_at >= ${start} and created_at < ${end}
      group by 1
    )
    select to_char(b.k, 'YYYY-MM-DD') as start, coalesce(c.n, 0)::int as value from b left join c on c.k = b.k order by b.k`);
  return { metric, grouping, timezone: period.timezone, buckets: rows<{ start: string; value: number }>(result), source: spec.source, formula: spec.formula, asOf: new Date().toISOString() };
}
