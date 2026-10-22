import type { CashExpensesDetailModel, CashSalesDetailModel, DetailState } from '@/lib/useCashDetail';
import { Button } from '../ui';
import { Badge, EmptyPanel, ErrorPanel, LoadingRows } from '../ui/Page';
import { Modal } from '../ui/Modal';
import { useWebStyles } from '../ui/shared';

type T = (key: string, params?: Record<string, string | number>) => string;

function Status({ t, state, onRetry, emptyText, children }: { t: T; state: DetailState; onRetry: () => void; emptyText: string; children: React.ReactNode }) {
  if (state === 'loading') return <LoadingRows label={t('cash_detail_loading')} rows={3} />;
  if (state === 'error') return <ErrorPanel message={t('cash_detail_error')} retryLabel={t('retry')} onRetry={onRetry} />;
  if (state === 'empty') return <EmptyPanel icon="receipt" title={emptyText} />;
  return <>{children}</>;
}

/** Línea de estado del detalle: cuándo se actualizó y, si falló una actualización, aviso con reintento (datos conservados). */
function Freshness({ t, updated, refreshError, onRetry }: { t: T; updated: string | null; refreshError: boolean; onRetry: () => void }) {
  if (!updated && !refreshError) return null;
  return (
    <p className={refreshError ? 'xw-hint is-danger' : 'xw-hint'} role="status" aria-live="polite">
      {refreshError ? t('cash_close_live_error', { time: updated ?? '—' }) : t('cash_detail_updated', { time: updated ?? '—' })}{' '}
      {refreshError ? (
        <button type="button" className="xw-sale-manual-toggle" onClick={onRetry}>
          {t('retry')}
        </button>
      ) : null}
    </p>
  );
}

function More({ t, showing, hasMore, loadingMore, onMore }: { t: T; showing: string | null; hasMore: boolean; loadingMore: boolean; onMore: () => void }) {
  if (!hasMore && !showing) return null;
  return (
    <div className="xw-detail-more">
      {showing ? <p className="xw-hint">{showing}</p> : null}
      {hasMore ? (
        <Button variant="secondary" size="sm" loading={loadingMore} loadingLabel={t('loading')} onPress={onMore}>
          {t('cash_detail_load_more')}
        </Button>
      ) : null}
    </div>
  );
}

const Row = ({ label, value, strong }: { label: string; value: string; strong?: boolean }) => (
  <div className={strong ? 'xw-summary-row xw-summary-row--total' : 'xw-summary-row'}>
    <dt>{label}</dt>
    <dd>{value}</dd>
  </div>
);

export interface CashSalesDetailModalProps {
  open: boolean;
  onClose: () => void;
  t: T;
  title: string;
  /** Aviso fijo de la vista (p. ej. productos sin empleado atribuido). */
  note?: string | null;
  /** Resumen agregado que sigue visible (bruto / descuento distribuido / neto del empleado en el día). */
  aggregate?: { gross: string; discount: string; net: string } | null;
  updated: string | null;
  model: CashSalesDetailModel;
}

