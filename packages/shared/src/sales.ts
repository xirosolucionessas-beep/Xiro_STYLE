import { z } from 'zod';

const trimmed = (max: number) => z.string().trim().max(max);
const required = (max: number) => trimmed(max).min(1, 'required');
const uuidString = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'not_found');
const money = () => z.number().int().min(0).max(1_000_000_000);

export const SALE_PAYMENT_METHODS = ['cash', 'card', 'nequi', 'bank_transfer', 'other'] as const;
export type SalePaymentMethod = (typeof SALE_PAYMENT_METHODS)[number];

/**
 * Una línea de venta: de catálogo (`itemId`, con `unitPrice` SOLO para ajustar el precio de esa venta puntual — el
 * servidor decide si quien pide el ajuste tiene permiso) o a mano (`itemId` vacío: `name` y `unitPrice` obligatorios,
 * con la opción de guardarla en el catálogo para la próxima vez).
 */
export const saleLineInputSchema = z
  .object({
    kind: z.enum(['service', 'product']),
    itemId: uuidString.nullable().default(null),
    name: trimmed(120).default(''),
    unitPrice: money().nullable().default(null),
    quantity: z.number().int().min(1).max(999).default(1),
    /** Quién hizo el servicio (comisiones y reportes). Sin sentido en un producto. */
    employeeId: uuidString.nullable().default(null),
    /** Solo para una línea a mano: además de venderla, guardarla en el catálogo para la próxima vez. */
    saveToCatalog: z.boolean().default(false),
  })
  .refine((line) => line.itemId !== null || (line.name.trim().length > 0 && line.unitPrice !== null), { message: 'required', path: ['name'] });
export type SaleLineInput = z.input<typeof saleLineInputSchema>;

export const salePaymentInputSchema = z
  .object({
    method: z.enum(SALE_PAYMENT_METHODS),
    amount: money().min(1),
    /** Solo en efectivo: cuánto entregó la persona, para calcular el cambio. */
    receivedAmount: money().nullable().default(null),
  })
  .refine((p) => p.receivedAmount === null || p.receivedAmount >= p.amount, { message: 'validation_error', path: ['receivedAmount'] });
export type SalePaymentInput = z.input<typeof salePaymentInputSchema>;

export const saleInputSchema = z.object({
  /** Cliente existente; vacío junto con `occasional: true` = cliente ocasional (recibo con `clientLabel`, sin ficha). */
  clientId: uuidString.nullable().default(null),
  occasional: z.boolean().default(false),
  /** Nombre a mostrar en el recibo cuando es un cliente ocasional (opcional: "Cliente ocasional" si se deja vacío). */
  clientLabel: trimmed(120).default(''),
  lines: z.array(saleLineInputSchema).min(1).max(60),
  discount: money().default(0),
  tip: money().default(0),
  payments: z.array(salePaymentInputSchema).min(1).max(6),
  /** Pedido de productos de la página pública que se entrega con esta venta (queda "Entregado" en la misma transacción). */
  productOrderId: uuidString.optional(),
});
export type SaleInput = z.input<typeof saleInputSchema>;

export const voidSaleInputSchema = z.object({ reason: required(200) });
export type VoidSaleInput = z.input<typeof voidSaleInputSchema>;

export const salesQuerySchema = z.object({
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export type SalesQuery = z.input<typeof salesQuerySchema>;

/* ---------- Lo que devuelve la API ---------- */

export interface SaleItemDto {
  id: string;
  kind: 'service' | 'product';
  itemId: string | null;
  name: string;
  unitPrice: number;
  quantity: number;
  total: number;
  employeeId: string | null;
  employeeName: string | null;
  loyaltyCounted: boolean;
}

export interface SalePaymentDto {
  id: string;
  method: SalePaymentMethod;
  amount: number;
  receivedAmount: number | null;
}

export interface SaleDto {
  id: string;
  clientId: string | null;
  clientName: string;
  items: SaleItemDto[];
  payments: SalePaymentDto[];
  subtotal: number;
  discount: number;
  tip: number;
  total: number;
  changeGiven: number;
  status: 'completed' | 'voided';
  voidReason: string;
  createdByName: string;
  createdAt: string;
  rewardJustEarned: boolean;
}
