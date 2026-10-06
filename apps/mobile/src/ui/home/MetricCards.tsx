import { Ionicons } from '@expo/vector-icons';
import { PixelRatio, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSettings } from '@/lib/settings';
import { AppText } from '../Text';
import { GradientCard } from './GradientCard';
import { Skeleton } from './Skeleton';

export interface Metric {
  id: string;
  icon: keyof typeof Ionicons.glyphMap;
  /** Cifra ya formateada, o `—` si no está disponible para esta persona / módulo. */
  value: string;
  label: string;
  /** Texto pequeño bajo la etiqueta (p. ej. "Próximamente"). */
  note?: string;
  loading?: boolean;
  onPress?: () => void;
}

/** Con pantallas muy angostas o texto grande, las 4 tarjetas pasan a 2x2 en vez de comprimirse. */
export function useCompactMetrics(): boolean {
  const { width } = useWindowDimensions();
  return width < 360 || PixelRatio.getFontScale() > 1.3;
}

/** Cifras largas ($12,4 M, $679.998) bajan de tamaño para caber en la tarjeta sin recortarse (también donde adjustsFontSizeToFit no aplica). */
export const valueSize = (value: string): number => (value.length <= 5 ? 22 : value.length <= 7 ? 18 : 15);

export function MetricCards({ metrics }: { metrics: Metric[] }) {
  const grid = useCompactMetrics();
  const { colors } = useSettings();
  return (
    <View style={[styles.row, grid && styles.grid]}>
      {metrics.map((metric) => (
        <GradientCard
          key={metric.id}
          style={grid ? styles.cellGrid : styles.cell}
          onPress={metric.onPress}
          accessibilityLabel={`${metric.loading ? '' : metric.value} ${metric.label}${metric.note ? `, ${metric.note}` : ''}`.trim()}
          innerStyle={styles.inner}>
          <Ionicons name={metric.icon} size={24} color={colors.textMuted} />
          {metric.loading ? (
            <Skeleton width={44} height={22} style={{ marginVertical: 6 }} />
          ) : (
            <AppText variant="heading" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={[styles.value, { fontSize: valueSize(metric.value) }]}>
              {metric.value}
            </AppText>
          )}
          <AppText variant="small" tone="muted" center numberOfLines={2}>
            {metric.label}
          </AppText>
          {metric.note ? (
            <AppText variant="small" tone="gold" center numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={{ fontSize: 11 }}>
              {metric.note}
            </AppText>
          ) : null}
        </GradientCard>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8 },
  grid: { flexWrap: 'wrap', gap: 10 },
  cell: { flex: 1 },
  cellGrid: { width: '48%' },
  inner: { alignItems: 'center', justifyContent: 'center', paddingVertical: 12, paddingHorizontal: 4, minHeight: 104, gap: 2 },
  value: { marginTop: 4, fontWeight: '800', textAlign: 'center', maxWidth: '100%' },
});
