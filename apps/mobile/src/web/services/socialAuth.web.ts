/**
 * Inicio de sesión / registro con Google y Apple en la web — servicio ÚNICO que comparten bienvenida, login y registro.
 *
 * ESTADO: la API de Xiro Style todavía no expone endpoints de autenticación social (ni la app móvil los usa), y la CSP de la API
 * bloquea los scripts de Google Identity Services y Sign in with Apple JS. Por eso `SOCIAL_BACKEND_READY` es `false`: los botones
 * existen, tienen todos sus estados, pero se muestran como "Próximamente". Cuando el backend lo soporte (ver la propuesta entregada
 * con la Fase 1), basta con implementar `startSignIn` y poner la bandera en `true`; ninguna pantalla cambia.
 *
 * Seguridad: nunca guardar tokens de Google/Apple en localStorage ni registrarlos en consola; la sesión la maneja `lib/session`.
 */

export type SocialProvider = 'google' | 'apple';
/** `signin` = cuenta existente · `signup` = registro (precarga nombre y correo). */
export type SocialIntent = 'signin' | 'signup';

export type SocialErrorCode = 'cancelled' | 'popup_blocked' | 'account_not_found' | 'network' | 'unavailable';

export interface SocialProfile {
  /** Apple puede no entregar el nombre; Google/Apple pueden entregar un correo de retransmisión privado. */
  name: string | null;
  email: string | null;
}

/** `profile` acompaña a `account_not_found` para precargar el registro con el nombre y el correo del proveedor. */
export type SocialResult = { ok: true; profile: SocialProfile } | { ok: false; error: SocialErrorCode; profile?: SocialProfile };

/** `false` hasta que la API acepte el token de Google / el código de Apple de la web. */
export const SOCIAL_BACKEND_READY = false;

export interface SocialEnv {
  googleClientId?: string;
  appleServicesId?: string;
  appleRedirectUri?: string;
}

/** Las variables EXPO_PUBLIC_* se incrustan al compilar y deben leerse con acceso estático. */
export function readSocialEnv(): SocialEnv {
  return {
    googleClientId: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID,
    appleServicesId: process.env.EXPO_PUBLIC_APPLE_SERVICES_ID,
    appleRedirectUri: process.env.EXPO_PUBLIC_APPLE_REDIRECT_URI,
  };
}

export type Availability = { available: true } | { available: false; reason: 'backend' | 'not_configured' };

export function providerAvailability(provider: SocialProvider, env: SocialEnv = readSocialEnv(), backendReady: boolean = SOCIAL_BACKEND_READY): Availability {
  if (!backendReady) return { available: false, reason: 'backend' };
  const configured = provider === 'google' ? Boolean(env.googleClientId) : Boolean(env.appleServicesId && env.appleRedirectUri);
  return configured ? { available: true } : { available: false, reason: 'not_configured' };
}

export async function startSignIn(provider: SocialProvider, _intent: SocialIntent, env: SocialEnv = readSocialEnv()): Promise<SocialResult> {
  if (!providerAvailability(provider, env).available) return { ok: false, error: 'unavailable' };
  // Pendiente de backend: aquí irán Google Identity Services / Sign in with Apple JS y el envío al endpoint social.
  return { ok: false, error: 'unavailable' };
}

/** Clave de traducción (src/web/strings) del mensaje amable para cada error; nunca se muestran errores técnicos. */
export const SOCIAL_ERROR_KEYS: Record<SocialErrorCode, string> = {
  cancelled: 'social_err_cancelled',
  popup_blocked: 'social_err_popup',
  account_not_found: 'social_err_not_found',
  network: 'social_err_network',
  unavailable: 'social_err_unavailable',
};
