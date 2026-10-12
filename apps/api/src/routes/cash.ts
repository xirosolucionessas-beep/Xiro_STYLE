import {
  cashCloseInputSchema,
  expenseInputSchema,
  voidCashCloseInputSchema,
  type CashClosingDto,
  type CashDaySummary,
  type CashEmployeeSales,
  type CashOpeningDto,
  type CashSalesByMethod,
  type CashTopEntry,
  type ExpenseDto,
} from '@xiro/shared';
import { and, desc, eq, gte, inArray, lt } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { addDays, localMinutes, zonedInstant } from '../booking/time';
import { withBusinessTrusted, type Tx } from '../booking/scope';
import type { Ctx } from '../context';
import { appointments, businesses, cashClosings, cashOpenings, clients, expenses, saleItems, salePayments, sales, users } from '../db/schema';
import { isUniqueViolation } from '../db/errors';
import { AppError, notFound, parse, uuid } from '../errors';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const dayQuery = z.object({ day: z.string().regex(DAY_RE, 'required') });
const rangeQuery = z.object({ from: z.string().regex(DAY_RE, 'required'), to: z.string().regex(DAY_RE, 'required') });

/**
 * Gastos del día y cierre de caja (Tarea 8): el cierre solo congela la base de apertura y lo contado físicamente; el
 * resto del resumen se recalcula siempre a partir de `sales`/`service_records`(vía `sale_items`)/`expenses`, que ya
 * son inmutables por su cuenta. Solo el dueño abre y cierra caja (mismo criterio que `/cash/today`).
 */
