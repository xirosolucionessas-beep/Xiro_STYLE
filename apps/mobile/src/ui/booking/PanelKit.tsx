import type { ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSettings } from '@/lib/settings';
import { Button as BaseButton } from '../Button';
import { Row, Toggle } from '../Kit';
import { AppText } from '../Text';

/**
 * Piezas visuales de "Mi página web" (rediseño solo de presentación). Mismos nombres y props que las de `Kit` —las pestañas
 * solo cambian de dónde las importan—, sin tocar estados, consultas ni eventos. El resto de la app sigue usando `Kit` tal cual.
 *  - Opciones: fondo suave sin contorno; la elegida, con un tinte dorado y el texto en el tono de la marca.
 *  - Tarjetas: superficie pulida con borde casi invisible y esquinas amplias; en claro, una sombra muy leve.
 */
const isWeb = Platform.OS === 'web';

/** Tonos que dependen del tema (en oscuro, blanco translúcido; en claro, negro translúcido). */
function useTones() {
  const { colors, theme } = useSettings();
  const dark = theme === 'dark';
  return {
    colors,
    dark,
    optionBg: dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
    optionPressed: dark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.07)',
    hairline: dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
  };
}

/** Marca la pantalla para el estilo web acotado (ver web/styles.ts, [data-xp-panel='booking']). */
export const PANEL_SCOPE = { dataSet: { xpPanel: 'booking' } } as object;

type ButtonProps = Parameters<typeof BaseButton>[0];

export function Button(props: ButtonProps) {
  const { colors, optionBg } = useTones();
  const variant = props.variant ?? 'primary';
  const soft: StyleProp<ViewStyle> =
    variant === 'secondary' ? { borderWidth: 0, backgroundColor: optionBg, borderRadius: 12 } : variant === 'danger' ? { borderWidth: 0, backgroundColor: `${colors.danger}1F`, borderRadius: 12 } : { borderRadius: 12 };
  return <BaseButton {...props} style={isWeb ? props.style : [soft, props.style]} />;
}

export function Chip({ label, selected, onPress, icon }: { label: string; selected?: boolean; onPress: () => void; icon?: ReactNode }) {
  const { colors, optionBg, optionPressed } = useTones();
  // En la web, el grupo es un radiogroup (como en Kit.web); en el teléfono, un botón con estado "seleccionado".
  const a11y = isWeb ? ({ role: 'radio', 'aria-checked': !!selected } as object) : { accessibilityRole: 'button' as const, accessibilityState: { selected: !!selected } };
  return (
    <Pressable
      {...a11y}
      onPress={onPress}
      style={({ pressed }) => [styles.option, { backgroundColor: selected ? colors.goldTint : pressed ? optionPressed : optionBg }, icon ? styles.optionWithIcon : null]}>
      {icon}
      <AppText variant="small" style={[styles.optionText, { color: selected ? colors.gold : colors.text, fontWeight: selected ? '700' : '500' }]}>
        {label}
      </AppText>
    </Pressable>
  );
}

export function ChipRow({ children, label }: { children: ReactNode; label?: string }) {
  const group = isWeb ? ({ role: 'radiogroup', 'aria-label': label } as object) : { accessibilityLabel: label };
  return (
    <View {...group} style={styles.optionRow}>
      {children}
    </View>
  );
}

export function Card({ children, style, onPress }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void }) {
  const { colors, dark, hairline } = useTones();
  const base = [styles.card, { backgroundColor: colors.surface, borderColor: hairline }, !dark && styles.cardShadow, style];
  if (!onPress) return <View style={base}>{children}</View>;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [base, pressed && { opacity: 0.88 }]}>
      {children}
    </Pressable>
  );
}

export function SectionTitle({ children }: { children: string }) {
  const heading = isWeb ? ({ role: 'heading', 'aria-level': 2 } as object) : { accessibilityRole: 'header' as const };
  return (
    <AppText {...heading} variant="bodyStrong" style={styles.sectionTitle}>
      {children}
    </AppText>
  );
}

export function ToggleRow({ label, value, onChange, icon }: { label: string; value: boolean; onChange: (next: boolean) => void; icon?: Parameters<typeof Row>[0]['icon'] }) {
  return <Row icon={icon} label={label} right={<Toggle value={value} onChange={onChange} label={label} />} />;
}

/**
 * Un bloque de ajustes en su propia tarjeta: título, explicación breve y el control (opciones, interruptores…). Solo agrupa
 * visualmente lo que antes iba suelto; no cambia qué se muestra ni cuándo.
 */
export function SettingSection({ title, hint, children, footer }: { title: string; hint?: string; children: ReactNode; footer?: ReactNode }) {
  const heading = isWeb ? ({ role: 'heading', 'aria-level': 2 } as object) : { accessibilityRole: 'header' as const };
  return (
    <Card style={styles.section}>
      <View style={styles.sectionHead}>
        <AppText {...heading} variant="bodyStrong">
          {title}
        </AppText>
        {hint ? (
          <AppText variant="small" tone="muted" style={styles.hint}>
            {hint}
          </AppText>
        ) : null}
      </View>
      {children}
      {footer ? <View style={styles.sectionFooter}>{footer}</View> : null}
    </Card>
  );
}

/** Texto de ayuda bajo un interruptor dentro de una tarjeta (mismo tono, mejor respiro). */
export function Hint({ children }: { children: ReactNode }) {
  return (
    <AppText variant="small" tone="muted" style={styles.toggleHint}>
      {children}
    </AppText>
  );
}

const styles = StyleSheet.create({
  option: { minHeight: 40, justifyContent: 'center', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9 },
  optionWithIcon: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  optionText: { fontSize: 13.5, lineHeight: 18 },
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingVertical: 2 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: 18, gap: 6 },
  cardShadow: { shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 1 },
  sectionTitle: { fontSize: 16, marginTop: 28, marginBottom: 12, letterSpacing: 0.2 },
  section: { marginBottom: 12, gap: 14 },
  sectionHead: { gap: 4 },
  sectionFooter: { marginTop: 2 },
  hint: { lineHeight: 18 },
  toggleHint: { lineHeight: 18, marginTop: -4 },
});
