import { Ico, type IconName } from '../icons';
import { linkProps } from '../ui/link';
import { Panel } from '../ui/Page';
import { useWebStyles } from '../ui/shared';

type T = (key: string, params?: Record<string, string | number>) => string;

const FEATURES: Array<{ icon: IconName; title: string; text: string }> = [
  { icon: 'calendar-days', title: 'sec_agenda_f1_t', text: 'sec_agenda_f1_d' },
  { icon: 'message-circle', title: 'sec_agenda_f2_t', text: 'sec_agenda_f2_d' },
  { icon: 'briefcase', title: 'sec_agenda_f3_t', text: 'sec_agenda_f3_d' },
];

/** Citas: el módulo aún no existe. Se dice con claridad ("Próximamente"), sin citas de ejemplo, y se ofrece lo que sí hay hoy. */
export function AgendaView({ t, navigate }: { t: T; navigate: (href: string) => void }) {
  useWebStyles();
  return (
    <div className="xw-section">
      <section className="xw-soon-hero xw-scope-dark" aria-labelledby="xw-agenda-title">
        <span className="xw-chip">{t('soon')}</span>
        <h2 id="xw-agenda-title">{t('sec_agenda_title')}</h2>
        <p>{t('sec_agenda_text')}</p>
      </section>

      <div className="xw-panels xw-panels--3">
        {FEATURES.map((feature) => (
          <div key={feature.title} className="xw-panel xw-feature">
            <span className="xw-feature-ic" aria-hidden="true">
              <Ico name={feature.icon} size={20} />
            </span>
            <div>
              <h3>{t(feature.title)}</h3>
              <p>{t(feature.text)}</p>
            </div>
          </div>
        ))}
      </div>

      <Panel title={t('sec_agenda_meanwhile')} icon="sparkles">
        <p className="xw-panel-empty" style={{ marginBottom: 'var(--xw-space-3)' }}>
          {t('sec_agenda_meanwhile_text')}
        </p>
        <div className="xw-head-actions">
          <a className="xw-btn xw-btn--secondary" {...linkProps('/clients', navigate)}>
            {t('sec_go_clients')}
          </a>
          <a className="xw-btn xw-btn--secondary" {...linkProps('/reports', navigate)}>
            {t('sec_go_reports')}
          </a>
        </div>
      </Panel>
    </div>
  );
}
