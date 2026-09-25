import { StyleSheet, View } from 'react-native';
import { useSettings } from '@/lib/settings';
import { AppText } from './Text';

/** Barra de progreso de 3 segmentos con "Paso X de 3" (la verán como una sola barra los lectores de pantalla). */
export function StepBar({ step, total = 3 }: { step: number; total?: number }) {
  const { t, colors } = useSettings();
  const label = t('reg_step_of', { n: step });
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel={label} accessibilityValue={{ min: 1, max: total, now: step }} style={styles.wrap}>
      <View style={styles.bar}>
        {Array.from({ length: total }, (_, index) => (
          <View key={index} style={[styles.segment, { backgroundColor: index < step ? colors.gold : colors.border }]} />
        ))}
      </View>
      <AppText tone="muted" variant="small" style={styles.label}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 18 },
  bar: { flexDirection: 'row', gap: 6 },
  segment: { flex: 1, height: 5, borderRadius: 3 },
  label: { marginTop: 8 },
});
