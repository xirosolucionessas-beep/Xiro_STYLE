import { birthdayTargetIds, markBirthdayRewardUsed, releaseBirthdayReward, reserveBirthdayReward, type ReservedReward } from '../birthday';
import { canTransitionProductOrder, OPEN_PRODUCT_ORDER_STATUSES, type ProductOrderDto, type ProductOrderItemDto, type ProductOrderStatus, type PublicProductOrderDto } from '@xiro/shared';
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { isUniqueViolation } from '../db/errors';
import { clients, items, productOrderItems, productOrders } from '../db/schema';
import { AppError, notFound } from '../errors';
import type { BusinessRow } from '../serializers';
import { findOrCreateClient, idempotencyHash, type PublicProfileRow } from './appointments';
import type { BookingContext } from './availability';
import type { Tx } from './scope';
import { discountCodesById, discountOf, redeemDiscount } from './discounts';
import { allSections } from './view';

export type ProductOrderRow = typeof productOrders.$inferSelect;
type OrderItemRow = typeof productOrderItems.$inferSelect;

/* ---------- Crear (página pública) ---------- */

export interface CreateProductOrderInput {
  now: Date;
  lines: Array<{ itemId: string; quantity: number }>;
  customer: { name: string; phone: string; email?: string | undefined; notes: string };
  /** Cuenta de cliente de la página pública, si inició sesión: el pedido queda en SU ficha (no en la del teléfono escrito). */
  account: { id: string; clientId: string } | null;
  termsIp: string | null;
  idempotencyKey?: string | undefined;
  /** Código de descuento (Fase 4); se valida y se cuenta aquí, en la transacción del pedido. */
  discountCode?: string | undefined;
  /** Usar la recompensa de cumpleaños de la cuenta con sesión (solo con cuenta: la recompensa es de esa persona). */
  useBirthdayReward?: boolean | undefined;
}

export interface CreatedProductOrder {
  row: ProductOrderRow;
  /** true si esta petición repetía una ya atendida: no se creó nada y no se avisa otra vez. */
  replayed: boolean;
}

/**
 * Crea un pedido de solo productos. Todo lo que vale dinero lo decide el servidor: qué productos se pueden pedir (del negocio,
 * de tipo producto, publicados y reservables), su precio y el total. El inventario se COMPRUEBA (hay existencias para lo
 * pedido) pero no se descuenta: eso ocurre al entregarlo como venta. Idempotente con `idempotencyKey`.
 */
