/**
 * Ruta /cash-close SOLO WEB (fallback nativo: cash-close.tsx redirige al inicio). Cierre de caja: resumen del día
 * (ventas por hora y por forma de pago, top servicios/productos, comisiones, clientes y citas, gastos), cerrar con lo
 * contado físicamente, anular con motivo, e historial de días anteriores. Presentación en src/web/screens/CashClose.tsx.
 */
import type { CashDaySummary, Currency, SalePaymentMethod } from '@xiro/shared';
import { formatMoney, whatsappLink } from '@xiro/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { addDays, formatClock, formatDay, localTime, todayIn } from '@/lib/agenda';
import { api } from '@/lib/api';
import { apiErrors } from '@/lib/forms';
import { useCashClosingDetail, useCashClosings, useCashCloseSummary, useInvalidateCash } from '@/lib/queries';
import { useAuthed } from '@/lib/session';
import { Header, Screen } from '@/ui/Screen';
import { CashCloseView, type CashCloseHistoryRow, type CashCloseRankRow } from '@/web/screens/CashClose';
import { parseAmountInput } from '@/web/money';
import { useWebText } from '@/web/services/useWebText';
import { VoidCashClosingModal } from '@/web/ui/VoidCashClosingModal';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const times = (n: number, t: (k: string, p?: Record<string, string | number>) => string) => (n === 1 ? t('sec_rep_time_one') : t('sec_rep_times', { n }));

