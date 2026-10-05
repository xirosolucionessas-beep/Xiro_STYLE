import { jsPDF } from 'jspdf';
import type { Currency } from '@xiro/shared';
import { formatMoney } from '@xiro/shared';

/**
 * Comprobante de pago de la SUSCRIPCIÓN a XIRO STYLE (no confundir con la factura de una venta del negocio, ver
 * invoicePdf.ts): mismo patrón (jsPDF en el navegador, sin servidor), pero el encabezado siempre es XIRO STYLE como
 * emisor — el negocio es el cliente aquí, al revés que en una factura de venta.
 */

export const THANK_YOU_MESSAGE = '¡Gracias por confiar en XIRO STYLE! Tu suscripción ha sido activada con éxito para impulsar la gestión de tu negocio.';

export interface SubscriptionInvoiceInput {
  businessName: string;
  /** NIT o cédula del negocio; "" si no lo ha completado — esa línea se omite sin más. */
  businessTaxId: string;
  businessEmail: string;
  businessPhone: string | null;
  paymentId: string;
  dateLabel: string;
  planLabel: string;
  amount: number;
  currency: Currency;
  paymentMethodLabel: string;
  periodStartLabel: string;
  periodEndLabel: string;
}

const GOLD: [number, number, number] = [176, 141, 62];
const INK: [number, number, number] = [26, 24, 21];
const MUTED: [number, number, number] = [110, 105, 97];
const MARGIN = 15;
const PAGE_WIDTH = 210; // A4 en mm

function money(amount: number, currency: Currency): string {
  return formatMoney(amount, currency);
}

