import type { BusinessHours } from '@xiro/shared';
import { useId, useState } from 'react';
import { HOUR_OPTIONS, applyRowChange, minuteOptions, rowsOf, setSameEveryDay, validateDay, type HoursRow } from '../hours';
import { Ico } from '../icons';
import { Button } from './Button';
import { Modal } from './Modal';
import { cx, useWebStyles } from './shared';

type T = (key: string) => string;

/** Selector de hora en 24 h: dos listas (hora y minutos) que no dependen del formato regional del navegador. */
function TimeSelect({ legend, hourLabel, minuteLabel, value, onChange }: { legend: string; hourLabel: string; minuteLabel: string; value: string; onChange: (value: string) => void }) {
  const [hh = '09', mm = '00'] = value.split(':');
  return (
    <fieldset className="xw-time">
      <legend className="xw-label">{legend}</legend>
      <div className="xw-time-row">
        <div className="xw-control">
          <select aria-label={`${legend}: ${hourLabel}`} value={hh} onChange={(e) => onChange(`${e.target.value}:${mm}`)}>
            {HOUR_OPTIONS.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
        </div>
        <span aria-hidden="true">:</span>
        <div className="xw-control">
          <select aria-label={`${legend}: ${minuteLabel}`} value={mm} onChange={(e) => onChange(`${hh}:${e.target.value}`)}>
            {minuteOptions(mm).map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
      </div>
    </fieldset>
  );
}

function rowLabel(row: HoursRow, t: T): string {
  if (row.id === 'weekdays') return t('hours_weekdays');
  return t(`day_${row.day}`);
}

/**
 * Horario editable. Con "mismo horario todos los días" activo se muestran tres filas (L–V, sábado, domingo) y cualquier
 * cambio se aplica a toda la semana; desactivado, se desglosa de lunes a domingo.
 */
export function HoursEditor({ hours, onChange, t, error }: { hours: BusinessHours; onChange: (hours: BusinessHours) => void; t: T; error?: string }) {
  useWebStyles();
  const switchId = useId();
  const [editing, setEditing] = useState<HoursRow | null>(null);
  const [draft, setDraft] = useState({ open: true, from: '09:00', to: '19:00' });
  const [draftError, setDraftError] = useState<string | null>(null);

  const startEdit = (row: HoursRow) => {
    setDraft({ open: row.open, from: row.from, to: row.to });
    setDraftError(null);
    setEditing(row);
  };
  const save = () => {
    const problem = validateDay(draft);
    if (problem) return setDraftError(t(problem));
    if (editing) onChange(applyRowChange(hours, editing, draft));
    setEditing(null);
  };

  return (
    <div className="xw-hours">
      <div className="xw-switch-row">
        <input id={switchId} className="xw-switch" type="checkbox" role="switch" checked={hours.sameEveryDay} onChange={(e) => onChange(setSameEveryDay(hours, e.target.checked))} />
        <label htmlFor={switchId}>{t('same_hours')}</label>
      </div>

      <ul className="xw-hours-list" aria-label={t('hours')}>
        {rowsOf(hours).map((row) => {
          const label = rowLabel(row, t);
          return (
            <li key={String(row.id)} className="xw-hours-row">
              <span className={cx('xw-dot', row.open && 'is-open')} aria-hidden="true" />
              <span className="xw-hours-day">{label}</span>
              <span className="xw-hours-time">{row.open ? `${row.from} — ${row.to}` : t('closed')}</span>
              <button type="button" className="xw-icon-btn xw-hours-edit" aria-label={`${t('edit_day')} ${label}`} onClick={() => startEdit(row)}>
                <Ico name="pencil" size={18} />
              </button>
            </li>
          );
        })}
      </ul>
      {error ? (
        <p className="xw-error" role="alert">
          <Ico name="triangle-alert" size={16} />
          <span>{error}</span>
        </p>
      ) : null}

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing ? `${t('edit_day')} ${rowLabel(editing, t)}` : ''}
        closeLabel={t('close')}
        footer={
          <>
            <Button variant="ghost" onPress={() => setEditing(null)}>
              {t('cancel')}
            </Button>
            <Button onPress={save}>{t('save')}</Button>
          </>
        }>
        <div className="xw-switch-row">
          <input id={`${switchId}-open`} className="xw-switch" type="checkbox" role="switch" checked={draft.open} onChange={(e) => setDraft({ ...draft, open: e.target.checked })} />
          <label htmlFor={`${switchId}-open`}>{t('day_open')}</label>
        </div>
        {draft.open ? (
          <div className="xw-time-grid">
            <TimeSelect legend={t('open_time')} hourLabel={t('hour')} minuteLabel={t('minute')} value={draft.from} onChange={(from) => setDraft({ ...draft, from })} />
            <TimeSelect legend={t('close_time')} hourLabel={t('hour')} minuteLabel={t('minute')} value={draft.to} onChange={(to) => setDraft({ ...draft, to })} />
          </div>
        ) : null}
        <p className="xw-error" role="alert">
          {draftError ? (
            <>
              <Ico name="triangle-alert" size={16} />
              <span>{draftError}</span>
            </>
          ) : null}
        </p>
      </Modal>
    </div>
  );
}
