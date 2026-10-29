import { describe, expect, it } from 'vitest';
import { bookingSelectionSchema, canTransitionProductOrder, productOrderWhatsappText, publicProductOrderInputSchema, type ProductOrderStatus } from '../src';

const ID = '33333333-3333-4333-8333-333333333333';
const customer = { firstName: 'Ana', lastName: 'Pérez', phone: '3001234567', email: '', notes: '', custom: {} };

describe('pedido de solo productos: validación del contrato', () => {
  it('acepta uno o más productos con cantidades de 1 a 20, y normaliza el celular', () => {
    const parsed = publicProductOrderInputSchema.parse({ products: [{ itemId: ID, quantity: 2 }], customer, acceptTerms: true });
    expect(parsed.products).toEqual([{ itemId: ID, quantity: 2 }]);
    expect(parsed.customer.phone).toBe('573001234567');
    expect(parsed.website).toBe('');
  });

  it('rechaza: sin productos, cantidad 0 o 21, el mismo producto en dos líneas, sin términos, celular inválido', () => {
    const bad = [
      { products: [], customer, acceptTerms: true },
      { products: [{ itemId: ID, quantity: 0 }], customer, acceptTerms: true },
      { products: [{ itemId: ID, quantity: 21 }], customer, acceptTerms: true },
      { products: [{ itemId: ID, quantity: 1 }, { itemId: ID.toUpperCase(), quantity: 1 }], customer, acceptTerms: true },
      { products: [{ itemId: ID, quantity: 1 }], customer, acceptTerms: false },
      { products: [{ itemId: ID, quantity: 1 }], customer: { ...customer, phone: '12' }, acceptTerms: true },
      { products: [{ itemId: 'no-es-uuid', quantity: 1 }], customer, acceptTerms: true },
    ];
    for (const input of bad) expect(publicProductOrderInputSchema.safeParse(input).success, JSON.stringify(input)).toBe(false);
  });

  it('no trae precios ni totales: si el cliente los manda, se descartan (los pone el servidor)', () => {
    const parsed = publicProductOrderInputSchema.parse({ products: [{ itemId: ID, quantity: 1, price: 1 }], customer, acceptTerms: true, total: 1 } as never);
    expect(JSON.stringify(parsed)).not.toMatch(/price|total/);
  });

  it('el contrato de las CITAS no cambió: una cita sigue exigiendo un servicio o paquete', () => {
    expect(bookingSelectionSchema.safeParse({ services: [], packages: [], products: [{ itemId: ID, quantity: 1 }] }).success).toBe(false);
  });
});

describe('estados del pedido', () => {
  it('nuevo → listo → entregado | cancelado; cerrado no cambia más', () => {
    const allowed: Array<[ProductOrderStatus, ProductOrderStatus]> = [
      ['pending', 'ready'],
      ['pending', 'delivered'],
      ['pending', 'cancelled'],
      ['ready', 'delivered'],
      ['ready', 'cancelled'],
    ];
    const all: ProductOrderStatus[] = ['pending', 'ready', 'delivered', 'cancelled'];
    for (const from of all) for (const to of all) expect(canTransitionProductOrder(from, to), `${from} → ${to}`).toBe(allowed.some(([a, b]) => a === from && b === to));
  });
});

describe('mensaje de WhatsApp del pedido (Fase 1, punto 5)', () => {
  it('formato exacto, con nombre del negocio, cantidades, precios y total en la moneda del negocio', () => {
    const text = productOrderWhatsappText({
      businessName: 'Estudio Luna',
      lines: [
        { name: 'Shampoo', quantity: 1, total: '$15.000' },
        { name: 'Cera mate', quantity: 2, total: '$44.000' },
      ],
      total: '$59.000',
      customerName: 'Ana Pérez',
      customerPhone: '3001234567',
      language: 'es',
    });
    expect(text).toBe('¡Hola Estudio Luna! 👋 Deseo comprar el/los siguiente(s) producto(s):\n\n• 1x Shampoo - $15.000\n• 2x Cera mate - $44.000\n\nTotal a pagar: $59.000\nMis datos: Ana Pérez | Tel: 3001234567');
  });

  it('en inglés para quien navega la página en inglés', () => {
    const text = productOrderWhatsappText({ businessName: 'Studio', lines: [{ name: 'Gel', quantity: 1, total: 'US$10.00' }], total: 'US$10.00', customerName: 'Ann', customerPhone: '15551234567', language: 'en' });
    expect(text).toContain("Hi Studio! 👋 I'd like to buy the following product(s):");
    expect(text).toContain('Total to pay: US$10.00');
  });
});
