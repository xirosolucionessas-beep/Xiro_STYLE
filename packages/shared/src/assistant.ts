import { z } from 'zod';
import type { AppointmentStatus } from './booking';
import type { BalanceCategorySlice } from './balance';
import { formatMoney, type Currency } from './money';
import type { EmployeePerformanceRow, PaymentMethodRow, RankRow, ReportPeriod } from './reports';
import type { EmployeePermission } from './roles';
import type { Language } from './schemas';
import type { SubscriptionStatus } from './subscription';
import { REPORT_PERIODS } from './reports';

/**
 * Asistente de negocio — Fase A (catálogo cerrado, sin texto libre interpretado como comando — ver la propuesta
 * entregada en esta fase). Cada pregunta reutiliza EXACTAMENTE los mismos cálculos que ya ve el dueño en "Reportes" o
 * "Finanzas": nunca una cifra nueva ni una definición distinta. Contrato compartido entre `apps/api/src/routes/assistant.ts`
 * y la futura interfaz (Fase B).
 */

export const ASSISTANT_CATEGORIES = ['sales', 'cash', 'finance', 'inventory', 'team', 'subscription', 'appointments', 'clients'] as const;
export type AssistantCategory = (typeof ASSISTANT_CATEGORIES)[number];

export const ASSISTANT_QUESTIONS = [
  'sales_total',
  'sales_count',
  'sales_average',
  'sales_comparison',
  'payment_methods',
  'top_services',
  'top_products',
  'top_employees',
  'cash_state',
  'expenses_total',
  'expenses_by_category',
  'expenses_operating_payroll',
  'net_profit',
  'stock_low',
  'employees_active',
  'subscription_status',
  // Fase C: citas y clientes (nuevas funciones de agregación — ver apps/api/src/assistant/extraData.ts).
  'appointments_by_status',
  'appointments_upcoming',
  'appointments_by_professional',
  'clients_new',
  'clients_served',
  'clients_not_returning',
] as const;
export type AssistantQuestionKey = (typeof ASSISTANT_QUESTIONS)[number];

/** Misma forma que `PolicyRule` en `apps/api/src/authz.ts`: 'any' = cualquier sesión, 'owner' = solo el dueño, lista = el
 * dueño o un empleado con AL MENOS UNO de esos permisos. */
export type AssistantRequirement = 'any' | 'owner' | readonly EmployeePermission[];

/** Qué permiso exige cada pregunta — el MISMO que ya exige la pantalla equivalente (authz.ts): nada nuevo que decidir. */
export const ASSISTANT_REQUIREMENT: Record<AssistantQuestionKey, AssistantRequirement> = {
  // Igual que GET /sales.
  sales_total: ['services_record'],
  sales_count: ['services_record'],
  sales_average: ['services_record'],
  sales_comparison: ['services_record'],
  payment_methods: ['services_record'],
  top_services: ['services_record'],
  top_products: ['services_record'],
  top_employees: ['services_record'],
  cash_state: ['services_record'],
  // Igual que GET /reports/balance (Finanzas).
  expenses_total: ['finance'],
  expenses_by_category: ['finance'],
  expenses_operating_payroll: ['finance'],
  net_profit: ['finance'],
  // Igual que GET /items.
  stock_low: ['catalog_view'],
  // Igual que GET /employees/quota.
  employees_active: 'owner',
  // Igual que GET /subscription.
  subscription_status: 'any',
  // Igual que GET /appointments: sin "ver todas las agendas", cada una se limita a las propias.
  appointments_by_status: ['agenda_own'],
  appointments_upcoming: ['agenda_own'],
  appointments_by_professional: ['agenda_own'],
  // Igual que GET /clients.
  clients_new: ['clients_view'],
  clients_served: ['clients_view'],
  clients_not_returning: ['clients_view'],
};

export interface AssistantCatalogEntry {
  question: AssistantQuestionKey;
  category: AssistantCategory;
  needsPeriod: boolean;
}

