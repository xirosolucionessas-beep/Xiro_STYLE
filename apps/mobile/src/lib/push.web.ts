import { WEB_NOTIFICATION_SOUND_URL } from '@xiro/shared';
import { useEffect } from 'react';
import { api } from './api';
import { createSoundPlayer, SOUND_REQUEST } from './notificationSound';
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

/**
 * Sonido de Xiro en la Web. El navegador NO permite sonido propio en el aviso del sistema ni reproducir audio desde el Service
 * Worker, así que cuando llega un push el SW le pregunta a la pestaña visible si puede sonar (sw.js). La página reproduce
 * el audio solo si la pestaña se ve y la persona ya interactuó con ella (si no, el navegador lo bloquearía) y contesta si
 * de verdad sonó: en ese caso el SW muestra el aviso en silencio; si no, con su sonido de siempre. Nunca suena dos veces.
 */
export function useNotificationSound(signedIn: boolean): void {
  useEffect(() => {
    // Sin sesión no se atiende: el SW no recibe respuesta y muestra el aviso como siempre.
    if (!signedIn || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    let interacted = (navigator as { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive ?? false;
    const markInteracted = () => (interacted = true);
    window.addEventListener('pointerdown', markInteracted, { once: true });
    window.addEventListener('keydown', markInteracted, { once: true });
    let audio: HTMLAudioElement | null = null;
    const handle = createSoundPlayer({
      env: () => ({ visible: document.visibilityState === 'visible', hasBeenActive: interacted || ((navigator as { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive ?? false) }),
      play: async () => {
        audio ??= new Audio(WEB_NOTIFICATION_SOUND_URL);
        audio.currentTime = 0;
        await audio.play(); // rechaza si el navegador lo bloquea o falta el archivo: el SW usa entonces el sonido del sistema
      },
    });
    const onMessage = (event: MessageEvent) => {
      const port = event.ports[0];
      if (event.data?.type !== SOUND_REQUEST || !port) return;
      void handle(String(event.data.id ?? '')).then((played) => port.postMessage({ played }));
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => {
      navigator.serviceWorker.removeEventListener('message', onMessage);
      window.removeEventListener('pointerdown', markInteracted);
      window.removeEventListener('keydown', markInteracted);
    };
  }, [signedIn]);
}
