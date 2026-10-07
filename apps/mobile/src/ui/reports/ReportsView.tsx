import { Ionicons } from '@expo/vector-icons';
import type { ReportPeriod } from '@/lib/sections';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useSettings } from '@/lib/settings';
import { CalendarPicker } from '../agenda/CalendarPicker';
import { Button } from '../Button';
import { Chip, ChipRow, EmptyState } from '../Kit';
import { AppText } from '../Text';
import { radius } from '../theme';

type IconName = keyof typeof Ionicons.glyphMap;

export interface ReportKpi {
  id: string;
  icon: IconName;
  label: string;
  value: string;
  loading?: boolean;
  /** Variación frente al periodo anterior ya redactada ("Subió 12%…"); sin base de comparación no hay. */
  trend?: { direction: 'up' | 'down' | 'flat'; text: string };
  hint?: string;
}

export interface ReportBar {
  key: string;
  /** Etiqueta corta del eje (vacía para no amontonar). */
  label: string;
  /** 0..1 respecto al día más alto. */
  height: number;
  dateLabel: string;
  amountLabel: string;
  countLabel: string;
}

export interface RankItem {
  id: string;
  name: string;
  value: string;
  sub: string;
}

export interface ShareRow {
  id: string;
  label: string;
  amountLabel: string;
  sub?: string;
  /** 0..100 */
  percent: number;
}

export interface ReportsViewProps {
  period: ReportPeriod;
  onPeriod: (period: ReportPeriod) => void;
  today: string;
  customFrom: string;
  customTo: string;
  onCustomFrom: (date: string) => void;
  onCustomTo: (date: string) => void;
  customError?: string;
  rangeLabel: string;
  kpis: ReportKpi[];
  growth: { direction: 'up' | 'down' | 'flat' | 'none'; percentLabel: string | null; statusText: string; currentLabel: string; previousLabel: string } | null;
  loading: boolean;
  empty: boolean;
  bars: ReportBar[];
  cashBalance: { openingLabel: string; cashSalesLabel: string; totalLabel: string } | null;
  paymentMethods: ShareRow[];
  employees: ShareRow[];
  topServices: RankItem[];
  topProducts: RankItem[];
  topClients: RankItem[];
  stock: { value: string; low: number; onPress: () => void } | null;
  note?: string;
  onShare: () => void;
  onExportPdf: () => void;
  onExportExcel: () => void;
  exportingPdf: boolean;
  exportingExcel: boolean;
}

const PERIODS: ReportPeriod[] = ['today', 'week', 'month', 'year', 'custom'];
const CHART_HEIGHT = 140;

/**
 * Reportes en Android/iOS: mismos datos y mismas secciones que la web (indicadores con variación, crecimiento, ventas por
 * día, total en caja, formas de pago, rendimiento por profesional, lo más vendido, mejores clientes e inventario), con
 * controles táctiles. La gráfica es de una sola serie (sin leyenda: el título la nombra); al tocar una barra se ve su
 * detalle, y cada barra lleva su lectura accesible completa (fecha, total y servicios).
 */
