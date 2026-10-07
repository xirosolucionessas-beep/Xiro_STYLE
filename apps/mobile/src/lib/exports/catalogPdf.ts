import './textDecoder';
import { jsPDF } from 'jspdf';
import { normalizePhone } from '@xiro/shared';

/**
 * Catálogo del negocio en PDF, para compartir por WhatsApp o imprimir (Entrega C del encargo de la página pública):
 * portada de marca, un índice si hace falta, UNA HOJA COMPLETA POR SERVICIO O PRODUCTO (con todas sus fotos) y una
 * contraportada con agradecimiento, contacto y un código QR a la página pública de reservas. A4 horizontal, para que
 * cada pieza se lea como un cartel de precios de verdad. Respeta EXACTAMENTE el filtro de categoría que el usuario
 * tenía activo en el Catálogo — el llamador ya filtra `items` antes de construir este input, este archivo solo dibuja
 * lo que recibe. Solo datos públicos: nunca costo unitario, stock ni notas internas.
 */

export interface CatalogPdfItem {
  name: string;
  /** "" si el artículo no tiene categoría asignada (no debería pasar, pero nunca rompe el documento). */
  categoryLabel: string;
  description: string;
  priceLabel: string;
  /** Minutos si es un servicio; `null` en productos (no se dibuja el renglón de duración). */
  durationMinutes: number | null;
  /** Todas las fotos ya cargadas (comprimidas, ver `toCompressedDataUrl`), en el orden del negocio. [] = sin fotos. */
  imageDataUrls: string[];
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

type Rgb = [number, number, number];

// Misma familia de color que el resto de la app (tokens "neutral multi-negocio" ya verificados por contraste),
// no la identidad de barbería: Xiro Style sirve barberías, salones, spa y uñas por igual.
const DARK_BG: Rgb = [21, 19, 15]; // #15130f
const DARK_TEXT: Rgb = [243, 238, 227]; // #f3eee3
const DARK_MUTED: Rgb = [183, 173, 155]; // #b7ad9b
const DARK_BORDER: Rgb = [57, 51, 43]; // #39332b
const ACCENT: Rgb = [205, 166, 104]; // #cda668 — dorado, para texto/trazos sobre fondo oscuro
const ACCENT_ON_LIGHT: Rgb = [122, 92, 18]; // #7a5c12 — el mismo acento, oscurecido para leerse sobre fondo claro
const LIGHT_BG: Rgb = [246, 242, 233]; // #f6f2e9
const PANEL_WHITE: Rgb = [255, 255, 255];
const INK: Rgb = [32, 27, 20]; // #201b14
const MUTED: Rgb = [104, 95, 79]; // #685f4f
const BORDER: Rgb = [227, 219, 200]; // #e3dbc8

const MARGIN = 14;
const PAGE_WIDTH = 297; // A4 horizontal, mm
const PAGE_HEIGHT = 210;
const CONTENT_W = PAGE_WIDTH - MARGIN * 2;

function setFill(doc: jsPDF, c: Rgb) {
  doc.setFillColor(c[0], c[1], c[2]);
}
function setText(doc: jsPDF, c: Rgb) {
  doc.setTextColor(c[0], c[1], c[2]);
}
function setDraw(doc: jsPDF, c: Rgb) {
  doc.setDrawColor(c[0], c[1], c[2]);
}

function darkPage(doc: jsPDF): void {
  setFill(doc, DARK_BG);
  doc.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, 'F');
}
function lightPage(doc: jsPDF): void {
  setFill(doc, LIGHT_BG);
  doc.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, 'F');
}

/** Logo o iniciales en un círculo con aro de latón, sin deformar la imagen (se ve completa, nunca recortada). */
function drawCircularLogo(doc: jsPDF, dataUrl: string | null, name: string, cx: number, cy: number, diameter: number, ringColor: Rgb, bgColor: Rgb, textColor: Rgb): void {
  const r = diameter / 2;
  setFill(doc, bgColor);
  doc.circle(cx, cy, r, 'F');
  let drew = false;
  if (dataUrl) {
    try {
      doc.saveGraphicsState();
      doc.circle(cx, cy, r, null);
      doc.clip();
      doc.discardPath();
      const props = doc.getImageProperties(dataUrl);
      const scale = Math.min(diameter / props.width, diameter / props.height) * 0.88;
      const w = props.width * scale;
      const h = props.height * scale;
      doc.addImage(dataUrl, cx - w / 2, cy - h / 2, w, h);
      doc.restoreGraphicsState();
      drew = true;
    } catch {
      /* logo dañado: se cae a las iniciales */
    }
  }
  if (!drew) {
    setText(doc, textColor);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(diameter * 0.9);
    doc.text((name.trim().charAt(0) || '·').toUpperCase(), cx, cy + diameter * 0.32, { align: 'center' });
  }
  setDraw(doc, ringColor);
  doc.setLineWidth(Math.max(0.4, diameter * 0.022));
  doc.circle(cx, cy, r, 'S');
}

