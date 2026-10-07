import { describe, expect, it } from 'vitest';
import { relativeTime } from '../src/lib/alerts';

/**
 * `relativeTime` no usa `Intl.RelativeTimeFormat` (Hermes, el motor de Android/iOS, no lo trae y tumbaba Inicio,
 * Mensajes y Notificaciones). Node sí lo trae: aquí sirve de referencia para exigir textos idénticos a los de antes.
 */
const NOW = Date.parse('2026-10-07T15:00:00Z');
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function reference(elapsedMs: number, language: 'es' | 'en'): string {
  const format = new Intl.RelativeTimeFormat(language, { numeric: 'auto' });
  const seconds = Math.max(0, Math.round(elapsedMs / 1000));
  if (seconds < 60) return format.format(0, 'second');
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return format.format(-minutes, 'minute');
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return format.format(-hours, 'hour');
  return format.format(-Math.floor(hours / 24), 'day');
}

const ELAPSED = [0, 5 * SECOND, 59 * SECOND, MINUTE, 90 * SECOND, 2 * MINUTE, 59 * MINUTE, HOUR, 2 * HOUR, 23 * HOUR, DAY, 2 * DAY, 3 * DAY, 30 * DAY, 400 * DAY];

describe('relativeTime (sin Intl.RelativeTimeFormat)', () => {
  it('no depende de Intl.RelativeTimeFormat (como en Hermes)', () => {
    const descriptor = Object.getOwnPropertyDescriptor(Intl, 'RelativeTimeFormat')!;
    // Se simula el motor de Android/iOS, que no lo trae.
    Reflect.deleteProperty(Intl, 'RelativeTimeFormat');
    try {
      expect('RelativeTimeFormat' in Intl).toBe(false);
      expect(relativeTime(NOW - 5 * MINUTE, NOW, 'es')).toBe('hace 5 minutos');
    } finally {
      Object.defineProperty(Intl, 'RelativeTimeFormat', descriptor);
    }
  });

  for (const language of ['es', 'en'] as const) {
    it(`da exactamente el mismo texto que Intl.RelativeTimeFormat en ${language}`, () => {
      for (const elapsed of ELAPSED) expect(relativeTime(NOW - elapsed, NOW, language), `${elapsed} ms`).toBe(reference(elapsed, language));
    });
  }

  it('usa singular, "ayer"/"anteayer" y nunca un tiempo futuro', () => {
    expect(relativeTime(NOW - MINUTE, NOW, 'es')).toBe('hace 1 minuto');
    expect(relativeTime(NOW - HOUR, NOW, 'en')).toBe('1 hour ago');
    expect(relativeTime(NOW - DAY, NOW, 'es')).toBe('ayer');
    expect(relativeTime(NOW - 2 * DAY, NOW, 'es')).toBe('anteayer');
    expect(relativeTime(NOW - 2 * DAY, NOW, 'en')).toBe('2 days ago');
    expect(relativeTime(NOW + HOUR, NOW, 'es')).toBe('ahora');
  });
});
