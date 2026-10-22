/**
 * Reportes → Balance general (módulo Finanzas). Una sola pantalla para Android, iOS y la web. Solo el dueño o quien tenga
 * el permiso "Finanzas" (access.ts redirige al resto y la API responde 403 de todos modos). Todas las cuentas salen del
 * servidor en SQL (`GET /api/reports/balance` y `/movements`), en días locales del negocio: aquí solo se muestran.
 * El rango vive en la URL (`?preset=` o `?from=&to=`), así un enlace o recargar la página conserva lo elegido.
 */
import { Ionicons } from '@expo/vector-icons';
import { BALANCE_PRESETS, formatMoney, withinExportLimit, type BalanceMovementDto, type Currency } from '@xiro/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { formatDay, todayIn, upperFirst } from '@/lib/agenda';
import { api, errorKey } from '@/lib/api';
import { rangeFromParams, type BalancePresetChoice as Preset } from '@/lib/balance';
import { useBalance, useBalanceMovements } from '@/lib/queries';
import { useAuthed } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { CalendarPicker } from '@/ui/agenda/CalendarPicker';
import { useCountUp } from '@/ui/AnimatedCharts';
import { Button } from '@/ui/Button';
import { Card, Chip, ChipRow, EmptyState } from '@/ui/Kit';
import { BalanceCharts } from '@/ui/reports/BalanceCharts';
import { DownloadButton } from '@/ui/reports/DownloadButton';
import { ReportsTabs } from '@/ui/reports/ReportsTabs';
import { Header, Screen } from '@/ui/Screen';
import { AppText } from '@/ui/Text';
import { space } from '@/ui/theme';

type Kind = 'all' | 'income' | 'expense';
type Sort = 'date' | 'amount';
const PAGE_SIZE = 20;
/** Lo mismo que la API (booking/balanceExport.ts): el PDF incluye los primeros 2.000 movimientos; el Excel, todos. */
const PDF_MAX_MOVEMENTS = 2000;

