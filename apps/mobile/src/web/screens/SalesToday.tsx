import type { SalePaymentMethod } from '@xiro/shared';
import { Badge, EmptyPanel, ErrorPanel, FilterChips, KpiRow, LoadingRows, type KpiView } from '../ui/Page';
import { useWebStyles } from '../ui/shared';

type T = (key: string, params?: Record<string, string | number>) => string;

export interface SaleRowView {
  id: string;
  time: string;
  client: string;
  items: string;
  employee: string | null;
  payment: string;
  paymentMethods: SalePaymentMethod[];
  total: string;
  running: string;
  status: 'completed' | 'voided';
  voidReason: string;
  canVoid: boolean;
}

export interface SalesTodayViewProps {
  t: T;
  kpis: KpiView[];
  rows: SaleRowView[];
  paymentFilter: SalePaymentMethod | null;
  onPaymentFilter: (value: SalePaymentMethod | null) => void;
  statusFilter: 'completed' | 'voided' | null;
  onStatusFilter: (value: 'completed' | 'voided' | null) => void;
  kindFilter: 'service' | 'product' | null;
  onKindFilter: (value: 'service' | 'product' | null) => void;
  state: 'loading' | 'error' | 'ready';
  errorMessage?: string;
  onRetry: () => void;
  onVoid: (id: string) => void;
  hasAnySale: boolean;
}

const PAYMENT_METHODS: SalePaymentMethod[] = ['cash', 'card', 'nequi', 'bank_transfer', 'other'];

/** Ventas de HOY: cada transacción con su hora, cliente, líneas, empleado, pago y el acumulado del día. Nada se borra: una venta anulada sigue aquí, marcada. */
export function SalesTodayView({ t, kpis, rows, paymentFilter, onPaymentFilter, statusFilter, onStatusFilter, kindFilter, onKindFilter, state, errorMessage, onRetry, onVoid, hasAnySale }: SalesTodayViewProps) {
  useWebStyles();
  // Columna de anular: solo aparece si HAY alguna venta anulable, pero se mantiene en TODAS las filas (con celda vacía si
  // esa fila en particular no aplica) para que la tabla no quede con columnas desalineadas entre filas.
  const showVoidColumn = rows.some((row) => row.canVoid);
  return (
    <div className="xw-section">
      <KpiRow kpis={kpis} label={t('sale_today_kpis')} t={t} />

      {hasAnySale ? (
        <div className="xw-toolbar">
          <FilterChips
            label={t('sale_filter_payment')}
            value={paymentFilter}
            onChange={(value) => onPaymentFilter(value as SalePaymentMethod | null)}
            options={PAYMENT_METHODS.map((method) => ({ id: method, label: t(`sale_pay_${method}`) }))}
          />
          <FilterChips
            label={t('sale_filter_status')}
            value={statusFilter}
            onChange={(value) => onStatusFilter(value as 'completed' | 'voided' | null)}
            options={[
              { id: 'completed', label: t('sale_filter_completed') },
              { id: 'voided', label: t('sale_filter_voided') },
            ]}
          />
          <FilterChips
            label={t('sale_filter_kind')}
            value={kindFilter}
            onChange={(value) => onKindFilter(value as 'service' | 'product' | null)}
            options={[
              { id: 'service', label: t('sale_filter_services') },
              { id: 'product', label: t('sale_filter_products') },
            ]}
          />
        </div>
      ) : null}

      {state === 'loading' ? <LoadingRows label={t('dash_loading')} rows={5} /> : null}
      {state === 'error' ? <ErrorPanel message={errorMessage ?? t('unknown_error')} retryLabel={t('retry')} onRetry={onRetry} /> : null}

      {state === 'ready' && rows.length === 0 ? (
        hasAnySale ? <EmptyPanel icon="search" title={t('sale_no_results')} /> : <EmptyPanel icon="coins" title={t('sale_empty_title')} text={t('sale_empty_text')} />
      ) : null}

      {state === 'ready' && rows.length > 0 ? (
        <div className="xw-tablewrap">
          <table className="xw-table">
            <caption className="xw-sr">{t('nav_sales_today')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('sale_col_time')}</th>
                <th scope="col">{t('sale_col_client')}</th>
                <th scope="col">{t('sale_col_items')}</th>
                <th scope="col">{t('sale_col_employee')}</th>
                <th scope="col">{t('sale_col_payment')}</th>
                <th scope="col">{t('sale_col_total')}</th>
                <th scope="col">{t('sale_col_running')}</th>
                <th scope="col">{t('sale_col_status')}</th>
                {showVoidColumn ? (
                  <th scope="col">
                    <span className="xw-sr">{t('sale_void_action')}</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="is-muted" data-label={t('sale_col_time')}>
                    {row.time}
                  </td>
                  <td data-label={t('sale_col_client')}>
                    <span className="xw-cell-title">{row.client}</span>
                  </td>
                  <td className="is-muted" data-label={t('sale_col_items')}>
                    {row.items}
                  </td>
                  <td className="is-muted" data-label={t('sale_col_employee')}>
                    {row.employee ?? '—'}
                  </td>
                  <td className="is-muted" data-label={t('sale_col_payment')}>
                    {row.payment}
                  </td>
                  <td data-label={t('sale_col_total')}>{row.total}</td>
                  <td className="is-muted" data-label={t('sale_col_running')}>
                    {row.running}
                  </td>
                  <td data-label={t('sale_col_status')}>
                    <Badge tone={row.status === 'voided' ? 'danger' : 'success'}>{t(row.status === 'voided' ? 'sale_status_voided' : 'sale_status_completed')}</Badge>
                    {row.status === 'voided' && row.voidReason ? <p className="xw-cell-sub">{t('sale_voided_reason', { reason: row.voidReason })}</p> : null}
                  </td>
                  {showVoidColumn ? (
                    <td>
                      {row.canVoid ? (
                        <button type="button" className="xw-btn xw-btn--secondary xw-btn--sm" onClick={() => onVoid(row.id)}>
                          {t('sale_void_action')}
                        </button>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
