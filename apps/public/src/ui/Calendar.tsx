import { addMonths, formatMonth, monthGrid, translate, upperFirst, weekdayShort, type Language } from '@xiro/shared';
import { useState } from 'react';

export type DayMark = 'available' | 'full' | 'closed';

interface CalendarProps {
  value: string;
  onChange: (date: string) => void;
  today: string;
  maxDate?: string;
  marks?: Record<string, DayMark>;
  onMonthChange?: (firstDayOfMonth: string) => void;
  language: Language;
}

/** Calendario mensual accesible (radiogroup de días), sin librerías: solo Intl. Un día marca si tiene cupo o no. */
export function Calendar({ value, onChange, today, maxDate, marks, onMonthChange, language }: CalendarProps) {
  const t = (key: string, params?: Record<string, string | number>) => translate(language, key, params);
  const [month, setMonth] = useState(`${value.slice(0, 7)}-01`);
  // "Ajustar estado cuando cambia una prop" durante el render (sin efecto): si `value` viene de fuera (p. ej. se eligió
  // una alternativa), el mes mostrado salta al suyo sin esperar un ciclo de render extra.
  const [shownFor, setShownFor] = useState(value);
  if (value !== shownFor) {
    setShownFor(value);
    setMonth(`${value.slice(0, 7)}-01`);
  }

  const go = (delta: number) => {
    const next = addMonths(month, delta);
    setMonth(next);
    onMonthChange?.(next);
  };

  const weeks = monthGrid(month);
  const dayLabel = (date: string, mark?: DayMark) => {
    const base = new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
    return mark === 'available' ? `${base}, ${t('pub_cal_available')}` : mark === 'full' ? `${base}, ${t('pub_cal_full')}` : mark === 'closed' ? `${base}, ${t('pub_cal_closed')}` : base;
  };

  return (
    <div>
      <div className="xp-cal-head">
        <button type="button" className="xp-cal-nav" aria-label={t('pub_cal_prev_month')} onClick={() => go(-1)}>
          ‹
        </button>
        <strong aria-live="polite">{upperFirst(formatMonth(month, language))}</strong>
        <button type="button" className="xp-cal-nav" aria-label={t('pub_cal_next_month')} onClick={() => go(1)}>
          ›
        </button>
      </div>
      <div className="xp-cal-grid" role="radiogroup" aria-label={t('pub_schedule_step_title')}>
        {[1, 2, 3, 4, 5, 6, 0].map((weekday) => (
          <span key={weekday} className="xp-cal-dow">
            {weekdayShort(weekday, language).slice(0, 3)}
          </span>
        ))}
        {weeks.flat().map((date) => {
          const inMonth = date.slice(0, 7) === month.slice(0, 7);
          const mark = date >= today ? marks?.[date] : undefined;
          const past = date < today;
          const beyond = Boolean(maxDate && date > maxDate);
          const disabled = past || beyond || mark === 'closed';
          const selected = date === value;
          return (
            <button
              key={date}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-current={selected ? 'date' : undefined}
              aria-label={dayLabel(date, mark)}
              disabled={disabled}
              onClick={() => onChange(date)}
              className={['xp-cal-day', date === today && 'is-today', !inMonth && 'is-outside'].filter(Boolean).join(' ')}>
              {Number(date.slice(8))}
              {mark === 'available' ? <span className="xp-cal-mark" aria-hidden="true" /> : mark === 'full' ? <span className="xp-cal-mark is-full" aria-hidden="true" /> : null}
            </button>
          );
        })}
      </div>
      <div className="xp-cal-legend">
        <span className="xp-cal-mark" aria-hidden="true" /> {t('pub_cal_available')}
        <span className="xp-cal-mark is-full" aria-hidden="true" /> {t('pub_cal_full')}
      </div>
    </div>
  );
}
