import { z } from 'zod';
import { isRealDate } from './agenda';

/**
 * Programa de cumpleaños (opcional por negocio; apagado por defecto). Reglas de producto definidas:
 * - Se emite UNA recompensa por cliente, negocio y año calendario (restricción única en la base de datos).
 * - Se emite el mismo día del cumpleaños, temprano (desde las 08:00 en la zona horaria del negocio), y vale N días
 *   (`validDays`, lo elige el negocio) contando ese día.
 * - Quien nació el 29 de febrero lo celebra el 28 de febrero en los años no bisiestos.
 * - Se canjea en caja (venta) o al reservar/pedir en la página web con la cuenta del cliente. El descuento lo calcula
 *   SIEMPRE el servidor con las condiciones congeladas al emitirla.
 */

export const BIRTHDAY_REWARD_KINDS = ['percent', 'fixed'] as const;
export type BirthdayRewardKind = (typeof BIRTHDAY_REWARD_KINDS)[number];

/** Sobre qué parte de la compra aplica: todo, solo servicios o solo productos (los paquetes cuentan como servicios). */
export const BIRTHDAY_SCOPES = ['all', 'services', 'products'] as const;
export type BirthdayScope = (typeof BIRTHDAY_SCOPES)[number];

export const BIRTHDAY_MAX_VALID_DAYS = 60;
/** Hora local desde la que se emite y se avisa ("temprano" = no a medianoche). */
export const BIRTHDAY_ISSUE_HOUR = 8;

export const birthdayProgramSchema = z
  .object({
    enabled: z.boolean(),
    rewardKind: z.enum(BIRTHDAY_REWARD_KINDS),
    rewardValue: z.number().int(),
    scope: z.enum(BIRTHDAY_SCOPES),
    validDays: z.number().int().min(1).max(BIRTHDAY_MAX_VALID_DAYS),
    /** Compra mínima (sobre la parte que aplica) para poder usarla; 0 = sin mínimo. */
    minTotal: z.number().int().min(0).max(1_000_000_000),
    /** ¿Se puede sumar a otro descuento de la misma compra (código de descuento o descuento manual en caja)? */
    combinable: z.boolean(),
    /** Texto de felicitación opcional del negocio (para su mensaje de WhatsApp y la cuenta del cliente). */
    message: z.string().trim().max(300),
  })
  .strict()
  .superRefine((v, ctx) => {
    const ok = v.rewardKind === 'percent' ? v.rewardValue >= 1 && v.rewardValue <= 100 : v.rewardValue >= 1 && v.rewardValue <= 1_000_000_000;
    if (!ok) ctx.addIssue({ code: 'custom', message: 'reward_value_out_of_range', path: ['rewardValue'] });
  });
export type BirthdayProgramInput = z.infer<typeof birthdayProgramSchema>;

export interface BirthdayProgramDto extends BirthdayProgramInput {
  updatedAt: string | null;
}

export const DEFAULT_BIRTHDAY_PROGRAM: BirthdayProgramInput = {
  enabled: false,
  rewardKind: 'percent',
  rewardValue: 10,
  scope: 'all',
  validDays: 7,
  minTotal: 0,
  combinable: false,
  message: '',
};

/* ---------- Fecha de nacimiento ---------- */

export const isLeapYear = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

/**
 * Fecha de nacimiento: AAAA-MM-DD real, desde 1900 y no futura. "Futura" se mide contra el día más adelantado del planeta
 * (UTC+14), para no rechazar a quien nació "hoy" en una zona horaria adelantada. Sin edad mínima: no hay regla definida.
 */
export function birthDateSchema(now: () => Date = () => new Date()) {
  return z
    .string()
    .trim()
    .refine(isRealDate, 'birth_date_invalid')
    .refine((v) => v >= '1900-01-01', 'birth_date_invalid')
    .refine((v) => v <= new Date(now().getTime() + 14 * 3_600_000).toISOString().slice(0, 10), 'birth_date_future');
}

/** En formularios: `undefined` (campo omitido) = no cambiar; `null` o '' = quitar la fecha; texto = guardarla. */
export const optionalBirthDateField = z
  .union([z.literal('').transform(() => null), z.null(), birthDateSchema()])
  .optional();

/** Día que se celebra el cumpleaños en `year` (29 de febrero → 28 de febrero si `year` no es bisiesto). */
export function birthdayInYear(birthDate: string, year: number): string {
  const [, mm, dd] = birthDate.split('-');
  const day = mm === '02' && dd === '29' && !isLeapYear(year) ? '28' : dd;
  return `${String(year).padStart(4, '0')}-${mm}-${day}`;
}

