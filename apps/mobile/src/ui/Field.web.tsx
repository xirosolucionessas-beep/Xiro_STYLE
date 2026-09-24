/**
 * Variante WEB de src/ui/Field.tsx: <label for> real, tipo/inputmode/autocomplete correctos, errores enlazados con
 * aria-describedby y anunciados. Mismo API que la nativa (incluido `label="Nombre *"` = obligatorio).
 */
import type { ComponentProps } from 'react';
import { useSettings } from '@/lib/settings';
import { tw } from '@/web/shell/strings';
import { Input } from '@/web/ui';
import type * as Native from './Field';

type FieldProps = ComponentProps<typeof Native.Field>;

const AUTOCOMPLETE: Record<string, string> = {
  password: 'current-password',
  'current-password': 'current-password',
  'new-password': 'new-password',
  username: 'username',
  email: 'email',
  name: 'name',
  tel: 'tel',
  'one-time-code': 'one-time-code',
  off: 'off',
};

export function Field({ label, error, hint, prefix, password, multiline, value, onChangeText, keyboardType, autoCapitalize, autoCorrect, autoComplete, maxLength, placeholder, editable, onSubmitEditing }: FieldProps) {
  const { language } = useSettings();
  const required = /\*\s*$/.test(label);
  const type = password ? 'password' : keyboardType === 'email-address' ? 'email' : keyboardType === 'phone-pad' ? 'tel' : 'text';
  const inputMode = keyboardType === 'number-pad' ? 'numeric' : keyboardType === 'decimal-pad' ? 'decimal' : keyboardType === 'email-address' ? 'email' : keyboardType === 'phone-pad' ? 'tel' : undefined;

  return (
    <Input
      label={label.replace(/\s*\*\s*$/, '')}
      required={required}
      hint={hint}
      error={error}
      prefix={prefix}
      multiline={multiline}
      value={value ?? ''}
      onChange={(next) => onChangeText?.(next)}
      type={type}
      inputMode={inputMode}
      autoComplete={autoComplete ? (AUTOCOMPLETE[autoComplete] ?? autoComplete) : undefined}
      autoCapitalize={autoCapitalize === 'none' ? 'off' : autoCapitalize}
      autoCorrect={autoCorrect === false ? 'off' : undefined}
      maxLength={maxLength}
      placeholder={placeholder}
      disabled={editable === false}
      showPasswordLabel={tw(language, 'show_password')}
      hidePasswordLabel={tw(language, 'hide_password')}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !multiline && onSubmitEditing) onSubmitEditing({} as never);
      }}
    />
  );
}
