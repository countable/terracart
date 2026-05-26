// Terracart service worker.
//
// Two caches:
//   1. SHELL_CACHE — versioned. Bumped on every deploy to invalidate stale
//      JS / HTML. Strategy: stale-while-revalidate (instant load, refresh in
//      background). Includes the app HTML + same-origin scripts/textures.
//   2. TILE_CACHE  — unversioned. Stores OpenFreeMap MVT tiles indefinitely.
//      Tiles are immutable per snapshot URL (the `20260520_001001_pt` segment),
//      so they're safe to cache forever. Strategy: cache-first with network
//      fallback. This makes a visited region playable offline.

const SHELL_VERSION = 'shell-v6';
const TILE_CACHE    = 'tiles-v1';

const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './phaser.js',
  './mvt.js',
  './worldgen.js',
  './crops.js',
  './textures.js',
  './app.js',
];

self.addEventListener('install', (event) => {
  // Pre-cache the app shell on install. Failures here don't block install —
  // any missing asset will be fetched normally and cached lazily on first use.
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_VERSION);
    await Promise.allSettled(SHELL_ASSETS.map(u => cache.add(u)));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  // Drop stale shell caches from prior versions. Keep TILE_CACHE forever.
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(k => k !== SHELL_VERSION && k !== TILE_CACHE)
      .map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Helper: is this request an OpenFreeMap MVT tile?
function isTileRequest(url) {
  return url.host === 'tiles.openfreemap.org' && url.pathname.endsWith('.pbf');
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // ── MVT tiles: cache-first, indefinite. ──────────────────────────
  if (isTileRequest(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(TILE_CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      try {
        const resp = await fetch(req);
        // Only cache successful responses. 4xx/5xx pass through uncached.
        if (resp.ok) cache.put(req, resp.clone());
        return resp;
      } catch (err) {
        // Offline + uncached → opaque 504 the worldgen code already handles.
        return new Response('', { status: 504, statusText: 'offline' });
      }
    })());
    return;
  }

  // ── Same-origin app shell ────────────────────────────────────────
  // HTML (index.html, "/") is NETWORK-FIRST so a fresh deploy lands on
  // the very next reload instead of waiting an extra cycle. Falls back
  // to cache only when the network fails (offline).
  // JS / images / etc. are STALE-WHILE-REVALIDATE — versioned via ?v=
  // in the script tags, so the URL itself changes on each deploy and
  // the cache lookup naturally misses for stale entries.
  if (url.origin === self.location.origin) {
    const isHTML = req.mode === 'navigate'
      || (req.destination === 'document')
      || url.pathname === '/' || url.pathname.endsWith('/')
      || url.pathname.endsWith('.html');
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_VERSION);
      if (isHTML) {
        try {
          const resp = await fetch(req);
          if (resp.ok) cache.put(req, resp.clone());
          return resp;
        } catch {
          const cached = await cache.match(req);
          if (cached) return cached;
          throw new Error('offline and no cached HTML');
        }
      }
      const cached = await cache.match(req);
      const networkPromise = fetch(req).then((resp) => {
        if (resp.ok) cache.put(req, resp.clone());
        return resp;
      }).catch(() => cached);
      return cached || networkPromise;
    })());
    return;
  }

  // Everything else (CDNs, etc.) — passthrough.
});
