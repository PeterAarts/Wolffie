// src/sw.js
//
// Hand-authored service worker (required for push notifications — vite-plugin-pwa's
// generateSW strategy can't host custom event listeners). precacheAndRoute() replaces
// what generateSW did automatically; everything below __WB_MANIFEST is new.

import { precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { createHandlerBoundToURL } from 'workbox-precaching';

// Injected at build time by vite-plugin-pwa (replaces globPatterns matches)
precacheAndRoute(self.__WB_MANIFEST);

// Equivalent of the old navigateFallbackDenylist: [/^\/api/] —
// serve index.html for navigation requests, except API routes.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.html'), {
    denylist: [/^\/api/],
  })
);

self.skipWaiting();
self.addEventListener('activate', () => self.clients.claim());

// ── Push notifications ────────────────────────────────────────────────────────

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'Wolffie', body: event.data.text() };
  }

  const title = payload.title || 'Wolffie';
  const options = {
    body: payload.body || '',
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    data: payload.data || {},
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Focus an existing tab if one's open, otherwise open a new one at root.
      for (const client of clients) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('/');
    })
  );
});