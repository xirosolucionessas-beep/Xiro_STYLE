/**
 * Ancla una ruta de medio relativa ("/media/xxx.webp", como la devuelve el servidor) al origen de la API. Equivalente
 * web-only de `resolveMedia` (lib/api.ts), sin pasar por `Platform` de React Native: los componentes puramente de
 * presentación de `web/` (screens, shell) no deben importar `lib/api.ts` porque arrastra `react-native`, cuyo bundle
 * usa sintaxis Flow que el bundler de las pruebas no sabe interpretar fuera de la app de Expo — ver test/setup.
 */
export function resolveMedia(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (!url.startsWith('/')) return url;
  // Servidor de desarrollo de Expo (8081) → API local en 3000; en producción la API sirve la web (mismo origen).
  const { hostname, port, origin } = window.location;
  const base = port === '8081' ? `http://${hostname}:3000` : origin;
  return `${base}${url}`;
}
