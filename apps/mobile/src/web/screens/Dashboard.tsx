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

/** Flujo de caja del día, ya formateado (ver lib/cashFlow.ts para las cuentas). */
export interface CashFlowView {
  loading: boolean;
  error?: string;
  net: string;
  netTone: 'success' | 'danger' | 'neutral';
  income: string;
  expenses: string;
  /** 0–1: proporción de entradas y de gastos para la barra. */
  incomeShare: number;
  expenseShare: number;
  tipsNote?: string;
  empty: boolean;
  methods: Array<{ id: string; label: string; value: string }>;
  cash: { kind: 'open'; current: string; base: string; delta: string; deltaTone: 'success' | 'danger' | 'neutral' } | { kind: 'closed' } | { kind: 'not_opened'; onOpen: () => void };
  closeHref: string;
}

export interface DashboardViewProps {
  t: HeaderT;
  /** "Buenos días" ya resuelto con la hora del negocio. */
  greeting: string;
  businessName: string;
  logo: ReactNode;
  /** Foto del negocio para el banner; sin ella, degradado dorado de marca. */
  heroUrl?: string | null;
  onChangeLogo: () => void;
  logoBusy: boolean;
  kpis: KpiView[];
  /** Flujo de caja del día (solo el dueño; null = no se muestra). */
  cashFlow?: CashFlowView | null;
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

      {props.cashFlow ? <CashFlowCard flow={props.cashFlow} t={t} navigate={navigate} /> : null}

      <div className="xw-dash-grid">
        <div className="xw-dash-col">
          {actions.length > 0 ? (
            <Panel title={t('quick_actions')}>
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

/**
 * "Flujo de caja diario": neto del día grande (verde si es positivo, rojo si es negativo), entradas frente a gastos con una
 * barra proporcional, lo cobrado por método y, con la caja abierta, el efectivo que debería haber frente a la base inicial.
 */
function CashFlowCard({ flow, t, navigate }: { flow: CashFlowView; t: HeaderT; navigate: (href: string) => void }) {
  return (
    <section className="xw-cf" aria-labelledby="xw-cf-title">
      <header className="xw-cf-head">
        <div className="xw-cf-heading">
          <span className="xw-cf-badge" aria-hidden="true">
            <Ico name="wallet" size={18} />
          </span>
          <div>
            <h2 id="xw-cf-title" className="xw-cf-title">
              {t('home_cf_title')}
            </h2>
            <p className="xw-cf-sub">{t('home_cf_sub')}</p>
          </div>
        </div>
        <a className="xw-cf-link" {...linkProps(flow.closeHref, navigate)}>
          {t('home_cf_see_close')}
          <Ico name="chevron-right" size={16} />
        </a>
      </header>

      {flow.loading ? <LoadingRows label={t('dash_loading')} /> : null}
      {!flow.loading && flow.error ? <p className="xw-panel-empty">{flow.error}</p> : null}
      {!flow.loading && !flow.error ? (
        <div className="xw-cf-body">
          <div className="xw-cf-main">
            <span className="xw-cf-label">{t('home_cf_net')}</span>
            <span className={cx('xw-cf-net', flow.netTone !== 'neutral' && `is-${flow.netTone}`)}>{flow.net}</span>
            <div className="xw-cf-flows">
              <span className="xw-cf-flow is-in">
                <span className="xw-cf-flow-ic" aria-hidden="true">
                  <Ico name="trending-up" size={16} />
                </span>
                <span className="xw-cf-flow-text">
                  <span className="xw-cf-flow-label">{t('home_cf_in')}</span>
                  <span className="xw-cf-flow-value">{flow.income}</span>
                </span>
              </span>
              <span className="xw-cf-flow is-out">
                <span className="xw-cf-flow-ic" aria-hidden="true">
                  <Ico name="trending-down" size={16} />
                </span>
                <span className="xw-cf-flow-text">
                  <span className="xw-cf-flow-label">{t('home_cf_out')}</span>
                  <span className="xw-cf-flow-value">{flow.expenses}</span>
                </span>
              </span>
            </div>
            <div className="xw-cf-bar" aria-hidden="true">
              <span className="xw-cf-bar-in" style={{ flexGrow: flow.incomeShare }} />
              <span className="xw-cf-bar-out" style={{ flexGrow: flow.expenseShare }} />
            </div>
            {flow.empty ? <p className="xw-cf-note">{t('home_cf_empty')}</p> : null}
            {flow.tipsNote ? <p className="xw-cf-note">{flow.tipsNote}</p> : null}
            {flow.methods.length > 0 ? (
              <ul className="xw-cf-methods" aria-label={t('home_cf_by_method')}>
                {flow.methods.map((m) => (
                  <li key={m.id}>
                    <span>{m.label}</span>
                    <strong>{m.value}</strong>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="xw-cf-cash">
            {flow.cash.kind === 'open' ? (
              <>
                <span className="xw-cf-label">{t('home_cf_cash_now')}</span>
                <span className="xw-cf-cash-value">{flow.cash.current}</span>
                <span className={cx('xw-cf-delta', flow.cash.deltaTone !== 'neutral' && `is-${flow.cash.deltaTone}`)}>{flow.cash.delta}</span>
                <span className="xw-cf-base">
                  <span>{t('home_cf_base')}</span>
                  <strong>{flow.cash.base}</strong>
                </span>
              </>
            ) : flow.cash.kind === 'closed' ? (
              <>
                <span className="xw-cf-cash-ic" aria-hidden="true">
                  <Ico name="circle-check" size={22} />
                </span>
                <span className="xw-cf-cash-text">{t('home_cf_closed')}</span>
              </>
            ) : (
              <>
                <span className="xw-cf-cash-text">{t('home_cf_not_opened')}</span>
                <button type="button" className="xw-btn xw-btn--secondary xw-btn--sm" onClick={flow.cash.onOpen}>
                  {t('home_cf_open_cash')}
                </button>
              </>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
