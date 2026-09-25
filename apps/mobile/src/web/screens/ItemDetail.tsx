import { Ico } from '../icons';
import { Button } from '../ui';
import { GalleryViewer } from '../ui/GalleryViewer';
import { Badge, KpiRow, Panel, type KpiView } from '../ui/Page';
import { useWebStyles } from '../ui/shared';

type T = (key: string, params?: Record<string, string | number>) => string;

export interface ItemDetailViewProps {
  t: T;
  name: string;
  /** URLs ya resueltas (máximo 4). */
  photos: string[];
  status: 'available' | 'reorder' | 'out_of_stock';
  statusLabel: string;
  description: string;
  kpis: KpiView[];
  /** Filas ya formateadas; "—" cuando no hay dato. */
  rows: Array<{ id: string; label: string; value: string }>;
  notes: string;
  deleting: boolean;
  onEdit: () => void;
  onDelete: () => void;
}

const TONE = { available: 'success', reorder: 'warning', out_of_stock: 'danger' } as const;

/** Ficha de inventario: galería, indicadores (stock, precio, costo, margen) y datos internos. Editar y eliminar como en la nativa. */
export function ItemDetailView({ t, name, photos, status, statusLabel, description, kpis, rows, notes, deleting, onEdit, onDelete }: ItemDetailViewProps) {
  useWebStyles();
  return (
    <div className="xw-section">
      <KpiRow kpis={kpis} label={t('dash_kpis')} t={t} />
      <div className="xw-detail">
        <div className="xw-detail-media">
          <GalleryViewer photos={photos} name={name} t={t} />
        </div>
        <div className="xw-detail-side">
          <Panel title={t('sec_id_data')} icon="package" action={<Badge tone={TONE[status]}>{statusLabel}</Badge>}>
            {description ? <p className="xw-detail-desc" style={{ marginBottom: 'var(--xw-space-3)' }}>{description}</p> : null}
            <dl className="xw-dl">
              {rows.map((row) => (
                <div key={row.id} className="xw-dl-row">
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
              {notes ? (
                <div className="xw-dl-row">
                  <dt>{t('sec_id_notes')}</dt>
                  <dd>{notes}</dd>
                </div>
              ) : null}
            </dl>
          </Panel>
          <div className="xw-detail-actions">
            <Button icon={<Ico name="pencil" size={18} />} onPress={onEdit}>
              {t('item_edit')}
            </Button>
            <Button variant="danger" icon={<Ico name="trash-2" size={18} />} loading={deleting} loadingLabel={t('loading')} onPress={onDelete}>
              {t('delete')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
