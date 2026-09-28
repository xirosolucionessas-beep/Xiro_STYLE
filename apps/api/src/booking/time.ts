import { TZDate } from '@date-fns/tz';

/**
 * Ayudas de fecha y hora del módulo de citas. Todo instante se guarda y se compara en UTC; la zona horaria del negocio
 * solo se usa para interpretar "el martes a las 09:00" y para mostrar. Nunca se calculan horas a mano.
 */

/** Minutos desde la medianoche local ("HH:MM" → 540). */
export const toMinutes = (time: string): number => {
  const [h, m] = time.split(':');
  return Number(h) * 60 + Number(m);
};

export const toTime = (minutes: number): string => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

const DATE_PARTS = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Día de la semana (0 = domingo) de una fecha de calendario "AAAA-MM-DD"; no depende de ninguna zona horaria. */
export function weekdayOf(date: string): number {
  const match = DATE_PARTS.exec(date);
  if (!match) throw new RangeError(`fecha inválida: ${date}`);
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).getUTCDay();
}

/** ¿Es una fecha real del calendario (no "2026-02-31")? */
export function isRealDate(date: string): boolean {
  const match = DATE_PARTS.exec(date);
  if (!match) return false;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

/** Suma días a una fecha de calendario. */
export function addDays(date: string, days: number): string {
  const match = DATE_PARTS.exec(date);
  if (!match) throw new RangeError(`fecha inválida: ${date}`);
  const next = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
}

/** Instante UTC de "esta fecha a esta hora" en la zona horaria del negocio. */
export function zonedInstant(date: string, minutes: number, timezone: string): Date {
  const match = DATE_PARTS.exec(date);
  if (!match) throw new RangeError(`fecha inválida: ${date}`);
  return new Date(new TZDate(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Math.floor(minutes / 60), minutes % 60, 0, 0, timezone).getTime());
}

/** Fecha de calendario local del negocio en la que cae un instante. */
export function localDate(instant: Date, timezone: string): string {
  const z = new TZDate(instant.getTime(), timezone);
  return `${z.getFullYear()}-${String(z.getMonth() + 1).padStart(2, '0')}-${String(z.getDate()).padStart(2, '0')}`;
}

/** Minutos desde la medianoche local del negocio en los que cae un instante. */
export function localMinutes(instant: Date, timezone: string): number {
  const z = new TZDate(instant.getTime(), timezone);
  return z.getHours() * 60 + z.getMinutes();
}

/** ¿Es un identificador de zona horaria IANA válido? */
export function isTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}
