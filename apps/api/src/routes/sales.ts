import { formatMoney, REORDER_THRESHOLD, can, saleInputSchema, salesQuerySchema, voidSaleInputSchema, type Currency, type SaleDto, type SaleItemDto, type SalePaymentDto } from '@xiro/shared';
import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { lockCashDayAt } from '../booking/cashLock';
import { withBusinessTrusted, type Tx } from '../booking/scope';
import type { Ctx } from '../context';
import { businesses, categories, clients, items, saleItems, salePayments, sales, serviceRecords, users } from '../db/schema';
import { AppError, notFound, parse, uuid } from '../errors';
import { deliverProductOrder } from '../booking/orders';
import { notifyBusiness, notifyLowStockIfNeeded } from '../push';
import { recordService } from '../serviceRecording';

type SaleRow = typeof sales.$inferSelect;
type SaleItemRow = typeof saleItems.$inferSelect;
type SalePaymentRow = typeof salePayments.$inferSelect;

/**
 * Cliente compartido "de mostrador" del negocio (una fila, creada la primera vez que hace falta): representa las ventas
 * sin ficha de cliente. Nunca aparece en el directorio (`GET /clients` lo excluye) ni cuenta como cliente nuevo.
 */
async function findOrCreateOccasionalClient(tx: Tx, businessId: string): Promise<string> {
  const [existing] = await tx.select({ id: clients.id }).from(clients).where(and(eq(clients.businessId, businessId), eq(clients.isOccasional, true))).limit(1);
  if (existing) return existing.id;
  const [created] = await tx.insert(clients).values({ businessId, name: 'Cliente ocasional', isOccasional: true }).returning({ id: clients.id });
  return created!.id;
}

/**
 * Descuenta existencias de forma atómica (`stock = stock + delta` evaluado en la base de datos): dos ventas simultáneas
 * del mismo producto nunca se pisan ni dejan el stock en negativo. Mismo patrón que `POST /items/:id/stock-adjustments`.
 * Devuelve el estado resultante para que, YA FUERA de la transacción, se avise si quedó bajo o agotado.
 */
async function adjustStock(tx: Tx, businessId: string, itemId: string, delta: number): Promise<{ id: string; name: string; stockStatus: string }> {
  const next = sql`${items.stock} + ${delta}`;
  const [updated] = await tx
    .update(items)
    .set({ stock: next, stockStatus: sql`case when ${next} <= 0 then 'out_of_stock' when ${next} <= ${REORDER_THRESHOLD} then 'reorder' else 'available' end`, updatedAt: new Date() })
    .where(and(eq(items.id, itemId), eq(items.businessId, businessId), sql`${items.stock} + ${delta} >= 0`, sql`${items.stock} + ${delta} <= 1000000`))
    .returning({ id: items.id, name: items.name, stockStatus: items.stockStatus });
  if (!updated) throw new AppError(409, 'insufficient_stock', undefined, undefined, { itemId });
  return updated;
}

