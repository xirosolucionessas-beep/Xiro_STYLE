import type { PlatformGrouping } from '@xiro/shared';
import type { PlatformText } from './texts';

export const locale = (language: string) => (language === 'en' ? 'en-US' : 'es-CO');

/** Escala "redonda" para el eje Y (1, 2, 5 × 10^n): marcas legibles, siempre enteras (son conteos). */
export function niceTicks(max: number): number[] {
  if (max <= 0) return [0, 1];
  const rough = max / 4;
  const pow = 10 ** Math.floor(Math.log10(Math.max(1, rough)));
  const step = Math.max(1, [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= rough) ?? 10 * pow);
  const ticks: number[] = [];
  for (let v = 0; v < max + step; v += step) ticks.push(v);
  return ticks;
}

/**
 * Etiqueta de un período según la agrupación: "12 oct", "Semana del 12 oct", "oct 2026". La fecha del servidor ya está en
 * la zona del período (AAAA-MM-DD), así que se formatea en UTC para no correrla un día por la zona del equipo.
 */
export function bucketLabel(start: string, grouping: PlatformGrouping, language: string, pt: PlatformText): string {
  const date = new Date(`${start}T00:00:00Z`);
  if (grouping === 'month') return new Intl.DateTimeFormat(locale(language), { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
  const day = new Intl.DateTimeFormat(locale(language), { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(date);
  return grouping === 'week' ? `${pt('chart_week_of')} ${day}` : day;
}
