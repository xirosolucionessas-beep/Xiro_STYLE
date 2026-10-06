import { describe, expect, it } from 'vitest';
import {
  buildSubscriptionInvoicePdf,
  buildSubscriptionPosTicketPdf,
  subscriptionInvoiceFileName,
  subscriptionPosTicketFileName,
  THANK_YOU_MESSAGE,
  type SubscriptionInvoiceInput,
} from '../src/web/services/subscriptionInvoicePdf';

function baseInput(over: Partial<SubscriptionInvoiceInput> = {}): SubscriptionInvoiceInput {
  return {
    businessName: 'Peluquería Ana',
    businessTaxId: '900123456-7',
    businessEmail: 'ana@correo.com',
    businessPhone: '3001234567',
    paymentId: 'bank_transfer:2026-10-04T15:00:00.000Z',
    dateLabel: 'domingo, 4 de octubre de 2026 · 3:15 p. m.',
    planLabel: 'Plan mensual',
    amount: 34_900,
    currency: 'COP',
    paymentMethodLabel: 'Transferencia bancaria',
    periodStartLabel: '4 de octubre de 2026',
    periodEndLabel: '4 de noviembre de 2026',
    ...over,
  };
}

describe('THANK_YOU_MESSAGE', () => {
  it('es exactamente el mensaje de agradecimiento pedido', () => {
    expect(THANK_YOU_MESSAGE).toBe('¡Gracias por confiar en XIRO STYLE! Tu suscripción ha sido activada con éxito para impulsar la gestión de tu negocio.');
  });
});

describe('subscriptionInvoiceFileName', () => {
  it('arma un nombre de archivo estable a partir del id de pago', () => {
    expect(subscriptionInvoiceFileName('abc123')).toBe('factura-suscripcion-abc123.pdf');
  });
});

describe('buildSubscriptionInvoicePdf', () => {
  it('genera un PDF con todos los datos, sin lanzar excepciones', () => {
    const doc = buildSubscriptionInvoicePdf(baseInput());
    expect(doc.output('datauristring')).toContain('data:application/pdf');
  });

  it('sin NIT/cédula (negocio que no lo completó) sigue generando el documento', () => {
    const doc = buildSubscriptionInvoicePdf(baseInput({ businessTaxId: '' }));
    expect(doc.output('datauristring')).toContain('data:application/pdf');
  });

  it('plan anual con monto mayor también genera el documento', () => {
    const doc = buildSubscriptionInvoicePdf(baseInput({ planLabel: 'Plan anual', amount: 349_000, periodEndLabel: '4 de octubre de 2027' }));
    expect(doc.output('datauristring')).toContain('data:application/pdf');
  });
});

describe('buildSubscriptionPosTicketPdf', () => {
  it('genera un comprobante angosto (80 mm)', () => {
    const doc = buildSubscriptionPosTicketPdf(baseInput(), 80);
    expect(doc.output('datauristring')).toContain('data:application/pdf');
    expect(doc.internal.pageSize.getWidth()).toBeCloseTo(80, 0);
  });

  it('también genera en 58 mm, incluso sin NIT/cédula ni teléfono', () => {
    const doc = buildSubscriptionPosTicketPdf(baseInput({ businessTaxId: '', businessPhone: null }), 58);
    expect(doc.internal.pageSize.getWidth()).toBeCloseTo(58, 0);
  });
});

describe('subscriptionPosTicketFileName', () => {
  it('arma un nombre de archivo distinto al de la factura', () => {
    expect(subscriptionPosTicketFileName('abc123')).toBe('ticket-suscripcion-abc123.pdf');
  });
});
