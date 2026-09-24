import { Text as RNText, type TextProps, type TextStyle } from 'react-native';
import { useSettings } from '@/lib/settings';
import type { Palette } from './theme';

type Variant = 'display' | 'title' | 'heading' | 'body' | 'bodyStrong' | 'small' | 'label';
type Tone = 'text' | 'muted' | 'gold' | 'danger' | 'success' | 'onGold';

const variants: Record<Variant, TextStyle> = {
  display: { fontSize: 30, fontWeight: '800', lineHeight: 36 },
  title: { fontSize: 24, fontWeight: '800', lineHeight: 30 },
  heading: { fontSize: 17, fontWeight: '700', lineHeight: 23 },
  body: { fontSize: 15, fontWeight: '400', lineHeight: 21 },
  bodyStrong: { fontSize: 15, fontWeight: '700', lineHeight: 21 },
  small: { fontSize: 12.5, fontWeight: '400', lineHeight: 17 },
  label: { fontSize: 12, fontWeight: '700', lineHeight: 16, letterSpacing: 0.3 },
};

const toneKey: Record<Tone, keyof Palette> = {
  text: 'text',
  muted: 'textMuted',
  gold: 'gold',
  danger: 'danger',
  success: 'success',
  onGold: 'onGold',
};

export interface AppTextProps extends TextProps {
  variant?: Variant;
  tone?: Tone;
  center?: boolean;
}

export function AppText({ variant = 'body', tone = 'text', center, style, ...props }: AppTextProps) {
  const { colors } = useSettings();
  return <RNText {...props} style={[variants[variant], { color: colors[toneKey[tone]] }, center && { textAlign: 'center' }, style]} />;
}
