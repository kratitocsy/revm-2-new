/* RevM² Service Worker — Offline Support */
const CACHE = 'revm2-v5';
const SHELL = [
  '/',
  '/index.html',
  '/login.html',
  '/tracker.html',
  '/calculator.html',
  '/predictor.html',
  '/groups.html',
  '/partners.html',
  '/chat.html',
  '/revhead.html',
  '/privacy.html',
  '/style.css',
  '/shared.js',
  '/manifest.json',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;900&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (e.request.url.includes('supabase.co')) return; // never cache API calls

  e.respondWith(
    caches.match(e.request).then(cached => {
      const network = fetch(e.request).then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => cached || new Response(
        '<h1>Offline</h1><p>This page isn\'t cached yet — reconnect and try again.</p>',
        { status: 503, headers: { 'Content-Type': 'text/html' } }
      ));
      return cached || network;
    })
  );
});
