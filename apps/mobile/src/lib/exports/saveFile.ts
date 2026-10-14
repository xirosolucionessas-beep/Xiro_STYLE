import { shareGeneratedFile, type MIME } from './nativeFiles';

/**
 * Guarda un archivo que generó el servidor (PDF o Excel del Balance y de Gastos). En Android/iOS no hay "descargas": se
 * escribe en la caché y se abre la hoja de compartir (Archivos, Drive, WhatsApp, correo, imprimir). La web usa saveFile.web.ts.
 */
export type SaveResult = 'saved' | 'shared' | 'unavailable';

export async function saveFile(fileName: string, bytes: Uint8Array, kind: keyof typeof MIME, dialogTitle: string): Promise<SaveResult> {
  return shareGeneratedFile(fileName, bytes, kind, dialogTitle);
}
