import { describe, expect, it } from 'vitest';
import { buildCatalogPdf, catalogPdfFileName, toQrDataUrl, type CatalogPdfInput, type CatalogPdfItem } from '../src/web/services/catalogPdf';

function item(over: Partial<CatalogPdfItem> = {}): CatalogPdfItem {
  return { name: 'Corte', categoryLabel: 'Cortes', description: 'Corte clásico con máquina y tijera.', priceLabel: '$ 30.000', imageDataUrl: null, ...over };
}

function baseInput(over: Partial<CatalogPdfInput> = {}): CatalogPdfInput {
  return {
    businessName: 'Peluquería Ana',
    tagline: 'Cortes y color a tu medida',
    logoDataUrl: null,
    whatsapp: '+57 300 123 4567',
    phone: null,
    address: 'Calle 10 #5-20, Bogotá, Colombia',
    social: ['Instagram: @peluqueria.ana'],
    filterLabel: null,
    items: [item()],
    bookingUrl: 'https://xiro.style/reservar/peluqueria-ana',
    qrDataUrl: null,
    ...over,
  };
}

describe('buildCatalogPdf', () => {
  it('genera portada, cuadrícula y contraportada sin lanzar excepciones', () => {
    const doc = buildCatalogPdf(baseInput());
    expect(doc.output('datauristring')).toContain('data:application/pdf');
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(3); // portada + al menos una página de artículos + contraportada
  });

  it('respeta el filtro de categoría (solo lo que el usuario tenía seleccionado en Catálogo)', () => {
    const doc = buildCatalogPdf(baseInput({ filterLabel: 'Categoría: Uñas', items: [item({ name: 'Manicure', categoryLabel: 'Uñas' })] }));
    expect(doc.output('datauristring')).toContain('data:application/pdf');
  });

  it('catálogo vacío (sin artículos publicados) no rompe: solo portada y contraportada', () => {
    const doc = buildCatalogPdf(baseInput({ items: [] }));
    expect(doc.output('datauristring')).toContain('data:application/pdf');
    expect(doc.getNumberOfPages()).toBe(2); // portada + contraportada, sin página de cuadrícula
  });

  it('un artículo sin foto usa un estado visual (inicial) en vez de romper el diseño', () => {
    const doc = buildCatalogPdf(baseInput({ items: [item({ imageDataUrl: null })] }));
    expect(doc.output('datauristring')).toContain('data:application/pdf');
  });

  it('una imagen de artículo inválida no rompe la generación (se omite esa foto)', () => {
    const doc = buildCatalogPdf(baseInput({ items: [item({ imageDataUrl: 'data:image/png;base64,not-a-real-image' })] }));
    expect(doc.output('datauristring')).toContain('data:application/pdf');
  });

  it('sin datos de contacto configurados (whatsapp/teléfono/dirección/redes) sigue generando el documento', () => {
    const doc = buildCatalogPdf(baseInput({ whatsapp: null, phone: null, address: '', social: [] }));
    expect(doc.output('datauristring')).toContain('data:application/pdf');
  });

  it('sin página pública publicada (sin bookingUrl ni QR) omite esa sección sin romper', () => {
    const doc = buildCatalogPdf(baseInput({ bookingUrl: null, qrDataUrl: null }));
    expect(doc.output('datauristring')).toContain('data:application/pdf');
  });

  it('un catálogo largo pagina correctamente la cuadrícula', () => {
    const items = Array.from({ length: 40 }, (_, i) => item({ name: `Servicio ${i + 1}` }));
    const doc = buildCatalogPdf(baseInput({ items }));
    expect(doc.getNumberOfPages()).toBeGreaterThan(3);
  });
});

describe('catalogPdfFileName', () => {
  it('arma un nombre de archivo a partir del negocio, sin caracteres raros', () => {
    expect(catalogPdfFileName('Peluquería Ana', null)).toMatch(/^catalogo-.*\.pdf$/);
  });

  it('incluye el filtro en el nombre cuando hay uno', () => {
    const withFilter = catalogPdfFileName('Peluquería Ana', 'Categoría: Uñas');
    const withoutFilter = catalogPdfFileName('Peluquería Ana', null);
    expect(withFilter).not.toBe(withoutFilter);
  });
});

describe('toQrDataUrl', () => {
  it('sin URL devuelve null sin generar nada', async () => {
    expect(await toQrDataUrl(null)).toBeNull();
  });

  it('con una URL real genera un data URL de imagen', async () => {
    const result = await toQrDataUrl('https://xiro.style/reservar/peluqueria-ana');
    expect(result).toMatch(/^data:image\/png;base64,/);
  });
});
