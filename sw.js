// Bump this version whenever you upload changed files, so devices get the update.
const CACHE = 'seatcheck-v8';
const ASSETS = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png', './jszip.min.js', './sf2.js', './sf2-template.xlsx', './qrcode.js', './jsqr.js', './clean.js', './xlsx.js', './sf4-template.xlsx'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(hit => hit ||
      fetch(e.request).catch(() => e.request.mode === 'navigate' ? caches.match('./index.html') : undefined))
  );
});
