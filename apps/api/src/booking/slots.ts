import type { AvailabilitySlot, SlotState } from '@xiro/shared';
import { toMinutes, toTime, weekdayOf, zonedInstant } from './time';

/**
 * Motor de disponibilidad (puro, sin base de datos): dado el horario del negocio y de cada profesional, sus ausencias y
 * sus citas ya tomadas, dice para CADA horario de la cuadrícula si está libre ("available"), ya reservado por otra
 * persona ("booked") o no disponible por cualquier otra razón ("unavailable"). Nunca expone quién ocupa un horario.
 */

/** Tramo de trabajo en minutos desde la medianoche local. */
export interface Block {
  from: number;
  to: number;
}

export interface Interval {
  start: Date;
  end: Date;
}

export interface ProfessionalDay {
  id: string;
  /** Bloques de ese día de la semana; null = sigue el horario del negocio. */
  blocks: Block[] | null;
  /** Ausencias y vacaciones que tocan ese día. */
  timeOff: Interval[];
  /** Citas activas (no canceladas) del profesional: ocupan de `start` a `end` (fin del servicio + limpieza). */
  busy: Interval[];
}

export interface DayInput {
  timezone: string;
  /** Fecha local del negocio, "AAAA-MM-DD". */
  date: string;
  now: Date;
  intervalMinutes: number;
  minNoticeMinutes: number;
  /** Último día reservable (fecha local, inclusive). */
  lastBookableDate: string;
  /** Duración de los servicios y tiempo de limpieza posterior. */
  serviceMinutes: number;
  cleanupMinutes: number;
  /** Bloques en los que el negocio atiende ese día (vacío = cerrado). */
  businessBlocks: Block[];
  /** Día cerrado por festivo/cierre. */
  closed: boolean;
  professionals: ProfessionalDay[];
  /** El personal del negocio puede agendar fuera de la anticipación mínima y de la ventana máxima. */
  ignoreNoticeAndHorizon?: boolean;
}

export interface SlotDetail extends AvailabilitySlot {
  /** Profesionales que pueden atender ese horario (solo si `state === 'available'`). */
  availableProfessionalIds: string[];
}

const overlaps = (aStart: number, aEnd: number, b: Interval): boolean => aStart < b.end.getTime() && b.start.getTime() < aEnd;

/** Une tramos que se tocan o solapan. */
const merge = (blocks: Block[]): Block[] => {
  const sorted = [...blocks].sort((a, b) => a.from - b.from);
  const out: Block[] = [];
  for (const block of sorted) {
    const last = out[out.length - 1];
    if (last && block.from <= last.to) last.to = Math.max(last.to, block.to);
    else out.push({ ...block });
  }
  return out;
};

const intersect = (a: Block[], b: Block[]): Block[] => {
  const out: Block[] = [];
  for (const x of a) for (const y of b) {
    const from = Math.max(x.from, y.from);
    const to = Math.min(x.to, y.to);
    if (from < to) out.push({ from, to });
  }
  return merge(out);
};

/** Horarios de la cuadrícula de un día: arrancan en cada bloque del negocio y avanzan de `intervalMinutes` en `intervalMinutes`. */
export function gridMinutes(businessBlocks: Block[], intervalMinutes: number): number[] {
  const seen = new Set<number>();
  for (const block of merge(businessBlocks)) for (let t = block.from; t < block.to; t += intervalMinutes) seen.add(t);
  return [...seen].sort((a, b) => a - b);
}

/** Estado de un horario para UN profesional. */
export function professionalState(input: DayInput, pro: ProfessionalDay, startMinutes: number): SlotState {
  const start = zonedInstant(input.date, startMinutes, input.timezone);
  const serviceEnd = new Date(start.getTime() + input.serviceMinutes * 60_000);
  const busyEnd = new Date(serviceEnd.getTime() + input.cleanupMinutes * 60_000);

  if (input.closed) return 'unavailable';
  if (start.getTime() < input.now.getTime()) return 'unavailable';
  if (!input.ignoreNoticeAndHorizon) {
    if (start.getTime() < input.now.getTime() + input.minNoticeMinutes * 60_000) return 'unavailable';
    if (input.date > input.lastBookableDate) return 'unavailable';
  }

  // El servicio debe caber DENTRO de un tramo en el que trabajan el negocio y el profesional (la limpieza puede pasarse del cierre).
  const windows = pro.blocks ? intersect(merge(input.businessBlocks), merge(pro.blocks)) : merge(input.businessBlocks);
  const endMinutes = startMinutes + input.serviceMinutes;
  if (!windows.some((w) => startMinutes >= w.from && endMinutes <= w.to)) return 'unavailable';

  if (pro.timeOff.some((off) => overlaps(start.getTime(), busyEnd.getTime(), off))) return 'unavailable';

  // "Ocupado" = la hora de inicio cae dentro de una cita de otra persona. Si el inicio está libre pero la duración choca con
  // la siguiente cita, el horario simplemente no sirve para este servicio ("no disponible").
  const startTaken = pro.busy.some((a) => a.start.getTime() <= start.getTime() && start.getTime() < a.end.getTime());
  if (startTaken) return 'booked';
  if (pro.busy.some((a) => overlaps(start.getTime(), busyEnd.getTime(), a))) return 'unavailable';
  return 'available';
}

/**
 * Cuadrícula completa de un día con el estado de cada horario, combinando a los profesionales aptos:
 * libre si alguno está libre; "ocupado" solo si ninguno está libre y a alguno le ocupa otra cita; si no, no disponible.
 */
export function computeSlots(input: DayInput): SlotDetail[] {
  const weekdayBlocks = input.businessBlocks;
  return gridMinutes(weekdayBlocks, input.intervalMinutes).map((minutes) => {
    const states = input.professionals.map((pro) => ({ id: pro.id, state: professionalState(input, pro, minutes) }));
    const free = states.filter((s) => s.state === 'available').map((s) => s.id);
    const state: SlotState = free.length > 0 ? 'available' : states.some((s) => s.state === 'booked') ? 'booked' : 'unavailable';
    return { time: toTime(minutes), startsAt: zonedInstant(input.date, minutes, input.timezone).toISOString(), state, availableProfessionalIds: free };
  });
}

/** Bloques de un día de la semana a partir de la lista semanal ({weekday, from, to}). */
export function blocksForDate(weekly: Array<{ weekday: number; from: string; to: string }>, date: string): Block[] {
  const weekday = weekdayOf(date);
  return weekly.filter((b) => b.weekday === weekday).map((b) => ({ from: toMinutes(b.from), to: toMinutes(b.to) }));
}

/** Horario semanal del formato histórico del negocio (`businesses.hours`, un tramo por día) a bloques. */
export function blocksFromBusinessHours(hours: { days: Array<{ day: number; open: boolean; from: string; to: string }> }): Array<{ weekday: number; from: string; to: string }> {
  return hours.days.filter((d) => d.open && d.from < d.to).map((d) => ({ weekday: d.day, from: d.from, to: d.to }));
}
