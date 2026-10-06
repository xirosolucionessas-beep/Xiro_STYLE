import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';

/**
 * Catálogo del negocio en PDF, para compartir por WhatsApp o imprimir (sección 2 del encargo de mejoras de
 * Reportes/Catálogo): portada oscura de marca (logo, nombre, datos de contacto) + cuadrícula clara de servicios o
 * productos (para que se lea bien impresa) + contraportada con agradecimiento, contacto y un código QR a la página
 * pública de reservas. Respeta EXACTAMENTE el filtro de categoría que el usuario tenía activo en el Catálogo — el
 * llamador ya filtra `items` antes de construir este input, este archivo solo dibuja lo que recibe.
 */

export interface CatalogPdfItem {
  name: string;
  /** "" si el artículo no tiene categoría asignada (no debería pasar, pero nunca rompe el documento). */
  categoryLabel: string;
  description: string;
  priceLabel: string;
  /** Data URL ya cargada; null = sin foto, se usa un estado visual elegante en su lugar. */
  imageDataUrl: string | null;
}

export interface CatalogPdfInput {
  businessName: string;
  /** Frase corta del perfil público ("Cortes y color a tu medida"); "" si no la configuró. */
  tagline: string;
  logoDataUrl: string | null;
  whatsapp: string | null;
  phone: string | null;
  address: string;
  /** Instagram/Facebook/TikTok/sitio web, ya con su etiqueta armada ("Instagram: @negocio"); vacío = no mostrar nada. */
  social: string[];
  /** "Categoría: Uñas" ya traducido; `null` = catálogo completo, sin filtro. */
  filterLabel: string | null;
  items: CatalogPdfItem[];
  /** URL pública de reservas/catálogo, si el negocio ya publicó su página; `null` = se omite el QR y el enlace. */
  bookingUrl: string | null;
  /** Ya generado con `toQrDataUrl(bookingUrl)`; `null` si no hay `bookingUrl` o el QR no se pudo generar. */
  qrDataUrl: string | null;
}

const GOLD: [number, number, number] = [217, 182, 54];
const DARK_BG: [number, number, number] = [18, 16, 13];
const INK: [number, number, number] = [26, 24, 21];
const MUTED: [number, number, number] = [110, 105, 97];
const CARD_BG: [number, number, number] = [245, 240, 228];
const MARGIN = 14;
const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const PAGE_BOTTOM = 280;

function coverPage(doc: jsPDF, input: CatalogPdfInput): void {
  doc.setFillColor(...DARK_BG);
  doc.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, 'F');

  let y = 60;
  if (input.logoDataUrl) {
    try {
      doc.addImage(input.logoDataUrl, 'JPEG', PAGE_WIDTH / 2 - 17, y, 34, 34);
      y += 44;
    } catch {
      /* logo dañado: la portada sigue sin él */
    }
  }

  doc.setTextColor(...GOLD);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(26);
  doc.text(input.businessName, PAGE_WIDTH / 2, y, { align: 'center' });
  y += 10;

  if (input.tagline) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(12);
    doc.setTextColor(230, 224, 210);
    doc.text(input.tagline, PAGE_WIDTH / 2, y, { align: 'center', maxWidth: PAGE_WIDTH - MARGIN * 4 });
    y += 10;
  }

  doc.setDrawColor(...GOLD);
  doc.setLineWidth(0.5);
  doc.line(PAGE_WIDTH / 2 - 20, y, PAGE_WIDTH / 2 + 20, y);
  y += 12;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(255, 255, 255);
  doc.text('CATÁLOGO', PAGE_WIDTH / 2, y, { align: 'center' });
  if (input.filterLabel) {
    y += 7;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(...GOLD);
    doc.text(input.filterLabel, PAGE_WIDTH / 2, y, { align: 'center' });
  }

  // Contacto, anclado cerca del pie de la portada.
  let contactY = PAGE_HEIGHT - 70;
  doc.setDrawColor(70, 64, 52);
  doc.setLineWidth(0.3);
  doc.line(MARGIN + 20, contactY, PAGE_WIDTH - MARGIN - 20, contactY);
  contactY += 10;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10.5);
  doc.setTextColor(230, 224, 210);
  const contactLines = [input.whatsapp ? `WhatsApp: ${input.whatsapp}` : null, input.phone && input.phone !== input.whatsapp ? `Tel: ${input.phone}` : null, input.address || null, ...input.social].filter((line): line is string => Boolean(line));
  for (const line of contactLines) {
    doc.text(line, PAGE_WIDTH / 2, contactY, { align: 'center' });
    contactY += 6;
  }
}

function ensureGridSpace(doc: jsPDF, y: number, needed: number): number {
  if (y + needed <= PAGE_BOTTOM) return y;
  doc.addPage();
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, 'F');
  return MARGIN;
}

/** Dibuja la imagen ajustada dentro de la caja, sin deformarla (letterbox si la proporción no coincide). */
function drawFitImage(doc: jsPDF, dataUrl: string, x: number, y: number, boxW: number, boxH: number): void {
  try {
    const props = doc.getImageProperties(dataUrl);
    const ratio = Math.min(boxW / props.width, boxH / props.height);
    const w = props.width * ratio;
    const h = props.height * ratio;
    doc.addImage(dataUrl, x + (boxW - w) / 2, y + (boxH - h) / 2, w, h);
  } catch {
    /* imagen dañada o formato no reconocido: la tarjeta sigue sin ella (ver el llamador, que ya revisa null primero) */
  }
}

