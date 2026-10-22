/**
 * Sonido de notificación de Xiro Style. Única fuente de los nombres que deben coincidir entre la app (recurso nativo y canal
 * de Android), el servidor (mensaje push) y la web (archivo servido). Ver docs/notification-sound.md.
 *
 * - Android/iOS: `apps/mobile/assets/sounds/xiro_notification.wav` (PCM 16 bits, mono, 44,1 kHz), empaquetado por el plugin
 *   de expo-notifications en un build nativo. iOS no admite MP3 para notificaciones.
 * - Android 8+: el sonido pertenece al CANAL y no se puede cambiar en un canal ya creado; por eso va en uno nuevo.
 * - Web: los navegadores no permiten sonido propio en el aviso del sistema; se reproduce en la página abierta.
 */
export const NOTIFICATION_SOUND_FILE = 'xiro_notification.wav';
export const NOTIFICATION_SOUND_CHANNEL_ID = 'xiro_alerts';
export const WEB_NOTIFICATION_SOUND_URL = '/sounds/xiro_notification.mp3';
