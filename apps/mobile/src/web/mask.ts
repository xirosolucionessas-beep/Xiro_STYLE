/** Enmascarado de contactos para mostrar en la recuperación de acceso (solo lo que la persona escribió; nunca datos de la cuenta). */

export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.trim().split('@');
  if (!local || !domain) return '';
  return `${local.slice(0, 2)}${'•'.repeat(Math.max(2, Math.min(local.length - 2, 4)))}@${domain}`;
}

/** "+57 3•• ••• ••42": conserva el prefijo, el primer dígito y los dos últimos. */
export function maskPhone(input: string): string {
  const digits = input.replace(/\D/g, '');
  if (digits.length < 7) return '';
  const national = digits.length > 10 ? digits.slice(-10) : digits;
  const prefix = digits.length > 10 ? `+${digits.slice(0, digits.length - 10)} ` : '';
  const masked = `${national[0]}•• ••• ••${national.slice(-2)}`;
  return `${prefix}${masked}`;
}