export function ReportsView(props: ReportsViewProps) {
  const { t, colors } = useSettings();
  const canExport = !props.loading && !props.customError && props.rangeLabel !== '';
  return (
    <View style={styles.root}>
      <PeriodPicker {...props} />

      {props.customError ? (
        <AppText tone="danger" variant="small" accessibilityLiveRegion="polite">
          {props.customError}
        </AppText>
      ) : props.rangeLabel ? (
        <AppText tone="muted" variant="small">
          {props.rangeLabel}
        </AppText>
      ) : null}

      <View style={styles.kpis}>
        {props.kpis.map((kpi) => (
          <Kpi key={kpi.id} kpi={kpi} />
        ))}
      </View>

      {props.note ? (
        <AppText tone="muted" variant="small">
          {props.note}
        </AppText>
      ) : null}

      {props.growth ? <Growth growth={props.growth} /> : null}

      <Section icon="bar-chart-outline" title={t('sec_rep_chart')}>
        {props.loading ? (
          <View style={styles.chartLoading}>
            <ActivityIndicator color={colors.gold} />
          </View>
        ) : props.empty ? (
          <EmptyState icon="bar-chart-outline" message={t('sec_rep_empty')} />
        ) : (
          <Bars bars={props.bars} />
        )}
      </Section>

      {props.cashBalance ? (
        <Section icon="wallet-outline" title={t('sec_rep_cash_total')}>
          <Line label={t('sec_rep_opening_base')} value={props.cashBalance.openingLabel} />
          <Line label={t('sec_rep_cash_sales')} value={props.cashBalance.cashSalesLabel} />
          <Line label={t('sec_rep_cash_total')} value={props.cashBalance.totalLabel} strong />
        </Section>
      ) : null}

      {props.paymentMethods.length > 0 ? (
        <Section icon="card-outline" title={t('sec_rep_payment_methods')}>
          {props.paymentMethods.map((row) => (
            <ShareLine key={row.id} row={row} sub={t('sec_rep_percent_of_total', { n: row.percent })} />
          ))}
        </Section>
      ) : null}

      {!props.empty && !props.loading ? (
        <Section icon="people-outline" title={t('sec_rep_employees')}>
          {props.employees.length === 0 ? (
            <AppText tone="muted">{t('sec_rep_employees_empty')}</AppText>
          ) : (
            props.employees.map((row) => <ShareLine key={row.id} row={row} sub={row.sub ?? ''} />)
          )}
        </Section>
      ) : null}

      <Ranking icon="cut-outline" title={t('sec_rep_top_services')} rows={props.topServices} />
      <Ranking icon="pricetag-outline" title={t('sec_rep_top_products')} rows={props.topProducts} />
      <Ranking icon="star-outline" title={t('sec_rep_top_clients')} rows={props.topClients} />

      {props.stock ? (
        <Section icon="cube-outline" title={t('sec_rep_stock')}>
          <Line label={t('sec_rep_stock_value')} value={props.stock.value} />
          <Pressable accessibilityRole="button" onPress={props.stock.onPress} style={styles.lineRow}>
            <AppText style={{ flex: 1 }}>{t('sec_rep_stock_low')}</AppText>
            <AppText variant="bodyStrong">{String(props.stock.low)}</AppText>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </Pressable>
        </Section>
      ) : null}

      {/* Mismos archivos que la web (mismo generador); en el teléfono se guardan o comparten desde la hoja del sistema. */}
      <View style={styles.exports}>
        <Button label={t('sec_rep_export_pdf')} icon="document-text-outline" onPress={props.onExportPdf} loading={props.exportingPdf} disabled={!canExport || props.exportingExcel} />
        <Button label={t('sec_rep_export_excel')} icon="grid-outline" variant="secondary" onPress={props.onExportExcel} loading={props.exportingExcel} disabled={!canExport || props.exportingPdf} />
        <Button label={t('rep_share')} icon="share-social-outline" variant="ghost" onPress={props.onShare} disabled={!canExport} />
      </View>
    </View>
  );
}

