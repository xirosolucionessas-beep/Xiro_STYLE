import type { Currency } from '@xiro/shared';
import { formatMoney } from '@xiro/shared';
import { WhatsAppLogo } from '../brand/logos';
import { Ico } from '../icons';
import { Button } from '../ui';
import { GalleryViewer } from '../ui/GalleryViewer';
import { useWebStyles } from '../ui/shared';

type T = (key: string) => string;

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
 * Ficha de servicio (sección 7): galería, datos y acciones. Vista previa de lo que ve el cliente (sin costo ni stock).
 * El botón "volver" y el título los aporta el <Header> del contenedor (ya sirven de ida y vuelta junto con la miga de pan).
 */
export function ServiceDetailView({ t, item, currency, publicUrl, onEdit, onShare }: ServiceDetailViewProps) {
  useWebStyles();
  const description = item.description || item.shortDescription;

  return (
    <div className="xw-detail">
      <GalleryViewer photos={item.photos} name={item.name} t={t} />

      <h1 className="xw-detail-title">{item.name}</h1>
      <p className="xw-detail-category">{item.categoryName}</p>
      {description ? <p className="xw-detail-desc">{description}</p> : null}
      {item.detail ? <p className="xw-detail-desc">{item.detail}</p> : null}
      <p className="xw-detail-price">{formatMoney(item.price, currency)}</p>
      {!item.published ? <p className="xw-home-sub">{t('hidden_from_catalog')}</p> : null}

      <div className="xw-detail-actions">
        <Button variant="secondary" icon={<Ico name="pencil" size={18} />} onPress={onEdit}>
          {t('item_edit')}
        </Button>
        <Button icon={<WhatsAppLogo size={20} />} onPress={onShare}>
          {t('share_whatsapp')}
        </Button>
        {item.published ? (
          <a className="xw-alink xw-detail-public" href={publicUrl} target="_blank" rel="noopener noreferrer">
            <Ico name="external-link" size={16} />
            {t('view_public_page')}
          </a>
        ) : null}
      </div>
    </div>
  );
}
