import { brandAccent, type AccentTokens } from '@xiro/shared';
import { useEffect } from 'react';

const VARS: Array<[keyof AccentTokens, string]> = [
  ['accent', 'accent'],
  ['onAccent', 'on-accent'],
  ['accentText', 'accent-text'],
  ['accentBorder', 'accent-border'],
  ['accentTint', 'accent-tint'],
];

/**
 * Pone la marca del negocio en la página (Fase 3): los tonos de SU color de acento para tema claro (--bl-*) y oscuro (--bd-*),
 * con contraste AA garantizado por `brandAccent`. Sin color propio (null) se quitan y rige el dorado por defecto de la hoja.
 * Los valores salen de una función pura sobre un hex validado (servidor y base de datos exigen #rrggbb): nunca texto libre en CSS.
 */
export function applyBrand(accentColor: string | null | undefined, root: HTMLElement = document.documentElement): void {
  for (const [, name] of VARS) {
    root.style.removeProperty(`--bl-${name}`);
    root.style.removeProperty(`--bd-${name}`);
  }
  if (!accentColor) return;
  const { light, dark } = brandAccent(accentColor);
  for (const [key, name] of VARS) {
    root.style.setProperty(`--bl-${name}`, light[key]);
    root.style.setProperty(`--bd-${name}`, dark[key]);
  }
}

/** Mientras la página de un negocio está abierta, su marca; al salir, la de por defecto. */
export function useBrand(accentColor: string | null | undefined): void {
  useEffect(() => {
    applyBrand(accentColor);
    return () => applyBrand(null);
  }, [accentColor]);
}
