import type { ThemeMode } from '@xiro/shared';
import { useSettings } from '@/lib/settings';

/**
 * Tokens del diseño "lujo oscuro" del Inicio nativo: degradados dorados, superficies elevadas y colores de insignias,
 * con su equivalente en modo claro. Viven aparte de la paleta base (theme.ts) para no alterar el resto de la app ni la
 * Web, y se leen con `useLuxury()`: ningún componente lleva colores fijos.
 */
export interface LuxuryTokens {
  /** Degradado sobre la foto del negocio (de arriba abajo): oscurece para leer el texto y se funde con el fondo. */
  heroOverlay: readonly [string, string, string, string];
  /** Fondo del hero cuando el negocio no tiene foto. */
  heroFallback: readonly [string, string, string];
  /** Texto sobre la foto (siempre claro: la foto lleva degradado oscuro) y sobre el fondo de respaldo. */
  onHeroPhoto: string;
  onHeroPhotoMuted: string;
  /** Dorado del nombre del negocio sobre la foto (más claro que el dorado base en modo claro, para contrastar con el degradado oscuro). */
  heroAccentPhoto: string;
  onHeroFallback: string;
  onHeroFallbackMuted: string;
  /** Borde dorado degradado y relleno sutil de las tarjetas. */
  cardBorder: readonly [string, string];
  cardFill: readonly [string, string];
  /** Botón flotante "+". */
  fab: readonly [string, string];
  /** Brillo suave (sombra en iOS; en Android se evita la elevación pesada). */
  glow: string;
  /** Borde superior de la barra de pestañas y su indicador activo. */
  tabBorder: string;
  badge: { urgent: string; warning: string; info: string; text: string };
}

export const luxury: Record<ThemeMode, LuxuryTokens> = {
  dark: {
    heroOverlay: ['rgba(21,19,15,0.62)', 'rgba(21,19,15,0.18)', 'rgba(21,19,15,0.6)', '#15130f'],
    heroFallback: ['#3a2f1c', '#201a10', '#15130f'],
    onHeroPhoto: '#ffffff',
    onHeroPhotoMuted: 'rgba(255,255,255,0.82)',
    heroAccentPhoto: '#e0c08f',
    onHeroFallback: '#ffffff',
    onHeroFallbackMuted: 'rgba(255,255,255,0.78)',
    cardBorder: ['#e0c08f', '#8a6d34'],
    cardFill: ['#241f16', '#181511'],
    fab: ['#e0c08f', '#b38f4e'],
    glow: '#cda668',
    tabBorder: 'rgba(205,166,104,0.35)',
    badge: { urgent: '#e2766a', warning: '#e08a4e', info: '#cda668', text: '#1a1510' },
  },
  light: {
    heroOverlay: ['rgba(32,27,20,0.6)', 'rgba(32,27,20,0.2)', 'rgba(32,27,20,0.55)', '#f6f2e9'],
    heroFallback: ['#e9d4a0', '#f1e6c9', '#f6f2e9'],
    onHeroPhoto: '#ffffff',
    onHeroPhotoMuted: 'rgba(255,255,255,0.88)',
    heroAccentPhoto: '#ecd7a4',
    onHeroFallback: '#201b14',
    onHeroFallbackMuted: '#59513f',
    cardBorder: ['#cda668', '#8a6d1e'],
    cardFill: ['#ffffff', '#f3ecda'],
    fab: ['#d9b878', '#8a6d1e'],
    glow: '#7a5c12',
    tabBorder: 'rgba(122,92,18,0.4)',
    badge: { urgent: '#ad3527', warning: '#954b10', info: '#7a5c12', text: '#ffffff' },
  },
};

export function useLuxury(): LuxuryTokens {
  return luxury[useSettings().theme];
}
