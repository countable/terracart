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

const SHELL_VERSION = 'shell-v151';
const TILE_CACHE    = 'tiles-v1';
// How old a cached tile may get before it is refreshed IN THE BACKGROUND. It
// is never an expiry: a stale tile is still served, and a failed refresh keeps
// the old copy. Deliberately long — the base map (streets, buildings) barely
// moves, and re-fetching costs the player data.
const TILE_REFRESH_MS = 30 * 24 * 60 * 60 * 1000;   // 30 days

// The non-script shell. The SCRIPTS are not listed here on purpose — they're
// read out of index.html at install time (see scriptUrlsFromIndex), because a
// hand-maintained list drifts: this one once named 6 of the ~25 modules the
// page loads, app.js among them and save.js not, which is exactly how a boot
// could end up with the app but not its save layer ("loadSave is not defined").
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './vendor/phaser.js',
];

// Every same-origin script index.html pulls in, at the exact ?v= URLs it asks
// for. Covers both the plain <script src> tags and app.js, which the boot gate
// injects from the APP_SRC string rather than a tag.
async function scriptUrlsFromIndex() {
  try {
    const resp = await fetch('./index.html', { cache: 'no-cache' });
    if (!resp.ok) return [];
    const html = await resp.text();
    const urls = [];
    for (const m of html.matchAll(/<script[^>]+src=["']([^"']+)["']/g)) urls.push(m[1]);
    const app = html.match(/APP_SRC\s*=\s*['"]([^'"]+)['"]/);
    if (app) urls.push(app[1]);
    // Same-origin only — a CDN URL isn't ours to cache.
    return urls.filter(u => !/^[a-z]+:\/\//i.test(u) && !u.startsWith('//'));
  } catch (_) {
    return [];
  }
}

self.addEventListener('install', (event) => {
  // Activate this worker immediately rather than waiting for open tabs to
  // close — unconditional so a failure opening the cache below can't strand
  // the new worker in "waiting".
  self.skipWaiting();
  // Pre-cache the app shell on install. Failures here don't block install —
  // any missing asset will be fetched normally and cached lazily on first use.
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_VERSION);
    const scripts = await scriptUrlsFromIndex();
    await Promise.allSettled([...SHELL_ASSETS, ...scripts].map(u => cache.add(u)));
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
        let resp = null;
        try { resp = await fetch(req); } catch (_) { resp = null; }
        if (resp && resp.ok) {
          cache.put(req, resp.clone());
          return resp;
        }
        // Offline, or the server answered 5xx — the last good copy beats an
        // error page, and its ?v= URLs are the ones already in this cache.
        const cachedHTML = await cache.match(req)
          || await cache.match(req, { ignoreSearch: true });
        if (cachedHTML) return cachedHTML;
        return resp || new Response('', { status: 504, statusText: 'offline' });
      }
      const cached = await cache.match(req);
      if (cached) {
        // Serve cache instantly, refresh in the background (stale-while-revalidate).
        event.waitUntil(fetch(req).then((resp) => {
          if (resp.ok) cache.put(req, resp.clone());
        }).catch(() => {}));
        return cached;
      }
      // Not cached — this exact ?v= is new, so go to network.
      let resp = null;
      try { resp = await fetch(req); } catch (_) { resp = null; }
      if (resp && resp.ok) {
        cache.put(req, resp.clone());
        return resp;
      }
      // The fetch died or came back 4xx/5xx. A page HALF loads in that case:
      // the modules already cached run, the one that failed doesn't, and the
      // app throws on the first symbol from the missing file ("loadSave is not
      // defined" on a refresh right after a deploy, when a single request
      // hiccuped). So fall back to ANY cached build of the same PATH, ignoring
      // the ?v=. A module one deploy stale still defines its functions; a
      // missing one defines nothing, and the whole game is dead until the
      // network comes back. Mixed versions are the lesser evil, and only ever
      // happen on a request that already failed.
      const stale = await cache.match(req, { ignoreSearch: true });
      if (stale) return stale;
      // Nothing cached under that path either. NEVER resolve respondWith()
      // with undefined: hand back a real Response so the browser surfaces a
      // normal load error instead of a SW invariant.
      return resp || new Response('', { status: 504, statusText: 'offline' });
    })());
    return;
  }

  // Everything else (CDNs, etc.) — passthrough.
});
