/**
 * La página solo tiene estas formas de URL, así que no hace falta una librería de rutas: se analiza `location.pathname`
 * a mano. La API la sirve bajo /reservar/ (ver apps/api/src/routes/web.ts).
 */
export const ACCOUNT_VIEWS = ['ingresar', 'registro', 'recuperar', 'cuenta'] as const;
export type AccountView = (typeof ACCOUNT_VIEWS)[number];

export type Route =
  | { name: 'profile'; slug: string }
  | { name: 'manage'; slug: string; token: string }
  | { name: 'account'; slug: string; view: AccountView }
  | { name: 'not-found' };

export function parseRoute(pathname: string): Route {
  const parts = pathname.split('/').filter(Boolean); // "reservar", ":slug", ["gestion", ":token"] | [":vista"]
  if (parts[0] !== 'reservar' || !parts[1]) return { name: 'not-found' };
  const slug = decodeURIComponent(parts[1]);
  if (parts.length === 2) return { name: 'profile', slug };
  if (parts.length === 4 && parts[2] === 'gestion' && parts[3]) return { name: 'manage', slug, token: decodeURIComponent(parts[3]) };
  if (parts.length === 3 && (ACCOUNT_VIEWS as readonly string[]).includes(parts[2]!)) return { name: 'account', slug, view: parts[2] as AccountView };
  return { name: 'not-found' };
}

export const profilePath = (slug: string) => `/reservar/${encodeURIComponent(slug)}`;
export const managePath = (slug: string, token: string) => `/reservar/${encodeURIComponent(slug)}/gestion/${encodeURIComponent(token)}`;
export const accountPath = (slug: string, view: AccountView) => `/reservar/${encodeURIComponent(slug)}/${view}`;

/** Cambia la URL sin recargar (para redirigir de una dirección anterior a la vigente, o al abrir el enlace de gestión). */
export function navigate(path: string): void {
  window.history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/** Igual, pero sin dejar una entrada nueva en el historial (redirección silenciosa de slug anterior → vigente). */
export function replacePath(path: string): void {
  window.history.replaceState(null, '', path);
}
