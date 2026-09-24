import type { SelectHTMLAttributes } from 'react';
import { describedBy, FieldShell, type FieldShellProps } from './Input';
import { Icon, useFieldIds, useWebStyles } from './shared';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends FieldShellProps, Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'value' | 'className' | 'style' | 'id'> {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  /** Opción vacía inicial (p. ej. "Selecciona…"). */
  placeholder?: string;
}

/** <select> nativo estilizado: el control más accesible (teclado, lectores y móviles) sin reimplementar comportamiento. */
export function Select({ label, hint, error, required, id, value, onChange, options, placeholder, ...rest }: SelectProps) {
  useWebStyles();
  const ids = useFieldIds(id);
  return (
    <FieldShell label={label} hint={hint} error={error} required={required} ids={ids}>
      <select
        {...rest}
        id={ids.id}
        value={value}
        required={required}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(ids, hint, error)}
        onChange={(e) => onChange(e.target.value)}>
        {placeholder !== undefined ? (
          <option value="" disabled={required}>
            {placeholder}
          </option>
        ) : null}
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      <span className="xw-chevron">
        <Icon name="chevron-down" />
      </span>
    </FieldShell>
  );
}
