import { Ionicons } from '@expo/vector-icons';
import type { StockStatus } from '@xiro/shared';
import { Image } from 'expo-image';
import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, View, type StyleProp, type ViewStyle } from 'react-native';
import { resolveMedia } from '@/lib/api';
import { useSettings } from '@/lib/settings';
import { AppText } from './Text';
import { radius } from './theme';

/* ---------- Chip ---------- */

export function Chip({ label, selected, onPress, icon }: { label: string; selected?: boolean; onPress: () => void; /** Ícono o logo opcional antes del texto (p. ej. la forma de pago). */ icon?: ReactNode }) {
  const { colors } = useSettings();
  // Seleccionado = superficie elevada + texto fuerte (no el color de acento: ese es para la acción primaria, el foco y la marca).
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      style={[styles.chip, { borderColor: selected ? colors.border : colors.border, backgroundColor: selected ? colors.surfaceAlt : 'transparent' }, icon ? styles.chipWithIcon : null]}>
      {icon}
      <AppText variant="small" tone={selected ? 'text' : 'muted'} style={{ fontWeight: selected ? '700' : '500' }}>
        {label}
      </AppText>
    </Pressable>
  );
}

/** `label`: nombre accesible del grupo de opciones. Solo lo usa la versión web (Kit.web.tsx); en nativo no tiene efecto. */
export function ChipRow({ children }: { children: ReactNode; label?: string }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
      {children}
    </ScrollView>
  );
}

/* ---------- Card / Section ---------- */

export function Card({ children, style, onPress }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void }) {
  const { colors } = useSettings();
  const base = [styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, style];
  if (!onPress) return <View style={base}>{children}</View>;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [base, pressed && { opacity: 0.85 }]}>
      {children}
    </Pressable>
  );
}

export function SectionTitle({ children }: { children: string }) {
  return (
    <AppText variant="bodyStrong" tone="text" style={styles.section}>
      {children}
    </AppText>
  );
}

export function Row({ icon, label, value, onPress, tone, right }: { icon?: keyof typeof Ionicons.glyphMap; label: string; value?: string; onPress?: () => void; tone?: 'danger'; right?: ReactNode }) {
  const { colors } = useSettings();
  const content = (
    <View style={styles.row}>
      {icon ? (
        <View style={styles.rowIcon}>
          <Ionicons name={icon} size={19} color={tone === 'danger' ? colors.danger : colors.textMuted} />
        </View>
      ) : null}
      <View style={styles.flex}>
        <AppText variant="bodyStrong" tone={tone === 'danger' ? 'danger' : 'text'}>
          {label}
        </AppText>
        {value ? (
          <AppText variant="small" tone="muted" numberOfLines={2}>
            {value}
          </AppText>
        ) : null}
      </View>
      {right ?? (onPress ? <Ionicons name="chevron-forward" size={18} color={colors.textMuted} /> : null)}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => pressed && { opacity: 0.8 }}>
      {content}
    </Pressable>
  );
}

/** Interruptor con los colores de la marca (activeThumbColor solo lo lee react-native-web). */
export function Toggle({ value, onChange, label }: { value: boolean; onChange: (next: boolean) => void; label: string }) {
  const { colors } = useSettings();
  const webProps = { activeThumbColor: '#ffffff' } as object;
  return <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.gold, false: colors.border }} thumbColor="#ffffff" accessibilityLabel={label} {...webProps} />;
}

export function ToggleRow({ label, value, onChange, icon }: { label: string; value: boolean; onChange: (next: boolean) => void; icon?: keyof typeof Ionicons.glyphMap }) {
  return <Row icon={icon} label={label} right={<Toggle value={value} onChange={onChange} label={label} />} />;
}

/* ---------- Estado de stock ---------- */

export function stockColor(status: StockStatus, colors: { success: string; warning: string; danger: string }): string {
  return status === 'available' ? colors.success : status === 'reorder' ? colors.warning : colors.danger;
}

export function StatusPill({ status }: { status: StockStatus }) {
  const { colors, t } = useSettings();
  const color = stockColor(status, colors);
  return (
    <View style={[styles.pill, { borderColor: color, backgroundColor: `${color}26` }]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <AppText variant="small" style={{ color, fontWeight: '800' }}>
        {t(`status_${status}`)}
      </AppText>
    </View>
  );
}

/* ---------- Imágenes ---------- */

/**
 * `initials`: para una persona (empleado, cliente) en vez del ícono genérico — si se da y no hay foto (o falla al
 * cargar), se muestra la inicial de su nombre en lugar de `icon`. 100% opcional: sin foto ni initials, sigue
 * mostrando el ícono de siempre.
 */
export function Photo({ url, size, style, icon = 'cube-outline', initials }: { url?: string | null; size?: number; style?: StyleProp<ViewStyle>; icon?: keyof typeof Ionicons.glyphMap; initials?: string }) {
  const { colors } = useSettings();
  const [failed, setFailed] = useState(false);
  // Una foto nueva (p. ej. tras subir otra) merece su propio intento, no el fallo de la anterior — se ajusta durante
  // el render (patrón recomendado por React) en vez de un efecto, para no disparar una vuelta de render de más.
  const [lastUrl, setLastUrl] = useState(url);
  if (url !== lastUrl) {
    setLastUrl(url);
    setFailed(false);
  }
  const source = resolveMedia(url);
  const box = size ? { width: size, height: size } : { width: '100%' as const, aspectRatio: 4 / 3 };
  const initial = initials?.trim().charAt(0).toUpperCase();
  return (
    <View style={[styles.photo, box, { backgroundColor: colors.surfaceAlt }, style]}>
      {source && !failed ? (
        <Image source={{ uri: source }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} onError={() => setFailed(true)} />
      ) : initial ? (
        <AppText style={{ color: colors.gold, fontSize: size ? size * 0.4 : 24, fontWeight: '800' }}>{initial}</AppText>
      ) : (
        <Ionicons name={icon} size={size ? size / 2.4 : 40} color={colors.gold} />
      )}
    </View>
  );
}

export function EmptyState({ icon, message }: { icon: keyof typeof Ionicons.glyphMap; message: string }) {
  const { colors } = useSettings();
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={46} color={colors.textMuted} style={{ opacity: 0.6 }} />
      <AppText tone="muted" center style={{ marginTop: 10 }}>
        {message}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  chip: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 8 },
  chipWithIcon: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chipRow: { gap: 8, paddingVertical: 4, paddingRight: 8 },
  card: { borderWidth: 1, borderRadius: radius.lg, padding: 16 },
  section: { marginTop: 22, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  rowIcon: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  photo: { borderRadius: radius.md, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', paddingVertical: 48 },
});