export default function CashCloseWeb() {
  const router = useRouter();
  const { t, language } = useWebText();
  const { user, business } = useAuthed();
  const isOwner = user.role === 'owner';
  const currency = business.currency as Currency;
  const money = (amount: number) => formatMoney(amount, currency);
  const invalidateCash = useInvalidateCash();

  const params = useLocalSearchParams<{ day?: string }>();
  const todayKey = todayIn(business.timezone);
  const day = params.day && DAY_RE.test(params.day) ? params.day : todayKey;
  const isToday = day === todayKey;

  const rangeFrom = useMemo(() => addDays(todayKey, -30), [todayKey]);
  const closingsQuery = useCashClosings({ from: rangeFrom, to: todayKey }, isOwner);
  const closedForDay = (closingsQuery.data ?? []).find((c) => c.day === day && c.status === 'completed') ?? null;

  const closingDetailQuery = useCashClosingDetail(closedForDay?.id ?? null, Boolean(closedForDay) && isOwner);
  const liveSummaryQuery = useCashCloseSummary(day, !closedForDay && isOwner);
  const summary: CashDaySummary | undefined = closedForDay ? closingDetailQuery.data?.summary : liveSummaryQuery.data;
  const loading = closedForDay ? closingDetailQuery.isLoading : liveSummaryQuery.isLoading;
  const isError = closedForDay ? closingDetailQuery.isError : liveSummaryQuery.isError;

  const [voidOpen, setVoidOpen] = useState(false);
  const [countedAmount, setCountedAmount] = useState(0);
  const [closeNote, setCloseNote] = useState('');
  const [closeBusy, setCloseBusy] = useState(false);
  const [closeError, setCloseError] = useState<string>();

  const [expenseOpen, setExpenseOpen] = useState(false);
  const [expenseDescription, setExpenseDescription] = useState('');
  const [expenseAmount, setExpenseAmount] = useState(0);
  const [expenseMethod, setExpenseMethod] = useState<SalePaymentMethod>('cash');
  const [expenseBusy, setExpenseBusy] = useState(false);
  const [expenseError, setExpenseError] = useState<string>();

  async function submitClose() {
    setCloseError(undefined);
    if (countedAmount <= 0) return setCloseError(t('cash_close_error_amount'));
    setCloseBusy(true);
    try {
      await api.closeCash({ day, countedAmount, note: closeNote });
      await invalidateCash();
      setCountedAmount(0);
      setCloseNote('');
    } catch (error) {
      setCloseError(apiErrors(error, t).general ?? t('unknown_error'));
    } finally {
      setCloseBusy(false);
    }
  }

  async function addExpense() {
    if (!expenseDescription.trim()) return setExpenseError(t('required'));
    if (expenseAmount <= 0) return setExpenseError(t('cash_close_expense_amount'));
    setExpenseError(undefined);
    setExpenseBusy(true);
    try {
      await api.createExpense({ amount: expenseAmount, description: expenseDescription.trim(), method: expenseMethod });
      await invalidateCash();
      setExpenseDescription('');
      setExpenseAmount(0);
      setExpenseOpen(false);
    } catch (error) {
      setExpenseError(apiErrors(error, t).general ?? t('unknown_error'));
    } finally {
      setExpenseBusy(false);
    }
  }

  async function confirmVoid(reason: string) {
    if (!closedForDay) return { ok: false };
    try {
      await api.voidCashClosing(closedForDay.id, reason);
      await invalidateCash();
      setVoidOpen(false);
      return { ok: true };
    } catch (error) {
      return { ok: false, general: apiErrors(error, t).general ?? t('unknown_error') };
    }
  }

  const dayLabel = formatDay(day, language, { weekday: 'long', day: 'numeric', month: 'long' });

  function shareText(): string {
    if (!summary) return '';
    const lines = [
      `${business.name} — ${t('nav_cash_close')}: ${dayLabel}`,
      `${t('cash_close_kpi_sales')}: ${money(summary.totalSales)}`,
      `${t('cash_close_kpi_expenses')}: ${money(summary.totalExpenses)}`,
      closedForDay ? `${t('cash_close_expected')}: ${money(closedForDay.expectedAmount)}` : summary.expectedCash !== null ? `${t('cash_close_expected')}: ${money(summary.expectedCash)}` : '',
      closedForDay ? `${t('cash_close_counted')}: ${money(closedForDay.countedAmount)}` : '',
      closedForDay ? `${t(closedForDay.difference >= 0 ? 'cash_close_surplus' : 'cash_close_shortfall')}: ${money(Math.abs(closedForDay.difference))}` : '',
    ].filter(Boolean);
    return lines.join('\n');
  }

  const hourly = Array.from({ length: 24 }, (_, hour) => summary?.hourly.find((h) => h.hour === hour)?.total ?? 0);
  const peak = Math.max(0, ...hourly);
  const bars = hourly.map((total, hour) => ({
    key: String(hour),
    label: total > 0 || hour % 3 === 0 ? `${hour}h` : '',
    aria: `${hour}:00 — ${money(total)}`,
    height: peak > 0 ? total / peak : 0,
    value: total > 0 ? money(total) : undefined,
    empty: total === 0,
  }));

  const rank = (entries: Array<{ name: string; total: number; count: number }>, idPrefix: string): CashCloseRankRow[] => entries.map((e) => ({ id: `${idPrefix}:${e.name}`, name: e.name, value: money(e.total), sub: times(e.count, t) }));

  const history: CashCloseHistoryRow[] = (closingsQuery.data ?? [])
    .slice()
    .sort((a, b) => (a.day < b.day ? 1 : -1))
    .map((row) => ({
      id: row.id,
      dayLabel: formatDay(row.day, language, { day: 'numeric', month: 'short' }),
      total: money(row.totalSales),
      difference: `${row.difference >= 0 ? '+' : ''}${money(row.difference)}`,
      status: row.status,
      href: `/cash-close?day=${row.day}`,
    }));

  return (
    <Screen header={<Header title={t('nav_cash_close')} />}>
      <CashCloseView
        t={t}
        currency={currency}
        dayLabel={dayLabel}
        isToday={isToday}
        todayHref="/cash-close"
        navigate={(href) => router.push(href as never)}
        state={loading ? 'loading' : isError ? 'error' : 'ready'}
        onRetry={() => void (closedForDay ? closingDetailQuery.refetch() : liveSummaryQuery.refetch())}
        kpis={[
          { id: 'sales', icon: 'coins', label: t('cash_close_kpi_sales'), value: summary ? money(summary.totalSales) : '—', loading },
          { id: 'expenses', icon: 'receipt', label: t('cash_close_kpi_expenses'), value: summary ? money(summary.totalExpenses) : '—', loading },
          { id: 'expected', icon: 'wallet', label: t('cash_close_kpi_expected'), value: summary?.expectedCash != null ? money(summary.expectedCash) : '—', loading },
        ]}
        bars={bars}
        paymentRows={(summary?.salesByMethod ?? []).map((m) => ({ id: m.method, name: t(`sale_pay_${m.method}`), value: money(m.total), sub: times(m.count, t) }))}
        topServices={rank(summary?.topServices ?? [], 'svc')}
        topProducts={rank(summary?.topProducts ?? [], 'prod')}
        employeeRows={rank(summary?.employeeSales.map((e) => ({ name: e.employeeName, total: e.total, count: e.count })) ?? [], 'emp')}
        expenseRows={(summary?.expenses ?? []).map((e) => ({ id: e.id, description: e.description, amount: money(e.amount), time: formatClock(localTime(e.createdAt, business.timezone), language) }))}
        clientsServed={summary?.clientsServed ?? 0}
        newClients={summary?.newClients ?? 0}
        appointments={summary?.appointments ?? { completed: 0, cancelled: 0, noShow: 0 }}
        closed={
          closedForDay
            ? {
                countedAmount: money(closedForDay.countedAmount),
                expectedAmount: money(closedForDay.expectedAmount),
                difference: `${closedForDay.difference >= 0 ? '+' : ''}${money(closedForDay.difference)}`,
                surplus: closedForDay.difference >= 0,
                note: closedForDay.note,
                closedByName: closedForDay.closedByName,
                status: closedForDay.status,
                voidReason: closedForDay.voidReason,
              }
            : null
        }
        isOwner={isOwner}
        canAct={isToday && !closedForDay && isOwner}
        expenseOpen={expenseOpen}
        onToggleExpense={() => setExpenseOpen((v) => !v)}
        expenseAmount={expenseAmount}
        onExpenseAmount={(raw) => setExpenseAmount(parseAmountInput(raw))}
        expenseDescription={expenseDescription}
        onExpenseDescription={setExpenseDescription}
        expenseMethod={expenseMethod}
        onExpenseMethod={setExpenseMethod}
        onAddExpense={() => void addExpense()}
        expenseBusy={expenseBusy}
        expenseError={expenseError}
        hasOpening={summary?.opening != null}
        countedAmount={countedAmount}
        onCountedAmount={(raw) => setCountedAmount(parseAmountInput(raw))}
        closeNote={closeNote}
        onCloseNote={setCloseNote}
        onSubmitClose={() => void submitClose()}
        closeBusy={closeBusy}
        closeError={closeError}
        expectedCashPreview={summary?.expectedCash ?? null}
        onOpenVoid={() => setVoidOpen(true)}
        onWhatsapp={() => window.open(whatsappLink('', shareText()), '_blank', 'noopener')}
        onPrint={() => window.print()}
        history={history}
      />
      <VoidCashClosingModal open={voidOpen} onClose={() => setVoidOpen(false)} t={t} onSubmit={confirmVoid} />
    </Screen>
  );
}
