import { formatMoney, type BalanceBucket, type BalanceCategorySlice, type BalanceGrouping, type Currency } from '@xiro/shared';
import { useState } from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, G, Line, Path, Polyline, Rect, Text as SvgText } from 'react-native-svg';
import { arcPath, bucketLabel, compactMoney, donutSlices, labelIndexes, niceScale } from '@/lib/balance';
import { useSettings } from '@/lib/settings';
import { Card } from '../Kit';
import { AppText } from '../Text';
import { space } from '../theme';

/**
 * Gráficos del Balance general (Android, iOS y web, con react-native-svg; sin librerías de gráficos):
 *  - Línea: utilidad neta por día, semana o mes.
 *  - Barras: ingresos frente a gastos de cada grupo.
 *  - Dona: en qué se fue el gasto (por categoría).
 * Tocar un punto o una barra muestra sus cifras exactas debajo. Los datos llegan ya agregados del servidor.
 */

const HEIGHT = 190;
type Frame = { width: number; plotW: number; column: number; shown: Set<number> };
const PAD = { top: 12, right: 8, bottom: 24, left: 52 };
/** Tonos de la dona: la paleta dorada del panel y acentos que se distinguen en claro y oscuro. */
const SLICE_COLORS = ['#cda668', '#5fb37e', '#e2766a', '#6b9bd2', '#b98ad6', '#d9a441', '#4fb3b3', '#c97b5a', '#8f9b6a', '#9a8f80', '#d6789f', '#7a86c9'];

interface ChartsProps {
  grouping: BalanceGrouping;
  buckets: BalanceBucket[];
  breakdown: BalanceCategorySlice[];
  currency: Currency;
}

