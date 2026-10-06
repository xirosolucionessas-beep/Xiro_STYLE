import { addDays, addMonths, dayRange, localDate, startOfWeek, todayIn } from './agenda';
import type { SaleDto } from './sales';

/**
 * Cálculos de reportes de ventas (totales, series por día, desglose por forma de pago y por profesional, rankings):
 * UNA sola fuente de verdad para el panel ("Reportes") y las herramientas de consulta del asistente de IA, para que
 * ambos citen exactamente la misma cifra sobre las mismas ventas. Puro y sin red: opera sobre `SaleDto[]` ya traídos
 * de la base de datos (ver `GET /sales` en la API, o el servicio del asistente que no acota por cantidad de filas).
 */

const DAY_MS = 86_400_000;

export const REPORT_PERIODS = ['today', 'week', 'month', 'year', 'custom'] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];

export interface ReportWindow {
  /** [from, to) UTC, para pedirle al servidor `GET /sales?from&to`. */
  from: string;
  to: string;
  /** Primer día local (YYYY-MM-DD) de la ventana. */
  startDate: string;
  /** Cuántos días locales cubre. */
  days: number;
}

export interface ReportRange {
  current: ReportWindow;
  /** Mismo largo de ventana, inmediatamente anterior — para la comparativa de crecimiento. */
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
 *  - personalizado → un periodo anterior de la MISMA duración, justo antes del elegido.
 * `custom` exige `from`/`to` (YYYY-MM-DD, `from <= to`); lanza si faltan o son inválidos — quien llama valida antes.
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

/** Venta anulada ⇒ nunca cuenta en ningún cálculo de esta página. */
const nonVoidedSales = <T extends { status: string }>(sales: ReadonlyArray<T>): T[] => sales.filter((sale) => sale.status !== 'voided');

export interface PeriodTotals {
  total: number;
  count: number;
  average: number | null;
}

/** `count` cuenta LÍNEAS de venta (una por servicio/producto vendido). */
export function salesSummary(sales: ReadonlyArray<Pick<SaleDto, 'status' | 'total' | 'items'>>): PeriodTotals {
  const valid = nonVoidedSales(sales);
  const total = valid.reduce((sum, sale) => sum + sale.total, 0);
  const count = valid.reduce((sum, sale) => sum + sale.items.length, 0);
  return { total, count, average: count > 0 ? Math.round(total / count) : null };
}

export interface ReportBucket {
  key: string;
  total: number;
  count: number;
}

/** Ventanas de más de 35 días se agrupan por mes (un año serían 365 barras ilegibles); el resto, por día. */
const DAILY_BUCKET_MAX_DAYS = 35;

/** Ventas por día (o por mes, en ventanas largas) a lo largo de toda la ventana — incluye periodos sin actividad. */
export function reportBuckets(sales: ReadonlyArray<Pick<SaleDto, 'status' | 'total' | 'createdAt'>>, timezone: string, window: ReportWindow): ReportBucket[] {
  const valid = nonVoidedSales(sales);
  const buckets = new Map<string, ReportBucket>();
  if (window.days <= DAILY_BUCKET_MAX_DAYS) {
    for (let i = 0; i < window.days; i += 1) {
      const key = addDays(window.startDate, i);
      buckets.set(key, { key, total: 0, count: 0 });
    }
    for (const sale of valid) {
      const bucket = buckets.get(localDate(sale.createdAt, timezone));
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
    const bucket = buckets.get(localDate(sale.createdAt, timezone).slice(0, 7));
    if (bucket) {
      bucket.total += sale.total;
      bucket.count += 1;
    }
  }
  return [...buckets.values()];
}

export interface PaymentMethodRow {
  method: string;
  total: number;
  count: number;
  percent: number;
}

/** Desglose de ingresos por forma de pago: efectivo, transferencia/Nequi, tarjetas/pasarelas, otro. */
export function paymentMethodBreakdown(sales: ReadonlyArray<Pick<SaleDto, 'status' | 'payments'>>): PaymentMethodRow[] {
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

export interface EmployeePerformanceRow {
  employeeId: string;
  employeeName: string;
  count: number;
  total: number;
  percent: number;
}

/** Rendimiento por profesional: solo cuenta líneas CON empleado asignado (un producto vendido sin atención de nadie no aplica). */
export function employeePerformance(sales: ReadonlyArray<Pick<SaleDto, 'status' | 'items'>>): EmployeePerformanceRow[] {
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

export interface RankRow {
  label: string;
  count: number;
  total: number;
}

/** Servicios o productos más vendidos del periodo (por cantidad; a igualdad, por monto). */
export function topSaleItems(sales: ReadonlyArray<Pick<SaleDto, 'status' | 'items'>>, kind: 'service' | 'product', limit = 5): RankRow[] {
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

/** Clientes que más gastaron en el periodo. */
export function topSaleClients(sales: ReadonlyArray<Pick<SaleDto, 'status' | 'total' | 'clientName'>>, limit = 5): RankRow[] {
  const rows = new Map<string, RankRow>();
  for (const sale of nonVoidedSales(sales)) {
    const row = rows.get(sale.clientName) ?? { label: sale.clientName, count: 0, total: 0 };
    row.count += 1;
    row.total += sale.total;
    rows.set(sale.clientName, row);
  }
  return [...rows.values()].sort((a, b) => b.total - a.total || b.count - a.count || a.label.localeCompare(b.label)).slice(0, limit);
}

/** Suma de las bases de caja (`GET /cash/openings`) registradas dentro del periodo; 0 si ningún día se abrió. */
export const openingBaseTotal = (openings: ReadonlyArray<{ amount: number }>): number => openings.reduce((sum, o) => sum + o.amount, 0);

/** "Total en caja": base inicial del periodo + lo cobrado en efectivo — el balance físico que debería haber en caja. */
export function cashBalance(openingTotal: number, paymentMethods: ReadonlyArray<Pick<PaymentMethodRow, 'method' | 'total'>>): number {
  const cashSales = paymentMethods.find((row) => row.method === 'cash')?.total ?? 0;
  return openingTotal + cashSales;
}
