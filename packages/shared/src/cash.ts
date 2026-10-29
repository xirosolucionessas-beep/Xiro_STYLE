import { z } from 'zod';
import { pageQuerySchema, type Page } from './pagination';
import { SALE_PAYMENT_METHODS, type SaleDto, type SalePaymentMethod } from './sales';
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

/** Un servicio dentro del desglose: unidades (`quantity`), bruto, su parte del descuento y neto. */
export interface CashBreakdownLine {
  name: string;
  units: number;
  gross: number;
  discount: number;
  net: number;
}

/** Lo que produjo UNA persona en servicios ese día (quien realizó el servicio, no quien registró la venta ni quien cerró). */
export interface CashEmployeeBreakdown {
  employeeId: string;
  employeeName: string;
  /** Unidades de servicio (una línea "Corte ×3" cuenta 3). */
  serviceUnits: number;
  services: CashBreakdownLine[];
  gross: number;
  discount: number;
  /** gross − discount. Ventas netas: no es ganancia ni comisión. */
  net: number;
}

/**
 * Desglose del día por empleado. Regla del descuento (guardado por VENTA, no por línea): se reparte entre TODAS las líneas de
 * esa venta en proporción a su importe antes del descuento; los redondeos se resuelven por mayor residuo (empate: la línea que
 * aparece primero), así la suma repartida es exactamente el descuento guardado. Las propinas NO se atribuyen (el sistema no
 * registra quién la recibió) y los productos tampoco (no se registra quién los vendió): van en `unattributed`.
 * Conciliación: Σ net de empleados + unattributed.net = totals.net, y totals.net + totals.tip = ventas del día.
 */
export interface CashEmployeeBreakdownSummary {
  employees: CashEmployeeBreakdown[];
  /** Servicios sin profesional registrado y todos los productos (sin atribución de vendedor). */
  unattributed: { serviceUnits: number; services: CashBreakdownLine[]; productUnits: number; products: CashBreakdownLine[]; gross: number; discount: number; net: number };
  totals: { gross: number; discount: number; net: number; tip: number; total: number };
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
  /** Desglose por empleado con bruto, descuento repartido y neto (ver `CashEmployeeBreakdownSummary`). Opcional por compatibilidad. */
  employeeBreakdown?: CashEmployeeBreakdownSummary;
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

/**
 * Reparte `amount` entre importes en proporción a cada uno (método del mayor residuo). Determinista: la suma del resultado es
 * exactamente `amount`, ninguna parte supera su importe (si `amount` ≤ la suma) y los empates van a la línea que aparece primero.
 */
export function allocateProportionally(amounts: readonly number[], amount: number): number[] {
  const base = amounts.reduce((sum, a) => sum + a, 0);
  if (amount <= 0 || base <= 0) return amounts.map(() => 0);
  const target = Math.min(amount, base);
  // Aritmética entera exacta (BigInt): a·target puede superar 2^53 con importes grandes.
  const bigBase = BigInt(base);
  const products = amounts.map((a) => BigInt(a) * BigInt(target));
  const shares = products.map((p) => Number(p / bigBase));
  let left = target - shares.reduce((sum, a) => sum + a, 0);
  // Mayor residuo (a·target mod base); empate: la línea que aparece primero.
  const order = products.map((p, index) => ({ index, rest: p % bigBase })).sort((x, y) => (y.rest > x.rest ? 1 : y.rest < x.rest ? -1 : x.index - y.index));
  for (const { index } of order) {
    if (left === 0) break;
    shares[index]! += 1;
    left -= 1;
  }
  return shares;
}

export interface BreakdownSale {
  id: string;
  discount: number;
  tip: number;
  total: number;
}
export interface BreakdownItem {
  saleId: string;
  kind: 'service' | 'product';
  name: string;
  quantity: number;
  /** Importe de la línea antes del descuento (precio unitario × cantidad). */
  total: number;
  employeeId: string | null;
}

/** Calcula el desglose a partir de las ventas COMPLETADAS del día y sus líneas (el servidor ya filtró día, negocio y anuladas). */
export function buildEmployeeBreakdown(sales: readonly BreakdownSale[], items: readonly BreakdownItem[], names: ReadonlyMap<string, string>): CashEmployeeBreakdownSummary {
  const bySale = new Map<string, BreakdownItem[]>();
  for (const item of items) bySale.set(item.saleId, [...(bySale.get(item.saleId) ?? []), item]);

  type Acc = { units: number; gross: number; discount: number; lines: Map<string, CashBreakdownLine> };
  const acc = (): Acc => ({ units: 0, gross: 0, discount: 0, lines: new Map() });
  const employees = new Map<string, Acc>();
  const loose = { services: acc(), products: acc() };
  const add = (bucket: Acc, item: BreakdownItem, discount: number) => {
    bucket.units += item.quantity;
    bucket.gross += item.total;
    bucket.discount += discount;
    const line = bucket.lines.get(item.name) ?? { name: item.name, units: 0, gross: 0, discount: 0, net: 0 };
    line.units += item.quantity;
    line.gross += item.total;
    line.discount += discount;
    line.net = line.gross - line.discount;
    bucket.lines.set(item.name, line);
  };

  let gross = 0;
  let discount = 0;
  let tip = 0;
  let total = 0;
  for (const sale of sales) {
    const lines = bySale.get(sale.id) ?? [];
    const shares = allocateProportionally(lines.map((l) => l.total), sale.discount);
    lines.forEach((item, index) => {
      const share = shares[index] ?? 0;
      if (item.kind === 'service' && item.employeeId) {
        const bucket = employees.get(item.employeeId) ?? acc();
        add(bucket, item, share);
        employees.set(item.employeeId, bucket);
      } else {
        add(item.kind === 'product' ? loose.products : loose.services, item, share);
      }
    });
    gross += lines.reduce((sum, l) => sum + l.total, 0);
    discount += sale.discount;
    tip += sale.tip;
    total += sale.total;
  }

  const sorted = (lines: Map<string, CashBreakdownLine>) => [...lines.values()].sort((a, b) => b.net - a.net || a.name.localeCompare(b.name));
  return {
    employees: [...employees.entries()]
      .map(([employeeId, b]) => ({ employeeId, employeeName: names.get(employeeId) ?? '', serviceUnits: b.units, services: sorted(b.lines), gross: b.gross, discount: b.discount, net: b.gross - b.discount }))
      .sort((a, b) => b.net - a.net || a.employeeName.localeCompare(b.employeeName)),
    unattributed: {
      serviceUnits: loose.services.units,
      services: sorted(loose.services.lines),
      productUnits: loose.products.units,
      products: sorted(loose.products.lines),
      gross: loose.services.gross + loose.products.gross,
      discount: loose.services.discount + loose.products.discount,
      net: loose.services.gross + loose.products.gross - loose.services.discount - loose.products.discount,
    },
    totals: { gross, discount, net: gross - discount, tip, total },
  };
}

/* ---------- "Ver más": ventas del día de un empleado (o sin atribución) ---------- */

/**
 * Detalle de ventas del cierre: las del día (zona horaria del negocio) en las que `employeeId` REALIZÓ al menos un servicio
 * (`scope: 'employee'`), o las que tienen productos o servicios sin profesional (`scope: 'unattributed'`). Paginado por
 * cursor: nunca se corta en silencio. Incluye las anuladas, marcadas, que no suman en `summary`.
 */
export const cashDaySalesQuerySchema = pageQuerySchema
  .extend({
    day: z.string().regex(DAY_RE, 'required'),
    scope: z.enum(['employee', 'unattributed']),
    employeeId: z
      .string()
      .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'not_found')
      .optional(),
  })
  .refine((q) => (q.scope === 'employee') === Boolean(q.employeeId), { message: 'validation_error', path: ['employeeId'] });