export function BalanceCharts({ grouping, buckets, breakdown, currency }: ChartsProps) {
  const { t, colors, language } = useSettings();
  const [lineW, setLineW] = useState(0);
  const [barW, setBarW] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const measure = (set: (w: number) => void) => (e: LayoutChangeEvent) => set(Math.round(e.nativeEvent.layout.width));
  const money = (amount: number) => formatMoney(amount, currency);
  const empty = buckets.every((b) => b.income === 0 && b.expenses === 0);
  const pick = selected !== null && selected < buckets.length ? buckets[selected] : null;

  const plotH = HEIGHT - PAD.top - PAD.bottom;
  /** Medidas de un gráfico según su ancho real. */
  const frame = (width: number) => {
    const plotW = Math.max(0, width - PAD.left - PAD.right);
    return { width, plotW, column: buckets.length > 0 ? plotW / buckets.length : 0, shown: labelIndexes(buckets.length, width < 420 ? 4 : 7) };
  };

  /** Eje Y con líneas guía y montos compactos. */
  const axis = ({ plotW }: Frame, scale: { min: number; max: number; step: number }, y: (v: number) => number) => {
    const ticks: number[] = [];
    for (let v = scale.min; v <= scale.max + scale.step / 2; v += scale.step) ticks.push(v);
    return ticks.map((v) => (
      <G key={v}>
        <Line x1={PAD.left} x2={PAD.left + plotW} y1={y(v)} y2={y(v)} stroke={colors.border} strokeWidth={v === 0 ? 1.5 : 1} strokeDasharray={v === 0 ? undefined : '3 4'} />
        <SvgText x={PAD.left - 6} y={y(v) + 4} fontSize={10} fill={colors.textMuted} textAnchor="end">
          {compactMoney(v, language)}
        </SvgText>
      </G>
    ));
  };
  const xLabels = ({ column, shown }: Frame) =>
    buckets.map((b, i) =>
    shown.has(i) ? (
      <SvgText key={b.key} x={PAD.left + column * (i + 0.5)} y={HEIGHT - 6} fontSize={10} fill={colors.textMuted} textAnchor="middle">
        {bucketLabel(b, grouping, language)}
      </SvgText>
    ) : null,
  );
  /**
   * Columnas invisibles para tocar cada grupo (más fácil que acertarle a un punto). Son botones normales encima del SVG:
   * `onPress` dentro del SVG no lo admite la web.
   */
  const hitAreas = ({ plotW }: Frame) => (
    <View style={[styles.hits, { left: PAD.left, top: PAD.top, width: plotW, height: plotH }]}>
      {buckets.map((b, i) => (
        <Pressable
          key={b.key}
          accessibilityRole="button"
          accessibilityLabel={`${bucketLabel(b, grouping, language)}: ${t('bal_income')} ${money(b.income)}, ${t('bal_chart_expenses')} ${money(b.expenses)}, ${t('bal_net')} ${money(b.net)}`}
          accessibilityState={{ selected: selected === i }}
          onPress={() => setSelected(selected === i ? null : i)}
          style={styles.hit}
        />
      ))}
    </View>
  );

  const lineChart = (fr: Frame) => {
    const { width, column } = fr;
    const scale = niceScale(buckets.map((b) => b.net));
    const y = (v: number) => PAD.top + plotH - ((v - scale.min) / (scale.max - scale.min)) * plotH;
    const points = buckets.map((b, i) => `${PAD.left + column * (i + 0.5)},${y(b.net)}`).join(' ');
    return (
      <View>
        <Svg width={width} height={HEIGHT}>
          {axis(fr, scale, y)}
          {selected !== null ? <Rect x={PAD.left + column * selected} y={PAD.top} width={column} height={plotH} fill={colors.goldTint} /> : null}
          <Polyline points={points} fill="none" stroke={colors.gold} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
          {buckets.length <= 40
            ? buckets.map((b, i) => <Circle key={b.key} cx={PAD.left + column * (i + 0.5)} cy={y(b.net)} r={selected === i ? 5 : 3} fill={b.net < 0 ? colors.danger : colors.gold} />)
            : null}
          {xLabels(fr)}
        </Svg>
        {hitAreas(fr)}
      </View>
    );
  };

  const barChart = (fr: Frame) => {
    const { width, column } = fr;
    const scale = niceScale(buckets.flatMap((b) => [b.income, b.expenses]));
    const y = (v: number) => PAD.top + plotH - ((v - scale.min) / (scale.max - scale.min)) * plotH;
    const bar = Math.max(1.5, Math.min(18, (column * 0.7) / 2));
    return (
      <View>
        <Svg width={width} height={HEIGHT}>
          {axis(fr, scale, y)}
          {selected !== null ? <Rect x={PAD.left + column * selected} y={PAD.top} width={column} height={plotH} fill={colors.goldTint} /> : null}
          {buckets.map((b, i) => {
            const center = PAD.left + column * (i + 0.5);
            return (
              <G key={b.key}>
                <Rect x={center - bar} y={y(b.income)} width={bar} height={Math.max(0, y(0) - y(b.income))} rx={2} fill={colors.success} />
                <Rect x={center} y={y(b.expenses)} width={bar} height={Math.max(0, y(0) - y(b.expenses))} rx={2} fill={colors.danger} />
              </G>
            );
          })}
          {xLabels(fr)}
        </Svg>
        {hitAreas(fr)}
      </View>
    );
  };

  const donut = () => {
    const slices = donutSlices(breakdown);
    const size = 160;
    const r = 58;
    const total = breakdown.reduce((sum, s) => sum + s.amount, 0);
    if (slices.length === 0) return <AppText tone="muted">{t('bal_chart_no_expenses')}</AppText>;
    return (
      <View style={styles.donutRow}>
        <View accessible accessibilityRole="image" accessibilityLabel={slices.map((s) => `${t(`exp_cat_${s.category}`)} ${Math.round(s.fraction * 100)} %`).join(', ')}>
          <Svg width={size} height={size}>
            {/* Cada porción es un arco que empieza arriba (12 en punto) y va en el sentido del reloj; sin rotar el SVG,
                que en la web produce un atributo inválido. Una sola porción del 100 % es un círculo completo. */}
            {slices.map((s, i) => {
              const color = SLICE_COLORS[i % SLICE_COLORS.length];
              const key = `${s.type}:${s.category}`;
              if (s.fraction >= 0.9999) return <Circle key={key} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={22} />;
              const gap = slices.length > 1 ? 1.5 / r : 0;
              return <Path key={key} d={arcPath(size / 2, r, s.start * 2 * Math.PI, (s.start + s.fraction) * 2 * Math.PI - gap)} fill="none" stroke={color} strokeWidth={22} />;
            })}
            <SvgText x={size / 2} y={size / 2 - 2} fontSize={11} fill={colors.textMuted} textAnchor="middle">
              {t('bal_chart_total')}
            </SvgText>
            <SvgText x={size / 2} y={size / 2 + 15} fontSize={14} fontWeight="700" fill={colors.text} textAnchor="middle">
              {compactMoney(total, language)}
            </SvgText>
          </Svg>
        </View>
        <View style={styles.legend}>
          {slices.map((s, i) => (
            <View key={`${s.type}:${s.category}`} style={styles.legendRow}>
              <View style={[styles.swatch, { backgroundColor: SLICE_COLORS[i % SLICE_COLORS.length] }]} />
              <AppText variant="small" style={styles.flex} numberOfLines={1}>
                {t(`exp_cat_${s.category}`)} · {t(`exp_type_${s.type}`)}
              </AppText>
              <AppText variant="small" tone="muted">
                {money(s.amount)} · {Math.round(s.fraction * 100)} %
              </AppText>
            </View>
          ))}
        </View>
      </View>
    );
  };

  const legendDot = (color: string, label: string) => (
    <View style={styles.legendRow}>
      <View style={[styles.swatch, { backgroundColor: color }]} />
      <AppText variant="small" tone="muted">
        {label}
      </AppText>
    </View>
  );

  const detail = pick ? (
    <AppText variant="small" style={styles.detail}>
      {pick.from === pick.to ? bucketLabel(pick, 'day', language) : `${bucketLabel({ key: pick.from, from: pick.from }, 'day', language)} – ${bucketLabel({ key: pick.to, from: pick.to }, 'day', language)}`} · {t('bal_income')} {money(pick.income)} · {t('bal_chart_expenses')} {money(pick.expenses)} ·{' '}
      {t('bal_net')} {money(pick.net)}
    </AppText>
  ) : (
    <AppText variant="small" tone="muted" style={styles.detail}>
      {t('bal_chart_tap_hint')}
    </AppText>
  );

  return (
    <View style={styles.wrap}>
      <View style={styles.grid}>
        <Card style={styles.card}>
          <AppText variant="heading">{t('bal_chart_net')}</AppText>
          <AppText variant="small" tone="muted">
            {t(`bal_grouping_${grouping}`)}
          </AppText>
          <View
            onLayout={measure(setLineW)}
            accessible
            accessibilityRole="image"
            accessibilityLabel={`${t('bal_chart_net')}: ${buckets.map((b) => `${bucketLabel(b, grouping, language)} ${money(b.net)}`).join(', ')}`}>
            {empty ? <AppText tone="muted">{t('bal_chart_empty')}</AppText> : lineW > 0 ? lineChart(frame(lineW)) : <View style={{ height: HEIGHT }} />}
          </View>
          {!empty ? detail : null}
        </Card>
        <Card style={styles.card}>
          <AppText variant="heading">{t('bal_chart_bars')}</AppText>
          <View style={styles.legendInline}>
            {legendDot(colors.success, t('bal_income'))}
            {legendDot(colors.danger, t('bal_chart_expenses'))}
          </View>
          <View
            onLayout={measure(setBarW)}
            accessible
            accessibilityRole="image"
            accessibilityLabel={`${t('bal_chart_bars')}: ${buckets.map((b) => `${bucketLabel(b, grouping, language)} ${money(b.income)} / ${money(b.expenses)}`).join(', ')}`}>
            {empty ? <AppText tone="muted">{t('bal_chart_empty')}</AppText> : barW > 0 ? barChart(frame(barW)) : <View style={{ height: HEIGHT }} />}
          </View>
          {!empty ? detail : null}
        </Card>
      </View>
      <Card style={styles.donutCard}>
        <AppText variant="heading">{t('bal_chart_donut')}</AppText>
        {donut()}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md, marginTop: space.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  card: { flexGrow: 1, flexBasis: 320, gap: 6, minWidth: 0 },
  /** La dona va sola en su fila: sin `flexBasis` (en una columna sería una altura mínima). */
  donutCard: { gap: 6 },
  hits: { position: 'absolute', flexDirection: 'row' },
  hit: { flex: 1 },
  flex: { flex: 1, minWidth: 0 },
  detail: { marginTop: 4 },
  donutRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.lg },
  legend: { flexGrow: 1, flexBasis: 220, maxWidth: 560, gap: 6, minWidth: 0 },
  legendInline: { flexDirection: 'row', gap: space.md },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  swatch: { width: 10, height: 10, borderRadius: 3 },
});
