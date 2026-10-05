import { describe, expect, it } from 'vitest';
import { buildInvoicePdf, buildPosTicketPdf, businessAddressLine, invoiceFileName, posTicketFileName, type InvoiceInput } from '../src/web/services/invoicePdf';

function baseInput(over: Partial<InvoiceInput> = {}): InvoiceInput {
  return {
    businessName: 'Xiro Style',
    businessAddress: 'Calle 10 #5-20, Bogotá, Colombia',
    businessPhone: '3001234567',
    logoDataUrl: null,
    receiptNumber: 'AB12CD34',
    dateLabel: 'miércoles, 30 de septiembre de 2026 · 3:15 p. m.',
    clientName: 'Ana Pérez',
    items: [{ name: 'Corte', quantity: 1, unitPrice: 30_000, total: 30_000 }],
    subtotal: 30_000,
    discount: 0,
    tip: 0,
    total: 30_000,
    paymentLabel: 'Efectivo $ 30.000',
    currency: 'COP',
    ...over,
  };
}

describe('businessAddressLine', () => {
  it('une dirección, ciudad y país con comas', () => {
    expect(businessAddressLine('Calle 10 #5-20', 'Bogotá', 'Colombia')).toBe('Calle 10 #5-20, Bogotá, Colombia');
  });

  it('omite los campos vacíos sin dejar comas sueltas', () => {
    expect(businessAddressLine('', 'Bogotá', '')).toBe('Bogotá');
    expect(businessAddressLine('', '', '')).toBe('');
  });
});

describe('invoiceFileName', () => {
  it('arma un nombre de archivo estable a partir del número de recibo', () => {
    expect(invoiceFileName('AB12CD34')).toBe('factura-AB12CD34.pdf');
  });
});

describe('buildInvoicePdf', () => {
  it('genera un PDF sin logo, sin lanzar excepciones', () => {
    const doc = buildInvoicePdf(baseInput());
    expect(doc.output('datauristring')).toContain('data:application/pdf');
  });

  it('con varios ítems, descuento y propina sigue generando el documento', () => {
    const doc = buildInvoicePdf(
      baseInput({
        items: [
          { name: 'Corte', quantity: 1, unitPrice: 30_000, total: 30_000 },
          { name: 'Shampoo', quantity: 2, unitPrice: 20_000, total: 40_000 },
        ],
        subtotal: 70_000,
        discount: 5_000,
        tip: 3_000,
        total: 68_000,
      }),
    );
    expect(doc.output('datauristring')).toContain('data:application/pdf');
  });

  it('un logo inválido no rompe la generación (se omite)', () => {
    const doc = buildInvoicePdf(baseInput({ logoDataUrl: 'data:image/png;base64,not-a-real-image' }));
    expect(doc.output('datauristring')).toContain('data:application/pdf');
  });
});

describe('buildPosTicketPdf', () => {
  it('genera un comprobante angosto (80 mm) de alto variable según el contenido', () => {
    const doc = buildPosTicketPdf(baseInput(), 80);
    expect(doc.output('datauristring')).toContain('data:application/pdf');
    const size = doc.internal.pageSize;
    expect(size.getWidth()).toBeCloseTo(80, 0);
  });

  it('también genera en 58 mm', () => {
    const doc = buildPosTicketPdf(baseInput(), 58);
    const size = doc.internal.pageSize;
    expect(size.getWidth()).toBeCloseTo(58, 0);
  });

  it('un nombre de artículo muy largo (que envuelve varias líneas) no rompe la generación', () => {
    const doc = buildPosTicketPdf(
      baseInput({
        items: [
          { name: 'Tratamiento capilar reconstructivo profundo con keratina y aceites esenciales premium', quantity: 1, unitPrice: 120_000, total: 120_000 },
          { name: 'Shampoo', quantity: 3, unitPrice: 20_000, total: 60_000 },
        ],
        subtotal: 180_000,
        total: 180_000,
      }),
      58,
    );
    expect(doc.output('datauristring')).toContain('data:application/pdf');
  });
});

describe('posTicketFileName', () => {
  it('arma un nombre de archivo distinto al de la factura', () => {
    expect(posTicketFileName('AB12CD34')).toBe('ticket-AB12CD34.pdf');
  });
});
