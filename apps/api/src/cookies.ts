/**
 * Cookies de sesión del cliente final (página pública), escritas a mano: la app y la API comparten siempre el mismo
 * origen (ver `apps/public/vite.config.ts`, que redirige `/api` al puerto de la API en desarrollo, y en producción la
 * API sirve la web) — no hace falta CORS con credenciales ni una librería aparte solo para esto.
 *
 * `SameSite=Lax` ya es la protección CSRF recomendada hoy para este caso (ningún sitio de otro origen puede disparar
 * una petición POST/PUT/DELETE con esta cookie): no se añade un token CSRF aparte.
 */

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      out[key] = part.slice(eq + 1).trim();
    }
  }
  return out;
}

/** `path` SIEMPRE el de este negocio (p. ej. `/api/public/booking/<slug>`): así la cookie de un negocio nunca se envía
 * en las peticiones de otro, aunque compartan el mismo navegador y el mismo dominio. */
export function serializeSessionCookie(name: string, value: string, path: string, maxAgeSeconds: number, secure: boolean): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSeconds}`];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function expiredSessionCookie(name: string, path: string, secure: boolean): string {
  const parts = [`${name}=`, `Path=${path}`, 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}
