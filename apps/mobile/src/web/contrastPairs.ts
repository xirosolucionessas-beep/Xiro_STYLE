import { composite, contrastRatio } from './contrast';
import { brand, colors, type ThemeName } from './tokens';

export interface ContrastCheck {
  name: string;
  fg: string;
  bg: string;
  /** 4.5 = texto normal (1.4.3) · 3 = texto grande, iconos y bordes de controles (1.4.3 / 1.4.11). */
  min: 4.5 | 3;
  ratio: number;
  pass: boolean;
}

/** Todos los pares de color que la interfaz usa de verdad. Fuente de las pruebas y de docs/web-design-tokens.md. */
export function contrastChecks(theme: ThemeName): ContrastCheck[] {
  const c = colors[theme];
  const social = brand.social[theme];
  const tintOnBg = composite(c.accentTint, c.background);
  const tintOnSurface = composite(c.accentTint, c.surface);
  const pairs: Array<[string, string, string, 4.5 | 3]> = [
    ['Texto sobre fondo', c.text, c.background, 4.5],
    ['Texto sobre superficie', c.text, c.surface, 4.5],
    ['Texto sobre superficie elevada', c.text, c.surfaceAlt, 4.5],
    ['Texto secundario sobre fondo', c.textMuted, c.background, 4.5],
    ['Texto secundario sobre superficie', c.textMuted, c.surface, 4.5],
    ['Texto secundario sobre superficie elevada', c.textMuted, c.surfaceAlt, 4.5],
    ['Acento (texto/enlaces) sobre fondo', c.accent, c.background, 4.5],
    ['Acento sobre superficie', c.accent, c.surface, 4.5],
    ['Acento sobre superficie elevada', c.accent, c.surfaceAlt, 4.5],
    ['Texto sobre superficie lavanda', c.text, c.surfaceTint, 4.5],
    ['Texto secundario sobre superficie lavanda', c.textMuted, c.surfaceTint, 4.5],
    ['Acento sobre superficie lavanda', c.accent, c.surfaceTint, 4.5],
    ['Acento sobre chip seleccionado (fondo)', c.accent, tintOnBg, 4.5],
    ['Acento sobre chip seleccionado (superficie)', c.accent, tintOnSurface, 4.5],
    ['Texto del botón primario', c.onAccent, c.accent, 4.5],
    ['Peligro (texto) sobre fondo', c.danger, c.background, 4.5],
    ['Peligro sobre superficie', c.danger, c.surface, 4.5],
    ['Peligro sobre superficie elevada', c.danger, c.surfaceAlt, 4.5],
    ['Éxito (texto) sobre fondo', c.success, c.background, 4.5],
    ['Éxito sobre superficie elevada (toast)', c.success, c.surfaceAlt, 4.5],
    ['Aviso (texto) sobre fondo', c.warning, c.background, 4.5],
    ['Aviso sobre superficie elevada', c.warning, c.surfaceAlt, 4.5],
    ['Borde de control sobre fondo', c.border, c.background, 3],
    ['Borde de control sobre superficie', c.border, c.surface, 3],
    ['Borde de control sobre superficie elevada', c.border, c.surfaceAlt, 3],
    ['Anillo de foco sobre fondo', c.focus, c.background, 3],
    ['Anillo de foco sobre superficie', c.focus, c.surface, 3],
    ['Icono/borde de acento sobre fondo', c.accent, c.background, 3],
    ['Botón Google: texto', social.googleText, social.googleBg, 4.5],
    ['Botón Google: borde sobre el fondo de página', social.googleBorder, c.background, 3],
    ['Botón Google: borde sobre su propio fondo', social.googleBorder, social.googleBg, 3],
    ['Botón Apple: texto', social.appleText, social.appleBg, 4.5],
  ];
  return pairs.map(([name, fg, bg, min]) => {
    const ratio = contrastRatio(fg, bg);
    return { name, fg, bg, min, ratio, pass: ratio >= min };
  });
}
