import { emailSchema, type RecoveryChannel } from '@xiro/shared';

/**
 * Validación de "¿cómo quieres recibir el código?" adaptada al canal ELEGIDO (no autodetectada por lo que se escribe):
 * WhatsApp/SMS solo aceptan dígitos (y el "+" del prefijo internacional), Correo valida como correo. Se usa tanto en
 * la pantalla de recuperación de cuenta como, si hiciera falta, en cualquier otro formulario con el mismo selector.
 * El servidor vuelve a validar con `identifierSchema` (packages/shared/src/schemas.ts) — esto es solo la UX del cliente.
 */

/** Para WhatsApp/SMS: descarta letras y símbolos según se escribe, conservando un "+" inicial para el prefijo. */
export function filterPhoneInput(value: string): string {
  const plus = value.trimStart().startsWith('+') ? '+' : '';
  return plus + value.replace(/\D/g, '');
}

/** Celular colombiano: 10 dígitos que empiezan en 3, con o sin el prefijo +57. */
export function isValidColombianPhone(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 10) return digits.startsWith('3');
  if (digits.length === 12) return digits.startsWith('57') && digits[2] === '3';
  return false;
}

/** ¿El valor escrito ya alcanza para habilitar "Enviar código" en el canal elegido? */
export function isValidIdentifierForChannel(value: string, channel: RecoveryChannel): boolean {
  if (channel === 'email') return emailSchema.safeParse(value).success;
  return isValidColombianPhone(value);
}

/** Mensaje de error específico del canal (no el genérico "correo o celular"). */
export function identifierErrorKeyForChannel(channel: RecoveryChannel): 'email_invalid' | 'phone_invalid' {
  return channel === 'email' ? 'email_invalid' : 'phone_invalid';
}
