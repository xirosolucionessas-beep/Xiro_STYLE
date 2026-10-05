import { addDays, addMonths, dayRange, startOfWeek, todayIn, type Item } from '@xiro/shared';
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
  photoUrl: string | null;
  createdAt: string;
  /** `null` = no se conoce (la persona no puede ver los registros de servicio). */
  visits: number | null;
  /** Último servicio (ms); `null` si no hay ninguno en los registros disponibles. */
  lastVisit: number | null;
}

/** Une clientes con lo que se sabe de sus servicios. `records` en `undefined` = sin permiso o cargando. */
export function clientRows(clients: ReadonlyArray<{ id: string; name: string; phone: string | null; email: string | null; photoUrl: string | null; createdAt: string }>, records?: ReadonlyArray<{ clientId: string; createdAt: string }>): ClientRow[] {
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
      photoUrl: client.photoUrl,
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

/* ---------- Reportes: rango de fechas dinámico (hoy/semana/mes/año/personalizado) ---------- */

export const REPORT_PERIODS = ['today', 'week', 'month', 'year', 'custom'] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];

export interface ReportWindow {
  /** [from, to) UTC, para pedirle al servidor GET /api/sales?from&to. */
  from: string;
  to: string;
  /** Primer día local (YYYY-MM-DD) de la ventana. */
  startDate: string;
  /** Cuántos días locales cubre. */
  days: number;
}

export interface ReportRange {
  current: ReportWindow;
  /** Mismo largo de ventana, inmediatamente anterior — para "Comparativa de crecimiento" (sección 1.2). */
  previous: ReportWindow;
}

const daysBetween = (a: string, b: string): number => {
  const toUTC = (date: string) => {
    const [y, m, d] = date.split('-').map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUTC(b) - toUTC(a)) / DAY_MS);
};

const windowOf = (startDate: string, days: number, timezone: string): ReportWindow => ({ ...dayRange(startDate, timezone, days), startDate, days });

/**
 * Resuelve el rango actual Y el periodo anterior equivalente, en la zona horaria del negocio:
 *  - hoy → ayer; esta semana (lun–dom) → la semana calendario anterior; este mes → el mes calendario anterior
 *    (con su propio largo real, no "30 días"); este año → el año calendario anterior.
 *  - personalizado → un periodo anterior de la MISMA duración, justo antes del elegido (igual que pide la sección 1.2).
 * `custom` exige `from`/`to` (YYYY-MM-DD, `from <= to`); lanza si faltan o son inválidos — la UI valida antes de llamar.
 */
export function resolveReportRange(period: ReportPeriod, timezone: string, now: Date = new Date(), custom?: { from: string; to: string }): ReportRange {
  const today = todayIn(timezone, now);
  if (period === 'today') return { current: windowOf(today, 1, timezone), previous: windowOf(addDays(today, -1), 1, timezone) };
  if (period === 'week') {
    const start = startOfWeek(today);
    return { current: windowOf(start, 7, timezone), previous: windowOf(addDays(start, -7), 7, timezone) };
  }
  if (period === 'month') {
    const start = addMonths(today, 0); // primer día del mes actual
    const days = daysBetween(start, addMonths(start, 1));
    const prevStart = addMonths(start, -1);
    const prevDays = daysBetween(prevStart, start);
    return { current: windowOf(start, days, timezone), previous: windowOf(prevStart, prevDays, timezone) };
  }
  if (period === 'year') {
    const start = `${today.slice(0, 4)}-01-01`;
    const days = daysBetween(start, `${Number(today.slice(0, 4)) + 1}-01-01`);
    const prevStart = `${Number(today.slice(0, 4)) - 1}-01-01`;
    const prevDays = daysBetween(prevStart, start);
    return { current: windowOf(start, days, timezone), previous: windowOf(prevStart, prevDays, timezone) };
  }
  // custom
  if (!custom || !custom.from || !custom.to || custom.from > custom.to) throw new RangeError('invalid_date_range');
  const days = daysBetween(custom.from, custom.to) + 1; // inclusive del día final
  const prevStart = addDays(custom.from, -days);
  return { current: windowOf(custom.from, days, timezone), previous: windowOf(prevStart, days, timezone) };
}