export async function createProductOrder(tx: Tx, businessId: string, ctx: BookingContext, input: CreateProductOrderInput): Promise<CreatedProductOrder> {
  const idem = input.idempotencyKey ? idempotencyHash(businessId, `order:${input.idempotencyKey}`) : null;
  if (idem) {
    const prior = await findOrderByIdempotency(tx, businessId, idem);
    if (prior) return { row: prior, replayed: true };
  }

  const ids = input.lines.map((line) => line.itemId.toLowerCase());
  const rows = await tx
    .select()
    .from(items)
    .where(and(eq(items.businessId, businessId), inArray(items.id, ids), eq(items.kind, 'product'), eq(items.bookable, true), eq(items.published, true)));
  const byId = new Map(rows.map((row) => [row.id, row]));
  const missing = ids.filter((id) => !byId.has(id));
  // Un producto que no es de este negocio, ya no se ofrece o se borró responde igual que uno inexistente.
  if (missing.length > 0) throw new AppError(409, 'product_unavailable', undefined, undefined, { itemIds: missing });
  // Solo QUÉ productos no alcanzan, nunca cuántas unidades quedan (la página pública no expone existencias exactas).
  const short = input.lines.filter((line) => byId.get(line.itemId.toLowerCase())!.stock < line.quantity).map((line) => line.itemId.toLowerCase());
  if (short.length > 0) throw new AppError(409, 'out_of_stock', undefined, undefined, { itemIds: short });

  const clientId = input.account?.clientId ?? (await findOrCreateClient(tx, businessId, { name: input.customer.name, phone: input.customer.phone, email: input.customer.email }));

  // Mismo freno que las citas: pocos pedidos abiertos por cliente (un bot no llena el panel del negocio con pedidos falsos).
  const [open] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(productOrders)
    .where(and(eq(productOrders.businessId, businessId), eq(productOrders.clientId, clientId), inArray(productOrders.status, [...OPEN_PRODUCT_ORDER_STATUSES])));
  if ((open?.n ?? 0) >= ctx.settings.maxPendingPerPhone) throw new AppError(429, 'too_many_pending');

  const lines = input.lines.map((line) => {
    const item = byId.get(line.itemId.toLowerCase())!;
    return { itemId: item.id, name: item.name, unitPrice: item.price, quantity: line.quantity };
  });
  const total = lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  let discount: { id: string; amount: number } | null = null;
  if (input.discountCode) {
    if (!ctx.settings.discountCodesEnabled) throw new AppError(409, 'discount_invalid');
    discount = await redeemDiscount(tx, businessId, input.discountCode, { subtotal: total, clientId, now: input.now });
  }
  // Recompensa de cumpleaños: solo con la cuenta de la persona (nunca por teléfono escrito en un formulario de invitado).
  let birthday: ReservedReward | null = null;
  if (input.useBirthdayReward) {
    if (!input.account) throw new AppError(401, 'unauthorized');
    birthday = await reserveBirthdayReward(tx, { businessId, clientId, lines: lines.map((line) => ({ kind: 'product' as const, total: line.unitPrice * line.quantity })), otherDiscount: discount?.amount ?? 0, now: input.now });
  }

  try {
    // Punto de guardado: si otro envío con la misma clave ganó la carrera, la transacción de la petición sigue viva.
    const row = await tx.transaction(async (sp) => {
      const [created] = await sp
        .insert(productOrders)
        .values({
          businessId,
          clientId,
          clientAccountId: input.account?.id ?? null,
          customerName: input.customer.name,
          customerPhone: input.customer.phone,
          customerEmail: input.customer.email ?? null,
          customerNotes: input.customer.notes,
          totalPrice: total,
          discountCodeId: discount?.id ?? null,
          discountAmount: (discount?.amount ?? 0) + (birthday?.amount ?? 0),
          idempotencyHash: idem,
          termsAcceptedAt: input.now,
          termsAcceptedIp: input.termsIp,
        })
        .returning();
      await sp.insert(productOrderItems).values(lines.map((line) => ({ businessId, orderId: created!.id, ...line })));
      return created!;
    });
    if (birthday) await markBirthdayRewardUsed(tx, businessId, birthday, { productOrderId: row.id }, input.now);
    return { row, replayed: false };
  } catch (error) {
    if (idem && isUniqueViolation(error, 'product_orders_idem_uq')) {
      const prior = await findOrderByIdempotency(tx, businessId, idem);
      if (prior) return { row: prior, replayed: true };
    }
    throw error;
  }
}

async function findOrderByIdempotency(tx: Tx, businessId: string, hash: string): Promise<ProductOrderRow | null> {
  const [row] = await tx.select().from(productOrders).where(and(eq(productOrders.businessId, businessId), eq(productOrders.idempotencyHash, hash))).limit(1);
  return row ?? null;
}

/* ---------- Leer ---------- */

const toItemDto = (row: OrderItemRow): ProductOrderItemDto => ({ id: row.id, itemId: row.itemId, name: row.name, unitPrice: row.unitPrice, quantity: row.quantity });

async function itemsOf(tx: Tx, businessId: string, orderIds: string[]): Promise<Map<string, ProductOrderItemDto[]>> {
  const out = new Map<string, ProductOrderItemDto[]>();
  if (orderIds.length === 0) return out;
  const rows = await tx.select().from(productOrderItems).where(and(eq(productOrderItems.businessId, businessId), inArray(productOrderItems.orderId, orderIds))).orderBy(productOrderItems.name);
  for (const row of rows) out.set(row.orderId, [...(out.get(row.orderId) ?? []), toItemDto(row)]);
  return out;
}

