/**
 * Destino tras iniciar sesión, para cuando el default de (auth)/_layout.tsx ("/") no aplica — por ejemplo,
 * mandar a una cuenta recién registrada a elegir plan en vez de directo al Dashboard. En memoria y de un solo uso,
 * igual que socialSeed.ts. Solo register.web.tsx lo fija hoy: nativo nunca lo toca, así que su navegación no cambia.
 */
let target: string | null = null;

export const setPostAuthRedirect = (href: string) => {
  target = href;
};

export function takePostAuthRedirect(fallback: string): string {
  const value = target ?? fallback;
  target = null;
  return value;
}
