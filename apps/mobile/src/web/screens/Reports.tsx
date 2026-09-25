import { linkProps } from '../ui/link';
import { EmptyPanel, FilterChips, KpiRow, LoadingRows, Panel, type KpiView } from '../ui/Page';
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
}

export interface RankView {
  id: string;
  name: string;
  /** Detalle principal a la derecha (monto o cantidad). */
  value: string;
  /** Detalle secundario ("3 veces"). */
  sub: string;
}

export interface ReportsViewProps {
  t: T;
  period: '7' | '30';
  onPeriod: (period: '7' | '30') => void;
  kpis: KpiView[];
  loading: boolean;
  /** No hubo servicios registrados en el periodo. */
  empty: boolean;
  bars: BarView[];
  topServices: RankView[];
  topClients: RankView[];
  stock: { value: string; low: number; href: string } | null;
  note?: string;
  navigate: (href: string) => void;
}

/** Reportes: ventas, servicios y clientes del periodo elegido, calculados con los registros reales. Sin datos → estados vacíos, nunca cifras inventadas. */
export function ReportsView({ t, period, onPeriod, kpis, loading, empty, bars, topServices, topClients, stock, note, navigate }: ReportsViewProps) {
  useWebStyles();
  return (
    <div className="xw-section">
      <FilterChips
        label={t('sec_period')}
        options={[
          { id: '7', label: t('sec_period_7') },
          { id: '30', label: t('sec_period_30') },
        ]}
        value={period}
        onChange={(id) => onPeriod(id === '30' ? '30' : '7')}
      />
      <KpiRow kpis={kpis} label={t('dash_kpis')} t={t} />
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
                  <span className="xw-sr">{bar.aria}</span>
                  <span className="xw-bar-label" aria-hidden="true">
                    {bar.label}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </Panel>

        <Panel title={t('sec_rep_top_services')} icon="scissors">
          {loading ? <LoadingRows label={t('dash_loading')} /> : null}
          {!loading && topServices.length === 0 ? <p className="xw-panel-empty">{t('sec_rep_empty')}</p> : null}
          {topServices.length > 0 ? (
            <ol className="xw-rank">
              {topServices.map((row) => (
                <li key={row.id}>
                  <span className="xw-rank-name">{row.name}</span>
                  <span className="xw-cell-sub">{row.sub}</span>
                  <span className="xw-rank-val">{row.value}</span>
                </li>
              ))}
            </ol>
          ) : null}
        </Panel>

        <Panel title={t('sec_rep_top_clients')} icon="users">
          {loading ? <LoadingRows label={t('dash_loading')} /> : null}
          {!loading && topClients.length === 0 ? <p className="xw-panel-empty">{t('sec_rep_empty')}</p> : null}
          {topClients.length > 0 ? (
            <ol className="xw-rank">
              {topClients.map((row) => (
                <li key={row.id}>
                  <span className="xw-rank-name">{row.name}</span>
                  <span className="xw-cell-sub">{row.sub}</span>
                  <span className="xw-rank-val">{row.value}</span>
                </li>
              ))}
            </ol>
          ) : null}
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
