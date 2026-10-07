/**
 * Catálogo en PDF (web). El documento lo arma `@/lib/exports/catalogPdf`, compartido con Android/iOS; aquí viven la
 * descarga del navegador y la preparación de imágenes con `canvas` (en el teléfono: `@/lib/exports/nativeFiles`).
 */
import QRCode from 'qrcode';
import { buildCatalogPdf, catalogPdfFileName, type CatalogPdfInput } from '@/lib/exports/catalogPdf';

export * from '@/lib/exports/catalogPdf';

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

/**
 * Carga una imagen y la reduce a un máximo de 1600px por lado, JPEG calidad 85 (el catálogo puede tener muchas fotos
 * de alta resolución; sin esto el PDF pesaría demasiado y la interfaz se congelaría armándolo). `null` si la URL es
 * vacía o la imagen no se pudo cargar — el llamador ya trata eso como "sin foto".
 */
export async function toCompressedDataUrl(url: string | undefined | null, maxSide = 1600, quality = 0.85): Promise<string | null> {
  if (!url) return null;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#ffffff'; // por si la imagen original tiene transparencia: un JPEG no la soporta
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    return canvas.toDataURL('image/jpeg', quality);
  } catch {
    return null;
  }
}
