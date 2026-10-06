import type { Language } from '@xiro/shared';
import { useMemo } from 'react';

/**
 * Idioma de la página pública: el del navegador de quien visita (sin cuenta ni preferencia guardada, no hay dónde
 * recordarla). Mismo criterio de detección que usa la app al arrancar.
 */
export function browserLanguage(): Language {
  const nav = typeof navigator !== 'undefined' ? navigator.language : 'es';
  return nav.toLowerCase().startsWith('en') ? 'en' : 'es';
}

export function useLanguage(): Language {
  return useMemo(() => browserLanguage(), []);
}
