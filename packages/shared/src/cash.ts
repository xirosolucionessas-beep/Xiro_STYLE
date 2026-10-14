import { z } from 'zod';
import { SALE_PAYMENT_METHODS, type SalePaymentMethod } from './sales';
import type { ExpenseAdjustmentDto, ExpenseDto } from './expenses';

/**
 * Gastos (salidas de caja) y cierre de caja (Tarea 8). El cierre solo congela lo que no tiene otra fuente — la base con
 * la que se abrió el día y lo que la persona contó físicamente —; el resto del resumen se recalcula al leerlo a partir
 * de las ventas, los registros de servicio y los gastos de ese día, que ya son inmutables por su cuenta.
 */

// Gastos: el esquema y el DTO viven ahora en ./expenses (ampliados y compatibles con el formato anterior).

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export const cashCloseInputSchema = z.object({
  day: z.string().regex(DAY_RE, 'required'),
  countedAmount: z.number().int().min(0).max(1_000_000_000),
  note: z.string().trim().max(500).default(''),
});
export type CashCloseInput = z.input<typeof cashCloseInputSchema>;

export const voidCashCloseInputSchema = z.object({ reason: z.string().trim().min(1, 'required').max(200) });
export type VoidCashCloseInput = z.input<typeof voidCashCloseInputSchema>;

export interface CashSalesByMethod {
  method: SalePaymentMethod;
  total: number;
  count: number;
}

export interface CashTopEntry {
  name: string;
  count: number;
  total: number;
}

export interface CashEmployeeSales {
  employeeId: string;
  employeeName: string;
  total: number;
  count: number;
}

export interface CashHourlyBucket {
  /** 0–23, hora local del negocio. */
  hour: number;
  total: number;
}

/** Resumen del día (en curso o ya cerrado), recalculado siempre a partir de los datos reales de ese día. */
export interface CashDaySummary {
  day: string;
  /** null = ese día nunca se abrió la caja. */
  opening: number | null;
  salesByMethod: CashSalesByMethod[];
  totalSales: number;
  totalTip: number;
  servicesCount: number;
  productsCount: number;
  topServices: CashTopEntry[];
  topProducts: CashTopEntry[];
  employeeSales: CashEmployeeSales[];
  expenses: ExpenseDto[];
  totalExpenses: number;
  /** Ajustes a gastos de este día hechos DESPUÉS del cierre (el cierre firmado no cambia; quedan a la vista). */
  adjustmentsAfterClose: ExpenseAdjustmentDto[];
  /**
   * Si el día ya tiene un cierre firmado: cuánto cambiaron las ventas y el efectivo esperado DESPUÉS de firmarlo (ventas
   * nuevas suman, anuladas restan; los ajustes de gastos desde caja también mueven el efectivo). El cierre firmado no
   * cambia: esto es lo que explica la diferencia entre lo firmado y el resumen de ahora. null = el día no está cerrado.
   */
  afterClose: { closedAt: string; closedSales: number; closedExpectedCash: number; salesDelta: number; expectedCashDelta: number } | null;
  /**
   * Cobros del día SIN venta registrada: citas completadas y servicios registrados a mano. Cuentan como ingreso en el Balance
   * e Inicio, pero no tienen método de pago, así que NO entran en las ventas ni en el efectivo esperado de la caja (decisión
   * del producto: se muestran aparte para explicar la diferencia con el Balance).
   */
  unbilledRecords: { count: number; total: number };
  /** opening + ventas en efectivo − gastos en efectivo. null si `opening` es null (no se puede cerrar sin abrir). */
  expectedCash: number | null;
  hourly: CashHourlyBucket[];
  clientsServed: number;
  newClients: number;
  appointments: { completed: number; cancelled: number; noShow: number };
}

/** Base de caja registrada para UN día (distinto de `CashOpening` en schemas.ts, que es la de "hoy" sin fecha explícita). */
export interface CashOpeningDto {
  id: string;
  day: string;
  amount: number;
  note: string;
  openedAt: string;
}

export interface CashClosingDto {
  id: string;
  day: string;
  openingAmount: number;
  countedAmount: number;
  expectedAmount: number;
  /** countedAmount − expectedAmount: positivo = sobrante, negativo = faltante. */
  difference: number;
  totalSales: number;
  totalTip: number;
  totalExpenses: number;
  note: string;
  status: 'completed' | 'voided';
  voidReason: string;
  closedByName: string;
  createdAt: string;
  /** Solo al consultar un cierre puntual (no en la lista del historial). */
  summary?: CashDaySummary;
}
