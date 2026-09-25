import type { Currency } from '@xiro/shared';

export type CountryCode = 'CO' | 'MX' | 'US' | 'CA' | 'ES' | 'AR' | 'CL' | 'PE' | 'EC';

export interface Country {
  code: CountryCode;
  /** Se guarda tal cual en `business.country` (texto libre en la API). */
  name: string;
  /** Prefijo telefónico internacional, sin "+". */
  dial: string;
  currency: Currency;
  /** La API solo admite COP/USD/MXN/EUR: para este país se usa USD como aproximación y así se avisa al usuario. */
  currencyIsFallback?: true;
}

export const COUNTRIES: readonly Country[] = [
  { code: 'CO', name: 'Colombia', dial: '57', currency: 'COP' },
  { code: 'MX', name: 'México', dial: '52', currency: 'MXN' },
  { code: 'US', name: 'United States', dial: '1', currency: 'USD' },
  { code: 'CA', name: 'Canadá', dial: '1', currency: 'USD', currencyIsFallback: true },
  { code: 'ES', name: 'España', dial: '34', currency: 'EUR' },
  { code: 'AR', name: 'Argentina', dial: '54', currency: 'USD', currencyIsFallback: true },
  { code: 'CL', name: 'Chile', dial: '56', currency: 'USD', currencyIsFallback: true },
  { code: 'PE', name: 'Perú', dial: '51', currency: 'USD', currencyIsFallback: true },
  { code: 'EC', name: 'Ecuador', dial: '593', currency: 'USD' },
];

export const DEFAULT_COUNTRY: CountryCode = 'CO';

export const countryByCode = (code: CountryCode): Country => COUNTRIES.find((c) => c.code === code) ?? COUNTRIES[0]!;

/**
 * Teléfono en dígitos internacionales (formato que valida `phoneSchema`): antepone el prefijo del país
 * salvo que el número ya lo traiga (más largo que un número local corto).
 */
export function composePhone(local: string, dial: string): string {
  const digits = local.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith(dial) && digits.length > dial.length + 6) return digits;
  return dial + digits.replace(/^0+/, '');
}

/** Bandera como emoji (letras indicadoras regionales), para nativo: sin descargar imágenes. `CO` → 🇨🇴. */
export const flagEmoji = (code: CountryCode): string => String.fromCodePoint(...[...code].map((letter) => 0x1f1a5 + letter.charCodeAt(0)));
