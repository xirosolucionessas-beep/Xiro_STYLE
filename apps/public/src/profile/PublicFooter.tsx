import { phoneHref, translate, upperFirst, whatsappLink, type Language, type PublicBookingProfile } from '@xiro/shared';
import { useState } from 'react';
import { Modal } from '../ui/Modal';

/**
 * Pie de página: Privacidad y Términos abren los textos que ESTE negocio escribió en "Mi página web" (sin texto, sin enlace:
 * nunca un enlace falso), y Ayuda lleva a su WhatsApp, a su teléfono o a "Ubicación y contacto", según lo que tenga. Debajo, los
 * créditos de siempre.
 */
export function PublicFooter({ profile, language, hasLocation }: { profile: PublicBookingProfile; language: Language; hasLocation: boolean }) {
  const t = (key: string, params?: Record<string, string | number>) => translate(language, key, params);
  const [open, setOpen] = useState<'privacy' | 'terms' | null>(null);
  const help = profile.whatsapp ? { href: whatsappLink(profile.whatsapp, ''), external: true } : profile.phone ? { href: phoneHref(profile.phone), external: false } : hasLocation ? { href: '#ubicacion', external: false } : null;
  const hasLinks = Boolean(profile.privacyPolicy || profile.conditions || help);

  return (
    <footer className="xp-footer">
      {hasLinks ? (
        <nav className="xp-footer-links" aria-label={t('pub_footer_nav')}>
          {profile.privacyPolicy ? (
            <button type="button" className="xp-footer-link" onClick={() => setOpen('privacy')}>
              {t('pub_footer_privacy')}
            </button>
          ) : null}
          {profile.conditions ? (
            <button type="button" className="xp-footer-link" onClick={() => setOpen('terms')}>
              {t('pub_footer_terms')}
            </button>
          ) : null}
          {help ? (
            <a className="xp-footer-link" href={help.href} {...(help.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
              {t('pub_footer_help')}
            </a>
          ) : null}
        </nav>
      ) : null}
      <p>{t('pub_footer_rights', { year: new Date().getFullYear(), name: profile.name })}</p>
      <p>{t('pub_footer_powered')}</p>
      {open ? (
        <Modal title={upperFirst(t(open === 'privacy' ? 'pub_privacy_link' : 'pub_conditions_link'))} closeLabel={t('close')} onClose={() => setOpen(null)}>
          <p className="xp-legal-text">{open === 'privacy' ? profile.privacyPolicy : profile.conditions}</p>
        </Modal>
      ) : null}
    </footer>
  );
}
