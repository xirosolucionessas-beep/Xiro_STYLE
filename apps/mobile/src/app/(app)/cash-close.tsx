/**
 * "Cierre de caja" (Tarea 8), versión nativa: resumen del día (ventas por hora y por forma de pago, top
 * servicios/productos, comisiones, clientes y citas, gastos), cerrar con lo contado, anular con motivo, e historial.
 * Misma lógica/API que la web; solo el dueño la usa. Hermana de cash-close.web.tsx.
 */
import { Ionicons } from '@expo/vector-icons';
import { formatMoney, localDate, whatsappLink, type CashDaySummary, type Currency, type SalePaymentMethod } from '@xiro/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, View } from 'react-native';
import { addDays, formatClock, formatDay, localTime, todayIn } from '@/lib/agenda';
import { api, errorKey } from '@/lib/api';
import { breakdownView, liveStatus, liveStatusText } from '@/lib/cashBreakdown';
import { afterCloseNote, unbilledNote } from '@/lib/cashFlow';
import { apiErrors } from '@/lib/forms';
import { keys, useCashClosingDetail, useCashClosings, useCashCloseSummary, useInvalidateCash } from '@/lib/queries';
import { useAuthed } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { useLiveRefresh } from '@/lib/useLiveRefresh';
import { AnimatedHourlyBars, AnimatedShareBar } from '@/ui/AnimatedCharts';
import { CashBreakdownSection } from '@/ui/CashBreakdown';
import { CashExpensesDetailSheet, CashSalesDetailSheet } from '@/ui/CashCloseDetail';
import { useCashDetail, type CashDetailTarget } from '@/lib/useCashDetail';
import { Button } from '@/ui/Button';
import { Field } from '@/ui/Field';
import { Card, Chip, ChipRow, EmptyState, Row, SectionTitle } from '@/ui/Kit';
import { Header, Screen } from '@/ui/Screen';
import { AppText } from '@/ui/Text';
import { space } from '@/ui/theme';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const times = (n: number, t: (k: string, p?: Record<string, string | number>) => string) => (n === 1 ? t('sec_rep_time_one') : t('sec_rep_times', { n }));
const PAYMENT_METHODS: SalePaymentMethod[] = ['cash', 'card', 'nequi', 'bank_transfer', 'other'];

