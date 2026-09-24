import { useMemo } from 'react';
import { useSettings } from '@/lib/settings';
import { tw } from '../shell/strings';

/** Traductor de la capa web (textos propios de la web + diccionario compartido). */
export function useWebText() {
  const { language } = useSettings();
  const t = useMemo(() => (key: string, params?: Record<string, string | number>) => tw(language, key, params), [language]);
  return { t, language };
}
