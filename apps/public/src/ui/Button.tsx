import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: Variant;
  size?: 'md' | 'sm' | 'lg';
  loading?: boolean;
  loadingLabel?: string;
  full?: boolean;
}

export function Button({ variant = 'primary', size = 'md', loading, loadingLabel = 'Cargando…', full = true, disabled, children, ...rest }: ButtonProps) {
  const classes = ['xp-btn', variant !== 'primary' && `xp-btn--${variant}`, size !== 'md' && `xp-btn--${size}`, !full && 'xp-btn--auto'].filter(Boolean).join(' ');
  return (
    <button type="button" className={classes} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? (
        <>
          <span className="xp-spinner" aria-hidden="true" />
          <span className="xp-sr">{loadingLabel}</span>
        </>
      ) : (
        children
      )}
    </button>
  );
}