/** Venta anulada ⇒ nunca cuenta: igual criterio que ya aplicaba el servidor al filtrar `service_records` por `voided`. */
const nonVoidedSales = <T extends { status: string }>(sales: ReadonlyArray<T>): T[] => sales.filter((sale) => sale.status !== 'voided');

interface SaleItemLike { kind: 'service' | 'product'; name: string; quantity: number; total: number; employeeId: string | null; employeeName: string | null }
interface SalePaymentLike { method: string; amount: number }
interface SaleLike { status: string; total: number; clientName: string; createdAt: string; items: readonly SaleItemLike[]; payments: readonly SalePaymentLike[] }

/**
 * Totales del periodo a partir de ventas ya filtradas por el servidor (`GET /sales?from&to`): reemplaza el cálculo que
 * antes salía de `service_records` (tope de 200 registros, sin acotar por fecha — ver `isTruncated`). `count` cuenta
 * LÍNEAS de venta (una por servicio/producto vendido), igual que antes contaba una fila de `service_records` por línea.
 */
export function salesSummary(sales: ReadonlyArray<Pick<SaleLike, 'status' | 'total' | 'items'>>): PeriodTotals {
  const valid = nonVoidedSales(sales);
  const total = valid.reduce((sum, sale) => sum + sale.total, 0);
  const count = valid.reduce((sum, sale) => sum + sale.items.length, 0);
  return { total, count, average: count > 0 ? Math.round(total / count) : null };
}

export interface ReportBucket { key: string; total: number; count: number }

/** Ventanas de más de 35 días se agrupan por mes (un año serían 365 barras ilegibles); el resto, por día. */
const DAILY_BUCKET_MAX_DAYS = 35;

/** Ventas por día (o por mes, en ventanas largas) a lo largo de toda la ventana — incluye periodos sin actividad. */
export function reportBuckets(sales: ReadonlyArray<Pick<SaleLike, 'status' | 'total' | 'createdAt'>>, timezone: string, window: ReportWindow): ReportBucket[] {
  const valid = nonVoidedSales(sales);
  const buckets = new Map<string, ReportBucket>();
  if (window.days <= DAILY_BUCKET_MAX_DAYS) {
    for (let i = 0; i < window.days; i += 1) {
      const key = addDays(window.startDate, i);
      buckets.set(key, { key, total: 0, count: 0 });
    }
    for (const sale of valid) {
      const bucket = buckets.get(dayKey(timezone, new Date(sale.createdAt)));
      if (bucket) {
        bucket.total += sale.total;
        bucket.count += 1;
      }
    }
    return [...buckets.values()];
  }
  const lastDay = addDays(window.startDate, window.days - 1);
  for (let cursor = `${window.startDate.slice(0, 7)}-01`; cursor.slice(0, 7) <= lastDay.slice(0, 7); cursor = addMonths(cursor, 1)) {
    buckets.set(cursor.slice(0, 7), { key: cursor.slice(0, 7), total: 0, count: 0 });
  }
  for (const sale of valid) {
    const bucket = buckets.get(dayKey(timezone, new Date(sale.createdAt)).slice(0, 7));
    if (bucket) {
      bucket.total += sale.total;
      bucket.count += 1;
    }
  }
  return [...buckets.values()];
}

export interface PaymentMethodRow { method: string; total: number; count: number; percent: number }

