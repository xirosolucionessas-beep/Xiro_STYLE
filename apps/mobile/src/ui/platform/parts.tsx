import { Ionicons } from '@expo/vector-icons';
import type { BusinessAccessStatus, Indicator, IndicatorState, PlatformGrouping } from '@xiro/shared';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Line, Rect, Text as SvgText } from 'react-native-svg';
import { ApiError } from '@/lib/api';
import { platformApi } from '@/lib/platformApi';
import { useSettings } from '@/lib/settings';
import { Button } from '../Button';
import { Field } from '../Field';
import { Card } from '../Kit';
import { AppText } from '../Text';
import { radius, space } from '../theme';
import { bucketLabel, locale, niceTicks } from './chart';
import { errorText, isUncertain, type PlatformText } from './strings';

export { bucketLabel };
export const formatDateTime = (iso: string | null | undefined, language: string) =>
  iso ? new Intl.DateTimeFormat(locale(language), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)) : '—';
export const formatDate = (iso: string | null | undefined, language: string) => (iso ? new Intl.DateTimeFormat(locale(language), { dateStyle: 'long' }).format(new Date(iso)) : '—');
export const formatTime = (iso: string | null | undefined, language: string) => (iso ? new Intl.DateTimeFormat(locale(language), { timeStyle: 'short' }).format(new Date(iso)) : '—');
export const formatNumber = (n: number, language: string) => new Intl.NumberFormat(locale(language)).format(n);

export type Tone = 'success' | 'warning' | 'danger' | 'neutral' | 'gold';

function useToneColor(tone: Tone): string {
  const { colors } = useSettings();
  return { success: colors.success, warning: colors.warning, danger: colors.danger, neutral: colors.textMuted, gold: colors.gold }[tone];
}

/** Insignia de estado: SIEMPRE con texto e ícono (el color nunca es la única pista). */
export function Badge({ label, tone, icon }: { label: string; tone: Tone; icon?: keyof typeof Ionicons.glyphMap }) {
  const color = useToneColor(tone);
  return (
    <View style={[styles.tag, { borderColor: color }]} accessible accessibilityLabel={label}>
      {icon ? <Ionicons name={icon} size={12} color={color} /> : null}
      <AppText variant="label" style={{ color }}>
        {label}
      </AppText>
    </View>
  );
}

const STATE_TONE: Record<IndicatorState, { tone: Tone; icon: keyof typeof Ionicons.glyphMap }> = {
  ok: { tone: 'success', icon: 'checkmark-circle' },
  unavailable: { tone: 'neutral', icon: 'remove-circle-outline' },
  unknown: { tone: 'warning', icon: 'help-circle-outline' },
  error: { tone: 'danger', icon: 'alert-circle' },
};

/** Estado de un dato: real, no disponible, sin comprobar o error. Nunca se muestra un número inventado. */
export function StateTag({ state, pt }: { state: IndicatorState; pt: PlatformText }) {
  return <Badge label={pt(`state_${state}`)} {...STATE_TONE[state]} />;
}

const ACCESS_TONE: Record<BusinessAccessStatus, { tone: Tone; icon: keyof typeof Ionicons.glyphMap }> = {
  active: { tone: 'success', icon: 'checkmark-circle' },
  suspended: { tone: 'warning', icon: 'pause-circle' },
  deactivated: { tone: 'danger', icon: 'close-circle' },
};

export function AccessBadge({ status, pt }: { status: BusinessAccessStatus; pt: PlatformText }) {
  return <Badge label={pt(`status_${status}_one`)} {...ACCESS_TONE[status]} />;
}

