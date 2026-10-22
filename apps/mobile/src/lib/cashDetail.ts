import { formatClock, formatDay, localDate, localTime, upperFirst, type CashDaySaleDto, type ExpenseAdjustmentDto, type ExpenseDto, type Language } from '@xiro/shared';

/**
 * "Ver más" del cierre de caja: lo que muestran web y Android/iOS de cada venta y gasto. Sin React Native ni DOM, para poder
 * probarlo. Fechas y horas salen SIEMPRE de los instantes que guarda el servidor, en la zona horaria del negocio (nunca del
 * reloj del dispositivo). Los importes vienen calculados por el servidor; aquí solo se les da formato.
 */
type T = (key: string, params?: Record<string, string | number>) => string;
export interface DetailFormat {
  t: T;
  fmt: (n: number) => string;
  timezone: string;
  language: Language;
}

const when = (f: DetailFormat, instant: string) => `${upperFirst(formatDay(localDate(instant, f.timezone), f.language, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }))} · ${formatClock(localTime(instant, f.timezone), f.language)}`;
const minus = (f: DetailFormat, n: number) => (n > 0 ? `−${f.fmt(n)}` : f.fmt(0));

export interface SaleDetailView {
  id: string;
  when: string;
  client: string;
  registeredBy: string;
  voided: boolean;
  voidReason: string | null;
  lines: Array<{ key: string; label: string; gross: string; discount: string; net: string }>;
  totals: { gross: string; discount: string; net: string };
  otherLines: Array<{ key: string; label: string; performer: string | null }>;
  sale: { subtotal: string; discount: string; tip: string | null; total: string; change: string | null; payments: Array<{ key: string; label: string; amount: string }> };
}

export function saleDetailView(f: DetailFormat, dto: CashDaySaleDto): SaleDetailView {
  const { t, fmt } = f;
  const focusIds = new Set(dto.lines.map((l) => l.id));
  return {
    id: dto.sale.id,
    when: when(f, dto.sale.createdAt),
    client: t('cash_detail_client', { name: dto.sale.clientName || t('sale_client_occasional') }),
    registeredBy: t('cash_detail_registered_by', { name: dto.sale.createdByName || '—' }),
    voided: dto.sale.status === 'voided',
    voidReason: dto.sale.status === 'voided' && dto.sale.voidReason ? t('cash_detail_void_reason', { reason: dto.sale.voidReason }) : null,
    lines: dto.lines.map((l) => ({ key: l.id, label: t('cash_close_breakdown_line', { name: l.name, units: l.quantity }), gross: fmt(l.gross), discount: minus(f, l.discountShare), net: fmt(l.net) })),
    totals: { gross: fmt(dto.gross), discount: minus(f, dto.discountShare), net: fmt(dto.net) },
    otherLines: dto.sale.items
      .filter((i) => !focusIds.has(i.id))
      .map((i) => ({ key: i.id, label: `${t('cash_close_breakdown_line', { name: i.name, units: i.quantity })} · ${fmt(i.total)}`, performer: i.kind === 'service' && i.employeeName ? t('cash_detail_performed_by', { name: i.employeeName }) : null })),
    sale: {
      subtotal: fmt(dto.sale.subtotal),
      discount: minus(f, dto.sale.discount),
      tip: dto.sale.tip > 0 ? fmt(dto.sale.tip) : null,
      total: fmt(dto.sale.total),
      change: dto.sale.changeGiven > 0 ? fmt(dto.sale.changeGiven) : null,
      payments: dto.sale.payments.map((p) => ({ key: p.id, label: t(`sale_pay_${p.method}`), amount: fmt(p.amount) })),
    },
  };
}

export interface ExpenseDetailView {
  id: string;
  title: string;
  meta: string;
  amount: string;
  method: string;
  expenseDate: string;
  registered: string;
  beneficiary: string | null;
  fromCash: string;
  notes: string | null;
  voided: boolean;
  voidInfo: string | null;
}

export function expenseDetailView(f: DetailFormat, e: ExpenseDto): ExpenseDetailView {
  const { t, fmt } = f;
  return {
    id: e.id,
    title: e.description,
    meta: `${t(`exp_type_${e.type}`)} · ${t(`exp_cat_${e.category}`)}`,
    amount: fmt(e.amount),
    method: t(`sale_pay_${e.method}`),
    expenseDate: t('cash_exp_date', { date: upperFirst(formatDay(e.expenseDate, f.language, { day: 'numeric', month: 'short', year: 'numeric' })) }),
    // Quién lo REGISTRÓ y a qué hora (zona del negocio); no quién "lo pagó".
    registered: t('cash_exp_registered', { name: e.createdByName || '—', time: when(f, e.createdAt) }),
    beneficiary: e.employeeName ? t('cash_exp_beneficiary', { name: e.employeeName }) : null,
    fromCash: t(e.paidFromCash ? 'cash_exp_from_cash' : 'cash_exp_not_from_cash'),
    notes: e.notes ? t('cash_exp_notes', { notes: e.notes }) : null,
    voided: e.status === 'voided',
    voidInfo: e.status === 'voided' ? t('cash_exp_voided_by', { name: e.voidedByName ?? '—', time: e.voidedAt ? when(f, e.voidedAt) : '—', reason: e.voidReason || '—' }) : null,
  };
}

/** Agrupa por EMPLEADO BENEFICIARIO (a quién se le pagó, p. ej. nómina); sin beneficiario va al final. */
export function groupExpensesByBeneficiary(t: T, expenses: ExpenseDto[]): Array<{ key: string; title: string; items: ExpenseDto[] }> {
  const groups = new Map<string, { key: string; title: string; items: ExpenseDto[] }>();
  for (const e of expenses) {
    const key = e.employeeId ?? '__none__';
    const group = groups.get(key) ?? { key, title: e.employeeId ? t('cash_exp_group', { name: e.employeeName ?? '—' }) : t('cash_exp_group_none'), items: [] };
    group.items.push(e);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => (a.key === '__none__' ? 1 : b.key === '__none__' ? -1 : a.title.localeCompare(b.title)));
}

export function adjustmentText(f: DetailFormat, a: ExpenseAdjustmentDto): string {
  return f.t('cash_exp_adjustment', {
    who: a.createdByName || '—',
    // Fecha y hora: un ajuste se hace después del cierre, a menudo otro día.
    time: when(f, a.createdAt),
    kind: f.t(a.kind === 'void' ? 'cash_exp_adjustment_void' : 'cash_exp_adjustment_edit'),
    before: f.fmt(a.amountBefore),
    after: f.fmt(a.amountAfter),
    reason: a.reason,
  });
}
