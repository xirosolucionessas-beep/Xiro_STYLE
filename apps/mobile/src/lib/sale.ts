import type { Item, SalePaymentMethod } from '@xiro/shared';
import { fold } from './search';

/**
 * Lógica pura de "Registrar venta" (POS): el carrito, sus totales, los pagos y el cambio. Sin React ni red, así que se
 * prueba directo. La pantalla (web/screens/SaleForm.tsx) solo la usa para calcular lo que muestra.
 */

export interface CartLine {
  /** Id local (no el del servidor): identifica la línea mientras se arma la venta, para poder editarla o quitarla. */
  key: string;
  kind: 'service' | 'product';
  /** Artículo del catálogo; null = línea a mano. */
  itemId: string | null;
  name: string;
  unitPrice: number;
  /** Precio original del catálogo, para saber si `unitPrice` es un ajuste puntual (y para poder deshacerlo). */
  catalogPrice: number | null;
  quantity: number;
  employeeId: string | null;
  /** Solo una línea a mano: además de venderla, guardarla en el catálogo. */
  saveToCatalog: boolean;
  /** Existencias actuales del producto (null = servicio o línea a mano): para avisar si la cantidad no alcanza. */
  stock: number | null;
}

export const lineTotal = (line: Pick<CartLine, 'unitPrice' | 'quantity'>): number => line.unitPrice * line.quantity;

export const cartSubtotal = (lines: readonly CartLine[]): number => lines.reduce((sum, line) => sum + lineTotal(line), 0);

/** Líneas de producto cuya cantidad pedida supera las existencias — para avisar ANTES de cobrar, no solo si el servidor la rechaza. */
export const insufficientStockLines = (lines: readonly CartLine[]): CartLine[] => lines.filter((line) => line.kind === 'product' && line.stock !== null && line.quantity > line.stock);

export interface PaymentRow {
  key: string;
  method: SalePaymentMethod;
  /** Texto tal como lo escribe la persona (COP sin decimales); se convierte a número al enviar. */
  amount: number;
  /** Solo en efectivo: cuánto entregó la persona. null = pagó el monto exacto (sin cambio). */
  receivedAmount: number | null;
}

export const paymentsTotal = (payments: readonly PaymentRow[]): number => payments.reduce((sum, p) => sum + p.amount, 0);

/** Cambio total a entregar (solo cuenta cuando se indicó cuánto entregó la persona). */
export const changeDue = (payments: readonly PaymentRow[]): number => payments.reduce((sum, p) => sum + (p.receivedAmount !== null ? Math.max(0, p.receivedAmount - p.amount) : 0), 0);

/** Total de la venta: subtotal menos descuento (nunca negativo) más propina. */
export const saleTotal = (subtotal: number, discount: number, tip: number): number => Math.max(0, subtotal - discount) + tip;

/** Cuánto falta por asignar a un método de pago para completar el total (negativo = ya se asignó de más). */
export const remainingToPay = (total: number, payments: readonly PaymentRow[]): number => total - paymentsTotal(payments);

/** Un artículo del catálogo, activo para vender: publicado o no da igual (la venta es interna), pero coincide con la búsqueda/categoría. */
export function filterCatalog<T extends Pick<Item, 'name' | 'categoryId' | 'kind'>>(items: readonly T[], query: string, categoryId: string | null, kind: 'service' | 'product'): T[] {
  const q = fold(query);
  return items.filter((item) => item.kind === kind && (!categoryId || item.categoryId === categoryId) && (!q || fold(item.name).includes(q)));
}
