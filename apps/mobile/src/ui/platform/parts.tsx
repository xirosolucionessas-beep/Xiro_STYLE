import type { Indicator, IndicatorState } from '@xiro/shared';
import { useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Line, Rect, Text as SvgText } from 'react-native-svg';
import { ApiError } from '@/lib/api';
import { platformApi } from '@/lib/platformApi';
import { useSettings } from '@/lib/settings';
import { Button } from '../Button';
import { Field } from '../Field';
import { Card } from '../Kit';
import { AppText } from '../Text';
import { radius, space } from '../theme';
import { errorText, type PlatformText } from './strings';

export const formatDateTime = (iso: string | null | undefined, language: string) =>
  iso ? new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)) : '—';
export const formatNumber = (n: number, language: string) => new Intl.NumberFormat(language === 'en' ? 'en-US' : 'es-CO').format(n);

/** Etiqueta del estado de un dato: real, no disponible, desconocido o error. Nunca se muestra un número inventado. */
export function StateTag({ state, pt }: { state: IndicatorState; pt: PlatformText }) {
  const { colors } = useSettings();
  const color = state === 'ok' ? colors.success : state === 'error' ? colors.danger : colors.warning;
  return (
    <View style={[styles.tag, { borderColor: color }]} accessibilityLabel={pt(`state_${state}`)}>
      <AppText variant="label" style={{ color }}>
        {pt(`state_${state}`)}
      </AppText>
    </View>
  );
}

/** Fuente, cálculo, hora y advertencias de un indicador (siempre visibles: el dato se puede verificar). */
export function IndicatorMeta({ indicator, pt, language }: { indicator: Pick<Indicator<unknown>, 'source' | 'formula' | 'asOf' | 'note'>; pt: PlatformText; language: string }) {
  return (
    <View style={styles.meta}>
      <AppText variant="small" tone="muted">
        {pt('source')}: {indicator.source} · {pt('updated')}: {formatDateTime(indicator.asOf, language)}
      </AppText>
      <AppText variant="small" tone="muted">
        {pt('formula')}: {indicator.formula}
      </AppText>
      {indicator.note ? (
        <AppText variant="small" tone="muted">
          {indicator.note}
        </AppText>
      ) : null}
    </View>
  );
}

export function Stat({ label, indicator, render, pt, language, meta = true }: { label: string; indicator: Indicator<unknown>; render?: () => ReactNode; pt: PlatformText; language: string; meta?: boolean }) {
  return (
    <Card style={styles.stat}>
      <View style={styles.statHead}>
        <AppText variant="label" tone="muted" style={styles.flex}>
          {label}
        </AppText>
        <StateTag state={indicator.state} pt={pt} />
      </View>
      {indicator.state === 'ok' && indicator.value !== null ? (
        render ? (
          render()
        ) : (
          <AppText variant="title">{typeof indicator.value === 'number' ? formatNumber(indicator.value, language) : String(indicator.value)}</AppText>
        )
      ) : (
        <AppText tone="muted">—</AppText>
      )}
      {meta ? <IndicatorMeta indicator={indicator} pt={pt} language={language} /> : null}
    </Card>
  );
}

