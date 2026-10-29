import type { ExpenseAdjustmentDto, ExpenseCategory, ExpenseDto, ExpenseStatus, ExpenseType, SalePaymentMethod } from '@xiro/shared';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { cashClosings, cashOpenings, expenseAdjustments, expenses, users } from '../db/schema';
import { AppError } from '../errors';
import type { Tx } from './scope';

export type ExpenseRow = typeof expenses.$inferSelect;

/** Nombres de personas del negocio (creador, beneficiario, quien anuló), en una sola consulta. */
export async function userNames(tx: Tx, businessId: string, ids: ReadonlyArray<string | null>): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();
  const rows = await tx.select({ id: users.id, name: users.name }).from(users).where(and(eq(users.businessId, businessId), inArray(users.id, unique)));
  return new Map(rows.map((r) => [r.id, r.name]));
}

export type AdjustmentRow = typeof expenseAdjustments.$inferSelect;

export function toExpenseDto(row: ExpenseRow, names: Map<string, string>, closedDays: ReadonlySet<string> = new Set()): ExpenseDto {
  return {
    id: row.id,
    amount: row.amount,
    description: row.description,
    method: row.method as SalePaymentMethod,
    createdByName: names.get(row.createdBy) ?? '',
    createdAt: row.createdAt.toISOString(),
    type: row.type as ExpenseType,
    category: row.category as ExpenseCategory,
    expenseDate: row.expenseDate,
    employeeId: row.employeeId,
    employeeName: row.employeeId ? (names.get(row.employeeId) ?? '') : null,
    notes: row.notes,
    paidFromCash: row.paidFromCash,
    status: row.status as ExpenseStatus,
    voidReason: row.voidReason,
    voidedByName: row.voidedBy ? (names.get(row.voidedBy) ?? '') : null,
    voidedAt: row.voidedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
    cashDayClosed: closedDays.has(row.expenseDate),
  };
}

/** Días (de la lista) cuya caja tiene un cierre vigente: una sola consulta para toda la lista. */
export async function closedCashDays(tx: Tx, businessId: string, days: readonly string[]): Promise<Set<string>> {
  const unique = [...new Set(days)];
  if (unique.length === 0) return new Set();
  const rows = await tx
    .select({ day: cashClosings.day })
    .from(cashClosings)
    .where(and(eq(cashClosings.businessId, businessId), inArray(cashClosings.day, unique), eq(cashClosings.status, 'completed')));
  return new Set(rows.map((r) => r.day));
}

export async function loadExpenseDtos(tx: Tx, businessId: string, rows: ExpenseRow[]): Promise<ExpenseDto[]> {
  const [names, closed] = await Promise.all([userNames(tx, businessId, rows.flatMap((r) => [r.createdBy, r.employeeId, r.voidedBy])), closedCashDays(tx, businessId, rows.map((r) => r.expenseDate))]);
  return rows.map((row) => toExpenseDto(row, names, closed));
}

export function toAdjustmentDto(row: AdjustmentRow, names: Map<string, string>): ExpenseAdjustmentDto {
  return {
    id: row.id,
    expenseId: row.expenseId,
    cashDay: row.cashDay,
    kind: row.kind as ExpenseAdjustmentDto['kind'],
    reason: row.reason,
    amountBefore: row.amountBefore,
    amountAfter: row.amountAfter,
    createdByName: names.get(row.createdBy) ?? '',
    createdAt: row.createdAt.toISOString(),
  };
}

/** Ajustes de un gasto o de un día de caja, del más viejo al más nuevo. */
export async function loadAdjustments(tx: Tx, businessId: string, filter: { expenseId: string } | { cashDay: string }): Promise<ExpenseAdjustmentDto[]> {
  const rows = await tx
    .select()
    .from(expenseAdjustments)
    .where(and(eq(expenseAdjustments.businessId, businessId), 'expenseId' in filter ? eq(expenseAdjustments.expenseId, filter.expenseId) : eq(expenseAdjustments.cashDay, filter.cashDay)))
    .orderBy(asc(expenseAdjustments.createdAt));
  const names = await userNames(tx, businessId, rows.map((r) => r.createdBy));
  return rows.map((row) => toAdjustmentDto(row, names));
}

/** Copia legible de un gasto para el historial del ajuste (antes / después). */
export const expenseSnapshot = (row: Pick<ExpenseRow, 'amount' | 'description' | 'method' | 'type' | 'category' | 'expenseDate' | 'employeeId' | 'notes' | 'paidFromCash' | 'status'>): Record<string, unknown> => ({
  amount: row.amount,
  description: row.description,
  method: row.method,
  type: row.type,
  category: row.category,
  expenseDate: row.expenseDate,
  employeeId: row.employeeId,
  notes: row.notes,
  paidFromCash: row.paidFromCash,
  status: row.status,
});

export async function recordAdjustment(
  tx: Tx,
  values: { businessId: string; expenseId: string; cashDay: string; kind: 'edit' | 'void'; reason: string; amountBefore: number; amountAfter: number; before: Record<string, unknown>; after: Record<string, unknown>; createdBy: string },
): Promise<void> {
  await tx.insert(expenseAdjustments).values(values);
}

/** El beneficiario de nómina debe ser una persona de ESTE negocio (si no, 400: nunca se revela si existe en otro). */
export async function assertEmployeeOfBusiness(tx: Tx, businessId: string, employeeId: string | null): Promise<void> {
  if (!employeeId) return;
  const [row] = await tx.select({ id: users.id }).from(users).where(and(eq(users.id, employeeId), eq(users.businessId, businessId))).limit(1);
  if (!row) throw new AppError(400, 'expense_employee_invalid');
}

/** ¿La caja de ese día ya está cerrada (cierre vigente)? Entonces un gasto que salió de ella no se puede tocar. */
export async function isCashDayClosed(tx: Tx, businessId: string, day: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: cashClosings.id })
    .from(cashClosings)
    .where(and(eq(cashClosings.businessId, businessId), eq(cashClosings.day, day), eq(cashClosings.status, 'completed')))
    .limit(1);
  return Boolean(row);
}

/** Apertura de caja de ese día (si la hubo): el gasto pagado desde caja queda enlazado a ella. */
export async function cashOpeningOf(tx: Tx, businessId: string, day: string): Promise<string | null> {
  const [row] = await tx.select({ id: cashOpenings.id }).from(cashOpenings).where(and(eq(cashOpenings.businessId, businessId), eq(cashOpenings.day, day))).limit(1);
  return row?.id ?? null;
}
