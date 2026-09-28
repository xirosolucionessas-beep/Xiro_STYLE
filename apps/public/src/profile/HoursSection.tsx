import { translate, type Language, type PublicBookingProfile } from '@xiro/shared';
import { hoursRows } from '../lib/hours';

/** Horarios de atención: los siete días con el de hoy resaltado (en la zona horaria del negocio). No se muestra si no hay ningún horario. */
export function HoursSection({ profile, language }: { profile: PublicBookingProfile; language: Language }) {
  const t = (key: string) => translate(language, key);
  if (profile.hours.length === 0) return null;
  const rows = hoursRows(profile.hours, language, profile.timezone);
  return (
    <section className="xp-section" id="horarios" aria-labelledby="xp-hours-h">
      <h2 id="xp-hours-h">{t('pub_nav_hours')}</h2>
      <dl className="xp-hours">
        {rows.map((row) => (
          <div key={row.weekday} className={`xp-hours-row${row.today ? ' is-today' : ''}${row.closed ? ' is-closed' : ''}`} aria-current={row.today ? 'date' : undefined}>
            <dt>
              {row.label}
              {row.today ? <span className="xp-tag">{t('pub_hours_today')}</span> : null}
            </dt>
            <dd>{row.text}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
