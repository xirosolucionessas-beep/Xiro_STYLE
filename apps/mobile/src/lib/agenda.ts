/**
 * Lógica pura de fechas y citas: vive en @xiro/shared (packages/shared/src/agenda.ts) porque la página pública de
 * reservas (apps/public) la necesita igual que esta app. Este archivo solo reexporta, para no tocar los ~10 imports
 * de `@/lib/agenda` ya existentes en pantallas y pruebas.
 */
export {
  actionStatus,
  addDays,
  addMonths,
  availableActions,
  canReschedule,
  dayRange,
  dayTotals,
  formatClock,
  formatDay,
  formatMonth,
  formatSpan,
  groupByDay,
  isRealDate,
  localDate,
  localTime,
  monthGrid,
  STATUS_TONE,
  startOfWeek,
  summarizeItems,
  todayIn,
  upcoming,
  upperFirst,
  weekDates,
  weekdayOf,
  weekdayShort,
  zonedInstant,
  type AppointmentAction,
  type DayTotals,
  type StatusTone,
} from '@xiro/shared';
