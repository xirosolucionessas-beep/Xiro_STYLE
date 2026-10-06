import type { Language } from '@xiro/shared';
import { useEffect, useState } from 'react';

const KEY = 'xp-lang';

function detect(): Language {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === 'es' || stored === 'en') return stored;
  } catch {
    /* almacenamiento no disponible: se detecta del navegador en cada visita */
  }
  const nav = typeof navigator !== 'undefined' ? navigator.language : 'es';
  return nav.toLowerCase().startsWith('en') ? 'en' : 'es';
}

/** Idioma de la página pública: el elegido por quien visita (guardado en el navegador) o, por defecto, el del
 * navegador. `setLanguage` lo persiste para que no haya que elegirlo de nuevo en la misma página. */
export function useLanguage(): [Language, (next: Language) => void] {
  const [language, setLanguageState] = useState<Language>(detect);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const setLanguage = (next: Language) => {
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* se aplica igual para esta visita, solo no persiste */
    }
    setLanguageState(next);
  };

  return [language, setLanguage];
}