export async function loadSaleDtos(db: Ctx['db'], businessId: string, saleRows: SaleRow[]): Promise<SaleDto[]> {
  if (saleRows.length === 0) return [];
  const saleIds = saleRows.map((s) => s.id);

  const [itemRows, paymentRows] = await Promise.all([
    db.select().from(saleItems).where(and(eq(saleItems.businessId, businessId), inArray(saleItems.saleId, saleIds))).orderBy(asc(saleItems.createdAt)),
    db.select().from(salePayments).where(and(eq(salePayments.businessId, businessId), inArray(salePayments.saleId, saleIds))).orderBy(asc(salePayments.createdAt)),
  ]);

  const userIds = new Set<string>();
  const clientIds = new Set<string>();
  for (const sale of saleRows) {
    userIds.add(sale.createdBy);
    if (sale.voidedBy) userIds.add(sale.voidedBy);
    if (sale.clientId) clientIds.add(sale.clientId);
  }
  for (const item of itemRows) if (item.employeeId) userIds.add(item.employeeId);

  const [userRows, clientRows] = await Promise.all([
    // Filtrados también por negocio (defensa en profundidad: las claves foráneas compuestas ya lo garantizan, y esta conexión
    // no tiene RLS). El resultado es idéntico.
    userIds.size > 0 ? db.select({ id: users.id, name: users.name }).from(users).where(and(eq(users.businessId, businessId), inArray(users.id, [...userIds]))) : Promise.resolve([]),
    clientIds.size > 0 ? db.select({ id: clients.id, name: clients.name }).from(clients).where(and(eq(clients.businessId, businessId), inArray(clients.id, [...clientIds]))) : Promise.resolve([]),
  ]);
  const userName = new Map(userRows.map((u) => [u.id, u.name]));
  const clientName = new Map(clientRows.map((c) => [c.id, c.name]));

  const itemsBySale = new Map<string, SaleItemRow[]>();
  for (const item of itemRows) itemsBySale.set(item.saleId, [...(itemsBySale.get(item.saleId) ?? []), item]);
  const paymentsBySale = new Map<string, SalePaymentRow[]>();
  for (const payment of paymentRows) paymentsBySale.set(payment.saleId, [...(paymentsBySale.get(payment.saleId) ?? []), payment]);

  const toItemDto = (row: SaleItemRow): SaleItemDto => ({
    id: row.id,
    kind: row.kind as SaleItemDto['kind'],
    itemId: row.itemId,
    name: row.name,
    unitPrice: row.unitPrice,
    quantity: row.quantity,
    total: row.total,
    employeeId: row.employeeId,
    employeeName: row.employeeId ? (userName.get(row.employeeId) ?? '') : null,
    loyaltyCounted: row.serviceRecordId !== null,
  });
  const toPaymentDto = (row: SalePaymentRow): SalePaymentDto => ({ id: row.id, method: row.method as SalePaymentDto['method'], amount: row.amount, receivedAmount: row.receivedAmount });

  return saleRows.map((sale): SaleDto => {
    const payments = paymentsBySale.get(sale.id) ?? [];
    const changeGiven = payments.reduce((acc, p) => (p.receivedAmount !== null ? acc + (p.receivedAmount - p.amount) : acc), 0);
    return {
      id: sale.id,
      clientId: sale.clientId,
      clientName: sale.clientId ? (clientName.get(sale.clientId) ?? '') : sale.clientLabel || 'Cliente ocasional',
      items: (itemsBySale.get(sale.id) ?? []).map(toItemDto),
      payments: payments.map(toPaymentDto),
      subtotal: sale.subtotal,
      discount: sale.discount,
      tip: sale.tip,
      total: sale.total,
      changeGiven,
      status: sale.status as SaleDto['status'],
      voidReason: sale.voidReason,
      createdByName: userName.get(sale.createdBy) ?? '',
      createdAt: sale.createdAt.toISOString(),
      rewardJustEarned: false,
    };
  });
}

/**
 * Registrar una venta (Tarea 5): POS con cliente existente/ocasional, líneas de catálogo o a mano (servicio o producto),
 * descuento, propina y uno o varios pagos. Cada línea sigue alimentando `service_records` a través de `recordService`
 * (misma puerta que usa cerrar una cita), así que Inicio, Reportes y Fidelización ven exactamente lo mismo vengan de una
 * cita o de una venta. Los precios y nombres de cada línea quedan CONGELADOS: editar el catálogo después no cambia el
 * historial. No se borra ninguna venta: se anula, con motivo, y las existencias de producto se restituyen.
 */
