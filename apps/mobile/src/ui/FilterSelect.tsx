import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { FlatList, Modal, Pressable, View } from 'react-native';
import { useSettings } from '@/lib/settings';
import { AppText } from './Text';
import { radius, space } from './theme';

export interface FilterSelectOption<T extends string> {
  value: T;
  label: string;
}

/**
 * Selector compacto de un solo valor (fecha, tipo, categoría…): un botón angosto con la opción elegida, que abre una
 * lista corta para cambiarla — en vez de una fila larga de chips, uno por opción. Mismo contrato en Android, iOS y
 * web; pensado para varios en fila en pantallas anchas (el contenedor que lo use decide el `flexWrap`).
 */
export function FilterSelect<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: ReadonlyArray<FilterSelectOption<T>>; onChange: (next: T) => void }) {
  const { colors } = useSettings();
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);

  return (
    <View style={{ minWidth: 150, flexGrow: 1, flexBasis: 150 }}>
      <AppText variant="label" tone="muted" style={{ marginBottom: 4 }}>
        {label}
      </AppText>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${current?.label ?? ''}`}
        onPress={() => setOpen(true)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          minHeight: 44,
          paddingHorizontal: space.md,
          borderRadius: radius.md,
          borderWidth: 1.5,
          borderColor: colors.border,
          backgroundColor: colors.surface,
        }}>
        <AppText numberOfLines={1} style={{ flex: 1 }}>
          {current?.label ?? ''}
        </AppText>
        <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: space.xl }}
          onPress={() => setOpen(false)}>
          {/* onStartShouldSetResponder: toca DENTRO de la tarjeta no cierra (solo el fondo), sin que React Native "burbujee" el onPress del Pressable de afuera. */}
          <View onStartShouldSetResponder={() => true} style={{ backgroundColor: colors.surface, borderRadius: radius.lg, maxHeight: '70%', overflow: 'hidden', borderWidth: 1, borderColor: colors.border }}>
            <AppText variant="bodyStrong" style={{ padding: space.lg, paddingBottom: space.sm }}>
              {label}
            </AppText>
            <FlatList
              data={options}
              keyExtractor={(o) => o.value}
              renderItem={({ item }) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: item.value === value }}
                  onPress={() => {
                    onChange(item.value);
                    setOpen(false);
                  }}
                  style={{ paddingVertical: space.md, paddingHorizontal: space.lg, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <AppText tone={item.value === value ? 'gold' : 'text'} numberOfLines={1} style={{ flex: 1 }}>
                    {item.label}
                  </AppText>
                  {item.value === value ? <Ionicons name="checkmark" size={18} color={colors.gold} /> : null}
                </Pressable>
              )}
            />
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}
