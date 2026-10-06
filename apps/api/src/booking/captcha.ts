/**
 * Verificación anti-bots (Cloudflare Turnstile) detrás de un adaptador.
 * PENDIENTE DE CREDENCIALES: sin `TURNSTILE_SECRET` la verificación queda apagada y la página pública se protege solo con
 * el campo trampa, los límites por IP y por negocio y el tope de reservas pendientes por celular. En cuanto se configura
 * el secreto, toda reserva pública exige un token válido.
 */
const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

export async function verifyCaptcha(secret: string | null, token: string | undefined, ip: string, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<boolean> {
  if (!secret) return true;
  if (!token) return false;
  try {
    const body = new URLSearchParams({ secret, response: token, remoteip: ip }).toString();
    const res = await fetchImpl(VERIFY_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    // Sin red hacia el proveedor no se deja pasar a nadie: es más seguro rechazar que aceptar sin verificar.
    return false;
  }
}