export type CashDaySalesQuery = z.input<typeof cashDaySalesQuerySchema>;

/** Línea de la venta que corresponde a la vista: importe guardado (`gross`) y su parte DISTRIBUIDA del descuento de la venta. */
export interface CashDaySaleLine {
  id: string;
  kind: 'service' | 'product';
  name: string;
  quantity: number;
  unitPrice: number;
  /** Guardado en la línea (precio × cantidad). */
  gross: number;
  /** Descuento distribuido: reparto contable del descuento de la venta (no guardado por línea). Ver allocateProportionally. */
  discountShare: number;
  net: number;
}

export interface CashDaySaleDto {
  /** La venta completa tal como se guardó (cliente, quién la registró, todas sus líneas, descuento, propina, total y pagos). */
  sale: SaleDto;
  /** Solo las líneas de esta vista (las del empleado, o los productos y servicios sin profesional). */
  lines: CashDaySaleLine[];
  gross: number;
  discountShare: number;
  net: number;
}

export interface CashDaySalesSummary {
  /** Ventas completadas y anuladas que cumplen el filtro (TODO el día, no solo lo cargado). */
  completedCount: number;
  voidedCount: number;
  /** Solo ventas completadas; coincide con el desglose del cierre (`employeeBreakdown`). */
  gross: number;
  discountShare: number;
  net: number;
  units: number;
}

export interface CashDaySalesPage extends Page<CashDaySaleDto> {
  /** Solo en la primera página (sin `cursor`). */
  summary: CashDaySalesSummary | null;
}

/** Qué líneas de una venta pertenecen a la vista: servicios hechos por el empleado, o productos y servicios sin profesional. */
export function lineInScope(line: { kind: 'service' | 'product'; employeeId: string | null }, scope: 'employee' | 'unattributed', employeeId?: string | null): boolean {
  if (scope === 'employee') return line.kind === 'service' && line.employeeId !== null && line.employeeId === employeeId;
  return line.kind === 'product' || line.employeeId === null;
}
