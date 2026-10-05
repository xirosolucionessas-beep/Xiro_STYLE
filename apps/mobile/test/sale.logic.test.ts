import { describe, expect, it } from 'vitest';
import { cartSubtotal, changeDue, filterCatalog, insufficientStockLines, lineTotal, paymentsTotal, remainingToPay, saleTotal, type CartLine, type PaymentRow } from '../src/lib/sale';

const line = (over: Partial<CartLine> = {}): CartLine => ({ key: 'k1', kind: 'service', itemId: null, name: 'Corte', unitPrice: 30_000, catalogPrice: 30_000, quantity: 1, employeeId: null, saveToCatalog: false, stock: null, ...over });

describe('carrito de la venta', () => {
  it('el total de una línea es precio por cantidad, y el subtotal suma todas', () => {
    expect(lineTotal(line({ unitPrice: 20_000, quantity: 2 }))).toBe(40_000);
    expect(cartSubtotal([line({ unitPrice: 20_000, quantity: 2 }), line({ unitPrice: 10_000, quantity: 1 })])).toBe(50_000);
    expect(cartSubtotal([])).toBe(0);
  });

  it('avisa de las líneas de producto cuya cantidad no alcanza en existencias, no de servicios ni de sobra', () => {
    const short = line({ key: 'p1', kind: 'product', itemId: 'i1', quantity: 3, stock: 2 });
    const ok = line({ key: 'p2', kind: 'product', itemId: 'i2', quantity: 1, stock: 5 });
    const service = line({ key: 's1', kind: 'service', quantity: 100, stock: null });
    expect(insufficientStockLines([short, ok, service])).toEqual([short]);
  });
});

describe('total de la venta y pagos', () => {
  it('subtotal menos descuento (nunca negativo) más propina', () => {
    expect(saleTotal(100_000, 10_000, 5_000)).toBe(95_000);
    expect(saleTotal(10_000, 50_000, 0)).toBe(0); // un descuento mayor al subtotal no vuelve el total negativo
  });

  const pay = (over: Partial<PaymentRow> = {}): PaymentRow => ({ key: 'p1', method: 'cash', amount: 50_000, receivedAmount: null, ...over });

  it('suma los pagos y calcula lo que falta por asignar', () => {
    expect(paymentsTotal([pay({ amount: 30_000 }), pay({ key: 'p2', amount: 20_000 })])).toBe(50_000);
    expect(remainingToPay(100_000, [pay({ amount: 30_000 })])).toBe(70_000);
    expect(remainingToPay(100_000, [pay({ amount: 100_000 })])).toBe(0);
  });

  it('el cambio solo cuenta cuando se indicó cuánto entregó la persona, y nunca es negativo', () => {
    expect(changeDue([pay({ amount: 30_000, receivedAmount: 50_000 })])).toBe(20_000);
    expect(changeDue([pay({ amount: 30_000, receivedAmount: null })])).toBe(0); // pagó el exacto
    expect(changeDue([pay({ amount: 30_000, receivedAmount: 30_000 })])).toBe(0);
    // Pago partido: el cambio de cada pago en efectivo se suma.
    expect(changeDue([pay({ key: 'a', amount: 20_000, receivedAmount: 25_000 }), pay({ key: 'b', method: 'nequi', amount: 30_000 })])).toBe(5_000);
  });
});

describe('filtro del catálogo (buscador + categoría)', () => {
  const items = [
    { id: '1', name: 'Corte de cabello', categoryId: 'cat-a', kind: 'service' as const },
    { id: '2', name: 'Manicure', categoryId: 'cat-b', kind: 'service' as const },
    { id: '3', name: 'Shampoo', categoryId: 'cat-a', kind: 'product' as const },
  ];

  it('separa servicios de productos, filtra por categoría y busca sin importar acentos/mayúsculas', () => {
    expect(filterCatalog(items, '', null, 'service').map((i) => i.id)).toEqual(['1', '2']);
    expect(filterCatalog(items, '', null, 'product').map((i) => i.id)).toEqual(['3']);
    expect(filterCatalog(items, '', 'cat-a', 'service').map((i) => i.id)).toEqual(['1']);
    expect(filterCatalog(items, 'MANICÜRE', null, 'service').map((i) => i.id)).toEqual(['2']);
    expect(filterCatalog(items, 'nada-coincide', null, 'service')).toEqual([]);
  });
});
