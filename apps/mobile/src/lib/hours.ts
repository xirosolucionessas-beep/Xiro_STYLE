import { defaultBusinessHours, type BusinessHours, type DayHours } from '@xiro/shared';

/**
 * Lógica pura del editor de horario. Reproduce la semántica del editor nativo (business.tsx):
 * con "mismo horario todos los días" activo, cualquier cambio se aplica a los 7 días.
 * `day`: 0 = domingo … 6 = sábado (contrato de la API).
 */

export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

export type HoursRowId = 'weekdays' | 'saturday' | 'sunday' | number;

export interface HoursRow {
  id: HoursRowId;
  /** Día usado para mostrar y editar la fila (lunes representa "Lunes a viernes"). */
  day: number;
  open: boolean;
  from: string;
  to: string;
}

export const initialHours = (): BusinessHours => ({ sameEveryDay: true, days: defaultBusinessHours().days.map((d) => ({ ...d, open: true })) });

const dayOf = (hours: BusinessHours, day: number): DayHours => hours.days.find((d) => d.day === day) ?? hours.days[0]!;

/** Filas a mostrar: agrupadas (L–V, sábado, domingo) con el interruptor activo; siete filas cuando está desactivado. */
export function rowsOf(hours: BusinessHours): HoursRow[] {
  const toRow = (id: HoursRowId, day: number): HoursRow => {
    const d = dayOf(hours, day);
    return { id, day, open: d.open, from: d.from, to: d.to };
  };
  if (!hours.sameEveryDay) return WEEK_ORDER.map((day) => toRow(day, day));
  return [toRow('weekdays', 1), toRow('saturday', 6), toRow('sunday', 0)];
}

/** Activar copia el primer día abierto (lunes primero) a todos, como en nativo; desactivar solo desbloquea el desglose. */
export function setSameEveryDay(hours: BusinessHours, same: boolean): BusinessHours {
  if (!same) return { ...hours, sameEveryDay: false };
  const source = WEEK_ORDER.map((day) => dayOf(hours, day)).find((d) => d.open) ?? dayOf(hours, 1);
  return { sameEveryDay: true, days: hours.days.map((d) => ({ ...d, open: true, from: source.from, to: source.to })) };
}

/**
 * Aplica un cambio a una fila. Con el interruptor activo actualiza todos los días;
 * si no, en la fila agrupada "Lunes a viernes" cambia de lunes a viernes y en las demás solo su día.
 */
export function applyRowChange(hours: BusinessHours, row: HoursRow, patch: Partial<Pick<DayHours, 'open' | 'from' | 'to'>>): BusinessHours {
  const targets = new Set<number>(hours.sameEveryDay ? hours.days.map((d) => d.day) : row.id === 'weekdays' ? [1, 2, 3, 4, 5] : [row.day]);
  return { ...hours, days: hours.days.map((d) => (targets.has(d.day) ? { ...d, ...patch } : d)) };
}

const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

/** El cierre debe ser posterior a la apertura (solo se exige en días abiertos). Devuelve la clave de error o null. */
export function validateDay(day: Pick<DayHours, 'open' | 'from' | 'to'>): 'hours_close_after_open' | null {
  if (!day.open) return null;
  return minutes(day.to) > minutes(day.from) ? null : 'hours_close_after_open';
}

export const hasHoursErrors = (hours: BusinessHours) => hours.days.some((d) => validateDay(d) !== null);

/** Opciones de hora (00–23) y de minutos en pasos de 5; conserva un valor fuera de la rejilla si ya existe. */
export const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
export function minuteOptions(current?: string): string[] {
  const steps = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'));
  return current && !steps.includes(current) ? [...steps, current].sort() : steps;
}