/** Construye el PDF (sin guardarlo): separado de `downloadSubscriptionInvoicePdf` para poder probarlo o reutilizarlo. */
export function buildSubscriptionInvoicePdf(input: SubscriptionInvoiceInput): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  let y = MARGIN;

  doc.setTextColor(...GOLD);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.text('XIRO STYLE', MARGIN, y + 6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(...MUTED);
  doc.text('Gestión de negocios de belleza y servicios', MARGIN, y + 12);

  doc.setTextColor(...INK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('COMPROBANTE DE SUSCRIPCIÓN', PAGE_WIDTH - MARGIN, y + 6, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(...MUTED);
  doc.text(`N.° ${input.paymentId}`, PAGE_WIDTH - MARGIN, y + 12, { align: 'right' });
  doc.text(input.dateLabel, PAGE_WIDTH - MARGIN, y + 17, { align: 'right' });

  y += 26;
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(0.6);
  doc.line(MARGIN, y, PAGE_WIDTH - MARGIN, y);
  y += 10;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...INK);
  doc.text('Facturado a', MARGIN, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(...MUTED);
  doc.text(input.businessName, MARGIN, y);
  y += 5;
  if (input.businessTaxId) {
    doc.text(`NIT/Cédula: ${input.businessTaxId}`, MARGIN, y);
    y += 5;
  }
  if (input.businessEmail) {
    doc.text(input.businessEmail, MARGIN, y);
    y += 5;
  }
  if (input.businessPhone) {
    doc.text(input.businessPhone, MARGIN, y);
    y += 5;
  }

  y += 6;
  doc.setFillColor(245, 240, 228);
  doc.rect(MARGIN, y, PAGE_WIDTH - MARGIN * 2, 44, 'F');
  y += 9;
  const detailRow = (label: string, value: string, bold = false) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(...INK);
    doc.text(label, MARGIN + 6, y);
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setTextColor(...(bold ? GOLD : INK));
    doc.setFontSize(bold ? 11 : 9.5);
    doc.text(value, PAGE_WIDTH - MARGIN - 6, y, { align: 'right' });
    y += bold ? 8 : 7;
  };
  detailRow('Plan', input.planLabel);
  detailRow('Forma de pago', input.paymentMethodLabel);
  detailRow('Fecha de inicio', input.periodStartLabel);
  detailRow('Fecha de vencimiento / próxima renovación', input.periodEndLabel);
  detailRow('Total pagado', money(input.amount, input.currency), true);

  y += 16;
  doc.setDrawColor(230, 226, 218);
  doc.setLineWidth(0.2);
  doc.line(MARGIN, y, PAGE_WIDTH - MARGIN, y);
  y += 10;

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(11);
  doc.setTextColor(...GOLD);
  const thankYouLines = doc.splitTextToSize(THANK_YOU_MESSAGE, PAGE_WIDTH - MARGIN * 2);
  for (const line of thankYouLines) {
    doc.text(line, PAGE_WIDTH / 2, y, { align: 'center' });
    y += 6;
  }

  return doc;
}

/** Nombre de archivo estable a partir del id de pago: "factura-suscripcion-a1b2c3d4.pdf". */
export function subscriptionInvoiceFileName(paymentId: string): string {
  return `factura-suscripcion-${paymentId}.pdf`;
}

/** Genera la factura de suscripción y dispara la descarga del navegador. */
export function downloadSubscriptionInvoicePdf(input: SubscriptionInvoiceInput): void {
  buildSubscriptionInvoicePdf(input).save(subscriptionInvoiceFileName(input.paymentId));
}

export type PosTicketWidth = 58 | 80;

/** Mismo comprobante, en formato ticket POS (58 u 80 mm): útil si el negocio imprime todo en la misma impresora térmica. */
export function buildSubscriptionPosTicketPdf(input: SubscriptionInvoiceInput, width: PosTicketWidth = 80): jsPDF {
  const margin = 3;
  const contentWidth = width - margin * 2;
  const lineH = width === 58 ? 3.6 : 4;
  const fontSize = width === 58 ? 7 : 8;

  const measurer = new jsPDF({ unit: 'mm', format: [width, 1000] });
  measurer.setFont('courier', 'normal').setFontSize(fontSize);
  const lines = (text: string) => measurer.splitTextToSize(text, contentWidth).length;
  const thankYouLines = lines(THANK_YOU_MESSAGE);

  let height = margin * 2;
  height += lineH * 2; // "XIRO STYLE" + subtítulo
  height += lineH; // separador
  height += lineH * (2 + (input.businessTaxId ? 1 : 0) + (input.businessEmail ? 1 : 0) + (input.businessPhone ? 1 : 0)); // facturado a
  height += lineH; // separador
  height += lineH * 6; // n°, fecha, plan, pago, inicio, vencimiento
  height += lineH * 1.5; // total
  height += lineH; // separador
  height += thankYouLines * lineH + lineH * 2; // agradecimiento + margen de corte

  const doc = new jsPDF({ unit: 'mm', format: [width, height] });
  doc.setFont('courier', 'normal');
  let y = margin + 3;

  const center = (text: string, size = fontSize, style: 'normal' | 'bold' = 'normal') => {
    doc.setFont('courier', style).setFontSize(size);
    for (const line of doc.splitTextToSize(text, contentWidth)) {
      doc.text(line, width / 2, y, { align: 'center' });
      y += lineH + (size > fontSize ? 0.5 : 0);
    }
  };
  const dashedRule = () => {
    doc.setFont('courier', 'normal').setFontSize(fontSize);
    doc.text('-'.repeat(Math.floor(contentWidth / 1.6)), width / 2, y, { align: 'center' });
    y += lineH;
  };
  const twoCol = (left: string, right: string, style: 'normal' | 'bold' = 'normal') => {
    doc.setFont('courier', style).setFontSize(fontSize);
    doc.text(left, margin, y);
    doc.text(right, width - margin, y, { align: 'right' });
    y += lineH;
  };

  center('XIRO STYLE', fontSize + 1.5, 'bold');
  center('Comprobante de suscripción');
  dashedRule();
  center(input.businessName);
  if (input.businessTaxId) center(`NIT/Cédula: ${input.businessTaxId}`);
  if (input.businessEmail) center(input.businessEmail);
  if (input.businessPhone) center(input.businessPhone);
  dashedRule();
  twoCol(`N.° ${input.paymentId}`, '');
  twoCol('Fecha', input.dateLabel);
  twoCol('Plan', input.planLabel);
  twoCol('Pago', input.paymentMethodLabel);
  twoCol('Inicio', input.periodStartLabel);
  twoCol('Vence', input.periodEndLabel);
  dashedRule();
  twoCol('TOTAL', money(input.amount, input.currency), 'bold');
  y += lineH * 0.5;
  center(THANK_YOU_MESSAGE);

  return doc;
}

/** Nombre de archivo estable a partir del id de pago: "ticket-suscripcion-a1b2c3d4.pdf". */
export function subscriptionPosTicketFileName(paymentId: string): string {
  return `ticket-suscripcion-${paymentId}.pdf`;
}

/** Genera el ticket POS de suscripción y dispara la descarga del navegador. */
export function downloadSubscriptionPosTicketPdf(input: SubscriptionInvoiceInput, width: PosTicketWidth = 80): void {
  buildSubscriptionPosTicketPdf(input, width).save(subscriptionPosTicketFileName(input.paymentId));
}