/** Fecha local (AAAA-MM-DD) y hora local de `now` en la zona horaria del negocio. */
export function localDateTimeIn(timezone: string, now: Date = new Date()): { date: string; hour: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

/** Suma días a una fecha AAAA-MM-DD (calendario, sin zona horaria). */
export function addDaysToDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Último día de vigencia (inclusive) para una recompensa que empieza el día del cumpleaños. */
export const rewardEndsOn = (birthdayOn: string, validDays: number) => addDaysToDate(birthdayOn, validDays - 1);

/**
 * Cumpleaños que corresponden HOY (fecha local del negocio) con su ventana de vigencia aún abierta: el de este año y el del
 * año anterior (cubre la vigencia que cruza el año nuevo: cumpleaños el 31 de diciembre). Devuelve el año de la recompensa
 * (el del cumpleaños celebrado) y el día celebrado, o null si hoy no está dentro de ninguna ventana.
 */
export function birthdayWindowOn(birthDate: string, today: string, validDays: number): { year: number; birthdayOn: string; endsOn: string } | null {
  const thisYear = Number(today.slice(0, 4));
  for (const year of [thisYear, thisYear - 1]) {
    const birthdayOn = birthdayInYear(birthDate, year);
    const endsOn = rewardEndsOn(birthdayOn, validDays);
    if (today >= birthdayOn && today <= endsOn) return { year, birthdayOn, endsOn };
  }
  return null;
}

/* ---------- Recompensas ---------- */

/**
 * `available` = emitida y sin usar; `claimed` = aplicada a una reserva o pedido web; `redeemed` = canjeada en caja.
 * `expired` NO se guarda: es una `available` cuya vigencia ya pasó (se deriva al mostrarla).
 */
export const BIRTHDAY_REWARD_STATES = ['available', 'claimed', 'redeemed', 'expired'] as const;
export type BirthdayRewardState = (typeof BIRTHDAY_REWARD_STATES)[number];

export interface BirthdayRewardDto {
  id: string;
  year: number;
  /** Primer y último día de vigencia (inclusive), en la zona horaria del negocio. */
  startsOn: string;
  endsOn: string;
  state: BirthdayRewardState;
  rewardKind: BirthdayRewardKind;
  rewardValue: number;
  scope: BirthdayScope;
  minTotal: number;
  combinable: boolean;
  /** Cuánto descontó al usarla (null si aún no se usó). */
  amount: number | null;
  usedAt: string | null;
}

/** Estado de cumpleaños de un cliente para el negocio (ficha) o para el propio cliente (su cuenta). Nunca trae la fecha. */
export interface BirthdayStatusDto {
  programEnabled: boolean;
  hasBirthDate: boolean;
  /** Mensaje de felicitación del negocio (para el WhatsApp preparado). */
  message: string;
  /** Recompensa del año en curso o la más reciente aún relevante; null si no tiene. */
  reward: BirthdayRewardDto | null;
}

/**
 * Lo que ve el propio cliente en su cuenta de la página pública. Sin programa activo no se revela nada más. Nunca incluye la
 * fecha de nacimiento (ya la tiene en su perfil).
 */
export type ClientBirthdayDto =
  | { active: false }
  | { active: true; hasBirthDate: boolean; validDays: number; message: string; currency: string; reward: BirthdayRewardDto | null };

export function rewardState(row: { status: string; endsOn: string }, today: string): BirthdayRewardState {
  if (row.status === 'claimed' || row.status === 'redeemed') return row.status;
  return today > row.endsOn ? 'expired' : 'available';
}

/** Parte de la compra sobre la que aplica: suma de las líneas incluidas por el alcance. */
export function eligibleSubtotal(lines: Array<{ kind: 'service' | 'product' | 'package'; total: number }>, scope: BirthdayScope): number {
  return lines.filter((l) => scope === 'all' || (scope === 'products' ? l.kind === 'product' : l.kind !== 'product')).reduce((s, l) => s + l.total, 0);
}

/** Descuento de la recompensa sobre la parte que aplica; 0 si no llega a la compra mínima. Nunca supera esa parte. */
export function birthdayDiscount(eligible: number, reward: { rewardKind: BirthdayRewardKind; rewardValue: number; minTotal: number }): number {
  if (eligible <= 0 || eligible < reward.minTotal) return 0;
  const amount = reward.rewardKind === 'percent' ? Math.round((eligible * reward.rewardValue) / 100) : reward.rewardValue;
  return Math.max(0, Math.min(eligible, amount));
}
