import { translate, type Language } from '@xiro/shared';
import { money } from '../lib/format';
import { Icon } from '../ui/Icon';

export interface SelectionSummary {
  names: string[];
  professional: string | null;
  when: string | null;
  minutes: number;
  price: number;
  currency: string;
}

/** La selección actual, siempre a la vista (fija bajo el progreso): qué se reserva, con quién, cuándo, cuánto dura y cuánto cuesta. */
export function SelectionBar({ summary, language }: { summary: SelectionSummary; language: Language }) {
  const t = (key: string, params?: Record<string, string | number>) => translate(language, key, params);
  const empty = summary.names.length === 0;
  return (
    <div className="xp-selbar" aria-label={t('pub_summary_title')}>
      <div className="xp-selbar-main">
        <p className="xp-selbar-names">{empty ? t('pub_sel_empty') : summary.names.join(' · ')}</p>
        {summary.professional || summary.when ? (
          <p className="xp-selbar-sub">
            {[summary.professional, summary.when].filter(Boolean).join(' · ')}
          </p>
        ) : null}
      </div>
      {!empty ? (
        <div className="xp-selbar-total">
          <span className="xp-price">{money(summary.price, summary.currency)}</span>
          <span className="xp-meta">
            <Icon name="clock" size={14} /> {t('pub_minutes', { minutes: summary.minutes })}
          </span>
        </div>
      ) : null}
    </div>
  );
}
