/**
 * Variante WEB de src/ui/theme.ts (Metro la elige solo en web; nativo sigue usando theme.ts).
 * Mantiene la misma forma para que las pantallas compartidas no cambien, pero con los tokens AA de src/web/tokens.ts.
 */
import type { ThemeMode } from '@xiro/shared';
import { colors, type ColorTokens } from '@/web/tokens';
import type * as NativeTheme from './theme';

function toPalette(token: ColorTokens): NativeTheme.Palette {
  return {
    background: token.background,
    surface: token.surface,
    surfaceAlt: token.surfaceAlt,
    border: token.border,
    text: token.text,
    textMuted: token.textMuted,
    gold: token.accent,
    goldSoft: token.accent,
    goldTint: token.accentTint,
    onGold: token.onAccent,
    danger: token.danger,
    success: token.success,
    warning: token.warning,
    overlay: token.overlay,
  };
}

export const palettes: Record<ThemeMode, NativeTheme.Palette> = {
  dark: toPalette(colors.dark),
  light: toPalette(colors.light),
};

export const radius = { sm: 10, md: 14, lg: 18, xl: 24, pill: 999 } as const satisfies typeof NativeTheme.radius;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const satisfies typeof NativeTheme.space;
export const MAX_CONTENT_WIDTH = 720;
export type Palette = NativeTheme.Palette;
