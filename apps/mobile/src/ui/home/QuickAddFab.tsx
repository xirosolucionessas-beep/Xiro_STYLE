import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSettings } from '@/lib/settings';
import { AppText } from '../Text';
import { useLuxury } from '../luxuryTokens';
import { radius } from '../theme';

export interface FabAction {
  id: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  /** Acción principal: va en dorado y es la más cercana al botón (al alcance del pulgar). */
  primary?: boolean;
}

const SIZE = 60;

/**
 * Botón flotante "+" con un menú corto de acciones que llevan a pantallas que ya existen. Se ancla abajo a la derecha del
 * contenedor de la pestaña (por encima de la barra inferior); la pantalla deja espacio al final del scroll para que
 * nunca tape el último elemento. `above` se apila encima del "+" (p. ej. el botón del asistente de IA) y se oculta
 * mientras el menú está abierto, para que nunca se superpongan. Si la persona no puede crear nada, no hay "+".
 */
export function QuickAddFab({ actions, label, bottom = 18, above }: { actions: FabAction[]; label: string; bottom?: number; above?: ReactNode }) {
  const { colors } = useSettings();
  const tk = useLuxury();
  const [open, setOpen] = useState(false);
  if (actions.length === 0 && !above) return null;
  // La principal queda al final de la columna: es la que queda junto al "+".
  const ordered = [...actions.filter((action) => !action.primary), ...actions.filter((action) => action.primary)];

  return (
    <>
      {open ? <Pressable accessibilityRole="button" accessibilityLabel={label} style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} /> : null}
      <View pointerEvents="box-none" style={[styles.wrap, { bottom }]}>
        {open ? (
          <View style={styles.menu}>
            {ordered.map((action) => (
              <Pressable
                key={action.id}
                accessibilityRole="button"
                accessibilityLabel={action.label}
                onPress={() => {
                  setOpen(false);
                  action.onPress();
                }}
                style={[styles.action, action.primary ? { backgroundColor: colors.gold, borderColor: colors.gold } : { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Ionicons name={action.icon} size={20} color={action.primary ? colors.onGold : colors.text} />
                <AppText variant="bodyStrong" tone={action.primary ? 'onGold' : 'text'}>
                  {action.label}
                </AppText>
              </Pressable>
            ))}
          </View>
        ) : (
          above
        )}
        {actions.length > 0 ? (
          <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ expanded: open }} onPress={() => setOpen((value) => !value)} hitSlop={6} style={{ width: SIZE, height: SIZE }}>
            <LinearGradient colors={tk.fab} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.fab, Platform.OS === 'ios' && { shadowColor: tk.glow, shadowOpacity: 0.45, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } }]}>
              <Ionicons name={open ? 'close' : 'add'} size={32} color="#17130a" />
            </LinearGradient>
          </Pressable>
        ) : null}
      </View>
    </>
  );
}

/** Botón redondo secundario de la pila flotante (asistente de IA): más pequeño que el "+" y con borde dorado. */
export function FabSecondary({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  const { colors } = useSettings();
  const tk = useLuxury();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      style={[styles.secondary, { backgroundColor: colors.surface, borderColor: colors.gold }, Platform.OS === 'ios' && { shadowColor: tk.glow, shadowOpacity: 0.35, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } }]}>
      <Ionicons name={icon} size={24} color={colors.gold} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', right: 18, alignItems: 'flex-end', gap: 14 },
  menu: { alignItems: 'flex-end', gap: 10 },
  fab: { width: SIZE, height: SIZE, borderRadius: SIZE / 2, alignItems: 'center', justifyContent: 'center' },
  action: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, borderRadius: radius.pill, borderWidth: 1, paddingHorizontal: 16 },
  secondary: { width: 52, height: 52, borderRadius: 26, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', marginRight: 4, elevation: 4 },
});
