/**
 * Gastos (módulo Finanzas): operativos y nómina, con filtros, alta, edición y anulación. Una sola pantalla para Android, iOS y
 * la web (como Pedidos). Solo el dueño o quien tenga el permiso "Finanzas" llega aquí (access.ts redirige al resto y la API
 * responde 403 de todos modos). Integración con Caja: "pagado desde caja" exige la caja del día abierta (si no, se ofrece
 * registrarlo sin caja) y un gasto de una caja ya cerrada solo se corrige o anula con un ajuste con motivo.
 */
import { Ionicons } from '@expo/vector-icons';
import {
  EXPENSE_CATEGORIES,
  expenseAmountIssue,
  formatMoney,
  SALE_PAYMENT_METHODS,
  type Currency,
  type ExpenseCategory,
  type ExpenseDto,
  type ExpenseType,
  type ExpenseUpdateInput,
  type SalePaymentMethod,
} from '@xiro/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';
import { addDays, formatDay, todayIn, upperFirst } from '@/lib/agenda';
import { EXPENSE_PERIODS as PERIODS, periodRange, type ExpensePeriod as Period } from '@/lib/expenses';
import { api, ApiError, errorKey } from '@/lib/api';
import { apiErrors } from '@/lib/forms';
import { useExpensePages, useExpensePayees, useInvalidateCash } from '@/lib/queries';
import { useAuthed } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { CalendarPicker } from '@/ui/agenda/CalendarPicker';
import { Button } from '@/ui/Button';
import { useDialogs } from '@/ui/Dialogs';
import { Field } from '@/ui/Field';
import { FilterSelect, type FilterSelectOption } from '@/ui/FilterSelect';
import { FormModal } from '@/ui/FormModal';
import { Card, Chip, ChipRow, EmptyState, ToggleRow } from '@/ui/Kit';
import { DownloadButton } from '@/ui/reports/DownloadButton';
import { Header, Screen } from '@/ui/Screen';
import { AppText } from '@/ui/Text';
import { radius, space } from '@/ui/theme';

const digits = (text: string) => text.replace(/\D/g, '').slice(0, 10);

