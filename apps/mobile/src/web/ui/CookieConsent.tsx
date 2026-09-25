import { useEffect, useId, useRef } from 'react';
import { Ico } from '../icons';
import { linkProps } from './link';
import { useWebStyles } from './shared';

type T = (key: string) => string;

export interface CookieConsentViewProps {
  open: boolean;
  t: T;
  onAccept: () => void;
  /** Navega dentro de la app (Términos y Privacidad se abren sin recargar; al volver, el aviso sigue ahí). */
  navigate: (href: string) => void;
}

/**
 * Aviso de cookies del primer ingreso: tarjeta flotante oscura y dorada, con entrada suave. Es un diálogo NO bloqueante
 * (no atrapa el foco ni oscurece la página): recibe el foco en "Entendido y Aceptar" al aparecer y se puede leer lo legal
 * antes de aceptar. Solo se cierra aceptando.
 */
export function CookieConsentView({ open, t, onAccept, navigate }: CookieConsentViewProps) {
  useWebStyles();
  const titleId = useId();
  const bodyId = useId();
  const accept = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) accept.current?.focus({ preventScroll: true });
  }, [open]);

  if (!open) return null;
  return (
    <div className="xw-cookie xw-scope-dark" role="dialog" aria-labelledby={titleId} aria-describedby={bodyId}>
      <div className="xw-cookie-head">
        <span className="xw-cookie-ic" aria-hidden="true">
          <Ico name="shield-check" size={22} />
        </span>
        <h2 id={titleId} className="xw-cookie-title">
          {t('cookies_title')}
        </h2>
      </div>
      <p id={bodyId} className="xw-cookie-body">
        {t('cookies_body')} {t('cookies_more')}{' '}
        <a {...linkProps('/terms', navigate)}>
          {t('cookies_terms')}
        </a>{' '}
        {t('cookies_and')}{' '}
        <a {...linkProps('/privacy', navigate)}>
          {t('cookies_privacy')}
        </a>
        .
      </p>
      <button ref={accept} type="button" className="xw-btn xw-btn--primary xw-cookie-btn" onClick={onAccept}>
        {t('cookies_accept')}
      </button>
    </div>
  );
}
