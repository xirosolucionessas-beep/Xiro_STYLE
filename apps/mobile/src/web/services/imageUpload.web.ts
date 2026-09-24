/**
 * Prepara una foto elegida en el navegador para subirla: la reduce a 1600 px de ancho máximo, la convierte a JPEG (calidad 0.8)
 * y devuelve el FormData. Usa un <canvas> directamente, sin `fetch()` sobre URLs `blob:`, porque la CSP de la API
 * (`connect-src 'self'`) bloquea esas peticiones (el código compartido de lib/images.ts sí las usa).
 */
export const MAX_UPLOAD_WIDTH = 1600;

/** Tamaño final conservando la proporción; nunca agranda. */
export function scaledSize(width: number, height: number, maxWidth = MAX_UPLOAD_WIDTH): { width: number; height: number } {
  if (width <= maxWidth) return { width, height };
  return { width: maxWidth, height: Math.max(1, Math.round((height * maxWidth) / width)) };
}

function loadImage(uri: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('unreadable_image'));
    image.src = uri;
  });
}

export async function photoToFormData(photo: { uri: string }, field = 'logo'): Promise<FormData> {
  const image = await loadImage(photo.uri);
  const { width, height } = scaledSize(image.naturalWidth, image.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('canvas_unavailable');
  context.fillStyle = '#ffffff'; // los PNG con transparencia no deben quedar negros al pasar a JPEG
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
  if (!blob) throw new Error('encode_failed');
  const form = new FormData();
  form.append(field, blob, 'photo.jpg');
  return form;
}
