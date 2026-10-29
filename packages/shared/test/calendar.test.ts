import { describe, expect, it } from 'vitest';
import { buildIcs, icsFold, icsInstant, icsText, icsUid, utf8Length } from '../src/calendar';

const NOW = new Date('2026-09-28T12:00:00.000Z');
const event = { uid: 'derek-20260930T140000Z@xirostyle', title: 'Corte de cabello — Xiro Beauty Studio', startsAt: '2026-09-30T14:00:00.000Z', endsAt: '2026-09-30T15:00:00.000Z', now: NOW };

describe('icsInstant', () => {
  it('formatea en UTC con Z', () => {
    expect(icsInstant('2026-09-30T14:00:00.000Z')).toBe('20260930T140000Z');
    expect(icsInstant(new Date(Date.UTC(2027, 0, 5, 3, 4, 5)))).toBe('20270105T030405Z');
  });
  it('una fecha inválida falla en vez de generar un archivo roto', () => {
    expect(() => icsInstant('no es una fecha')).toThrow(RangeError);
  });
});

describe('icsText', () => {
  it('escapa barra, punto y coma, coma y saltos de línea', () => {
    expect(icsText('a\\b; c, d\nx\r\ny')).toBe('a\\\\b\\; c\\, d\\nx\\ny');
  });
  it('quita caracteres de control (no pueden partir el archivo ni colar otra línea)', () => {
    expect(icsText('hola\u0000\u0007 mundo')).toBe('hola mundo');
    expect(icsText('x\r\nBEGIN:VEVENT')).toBe('x\\nBEGIN:VEVENT'); // un salto de línea nunca inicia una línea nueva del archivo
  });
});

describe('icsFold', () => {
  it('no toca las líneas cortas', () => {
    expect(icsFold('SUMMARY:Corte')).toBe('SUMMARY:Corte');
  });
  it('parte las largas a 75 octetos con continuación que empieza con un espacio', () => {
    const folded = icsFold(`DESCRIPTION:${'a'.repeat(200)}`);
    const lines = folded.split('\r\n');
    expect(lines.length).toBeGreaterThan(2);
    expect(lines[0]).toHaveLength(75);
    for (const line of lines.slice(1)) {
      expect(line.startsWith(' ')).toBe(true);
      expect(line.length).toBeLessThanOrEqual(75);
    }
    expect(lines.join('').replace(/ /g, '')).toBe(`DESCRIPTION:${'a'.repeat(200)}`); // no se pierde nada
  });
  it('cuenta octetos, no letras: no parte un carácter con tilde ni un emoji por la mitad', () => {
    const line = `SUMMARY:${'ñ'.repeat(60)}💈${'é'.repeat(40)}`;
    for (const part of icsFold(line).split('\r\n')) expect(utf8Length(part)).toBeLessThanOrEqual(75);
    expect(icsFold(line).replace(/\r\n /g, '')).toBe(line);
  });
});

describe('buildIcs', () => {
  it('arma un evento completo con final de línea CRLF', () => {
    const ics = buildIcs({ ...event, description: 'Con Ana.\nLlega 5 minutos antes.', location: 'Cra. 7 #71-21, Bogotá', url: 'https://x.co/reservar/derek/gestion/abc' });
    expect(ics.endsWith('\r\n')).toBe(true);
    expect(ics.split('\r\n')).toEqual([
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Xiro Style//Reservas//ES',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      'UID:derek-20260930T140000Z@xirostyle',
      'DTSTAMP:20260928T120000Z',
      'CREATED:20260928T120000Z',
      'LAST-MODIFIED:20260928T120000Z',
      'SEQUENCE:0',
      'DTSTART:20260930T140000Z',
      'DTEND:20260930T150000Z',
      'SUMMARY:Corte de cabello — Xiro Beauty Studio',
      'DESCRIPTION:Con Ana.\\nLlega 5 minutos antes.',
      'LOCATION:Cra. 7 #71-21\\, Bogotá',
      'URL:https://x.co/reservar/derek/gestion/abc',
      'STATUS:CONFIRMED',
      'TRANSP:OPAQUE',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'DESCRIPTION:Corte de cabello — Xiro Beauty Studio',
      'TRIGGER:-PT60M',
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR',
      '',
    ]);
  });

  it('sin aviso ni datos opcionales, el evento queda mínimo', () => {
    const ics = buildIcs({ ...event, reminderMinutes: 0 });
    expect(ics).not.toContain('VALARM');
    expect(ics).not.toContain('LOCATION');
    expect(ics).not.toContain('URL');
  });

  it('cumple RFC 5545 para Outlook y Google: CRLF sin LF sueltos, líneas ≤ 75 octetos, propiedades obligatorias, fin > inicio', () => {
    const long = 'Corte, color y tratamiento; con "Ana María" — llega 10 min antes.\n'.repeat(8);
    const ics = buildIcs({ ...event, uid: 'mi-negocio-2026-09-30T14:00:00.000Z', title: `💇 ${long.slice(0, 120)}`, description: long, location: 'Cra. 7 #71-21, Bogotá', url: 'https://x.co/reservar/mi negocio' });
    expect(/\r(?!\n)|(?<!\r)\n/.test(ics)).toBe(false);
    const physical = ics.split('\r\n').slice(0, -1);
    for (const line of physical) expect(utf8Length(line), line).toBeLessThanOrEqual(75);
    // Desplegar (§3.1) devuelve las líneas lógicas; ninguna secuencia escapada quedó partida.
    const logical = ics.replace(/\r\n /g, '').split('\r\n');
    for (const name of ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:', 'BEGIN:VEVENT', 'UID:', 'DTSTAMP:', 'DTSTART:', 'DTEND:', 'END:VEVENT', 'END:VCALENDAR']) expect(logical.some((l) => l.startsWith(name)), name).toBe(true);
    for (const part of physical) expect(/(^|[^\\])(\\\\)*\\$/.test(part), `escape partido: ${part}`).toBe(false);
    expect(logical.find((l) => l.startsWith('UID:'))).toBe('UID:mi-negocio-2026-09-30T14-00-00.000Z@xirostyle');
    expect(logical.find((l) => l.startsWith('URL:'))).toBe('URL:https://x.co/reservar/mi%20negocio');
    // Un fin igual al inicio se corrige (los calendarios rechazan eventos de duración cero o negativa).
    const zero = buildIcs({ ...event, endsAt: event.startsAt }).replace(/\r\n /g, '');
    expect(zero).toContain('DTSTART:20260930T140000Z');
    expect(zero).toContain('DTEND:20260930T140100Z');
  });

  it('icsUid: estable, sin caracteres problemáticos, siempre con dominio', () => {
    expect(icsUid('derek-20260930T140000Z@xirostyle')).toBe('derek-20260930T140000Z@xirostyle');
    expect(icsUid('a b:c/d')).toBe('a-b-c-d@xirostyle');
    expect(icsUid('a b:c/d')).toBe(icsUid('a b:c/d'));
  });

  it('el título de un negocio con comas o saltos de línea no puede inyectar líneas', () => {
    const ics = buildIcs({ ...event, title: 'Local, "Uno"\r\nEND:VEVENT\r\nBEGIN:VEVENT' });
    expect(ics.split('\r\n').filter((l) => l === 'END:VEVENT')).toHaveLength(1);
    expect(ics.split('\r\n').filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(1);
  });
});
