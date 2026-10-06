import { formatMoney, type BusinessType, type Currency, type Item } from '@xiro/shared';

/** Día calendario (YYYY-MM-DD) en la zona horaria del negocio: la misma regla que usa la API para "hoy". */
export function dayKey(timezone: string, date: Date): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  }
}

/** Suma de lo cobrado HOY (día del negocio) según los servicios registrados. Cero real = 0. */
export function salesToday(records: ReadonlyArray<{ amount: number; createdAt: string }>, timezone: string, now: Date = new Date()): number {
  const today = dayKey(timezone, now);
  return records.reduce((sum, record) => (dayKey(timezone, new Date(record.createdAt)) === today ? sum + record.amount : sum), 0);
}

/** $680.000 tal cual; desde 1 millón se abrevia ($12,4 M) para que la cifra no desborde la tarjeta. */
export function formatCompactMoney(amount: number, currency: Currency = 'COP'): string {
  if (Math.abs(amount) < 1_000_000) return formatMoney(amount, currency).replace(/\s/g, '');
  const millions = (amount / 1_000_000).toFixed(1).replace(/\.0$/, '');
  const symbol = formatMoney(0, currency).replace(/[\d\s.,]/g, '');
  return `${symbol}${millions.replace('.', ',')} M`;
}

/** Etiqueta de la tarjeta del equipo según el tipo de negocio (ES/EN en el diccionario compartido). */
export const TEAM_LABEL_KEYS: Record<BusinessType, string> = {
  barbershop: 'team_label_barbershop',
  beauty_salon: 'team_label_beauty_salon',
  spa: 'team_label_spa',
  nails: 'team_label_nails',
  other: 'team_label_other',
};

/**
 * ¿Este artículo lleva inventario? Los productos sí; los servicios no (no tienen existencias). Mientras el dueño no haya
 * confirmado la clasificación (pantalla "Revisa tus servicios y productos") se cuenta todo lo que aún no confirmó, para que
 * un producto agotado que se propuso como servicio no desaparezca de Inventario ni de las alertas.
 */
export const tracksStock = (item: Partial<Pick<Item, 'kind' | 'kindConfirmed'>>): boolean => (item.kind ?? 'product') === 'product' || item.kindConfirmed === false;

/** Productos por reponer o agotados (mismo criterio de stock mínimo que ya usa Inventario). */
export function lowStock(all: ReadonlyArray<Pick<Item, 'stockStatus'> & Partial<Pick<Item, 'kind' | 'kindConfirmed'>>>): { count: number; reorder: number; outOfStock: number } {
  const items = all.filter(tracksStock);
  const reorder = items.filter((item) => item.stockStatus === 'reorder').length;
  const outOfStock = items.filter((item) => item.stockStatus === 'out_of_stock').length;
  return { count: reorder + outOfStock, reorder, outOfStock };
}