export default function Expenses() {
  const { t, colors, language } = useSettings();
  const { business } = useAuthed();
  const router = useRouter();
  const params = useLocalSearchParams<{ new?: string }>();
  const currency = business.currency as Currency;
  const today = todayIn(business.timezone);
  const [period, setPeriod] = useState<Period>('this_month');
  const [customFrom, setCustomFrom] = useState(today);
  const [customTo, setCustomTo] = useState(today);
  const [showCustomFrom, setShowCustomFrom] = useState(false);
  const [showCustomTo, setShowCustomTo] = useState(false);
  const [type, setType] = useState<ExpenseType | 'all'>('all');
  const [category, setCategory] = useState<ExpenseCategory | 'all'>('all');
  const [employeeId, setEmployeeId] = useState<string | 'all'>('all');
  const [showVoided, setShowVoided] = useState(false);
  const [editing, setEditing] = useState<ExpenseDto | 'new' | null>(null);
  const [voiding, setVoiding] = useState<ExpenseDto | null>(null);
  const range = periodRange(period, today, { from: customFrom, to: customTo > customFrom ? customTo : customFrom });
  const query = {
    ...range,
    ...(type !== 'all' ? { type } : {}),
    ...(category !== 'all' ? { category } : {}),
    ...(employeeId !== 'all' ? { employeeId } : {}),
    status: showVoided ? ('all' as const) : ('active' as const),
  };
  // Por páginas: el total y la cantidad salen del servidor sobre TODO el rango (antes se sumaba lo cargado, hasta 1.000).
  const list = useExpensePages(query);
  const payees = useExpensePayees();

  // Acceso rápido "Registrar gasto" del Inicio: abre el formulario directamente (y limpia el parámetro).
  useEffect(() => {
    if (params.new) {
      setEditing('new');
      router.setParams({ new: undefined });
    }
  }, [params.new, router]);

  const rows = useMemo(() => list.data?.pages.flatMap((p) => p.data) ?? [], [list.data]);
  const totals = list.data?.pages[0]?.summary ?? null;
  const total = totals?.activeTotal ?? 0;
  const activeCount = totals?.activeCount ?? 0;
  const categories: ExpenseCategory[] = type === 'all' ? [...EXPENSE_CATEGORIES.operating, ...EXPENSE_CATEGORIES.payroll] : [...EXPENSE_CATEGORIES[type]];

  const periodOptions: FilterSelectOption<Period>[] = PERIODS.map((p) => ({ value: p, label: t(`exp_period_${p}`) }));
  const typeOptions: FilterSelectOption<ExpenseType | 'all'>[] = (['all', 'operating', 'payroll'] as const).map((value) => ({ value, label: t(`exp_type_${value}`) }));
  const categoryOptions: FilterSelectOption<ExpenseCategory | 'all'>[] = [{ value: 'all' as const, label: t('exp_type_all') }, ...categories.map((c) => ({ value: c, label: t(`exp_cat_${c}`) }))];
  const employeeOptions: FilterSelectOption<string>[] = [{ value: 'all', label: t('exp_type_all') }, ...(payees.data ?? []).map((p) => ({ value: p.id, label: p.active ? p.name : `${p.name} (${t('exp_employee_inactive')})` }))];

  const renderExpense = ({ item: expense }: { item: ExpenseDto }) => {
    const voided = expense.status === 'voided';
    return (
      <Card style={[styles.card, voided && { opacity: 0.6 }]}>
        <View style={styles.row}>
          <View style={styles.flex}>
            <AppText variant="bodyStrong" numberOfLines={2} style={voided ? { textDecorationLine: 'line-through' } : undefined}>
              {expense.description}
            </AppText>
            <AppText variant="small" tone="muted">
              {[t(`exp_type_${expense.type}`), t(`exp_cat_${expense.category}`), upperFirst(formatDay(expense.expenseDate, language, { day: 'numeric', month: 'short' })), t(`sale_pay_${expense.method}`)].join(' · ')}
            </AppText>
            {expense.employeeName ? (
              <AppText variant="small" tone="muted">
                <Ionicons name="person-outline" size={12} color={colors.textMuted} /> {expense.employeeName}
              </AppText>
            ) : null}
          </View>
          <AppText variant="bodyStrong" tone={voided ? 'muted' : 'text'}>
            {formatMoney(expense.amount, currency)}
          </AppText>
        </View>
        <View style={styles.badges}>
          {expense.paidFromCash ? <Badge label={t('exp_badge_cash')} color={colors.gold} /> : null}
          {expense.cashDayClosed && expense.paidFromCash ? <Badge label={t('exp_badge_closed')} color={colors.textMuted} /> : null}
          {voided ? <Badge label={t('exp_badge_voided')} color={colors.danger} /> : null}
        </View>
        {voided && expense.voidReason ? (
          <AppText variant="small" tone="muted">
            {t('exp_voided_by', { name: expense.voidedByName ?? '', reason: expense.voidReason })}
          </AppText>
        ) : null}
        {!voided ? (
          <View style={styles.actions}>
            <Button label={t('exp_edit_short')} icon="create-outline" variant="secondary" compact onPress={() => setEditing(expense)} />
            <Button label={t('exp_void')} variant="secondary" compact onPress={() => setVoiding(expense)} />
          </View>
        ) : null}
      </Card>
    );
  };

  return (
    <Screen scroll={false} header={<Header title={t('nav_expenses')} subtitle={t('exp_subtitle')} right={<Button label={t('exp_new')} icon="add" compact onPress={() => setEditing('new')} />} />}>
      <FlatList
        data={rows}
        keyExtractor={(e) => e.id}
        renderItem={renderExpense}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.filters}>
            {/* Tres selectores compactos (en vez de una fila de chip por cada una de las ~20 opciones combinadas):
                en pantallas anchas caben en una sola fila (flexWrap los acomoda en varias si no caben). */}
            <View style={styles.filterRow}>
              <FilterSelect
                label={t('exp_period')}
                value={period}
                options={periodOptions}
                onChange={(p) => {
                  setPeriod(p);
                  if (p === 'custom') {
                    setCustomFrom(today);
                    setCustomTo(today);
                  }
                }}
              />
              <FilterSelect
                label={t('exp_type')}
                value={type}
                options={typeOptions}
                onChange={(value) => {
                  setType(value);
                  setCategory('all');
                  if (value !== 'payroll') setEmployeeId('all');
                }}
              />
              <FilterSelect label={t('exp_category')} value={category} options={categoryOptions} onChange={setCategory} />
              {type === 'payroll' && (payees.data ?? []).length > 0 ? <FilterSelect label={t('exp_employee')} value={employeeId} options={employeeOptions} onChange={setEmployeeId} /> : null}
            </View>
            {period === 'custom' ? (
              <View style={styles.filterRow}>
                <View style={{ flexGrow: 1, flexBasis: 150 }}>
                  <AppText variant="label" tone="muted" style={{ marginBottom: 4 }}>
                    {t('exp_date_from')}
                  </AppText>
                  <Chip label={upperFirst(formatDay(customFrom, language, { day: 'numeric', month: 'short', year: 'numeric' }))} selected={showCustomFrom} onPress={() => setShowCustomFrom((v) => !v)} />
                  {showCustomFrom ? (
                    <CalendarPicker
                      value={customFrom}
                      onChange={(d) => {
                        setCustomFrom(d);
                        setShowCustomFrom(false);
                      }}
                      today={today}
                      allowPast
                      maxDate={today}
                    />
                  ) : null}
                </View>
                <View style={{ flexGrow: 1, flexBasis: 150 }}>
                  <AppText variant="label" tone="muted" style={{ marginBottom: 4 }}>
                    {t('exp_date_to')}
                  </AppText>
                  <Chip label={upperFirst(formatDay(customTo, language, { day: 'numeric', month: 'short', year: 'numeric' }))} selected={showCustomTo} onPress={() => setShowCustomTo((v) => !v)} />
                  {showCustomTo ? (
                    <CalendarPicker
                      value={customTo}
                      onChange={(d) => {
                        setCustomTo(d);
                        setShowCustomTo(false);
                      }}
                      today={today}
                      allowPast
                      maxDate={today}
                    />
                  ) : null}
                </View>
              </View>
            ) : null}
            <ToggleRow label={t('exp_show_voided')} value={showVoided} onChange={setShowVoided} />
            <Card style={styles.summary}>
              <AppText variant="small" tone="muted">
                {t('exp_total')} · {upperFirst(formatDay(range.from, language, { day: 'numeric', month: 'short' }))} – {formatDay(range.to, language, { day: 'numeric', month: 'short' })}
              </AppText>
              <AppText variant="title" tone="gold">
                {formatMoney(total, currency)}
              </AppText>
              <AppText variant="small" tone="muted">
                {activeCount === 1 ? t('exp_count_one') : t('exp_count', { count: activeCount })}
              </AppText>
              {/* La lista en Excel, con los mismos filtros de arriba (generada en el servidor; máximo 12 meses). */}
              <View style={styles.download}>
                <DownloadButton
                  kind="xlsx"
                  label={t('exp_download_xlsx')}
                  fileName={`gastos-${business.slug}-${range.from}_${range.to}.xlsx`}
                  fetchFile={() => api.expensesExport({ ...query, lang: language })}
                />
              </View>
            </Card>
            {list.isLoading ? <ActivityIndicator style={{ marginTop: space.lg }} accessibilityLabel={t('loading')} /> : null}
            {list.isError ? (
              <View style={{ gap: 8 }}>
                <AppText tone="danger">{t(errorKey(list.error))}</AppText>
                <Button label={t('retry')} variant="secondary" compact onPress={() => void list.refetch()} style={{ alignSelf: 'flex-start' }} />
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={!list.isLoading && !list.isError ? <EmptyState icon="wallet-outline" message={t('exp_empty')} /> : null}
        ListFooterComponent={
          rows.length > 0 && totals && (list.hasNextPage || totals.count > rows.length) ? (
            <View style={styles.more}>
              <AppText variant="small" tone="muted">
                {t('exp_showing', { shown: rows.length, count: totals.count })}
              </AppText>
              {list.hasNextPage ? <Button label={t('exp_load_more')} icon="chevron-down" variant="secondary" compact loading={list.isFetchingNextPage} onPress={() => void list.fetchNextPage()} /> : null}
            </View>
          ) : null
        }
      />
      {editing ? <ExpenseForm expense={editing === 'new' ? null : editing} today={today} onClose={() => setEditing(null)} /> : null}
      {voiding ? <VoidForm expense={voiding} onClose={() => setVoiding(null)} /> : null}
    </Screen>
  );
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <AppText variant="small" style={{ color, fontWeight: '700' }}>
        {label}
      </AppText>
    </View>
  );
}

