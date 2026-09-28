import type { CSSProperties, ReactNode } from 'react';
import { Ico, type IconName } from '../icons';
import type { HeaderT } from '../shell/HeaderTools';
import { Badge, KpiRow, LoadingRows, Panel, type KpiView } from '../ui/Page';
import { linkProps } from '../ui/link';
import { cx, useWebStyles } from '../ui/shared';
import { ActionTile, type HomeAction } from './Home';

export interface SummaryRow {
  id: string;
  label: string;
  value: string;
}

export interface StockRow {
  id: string;
  name: string;
  badge: string;
  out: boolean;
  href: string;
}

export interface ActivityRowView {
  id: string;
  icon: IconName;
  title: string;
  detail?: string;
  time: string;
  amount?: string;
}

export interface AppointmentRowView {
  id: string;
  /** "lun 5" — día corto ya formateado. */
  day: string;
  time: string;
  client: string;
  detail: string;
  status: string;
  tone: 'success' | 'warning' | 'danger' | 'accent' | 'muted';
  href: string;
}

export interface DashboardViewProps {
  t: HeaderT;
  /** "Buenos días" ya resuelto con la hora del negocio. */
  greeting: string;
  businessName: string;
  userName: string;
  businessSlug: string;
  logo: ReactNode;
  /** Foto del negocio para el banner; sin ella, degradado dorado de marca. */
  heroUrl?: string | null;
  onChangeLogo: () => void;
  logoBusy: boolean;
  onEditProfile: () => void;
  kpis: KpiView[];
  actions: HomeAction[];
  needsWhatsappSetup: boolean;
  onGoBusinessSettings: () => void;
  /** null: esta persona no ve el resumen (sin permiso para registrar servicios). */
  summary: { loading: boolean; rows: SummaryRow[]; empty: boolean } | null;
  stock: { loading: boolean; rows: StockRow[]; allHref: string } | null;
  activity: { loading: boolean; rows: ActivityRowView[] } | null;
  /** Próximas citas; null = esta persona no ve la agenda. */
  appointments: { loading: boolean; rows: AppointmentRowView[]; allHref: string } | null;
  /** Aviso "Revisa tus servicios y productos" (solo quien gestiona el catálogo y solo si hay pendientes). */
  reviewBanner: { count: number; href: string } | null;
  onOpenAssistant: () => void;
  navigate: (href: string) => void;
  year: number;
  supportHref: string;
}

/**
 * Tablero de Inicio de la web (rediseño): banner de bienvenida, indicadores con variación, accesos rápidos, próximas citas,
 * resumen del día, bajo inventario, actividad reciente, asistente y pie institucional. Puro: todo llega por props y solo
 * muestra datos reales (lo que aún no existe, como las citas, se dice "Próximamente").
 */
