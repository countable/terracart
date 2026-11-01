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
// 'late' answers only when log.release() is called. `request`: 'ok' completes
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
      else if (open === 'late') log.release = () => req.onsuccess?.();
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

})();
