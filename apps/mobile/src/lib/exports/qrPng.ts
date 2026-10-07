import QRCode from 'qrcode';

/**
 * QR como PNG en data URL, sin `canvas` (Android/iOS no lo tienen). Usa la matriz de `qrcode` (`QRCode.create`, que no
 * dibuja nada) y codifica el PNG a mano: mismos colores y margen que el QR de la web (`toQrDataUrl` en catalogPdf).
 * El PNG va sin comprimir (bloques "stored" de zlib): un QR de ~400px pesa ~500 KB crudo, y jsPDF lo vuelve a comprimir
 * al incrustarlo, así que el PDF final no crece.
 */
const DARK: readonly [number, number, number] = [0x12, 0x10, 0x0d];
const LIGHT: readonly [number, number, number] = [0xff, 0xff, 0xff];
const MARGIN = 1;
const TARGET_WIDTH = 400;

export function qrPngDataUrl(text: string | null): string | null {
  if (!text) return null;
  try {
    const { modules } = QRCode.create(text, { errorCorrectionLevel: 'M' });
    const cells = modules.size + MARGIN * 2;
    const scale = Math.max(1, Math.floor(TARGET_WIDTH / cells));
    const side = cells * scale;
    // Cada fila: 1 byte de filtro (0 = ninguno) + RGB por píxel.
    const stride = 1 + side * 3;
    const raw = new Uint8Array(stride * side);
    for (let y = 0; y < side; y++) {
      const row = y * stride;
      const my = Math.floor(y / scale) - MARGIN;
      for (let x = 0; x < side; x++) {
        const mx = Math.floor(x / scale) - MARGIN;
        const dark = mx >= 0 && my >= 0 && mx < modules.size && my < modules.size && modules.get(my, mx) === 1;
        const color = dark ? DARK : LIGHT;
        const at = row + 1 + x * 3;
        raw[at] = color[0];
        raw[at + 1] = color[1];
        raw[at + 2] = color[2];
      }
    }
    return `data:image/png;base64,${toBase64(encodePng(side, side, raw))}`;
  } catch {
    return null;
  }
}

/* ---------- PNG mínimo (RGB 8 bits, sin entrelazado) ---------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]!) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** zlib con bloques "stored" (sin compresión): válido para cualquier lector de PNG. */
function zlibStored(data: Uint8Array): Uint8Array {
  const BLOCK = 65535;
  const blocks = Math.max(1, Math.ceil(data.length / BLOCK));
  const out = new Uint8Array(2 + blocks * 5 + data.length + 4);
  out[0] = 0x78;
  out[1] = 0x01;
  let at = 2;
  for (let i = 0; i < blocks; i++) {
    const chunk = data.subarray(i * BLOCK, Math.min(data.length, (i + 1) * BLOCK));
    out[at++] = i === blocks - 1 ? 1 : 0;
    out[at++] = chunk.length & 0xff;
    out[at++] = chunk.length >>> 8;
    out[at++] = ~chunk.length & 0xff;
    out[at++] = (~chunk.length >>> 8) & 0xff;
    out.set(chunk, at);
    at += chunk.length;
  }
  const checksum = adler32(data);
  out[at++] = checksum >>> 24;
  out[at++] = (checksum >>> 16) & 0xff;
  out[at++] = (checksum >>> 8) & 0xff;
  out[at] = checksum & 0xff;
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function encodePng(width: number, height: number, raw: Uint8Array): Uint8Array {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8; // bits por canal
  header[9] = 2; // RGB
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', zlibStored(raw)), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