/** Título con un botón "?" que despliega debajo una explicación breve (funciona con toque, teclado y lector de pantalla). */
export function Titled({ title, help, pt, variant = 'heading', right }: { title: string; help?: string; pt: PlatformText; variant?: 'heading' | 'label' | 'title'; right?: ReactNode }) {
  const { colors } = useSettings();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: 4 }}>
      <View style={styles.titleRow}>
        <AppText variant={variant} tone={variant === 'label' ? 'muted' : 'text'} accessibilityRole="header" style={styles.flexShrink}>
          {title}
        </AppText>
        {help ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${pt('what_is_this')} ${title}`}
            accessibilityState={{ expanded: open }}
            hitSlop={10}
            onPress={() => setOpen((v) => !v)}
            style={[styles.helpButton, { borderColor: open ? colors.gold : colors.border }]}>
            <Ionicons name={open ? 'close' : 'help'} size={14} color={open ? colors.gold : colors.textMuted} />
          </Pressable>
        ) : null}
        <View style={styles.flex} />
        {right}
      </View>
      {help && open ? (
        <AppText variant="small" tone="muted" accessibilityLiveRegion="polite">
          {help}
        </AppText>
      ) : null}
    </View>
  );
}

/**
 * Procedencia de un indicador: hora de la consulta siempre visible; fuente, cálculo y advertencias técnicas en un
 * desplegable (el dato se puede verificar sin llenar la pantalla de texto).
 */
export function IndicatorMeta({ indicator, pt, language }: { indicator: Pick<Indicator<unknown>, 'source' | 'formula' | 'asOf' | 'note'>; pt: PlatformText; language: string }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.meta}>
      <View style={styles.metaRow}>
        <AppText variant="small" tone="muted" style={styles.flexShrink}>
          {pt('updated')}: {formatTime(indicator.asOf, language)}
        </AppText>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} hitSlop={8} onPress={() => setOpen((v) => !v)} style={styles.metaToggle}>
          <AppText variant="small" tone="gold">
            {open ? pt('hide_details') : pt('technical_details')}
          </AppText>
        </Pressable>
      </View>
      {indicator.note ? (
        <AppText variant="small" tone="muted">
          {indicator.note}
        </AppText>
      ) : null}
      {open ? (
        <View style={{ gap: 2 }}>
          <AppText variant="small" tone="muted">
            {pt('source')}: {indicator.source}
          </AppText>
          <AppText variant="small" tone="muted">
            {pt('formula')}: {indicator.formula}
          </AppText>
          <AppText variant="small" tone="muted">
            {pt('updated')}: {formatDateTime(indicator.asOf, language)}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

/** Tarjeta de un indicador: título + ayuda, estado del dato, valor (o "—" si no hay dato real) y su procedencia. */
export function Stat({
  label,
  help,
  indicator,
  render,
  pt,
  language,
  meta = true,
  wide,
  action,
}: {
  label: string;
  help?: string;
  indicator: Indicator<unknown>;
  render?: () => ReactNode;
  pt: PlatformText;
  language: string;
  meta?: boolean;
  wide?: boolean;
  /** Acción propia de este indicador (p. ej. "Ver más"), junto al título. Solo se muestra con el dato cargado. */
  action?: ReactNode;
}) {
  return (
    <Card style={[styles.stat, wide && styles.statWide]}>
      <Titled title={label} help={help} pt={pt} variant="label" right={indicator.state === 'ok' ? action : <StateTag state={indicator.state} pt={pt} />} />
      {indicator.state === 'ok' && indicator.value !== null ? (
        render ? (
          render()
        ) : (
          <AppText variant="display">{typeof indicator.value === 'number' ? formatNumber(indicator.value, language) : String(indicator.value)}</AppText>
        )
      ) : (
        <View style={{ gap: 4 }}>
          <AppText variant="title" tone="muted" accessibilityLabel={pt(`state_${indicator.state}`)}>
            —
          </AppText>
          {indicator.state === 'error' ? (
            <AppText variant="small" tone="danger">
              {pt('state_error_help')}
            </AppText>
          ) : null}
        </View>
      )}
      {meta ? <IndicatorMeta indicator={indicator} pt={pt} language={language} /> : null}
    </Card>
  );
}

export function Segmented<T extends string>({ options, value, onChange, label }: { options: Array<{ value: T; label: string }>; value: T; onChange: (v: T) => void; label?: string }) {
  const { colors } = useSettings();
  return (
    <View style={styles.segment} accessibilityRole="tablist" accessibilityLabel={label}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(o.value)}
            style={({ pressed }) => [styles.segmentItem, { borderColor: selected ? colors.gold : colors.border, backgroundColor: selected ? colors.goldTint : 'transparent', opacity: pressed ? 0.75 : 1 }]}>
            <AppText variant="small" style={{ color: selected ? colors.text : colors.textMuted, fontWeight: selected ? '700' : '500' }}>
              {o.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ---------- Gráfica ---------- */

const CHART_H = 200;
const PAD = { top: 12, bottom: 28, left: 40, right: 8 };

/** "Reducir movimiento" del sistema: con él activo, las gráficas aparecen sin animación. */
function useReduceMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => alive && setReduced(v));
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return reduced;
}

/**
 * Barras por período con los valores tal como llegan del servidor (sin rellenar ni suavizar). Entrada breve (crecen desde
 * el eje en ~0,4 s, una sola animación nativa para toda la gráfica) al cargar o cambiar de período. Tocar una barra
 * muestra su valor; la lista accesible repite TODOS los datos para teclado y lectores de pantalla.
 */
export function BarChart({
  buckets,
  grouping,
  language,
  pt,
  unitLabel,
}: {
  buckets: Array<{ start: string; value: number }>;
  grouping: PlatformGrouping;
  language: string;
  pt: PlatformText;
  unitLabel: string;
}) {
  const { colors } = useSettings();
  const reduced = useReduceMotion();
  const [width, setWidth] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const grow = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  const dataKey = `${grouping}:${buckets[0]?.start ?? ''}:${buckets.length}:${buckets.map((b) => b.value).join(',')}`;

  useEffect(() => {
    setPicked(null);
    if (reduced) {
      grow.setValue(1);
      return;
    }
    grow.setValue(0);
    const anim = Animated.timing(grow, { toValue: 1, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [dataKey, reduced]);

  const total = buckets.reduce((s, b) => s + b.value, 0);
  const max = Math.max(0, ...buckets.map((b) => b.value));
  const ticks = niceTicks(max);
  const top = ticks.at(-1)!;
  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = CHART_H - PAD.top - PAD.bottom;
  const col = buckets.length ? plotW / buckets.length : 0;
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;
  const pick = picked !== null ? buckets[picked] : null;
  const labelIdx = buckets.length <= 2 ? buckets.map((_, i) => i) : [0, Math.floor((buckets.length - 1) / 2), buckets.length - 1];

  return (
    <View style={{ gap: space.sm }}>
      <AppText variant="small" tone={pick ? 'text' : 'muted'} accessibilityLiveRegion="polite" style={{ minHeight: 18 }}>
        {pick ? `${bucketLabel(pick.start, grouping, language, pt)}: ${formatNumber(pick.value, language)} ${unitLabel}` : total === 0 ? pt('chart_empty') : pt('chart_pick')}
      </AppText>
      <View onLayout={(e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width))} style={{ height: CHART_H }}>
        {width > 0 ? (
          <Svg width={width} height={CHART_H} accessibilityLabel={`${pt('chart_a11y')}: ${unitLabel}, ${pt('chart_total').toLowerCase()} ${formatNumber(total, language)}`}>
            {ticks.map((t) => (
              <Line key={`g${t}`} x1={PAD.left} x2={PAD.left + plotW} y1={y(t)} y2={y(t)} stroke={colors.border} strokeDasharray={t === 0 ? undefined : '3 4'} />
            ))}
            {ticks.map((t) => (
              <SvgText key={`t${t}`} x={PAD.left - 6} y={y(t) + 4} fontSize={11} fill={colors.textMuted} textAnchor="end">
                {formatNumber(t, language)}
              </SvgText>
            ))}
            {labelIdx.map((i) => (
              <SvgText
                key={`x${i}`}
                x={PAD.left + i * col + col / 2}
                y={CHART_H - 8}
                fontSize={11}
                fill={colors.textMuted}
                textAnchor={i === 0 && buckets.length > 2 ? 'start' : i === buckets.length - 1 && buckets.length > 2 ? 'end' : 'middle'}>
                {bucketLabel(buckets[i]!.start, grouping, language, pt)}
              </SvgText>
            ))}
          </Svg>
        ) : null}
        {width > 0 ? (
          <Animated.View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { transformOrigin: 'bottom', transform: [{ scaleY: grow }] }]}>
            <Svg width={width} height={CHART_H}>
              {buckets.map((b, i) => (
                <Rect
                  key={b.start}
                  x={PAD.left + i * col + col * 0.15}
                  y={y(b.value)}
                  width={Math.max(1, col * 0.7)}
                  height={Math.max(0, y(0) - y(b.value))}
                  rx={Math.min(3, col * 0.2)}
                  fill={picked === i ? colors.goldSoft : colors.gold}
                  onPress={() => setPicked(picked === i ? null : i)}
                />
              ))}
              {/* Zona táctil completa por columna: las barras bajas o en cero también se pueden tocar. */}
              {buckets.map((b, i) => (
                <Rect key={`hit${b.start}`} x={PAD.left + i * col} y={PAD.top} width={Math.max(1, col)} height={plotH} fill="transparent" onPress={() => setPicked(picked === i ? null : i)} />
              ))}
            </Svg>
          </Animated.View>
        ) : null}
      </View>
      <View style={styles.metaRow}>
        <AppText variant="bodyStrong" style={styles.flexShrink}>
          {pt('chart_total')}: {formatNumber(total, language)} {unitLabel}
        </AppText>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: table }} hitSlop={8} onPress={() => setTable((v) => !v)} style={styles.metaToggle}>
          <AppText variant="small" tone="gold">
            {table ? pt('chart_table_hide') : pt('chart_table_show')}
          </AppText>
        </Pressable>
      </View>
      {table ? (
        <View accessibilityRole="list">
          {buckets.map((b) => (
            <KV key={b.start} label={bucketLabel(b.start, grouping, language, pt)} value={formatNumber(b.value, language)} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

/**
 * Ejecuta una acción sensible. Si el servidor pide reautenticación (`step_up_required`), muestra el campo del código TOTP,
 * llama a /auth/step-up y reintenta UNA vez la misma acción (las acciones con clave de idempotencia no se duplican).
 * Si se pierde la conexión, el resultado es INCIERTO: se dice así (nunca "éxito") y se invita a repetir sin riesgo.
 */
export function useSensitiveAction(pt: PlatformText) {
  const [prompt, setPrompt] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<{ action: () => Promise<unknown>; resolve: (ok: boolean) => void } | null>(null);

  const describe = (e: unknown) => {
    const c = e instanceof ApiError ? e.code : undefined;
    return isUncertain(c) ? pt('uncertain') : errorText(pt, c);
  };

  async function run(action: () => Promise<unknown>): Promise<boolean> {
    setError(null);
    setBusy(true);
    try {
      await action();
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.code === 'step_up_required') {
        setPrompt(true);
        return new Promise<boolean>((resolve) => (pending.current = { action, resolve }));
      }
      setError(describe(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function confirmCode() {
    if (!pending.current) return;
    setBusy(true);
    setError(null);
    try {
      await platformApi.stepUp(code.trim());
      const { action, resolve } = pending.current;
      pending.current = null;
      setPrompt(false);
      setCode('');
      try {
        await action();
        resolve(true);
      } catch (e) {
        setError(describe(e));
        resolve(false);
      }
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  }

  const cancel = () => {
    pending.current?.resolve(false);
    pending.current = null;
    setPrompt(false);
    setCode('');
  };

  const ui = (
    <>
      {prompt ? (
        <Card style={styles.stepUp}>
          <AppText variant="heading">{pt('step_up_title')}</AppText>
          <AppText tone="muted">{pt('step_up_body')}</AppText>
          <Field label={pt('totp')} value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6} autoComplete="one-time-code" textContentType="oneTimeCode" />
          <View style={styles.row}>
            <Button label={pt('cancel')} variant="ghost" compact onPress={cancel} />
            <Button label={pt('confirm')} compact loading={busy} disabled={!/^\d{6}$/.test(code.trim())} onPress={() => void confirmCode()} />
          </View>
        </Card>
      ) : null}
      {error ? (
        <AppText tone="danger" accessibilityRole="alert">
          {error}
        </AppText>
      ) : null}
    </>
  );
  return { run, busy, ui };
}

export function KV({ label, value, strong, right }: { label: string; value?: string; strong?: boolean; right?: ReactNode }) {
  return (
    <View style={styles.kv}>
      <AppText variant="small" tone="muted" style={styles.flex}>
        {label}
      </AppText>
      {right ?? <AppText variant={strong ? 'bodyStrong' : 'body'}>{value}</AppText>}
    </View>
  );
}

/** UUID v4 sin depender de crypto.randomUUID (no existe en todos los motores de React Native). */
export function newKey(): string {
  const hex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16));
  hex[12] = '4';
  hex[16] = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  const h = hex.join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const styles = StyleSheet.create({
  flex: { flex: 1 },
  flexShrink: { flexShrink: 1 },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  helpButton: { width: 24, height: 24, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  meta: { marginTop: space.sm, gap: 4 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap', justifyContent: 'space-between' },
  metaToggle: { minHeight: 32, justifyContent: 'center' },
  stat: { gap: space.sm, flexGrow: 1, flexBasis: 240 },
  statWide: { flexBasis: 420 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  segment: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  segmentItem: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space.md, minHeight: 40, justifyContent: 'center' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, alignItems: 'center' },
  section: { gap: space.md, marginTop: space.xl },
  stepUp: { gap: space.sm, marginTop: space.sm },
  kv: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.md, paddingVertical: 6 },
});