export function DashboardView(props: DashboardViewProps) {
  useWebStyles();
  const { t, kpis, actions, summary, stock, activity, appointments, reviewBanner, navigate } = props;
  const hero: CSSProperties | undefined = props.heroUrl ? { backgroundImage: `linear-gradient(100deg, rgba(8,8,10,.92) 8%, rgba(8,8,10,.55) 60%, rgba(8,8,10,.35)), url("${props.heroUrl}")` } : undefined;
  const initial = props.userName.trim().charAt(0).toUpperCase() || '?';

  const link = (href: string) => linkProps(href, navigate);

  return (
    <div className="xw-dash">
      <section className={cx('xw-hero xw-scope-dark', props.heroUrl && 'has-photo')} style={hero}>
        <div className="xw-hero-brand">
          <span className="xw-hero-logo">{props.logo}</span>
          <button type="button" className="xw-home-cam" aria-label={t('logo_change')} disabled={props.logoBusy} onClick={props.onChangeLogo}>
            {props.logoBusy ? <span className="xw-spinner" aria-hidden="true" /> : <Ico name="camera" size={14} />}
          </button>
        </div>
        <div className="xw-hero-text">
          <h2 className="xw-hero-title">{t('dash_welcome', { greeting: props.greeting, business: props.businessName })}</h2>
          <p className="xw-hero-sub">{t('dash_tagline')}</p>
        </div>
        <button type="button" className="xw-hero-account" aria-label={t('edit_profile')} onClick={props.onEditProfile}>
          <span className="xw-hero-account-text">
            <span className="xw-home-name">{props.userName}</span>
            <span className="xw-home-sub">{t('dash_account', { slug: props.businessSlug })}</span>
          </span>
          <span className="xw-home-avatar" aria-hidden="true">
            {initial}
          </span>
        </button>
      </section>

      {props.needsWhatsappSetup ? (
        <button type="button" className="xw-card xw-setup" onClick={props.onGoBusinessSettings}>
          <span className="xw-setup-ic" aria-hidden="true">
            <Ico name="message-square" size={20} />
          </span>
          <span className="xw-setup-text">
            <span className="xw-tile-label">{t('business_settings')}</span>
            <br />
            <span className="xw-home-sub">{t('business_whatsapp')}</span>
          </span>
          <span className="xw-setup-chevron" aria-hidden="true">
            <Ico name="chevron-right" size={18} />
          </span>
        </button>
      ) : null}

      {reviewBanner ? (
        <a className="xw-card xw-setup" {...linkProps(reviewBanner.href, navigate)}>
          <span className="xw-setup-ic" aria-hidden="true">
            <Ico name="circle-check" size={20} />
          </span>
          <span className="xw-setup-text">
            <span className="xw-tile-label">{t('review_banner', { count: reviewBanner.count })}</span>
            <br />
            <span className="xw-home-sub">{t('review_banner_hint')}</span>
          </span>
          <span className="xw-setup-chevron" aria-hidden="true">
            <Ico name="chevron-right" size={18} />
          </span>
        </a>
      ) : null}

      <KpiRow kpis={kpis} label={t('dash_kpis')} t={t} />

      <div className="xw-dash-grid">
        <div className="xw-dash-col">
          {actions.length > 0 ? (
            <Panel title={t('quick_actions')} icon="sparkles">
              <p className="xw-panel-sub">{t('dash_actions_sub')}</p>
              <div className="xw-actions-grid">
                {actions.map((action) => (
                  <ActionTile key={action.id} action={action} t={t} navigate={navigate} />
                ))}
              </div>
            </Panel>
          ) : null}

          {activity ? (
            <Panel title={t('dash_activity_title')} icon="activity">
              {activity.loading ? <LoadingRows label={t('dash_loading')} /> : null}
              {!activity.loading && activity.rows.length === 0 ? <p className="xw-panel-empty">{t('dash_activity_empty')}</p> : null}
              {activity.rows.length > 0 ? (
                <ul className="xw-timeline">
                  {activity.rows.map((row) => (
                    <li key={row.id} className="xw-timeline-row">
                      <span className="xw-timeline-ic" aria-hidden="true">
                        <Ico name={row.icon} size={16} />
                      </span>
                      <span className="xw-timeline-text">
                        <span className="xw-timeline-title">{row.title}</span>
                        {row.detail ? <span className="xw-timeline-detail">{row.detail}</span> : null}
                      </span>
                      <span className="xw-timeline-meta">
                        {row.amount ? <span className="xw-timeline-amount">{row.amount}</span> : null}
                        <span className="xw-timeline-time">{row.time}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </Panel>
          ) : null}
        </div>

        <div className="xw-dash-col">
          {appointments ? (
            <Panel
              title={t('dash_appointments_title')}
              icon="calendar-days"
              action={
                <a className="xw-link-btn" {...link(appointments.allHref)}>
                  {t('dash_appts_see_all')}
                </a>
              }>
              {appointments.loading ? <LoadingRows label={t('dash_loading')} /> : null}
              {!appointments.loading && appointments.rows.length === 0 ? <p className="xw-panel-empty">{t('dash_appts_empty')}</p> : null}
              {appointments.rows.length > 0 ? (
                <ul className="xw-stock">
                  {appointments.rows.map((row) => (
                    <li key={row.id}>
                      <a className="xw-stock-row" {...link(row.href)}>
                        <span className="xw-stock-name">
                          <strong>
                            {row.day} · {row.time}
                          </strong>{' '}
                          {row.client}
                          <br />
                          <span className="xw-home-sub">{row.detail}</span>
                        </span>
                        <Badge tone={row.tone}>{row.status}</Badge>
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </Panel>
          ) : null}

          {summary ? (
            <Panel title={t('dash_summary_title')} icon="receipt">
              {summary.loading ? <LoadingRows label={t('dash_loading')} /> : null}
              {!summary.loading && summary.empty ? <p className="xw-panel-empty">{t('dash_summary_empty')}</p> : null}
              {!summary.loading && summary.rows.length > 0 ? (
                <dl className="xw-summary">
                  {summary.rows.map((row) => (
                    <div key={row.id} className="xw-summary-row">
                      <dt>{row.label}</dt>
                      <dd>{row.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </Panel>
          ) : null}

          {stock ? (
            <Panel
              title={t('dash_stock_title')}
              icon="package"
              action={
                <a className="xw-link-btn" {...link(stock.allHref)}>
                  {t('dash_stock_see_all')}
                </a>
              }>
              {stock.loading ? <LoadingRows label={t('dash_loading')} /> : null}
              {!stock.loading && stock.rows.length === 0 ? (
                <p className="xw-panel-empty">
                  <Ico name="circle-check" size={16} /> {t('dash_stock_all_good')}
                </p>
              ) : null}
              {stock.rows.length > 0 ? (
                <ul className="xw-stock">
                  {stock.rows.map((row) => (
                    <li key={row.id}>
                      <a className="xw-stock-row" {...link(row.href)}>
                        <span className="xw-stock-name">{row.name}</span>
                        <span className={cx('xw-stock-badge', row.out && 'is-out')}>{row.badge}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </Panel>
          ) : null}

          <section className="xw-assistant xw-scope-dark" aria-labelledby="xw-assistant-title">
            <span className="xw-assistant-ic" aria-hidden="true">
              <Ico name="sparkles" size={24} />
            </span>
            <div className="xw-assistant-text">
              <h2 id="xw-assistant-title" className="xw-assistant-title">
                {t('dash_assistant_title')}
              </h2>
              <p>{t('dash_assistant_text')}</p>
            </div>
            <button type="button" className="xw-btn xw-btn--primary xw-btn--sm" onClick={props.onOpenAssistant}>
              {t('dash_assistant_cta')}
            </button>
          </section>
        </div>
      </div>

      <footer className="xw-dash-footer">
        <p>{t('dash_footer_rights', { year: props.year })}</p>
        <nav aria-label={t('dash_footer_nav')}>
          <a {...link('/terms')}>{t('terms_page_title')}</a>
          <a {...link('/privacy')}>{t('privacy_page_title')}</a>
          <a href={props.supportHref} target="_blank" rel="noopener noreferrer">
            {t('dash_footer_support')}
          </a>
        </nav>
      </footer>
    </div>
  );
}
