import { translate, type Language } from '@xiro/shared';
import { money } from '../lib/format';
import { Button } from '../ui/Button';
import { Carousel } from '../ui/Carousel';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/Modal';

export interface DetailItem {
  id: string;
  name: string;
  /** Solo los servicios la traen. */
  category?: string;
  description: string;
  /** Texto de detalle ("Lo que ve tu cliente" en el panel): se muestra completo debajo de la descripción. */
  detail?: string;
  images: string[];
  /** Solo los servicios la traen. */
  durationMinutes?: number;
  price: number;
  /** El precio mostrado es "desde" (el servicio tiene variantes con precios distintos). */
  fromPrice?: boolean;
}

/**
 * Detalle de un servicio o producto a pantalla completa (tema oscuro): todas sus fotos en un carrusel y toda su información. Se abre al tocar la fila o la tarjeta
 * (nunca el botón "Reservar" de la lista, que conserva su acción de siempre). El botón "Reservar" de aquí adentro
 * llama al mismo manejador que el de la lista, con este servicio o producto ya elegido.
 */
export function ItemDetailModal({ item, currency, language, canBook, ctaLabel, onBook, onClose }: { item: DetailItem; currency: string; language: Language; canBook: boolean; ctaLabel?: string; onBook: () => void; onClose: () => void }) {
  const t = (key: string, params?: Record<string, string | number>) => translate(language, key, params);
  return (
    <Modal title={item.name} closeLabel={t('close')} onClose={onClose} size="full" hideTitle>
      <div className="xp-detail xp-detail--immersive">
        <Carousel images={item.images} alt={item.name} language={language} />
        <div className="xp-detail-info">
          {item.category ? <p className="xp-kicker">{item.category}</p> : null}
          <h2 className="xp-detail-name">{item.name}</h2>
          {item.description ? <p className="xp-detail-desc">{item.description}</p> : null}
          {item.detail && item.detail !== item.description ? <p className="xp-detail-desc xp-detail-extra">{item.detail}</p> : null}
          {item.durationMinutes !== undefined ? (
            <span className="xp-meta">
              <Icon name="clock" size={16} /> {t('pub_minutes', { minutes: item.durationMinutes })}
            </span>
          ) : null}
          <div className="xp-detail-foot">
            <span className="xp-price xp-price--lg">{item.fromPrice ? t('pub_from', { price: money(item.price, currency) }) : money(item.price, currency)}</span>
            {canBook ? (
              <Button onClick={onBook} full={false} aria-label={t('pub_service_book_aria', { name: item.name })}>
                {ctaLabel ?? t('pub_service_book')}
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </Modal>
  );
}
