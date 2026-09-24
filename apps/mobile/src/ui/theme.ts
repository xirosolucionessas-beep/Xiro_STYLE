import type { ThemeMode } from '@xiro/shared';

export interface Palette {
  background: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  textMuted: string;
  gold: string;
  goldSoft: string;
  goldTint: string;
  onGold: string;
  danger: string;
  success: string;
  warning: string;
  overlay: string;
}

export const palettes: Record<ThemeMode, Palette> = {
  dark: {
    background: '#0d0d0f',
    surface: '#1a1a1d',
    surfaceAlt: '#24221d',
    border: '#37342b',
    text: '#ffffff',
    textMuted: '#b9b3a7',
    gold: '#d9b636',
    goldSoft: '#f6de86',
    goldTint: 'rgba(217,182,54,0.14)',
    onGold: '#17130a',
    danger: '#e56565',
    success: '#53c878',
    warning: '#f2c94c',
    overlay: 'rgba(0,0,0,0.6)',
  },
  light: {
    background: '#faf8f2',
    surface: '#ffffff',
    surfaceAlt: '#f3efe3',
    border: '#e2dccb',
    text: '#1a160a',
    textMuted: '#6d6656',
    gold: '#a8871a',
    goldSoft: '#d9b636',
    goldTint: 'rgba(168,135,26,0.12)',
    onGold: '#ffffff',
    danger: '#c53d3d',
    success: '#2f9e57',
    warning: '#b98a00',
    overlay: 'rgba(0,0,0,0.4)',
  },
};

export const radius = { sm: 10, md: 14, lg: 18, xl: 24, pill: 999 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const MAX_CONTENT_WIDTH = 720;
