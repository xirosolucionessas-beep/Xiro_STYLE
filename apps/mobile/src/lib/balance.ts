import { BALANCE_PRESETS, presetRange, type BalanceGrouping, type BalancePreset, type Language } from '@xiro/shared';

/** Balance general (Reportes → Balance general): el rango vive en la URL de la pantalla. */
export type BalancePresetChoice = BalancePreset | 'custom';
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Rango a partir de la URL; lo que no sea válido vuelve a "Mes actual" (nunca una consulta rota). */
export function rangeFromParams(params: { preset?: string; from?: string; to?: string }, today: string): { preset: BalancePresetChoice; from: string; to: string; error?: string } {
  if (params.preset === 'custom' || (!params.preset && params.from && params.to)) {
    const from = DAY_RE.test(params.from ?? '') ? params.from! : today;
    const to = DAY_RE.test(params.to ?? '') ? params.to! : today;
    if (from > to) return { preset: 'custom', from, to, error: 'range_invalid' };
    if (to > today) return { preset: 'custom', from, to, error: 'range_future' };
    return { preset: 'custom', from, to };
  }
  const preset = (BALANCE_PRESETS as readonly string[]).includes(params.preset ?? '') ? (params.preset as BalancePreset) : 'this_month';
  return { preset, ...presetRange(preset, today) };
}

/* ---------- Gráficos ---------- */

/** Etiqueta corta de un grupo: "13 oct" (día o semana, por su primer día dentro del rango) u "oct 26" (mes). */
export function bucketLabel(bucket: { key: string; from: string }, grouping: BalanceGrouping, language: Language): string {
  const locale = language === 'en' ? 'en-US' : 'es-CO';
  const date = new Date(`${grouping === 'month' ? bucket.key : bucket.from}T00:00:00Z`);
  const options: Intl.DateTimeFormatOptions = grouping === 'month' ? { month: 'short', year: '2-digit', timeZone: 'UTC' } : { day: 'numeric', month: 'short', timeZone: 'UTC' };
  return new Intl.DateTimeFormat(locale, options).format(date).replace(/\./g, '').replace(/ de /g, ' ');
}

/** Monto compacto para los ejes: "$1,2 M", "$450 k", "−$80 k" (sin depender de `notation: 'compact'`, que no está en todos los motores). */
export function compactMoney(amount: number, language: Language): string {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? '−' : '';
  const fmt = (value: number) => new Intl.NumberFormat(language === 'en' ? 'en-US' : 'es-CO', { maximumFractionDigits: 1 }).format(value);
  if (abs >= 1_000_000) return `${sign}$${fmt(abs / 1_000_000)} M`;
  if (abs >= 1_000) return `${sign}$${fmt(Math.round(abs / 1_000))} k`;
  return `${sign}$${fmt(abs)}`;
}

/** Escala "redonda" del eje: incluye siempre el cero y termina en 1, 2 o 5 × 10ⁿ. */
export function niceScale(values: number[], ticks = 4): { min: number; max: number; step: number } {
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  if (lo === hi) return { min: 0, max: 1, step: 1 };
  const raw = (hi - lo) / ticks;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 5, 10].find((m) => m * magnitude >= raw) ?? 10) * magnitude;
  return { min: Math.floor(lo / step) * step, max: Math.ceil(hi / step) * step, step };
}

/** Porciones de la dona: cada una con su fracción del total y dónde empieza (0–1). */
export function donutSlices<T extends { amount: number }>(items: T[]): Array<T & { fraction: number; start: number }> {
  const total = items.reduce((sum, i) => sum + i.amount, 0);
  if (total <= 0) return [];
  let start = 0;
  return items.map((item) => {
    const fraction = item.amount / total;
    const slice = { ...item, fraction, start };
    start += fraction;
    return slice;
  });
}

/** Etiquetas del eje X sin amontonarse: como máximo `max` (siempre la primera y la última). */
export function labelIndexes(count: number, max = 7): Set<number> {
  if (count <= max) return new Set(Array.from({ length: count }, (_, i) => i));
  const step = (count - 1) / (max - 1);
  return new Set(Array.from({ length: max }, (_, i) => Math.round(i * step)));
}

/**
 * Arco SVG de un círculo de centro (c, c) y radio `r`, de `from` a `to` radianes medidos desde las 12 en punto en el
 * sentido del reloj (para trazarlo con `stroke`). Para el círculo completo usa un `<Circle>`: un arco no puede cerrarse.
 */
export function arcPath(c: number, r: number, from: number, to: number): string {
  const point = (angle: number) => [c + r * Math.sin(angle), c - r * Math.cos(angle)].map((v) => Math.round(v * 100) / 100).join(' ');
  const large = to - from > Math.PI ? 1 : 0;
  return `M ${point(from)} A ${r} ${r} 0 ${large} 1 ${point(to)}`;
}