/** Desglose de ingresos por forma de pago (sección 1.3): efectivo, transferencia/Nequi, tarjetas/pasarelas, otro. */
export function paymentMethodBreakdown(sales: ReadonlyArray<Pick<SaleLike, 'status' | 'payments'>>): PaymentMethodRow[] {
  const rows = new Map<string, { total: number; count: number }>();
  let grandTotal = 0;
  for (const sale of nonVoidedSales(sales)) {
    for (const payment of sale.payments) {
      const row = rows.get(payment.method) ?? { total: 0, count: 0 };
      row.total += payment.amount;
      row.count += 1;
      rows.set(payment.method, row);
      grandTotal += payment.amount;
    }
  }
  return [...rows.entries()].map(([method, r]) => ({ method, total: r.total, count: r.count, percent: grandTotal > 0 ? Math.round((r.total / grandTotal) * 100) : 0 })).sort((a, b) => b.total - a.total);
}

export interface EmployeePerformanceRow { employeeId: string; employeeName: string; count: number; total: number; percent: number }

/** Rendimiento por profesional (sección 1.3): solo cuenta líneas CON empleado asignado (un producto vendido sin atención de nadie no aplica). */
export function employeePerformance(sales: ReadonlyArray<Pick<SaleLike, 'status' | 'items'>>): EmployeePerformanceRow[] {
  const rows = new Map<string, EmployeePerformanceRow>();
  let grandTotal = 0;
  for (const sale of nonVoidedSales(sales)) {
    for (const item of sale.items) {
      if (!item.employeeId) continue;
      const row = rows.get(item.employeeId) ?? { employeeId: item.employeeId, employeeName: item.employeeName ?? '', count: 0, total: 0, percent: 0 };
      row.count += 1;
      row.total += item.total;
      rows.set(item.employeeId, row);
      grandTotal += item.total;
    }
  }
  return [...rows.values()].map((row) => ({ ...row, percent: grandTotal > 0 ? Math.round((row.total / grandTotal) * 100) : 0 })).sort((a, b) => b.total - a.total);
}

/** Servicios o productos más vendidos del periodo (por cantidad; a igualdad, por monto) — igual criterio que ya usa Cierre de caja. */
export function topSaleItems(sales: ReadonlyArray<Pick<SaleLike, 'status' | 'items'>>, kind: 'service' | 'product', limit = 5): RankRow[] {
  const rows = new Map<string, RankRow>();
  for (const sale of nonVoidedSales(sales)) {
    for (const item of sale.items) {
      if (item.kind !== kind) continue;
      const row = rows.get(item.name) ?? { label: item.name, count: 0, total: 0 };
      row.count += item.quantity;
      row.total += item.total;
      rows.set(item.name, row);
    }
  }
  return [...rows.values()].sort((a, b) => b.count - a.count || b.total - a.total || a.label.localeCompare(b.label)).slice(0, limit);
}

/** Clientes que más gastaron en el periodo, a partir de las ventas (reemplaza el cálculo por `service_records` para Reportes). */
export function topSaleClients(sales: ReadonlyArray<Pick<SaleLike, 'status' | 'total' | 'clientName'>>, limit = 5): RankRow[] {
  const rows = new Map<string, RankRow>();
  for (const sale of nonVoidedSales(sales)) {
    const row = rows.get(sale.clientName) ?? { label: sale.clientName, count: 0, total: 0 };
    row.count += 1;
    row.total += sale.total;
    rows.set(sale.clientName, row);
  }
  return [...rows.values()].sort((a, b) => b.total - a.total || b.count - a.count || a.label.localeCompare(b.label)).slice(0, limit);
}

/** Suma de las bases de caja (`GET /cash/openings`) registradas dentro del periodo; 0 si ningún día se abrió (nunca se inventa un valor). */
export const openingBaseTotal = (openings: ReadonlyArray<{ amount: number }>): number => openings.reduce((sum, o) => sum + o.amount, 0);

/** "Total en caja" (sección Reportes): base inicial del periodo + lo cobrado en efectivo — el balance físico que debería haber en caja. */
export function cashBalance(openingTotal: number, paymentMethods: ReadonlyArray<Pick<PaymentMethodRow, 'method' | 'total'>>): number {
  const cashSales = paymentMethods.find((row) => row.method === 'cash')?.total ?? 0;
  return openingTotal + cashSales;
}