export const ASSISTANT_CATALOG: AssistantCatalogEntry[] = [
  { question: 'sales_total', category: 'sales', needsPeriod: true },
  { question: 'sales_count', category: 'sales', needsPeriod: true },
  { question: 'sales_average', category: 'sales', needsPeriod: true },
  { question: 'sales_comparison', category: 'sales', needsPeriod: true },
  { question: 'payment_methods', category: 'sales', needsPeriod: true },
  { question: 'top_services', category: 'sales', needsPeriod: true },
  { question: 'top_products', category: 'sales', needsPeriod: true },
  { question: 'top_employees', category: 'sales', needsPeriod: true },
  { question: 'cash_state', category: 'cash', needsPeriod: true },
  { question: 'expenses_total', category: 'finance', needsPeriod: true },
  { question: 'expenses_by_category', category: 'finance', needsPeriod: true },
  { question: 'expenses_operating_payroll', category: 'finance', needsPeriod: true },
  { question: 'net_profit', category: 'finance', needsPeriod: true },
  { question: 'stock_low', category: 'inventory', needsPeriod: false },
  { question: 'employees_active', category: 'team', needsPeriod: false },
  { question: 'subscription_status', category: 'subscription', needsPeriod: false },
  { question: 'appointments_by_status', category: 'appointments', needsPeriod: true },
  { question: 'appointments_upcoming', category: 'appointments', needsPeriod: false },
  { question: 'appointments_by_professional', category: 'appointments', needsPeriod: true },
  { question: 'clients_new', category: 'clients', needsPeriod: true },
  { question: 'clients_served', category: 'clients', needsPeriod: true },
  { question: 'clients_not_returning', category: 'clients', needsPeriod: false },
];

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export const assistantAskQuerySchema = z
  .object({
    question: z.enum(ASSISTANT_QUESTIONS),
    period: z.enum(REPORT_PERIODS).optional(),
    from: z.string().regex(DAY_RE).optional(),
    to: z.string().regex(DAY_RE).optional(),
  })
  .strict();
export type AssistantAskQuery = z.infer<typeof assistantAskQuerySchema>;

export interface AssistantPeriodInfo {
  period: ReportPeriod;
  /** [from, to] en días locales del negocio, AMBOS incluidos (a diferencia de `ReportWindow.to`, que es un instante UTC exclusivo). */
  from: string;
  to: string;
}

/** Días sin una visita para que un cliente cuente como "no ha vuelto" (`clients_not_returning`). Fijo por ahora — ver
 * la propuesta de diseño: es una decisión de producto pendiente de confirmar, no un cálculo. */
export const CLIENTS_NOT_RETURNING_THRESHOLD_DAYS = 30;

export type AssistantAnswerData =
  | { question: 'sales_total'; total: number; count: number }
  | { question: 'sales_count'; count: number }
  | { question: 'sales_average'; average: number | null }
  | { question: 'sales_comparison'; current: number; previous: number; changePercent: number | null }
  | { question: 'payment_methods'; rows: PaymentMethodRow[] }
  | { question: 'top_services'; rows: RankRow[] }
  | { question: 'top_products'; rows: RankRow[] }
  | { question: 'top_employees'; rows: EmployeePerformanceRow[] }
  | { question: 'cash_state'; openingBase: number; cashSales: number; cashTotal: number }
  | { question: 'expenses_total'; total: number; operating: number; payroll: number }
  | { question: 'expenses_by_category'; rows: BalanceCategorySlice[] }
  | { question: 'expenses_operating_payroll'; operating: number; payroll: number }
  | { question: 'net_profit'; income: number; expenses: number; net: number; marginPercent: number | null }
  | { question: 'stock_low'; rows: Array<{ id: string; name: string; stock: number; stockStatus: 'reorder' | 'out_of_stock' }> }
  | { question: 'employees_active'; active: number; limit: number }
  | {
      question: 'subscription_status';
      status: SubscriptionStatus | 'none';
      hasAccess: boolean;
      trialEndsAt: string | null;
      currentPeriodEnd: string | null;
      gracePeriodEndsAt: string | null;
      accessGrantEndsAt: string | null;
    }
  | { question: 'appointments_by_status'; rows: Array<{ status: AppointmentStatus; count: number }> }
  | { question: 'appointments_upcoming'; rows: Array<{ startsAt: string; clientName: string; professionalName: string; status: AppointmentStatus }> }
  | { question: 'appointments_by_professional'; rows: Array<{ professionalName: string; count: number }> }
  | { question: 'clients_new'; count: number }
  | { question: 'clients_served'; count: number }
  | { question: 'clients_not_returning'; thresholdDays: number; rows: Array<{ name: string; lastVisit: string }> };

