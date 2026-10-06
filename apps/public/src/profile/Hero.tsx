import { translate, type Language, type PublicBookingProfile } from '@xiro/shared';
import type { Ref } from 'react';
import { initials } from '../lib/format';
import { statusText } from '../lib/hours';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';

/**
 * Encabezado: portada con degradado oscuro abajo (el texto NUNCA va encima de la imagen), logo circular montado en su borde y,
 * debajo, sobre fondo sólido: nombre, frase, estado de apertura y el botón principal. Una portada con texto o muy cargada no
 * puede restar legibilidad a nada porque nada se dibuja sobre ella.
 */
export function Hero({ profile, language, onBook, ctaRef }: { profile: PublicBookingProfile; language: Language; onBook: () => void; ctaRef: Ref<HTMLDivElement> }) {
  const t = (key: string, params?: Record<string, string | number>) => translate(language, key, params);
  const showRating = profile.sections.reviews && profile.rating.count > 0;
  return (
    <header className="xp-hero">
      <div className="xp-cover">
        {profile.coverUrl ? <img className="xp-cover-img" src={profile.coverUrl} alt="" width={1200} height={480} fetchPriority="high" decoding="async" /> : <div className="xp-cover-fallback" aria-hidden="true" />}
      </div>
      <div className="xp-container xp-identity">
        {profile.logoUrl ? (
          <img className="xp-logo" src={profile.logoUrl} alt="" width={96} height={96} decoding="async" />
        ) : (
          <span className="xp-logo xp-logo--fallback" aria-hidden="true">
            {initials(profile.name)}
          </span>
        )}
        <h1 className="xp-name">{profile.name}</h1>
        {profile.tagline ? <p className="xp-tagline">{profile.tagline}</p> : null}
        <div className="xp-badges">
          <span className={`xp-status ${profile.openStatus.open ? 'is-open' : 'is-closed'}`}>
            <span className="xp-dot" aria-hidden="true" />
            {statusText(profile, language)}
          </span>
          {showRating ? (
            <span className="xp-rating">
              <Icon name="star" size={16} />
              {t('pub_rating', { rating: profile.rating.average ?? 0, count: profile.rating.count })}
            </span>
          ) : null}
        </div>
        {profile.acceptsBookings ? (
          <div ref={ctaRef} className="xp-hero-cta">
            <Button size="lg" onClick={onBook}>
              {t('pub_book_cta')}
            </Button>
          </div>
        ) : null}
      </div>
    </header>
  );
}
