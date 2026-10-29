import { NOTIFICATION_SOUND_CHANNEL_ID, NOTIFICATION_SOUND_FILE, type PushRegisterInput } from '@xiro/shared';

/**
 * Sonido de notificación de Xiro: lógica pura (sin React Native ni DOM) para poder probarla. Ver docs/notification-sound.md.
 */

/**
 * Canales de Android. `legacy` es el que ya existe en los teléfonos: NO se toca ni se borra (conserva lo que la persona haya
 * ajustado: sonido, vibración, silencio). `sound` es nuevo porque en Android 8+ el sonido de un canal no se puede cambiar
 * una vez creado; los avisos de los builds nuevos llegan por él (el servidor lo indica con `channelId`).
 */
export const ANDROID_CHANNELS = {
  legacy: { id: 'default', name: 'Xiro Style' },
  sound: { id: NOTIFICATION_SOUND_CHANNEL_ID, name: 'Avisos de Xiro Style', sound: NOTIFICATION_SOUND_FILE },
} as const;

/** Registro de un dispositivo nativo: este build trae el sonido empaquetado (plugin de expo-notifications en app.json). */
export const expoRegistration = (token: string): PushRegisterInput => ({ platform: 'expo', token, customSound: true });

/* ---------- Web ---------- */

/** Mensajes entre el service worker (public/sw.js) y la página. */
export const SOUND_REQUEST = 'xiro:play-notification-sound';

export interface SoundEnvironment {
  /** La pestaña se ve ahora mismo (si no, el aviso del sistema suena como siempre). */
  visible: boolean;
  /** La persona ya interactuó con la página: sin eso el navegador bloquea el audio (regla de autoreproducción). */
  hasBeenActive: boolean;
}

export const canPlayInPage = (env: SoundEnvironment) => env.visible && env.hasBeenActive;

/**
 * Reproductor de la página. Responde `true` al service worker SOLO si de verdad empezó a sonar: así el SW muestra el aviso
 * en silencio (sin sonido doble). Si el navegador lo bloquea, falta el archivo o la pestaña no se ve, responde `false` y el
 * aviso del sistema se muestra con su sonido de siempre. Cada aviso (`id`) suena como mucho una vez.
 */
export function createSoundPlayer(deps: { env: () => SoundEnvironment; play: () => Promise<void>; remember?: number }) {
  const played: string[] = [];
  const limit = deps.remember ?? 50;
  return async function handle(id: string): Promise<boolean> {
    if (!id) return false;
    // Mismo aviso otra vez (reentrega): ya sonó en la página, así que el aviso del sistema debe ir en silencio.
    if (played.includes(id)) return true;
    if (!canPlayInPage(deps.env())) return false;
    played.push(id);
    if (played.length > limit) played.shift();
    try {
      await deps.play();
      return true;
    } catch {
      return false;
    }
  };
}
