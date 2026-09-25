import type { ReactNode } from 'react';
import { Ico } from '../icons';
import { linkProps } from '../ui/link';
import { Avatar, EmptyPanel, ErrorPanel, KpiRow, LoadingRows, SearchField, type KpiView } from '../ui/Page';
import { useWebStyles } from '../ui/shared';

type T = (key: string, params?: Record<string, string | number>) => string;

export interface ClientRowView {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  /** Ya formateado ("12 sep 2026"); `null` = sin dato. */
  since: string;
  visits: string | null;
  lastVisit: string | null;
  href: string;
}

export interface ClientsViewProps {
  t: T;
  kpis: KpiView[];
  search: string;
  onSearch: (value: string) => void;
  /** Consulta ya aplicada (con retraso) para los textos de "sin resultados". */
  appliedQuery: string;
  rows: ClientRowView[];
  /** Columnas de servicios y último servicio (solo con permiso para ver registros). */
  showServiceCols: boolean;
  state: 'loading' | 'error' | 'ready';
  errorMessage?: string;
  onRetry: () => void;
  note?: string;
  emptyAction?: ReactNode;
  navigate: (href: string) => void;
}

/** Sección Clientes: indicadores, buscador y tabla (en móvil, tarjetas). Solo datos reales; lo que no se conoce se muestra "—". */
export function ClientsView({ t, kpis, search, onSearch, appliedQuery, rows, showServiceCols, state, errorMessage, onRetry, note, emptyAction, navigate }: ClientsViewProps) {
  useWebStyles();
  return (
    <div className="xw-section">
      <KpiRow kpis={kpis} label={t('dash_kpis')} t={t} />

      <div className="xw-toolbar">
        <SearchField label={t('sec_clients_search')} value={search} onChange={onSearch} />
      </div>

      {state === 'loading' ? <LoadingRows label={t('dash_loading')} rows={5} /> : null}
      {state === 'error' ? <ErrorPanel message={errorMessage ?? t('unknown_error')} retryLabel={t('retry')} onRetry={onRetry} /> : null}

      {state === 'ready' && rows.length === 0 ? (
        appliedQuery ? (
          <EmptyPanel icon="search" title={t('sec_no_results', { q: appliedQuery })} />
        ) : (
          <EmptyPanel icon="users" title={t('no_clients')} text={t('sec_clients_empty_text')} action={emptyAction} />
        )
      ) : null}

      {state === 'ready' && rows.length > 0 ? (
        <>
          <p className="xw-hint" role="status">
            {rows.length === 1 ? t('sec_showing_one') : t('sec_showing', { n: rows.length })}
          </p>
          <div className="xw-tablewrap">
            <table className="xw-table">
              <caption className="xw-sr">{t('sec_clients_list')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('sec_col_client')}</th>
                  <th scope="col">{t('sec_col_contact')}</th>
                  {showServiceCols ? <th scope="col">{t('sec_col_visits')}</th> : null}
                  {showServiceCols ? <th scope="col">{t('sec_col_last')}</th> : null}
                  <th scope="col">{t('sec_col_since')}</th>
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
                        <Avatar name={row.name} />
                        <a className="xw-cell-title" {...linkProps(row.href, navigate)}>
                          {row.name}
                        </a>
                      </div>
                    </td>
                    <td className="is-muted">
                      <div className="xw-cell-text">
                        <span>{row.phone ?? row.email ?? '—'}</span>
                        {row.phone && row.email ? <span className="xw-cell-sub">{row.email}</span> : null}
                      </div>
                    </td>
                    {showServiceCols ? <td data-label={t('sec_col_visits')}>{row.visits ?? '—'}</td> : null}
                    {showServiceCols ? (
                      <td className="is-muted" data-label={t('sec_col_last')}>
                        {row.lastVisit ?? '—'}
                      </td>
                    ) : null}
                    <td className="is-muted" data-label={t('sec_col_since')}>
                      {row.since}
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
          {note ? <p className="xw-hint">{note}</p> : null}
        </>
      ) : null}
    </div>
  );
}
