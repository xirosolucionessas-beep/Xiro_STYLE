import './textDecoder';
import { jsPDF } from 'jspdf';

/**
 * Reporte de ventas/analítica en PDF, corporativo y listo para imprimir (sección 1.4 del encargo de mejoras de
 * Reportes/Catálogo): mismo patrón que `invoicePdf.ts` (jsPDF en el navegador, sin servidor, acentos dorados sobre
 * fondo blanco), pero con el contenido de un reporte — resumen ejecutivo, crecimiento, formas de pago, rendimiento
 * por profesional, más vendidos y el detalle día a día del periodo elegido. Todo llega ya formateado (moneda,
 * porcentajes, fechas): este archivo solo dibuja.
 */

export interface ReportsPdfRow {
  label: string;
  value: string;
}

export interface ReportsPdfPaymentRow {
  label: string;
  amountLabel: string;
  percent: number;
}

export interface ReportsPdfEmployeeRow {
  name: string;
  countLabel: string;
  amountLabel: string;
  percent: number;
}

export interface ReportsPdfRankRow {
  name: string;
  countLabel: string;
  amountLabel: string;
}

export interface ReportsPdfDailyRow {
  dateLabel: string;
  countLabel: string;
  amountLabel: string;
}

export interface ReportsPdfInput {
  businessName: string;
  /** "Calle 10 #5-20, Bogotá, Colombia" — ya compuesta (ver `businessAddressLine` de invoicePdf.ts). */
  businessAddress: string;
  businessPhone: string | null;
  /** Data URL ya cargado; null = sin logo, se omite sin más (nunca rompe el documento). */
  logoDataUrl: string | null;
  /** "1 – 30 sept 2026", ya formateado. */
  periodLabel: string;
  generatedAtLabel: string;
  kpis: ReportsPdfRow[];
  /** Comparativa de crecimiento (sección 1.2); `null` solo si no hay rango resuelto (no debería pasar en la práctica). */
  growth: { percentLabel: string | null; statusText: string; currentLabel: string; previousLabel: string } | null;
  /** "Total en Caja = Base Inicial + Ventas en Efectivo" del periodo; `null` si no hay base registrada en ningún día. */
  cashBalance: { openingLabel: string; cashSalesLabel: string; totalLabel: string } | null;
  paymentMethods: ReportsPdfPaymentRow[];
  employees: ReportsPdfEmployeeRow[];
  topServices: ReportsPdfRankRow[];
  topProducts: ReportsPdfRankRow[];
  dailyRows: ReportsPdfDailyRow[];
}

const GOLD: [number, number, number] = [176, 141, 62];
const INK: [number, number, number] = [26, 24, 21];
const MUTED: [number, number, number] = [110, 105, 97];
const LIGHT_FILL: [number, number, number] = [245, 240, 228];
const MARGIN = 15;
const PAGE_WIDTH = 210; // A4 en mm
const PAGE_BOTTOM = 282;

function ensureSpace(doc: jsPDF, y: number, needed: number): number {
  if (y + needed <= PAGE_BOTTOM) return y;
  doc.addPage();
  return MARGIN;
}

function sectionTitle(doc: jsPDF, text: string, y: number): number {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...GOLD);
  doc.text(text.toUpperCase(), MARGIN, y);
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(0.4);
  doc.line(MARGIN, y + 2, PAGE_WIDTH - MARGIN, y + 2);
  return y + 10;
}

