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

const SHELL_VERSION = 'shell-v64';
const TILE_CACHE    = 'tiles-v1';
// How old a cached tile may get before it is refreshed IN THE BACKGROUND. It
// is never an expiry: a stale tile is still served, and a failed refresh keeps
// the old copy. Deliberately long — the base map (streets, buildings) barely
// moves, and re-fetching costs the player data.
const TILE_REFRESH_MS = 30 * 24 * 60 * 60 * 1000;   // 30 days

// Only assets whose URL here EXACTLY matches the URL the page requests
// belong in this list. Cache.match() keys on the full URL *including the
// query string*, so a precached './src/worldgen.js' can never satisfy the
// page's request for './src/worldgen.js?v=208' — the entry is dead weight,
// and fetching it costs a second, redundant download of every one of those
// files on install, competing for bandwidth with the real page load.
//
// So the versioned src/*.js scripts are deliberately NOT precached. They are
// all plain script tags in index.html, which means the very first page load
// fetches them anyway and the stale-while-revalidate branch below stores each
// one under its real ?v= URL. Precaching them bought nothing and cost ~800 KB.
//
// What is left are the URLs the page really does request verbatim.
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './vendor/phaser.js',
];

self.addEventListener('install', (event) => {
  // Activate this worker immediately rather than waiting for open tabs to
  // close — unconditional so a failure opening the cache below can't strand
  // the new worker in "waiting".
  self.skipWaiting();
  // Pre-cache the app shell on install. Failures here don't block install —
  // any missing asset will be fetched normally and cached lazily on first use.
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_VERSION);
    await Promise.allSettled(SHELL_ASSETS.map(u => cache.add(u)));
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

  // ── MVT tiles: cache-first, kept indefinitely. ───────────────────
  // A cached tile is ALWAYS served, however old it is; age only decides
  // whether to also refresh it in the background (TILE_REFRESH_MS, 30 days).
  // A refresh that fails leaves the cached copy in place — nothing here ever
  // evicts a tile, so a visited area keeps rendering on any network. (The
  // same policy the worldgen IndexedDB layer applies to the decoded bytes;
  // this cache is the HTTP-level half of it.)
  if (isTileRequest(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(TILE_CACHE);
      const hit = await cache.match(req);
      if (hit) {
        const stamped = Date.parse(hit.headers.get('date') || '') || 0;
        if (Date.now() - stamped > TILE_REFRESH_MS) {
          // Background revalidate; failures are swallowed and the hit stands.
          event.waitUntil(fetch(req).then((resp) => {
            if (resp && resp.ok) return cache.put(req, resp.clone());
          }).catch(() => {}));
        }
        return hit;
      }
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
      if (cached) {
        // Serve cache instantly, refresh in the background (stale-while-revalidate).
        event.waitUntil(fetch(req).then((resp) => {
          if (resp.ok) cache.put(req, resp.clone());
        }).catch(() => {}));
        return cached;
      }
      // Not cached → go to network. NEVER resolve respondWith() with undefined:
      // on a network failure return a real error Response so the browser can
      // surface a normal load error instead of throwing a SW invariant.
      try {
        const resp = await fetch(req);
        if (resp.ok) cache.put(req, resp.clone());
        return resp;
      } catch {
        return new Response('', { status: 504, statusText: 'offline' });
      }
    })());
    return;
  }

  // Everything else (CDNs, etc.) — passthrough.
});
