import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as Sharing from 'expo-sharing';

/**
 * Archivos generados en Android/iOS (PDF de reportes y catálogo, Excel de reportes). En el teléfono no hay "descargas"
 * del navegador: el archivo se escribe en la caché de la app y se abre la hoja de compartir del sistema, desde donde se
 * guarda en Archivos/Drive, se manda por WhatsApp o correo, o se imprime. Solo para código nativo.
 */

export const MIME = {
  pdf: { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' },
  xlsx: { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', UTI: 'org.openxmlformats.spreadsheetml.sheet' },
} as const;

export type ShareResult = 'shared' | 'unavailable';

/** Escribe `bytes` como `fileName` en la caché y abre la hoja de compartir. `unavailable` si el equipo no permite compartir. */
export async function shareGeneratedFile(fileName: string, bytes: Uint8Array, kind: keyof typeof MIME, dialogTitle: string): Promise<ShareResult> {
  const file = new File(Paths.cache, fileName);
  if (file.exists) file.delete();
  file.create();
  file.write(bytes);
  if (!(await Sharing.isAvailableAsync())) return 'unavailable';
  await Sharing.shareAsync(file.uri, { ...MIME[kind], dialogTitle });
  return 'shared';
}

/**
 * Equivalente nativo de `toCompressedDataUrl` (web): descarga la imagen, la reduce a `maxSide` px por lado y la devuelve
 * como JPEG en data URL para incrustarla en el PDF. `null` si no hay URL o no se pudo cargar (el PDF la trata como "sin foto").
 */
export async function imageDataUrl(url: string | null | undefined, maxSide = 1600, quality = 0.85): Promise<string | null> {
  if (!url) return null;
  let downloaded: File | null = null;
  try {
    const source = url.startsWith('http') ? (downloaded = await File.downloadFileAsync(url, new Directory(Paths.cache), { idempotent: true })).uri : url;
    const original = await ImageManipulator.manipulate(source).renderAsync();
    const scale = Math.min(1, maxSide / Math.max(original.width, original.height));
    const image = scale < 1 ? await ImageManipulator.manipulate(original).resize({ width: Math.round(original.width * scale), height: Math.round(original.height * scale) }).renderAsync() : original;
    const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: quality, base64: true });
    return saved.base64 ? `data:image/jpeg;base64,${saved.base64}` : null;
  } catch {
    return null;
  } finally {
    try {
      if (downloaded?.exists) downloaded.delete();
    } catch {
      // La caché la limpia el sistema; no vale la pena fallar por esto.
    }
  }
}
