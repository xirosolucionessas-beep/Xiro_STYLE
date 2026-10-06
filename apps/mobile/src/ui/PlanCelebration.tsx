import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Modal, StyleSheet, View } from 'react-native';
import { useSettings } from '@/lib/settings';
import { Button } from './Button';
import { AppText } from './Text';
import { radius, space } from './theme';

export interface PlanCelebrationProps {
  open: boolean;
  onClose: () => void;
  /** "Mensual" o "Anual", ya traducido. */
  planLabel: string;
  /** Fecha de renovación ya formateada; "" si no se conoce. */
  renewalDate: string;
}

/**
 * "¡Bienvenido a Xiro Premium!" (Tarea 9), versión nativa: se muestra justo después de una compra que la tienda ya
 * confirmó (nunca al tocar "comprar" — RevenueCat resuelve la compra antes de llegar aquí). Corta, con "Continuar",
 * y respeta "reducir movimiento" del sistema.
 */
export function PlanCelebration({ open, onClose, planLabel, renewalDate }: PlanCelebrationProps) {
  const { t, colors } = useSettings();
  const scale = useRef(new Animated.Value(0.85)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
  }, []);

  useEffect(() => {
    if (!open) return;
    scale.setValue(reduceMotion ? 1 : 0.85);
    opacity.setValue(reduceMotion ? 1 : 0);
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: reduceMotion ? 0 : 250, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, friction: 7, tension: 60, useNativeDriver: true }),
    ]).start();
  }, [open, reduceMotion, scale, opacity]);

  if (!open) return null;

  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={[StyleSheet.absoluteFill, styles.backdrop]}>
        <Animated.View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.gold, opacity, transform: [{ scale }] }]}>
          <View style={[styles.iconWrap, { backgroundColor: colors.goldTint, borderColor: colors.gold }]}>
            <Ionicons name="sparkles" size={34} color={colors.gold} />
          </View>
          <AppText variant="title" center tone="gold" style={{ marginBottom: space.sm }}>
            {t('plan_celebrate_title')}
          </AppText>
          <AppText center tone="muted" style={{ marginBottom: space.lg }}>
            {renewalDate ? t('plan_celebrate_body', { plan: planLabel, date: renewalDate }) : t('plan_celebrate_body_no_date', { plan: planLabel })}
          </AppText>
          <Button label={t('plan_celebrate_continue')} onPress={onClose} />
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.7)', padding: space.lg },
  card: { width: '100%', maxWidth: 360, borderWidth: 1.5, borderRadius: radius.xl, padding: space.xl, alignItems: 'center' },
  iconWrap: { width: 72, height: 72, borderRadius: 36, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', marginBottom: space.lg },
});
