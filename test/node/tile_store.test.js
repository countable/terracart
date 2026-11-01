// THE TILE STORE NEVER HANGS A TILE.
//
// IndexedDB can stall — an open or a request that never settles, most often
// on the page load right after a reload. WorldGen's raw tile store
// (worldgen.js openIDB / idbGet / idbPut) used to memoise its open promise
// with no bound on it or on any request, so one stalled open hung every tile
// fetch after it: nothing failed, nothing retried, no banner — the player
// stood on bare ground with no roads or buildings until the next refresh.
//
// These tests pin the bounded contract with a scripted fetch and a fake
// IndexedDB in the vm context: a stalled open or request is a cache MISS
// (the tile still arrives from the network), the stalled connection is
// forgotten so the next call opens afresh, and a late answer is closed, not
// kept. A healthy store still answers from cache.
(function () {

const WG = WorldGen;
const tileJson = () => ({ ok: true, status: 200, json: async () => ({ tiles: [WG.TILE_URL_FALLBACK] }) });
const okTile = () => ({ ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });

// A fake store. `open`: 'ok' answers next microtask, 'stall' never answers,
// 'late' answers only when log.release() is called — and only the FIRST open,
// the one that has certainly timed out by then (which open is last depends on
// how many microtask hops the fetch path takes, not on the store). `request`: 'ok' completes
// transactions next microtask, 'stall' never completes them.
function fakeStore({ open = 'ok', request = 'ok' } = {}) {
  const data = new Map();
  const log = { opens: 0, closes: 0, aborts: 0, release: null };
  const later = (fn) => Promise.resolve().then(fn);
  const db = {
    close() { log.closes++; },
    transaction() {
      const tx = { error: null, oncomplete: null, onerror: null, onabort: null, abort() { log.aborts++; } };
      tx.objectStore = () => ({
        get(key) {
          const req = { result: undefined, onsuccess: null };
          if (request === 'ok') later(() => { req.result = data.get(key); req.onsuccess?.(); later(() => tx.oncomplete?.()); });
          return req;
        },
        put(val, key) {
          data.set(key, val);
          if (request === 'ok') later(() => tx.oncomplete?.());
        },
      });
      return tx;
    },
  };
  const indexedDB = {
    open() {
      log.opens++;
      const req = { result: db, error: null, onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null };
      if (open === 'ok') later(() => req.onsuccess?.());
      else if (open === 'late' && !log.release) log.release = () => req.onsuccess?.();
      return req;
    },
  };
  return { indexedDB, data, log };
}

// The vm's setTimeout is a no-op. The store's timeouts become a microtask
// "timer" that fires three hops later: a healthy fake answers in one hop and
// wins; a stalled one never answers and the timer takes over.
function withStore(store, fn) {
  const realFetch = globalThis.fetch, realIDB = globalThis.indexedDB;
  const realSet = globalThis.setTimeout, realClear = globalThis.clearTimeout;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return String(url) === WG.TILEJSON_URL ? tileJson() : okTile();
  };
  globalThis.indexedDB = store.indexedDB;
  globalThis.setTimeout = (cb) => { Promise.resolve().then(() => Promise.resolve()).then(() => Promise.resolve()).then(cb); return 1; };
  globalThis.clearTimeout = () => {};
  WG._resetTileUrlForTest();
  WG._resetTileStoreForTest();
  return Promise.resolve()
    .then(() => fn(calls))
    .finally(() => {
      globalThis.fetch = realFetch; globalThis.indexedDB = realIDB;
      globalThis.setTimeout = realSet; globalThis.clearTimeout = realClear;
      WG._resetTileUrlForTest();
      WG._resetTileStoreForTest();
    });
}
const tileFetches = (calls) => calls.filter(u => u !== WG.TILEJSON_URL).length;

test('tile store: a stalled open is a cache miss, and is forgotten for the next call', () => {
  const store = fakeStore({ open: 'stall' });
  return withStore(store, async (calls) => {
    const got = await WG.fetchTileBytes(5, 5);
    assert.eq(got.fromCache, false, 'the tile came from the network');
    assert.eq(got.bytes.length, 3, 'the tile arrived');
    assert.eq(tileFetches(calls), 1);
    // A fetch opens the store more than once (the TileJSON memo, the read, the
    // write-back); what matters is that every later call opens afresh.
    const opens = store.log.opens;
    assert.eq(opens >= 1, true);
    await WG.fetchTileBytes(6, 6);
    assert.eq(store.log.opens > opens, true, 'a stalled open is not inherited by the next call');
    assert.eq(tileFetches(calls), 2, 'and that call also fell through to the network');
  });
});

test('tile store: a connection that answers after its open timed out is closed, not kept', () => {
  const store = fakeStore({ open: 'late' });
  return withStore(store, async (calls) => {
    const got = await WG.fetchTileBytes(5, 5);
    assert.eq(got.fromCache, false);
    assert.eq(store.log.closes, 0);
    const opens = store.log.opens;
    store.log.release();
    assert.eq(store.log.closes, 1, 'the late connection is closed');
    await WG.fetchTileBytes(6, 6);
    assert.eq(store.log.opens > opens, true, 'the next call opened afresh');
    assert.eq(tileFetches(calls), 2);
  });
});

test('tile store: a stalled request is abandoned and its connection forgotten', () => {
  const store = fakeStore({ open: 'ok', request: 'stall' });
  return withStore(store, async (calls) => {
    const got = await WG.fetchTileBytes(5, 5);
    assert.eq(got.fromCache, false, 'a read that never completes is a miss');
    assert.eq(got.bytes.length, 3);
    assert.eq(store.log.aborts >= 1, true, 'the stalled transaction was aborted');
    assert.eq(store.log.closes >= 1, true, 'the wedged connection was closed');
    const opens = store.log.opens;
    await WG.fetchTileBytes(6, 6);
    assert.eq(store.log.opens > opens, true, 'the next call opened afresh');
    assert.eq(tileFetches(calls), 2);
  });
});

test('tile store: a healthy store still answers from cache without a fetch', () => {
  const store = fakeStore();
  store.data.set(WG.tileKey(7, 8), { bytes: new Uint8Array([9, 9]), fetchedAt: Date.now() });
  return withStore(store, async (calls) => {
    const got = await WG.fetchTileBytes(7, 8);
    assert.eq(got.fromCache, true, 'served from the store');
    assert.eq(got.bytes.length, 2);
    assert.eq(tileFetches(calls), 0, 'no network');
    assert.eq(store.log.opens, 1);
    assert.eq(store.log.closes, 0, 'a healthy connection is kept');
    const miss = await WG.fetchTileBytes(1, 2);
    assert.eq(miss.fromCache, false);
    assert.eq(store.log.opens, 1, 'and reused');
    assert.eq(store.data.has(WG.tileKey(1, 2)), true, 'the fetched tile was written back');
  });
});

// THE NETWORK NEVER HANGS A TILE EITHER. A fetch that never settles (a radio
// dropped mid-transfer, a captive portal that accepts and never answers) used
// to leave the entry 'loading' for the life of the page: nothing rejected, so
// nothing evicted, retried or raised the banner — bare ground with no roads
// until the next refresh, from the network side this time. Every network wait
// now runs under a deadline (WorldGen.TILE_FETCH_TIMEOUT_MS for a tile's
// headers and body, TILEJSON_FETCH_TIMEOUT_MS for the template) that aborts
// the request AND rejects the wait.
//
// `hang` says which URLs never answer; `fire` is the one delay the fake clock
// lets run (a few microtask hops later) — the vm's setTimeout is otherwise a
// no-op, so every other timer stays silent. A fake AbortController records
// whether the hung request was actually aborted.
function withNetwork({ hang = () => false, fire } = {}, fn) {
  const realFetch = globalThis.fetch, realIDB = globalThis.indexedDB;
  const realSet = globalThis.setTimeout, realClear = globalThis.clearTimeout;
  const realAbort = globalThis.AbortController;
  const calls = [], signals = [];
  globalThis.fetch = (url, init) => {
    const u = String(url);
    calls.push(u);
    if (init && init.signal) signals.push({ url: u, signal: init.signal });
    if (hang(u)) return new Promise(() => {});
    return Promise.resolve(u === WG.TILEJSON_URL ? tileJson() : okTile());
  };
  globalThis.AbortController = class {
    constructor() { this.signal = { aborted: false }; }
    abort() { this.signal.aborted = true; }
  };
  globalThis.indexedDB = fakeStore().indexedDB;
  const hop = (cb) => { Promise.resolve().then(() => Promise.resolve()).then(() => Promise.resolve()).then(cb); };
  globalThis.setTimeout = (cb, ms) => { if (ms === fire) hop(cb); return 1; };
  globalThis.clearTimeout = () => {};
  WG._resetTileUrlForTest();
  WG._resetTileStoreForTest();
  return Promise.resolve()
    .then(() => fn(calls, signals))
    .finally(() => {
      globalThis.fetch = realFetch; globalThis.indexedDB = realIDB;
      globalThis.setTimeout = realSet; globalThis.clearTimeout = realClear;
      if (realAbort === undefined) delete globalThis.AbortController; else globalThis.AbortController = realAbort;
      WG._resetTileUrlForTest();
      WG._resetTileStoreForTest();
    });
}
const isTileJson = (u) => u === WG.TILEJSON_URL;
const isTile = (u) => !isTileJson(u);

test('tile fetch: a tile request that never answers times out as an ordinary failure, and the next call fetches afresh', () =>
  withNetwork({ hang: isTile, fire: WG.TILE_FETCH_TIMEOUT_MS }, async (calls, signals) => {
    let err = null;
    try { await WG.fetchTileBytes(5, 5); } catch (e) { err = e; }
    assert.truthy(err && /timed out/.test(err.message), 'the wait rejected at the deadline: ' + (err && err.message));
    const hung = signals.filter(s => isTile(s.url));
    assert.truthy(hung.length >= 1 && hung.every(s => s.signal.aborted), 'the hung request itself was aborted');
    // The scene's one classifier: a timeout is 'failed' — retried, and
    // bannered when it is the ground under the player — never 'permanent'.
    const kind = liftSceneMethod('_tileFailureKind');
    assert.eq(kind.call({}, err, null), 'failed');
    const before = tileFetches(calls);
    err = null;
    try { await WG.fetchTileBytes(5, 5); } catch (e) { err = e; }
    assert.truthy(err, 'still hanging, still failing');
    assert.eq(tileFetches(calls) > before, true, 'nothing memoised the hang: the retry asked the network again');
  }));

test('tile fetch: a TileJSON that never answers keeps the current template and the tile still arrives', () =>
  withNetwork({ hang: isTileJson, fire: WG.TILEJSON_FETCH_TIMEOUT_MS }, async (calls, signals) => {
    const got = await WG.fetchTileBytes(3, 4);
    assert.eq(got.fromCache, false);
    assert.eq(got.bytes.length, 3, 'fetched under the pinned fallback');
    assert.eq(WG.tileUrlTemplate(), WG.TILE_URL_FALLBACK, 'the template was left alone');
    assert.truthy(signals.some(s => isTileJson(s.url) && s.signal.aborted), 'the hung TileJSON request was aborted');
    assert.eq(tileFetches(calls), 1);
  }));

test('tile fetch: a healthy transfer is never cut off by its own deadline', () =>
  withNetwork({ fire: WG.TILE_FETCH_TIMEOUT_MS }, async (calls, signals) => {
    const got = await WG.fetchTileBytes(8, 8);
    assert.eq(got.fromCache, false);
    assert.eq(got.bytes.length, 3, 'the tile arrived whole');
    assert.eq(tileFetches(calls), 1, 'one fetch, no retry');
    // The deadline's late firing (the fake clock cannot be cleared) is harmless
    // to a settled transfer — the result above already stands.
    await new Promise(r => Promise.resolve().then(() => Promise.resolve()).then(() => Promise.resolve()).then(r));
    assert.eq(got.bytes.length, 3);
  }));

})();
