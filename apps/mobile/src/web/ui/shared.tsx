import { useId, type ReactNode } from 'react';
import { ensureStyles } from '../styles';

export const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

/** Garantiza que el CSS del sistema de diseño esté presente. */
export function useWebStyles(): void {
  if (typeof document !== 'undefined') ensureStyles();
}

export function VisuallyHidden({ children }: { children: ReactNode }) {
  useWebStyles();
  return <span className="xw-sr">{children}</span>;
}

/** Icono decorativo (aria-hidden): nunca es la única señal de estado, siempre va con texto. */
export type IconName = 'alert' | 'check' | 'info' | 'eye' | 'eye-off' | 'chevron-down' | 'chevron-right' | 'close' | 'inbox' | 'home' | 'calendar' | 'users' | 'book' | 'box' | 'briefcase' | 'chart' | 'sliders' | 'menu' | 'chevrons-left' | 'chevrons-right' | 'arrow-left' | 'star' | 'globe';

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<typeof name, ReactNode> = {
    alert: (
      <>
        <path d="M12 3 2 21h20L12 3Z" />
        <path d="M12 10v5M12 18h.01" />
      </>
    ),
    check: <path d="m4 12 5 5L20 6" />,
    info: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v6M12 7.5h.01" />
      </>
    ),
    eye: (
      <>
        <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    'eye-off': (
      <>
        <path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.1 6.1A17 17 0 0 0 2 12s3.6 7 10 7a10 10 0 0 0 4.4-1" />
        <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      </>
    ),
    'chevron-down': <path d="m6 9 6 6 6-6" />,
    close: <path d="M6 6l12 12M18 6 6 18" />,
    'chevron-right': <path d="m9 6 6 6-6 6" />,
    home: (
      <>
        <path d="M3 11 12 3l9 8" />
        <path d="M5 10v10h14V10" />
        <path d="M10 20v-6h4v6" />
      </>
    ),
    calendar: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M3 10h18M8 3v4M16 3v4" />
      </>
    ),
    users: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
        <circle cx="17" cy="9" r="2.5" />
        <path d="M17 14.5c2.5 0 4 1.7 4 4.5" />
      </>
    ),
    book: (
      <>
        <path d="M4 4h10a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4V4Z" />
        <path d="M4 16a4 4 0 0 1 4-4h10" />
      </>
    ),
    box: (
      <>
        <path d="M21 8 12 3 3 8l9 5 9-5Z" />
        <path d="M3 8v8l9 5 9-5V8M12 13v8" />
      </>
    ),
    briefcase: (
      <>
        <rect x="3" y="7" width="18" height="13" rx="2" />
        <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18" />
      </>
    ),
    chart: <path d="M4 20V4M4 20h16M8 16v-5M13 16V8M18 16v-3" />,
    sliders: (
      <>
        <path d="M4 6h8M18 6h2M4 12h2M12 12h8M4 18h10M20 18h0" />
        <circle cx="15" cy="6" r="2" />
        <circle cx="9" cy="12" r="2" />
        <circle cx="17" cy="18" r="2" />
      </>
    ),
    menu: <path d="M4 6h16M4 12h16M4 18h16" />,
    'chevrons-left': <path d="m11 17-5-5 5-5M18 17l-5-5 5-5" />,
    'chevrons-right': <path d="m6 17 5-5-5-5M13 17l5-5-5-5" />,
    'arrow-left': <path d="M19 12H5M12 19l-7-7 7-7" />,
    inbox: (
      <>
        <path d="M3 13l3-8h12l3 8v6H3v-6Z" />
        <path d="M3 13h5l1 3h6l1-3h5" />
      </>
    ),
    star: <path d="m12 3 2.6 5.9 6.4.6-4.8 4.3 1.4 6.3L12 17l-5.6 3 1.4-6.3-4.8-4.3 6.4-.6L12 3Z" />,
    globe: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
      </>
    ),
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {paths[name]}
    </svg>
  );
}

/** ids estables para enlazar label / hint / error. */
export function useFieldIds(explicit?: string) {
  const generated = useId();
  const id = explicit ?? `xw-${generated.replace(/:/g, '')}`;
  return { id, hintId: `${id}-hint`, errorId: `${id}-error` };
}
