import { googleMapsDirectionsUrl, googleMapsSearchUrl, productOrderWhatsappText, translate, whatsappLink, type Language, type PublicBookingProfile, type PublicProductOrderDto } from '@xiro/shared';
import { money } from '../lib/format';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';

/**
 * Pantalla final de un pedido de solo productos: qué se pidió, el total, que se recoge y paga en el local, y — si el negocio
 * tiene WhatsApp — el mensaje del pedido ya escrito para enviárselo. El pedido ya quedó registrado y avisado al negocio dentro de
 * la plataforma; WhatsApp es un canal extra, no un requisito.
 */
export function OrderDoneStep({ order, profile, language, customer, onClose }: { order: PublicProductOrderDto; profile: PublicBookingProfile; language: Language; customer: { name: string; phone: string }; onClose: () => void }) {
  const t = (key: string, params?: Record<string, string | number>) => translate(language, key, params);
  const { business } = order;
  const address = [business.location?.address || business.address, business.location?.address ? '' : business.city].filter(Boolean).join(', ');
  const directions = business.location ? googleMapsDirectionsUrl({ lat: business.location.latitude, lng: business.location.longitude, placeId: business.location.placeId }) : address ? googleMapsSearchUrl(address) : null;
  const whatsapp = business.whatsapp
    ? whatsappLink(
        business.whatsapp,
        productOrderWhatsappText({
          businessName: business.name,
          lines: order.items.map((item) => ({ name: item.name, quantity: item.quantity, total: money(item.unitPrice * item.quantity, business.currency) })),
          total: money(order.totalPrice, business.currency),
          customerName: customer.name,
          customerPhone: customer.phone,
          language,
        }),
      )
    : null;

  return (
    <div className="xp-overlay" role="dialog" aria-modal="true" aria-label={t('pub_order_done_title')}>
      <div className="xp-overlay-head">
        <button type="button" className="xp-icon-btn" aria-label={t('close')} onClick={onClose}>
          <Icon name="close" size={22} />
        </button>
        <div className="xp-overlay-title">
          <strong>{t('pub_order_flow_title')}</strong>
          <span className="xp-muted">{business.name || profile.name}</span>
        </div>
      </div>
      <div className="xp-overlay-body xp-stack xp-done">
        <div className="xp-done-hero">
          <span className="xp-done-badge" aria-hidden="true">
            <Icon name="check" size={34} />
          </span>
          <h2 className="xp-step-title">{t('pub_order_done_title')}</h2>
          <p className="xp-muted">{t('pub_order_done_text')}</p>
        </div>

        <div className="xp-summary">
          <dl>
            <div>
              <dt>{t('pub_order_summary_products')}</dt>
              <dd>
                <ul className="xp-summary-lines">
                  {order.items.map((item) => (
                    <li key={item.id}>
                      <span>{item.quantity > 1 ? `${item.name} ×${item.quantity}` : item.name}</span>
                      <span>{money(item.unitPrice * item.quantity, business.currency)}</span>
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
            <div>
              <dt>{t('pub_order_pickup')}</dt>
              <dd>{t('pub_order_pickup_value')}</dd>
            </div>
            {address ? (
              <div>
                <dt>{t('pub_summary_where')}</dt>
                <dd>{address}</dd>
              </div>
            ) : null}
          </dl>
          <div className="xp-summary-total">
            <span>{t('pub_summary_total')}</span>
            <span className="xp-price xp-price--lg">{money(order.totalPrice, business.currency)}</span>
          </div>
        </div>

        {whatsapp || directions ? (
          <div className="xp-actions">
            {whatsapp ? (
              <a className="xp-action" href={whatsapp} target="_blank" rel="noopener noreferrer">
                <Icon name="chat" size={22} />
                <span>{t('pub_order_whatsapp')}</span>
              </a>
            ) : null}
            {directions ? (
              <a className="xp-action" href={directions} target="_blank" rel="noopener noreferrer">
                <Icon name="navigate" size={22} />
                <span>{t('pub_done_directions')}</span>
              </a>
            ) : null}
          </div>
        ) : null}

        <Button variant="secondary" onClick={onClose}>
          {t('pub_done_close')}
        </Button>
      </div>
    </div>
  );
}
