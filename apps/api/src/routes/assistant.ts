import {
  addDays,
  ASSISTANT_CATALOG,
  ASSISTANT_REQUIREMENT,
  assistantAskQuerySchema,
  can,
  canAny,
  CLIENTS_NOT_RETURNING_THRESHOLD_DAYS,
  EMPLOYEE_ACTIVE_LIMIT,
  percentChange,
  resolveReportRange,
  type AssistantAnswer,
  type AssistantAnswerData,
  type AssistantPeriodInfo,
  type AssistantQuestionKey,
  type AssistantRequirement,
  type BalanceDto,
  type Currency,
  type ImageMatchResult,
  type ReportPeriod,
} from '@xiro/shared';
import { and, count, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { buildSalesReport, type SalesReport } from '../assistant/reportsData';
import { appointmentsByProfessional, appointmentsByStatus, clientsNotReturning, countNewClients, countServedClients, upcomingAppointments } from '../assistant/extraData';
import { matchProductImage } from '../assistant/imageMatch';
import { computeBalance } from '../booking/balance';
import { withBusiness } from '../booking/scope';
import { localDate } from '../booking/time';
import type { Ctx } from '../context';
import { businesses, items, users } from '../db/schema';
import { AppError, notFound, parse } from '../errors';
import { accessGrantStatus } from '../platform/grants';
import { formatPushMoment } from '../push';
import { getSubscriptionRow, toSubscriptionResponse } from '../subscriptions';

/**
 * Asistente de negocio — Fase A (ver la propuesta de diseño entregada antes de esta fase). Catálogo CERRADO: cada
 * pregunta reutiliza el mismo cálculo que ya ve el dueño en Reportes/Finanzas/Equipo/Suscripción, con el MISMO permiso
 * que ya exige su pantalla equivalente. Nada de texto libre interpretado como comando ni SQL dinámico: la única entrada
 * del cliente es `question` (de un enum cerrado) y, para las que lo piden, un período.
 */

const EXPENSE_QUESTIONS = new Set<AssistantQuestionKey>(['expenses_total', 'expenses_by_category', 'expenses_operating_payroll', 'net_profit']);
const APPOINTMENT_PERIOD_QUESTIONS = new Set<AssistantQuestionKey>(['appointments_by_status', 'appointments_by_professional']);
const CLIENT_PERIOD_QUESTIONS = new Set<AssistantQuestionKey>(['clients_new', 'clients_served']);
type NoPeriodQuestion = 'stock_low' | 'employees_active' | 'subscription_status' | 'appointments_upcoming' | 'clients_not_returning';

/** Igual regla que el `ownScope` local de routes/booking.ts (no se exporta de ahí, así que se repite aquí): sin "ver
 * todas las agendas", cada pregunta de citas se limita a las propias — igual que ya hace `GET /appointments`. */
function ownScope(request: FastifyRequest): string | undefined {
  return can(request.actor, 'agenda_all') ? undefined : request.actor.id;
}

/** Igual disciplina que `authorize()` en authz.ts, aplicada por PREGUNTA (una sola ruta sirve varias preguntas con
 * distinto permiso, así que la política de la ruta en authz.ts es la unión de todas; esto afina por pregunta). */
function requireQuestionAccess(request: FastifyRequest, question: AssistantQuestionKey): void {
  if (request.actor.role === 'owner') return;
  const requirement: AssistantRequirement = ASSISTANT_REQUIREMENT[question];
  if (requirement === 'any') return;
  if (requirement === 'owner' || !canAny(request.actor, requirement)) throw new AppError(403, 'forbidden');
}

function canAsk(request: FastifyRequest, question: AssistantQuestionKey): boolean {
  if (request.actor.role === 'owner') return true;
  const requirement = ASSISTANT_REQUIREMENT[question];
  return requirement === 'any' || (requirement !== 'owner' && canAny(request.actor, requirement));
}

function salesAnswerData(question: AssistantQuestionKey, report: SalesReport): AssistantAnswerData {
  switch (question) {
    case 'sales_total':
      return { question, total: report.current.total, count: report.current.count };
    case 'sales_count':
      return { question, count: report.current.count };
    case 'sales_average':
      return { question, average: report.current.average };
    case 'sales_comparison':
      return { question, current: report.current.total, previous: report.previous.total, changePercent: percentChange(report.current.total, report.previous.total) };
    case 'payment_methods':
      return { question, rows: report.paymentMethods };
    case 'top_services':
      return { question, rows: report.topServices };
    case 'top_products':
      return { question, rows: report.topProducts };
    case 'top_employees':
      return { question, rows: report.employees.slice(0, 5) };
    case 'cash_state':
      return { question, openingBase: report.openingBase, cashSales: report.cashTotal - report.openingBase, cashTotal: report.cashTotal };
    default:
      // Inalcanzable: las únicas preguntas que llegan aquí son las de arriba (ver ASSISTANT_CATALOG más abajo).
      throw new AppError(500, 'internal_error');
  }
}

function financeAnswerData(question: AssistantQuestionKey, balance: BalanceDto): AssistantAnswerData {
  const { totals } = balance;
  switch (question) {
    case 'expenses_total':
      return { question, total: totals.operating + totals.payroll, operating: totals.operating, payroll: totals.payroll };
    case 'expenses_by_category':
      return { question, rows: balance.expenseBreakdown };
    case 'expenses_operating_payroll':
      return { question, operating: totals.operating, payroll: totals.payroll };
    case 'net_profit':
      return { question, income: totals.income, expenses: totals.operating + totals.payroll, net: totals.net, marginPercent: totals.margin };
    default:
      throw new AppError(500, 'internal_error');
  }
}

async function appointmentPeriodAnswerData(db: Ctx['db'], businessId: string, question: 'appointments_by_status' | 'appointments_by_professional', from: string, to: string, own: string | undefined): Promise<AssistantAnswerData> {
  if (question === 'appointments_by_status') return { question, rows: await appointmentsByStatus(db, businessId, from, to, own) };
  return { question, rows: await appointmentsByProfessional(db, businessId, from, to, own) };
}

async function clientPeriodAnswerData(db: Ctx['db'], businessId: string, question: 'clients_new' | 'clients_served', from: string, to: string): Promise<AssistantAnswerData> {
  if (question === 'clients_new') return { question, count: await countNewClients(db, businessId, from, to) };
  return { question, count: await countServedClients(db, businessId, from, to) };
}

export function assistantRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db } = ctx;

  /**
   * Preguntas que el actor de ESTA sesión puede hacer ahora mismo — para que la interfaz (Fase B) no ofrezca algo que
   * de todos modos se va a negar. Ocultar no es el control de seguridad: `/assistant/ask` vuelve a exigir el permiso
   * por su cuenta, sin confiar en que el cliente solo pida lo que ve aquí.
   */
  app.get('/assistant/catalog', async (request) => ASSISTANT_CATALOG.filter((entry) => canAsk(request, entry.question)));

  app.get('/assistant/ask', async (request): Promise<AssistantAnswer> => {
    const query = parse(assistantAskQuerySchema, request.query);
    requireQuestionAccess(request, query.question);
    const businessId = request.user.bid;
    const entry = ASSISTANT_CATALOG.find((q) => q.question === query.question);
    if (!entry) throw notFound();

    const [business] = await db.select({ timezone: businesses.timezone, currency: businesses.currency }).from(businesses).where(eq(businesses.id, businessId)).limit(1);
    if (!business) throw new AppError(401, 'unauthorized');
    const currency = business.currency as Currency;
    const own = ownScope(request);

    if (!entry.needsPeriod) {
      // `entry.needsPeriod === false` garantiza que `query.question` es una de las que acepta `answerWithoutPeriod`.
      const data = await answerWithoutPeriod(db, businessId, query.question as NoPeriodQuestion, request.actor.role, business.timezone, own);
      return { question: query.question, category: entry.category, period: null, currency, source: sourceOf(query.question), data };
    }

    const period: ReportPeriod = query.period ?? 'month';
    if (period === 'custom' && (!query.from || !query.to || query.from > query.to)) throw new AppError(400, 'validation_error', 'Rango de fechas inválido.');
    const custom = period === 'custom' ? { from: query.from!, to: query.to! } : undefined;
    let range: ReturnType<typeof resolveReportRange>;
    try {
      range = resolveReportRange(period, business.timezone, new Date(), custom);
    } catch {
      throw new AppError(400, 'validation_error', 'Rango de fechas inválido.');
    }
    const periodInfo: AssistantPeriodInfo = { period, from: range.current.startDate, to: addDays(range.current.startDate, range.current.days - 1) };

    if (EXPENSE_QUESTIONS.has(query.question)) {
      // Finanzas nunca consulta más allá de hoy (como su propia pantalla): un período en curso se recorta a hoy.
      const today = localDate(new Date(), business.timezone);
      const to = periodInfo.to > today ? today : periodInfo.to;
      const balance = await withBusiness(db, businessId, (tx) => computeBalance(tx, businessId, periodInfo.from, to, business.timezone));
      return { question: query.question, category: entry.category, currency, period: { ...periodInfo, to }, source: sourceOf(query.question), data: financeAnswerData(query.question, balance) };
    }

    if (APPOINTMENT_PERIOD_QUESTIONS.has(query.question)) {
      const data = await appointmentPeriodAnswerData(db, businessId, query.question as 'appointments_by_status' | 'appointments_by_professional', range.current.from, range.current.to, own);
      return { question: query.question, category: entry.category, currency, period: periodInfo, source: sourceOf(query.question), data };
    }

    if (CLIENT_PERIOD_QUESTIONS.has(query.question)) {
      const data = await clientPeriodAnswerData(db, businessId, query.question as 'clients_new' | 'clients_served', range.current.from, range.current.to);
      return { question: query.question, category: entry.category, currency, period: periodInfo, source: sourceOf(query.question), data };
    }

    const report = await buildSalesReport(db, businessId, period, business.timezone, new Date(), custom);
    return { question: query.question, category: entry.category, currency, period: periodInfo, source: sourceOf(query.question), data: salesAnswerData(query.question, report) };
  });

  /**
   * Foto de un producto → comparación LOCAL contra el inventario (ver `assistant/imageMatch.ts`): nunca se manda la
   * imagen a un servicio externo. Mismo permiso que ver el inventario (`GET /items`): es una forma más de consultarlo,
   * no una pregunta nueva de negocio. Siempre 200 con un resultado estructurado (coincidencia, parecido, nada, o por
   * qué no se pudo) — nunca inventa un producto que no esté de verdad en `items`.
   */
  app.post('/assistant/image-match', async (request): Promise<ImageMatchResult> => {
    const part = await request.file();
    if (!part) throw new AppError(400, 'image_invalid');
    const buffer = await part.toBuffer();
    return matchProductImage(ctx, request.user.bid, buffer);
  });
}

