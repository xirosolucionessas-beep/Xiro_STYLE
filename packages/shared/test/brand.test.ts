import { describe, expect, it } from 'vitest';
import { ATELIER_SURFACES, DEFAULT_ACCENT, brandAccent, contrastRatioHex } from '../src';

/** Cuadrícula de 8×8×8 = 512 colores, de negro a blanco, más casos extremos que un negocio podría elegir. */
const colors = (() => {
  const steps = [0, 36, 73, 109, 146, 182, 219, 255];
  const out: string[] = [];
  for (const r of steps) for (const g of steps) for (const b of steps) out.push(`#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`);
  return [...out, '#ffffff', '#000000', '#ffff99', '#fff8e1', '#000080', '#d4af37', '#c5a059', '#ff69b4', '#808080', '#767676'];
})();

describe('brandAccent: contraste WCAG AA garantizado con CUALQUIER color de marca', () => {
  for (const theme of ['light', 'dark'] as const) {
    it(`tema ${theme}: texto de acento ≥ 4.5, bordes ≥ 3 y texto sobre el botón ≥ 4.5, para ${colors.length} colores`, () => {
      const { bg, surface } = ATELIER_SURFACES[theme];
      const failures: string[] = [];
      for (const color of colors) {
        const t = brandAccent(color)[theme];
        const checks: Array<[string, number, number]> = [
          ['texto/fondo', contrastRatioHex(t.accentText, bg), 4.5],
          ['texto/tarjeta', contrastRatioHex(t.accentText, surface), 4.5],
          ['borde/fondo', contrastRatioHex(t.accentBorder, bg), 3],
          ['borde/tarjeta', contrastRatioHex(t.accentBorder, surface), 3],
          ['botón/fondo', contrastRatioHex(t.accent, bg), 3],
          ['texto sobre botón', contrastRatioHex(t.onAccent, t.accent), 4.5],
        ];
        for (const [name, ratio, min] of checks) if (ratio < min) failures.push(`${color} ${name}: ${ratio.toFixed(2)} < ${min}`);
      }
      expect(failures).toEqual([]);
    });
  }

  it('respeta el color del negocio cuando ya tiene buen contraste (no lo cambia sin necesidad)', () => {
    expect(brandAccent('#1f4e79').light.accent).toBe('#1f4e79'); // azul oscuro sobre fondo claro: tal cual
    expect(brandAccent('#ffd166').dark.accent).toBe('#ffd166'); // amarillo sobre fondo oscuro: tal cual
  });

  it('sin color o con uno inválido usa el dorado por defecto; mismo color → mismos tokens', () => {
    expect(brandAccent(null)).toEqual(brandAccent(DEFAULT_ACCENT));
    expect(brandAccent('rojo')).toEqual(brandAccent(DEFAULT_ACCENT));
    expect(brandAccent('#C5A059')).toEqual(brandAccent('#c5a059'));
  });

  it('el tinte del estado elegido es el color del botón, translúcido', () => {
    expect(brandAccent('#1f4e79').light.accentTint).toBe('rgba(31, 78, 121, 0.12)');
  });
});
