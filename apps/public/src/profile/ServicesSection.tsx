import { phoneHref, translate, whatsappLink, type Language, type PublicBookingCatalog, type PublicBookingProfile } from '@xiro/shared';
import { money } from '../lib/format';
import { Icon } from '../ui/Icon';
import { ListSkeleton } from '../ui/Skeleton';

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

  return (
    <section className="xp-section" id="servicios" aria-labelledby="xp-services-h">
      <h2 id="xp-services-h">{t('pub_nav_services')}</h2>

      {loading ? <ListSkeleton rows={3} /> : null}

      {!loading && !canBook ? (
        <div className="xp-notice">
          <h3>{t('pub_empty_booking_title')}</h3>
          <p>{t('pub_empty_booking_text')}</p>
          <div className="xp-btn-row">
            {profile.whatsapp ? (
              <a className="xp-btn xp-btn--auto" href={whatsappLink(profile.whatsapp, '')} target="_blank" rel="noopener noreferrer">
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
          <div className="xp-service-grid">
            {group.items.map((service) => {
              const from = service.variants.length > 0 ? Math.min(service.price, ...service.variants.map((v) => v.price)) : service.price;
              const description = service.description && service.description !== service.name ? service.description : '';
              return (
                <article key={service.id} className={`xp-service${service.image ? ' xp-service--photo' : ''}`}>
                  {service.image ? <img className="xp-service-img" src={service.image} alt="" width={112} height={112} loading="lazy" decoding="async" /> : null}
                  <div className="xp-service-body">
                    <h3 className="xp-service-name">{service.name}</h3>
                    {description ? <p className="xp-service-desc">{description}</p> : null}
                    <div className="xp-service-meta">
                      <span className="xp-meta">
                        <Icon name="clock" size={16} /> {t('pub_minutes', { minutes: service.durationMinutes })}
                      </span>
                      <span className="xp-price">{service.variants.length > 0 ? t('pub_from', { price: money(from, profile.currency) }) : money(service.price, profile.currency)}</span>
                    </div>
                    {canBook ? (
                      <button type="button" className="xp-btn xp-btn--secondary xp-service-book" aria-label={t('pub_service_book_aria', { name: service.name })} onClick={() => onBook({ serviceId: service.id })}>
                        {t('pub_service_book')}
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      ))}

      {packages.length > 0 ? (
        <div className="xp-group">
          <div className="xp-service-grid">
            {packages.map((pkg) => (
              <article key={pkg.id} className="xp-service xp-service--package">
                <div className="xp-service-body">
                  <span className="xp-tag">{t('pub_package_badge')}</span>
                  <h3 className="xp-service-name">{pkg.name}</h3>
                  <p className="xp-service-desc">{t('pub_package_includes', { services: pkg.services.join(' + ') })}</p>
                  <div className="xp-service-meta">
                    <span className="xp-meta">
                      <Icon name="clock" size={16} /> {t('pub_minutes', { minutes: pkg.durationMinutes })}
                    </span>
                    <span className="xp-price">{money(pkg.price, profile.currency)}</span>
                  </div>
                  {canBook ? (
                    <button type="button" className="xp-btn xp-btn--secondary xp-service-book" aria-label={t('pub_service_book_aria', { name: pkg.name })} onClick={() => onBook({ packageId: pkg.id })}>
                      {t('pub_service_book')}
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
