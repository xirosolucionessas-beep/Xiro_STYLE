import { phoneHref, translate, whatsappLink, type Language, type PublicBookingProfile } from '@xiro/shared';
import { useState, type Ref } from 'react';
import { initials } from '../lib/format';
import { statusText } from '../lib/hours';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Lightbox } from '../ui/Lightbox';
import { Stars } from '../ui/Stars';

/** Teléfono para leer: "+57 300 123 4567" si es un celular colombiano completo; si no, tal como está guardado. */
const formatPhone = (raw: string) => {
  const digits = raw.replace(/\D/g, '');
  const m = /^57(\d{3})(\d{3})(\d{4})$/.exec(digits);
  if (m) return `+57 ${m[1]} ${m[2]} ${m[3]}`;
  const local = /^(\d{3})(\d{3})(\d{4})$/.exec(digits);
  return local ? `${local[1]} ${local[2]} ${local[3]}` : raw;
};

/** "4,9" en español, "4.9" en inglés. */
export const formatRating = (value: number, language: Language) => value.toLocaleString(language === 'en' ? 'en-US' : 'es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/**
 * Cabecera del negocio, en dos lados. Escritorio: a la IZQUIERDA el logo circular con los datos del negocio (nombre,
 * calificación real, tipo, dirección, contacto, estado de apertura, distintivo y "Reservar cita"); a la DERECHA la foto del
 * local. Celular: arriba el logo y la foto lado a lado y, debajo, los datos. Sin foto o sin logo: fallbacks elegantes.
 * Nada se dibuja encima de la foto.
 */
export function Hero({ profile, language, onBook, ctaRef }: { profile: PublicBookingProfile; language: Language; onBook: () => void; ctaRef: Ref<HTMLDivElement> }) {
  const t = (key: string, params?: Record<string, string | number>) => translate(language, key, params);
  const [expanded, setExpanded] = useState(false);
  const reviewsOn = profile.sections.reviews;
  const { average, count } = profile.rating;
  const hasRating = count > 0 && average !== null;
  const typeKey = `type_${profile.businessType}`;
  const typeLabel = profile.businessType && translate(language, typeKey) !== typeKey ? translate(language, typeKey) : '';
  const address = profile.mapAddress || [profile.address, profile.city].filter(Boolean).join(', ');
  // Contacto: el teléfono si lo tiene (llamar); si no, su WhatsApp.
  const contact = profile.phone
    ? { href: phoneHref(profile.phone), label: formatPhone(profile.phone), icon: 'phone' as const, external: false }
    : profile.whatsapp
      ? { href: whatsappLink(profile.whatsapp, ''), label: formatPhone(profile.whatsapp), icon: 'chat' as const, external: true }
      : null;

  return (
    <header className="xp-hero xp-hero--duo">
      <div className="xp-container">
        <div className="xp-duo">
          <div className="xp-duo-logo">
            {profile.logoUrl ? (
              <img src={profile.logoUrl} alt={t('pub_logo_alt', { name: profile.name })} width={160} height={160} decoding="async" />
            ) : (
              <span className="xp-duo-logo-fallback" aria-hidden="true">
                {initials(profile.name)}
              </span>
            )}
          </div>

          {profile.coverUrl ? (
            <button type="button" className="xp-duo-photo" aria-label={t('pub_gallery_open', { n: 1, total: 1 })} onClick={() => setExpanded(true)}>
              {/* Fondo desenfocado de la MISMA foto: con `contain` nunca se recorta nada y el espacio sobrante no queda plano. */}
              <span className="xp-duo-photo-backdrop" style={{ backgroundImage: `url(${profile.coverUrl})` }} aria-hidden="true" />
              <img src={profile.coverUrl} alt="" width={960} height={600} fetchPriority="high" decoding="async" />
            </button>
          ) : (
            <div className="xp-duo-photo xp-duo-photo--empty" aria-hidden="true">
              <Icon name="image" size={36} />
            </div>
          )}

          <div className="xp-identity xp-identity--duo">
            <h1 className="xp-name">{profile.name}</h1>

            {reviewsOn ? (
              hasRating ? (
                <a className="xp-hero-rating" href="#resenas">
                  <Stars value={average} label={t('pub_stars_label', { rating: formatRating(average, language) })} />
                  <strong>{formatRating(average, language)}</strong>
                  <span className="xp-muted">· {count === 1 ? t('pub_reviews_one') : t('pub_reviews_count', { count })}</span>
                </a>
              ) : (
                <a className="xp-hero-rating is-empty" href="#resenas">
                  <Stars value={null} label={t('pub_reviews_none')} />
                  <span className="xp-muted">{t('pub_reviews_first')}</span>
                </a>
              )
            ) : null}

            {typeLabel ? <p className="xp-hero-type">{typeLabel}</p> : null}
            {profile.tagline ? <p className="xp-tagline">{profile.tagline}</p> : null}
            {address ? (
              <p className="xp-hero-address">
                <Icon name="pin" size={16} /> {address}
              </p>
            ) : null}
            {contact ? (
              <p className="xp-hero-address">
                <Icon name={contact.icon} size={16} />
                <a className="xp-hero-contact" href={contact.href} {...(contact.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
                  {contact.label}
                </a>
              </p>
            ) : null}

            <div className="xp-badges">
              <span className={`xp-status ${profile.openStatus.open ? 'is-open' : 'is-closed'}`}>
                <span className="xp-dot" aria-hidden="true" />
                {statusText(profile, language)}
              </span>
              {profile.features.noPrepayBadge ? (
                <span className="xp-trust-badge">
                  <Icon name="check" size={14} /> {t('pub_no_prepay_badge')}
                </span>
              ) : null}
            </div>

            {profile.acceptsBookings || profile.acceptsProductOrders ? (
              <div ref={ctaRef} className="xp-hero-cta">
                <Button size="lg" onClick={onBook}>
                  {/* Sin citas en línea pero con pedidos (p. ej. un negocio que solo vende productos): "Pedir productos". */}
                  {t(profile.acceptsBookings ? 'pub_book_cta' : 'pub_order_cta')}
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
      {expanded && profile.coverUrl ? <Lightbox photos={[profile.coverUrl]} index={0} onChange={() => {}} onClose={() => setExpanded(false)} language={language} /> : null}
    </header>
  );
}