export function Segmented<T extends string>({ options, value, onChange }: { options: Array<{ value: T; label: string }>; value: T; onChange: (v: T) => void }) {
  const { colors } = useSettings();
  return (
    <View style={styles.segment} accessibilityRole="tablist">
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(o.value)}
            style={[styles.segmentItem, { borderColor: selected ? colors.gold : colors.border, backgroundColor: selected ? colors.goldTint : 'transparent' }]}>
            <AppText variant="small" style={{ color: selected ? colors.text : colors.textMuted, fontWeight: selected ? '700' : '400' }}>
              {o.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const CHART_H = 160;
const PAD = { top: 10, bottom: 22, left: 34, right: 6 };

/** Barras por período, con los valores tal como llegan del servidor (sin rellenar ni suavizar). Tocar una barra la detalla. */
export function BarChart({ buckets, language }: { buckets: Array<{ start: string; value: number }>; language: string }) {
  const { colors } = useSettings();
  const [width, setWidth] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const max = Math.max(1, ...buckets.map((b) => b.value));
  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = CHART_H - PAD.top - PAD.bottom;
  const col = buckets.length ? plotW / buckets.length : 0;
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const pick = picked !== null ? buckets[picked] : null;
  return (
    <View onLayout={(e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width))}>
      {width > 0 ? (
        <Svg width={width} height={CHART_H} accessibilityRole="image" accessibilityLabel={buckets.map((b) => `${b.start}: ${b.value}`).join(', ')}>
          <Line x1={PAD.left} x2={PAD.left + plotW} y1={y(0)} y2={y(0)} stroke={colors.border} />
          <SvgText x={PAD.left - 4} y={y(max) + 4} fontSize={10} fill={colors.textMuted} textAnchor="end">
            {max}
          </SvgText>
          <SvgText x={PAD.left - 4} y={y(0) + 4} fontSize={10} fill={colors.textMuted} textAnchor="end">
            0
          </SvgText>
          {buckets.map((b, i) => (
            <Rect
              key={b.start}
              x={PAD.left + i * col + col * 0.15}
              y={y(b.value)}
              width={Math.max(1, col * 0.7)}
              height={Math.max(b.value > 0 ? 1 : 0, y(0) - y(b.value))}
              rx={2}
              fill={picked === i ? colors.goldSoft : colors.gold}
              onPress={() => setPicked(i)}
            />
          ))}
          {buckets.length > 0 ? (
            <>
              <SvgText x={PAD.left} y={CHART_H - 6} fontSize={10} fill={colors.textMuted}>
                {buckets[0]!.start}
              </SvgText>
              <SvgText x={PAD.left + plotW} y={CHART_H - 6} fontSize={10} fill={colors.textMuted} textAnchor="end">
                {buckets.at(-1)!.start}
              </SvgText>
            </>
          ) : null}
        </Svg>
      ) : null}
      <AppText variant="small" tone="muted">
        {pick ? `${pick.start}: ${formatNumber(pick.value, language)}` : `Total: ${formatNumber(buckets.reduce((s, b) => s + b.value, 0), language)}`}
      </AppText>
    </View>
  );
}

/**
 * Ejecuta una acción sensible. Si el servidor pide reautenticación (`step_up_required`), muestra el campo del código TOTP,
 * llama a /auth/step-up y reintenta UNA vez la misma acción (las concesiones llevan clave de idempotencia: no se duplican).
 */
export function useSensitiveAction(pt: PlatformText) {
  const [prompt, setPrompt] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<{ action: () => Promise<unknown>; resolve: (ok: boolean) => void } | null>(null);

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
      setError(errorText(pt, e instanceof ApiError ? e.code : undefined));
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
        setError(errorText(pt, e instanceof ApiError ? e.code : undefined));
        resolve(false);
      }
    } catch (e) {
      setError(errorText(pt, e instanceof ApiError ? e.code : undefined));
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

export function KV({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.kv}>
      <AppText variant="small" tone="muted" style={styles.flex}>
        {label}
      </AppText>
      <AppText variant={strong ? 'bodyStrong' : 'body'}>{value}</AppText>
    </View>
  );
}

export const styles = StyleSheet.create({
  flex: { flex: 1 },
  tag: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  meta: { marginTop: space.sm, gap: 2 },
  stat: { gap: space.xs, flexGrow: 1, flexBasis: 260 },
  statHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  segment: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  segmentItem: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 6 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, alignItems: 'center' },
  section: { gap: space.md, marginTop: space.xl },
  stepUp: { gap: space.sm, marginTop: space.sm },
  kv: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md, paddingVertical: 4 },
});