export default function BalanceReport() {
  const { t, colors, language } = useSettings();
  const { business, user } = useAuthed();
  const router = useRouter();
  const params = useLocalSearchParams<{ preset?: string; from?: string; to?: string }>();
  const currency = business.currency as Currency;
  const money = (amount: number) => formatMoney(amount, currency);
  const today = todayIn(business.timezone);
  const range = rangeFromParams(params, today);
  const [picking, setPicking] = useState<'from' | 'to' | null>(null);
  const [kind, setKind] = useState<Kind>('all');
  const [sort, setSort] = useState<Sort>('date');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);

  const valid = !range.error;
  const exportAllowed = withinExportLimit(range.from, range.to);
  const balance = useBalance({ from: range.from, to: range.to }, valid);
  const movements = useBalanceMovements({ from: range.from, to: range.to, kind, sort, dir, page, pageSize: PAGE_SIZE }, valid);

  const choosePreset = (preset: Preset) => {
    setPage(1);
    setPicking(preset === 'custom' ? 'from' : null);
    if (preset === 'custom') router.setParams({ preset: 'custom', from: range.from, to: range.to });
    else router.setParams({ preset, from: undefined, to: undefined });
  };
  const chooseDay = (which: 'from' | 'to', day: string) => {
    setPage(1);
    const next = which === 'from' ? { from: day, to: range.to < day ? day : range.to } : { from: range.from, to: day };
    router.setParams({ preset: 'custom', ...next });
    setPicking(which === 'from' ? 'to' : null);
  };
  const chooseSort = (next: Sort) => {
    setPage(1);
    if (next === sort) setDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    else {
      setSort(next);
      setDir('desc');
    }
  };

  const day = (date: string, year = false) => upperFirst(formatDay(date, language, { day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}) }));
  const totals = balance.data?.totals;
  const comparison = balance.data?.comparison;
  const pages = Math.max(1, Math.ceil((movements.data?.total ?? 0) / PAGE_SIZE));
  // Las 4 cifras principales cuentan progresivamente al cargar o cambiar de periodo, en vez de saltar de golpe.
  const incomeDisplay = useCountUp(totals?.income);
  const operatingDisplay = useCountUp(totals?.operating);
  const payrollDisplay = useCountUp(totals?.payroll);
  const netDisplay = useCountUp(totals?.net);

  /** Variación vs. el periodo anterior; `goodWhenUp` = false en los gastos (subir es malo). */
  const change = (value: number | null | undefined, goodWhenUp: boolean) => {
    if (value === undefined) return null;
    if (value === null) return <AppText variant="small" tone="muted">{t('bal_no_prev')}</AppText>;
    if (value === 0) return <AppText variant="small" tone="muted">{t('bal_change_flat')}</AppText>;
    const up = value > 0;
    return (
      <AppText variant="small" tone={up === goodWhenUp ? 'success' : 'danger'}>
        {t(up ? 'bal_change_up' : 'bal_change_down', { n: Math.abs(value) })}
      </AppText>
    );
  };

  const metric = (label: string, amount: number | undefined, delta: ReactNode, tone: 'text' | 'gold' | 'success' | 'danger' = 'text', extra?: ReactNode) => (
    <Card style={styles.metric}>
      <AppText variant="label" tone="muted">
        {label.toUpperCase()}
      </AppText>
      <AppText variant="title" tone={tone}>
        {amount === undefined ? '—' : money(amount)}
      </AppText>
      {delta}
      {extra}
    </Card>
  );

  const renderMovement = (m: BalanceMovementDto) => {
    const income = m.direction === 'in';
    const label = m.kind === 'operating' || m.kind === 'payroll' ? `${t(`bal_kind_${m.kind}`)} · ${m.category ? t(`exp_cat_${m.category}`) : ''}` : t(`bal_kind_${m.kind}`);
    return (
      <View key={`${m.kind}:${m.id}`} style={[styles.movement, { borderColor: colors.border }]}>
        <Ionicons name={income ? 'arrow-down-circle-outline' : 'arrow-up-circle-outline'} size={20} color={income ? colors.success : colors.danger} />
        <View style={styles.flex}>
          <AppText variant="bodyStrong" numberOfLines={1}>
            {m.description || label}
          </AppText>
          <AppText variant="small" tone="muted" numberOfLines={1}>
            {day(todayIn(business.timezone, new Date(m.at)))} · {label}
          </AppText>
        </View>
        <AppText variant="bodyStrong" tone={income ? 'success' : 'danger'}>
          {income ? '+' : '−'}
          {money(m.amount)}
        </AppText>
      </View>
    );
  };

  return (
    <Screen header={<Header title={t('menu_reports')} subtitle={t('bal_subtitle')} />} refreshing={balance.isRefetching} onRefresh={() => void Promise.all([balance.refetch(), movements.refetch()])}>
      <ReportsTabs active="balance" showSales={user.role === 'owner'} />

      <ChipRow label={t('bal_period')}>
        {[...BALANCE_PRESETS, 'custom' as const].map((p) => (
          <Chip key={p} label={t(`bal_preset_${p}`)} selected={range.preset === p} onPress={() => choosePreset(p)} />
        ))}
      </ChipRow>
      {range.preset === 'custom' ? (
        <View style={styles.custom}>
          <ChipRow>
            <Chip icon={<Ionicons name="calendar-outline" size={14} color={colors.textMuted} />} label={`${t('bal_from')}: ${day(range.from, true)}`} selected={picking === 'from'} onPress={() => setPicking(picking === 'from' ? null : 'from')} />
            <Chip icon={<Ionicons name="calendar-outline" size={14} color={colors.textMuted} />} label={`${t('bal_to')}: ${day(range.to, true)}`} selected={picking === 'to'} onPress={() => setPicking(picking === 'to' ? null : 'to')} />
          </ChipRow>
          {picking ? (
            <Card>
              <CalendarPicker key={picking} value={picking === 'from' ? range.from : range.to} onChange={(d) => chooseDay(picking, d)} today={today} allowPast maxDate={today} minDate={picking === 'to' ? range.from : undefined} />
            </Card>
          ) : null}
        </View>
      ) : null}
      <View style={styles.rangeRow}>
        <AppText variant="small" tone="muted" style={styles.rangeText}>
          {range.from === range.to ? day(range.from, true) : `${day(range.from, true)} – ${day(range.to, true)}`}
        </AppText>
        {/* Descargas generadas en el servidor con las mismas cuentas de la pantalla (máximo 12 meses). */}
        <View style={styles.downloads}>
          {(['pdf', 'xlsx'] as const).map((format) => (
            <DownloadButton
              key={format}
              kind={format}
              label={t(format === 'pdf' ? 'bal_download_pdf' : 'bal_download_xlsx')}
              fileName={`balance-${business.slug}-${range.from}_${range.to}.${format}`}
              disabled={!valid || !exportAllowed}
              fetchFile={() => api.balanceExport(format, { from: range.from, to: range.to, lang: language })}
            />
          ))}
        </View>
      </View>
      {valid && exportAllowed && (movements.data?.total ?? 0) > PDF_MAX_MOVEMENTS ? (
        <AppText variant="small" tone="muted">
          {t('bal_pdf_limit')}
        </AppText>
      ) : null}
      {valid && !exportAllowed ? (
        <AppText variant="small" tone="muted">
          {t('bal_download_limit')}
        </AppText>
      ) : null}
      {range.error ? <AppText tone="danger">{t(range.error)}</AppText> : null}

      {balance.isError ? (
        <View style={{ gap: 8 }}>
          <AppText tone="danger">{t(errorKey(balance.error))}</AppText>
          <Button label={t('retry')} variant="secondary" compact onPress={() => void balance.refetch()} style={{ alignSelf: 'flex-start' }} />
        </View>
      ) : null}
      {valid && balance.isLoading ? <ActivityIndicator style={{ marginVertical: space.lg }} accessibilityLabel={t('loading')} /> : null}

      {valid && totals ? (
        <>
          <View style={styles.metrics}>
            {metric(
              t('bal_income'),
              incomeDisplay,
              change(comparison?.income, true),
              'text',
              <AppText variant="small" tone="muted">
                {t('bal_breakdown', { services: money(totals.services), products: money(totals.products), discounts: money(totals.discounts) })}
              </AppText>,
            )}
            {metric(t('bal_operating'), operatingDisplay, change(comparison?.operating, false))}
            {metric(t('bal_payroll'), payrollDisplay, change(comparison?.payroll, false))}
            {metric(
              t('bal_net'),
              netDisplay,
              change(comparison?.net, true),
              totals.net < 0 ? 'danger' : 'gold',
              <AppText variant="bodyStrong" tone={totals.margin === null ? 'muted' : totals.margin < 0 ? 'danger' : 'text'}>
                {totals.margin === null ? t('bal_no_margin') : t('bal_margin', { n: totals.margin })}
              </AppText>,
            )}
          </View>
          {totals.tips > 0 ? (
            <AppText variant="small" tone="muted" style={styles.rangeLine}>
              {t('bal_tips', { amount: money(totals.tips) })}
            </AppText>
          ) : null}
          {balance.data ? (
            <BalanceCharts
              grouping={balance.data.series.grouping}
              buckets={balance.data.series.buckets}
              breakdown={balance.data.expenseBreakdown}
              currency={currency}
            />
          ) : null}
        </>
      ) : null}

      {valid ? (
        <Card style={styles.table}>
          <AppText variant="heading">{t('bal_movements')}</AppText>
          <ChipRow>
            {(['all', 'income', 'expense'] as const).map((k) => (
              <Chip
                key={k}
                label={t(`bal_filter_${k}`)}
                selected={kind === k}
                onPress={() => {
                  setKind(k);
                  setPage(1);
                }}
              />
            ))}
          </ChipRow>
          <ChipRow label={t('bal_sort_by')}>
            {(['date', 'amount'] as const).map((s) => (
              <Chip
                key={s}
                label={t(`bal_sort_${s}`)}
                selected={sort === s}
                icon={sort === s ? <Ionicons name={dir === 'desc' ? 'arrow-down' : 'arrow-up'} size={14} color={colors.gold} /> : undefined}
                onPress={() => chooseSort(s)}
              />
            ))}
          </ChipRow>
          {movements.isError ? <AppText tone="danger">{t(errorKey(movements.error))}</AppText> : null}
          {movements.isLoading ? <ActivityIndicator accessibilityLabel={t('loading')} /> : null}
          {movements.data && movements.data.rows.length === 0 ? <EmptyState icon="swap-vertical-outline" message={t('bal_movements_empty')} /> : null}
          <View>{(movements.data?.rows ?? []).map(renderMovement)}</View>
          {movements.data && movements.data.total > 0 ? (
            <View style={styles.pager}>
              <AppText variant="small" tone="muted">
                {movements.data.total === 1 ? t('bal_count_one') : t('bal_count', { count: movements.data.total })} · {t('bal_page', { page, pages })}
              </AppText>
              <View style={styles.pagerButtons}>
                <Button label={t('bal_prev_page')} icon="chevron-back" variant="secondary" compact disabled={page <= 1} onPress={() => setPage((p) => Math.max(1, p - 1))} />
                <Button label={t('bal_next_page')} variant="secondary" compact disabled={page >= pages} onPress={() => setPage((p) => Math.min(pages, p + 1))} />
              </View>
            </View>
          ) : null}
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  custom: { gap: space.sm, marginTop: space.sm },
  rangeLine: { marginTop: space.sm },
  /** Ocupa el espacio libre; si no queda al menos 200 px junto a los botones, pasa a su propia línea. */
  rangeText: { flexGrow: 1, flexBasis: 200 },
  downloads: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  rangeRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm, marginTop: space.sm },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, marginTop: space.md },
  metric: { flexGrow: 1, flexBasis: 220, gap: 4 },
  table: { marginTop: space.lg, gap: space.sm },
  movement: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  pager: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: space.sm, marginTop: space.sm },
  pagerButtons: { flexDirection: 'row', gap: space.sm },
});
