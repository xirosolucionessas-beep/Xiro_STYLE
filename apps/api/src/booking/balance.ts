import {
  balanceBucketRanges,
  balanceGrouping,
  percentChange,
  previousRange,
  type BalanceBucket,
  type BalanceCategorySlice,
  type BalanceDto,
  type BalanceGrouping, type BalanceMovementDto, type BalanceMovementsPage,
  type BalanceTotals,
  type ExpenseCategory,
} from '@xiro/shared';
import { sql } from 'drizzle-orm';
import type { Tx } from './scope';
import { addDays, zonedInstant } from './time';

/**
 * Balance general, calculado en SQL (agregaciones en la base, nunca sumando en el cliente). Fuentes:
 *  - Ingresos: `service_records` vigentes (cada línea de venta y cada cita completada genera uno; anular una venta los marca
 *    `voided`) — así no hay doble conteo — menos los descuentos de las ventas completadas. Propinas aparte.
 *  - Gastos: `expenses` vigentes por su FECHA de gasto, separados en operativos y nómina.
 * Los rangos son días locales del negocio: [inicio 00:00, fin+1 00:00) en su zona horaria.
 */

interface Row {
  [key: string]: unknown;
}

const n = (value: unknown) => Number(value ?? 0);

export async function balanceTotals(tx: Tx, businessId: string, from: string, to: string, timezone: string): Promise<BalanceTotals> {
  const start = zonedInstant(from, 0, timezone);
  const end = zonedInstant(addDays(to, 1), 0, timezone);
  const result = await tx.execute<Row>(sql`
    select
      (select coalesce(sum(amount) filter (where kind = 'service'), 0) from service_records
        where business_id = ${businessId} and voided = false and created_at >= ${start} and created_at < ${end}) as services,
      (select coalesce(sum(amount) filter (where kind = 'product'), 0) from service_records
        where business_id = ${businessId} and voided = false and created_at >= ${start} and created_at < ${end}) as products,
      (select coalesce(sum(discount), 0) from sales
        where business_id = ${businessId} and status = 'completed' and created_at >= ${start} and created_at < ${end}) as discounts,
      (select coalesce(sum(tip), 0) from sales
        where business_id = ${businessId} and status = 'completed' and created_at >= ${start} and created_at < ${end}) as tips,
      (select coalesce(sum(amount) filter (where type = 'operating'), 0) from expenses
        where business_id = ${businessId} and status = 'active' and expense_date >= ${from} and expense_date <= ${to}) as operating,
      (select coalesce(sum(amount) filter (where type = 'payroll'), 0) from expenses
        where business_id = ${businessId} and status = 'active' and expense_date >= ${from} and expense_date <= ${to}) as payroll
  `);
  const row = result.rows[0] ?? {};
  const services = n(row.services);
  const products = n(row.products);
  const discounts = n(row.discounts);
  const income = services + products - discounts;
  const operating = n(row.operating);
  const payroll = n(row.payroll);
  const net = income - operating - payroll;
  return { services, products, discounts, income, tips: n(row.tips), operating, payroll, net, margin: income > 0 ? Math.round((net / income) * 1000) / 10 : null };
}

export async function computeBalance(tx: Tx, businessId: string, from: string, to: string, timezone: string): Promise<BalanceDto> {
  const prev = previousRange(from, to);
  const totals = await balanceTotals(tx, businessId, from, to, timezone);
  const previousTotals = await balanceTotals(tx, businessId, prev.from, prev.to, timezone);
  const grouping = balanceGrouping(from, to);
  return {
    from,
    to,
    totals,
    previous: { ...prev, totals: previousTotals },
    comparison: {
      income: percentChange(totals.income, previousTotals.income),
      operating: percentChange(totals.operating, previousTotals.operating),
      payroll: percentChange(totals.payroll, previousTotals.payroll),
      net: percentChange(totals.net, previousTotals.net),
    },
    series: { grouping, buckets: await balanceSeries(tx, businessId, from, to, timezone, grouping) },
    expenseBreakdown: await expenseBreakdown(tx, businessId, from, to),
  };
}

