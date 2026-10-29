/** Web: el archivo que generó el servidor se descarga con el nombre indicado (ver saveFile.ts para Android/iOS; aquí no hay hoja de compartir, así que el título no se usa). */
export type SaveResult = 'saved' | 'shared' | 'unavailable';

const TYPES = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
} as const;

export async function saveFile(fileName: string, bytes: Uint8Array, kind: keyof typeof TYPES): Promise<SaveResult> {
  const blob = new Blob([bytes as BlobPart], { type: TYPES[kind] });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    // Se libera después del clic (algunos navegadores leen el enlace de forma asíncrona).
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
  return 'saved';
}