function PeriodPicker({ period, onPeriod, today, customFrom, customTo, onCustomFrom, onCustomTo }: ReportsViewProps) {
  const { t, colors } = useSettings();
  const [editing, setEditing] = useState<'from' | 'to' | null>(null);
  const label: Record<ReportPeriod, string> = { today: t('sec_period_today'), week: t('sec_period_week'), month: t('sec_period_month'), year: t('sec_period_year'), custom: t('sec_period_custom') };
  return (
    <View style={{ gap: 10 }}>
      <ChipRow label={t('sec_period')}>
        {PERIODS.map((value) => (
          <Chip key={value} label={label[value]} selected={period === value} onPress={() => onPeriod(value)} />
        ))}
      </ChipRow>
      {period === 'custom' ? (
        <View style={{ gap: 10 }}>
          <View style={styles.dates}>
            {(['from', 'to'] as const).map((which) => {
              const value = which === 'from' ? customFrom : customTo;
              const active = editing === which;
              return (
                <Pressable
                  key={which}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: active }}
                  accessibilityLabel={`${t(which === 'from' ? 'sec_period_from' : 'sec_period_to')}: ${value || '—'}`}
                  onPress={() => setEditing(active ? null : which)}
                  style={[styles.dateField, { backgroundColor: colors.surface, borderColor: active ? colors.gold : colors.border }]}>
                  <AppText variant="small" tone="muted">
                    {t(which === 'from' ? 'sec_period_from' : 'sec_period_to')}
                  </AppText>
                  <AppText variant="bodyStrong">{value || '—'}</AppText>
                </Pressable>
              );
            })}
          </View>
          {editing ? (
            <CalendarPicker
              value={(editing === 'from' ? customFrom : customTo) || today}
              today={today}
              allowPast
              maxDate={today}
              onChange={(date) => {
                if (editing === 'from') onCustomFrom(date);
                else onCustomTo(date);
                setEditing(editing === 'from' && !customTo ? 'to' : null);
              }}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function Kpi({ kpi }: { kpi: ReportKpi }) {
  const { colors } = useSettings();
  const trendColor = kpi.trend ? (kpi.trend.direction === 'up' ? colors.success : kpi.trend.direction === 'down' ? colors.danger : colors.textMuted) : undefined;
  const trendIcon: IconName = kpi.trend?.direction === 'up' ? 'trending-up' : kpi.trend?.direction === 'down' ? 'trending-down' : 'remove';
  return (
    <View style={[styles.kpi, { backgroundColor: colors.surface, borderColor: colors.border }]} accessible accessibilityLabel={[kpi.label, kpi.loading ? '' : kpi.value, kpi.trend?.text, kpi.hint].filter(Boolean).join('. ')}>
      <View style={styles.kpiHead}>
        <Ionicons name={kpi.icon} size={16} color={colors.textMuted} />
        <AppText variant="small" tone="muted" numberOfLines={1} style={{ flex: 1 }}>
          {kpi.label}
        </AppText>
      </View>
      {kpi.loading ? <ActivityIndicator size="small" color={colors.gold} style={{ alignSelf: 'flex-start', marginVertical: 4 }} /> : <AppText variant="heading" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{kpi.value}</AppText>}
      {kpi.trend && !kpi.loading ? (
        <View style={styles.trend}>
          <Ionicons name={trendIcon} size={14} color={trendColor} />
          <AppText variant="small" numberOfLines={2} style={{ color: trendColor, flex: 1 }}>
            {kpi.trend.text}
          </AppText>
        </View>
      ) : kpi.hint ? (
        <AppText variant="small" tone="muted" numberOfLines={1}>
          {kpi.hint}
        </AppText>
      ) : null}
    </View>
  );
}

function Growth({ growth }: { growth: NonNullable<ReportsViewProps['growth']> }) {
  const { colors } = useSettings();
  const tone = growth.direction === 'up' ? colors.success : growth.direction === 'down' ? colors.danger : colors.textMuted;
  return (
    <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]} accessible accessibilityLabel={[growth.percentLabel, growth.statusText, growth.previousLabel, growth.currentLabel].filter(Boolean).join('. ')}>
      <View style={styles.growthRow}>
        {growth.percentLabel ? <AppText variant="title" style={{ color: tone }}>{growth.percentLabel}</AppText> : null}
        <AppText style={{ flex: 1 }}>{growth.statusText}</AppText>
      </View>
      <AppText variant="small" tone="muted">
        {growth.previousLabel} → {growth.currentLabel}
      </AppText>
    </View>
  );
}

function Bars({ bars }: { bars: ReportBar[] }) {
  const { colors } = useSettings();
  const [selected, setSelected] = useState<string | null>(null);
  const active = bars.find((bar) => bar.key === selected) ?? null;
  const gap = bars.length > 14 ? 2 : 6;
  return (
    <View style={{ gap: 8 }}>
      {/* Detalle de la barra tocada (equivalente táctil del tooltip de la web). */}
      <View style={[styles.detail, { backgroundColor: colors.surfaceAlt }]} accessibilityLiveRegion="polite">
        {active ? (
          <>
            <AppText variant="bodyStrong">{active.dateLabel}</AppText>
            <AppText variant="small">{active.amountLabel}</AppText>
            <AppText variant="small" tone="muted">
              {active.countLabel}
            </AppText>
          </>
        ) : (
          <AppText variant="small" tone="muted">
            {bars.length > 0 ? `${bars[0]!.dateLabel} – ${bars[bars.length - 1]!.dateLabel}` : ''}
          </AppText>
        )}
      </View>
      <View style={[styles.chart, { height: CHART_HEIGHT, gap, borderBottomColor: colors.border }]}>
        {bars.map((bar) => {
          const isActive = bar.key === selected;
          return (
            <Pressable
              key={bar.key}
              accessibilityRole="button"
              accessibilityLabel={`${bar.dateLabel}. ${bar.amountLabel}. ${bar.countLabel}`}
              accessibilityState={{ selected: isActive }}
              onPress={() => setSelected(isActive ? null : bar.key)}
              hitSlop={{ top: 8, bottom: 8 }}
              style={styles.barSlot}>
              <View
                style={{
                  height: bar.height > 0 ? Math.max(4, Math.round(bar.height * (CHART_HEIGHT - 8))) : 2,
                  backgroundColor: bar.height > 0 ? colors.gold : colors.border,
                  opacity: selected && !isActive ? 0.45 : 1,
                  borderTopLeftRadius: 4,
                  borderTopRightRadius: 4,
                }}
              />
            </Pressable>
          );
        })}
      </View>
      <View style={[styles.axis, { gap }]}>
        {bars.map((bar) => (
          <AppText key={bar.key} variant="small" tone="muted" numberOfLines={1} style={styles.axisLabel}>
            {bar.label}
          </AppText>
        ))}
      </View>
    </View>
  );
}

function Section({ icon, title, children }: { icon: IconName; title: string; children: ReactNode }) {
  const { colors } = useSettings();
  return (
    <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.sectionHead}>
        <Ionicons name={icon} size={18} color={colors.gold} />
        <AppText variant="heading" accessibilityRole="header">
          {title}
        </AppText>
      </View>
      {children}
    </View>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.lineRow} accessible accessibilityLabel={`${label}: ${value}`}>
      <AppText variant={strong ? 'bodyStrong' : 'body'} style={{ flex: 1 }}>
        {label}
      </AppText>
      <AppText variant="bodyStrong">{value}</AppText>
    </View>
  );
}

