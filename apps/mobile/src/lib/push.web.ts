import { api } from './api';
import type { PushAdapter, PushOutcome, PushPermission } from './pushTypes';
import { prefsStorage } from './storage';
import { urlBase64ToBytes } from './vapid';

const TOKEN_KEY = 'xiro.pushToken';

function isIos(): boolean {
  const ua = navigator.userAgent;
  // iPadOS 13+ se presenta como Mac: se distingue por la pantalla táctil.
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
}

function isInstalledPwa(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches === true || (navigator as { standalone?: boolean }).standalone === true;
}

/** Web Push estándar (Service Worker + PushManager + VAPID). En iOS solo funciona desde la PWA instalada (Safari 16.4+). */
export const push: PushAdapter = {
  async permission(): Promise<PushPermission> {
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) return 'unavailable';
    return Notification.permission === 'default' ? 'undetermined' : Notification.permission;
  },

  async enable(): Promise<PushOutcome> {
    if (isIos() && !isInstalledPwa()) return 'ios_needs_install';
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
    if (Notification.permission === 'denied') return 'denied';

    const { publicKey } = await api.vapidPublicKey();
    if (!publicKey) return 'not_configured';

    const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (permission !== 'granted') return 'denied';

    const registration = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    const subscription = (await registration.pushManager.getSubscription()) ?? (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToBytes(publicKey) }));

    const json = subscription.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) return 'unsupported';
    await api.registerPush({ platform: 'web', endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } });
    await prefsStorage.set(TOKEN_KEY, json.endpoint);
    return 'granted';
  },

  async disable(): Promise<void> {
    const endpoint = await prefsStorage.get(TOKEN_KEY);
    try {
      const registration = await navigator.serviceWorker?.getRegistration('/sw.js');
      await (await registration?.pushManager.getSubscription())?.unsubscribe();
    } catch {
      /* el navegador ya la había cancelado */
    }
    if (endpoint) await api.unregisterPush(endpoint).catch(() => undefined);
    await prefsStorage.remove(TOKEN_KEY);
  },
};

/**
 * En Web el deep linking al tocar un push lo resuelve el propio Service Worker (sw.js: `notificationclick` navega la
 * pestaña ya abierta, o abre una nueva en `data.url`), sin pasar por React — no hay nada que hacer aquí. Mismo
 * patrón que `useRealtimeAppointments` en realtime.ts/realtime.web.ts: no-op a propósito en la variante que no aplica.
 */
export function useNotificationNavigation(): void {
  // Nada que hacer en Web.
}
