/** Variante WEB de src/ui/Button.tsx: un <button> real del kit (foco visible, 44px, aria-busy). Mismo API que la nativa. */
import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { useSettings } from '@/lib/settings';
import { tw } from '@/web/shell/strings';
import { Button as WebButton } from '@/web/ui';
import type * as Native from './Button';
import { rnStyleToCss } from './rnStyle.web';

type ButtonProps = ComponentProps<typeof Native.Button>;

export function Button({ label, onPress, variant = 'primary', icon, loading, disabled, style, compact }: ButtonProps) {
  const { language } = useSettings();
  return (
    <WebButton
      variant={variant}
      size={compact ? 'sm' : 'md'}
      icon={icon ? <Ionicons name={icon} size={18} color="currentColor" /> : undefined}
      loading={loading}
      loadingLabel={tw(language, 'loading')}
      disabled={disabled}
      onPress={onPress}
      style={rnStyleToCss(style)}>
      {label}
    </WebButton>
  );
}
