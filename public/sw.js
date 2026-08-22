const CACHE_PREFIX = 'origin-pwa-';
const CACHE_NAME = `${CACHE_PREFIX}v3`;
const APP_SHELL_KEY = '/__origin-app-shell__';
const SAFE_STATIC_PATHS = new Set([
  '/offline.html',
  '/manifest.webmanifest',
  '/pwa-192.png',
  '/pwa-512.png',
  '/pwa-maskable-512.png',
  '/apple-touch-icon.png',
]);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll([...SAFE_STATIC_PATHS]);
      try {
        const response = await fetch('/', { credentials: 'same-origin' });
        if (response.ok) await cache.put(APP_SHELL_KEY, response);
      } catch {
        // The fixed offline page remains available if first installation is offline.
      }
    }),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (
    event.origin === self.location.origin
    && event.data?.type === 'SKIP_WAITING'
  ) {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (
    request.method !== 'GET'
    || url.origin !== self.location.origin
    || url.pathname.startsWith('/api/')
    || url.pathname === '/health'
  ) {
    return;
  }

  const hasSensitiveHeaders = request.headers.has('authorization') || request.headers.has('cookie');

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).then(async (response) => {
        if (response.ok && !hasSensitiveHeaders) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(APP_SHELL_KEY, response.clone());
        }
        return response;
      }).catch(async () => (!hasSensitiveHeaders && await caches.match(APP_SHELL_KEY)) || caches.match('/offline.html')),
    );
    return;
  }

  if (hasSensitiveHeaders) {
    return;
  }

  if (SAFE_STATIC_PATHS.has(url.pathname) || url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then(async (cached) => {
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, response.clone());
        }
        return response;
      }),
    );
  }
});
