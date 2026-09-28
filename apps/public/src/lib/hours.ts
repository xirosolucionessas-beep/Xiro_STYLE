import { addDays, formatClock, formatDay, localDate, localTime, translate, upperFirst, weekdayOf, type Language, type PublicBookingProfile } from '@xiro/shared';

/** Nombre del día de la semana (0 = domingo) en el idioma de la persona. */
export function weekdayName(weekday: number, language: Language): string {
  // 4 de enero de 2026 fue domingo: sumar `weekday` días da el día pedido sin depender de ninguna zona horaria.
  return upperFirst(formatDay(addDays('2026-01-04', weekday), language, { weekday: 'long' }));
}

/**
 * "Abierto · cierra a las 7:00 p. m." / "Cerrado · abre mañana a las 9:00 a. m.". Todo sale de `openStatus`, que el servidor
 * calcula en la zona horaria del negocio: aquí solo se le da nombre a ese instante en esa misma zona.
 */
export function statusText(profile: Pick<PublicBookingProfile, 'openStatus' | 'timezone'>, language: Language, now: Date = new Date()): string {
  const t = (key: string, params?: Record<string, string | number>) => translate(language, key, params);
  const { open, changesAt } = profile.openStatus;
  if (!changesAt) return t('pub_status_closed');
  const time = formatClock(localTime(changesAt, profile.timezone), language);
  if (open) return t('pub_status_open_until', { time });
  const day = localDate(changesAt, profile.timezone);
  const today = localDate(now, profile.timezone);
  const when = day === today ? t('pub_when_today') : day === addDays(today, 1) ? t('pub_when_tomorrow') : weekdayName(weekdayOf(day), language).toLowerCase();
  return t('pub_status_closed_opens', { when, time });
}

export interface HoursRow {
  weekday: number;
  label: string;
  /** "9:00 a. m. – 7:00 p. m." (con varios bloques, separados por " · ") o "Cerrado". */
  text: string;
  closed: boolean;
  today: boolean;
}

/** Los siete días, de lunes a domingo, con el de hoy (en la zona del negocio) marcado. */
export function hoursRows(hours: PublicBookingProfile['hours'], language: Language, timezone: string, now: Date = new Date()): HoursRow[] {
  const t = (key: string) => translate(language, key);
  const todayWeekday = weekdayOf(localDate(now, timezone));
  return [1, 2, 3, 4, 5, 6, 0].map((weekday) => {
    const blocks = hours.filter((b) => b.weekday === weekday).sort((a, b) => a.from.localeCompare(b.from));
    return {
      weekday,
      label: weekdayName(weekday, language),
      closed: blocks.length === 0,
      text: blocks.length === 0 ? t('pub_hours_closed') : blocks.map((b) => `${formatClock(b.from, language)} – ${formatClock(b.to, language)}`).join(' · '),
      today: weekday === todayWeekday,
    };
  });
}
