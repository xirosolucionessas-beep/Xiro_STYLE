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
    heroOverlay: ['rgba(13,13,15,0.62)', 'rgba(13,13,15,0.18)', 'rgba(13,13,15,0.6)', '#0d0d0f'],
    heroFallback: ['#3d3110', '#1c170a', '#0d0d0f'],
    onHeroPhoto: '#ffffff',
    onHeroPhotoMuted: 'rgba(255,255,255,0.82)',
    heroAccentPhoto: '#e6c552',
    onHeroFallback: '#ffffff',
    onHeroFallbackMuted: 'rgba(255,255,255,0.78)',
    cardBorder: ['#f6de86', '#7a5f14'],
    cardFill: ['#221e12', '#131313'],
    fab: ['#f6de86', '#c9a227'],
    glow: '#d9b636',
    tabBorder: 'rgba(217,182,54,0.35)',
    badge: { urgent: '#e5484d', warning: '#f2c94c', info: '#d9b636', text: '#17130a' },
  },
  light: {
    heroOverlay: ['rgba(26,22,10,0.6)', 'rgba(26,22,10,0.2)', 'rgba(26,22,10,0.55)', '#faf8f2'],
    heroFallback: ['#f1dc93', '#f7ecc6', '#faf8f2'],
    onHeroPhoto: '#ffffff',
    onHeroPhotoMuted: 'rgba(255,255,255,0.88)',
    heroAccentPhoto: '#f3d76b',
    onHeroFallback: '#1a160a',
    onHeroFallbackMuted: '#5d5640',
    cardBorder: ['#d9b636', '#a8871a'],
    cardFill: ['#ffffff', '#f6f1e0'],
    fab: ['#e6c552', '#a8871a'],
    glow: '#a8871a',
    tabBorder: 'rgba(168,135,26,0.4)',
    badge: { urgent: '#c53d3d', warning: '#b98a00', info: '#a8871a', text: '#ffffff' },
  },
};

export function useLuxury(): LuxuryTokens {
  return luxury[useSettings().theme];
}
