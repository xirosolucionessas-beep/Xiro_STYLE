/**
 * Marca de cada negocio en su página pública (Fase 3 del plan): a partir de UN color de acento (el que elija el negocio, o el
 * dorado por defecto) se derivan los tonos que usa la interfaz en tema claro y oscuro, GARANTIZANDO contraste WCAG 2.2 AA:
 * texto de acento ≥ 4.5:1 sobre el fondo y las tarjetas, bordes/controles ≥ 3:1, y el texto sobre un botón de acento ≥ 4.5:1.
 * Un negocio puede elegir un amarillo pálido o un azul casi negro y la página sigue siendo legible: el color de relleno se
 * respeta y solo se oscurece o aclara lo justo donde el contraste lo exige.
 */
export const DEFAULT_ACCENT = '#c5a059';
/** Texto oscuro sobre un botón de acento claro (casi negro, cálido). */
const DARK_TEXT = '#1a1510';

/** Fondos del tema "Atelier" (deben coincidir con los tokens de apps/public/src/styles.css). */
export const ATELIER_SURFACES = {
  light: { bg: '#f9f8f6', surface: '#ffffff' },
  dark: { bg: '#121212', surface: '#1c1b19' },
} as const;

export interface AccentTokens {
  /** Relleno de botones y del estado elegido (el color del negocio, ajustado solo si no se distinguiría del fondo). */
  accent: string;
  /** Texto encima de `accent`. */
  onAccent: string;
  /** Texto, íconos y precios en color de acento sobre fondo/tarjeta. */
  accentText: string;
  /** Bordes del estado elegido y anillos de foco. */
  accentBorder: string;
  /** Fondo suave del estado elegido. */
  accentTint: string;
}

type Rgb = [number, number, number];

export function parseHex(hex: string): Rgb | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const n = parseInt(match[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toHex = ([r, g, b]: Rgb) => `#${[r, g, b].map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('')}`;

function luminance([r, g, b]: Rgb): number {
  const channel = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Relación de contraste WCAG entre dos colores #rrggbb. */
export function contrastRatioHex(a: string, b: string): number {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return 1;
  const [hi, lo] = [luminance(ca), luminance(cb)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Acerca `color` a negro (claro) o a blanco (oscuro) lo MÍNIMO necesario para llegar a `min` contra todos los `backgrounds`. */
function adjustFor(color: Rgb, backgrounds: string[], min: number, toward: Rgb): string {
  for (let step = 0; step <= 40; step += 1) {
    const candidate = toHex(mix(color, toward, step / 40));
    if (backgrounds.every((bg) => contrastRatioHex(candidate, bg) >= min)) return candidate;
  }
  return toHex(toward);
}

const rgba = ([r, g, b]: Rgb, alpha: number) => `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha})`;

/**
 * Tokens de acento para cada tema. `hex` inválido o null → el dorado por defecto. Puro y determinista (mismo color, mismos
 * tokens), así el servidor y la página calculan lo mismo y se puede probar.
 */
export function brandAccent(hex: string | null | undefined): { light: AccentTokens; dark: AccentTokens } {
  const base = parseHex(hex ?? '') ?? parseHex(DEFAULT_ACCENT)!;
  const black: Rgb = [0, 0, 0];
  const white: Rgb = [255, 255, 255];
  const build = (theme: 'light' | 'dark'): AccentTokens => {
    const { bg, surface } = ATELIER_SURFACES[theme];
    const toward = theme === 'light' ? black : white;
    // El botón conserva el color del negocio salvo que no se distinga del fondo (< 3:1, p. ej. blanco en claro).
    let accent = adjustFor(base, [bg, surface], 3, toward);
    let onAccent = contrastRatioHex(DARK_TEXT, accent) >= contrastRatioHex('#ffffff', accent) ? DARK_TEXT : '#ffffff';
    // Tonos medios: si ni el texto oscuro ni el blanco llegan a 4.5:1 sobre el botón, se ajusta el relleno en la MISMA dirección
    // que ya lo separa del fondo (en claro se oscurece con texto blanco; en oscuro se aclara con texto oscuro), así el ajuste
    // solo puede mejorar también el contraste contra el fondo.
    if (contrastRatioHex(onAccent, accent) < 4.5) {
      onAccent = theme === 'light' ? '#ffffff' : DARK_TEXT;
      accent = adjustFor(parseHex(accent)!, [onAccent], 4.5, toward);
    }
    const fill = parseHex(accent)!;
    return {
      accent,
      onAccent,
      accentText: adjustFor(base, [bg, surface], 4.5, toward),
      accentBorder: accent,
      accentTint: rgba(fill, theme === 'light' ? 0.12 : 0.18),
    };
  };
  return { light: build('light'), dark: build('dark') };
}
