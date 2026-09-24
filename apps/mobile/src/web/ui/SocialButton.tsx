import type { MouseEvent } from 'react';
import { AppleLogo, GoogleLogo } from '../brand/logos';
import type { SocialProvider } from '../services/socialAuth.web';
import { cx, useWebStyles, VisuallyHidden } from './shared';

export interface SocialButtonProps {
  provider: SocialProvider;
  /** Texto completo ("Iniciar sesión con Google"). */
  label: string;
  /** `soon`: el proveedor no está disponible aún ("Próximamente"); `loading`: flujo en curso. */
  state?: 'idle' | 'loading' | 'soon';
  soonLabel: string;
  loadingLabel: string;
  onPress: () => void;
}

/**
 * Botón de acceso con Google o Apple (guías de marca: logo oficial, mismo alto y tamaño de logo, Apple sin color dorado).
 * En `loading` el spinner sustituye al logo y se bloquea el clic (sin `disabled`, para no perder el foco del teclado).
 * En `soon` sigue siendo enfocable: quien navega con lector de pantalla oye "Próximamente" en el nombre del botón.
 */
export function SocialButton({ provider, label, state = 'idle', soonLabel, loadingLabel, onPress }: SocialButtonProps) {
  useWebStyles();
  const inactive = state !== 'idle';
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (inactive) {
      event.preventDefault();
      return;
    }
    onPress();
  };
  return (
    <button
      type="button"
      className={cx('xw-social', `xw-social--${provider}`)}
      aria-disabled={inactive || undefined}
      aria-busy={state === 'loading' || undefined}
      data-soon={state === 'soon' || undefined}
      onClick={handleClick}>
      <span className="xw-social-ic" aria-hidden="true">
        {state === 'loading' ? <span className="xw-spinner" /> : provider === 'google' ? <GoogleLogo size={20} /> : <AppleLogo size={22} />}
      </span>
      <span className="xw-social-text">
        <span className="xw-social-label">{label}</span>
        {state === 'soon' ? <span className="xw-social-soon">{soonLabel}</span> : null}
      </span>
      {state === 'loading' ? <VisuallyHidden>{loadingLabel}</VisuallyHidden> : null}
    </button>
  );
}

/** Estado visual a partir de la disponibilidad del proveedor y de si hay un flujo en curso con él. */
export function socialState(available: boolean, busy: boolean): NonNullable<SocialButtonProps['state']> {
  if (busy) return 'loading';
  return available ? 'idle' : 'soon';
}
