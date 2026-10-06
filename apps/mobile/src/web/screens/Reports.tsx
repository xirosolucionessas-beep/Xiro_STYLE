import type { ReportPeriod } from '../../lib/sections';
import { Ico, type IconName } from '../icons';
import { linkProps } from '../ui/link';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { EmptyPanel, KpiRow, LoadingRows, Panel, type KpiView } from '../ui/Page';
import { cx, useWebStyles } from '../ui/shared';

type T = (key: string, params?: Record<string, string | number>) => string;

export interface BarView {
  key: string;
  /** Etiqueta corta visible bajo la barra ("" = solo para lectores de pantalla). */
  label: string;
  /** Texto completo para lectores de pantalla ("lun 21: $ 30.000"). */
  aria: string;
  /** Altura relativa 0–1. */
  height: number;
  /** Monto formateado sobre la barra (solo periodos cortos). */
  value?: string;
  empty: boolean;
  /** Información contextual al pasar el cursor (sección 1.6: tooltip). */
  tooltip: { dateLabel: string; amountLabel: string; countLabel: string };
}

export interface RankView {
  id: string;
  name: string;
  /** Detalle principal a la derecha (monto o cantidad). */
  value: string;
  /** Detalle secundario ("3 veces"). */
  sub: string;
}

/** Comparativa de crecimiento (sección 1.2): periodo elegido vs. el inmediatamente anterior equivalente. */
export interface GrowthView {
  direction: 'up' | 'down' | 'flat' | 'none';
  /** "+18.4%" / "-7.2%" ya formateado; `null` sin base de comparación (periodo anterior en cero). */
  percentLabel: string | null;
  currentLabel: string;
  previousLabel: string;
}

export interface PaymentMethodView {
  id: string;
  label: string;
  amountLabel: string;
  percent: number;
}

export interface EmployeeView {
  id: string;
  name: string;
  countLabel: string;
  amountLabel: string;
  percent: number;
}

/** "Total en Caja = Base Inicial + Ventas en Efectivo" del periodo; `null` solo mientras carga o sin rango resuelto. */
export interface CashBalanceView {
  openingLabel: string;
  cashSalesLabel: string;
  totalLabel: string;
}

export interface ReportsViewProps {
  t: T;
  period: ReportPeriod;
  onPeriod: (period: ReportPeriod) => void;
  customFrom: string;
  customTo: string;
  onCustomFrom: (value: string) => void;
  onCustomTo: (value: string) => void;
  customError?: string;
  /** "1 – 30 sept 2026", ya formateado: qué periodo se está viendo exactamente. */
  rangeLabel: string;
  kpis: KpiView[];
  growth: GrowthView | null;
  loading: boolean;
  /** No hubo ventas en el periodo. */
  empty: boolean;
  bars: BarView[];
  topServices: RankView[];
  topProducts: RankView[];
  topClients: RankView[];
  paymentMethods: PaymentMethodView[];
  /** `null` = aún no hay datos suficientes (cargando o sin rango resuelto); nunca se muestra con cifras a medias. */
  cashBalance: CashBalanceView | null;
  employees: EmployeeView[];
  stock: { value: string; low: number; href: string } | null;
  note?: string;
  navigate: (href: string) => void;
  onExportPdf: () => void;
  onExportExcel: () => void;
  exportingPdf: boolean;
  exportingExcel: boolean;
}

