import { isTranslationKey } from '@xiro/shared';
import { ApiError, errorKey } from './api';

type Translate = (key: string) => string;

const translateMessage = (message: string, t: Translate) => (isTranslationKey(message) ? t(message) : t('required'));

export function issuesToErrors(issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>, t: Translate): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const field = String(issue.path[0] ?? '');
    if (field && !errors[field]) errors[field] = translateMessage(issue.message, t);
  }
  return errors;
}

/** Errores de la API separados en campos (validación) y un mensaje general (credenciales, red, conflicto...). */
export function apiErrors(error: unknown, t: Translate): { fields: Record<string, string>; general?: string } {
  if (error instanceof ApiError && error.code === 'validation_error' && error.issues.length > 0) {
    return { fields: issuesToErrors(error.issues.map((i) => ({ path: i.path.split('.'), message: i.message })), t) };
  }
  const key = errorKey(error);
  return { fields: {}, general: isTranslationKey(key) ? t(key) : t('unknown_error') };
}

export const digitsOnly = (value: string) => value.replace(/\D/g, '');

/** "45000" → 45000; vacío → 0. */
export const toInt = (value: string) => (value ? Number.parseInt(digitsOnly(value) || '0', 10) : 0);
