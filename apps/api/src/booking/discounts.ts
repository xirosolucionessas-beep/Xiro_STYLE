import { computeDiscount, type AppliedDiscountDto, type DiscountCodeDto, type DiscountKind, type PublicDiscountDto } from '@xiro/shared';
import { and, eq, gt, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { appointments, discountCodes, productOrders } from '../db/schema';
import { AppError } from '../errors';
import type { Tx } from './scope';

export type DiscountCodeRow = typeof discountCodes.$inferSelect;

/** Mismo error para "no existe", "vencido", "agotado" o "de otro negocio": quien prueba códigos no aprende nada. */
const invalid = () => new AppError(409, 'discount_invalid');

/** Condición de "vigente ahora": activo, dentro de sus fechas y con usos disponibles. */
const usable = (now: Date) =>
  and(
    eq(discountCodes.active, true),
    or(isNull(discountCodes.startsAt), lt(discountCodes.startsAt, now)),
    or(isNull(discountCodes.endsAt), gt(discountCodes.endsAt, now)),
    or(isNull(discountCodes.maxUses), lt(discountCodes.uses, discountCodes.maxUses)),
  );

export const toPublicDiscount = (row: DiscountCodeRow): PublicDiscountDto => ({ code: row.code, description: row.description, kind: row.kind as DiscountKind, value: row.value, minTotal: row.minTotal });

export const toDiscountDto = (row: DiscountCodeRow): DiscountCodeDto => ({
  id: row.id,
  code: row.code,
  description: row.description,
  kind: row.kind as DiscountKind,
  value: row.value,
  minTotal: row.minTotal,
  maxUses: row.maxUses,
  uses: row.uses,
  oncePerClient: row.oncePerClient,
  startsAt: row.startsAt?.toISOString() ?? null,
  endsAt: row.endsAt?.toISOString() ?? null,
  active: row.active,
  createdAt: row.createdAt.toISOString(),
});

/** Para la vista previa de la página pública: el código vigente de ESTE negocio, o el error genérico. */
export async function findUsableDiscount(tx: Tx, businessId: string, code: string, now: Date): Promise<DiscountCodeRow> {
  const [row] = await tx.select().from(discountCodes).where(and(eq(discountCodes.businessId, businessId), eq(discountCodes.code, code), usable(now))).limit(1);
  if (!row) throw invalid();
  return row;
}

/**
 * Canjea un código al confirmar una cita o un pedido (DENTRO de su transacción: si algo falla, no queda ni la reserva ni el uso).
 * El subtotal es el del servidor. El uso se cuenta con un UPDATE condicional: dos reservas simultáneas con el último uso
 * disponible → solo una lo obtiene; la otra recibe `discount_invalid` y su reserva se revierte (puede reintentar sin código).
 */
export async function redeemDiscount(tx: Tx, businessId: string, code: string, options: { subtotal: number; clientId: string; now: Date }): Promise<{ id: string; code: string; amount: number }> {
  const row = await findUsableDiscount(tx, businessId, code, options.now);
  const amount = computeDiscount(options.subtotal, toPublicDiscount(row));
  if (amount === 0) throw new AppError(409, 'discount_min_total', undefined, undefined, { minTotal: row.minTotal });
  if (row.oncePerClient) {
    const [used] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(appointments)
      .where(and(eq(appointments.businessId, businessId), eq(appointments.discountCodeId, row.id), eq(appointments.clientId, options.clientId), ne(appointments.status, 'cancelled')));
    const [usedInOrders] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(productOrders)
      .where(and(eq(productOrders.businessId, businessId), eq(productOrders.discountCodeId, row.id), eq(productOrders.clientId, options.clientId), ne(productOrders.status, 'cancelled')));
    if ((used?.n ?? 0) + (usedInOrders?.n ?? 0) > 0) throw new AppError(409, 'discount_already_used');
  }
  const [counted] = await tx
    .update(discountCodes)
    .set({ uses: sql`${discountCodes.uses} + 1`, updatedAt: options.now })
    .where(and(eq(discountCodes.id, row.id), eq(discountCodes.businessId, businessId), usable(options.now)))
    .returning({ id: discountCodes.id });
  if (!counted) throw invalid();
  return { id: row.id, code: row.code, amount };
}

/** Códigos (texto) de varios ids, para las listas de citas y pedidos. */
export async function discountCodesById(tx: Tx, businessId: string, ids: Array<string | null>): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (wanted.length === 0) return new Map();
  const rows = await tx.select({ id: discountCodes.id, code: discountCodes.code }).from(discountCodes).where(and(eq(discountCodes.businessId, businessId), inArray(discountCodes.id, wanted)));
  return new Map(rows.map((r) => [r.id, r.code]));
}

/** El descuento de una cita o pedido tal como lo ven el negocio y el cliente. */
/** Descuento aplicado. `birthdayIds`: citas/pedidos cuyo descuento incluye la recompensa de cumpleaños (ver birthday.ts). */
export const discountOf = (row: { id: string; discountCodeId: string | null; discountAmount: number }, codes: Map<string, string>, birthdayIds: Set<string> = new Set()): AppliedDiscountDto | null => {
  if (row.discountAmount <= 0) return null;
  const birthday = birthdayIds.has(row.id);
  const code = row.discountCodeId ? codes.get(row.discountCodeId) || '—' : birthday ? '' : '—';
  return birthday ? { code, amount: row.discountAmount, birthday: true } : { code, amount: row.discountAmount };
};
