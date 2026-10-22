import { accountAccessSummary, accountAccessTextKeys, type Subscription } from '@xiro/shared';
import { useWebStyles } from './shared';

type T = (key: string, params?: Record<string, string | number>) => string;

export interface SubscriptionStatusViewProps {
  t: T;
  language: string;
  /** Zona horaria del negocio: las fechas se muestran como las ve el negocio, no según la del navegador. */
  timezone: string;
  isOwner: boolean;
  state: { kind: 'loading' } | { kind: 'error'; retrying: boolean } | { kind: 'ready'; subscription: Subscription };
  onRetry: () => void;
  onManage: () => void;
  /** Solo pruebas: "ahora" fijo. */
  now?: Date;
}

/**
 * Tarjeta "Suscripción y estado de cuenta" del perfil (web). Presentación pura: los datos llegan de GET /api/subscription
 * y la regla de qué estado y qué fecha mostrar vive en @xiro/shared (la misma que usa la app nativa).
 */
export function SubscriptionStatusView({ t, language, timezone, isOwner, state, onRetry, onManage, now }: SubscriptionStatusViewProps) {
  useWebStyles();
  const formatDate = (iso: string) => new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'es-CO', { dateStyle: 'long', timeZone: timezone }).format(new Date(iso));
  const title = (
    <h2 className="xw-label" id="xw-account-access-title" style={{ margin: 0 }}>
      {t('account_access_title')}
    </h2>
  );

  if (state.kind === 'loading') {
    return (
      <section className="xw-card" aria-labelledby="xw-account-access-title" aria-busy="true" style={{ marginBottom: 'var(--xw-space-4)' }}>
        {title}
        <p className="xw-hint">{t('account_access_loading')}</p>
      </section>
    );
  }
  if (state.kind === 'error') {
    return (
      <section className="xw-card" aria-labelledby="xw-account-access-title" style={{ marginBottom: 'var(--xw-space-4)' }}>
        {title}
        <p role="alert" style={{ color: 'var(--xw-danger)' }}>
          {t('account_access_error')}
        </p>
        <button type="button" className="xw-link-btn" disabled={state.retrying} onClick={onRetry}>
          {t('account_access_retry')}
        </button>
      </section>
    );
  }

  const summary = accountAccessSummary(state.subscription, now);
  const keys = accountAccessTextKeys(summary);
  const tone = summary.kind === 'grace' ? 'is-warning' : summary.hasAccess ? 'is-success' : 'is-danger';

  return (
    <section className="xw-card" aria-labelledby="xw-account-access-title" style={{ marginBottom: 'var(--xw-space-4)', display: 'grid', gap: 'var(--xw-space-2)' }}>
      {title}
      <p style={{ margin: 0 }}>
        <span className={`xw-badge ${tone}`}>
          <span className="xw-badge-dot" aria-hidden="true" />
          {t(keys.title)}
        </span>
      </p>
      <p className="xw-hint" style={{ margin: 0 }}>
        {t(keys.description)}
      </p>
      {keys.dateLabel ? (
        <div>
          <span className="xw-label">{t(keys.dateLabel)}</span>
          <p className="xw-profile-value" style={{ margin: 0 }}>
            {summary.endsAt ? <time dateTime={summary.endsAt}>{formatDate(summary.endsAt)}</time> : t('account_access_date_unknown')}
          </p>
          {keys.days ? <p className="xw-note">{t(keys.days.key, keys.days.n !== undefined ? { n: keys.days.n } : undefined)}</p> : null}
        </div>
      ) : null}
      {summary.courtesyEndsAt && summary.kind !== 'courtesy' ? <p className="xw-note">{t('account_access_courtesy_also', { date: formatDate(summary.courtesyEndsAt) })}</p> : null}
      {summary.upcomingCourtesy ? (
        <p className="xw-note">{t('account_access_upcoming', { from: formatDate(summary.upcomingCourtesy.startsAt), to: formatDate(summary.upcomingCourtesy.endsAt) })}</p>
      ) : null}
      {isOwner ? (
        <p style={{ margin: 0 }}>
          <button type="button" className="xw-link-btn" onClick={onManage}>
            {t('account_access_manage')}
          </button>
        </p>
      ) : (
        <p className="xw-note">{t('account_access_employee_note')}</p>
      )}
    </section>
  );
}
