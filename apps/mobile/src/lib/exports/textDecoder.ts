/**
 * `TextDecoder` mínimo para Android/iOS. jsPDF crea `new TextDecoder('latin1')` al cargarse (su lector de PNG) y usa
 * UTF-8 al leer texto; React Native no trae `TextDecoder` propio y, según la versión de Hermes, puede no existir. Solo se
 * instala si falta: donde ya existe (navegador, Node, Hermes reciente) no toca nada. Importarlo ANTES que jsPDF.
 */
type Input = ArrayBuffer | ArrayBufferView | undefined;

function bytesOf(input: Input): Uint8Array {
  if (!input) return new Uint8Array(0);
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
}

/**
 * Para el estándar WHATWG, "latin1" es windows-1252: igual a ISO-8859-1 salvo 0x80–0x9F, que son € ‚ ƒ „ … (y los cinco
 * huecos sin asignar se quedan con su propio código). Tabla oficial: https://encoding.spec.whatwg.org/index-windows-1252.txt
 */
const WINDOWS_1252_HIGH = [
  0x20ac, 0x81, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x8d, 0x017d, 0x8f,
  0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x9d, 0x017e, 0x0178,
];

function decodeLatin1(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    const codes = Array.from(bytes.subarray(i, i + 8192), (b) => (b >= 0x80 && b <= 0x9f ? WINDOWS_1252_HIGH[b - 0x80]! : b));
    out += String.fromCharCode(...codes);
  }
  return out;
}

function decodeUtf8(bytes: Uint8Array): string {
  const codes: number[] = [];
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i++]!;
    let code = 0xfffd;
    if (b < 0x80) code = b;
    else if (b >= 0xc0 && b < 0xe0 && i < bytes.length) code = ((b & 0x1f) << 6) | (bytes[i++]! & 0x3f);
    else if (b >= 0xe0 && b < 0xf0 && i + 1 < bytes.length) code = ((b & 0x0f) << 12) | ((bytes[i++]! & 0x3f) << 6) | (bytes[i++]! & 0x3f);
    else if (b >= 0xf0 && i + 2 < bytes.length) code = ((b & 0x07) << 18) | ((bytes[i++]! & 0x3f) << 12) | ((bytes[i++]! & 0x3f) << 6) | (bytes[i++]! & 0x3f);
    if (code > 0xffff) {
      code -= 0x10000;
      codes.push(0xd800 + (code >> 10), 0xdc00 + (code & 0x3ff));
    } else codes.push(code);
    if (codes.length >= 8192) out += String.fromCharCode(...codes.splice(0));
  }
  return out + String.fromCharCode(...codes);
}

class MinimalTextDecoder {
  readonly encoding: 'utf-8' | 'latin1';
  constructor(label = 'utf-8') {
    const normalized = label.toLowerCase();
    this.encoding = normalized === 'latin1' || normalized === 'iso-8859-1' || normalized === 'ascii' || normalized === 'windows-1252' ? 'latin1' : 'utf-8';
  }
  decode(input?: Input): string {
    const bytes = bytesOf(input);
    return this.encoding === 'latin1' ? decodeLatin1(bytes) : decodeUtf8(bytes);
  }
}

const scope = globalThis as { TextDecoder?: unknown };
if (typeof scope.TextDecoder !== 'function') scope.TextDecoder = MinimalTextDecoder;

export {};
