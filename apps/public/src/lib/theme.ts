import { useEffect, useState } from 'react';

export type ThemeChoice = 'system' | 'light' | 'dark';

const KEY = 'xp-theme';

function systemPrefersLight(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches;
}

function resolve(choice: ThemeChoice): 'light' | 'dark' {
  return choice === 'system' ? (systemPrefersLight() ? 'light' : 'dark') : choice;
}

function apply(choice: ThemeChoice) {
  const resolved = resolve(choice);
  document.documentElement.setAttribute('data-theme', resolved);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'light' ? '#f6f2e9' : '#15130f');
}

function readStored(): ThemeChoice {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    /* almacenamiento no disponible (privado, bloqueado): se usa el del sistema */
  }
  return 'system';
}

/** Tema de la página pública: sistema (por defecto), claro u oscuro, guardado en el navegador. El `<script>` inline en
 * index.html ya aplica el valor guardado antes del primer pintado; este hook solo sincroniza el estado de React y
 * reacciona a cambios (toggle del visitante, o cambio del tema del sistema operativo mientras está en "Sistema"). */
export function useTheme(): [ThemeChoice, (next: ThemeChoice) => void] {
  const [choice, setChoice] = useState<ThemeChoice>(readStored);

  useEffect(() => {
    apply(choice);
    if (choice !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => apply('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [choice]);

  const setTheme = (next: ThemeChoice) => {
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* se aplica igual para esta visita, solo no persiste */
    }
    setChoice(next);
  };

  return [choice, setTheme];
}
