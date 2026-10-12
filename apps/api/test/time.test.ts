import { TZDate } from '@date-fns/tz';
import { describe, expect, it } from 'vitest';
import { addDays, zonedInstant } from '../src/booking/time';

/** Lo que calculaba zonedInstant antes de tener memoria (Fase 5): la referencia exacta. */
const reference = (date: string, minutes: number, timezone: string) => {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new TZDate(y, m - 1, d, Math.floor(minutes / 60), minutes % 60, 0, 0, timezone).getTime();
};

describe('zonedInstant con memoria', () => {
  it('da exactamente el mismo instante que TZDate, también en cambios de horario y zonas de media hora', () => {
    const zones = ['America/Bogota', 'America/New_York', 'Europe/Madrid', 'America/Santiago', 'Asia/Kolkata', 'Australia/Lord_Howe'];
    // Días alrededor de los cambios de horario de 2026 (EE. UU. 8 mar / 1 nov, Europa 29 mar / 25 oct, Chile abr / sep).
    const days = ['2026-03-08', '2026-03-29', '2026-04-05', '2026-09-06', '2026-10-04', '2026-10-25', '2026-11-01', '2026-12-31'];
    for (const zone of zones) {
      for (const day of days) {
        for (const date of [addDays(day, -1), day, addDays(day, 1)]) {
          for (let minutes = 0; minutes < 24 * 60; minutes += 15) {
            const expected = reference(date, minutes, zone);
            // Dos veces: la primera calcula, la segunda sale de la memoria; ambas deben coincidir.
            expect(zonedInstant(date, minutes, zone).getTime()).toBe(expected);
            expect(zonedInstant(date, minutes, zone).getTime()).toBe(expected);
          }
        }
      }
    }
  });

  it('cada llamada devuelve un Date nuevo (modificar uno no altera la memoria)', () => {
    const first = zonedInstant('2026-06-10', 9 * 60, 'America/Bogota');
    first.setTime(0);
    expect(zonedInstant('2026-06-10', 9 * 60, 'America/Bogota').toISOString()).toBe('2026-06-10T14:00:00.000Z');
  });

  it('una fecha inválida sigue lanzando el mismo error', () => {
    expect(() => zonedInstant('2026-13-99x', 0, 'America/Bogota')).toThrow(RangeError);
  });
});
