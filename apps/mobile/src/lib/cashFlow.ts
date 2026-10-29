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
  /** Lo que cambió después del cierre firmado de hoy (ver afterCloseNote). */
  afterClose: CashDaySummary['afterClose'];
  /** Cobros del día sin venta registrada (ver unbilledNote): no suman a las entradas de la caja. */
  unbilled: CashDaySummary['unbilledRecords'];
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
    afterClose: closed ? summary.afterClose : null,
    unbilled: summary.unbilledRecords ?? { count: 0, total: 0 },
  };
}

/** Proporción de entradas frente a gastos para la barra (0–1 cada una; ambas en 0 si no hubo movimiento). */
export function flowShares(flow: Pick<DailyCashFlow, 'income' | 'expenses'>): { income: number; expenses: number } {
  const total = flow.income + flow.expenses;
  if (total <= 0) return { income: 0, expenses: 0 };
  return { income: flow.income / total, expenses: flow.expenses / total };
}

/**
 * "Después del cierre: ventas +$30.000 · efectivo esperado +$30.000. El cierre firmado no cambia." — explica la diferencia
 * entre lo firmado y el resumen de ahora (ventas registradas o anuladas, y ajustes de gastos, hechos después de cerrar).
 * null si el día no está cerrado o nada cambió después.
 */
export function afterCloseNote(afterClose: CashDaySummary['afterClose'], money: (amount: number) => string, t: (key: string, params?: Record<string, string | number>) => string): string | null {
  if (!afterClose || (afterClose.salesDelta === 0 && afterClose.expectedCashDelta === 0)) return null;
  const signed = (n: number) => `${n > 0 ? '+' : ''}${money(n)}`;
  return t('cash_after_close', { sales: signed(afterClose.salesDelta), cash: signed(afterClose.expectedCashDelta) });
}

/**
 * "Cobros sin venta registrada (citas completadas o servicios registrados a mano): $X. No suman a las ventas ni al efectivo
 * de la caja." — explica por qué el Balance muestra más ingresos que la caja. null si no hubo.
 */
export function unbilledNote(unbilled: CashDaySummary['unbilledRecords'] | undefined, money: (amount: number) => string, t: (key: string, params?: Record<string, string | number>) => string): string | null {
  if (!unbilled || unbilled.count === 0) return null;
  return t(unbilled.count === 1 ? 'cash_unbilled_one' : 'cash_unbilled', { amount: money(unbilled.total), count: unbilled.count });
}
