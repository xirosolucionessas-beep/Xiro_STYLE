import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type ImageExt = 'jpg' | 'png' | 'webp';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Detecta el formato real por firma; nunca se confía en el nombre ni el Content-Type enviados por el cliente. */
export function sniffImage(buffer: Buffer): ImageExt | null {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

export async function saveImage(mediaDir: string, buffer: Buffer): Promise<string | null> {
  const ext = sniffImage(buffer);
  if (!ext || buffer.length > MAX_IMAGE_BYTES) return null;
  await mkdir(mediaDir, { recursive: true });
  const file = `${randomUUID()}.${ext}`;
  await writeFile(path.join(mediaDir, file), buffer);
  return file;
}

export async function removeMedia(mediaDir: string, file: string | null | undefined): Promise<void> {
  if (!file) return;
  await unlink(path.join(mediaDir, path.basename(file))).catch(() => undefined);
}

export const mediaUrl = (file: string): string => `/media/${file}`;
