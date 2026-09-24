/**
 * Variante WEB de src/ui/Kit.tsx. Mismo API que la nativa; cambia solo la semántica:
 *  - Chip: role="radio" + aria-checked (antes: botón sin estado seleccionado). El agrupamiento en radiogroup con
 *    tabulación "roving" y flechas lo aplica src/web/shell/formEnhance.ts.
 *  - ChipRow: radiogroup con `label` (nombre accesible) y opciones que hacen wrap en vez de scroll horizontal.
 *  - SectionTitle: encabezado real (h2). EmptyState: componente del kit web con encabezado.
 * El resto es idéntico a Kit.tsx; test/variants.parity.test.ts falla si las exportaciones dejan de coincidir.
 */
import { Ionicons } from '@expo/vector-icons';
import type { StockStatus } from '@xiro/shared';
import { Image } from 'expo-image';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Switch, View, type StyleProp, type ViewStyle } from 'react-native';
import { resolveMedia } from '@/lib/api';
import { useSettings } from '@/lib/settings';
import { EmptyState as WebEmptyState } from '@/web/ui';
import { AppText } from './Text';
import { radius } from './theme';

/* ---------- Chip ---------- */

export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress: () => void }) {
  const { colors } = useSettings();
  return (
    <Pressable
      role="radio"
      aria-checked={!!selected}
      onPress={onPress}
      style={[styles.chip, { borderColor: selected ? colors.gold : colors.border, backgroundColor: selected ? colors.goldTint : 'transparent' }]}>
      <AppText variant="small" tone={selected ? 'gold' : 'muted'} style={{ fontWeight: selected ? '800' : '500' }}>
        {label}
      </AppText>
    </Pressable>
  );
}

/** Grupo de opciones: radiogroup con nombre accesible. En web las opciones se reparten en varias líneas (sin scroll horizontal). */
export function ChipRow({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <View role="radiogroup" aria-label={label} style={styles.chipRow}>
      {children}
    </View>
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
    <AppText role="heading" aria-level={2} variant="label" tone="gold" style={styles.section}>
      {children.toUpperCase()}
    </AppText>
  );
}

export function Row({ icon, label, value, onPress, tone, right }: { icon?: keyof typeof Ionicons.glyphMap; label: string; value?: string; onPress?: () => void; tone?: 'danger'; right?: ReactNode }) {
  const { colors } = useSettings();
  const content = (
    <View style={styles.row}>
      {icon ? (
        <View style={[styles.rowIcon, { backgroundColor: tone === 'danger' ? 'rgba(229,101,101,0.14)' : colors.goldTint }]}>
          <Ionicons name={icon} size={19} color={tone === 'danger' ? colors.danger : colors.gold} />
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

export function Photo({ url, size, style, icon = 'cube-outline' }: { url?: string | null; size?: number; style?: StyleProp<ViewStyle>; icon?: keyof typeof Ionicons.glyphMap }) {
  const { colors } = useSettings();
  const [failed, setFailed] = useState(false);
  const source = resolveMedia(url);
  const box = size ? { width: size, height: size } : { width: '100%' as const, aspectRatio: 4 / 3 };
  return (
    <View style={[styles.photo, box, { backgroundColor: colors.surfaceAlt }, style]}>
      {source && !failed ? (
        <Image source={{ uri: source }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} onError={() => setFailed(true)} />
      ) : (
        <Ionicons name={icon} size={size ? size / 2.4 : 40} color={colors.gold} />
      )}
    </View>
  );
}

/** Estado vacío del kit web: título como encabezado real (h2) e icono decorativo. */
export function EmptyState({ icon, message }: { icon: keyof typeof Ionicons.glyphMap; message: string }) {
  const { colors } = useSettings();
  return <WebEmptyState title={message} headingLevel={2} icon={<Ionicons name={icon} size={46} color={colors.gold} style={{ opacity: 0.6 }} />} />;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  chip: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 8, minHeight: 44, justifyContent: 'center' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingVertical: 4 },
  card: { borderWidth: 1, borderRadius: radius.lg, padding: 16 },
  section: { marginTop: 22, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  rowIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  photo: { borderRadius: radius.md, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
});
