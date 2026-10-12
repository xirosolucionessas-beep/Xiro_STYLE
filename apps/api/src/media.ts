import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { contentTypeOf, type MediaStore } from './storage';

export type ImageExt = 'jpg' | 'png' | 'webp';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Lado de la foto de perfil ya procesada (cuadrada). */
export const AVATAR_SIZE = 400;

/** Lado máximo de una foto de catálogo guardada (las de cámara de 4000 px se reducen; las pequeñas no se agrandan). */
export const MAX_PHOTO_SIDE = 2048;

/**
 * Tope de píxeles al decodificar: una imagen "bomba" (pocos KB que se descomprimen a gigapíxeles) se rechaza antes de
 * agotar la memoria. 40 MP cubre de sobra las fotos de cualquier teléfono.
 */
const MAX_INPUT_PIXELS = 40_000_000;

/** Detecta el formato real por firma; nunca se confía en el nombre ni el Content-Type enviados por el cliente. */
export function sniffImage(buffer: Buffer): ImageExt | null {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

/**
 * Foto de catálogo/logo: se vuelve a codificar en su mismo formato. Así se descartan los metadatos (EXIF con la
 * ubicación GPS de donde se tomó la foto, modelo del teléfono…) que antes se guardaban tal cual, la imagen queda
 * enderezada según su orientación y nunca pasa de \`MAX_PHOTO_SIDE\`. Null si no es una imagen real, pesa de más o no se
 * puede decodificar.
 */
export async function saveImage(store: MediaStore, buffer: Buffer): Promise<string | null> {
  const ext = sniffImage(buffer);
  if (!ext || buffer.length > MAX_IMAGE_BYTES) return null;
  let processed: Buffer;
  try {
    const image = sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS }).rotate().resize(MAX_PHOTO_SIDE, MAX_PHOTO_SIDE, { fit: 'inside', withoutEnlargement: true });
    processed = await (ext === 'png' ? image.png({ compressionLevel: 9 }) : ext === 'webp' ? image.webp({ quality: 85 }) : image.jpeg({ quality: 85, mozjpeg: true })).toBuffer();
  } catch {
    return null;
  }
  const file = `${randomUUID()}.${ext}`;
  await store.put(file, processed, contentTypeOf(file));
  return file;
}

/**
 * Foto de perfil (empleado/profesional/cliente): se guarda siempre igual de liviana y con la misma forma, sin importar
 * lo que suba la persona. \`rotate()\` endereza según la orientación EXIF antes de recortar, y como el WebP de salida no
 * pide \`withMetadata()\`, ese EXIF (que puede traer ubicación) no llega al archivo guardado.
 */
export async function saveAvatarImage(store: MediaStore, buffer: Buffer): Promise<string | null> {
  if (!sniffImage(buffer) || buffer.length > MAX_IMAGE_BYTES) return null;
  let processed: Buffer;
  try {
    processed = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover', position: 'attention' })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    return null;
  }
  const file = `${randomUUID()}.webp`;
  await store.put(file, processed, 'image/webp');
  return file;
}

/** Borra un archivo (si el nombre no es uno generado por la API, no hace nada). Nunca falla la petición por esto. */
export async function removeMedia(store: MediaStore, file: string | null | undefined): Promise<void> {
  if (!file) return;
  await store.remove(file.split('/').pop() ?? file).catch(() => undefined);
}

export const mediaUrl = (file: string): string => `/media/${file}`;
