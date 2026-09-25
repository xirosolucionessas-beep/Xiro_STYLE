/** Resultado de intentar activar las notificaciones en este dispositivo. */
export type PushOutcome =
  /** Permiso concedido y dispositivo registrado en el servidor. */
  | 'granted'
  /** La persona bloqueó el permiso: solo se puede reactivar desde los ajustes del sistema/navegador. */
  | 'denied'
  /** Este dispositivo/navegador no admite push (emulador, navegador sin Push API, iOS Safari sin instalar como PWA). */
  | 'unsupported'
  /** El servidor no tiene claves configuradas (VAPID en la Web). */
  | 'not_configured'
  /** iPhone/iPad en Safari sin haber agregado la app a la pantalla de inicio: Apple solo permite push desde la PWA instalada. */
  | 'ios_needs_install';

/** Estado del permiso de notificaciones del sistema. `unavailable`: este entorno no puede recibir push (Expo Go, emulador, navegador sin soporte). */
export type PushPermission = 'granted' | 'denied' | 'undetermined' | 'unavailable';

export interface PushAdapter {
  /** Estado actual del permiso, SIN pedirlo (se pide solo al activar). */
  permission(): Promise<PushPermission>;
  /** Pide permiso (solo aquí, nunca al abrir la app) y registra el dispositivo. */
  enable(): Promise<PushOutcome>;
  /** Borra el registro de este dispositivo en el servidor y localmente. No revoca el permiso del sistema. */
  disable(): Promise<void>;
}
