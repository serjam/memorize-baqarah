const CACHE_NAME = 'baqarah-v4';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './quran-data.js',
];
const OFFLINE_RESPONSE = new Response('Offline', { status: 503, statusText: 'Service Unavailable' });

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Network-first for index.html (ensures updates are picked up)
  if (url.pathname.endsWith('/') || url.pathname.endsWith('/index.html')) {
    event.respondWith(
      fetch(event.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => caches.match(event.request).then(r => r || OFFLINE_RESPONSE))
    );
    return;
  }

  // Audio files: let the browser/network handle directly (Range requests work natively)
  if (url.pathname.includes('/audio/')) {
    return;
  }

  // Mushaf images: cache-first
  if (url.hostname === 'www.mp3quran.net') {
    event.respondWith(
      caches.match(new Request(url.href), { ignoreVary: true }).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response.ok || response.type === 'opaque') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        }).catch(() => OFFLINE_RESPONSE);
      })
    );
    return;
  }

  // Stale-while-revalidate for CDN assets (Tailwind, Alpine, fonts, confetti)
  event.respondWith(
    caches.match(event.request, { ignoreVary: true }).then(cached => {
      const fetchPromise = fetch(event.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => cached || OFFLINE_RESPONSE);
      return cached || fetchPromise;
    })
  );
});
