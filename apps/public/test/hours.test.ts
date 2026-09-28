import { describe, expect, it } from 'vitest';
import { hoursRows, statusText, weekdayName } from '../src/lib/hours';

const TZ = 'America/Bogota'; // UTC-5, sin horario de verano
const status = (open: boolean, changesAt: string | null) => ({ openStatus: { open, changesAt }, timezone: TZ });

describe('statusText', () => {
  it('abierto: a qué hora cierra (en la hora del negocio, no la del navegador)', () => {
    expect(statusText(status(true, '2026-10-01T00:00:00.000Z'), 'es', new Date('2026-09-30T15:00:00Z'))).toBe('Abierto · cierra a las 7:00 p.\u00a0m.');
    expect(statusText(status(true, '2026-10-01T00:00:00.000Z'), 'en', new Date('2026-09-30T15:00:00Z'))).toBe('Open · closes at 7:00 PM');
  });

  it('cerrado: abre hoy, mañana o el día de la semana que toque', () => {
    const now = new Date('2026-09-30T12:00:00Z'); // miércoles 07:00 en Bogotá
    expect(statusText(status(false, '2026-09-30T14:00:00.000Z'), 'es', now)).toBe('Cerrado · abre hoy a las 9:00 a.\u00a0m.');
    expect(statusText(status(false, '2026-10-01T14:00:00.000Z'), 'es', now)).toBe('Cerrado · abre mañana a las 9:00 a.\u00a0m.');
    expect(statusText(status(false, '2026-10-05T14:00:00.000Z'), 'es', now)).toBe('Cerrado · abre lunes a las 9:00 a.\u00a0m.');
  });

  it('"hoy" y "mañana" son del negocio: a las 11 p.\u00a0m. en Bogotá ya es "mañana" en UTC pero sigue siendo hoy allá', () => {
    const now = new Date('2026-09-30T04:00:00Z'); // martes 29 sep 23:00 en Bogotá (ya es miércoles en UTC)
    expect(statusText(status(false, '2026-09-30T14:00:00.000Z'), 'es', now)).toBe('Cerrado · abre mañana a las 9:00 a.\u00a0m.');
  });

  it('sin próxima apertura, solo "Cerrado"', () => {
    expect(statusText(status(false, null), 'es')).toBe('Cerrado');
  });
});

describe('weekdayName / hoursRows', () => {
  it('nombres de día en cada idioma', () => {
    expect(weekdayName(0, 'es')).toBe('Domingo');
    expect(weekdayName(3, 'es')).toBe('Miércoles');
    expect(weekdayName(1, 'en')).toBe('Monday');
  });

  const hours = [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, from: '09:00', to: '19:00' }));

  it('siete filas de lunes a domingo, con el domingo cerrado y el día de hoy marcado', () => {
    const rows = hoursRows(hours, 'es', TZ, new Date('2026-09-30T15:00:00Z')); // miércoles
    expect(rows.map((r) => r.label)).toEqual(['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']);
    expect(rows.filter((r) => r.today).map((r) => r.label)).toEqual(['Miércoles']);
    expect(rows[0]).toMatchObject({ text: '9:00 a.\u00a0m. – 7:00 p.\u00a0m.', closed: false });
    expect(rows[6]).toMatchObject({ text: 'Cerrado', closed: true });
  });

  it('horario partido en dos bloques', () => {
    const split = [
      { weekday: 2, from: '14:00', to: '19:00' },
      { weekday: 2, from: '09:00', to: '12:00' },
    ];
    expect(hoursRows(split, 'es', TZ, new Date('2026-09-30T15:00:00Z'))[1]!.text).toBe('9:00 a.\u00a0m. – 12:00 p.\u00a0m. · 2:00 p.\u00a0m. – 7:00 p.\u00a0m.');
  });

  it('el "hoy" sigue la zona del negocio: a las 11 p.\u00a0m. del martes en Bogotá todavía es martes', () => {
    const rows = hoursRows(hours, 'es', TZ, new Date('2026-09-30T04:00:00Z'));
    expect(rows.find((r) => r.today)!.label).toBe('Martes');
  });
});
