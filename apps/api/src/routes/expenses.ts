import {
  expenseInputSchema,
  expensesExportQuerySchema,
  expensesQuerySchema,
  expenseUpdateSchema,
  expenseVoidSchema,
  type Currency,
  type ExpenseDto,
  type ExpensePayeeDto,
  type ExpensesQuery,
} from '@xiro/shared';
import { and, asc, desc, eq, gte, lte } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { assertEmployeeOfBusiness, cashOpeningOf, expenseSnapshot, isCashDayClosed, loadAdjustments, loadExpenseDtos, recordAdjustment, type ExpenseRow } from '../booking/expenses';
import { withBusiness, type Tx } from '../booking/scope';
import { localDate } from '../booking/time';
import { buildExpensesXlsx, exportFileName } from '../booking/balanceExport';
import type { Ctx } from '../context';
import { businesses, expenses, users } from '../db/schema';
import { AppError, notFound, parse, uuid } from '../errors';

/** Tope de filas por consulta del listado (un rango de un año de un negocio real queda muy por debajo). */
const MAX_ROWS = 1000;
/** Tope de la descarga en Excel (máximo 12 meses). */
const MAX_EXPORT_ROWS = 5000;

/** La caja de ese día está cerrada: cambiar el gasto exige un ajuste explícito (la respuesta lo indica a la interfaz). */
const dayClosed = (day: string) => new AppError(409, 'expense_day_closed', undefined, undefined, { adjustable: true, cashDay: day });

/**
 * Gastos del negocio (módulo Finanzas): operativos y nómina. Quién puede: el dueño o un empleado con el permiso "finance"
 * (ver authz.ts; cualquier otro recibe 403). Todo con `withBusiness` (RLS): el negocio sale SIEMPRE de la sesión.
 *
 * Caja: un gasto "pagado desde caja" se resta del efectivo esperado de ese día. Pedirlo explícitamente exige la caja de ese
 * día abierta (si no, 409 `cash_not_open`: se puede registrar como "no pagado desde caja"). El formato anterior (Cierre de
 * caja, sin la marca) conserva su comportamiento de siempre. Un gasto que salió de una caja YA CERRADA solo se corrige o anula
 * con un ajuste explícito (motivo), que queda registrado con el antes y el después; el cierre firmado no cambia.
 * Nada se borra: un gasto se anula con motivo y queda en el historial.
 */
