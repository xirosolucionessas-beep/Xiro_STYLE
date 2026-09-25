import { View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import { useSettings } from '@/lib/settings';

/** Marcador de carga estático (sin animación: ligero y respeta "reducir movimiento"). Reserva el espacio para que el diseño no salte. */
export function Skeleton({ width = '100%', height = 16, radius = 8, style }: { width?: DimensionValue; height?: number; radius?: number; style?: StyleProp<ViewStyle> }) {
  const { colors } = useSettings();
  return <View accessibilityElementsHidden importantForAccessibility="no" style={[{ width, height, borderRadius: radius, backgroundColor: colors.surfaceAlt, opacity: 0.8 }, style]} />;
}
