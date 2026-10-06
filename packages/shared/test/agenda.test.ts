import { describe, expect, it } from 'vitest';
import type { AppointmentDto } from '../src/booking';
import { actionStatus, addDays, addMonths, availableActions, canReschedule, dayRange, dayTotals, formatClock, formatDay, groupByDay, isRealDate, localDate, localTime, monthGrid, startOfWeek, summarizeItems, upcoming, weekdayOf, weekDates, zonedInstant } from '../src/agenda';

const TZ = 'America/Bogota';

const appt = (over: Partial<AppointmentDto> & { id: string; startsAt: string }): AppointmentDto => ({
  status: 'confirmed',
  source: 'web',
  endsAt: new Date(new Date(over.startsAt).getTime() + 3_600_000).toISOString(),
  durationMinutes: 60,
  totalPrice: 30000,
  customerNotes: '',
  internalNotes: '',
  modificationCount: 0,
  createdAt: '2026-10-01T00:00:00.000Z',
  professional: { id: 'p1', name: 'Ana' },
  client: { id: 'c1', name: 'Cliente', phone: null, email: null },
  items: [],
  ...over,
});

describe('fechas en la zona horaria del negocio', () => {
  it('interpreta una hora local como instante UTC y viceversa (Bogotá es UTC-5 todo el año)', () => {
    expect(zonedInstant('2026-10-06', '09:00', TZ).toISOString()).toBe('2026-10-06T14:00:00.000Z');
    expect(localDate('2026-10-07T03:30:00Z', TZ)).toBe('2026-10-06'); // 22:30 del 6
    expect(localTime('2026-10-07T03:30:00Z', TZ)).toBe('22:30');
  });

  it('respeta el horario de verano de otras zonas', () => {
    expect(zonedInstant('2026-03-07', '09:00', 'America/New_York').toISOString()).toBe('2026-03-07T14:00:00.000Z'); // UTC-5
    expect(zonedInstant('2026-03-09', '09:00', 'America/New_York').toISOString()).toBe('2026-03-09T13:00:00.000Z'); // UTC-4
    expect(localTime('2026-03-09T13:00:00Z', 'America/New_York')).toBe('09:00');
  });

  it('un día local completo va de medianoche a medianoche del negocio', () => {
    expect(dayRange('2026-10-06', TZ)).toEqual({ from: '2026-10-06T05:00:00.000Z', to: '2026-10-07T05:00:00.000Z' });
    expect(dayRange('2026-10-05', TZ, 7).to).toBe('2026-10-12T05:00:00.000Z');
  });

  it('suma días, calcula el día de la semana y la semana de lunes a domingo', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(weekdayOf('2026-10-04')).toBe(0);
    expect(startOfWeek('2026-10-04')).toBe('2026-09-28'); // domingo → lunes anterior
    expect(startOfWeek('2026-10-06')).toBe('2026-10-05');
    expect(weekDates('2026-10-07')).toEqual(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']);
    expect(isRealDate('2026-02-30')).toBe(false);
    expect(isRealDate('2028-02-29')).toBe(true);
  });

  it('da formato legible en español e inglés', () => {
    expect(formatDay('2026-10-05', 'es')).toMatch(/lunes/i);
    expect(formatDay('2026-10-05', 'en')).toMatch(/Monday/);
    expect(formatClock('14:30', 'en')).toMatch(/2:30\s?PM/i);
    expect(formatClock('09:05', 'es')).toMatch(/9:05/);
  });
});

describe('acciones y resúmenes de citas', () => {
  const now = new Date('2026-10-06T15:00:00Z');
  it('cada estado ofrece solo las transiciones válidas; "no asistió" solo cuando ya pasó la hora', () => {
    expect(availableActions('pending', '2026-10-06T16:00:00Z', now)).toEqual(['confirm', 'cancel']);
    expect(availableActions('confirmed', '2026-10-06T16:00:00Z', now)).toEqual(['start', 'complete', 'cancel']);
    expect(availableActions('confirmed', '2026-10-06T14:00:00Z', now)).toEqual(['start', 'complete', 'no_show', 'cancel']);
    expect(availableActions('in_progress', '2026-10-06T14:00:00Z', now)).toEqual(['complete', 'cancel']);
    for (const done of ['completed', 'cancelled', 'no_show'] as const) expect(availableActions(done, '2026-10-06T14:00:00Z', now)).toEqual([]);
    expect(actionStatus('start')).toBe('in_progress');
    expect(canReschedule('pending')).toBe(true);
    expect(canReschedule('in_progress')).toBe(false);
  });

  it('resume lo reservado y los totales del día', () => {
    expect(summarizeItems([{ name: 'Corte', quantity: 1 }])).toBe('Corte');
    expect(summarizeItems([{ name: 'Corte', quantity: 1 }, { name: 'Barba', quantity: 1 }, { name: 'Cera', quantity: 2 }])).toBe('Corte, Barba +1');
    const totals = dayTotals([appt({ id: '1', startsAt: '2026-10-06T14:00:00Z', status: 'completed', totalPrice: 40000 }), appt({ id: '2', startsAt: '2026-10-06T16:00:00Z', status: 'pending' }), appt({ id: '3', startsAt: '2026-10-06T18:00:00Z' }), appt({ id: '4', startsAt: '2026-10-06T19:00:00Z', status: 'cancelled' }), appt({ id: '5', startsAt: '2026-10-06T20:00:00Z', status: 'no_show' })]);
    expect(totals).toEqual({ total: 5, active: 2, pending: 1, completed: 1, cancelled: 2, earned: 40000, expected: 60000 });
  });

  it('agrupa por día local del negocio y arma la lista de próximas', () => {
    const late = appt({ id: 'a', startsAt: '2026-10-07T03:30:00Z' }); // 22:30 del día 6 en Bogotá
    const next = appt({ id: 'b', startsAt: '2026-10-07T15:00:00Z' });
    expect([...groupByDay([next, late], TZ).keys()]).toEqual(['2026-10-06', '2026-10-07']);
    const list = upcoming([next, late, appt({ id: 'c', startsAt: '2026-10-06T16:00:00Z', status: 'cancelled' }), appt({ id: 'd', startsAt: '2026-10-05T10:00:00Z' })], now, 5);
    expect(list.map((a) => a.id)).toEqual(['a', 'b']);
  });
});

describe('calendario mensual', () => {
  it('cubre el mes con semanas completas de lunes a domingo', () => {
    const weeks = monthGrid('2026-10-15');
    expect(weeks[0]![0]).toBe('2026-09-28');
    expect(weeks.at(-1)!.at(-1)).toBe('2026-11-01');
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks.flat()).toContain('2026-10-31');
    // Febrero de 2026 empieza en domingo: la primera fila arranca el lunes 26 de enero y son 5 semanas.
    expect(monthGrid('2026-02-10')).toHaveLength(5);
    expect(monthGrid('2026-02-10')[0]![0]).toBe('2026-01-26');
  });

  it('cambia de mes sin desbordar', () => {
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-01');
    expect(addMonths('2026-01-31', -1)).toBe('2025-12-01');
  });
});