/** Ingresos y gastos agrupados por día, semana o mes local, con TODOS los grupos del rango (los vacíos en cero). */
export async function balanceSeries(tx: Tx, businessId: string, from: string, to: string, timezone: string, grouping: BalanceGrouping): Promise<BalanceBucket[]> {
  const start = zonedInstant(from, 0, timezone);
  const end = zonedInstant(addDays(to, 1), 0, timezone);
  // `grouping` solo puede ser 'day' | 'week' | 'month' (lo calcula balanceGrouping, nunca llega del cliente).
  const unit = sql.raw(`'${grouping}'`);
  const result = await tx.execute<Row>(sql`
    select to_char(b, 'YYYY-MM-DD') as key, sum(income)::bigint as income, sum(expenses)::bigint as expenses from (
      select date_trunc(${unit}, created_at at time zone ${timezone}) as b, amount as income, 0 as expenses
        from service_records where business_id = ${businessId} and voided = false and created_at >= ${start} and created_at < ${end}
      union all
      select date_trunc(${unit}, created_at at time zone ${timezone}) as b, -discount as income, 0 as expenses
        from sales where business_id = ${businessId} and status = 'completed' and discount > 0 and created_at >= ${start} and created_at < ${end}
      union all
      select date_trunc(${unit}, expense_date::timestamp) as b, 0 as income, amount as expenses
        from expenses where business_id = ${businessId} and status = 'active' and expense_date >= ${from} and expense_date <= ${to}
    ) m group by b`);
  const byKey = new Map(result.rows.map((r) => [String(r.key), { income: n(r.income), expenses: n(r.expenses) }]));
  return balanceBucketRanges(from, to, grouping).map((range) => {
    const v = byKey.get(range.key) ?? { income: 0, expenses: 0 };
    return { ...range, income: v.income, expenses: v.expenses, net: v.income - v.expenses };
  });
}

/** Gastos vigentes del rango por categoría, de mayor a menor. */
export async function expenseBreakdown(tx: Tx, businessId: string, from: string, to: string): Promise<BalanceCategorySlice[]> {
  const result = await tx.execute<Row>(sql`
    select type, category, sum(amount)::bigint as amount from expenses
      where business_id = ${businessId} and status = 'active' and expense_date >= ${from} and expense_date <= ${to}
      group by type, category order by sum(amount) desc, category`);
  return result.rows.map((r) => ({ type: r.type as BalanceCategorySlice['type'], category: r.category as ExpenseCategory, amount: n(r.amount) }));
}

/**
 * Movimientos del rango (ingresos y egresos juntos), paginados y ordenados en la base. Ingresos: cada registro vigente
 * (servicio o producto) y, como salida de ingreso, el descuento de cada venta completada. Egresos: cada gasto vigente, al
 * inicio de su día local.
 */
export async function balanceMovements(
  tx: Tx,
  businessId: string,
  q: { from: string; to: string; kind: 'all' | 'income' | 'expense'; sort: 'date' | 'amount'; dir: 'asc' | 'desc'; page: number; pageSize: number },
  timezone: string,
): Promise<BalanceMovementsPage> {
  const start = zonedInstant(q.from, 0, timezone);
  const end = zonedInstant(addDays(q.to, 1), 0, timezone);
  const incomeRows = sql`
    select id, created_at as at, 'in' as direction, kind, null::text as category, label as description, amount
      from service_records where business_id = ${businessId} and voided = false and created_at >= ${start} and created_at < ${end}
    union all
    select id, created_at as at, 'out' as direction, 'discount' as kind, null::text as category, coalesce(nullif(client_label, ''), '') as description, discount as amount
      from sales where business_id = ${businessId} and status = 'completed' and discount > 0 and created_at >= ${start} and created_at < ${end}`;
  const expenseRows = sql`
    select id, (expense_date::timestamp at time zone ${timezone}) as at, 'out' as direction, type as kind, category, description, amount
      from expenses where business_id = ${businessId} and status = 'active' and expense_date >= ${q.from} and expense_date <= ${q.to}`;
  const union = q.kind === 'income' ? incomeRows : q.kind === 'expense' ? expenseRows : sql`${incomeRows} union all ${expenseRows}`;
  // `sort` y `dir` solo pueden ser los valores del enum validado (balanceMovementsQuerySchema): nunca texto del cliente.
  const order = q.sort === 'amount' ? sql.raw(`amount ${q.dir}, at desc, id`) : sql.raw(`at ${q.dir}, id`);
  const offset = (q.page - 1) * q.pageSize;
  // Una transacción es una sola conexión: las consultas van en serie.
  const page = await tx.execute<Row>(sql`select * from (${union}) m order by ${order} limit ${q.pageSize} offset ${offset}`);
  const count = await tx.execute<Row>(sql`select count(*)::int as total from (${union}) m`);
  const rows: BalanceMovementDto[] = page.rows.map((r) => ({
    id: String(r.id),
    at: new Date(r.at as string).toISOString(),
    direction: r.direction as 'in' | 'out',
    kind: r.kind as BalanceMovementDto['kind'],
    category: (r.category as ExpenseCategory | null) ?? null,
    description: String(r.description ?? ''),
    amount: n(r.amount),
  }));
  return { rows, total: n(count.rows[0]?.total), page: q.page, pageSize: q.pageSize };
}
