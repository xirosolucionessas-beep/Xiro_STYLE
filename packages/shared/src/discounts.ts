import { z } from 'zod';

const trimmed = (max: number) => z.string().trim().max(max);

/**
 * Códigos de descuento de la página pública (Fase 4). El negocio los crea en su panel; quien reserva escribe el código y el
 * SERVIDOR decide si aplica y cuánto descuenta (con `computeDiscount`, la misma función que usa la página solo para mostrar).
 */
export const DISCOUNT_KINDS = ['percent', 'fixed'] as const;
export type DiscountKind = (typeof DISCOUNT_KINDS)[number];

/** Letras, números, guion y guion bajo; se guarda y compara en mayúsculas ("verano10" = "VERANO10"). */
export const discountCodeSchema = z
  .string()
  .trim()
  .transform((code) => code.toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9_-]{3,30}$/, 'discount_code_format'));

export const discountCodeInputSchema = z
  .object({
    code: discountCodeSchema,
    description: trimmed(120).default(''),
    kind: z.enum(DISCOUNT_KINDS),
    value: z.number().int().min(1).max(1_000_000_000),
    minTotal: z.number().int().min(0).max(1_000_000_000).default(0),
    maxUses: z.number().int().min(1).max(1_000_000).nullable().default(null),
    oncePerClient: z.boolean().default(false),
    startsAt: z.iso.datetime().nullable().default(null),
    endsAt: z.iso.datetime().nullable().default(null),
    active: z.boolean().default(true),
  })
  .refine((d) => d.kind !== 'percent' || d.value <= 100, { message: 'discount_percent_range', path: ['value'] })
  .refine((d) => !d.startsAt || !d.endsAt || Date.parse(d.startsAt) < Date.parse(d.endsAt), { message: 'discount_dates', path: ['endsAt'] });
export type DiscountCodeInput = z.input<typeof discountCodeInputSchema>;

export interface DiscountCodeDto {
  id: string;
  code: string;
  description: string;
  kind: DiscountKind;
  value: number;
  minTotal: number;
  maxUses: number | null;
  uses: number;
  oncePerClient: boolean;
  startsAt: string | null;
  endsAt: string | null;
  active: boolean;
  createdAt: string;
}

/** Lo que ve quien reserva al validar un código: lo justo para mostrar el descuento (nunca usos ni límites internos). */
export interface PublicDiscountDto {
  code: string;
  description: string;
  kind: DiscountKind;
  value: number;
  minTotal: number;
}

/**
 * Cuánto descuenta un código sobre `subtotal` (unidad principal de la moneda): 0 si no llega al mínimo; un porcentaje
 * redondeado al entero más cercano; un monto fijo nunca mayor que el subtotal. El total a pagar jamás es negativo.
 */
export function computeDiscount(subtotal: number, discount: Pick<PublicDiscountDto, 'kind' | 'value' | 'minTotal'>): number {
  if (subtotal <= 0 || subtotal < discount.minTotal) return 0;
  const amount = discount.kind === 'percent' ? Math.round((subtotal * discount.value) / 100) : discount.value;
  return Math.max(0, Math.min(subtotal, amount));
}

/**
 * Descuento aplicado a una cita o pedido (lo que ve el cliente y el negocio). `code` = código usado ('—' si se borró;
 * vacío si no hubo código); `birthday` = el monto incluye la recompensa de cumpleaños del cliente.
 */
export interface AppliedDiscountDto {
  code: string;
  amount: number;
  birthday?: boolean;
}

/** Texto del descuento aplicado: "Descuento (CODIGO)", "Descuento de cumpleaños" o ambos. */
export function appliedDiscountLabel(t: (key: string, params?: Record<string, string | number>) => string, discount: AppliedDiscountDto, birthdayKey: string): string {
  if (discount.birthday && !discount.code) return t(birthdayKey);
  const base = t('pub_summary_discount', { code: discount.code });
  return discount.birthday ? `${base} + ${t(birthdayKey)}` : base;
}
