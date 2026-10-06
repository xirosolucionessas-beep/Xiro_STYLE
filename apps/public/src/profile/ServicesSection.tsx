import { phoneHref, translate, whatsappLink, type Language, type PublicBookingCatalog, type PublicBookingProfile } from '@xiro/shared';
import { useState } from 'react';
import { money } from '../lib/format';
import { Icon } from '../ui/Icon';
import { ListSkeleton } from '../ui/Skeleton';
import { ItemDetailModal, type DetailItem } from './ItemDetailModal';

type Service = PublicBookingCatalog['services'][number];

/** Servicios agrupados por categoría (con título solo si hay más de una), cada uno con su botón "Reservar" que abre el flujo con ese servicio ya elegido. */
function groupByCategory(services: Service[]): Array<{ category: string; items: Service[] }> {
  const groups = new Map<string, Service[]>();
  for (const service of services) groups.set(service.category, [...(groups.get(service.category) ?? []), service]);
  return [...groups].map(([category, items]) => ({ category, items }));
}

export function ServicesSection({
  profile,
  catalog,
  loading,
  language,
  onBook,
}: {
  profile: PublicBookingProfile;
  catalog: PublicBookingCatalog | null;
  loading: boolean;
  language: Language;
  onBook: (choice: { serviceId?: string; packageId?: string }) => void;
}) {
  const t = (key: string, params?: Record<string, string | number>) => translate(language, key, params);
  const canBook = profile.acceptsBookings;
  const services = catalog?.services ?? [];
  const packages = catalog?.packages ?? [];
  const groups = groupByCategory(services);
  const [openId, setOpenId] = useState<string | null>(null);
  const openService = openId ? services.find((s) => s.id === openId) : null;

  return (
    <section className="xp-section" id="servicios" aria-labelledby="xp-services-h">
      <p className="xp-kicker" aria-hidden="true">
        {t('pub_kicker_services')}
      </p>
      <h2 id="xp-services-h">{t('pub_nav_services')}</h2>

      {loading ? <ListSkeleton rows={3} /> : null}

      {!loading && !canBook ? (
        <div className="xp-notice">
          <h3>{t('pub_empty_booking_title')}</h3>
          <p>{t('pub_empty_booking_text')}</p>
          <div className="xp-btn-row">
            {profile.whatsapp ? (
              <a className="xp-btn xp-btn--secondary xp-btn--auto" href={whatsappLink(profile.whatsapp, '')} target="_blank" rel="noopener noreferrer">
                <Icon name="chat" /> {t('pub_whatsapp')}
              </a>
            ) : null}
            {profile.phone ? (
              <a className="xp-btn xp-btn--secondary xp-btn--auto" href={phoneHref(profile.phone)}>
                <Icon name="phone" /> {t('call')}
              </a>
            ) : null}
          </div>
        </div>
      ) : null}

      {!loading && canBook && services.length === 0 && packages.length === 0 ? <p className="xp-muted">{t('pub_services_empty')}</p> : null}

      {groups.map((group) => (
        <div key={group.category} className="xp-group">
          {groups.length > 1 ? <h3 className="xp-group-title">{group.category}</h3> : null}
          <ul className="xp-price-list">
            {group.items.map((service) => {
              const from = service.variants.length > 0 ? Math.min(service.price, ...service.variants.map((v) => v.price)) : service.price;
              const description = service.description && service.description !== service.name ? service.description : '';
              return (
                <li key={service.id} className="xp-price-row">
                  <button type="button" className="xp-price-open" aria-label={t('pub_detail_open', { name: service.name })} onClick={() => setOpenId(service.id)}>
                    {service.image ? <img className="xp-price-thumb" src={service.image} alt="" width={56} height={56} loading="lazy" decoding="async" /> : null}
                    <span className="xp-price-main">
                      <span className="xp-price-top">
                        <h3 className="xp-price-name">{service.name}</h3>
                        <span className="xp-price">{service.variants.length > 0 ? t('pub_from', { price: money(from, profile.currency) }) : money(service.price, profile.currency)}</span>
                      </span>
                      <span className="xp-price-sub">
                        <span className="xp-meta">
                          <Icon name="clock" size={16} /> {t('pub_minutes', { minutes: service.durationMinutes })}
                        </span>
                        {description ? <span className="xp-price-desc">{description}</span> : null}
                      </span>
                    </span>
                  </button>
                  {canBook ? (
                    <button type="button" className="xp-btn xp-btn--secondary xp-btn--auto xp-price-book" aria-label={t('pub_service_book_aria', { name: service.name })} onClick={() => onBook({ serviceId: service.id })}>
                      {t('pub_service_book')}
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      {packages.length > 0 ? (
        <div className="xp-group">
          <ul className="xp-price-list">
            {packages.map((pkg) => (
              <li key={pkg.id} className="xp-price-row">
                <div className="xp-price-main">
                  <div className="xp-price-top">
                    <h3 className="xp-price-name">
                      {pkg.name} <span className="xp-tag">{t('pub_package_badge')}</span>
                    </h3>
                    <span className="xp-price">{money(pkg.price, profile.currency)}</span>
                  </div>
                  <div className="xp-price-sub">
                    <span className="xp-meta">
                      <Icon name="clock" size={16} /> {t('pub_minutes', { minutes: pkg.durationMinutes })}
                    </span>
                    <span className="xp-price-desc">{t('pub_package_includes', { services: pkg.services.join(' + ') })}</span>
                  </div>
                  {canBook ? (
                    <button type="button" className="xp-btn xp-btn--secondary xp-btn--auto xp-price-book" aria-label={t('pub_service_book_aria', { name: pkg.name })} onClick={() => onBook({ packageId: pkg.id })}>
                      {t('pub_service_book')}
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {openService ? (
        <ItemDetailModal
          item={detailFromService(openService)}
          currency={profile.currency}
          language={language}
          canBook={canBook}
          onClose={() => setOpenId(null)}
          onBook={() => {
            setOpenId(null);
            onBook({ serviceId: openService.id });
          }}
        />
      ) : null}
    </section>
  );
}

function detailFromService(service: Service): DetailItem {
  const from = service.variants.length > 0 ? Math.min(service.price, ...service.variants.map((v) => v.price)) : service.price;
  return {
    id: service.id,
    name: service.name,
    category: service.category,
    description: service.description && service.description !== service.name ? service.description : '',
    images: service.images,
    durationMinutes: service.durationMinutes,
    price: from,
    fromPrice: service.variants.length > 0,
  };
}
