import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useLuxury } from '../luxuryTokens';
import { radius } from '../theme';

interface Props {
  children: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  innerStyle?: StyleProp<ViewStyle>;
  /** Radio exterior (por defecto el de las tarjetas grandes). */
  rounded?: number;
}

const BORDER = 1.5;

/**
 * Tarjeta con borde dorado degradado y relleno sutil. El "brillo" es un degradado (barato en cualquier gama); solo iOS
 * añade una sombra suave, y en Android no se usa elevación para no penalizar a los equipos de gama baja.
 */
export function GradientCard({ children, onPress, accessibilityLabel, style, innerStyle, rounded = radius.lg }: Props) {
  const tk = useLuxury();
  const body = (
    <LinearGradient colors={tk.cardBorder} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.border, { borderRadius: rounded }, Platform.OS === 'ios' && { shadowColor: tk.glow, shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } }]}>
      <LinearGradient colors={tk.cardFill} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={[{ borderRadius: rounded - BORDER }, innerStyle]}>
        {children}
      </LinearGradient>
    </LinearGradient>
  );
  if (!onPress) return <View style={style} accessible={Boolean(accessibilityLabel)} accessibilityLabel={accessibilityLabel}>{body}</View>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} style={({ pressed }) => [style, { opacity: pressed ? 0.85 : 1 }]}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  border: { padding: BORDER },
});
