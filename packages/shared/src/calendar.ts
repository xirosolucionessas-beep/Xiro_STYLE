/**
 * Archivo de calendario (.ics, RFC 5545) para "Agregar a mi calendario". Puro y sin dependencias: la página pública lo arma en
 * el navegador con los datos de SU cita (nada sale del dispositivo). Las horas van en UTC ("Z"): cada app de calendario las
 * muestra en la zona horaria de quien las abre, sin confundir la del servidor con la del negocio.
 */

export interface IcsEvent {
  /** Identificador estable del evento: volver a importar la misma cita la actualiza en vez de duplicarla. */
  uid: string;
  title: string;
  description?: string;
  location?: string;
  startsAt: Date | string;
  endsAt: Date | string;
  /** Dirección de la cita/gestión, si se quiere en el evento. */
  url?: string;
  /** Aviso antes del inicio, en minutos (0 = sin aviso). Por defecto 60. */
  reminderMinutes?: number;
  /** Instante de creación (`DTSTAMP`); por defecto ahora. Se recibe para poder probar salidas exactas. */
  now?: Date;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 2026-09-30T14:00:00.000Z → 20260930T140000Z */
export function icsInstant(value: Date | string): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) throw new RangeError('fecha inválida para el calendario');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

/** Escapa un valor de texto: \ ; , y saltos de línea (RFC 5545 §3.3.11). Quita también caracteres de control. */
export function icsText(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/** Octetos que ocupa un texto en UTF-8 (sin depender de TextEncoder, que este paquete no tipa). */
export function utf8Length(text: string): number {
  let total = 0;
  for (const char of text) {
    const code = char.codePointAt(0)!;
    total += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return total;
}

/** Cada línea mide como máximo 75 octetos; el resto continúa en la siguiente, que empieza con un espacio (§3.1). */
export function icsFold(line: string): string {
  if (utf8Length(line) <= 75) return line;
  const parts: string[] = [];
  let current = '';
  let size = 0;
  let limit = 75;
  for (const char of line) {
    const bytes = utf8Length(char);
    if (size + bytes > limit) {
      parts.push(current);
      current = '';
      size = 0;
      limit = 74; // el espacio inicial de las continuaciones cuenta
    }
    current += char;
    size += bytes;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

export function buildIcs(event: IcsEvent): string {
  const reminder = event.reminderMinutes ?? 60;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Xiro Style//Reservas//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${icsText(event.uid)}`,
    `DTSTAMP:${icsInstant(event.now ?? new Date())}`,
    `DTSTART:${icsInstant(event.startsAt)}`,
    `DTEND:${icsInstant(event.endsAt)}`,
    `SUMMARY:${icsText(event.title)}`,
    ...(event.description ? [`DESCRIPTION:${icsText(event.description)}`] : []),
    ...(event.location ? [`LOCATION:${icsText(event.location)}`] : []),
    ...(event.url ? [`URL:${event.url.replace(/[\r\n]/g, '')}`] : []),
    'STATUS:CONFIRMED',
    ...(reminder > 0 ? ['BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(event.title)}`, `TRIGGER:-PT${reminder}M`, 'END:VALARM'] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(icsFold).join('\r\n') + '\r\n';
}
