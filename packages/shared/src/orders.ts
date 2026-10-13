import { z } from 'zod';
import { publicCustomerSchema } from './booking';
import { discountCodeSchema } from './discounts';
import { pageQuerySchema } from './pagination';

const trimmed = (max: number) => z.string().trim().max(max);
const uuidString = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'not_found');

/**
 * Pedidos de SOLO productos desde la página pública: el cliente elige productos, deja sus datos y los recoge y paga en el
 * local. Sin hora ni profesional (eso es una cita). Cada negocio decide si los acepta (`productOrdersEnabled`).
 * Estados: pending (nuevo) → ready (listo para recoger) → delivered (entregado: se registró como venta) | cancelled.
 */
export const PRODUCT_ORDER_STATUSES = ['pending', 'ready', 'delivered', 'cancelled'] as const;
export type ProductOrderStatus = (typeof PRODUCT_ORDER_STATUSES)[number];
/** Estados en los que el pedido sigue abierto (el negocio aún debe atenderlo). */
export const OPEN_PRODUCT_ORDER_STATUSES = ['pending', 'ready'] as const satisfies readonly ProductOrderStatus[];

export const productOrderLineInputSchema = z.object({ itemId: uuidString, quantity: z.number().int().min(1).max(20) });

export const publicProductOrderInputSchema = z.object({
  products: z
    .array(productOrderLineInputSchema)
    .min(1, 'required')
    .max(10)
    // El mismo producto dos veces en líneas separadas sería ambiguo: se pide una sola línea con la cantidad.
    .refine((lines) => new Set(lines.map((l) => l.itemId.toLowerCase())).size === lines.length, { message: 'validation_error' }),
  customer: publicCustomerSchema,
  acceptTerms: z.literal(true, { error: 'terms_required' }),
  /** Campo trampa: las personas no lo ven ni lo llenan; un bot sí. */
  website: z.string().max(200).default(''),
  captchaToken: z.string().max(4096).optional(),
  /** Un UUID por intento de confirmar: repetir la MISMA petición (doble clic, reintento) devuelve el pedido ya creado. */
  idempotencyKey: uuidString.optional(),
  /** Código de descuento (Fase 4, si el negocio los activó). */
  discountCode: discountCodeSchema.optional(),
});
export type PublicProductOrderInput = z.input<typeof publicProductOrderInputSchema>;

export interface ProductOrderItemDto {
  id: string;
  /** null si el producto se borró del catálogo después (el pedido conserva nombre y precio). */
  itemId: string | null;
  name: string;
  unitPrice: number;
  quantity: number;
}

/** Lo que ve quien pidió en la página pública (sin datos internos del negocio). */
export interface PublicProductOrderDto {
  id: string;
  status: ProductOrderStatus;
  items: ProductOrderItemDto[];
  totalPrice: number;
  /** Descuento aplicado (total a pagar = totalPrice − amount). */
  discount: { code: string; amount: number } | null;
  createdAt: string;
  business: { name: string; slug: string; currency: string; whatsapp: string | null; address: string; city: string; location: { latitude: number; longitude: number; placeId: string | null; address: string } | null };
}

/** Lo que ve el negocio en su panel (Pedidos). */
export interface ProductOrderDto {
  id: string;
  status: ProductOrderStatus;
  clientId: string;
  clientName: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  customerNotes: string;
  items: ProductOrderItemDto[];
  totalPrice: number;
  discount: { code: string; amount: number } | null;
  /** Venta con la que se entregó (null mientras no se entrega). */
  saleId: string | null;
  cancelReason: string;
  createdAt: string;
  updatedAt: string;
}

export const productOrdersQuerySchema = pageQuerySchema.extend({
  /** Sin estado = todos; `open` = nuevos y listos para recoger (lo que falta atender). */
  status: z.enum([...PRODUCT_ORDER_STATUSES, 'open']).optional(),
});
export type ProductOrdersQuery = z.input<typeof productOrdersQuerySchema>;

export interface ProductOrdersSummary {
  pending: number;
  ready: number;
}

export const productOrderCancelInputSchema = z.object({ reason: trimmed(200).default('') });
export type ProductOrderCancelInput = z.input<typeof productOrderCancelInputSchema>;

/** Transiciones permitidas desde el panel (entregar se hace registrando la venta, ver `saleInputSchema.productOrderId`). */
export function canTransitionProductOrder(from: ProductOrderStatus, to: ProductOrderStatus): boolean {
  if (to === 'ready') return from === 'pending';
  if (to === 'delivered' || to === 'cancelled') return from === 'pending' || from === 'ready';
  return false;
}

/**
 * Mensaje de WhatsApp del cliente al negocio con su pedido (Fase 1, punto 5). Los precios llegan ya formateados en la moneda
 * del negocio (`money`), así sirve para cualquier negocio y moneda.
 */
export function productOrderWhatsappText(input: {
  businessName: string;
  lines: Array<{ name: string; quantity: number; total: string }>;
  total: string;
  customerName: string;
  customerPhone: string;
  language: 'es' | 'en';
}): string {
  const bullets = input.lines.map((l) => `• ${l.quantity}x ${l.name} - ${l.total}`).join('\n');
  if (input.language === 'en') {
    return `Hi ${input.businessName}! 👋 I'd like to buy the following product(s):\n\n${bullets}\n\nTotal to pay: ${input.total}\nMy details: ${input.customerName} | Phone: ${input.customerPhone}`;
  }
  return `¡Hola ${input.businessName}! 👋 Deseo comprar el/los siguiente(s) producto(s):\n\n${bullets}\n\nTotal a pagar: ${input.total}\nMis datos: ${input.customerName} | Tel: ${input.customerPhone}`;
}
