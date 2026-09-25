import type { ReactNode } from 'react';
import { Ico } from '../icons';
import { linkProps } from '../ui/link';
import { Badge, EmptyPanel, ErrorPanel, FilterChips, KpiRow, LoadingRows, type FilterOption, type KpiView } from '../ui/Page';
import { useWebStyles } from '../ui/shared';

type T = (key: string, params?: Record<string, string | number>) => string;

export interface InventoryRowView {
  id: string;
  name: string;
  category: string;
  stock: number;
  status: 'available' | 'reorder' | 'out_of_stock';
  /** Texto del estado ya traducido. */
  statusLabel: string;
  /** Costo unitario formateado; "—" si no está cargado. */
  cost: string;
  photo: string | null;
  href: string;
}

export interface InventoryViewProps {
  t: T;
  kpis: KpiView[];
  categories: FilterOption[];
  category: string | null;
  onCategory: (id: string | null) => void;
  statuses: FilterOption[];
  status: string | null;
  onStatus: (id: string | null) => void;
  rows: InventoryRowView[];
  state: 'loading' | 'error' | 'ready';
  errorMessage?: string;
  onRetry: () => void;
  emptyAction?: ReactNode;
  navigate: (href: string) => void;
}

const TONE = { available: 'success', reorder: 'warning', out_of_stock: 'danger' } as const;

/** Sección Inventario: indicadores por estado de stock, filtros y tabla con foto, stock, estado y costo. */
export function InventoryView({ t, kpis, categories, category, onCategory, statuses, status, onStatus, rows, state, errorMessage, onRetry, emptyAction, navigate }: InventoryViewProps) {
  useWebStyles();
  return (
    <div className="xw-section">
      <KpiRow kpis={kpis} label={t('dash_kpis')} t={t} />

      <div className="xw-toolbar" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        {categories.length > 0 ? <FilterChips label={t('filter_category')} options={categories} value={category} onChange={onCategory} /> : null}
        <FilterChips label={t('filter_status')} options={statuses} value={status} onChange={onStatus} />
      </div>
      <p className="xw-hint" style={{ margin: 0 }}>
        {t('inventory_sync_note')}
      </p>

      {state === 'loading' ? <LoadingRows label={t('dash_loading')} rows={5} /> : null}
      {state === 'error' ? <ErrorPanel message={errorMessage ?? t('unknown_error')} retryLabel={t('retry')} onRetry={onRetry} /> : null}
      {state === 'ready' && rows.length === 0 ? <EmptyPanel icon="package" title={t('no_items')} text={t('sec_inventory_empty_text')} action={emptyAction} /> : null}

      {state === 'ready' && rows.length > 0 ? (
        <>
          <p className="xw-hint" role="status" style={{ margin: 0 }}>
            {rows.length === 1 ? t('sec_showing_one') : t('sec_showing', { n: rows.length })}
          </p>
          <div className="xw-tablewrap">
            <table className="xw-table">
              <caption className="xw-sr">{t('sec_inventory_list')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('sec_col_item')}</th>
                  <th scope="col">{t('sec_col_category')}</th>
                  <th scope="col" className="is-num">
                    {t('sec_col_stock')}
                  </th>
                  <th scope="col">{t('sec_col_status')}</th>
                  <th scope="col" className="is-num">
                    {t('sec_col_cost')}
                  </th>
                  <th scope="col">
                    <span className="xw-sr">{t('sec_open')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <div className="xw-cell-main">
                        <span className="xw-thumb" aria-hidden="true">
                          {row.photo ? <img src={row.photo} alt="" loading="lazy" /> : <Ico name="package" size={20} />}
                        </span>
                        <a className="xw-cell-title" {...linkProps(row.href, navigate)}>
                          {row.name}
                        </a>
                      </div>
                    </td>
                    <td className="is-muted" data-label={t('sec_col_category')}>
                      {row.category}
                    </td>
                    <td className="is-num" data-label={t('sec_col_stock')}>
                      {row.stock}
                    </td>
                    <td data-label={t('sec_col_status')}>
                      <Badge tone={TONE[row.status]}>{row.statusLabel}</Badge>
                    </td>
                    <td className="is-num is-muted" data-label={t('sec_col_cost')}>
                      {row.cost}
                    </td>
                    <td className="xw-td-chev">
                      <span className="xw-row-chev">
                        <Ico name="chevron-right" size={18} />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}