/** Alta o edición. Maneja los dos casos de Caja: sin caja abierta (registrar sin caja) y caja cerrada (ajuste con motivo). */
function ExpenseForm({ expense, today, onClose }: { expense: ExpenseDto | null; today: string; onClose: () => void }) {
  const { t, language } = useSettings();
  const { business } = useAuthed();
  const { toast } = useDialogs();
  const invalidate = useInvalidateCash();
  const payees = useExpensePayees();
  const [type, setType] = useState<ExpenseType>(expense?.type ?? 'operating');
  const [category, setCategory] = useState<ExpenseCategory>(expense?.category ?? 'other');
  const [amount, setAmount] = useState(expense ? String(expense.amount) : '');
  const [description, setDescription] = useState(expense?.description ?? '');
  const [method, setMethod] = useState<SalePaymentMethod>(expense?.method ?? 'cash');
  const [expenseDate, setExpenseDate] = useState(expense?.expenseDate ?? today);
  const [employeeId, setEmployeeId] = useState<string | null>(expense?.employeeId ?? null);
  const [notes, setNotes] = useState(expense?.notes ?? '');
  const [paidFromCash, setPaidFromCash] = useState(expense ? expense.paidFromCash : true);
  const [adjustmentReason, setAdjustmentReason] = useState('');
  const [needsAdjustment, setNeedsAdjustment] = useState(false);
  const [noCash, setNoCash] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [fields, setFields] = useState<Record<string, string>>({});
  const [showCalendar, setShowCalendar] = useState(false);

  const fromCash = method === 'cash' && paidFromCash;

  async function save(overrides: { paidFromCash?: boolean } = {}) {
    setBusy(true);
    setError(undefined);
    setFields({});
    const body: ExpenseUpdateInput = {
      amount: Number(amount || 0),
      description,
      method,
      type,
      category,
      expenseDate,
      employeeId: type === 'payroll' ? employeeId : null,
      notes,
      paidFromCash: overrides.paidFromCash ?? fromCash,
      ...(needsAdjustment ? { adjustmentReason } : {}),
    };
    try {
      if (expense) await api.updateExpense(expense.id, body);
      else await api.createExpense(body);
      await invalidate();
      toast(t('exp_saved'));
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'cash_not_open') {
        setNoCash(true);
      } else if (e instanceof ApiError && e.code === 'expense_day_closed' && e.extra.adjustable === true) {
        setNeedsAdjustment(true);
      } else {
        const result = apiErrors(e, t);
        setFields(result.fields);
        setError(result.general ?? (Object.keys(result.fields).length > 0 ? t('appt_err_fix') : undefined));
      }
    } finally {
      setBusy(false);
    }
  }

  const categories = EXPENSE_CATEGORIES[type];
  return (
    <FormModal
      title={expense ? t('exp_edit') : t('exp_new')}
      onClose={onClose}
      footer={<Button label={t('exp_save')} loading={busy} disabled={!amount || expenseAmountIssue(amount) !== null || !description.trim() || (needsAdjustment && adjustmentReason.trim().length < 3)} onPress={() => void save()} />}>
      <AppText variant="label" tone="muted" style={styles.label}>
        {t('exp_type')}
      </AppText>
      <ChipRow label={t('exp_type')}>
        {(['operating', 'payroll'] as const).map((value) => (
          <Chip
            key={value}
            label={t(`exp_type_${value}`)}
            selected={type === value}
            onPress={() => {
              setType(value);
              setCategory(EXPENSE_CATEGORIES[value][0]);
            }}
          />
        ))}
      </ChipRow>
      <AppText variant="label" tone="muted" style={styles.label}>
        {t('exp_category')}
      </AppText>
      <ChipRow label={t('exp_category')}>
        {categories.map((c) => (
          <Chip key={c} label={t(`exp_cat_${c}`)} selected={category === c} onPress={() => setCategory(c)} />
        ))}
      </ChipRow>
      {type === 'payroll' ? (
        <>
          <AppText variant="label" tone="muted" style={styles.label}>
            {t('exp_employee')}
          </AppText>
          <ChipRow label={t('exp_employee')}>
            {/* Inactivos también (liquidaciones, pagos pendientes: decisión del producto), después de los activos y marcados. */}
            {[...(payees.data ?? [])].sort((x, y) => Number(y.active) - Number(x.active)).map((p) => (
              <Chip key={p.id} label={p.active ? p.name : `${p.name} (${t('exp_employee_inactive')})`} selected={employeeId === p.id} onPress={() => setEmployeeId(p.id)} />
            ))}
          </ChipRow>
          {fields.employeeId ? <AppText tone="danger">{fields.employeeId}</AppText> : null}
        </>
      ) : null}
      <Field
        label={t('exp_amount')}
        value={amount}
        onChangeText={(v) => setAmount(digits(v))}
        keyboardType="number-pad"
        prefix="$"
        error={fields.amount ?? (amount && expenseAmountIssue(amount) ? t(expenseAmountIssue(amount)!) : undefined)}
        hint={amount ? formatMoney(Number(amount), business.currency as Currency) : t('exp_amount_hint')}
      />
      <Field label={t('exp_concept')} value={description} onChangeText={setDescription} maxLength={200} placeholder={t('exp_concept_placeholder')} error={fields.description} />
      <AppText variant="label" tone="muted" style={styles.label}>
        {t('exp_method')}
      </AppText>
      <ChipRow label={t('exp_method')}>
        {SALE_PAYMENT_METHODS.map((m) => (
          <Chip key={m} label={t(`sale_pay_${m}`)} selected={method === m} onPress={() => setMethod(m)} />
        ))}
      </ChipRow>
      {method === 'cash' ? (
        <View>
          <ToggleRow label={t('exp_paid_from_cash')} value={paidFromCash} onChange={setPaidFromCash} />
          <AppText variant="small" tone="muted">
            {t('exp_paid_from_cash_hint')}
          </AppText>
        </View>
      ) : null}
      <AppText variant="label" tone="muted" style={styles.label}>
        {t('exp_date')}
      </AppText>
      <ChipRow label={t('exp_date')}>
        <Chip label={upperFirst(formatDay(today, language, { weekday: 'short', day: 'numeric', month: 'short' }))} selected={expenseDate === today} onPress={() => setExpenseDate(today)} />
        <Chip label={upperFirst(formatDay(addDays(today, -1), language, { weekday: 'short', day: 'numeric', month: 'short' }))} selected={expenseDate === addDays(today, -1)} onPress={() => setExpenseDate(addDays(today, -1))} />
        <Chip label={expenseDate !== today && expenseDate !== addDays(today, -1) ? upperFirst(formatDay(expenseDate, language, { day: 'numeric', month: 'short', year: 'numeric' })) : t('exp_other_date')} selected={showCalendar} onPress={() => setShowCalendar((v) => !v)} />
      </ChipRow>
      {showCalendar ? <CalendarPicker value={expenseDate} onChange={(d) => setExpenseDate(d)} today={today} allowPast maxDate={today} /> : null}
      <Field label={t('exp_notes')} value={notes} onChangeText={setNotes} maxLength={500} multiline />

      {noCash ? (
        <Card style={styles.notice}>
          <AppText variant="bodyStrong">{t('exp_no_cash_title')}</AppText>
          <AppText variant="small" tone="muted">
            {t('exp_no_cash_text')}
          </AppText>
          <Button
            label={t('exp_no_cash_cta')}
            variant="secondary"
            compact
            loading={busy}
            onPress={() => {
              setPaidFromCash(false);
              setNoCash(false);
              void save({ paidFromCash: false });
            }}
            style={{ alignSelf: 'flex-start', marginTop: 6 }}
          />
        </Card>
      ) : null}
      {needsAdjustment ? (
        <Card style={styles.notice}>
          <AppText variant="bodyStrong">{t('exp_adjust_title')}</AppText>
          <AppText variant="small" tone="muted">
            {t('exp_adjust_text')}
          </AppText>
          <Field label={t('exp_adjust_reason')} value={adjustmentReason} onChangeText={setAdjustmentReason} maxLength={200} error={fields.adjustmentReason} />
        </Card>
      ) : null}
      {error ? (
        <AppText tone="danger" accessibilityLiveRegion="polite">
          {error}
        </AppText>
      ) : null}
    </FormModal>
  );
}

