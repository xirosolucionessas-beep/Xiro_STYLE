import type { Item } from '@xiro/shared';
import { dayKey } from './homeMetrics';

/**
 * Cálculos puros de las pantallas de sección de la web (Clientes, Servicios, Inventario, Reportes). Solo usan datos que
 * la app YA consulta: clientes, artículos y registros de servicio. Nada se inventa: sin datos, `null` o cero real.
 */

const DAY_MS = 86_400_000;

/** El servidor devuelve como máximo esta cantidad de registros de servicio: si llegan tantos, el historial puede estar cortado. */
export const RECORD_LIMIT = 200;
export const isTruncated = (records: ReadonlyArray<unknown>): boolean => records.length >= RECORD_LIMIT;

/* ---------- Clientes ---------- */

export interface ClientRow {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  createdAt: string;
  /** `null` = no se conoce (la persona no puede ver los registros de servicio). */
  visits: number | null;
  /** Último servicio (ms); `null` si no hay ninguno en los registros disponibles. */
  lastVisit: number | null;
}

/** Une clientes con lo que se sabe de sus servicios. `records` en `undefined` = sin permiso o cargando. */
export function clientRows(clients: ReadonlyArray<{ id: string; name: string; phone: string | null; email: string | null; createdAt: string }>, records?: ReadonlyArray<{ clientId: string; createdAt: string }>): ClientRow[] {
  const stats = new Map<string, { visits: number; last: number }>();
  for (const record of records ?? []) {
    const at = Date.parse(record.createdAt);
    const current = stats.get(record.clientId) ?? { visits: 0, last: 0 };
    stats.set(record.clientId, { visits: current.visits + 1, last: Number.isFinite(at) ? Math.max(current.last, at) : current.last });
  }
  return clients.map((client) => {
    const found = stats.get(client.id);
    return {
      id: client.id,
      name: client.name,
      phone: client.phone,
      email: client.email,
      createdAt: client.createdAt,
      visits: records ? (found?.visits ?? 0) : null,
      lastVisit: found && found.last > 0 ? found.last : null,
    };
  });
}

/** Mes calendario (YYYY-MM) del negocio. */
const monthKey = (timezone: string, date: Date) => dayKey(timezone, date).slice(0, 7);

/** Clientes creados este mes (mes del negocio). */
export function newThisMonth(clients: ReadonlyArray<{ createdAt: string }>, timezone: string, now: Date = new Date()): number {
  const current = monthKey(timezone, now);
  return clients.filter((client) => monthKey(timezone, new Date(client.createdAt)) === current).length;
}

/** Clientes con algún servicio en los últimos `days` días ("activos"). */
export function activeClients(records: ReadonlyArray<{ clientId: string; createdAt: string }>, days: number, now: Date = new Date()): number {
  const since = now.getTime() - days * DAY_MS;
  return new Set(records.filter((record) => Date.parse(record.createdAt) >= since).map((record) => record.clientId)).size;
}

/* ---------- Servicios e inventario ---------- */

export interface CatalogStats {
  total: number;
  published: number;
  hidden: number;
  /** Precio promedio; `null` si no hay artículos. */
  averagePrice: number | null;
}

export function catalogStats(items: ReadonlyArray<Pick<Item, 'published' | 'price'>>): CatalogStats {
  const published = items.filter((item) => item.published).length;
  return { total: items.length, published, hidden: items.length - published, averagePrice: items.length > 0 ? Math.round(items.reduce((sum, item) => sum + item.price, 0) / items.length) : null };
}

/** Valor del inventario a costo interno (unidades × costo). `null` si ningún artículo tiene costo cargado: no se muestra un 0 engañoso. */
export function inventoryValue(items: ReadonlyArray<Pick<Item, 'stock' | 'internalUnitCost'>>): number | null {
  const costed = items.filter((item) => item.internalUnitCost > 0);
  return costed.length === 0 ? null : costed.reduce((sum, item) => sum + item.stock * item.internalUnitCost, 0);
}

/* ---------- Reportes ---------- */

export interface DayBucket {
  key: string;
  total: number;
  count: number;
}

/** Ventas y servicios por día para los últimos `days` días (el último es hoy), en la zona horaria del negocio. Incluye días sin actividad. */
export function salesByDay(records: ReadonlyArray<{ amount: number; createdAt: string }>, timezone: string, days: number, now: Date = new Date()): DayBucket[] {
  const buckets = new Map<string, DayBucket>();
  for (let i = days - 1; i >= 0; i -= 1) {
    const key = dayKey(timezone, new Date(now.getTime() - i * DAY_MS));
    buckets.set(key, { key, total: 0, count: 0 });
  }
  for (const record of records) {
    const bucket = buckets.get(dayKey(timezone, new Date(record.createdAt)));
    if (bucket) {
      bucket.total += record.amount;
      bucket.count += 1;
    }
  }
  return [...buckets.values()];
}

