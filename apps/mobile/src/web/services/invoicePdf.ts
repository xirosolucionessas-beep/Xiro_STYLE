import { jsPDF } from 'jspdf';
import type { Currency } from '@xiro/shared';
import { formatMoney } from '@xiro/shared';

/**
 * Factura en PDF de una venta ya registrada (Tarea 6): se genera enteramente en el navegador (jsPDF), sin pasar por
 * el servidor — no hay nada que desplegar ni credenciales que configurar. Fondo blanco (para no gastar tinta al
 * imprimir) con los acentos dorados de la marca; el logo es opcional y nunca rompe la factura si no carga.
 */

export interface InvoiceItem {
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface InvoiceInput {
  businessName: string;
  /** "Calle 10 #5-20, Bogotá, Colombia" — ya compuesta (ver `businessAddressLine`). */
  businessAddress: string;
  businessPhone: string | null;
  /** Data URL (data:image/...;base64,...) ya cargado; null = sin logo, se omite sin más. */
  logoDataUrl: string | null;
  receiptNumber: string;
  dateLabel: string;
  clientName: string;
  items: InvoiceItem[];
  subtotal: number;
  discount: number;
  tip: number;
  total: number;
  paymentLabel: string;
  currency: Currency;
}

/** Compartida con Android/iOS (ver @/lib/exports/address). */
export { businessAddressLine } from '@/lib/exports/address';

const GOLD: [number, number, number] = [176, 141, 62];
const INK: [number, number, number] = [26, 24, 21];
const MUTED: [number, number, number] = [110, 105, 97];
const MARGIN = 15;
const PAGE_WIDTH = 210; // A4 en mm

function money(amount: number, currency: Currency): string {
  return formatMoney(amount, currency);
}

/** Construye el PDF (sin guardarlo): separado de `downloadInvoicePdf` para poder probarlo o reutilizar el documento. */
export function buildInvoicePdf(input: InvoiceInput): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  let y = MARGIN;