/** "Ver más" de ventas (web): ventas del día de un empleado o sin atribución, una tarjeta por venta. */
export function CashSalesDetailModal({ open, onClose, t, title, note, aggregate, updated, model }: CashSalesDetailModalProps) {
  useWebStyles();
  return (
    <Modal open={open} onClose={onClose} title={title} size="lg" closeLabel={t('close')}>
      {note ? <p className="xw-hint">{note}</p> : null}
      {aggregate ? (
        <dl className="xw-summary" aria-label={t('cash_close_breakdown_title')}>
          <Row label={t('cash_close_breakdown_gross')} value={aggregate.gross} />
          <Row label={t('cash_detail_discount_distributed')} value={aggregate.discount} />
          <Row label={t('cash_close_breakdown_net')} value={aggregate.net} strong />
        </dl>
      ) : null}
      {model.summary ? <p className="xw-hint">{model.summary}</p> : null}
      <Freshness t={t} updated={updated} refreshError={model.refreshError} onRetry={model.retry} />
      <Status t={t} state={model.state} onRetry={model.retry} emptyText={t('cash_detail_empty')}>
        <ul className="xw-detail-list">
          {model.rows.map((row) => (
            <li key={row.id} className={row.voided ? 'xw-detail-card is-voided' : 'xw-detail-card'}>
              <div className="xw-detail-head">
                <strong>{row.when}</strong>
                {row.voided ? <Badge tone="danger">{t('cash_detail_voided')}</Badge> : null}
              </div>
              <p className="xw-cell-sub">{row.client}</p>
              <p className="xw-cell-sub">{row.registeredBy}</p>
              {row.voidReason ? <p className="xw-hint">{row.voidReason}</p> : null}
              <p className="xw-cell-sub">{t('cash_detail_lines_title')}</p>
              <ul className="xw-cash-lines">
                {row.lines.map((line) => (
                  <li key={line.key}>
                    <span className="xw-cash-line-name">{line.label}</span>
                    <span className="xw-cash-line-net">{line.net}</span>
                    <span className="xw-cash-line-detail">
                      {t('cash_close_breakdown_gross')} {line.gross} · {t('cash_detail_discount_distributed')} {line.discount}
                    </span>
                  </li>
                ))}
              </ul>
              {row.otherLines.length > 0 ? (
                <>
                  <p className="xw-cell-sub">{t('cash_detail_other_lines')}</p>
                  <ul className="xw-detail-other">
                    {row.otherLines.map((line) => (
                      <li key={line.key} className="xw-cell-sub">
                        {line.label}
                        {line.performer ? ` · ${line.performer}` : ''}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
              <dl className="xw-summary" aria-label={t('cash_detail_sale_title')}>
                <Row label={t('cash_detail_subtotal')} value={row.sale.subtotal} />
                <Row label={t('cash_detail_sale_discount')} value={row.sale.discount} />
                {row.sale.tip ? <Row label={t('cash_detail_tip')} value={row.sale.tip} /> : null}
                <Row label={t('cash_detail_total')} value={row.sale.total} strong />
                {row.sale.payments.map((p) => (
                  <Row key={p.key} label={`${t('cash_detail_payments')} · ${p.label}`} value={p.amount} />
                ))}
                {row.sale.change ? <Row label={t('cash_detail_change')} value={row.sale.change} /> : null}
              </dl>
            </li>
          ))}
        </ul>
        <p className="xw-hint">{t('cash_detail_distributed_note')}</p>
        <More t={t} showing={model.showing} hasMore={model.hasMore} loadingMore={model.loadingMore} onMore={model.loadMore} />
      </Status>
    </Modal>
  );
}

export interface CashExpensesDetailModalProps {
  open: boolean;
  onClose: () => void;
  t: T;
  title: string;
  updated: string | null;
  model: CashExpensesDetailModel;
}

/** "Ver más" de gastos (web): gastos del día agrupados por empleado beneficiario, con anulados marcados y ajustes. */
export function CashExpensesDetailModal({ open, onClose, t, title, updated, model }: CashExpensesDetailModalProps) {
  useWebStyles();
  return (
    <Modal open={open} onClose={onClose} title={title} size="lg" closeLabel={t('close')}>
      {model.summary ? <p className="xw-hint">{model.summary}</p> : null}
      <Freshness t={t} updated={updated} refreshError={model.refreshError} onRetry={model.retry} />
      <Status t={t} state={model.state} onRetry={model.retry} emptyText={t('cash_exp_empty')}>
        {model.groups.map((group) => (
          <section key={group.key} aria-label={group.title} className="xw-detail-group">
            <h3 className="xw-panel-title">{group.title}</h3>
            <ul className="xw-detail-list">
              {group.items.map((e) => (
                <li key={e.id} className={e.voided ? 'xw-detail-card is-voided' : 'xw-detail-card'}>
                  <div className="xw-detail-head">
                    <strong>{e.title}</strong>
                    <span className="xw-rank-val">{e.amount}</span>
                  </div>
                  {e.voided ? <Badge tone="danger">{t('cash_exp_voided')}</Badge> : null}
                  <p className="xw-cell-sub">
                    {e.meta} · {e.method}
                  </p>
                  <p className="xw-cell-sub">{e.expenseDate}</p>
                  <p className="xw-cell-sub">{e.registered}</p>
                  {e.beneficiary ? <p className="xw-cell-sub">{e.beneficiary}</p> : null}
                  <p className="xw-cell-sub">{e.fromCash}</p>
                  {e.notes ? <p className="xw-cell-sub">{e.notes}</p> : null}
                  {e.voidInfo ? <p className="xw-hint">{e.voidInfo}</p> : null}
                </li>
              ))}
            </ul>
          </section>
        ))}
        <More t={t} showing={model.showing} hasMore={model.hasMore} loadingMore={model.loadingMore} onMore={model.loadMore} />
      </Status>
      {model.adjustments.length > 0 ? (
        <section aria-label={t('cash_exp_adjustments')} className="xw-detail-group">
          <h3 className="xw-panel-title">{t('cash_exp_adjustments')}</h3>
          <ul className="xw-detail-other">
            {model.adjustments.map((text, index) => (
              <li key={index} className="xw-cell-sub">
                {text}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </Modal>
  );
}