export interface PeriodTotals {
  total: number;
  count: number;
  average: number | null;
}

const totalsOf = (buckets: ReadonlyArray<DayBucket>): PeriodTotals => {
  const total = buckets.reduce((sum, bucket) => sum + bucket.total, 0);
  const count = buckets.reduce((sum, bucket) => sum + bucket.count, 0);
  return { total, count, average: count > 0 ? Math.round(total / count) : null };
};

/** Totales del periodo actual (últimos `days` días) y del periodo anterior de igual duración. */
export function periodTotals(records: ReadonlyArray<{ amount: number; createdAt: string }>, timezone: string, days: number, now: Date = new Date()): { current: PeriodTotals; previous: PeriodTotals } {
  const current = totalsOf(salesByDay(records, timezone, days, now));
  const previous = totalsOf(salesByDay(records, timezone, days, new Date(now.getTime() - days * DAY_MS)));
  return { current, previous };
}

export interface RankRow {
  label: string;
  count: number;
  total: number;
}

const inPeriod = (createdAt: string, timezone: string, days: number, now: Date): boolean => {
  const keys = new Set(salesByDay([], timezone, days, now).map((bucket) => bucket.key));
  return keys.has(dayKey(timezone, new Date(createdAt)));
};

/** Servicios más pedidos del periodo (por cantidad; a igualdad, por monto). */
export function topServices(records: ReadonlyArray<{ label: string; amount: number; createdAt: string }>, timezone: string, days: number, now: Date = new Date(), limit = 5): RankRow[] {
  const keys = new Set(salesByDay([], timezone, days, now).map((bucket) => bucket.key));
  const rows = new Map<string, RankRow>();
  for (const record of records) {
    if (!keys.has(dayKey(timezone, new Date(record.createdAt)))) continue;
    const row = rows.get(record.label) ?? { label: record.label, count: 0, total: 0 };
    row.count += 1;
    row.total += record.amount;
    rows.set(record.label, row);
  }
  return [...rows.values()].sort((a, b) => b.count - a.count || b.total - a.total || a.label.localeCompare(b.label)).slice(0, limit);
}

/** Clientes que más gastaron en el periodo. */
export function topClients(records: ReadonlyArray<{ clientName: string; amount: number; createdAt: string }>, timezone: string, days: number, now: Date = new Date(), limit = 5): RankRow[] {
  const keys = new Set(salesByDay([], timezone, days, now).map((bucket) => bucket.key));
  const rows = new Map<string, RankRow>();
  for (const record of records) {
    if (!keys.has(dayKey(timezone, new Date(record.createdAt)))) continue;
    const row = rows.get(record.clientName) ?? { label: record.clientName, count: 0, total: 0 };
    row.count += 1;
    row.total += record.amount;
    rows.set(record.clientName, row);
  }
  return [...rows.values()].sort((a, b) => b.total - a.total || b.count - a.count || a.label.localeCompare(b.label)).slice(0, limit);
}

/** Clientes creados dentro del periodo. */
export const newClientsInPeriod = (clients: ReadonlyArray<{ createdAt: string }>, timezone: string, days: number, now: Date = new Date()): number => clients.filter((client) => inPeriod(client.createdAt, timezone, days, now)).length;

/* ---------- Fichas ---------- */

/** Margen sobre el precio (precio − costo). `null` si no hay costo cargado o no hay precio: no se muestra un margen inventado. */
export function margin(price: number, cost: number): { amount: number; percent: number } | null {
  if (!(cost > 0) || !(price > 0)) return null;
  return { amount: price - cost, percent: Math.round(((price - cost) / price) * 100) };
}

export interface ClientHistory {
  count: number;
  total: number;
  /** Último servicio (ms); `null` si no hay ninguno. */
  last: number | null;
}

/** Resumen de los servicios de UN cliente. */
export function clientHistory(records: ReadonlyArray<{ amount: number; createdAt: string }>): ClientHistory {
  const times = records.map((record) => Date.parse(record.createdAt)).filter(Number.isFinite);
  return { count: records.length, total: records.reduce((sum, record) => sum + record.amount, 0), last: times.length > 0 ? Math.max(...times) : null };
}
