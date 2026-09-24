import { useId, type ReactNode } from 'react';
import type { CountryCode } from '../data/countries';

/**
 * Banderas como SVG locales (no emojis: en Windows los emojis de bandera se ven como letras). Formato 3:2 con esquinas redondeadas.
 * Son versiones simplificadas de las banderas oficiales (sin escudos detallados) pensadas para 20–28 px.
 */
const art: Record<CountryCode, ReactNode> = {
  CO: (
    <>
      <rect width="36" height="12" fill="#FCD116" />
      <rect y="12" width="36" height="6" fill="#003893" />
      <rect y="18" width="36" height="6" fill="#CE1126" />
    </>
  ),
  MX: (
    <>
      <rect width="12" height="24" fill="#006847" />
      <rect x="12" width="12" height="24" fill="#FFFFFF" />
      <rect x="24" width="12" height="24" fill="#CE1126" />
      <circle cx="18" cy="12" r="3.4" fill="#A5793A" />
      <circle cx="18" cy="12" r="1.6" fill="#6B8E3C" />
    </>
  ),
  US: (
    <>
      <rect width="36" height="24" fill="#FFFFFF" />
      {[0, 2, 4, 6, 8, 10, 12].map((i) => (
        <rect key={i} y={(i * 24) / 13} width="36" height={24 / 13} fill="#B22234" />
      ))}
      <rect width="16" height={(7 * 24) / 13} fill="#3C3B6E" />
      {[0, 1, 2].flatMap((row) => [0, 1, 2, 3].map((col) => <circle key={`${row}-${col}`} cx={3 + col * 3.6 + (row % 2) * 1.8} cy={2.6 + row * 3.4} r="0.9" fill="#FFFFFF" />))}
    </>
  ),
  ES: (
    <>
      <rect width="36" height="24" fill="#AA151B" />
      <rect y="6" width="36" height="12" fill="#F1BF00" />
    </>
  ),
  AR: (
    <>
      <rect width="36" height="8" fill="#74ACDF" />
      <rect y="8" width="36" height="8" fill="#FFFFFF" />
      <rect y="16" width="36" height="8" fill="#74ACDF" />
      <circle cx="18" cy="12" r="2.8" fill="#F6B40E" />
    </>
  ),
  CL: (
    <>
      <rect width="36" height="12" fill="#FFFFFF" />
      <rect y="12" width="36" height="12" fill="#D52B1E" />
      <rect width="12" height="12" fill="#0039A6" />
      <path d="m6 2.2 1.15 3.5H10.8L7.85 7.85 8.95 11.3 6 9.2 3.05 11.3l1.1-3.45L1.2 5.7h3.65Z" fill="#FFFFFF" />
    </>
  ),
  PE: (
    <>
      <rect width="12" height="24" fill="#D91023" />
      <rect x="12" width="12" height="24" fill="#FFFFFF" />
      <rect x="24" width="12" height="24" fill="#D91023" />
    </>
  ),
  CA: (
    <>
      <rect width="36" height="24" fill="#FFFFFF" />
      <rect width="9" height="24" fill="#FF0000" />
      <rect x="27" width="9" height="24" fill="#FF0000" />
      <path d="M18 6 19.2 9.6 23 9 20.6 12 23 13.4 19.6 13.8 20.2 17.4 18 15 15.8 17.4 16.4 13.8 13 13.4 15.4 12 13 9 16.8 9.6Z" fill="#FF0000" />
    </>
  ),
  EC: (
    <>
      <rect width="36" height="12" fill="#FFD100" />
      <rect y="12" width="36" height="6" fill="#0033A0" />
      <rect y="18" width="36" height="6" fill="#ED1C24" />
      <circle cx="18" cy="12" r="3.6" fill="#FFD100" stroke="#0033A0" strokeWidth="0.6" />
      <circle cx="18" cy="12" r="1.6" fill="#8B5E3C" />
    </>
  ),
};

/** Bandera decorativa: el nombre del país siempre va como texto al lado. */
export function Flag({ code, width = 24 }: { code: CountryCode; width?: number }) {
  const clip = useId().replace(/:/g, '');
  return (
    <svg width={width} height={(width * 2) / 3} viewBox="0 0 36 24" aria-hidden="true" focusable="false" style={{ flex: 'none', borderRadius: 4, boxShadow: '0 0 0 1px rgba(128,128,128,.45)' }}>
      <defs>
        <clipPath id={clip}>
          <rect width="36" height="24" rx="3.5" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>{art[code]}</g>
    </svg>
  );
}