  if (input.logoDataUrl) {
    try {
      doc.addImage(input.logoDataUrl, 'JPEG', MARGIN, y, 22, 22);
    } catch {
      /* logo dañado o formato no reconocido por jsPDF: la factura sigue sin él */
    }
  }
  const textX = input.logoDataUrl ? MARGIN + 28 : MARGIN;
  doc.setTextColor(...INK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(input.businessName, textX, y + 6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(...MUTED);
  if (input.businessAddress) doc.text(input.businessAddress, textX, y + 12);
  if (input.businessPhone) doc.text(input.businessPhone, textX, y + 17);

  doc.setTextColor(...GOLD);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('FACTURA DE VENTA', PAGE_WIDTH - MARGIN, y + 6, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(...MUTED);
  doc.text(`N.° ${input.receiptNumber}`, PAGE_WIDTH - MARGIN, y + 12, { align: 'right' });
  doc.text(input.dateLabel, PAGE_WIDTH - MARGIN, y + 17, { align: 'right' });

  y += 26;
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(0.6);
  doc.line(MARGIN, y, PAGE_WIDTH - MARGIN, y);
  y += 8;

  doc.setTextColor(...INK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('Cliente', MARGIN, y);
  doc.setFont('helvetica', 'normal');
  doc.text(input.clientName, MARGIN + 18, y);
  y += 10;

  // Cabecera de la tabla de ítems
  const col = { qty: MARGIN, name: MARGIN + 14, price: PAGE_WIDTH - MARGIN - 45, total: PAGE_WIDTH - MARGIN };
  doc.setFillColor(245, 240, 228);
  doc.rect(MARGIN, y - 5, PAGE_WIDTH - MARGIN * 2, 7, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...INK);
  doc.text('Cant.', col.qty + 2, y);
  doc.text('Descripción', col.name, y);
  doc.text('Precio unit.', col.price, y, { align: 'right' });
  doc.text('Total', col.total, y, { align: 'right' });
  y += 7;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  for (const item of input.items) {
    if (y > 265) {
      doc.addPage();
      y = MARGIN;
    }
    doc.text(String(item.quantity), col.qty + 2, y);
    doc.text(item.name, col.name, y, { maxWidth: col.price - col.name - 4 });
    doc.text(money(item.unitPrice, input.currency), col.price, y, { align: 'right' });
    doc.text(money(item.total, input.currency), col.total, y, { align: 'right' });
    y += 7;
    doc.setDrawColor(230, 226, 218);
    doc.setLineWidth(0.2);
    doc.line(MARGIN, y - 4, PAGE_WIDTH - MARGIN, y - 4);
  }

  y += 4;
  const summaryX = PAGE_WIDTH - MARGIN - 60;
  const row = (label: string, value: string, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(bold ? 11 : 9.5);
    doc.setTextColor(...(bold ? GOLD : MUTED));
    doc.text(label, summaryX, y);
    doc.setTextColor(...INK);
    doc.text(value, PAGE_WIDTH - MARGIN, y, { align: 'right' });
    y += bold ? 8 : 6;
  };
  row('Subtotal', money(input.subtotal, input.currency));
  if (input.discount > 0) row('Descuento', `-${money(input.discount, input.currency)}`);
  if (input.tip > 0) row('Propina', money(input.tip, input.currency));
  row('Total', money(input.total, input.currency), true);
  row('Forma de pago', input.paymentLabel);

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8.5);
  doc.setTextColor(...MUTED);
  doc.text('Gracias por tu compra.', MARGIN, 285);

  return doc;
}

/** Nombre de archivo estable a partir del número de recibo: "factura-a1b2c3d4.pdf". */
export function invoiceFileName(receiptNumber: string): string {
  return `factura-${receiptNumber}.pdf`;
}

/** Genera la factura y dispara la descarga del navegador. */
export function downloadInvoicePdf(input: InvoiceInput): void {
  buildInvoicePdf(input).save(invoiceFileName(input.receiptNumber));
}

/** Anchos estándar de rollo térmico POS, en milímetros. */
export type PosTicketWidth = 58 | 80;

/**
 * Comprobante en formato ticket POS (rollo térmico de 58 u 80 mm): tipografía monoespaciada, una columna, sin logo
 * (no se ve con nitidez en una impresión térmica angosta). El alto de la página se calcula a partir del contenido
 * real (cuántas líneas ocupa cada nombre largo al envolver) — un ticket no es una hoja de tamaño fijo como la factura.
 */
export function buildPosTicketPdf(input: InvoiceInput, width: PosTicketWidth = 80): jsPDF {
  const margin = 3;
  const contentWidth = width - margin * 2;
  const lineH = width === 58 ? 3.6 : 4;
  const fontSize = width === 58 ? 7 : 8;

  // Medida (sin dibujar todavía): cuántas líneas ocupa cada bloque que puede envolver, para saber el alto total.
  const measurer = new jsPDF({ unit: 'mm', format: [width, 1000] });
  measurer.setFont('courier', 'normal').setFontSize(fontSize);
  const nameLines = (text: string) => measurer.splitTextToSize(text, contentWidth).length;
  const businessNameLines = nameLines(input.businessName);
  const addressLines = input.businessAddress ? nameLines(input.businessAddress) : 0;
  const dateLines = nameLines(input.dateLabel);
  const itemLineCounts = input.items.map((item) => nameLines(item.quantity > 1 ? `${item.name} ×${item.quantity}` : item.name));

  let height = margin * 2;
  height += businessNameLines * (lineH + 0.5);
  height += addressLines * lineH;
  height += input.businessPhone ? lineH : 0;
  height += lineH; // separador
  height += lineH; // "N.° ..."
  height += dateLines * lineH;
  height += lineH; // cliente
  height += lineH * 1.5; // separador + cabecera de ítems
  height += itemLineCounts.reduce((sum, lines) => sum + lines * lineH + lineH, 0); // nombre(s) + línea de cantidad/precio
  height += lineH * 1.5; // separador
  height += lineH * (2 + (input.discount > 0 ? 1 : 0) + (input.tip > 0 ? 1 : 0)); // subtotal/descuento/propina/total
  height += lineH * 2; // forma de pago + espacio
  height += lineH * 3; // agradecimiento + margen de corte

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

  center(input.businessName, fontSize + 1.5, 'bold');
  if (input.businessAddress) center(input.businessAddress);
  if (input.businessPhone) center(input.businessPhone);
  dashedRule();
  twoCol(`N.° ${input.receiptNumber}`, '');
  center(input.dateLabel);
  twoCol('Cliente:', input.clientName);
  dashedRule();

  for (const item of input.items) {
    const label = item.quantity > 1 ? `${item.name} ×${item.quantity}` : item.name;
    doc.setFont('courier', 'normal').setFontSize(fontSize);
    for (const line of doc.splitTextToSize(label, contentWidth)) {
      doc.text(line, margin, y);
      y += lineH;
    }
    twoCol(`  ${item.quantity} x ${money(item.unitPrice, input.currency)}`, money(item.total, input.currency));
  }
  dashedRule();

  twoCol('Subtotal', money(input.subtotal, input.currency));
  if (input.discount > 0) twoCol('Descuento', `-${money(input.discount, input.currency)}`);
  if (input.tip > 0) twoCol('Propina', money(input.tip, input.currency));
  twoCol('TOTAL', money(input.total, input.currency), 'bold');
  y += lineH * 0.5;
  twoCol('Pago', input.paymentLabel);
  y += lineH;
  center('¡Gracias por tu compra!');

  return doc;
}

/** Nombre de archivo estable a partir del número de recibo: "ticket-a1b2c3d4.pdf". */
export function posTicketFileName(receiptNumber: string): string {
  return `ticket-${receiptNumber}.pdf`;
}

/** Genera el comprobante POS y dispara la descarga del navegador. */
export function downloadPosTicketPdf(input: InvoiceInput, width: PosTicketWidth = 80): void {
  buildPosTicketPdf(input, width).save(posTicketFileName(input.receiptNumber));
}

/**
 * Trae una imagen (p. ej. el logo del negocio, ya con `resolveMedia`) y la convierte a data URL para `addImage`, que
 * no acepta URLs remotas. `null` ante cualquier problema (sin logo, red, CORS): la factura se genera igual, sin logo.
 */
export async function toDataUrl(url: string | undefined): Promise<string | null> {
  if (!url) return null;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}
