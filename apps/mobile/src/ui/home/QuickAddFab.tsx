import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
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
}

const SIZE = 60;

/**
 * Botón flotante "+" con un menú corto de acciones que llevan a pantallas que ya existen. Se ancla abajo a la derecha del
 * contenedor de la pestaña (por encima de la barra inferior); la pantalla deja espacio al final del scroll para que
 * nunca tape el último elemento. Si la persona no puede crear nada, no se muestra.
 */
export function QuickAddFab({ actions, label, bottom = 18 }: { actions: FabAction[]; label: string; bottom?: number }) {
  const { colors } = useSettings();
  const tk = useLuxury();
  const [open, setOpen] = useState(false);
  if (actions.length === 0) return null;

  return (
    <>
      {open ? <Pressable accessibilityRole="button" accessibilityLabel={label} style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} /> : null}
      <View pointerEvents="box-none" style={[styles.wrap, { bottom }]}>
        {open ? (
          <View style={styles.menu}>
            {actions.map((action) => (
              <Pressable
                key={action.id}
                accessibilityRole="button"
                accessibilityLabel={action.label}
                onPress={() => {
                  setOpen(false);
                  action.onPress();
                }}
                style={[styles.action, { backgroundColor: colors.surface, borderColor: colors.gold }]}>
                <Ionicons name={action.icon} size={20} color={colors.gold} />
                <AppText variant="bodyStrong">{action.label}</AppText>
              </Pressable>
            ))}
          </View>
        ) : null}
        <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ expanded: open }} onPress={() => setOpen((value) => !value)} hitSlop={6} style={{ width: SIZE, height: SIZE }}>
          <LinearGradient colors={tk.fab} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.fab, Platform.OS === 'ios' && { shadowColor: tk.glow, shadowOpacity: 0.45, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } }]}>
            <Ionicons name={open ? 'close' : 'add'} size={32} color="#17130a" />
          </LinearGradient>
        </Pressable>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', right: 18, alignItems: 'flex-end' },
  menu: { alignItems: 'flex-end', gap: 10, marginBottom: 12 },
  fab: { width: SIZE, height: SIZE, borderRadius: SIZE / 2, alignItems: 'center', justifyContent: 'center' },
  action: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, borderRadius: radius.pill, borderWidth: 1, paddingHorizontal: 16 },
});
