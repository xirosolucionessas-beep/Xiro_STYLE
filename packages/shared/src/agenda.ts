import type { AppointmentDto, AppointmentItemDto, AppointmentStatus } from './booking';
import type { Language } from './schemas';

/**
 * Lógica pura de fechas y citas (sin React ni red), compartida por la app (Android, iOS, Web) y la página pública de
 * reservas. Todo instante viaja y se guarda en UTC; la zona horaria del NEGOCIO (`business.timezone`) solo se usa para
 * interpretar y mostrar "el martes a las 09:00". Sin librerías de fechas: Intl.
 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const pad = (n: number) => String(n).padStart(2, '0');

/** Fecha de calendario "AAAA-MM-DD" en la que cae un instante, en la zona del negocio. */
export function localDate(instant: Date | string, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(instant));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Hora local "HH:MM" (24 h) de un instante en la zona del negocio. */
export function localTime(instant: Date | string, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(instant));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('hour')}:${get('minute')}`;
}

/** Diferencia (minutos) entre UTC y la hora local de la zona en un instante. */
function offsetMinutes(instantMs: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(instantMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - Math.floor(instantMs / 1000) * 1000) / 60_000);
}

/** Instante UTC de "esta fecha a esta hora local" en la zona del negocio (respeta el horario de verano). */
export function zonedInstant(date: string, time: string, timezone: string): Date {
  const match = DATE_RE.exec(date);
  if (!match) throw new RangeError(`fecha inválida: ${date}`);
  const [h, m] = time.split(':').map(Number) as [number, number];
  const wall = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), h, m);
  // Dos pasadas: la primera estima el desfase, la segunda lo corrige si el resultado cruzó un cambio de horario.
  let guess = wall - offsetMinutes(wall, timezone) * 60_000;
  guess = wall - offsetMinutes(guess, timezone) * 60_000;
  return new Date(guess);
}

export const todayIn = (timezone: string, now: Date = new Date()): string => localDate(now, timezone);

export function addDays(date: string, days: number): string {
  const match = DATE_RE.exec(date);
  if (!match) throw new RangeError(`fecha inválida: ${date}`);
  const next = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

/** 0 = domingo … 6 = sábado (independiente de la zona horaria). */
export function weekdayOf(date: string): number {
  const match = DATE_RE.exec(date);
  if (!match) throw new RangeError(`fecha inválida: ${date}`);
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).getUTCDay();
}

/** Rango [inicio, fin) UTC de uno o más días locales completos. */
export function dayRange(date: string, timezone: string, days = 1): { from: string; to: string } {
  return { from: zonedInstant(date, '00:00', timezone).toISOString(), to: zonedInstant(addDays(date, days), '00:00', timezone).toISOString() };
}

/** Lunes de la semana de `date` (semana de lunes a domingo). */
export const startOfWeek = (date: string): string => addDays(date, -((weekdayOf(date) + 6) % 7));
export const weekDates = (date: string): string[] => Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(date), i));

/** Primera letra en mayúscula y el resto tal cual ("lunes, 5 de octubre" → "Lunes, 5 de octubre"; `textTransform: capitalize` pondría "De" en mayúscula). */
export const upperFirst = (text: string): string => text.charAt(0).toLocaleUpperCase() + text.slice(1);

const localeOf = (language: Language) => (language === 'en' ? 'en-US' : 'es-CO');

/** "lunes, 5 de octubre" — la fecha ya es de calendario, por eso se formatea en UTC sin desfases. */
export function formatDay(date: string, language: Language, options: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' }): string {
  const match = DATE_RE.exec(date);
  if (!match) return date;
  return new Intl.DateTimeFormat(localeOf(language), { ...options, timeZone: 'UTC' }).format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))));
}

export const formatMonth = (date: string, language: Language) => formatDay(date, language, { month: 'long', year: 'numeric' });
export const weekdayShort = (weekday: number, language: Language) => formatDay(addDays('2026-01-04', weekday), language, { weekday: 'short' });

/** "10:00 a. m." a partir de una hora "HH:MM" de calendario (sin zona: ya es la hora local del negocio). */
export function formatClock(time: string, language: Language): string {
  const [h, m] = time.split(':').map(Number) as [number, number];
  const text = new Intl.DateTimeFormat(localeOf(language), { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(new Date(Date.UTC(2000, 0, 1, h, m)));
  // "a. m." nunca se parte en dos líneas ("10:00 a." / "m.").
  return text.replace(/([ap]\.)[\s\u00a0\u202f](m\.)/i, '$1\u00a0$2');
}

/** "10:00 a. m. – 11:00 a. m." de una cita, en la zona del negocio. */
export function formatSpan(startsAt: string, endsAt: string, timezone: string, language: Language): string {
  return `${formatClock(localTime(startsAt, timezone), language)} – ${formatClock(localTime(endsAt, timezone), language)}`;
}

/* ---------- Estados ---------- */

export type StatusTone = 'success' | 'warning' | 'danger' | 'accent' | 'muted';

export const STATUS_TONE: Record<AppointmentStatus, StatusTone> = {
  pending: 'warning',
  confirmed: 'accent',
  in_progress: 'accent',
  completed: 'success',
  cancelled: 'muted',
  no_show: 'danger',
};

/** Acciones que el personal puede hacer sobre una cita según su estado (espejo de `canTransition`). */
export type AppointmentAction = 'confirm' | 'start' | 'complete' | 'no_show' | 'cancel';

const ACTION_TARGET: Record<AppointmentAction, AppointmentStatus> = { confirm: 'confirmed', start: 'in_progress', complete: 'completed', no_show: 'no_show', cancel: 'cancelled' };
export const actionStatus = (action: AppointmentAction): AppointmentStatus => ACTION_TARGET[action];

export function availableActions(status: AppointmentStatus, startsAt: string, now: Date = new Date()): AppointmentAction[] {
  switch (status) {
    case 'pending':
      return ['confirm', 'cancel'];
    case 'confirmed':
      // "No asistió" solo tiene sentido cuando ya pasó la hora de la cita (el servidor lo exige igual).
      return ['start', 'complete', ...(new Date(startsAt).getTime() <= now.getTime() ? (['no_show'] as const) : []), 'cancel'];
    case 'in_progress':
      return ['complete', 'cancel'];
    default:
      return [];
  }
}

/** Una cita se puede mover mientras esté pendiente o confirmada. */
export const canReschedule = (status: AppointmentStatus): boolean => status === 'pending' || status === 'confirmed';

/* ---------- Resúmenes ---------- */

/** "Corte, Barba +1" — los nombres de lo reservado, resumidos. */
export function summarizeItems(items: ReadonlyArray<Pick<AppointmentItemDto, 'name' | 'quantity'>>, max = 2): string {
  const names = items.map((item) => (item.quantity > 1 ? `${item.name} ×${item.quantity}` : item.name));
  return names.length <= max ? names.join(', ') : `${names.slice(0, max).join(', ')} +${names.length - max}`;
}

export interface DayTotals {
  total: number;
  active: number;
  pending: number;
  completed: number;
  cancelled: number;
  /** Ingresos de lo ya completado. */
  earned: number;
  /** Ingresos esperados de lo aún activo (pendiente, confirmado o en curso). */
  expected: number;
}

export function dayTotals(appointments: ReadonlyArray<Pick<AppointmentDto, 'status' | 'totalPrice'>>): DayTotals {
  const totals: DayTotals = { total: appointments.length, active: 0, pending: 0, completed: 0, cancelled: 0, earned: 0, expected: 0 };
  for (const appt of appointments) {
    if (appt.status === 'completed') {
      totals.completed += 1;
      totals.earned += appt.totalPrice;
    } else if (appt.status === 'cancelled' || appt.status === 'no_show') totals.cancelled += 1;
    else {
      totals.active += 1;
      totals.expected += appt.totalPrice;
      if (appt.status === 'pending') totals.pending += 1;
    }
  }
  return totals;
}

/** Agrupa citas por día local del negocio (orden cronológico dentro de cada día). */
export function groupByDay(appointments: ReadonlyArray<AppointmentDto>, timezone: string): Map<string, AppointmentDto[]> {
  const out = new Map<string, AppointmentDto[]>();
  for (const appt of [...appointments].sort((a, b) => a.startsAt.localeCompare(b.startsAt))) {
    const key = localDate(appt.startsAt, timezone);
    out.set(key, [...(out.get(key) ?? []), appt]);
  }
  return out;
}

/** Próximas citas activas a partir de `now` (para Inicio). */
export function upcoming(appointments: ReadonlyArray<AppointmentDto>, now: Date = new Date(), limit = 5): AppointmentDto[] {
  return appointments
    .filter((appt) => (appt.status === 'pending' || appt.status === 'confirmed' || appt.status === 'in_progress') && new Date(appt.endsAt).getTime() > now.getTime())
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .slice(0, limit);
}

/* ---------- Calendario mensual ---------- */

/** Semanas (lunes a domingo) que cubren el mes de `date`; incluye los días vecinos para completar las filas. */
export function monthGrid(date: string): string[][] {
  const first = `${date.slice(0, 7)}-01`;
  const start = startOfWeek(first);
  const [year, month] = first.split('-').map(Number) as [number, number];
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const last = `${date.slice(0, 7)}-${pad(lastDay)}`;
  const weeks: string[][] = [];
  for (let cursor = start; cursor <= addDays(startOfWeek(last), 6); cursor = addDays(cursor, 7)) weeks.push(Array.from({ length: 7 }, (_, i) => addDays(cursor, i)));
  return weeks;
}

export const addMonths = (date: string, months: number): string => {
  const [year, month] = date.split('-').map(Number) as [number, number];
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  return `${target.getUTCFullYear()}-${pad(target.getUTCMonth() + 1)}-01`;
};

/** ¿Es una fecha real del calendario ("2026-02-31" no)? */
export function isRealDate(date: string): boolean {
  const match = DATE_RE.exec(date);
  if (!match) return false;
  const probe = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return probe.getUTCFullYear() === Number(match[1]) && probe.getUTCMonth() === Number(match[2]) - 1 && probe.getUTCDate() === Number(match[3]);
}
