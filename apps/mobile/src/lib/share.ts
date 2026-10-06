import { Platform, Share } from 'react-native';

/**
 * Copia un texto al portapapeles (Web) o abre la hoja de compartir del sistema (Android/iOS, que también permite copiar).
 * Devuelve qué pasó para poder avisarlo con claridad; nunca lanza.
 */
export async function copyOrShare(text: string): Promise<'copied' | 'shared' | 'failed'> {
  if (Platform.OS === 'web') {
    try {
      await navigator.clipboard.writeText(text);
      return 'copied';
    } catch {
      return 'failed';
    }
  }
  try {
    const result = await Share.share({ message: text });
    return result.action === Share.dismissedAction ? 'failed' : 'shared';
  } catch {
    return 'failed';
  }
}