/** Dibuja la imagen ajustada dentro de la caja, sin deformarla (contain: letterbox si la proporción no coincide). */
function drawContainImage(doc: jsPDF, dataUrl: string, x: number, y: number, boxW: number, boxH: number): void {
  try {
    const props = doc.getImageProperties(dataUrl);
    const ratio = Math.min(boxW / props.width, boxH / props.height);
    const w = props.width * ratio;
    const h = props.height * ratio;
    doc.addImage(dataUrl, x + (boxW - w) / 2, y + (boxH - h) / 2, w, h);
  } catch {
    /* imagen dañada o formato no reconocido: el panel sigue sin ella */
  }
}

/** Panel blanco con borde fino y esquinas redondeadas para una foto (o el dibujo de reemplazo si no hay ninguna). */
function photoPanel(doc: jsPDF, dataUrl: string | null, x: number, y: number, w: number, h: number): void {
  setFill(doc, PANEL_WHITE);
  setDraw(doc, BORDER);
  doc.setLineWidth(0.3);
  doc.roundedRect(x, y, w, h, 3, 3, 'FD');
  if (dataUrl) {
    drawContainImage(doc, dataUrl, x + 3, y + 3, w - 6, h - 6);
  } else {
    // Ícono neutro de "sin imagen" (nunca un hueco vacío ni iconografía exclusiva de un solo tipo de negocio).
    setDraw(doc, [200, 193, 178]);
    doc.setLineWidth(1.1);
    const cx = x + w / 2;
    const cy = y + h / 2;
    const s = Math.min(w, h) * 0.16;
    doc.roundedRect(cx - s, cy - s * 0.72, s * 2, s * 1.44, 1.5, 1.5, 'S');
    doc.circle(cx - s * 0.45, cy - s * 0.18, s * 0.22, 'S');
    doc.line(cx - s * 0.8, cy + s * 0.5, cx - s * 0.1, cy - s * 0.1);
    doc.line(cx - s * 0.1, cy - s * 0.1, cx + s * 0.3, cy + s * 0.2);
    doc.line(cx + s * 0.3, cy + s * 0.2, cx + s * 0.8, cy - s * 0.3);
    doc.line(cx + s * 0.8, cy - s * 0.3, cx + s * 0.8, cy + s * 0.5);
  }
}

function contactLines(input: CatalogPdfInput): string[] {
  const whatsapp = formatPhoneDisplay(input.whatsapp);
  const phone = formatPhoneDisplay(input.phone);
  return [whatsapp ? `WhatsApp: ${whatsapp}` : null, phone && phone !== whatsapp ? `Tel: ${phone}` : null, input.address || null, ...input.social].filter((line): line is string => Boolean(line));
}

// ---------- 1. Portada ----------

function coverPage(doc: jsPDF, input: CatalogPdfInput): void {
  darkPage(doc);
  const cx = PAGE_WIDTH / 2;
  let y = 42;

  drawCircularLogo(doc, input.logoDataUrl, input.businessName, cx, y, 64, ACCENT, [30, 27, 22], ACCENT);
  y += 44;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(40);
  setText(doc, DARK_TEXT);
  doc.text(input.businessName, cx, y, { align: 'center', maxWidth: PAGE_WIDTH - MARGIN * 4 });
  y += 11;

  if (input.tagline) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(13);
    setText(doc, DARK_MUTED);
    doc.text(input.tagline, cx, y, { align: 'center', maxWidth: PAGE_WIDTH - MARGIN * 6 });
    y += 10;
  }

  setDraw(doc, ACCENT);
  doc.setLineWidth(0.5);
  doc.line(cx - 22, y, cx + 22, y);
  y += 11;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  setText(doc, [255, 255, 255]);
  const now = new Date();
  const monthYear = now.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });
  doc.text(`Catálogo · ${monthYear}`, cx, y, { align: 'center' });
  if (input.filterLabel) {
    y += 7;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10.5);
    setText(doc, ACCENT);
    doc.text(input.filterLabel, cx, y, { align: 'center' });
  }

  let contactY = PAGE_HEIGHT - 32;
  setDraw(doc, DARK_BORDER);
  doc.setLineWidth(0.3);
  doc.line(cx - 60, contactY, cx + 60, contactY);
  contactY += 7;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  setText(doc, DARK_MUTED);
  for (const line of contactLines(input)) {
    doc.text(line, cx, contactY, { align: 'center' });
    contactY += 5.5;
  }
}

