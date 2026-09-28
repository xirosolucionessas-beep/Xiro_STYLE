import type { AvailabilitySlot } from '@xiro/shared';
import { Pressable, StyleSheet, View } from 'react-native';
import { formatClock } from '@/lib/agenda';
import { useSettings } from '@/lib/settings';
import { AppText } from '../Text';
import { radius } from '../theme';

interface SlotGridProps {
  slots: AvailabilitySlot[];
  /** Instante (ISO) del horario elegido. */
  value: string | null;
  onChange: (slot: AvailabilitySlot) => void;
}

/**
 * Cuadrícula de horarios de un día. Cada horario es libre (se puede elegir), ocupado (otra cita) o no disponible (fuera
 * de horario, ausencia o no cabe el servicio). El estado va en el texto accesible y en la etiqueta, no solo en el color.
 */
export function SlotGrid({ slots, value, onChange }: SlotGridProps) {
  const { colors, language, t } = useSettings();
  return (
    <View style={styles.grid} accessibilityRole="radiogroup">
      {slots.map((slot) => {
        const selected = value === slot.startsAt;
        const free = slot.state === 'available';
        const clock = formatClock(slot.time, language);
        const stateLabel = t(`slot_${slot.state}`);
        return (
          <Pressable
            key={slot.startsAt}
            accessibilityRole="radio"
            accessibilityLabel={free ? clock : `${clock}, ${stateLabel}`}
            accessibilityState={{ checked: selected, disabled: !free }}
            disabled={!free}
            onPress={() => onChange(slot)}
            style={[
              styles.slot,
              { borderColor: selected ? colors.gold : colors.border, backgroundColor: selected ? colors.gold : free ? colors.surface : 'transparent', opacity: free ? 1 : 0.55 },
            ]}>
            <AppText variant="bodyStrong" style={{ color: selected ? colors.onGold : colors.text, textDecorationLine: free ? 'none' : 'line-through' }}>
              {clock}
            </AppText>
            {!free ? (
              <AppText variant="small" tone="muted">
                {stateLabel}
              </AppText>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  slot: { minWidth: 92, minHeight: 48, borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: 6, alignItems: 'center', justifyContent: 'center' },
});
