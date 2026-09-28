import { describe, expect, it } from 'vitest';
import { blocksForDate, blocksFromBusinessHours, computeSlots, gridMinutes, professionalState, type DayInput, type ProfessionalDay } from '../src/booking/slots';
import { addDays, isRealDate, localDate, localMinutes, toMinutes, toTime, weekdayOf, zonedInstant } from '../src/booking/time';

const TZ = 'America/Bogota'; // UTC-5, sin horario de verano
/** Martes 6 de octubre de 2026 (día de semana 2). */
const DATE = '2026-10-06';
/** "Ahora": lunes 5 de octubre, 08:00 en Bogotá. */
const NOW = zonedInstant('2026-10-05', toMinutes('08:00'), TZ);
const at = (time: string, date = DATE) => zonedInstant(date, toMinutes(time), TZ);
const range = (from: string, to: string, date = DATE) => ({ start: at(from, date), end: at(to, date) });

function pro(id: string, over: Partial<ProfessionalDay> = {}): ProfessionalDay {
  return { id, blocks: null, timeOff: [], busy: [], ...over };
}

function day(over: Partial<DayInput> = {}): DayInput {
  return {
    timezone: TZ,
    date: DATE,
    now: NOW,
    intervalMinutes: 30,
    minNoticeMinutes: 60,
    lastBookableDate: '2026-12-31',
    serviceMinutes: 30,
    cleanupMinutes: 0,
    businessBlocks: [{ from: toMinutes('09:00'), to: toMinutes('12:00') }],
    closed: false,
    professionals: [pro('ana')],
    ...over,
  };
}

const states = (input: DayInput) => Object.fromEntries(computeSlots(input).map((s) => [s.time, s.state]));

describe('ayudas de tiempo', () => {
  it('convierte horas y calcula el día de la semana sin depender de la zona horaria', () => {
    expect(toMinutes('09:30')).toBe(570);
    expect(toTime(570)).toBe('09:30');
    expect(weekdayOf('2026-10-06')).toBe(2);
    expect(weekdayOf('2026-10-04')).toBe(0);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(isRealDate('2026-02-30')).toBe(false);
    expect(isRealDate('2028-02-29')).toBe(true);
  });

  it('convierte a UTC según la zona del negocio: 09:00 en Bogotá es 14:00Z', () => {
    expect(zonedInstant(DATE, 540, TZ).toISOString()).toBe('2026-10-06T14:00:00.000Z');
    expect(localDate(new Date('2026-10-07T03:30:00Z'), TZ)).toBe('2026-10-06'); // 22:30 del 6 en Bogotá
    expect(localMinutes(new Date('2026-10-07T03:30:00Z'), TZ)).toBe(22 * 60 + 30);
  });

  it('respeta el horario de verano de otras zonas (Nueva York, cambio del 8 de marzo de 2026)', () => {
    expect(zonedInstant('2026-03-07', 540, 'America/New_York').toISOString()).toBe('2026-03-07T14:00:00.000Z'); // UTC-5
    expect(zonedInstant('2026-03-09', 540, 'America/New_York').toISOString()).toBe('2026-03-09T13:00:00.000Z'); // UTC-4
  });
});

describe('cuadrícula', () => {
  it('arranca en cada bloque del negocio y avanza por el intervalo', () => {
    expect(gridMinutes([{ from: 540, to: 660 }], 30)).toEqual([540, 570, 600, 630]);
    expect(gridMinutes([{ from: 540, to: 600 }, { from: 780, to: 840 }], 30)).toEqual([540, 570, 780, 810]);
    expect(gridMinutes([{ from: 545, to: 600 }], 30)).toEqual([545, 575]);
    expect(gridMinutes([], 30)).toEqual([]);
  });

  it('el horario histórico del negocio (un tramo por día) se convierte a bloques', () => {
    const weekly = blocksFromBusinessHours({ days: [{ day: 0, open: false, from: '09:00', to: '19:00' }, { day: 2, open: true, from: '09:00', to: '19:00' }] });
    expect(blocksForDate(weekly, DATE)).toEqual([{ from: 540, to: 1140 }]);
    expect(blocksForDate(weekly, '2026-10-04')).toEqual([]); // domingo cerrado
  });
});

