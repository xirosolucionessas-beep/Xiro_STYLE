import type { Currency } from '@xiro/shared';
import { formatMoney } from '@xiro/shared';
import { WhatsAppLogo } from '../brand/logos';
import { Ico } from '../icons';
import { Button } from '../ui';
import { GalleryViewer } from '../ui/GalleryViewer';
import { Badge, Panel } from '../ui/Page';
import { useWebStyles } from '../ui/shared';

type T = (key: string, params?: Record<string, string | number>) => string;

export interface ServiceDetailItem {
  id: string;
  name: string;
  categoryName: string;
  description: string;
  shortDescription: string;
  detail: string;
  price: number;
  published: boolean;
  photos: string[];
  /** Solo servicios: duración en minutos. */
  durationMinutes?: number | null;
  /** Estilos/variantes con su precio (y duración) reales, si tiene. */
  variants?: Array<{ id: string; name: string; price: number; durationMinutes: number | null }>;
}

export interface ServiceDetailViewProps {
  t: T;
  item: ServiceDetailItem;
  currency: Currency;
  publicUrl: string;
  onEdit: () => void;
  onShare: () => void;
}

/**
 * Ficha de servicio (sección 7): galería a la izquierda y, a la derecha, precio, descripción y acciones. Es la vista
 * previa de lo que ve el cliente (sin costo ni stock). El nombre y la categoría los muestra el encabezado de la página
 * (título y subtítulo) que aporta el contenedor, junto al botón de volver.
 */
export function ServiceDetailView({ t, item, currency, publicUrl, onEdit, onShare }: ServiceDetailViewProps) {
  useWebStyles();
  const description = item.description || item.shortDescription;

  return (
    <div className="xw-section">
    <div className="xw-detail xw-detail--preview">
      <div className="xw-detail-media">
        <GalleryViewer photos={item.photos} name={item.name} t={t} />
      </div>

      <div className="xw-detail-side">
        <Panel title={t('sec_sd_info')} icon="eye" action={item.published ? null : <Badge tone="muted">{t('hidden_from_catalog')}</Badge>}>
          <div className="xw-detail-actions" style={{ marginTop: 0 }}>
            <p className="xw-detail-price">
              {item.variants && item.variants.length > 0 ? t('preview_from', { price: formatMoney(Math.min(item.price, ...item.variants.map((v) => v.price)), currency) }) : formatMoney(item.price, currency)}
              {item.durationMinutes ? <span className="xw-detail-duration"> · {t('minutes_short', { minutes: item.durationMinutes })}</span> : null}
            </p>
            {description ? <p className="xw-detail-desc">{description}</p> : null}
            {item.detail ? <p className="xw-detail-desc xw-detail-desc--pre">{item.detail}</p> : null}
            {item.variants && item.variants.length > 0 ? (
              <ul className="xw-detail-variants">
                {item.variants.map((variant) => (
                  <li key={variant.id}>
                    <span>{variant.name}</span>
                    <span>
                      {formatMoney(variant.price, currency)}
                      {variant.durationMinutes ? ` · ${t('minutes_short', { minutes: variant.durationMinutes })}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </Panel>

        <div className="xw-detail-actions">
          <Button icon={<WhatsAppLogo size={20} />} onPress={onShare}>
            {t('share_whatsapp')}
          </Button>
          <Button variant="secondary" icon={<Ico name="pencil" size={18} />} onPress={onEdit}>
            {t('item_edit')}
          </Button>
          {item.published ? (
            <a className="xw-alink xw-detail-public" href={publicUrl} target="_blank" rel="noopener noreferrer">
              <Ico name="external-link" size={16} />
              {t('view_public_page')}
            </a>
          ) : null}
        </div>
      </div>
    </div>
    </div>
  );
}
