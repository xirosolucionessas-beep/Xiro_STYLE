import type { ExpenseAdjustmentDto } from '@xiro/shared';
import { adjustmentText, expenseDetailView, groupExpensesByBeneficiary, saleDetailView, type DetailFormat, type ExpenseDetailView, type SaleDetailView } from './cashDetail';
import { useCashDayExpenses, useCashDaySales } from './queries';

/** Qué detalle de ventas está abierto: un empleado (por id) o lo que no tiene empleado atribuido. */
export type CashDetailTarget = { scope: 'employee'; employeeId: string; name: string } | { scope: 'unattributed' };

/** Carga inicial · error sin datos (con reintento) · vacío · listo (con datos; `refreshError` si falló una actualización). */
export type DetailState = 'loading' | 'error' | 'empty' | 'ready';

export interface CashSalesDetailModel {
  state: DetailState;
  refreshError: boolean;
  summary: string | null;
  showing: string | null;
  rows: SaleDetailView[];
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => void;
  retry: () => void;
  updatedAt: number;
}

export interface CashExpensesDetailModel {
  state: DetailState;
  refreshError: boolean;
  summary: string | null;
  showing: string | null;
  groups: Array<{ key: string; title: string; items: ExpenseDetailView[] }>;
  adjustments: string[];
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => void;
  retry: () => void;
  updatedAt: number;
}

function stateOf(q: { isLoading: boolean; isError: boolean; data?: unknown }, count: number): DetailState {
  if (q.isLoading) return 'loading';
  if (q.isError && !q.data) return 'error';
  return count === 0 ? 'empty' : 'ready';
}

/**
 * Datos del "Ver más" del cierre (web y Android/iOS): solo se piden mientras el detalle está abierto, y con el mismo intervalo
 * automático del cierre (`interval`: solo hoy y con la pantalla visible). Al actualizarse se conservan la selección y las
 * páginas ya cargadas; ante un error temporal se mantienen los últimos datos válidos.
 */
export function useCashDetail(input: { day: string; target: CashDetailTarget | null; expensesOpen: boolean; interval: number | false; f: DetailFormat; adjustments: ExpenseAdjustmentDto[] }): { sales: CashSalesDetailModel; expenses: CashExpensesDetailModel } {
  const { f } = input;
  const salesQuery = useCashDaySales(input.target ? { day: input.day, scope: input.target.scope, ...(input.target.scope === 'employee' ? { employeeId: input.target.employeeId } : {}) } : null, input.target ? input.interval : false);
  const expensesQuery = useCashDayExpenses(input.expensesOpen ? input.day : null, null, input.expensesOpen ? input.interval : false);

  const salePages = salesQuery.data?.pages ?? [];
  const saleRows = salePages.flatMap((p) => p.data).map((dto) => saleDetailView(f, dto));
  const saleSummary = salePages[0]?.summary ?? null;
  const saleTotal = saleSummary ? saleSummary.completedCount + saleSummary.voidedCount : null;

  const expensePages = expensesQuery.data?.pages ?? [];
  const expenseList = expensePages.flatMap((p) => p.data);
  const expenseSummary = expensePages[0]?.summary ?? null;

  return {
    sales: {
      state: stateOf(salesQuery, saleRows.length),
      refreshError: salesQuery.isError && Boolean(salesQuery.data),
      summary: saleSummary ? f.t('cash_detail_summary', { completed: saleSummary.completedCount, voided: saleSummary.voidedCount }) : null,
      showing: saleTotal !== null && saleTotal > saleRows.length ? f.t('cash_detail_showing', { shown: saleRows.length, total: saleTotal }) : null,
      rows: saleRows,
      hasMore: Boolean(salesQuery.hasNextPage),
      loadingMore: salesQuery.isFetchingNextPage,
      loadMore: () => void salesQuery.fetchNextPage(),
      retry: () => void salesQuery.refetch(),
      updatedAt: salesQuery.dataUpdatedAt,
    },
    expenses: {
      state: stateOf(expensesQuery, expenseList.length),
      refreshError: expensesQuery.isError && Boolean(expensesQuery.data),
      summary: expenseSummary ? f.t('cash_exp_summary', { count: expenseSummary.activeCount, total: f.fmt(expenseSummary.activeTotal) }) : null,
      showing: expenseSummary && expenseSummary.count > expenseList.length ? f.t('cash_detail_showing', { shown: expenseList.length, total: expenseSummary.count }) : null,
      groups: groupExpensesByBeneficiary(f.t, expenseList).map((g) => ({ key: g.key, title: g.title, items: g.items.map((e) => expenseDetailView(f, e)) })),
      adjustments: input.adjustments.map((a) => adjustmentText(f, a)),
      hasMore: Boolean(expensesQuery.hasNextPage),
      loadingMore: expensesQuery.isFetchingNextPage,
      loadMore: () => void expensesQuery.fetchNextPage(),
      retry: () => void expensesQuery.refetch(),
      updatedAt: expensesQuery.dataUpdatedAt,
    },
  };
}
