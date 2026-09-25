import { StyleSheet, View } from 'react-native';
import { useSettings } from '@/lib/settings';
import { AppText } from './Text';

/** Línea con texto centrado ("o inicia sesión con", "o con tu correo"). */
export function OrDivider({ label }: { label: string }) {
  const { colors } = useSettings();
  return (
    <View style={styles.row} accessibilityRole="text">
      <View style={[styles.line, { backgroundColor: colors.border }]} />
      <AppText tone="muted" variant="small">
        {label}
      </AppText>
      <View style={[styles.line, { backgroundColor: colors.border }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 16 },
  line: { flex: 1, height: StyleSheet.hairlineWidth },
});