export interface AssistantAnswer {
  question: AssistantQuestionKey;
  category: AssistantCategory;
  /** `null` para las preguntas que no dependen de un período (inventario, equipo, suscripción). */
  period: AssistantPeriodInfo | null;
  currency: Currency;
  /** De dónde sale la cifra, en palabras (p. ej. "Reportes → Ventas", "Finanzas → Balance general"). */
  source: string;
  data: AssistantAnswerData;
}

/* ---------- Texto libre sin IA: coincidencia por palabras clave contra el catálogo CERRADO ---------- */

/**
 * Palabras/frases (en minúsculas, sin tildes) que identifican cada pregunta. Es un dato de emparejamiento, no texto
 * para mostrar (los textos que SÍ se muestran viven en `packages/shared/src/i18n.ts`, como el resto de la app).
 */
const ASSISTANT_QUESTION_KEYWORDS: Record<Language, Record<AssistantQuestionKey, string[]>> = {
  es: {
    sales_total: ['cuanto vendi', 'total de ventas', 'ventas del dia', 'ventas de hoy', 'ventas del mes', 'ventas del año'],
    sales_count: ['cuantas ventas', 'numero de ventas', 'cantidad de ventas'],
    sales_average: ['promedio por venta', 'ticket promedio', 'valor promedio de venta'],
    sales_comparison: ['periodo anterior', 'comparado con', 'crecieron las ventas', 'bajaron las ventas', 'subieron las ventas'],
    payment_methods: ['medio de pago', 'metodo de pago', 'cuanto en efectivo', 'cuanto por tarjeta', 'cuanto en transferencia'],
    top_services: ['servicios mas vendidos', 'servicio mas solicitado', 'servicios mas pedidos'],
    top_products: ['productos mas vendidos', 'producto mas vendido'],
    top_employees: ['empleado que mas vendio', 'quien vendio mas', 'rendimiento de empleados', 'mejor empleado'],
    cash_state: ['cuanto hay en caja', 'saldo de caja', 'efectivo en caja', 'base de caja', 'total en caja'],
    expenses_total: ['cuanto gaste', 'total de gastos', 'gastos del periodo', 'cuanto en gastos'],
    expenses_by_category: ['categoria de gastos', 'en que gaste mas', 'gastos por categoria'],
    expenses_operating_payroll: ['nomina', 'gastos operativos', 'pague de nomina'],
    net_profit: ['ganancia', 'utilidad', 'cuanto gane', 'margen'],
    stock_low: ['agotado', 'poco stock', 'bajo inventario', 'se esta acabando', 'por agotarse'],
    employees_active: ['empleados activos', 'cuantos empleados'],
    subscription_status: ['mi suscripcion', 'mi plan', 'cuando vence mi plan', 'tengo acceso'],
    appointments_by_status: ['cuantas citas', 'citas pendientes', 'citas confirmadas', 'citas canceladas', 'citas completadas'],
    appointments_upcoming: ['proximas citas', 'siguientes citas', 'que citas vienen', 'agenda de hoy'],
    appointments_by_professional: ['citas por profesional', 'citas por empleado', 'quien tiene mas citas'],
    clients_new: ['clientes nuevos', 'cuantos clientes nuevos'],
    clients_served: ['clientes atendidos', 'cuantos clientes atendi'],
    clients_not_returning: ['clientes que no han vuelto', 'clientes que no regresan', 'clientes inactivos', 'clientes perdidos'],
  },
  en: {
    sales_total: ['how much did i sell', 'total sales', 'sales today', 'sales this month', 'sales this year'],
    sales_count: ['how many sales', 'number of sales'],
    sales_average: ['average sale', 'average ticket'],
    sales_comparison: ['previous period', 'compared to', 'sales grew', 'sales dropped'],
    payment_methods: ['payment method', 'how much in cash', 'how much by card', 'how much by transfer'],
    top_services: ['best selling service', 'most requested service', 'top services'],
    top_products: ['best selling product', 'top products'],
    top_employees: ['best selling employee', 'who sold the most', 'employee performance', 'top employees'],
    cash_state: ['how much is in the register', 'cash balance', 'cash on hand', 'opening base'],
    expenses_total: ['how much did i spend', 'total expenses'],
    expenses_by_category: ['expense category', 'spent the most on'],
    expenses_operating_payroll: ['payroll', 'operating expenses'],
    net_profit: ['profit', 'net profit', 'how much did i make', 'margin'],
    stock_low: ['out of stock', 'low stock', 'running low', 'low inventory'],
    employees_active: ['active employees', 'how many employees'],
    subscription_status: ['my subscription', 'my plan', 'when does my plan end', 'do i have access'],
    appointments_by_status: ['how many appointments', 'pending appointments', 'confirmed appointments', 'cancelled appointments'],
    appointments_upcoming: ['upcoming appointments', 'next appointments', 'what appointments are coming'],
    appointments_by_professional: ['appointments by professional', 'appointments by employee', 'who has the most appointments'],
    clients_new: ['new clients', 'how many new clients'],
    clients_served: ['clients served', 'how many clients did i serve'],
    clients_not_returning: ['clients who havent returned', 'clients who have not come back', 'inactive clients', 'lost clients'],
  },
};

