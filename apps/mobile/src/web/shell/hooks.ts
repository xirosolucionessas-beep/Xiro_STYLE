import { useCallback, useState, useSyncExternalStore } from 'react';
import { layout } from '../tokens';
import type { ShellMode } from './ShellView';

function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (notify: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', notify);
      return () => list.removeEventListener('change', notify);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => true,
  );
}

/** ≥1024px escritorio · 768–1023px tablet (solo iconos) · <768px móvil (drawer). */
export function useShellMode(): ShellMode {
  const desktop = useMediaQuery(`(min-width: ${layout.breakpoints.desktop}px)`);
  const tablet = useMediaQuery(`(min-width: ${layout.breakpoints.tablet}px)`);
  return desktop ? 'desktop' : tablet ? 'tablet' : 'mobile';
}

/** Booleano persistido en localStorage (tolera almacenamiento bloqueado). */
export function usePersistentBool(key: string, initial: boolean): [boolean, () => void] {
  const [value, setValue] = useState<boolean>(() => {
    try {
      const stored = window.localStorage.getItem(key);
      return stored === null ? initial : stored === '1';
    } catch {
      return initial;
    }
  });
  const toggle = useCallback(() => {
    setValue((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(key, next ? '1' : '0');
      } catch {
        /* sin persistencia */
      }
      return next;
    });
  }, [key]);
  return [value, toggle];
}
