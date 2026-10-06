import { describe, expect, it } from 'vitest';
import { buildCatalogPdf, catalogPdfFileName, formatPhoneDisplay, toQrDataUrl, type CatalogPdfInput, type CatalogPdfItem } from '../src/web/services/catalogPdf';

function item(over: Partial<CatalogPdfItem> = {}): CatalogPdfItem {
  return { name: 'Corte', categoryLabel: 'Cortes', description: 'Corte clásico con máquina y tijera.', priceLabel: '$ 30.000', durationMinutes: 30, imageDataUrls: [], ...over };
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
  it('genera portada, una hoja por artículo y contraportada sin lanzar excepciones', () => {
    const doc = buildCatalogPdf(baseInput());
    expect(doc.output('datauristring')).toContain('data:application/pdf');
    // portada + 1 artículo (sin índice: una sola categoría y 8 o menos piezas) + contraportada
    expect(doc.getNumberOfPages()).toBe(3);
  });

  it('con más de una categoría agrega la hoja de índice', () => {
    const doc = buildCatalogPdf(baseInput({ items: [item({ name: 'Corte', categoryLabel: 'Cortes' }), item({ name: 'Manicure', categoryLabel: 'Uñas' })] }));
    // portada + índice + 2 artículos + contraportada
    expect(doc.getNumberOfPages()).toBe(5);
  });

  it('con más de 8 piezas agrega la hoja de índice aunque sea una sola categoría', () => {
    const items = Array.from({ length: 9 }, (_, i) => item({ name: `Servicio ${i + 1}` }));
    const doc = buildCatalogPdf(baseInput({ items }));
    expect(doc.getNumberOfPages()).toBe(1 + 1 + 9 + 1);
  });

  it('un artículo con más de 5 fotos agrega una hoja de continuación', () => {
    const images = Array.from({ length: 7 }, (_, i) => `data:image/png;base64,foto-${i}`);
    const doc = buildCatalogPdf(baseInput({ items: [item({ imageDataUrls: images })] }));
    // portada + artículo + continuación + contraportada (sin índice: 1 categoría, 1 pieza)
    expect(doc.getNumberOfPages()).toBe(4);
  });

  it('respeta el filtro de categoría (solo lo que el usuario tenía seleccionado en Catálogo)', () => {
    const doc = buildCatalogPdf(baseInput({ filterLabel: 'Categoría: Uñas', items: [item({ name: 'Manicure', categoryLabel: 'Uñas' })] }));
    expect(doc.output('datauristring')).toContain('data:application/pdf');
  });

  it('catálogo vacío (sin artículos publicados) no rompe: solo portada y contraportada', () => {
    const doc = buildCatalogPdf(baseInput({ items: [] }));
    expect(doc.output('datauristring')).toContain('data:application/pdf');
    expect(doc.getNumberOfPages()).toBe(2);
  });

  it('un artículo sin foto usa el ícono de reemplazo en vez de romper el diseño', () => {
    const doc = buildCatalogPdf(baseInput({ items: [item({ imageDataUrls: [] })] }));
    expect(doc.output('datauristring')).toContain('data:application/pdf');
  });

  it('un producto sin duración (durationMinutes null) no dibuja ese renglón ni rompe', () => {
    const doc = buildCatalogPdf(baseInput({ items: [item({ durationMinutes: null })] }));
    expect(doc.output('datauristring')).toContain('data:application/pdf');
  });

  it('una imagen de artículo inválida no rompe la generación (se omite esa foto)', () => {
    const doc = buildCatalogPdf(baseInput({ items: [item({ imageDataUrls: ['data:image/png;base64,not-a-real-image'] })] }));
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

  it('un catálogo largo pagina correctamente (una hoja por pieza + índice)', () => {
    const items = Array.from({ length: 40 }, (_, i) => item({ name: `Servicio ${i + 1}` }));
    const doc = buildCatalogPdf(baseInput({ items }));
    expect(doc.getNumberOfPages()).toBeGreaterThan(40);
  });

  it('pone el título del documento (nombre del negocio en los metadatos del PDF)', () => {
    const doc = buildCatalogPdf(baseInput());
    // jsPDF no expone un getter público de metadatos; el título va como UTF-16BE en el PDF crudo (ver setProperties).
    const out = doc.output();
    expect(out).toContain('/Title (');
    expect(out).toContain(Array.from('Ana').map((c) => `\u0000${c}`).join(''));
  });

  it('nombres y descripciones largos no rompen el documento', () => {
    const doc = buildCatalogPdf(
      baseInput({
        items: [
          item({
            name: 'Tratamiento de keratina para cabello largo con proteínas y aceites naturales de origen vegetal',
            description: 'Nombre y descripción muy largos a propósito para revisar cómo se comporta el documento cuando el texto no cabe en una sola línea y hay que repartirlo en varias, sin que nada se corte ni se salga del margen de la hoja.'.repeat(2),
          }),
        ],
      }),
    );
    expect(doc.output('datauristring')).toContain('data:application/pdf');
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

  it('quita tildes conservando la letra, en vez de cortarla (no más "categor-a")', () => {
    const name = catalogPdfFileName('Derek', 'Categoría: Productos');
    expect(name).toContain('categoria');
    expect(name).not.toContain('categor-a');
    expect(name).not.toMatch(/[áéíóúñÁÉÍÓÚÑ]/);
  });
});

describe('formatPhoneDisplay', () => {
  it('sin teléfono devuelve null', () => {
    expect(formatPhoneDisplay(null)).toBeNull();
  });

  it('un celular colombiano de 10 dígitos se agrupa con +57', () => {
    expect(formatPhoneDisplay('3135150072')).toBe('+57 313 515 0072');
  });

  it('un número ya con indicativo se agrupa igual', () => {
    expect(formatPhoneDisplay('+57 313 515 0072')).toBe('+57 313 515 0072');
  });

  it('un valor que no se puede normalizar se muestra tal cual, sin romper', () => {
    expect(formatPhoneDisplay('ext. 204')).toBe('ext. 204');
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
