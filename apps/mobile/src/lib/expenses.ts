import { addDays, addMonths } from '@xiro/shared';

/** Atajos de periodo de la pantalla de Gastos (días locales del negocio, ambos incluidos). "custom" usa el rango que
 * elija la persona (ver `custom` en `periodRange`), no uno calculado aquí. */
export type ExpensePeriod = 'this_month' | 'last_month' | 'last_7' | 'this_year' | 'custom';
export const EXPENSE_PERIODS: ExpensePeriod[] = ['this_month', 'last_month', 'last_7', 'this_year', 'custom'];

export function periodRange(period: ExpensePeriod, today: string, custom?: { from: string; to: string }): { from: string; to: string } {
  const monthStart = `${today.slice(0, 7)}-01`;
  if (period === 'this_month') return { from: monthStart, to: today };
  if (period === 'last_month') return { from: addMonths(monthStart, -1), to: addDays(monthStart, -1) };
  if (period === 'last_7') return { from: addDays(today, -6), to: today };
  if (period === 'custom') return custom ?? { from: today, to: today };
  return { from: `${today.slice(0, 4)}-01-01`, to: today };
}
