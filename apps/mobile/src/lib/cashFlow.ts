import type { CashClosingDto, CashDaySummary, SalePaymentMethod } from '@xiro/shared';

/**
 * Flujo de caja del día (tarjeta del Inicio, web y Android/iOS). Todo sale del resumen del día que ya calcula el servidor
 * (`GET /cash/close-summary`, el mismo del Cierre de caja): aquí solo se ordena para mostrarlo.
 *  - Entradas: todo lo cobrado hoy en ventas completadas, en cualquier método (efectivo, tarjeta, Nequi…). Incluye las
 *    propinas porque también entraron; se muestran aparte para que se vea cuánto son.
 *  - Gastos: todos los gastos vigentes con fecha de hoy (operativos y nómina), salgan o no de la caja.
 *  - Neto del día = entradas − gastos.
 *  - Caja: si se abrió y aún no se cerró, el efectivo que debería haber ahora (base + ventas en efectivo − gastos pagados
 *    desde la caja) frente a la base inicial.
 */
export interface DailyCashFlow {
  income: number;
  tips: number;
  expenses: number;
  net: number;
  /** Cobrado por método, de mayor a menor (solo los que tuvieron cobros). */
  methods: Array<{ method: SalePaymentMethod; total: number }>;
  cash: { state: 'not_opened' } | { state: 'open'; opening: number; current: number } | { state: 'closed'; opening: number };
}

export function dailyCashFlow(summary: CashDaySummary, closings: CashClosingDto[] = []): DailyCashFlow {
  const closed = closings.some((c) => c.day === summary.day && c.status === 'completed');
  const cash: DailyCashFlow['cash'] =
    summary.opening === null
      ? { state: 'not_opened' }
      : closed || summary.expectedCash === null
        ? { state: 'closed', opening: summary.opening }
        : { state: 'open', opening: summary.opening, current: summary.expectedCash };
  return {
    income: summary.totalSales,
    tips: summary.totalTip,
    expenses: summary.totalExpenses,
    net: summary.totalSales - summary.totalExpenses,
    methods: summary.salesByMethod.filter((m) => m.total > 0).map((m) => ({ method: m.method, total: m.total })),
    cash,
  };
}

/** Proporción de entradas frente a gastos para la barra (0–1 cada una; ambas en 0 si no hubo movimiento). */
export function flowShares(flow: Pick<DailyCashFlow, 'income' | 'expenses'>): { income: number; expenses: number } {
  const total = flow.income + flow.expenses;
  if (total <= 0) return { income: 0, expenses: 0 };
  return { income: flow.income / total, expenses: flow.expenses / total };
}