// ---------- 2. Contenido (índice) ----------

const CONTENT_ROW_H = 10.5;
const CONTENT_TOP = MARGIN + 20;
const CONTENT_ROWS_PER_PAGE = Math.floor((PAGE_HEIGHT - CONTENT_TOP - MARGIN) / CONTENT_ROW_H);

function needsContentPage(input: CatalogPdfInput): boolean {
  const categories = new Set(input.items.map((i) => i.categoryLabel));
  return categories.size > 1 || input.items.length > 8;
}

function contentPageCount(input: CatalogPdfInput): number {
  if (!needsContentPage(input)) return 0;
  return Math.max(1, Math.ceil(input.items.length / CONTENT_ROWS_PER_PAGE));
}

function contentPageHeader(doc: jsPDF, title: string): void {
  lightPage(doc);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  setText(doc, INK);
  doc.text(title, MARGIN, MARGIN + 8);
  setDraw(doc, BORDER);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, MARGIN + 13, PAGE_WIDTH - MARGIN, MARGIN + 13);
}

function contentPages(doc: jsPDF, input: CatalogPdfInput, pageNumberOf: number[]): void {
  if (!needsContentPage(input)) return;
  const total = contentPageCount(input);
  let index = 0;
  for (let page = 0; page < total; page++) {
    doc.addPage();
    contentPageHeader(doc, 'Contenido');
    let y = CONTENT_TOP;
    const end = Math.min(index + CONTENT_ROWS_PER_PAGE, input.items.length);
    for (; index < end; index++) {
      const item = input.items[index]!;
      const nameY = item.categoryLabel ? y + 7 : y + 4.5;
      if (item.categoryLabel) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        setText(doc, MUTED);
        doc.text(item.categoryLabel, MARGIN, y + 2.8);
      }
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      setText(doc, INK);
      const nameW = doc.getTextWidth(item.name);
      doc.text(item.name, MARGIN, nameY);
      const pageLabel = String(pageNumberOf[index]);
      const pageLabelW = doc.getTextWidth(pageLabel);
      setDraw(doc, BORDER);
      doc.setLineWidth(0.2);
      doc.setLineDashPattern([0.6, 1.2], 0);
      doc.line(MARGIN + nameW + 3, nameY - 1.4, PAGE_WIDTH - MARGIN - pageLabelW - 3, nameY - 1.4);
      doc.setLineDashPattern([], 0);
      setText(doc, MUTED);
      doc.text(pageLabel, PAGE_WIDTH - MARGIN, nameY, { align: 'right' });
      y += CONTENT_ROW_H;
      setDraw(doc, BORDER);
      doc.setLineWidth(0.15);
      doc.line(MARGIN, y - 2.5, PAGE_WIDTH - MARGIN, y - 2.5);
    }
  }
}

// ---------- 3. Una hoja por servicio o producto ----------

function itemPageHeader(doc: jsPDF, input: CatalogPdfInput, index: number, total: number, categoryLabel: string): void {
  const logoY = MARGIN + 7;
  drawCircularLogo(doc, input.logoDataUrl, input.businessName, MARGIN + 7, logoY, 14, ACCENT_ON_LIGHT, PANEL_WHITE, ACCENT_ON_LIGHT);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  setText(doc, INK);
  doc.text(input.businessName, MARGIN + 16, logoY + 1.5, { maxWidth: 90 });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  setText(doc, MUTED);
  const counter = `${index + 1} / ${total}`;
  doc.text(counter, PAGE_WIDTH - MARGIN, logoY - 1, { align: 'right' });
  if (categoryLabel) {
    setText(doc, ACCENT_ON_LIGHT);
    doc.text(categoryLabel, PAGE_WIDTH - MARGIN, logoY + 3.6, { align: 'right' });
  }

  setDraw(doc, BORDER);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, MARGIN + 16, PAGE_WIDTH - MARGIN, MARGIN + 16);
}

function itemPageFooter(doc: jsPDF, input: CatalogPdfInput): void {
  const y = PAGE_HEIGHT - MARGIN - 10;
  setDraw(doc, BORDER);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, y, PAGE_WIDTH - MARGIN, y);
  let textX = MARGIN;
  if (input.qrDataUrl && input.bookingUrl) {
    doc.addImage(input.qrDataUrl, MARGIN, y + 2.5, 14, 14);
    textX = MARGIN + 18;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    setText(doc, ACCENT_ON_LIGHT);
    doc.text('Reserva en línea', textX, y + 7);
  }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  setText(doc, MUTED);
  doc.text(contactLines(input).join('  ·  '), textX, y + (input.qrDataUrl ? 12 : 6), { maxWidth: PAGE_WIDTH - MARGIN - textX });
}