function sourceOf(question: AssistantQuestionKey): string {
  if (EXPENSE_QUESTIONS.has(question)) return 'Finanzas → Balance general';
  if (question === 'stock_low') return 'Catálogo → Inventario';
  if (question === 'employees_active') return 'Equipo';
  if (question === 'subscription_status') return 'Mi cuenta → Suscripción';
  if (question.startsWith('appointments_')) return 'Agenda';
  if (question.startsWith('clients_')) return 'Clientes';
  return 'Reportes → Ventas';
}

/** `question` llega acotado a las preguntas sin período (`ASSISTANT_CATALOG[*].needsPeriod === false`); quien llama
 * ya lo comprobó, así que aquí se afirma el tipo en vez de repetir la comprobación. */
async function answerWithoutPeriod(db: Ctx['db'], businessId: string, question: NoPeriodQuestion, role: 'owner' | 'employee', timezone: string, own: string | undefined): Promise<AssistantAnswerData> {
  if (question === 'appointments_upcoming') {
    const rows = await upcomingAppointments(db, businessId, new Date(), own);
    return { question, rows: rows.map((r) => ({ startsAt: formatPushMoment(r.startsAt.toISOString(), timezone), clientName: r.clientName, professionalName: r.professionalName, status: r.status })) };
  }
  if (question === 'clients_not_returning') {
    const rows = await clientsNotReturning(db, businessId, new Date());
    return { question, thresholdDays: CLIENTS_NOT_RETURNING_THRESHOLD_DAYS, rows };
  }
  if (question === 'stock_low') {
    const rows = await db
      .select({ id: items.id, name: items.name, stock: items.stock, stockStatus: items.stockStatus })
      .from(items)
      .where(and(eq(items.businessId, businessId), eq(items.kind, 'product'), inArray(items.stockStatus, ['reorder', 'out_of_stock'])))
      .orderBy(items.stock);
    return { question, rows: rows.map((r) => ({ id: r.id, name: r.name, stock: r.stock, stockStatus: r.stockStatus as 'reorder' | 'out_of_stock' })) };
  }
  if (question === 'employees_active') {
    const [row] = await db
      .select({ active: count() })
      .from(users)
      .where(and(eq(users.businessId, businessId), eq(users.role, 'employee'), eq(users.active, true)));
    return { question, active: row?.active ?? 0, limit: EMPLOYEE_ACTIVE_LIMIT };
  }
  // subscription_status — misma combinación que GET /api/subscription (routes/subscriptions.ts), para que el
  // asistente nunca cite un estado distinto del que ya ve el dueño en "Mi cuenta".
  const subRow = await getSubscriptionRow(db, businessId);
  const paid = await toSubscriptionResponse(db, subRow);
  const grant = await accessGrantStatus(db, businessId);
  const full = grant.coversNow ? { ...paid, hasAccess: true, accessGrantEndsAt: grant.until!.toISOString() } : { ...paid, accessGrantEndsAt: null };
  if (role === 'owner') {
    return { question, status: full.status, hasAccess: full.hasAccess, trialEndsAt: full.trialEndsAt, currentPeriodEnd: full.currentPeriodEnd, gracePeriodEndsAt: full.gracePeriodEndsAt, accessGrantEndsAt: full.accessGrantEndsAt };
  }
  // Un empleado solo necesita saber si hay acceso, igual que en GET /api/subscription.
  return { question, status: full.status, hasAccess: full.hasAccess, trialEndsAt: null, currentPeriodEnd: null, gracePeriodEndsAt: full.gracePeriodEndsAt, accessGrantEndsAt: full.accessGrantEndsAt };
}
