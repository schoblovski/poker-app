// DTKS Poker – Service Worker
// Zuständig für: Push Notifications empfangen + anzeigen
// Wird von index.html registriert (navigator.serviceWorker.register('/sw.js'))

const SW_VERSION = '1.0';

// ── PUSH EVENT ─────────────────────────────────────────────────────────────
// Wird ausgelöst wenn der Push-Server eine Nachricht sendet
self.addEventListener('push', event => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'DTKS Poker', body: event.data.text() };
  }

  const { title = 'DTKS Poker', body = '', icon, badge, data = {} } = payload;

  const options = {
    body,
    icon:  icon  || '/icons/icon-192.png',
    badge: badge || '/icons/badge-72.png',
    data,
    // Verhindert mehrere Notifications vom gleichen "Tag" (ersetzt die alte)
    tag: data.tag || 'dtks-default',
    renotify: !!data.tag,
    requireInteraction: data.requireInteraction || false,
    vibrate: [200, 100, 200],
  };

  event.waitUntil((async () => {
    await self.registration.showNotification(title, options);
    // App-Badge hochzählen (zeigt ungelesene Zahl auf dem Icon)
    if (self.navigator && 'setAppBadge' in self.navigator) {
      try {
        const cache = await caches.open('dtks-badge');
        const res = await cache.match('/badge-count');
        const current = res ? parseInt(await res.text(), 10) || 0 : 0;
        const next = current + 1;
        await cache.put('/badge-count', new Response(String(next)));
        await self.navigator.setAppBadge(next);
      } catch (e) { /* Badge-API nicht verfügbar → ignorieren */ }
    }
  })());
});

// ── NOTIFICATION CLICK ─────────────────────────────────────────────────────
// Wird ausgelöst wenn der Nutzer die Notification antippt
self.addEventListener('notificationclick', event => {
  event.notification.close();
  // Badge beim Öffnen via Notification clearen
  if (self.navigator && 'clearAppBadge' in self.navigator) {
    try {
      self.navigator.clearAppBadge();
      caches.open('dtks-badge').then(c => c.put('/badge-count', new Response('0')));
    } catch (e) {}
  }

  const data = event.notification.data || {};
  // Optionale URL aus dem Payload (z.B. '/app#transaktionen')
  const url = data.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      // Offenes Fenster fokussieren falls vorhanden
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          if (url !== '/') client.postMessage({ type: 'NAVIGATE', url });
          return client.focus();
        }
      }
      // Sonst neues Fenster öffnen
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

// ── INSTALL / ACTIVATE ─────────────────────────────────────────────────────
// Minimal – kein Caching (App ist kein Offline-First PWA)
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil(clients.claim());
});