const COL_GAP = 10;
const LEFT_COL_W = (CONTENT_W - COL_GAP) * 0.55;
const RIGHT_COL_W = CONTENT_W - COL_GAP - LEFT_COL_W;
const COL_TOP = MARGIN + 22;
const COL_BOTTOM = PAGE_HEIGHT - MARGIN - 14;
const MAIN_PHOTOS_ON_PAGE = 5;

/** Columna izquierda: foto principal grande y, si hay más, miniaturas del resto debajo (hasta 5 en total en esta hoja). */
function photoColumn(doc: jsPDF, images: string[]): void {
  const x = MARGIN;
  const shown = images.slice(0, MAIN_PHOTOS_ON_PAGE);
  const hasThumbs = shown.length > 1;
  const mainH = hasThumbs ? (COL_BOTTOM - COL_TOP) * 0.76 : COL_BOTTOM - COL_TOP;
  photoPanel(doc, shown[0] ?? null, x, COL_TOP, LEFT_COL_W, mainH);
  if (hasThumbs) {
    const thumbs = shown.slice(1);
    const gap = 4;
    const thumbW = (LEFT_COL_W - gap * (thumbs.length - 1)) / thumbs.length;
    const thumbY = COL_TOP + mainH + 5;
    const thumbH = COL_BOTTOM - thumbY;
    thumbs.forEach((src, i) => {
      photoPanel(doc, src, x + i * (thumbW + gap), thumbY, thumbW, thumbH);
    });
  }
}

/**
 * Imprime texto envuelto reduciendo el tamaño de letra hasta que quepa en el alto disponible — nunca lo corta (ni
 * con "…" ni a medias): si ni al tamaño mínimo cabe, se sigue imprimiendo completo aunque se salga del renglón
 * calculado (mejor que perder texto). Devuelve el Y donde quedó el cursor, listo para lo siguiente.
 */
function fitWrappedText(doc: jsPDF, text: string, x: number, y: number, w: number, maxH: number, startSize: number, minSize: number, lineHeightRatio: number): number {
  let size = startSize;
  let lines = doc.setFontSize(size).splitTextToSize(text, w) as string[];
  let lineH = size * lineHeightRatio;
  while (lines.length * lineH > maxH && size > minSize) {
    size -= 0.5;
    lineH = size * lineHeightRatio;
    lines = doc.setFontSize(size).splitTextToSize(text, w) as string[];
  }
  doc.setFontSize(size);
  for (const line of lines) {
    doc.text(line, x, y);
    y += lineH;
  }
  return y;
}

function detailColumn(doc: jsPDF, item: CatalogPdfItem): void {
  const x = MARGIN + LEFT_COL_W + COL_GAP;
  let y = COL_TOP + 4;

  if (item.categoryLabel) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    setText(doc, ACCENT_ON_LIGHT);
    doc.text(item.categoryLabel, x, y);
    y += 9;
  }

  doc.setFont('helvetica', 'bold');
  setText(doc, INK);
  y = fitWrappedText(doc, item.name, x, y + 9, RIGHT_COL_W, 46, 32, 18, 0.37) + 4;

  if (item.description) {
    doc.setFont('helvetica', 'normal');
    setText(doc, MUTED);
    // El bloque de precio necesita ~40mm abajo; lo demás es presupuesto real para la descripción — si ni reduciendo
    // el tamaño cabe, fitWrappedText sigue imprimiéndola completa y el precio se corre más abajo (nunca se solapan).
    const budget = Math.max(24, COL_BOTTOM - 40 - y);
    y = fitWrappedText(doc, item.description, x, y + 5, RIGHT_COL_W, budget, 12, 8.5, 0.467) + 3;
  }

  if (item.durationMinutes != null) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10.5);
    setText(doc, INK);
    doc.text(`Duración: ${item.durationMinutes} min`, x, y + 3);
    y += 8;
  }

  // Bloque de precio: anclado abajo de la columna, o justo debajo del contenido si este es más largo de lo usual.
  const priceY = Math.max(COL_BOTTOM - 8, y + 24);
  setDraw(doc, BORDER);
  doc.setLineWidth(0.3);
  doc.line(x, priceY - 16, x + RIGHT_COL_W, priceY - 16);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  setText(doc, MUTED);
  doc.text('Precio', x, priceY - 9);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(34);
  setText(doc, ACCENT_ON_LIGHT);
  doc.text(item.priceLabel, x, priceY + 4);
}