describe('estados de cada horario', () => {
  it('sin nada que lo impida todos los horarios que caben están libres; el último que no cabe no se ofrece como libre', () => {
    const result = states(day({ serviceMinutes: 60 }));
    expect(result).toEqual({ '09:00': 'available', '09:30': 'available', '10:00': 'available', '10:30': 'available', '11:00': 'available', '11:30': 'unavailable' });
  });

  it('un día cerrado o sin bloques no ofrece nada libre', () => {
    expect(Object.values(states(day({ closed: true }))).every((s) => s === 'unavailable')).toBe(true);
    expect(computeSlots(day({ businessBlocks: [] }))).toEqual([]);
  });

  it('las horas pasadas y las que no cumplen la anticipación mínima no están disponibles', () => {
    const today = day({ date: '2026-10-05', now: at('10:10', '2026-10-05'), minNoticeMinutes: 60 });
    const result = states(today);
    expect(result['09:00']).toBe('unavailable'); // pasada
    expect(result['10:30']).toBe('unavailable'); // faltan 20 min: menos de la anticipación
    expect(result['11:00']).toBe('unavailable'); // 50 min: todavía menos de la anticipación
    expect(result['11:30']).toBe('available'); // 80 min: cumple
  });

  it('la anticipación se mide contra el inicio del horario (exactamente 60 min sí se permite)', () => {
    const input = day({ date: '2026-10-05', now: at('10:00', '2026-10-05'), minNoticeMinutes: 60, businessBlocks: [{ from: 540, to: 720 }] });
    expect(states(input)).toMatchObject({ '10:30': 'unavailable', '11:00': 'available', '11:30': 'available' });
  });

  it('más allá del máximo de días a futuro no hay disponibilidad, salvo para el personal', () => {
    const far = day({ lastBookableDate: '2026-10-05' });
    expect(Object.values(states(far)).every((s) => s === 'unavailable')).toBe(true);
    expect(states({ ...far, ignoreNoticeAndHorizon: true })['09:00']).toBe('available');
  });

  it('el personal puede agendar dentro de la anticipación mínima, pero nunca en el pasado', () => {
    const input = day({ date: '2026-10-05', now: at('10:10', '2026-10-05'), ignoreNoticeAndHorizon: true, businessBlocks: [{ from: 540, to: 720 }] });
    expect(states(input)).toMatchObject({ '10:00': 'unavailable', '10:30': 'available' });
  });

  it('una cita existente deja ese horario "ocupado"; el horario justo antes, si el servicio no cabe, es "no disponible"', () => {
    const input = day({ serviceMinutes: 60, professionals: [pro('ana', { busy: [range('10:00', '11:00')] })] });
    expect(states(input)).toMatchObject({
      '09:00': 'available', // 09:00–10:00 termina justo cuando empieza la otra: adyacente, permitido
      '09:30': 'unavailable', // empezaría libre pero choca con la cita de las 10:00
      '10:00': 'booked',
      '10:30': 'booked',
      '11:00': 'available',
    });
  });

  it('el tiempo de limpieza también ocupa: una cita a las 09:00 de 30 min + 15 de limpieza bloquea hasta 09:45', () => {
    const input = day({ intervalMinutes: 15, professionals: [pro('ana', { busy: [range('09:00', '09:45')] })], businessBlocks: [{ from: 540, to: 660 }] });
    const result = states(input);
    expect(result['09:00']).toBe('booked');
    expect(result['09:30']).toBe('booked');
    expect(result['09:45']).toBe('available');
  });

  it('la limpieza del servicio propio puede pasarse del cierre, pero el servicio no', () => {
    const input = day({ businessBlocks: [{ from: 540, to: 600 }], serviceMinutes: 30, cleanupMinutes: 20, intervalMinutes: 30 });
    expect(states(input)).toEqual({ '09:00': 'available', '09:30': 'available' });
    expect(states({ ...input, serviceMinutes: 45 })).toEqual({ '09:00': 'available', '09:30': 'unavailable' });
  });

  it('un descanso (hueco entre dos bloques del profesional) y las ausencias no se pueden reservar', () => {
    const withBreak = day({
      businessBlocks: [{ from: 540, to: 780 }],
      professionals: [pro('ana', { blocks: [{ from: 540, to: 600 }, { from: 660, to: 780 }] })],
    });
    expect(states(withBreak)).toMatchObject({ '09:00': 'available', '09:30': 'available', '10:00': 'unavailable', '10:30': 'unavailable', '11:00': 'available' });

    const away = day({ professionals: [pro('ana', { timeOff: [range('09:30', '10:30')] })] });
    expect(states(away)).toMatchObject({ '09:00': 'available', '09:30': 'unavailable', '10:00': 'unavailable', '10:30': 'available' });
  });

  it('el horario del profesional se limita al del negocio (no atiende fuera de la hora de apertura)', () => {
    const input = day({ professionals: [pro('ana', { blocks: [{ from: 480, to: 1080 }] })] }); // 08:00–18:00 pero el negocio abre 09:00–12:00
    expect(states(input)).toEqual({ '09:00': 'available', '09:30': 'available', '10:00': 'available', '10:30': 'available', '11:00': 'available', '11:30': 'available' });
    const late = day({ professionals: [pro('ana', { blocks: [{ from: 630, to: 1080 }] })] }); // empieza 10:30
    expect(states(late)).toMatchObject({ '10:00': 'unavailable', '10:30': 'available' });
  });
});

describe('varios profesionales ("Primero disponible")', () => {
  const two = (busyAna: ProfessionalDay['busy'], busyLuis: ProfessionalDay['busy'], extra: Partial<DayInput> = {}) =>
    computeSlots(day({ professionals: [pro('ana', { busy: busyAna }), pro('luis', { busy: busyLuis })], ...extra }));

  it('es libre si alguno está libre, y dice quién', () => {
    const slots = two([range('09:00', '09:30')], []);
    expect(slots[0]).toMatchObject({ time: '09:00', state: 'available', availableProfessionalIds: ['luis'] });
    expect(slots[1]!.availableProfessionalIds).toEqual(['ana', 'luis']);
  });

  it('es "ocupado" solo si TODOS los aptos están ocupados', () => {
    const slots = two([range('09:00', '09:30')], [range('09:00', '09:30')]);
    expect(slots[0]).toMatchObject({ state: 'booked', availableProfessionalIds: [] });
  });

  it('si uno está ocupado y otro no trabaja ese rato, el horario sigue siendo "ocupado" (no se inventa un hueco)', () => {
    const slots = computeSlots(day({ professionals: [pro('ana', { busy: [range('09:00', '09:30')] }), pro('luis', { blocks: [{ from: 600, to: 720 }] })] }));
    expect(slots[0]!.state).toBe('booked');
  });

  it('sin profesionales aptos no hay nada libre', () => {
    expect(computeSlots(day({ professionals: [] })).every((s) => s.state === 'unavailable')).toBe(true);
  });

  it('professionalState nunca marca libre un horario en el que el profesional tiene una cita', () => {
    const p = pro('ana', { busy: [range('09:00', '10:00')] });
    const input = day({ professionals: [p] });
    for (const minutes of [540, 570]) expect(professionalState(input, p, minutes)).toBe('booked');
  });
});
