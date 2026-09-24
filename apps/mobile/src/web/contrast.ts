/** Cálculo de contraste WCAG 2.x (luminancia relativa). Puro: sin DOM ni React Native. */

type Rgb = [number, number, number];

export function parseColor(input: string): { rgb: Rgb; alpha: number } {
  const hex = /^#([0-9a-f]{6})$/i.exec(input);
  if (hex) {
    const n = hex[1]!;
    return { rgb: [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16)) as Rgb, alpha: 1 };
  }
  const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(input);
  if (rgba) return { rgb: [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])], alpha: rgba[4] === undefined ? 1 : Number(rgba[4]) };
  throw new Error(`Color no soportado: ${input}`);
}

/** Compone `fg` (con alfa) sobre un fondo opaco `bg`. */
export function composite(fg: string, bg: string): string {
  const f = parseColor(fg);
  const b = parseColor(bg);
  const mixed = f.rgb.map((c, i) => Math.round(c * f.alpha + b.rgb[i]! * (1 - f.alpha)));
  return `#${mixed.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

export function luminance(color: string): number {
  const [r, g, b] = parseColor(color).rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
