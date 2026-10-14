import { z } from 'zod';
import { withinExportLimit } from './balance';
import { pageQuerySchema, type Page } from './pagination';
import { SALE_PAYMENT_METHODS, type SalePaymentMethod } from './sales';

/**
 * Gastos del negocio (módulo Finanzas). Amplía los gastos de caja que ya existían SIN romperlos: un gasto con el formato
 * de siempre (monto, descripción, método) se guarda como "operativo · otros", con fecha de hoy y —si es en efectivo—
 * pagado desde la caja, exactamente como antes.
 *
 * Montos en pesos enteros (igual que el resto del sistema). Catálogo de categorías por tipo, ampliable aquí (no hace falta
 * migración: la base guarda el código y la validación vive en este archivo).
 */

export const EXPENSE_TYPES = ['operating', 'payroll'] as const;
export type ExpenseType = (typeof EXPENSE_TYPES)[number];

export const EXPENSE_CATEGORIES = {
  operating: ['rent', 'utilities_water', 'utilities_power', 'utilities_internet', 'supplies', 'cleaning', 'maintenance', 'other'],
  payroll: ['salary', 'commission', 'advance', 'bonus'],
} as const satisfies Record<ExpenseType, readonly string[]>;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[ExpenseType][number];
export const ALL_EXPENSE_CATEGORIES = [...EXPENSE_CATEGORIES.operating, ...EXPENSE_CATEGORIES.payroll] as const;

export const EXPENSE_STATUSES = ['active', 'voided'] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Una fecha que existe en el calendario (no '2026-02-30'). */
const isRealDay = (value: string) => {
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
};
const day = (message: string) => z.string().regex(DAY_RE, message).refine(isRealDay, 'date_invalid');
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'not_found');

/**
 * Monto de un gasto: pesos ENTEROS (todo el sistema maneja montos enteros: precios, ventas, caja, reportes), de 1 a
 * 1.000.000.000. El mismo límite está en la base (restricción `expenses_amount_ck`) y el formulario lo valida antes de
 * enviar con `expenseAmountIssue`. Decisión del producto (2026-10-13): sin centavos y con este máximo.
 */
export const EXPENSE_AMOUNT_MIN = 1;
export const EXPENSE_AMOUNT_MAX = 1_000_000_000;
const expenseAmount = z
  .number({ error: 'expense_amount_required' })
  .int('expense_amount_integer')
  .min(EXPENSE_AMOUNT_MIN, 'expense_amount_min')
  .max(EXPENSE_AMOUNT_MAX, 'expense_amount_max');

/**
 * Validación del monto en el formulario (lo que escribió la persona, sin formato): la misma regla que la API, con la clave
 * del mensaje. null = válido.
 */
export function expenseAmountIssue(raw: string): 'expense_amount_required' | 'expense_amount_integer' | 'expense_amount_min' | 'expense_amount_max' | null {
  const text = raw.trim();
  if (!text) return 'expense_amount_required';
  if (!/^\d+$/.test(text)) return /^\d+[.,]\d+$/.test(text) ? 'expense_amount_integer' : 'expense_amount_required';
  const value = Number(text);
  if (value < EXPENSE_AMOUNT_MIN) return 'expense_amount_min';
  if (value > EXPENSE_AMOUNT_MAX) return 'expense_amount_max';
  return null;
}

/** Campos de un gasto (alta y edición). Lo nuevo es opcional: el formato anterior sigue siendo válido tal cual. */
const expenseFields = z.object({
  amount: expenseAmount,
  /** Concepto (lo que se ve en la lista y en el cierre de caja). */
  description: z.string().trim().min(1, 'required').max(200),
  method: z.enum(SALE_PAYMENT_METHODS).default('cash'),
  type: z.enum(EXPENSE_TYPES).default('operating'),
  category: z.enum(ALL_EXPENSE_CATEGORIES).default('other'),
  /** Fecha del gasto (día local del negocio). Sin ella: hoy. */
  expenseDate: day('date_invalid').optional(),
  /** Empleado que recibe el pago: obligatorio en nómina (y debe ser de este negocio; lo valida el servidor). */
  employeeId: uuid.nullable().default(null),
  notes: z.string().trim().max(500).default(''),
  /** ¿Salió de la caja del día? Sin indicarlo: sí cuando es en efectivo (como siempre funcionó). */
  paidFromCash: z.boolean().optional(),
});

const refineExpense = <T extends z.infer<typeof expenseFields>>(data: T, ctx: z.RefinementCtx) => {
  if (!(EXPENSE_CATEGORIES[data.type] as readonly string[]).includes(data.category)) ctx.addIssue({ code: 'custom', message: 'expense_category_type', path: ['category'] });
  if (data.type === 'payroll' && !data.employeeId) ctx.addIssue({ code: 'custom', message: 'expense_employee_required', path: ['employeeId'] });
  if (data.paidFromCash && data.method !== 'cash') ctx.addIssue({ code: 'custom', message: 'expense_cash_method', path: ['paidFromCash'] });
};

export const expenseInputSchema = expenseFields.superRefine(refineExpense);
export type ExpenseInput = z.input<typeof expenseInputSchema>;

