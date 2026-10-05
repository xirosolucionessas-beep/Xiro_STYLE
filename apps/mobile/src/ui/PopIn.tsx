import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing } from 'react-native';

/**
 * Entrada con un rebote corto (~0.4s: escala desde 0.4 con un leve "overshoot" a 1, más desvanecido) — para la marca
 * de confirmación tras registrar una venta. Respeta la preferencia de "Reducir movimiento" del sistema
 * (`AccessibilityInfo`): con ella activa, aparece de inmediato, sin animar.
 */
export function PopIn({ children }: { children: ReactNode }) {
  const scale = useRef(new Animated.Value(0.4)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (cancelled) return;
      setReady(true);
      if (reduced) {
        scale.setValue(1);
        opacity.setValue(1);
        return;
      }
      Animated.parallel([
        Animated.spring(scale, { toValue: 1, friction: 5, tension: 140, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 250, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ]).start();
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) return null;
  return <Animated.View style={{ opacity, transform: [{ scale }] }}>{children}</Animated.View>;
}
