import { ApiError } from '../api';

/**
 * Mensaje legible para un error de las rutas de cuenta de cliente (ingresar, registrar, cambiar contraseña,
 * recuperar acceso...). Nunca el "Ocurrió un error inesperado" genérico cuando el servidor ya dijo exactamente
 * qué falló: un campo inválido llega como `validation_error` + `issues[0].message`, que YA es una clave de
 * traducción existente (p. ej. "phone_invalid", "password_weak") — se traduce tal cual, no se descarta.
 */
export function accountErrorMessage(t: (key: string) => string, error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'invalid_credentials') return t('pub_account_err_invalid_credentials');
    if (error.code === 'account_exists') return t('pub_account_err_account_exists');
    if (error.code === 'otp_invalid') return t('pub_account_err_otp_invalid');
    if (error.code === 'reset_token_invalid') return t('pub_account_err_reset_token_invalid');
    if (error.code === 'too_many_requests') return t('too_many_requests');
    if (error.code === 'photo_invalid') return t('photo_invalid');
    if (error.code === 'validation_error' && error.issues[0]) return t(error.issues[0].message);
    if (error.isNetwork) return t(error.code === 'timeout_error' ? 'timeout_error' : 'offline_error');
  }
  return t('unknown_error');
}
