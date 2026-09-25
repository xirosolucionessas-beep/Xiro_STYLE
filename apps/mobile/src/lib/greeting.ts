export type GreetingKey = 'greeting_morning' | 'greeting_afternoon' | 'greeting_evening';

/** Franjas por hora local: 05:00–11:59 mañana · 12:00–18:59 tarde · 19:00–04:59 noche. */
export function greetingKey(hour: number): GreetingKey {
  if (hour >= 5 && hour < 12) return 'greeting_morning';
  if (hour >= 12 && hour < 19) return 'greeting_afternoon';
  return 'greeting_evening';
}

/** Horas en las que cambia el saludo. */
export const GREETING_BOUNDARIES = [5, 12, 19] as const;

/** Milisegundos hasta el próximo cambio de saludo (05:00, 12:00 o 19:00 locales), para reprogramarlo sin reiniciar la app. */
export function msUntilNextGreeting(now: Date): number {
  for (const hour of GREETING_BOUNDARIES) {
    const boundary = new Date(now);
    boundary.setHours(hour, 0, 0, 0);
    if (boundary.getTime() > now.getTime()) return boundary.getTime() - now.getTime();
  }
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(GREETING_BOUNDARIES[0], 0, 0, 0);
  return tomorrow.getTime() - now.getTime();
}

/** Hora (0–23) en la zona horaria dada; si la zona es inválida usa la del dispositivo. */
export function hourInTimezone(timezone: string, date: Date): number {
  try {
    const hour = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', hourCycle: 'h23' }).format(date);
    const parsed = Number.parseInt(hour, 10);
    return Number.isFinite(parsed) ? parsed % 24 : date.getHours();
  } catch {
    return date.getHours();
  }
}

/** Saludo según la hora del NEGOCIO (su zona horaria), no la del navegador de quien mira. */
export const greetingKeyIn = (timezone: string, date: Date): GreetingKey => greetingKey(hourInTimezone(timezone, date));
