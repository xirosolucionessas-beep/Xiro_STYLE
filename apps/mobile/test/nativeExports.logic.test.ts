import { crc32, inflateSync } from 'node:zlib';
import QRCode from 'qrcode';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { qrPngDataUrl } from '../src/lib/exports/qrPng';

/**
 * Piezas de la exportación en Android/iOS que no pasan por el navegador: el QR en PNG hecho a mano (sin canvas) y el
 * TextDecoder mínimo que jsPDF necesita al cargarse. Se validan con decodificadores independientes (node:zlib).
 */

interface Png {
  width: number;
  height: number;
  /** Fila y → bytes RGB (sin el byte de filtro). */
  rows: Uint8Array[];
}

function decodePng(dataUrl: string): Png {
  const bytes = Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64');
  expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let at = 8;
  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];
  const types: string[] = [];
  while (at < bytes.length) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.toString('latin1', at + 4, at + 8);
    const data = bytes.subarray(at + 8, at + 8 + length);
    // CRC independiente (zlib de Node) sobre tipo + datos.
    expect(bytes.readUInt32BE(at + 8 + length), `CRC de ${type}`).toBe(crc32(bytes.subarray(at + 4, at + 8 + length)));
    types.push(type);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      expect([data[8], data[9], data[10], data[11], data[12]]).toEqual([8, 2, 0, 0, 0]); // RGB 8 bits, sin entrelazado
    }
    if (type === 'IDAT') idat.push(Buffer.from(data));
    at += 12 + length;
  }
  expect(types).toEqual(['IHDR', 'IDAT', 'IEND']);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = 1 + width * 3;
  expect(raw.length).toBe(stride * height);
  const rows = Array.from({ length: height }, (_, y) => {
    expect(raw[y * stride], 'filtro "ninguno"').toBe(0);
    return new Uint8Array(raw.subarray(y * stride + 1, (y + 1) * stride));
  });
  return { width, height, rows };
}

describe('qrPngDataUrl (QR sin canvas)', () => {
  it('es un PNG válido cuyos módulos coinciden con la matriz del QR, con 1 módulo de margen claro', () => {
    const url = 'https://xiro.style/catalog/peluqueria-ana';
    const png = decodePng(qrPngDataUrl(url)!);
    const { modules } = QRCode.create(url, { errorCorrectionLevel: 'M' });
    const cells = modules.size + 2;
    expect(png.width).toBe(png.height);
    expect(png.width % cells).toBe(0);
    expect(png.width).toBeLessThanOrEqual(400);
    const scale = png.width / cells;
    const pixel = (mx: number, my: number) => {
      const row = png.rows[Math.floor((my + 1) * scale + scale / 2)]!;
      const x = Math.floor((mx + 1) * scale + scale / 2) * 3;
      return [row[x], row[x + 1], row[x + 2]];
    };
    for (let y = 0; y < modules.size; y++) {
      for (let x = 0; x < modules.size; x++) expect(pixel(x, y), `módulo ${x},${y}`).toEqual(modules.get(y, x) ? [0x12, 0x10, 0x0d] : [0xff, 0xff, 0xff]);
    }
    expect(pixel(-1, -1)).toEqual([0xff, 0xff, 0xff]); // margen
  });

  it('sin URL no hay QR', () => {
    expect(qrPngDataUrl(null)).toBeNull();
    expect(qrPngDataUrl('')).toBeNull();
  });
});

describe('TextDecoder mínimo (Android/iOS)', () => {
  const original = globalThis.TextDecoder;
  afterEach(() => {
    globalThis.TextDecoder = original;
    vi.resetModules();
  });

  it('solo se instala si falta, y decodifica UTF-8 y latin1 igual que el nativo', async () => {
    // @ts-expect-error -- se simula un motor sin TextDecoder.
    delete globalThis.TextDecoder;
    vi.resetModules();
    await import('../src/lib/exports/textDecoder');
    const Polyfill = globalThis.TextDecoder;
    expect(Polyfill).not.toBe(original);
    const text = 'Peluquería Ñandú – café ☕ 😀 $ 25.000';
    const utf8 = new TextEncoder().encode(text);
    expect(new Polyfill().decode(utf8)).toBe(new original().decode(utf8));
    const latin1 = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(new Polyfill('latin1').decode(latin1)).toBe(new original('latin1').decode(latin1));
    expect(new Polyfill().decode()).toBe('');
  });

  it('no reemplaza un TextDecoder que ya existe', async () => {
    vi.resetModules();
    await import('../src/lib/exports/textDecoder');
    expect(globalThis.TextDecoder).toBe(original);
  });

  it('el PDF de reportes se genera aunque el motor no traiga TextDecoder', async () => {
    // @ts-expect-error -- se simula un motor sin TextDecoder (el polyfill se carga antes que jsPDF).
    delete globalThis.TextDecoder;
    vi.resetModules();
    const { buildReportsPdf } = await import('../src/lib/exports/reportsPdf');
    const doc = buildReportsPdf({
      businessName: 'Peluquería Ana',
      businessAddress: 'Calle 10 #5-20, Bogotá',
      businessPhone: null,
      logoDataUrl: qrPngDataUrl('https://xiro.style'),
      periodLabel: 'Hoy',
      generatedAtLabel: '7 oct 2026',
      kpis: [{ label: 'Ventas', value: '$ 10.000' }],
      growth: null,
      cashBalance: null,
      paymentMethods: [],
      employees: [],
      topServices: [],
      topProducts: [],
      dailyRows: [],
    });
    const bytes = new Uint8Array(doc.output('arraybuffer'));
    expect(String.fromCharCode(...bytes.subarray(0, 5))).toBe('%PDF-');
  });
});
