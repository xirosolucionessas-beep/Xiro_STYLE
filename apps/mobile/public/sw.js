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
  event.waitUntil(self.registration.showNotification(payload.title || 'Xiro Style', { body: payload.body || '', icon: '/favicon.ico', tag: payload.tag }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows[0];
      return open ? open.focus() : self.clients.openWindow('/');
    }),
  );
});
