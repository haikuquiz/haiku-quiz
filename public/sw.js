const CACHE_NAME = 'haiku-quiz-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Let all requests pass through to the network
  event.respondWith(fetch(event.request));
});