export function expenseRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db } = ctx;
  const scoped = <T>(businessId: string, fn: (tx: Tx) => Promise<T>) => withBusiness(db, businessId, fn);

  async function timezoneOf(tx: Tx, businessId: string): Promise<string> {
    const [row] = await tx.select({ timezone: businesses.timezone }).from(businesses).where(eq(businesses.id, businessId)).limit(1);
    if (!row) throw notFound();
    return row.timezone;
  }

  async function lockOwn(tx: Tx, businessId: string, id: string): Promise<ExpenseRow> {
    const [row] = await tx.select().from(expenses).where(and(eq(expenses.id, id), eq(expenses.businessId, businessId))).limit(1).for('update');
    if (!row) throw notFound();
    return row;
  }

  /**
   * ¿Puede salir de la caja de `day`? Cerrada → no (salvo ajuste, que decide quien llama). Pedido explícito sin apertura → no.
   * Devuelve la apertura a enlazar (o null).
   */
  async function cashFor(tx: Tx, businessId: string, day: string, explicit: boolean): Promise<string | null> {
    const opening = await cashOpeningOf(tx, businessId, day);
    if (explicit && !opening) throw new AppError(409, 'cash_not_open', undefined, undefined, { cashDay: day });
    return opening;
  }

  /** Gastos del negocio con los filtros del listado (la pantalla y la descarga en Excel usan la misma consulta). */
  async function findExpenses(tx: Tx, businessId: string, query: Required<Pick<ExpensesQuery, 'from' | 'to' | 'status'>> & ExpensesQuery, limit: number): Promise<ExpenseDto[]> {
    const rows = await tx
      .select()
      .from(expenses)
      .where(
        and(
          eq(expenses.businessId, businessId),
          gte(expenses.expenseDate, query.from),
          lte(expenses.expenseDate, query.to),
          query.type ? eq(expenses.type, query.type) : undefined,
          query.category ? eq(expenses.category, query.category) : undefined,
          query.employeeId ? eq(expenses.employeeId, query.employeeId) : undefined,
          query.status === 'all' ? undefined : eq(expenses.status, query.status),
        ),
      )
      .orderBy(desc(expenses.expenseDate), desc(expenses.createdAt))
      .limit(limit);
    return loadExpenseDtos(tx, businessId, rows);
  }

  app.get('/expenses', async (request): Promise<ExpenseDto[]> => {
    const query = parse(expensesQuerySchema, request.query);
    const businessId = request.user.bid;
    return scoped(businessId, async (tx) => findExpenses(tx, businessId, query, MAX_ROWS));
  });

  /** Lista de gastos en Excel, con los mismos filtros que la pantalla (máximo 12 meses). */
  app.get('/expenses/export.xlsx', async (request, reply) => {
    const { lang, ...query } = parse(expensesExportQuerySchema, request.query);
    const businessId = request.user.bid;
    const { rows, business } = await scoped(businessId, async (tx) => {
      const [business] = await tx
        .select({ name: businesses.name, slug: businesses.slug, address: businesses.address, city: businesses.city, currency: businesses.currency, timezone: businesses.timezone })
        .from(businesses)
        .where(eq(businesses.id, businessId))
        .limit(1);
      if (!business) throw notFound();
      return { rows: await findExpenses(tx, businessId, query, MAX_EXPORT_ROWS), business };
    });
    const file = await buildExpensesXlsx(rows, { ...business, currency: business.currency as Currency }, query, lang);
    return reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', `attachment; filename="${exportFileName('gastos', business.slug, query.from, query.to, 'xlsx')}"`)
      .header('Cache-Control', 'no-store')
      .send(file);
  });

  /**
   * Personas del negocio a las que se les puede pagar nómina (para elegir el beneficiario). Solo id, nombre y rol: un
   * administrador con "Finanzas" no necesita (ni ve) la ficha completa de Empleados, que sigue siendo del dueño.
   */
  app.get('/expenses/payees', async (request): Promise<ExpensePayeeDto[]> => {
    const businessId = request.user.bid;
    return scoped(businessId, async (tx) =>
      (await tx.select({ id: users.id, name: users.name, role: users.role, active: users.active }).from(users).where(eq(users.businessId, businessId)).orderBy(asc(users.name))).map((u) => ({
        id: u.id,
        name: u.name,
        role: u.role as ExpensePayeeDto['role'],
        active: u.active,
      })),
    );
  });

  /** Detalle, con los ajustes registrados después del cierre de su caja. */
  app.get('/expenses/:id', async (request): Promise<ExpenseDto> => {
    const id = uuid((request.params as { id?: string }).id);
    const businessId = request.user.bid;
    return scoped(businessId, async (tx) => {
      const [row] = await tx.select().from(expenses).where(and(eq(expenses.id, id), eq(expenses.businessId, businessId))).limit(1);
      if (!row) throw notFound();
      const [dto] = await loadExpenseDtos(tx, businessId, [row]);
      return { ...dto!, adjustments: await loadAdjustments(tx, businessId, { expenseId: id }) };
    });
  });

  /** Alta. El formato anterior (monto, concepto, método) sigue valiendo: queda como operativo, hoy y —en efectivo— desde caja. */
  app.post('/expenses', async (request, reply) => {
    const input = parse(expenseInputSchema, request.body);
    const businessId = request.user.bid;
    const userId = request.user.sub;
    const dto = await scoped(businessId, async (tx) => {
      const expenseDate = input.expenseDate ?? localDate(new Date(), await timezoneOf(tx, businessId));
      await assertEmployeeOfBusiness(tx, businessId, input.employeeId);
      const paidFromCash = input.paidFromCash ?? input.method === 'cash';
      // A una caja ya cerrada no se le agregan salidas (no hay ajuste para un gasto nuevo: se registra "no pagado desde caja").
      if (paidFromCash && (await isCashDayClosed(tx, businessId, expenseDate))) throw new AppError(409, 'expense_day_closed', undefined, undefined, { adjustable: false, cashDay: expenseDate });
      const cashOpeningId = paidFromCash ? await cashFor(tx, businessId, expenseDate, input.paidFromCash === true) : null;
      const [row] = await tx
        .insert(expenses)
        .values({
          businessId,
          amount: input.amount,
          description: input.description,
          method: input.method,
          type: input.type,
          category: input.category,
          expenseDate,
          employeeId: input.employeeId,
          notes: input.notes,
          paidFromCash,
          cashOpeningId,
          createdBy: userId,
        })
        .returning();
      return (await loadExpenseDtos(tx, businessId, [row!]))[0]!;
    });
    return reply.status(201).send(dto);
  });

  /**
   * Edición completa (mismos campos que el alta). Anulado → 409. Si toca una caja ya cerrada (la de antes o la de ahora), exige
   * `adjustmentReason` y registra el ajuste de cada caja cerrada afectada con lo que salía de ella antes y después.
   */
  app.put('/expenses/:id', async (request): Promise<ExpenseDto> => {
    const id = uuid((request.params as { id?: string }).id);
    const input = parse(expenseUpdateSchema, request.body);
    const businessId = request.user.bid;
    const userId = request.user.sub;
    return scoped(businessId, async (tx) => {
      const current = await lockOwn(tx, businessId, id);
      if (current.status === 'voided') throw new AppError(409, 'expense_already_voided');
      await assertEmployeeOfBusiness(tx, businessId, input.employeeId);
      const expenseDate = input.expenseDate ?? current.expenseDate;
      const paidFromCash = input.paidFromCash ?? input.method === 'cash';

      // Cajas cerradas afectadas: la de antes (si el gasto salía de ella) y la de ahora (si saldrá de ella).
      const closedBefore = current.paidFromCash && (await isCashDayClosed(tx, businessId, current.expenseDate));
      const closedAfter = paidFromCash && (expenseDate === current.expenseDate ? closedBefore || (await isCashDayClosed(tx, businessId, expenseDate)) : await isCashDayClosed(tx, businessId, expenseDate));
      if ((closedBefore || closedAfter) && !input.adjustmentReason) throw dayClosed(closedBefore ? current.expenseDate : expenseDate);

      const cashOpeningId = paidFromCash ? (closedAfter ? await cashOpeningOf(tx, businessId, expenseDate) : await cashFor(tx, businessId, expenseDate, input.paidFromCash === true)) : null;
      const [row] = await tx
        .update(expenses)
        .set({
          amount: input.amount,
          description: input.description,
          method: input.method,
          type: input.type,
          category: input.category,
          expenseDate,
          employeeId: input.employeeId,
          notes: input.notes,
          paidFromCash,
          cashOpeningId,
          updatedAt: new Date(),
        })
        .where(and(eq(expenses.id, id), eq(expenses.businessId, businessId)))
        .returning();

      // Lo que sale de cada caja cerrada antes y después (0 si no salía / ya no sale de ella).
      const outOf = (r: ExpenseRow, day: string) => (r.paidFromCash && r.expenseDate === day && r.status === 'active' ? r.amount : 0);
      const days = new Set<string>([...(closedBefore ? [current.expenseDate] : []), ...(closedAfter ? [expenseDate] : [])]);
      for (const day of days) {
        await recordAdjustment(tx, {
          businessId,
          expenseId: id,
          cashDay: day,
          kind: 'edit',
          reason: input.adjustmentReason!,
          amountBefore: outOf(current, day),
          amountAfter: outOf(row!, day),
          before: expenseSnapshot(current),
          after: expenseSnapshot(row!),
          createdBy: userId,
        });
      }
      return (await loadExpenseDtos(tx, businessId, [row!]))[0]!;
    });
  });

  /** Anular (nunca borrar): con motivo y quién lo hizo. Si salió de una caja ya cerrada, exige y registra el ajuste. */
  app.post('/expenses/:id/void', async (request): Promise<ExpenseDto> => {
    const id = uuid((request.params as { id?: string }).id);
    const { reason, adjustmentReason } = parse(expenseVoidSchema, request.body);
    const businessId = request.user.bid;
    const userId = request.user.sub;
    return scoped(businessId, async (tx) => {
      const current = await lockOwn(tx, businessId, id);
      if (current.status === 'voided') throw new AppError(409, 'expense_already_voided');
      const closed = current.paidFromCash && (await isCashDayClosed(tx, businessId, current.expenseDate));
      if (closed && !adjustmentReason) throw dayClosed(current.expenseDate);
      const [row] = await tx
        .update(expenses)
        .set({ status: 'voided', voidReason: reason, voidedBy: userId, voidedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(expenses.id, id), eq(expenses.businessId, businessId)))
        .returning();
      if (closed) {
        await recordAdjustment(tx, {
          businessId,
          expenseId: id,
          cashDay: current.expenseDate,
          kind: 'void',
          reason: adjustmentReason!,
          amountBefore: current.amount,
          amountAfter: 0,
          before: expenseSnapshot(current),
          after: expenseSnapshot(row!),
          createdBy: userId,
        });
      }
      return (await loadExpenseDtos(tx, businessId, [row!]))[0]!;
    });
  });
}
