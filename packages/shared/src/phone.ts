export const DEFAULT_COUNTRY_CODE = '57';

/**
 * Normalizes a phone number to international digits without "+" (e.g. "573001234567").
 * A 10-digit Colombian mobile number (starts with 3) gets the default country code.
 * Returns null when the number cannot be a valid international number.
 */
export function normalizePhone(input: string, defaultCountryCode = DEFAULT_COUNTRY_CODE): string | null {
  const digits = input.replace(/\D/g, '');
  if (digits.length === 0) return null;
  if (digits.length === 10 && digits.startsWith('3')) return defaultCountryCode + digits;
  if (digits.length >= 11 && digits.length <= 15 && !digits.startsWith('0')) return digits;
  return null;
}

export function isValidPhone(input: string): boolean {
  return normalizePhone(input) !== null;
}

export function whatsappLink(phone: string, message: string): string {
  const normalized = normalizePhone(phone);
  const base = normalized ? `https://wa.me/${normalized}` : 'https://wa.me/';
  return `${base}?text=${encodeURIComponent(message)}`;
}

export function looksLikeEmail(input: string): boolean {
  return input.includes('@');
}

/** Enlace para llamar (`tel:`): número internacional si se puede normalizar ("3001234567" → "tel:+573001234567"); si no, solo sus dígitos y el "+" inicial. */
export function phoneHref(phone: string): string {
  const normalized = normalizePhone(phone);
  if (normalized) return `tel:+${normalized}`;
  return `tel:${phone.trim().replace(/(?!^\+)[^\d]/g, '')}`;
}
