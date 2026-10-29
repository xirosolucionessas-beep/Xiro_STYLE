import type { CashBreakdownLine, CashEmployeeBreakdownSummary } from '@xiro/shared';

/**
 * Cierre de caja: lo que muestran web y Android/iOS del desglose por empleado y del estado de la actualización automática.
 * Sin React Native ni DOM, para poder probarlo. Los importes ya vienen calculados por el servidor (nunca se recalculan aquí).
 */
type T = (key: string, params?: Record<string, string | number>) => string;

/** Cada cuánto se vuelve a pedir el resumen de HOY mientras la pantalla está visible (no es tiempo real instantáneo). */
export const CASH_LIVE_INTERVAL_MS = 30_000;

export interface BreakdownLineView {
  key: string;
  label: string;
  net: string;
  detail: string;
}
export interface BreakdownCardView {
  id: string;
  name: string;
  /** 0–1: su neto sobre el neto de todos los empleados (barra animada). */
  share: number;
  units: string;
  gross: string;
  discount: string;
  net: string;
  lines: BreakdownLineView[];
}
export interface BreakdownView {
  empty: boolean;
  employees: BreakdownCardView[];
  /** null si no hay nada sin atribuir. */
  unattributed: { gross: string; discount: string; net: string; services: BreakdownLineView[]; products: BreakdownLineView[] } | null;
  tips: string;
  hasTips: boolean;
  reconcile: string;
}

const units = (t: T, n: number) => (n === 1 ? t('cash_close_breakdown_unit_one') : t('cash_close_breakdown_units', { n }));
const discountText = (fmt: (n: number) => string, amount: number) => (amount > 0 ? `−${fmt(amount)}` : fmt(0));

function lineViews(t: T, fmt: (n: number) => string, prefix: string, lines: CashBreakdownLine[]): BreakdownLineView[] {
  return lines.map((line) => ({
    key: `${prefix}:${line.name}`,
    label: t('cash_close_breakdown_line', { name: line.name, units: line.units }),
    net: fmt(line.net),
    detail: `${t('cash_close_breakdown_gross')} ${fmt(line.gross)} · ${t('cash_close_breakdown_discount')} ${discountText(fmt, line.discount)}`,
  }));
}

export function breakdownView(t: T, fmt: (n: number) => string, breakdown: CashEmployeeBreakdownSummary): BreakdownView {
  const u = breakdown.unattributed;
  const hasUnattributed = u.serviceUnits + u.productUnits > 0;
  const employeesNet = breakdown.employees.reduce((sum, e) => sum + Math.max(0, e.net), 0);
  return {
    empty: breakdown.totals.total === 0 && breakdown.employees.length === 0 && !hasUnattributed,
    employees: breakdown.employees.map((e) => ({
      id: e.employeeId,
      name: e.employeeName,
      share: employeesNet > 0 ? Math.max(0, e.net) / employeesNet : 0,
      units: units(t, e.serviceUnits),
      gross: fmt(e.gross),
      discount: discountText(fmt, e.discount),
      net: fmt(e.net),
      lines: lineViews(t, fmt, e.employeeId, e.services),
    })),
    unattributed: hasUnattributed
      ? { gross: fmt(u.gross), discount: discountText(fmt, u.discount), net: fmt(u.net), services: lineViews(t, fmt, 'svc', u.services), products: lineViews(t, fmt, 'prod', u.products) }
      : null,
    tips: fmt(breakdown.totals.tip),
    hasTips: breakdown.totals.tip > 0,
    reconcile: t('cash_close_breakdown_reconcile', { net: fmt(breakdown.totals.net), tips: fmt(breakdown.totals.tip), total: fmt(breakdown.totals.total) }),
  };
}

/**
 * Estado de la actualización automática. `live` = es el día de HOY (los días pasados y sus cierres no se vuelven a pedir solos).
 * - initial: aún no hay datos (carga inicial) · refreshing: hay datos y se está pidiendo otra vez en segundo plano
 * - fresh / stale: datos al día o más viejos de 2 intervalos · error: falló una actualización pero hay datos válidos
 * - failed: falló y no hay datos · paused: hoy, pero la pantalla o la app no están activas · static: día pasado
 */
export type LiveStatusKind = 'initial' | 'refreshing' | 'fresh' | 'stale' | 'error' | 'failed' | 'paused' | 'static';

export function liveStatus(input: { live: boolean; active: boolean; hasData: boolean; isFetching: boolean; isError: boolean; dataUpdatedAt: number; now: number; intervalMs?: number }): LiveStatusKind {
  const interval = input.intervalMs ?? CASH_LIVE_INTERVAL_MS;
  if (!input.hasData) return input.isError ? 'failed' : 'initial';
  if (!input.live) return 'static';
  if (input.isFetching) return 'refreshing';
  if (input.isError) return 'error';
  if (!input.active) return 'paused';
  return input.now - input.dataUpdatedAt > interval * 2 ? 'stale' : 'fresh';
}

export function liveStatusText(t: T, kind: LiveStatusKind, time: string, intervalMs = CASH_LIVE_INTERVAL_MS): string {
  const auto = t('cash_close_live_auto', { seconds: Math.round(intervalMs / 1000) });
  switch (kind) {
    case 'fresh':
      return `${t('cash_close_live_updated', { time })} · ${auto}`;
    case 'refreshing':
      return t('cash_close_live_refreshing');
    case 'stale':
      return t('cash_close_live_stale', { time });
    case 'error':
      return t('cash_close_live_error', { time });
    case 'paused':
      return `${t('cash_close_live_updated', { time })} · ${t('cash_close_live_paused')}`;
    case 'static':
      return t('cash_close_live_static');
    case 'failed':
      return t('cash_close_load_error');
    default:
      return '';
  }
}
