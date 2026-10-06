import {
  addDays,
  cashBalance,
  employeePerformance,
  openingBaseTotal,
  paymentMethodBreakdown,
  reportBuckets,
  resolveReportRange,
  salesSummary,
  topSaleClients,
  topSaleItems,
  type EmployeePerformanceRow,
  type PaymentMethodRow,
  type RankRow,
  type ReportBucket,
  type ReportPeriod,
  type ReportWindow,
} from '@xiro/shared';
import { and, desc, eq, gte, lt } from 'drizzle-orm';
import type { Ctx } from '../context';
import { businesses, cashOpenings, sales } from '../db/schema';
import { loadSaleDtos } from '../routes/sales';

/**
 * Datos de ventas para las herramientas de consulta del asistente de IA (sección 6 del encargo): usa EXACTAMENTE los
 * mismos cálculos que el panel ("Reportes", en `@xiro/shared/reports`), para que las cifras que cita el asistente
 * coincidan siempre con las que vería el dueño. Vive aparte de `routes/sales.ts` (que sirve la pantalla de Reportes,
 * acotada a 200 filas) porque aquí la exactitud es la prioridad: el asistente nunca debe citar un total recortado.
 */

/** Más de esto en una sola ventana sería un negocio con un volumen fuera de lo que esta vista puede traer de una sola
 * vez; un negocio real no debería acercarse ni de lejos. Tope de sanidad, no un límite de diseño. */
const SANITY_LIMIT = 50_000;

export async function timezoneOf(db: Ctx['db'], businessId: string): Promise<string | null> {
  const [row] = await db.select({ timezone: businesses.timezone }).from(businesses).where(eq(businesses.id, businessId)).limit(1);
  return row?.timezone ?? null;
}

/** Ventas del negocio dentro de `[window.from, window.to)`, sin el tope de 200 filas de `GET /sales`. */
export async function loadSalesInWindow(db: Ctx['db'], businessId: string, window: Pick<ReportWindow, 'from' | 'to'>) {
  const rows = await db
    .select()
    .from(sales)
    .where(and(eq(sales.businessId, businessId), gte(sales.createdAt, new Date(window.from)), lt(sales.createdAt, new Date(window.to))))
    .orderBy(desc(sales.createdAt))
    .limit(SANITY_LIMIT);
  return loadSaleDtos(db, businessId, rows);
}

/** Suma de las bases de caja (`cash_openings`) registradas dentro de la ventana (días LOCALES, no instantes UTC). */
export async function loadOpeningBaseTotal(db: Ctx['db'], businessId: string, window: Pick<ReportWindow, 'startDate' | 'days'>): Promise<number> {
  const toDay = addDays(window.startDate, window.days - 1);
  const rows = await db
    .select({ amount: cashOpenings.amount })
    .from(cashOpenings)
    .where(and(eq(cashOpenings.businessId, businessId), gte(cashOpenings.day, window.startDate), lt(cashOpenings.day, addDays(toDay, 1))));
  return openingBaseTotal(rows);
}

export interface SalesReport {
  period: ReportPeriod;
  range: { current: ReportWindow; previous: ReportWindow };
  current: { total: number; count: number; average: number | null };
  previous: { total: number; count: number; average: number | null };
  buckets: ReportBucket[];
  paymentMethods: PaymentMethodRow[];
  employees: EmployeePerformanceRow[];
  topServices: RankRow[];
  topProducts: RankRow[];
  topClients: RankRow[];
  openingBase: number;
  cashTotal: number;
}

/**
 * Reporte completo de un periodo (y su comparación con el anterior), calculado con las mismas ventas y las mismas
 * funciones que usa "Reportes" en el panel. Pensado para que las herramientas `ventas_resumen`, `servicios_mas_vendidos`,
 * `empleados_rendimiento` y `caja_estado` del asistente compartan una sola consulta en vez de repetirla cada una.
 */
export async function buildSalesReport(db: Ctx['db'], businessId: string, period: ReportPeriod, timezone: string, now: Date = new Date(), custom?: { from: string; to: string }): Promise<SalesReport> {
  const range = resolveReportRange(period, timezone, now, custom);
  const [currentSales, previousSales, openingBase] = await Promise.all([loadSalesInWindow(db, businessId, range.current), loadSalesInWindow(db, businessId, range.previous), loadOpeningBaseTotal(db, businessId, range.current)]);

  const paymentMethods = paymentMethodBreakdown(currentSales);
  return {
    period,
    range,
    current: salesSummary(currentSales),
    previous: salesSummary(previousSales),
    buckets: reportBuckets(currentSales, timezone, range.current),
    paymentMethods,
    employees: employeePerformance(currentSales),
    topServices: topSaleItems(currentSales, 'service'),
    topProducts: topSaleItems(currentSales, 'product'),
    topClients: topSaleClients(currentSales),
    openingBase,
    cashTotal: cashBalance(openingBase, paymentMethods),
  };
}