export function salesRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db } = ctx;
  const businessOf = (request: { user: { bid: string; sub: string } }) => request.user.bid;

  app.get('/sales', async (request) => {
    const { from, to, limit } = parse(salesQuerySchema, request.query);
    const businessId = businessOf(request);
    const rows = await db
      .select()
      .from(sales)
      .where(and(eq(sales.businessId, businessId), gte(sales.createdAt, new Date(from)), lte(sales.createdAt, new Date(to))))
      .orderBy(desc(sales.createdAt))
      .limit(limit);
    return loadSaleDtos(db, businessId, rows);
  });

  app.get('/sales/:id', async (request) => {
    const id = uuid((request.params as { id?: string }).id);
    const businessId = businessOf(request);
    const [row] = await db.select().from(sales).where(and(eq(sales.id, id), eq(sales.businessId, businessId))).limit(1);
    if (!row) throw notFound();
    return (await loadSaleDtos(db, businessId, [row]))[0]!;
  });

  app.post('/sales', async (request, reply) => {
    const input = parse(saleInputSchema, request.body);
    const businessId = businessOf(request);
    const userId = request.user.sub;
    const actor = request.actor;

    const result = await withBusinessTrusted(db, businessId, async (tx) => {
      // Un cierre de caja de hoy en curso termina antes de que esta venta se registre (booking/cashLock.ts): la venta entra
      // completa en el cierre o queda, entera, "después del cierre".
      await lockCashDayAt(tx, businessId);
      // Cliente: el elegido (validado que sea de este negocio y no sea el placeholder ocasional), o el cliente ocasional
      // compartido cuando la venta no tiene ficha.
      let clientId: string;
      if (input.clientId) {
        const [client] = await tx.select({ id: clients.id, isOccasional: clients.isOccasional }).from(clients).where(and(eq(clients.id, input.clientId), eq(clients.businessId, businessId))).limit(1);
        if (!client || client.isOccasional) throw notFound();
        clientId = client.id;
      } else {
        clientId = await findOrCreateOccasionalClient(tx, businessId);
      }

      let subtotal = 0;
      let rewardJustEarned = false;
      const itemsToInsert: Array<typeof saleItems.$inferInsert> = [];
      const stockMoved: Array<{ id: string; name: string; stockStatus: string }> = [];

      for (const line of input.lines) {
        let name: string;
        let unitPrice: number;
        let linkedItemId: string | null = null;
        let trackStock = false;

        if (line.itemId) {
          const [catalogItem] = await tx.select().from(items).where(and(eq(items.id, line.itemId), eq(items.businessId, businessId))).limit(1);
          if (!catalogItem) throw notFound();
          if (catalogItem.kind !== line.kind) throw new AppError(400, 'validation_error', 'Item kind mismatch');
          linkedItemId = catalogItem.id;
          name = catalogItem.name;
          // Ajustar el precio de esta venta puntual (sin tocar el catálogo) exige el mismo permiso que administrar el catálogo.
          if (line.unitPrice !== null && line.unitPrice !== catalogItem.price) {
            if (!can(actor, 'catalog_manage')) throw new AppError(403, 'forbidden');
            unitPrice = line.unitPrice;
          } else {
            unitPrice = catalogItem.price;
          }
          trackStock = line.kind === 'product';
        } else {
          name = line.name.trim();
          unitPrice = line.unitPrice!;
          if (line.saveToCatalog) {
            // Se guarda en una categoría genérica del negocio (creada la primera vez que hace falta); el dueño puede
            // reclasificarla luego desde el catálogo. El stock de un producto nuevo nace en 0: recién se está dando de
            // alta, así que esta venta NO descuenta contra un inventario que todavía no existía.
            const categoryId = await findOrCreateDefaultCategory(tx, businessId);
            const [created] = await tx
              .insert(items)
              .values({
                businessId,
                categoryId,
                name,
                price: unitPrice,
                stock: 0,
                stockStatus: 'out_of_stock',
                kind: line.kind,
                kindConfirmed: true,
                bookable: line.kind === 'service',
              })
              .returning({ id: items.id });
            linkedItemId = created!.id;
          }
        }

        if (trackStock && linkedItemId) stockMoved.push(await adjustStock(tx, businessId, linkedItemId, -line.quantity));

        const total = unitPrice * line.quantity;
        const recorded = await recordService(tx, {
          businessId,
          clientId,
          itemId: linkedItemId,
          label: line.quantity > 1 ? `${name} ×${line.quantity}` : name,
          amount: total,
          kind: line.kind,
          note: '',
          createdBy: userId,
        });
        rewardJustEarned ||= recorded.rewardJustEarned;
        subtotal += total;

        itemsToInsert.push({
          businessId,
          saleId: '', // se completa abajo, tras crear la venta
          kind: line.kind,
          itemId: linkedItemId,
          name,
          unitPrice,
          quantity: line.quantity,
          total,
          employeeId: line.employeeId,
          serviceRecordId: recorded.record.id,
        });
      }

      if (input.discount > subtotal) throw new AppError(400, 'validation_error', 'Discount exceeds subtotal');
      const total = subtotal - input.discount + input.tip;
      const paid = input.payments.reduce((acc, p) => acc + p.amount, 0);
      if (paid !== total) throw new AppError(400, 'validation_error', 'Payments do not add up to the total');

      const [sale] = await tx
        .insert(sales)
        .values({ businessId, clientId: input.clientId ? clientId : null, clientLabel: input.clientId ? '' : input.clientLabel, subtotal, discount: input.discount, tip: input.tip, total, createdBy: userId })
        .returning();

      if (itemsToInsert.length > 0) await tx.insert(saleItems).values(itemsToInsert.map((row) => ({ ...row, saleId: sale!.id })));
      if (input.payments.length > 0) await tx.insert(salePayments).values(input.payments.map((p) => ({ businessId, saleId: sale!.id, method: p.method, amount: p.amount, receivedAmount: p.receivedAmount })));
      // Entrega de un pedido de la página pública: en ESTA transacción (bloqueado). Si ya se entregó o se canceló, toda la
      // venta se revierte (inventario incluido): nunca dos ventas por un mismo pedido.
      if (input.productOrderId) await deliverProductOrder(tx, businessId, input.productOrderId, sale!.id);

      return { sale: sale!, rewardJustEarned, stockMoved };
    });

    const [dto] = await loadSaleDtos(db, businessId, [result.sale]);
    // Avisos de mejor esfuerzo, FUERA de la transacción (igual que el premio de fidelización al completar una cita):
    // la propia venta (salvo que el dueño se la registre a sí mismo) y cualquier producto que quedó bajo o agotado.
    const [biz] = await db.select({ currency: businesses.currency }).from(businesses).where(eq(businesses.id, businessId)).limit(1);
    void notifyBusiness(
      ctx,
      businessId,
      'sales',
      { titleKey: 'push_sale_new_title', bodyKey: 'push_sale_new_body', params: { amount: formatMoney(dto!.total, (biz?.currency as Currency) ?? 'COP') }, dedupeKey: `sale_new:${dto!.id}`, href: '/sales-today' },
      request.actor.id,
    );
    for (const item of result.stockMoved) void notifyLowStockIfNeeded(ctx, businessId, item);
    return reply.status(201).send({ ...dto!, rewardJustEarned: result.rewardJustEarned });
  });

  app.post('/sales/:id/void', async (request) => {
    const id = uuid((request.params as { id?: string }).id);
    const { reason } = parse(voidSaleInputSchema, request.body);
    const businessId = businessOf(request);
    const userId = request.user.sub;

    const sale = await withBusinessTrusted(db, businessId, async (tx) => {
      // FOR UPDATE: dos anulaciones simultáneas (doble clic, dos dispositivos) se ordenan; la segunda ve "voided" y
      // responde 409 en vez de devolver el stock otra vez.
      const [row] = await tx.select().from(sales).where(and(eq(sales.id, id), eq(sales.businessId, businessId))).limit(1).for('update');
      if (!row) throw notFound();
      if (row.status === 'voided') throw new AppError(409, 'already_voided');
      // La caja del día en que se vendió: un cierre en curso de ese día termina primero (booking/cashLock.ts).
      await lockCashDayAt(tx, businessId, row.createdAt);

      const lines = await tx.select().from(saleItems).where(and(eq(saleItems.businessId, businessId), eq(saleItems.saleId, id)));
      for (const line of lines) {
        if (line.kind === 'product' && line.itemId) {
          const next = sql`least(${items.stock} + ${line.quantity}, 1000000)`;
          await tx.update(items).set({ stock: next, stockStatus: sql`case when ${next} <= 0 then 'out_of_stock' when ${next} <= ${REORDER_THRESHOLD} then 'reorder' else 'available' end`, updatedAt: new Date() }).where(and(eq(items.id, line.itemId), eq(items.businessId, businessId)));
        }
      }

      // Los registros de servicio que generó esta venta dejan de contar en Inicio/Reportes/Fidelización: la venta
      // "no pasó", pero el historial de cada uno se conserva (no se borra), solo queda marcado.
      const recordIds = lines.map((line) => line.serviceRecordId).filter((recordId): recordId is string => recordId !== null);
      if (recordIds.length > 0) await tx.update(serviceRecords).set({ voided: true }).where(and(eq(serviceRecords.businessId, businessId), inArray(serviceRecords.id, recordIds)));

      const [updated] = await tx.update(sales).set({ status: 'voided', voidReason: reason, voidedBy: userId, voidedAt: new Date() }).where(eq(sales.id, id)).returning();
      return updated!;
    });

    return (await loadSaleDtos(db, businessId, [sale]))[0]!;
  });
}

/** Categoría genérica para artículos creados desde una venta ("guardar en catálogo"): una por negocio, bajo pedido. */
async function findOrCreateDefaultCategory(tx: Tx, businessId: string): Promise<string> {
  const [existing] = await tx.select({ id: categories.id }).from(categories).where(and(eq(categories.businessId, businessId), sql`lower(${categories.name}) = 'otros'`)).limit(1);
  if (existing) return existing.id;
  const [created] = await tx.insert(categories).values({ businessId, name: 'Otros' }).returning({ id: categories.id });
  return created!.id;
}
