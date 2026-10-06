import { googleMapsDirectionsUrl, googleMapsSearchUrl, phoneHref, translate, wazeSearchUrl, wazeUrl, whatsappLink, type Language, type PublicBookingProfile } from '@xiro/shared';
import { useState } from 'react';
import { Icon } from './Icon';

/**
 * Ubicación y contacto: mapa (una imagen que arma el servidor, oscura y con el pin dorado —la página no carga ningún script de
 * Google ni expone claves— y que al tocarla abre Google Maps), la dirección escrita y los botones para llegar y contactar.
 * Con pin: rutas exactas (Google con `place_id`, Waze). Solo con dirección escrita: búsqueda del texto. Sin nada de eso no se dibuja.
 */
export function LocationCard({ profile, language }: { profile: PublicBookingProfile; language: Language }) {
  const t = (key: string, params?: Record<string, string | number>) => translate(language, key, params);
  const [imageFailed, setImageFailed] = useState(false);

  const hasPin = profile.latitude !== null && profile.longitude !== null;
  const written = [profile.address, profile.city].filter(Boolean).join(', ');
  const address = (hasPin && profile.mapAddress) || written;
  if (!hasPin && !address && !profile.whatsapp && !profile.phone) return null;

  const place = hasPin ? { lat: profile.latitude!, lng: profile.longitude!, placeId: profile.placeId } : null;
  const googleHref = place ? googleMapsDirectionsUrl(place) : address ? googleMapsSearchUrl(address) : null;
  const wazeHref = place ? wazeUrl(place) : address ? wazeSearchUrl(address) : null;
  const showImage = Boolean(profile.mapImageUrl) && !imageFailed;

  return (
    <div className="xp-location">
      {showImage && googleHref ? (
        <a className="xp-map-link" href={googleHref} target="_blank" rel="noopener noreferrer" aria-label={t('pub_map_open_aria', { name: profile.name })}>
          <img className="xp-map-img" src={profile.mapImageUrl!} alt={t('pub_loc_map_alt', { name: profile.name })} width={640} height={360} loading="lazy" decoding="async" onError={() => setImageFailed(true)} />
        </a>
      ) : null}
      {address ? (
        <p className="xp-address">
          <Icon name="pin" size={18} /> <span>{address}</span>
        </p>
      ) : null}
      <div className="xp-btn-row">
        {googleHref ? (
          <a className="xp-btn xp-btn--secondary xp-btn--auto" href={googleHref} target="_blank" rel="noopener noreferrer">
            <Icon name="navigate" /> {t('pub_loc_google')}
          </a>
        ) : null}
        {wazeHref ? (
          <a className="xp-btn xp-btn--secondary xp-btn--auto" href={wazeHref} target="_blank" rel="noopener noreferrer">
            <Icon name="navigate" /> {t('pub_loc_waze')}
          </a>
        ) : null}
        {profile.whatsapp ? (
          <a className="xp-btn xp-btn--auto" href={whatsappLink(profile.whatsapp, '')} target="_blank" rel="noopener noreferrer">
            <Icon name="chat" /> {t('pub_whatsapp')}
          </a>
        ) : null}
        {profile.phone ? (
          <a className="xp-btn xp-btn--ghost xp-btn--auto" href={phoneHref(profile.phone)}>
            <Icon name="phone" /> {t('call')}
          </a>
        ) : null}
      </div>
    </div>
  );
}