function PeriodChips({ t, period, onPeriod }: { t: T; period: ReportPeriod; onPeriod: (p: ReportPeriod) => void }) {
  const options: Array<{ id: ReportPeriod; label: string }> = [
    { id: 'today', label: t('sec_period_today') },
    { id: 'week', label: t('sec_period_week') },
    { id: 'month', label: t('sec_period_month') },
    { id: 'year', label: t('sec_period_year') },
    { id: 'custom', label: t('sec_period_custom') },
  ];
  return (
    <div className="xw-fchips" role="radiogroup" aria-label={t('sec_period')}>
      <span className="xw-fchips-label" aria-hidden="true">
        <Ico name="calendar-days" size={16} />
        {t('sec_period')}
      </span>
      {options.map((option) => (
        <button key={option.id} type="button" role="radio" aria-checked={period === option.id} className="xw-fchip" onClick={() => onPeriod(option.id)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

function GrowthCard({ t, growth }: { t: T; growth: GrowthView }) {
  if (growth.direction === 'none') {
    return (
      <div className="xw-rep-growth is-none">
        <span className="xw-rep-growth-icon" aria-hidden="true">
          <Ico name="activity" size={22} />
        </span>
        <div>
          <p className="xw-rep-growth-text">{t('sec_rep_growth_none')}</p>
        </div>
      </div>
    );
  }
  const icon = growth.direction === 'up' ? 'trending-up' : growth.direction === 'down' ? 'trending-down' : 'activity';
  const statusKey = growth.percentLabel === null ? 'sec_rep_growth_new' : growth.direction === 'up' ? 'sec_rep_growth_up' : growth.direction === 'down' ? 'sec_rep_growth_down' : 'sec_rep_growth_flat';
  return (
    <div className={cx('xw-rep-growth', `is-${growth.direction}`)} role="status">
      <span className="xw-rep-growth-icon" aria-hidden="true">
        <Ico name={icon} size={22} />
      </span>
      <div className="xw-rep-growth-body">
        {growth.percentLabel !== null ? <p className="xw-rep-growth-percent">{growth.percentLabel}</p> : null}
        <p className="xw-rep-growth-text">{t(statusKey)}</p>
        <p className="xw-rep-growth-values">{t('sec_rep_growth_values', { previous: growth.previousLabel, current: growth.currentLabel })}</p>
      </div>
    </div>
  );
}

function RankList({ t, rows, emptyIcon }: { t: T; rows: RankView[]; emptyIcon: IconName }) {
  if (rows.length === 0) return <EmptyPanel icon={emptyIcon} title={t('sec_rep_empty')} />;
  return (
    <ol className="xw-rank">
      {rows.map((row) => (
        <li key={row.id}>
          <span className="xw-rank-name">{row.name}</span>
          <span className="xw-cell-sub">{row.sub}</span>
          <span className="xw-rank-val">{row.value}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Reportes: ventas, servicios y clientes del periodo elegido, con filtro de fechas dinámico (hoy/semana/mes/año/
 * personalizado), comparativa de crecimiento, desglose por forma de pago y por profesional, y exportación a PDF/Excel.
 * Calculado con datos reales (ventas del negocio); sin datos → estados vacíos, nunca cifras inventadas.
 */
export function ReportsView({
  t,
  period,
  onPeriod,
  customFrom,
  customTo,
  onCustomFrom,
  onCustomTo,
  customError,
  rangeLabel,
  kpis,
  growth,
  loading,
  empty,
  bars,
  topServices,
  topProducts,
  topClients,
  paymentMethods,
  cashBalance,
  employees,
  stock,
  note,
  navigate,
  onExportPdf,
  onExportExcel,
  exportingPdf,
  exportingExcel,
}: ReportsViewProps) {
  useWebStyles();
  return (
    <div className="xw-section xw-fade-in">
      <div className="xw-rep-toolbar">
        <PeriodChips t={t} period={period} onPeriod={onPeriod} />
        <div className="xw-rep-exports">
          <Button variant="secondary" size="sm" icon={<Ico name="download" size={16} />} loading={exportingPdf} loadingLabel={t('loading')} onPress={onExportPdf}>
            {t('sec_rep_export_pdf')}
          </Button>
          <Button variant="secondary" size="sm" icon={<Ico name="download" size={16} />} loading={exportingExcel} loadingLabel={t('loading')} onPress={onExportExcel}>
            {t('sec_rep_export_excel')}
          </Button>
        </div>
      </div>

      {period === 'custom' ? (
        <div className="xw-rep-daterange">
          <Input label={t('sec_period_from')} type="date" value={customFrom} max={customTo || undefined} onChange={onCustomFrom} />
          <Input label={t('sec_period_to')} type="date" value={customTo} min={customFrom || undefined} onChange={onCustomTo} error={customError} />
        </div>
      ) : (
        <p className="xw-hint" style={{ margin: 0 }}>
          {rangeLabel}
        </p>
      )}

      <KpiRow kpis={kpis} label={t('dash_kpis')} t={t} />
      {growth ? <GrowthCard t={t} growth={growth} /> : null}
      {note ? (
        <p className="xw-hint" role="note" style={{ margin: 0 }}>
          {note}
        </p>
      ) : null}

      <div className="xw-panels">
        <Panel title={t('sec_rep_chart')} icon="bar-chart" className="xw-span-all">
          {loading ? <LoadingRows label={t('dash_loading')} /> : null}
          {!loading && empty ? <EmptyPanel icon="bar-chart" title={t('sec_rep_empty')} /> : null}
          {!loading && !empty ? (
            <ul className="xw-bars" aria-label={t('sec_rep_chart')} style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {bars.map((bar) => (
                <li key={bar.key} className={cx('xw-bar', bar.empty && 'is-empty')}>
                  {bar.value ? <span className="xw-bar-value">{bar.value}</span> : null}
                  <span className="xw-bar-fill" style={{ height: `${Math.max(bar.height * 100, 2)}%` }} aria-hidden="true" />
                  <span className="xw-bar-tooltip" role="tooltip" aria-hidden="true">
                    <strong>{bar.tooltip.dateLabel}</strong>
                    <span>{bar.tooltip.amountLabel}</span>
                    <span>{bar.tooltip.countLabel}</span>
                  </span>
                  <span className="xw-sr">{bar.aria}</span>
                  <span className="xw-bar-label" aria-hidden="true">
                    {bar.label}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </Panel>

        <Panel title={t('sec_rep_payment_methods')} icon="credit-card">
          {loading ? <LoadingRows label={t('dash_loading')} /> : null}
          {!loading && cashBalance ? (
            <div className="xw-rep-cashbalance">
              <div className="xw-rep-cashbalance-row">
                <span>{t('sec_rep_opening_base')}</span>
                <span>{cashBalance.openingLabel}</span>
              </div>
              <div className="xw-rep-cashbalance-row">
                <span>{t('sec_rep_cash_sales')}</span>
                <span>{cashBalance.cashSalesLabel}</span>
              </div>
              <div className="xw-rep-cashbalance-row xw-rep-cashbalance-total">
                <span>{t('sec_rep_cash_total')}</span>
                <span>{cashBalance.totalLabel}</span>
              </div>
            </div>
          ) : null}
          {!loading && paymentMethods.length === 0 ? <EmptyPanel icon="credit-card" title={t('sec_rep_empty')} /> : null}
          {paymentMethods.length > 0 ? (
            <ul className="xw-rep-methods" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {paymentMethods.map((row) => (
                <li key={row.id} className="xw-rep-method-row">
                  <div className="xw-rep-method-top">
                    <span>{row.label}</span>
                    <span className="xw-rank-val">{row.amountLabel}</span>
                  </div>
                  <div className="xw-rep-method-bar">
                    <span className="xw-rep-method-fill" style={{ width: `${row.percent}%` }} />
                  </div>
                  <span className="xw-cell-sub">{t('sec_rep_percent_of_total', { n: row.percent })}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </Panel>

        <Panel title={t('sec_rep_employees')} icon="users">
          {loading ? <LoadingRows label={t('dash_loading')} /> : null}
          {!loading && employees.length === 0 ? <EmptyPanel icon="users" title={t('sec_rep_employees_empty')} /> : null}
          {employees.length > 0 ? (
            <ol className="xw-rank">
              {employees.map((row) => (
                <li key={row.id}>
                  <span className="xw-rank-name">{row.name}</span>
                  <span className="xw-cell-sub">
                    {row.countLabel} · {t('sec_rep_percent_of_total', { n: row.percent })}
                  </span>
                  <span className="xw-rank-val">{row.amountLabel}</span>
                </li>
              ))}
            </ol>
          ) : null}
        </Panel>

        <Panel title={t('sec_rep_top_services')} icon="scissors">
          {loading ? <LoadingRows label={t('dash_loading')} /> : <RankList t={t} rows={topServices} emptyIcon="scissors" />}
        </Panel>

        <Panel title={t('sec_rep_top_products')} icon="package">
          {loading ? <LoadingRows label={t('dash_loading')} /> : <RankList t={t} rows={topProducts} emptyIcon="package" />}
        </Panel>

        <Panel title={t('sec_rep_top_clients')} icon="users">
          {loading ? <LoadingRows label={t('dash_loading')} /> : <RankList t={t} rows={topClients} emptyIcon="users" />}
        </Panel>

        {stock ? (
          <Panel title={t('sec_rep_stock')} icon="package" className="xw-span-all">
            <dl className="xw-summary">
              <div className="xw-summary-row">
                <dt>{t('sec_rep_stock_value')}</dt>
                <dd>{stock.value}</dd>
              </div>
              <div className="xw-summary-row">
                <dt>{t('sec_rep_stock_low')}</dt>
                <dd>
                  <a className="xw-link-btn" {...linkProps(stock.href, navigate)}>
                    {stock.low}
                  </a>
                </dd>
              </div>
            </dl>
          </Panel>
        ) : null}
      </div>
    </div>
  );
}
