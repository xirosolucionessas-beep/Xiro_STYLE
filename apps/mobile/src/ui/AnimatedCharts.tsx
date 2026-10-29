import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native';
import { useSettings } from '@/lib/settings';

/** true si el sistema pide reducir el movimiento: entonces las gráficas aparecen ya en su tamaño final, sin animar. */
export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => alive && setReduce(value));
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      alive = false;
      subscription.remove();
    };
  }, []);
  return reduce;
}

const EASE = Easing.bezier(0.22, 1, 0.36, 1);
const BAR_MAX = 64;

/**
 * Ventas por hora (Android/iOS): 24 barras que crecen en cascada al abrir la pantalla y, cuando la actualización automática
 * trae datos nuevos, cambian de altura con una transición suave (sin reiniciar la entrada). La hora pico se destaca.
 */
export function AnimatedHourlyBars({ values, label }: { values: number[]; label: string }) {
  const { colors } = useSettings();
  const reduce = useReduceMotion();
  const peak = Math.max(0, ...values);
  const target = (v: number) => (peak > 0 ? Math.max((v / peak) * BAR_MAX, v > 0 ? 4 : 1) : 1);
  const [heights] = useState(() => values.map(() => new Animated.Value(0)));
  const key = values.join(',');
  const entered = useRef(false);

  useEffect(() => {
    const animations = values.map((v, i) => Animated.timing(heights[i]!, { toValue: target(v), duration: entered.current ? 600 : 720, easing: EASE, useNativeDriver: false }));
    if (reduce) {
      values.forEach((v, i) => heights[i]!.setValue(target(v)));
    } else if (entered.current) {
      Animated.parallel(animations).start();
    } else {
      Animated.stagger(28, animations).start();
    }
    entered.current = true;
    // Solo cuando cambian los valores (key) o la preferencia de movimiento.
  }, [key, reduce]);

  return (
    <View style={styles.chart} accessible accessibilityRole="image" accessibilityLabel={label}>
      {values.map((v, hour) => (
        <View key={hour} style={styles.barWrap}>
          <Animated.View style={[styles.bar, { height: heights[hour]!, backgroundColor: v > 0 ? colors.gold : colors.border, opacity: v > 0 && v === peak ? 1 : v > 0 ? 0.82 : 1 }]} />
        </View>
      ))}
    </View>
  );
}

/** Barra de proporción animada (0–1): crece al aparecer y se ajusta suave cuando cambian los datos. Decorativa. */
export function AnimatedShareBar({ share, delay = 0 }: { share: number; delay?: number }) {
  const { colors } = useSettings();
  const reduce = useReduceMotion();
  const clamped = Math.max(0, Math.min(1, share));
  const [width] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (reduce) return width.setValue(clamped);
    Animated.timing(width, { toValue: clamped, duration: 760, delay, easing: EASE, useNativeDriver: false }).start();
  }, [clamped, delay, reduce, width]);
  return (
    <View style={[styles.track, { backgroundColor: colors.border }]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Animated.View style={[styles.fill, { backgroundColor: colors.gold, width: width.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]} />
    </View>
  );
}

/**
 * Cuenta progresivamente desde el valor anterior (o 0 la primera vez) hasta `target`, con desaceleración al final —
 * mismo patrón que `AnimatedHourlyBars`/`AnimatedShareBar` (requestAnimationFrame, disponible en Android, iOS y
 * web) para cifras de un reporte (ingresos, gastos, utilidad neta…) que cambian al elegir otro periodo. Respeta
 * "reducir movimiento" saltando directo al valor final.
 */
export function useCountUp(target: number | undefined, durationMs = 650): number | undefined {
  const reduce = useReduceMotion();
  const [display, setDisplay] = useState(target);
  const [trackedTarget, setTrackedTarget] = useState(target);
  if (target !== trackedTarget) {
    setTrackedTarget(target);
    if (target === undefined || reduce) setDisplay(target); // nada que animar: salta directo
    // si no, `display` se queda en el valor anterior por ahora — el efecto de abajo lo anima hasta `target`.
  }

  useEffect(() => {
    if (target === undefined || reduce || display === target) return;
    const from = typeof display === 'number' ? display : 0;
    const start = Date.now();
    let frame = 0;
    const tick = () => {
      const progress = Math.min(1, (Date.now() - start) / durationMs);
      const eased = 1 - (1 - progress) * (1 - progress);
      setDisplay(Math.round(from + (target - from) * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, reduce, durationMs]);

  return display;
}

const styles = StyleSheet.create({
  chart: { flexDirection: 'row', alignItems: 'flex-end', height: 72, marginBottom: 12, gap: 2 },
  barWrap: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: BAR_MAX },
  bar: { width: '70%', borderRadius: 3, minHeight: 1 },
  track: { height: 6, borderRadius: 3, overflow: 'hidden', marginTop: 6, marginBottom: 4 },
  fill: { height: '100%', borderRadius: 3 },
});
