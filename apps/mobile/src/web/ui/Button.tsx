import type { ButtonHTMLAttributes, CSSProperties, MouseEvent, ReactNode } from 'react';
import { cx, useWebStyles, VisuallyHidden } from './shared';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'style'> {
  /** Solo ajustes de layout (márgenes, flex, ancho). Colores y tipografía vienen de los tokens. */
  style?: CSSProperties;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'md' | 'sm';
  fullWidth?: boolean;
  icon?: ReactNode;
  /** Dónde va el icono respecto al texto (por defecto, antes; 'end' para flechas de avance). */
  iconPosition?: 'start' | 'end';
  loading?: boolean;
  /** Texto para lectores de pantalla mientras `loading` (p. ej. "Cargando"). */
  loadingLabel?: string;
  /** Paridad con la API nativa (`onPress`). */
  onPress?: () => void;
}

export function Button({ variant = 'primary', size = 'md', fullWidth, icon, iconPosition = 'start', loading, loadingLabel, onPress, onClick, disabled, children, type = 'button', style, ...rest }: ButtonProps) {
  useWebStyles();
  const inactive = Boolean(disabled || loading);

  // Con `loading` no se usa `disabled` para no perder el foco del teclado; se bloquea el clic y se anuncia aria-busy.
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (inactive) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
    onPress?.();
  };

  return (
    <button
      {...rest}
      type={type}
      style={style}
      disabled={disabled && !loading}
      aria-disabled={inactive || undefined}
      aria-busy={loading || undefined}
      onClick={handleClick}
      className={cx('xw-btn', `xw-btn--${variant}`, size === 'sm' && 'xw-btn--sm', fullWidth && 'xw-btn--block')}>
      {loading ? <span className="xw-spinner" aria-hidden="true" /> : iconPosition === 'start' ? icon : null}
      <span>{children}</span>
      {!loading && iconPosition === 'end' ? icon : null}
      {loading && loadingLabel ? <VisuallyHidden>{loadingLabel}</VisuallyHidden> : null}
    </button>
  );
}
