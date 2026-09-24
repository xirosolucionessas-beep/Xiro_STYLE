/**
 * Tokens de diseño SOLO WEB — fuente única de verdad.
 * No importar desde código nativo. Las apps Android/iOS siguen usando src/ui/theme.ts sin cambios.
 *
 * Todos los pares de color de texto/controles se verifican en test/tokens.contrast.test.ts
 * (WCAG 2.2 AA: 4.5:1 texto normal · 3:1 texto grande, iconos y bordes de controles).
 */

export type ThemeName = 'dark' | 'light';

export interface ColorTokens {
  /** Fondo de página. */
  background: string;
  /** Tarjetas, campos, barras. */
  surface: string;
  /** Superficie elevada / hover. */
  surfaceAlt: string;
  /** Superficie lavanda para tarjetas secundarias (p. ej. Términos): texto, acento y texto secundario ≥ 4.5:1. */
  surfaceTint: string;
  /** Borde de CONTROLES (campos, chips, botones secundarios): ≥ 3:1 contra su fondo (WCAG 1.4.11). */
  border: string;
  /** Solo decorativo (separadores, contorno de tarjetas no interactivas). Sin requisito de contraste. */
  borderSubtle: string;
  text: string;
  /** Texto secundario: ≥ 4.5:1 sobre background, surface y surfaceAlt. */
  textMuted: string;
  /** Acento dorado: texto, iconos y relleno de botón primario. */
  accent: string;
  /** Fondo tenue del acento (chips seleccionados, íconos). Compuesto sobre background. */
  accentTint: string;
  /** Texto sobre relleno de acento. */
  onAccent: string;
  danger: string;
  success: string;
  warning: string;
  overlay: string;
  /** Anillo de foco: 2px, ≥ 3:1 contra los fondos adyacentes. */
  focus: string;
}

export const colors: Record<ThemeName, ColorTokens> = {
  dark: {
    background: '#0d0d0f',
    surface: '#1a1a1d',
    surfaceAlt: '#24221d',
    surfaceTint: '#221e2b',
    border: '#726d60',
    borderSubtle: '#37342b',
    text: '#ffffff',
    textMuted: '#b9b3a7',
    accent: '#d9b636',
    accentTint: 'rgba(217, 182, 54, 0.14)',
    onAccent: '#17130a',
    danger: '#e56565',
    success: '#53c878',
    warning: '#f2c94c',
    overlay: 'rgba(0, 0, 0, 0.7)',
    focus: '#d9b636',
  },
  light: {
    background: '#faf8f2',
    surface: '#ffffff',
    surfaceAlt: '#f3efe3',
    surfaceTint: '#ece6f1',
    border: '#857f6b',
    borderSubtle: '#e2dccb',
    text: '#1a160a',
    textMuted: '#6d6656',
    accent: '#7a5c00',
    accentTint: 'rgba(122, 92, 0, 0.12)',
    onAccent: '#ffffff',
    danger: '#b32d2d',
    success: '#1b7038',
    warning: '#805a00',
    overlay: 'rgba(0, 0, 0, 0.5)',
    focus: '#7a5c00',
  },
};

/** Escala de espaciado en múltiplos de 4 (px). */
export const space = { 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, 16: 64 } as const;

export const radius = { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 } as const;

export const font = {
  family: `system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`,
  /** px; en CSS se convierten a rem para respetar el tamaño de texto del navegador (zoom de texto 200%). */
  size: { xs: 12, sm: 14, md: 16, lg: 18, xl: 20, '2xl': 24, '3xl': 30 },
  weight: { regular: 400, medium: 500, semibold: 600, bold: 700, extrabold: 800 },
  lineHeight: { tight: 1.25, normal: 1.5 },
} as const;

export const layout = {
  /** Ancho máximo del contenido en escritorio. */
  maxContent: 1200,
  /** Ancho máximo de pantallas de formulario / autenticación. */
  maxForm: 480,
  /** Ancho máximo de pantallas de formulario dentro de la app (perfil, ficha, categorías…). */
  maxFormPage: 640,
  sidebarWidth: 264,
  sidebarCollapsedWidth: 72,
  /** Área clicable mínima (WCAG 2.5.8 pide 24; usamos 44 por ergonomía táctil). */
  touchTarget: 44,
  /** `wide`: monitores anchos/ultra-anchos, donde el dashboard puede usar más columnas sin estirar las tarjetas. */
  breakpoints: { tablet: 768, desktop: 1024, wide: 1440 },
} as const;

export const focusRing = { width: 2, offset: 2 } as const;

export const motion = { fast: 120, base: 200 } as const;

export const remOf = (px: number) => `${px / 16}rem`;

/**
 * Marca y botones de terceros. Los valores de Google y Apple siguen sus guías de marca (no son de la paleta de Xiro).
 * Google: claro = fondo blanco, borde #747775 · oscuro = fondo #131314, borde #8e918f.
 * Sign in with Apple: claro = fondo negro + texto blanco · oscuro = fondo blanco + texto negro (nunca dorado).
 */
export const brand = {
  gold: '#d9b738',
  goldHover: '#c4a32c',
  whatsapp: '#25d366',
  social: {
    dark: {
      googleBg: '#131314',
      googleBorder: '#8e918f',
      googleText: '#e3e3e3',
      appleBg: '#ffffff',
      appleText: '#000000',
    },
    light: {
      googleBg: '#ffffff',
      googleBorder: '#747775',
      googleText: '#1f1f1f',
      appleBg: '#000000',
      appleText: '#ffffff',
    },
  },
} as const;
