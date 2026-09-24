import { useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { cx, Icon, useFieldIds, useWebStyles } from './shared';

export interface FieldShellProps {
  label: string;
  hint?: string;
  /** Mensaje ya traducido. Se anuncia (aria-live) y se enlaza con aria-describedby. */
  error?: string;
  required?: boolean;
  id?: string;
}

/** Estructura común de campo: <label for>, control, ayuda y error anunciable. */
export function FieldShell({ label, hint, error, required, ids, multiline, children }: FieldShellProps & { ids: ReturnType<typeof useFieldIds>; multiline?: boolean; children: ReactNode }) {
  return (
    <div className="xw-field">
      <label className="xw-label" htmlFor={ids.id}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      <div className={cx('xw-control', error && 'xw-control--invalid', multiline && 'xw-control--multiline')}>{children}</div>
      {hint ? (
        <p className="xw-hint" id={ids.hintId}>
          {hint}
        </p>
      ) : null}
      {/* La región existe siempre para que los lectores de pantalla anuncien los cambios. */}
      <p className="xw-error" id={ids.errorId} aria-live="polite">
        {error ? (
          <>
            <Icon name="alert" size={16} />
            <span>{error}</span>
          </>
        ) : null}
      </p>
    </div>
  );
}

export const describedBy = (ids: ReturnType<typeof useFieldIds>, hint?: string, error?: string) => {
  const list = [hint ? ids.hintId : null, error ? ids.errorId : null].filter(Boolean).join(' ');
  return list || undefined;
};

export interface InputProps extends FieldShellProps, Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'className' | 'style' | 'id' | 'prefix'> {
  value: string;
  onChange: (value: string) => void;
  prefix?: string;
  multiline?: boolean;
  rows?: number;
  showPasswordLabel?: string;
  hidePasswordLabel?: string;
}

export function Input({ label, hint, error, required, id, value, onChange, prefix, multiline, rows = 4, type = 'text', showPasswordLabel = 'Mostrar contraseña', hidePasswordLabel = 'Ocultar contraseña', ...rest }: InputProps) {
  useWebStyles();
  const ids = useFieldIds(id);
  const [revealed, setRevealed] = useState(false);
  const isPassword = type === 'password';

  const common = {
    id: ids.id,
    value,
    required,
    'aria-required': required || undefined,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy(ids, hint, error),
  } as const;

  return (
    <FieldShell label={label} hint={hint} error={error} required={required} ids={ids} multiline={multiline}>
      {prefix ? (
        <span className="xw-prefix" aria-hidden="true">
          {prefix}
        </span>
      ) : null}
      {multiline ? (
        <textarea {...common} rows={rows} onChange={(e) => onChange(e.target.value)} maxLength={rest.maxLength} placeholder={rest.placeholder} disabled={rest.disabled} name={rest.name} />
      ) : (
        <input {...rest} {...common} type={isPassword && revealed ? 'text' : type} onChange={(e) => onChange(e.target.value)} />
      )}
      {isPassword ? (
        <button type="button" className="xw-icon-btn" aria-pressed={revealed} aria-label={revealed ? hidePasswordLabel : showPasswordLabel} onClick={() => setRevealed((v) => !v)}>
          <Icon name={revealed ? 'eye-off' : 'eye'} />
        </button>
      ) : null}
    </FieldShell>
  );
}
