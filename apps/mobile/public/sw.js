/* Service worker de Xiro Style: solo recibe Web Push y muestra el aviso. No cachea nada ni intercepta peticiones. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

/*
 * Sonido de Xiro (ver docs/notification-sound.md). El navegador no deja poner un sonido propio al aviso del sistema ni
 * reproducir audio aquí, así que se le pregunta a UNA pestaña visible si puede sonar ella. Si contesta que sonó, el aviso se
 * muestra en silencio (nunca dos sonidos); si no hay pestaña visible, no contesta a tiempo o el navegador bloqueó el audio,
 * el aviso se muestra exactamente como antes (con el sonido que decidan el sistema y el navegador).
 */
const SOUND_REQUEST = 'xiro:play-notification-sound';
const SOUND_TIMEOUT_MS = 1500;
let pushCounter = 0;

async function pageSound(id) {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const visible = windows.filter((w) => w.visibilityState === 'visible');
  const target = visible.find((w) => w.focused) || visible[0];
  if (!target) return false;
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(false), SOUND_TIMEOUT_MS);
    channel.port1.onmessage = (message) => {
      clearTimeout(timer);
      resolve(Boolean(message.data && message.data.played));
    };
    target.postMessage({ type: SOUND_REQUEST, id }, [channel.port2]);
  });
}

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: 'Xiro Style', body: event.data ? event.data.text() : '' };
  }
  pushCounter += 1;
  const id = `${Date.now()}-${pushCounter}`;
  // `data.url` (si viene) es la ruta de destino al tocar el aviso — ver "Deep linking" en notificationclick.
  event.waitUntil(
    pageSound(id)
      .catch(() => false)
      .then((played) =>
        self.registration.showNotification(payload.title || 'Xiro Style', { body: payload.body || '', icon: '/favicon.ico', tag: payload.tag, data: payload.data || {}, silent: played }),
      ),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (windows) => {
      const open = windows[0];
      if (!open) return self.clients.openWindow(url);
      await open.focus();
      // No todos los navegadores soportan navegar una pestaña ya abierta desde el service worker (p. ej. Safari):
      // si no se puede, se deja enfocada en lo que ya tenía — mejor eso que fallar el clic entero.
      if ('navigate' in open) {
        try {
          await open.navigate(url);
        } catch {
          /* ver nota arriba */
        }
      }
      return open;
    }),
  );
});