/**
 * Ajuste explícito: corregir o anular un gasto que salió de una caja YA CERRADA exige decir por qué. Queda registrado (antes,
 * después, quién y cuándo) y el cierre firmado no cambia. Sin la caja cerrada no hace falta (y se ignora).
 */
const adjustmentReason = z.string().trim().min(3, 'adjustment_reason_required').max(200).optional();

/** Edición: los mismos campos del alta y, si la caja de ese día ya se cerró, el motivo del ajuste. */
export const expenseUpdateSchema = expenseFields.extend({ adjustmentReason }).superRefine(refineExpense);
export type ExpenseUpdateInput = z.input<typeof expenseUpdateSchema>;

export const expenseVoidSchema = z.object({ reason: z.string().trim().min(3, 'required').max(200), adjustmentReason });
export type ExpenseVoidInput = z.input<typeof expenseVoidSchema>;

const expensesQueryBase = z.object({
    /** Rango de fechas del gasto (días locales, ambos incluidos). */
    from: day('required'),
    to: day('required'),
    type: z.enum(EXPENSE_TYPES).optional(),
    category: z.enum(ALL_EXPENSE_CATEGORIES).optional(),
    employeeId: uuid.optional(),
    /** Por defecto solo los vigentes; 'all' incluye los anulados. */
    status: z.enum(['active', 'voided', 'all']).default('active'),
});
export const expensesQuerySchema = expensesQueryBase.refine((q) => q.from <= q.to, { message: 'range_invalid', path: ['to'] });
export type ExpensesQuery = z.input<typeof expensesQuerySchema>;

/** Descarga de la lista de gastos en Excel: los mismos filtros, el idioma del archivo y como máximo 12 meses. */
export const expensesExportQuerySchema = expensesQueryBase
  .extend({ lang: z.enum(['es', 'en']).default('es') })
  .refine((q) => q.from <= q.to, { message: 'range_invalid', path: ['to'] })
  .refine((q) => withinExportLimit(q.from, q.to), { message: 'export_range_too_long', path: ['from'] });
export type ExpensesExportQuery = z.input<typeof expensesExportQuerySchema>;

/**
 * Tope de filas de una descarga en Excel (gastos y movimientos del balance). Por debajo, el archivo trae TODAS las filas
 * del rango; por encima, la API responde 400 `export_too_many_rows` (nunca un archivo cortado en silencio).
 */
export const EXPORT_MAX_ROWS = 50_000;

/**
 * Listado paginado de Gastos (`GET /expenses/page`): los mismos filtros que `GET /expenses` más `cursor`/`limit`. Orden
 * estable (fecha del gasto, alta, id; lo más reciente primero): sin filas repetidas ni saltadas aunque se registren gastos
 * mientras se navega. `GET /expenses` (hasta 1.000 filas, sin paginar) se conserva tal cual para versiones anteriores.
 */
export const expensesPageQuerySchema = expensesQueryBase
  .extend(pageQuerySchema.shape)
  .refine((q) => q.from <= q.to, { message: 'range_invalid', path: ['to'] });
export type ExpensesPageQuery = z.input<typeof expensesPageQuerySchema>;

/** Totales del rango y filtros COMPLETOS (no solo de lo cargado): la pantalla los muestra tal cual. */
export interface ExpensesSummary {
  /** Filas que cumplen los filtros (incluye anuladas si se pidieron). */
  count: number;
  activeCount: number;
  /** Suma de los vigentes. */
  activeTotal: number;
}

export interface ExpensesPage extends Page<ExpenseDto> {
  /** Solo en la primera página (sin `cursor`): no cambia al pasar de página. */
  summary: ExpensesSummary | null;
}

export interface ExpenseDto {
  id: string;
  amount: number;
  description: string;
  method: SalePaymentMethod;
  createdByName: string;
  createdAt: string;
  type: ExpenseType;
  category: ExpenseCategory;
  expenseDate: string;
  employeeId: string | null;
  employeeName: string | null;
  notes: string;
  paidFromCash: boolean;
  status: ExpenseStatus;
  voidReason: string;
  voidedByName: string | null;
  voidedAt: string | null;
  updatedAt: string;
  /** La caja del día de este gasto ya está cerrada (si salió de ella, cambiarlo exige un ajuste explícito). */
  cashDayClosed: boolean;
  /** Ajustes registrados después del cierre (solo en el detalle de un gasto). */
  adjustments?: ExpenseAdjustmentDto[];
}

/** Persona del negocio a la que se le puede pagar nómina (solo lo necesario para elegirla). */
export interface ExpensePayeeDto {
  id: string;
  name: string;
  role: 'owner' | 'employee';
  active: boolean;
}

export interface ExpenseAdjustmentDto {
  id: string;
  expenseId: string;
  /** Día de caja (cerrada) afectado. */
  cashDay: string;
  kind: 'edit' | 'void';
  reason: string;
  /** Lo que salía de la caja antes y después (la diferencia es lo que el arqueo cambia respecto del cierre firmado). */
  amountBefore: number;
  amountAfter: number;
  createdByName: string;
  createdAt: string;
}
