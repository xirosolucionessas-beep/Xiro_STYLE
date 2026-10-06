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
    background: '#15130f',
    surface: '#1c1914',
    surfaceAlt: '#272019',
    border: '#39332b',
    text: '#f3eee3',
    textMuted: '#b7ad9b',
    gold: '#cda668',
    goldSoft: '#e0c08f',
    goldTint: 'rgba(205,166,104,0.14)',
    onGold: '#1a1510',
    danger: '#e2766a',
    success: '#5fb37e',
    warning: '#e08a4e',
    overlay: 'rgba(0,0,0,0.6)',
  },
  light: {
    background: '#f6f2e9',
    surface: '#ffffff',
    surfaceAlt: '#f0e9db',
    border: '#e3dbc8',
    text: '#201b14',
    textMuted: '#685f4f',
    gold: '#7a5c12',
    goldSoft: '#cda668',
    goldTint: 'rgba(122,92,18,0.12)',
    onGold: '#ffffff',
    danger: '#ad3527',
    success: '#176b3a',
    warning: '#954b10',
    overlay: 'rgba(0,0,0,0.4)',
  },
};

export const radius = { sm: 10, md: 14, lg: 18, xl: 24, pill: 999 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const MAX_CONTENT_WIDTH = 720;
