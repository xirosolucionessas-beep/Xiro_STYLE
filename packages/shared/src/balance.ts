import { z } from 'zod';
import { addDays, startOfWeek } from './agenda';
import type { ExpenseCategory } from './expenses';

/**
 * Balance general (módulo Finanzas). Ingresos = lo cobrado por servicios y productos (registros vigentes: una venta anulada
 * deja de contar y una cita completada cuenta por lo que se cobró) MENOS los descuentos de las ventas. Las propinas son del
 * personal: se muestran aparte y no suman al ingreso del negocio. Gastos por fecha del gasto, solo los vigentes.
 * Todo en días locales del negocio (America/Bogota por defecto) y en pesos enteros.
 */

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const isRealDay = (value: string) => {
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
};
const day = z.string().regex(DAY_RE, 'required').refine(isRealDay, 'date_invalid');

/** Rango máximo que se consulta de una vez (las descargas tienen su propio tope, más corto). */
export const BALANCE_MAX_DAYS = 3 * 366;

export const balanceQuerySchema = z
  .object({ from: day, to: day })
  .refine((q) => q.from <= q.to, { message: 'range_invalid', path: ['to'] })
  .refine((q) => daysBetween(q.from, q.to) < BALANCE_MAX_DAYS, { message: 'range_too_long', path: ['from'] });
export type BalanceQuery = z.input<typeof balanceQuerySchema>;

export const BALANCE_MOVEMENT_KINDS = ['all', 'income', 'expense'] as const;
export const balanceMovementsQuerySchema = z
  .object({
    from: day,
    to: day,
    kind: z.enum(BALANCE_MOVEMENT_KINDS).default('all'),
    sort: z.enum(['date', 'amount']).default('date'),
    dir: z.enum(['asc', 'desc']).default('desc'),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(10).max(200).default(50),
  })
  .refine((q) => q.from <= q.to, { message: 'range_invalid', path: ['to'] })
  .refine((q) => daysBetween(q.from, q.to) < BALANCE_MAX_DAYS, { message: 'range_too_long', path: ['from'] });
export type BalanceMovementsQuery = z.input<typeof balanceMovementsQuerySchema>;

export interface BalanceTotals {
  /** Servicios + productos cobrados (bruto, antes de descuentos de venta). */
  services: number;
  products: number;
  /** Descuentos aplicados en las ventas (se restan del ingreso). */
  discounts: number;
  /** Ingresos netos = servicios + productos − descuentos. */
  income: number;
  /** Propinas (del personal; no cuentan como ingreso del negocio). */
  tips: number;
  operating: number;
  payroll: number;
  /** Utilidad neta = ingresos − (operativos + nómina). */
  net: number;
  /** Margen % = utilidad / ingresos × 100; null si no hubo ingresos. */
  margin: number | null;
}

export interface BalanceComparison {
  /** Variación % contra el periodo anterior de igual duración; null = "sin datos previos" (el anterior fue 0). */
  income: number | null;
  operating: number | null;
  payroll: number | null;
  net: number | null;
}

/** Agrupación de los gráficos: por día hasta 31 días, por semana (lunes a domingo) hasta ~6 meses, por mes desde ahí. */
export type BalanceGrouping = 'day' | 'week' | 'month';

/** Un punto de los gráficos. `from`/`to` ya recortados al rango pedido (la primera semana o mes puede empezar antes). */
export interface BalanceBucket {
  /** Inicio natural del grupo (el día, el lunes de la semana o el día 1 del mes). */
  key: string;
  from: string;
  to: string;
  income: number;
  /** Operativos + nómina. */
  expenses: number;
  net: number;
}

export interface BalanceCategorySlice {
  type: 'operating' | 'payroll';
  category: ExpenseCategory;
  amount: number;
}

export interface BalanceDto {
  from: string;
  to: string;
  previous: { from: string; to: string; totals: BalanceTotals };
  totals: BalanceTotals;
  comparison: BalanceComparison;
  /** Series para los gráficos (la suma de los grupos es exactamente `totals`). */
  series: { grouping: BalanceGrouping; buckets: BalanceBucket[] };
  /** Gastos por categoría, de mayor a menor (para la dona). */
  expenseBreakdown: BalanceCategorySlice[];
}

export type BalanceMovementKind = 'service' | 'product' | 'discount' | 'operating' | 'payroll';

export interface BalanceMovementDto {
  id: string;
  /** Instante (ISO). Los gastos van al inicio de su día local. */
  at: string;
  /** 'in' suma al balance, 'out' resta. */
  direction: 'in' | 'out';
  kind: BalanceMovementKind;
  /** Categoría del gasto (solo egresos). */
  category: ExpenseCategory | null;
  description: string;
  /** Monto positivo (el signo lo da `direction`). */
  amount: number;
}