/** Pedidos con sus líneas y el nombre ACTUAL del cliente (vista del negocio). */
export async function loadProductOrderDtos(tx: Tx, businessId: string, rows: ProductOrderRow[]): Promise<ProductOrderDto[]> {
  if (rows.length === 0) return [];
  const [lines, names] = await Promise.all([
    itemsOf(tx, businessId, rows.map((r) => r.id)),
    tx.select({ id: clients.id, name: clients.name }).from(clients).where(and(eq(clients.businessId, businessId), inArray(clients.id, [...new Set(rows.map((r) => r.clientId))]))),
  ]);
  const nameOf = new Map(names.map((n) => [n.id, n.name]));
  const codes = await discountCodesById(tx, businessId, rows.map((r) => r.discountCodeId));
  const birthdayIds = await birthdayTargetIds(tx, businessId, 'order', rows.map((r) => r.id));
  return rows.map((row) => ({
    id: row.id,
    status: row.status as ProductOrderStatus,
    clientId: row.clientId,
    clientName: nameOf.get(row.clientId) ?? row.customerName,
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    customerEmail: row.customerEmail,
    customerNotes: row.customerNotes,
    items: lines.get(row.id) ?? [],
    totalPrice: row.totalPrice,
    discount: discountOf(row, codes, birthdayIds),
    saleId: row.saleId,
    cancelReason: row.cancelReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

/** Lo que ve quien pidió: sus productos, total y cómo contactar o llegar al negocio. Sin datos internos. */
export async function toPublicProductOrder(tx: Tx, business: BusinessRow, row: ProductOrderRow, profile: PublicProfileRow | null): Promise<PublicProductOrderDto> {
  const lines = await itemsOf(tx, business.id, [row.id]);
  const hasPin = allSections(profile?.sections).map && profile?.latitude != null && profile.longitude != null;
  return {
    id: row.id,
    status: row.status as ProductOrderStatus,
    items: lines.get(row.id) ?? [],
    totalPrice: row.totalPrice,
    discount: discountOf(row, await discountCodesById(tx, business.id, [row.discountCodeId]), await birthdayTargetIds(tx, business.id, 'order', [row.id])),
    createdAt: row.createdAt.toISOString(),
    business: {
      name: profile?.displayName || business.name,
      slug: business.slug,
      currency: business.currency,
      whatsapp: business.whatsapp,
      address: business.address,
      city: business.city,
      location: hasPin ? { latitude: profile!.latitude!, longitude: profile!.longitude!, placeId: profile!.placeId ?? null, address: profile!.mapAddress ?? '' } : null,
    },
  };
}

/* ---------- Cambiar de estado (panel del negocio) ---------- */

/** Bloquea el pedido para cambiarlo (dos personas del equipo tocando el mismo pedido a la vez: gana una, la otra ve el estado nuevo). */
export async function lockProductOrder(tx: Tx, businessId: string, id: string): Promise<ProductOrderRow> {
  const [row] = await tx.select().from(productOrders).where(and(eq(productOrders.id, id), eq(productOrders.businessId, businessId))).limit(1).for('update');
  if (!row) throw notFound();
  return row;
}

export async function transitionProductOrder(tx: Tx, businessId: string, id: string, to: 'ready' | 'cancelled', reason = ''): Promise<ProductOrderRow> {
  const row = await lockProductOrder(tx, businessId, id);
  if (!canTransitionProductOrder(row.status as ProductOrderStatus, to)) throw new AppError(409, 'invalid_transition');
  const [updated] = await tx
    .update(productOrders)
    .set({ status: to, updatedAt: new Date(), ...(to === 'cancelled' ? { cancelReason: reason } : {}) })
    .where(and(eq(productOrders.id, id), eq(productOrders.businessId, businessId)))
    .returning();
  if (to === 'cancelled') await releaseBirthdayReward(tx, businessId, { productOrderId: id });
  return updated!;
}

/**
 * Entrega con venta: dentro de la MISMA transacción que registra la venta (que es la que descuenta el inventario). Si el pedido
 * ya se entregó o se canceló, la venta entera se revierte: nunca dos ventas por un mismo pedido.
 */
export async function deliverProductOrder(tx: Tx, businessId: string, id: string, saleId: string): Promise<void> {
  const row = await lockProductOrder(tx, businessId, id);
  if (!canTransitionProductOrder(row.status as ProductOrderStatus, 'delivered')) throw new AppError(409, 'invalid_transition');
  await tx.update(productOrders).set({ status: 'delivered', saleId, updatedAt: new Date() }).where(and(eq(productOrders.id, id), eq(productOrders.businessId, businessId)));
}

export const orderStatusFilter = (status: ProductOrderStatus | 'open' | undefined): SQL | undefined =>
  status === 'open' ? inArray(productOrders.status, [...OPEN_PRODUCT_ORDER_STATUSES]) : status ? eq(productOrders.status, status) : undefined;
