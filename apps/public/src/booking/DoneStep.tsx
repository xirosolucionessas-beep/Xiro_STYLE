import {
  buildIcs,
  formatClock,
  formatDay,
  googleMapsDirectionsUrl,
  googleMapsSearchUrl,
  localDate,
  localTime,
  translate,
  upperFirst,
  whatsappLink,
  type Language,
  type PublicBookingProfile,
  type PublicBookingResult,
} from '@xiro/shared';
import { useState } from 'react';
import { money } from '../lib/format';
import { downloadTextFile, safeFileName } from '../lib/ics';
import { managePath, navigate, profilePath } from '../lib/route';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { TotalRows } from '../ui/TotalRows';

/**
 * Pantalla final: datos de la cita, agregar al calendario (.ics armado en el navegador), escribirle al negocio por WhatsApp con el
 * mensaje ya escrito y "Cómo llegar". Además el enlace personal, que se entrega UNA sola vez (no se envía por correo).
 */
export function DoneStep({ result, profile, language, customerName, onClose }: { result: PublicBookingResult; profile: PublicBookingProfile; language: Language; customerName: string; onClose: () => void }) {
  const t = (key: string, params?: Record<string, string | number>) => translate(language, key, params);
  const { appointment, token } = result;
  const { business } = appointment;
  const link = `${window.location.origin}${managePath(profile.slug, token)}`;
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const confirmed = appointment.status === 'confirmed';

  const date = localDate(appointment.startsAt, business.timezone);
  const day = upperFirst(formatDay(date, language));
  const time = formatClock(localTime(appointment.startsAt, business.timezone), language);
  const end = formatClock(localTime(appointment.endsAt, business.timezone), language);
  const services = appointment.items.filter((i) => i.kind !== 'product').map((i) => i.name).join(' + ') || appointment.items.map((i) => i.name).join(' + ');
  const address = [business.location?.address || business.address, business.location?.address ? '' : business.city].filter(Boolean).join(', ');

  const directions = business.location ? googleMapsDirectionsUrl({ lat: business.location.latitude, lng: business.location.longitude, placeId: business.location.placeId }) : address ? googleMapsSearchUrl(address) : null;
  const whatsapp = business.whatsapp ? whatsappLink(business.whatsapp, t('pub_done_whatsapp_message', { name: customerName, services, day: formatDay(date, language), time })) : null;

  function addToCalendar() {
    const ics = buildIcs({
      uid: `${profile.slug}-${appointment.startsAt}@xirostyle`,
      title: t('pub_done_ics_title', { services, business: business.name }),
      description: t('pub_done_ics_description', { professional: appointment.professionalName }),
      location: address,
      startsAt: appointment.startsAt,
      endsAt: appointment.endsAt,
      // La página pública del negocio, no el enlace personal: ese da control de la cita y no debe quedar en un calendario compartido.
      url: `${window.location.origin}${profilePath(profile.slug)}`,
    });
    downloadTextFile(`cita-${safeFileName(business.name)}.ics`, ics);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  }

  return (
    <div className="xp-overlay" role="dialog" aria-modal="true" aria-label={t(confirmed ? 'pub_done_confirmed_title' : 'pub_done_pending_title')}>
      <div className="xp-overlay-head">
        <button type="button" className="xp-icon-btn" aria-label={t('close')} onClick={onClose}>
          <Icon name="close" size={22} />
        </button>
        <div className="xp-overlay-title">
          <strong>{t('pub_flow_title')}</strong>
          <span className="xp-muted">{business.name}</span>
        </div>
      </div>
      <div className="xp-overlay-body xp-stack xp-done">
        <div className="xp-done-hero">
          <span className={`xp-done-badge${confirmed ? '' : ' is-pending'}`} aria-hidden="true">
            <Icon name={confirmed ? 'check' : 'clock'} size={34} />
          </span>
          <h2 className="xp-step-title">{t(confirmed ? 'pub_done_confirmed_title' : 'pub_done_pending_title')}</h2>
          {!confirmed ? <p className="xp-muted">{t('pub_done_pending_text')}</p> : null}
        </div>

        <div className="xp-summary">
          <div className="xp-done-when">
            <span className="xp-done-day">{day}</span>
            <span className="xp-done-time">
              {time} – {end}
            </span>
          </div>
          <dl>
            <div>
              <dt>{t('pub_summary_services')}</dt>
              <dd>
                <ul className="xp-summary-lines">
                  {appointment.items.map((item) => (
                    <li key={item.id}>
                      <span>{item.quantity > 1 ? `${item.name} ×${item.quantity}` : item.name}</span>
                      <span>{money(item.price * item.quantity, business.currency)}</span>
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
            <div>
              <dt>{t('pub_summary_professional')}</dt>
              <dd>{appointment.professionalName}</dd>
            </div>
            {address ? (
              <div>
                <dt>{t('pub_summary_where')}</dt>
                <dd>{address}</dd>
              </div>
            ) : null}
          </dl>
          <TotalRows total={appointment.totalPrice} discount={appointment.discount} currency={business.currency} t={t} />
        </div>

        <div className="xp-actions">
          <button type="button" className="xp-action" onClick={addToCalendar}>
            <Icon name="calendar" size={22} />
            <span>{t('pub_done_add_calendar')}</span>
          </button>
          {whatsapp ? (
            <a className="xp-action" href={whatsapp} target="_blank" rel="noopener noreferrer">
              <Icon name="chat" size={22} />
              <span>{t('pub_done_whatsapp')}</span>
            </a>
          ) : null}
          {directions ? (
            <a className="xp-action" href={directions} target="_blank" rel="noopener noreferrer">
              <Icon name="navigate" size={22} />
              <span>{t('pub_done_directions')}</span>
            </a>
          ) : null}
        </div>

        <div className="xp-card xp-stack">
          <h3 className="xp-subtitle">{t('pub_save_link_title')}</h3>
          <p className="xp-hint">{t('pub_save_link_text')}</p>
          <p className="xp-token-box" aria-label={t('pub_save_link_title')}>
            {link}
          </p>
          <div className="xp-btn-row">
            <Button variant="secondary" full={false} onClick={() => void copyLink()}>
              {t('pub_copy_link')}
            </Button>
            <a className="xp-btn xp-btn--secondary xp-btn--auto" href={managePath(profile.slug, token)}>
              {t('pub_open_my_appointment')}
            </a>
          </div>
          {copyState === 'copied' ? (
            <p className="xp-hint" role="status">
              {t('pub_link_copied')}
            </p>
          ) : null}
          {copyState === 'failed' ? (
            <p className="xp-error" role="alert">
              {t('pub_link_copy_failed')}
            </p>
          ) : null}
        </div>

        <Button
          variant="secondary"
          onClick={() => {
            onClose();
            navigate(managePath(profile.slug, token));
          }}>
          {t('pub_done_close')}
        </Button>
      </div>
    </div>
  );
}