export default function CashCloseNative() {
  const router = useRouter();
  const { t, colors, language } = useSettings();
  const { user, business } = useAuthed();
  const isOwner = user.role === 'owner';
  const currency = business.currency as Currency;
  const fmt = (n: number) => formatMoney(n, currency);
  const invalidateCash = useInvalidateCash();

  const params = useLocalSearchParams<{ day?: string }>();
  const todayKey = todayIn(business.timezone);
  const day = params.day && DAY_RE.test(params.day) ? params.day : todayKey;
  const isToday = day === todayKey;
  const rangeFrom = addDays(todayKey, -30);

  // Actualización automática SOLO del día de hoy, con la pantalla enfocada y la app en primer plano (ver useLiveRefresh). Al
  // volver se pide una vez el resumen y la lista de cierres (por si se cerró desde otro dispositivo).
  const queryClient = useQueryClient();
  const resume = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: keys.cashCloseSummary });
    void queryClient.invalidateQueries({ queryKey: keys.cashClosings });
  }, [queryClient]);
  const live = useLiveRefresh(isToday && isOwner, resume);

  const closingsQuery = useCashClosings({ from: rangeFrom, to: todayKey }, isOwner);
  const closedForDay = (closingsQuery.data ?? []).find((c) => c.day === day && c.status === 'completed') ?? null;
  const closingDetailQuery = useCashClosingDetail(closedForDay?.id ?? null, Boolean(closedForDay) && isOwner, live.interval);
  const liveSummaryQuery = useCashCloseSummary(day, !closedForDay && isOwner, live.interval);
  const activeQuery = closedForDay ? closingDetailQuery : liveSummaryQuery;
  const summary: CashDaySummary | undefined = closedForDay ? closingDetailQuery.data?.summary : liveSummaryQuery.data;
  const loading = activeQuery.isLoading;
  const status = liveStatus({ live: isToday, active: live.active, hasData: summary !== undefined, isFetching: activeQuery.isFetching, isError: activeQuery.isError, dataUpdatedAt: activeQuery.dataUpdatedAt, now: live.now });
  const updatedTime = activeQuery.dataUpdatedAt ? formatClock(localTime(new Date(activeQuery.dataUpdatedAt).toISOString(), business.timezone), language) : '';
  const breakdown = summary?.employeeBreakdown ? breakdownView(t, fmt, summary.employeeBreakdown) : null;

  // "Ver más": la selección (empleado o sin atribuir) se conserva mientras el detalle se actualiza solo.
  const [detailTarget, setDetailTarget] = useState<CashDetailTarget | null>(null);
  const [expensesDetailOpen, setExpensesDetailOpen] = useState(false);
  const detail = useCashDetail({ day, target: detailTarget, expensesOpen: expensesDetailOpen, interval: live.interval, f: { t, fmt, timezone: business.timezone, language }, adjustments: summary?.adjustmentsAfterClose ?? [] });
  const clockOf = (at: number) => (at ? formatClock(localTime(new Date(at).toISOString(), business.timezone), language) : null);
  const detailAggregate = detailTarget?.scope === 'employee' ? breakdown?.employees.find((e) => e.id === detailTarget.employeeId) : detailTarget ? breakdown?.unattributed : null;
  const canAct = isToday && !closedForDay && isOwner;

  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [voidBusy, setVoidBusy] = useState(false);
  const [voidError, setVoidError] = useState<string>();

  const [countedAmount, setCountedAmount] = useState('');
  const [closeNote, setCloseNote] = useState('');
  const [closeBusy, setCloseBusy] = useState(false);
  const [closeError, setCloseError] = useState<string>();

  const [expenseOpen, setExpenseOpen] = useState(false);
  const [expenseDescription, setExpenseDescription] = useState('');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseMethod, setExpenseMethod] = useState<SalePaymentMethod>('cash');
  const [expenseBusy, setExpenseBusy] = useState(false);
  const [expenseError, setExpenseError] = useState<string>();

  async function submitClose() {
    setCloseError(undefined);
    const amount = Number.parseInt(countedAmount || '0', 10);
    if (amount <= 0) return setCloseError(t('cash_close_error_amount'));
    setCloseBusy(true);
    try {
      await api.closeCash({ day, countedAmount: amount, note: closeNote });
      await invalidateCash();
      setCountedAmount('');
      setCloseNote('');
    } catch (error) {
      setCloseError(apiErrors(error, t).general ?? t('unknown_error'));
    } finally {
      setCloseBusy(false);
    }
  }

  async function addExpense() {
    if (!expenseDescription.trim()) return setExpenseError(t('required'));
    const amount = Number.parseInt(expenseAmount || '0', 10);
    if (amount <= 0) return setExpenseError(t('cash_close_expense_amount'));
    setExpenseError(undefined);
    setExpenseBusy(true);
    try {
      await api.createExpense({ amount, description: expenseDescription.trim(), method: expenseMethod });
      await invalidateCash();
      setExpenseDescription('');
      setExpenseAmount('');
      setExpenseOpen(false);
    } catch (error) {
      setExpenseError(apiErrors(error, t).general ?? t('unknown_error'));
    } finally {
      setExpenseBusy(false);
    }
  }

  async function confirmVoid() {
    if (!closedForDay) return;
    if (!voidReason.trim()) return setVoidError(t('cash_close_void_reason_required'));
    setVoidBusy(true);
    setVoidError(undefined);
    try {
      await api.voidCashClosing(closedForDay.id, voidReason.trim());
      await invalidateCash();
      setVoidOpen(false);
      setVoidReason('');
    } catch (error) {
      setVoidError(apiErrors(error, t).general ?? t('unknown_error'));
    } finally {
      setVoidBusy(false);
    }
  }

  const dayLabel = formatDay(day, language, { weekday: 'long', day: 'numeric', month: 'long' });

  function sendWhatsapp() {
    if (!summary) return;
    const lines = [
      `${business.name} — ${t('nav_cash_close')}: ${dayLabel}`,
      `${t('cash_close_kpi_sales')}: ${fmt(summary.totalSales)}`,
      `${t('cash_close_kpi_expenses')}: ${fmt(summary.totalExpenses)}`,
      closedForDay ? `${t('cash_close_expected')}: ${fmt(closedForDay.expectedAmount)}` : summary.expectedCash !== null ? `${t('cash_close_expected')}: ${fmt(summary.expectedCash)}` : '',
      closedForDay ? `${t('cash_close_counted')}: ${fmt(closedForDay.countedAmount)}` : '',
      closedForDay ? `${t(closedForDay.difference >= 0 ? 'cash_close_surplus' : 'cash_close_shortfall')}: ${fmt(Math.abs(closedForDay.difference))}` : '',
    ].filter(Boolean);
    void Linking.openURL(whatsappLink('', lines.join('\n')));
  }

  if (!isOwner) {
    return (
      <Screen header={<Header title={t('nav_cash_close')} />}>
        <EmptyState icon="lock-closed-outline" message={t('forbidden')} />
      </Screen>
    );
  }

  const hourly = Array.from({ length: 24 }, (_, hour) => summary?.hourly.find((h) => h.hour === hour)?.total ?? 0);
  const peak = Math.max(0, ...hourly);

  return (
    <Screen
      refreshing={closedForDay ? closingDetailQuery.isRefetching : liveSummaryQuery.isRefetching}
      onRefresh={() => void (closedForDay ? closingDetailQuery.refetch() : liveSummaryQuery.refetch())}
      header={<Header title={t('nav_cash_close')} />}
      footer={
        canAct ? (
          summary?.opening != null ? (
            <Button label={t('cash_close_submit_cta')} onPress={() => void submitClose()} loading={closeBusy} />
          ) : (
            <AppText tone="muted" variant="small" center>
              {t('cash_close_no_opening')}
            </AppText>
          )
        ) : undefined
      }>
      <View style={styles.headRow}>
        <AppText variant="heading" style={{ flex: 1 }}>
          {dayLabel}
        </AppText>
        {!isToday ? <Button label={t('cash_close_go_today')} variant="secondary" compact onPress={() => router.setParams({ day: undefined })} /> : null}
      </View>

      {loading ? <ActivityIndicator color={colors.gold} style={{ marginTop: 32 }} /> : null}

      {/* Estado de la actualización: cuándo se actualizó, si está actualizando, en pausa o con error (con reintento). */}
      {status !== 'initial' ? (
        <View style={styles.liveRow} accessibilityLiveRegion="polite">
          <AppText variant="small" tone={status === 'error' || status === 'failed' || status === 'stale' ? 'danger' : 'muted'} style={{ flex: 1 }}>
            {liveStatusText(t, status, updatedTime)}
          </AppText>
          {status === 'error' || status === 'failed' || status === 'stale' ? <Button label={t('retry')} variant="secondary" compact onPress={() => void activeQuery.refetch()} /> : null}
        </View>
      ) : null}

      {!loading && closedForDay ? (
        <Card style={{ marginBottom: space.md }}>
          <AppText tone={closedForDay.status === 'voided' ? 'danger' : 'success'} variant="bodyStrong" style={{ marginBottom: space.sm }}>
            {t(closedForDay.status === 'voided' ? 'cash_close_status_voided' : 'cash_close_status_completed')}
          </AppText>
          <View style={styles.summaryRow}>
            <AppText tone="muted">{t('cash_close_expected')}</AppText>
            <AppText>{fmt(closedForDay.expectedAmount)}</AppText>
          </View>
          <View style={styles.summaryRow}>
            <AppText tone="muted">{t('cash_close_counted')}</AppText>
            <AppText>{fmt(closedForDay.countedAmount)}</AppText>
          </View>
          <View style={styles.summaryRow}>
            <AppText tone={closedForDay.difference >= 0 ? 'success' : 'danger'} variant="bodyStrong">
              {t(closedForDay.difference >= 0 ? 'cash_close_surplus' : 'cash_close_shortfall')}
            </AppText>
            <AppText tone={closedForDay.difference >= 0 ? 'success' : 'danger'} variant="bodyStrong">
              {fmt(Math.abs(closedForDay.difference))}
            </AppText>
          </View>
          {closedForDay.note ? (
            <AppText variant="small" tone="muted" style={{ marginTop: space.sm }}>
              {closedForDay.note}
            </AppText>
          ) : null}
          {/* Ventas o ajustes hechos DESPUÉS de firmar: el cierre no cambia, pero se explica la diferencia con el resumen. */}
          {afterCloseNote(summary?.afterClose ?? null, fmt, t) ? (
            <AppText variant="small" tone="gold" accessibilityRole="text" style={{ marginTop: space.sm }}>
              {afterCloseNote(summary?.afterClose ?? null, fmt, t)}
            </AppText>
          ) : null}
          <AppText variant="small" tone="muted">
            {t('cash_close_closed_by_at', { name: closedForDay.closedByName, date: formatDay(localDate(closedForDay.createdAt, business.timezone), language, { day: 'numeric', month: 'short' }), time: formatClock(localTime(closedForDay.createdAt, business.timezone), language) })}
          </AppText>
          <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>
            <Button label={t('cash_close_whatsapp')} icon="logo-whatsapp" variant="secondary" compact onPress={sendWhatsapp} style={{ flex: 1 }} />
            {closedForDay.status === 'completed' ? <Button label={t('cash_close_void_action')} variant="danger" compact onPress={() => setVoidOpen((v) => !v)} style={{ flex: 1 }} /> : null}
          </View>
          {voidOpen ? (
            <View style={{ marginTop: space.md }}>
              <Field label={t('cash_close_void_reason')} value={voidReason} onChangeText={setVoidReason} />
              {voidError ? <AppText tone="danger" variant="small" style={{ marginBottom: space.sm }}>{voidError}</AppText> : null}
              <Button label={t('cash_close_void_confirm')} variant="danger" compact loading={voidBusy} onPress={() => void confirmVoid()} />
            </View>
          ) : null}
        </Card>
      ) : null}

      {!loading && status !== 'failed' ? (
        <>
          <View style={{ flexDirection: 'row', gap: space.sm, marginBottom: space.md }}>
            <Card style={{ flex: 1 }}>
              <AppText variant="small" tone="muted">{t('cash_close_kpi_sales')}</AppText>
              <AppText variant="heading" tone="gold">{summary ? fmt(summary.totalSales) : '—'}</AppText>
            </Card>
            <Card style={{ flex: 1 }}>
              <AppText variant="small" tone="muted">{t('cash_close_kpi_expenses')}</AppText>
              <AppText variant="heading" tone="gold">{summary ? fmt(summary.totalExpenses) : '—'}</AppText>
            </Card>
          </View>
          <Card style={{ marginBottom: space.md }}>
            <AppText variant="small" tone="muted">{t('cash_close_kpi_expected')}</AppText>
            <AppText variant="heading" tone="gold">{summary?.expectedCash != null ? fmt(summary.expectedCash) : '—'}</AppText>
          </Card>
          {/* Citas completadas y servicios registrados a mano: ingreso del Balance, pero sin método de pago (no entran al arqueo). */}
          {unbilledNote(summary?.unbilledRecords, fmt, t) ? (
            <AppText variant="small" tone="gold" style={{ marginBottom: space.md }}>
              {unbilledNote(summary?.unbilledRecords, fmt, t)}
            </AppText>
          ) : null}

          <SectionTitle>{t('cash_close_hourly_chart')}</SectionTitle>
          {peak === 0 ? (
            <AppText tone="muted" variant="small" style={{ marginBottom: space.md }}>
              {t('cash_close_no_sales')}
            </AppText>
          ) : (
            <AnimatedHourlyBars values={hourly} label={t('cash_close_hourly_chart')} />
          )}

          {(summary?.salesByMethod ?? []).length > 0 ? (
            <>
              <SectionTitle>{t('cash_close_by_method')}</SectionTitle>
              {summary!.salesByMethod.map((m, index) => (
                <View key={m.method}>
                  <Row label={t(`sale_pay_${m.method}`)} value={times(m.count, t)} right={<AppText variant="bodyStrong">{fmt(m.total)}</AppText>} />
                  <AnimatedShareBar share={summary!.totalSales > 0 ? m.total / summary!.salesByMethod.reduce((sum, x) => sum + x.total, 0) : 0} delay={index * 90} />
                </View>
              ))}
            </>
          ) : null}

          {(summary?.topServices ?? []).length > 0 ? (
            <>
              <SectionTitle>{t('cash_close_top_services')}</SectionTitle>
              {summary!.topServices.map((e) => (
                <Row key={e.name} label={e.name} value={times(e.count, t)} right={<AppText variant="bodyStrong">{fmt(e.total)}</AppText>} />
              ))}
            </>
          ) : null}

          {(summary?.topProducts ?? []).length > 0 ? (
            <>
              <SectionTitle>{t('cash_close_top_products')}</SectionTitle>
              {summary!.topProducts.map((e) => (
                <Row key={e.name} label={e.name} value={times(e.count, t)} right={<AppText variant="bodyStrong">{fmt(e.total)}</AppText>} />
              ))}
            </>
          ) : null}

          {breakdown ? <CashBreakdownSection t={t} view={breakdown} onSeeMore={setDetailTarget} /> : null}

          {!breakdown && (summary?.employeeSales ?? []).length > 0 ? (
            <>
              <SectionTitle>{t('cash_close_employees')}</SectionTitle>
              {summary!.employeeSales.map((e) => (
                <Row key={e.employeeId} label={e.employeeName} value={times(e.count, t)} right={<AppText variant="bodyStrong">{fmt(e.total)}</AppText>} />
              ))}
            </>
          ) : null}

          <SectionTitle>{t('cash_close_clients')}</SectionTitle>
          <Card style={{ marginBottom: space.md }}>
            <View style={styles.summaryRow}><AppText tone="muted">{t('cash_close_clients_served')}</AppText><AppText>{summary?.clientsServed ?? 0}</AppText></View>
            <View style={styles.summaryRow}><AppText tone="muted">{t('cash_close_clients_new')}</AppText><AppText>{summary?.newClients ?? 0}</AppText></View>
            <View style={styles.summaryRow}><AppText tone="muted">{t('cash_close_appts_completed')}</AppText><AppText>{summary?.appointments.completed ?? 0}</AppText></View>
            <View style={styles.summaryRow}><AppText tone="muted">{t('cash_close_appts_cancelled')}</AppText><AppText>{summary?.appointments.cancelled ?? 0}</AppText></View>
            <View style={styles.summaryRow}><AppText tone="muted">{t('cash_close_appts_no_show')}</AppText><AppText>{summary?.appointments.noShow ?? 0}</AppText></View>
          </Card>

          <SectionTitle>{t('cash_close_expenses_title')}</SectionTitle>
          <Button label={t('cash_detail_see_more')} accessibilityLabel={t('cash_detail_see_more_expenses')} variant="secondary" compact onPress={() => setExpensesDetailOpen(true)} style={{ alignSelf: 'flex-start', marginBottom: space.sm }} />
          {(summary?.expenses ?? []).length === 0 ? (
            <AppText tone="muted" variant="small" style={{ marginBottom: space.sm }}>
              {t('cash_close_no_expenses')}
            </AppText>
          ) : (
            summary!.expenses.map((e) => <Row key={e.id} label={e.description} value={formatClock(localTime(e.createdAt, business.timezone), language)} right={<AppText variant="bodyStrong">{fmt(e.amount)}</AppText>} />)
          )}
          {canAct ? (
            <>
              <Pressable accessibilityRole="button" onPress={() => setExpenseOpen((v) => !v)} style={{ marginVertical: space.sm }}>
                <AppText tone="gold" variant="bodyStrong">
                  {t('cash_close_add_expense')}
                </AppText>
              </Pressable>
              {expenseOpen ? (
                <Card style={{ marginBottom: space.md }}>
                  <Field label={t('cash_close_expense_description')} value={expenseDescription} onChangeText={setExpenseDescription} />
                  <Field label={t('cash_close_expense_amount')} value={expenseAmount} onChangeText={(v) => setExpenseAmount(v.replace(/\D/g, ''))} keyboardType="number-pad" prefix="$" />
                  <ChipRow label={t('sale_pay_title')}>
                    {PAYMENT_METHODS.map((m) => (
                      <Chip key={m} label={t(`sale_pay_${m}`)} selected={expenseMethod === m} onPress={() => setExpenseMethod(m)} />
                    ))}
                  </ChipRow>
                  {expenseError ? <AppText tone="danger" variant="small" style={{ marginBottom: space.sm }}>{expenseError}</AppText> : null}
                  <Button label={t('cash_close_add_expense_cta')} compact loading={expenseBusy} onPress={() => void addExpense()} />
                </Card>
              ) : null}
            </>
          ) : null}

          {canAct && summary?.opening != null ? (
            <>
              <SectionTitle>{t('cash_close_close_title')}</SectionTitle>
              <AppText variant="small" tone="muted" style={{ marginBottom: space.sm }}>
                {t('cash_close_expected_preview', { amount: summary.expectedCash !== null ? fmt(summary.expectedCash) : '—' })}
              </AppText>
              <Field label={t('cash_close_counted_label')} value={countedAmount} onChangeText={(v) => setCountedAmount(v.replace(/\D/g, ''))} keyboardType="number-pad" prefix="$" />
              <Field label={t('cash_close_note_label')} value={closeNote} onChangeText={setCloseNote} />
              {closeError ? <AppText tone="danger" variant="small" style={{ marginBottom: space.sm }}>{closeError}</AppText> : null}
            </>
          ) : null}

          {(closingsQuery.data ?? []).length > 0 ? (
            <>
              <SectionTitle>{t('cash_close_history_title')}</SectionTitle>
              {closingsQuery.data!
                .slice()
                .sort((a, b) => (a.day < b.day ? 1 : -1))
                .map((row) => (
                  <Row
                    key={row.id}
                    label={formatDay(row.day, language, { day: 'numeric', month: 'short' })}
                    value={`${row.difference >= 0 ? '+' : ''}${fmt(row.difference)}${row.status === 'voided' ? ` · ${t('cash_close_status_voided')}` : ''}`}
                    right={<AppText variant="bodyStrong">{fmt(row.totalSales)}</AppText>}
                    onPress={() => router.setParams({ day: row.day })}
                  />
                ))}
            </>
          ) : null}
        </>
      ) : null}
      <CashSalesDetailSheet
        open={detailTarget !== null}
        onClose={() => setDetailTarget(null)}
        t={t}
        title={detailTarget?.scope === 'employee' ? t('cash_detail_title_employee', { name: detailTarget.name, day: dayLabel }) : t('cash_detail_title_unattributed', { day: dayLabel })}
        note={detailTarget?.scope === 'unattributed' ? t('cash_detail_unattributed_note') : null}
        aggregate={detailAggregate ? { gross: detailAggregate.gross, discount: detailAggregate.discount, net: detailAggregate.net } : null}
        updated={clockOf(detail.sales.updatedAt)}
        model={detail.sales}
      />
      <CashExpensesDetailSheet open={expensesDetailOpen} onClose={() => setExpensesDetailOpen(false)} t={t} title={t('cash_exp_title', { day: dayLabel })} updated={clockOf(detail.expenses.updatedAt)} model={detail.expenses} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  headRow: { flexDirection: 'row', alignItems: 'center', marginBottom: space.md },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: space.xs },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.md },
  chart: { flexDirection: 'row', alignItems: 'flex-end', height: 72, marginBottom: space.md, gap: 2 },
  chartBarWrap: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: 64 },
  chartBar: { width: '70%', borderRadius: 3, minHeight: 1 },
});
