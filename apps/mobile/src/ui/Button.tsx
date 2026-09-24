import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSettings } from '@/lib/settings';
import { AppText } from './Text';
import { radius } from './theme';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  icon?: keyof typeof Ionicons.glyphMap;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  compact?: boolean;
}

export function Button({ label, onPress, variant = 'primary', icon, loading, disabled, style, compact }: ButtonProps) {
  const { colors } = useSettings();
  const inactive = disabled || loading;
  const palette = {
    primary: { bg: colors.gold, fg: colors.onGold, border: colors.gold },
    secondary: { bg: 'transparent', fg: colors.gold, border: colors.gold },
    ghost: { bg: 'transparent', fg: colors.textMuted, border: 'transparent' },
    danger: { bg: 'transparent', fg: colors.danger, border: colors.danger },
  }[variant];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      onPress={inactive ? undefined : onPress}
      style={({ pressed }) => [
        styles.base,
        compact && styles.compact,
        { backgroundColor: palette.bg, borderColor: palette.border, opacity: inactive ? 0.5 : pressed ? 0.85 : 1 },
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={palette.fg} />
      ) : (
        <View style={styles.content}>
          {icon ? <Ionicons name={icon} size={18} color={palette.fg} /> : null}
          <AppText variant="bodyStrong" style={{ color: palette.fg, fontWeight: '800' }}>
            {label}
          </AppText>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { minHeight: 52, borderRadius: radius.lg, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  compact: { minHeight: 42, borderRadius: radius.md, paddingHorizontal: 14 },
  content: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
