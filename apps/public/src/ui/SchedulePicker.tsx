import { addDays, formatDay, monthGrid, todayIn, translate, upperFirst, type AvailabilitySlot, type BookingSelection, type DaySummary, type Language } from '@xiro/shared';
import { useMemo, useState } from 'react';
import { publicApi } from '../api';
import { errorKey, useAsync } from '../lib/useAsync';
import { Button } from './Button';
import { Calendar, type DayMark } from './Calendar';
import { Skeleton } from './Skeleton';
import { SlotGrid } from './SlotGrid';

interface SchedulePickerProps {
  slug: string;
  timezone: string;
  selection: Pick<BookingSelection, 'services' | 'packages'>;
  professionalId: string;
  date: string;
  onDate: (date: string) => void;
  slot: string | null;
  onSlot: (slot: AvailabilitySlot) => void;
  maxDaysAhead: number;
  language: Language;
}

/**
 * Elegir día y hora reales: un calendario que marca los días con cupo (los cerrados, deshabilitados) y, debajo, solo los horarios
 * libres de ese día. Si el día elegido no tiene horarios, lo dice y ofrece saltar al siguiente día que sí tenga.
 */
export function SchedulePicker({ slug, timezone, selection, professionalId, date, onDate, slot, onSlot, maxDaysAhead, language }: SchedulePickerProps) {
  const t = (key: string, params?: Record<string, string | number>) => translate(language, key, params);
  const today = todayIn(timezone);
  const [month, setMonth] = useState(`${date.slice(0, 7)}-01`);
  const grid = monthGrid(month);
  const from = grid[0]![0]!;
  const days = Math.min(62, grid.length * 7);
  const maxDate = useMemo(() => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + maxDaysAhead);
    return d.toISOString().slice(0, 10);
  }, [today, maxDaysAhead]);

  const key = JSON.stringify(selection);
  const monthState = useAsync(() => publicApi.days(slug, from, days, professionalId, selection), [slug, from, days, professionalId, key]);
  const dayState = useAsync(() => publicApi.availability(slug, date, professionalId, selection), [slug, date, professionalId, key]);

  // ¿El día elegido no tiene ningún horario libre? Entonces se busca el siguiente que sí (solo en ese caso: no cuesta nada el resto del tiempo).
  const dayIsEmpty = dayState.data ? dayState.data.slots.every((s) => s.state !== 'available') : false;
  const upcoming = useAsync(
    () => (dayIsEmpty && date < maxDate ? publicApi.days(slug, addDays(date, 1), 60, professionalId, selection) : Promise.resolve([] as DaySummary[])),
    [dayIsEmpty, date, maxDate, slug, professionalId, key],
  );
  const next = upcoming.data?.find((d) => d.hasAvailability && d.date <= maxDate)?.date;

  const marks = useMemo(() => {
    const out: Record<string, DayMark> = {};
    for (const day of monthState.data ?? []) out[day.date] = !day.open ? 'closed' : day.hasAvailability ? 'available' : 'full';
    return out;
  }, [monthState.data]);

  return (
    <div className="xp-stack">
      <Calendar value={date} onChange={onDate} today={today} maxDate={maxDate} marks={marks} onMonthChange={setMonth} language={language} />
      <div className="xp-slots-wrap" aria-live="polite">
        {dayState.loading ? (
          <div className="xp-slots" aria-hidden="true">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="xp-skel-slot" />
            ))}
          </div>
        ) : dayState.error ? (
          <div className="xp-stack">
            <p className="xp-error" role="alert">
              {t(errorKey(dayState.error))}
            </p>
            <Button variant="secondary" size="sm" full={false} onClick={dayState.reload}>
              {t('retry')}
            </Button>
          </div>
        ) : dayState.data && dayState.data.slots.length === 0 ? (
          <p className="xp-muted">{t('pub_closed_day')}</p>
        ) : dayState.data ? (
          <>
            {dayIsEmpty ? <p className="xp-muted">{t('pub_no_slots_day')}</p> : null}
            <SlotGrid slots={dayState.data.slots} value={slot} onChange={onSlot} language={language} />
            <p className="xp-hint">{t('pub_summary_duration', { minutes: dayState.data.totalMinutes })}</p>
          </>
        ) : null}

        {dayIsEmpty || (dayState.data && dayState.data.slots.length === 0) ? (
          next ? (
            <div className="xp-notice xp-notice--compact">
              <p>{t('pub_next_available', { day: upperFirst(formatDay(next, language, { weekday: 'long', day: 'numeric', month: 'long' })) })}</p>
              <Button variant="secondary" size="sm" full={false} onClick={() => onDate(next)}>
                {t('pub_next_available_cta', { day: formatDay(next, language, { weekday: 'short', day: 'numeric', month: 'short' }) })}
              </Button>
            </div>
          ) : upcoming.data && !upcoming.loading ? (
            <p className="xp-muted">{t('pub_no_more_days')}</p>
          ) : null
        ) : null}
      </div>
    </div>
  );
}
