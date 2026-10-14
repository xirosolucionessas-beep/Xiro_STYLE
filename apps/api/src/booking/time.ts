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

/**
 * Memoria de `zonedInstant` (Fase 5): calcular horarios llama a esta función por cada franja de cada día y profesional, y
 * cada `TZDate` consulta la zona horaria con `Intl` varias veces — era el 28 % de la CPU de /availability y /days bajo
 * carga. El resultado depende SOLO de (zona, fecha, minutos) y de las reglas de zonas horarias del runtime, que no cambian
 * mientras el proceso vive: guardarlo da exactamente el mismo instante. Tope de tamaño: al llenarse se vacía y se rehace.
 */
const ZONED_CACHE_MAX = 50_000;
const zonedCache = new Map<string, number>();

/** Instante UTC de "esta fecha a esta hora" en la zona horaria del negocio. */
export function zonedInstant(date: string, minutes: number, timezone: string): Date {
  const key = `${timezone}|${date}|${minutes}`;
  const cached = zonedCache.get(key);
  if (cached !== undefined) return new Date(cached); // copia nueva: un Date es mutable
  const match = DATE_PARTS.exec(date);
  if (!match) throw new RangeError(`fecha inválida: ${date}`);
  const instant = new TZDate(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Math.floor(minutes / 60), minutes % 60, 0, 0, timezone).getTime();
  if (zonedCache.size >= ZONED_CACHE_MAX) zonedCache.clear();
  zonedCache.set(key, instant);
  return new Date(instant);
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