const normalize = (value: string): string =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

export type AssistantClassification =
  | { kind: 'matched'; question: AssistantQuestionKey }
  /** El texto coincide con MÁS de una pregunta del catálogo: nunca se adivina cuál quiso decir — quien llama debe
   * mostrar las candidatas (o el catálogo completo), nunca ejecutar una al azar. */
  | { kind: 'ambiguous'; candidates: AssistantQuestionKey[] }
  | { kind: 'unsupported' };

/**
 * Clasificador local por palabras clave (Fase D — ver la propuesta de diseño): SIN IA, sin red, sin acceso a datos.
 * Decide, a partir del texto, cuál pregunta del catálogo CERRADO (`ASSISTANT_QUESTIONS`) coincide, si alguna — nunca
 * construye una consulta ni decide un permiso. El resultado es, como mucho, uno (o varios, si es ambiguo) de los
 * valores de `AssistantQuestionKey` ya enumerados; quien llama SIEMPRE debe volver a pasarlo por el permiso real de
 * la pregunta (`requireQuestionAccess` en `apps/api/src/routes/assistant.ts`) antes de responder — este clasificador
 * no concede ni adelanta ningún permiso, solo reconoce texto.
 */
export function classifyAssistantQuestion(text: string, language: Language): AssistantClassification {
  const normalized = normalize(text);
  if (!normalized.trim()) return { kind: 'unsupported' };
  const candidates = ASSISTANT_QUESTIONS.filter((question) => ASSISTANT_QUESTION_KEYWORDS[language][question].some((keyword) => normalized.includes(normalize(keyword))));
  if (candidates.length === 0) return { kind: 'unsupported' };
  if (candidates.length === 1) return { kind: 'matched', question: candidates[0]! };
  return { kind: 'ambiguous', candidates: [...candidates] };
}

/**
 * Compatibilidad con quien solo necesita "¿hay UNA sola coincidencia clara?" — una ambigüedad (más de una candidata)
 * se trata igual que "ninguna coincidencia": nunca se adivina cuál de varias quiso decir (ver `classifyAssistantQuestion`
 * para distinguir ambos casos).
 */
export function matchAssistantQuestion(text: string, language: Language): AssistantQuestionKey | null {
  const result = classifyAssistantQuestion(text, language);
  return result.kind === 'matched' ? result.question : null;
}

const ASSISTANT_PERIOD_KEYWORDS: Record<Language, Array<[Exclude<ReportPeriod, 'custom'>, string[]]>> = {
  es: [
    ['today', ['hoy']],
    ['week', ['esta semana']],
    ['year', ['este año', 'este ano', 'este anio']],
    ['month', ['este mes']],
  ],
  en: [
    ['today', ['today']],
    ['week', ['this week']],
    ['year', ['this year']],
    ['month', ['this month']],
  ],
};