function ShareLine({ row, sub }: { row: ShareRow; sub: string }) {
  const { colors } = useSettings();
  return (
    <View style={{ gap: 6, paddingVertical: 6 }} accessible accessibilityLabel={`${row.label}: ${row.amountLabel}. ${sub}`}>
      <View style={styles.shareHead}>
        <AppText style={{ flex: 1 }} numberOfLines={1}>
          {row.label}
        </AppText>
        <AppText variant="bodyStrong">{row.amountLabel}</AppText>
      </View>
      <View style={[styles.track, { backgroundColor: colors.surfaceAlt }]}>
        <View style={[styles.fill, { width: `${Math.max(0, Math.min(100, row.percent))}%`, backgroundColor: colors.gold }]} />
      </View>
      <AppText variant="small" tone="muted">
        {sub}
      </AppText>
    </View>
  );
}

function Ranking({ icon, title, rows }: { icon: IconName; title: string; rows: RankItem[] }) {
  const { colors } = useSettings();
  if (rows.length === 0) return null;
  return (
    <Section icon={icon} title={title}>
      {rows.map((row, index) => (
        <View key={row.id} style={[styles.rank, index > 0 && { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth }]} accessible accessibilityLabel={`${index + 1}. ${row.name}: ${row.value}, ${row.sub}`}>
          <AppText variant="bodyStrong" tone="muted" style={styles.rankIndex}>
            {index + 1}
          </AppText>
          <View style={{ flex: 1 }}>
            <AppText numberOfLines={1}>{row.name}</AppText>
            <AppText variant="small" tone="muted">
              {row.sub}
            </AppText>
          </View>
          <AppText variant="bodyStrong">{row.value}</AppText>
        </View>
      ))}
    </Section>
  );
}

const styles = StyleSheet.create({
  root: { gap: 14 },
  exports: { gap: 10, marginTop: 4 },
  dates: { flexDirection: 'row', gap: 10 },
  dateField: { flex: 1, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 8, minHeight: 48 },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  kpi: { width: '48.5%', flexGrow: 1, borderWidth: 1, borderRadius: radius.lg, padding: 12, gap: 4 },
  kpiHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  trend: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  section: { borderWidth: 1, borderRadius: radius.lg, padding: 14, gap: 6 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  growthRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  chartLoading: { height: CHART_HEIGHT, alignItems: 'center', justifyContent: 'center' },
  detail: { borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 8, minHeight: 58, justifyContent: 'center' },
  chart: { flexDirection: 'row', alignItems: 'flex-end', borderBottomWidth: StyleSheet.hairlineWidth },
  barSlot: { flex: 1, height: '100%', justifyContent: 'flex-end' },
  axis: { flexDirection: 'row' },
  axisLabel: { flex: 1, textAlign: 'center', fontSize: 10 },
  lineRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40 },
  shareHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  rank: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52 },
  rankIndex: { width: 20, textAlign: 'center' },
});