function itemGrid(doc: jsPDF, input: CatalogPdfInput): void {
  doc.addPage();
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, 'F');
  let y = MARGIN;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(...INK);
  doc.text(input.filterLabel ?? 'Catálogo completo', MARGIN, y + 6);
  y += 14;

  const gap = 6;
  const cardW = (PAGE_WIDTH - MARGIN * 2 - gap) / 2;
  const imageH = 32;
  const cardH = 58;

  input.items.forEach((item, index) => {
    const col = index % 2;
    if (col === 0) y = ensureGridSpace(doc, y, cardH + gap);
    const x = MARGIN + col * (cardW + gap);
    const cardY = y;

    doc.setFillColor(...CARD_BG);
    doc.roundedRect(x, cardY, cardW, cardH, 2, 2, 'F');

    if (item.imageDataUrl) {
      drawFitImage(doc, item.imageDataUrl, x + 2, cardY + 2, cardW - 4, imageH);
    } else {
      doc.setFillColor(230, 224, 210);
      doc.roundedRect(x + 2, cardY + 2, cardW - 4, imageH, 2, 2, 'F');
      doc.setTextColor(...MUTED);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(20);
      doc.text(item.name.trim().charAt(0).toUpperCase() || '·', x + cardW / 2, cardY + 2 + imageH / 2 + 3, { align: 'center' });
    }

    let textY = cardY + imageH + 9;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...INK);
    doc.text(item.name, x + 3, textY, { maxWidth: cardW - 6 });
    textY += 5;

    if (item.categoryLabel) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(...GOLD);
      doc.text(item.categoryLabel.toUpperCase(), x + 3, textY);
      textY += 4.5;
    }

    if (item.description) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(...MUTED);
      const lines = doc.splitTextToSize(item.description, cardW - 6).slice(0, 2);
      for (const line of lines) {
        doc.text(line, x + 3, textY);
        textY += 3.8;
      }
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(...INK);
    doc.text(item.priceLabel, x + cardW - 3, cardY + cardH - 4, { align: 'right' });

    if (col === 1) y += cardH + gap;
  });
}

function backCover(doc: jsPDF, input: CatalogPdfInput): void {
  doc.addPage();
  doc.setFillColor(...DARK_BG);
  doc.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, 'F');

  let y = 90;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(...GOLD);
  doc.text('¡Gracias por tu interés!', PAGE_WIDTH / 2, y, { align: 'center' });
  y += 10;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(230, 224, 210);
  doc.text('Escríbenos para agendar tu cita o resolver cualquier duda.', PAGE_WIDTH / 2, y, { align: 'center', maxWidth: PAGE_WIDTH - MARGIN * 4 });
  y += 14;

  if (input.qrDataUrl) {
    const size = 42;
    doc.addImage(input.qrDataUrl, PAGE_WIDTH / 2 - size / 2, y, size, size);
    y += size + 6;
    doc.setFontSize(9.5);
    doc.setTextColor(...GOLD);
    doc.text('Escanea para reservar o ver el catálogo en línea', PAGE_WIDTH / 2, y, { align: 'center' });
    y += 10;
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10.5);
  doc.setTextColor(255, 255, 255);
  const lines = [input.whatsapp ? `WhatsApp: ${input.whatsapp}` : null, input.phone && input.phone !== input.whatsapp ? `Tel: ${input.phone}` : null, input.address || null, ...input.social].filter((line): line is string => Boolean(line));
  for (const line of lines) {
    doc.text(line, PAGE_WIDTH / 2, y, { align: 'center' });
    y += 6;
  }
}

/** Construye el PDF (sin guardarlo): separado de `downloadCatalogPdf` para poder probarlo o reutilizar el documento. */
export function buildCatalogPdf(input: CatalogPdfInput): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  coverPage(doc, input);
  if (input.items.length > 0) itemGrid(doc, input);
  backCover(doc, input);
  return doc;
}

/** Nombre de archivo estable a partir del negocio y, si hay filtro, la categoría. */
export function catalogPdfFileName(businessName: string, filterLabel: string | null): string {
  const suffix = filterLabel ? `-${filterLabel}` : '';
  return `catalogo-${businessName}${suffix}`.replace(/[^\w.-]+/g, '-').toLowerCase().replace(/-+/g, '-') + '.pdf';
}

/** Genera el catálogo y dispara la descarga del navegador. */
export function downloadCatalogPdf(input: CatalogPdfInput): void {
  buildCatalogPdf(input).save(catalogPdfFileName(input.businessName, input.filterLabel));
}

/** QR de la URL pública del catálogo/reservas, como data URL lista para `addImage`; `null` si no hay URL o falla la generación. */
export async function toQrDataUrl(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    return await QRCode.toDataURL(url, { margin: 1, width: 400, color: { dark: '#12100d', light: '#ffffff' } });
  } catch {
    return null;
  }
}
