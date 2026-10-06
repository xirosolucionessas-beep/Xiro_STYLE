/* Service worker de Xiro Style: solo recibe Web Push y muestra el aviso. No cachea nada ni intercepta peticiones. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: 'Xiro Style', body: event.data ? event.data.text() : '' };
  }
  // `data.url` (si viene) es la ruta de destino al tocar el aviso — ver "Deep linking" en notificationclick.
  event.waitUntil(self.registration.showNotification(payload.title || 'Xiro Style', { body: payload.body || '', icon: '/favicon.ico', tag: payload.tag, data: payload.data || {} }));
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