/** Construye el PDF (sin guardarlo): separado de `downloadReportsPdf` para poder probarlo o reutilizar el documento. */
export function buildReportsPdf(input: ReportsPdfInput): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  let y = MARGIN;

  if (input.logoDataUrl) {
    try {
      doc.addImage(input.logoDataUrl, 'JPEG', MARGIN, y, 20, 20);
    } catch {
      /* logo dañado o formato no reconocido por jsPDF: el reporte sigue sin él */
    }
  }
  const textX = input.logoDataUrl ? MARGIN + 26 : MARGIN;
  doc.setTextColor(...INK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text(input.businessName, textX, y + 6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  if (input.businessAddress) doc.text(input.businessAddress, textX, y + 12);
  if (input.businessPhone) doc.text(input.businessPhone, textX, y + 17);

  doc.setTextColor(...GOLD);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('REPORTE DE VENTAS', PAGE_WIDTH - MARGIN, y + 6, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(...MUTED);
  doc.text(input.periodLabel, PAGE_WIDTH - MARGIN, y + 12, { align: 'right' });
  doc.text(input.generatedAtLabel, PAGE_WIDTH - MARGIN, y + 17, { align: 'right' });

  y += 26;
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(0.6);
  doc.line(MARGIN, y, PAGE_WIDTH - MARGIN, y);
  y += 10;

  // Resumen ejecutivo: KPIs en cuadrícula de 2 columnas.
  y = sectionTitle(doc, 'Resumen ejecutivo', y);
  const colWidth = (PAGE_WIDTH - MARGIN * 2 - 6) / 2;
  input.kpis.forEach((kpi, index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const x = MARGIN + col * (colWidth + 6);
    const boxY = y + row * 20;
    doc.setFillColor(...LIGHT_FILL);
    doc.roundedRect(x, boxY, colWidth, 16, 2, 2, 'F');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...MUTED);
    doc.text(kpi.label, x + 4, boxY + 6);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(...INK);
    doc.text(kpi.value, x + 4, boxY + 13);
  });
  y += Math.ceil(input.kpis.length / 2) * 20 + 6;

  // Comparativa de crecimiento (sección 1.2).
  if (input.growth) {
    y = ensureSpace(doc, y, 22);
    doc.setFillColor(...LIGHT_FILL);
    doc.roundedRect(MARGIN, y, PAGE_WIDTH - MARGIN * 2, 18, 2, 2, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(input.growth.percentLabel ? 14 : 11);
    doc.setTextColor(...GOLD);
    doc.text(input.growth.percentLabel ?? input.growth.statusText, MARGIN + 5, y + 8);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...INK);
    if (input.growth.percentLabel) doc.text(input.growth.statusText, MARGIN + 5, y + 14);
    doc.setFontSize(8.5);
    doc.setTextColor(...MUTED);
    doc.text(`Anterior: ${input.growth.previousLabel}   ·   Actual: ${input.growth.currentLabel}`, PAGE_WIDTH - MARGIN - 5, y + 11, { align: 'right' });
    y += 24;
  }

  // Total en caja (base inicial + ventas en efectivo).
  if (input.cashBalance) {
    y = ensureSpace(doc, y, 20);
    doc.setFillColor(...LIGHT_FILL);
    doc.roundedRect(MARGIN, y, PAGE_WIDTH - MARGIN * 2, 16, 2, 2, 'F');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...MUTED);
    doc.text(`Base inicial: ${input.cashBalance.openingLabel}   ·   Ventas en efectivo: ${input.cashBalance.cashSalesLabel}`, MARGIN + 4, y + 6);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...INK);
    doc.text(`Total en caja: ${input.cashBalance.totalLabel}`, MARGIN + 4, y + 12.5);
    y += 22;
  }

  // Formas de pago.
  if (input.paymentMethods.length > 0) {
    y = ensureSpace(doc, y, 14 + input.paymentMethods.length * 8);
    y = sectionTitle(doc, 'Formas de pago', y);
    for (const row of input.paymentMethods) {
      y = ensureSpace(doc, y, 8);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      doc.setTextColor(...INK);
      doc.text(row.label, MARGIN, y);
      doc.text(`${row.amountLabel}  (${row.percent}%)`, PAGE_WIDTH - MARGIN, y, { align: 'right' });
      y += 3;
      const barWidth = PAGE_WIDTH - MARGIN * 2;
      doc.setFillColor(230, 226, 218);
      doc.roundedRect(MARGIN, y, barWidth, 2.4, 1, 1, 'F');
      doc.setFillColor(...GOLD);
      doc.roundedRect(MARGIN, y, Math.max((barWidth * row.percent) / 100, 2), 2.4, 1, 1, 'F');
      y += 7;
    }
    y += 4;
  }

  // Rendimiento por profesional.
  if (input.employees.length > 0) {
    y = ensureSpace(doc, y, 16 + input.employees.length * 7);
    y = sectionTitle(doc, 'Rendimiento por profesional', y);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...INK);
    doc.text('Profesional', MARGIN, y);
    doc.text('Servicios', PAGE_WIDTH - MARGIN - 70, y, { align: 'right' });
    doc.text('Ingresos', PAGE_WIDTH - MARGIN - 28, y, { align: 'right' });
    doc.text('Participación', PAGE_WIDTH - MARGIN, y, { align: 'right' });
    y += 5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    for (const row of input.employees) {
      y = ensureSpace(doc, y, 7);
      doc.setTextColor(...INK);
      doc.text(row.name, MARGIN, y, { maxWidth: 90 });
      doc.setTextColor(...MUTED);
      doc.text(row.countLabel, PAGE_WIDTH - MARGIN - 70, y, { align: 'right' });
      doc.text(row.amountLabel, PAGE_WIDTH - MARGIN - 28, y, { align: 'right' });
      doc.text(`${row.percent}%`, PAGE_WIDTH - MARGIN, y, { align: 'right' });
      y += 6.5;
    }
    y += 4;
  }

  // Más vendidos: servicios y productos, lado a lado si caben.
  const rankSection = (title: string, rows: ReportsPdfRankRow[]) => {
    if (rows.length === 0) return;
    y = ensureSpace(doc, y, 14 + rows.length * 6.5);
    y = sectionTitle(doc, title, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    rows.forEach((row, index) => {
      y = ensureSpace(doc, y, 6.5);
      doc.setTextColor(...INK);
      doc.text(`${index + 1}. ${row.name}`, MARGIN, y, { maxWidth: 110 });
      doc.setTextColor(...MUTED);
      doc.text(row.countLabel, PAGE_WIDTH - MARGIN - 28, y, { align: 'right' });
      doc.setTextColor(...INK);
      doc.text(row.amountLabel, PAGE_WIDTH - MARGIN, y, { align: 'right' });
      y += 6.5;
    });
    y += 4;
  };
  rankSection('Servicios más solicitados', input.topServices);
  rankSection('Productos más vendidos', input.topProducts);

  // Detalle por día (o por mes, en periodos largos).
  if (input.dailyRows.length > 0) {
    y = ensureSpace(doc, y, 14);
    y = sectionTitle(doc, 'Detalle del periodo', y);
    doc.setFillColor(...LIGHT_FILL);
    doc.rect(MARGIN, y - 5, PAGE_WIDTH - MARGIN * 2, 7, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...INK);
    doc.text('Fecha', MARGIN + 2, y);
    doc.text('Facturado', PAGE_WIDTH - MARGIN - 2, y, { align: 'right' });
    y += 7;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    for (const row of input.dailyRows) {
      y = ensureSpace(doc, y, 6);
      doc.setTextColor(...INK);
      doc.text(row.dateLabel, MARGIN + 2, y);
      doc.setTextColor(...MUTED);
      doc.text(row.countLabel, PAGE_WIDTH - MARGIN - 48, y, { align: 'right' });
      doc.setTextColor(...INK);
      doc.text(row.amountLabel, PAGE_WIDTH - MARGIN - 2, y, { align: 'right' });
      y += 6;
      doc.setDrawColor(230, 226, 218);
      doc.setLineWidth(0.2);
      doc.line(MARGIN, y - 4, PAGE_WIDTH - MARGIN, y - 4);
    }
  }

  return doc;
}

/** Nombre de archivo estable a partir del periodo. */
export function reportsPdfFileName(periodLabel: string): string {
  return `reporte-${periodLabel.replace(/[^\w.-]+/g, '-').toLowerCase()}.pdf`;
}
