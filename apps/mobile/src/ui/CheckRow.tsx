import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSettings } from '@/lib/settings';
import { AppText } from './Text';

/** Casilla con etiqueta y texto de apoyo: toda la fila es el área táctil (≥ 48 px). */
export function CheckRow({ label, hint, checked, onChange, disabled }: { label: string; hint?: string; checked: boolean; onChange: (next: boolean) => void; disabled?: boolean }) {
  const { colors } = useSettings();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: !!disabled }}
      accessibilityLabel={hint ? `${label}. ${hint}` : label}
      onPress={disabled ? undefined : () => onChange(!checked)}
      style={[styles.row, { opacity: disabled ? 0.7 : 1 }]}>
      <View style={[styles.box, { borderColor: checked ? colors.gold : colors.border, backgroundColor: checked ? colors.gold : 'transparent' }]}>{checked ? <Ionicons name="checkmark" size={16} color={colors.onGold} /> : null}</View>
      <View style={{ flex: 1 }}>
        <AppText variant="bodyStrong">{label}</AppText>
        {hint ? (
          <AppText tone="muted" variant="small">
            {hint}
          </AppText>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48, paddingVertical: 6 },
  box: { width: 24, height: 24, borderRadius: 7, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
});
