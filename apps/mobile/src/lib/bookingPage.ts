import { defaultBusinessHours, slugSchema, timeOfDaySchema, type BookingReadiness, type BusinessHours, type ScheduleBlock } from '@xiro/shared';
import { addDays, zonedInstant } from './agenda';

/**
 * Lógica pura de "Mi página web": enlace público, dirección (slug), horario semanal por bloques y ausencias.
 * Sin React ni red, para probarla a fondo.
 */

/** Dirección pública de la página de reservas de un negocio. */
export const publicPageUrl = (slug: string, base: string): string => `${base.replace(/\/$/, '')}/reservar/${slug}`;

/** Enlace de WhatsApp para COMPARTIR un texto (sin elegir un contacto de antemano). */
export const whatsappShareUrl = (text: string): string => `https://wa.me/?text=${encodeURIComponent(text)}`;

/** Clave de traducción del problema de una dirección, o `null` si es válida. Mismas reglas que valida el servidor. */
export function slugProblem(input: string): string | null {
  const parsed = slugSchema.safeParse(input);
  return parsed.success ? null : (parsed.error.issues[0]?.message ?? 'slug_invalid');
}

/** Propuesta de dirección a partir del nombre del negocio ("Barbería Don Pepe" → "barberia-don-pepe"). */
export function suggestSlug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

/* ---------- Horario semanal por bloques ---------- */

export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

export const blocksOfDay = (blocks: ReadonlyArray<ScheduleBlock>, weekday: number): ScheduleBlock[] => blocks.filter((b) => b.weekday === weekday).sort((a, b) => a.from.localeCompare(b.from));

/** Reemplaza los bloques de un día conservando los demás. */
export const setDayBlocks = (blocks: ReadonlyArray<ScheduleBlock>, weekday: number, next: ReadonlyArray<ScheduleBlock>): ScheduleBlock[] => [...blocks.filter((b) => b.weekday !== weekday), ...next].sort((a, b) => a.weekday - b.weekday || a.from.localeCompare(b.from));

/** Nuevo bloque tras el último del día (por defecto 09:00–13:00, o desde el cierre del anterior). */
export function nextBlock(existing: ReadonlyArray<ScheduleBlock>, weekday: number): ScheduleBlock {
  const last = blocksOfDay(existing, weekday).at(-1);
  if (!last) return { weekday, from: '09:00', to: '13:00' };
  const from = last.to;
  const start = minutes(from);
  const end = Math.min(start + 240, 23 * 60 + 59);
  return { weekday, from, to: `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}` };
}

/** Problemas de un horario semanal: bloque con cierre anterior a la apertura, o bloques del mismo día que se cruzan. */
export function blocksProblem(blocks: ReadonlyArray<ScheduleBlock>): 'hours_close_after_open' | null {
  for (const weekday of WEEK_ORDER) {
    const day = blocksOfDay(blocks, weekday);
    for (let i = 0; i < day.length; i += 1) {
      const block = day[i]!;
      if (minutes(block.to) <= minutes(block.from)) return 'hours_close_after_open';
      if (i > 0 && minutes(block.from) < minutes(day[i - 1]!.to)) return 'hours_close_after_open';
    }
  }
  return null;
}

/** Horario semanal de partida a partir del horario del negocio (un tramo por día): "Personalizar" arranca de lo que ya hay. */
export function blocksFromHours(hours: BusinessHours = defaultBusinessHours()): ScheduleBlock[] {
  return hours.days.filter((d) => d.open && d.from < d.to).map((d) => ({ weekday: d.day, from: d.from, to: d.to }));
}

/** Copia los bloques de un día a otros días (p. ej. "aplicar a lunes–viernes"). */
export function copyDay(blocks: ReadonlyArray<ScheduleBlock>, from: number, to: ReadonlyArray<number>): ScheduleBlock[] {
  const source = blocksOfDay(blocks, from);
  return to.reduce((acc, weekday) => (weekday === from ? acc : setDayBlocks(acc, weekday, source.map((b) => ({ ...b, weekday })))), [...blocks]);
}

/* ---------- Ausencias ---------- */

export interface TimeOffForm {
  /** Primer día, "AAAA-MM-DD". */
  date: string;
  allDay: boolean;
  /** Cuántos días seguidos (solo "todo el día"). */
  days: number;
  from: string;
  to: string;
}

/** Instantes UTC de una ausencia según la zona del negocio; `error` = clave de traducción si el formulario no es válido. */
export function timeOffRange(form: TimeOffForm, timezone: string): { startsAt: string; endsAt: string } | { error: string } {
  if (form.allDay) {
    if (!Number.isInteger(form.days) || form.days < 1 || form.days > 60) return { error: 'timeoff_err_days' };
    return { startsAt: zonedInstant(form.date, '00:00', timezone).toISOString(), endsAt: zonedInstant(addDays(form.date, form.days), '00:00', timezone).toISOString() };
  }
  if (!timeOfDaySchema.safeParse(form.from).success || !timeOfDaySchema.safeParse(form.to).success) return { error: 'time_invalid' };
  if (form.to <= form.from) return { error: 'hours_close_after_open' };
  return { startsAt: zonedInstant(form.date, form.from, timezone).toISOString(), endsAt: zonedInstant(form.date, form.to, timezone).toISOString() };
}


export type SetupStepId = 'published' | 'services' | 'professionals' | 'hours';

/** Los pasos que la página pública necesita para recibir reservas, en el orden en que conviene hacerlos. */
export function setupSteps(readiness: BookingReadiness): Array<{ id: SetupStepId; done: boolean }> {
  return [
    { id: 'services', done: readiness.bookableServices > 0 },
    { id: 'professionals', done: readiness.bookableProfessionals > 0 },
    { id: 'hours', done: readiness.openDays > 0 },
    { id: 'published', done: readiness.published },
  ];
}
