import { describe, expect, it } from 'vitest';
import { blocksFromHours, blocksOfDay, blocksProblem, copyDay, nextBlock, publicPageUrl, setDayBlocks, setupSteps, slugProblem, suggestSlug, timeOffRange, whatsappShareUrl } from '../src/lib/bookingPage';

describe('enlace y dirección de la página', () => {
  it('arma la dirección pública y el enlace de WhatsApp para compartir', () => {
    expect(publicPageUrl('mi-barberia', 'https://xiro.app/')).toBe('https://xiro.app/reservar/mi-barberia');
    expect(whatsappShareUrl('Reserva aquí: https://x.co/a b')).toBe('https://wa.me/?text=Reserva%20aqu%C3%AD%3A%20https%3A%2F%2Fx.co%2Fa%20b');
  });

  it('valida la dirección con las mismas reglas del servidor', () => {
    expect(slugProblem('mi-barberia')).toBeNull();
    expect(slugProblem('ab')).toBe('slug_invalid');
    expect(slugProblem('MiBarberia')).toBeNull(); // las mayúsculas se normalizan a minúsculas
  });

  it('rechaza espacios, guiones dobles y palabras reservadas', () => {
    expect(slugProblem('con espacios')).toBe('slug_invalid');
    expect(slugProblem('doble--guion')).toBe('slug_invalid');
    expect(slugProblem('-empieza')).toBe('slug_invalid');
    expect(slugProblem('admin')).toBe('slug_reserved');
    expect(slugProblem('reservar')).toBe('slug_reserved');
  });

  it('propone una dirección a partir del nombre', () => {
    expect(suggestSlug('Barbería Don Pepe')).toBe('barberia-don-pepe');
    expect(suggestSlug('  ¡¡Ñandú & Co.!!  ')).toBe('nandu-co');
    expect(suggestSlug('x'.repeat(60))).toHaveLength(40);
  });
});

describe('horario semanal por bloques', () => {
  const week = [
    { weekday: 1, from: '09:00', to: '12:00' },
    { weekday: 1, from: '14:00', to: '18:00' },
    { weekday: 2, from: '10:00', to: '16:00' },
  ];

  it('separa y reemplaza los bloques de un día', () => {
    expect(blocksOfDay(week, 1)).toHaveLength(2);
    const next = setDayBlocks(week, 1, [{ weekday: 1, from: '08:00', to: '09:00' }]);
    expect(blocksOfDay(next, 1)).toEqual([{ weekday: 1, from: '08:00', to: '09:00' }]);
    expect(blocksOfDay(next, 2)).toHaveLength(1);
  });

  it('propone el siguiente bloque tras el último del día', () => {
    expect(nextBlock([], 3)).toEqual({ weekday: 3, from: '09:00', to: '13:00' });
    expect(nextBlock(week, 1)).toEqual({ weekday: 1, from: '18:00', to: '22:00' });
    expect(nextBlock([{ weekday: 1, from: '20:00', to: '23:00' }], 1)).toEqual({ weekday: 1, from: '23:00', to: '23:59' });
  });

  it('detecta cierres antes de la apertura y bloques que se cruzan', () => {
    expect(blocksProblem(week)).toBeNull();
    expect(blocksProblem([{ weekday: 1, from: '10:00', to: '10:00' }])).toBe('hours_close_after_open');
    expect(blocksProblem([{ weekday: 1, from: '09:00', to: '12:00' }, { weekday: 1, from: '11:00', to: '13:00' }])).toBe('hours_close_after_open');
    expect(blocksProblem([{ weekday: 1, from: '09:00', to: '12:00' }, { weekday: 2, from: '11:00', to: '13:00' }])).toBeNull(); // otro día: no se cruzan
  });

  it('parte del horario del negocio y copia un día a otros', () => {
    const fromHours = blocksFromHours({ sameEveryDay: false, days: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, open: day !== 0, from: '09:00', to: '19:00' })) });
    expect(fromHours).toHaveLength(6);
    expect(fromHours.some((b) => b.weekday === 0)).toBe(false);
    const copied = copyDay(week, 1, [1, 3, 4]);
    expect(blocksOfDay(copied, 3).map((b) => [b.from, b.to])).toEqual([['09:00', '12:00'], ['14:00', '18:00']]);
    expect(blocksOfDay(copied, 2)).toHaveLength(1);
  });
});

describe('ausencias', () => {
  const TZ = 'America/Bogota';
  it('todo el día: de la medianoche local del primer día a la del día siguiente al último', () => {
    expect(timeOffRange({ date: '2026-10-06', allDay: true, days: 2, from: '09:00', to: '10:00' }, TZ)).toEqual({ startsAt: '2026-10-06T05:00:00.000Z', endsAt: '2026-10-08T05:00:00.000Z' });
  });

  it('por horas, en la zona del negocio', () => {
    expect(timeOffRange({ date: '2026-10-06', allDay: false, days: 1, from: '09:00', to: '12:30' }, TZ)).toEqual({ startsAt: '2026-10-06T14:00:00.000Z', endsAt: '2026-10-06T17:30:00.000Z' });
  });

  it('valida el formulario', () => {
    expect(timeOffRange({ date: '2026-10-06', allDay: false, days: 1, from: '12:00', to: '09:00' }, TZ)).toEqual({ error: 'hours_close_after_open' });
    expect(timeOffRange({ date: '2026-10-06', allDay: false, days: 1, from: '9', to: '12:00' }, TZ)).toEqual({ error: 'time_invalid' });
    expect(timeOffRange({ date: '2026-10-06', allDay: true, days: 0, from: '', to: '' }, TZ)).toEqual({ error: 'timeoff_err_days' });
  });
});

describe('checklist para poder recibir reservas', () => {
  const ready = { published: true, bookableServices: 2, bookableProfessionals: 1, openDays: 6, ready: true };
  it('todo en regla: los cuatro pasos hechos', () => {
    expect(setupSteps(ready).every((s) => s.done)).toBe(true);
  });
  it('un negocio con solo un producto (el caso de "derek"): faltan el servicio y, si aplica, quien atienda', () => {
    const steps = setupSteps({ published: true, bookableServices: 0, bookableProfessionals: 0, openDays: 6, ready: false });
    expect(steps.filter((s) => !s.done).map((s) => s.id)).toEqual(['services', 'professionals']);
  });
  it('sin publicar o sin días abiertos se señala solo ese paso, y el orden es el recomendado', () => {
    expect(setupSteps({ ...ready, published: false, ready: false }).filter((s) => !s.done).map((s) => s.id)).toEqual(['published']);
    expect(setupSteps({ ...ready, openDays: 0, ready: false }).filter((s) => !s.done).map((s) => s.id)).toEqual(['hours']);
    expect(setupSteps(ready).map((s) => s.id)).toEqual(['services', 'professionals', 'hours', 'published']);
  });
});