/** Período mencionado en el texto libre, si hay alguno; `null` si no se menciona ninguno (quien llama decide el valor por defecto). */
export function matchAssistantPeriod(text: string, language: Language): ReportPeriod | null {
  const normalized = normalize(text);
  for (const [period, keywords] of ASSISTANT_PERIOD_KEYWORDS[language]) {
    if (keywords.some((keyword) => normalized.includes(normalize(keyword)))) return period;
  }
  return null;
}

/* ---------- Dar forma a la respuesta (reutilizado por la app nativa y la web) ---------- */

/** Línea del "resultado principal" (parte 1 de la estructura de respuesta). `t` resuelve `exp_cat_<categoría>` para
 * los nombres de categoría de gasto (i18n.ts) — todo lo demás es puro número con `formatMoney`. */
export function assistantResultLine(data: AssistantAnswerData, currency: Currency, t: (key: string) => string): string {
  const money = (n: number) => formatMoney(n, currency);
  const pct = (n: number) => `${n > 0 ? '+' : ''}${n}%`;
  switch (data.question) {
    case 'sales_total':
      return `${money(data.total)} (${data.count})`;
    case 'sales_count':
      return String(data.count);
    case 'sales_average':
      return data.average === null ? t('assistant_no_sales_period') : money(data.average);
    case 'sales_comparison':
      return `${money(data.current)} / ${money(data.previous)}` + (data.changePercent === null ? '' : ` (${pct(data.changePercent)})`);
    case 'payment_methods':
      return data.rows.length === 0 ? t('assistant_no_data_period') : data.rows.map((row) => `${row.method}: ${money(row.total)} (${row.percent}%)`).join(' · ');
    case 'top_services':
    case 'top_products':
      return data.rows.length === 0 ? t('assistant_no_data_period') : data.rows.map((row, i) => `${i + 1}. ${row.label} (${row.count})`).join(' · ');
    case 'top_employees':
      return data.rows.length === 0 ? t('assistant_no_data_period') : data.rows.map((row, i) => `${i + 1}. ${row.employeeName} (${row.count})`).join(' · ');
    case 'cash_state':
      return money(data.cashTotal);
    case 'expenses_total':
      return money(data.total);
    case 'expenses_by_category':
      return data.rows.length === 0 ? t('assistant_no_data_period') : data.rows.map((row) => `${t(`exp_cat_${row.category}`)}: ${money(row.amount)}`).join(' · ');
    case 'expenses_operating_payroll':
      return `${money(data.operating)} / ${money(data.payroll)}`;
    case 'net_profit':
      return money(data.net) + (data.marginPercent === null ? '' : ` (${data.marginPercent}%)`);
    case 'stock_low':
      return data.rows.length === 0 ? t('assistant_no_data_period') : data.rows.map((row) => `${row.name} (${row.stock})`).join(' · ');
    case 'employees_active':
      return `${data.active} / ${data.limit}`;
    case 'subscription_status':
      return data.status;
    case 'appointments_by_status':
      return data.rows.length === 0 ? t('assistant_no_data_period') : data.rows.map((row) => `${t(`assistant_appt_status_${row.status}`)}: ${row.count}`).join(' · ');
    case 'appointments_upcoming':
      return data.rows.length === 0 ? t('assistant_no_data') : data.rows.map((row) => `${row.clientName} — ${row.professionalName} (${row.startsAt})`).join(' · ');
    case 'appointments_by_professional':
      return data.rows.length === 0 ? t('assistant_no_data_period') : data.rows.map((row) => `${row.professionalName}: ${row.count}`).join(' · ');
    case 'clients_new':
    case 'clients_served':
      return String(data.count);
    case 'clients_not_returning':
      return data.rows.length === 0 ? t('assistant_no_data') : data.rows.map((row) => `${row.name} (${row.lastVisit})`).join(' · ');
  }
}

/**
 * Las 5 partes de toda respuesta del asistente (ver la propuesta de diseño): pregunta reconocida, resultado, período,
 * moneda y fuente, ayuda breve, y la nota de la única pregunta que la necesita (`net_profit`). Mismo texto en
 * cualquier plataforma: nativo y web llaman esto con su propio `t()` (ambos ya exponen `exp_cat_*`, ver i18n.ts).
 */