export function cashRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db } = ctx;
  const businessOf = (request: { user: { bid: string } }) => request.user.bid;

  async function timezoneOf(businessId: string): Promise<string> {
    const [row] = await db.select({ timezone: businesses.timezone }).from(businesses).where(eq(businesses.id, businessId)).limit(1);
    if (!row) throw notFound();
    return row.timezone;
  }

  const toExpenseDto = (row: typeof expenses.$inferSelect, name: string): ExpenseDto => ({
    id: row.id,
    amount: row.amount,
    description: row.description,
    method: row.method as ExpenseDto['method'],
    createdByName: name,
    createdAt: row.createdAt.toISOString(),
  });

  async function namesOf(tx: Tx | typeof db, businessId: string, ids: readonly string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await tx.select({ id: users.id, name: users.name }).from(users).where(and(eq(users.businessId, businessId), inArray(users.id, unique)));
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  /** Todo lo del día `day` (hora local del negocio), recalculado en vivo — nunca una copia guardada aparte. */
  async function computeDaySummary(tx: Tx | typeof db, businessId: string, day: string, timezone: string): Promise<CashDaySummary> {
    const rangeFrom = zonedInstant(day, 0, timezone);
    const rangeTo = zonedInstant(addDays(day, 1), 0, timezone);

    const [opening] = await tx.select().from(cashOpenings).where(and(eq(cashOpenings.businessId, businessId), eq(cashOpenings.day, day))).limit(1);

    const saleRows = await tx.select().from(sales).where(and(eq(sales.businessId, businessId), gte(sales.createdAt, rangeFrom), lt(sales.createdAt, rangeTo), eq(sales.status, 'completed')));
    const saleIds = saleRows.map((s) => s.id);
    const [itemRows, paymentRows] = await Promise.all([
      saleIds.length > 0 ? tx.select().from(saleItems).where(and(eq(saleItems.businessId, businessId), inArray(saleItems.saleId, saleIds))) : Promise.resolve([]),
      saleIds.length > 0 ? tx.select().from(salePayments).where(and(eq(salePayments.businessId, businessId), inArray(salePayments.saleId, saleIds))) : Promise.resolve([]),
    ]);

    const expenseRows = await tx.select().from(expenses).where(and(eq(expenses.businessId, businessId), gte(expenses.createdAt, rangeFrom), lt(expenses.createdAt, rangeTo)));
    const expenseNames = await namesOf(tx, businessId, expenseRows.map((e) => e.createdBy));

    const byMethod = new Map<string, CashSalesByMethod>();
    for (const payment of paymentRows) {
      const bucket = byMethod.get(payment.method) ?? { method: payment.method as CashSalesByMethod['method'], total: 0, count: 0 };
      bucket.total += payment.amount;
      bucket.count += 1;
      byMethod.set(payment.method, bucket);
    }

    const rank = (rows: typeof itemRows, kind: 'service' | 'product'): CashTopEntry[] => {
      const byName = new Map<string, CashTopEntry>();
      for (const row of rows) {
        if (row.kind !== kind) continue;
        const bucket = byName.get(row.name) ?? { name: row.name, count: 0, total: 0 };
        bucket.count += row.quantity;
        bucket.total += row.total;
        byName.set(row.name, bucket);
      }
      return [...byName.values()].sort((a, b) => b.total - a.total).slice(0, 5);
    };

    const employeeMap = new Map<string, CashEmployeeSales>();
    for (const row of itemRows) {
      if (row.kind !== 'service' || !row.employeeId) continue;
      const bucket = employeeMap.get(row.employeeId) ?? { employeeId: row.employeeId, employeeName: '', total: 0, count: 0 };
      bucket.total += row.total;
      bucket.count += 1;
      employeeMap.set(row.employeeId, bucket);
    }
    const employeeNames = await namesOf(tx, businessId, [...employeeMap.keys()]);
    const employeeSales = [...employeeMap.values()].map((e) => ({ ...e, employeeName: employeeNames.get(e.employeeId) ?? '' })).sort((a, b) => b.total - a.total);

    const hourlyMap = new Map<number, number>();
    for (const sale of saleRows) {
      const hour = Math.floor(localMinutes(sale.createdAt, timezone) / 60);
      hourlyMap.set(hour, (hourlyMap.get(hour) ?? 0) + sale.total);
    }
    const hourly = [...hourlyMap.entries()].map(([hour, total]) => ({ hour, total })).sort((a, b) => a.hour - b.hour);

    const clientIds = new Set(saleRows.map((s) => s.clientId ?? `occasional:${s.id}`));
    const newClientRows = await tx.select({ id: clients.id }).from(clients).where(and(eq(clients.businessId, businessId), gte(clients.createdAt, rangeFrom), lt(clients.createdAt, rangeTo), eq(clients.isOccasional, false)));

    const apptRows = await tx.select({ status: appointments.status }).from(appointments).where(and(eq(appointments.businessId, businessId), gte(appointments.startsAt, rangeFrom), lt(appointments.startsAt, rangeTo)));
    const apptCount = (status: string) => apptRows.filter((a) => a.status === status).length;

    const totalSales = saleRows.reduce((sum, s) => sum + s.total, 0);
    const totalTip = saleRows.reduce((sum, s) => sum + s.tip, 0);
    const totalExpenses = expenseRows.reduce((sum, e) => sum + e.amount, 0);
    const cashIn = byMethod.get('cash')?.total ?? 0;
    const cashOut = expenseRows.filter((e) => e.method === 'cash').reduce((sum, e) => sum + e.amount, 0);

    return {
      day,
      opening: opening?.amount ?? null,
      salesByMethod: [...byMethod.values()].sort((a, b) => b.total - a.total),
      totalSales,
      totalTip,
      servicesCount: itemRows.filter((i) => i.kind === 'service').reduce((sum, i) => sum + i.quantity, 0),
      productsCount: itemRows.filter((i) => i.kind === 'product').reduce((sum, i) => sum + i.quantity, 0),
      topServices: rank(itemRows, 'service'),
      topProducts: rank(itemRows, 'product'),
      employeeSales,
      expenses: expenseRows.map((e) => toExpenseDto(e, expenseNames.get(e.createdBy) ?? '')),
      totalExpenses,
      expectedCash: opening ? opening.amount + cashIn - cashOut : null,
      hourly,
      clientsServed: clientIds.size,
      newClients: newClientRows.length,
      appointments: { completed: apptCount('completed'), cancelled: apptCount('cancelled'), noShow: apptCount('no_show') },
    };
  }

  const toClosingDto = (row: typeof cashClosings.$inferSelect, closedByName: string, summary?: CashDaySummary): CashClosingDto => ({
    id: row.id,
    day: row.day,
    openingAmount: row.openingAmount,
    countedAmount: row.countedAmount,
    expectedAmount: row.expectedAmount,
    difference: row.difference,
    totalSales: row.totalSales,
    totalTip: row.totalTip,
    totalExpenses: row.totalExpenses,
    note: row.note,
    status: row.status as CashClosingDto['status'],
    voidReason: row.voidReason,
    closedByName,
    createdAt: row.createdAt.toISOString(),
    ...(summary ? { summary } : {}),
  });

  /* ---------- Gastos ---------- */

  app.get('/expenses', async (request) => {
    const { from, to } = parse(rangeQuery, request.query);
    const businessId = businessOf(request);
    const timezone = await timezoneOf(businessId);
    const rangeFrom = zonedInstant(from, 0, timezone);
    const rangeTo = zonedInstant(addDays(to, 1), 0, timezone);
    const rows = await db.select().from(expenses).where(and(eq(expenses.businessId, businessId), gte(expenses.createdAt, rangeFrom), lt(expenses.createdAt, rangeTo))).orderBy(desc(expenses.createdAt));
    const names = await namesOf(db, businessId, rows.map((r) => r.createdBy));
    return rows.map((r) => toExpenseDto(r, names.get(r.createdBy) ?? ''));
  });

  app.post('/expenses', async (request, reply) => {
    const input = parse(expenseInputSchema, request.body);
    const businessId = businessOf(request);
    const userId = request.user.sub;
    const [row] = await db.insert(expenses).values({ businessId, amount: input.amount, description: input.description, method: input.method, createdBy: userId }).returning();
    const name = (await namesOf(db, businessId, [userId])).get(userId) ?? '';
    return reply.status(201).send(toExpenseDto(row!, name));
  });

  /* ---------- Cierre de caja ---------- */

  app.get('/cash/close-summary', async (request) => {
    const { day } = parse(dayQuery, request.query);
    const businessId = businessOf(request);
    const timezone = await timezoneOf(businessId);
    return computeDaySummary(db, businessId, day, timezone);
  });

  /**
   * Bases de caja registradas dentro de un rango (Reportes: tarjeta "Base inicial" — no existía una forma de leer
   * más de un día a la vez, solo `/cash/today`). Un día sin apertura registrada simplemente no aparece en la lista:
   * nunca se inventa un valor para un día que nunca se abrió.
   */
  app.get('/cash/openings', async (request): Promise<CashOpeningDto[]> => {
    const { from, to } = parse(rangeQuery, request.query);
    const businessId = businessOf(request);
    const rows = await db.select().from(cashOpenings).where(and(eq(cashOpenings.businessId, businessId), gte(cashOpenings.day, from), lt(cashOpenings.day, addDays(to, 1)))).orderBy(desc(cashOpenings.day));
    return rows.map((row) => ({ id: row.id, day: row.day, amount: row.amount, note: row.note, openedAt: row.openedAt.toISOString() }));
  });

  app.get('/cash/closings', async (request) => {
    const { from, to } = parse(rangeQuery, request.query);
    const businessId = businessOf(request);
    const rows = await db.select().from(cashClosings).where(and(eq(cashClosings.businessId, businessId), gte(cashClosings.day, from), lt(cashClosings.day, addDays(to, 1)))).orderBy(desc(cashClosings.day));
    const names = await namesOf(db, businessId, rows.map((r) => r.closedBy));
    return rows.map((r) => toClosingDto(r, names.get(r.closedBy) ?? ''));
  });

  app.get('/cash/closings/:id', async (request) => {
    const id = uuid((request.params as { id?: string }).id);
    const businessId = businessOf(request);
    const [row] = await db.select().from(cashClosings).where(and(eq(cashClosings.id, id), eq(cashClosings.businessId, businessId))).limit(1);
    if (!row) throw notFound();
    const timezone = await timezoneOf(businessId);
    const [summary, names] = await Promise.all([computeDaySummary(db, businessId, row.day, timezone), namesOf(db, businessId, [row.closedBy])]);
    return toClosingDto(row, names.get(row.closedBy) ?? '', summary);
  });

  app.post('/cash/close', async (request, reply) => {
    const input = parse(cashCloseInputSchema, request.body);
    const businessId = businessOf(request);
    const userId = request.user.sub;
    const timezone = await timezoneOf(businessId);

    // Dos cierres simultáneos del mismo día: el índice único (cash_closings_business_day_active_uq) deja pasar uno; el
    // otro es el mismo 409 "ya cerrada" que si hubiera llegado después (antes era un error 500).
    const result = await withBusinessTrusted(db, businessId, async (tx) => {
      const [already] = await tx.select({ id: cashClosings.id }).from(cashClosings).where(and(eq(cashClosings.businessId, businessId), eq(cashClosings.day, input.day), eq(cashClosings.status, 'completed'))).limit(1);
      if (already) throw new AppError(409, 'already_closed');

      const summary = await computeDaySummary(tx, businessId, input.day, timezone);
      if (summary.opening === null || summary.expectedCash === null) throw new AppError(409, 'no_opening');

      const difference = input.countedAmount - summary.expectedCash;
      const [row] = await tx
        .insert(cashClosings)
        .values({
          businessId,
          day: input.day,
          openingAmount: summary.opening,
          countedAmount: input.countedAmount,
          expectedAmount: summary.expectedCash,
          difference,
          totalSales: summary.totalSales,
          totalTip: summary.totalTip,
          totalExpenses: summary.totalExpenses,
          note: input.note,
          closedBy: userId,
        })
        .returning();
      return { row: row!, summary };
    }).catch((error: unknown) => {
      if (isUniqueViolation(error, 'cash_closings_business_day_active_uq')) throw new AppError(409, 'already_closed');
      throw error;
    });

    const name = (await namesOf(db, businessId, [userId])).get(userId) ?? '';
    return reply.status(201).send(toClosingDto(result.row, name, result.summary));
  });

  app.post('/cash/closings/:id/void', async (request) => {
    const id = uuid((request.params as { id?: string }).id);
    const { reason } = parse(voidCashCloseInputSchema, request.body);
    const businessId = businessOf(request);
    const userId = request.user.sub;

    const updated = await db
      .update(cashClosings)
      .set({ status: 'voided', voidReason: reason, voidedBy: userId, voidedAt: new Date() })
      .where(and(eq(cashClosings.id, id), eq(cashClosings.businessId, businessId), eq(cashClosings.status, 'completed')))
      .returning();
    if (updated.length === 0) {
      const [row] = await db.select({ id: cashClosings.id }).from(cashClosings).where(and(eq(cashClosings.id, id), eq(cashClosings.businessId, businessId))).limit(1);
      throw row ? new AppError(409, 'already_voided') : notFound();
    }
    const name = (await namesOf(db, businessId, [updated[0]!.closedBy])).get(updated[0]!.closedBy) ?? '';
    return toClosingDto(updated[0]!, name);
  });
}
