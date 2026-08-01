/* RevM² Service Worker — Offline Support */
const CACHE = 'revm2-v8'; // bumped: was v7. Removed calculator.html and
// predictor.html from SHELL below (pages deleted from the platform) -
// this bump purges them out of every existing client's cache too, not
// just new installs.
const SHELL = [
  '/',
  '/index.html',
  '/login.html',
  '/tracker.html',
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

  // HTML page loads (actual navigations, e.g. opening blocks.html) always
  // go network-first. This is an actively-developed product shipping new
  // features regularly - cache-first on documents meant "I shipped it but
  // it's not showing up" every single time, for every returning user,
  // until someone thought to manually bump CACHE above. Network-first
  // fixes that permanently: you always get the live page when online, and
  // only fall back to whatever's cached if you're genuinely offline.
  // Static assets (css/js/fonts/manifest) below keep cache-first, since
  // those change far less often and benefit from the speed without this
  // staleness risk.
  const isNavigation = e.request.mode === 'navigate' ||
    (e.request.headers.get('accept') || '').includes('text/html');

  if (isNavigation) {
    e.respondWith(
      fetch(e.request).then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() =>
        caches.match(e.request).then(cached => cached || new Response(
          '<h1>Offline</h1><p>This page isn\'t cached yet — reconnect and try again.</p>',
          { status: 503, headers: { 'Content-Type': 'text/html' } }
        ))
      )
    );
    return;
  }

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
