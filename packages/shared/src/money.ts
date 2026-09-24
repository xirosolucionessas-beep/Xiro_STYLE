export const CURRENCIES = ['COP', 'USD', 'MXN', 'EUR'] as const;
export type Currency = (typeof CURRENCIES)[number];

const LOCALE_BY_CURRENCY: Record<Currency, string> = {
  COP: 'es-CO',
  USD: 'en-US',
  MXN: 'es-MX',
  EUR: 'es-ES',
};

/** Prices are stored as whole numbers in the currency's main unit (pesos, dollars...). */
export function formatMoney(amount: number, currency: Currency = 'COP'): string {
  return new Intl.NumberFormat(LOCALE_BY_CURRENCY[currency], {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}
