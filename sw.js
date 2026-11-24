/**
 * df-decode — Service Worker para Modo Offline y PWA Instalable
 */

const CACHE_NAME = 'df-decode-cache-v1.0';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './tests.html',
  './manifest.json',
  './assets/icon.svg',
  './assets/icon-512.png',
  './assets/logo.svg',
  './assets/fontawesome/css/all.min.css',
  './assets/fontawesome/webfonts/fa-solid-900.woff2',
  './assets/fontawesome/webfonts/fa-regular-400.woff2',
  './assets/fontawesome/webfonts/fa-brands-400.woff2',
  './assets/fontawesome/webfonts/fa-v4compatibility.woff2',
  './css/styles.css',
  './js/evaluator.js',
  './js/model.js',
  './js/dfd-format.js',
  './js/storage.js',
  './js/codegen.js',
  './js/examples.js',
  './js/renderer.js',
  './js/interpreter.js',
  './js/app.js',
  './tests/unit-tests.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});