export interface BalanceMovementsPage {
  rows: BalanceMovementDto[];
  total: number;
  page: number;
  pageSize: number;
}

/* ---------- Fechas ---------- */

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Periodo anterior de igual duración, inmediatamente antes de `from`. */
export function previousRange(from: string, to: string): { from: string; to: string } {
  const length = daysBetween(from, to) + 1;
  const prevTo = addDays(from, -1);
  return { from: addDays(prevTo, -(length - 1)), to: prevTo };
}

/** Variación % (redondeada a 1 decimal); null cuando el anterior es 0 (no hay base contra la cual comparar). */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

export const BALANCE_PRESETS = ['today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month', 'this_year'] as const;
export type BalancePreset = (typeof BALANCE_PRESETS)[number];

/** Rango de cada atajo (semana de lunes a domingo, como en Colombia). Nunca pasa de hoy. */
export function presetRange(preset: BalancePreset, today: string): { from: string; to: string } {
  const monthStart = `${today.slice(0, 7)}-01`;
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday':
      return { from: addDays(today, -1), to: addDays(today, -1) };
    case 'this_week':
      return { from: startOfWeek(today), to: today };
    case 'last_week': {
      const start = addDays(startOfWeek(today), -7);
      return { from: start, to: addDays(start, 6) };
    }
    case 'this_month':
      return { from: monthStart, to: today };
    case 'last_month': {
      const lastDay = addDays(monthStart, -1);
      return { from: `${lastDay.slice(0, 7)}-01`, to: lastDay };
    }
    case 'this_year':
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
  }
}

/* ---------- Gráficos ---------- */

/** Días que abarca cada agrupación como máximo (rango inclusive). */
export const BALANCE_DAY_MAX = 31;
export const BALANCE_WEEK_MAX = 186;

export function balanceGrouping(from: string, to: string): BalanceGrouping {
  const days = daysBetween(from, to) + 1;
  return days <= BALANCE_DAY_MAX ? 'day' : days <= BALANCE_WEEK_MAX ? 'week' : 'month';
}

/** Inicio natural del grupo de un día (mismo criterio que `date_trunc` de PostgreSQL: semanas desde el lunes). */
export function bucketKey(day: string, grouping: BalanceGrouping): string {
  if (grouping === 'day') return day;
  if (grouping === 'week') return startOfWeek(day);
  return `${day.slice(0, 7)}-01`;
}

function nextBucket(key: string, grouping: BalanceGrouping): string {
  if (grouping === 'day') return addDays(key, 1);
  if (grouping === 'week') return addDays(key, 7);
  const [y, m] = key.split('-').map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

/** Todos los grupos del rango, en orden y sin huecos (los vacíos también se dibujan, en cero). */
export function balanceBucketRanges(from: string, to: string, grouping: BalanceGrouping): Array<{ key: string; from: string; to: string }> {
  const out: Array<{ key: string; from: string; to: string }> = [];
  for (let key = bucketKey(from, grouping); key <= to; key = nextBucket(key, grouping)) {
    const end = addDays(nextBucket(key, grouping), -1);
    out.push({ key, from: key < from ? from : key, to: end > to ? to : end });
  }
  return out;
}

/* ---------- Descargas (PDF y Excel, generados en el servidor) ---------- */

/**
 * Tope de las descargas: 12 meses de calendario. `to` puede llegar como mucho al día anterior a la misma fecha del año
 * siguiente (1 ene → 31 dic; con un año bisiesto son 366 días). Un día más ya es "más de 12 meses".
 */
export function withinExportLimit(from: string, to: string): boolean {
  // Zod corre este refinamiento aunque la fecha ya sea inválida: ese error lo reporta la validación de formato (400).
  if (!DAY_RE.test(from) || !DAY_RE.test(to)) return true;
  const [y, m, d] = from.split('-').map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y + 1, m - 1, d));
  if (Number.isNaN(next.getTime())) return true;
  const sameDayNextYear = next.toISOString().slice(0, 10);
  return to < sameDayNextYear;
}
export const BALANCE_EXPORT_FORMATS = ['pdf', 'xlsx'] as const;
export type BalanceExportFormat = (typeof BALANCE_EXPORT_FORMATS)[number];

export const balanceExportQuerySchema = z
  .object({ from: day, to: day, lang: z.enum(['es', 'en']).default('es') })
  .refine((q) => q.from <= q.to, { message: 'range_invalid', path: ['to'] })
  .refine((q) => withinExportLimit(q.from, q.to), { message: 'export_range_too_long', path: ['from'] });
export type BalanceExportQuery = z.input<typeof balanceExportQuerySchema>;