function itemPage(doc: jsPDF, input: CatalogPdfInput, item: CatalogPdfItem, index: number, total: number): void {
  doc.addPage();
  lightPage(doc);
  itemPageHeader(doc, input, index, total, item.categoryLabel);
  photoColumn(doc, item.imageDataUrls);
  detailColumn(doc, item);
  itemPageFooter(doc, input);

  if (item.imageDataUrls.length > MAIN_PHOTOS_ON_PAGE) {
    doc.addPage();
    lightPage(doc);
    itemPageHeader(doc, input, index, total, item.categoryLabel);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(10);
    setText(doc, MUTED);
    doc.text(`${item.name} · continúa`, MARGIN, MARGIN + 21);
    const rest = item.imageDataUrls.slice(MAIN_PHOTOS_ON_PAGE);
    const perRow = 4;
    const gap = 6;
    const cellW = (CONTENT_W - gap * (perRow - 1)) / perRow;
    const cellH = 60;
    rest.forEach((src, i) => {
      const col = i % perRow;
      const row = Math.floor(i / perRow);
      photoPanel(doc, src, MARGIN + col * (cellW + gap), COL_TOP + 6 + row * (cellH + gap), cellW, cellH);
    });
  }
}

// ---------- 4. Cierre ----------

function closingPage(doc: jsPDF, input: CatalogPdfInput): void {
  doc.addPage();
  darkPage(doc);
  const cx = PAGE_WIDTH / 2;
  let y = 58;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  setText(doc, ACCENT);
  doc.text('¡Gracias por tu interés!', cx, y, { align: 'center' });
  y += 11;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(12);
  setText(doc, DARK_TEXT);
  doc.text('Escríbenos para agendar tu cita o resolver cualquier duda.', cx, y, { align: 'center', maxWidth: PAGE_WIDTH - MARGIN * 4 });
  y += 16;

  if (input.qrDataUrl) {
    const size = 50;
    doc.addImage(input.qrDataUrl, cx - size / 2, y, size, size);
    y += size + 7;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    setText(doc, ACCENT);
    doc.text('Escanea para reservar o ver el catálogo en línea', cx, y, { align: 'center' });
    y += 11;
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  setText(doc, [255, 255, 255]);
  for (const line of contactLines(input)) {
    doc.text(line, cx, y, { align: 'center' });
    y += 6.5;
  }
}

// ---------- Orquestación ----------

function pageNumbersForItems(input: CatalogPdfInput): number[] {
  const startPage = 1 + contentPageCount(input) + 1; // portada + índice (si lo hay) + primera hoja de pieza
  const out: number[] = [];
  let page = startPage;
  for (const item of input.items) {
    out.push(page);
    page += item.imageDataUrls.length > MAIN_PHOTOS_ON_PAGE ? 2 : 1;
  }
  return out;
}

/** Construye el PDF (sin guardarlo): separado de `downloadCatalogPdf` para poder probarlo o reutilizar el documento. */
export function buildCatalogPdf(input: CatalogPdfInput): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  doc.setProperties({ title: `Catálogo – ${input.businessName}` });
  coverPage(doc, input);
  const pageNumbers = pageNumbersForItems(input);
  contentPages(doc, input, pageNumbers);
  input.items.forEach((item, index) => itemPage(doc, input, item, index, input.items.length));
  closingPage(doc, input);
  return doc;
}

/** Quita tildes/diéresis conservando la letra base ("categoría" → "categoria", nunca "categor-a"). */
function stripAccents(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Nombre de archivo estable a partir del negocio y, si hay filtro, la categoría. */
export function catalogPdfFileName(businessName: string, filterLabel: string | null): string {
  const suffix = filterLabel ? `-${filterLabel}` : '';
  return (
    stripAccents(`catalogo-${businessName}${suffix}`)
      .replace(/[^\w.-]+/g, '-')
      .toLowerCase()
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') + '.pdf'
  );
}

/** Teléfono legible solo para mostrar ("+57 313 515 0072"); lo guardado no cambia, esto es solo presentación. */
export function formatPhoneDisplay(phone: string | null): string | null {
  if (!phone) return null;
  const normalized = normalizePhone(phone);
  if (!normalized) return phone.trim() || null;
  const last10 = normalized.slice(-10);
  const country = normalized.slice(0, normalized.length - 10) || '57';
  const groups = [last10.slice(0, 3), last10.slice(3, 6), last10.slice(6)].filter(Boolean);
  return `+${country} ${groups.join(' ')}`;
}
