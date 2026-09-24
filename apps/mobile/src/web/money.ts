/** Formato en vivo de un monto entero con separador de miles, para campos como "Monto inicial" (base de caja). */

/** Solo dígitos, sin ceros a la izquierda (excepto "0" solo). */
export function digitsOnly(value: string): string {
  const clean = value.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  return clean;
}

/** "1000000" → "1.000.000" (separador de miles con punto, como el resto de la app). */
export function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** Lo que debe quedar en el campo mientras se escribe: solo dígitos agrupados. */
export const formatAmountInput = (raw: string): string => groupThousands(digitsOnly(raw));

/** Valor numérico real a partir de lo escrito (para enviar a la API). */
export const parseAmountInput = (raw: string): number => Number(digitsOnly(raw) || '0');