/** Anular con motivo; si salió de una caja ya cerrada, pide además el motivo del ajuste. */
function VoidForm({ expense, onClose }: { expense: ExpenseDto; onClose: () => void }) {
  const { t } = useSettings();
  const { business } = useAuthed();
  const { toast } = useDialogs();
  const invalidate = useInvalidateCash();
  const [reason, setReason] = useState('');
  const needsAdjustment = expense.paidFromCash && expense.cashDayClosed;
  const [adjustmentReason, setAdjustmentReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit() {
    setBusy(true);
    setError(undefined);
    try {
      await api.voidExpense(expense.id, { reason, ...(needsAdjustment ? { adjustmentReason } : {}) });
      await invalidate();
      toast(t('exp_voided'));
      onClose();
    } catch (e) {
      setError(apiErrors(e, t).general ?? t('unknown_error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormModal
      title={t('exp_void_title')}
      subtitle={`${expense.description} · ${formatMoney(expense.amount, business.currency as Currency)}`}
      onClose={onClose}
      footer={<Button label={t('exp_void')} variant="danger" loading={busy} disabled={reason.trim().length < 3 || (needsAdjustment && adjustmentReason.trim().length < 3)} onPress={() => void submit()} />}>
      <Field label={t('exp_void_reason')} value={reason} onChangeText={setReason} maxLength={200} />
      {needsAdjustment ? (
        <Card style={styles.notice}>
          <AppText variant="bodyStrong">{t('exp_adjust_title')}</AppText>
          <AppText variant="small" tone="muted">
            {t('exp_adjust_text')}
          </AppText>
          <Field label={t('exp_adjust_reason')} value={adjustmentReason} onChangeText={setAdjustmentReason} maxLength={200} />
        </Card>
      ) : null}
      {error ? (
        <AppText tone="danger" accessibilityLiveRegion="polite">
          {error}
        </AppText>
      ) : null}
    </FormModal>
  );
}

const styles = StyleSheet.create({
  list: { padding: space.lg, gap: space.md, paddingBottom: 120 },
  filters: { gap: space.sm, marginBottom: space.sm },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  summary: { gap: 2, marginTop: space.sm },
  download: { alignItems: 'flex-start', marginTop: space.sm },
  more: { alignItems: 'center', gap: space.sm, paddingVertical: space.lg },
  card: { gap: 6 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  flex: { flex: 1, minWidth: 0, gap: 2 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  badge: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: 4 },
  notice: { gap: 6, marginTop: space.sm },
  label: { marginTop: space.sm },
});