export function assistantAnswerText(answer: AssistantAnswer, t: (key: string) => string): string {
  const lines = [t(`assistant_q_${answer.question}`), assistantResultLine(answer.data, answer.currency, t)];
  if (answer.period) lines.push(`${t('assistant_answer_period')}: ${t(`assistant_period_${answer.period.period}`)} (${answer.period.from} – ${answer.period.to})`);
  lines.push(`${t('assistant_answer_source')}: ${answer.source} · ${answer.currency}`);
  const help = t(`assistant_help_${answer.question}`);
  if (help) lines.push(help);
  if (answer.question === 'net_profit') lines.push(t('assistant_note_net_profit'));
  if (answer.question === 'clients_not_returning') lines.push(t('assistant_note_not_returning').replace('{n}', String(CLIENTS_NOT_RETURNING_THRESHOLD_DAYS)));
  return lines.join('\n');
}

/* ---------- Saludo del primer mensaje ---------- */

/**
 * Saludo del primer mensaje (ver la propuesta de diseño): según la hora (mañana/tarde/noche) y, si se conoce, el
 * nombre del negocio — nunca inventado: sin nombre, un saludo genérico. `hour` es 0–23 en hora LOCAL de quien lee
 * (nativo/web deciden cuál reloj usar); esta función es pura y no depende de ninguna plataforma.
 */
export function assistantGreeting(hour: number, businessName: string | null | undefined, t: (key: string) => string): string {
  const moment = hour >= 5 && hour < 12 ? 'morning' : hour >= 12 && hour < 19 ? 'afternoon' : 'evening';
  const greeting = t(`assistant_greeting_${moment}`);
  const name = businessName?.trim();
  const template = name ? t('assistant_greeting_with_business') : t('assistant_greeting_generic');
  return template.replace('{greeting}', greeting).replace('{business}', name ?? '');
}

/* ---------- Comparación de una foto con el inventario (local, sin IA ni servicio externo) ---------- */

/** Por debajo de este puntaje (0–100) no se considera ni "coincidencia" ni "similar": se dice que no se encontró nada confiable. */
export const IMAGE_SIMILAR_SCORE = 65;
/** A partir de este puntaje se trata como el MISMO producto, no solo uno parecido. */
export const IMAGE_MATCH_SCORE = 90;

export interface ImageMatchItem {
  id: string;
  name: string;
  price: number;
  stock: number;
  stockStatus: 'available' | 'reorder' | 'out_of_stock';
  /** 0–100: qué tan parecida es la foto enviada a la mejor foto de este producto en el inventario. */
  score: number;
}

export type ImageMatchResult =
  /** Una o más coincidencias casi exactas (≥ `IMAGE_MATCH_SCORE`). */
  | { ok: true; kind: 'match'; currency: Currency; items: ImageMatchItem[] }
  /** Nada casi exacto, pero sí algo parecido (≥ `IMAGE_SIMILAR_SCORE`): nunca se afirma que es el mismo producto. */
  | { ok: true; kind: 'similar'; currency: Currency; items: ImageMatchItem[] }
  /** Ninguna coincidencia confiable — nunca se inventa una. */
  | { ok: true; kind: 'none' }
  | { ok: false; reason: 'invalid_image' | 'no_inventory' };

/** Texto de la respuesta a una foto de producto (parte del contrato de 5 partes del asistente, adaptado: aquí no hay
 * período ni pregunta reconocida, solo el resultado y, si aplica, precio/existencias de HOY). */
export function imageMatchResultText(result: ImageMatchResult, t: (key: string) => string): string {
  if (!result.ok) return t(result.reason === 'invalid_image' ? 'assistant_image_invalid' : 'assistant_image_no_inventory');
  if (result.kind === 'none') return t('assistant_image_none');
  const header = t(result.kind === 'match' ? 'assistant_image_match' : 'assistant_image_similar');
  const stockKey = (status: ImageMatchItem['stockStatus']) => `assistant_image_stock_${status === 'out_of_stock' ? 'out' : status}`;
  const lines = result.items.map((item) => `${item.name} — ${formatMoney(item.price, result.currency)} — ${t(stockKey(item.stockStatus))} (${item.stock})`);
  return [header, ...lines].join('\n');
}
