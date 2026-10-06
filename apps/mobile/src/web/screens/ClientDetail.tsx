import { Ico } from '../icons';
import { Button } from '../ui';
import { EmptyPanel, KpiRow, LoadingRows, Panel, type KpiView } from '../ui/Page';
import { useWebStyles } from '../ui/shared';

type T = (key: string, params?: Record<string, string | number>) => string;

export interface HistoryRowView {
  id: string;
  label: string;
  note: string;
  amount: string;
  date: string;
}

export interface ClientDetailViewProps {
  t: T;
  /** Filas ya formateadas; "—" cuando no hay dato. */
  rows: Array<{ id: string; label: string; value: string; href?: string }>;
  /** null: esta persona no puede ver los registros de servicio. */
  history: { loading: boolean; rows: HistoryRowView[] } | null;
  kpis: KpiView[];
  whatsappHref?: string;
  callHref?: string;
  deleting: boolean;
  onEdit: () => void;
  onDelete: () => void;
  canManage: boolean;
  /** Derecho de supresión (Ley 1581): borra los datos identificables y conserva el historial. */
  anonymizing: boolean;
  onAnonymize: () => void;
}

/** Ficha de cliente: contacto, indicadores e historial real de servicios, con las mismas acciones que la nativa (WhatsApp, llamar, editar, eliminar datos, eliminar). */
export function ClientDetailView({ t, rows, history, kpis, whatsappHref, callHref, deleting, onEdit, onDelete, canManage, anonymizing, onAnonymize }: ClientDetailViewProps) {
  useWebStyles();
  return (
    <div className="xw-section">
      <KpiRow kpis={kpis} label={t('dash_kpis')} t={t} />
      <div className="xw-panels">
        <div className="xw-dash-col">
          <Panel title={t('sec_cd_contact')} icon="user">
            <dl className="xw-dl">
              {rows.map((row) => (
                <div key={row.id} className="xw-dl-row">
                  <dt>{row.label}</dt>
                  <dd>{row.href ? <a href={row.href}>{row.value}</a> : row.value}</dd>
                </div>
              ))}
            </dl>
          </Panel>

          <Panel title={t('sec_cd_actions')}>
            <div className="xw-detail-actions" style={{ marginTop: 0 }}>
              {whatsappHref ? (
                <a className="xw-btn xw-btn--primary" href={whatsappHref} target="_blank" rel="noopener noreferrer">
                  <Ico name="message-circle" size={18} />
                  <span>WhatsApp</span>
                </a>
              ) : null}
              {callHref ? (
                <a className="xw-btn xw-btn--secondary" href={callHref}>
                  <Ico name="phone" size={18} />
                  <span>{t('call')}</span>
                </a>
              ) : null}
              {canManage ? (
                <>
                  <Button variant="secondary" icon={<Ico name="pencil" size={18} />} onPress={onEdit}>
                    {t('edit')}
                  </Button>
                  <Button variant="secondary" icon={<Ico name="eye-off" size={18} />} loading={anonymizing} loadingLabel={t('loading')} onPress={onAnonymize}>
                    {t('client_anonymize')}
                  </Button>
                  <Button variant="danger" icon={<Ico name="trash-2" size={18} />} loading={deleting} loadingLabel={t('loading')} onPress={onDelete}>
                    {t('delete')}
                  </Button>
                </>
              ) : null}
            </div>
          </Panel>
        </div>

        {history ? (
          <Panel title={t('sec_cd_history')} icon="receipt">
            {history.loading ? <LoadingRows label={t('dash_loading')} /> : null}
            {!history.loading && history.rows.length === 0 ? <EmptyPanel icon="receipt" title={t('sec_cd_history_empty')} /> : null}
            {history.rows.length > 0 ? (
              <ul className="xw-timeline">
                {history.rows.map((row) => (
                  <li key={row.id} className="xw-timeline-row">
                    <span className="xw-timeline-ic" aria-hidden="true">
                      <Ico name="scissors" size={16} />
                    </span>
                    <span className="xw-timeline-text">
                      <span className="xw-timeline-title">{row.label}</span>
                      {row.note ? <span className="xw-timeline-detail">{row.note}</span> : null}
                    </span>
                    <span className="xw-timeline-meta">
                      <span className="xw-timeline-amount">{row.amount}</span>
                      <span className="xw-timeline-time">{row.date}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </Panel>
        ) : null}
      </div>
    </div>
  );
}
