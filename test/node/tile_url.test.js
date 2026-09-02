// THE TILE URL IS RESOLVED, NOT PINNED.
//
// OpenFreeMap serves each weekly planet build from a dated directory and keeps
// two of them; the rest are deleted. A tile URL with a version baked in
// therefore stops working within weeks — every uncached tile fails, as a
// network error rather than a tile 404 — which surfaced as "can't reach the
// map — tap to retry" that no tap could clear, on a blank ground, for anyone
// standing somewhere their IndexedDB hadn't cached months ago.
//
// WorldGen.resolveTileUrl asks the TileJSON for the live template and
// fetchTileBytes re-asks it once when a tile fetch fails. These tests pin that
// contract with a scripted `fetch` in the vm context (no network, no
// IndexedDB — idbGet returns null here, so the cache branch is never taken).
(function () {

const WG = WorldGen;
const PINNED = WG.TILE_URL_FALLBACK;
const NEW = 'https://tiles.openfreemap.org/planet/20260826_001001_pt/{z}/{x}/{y}.pbf';

// A scripted fetch: `script` maps a URL predicate to a response factory, in
// order; the first matching entry answers. Every call is recorded.
function withFetch(script, fn) {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    for (const [match, respond] of script) {
      if (match(String(url))) return respond(String(url));
    }
    throw new TypeError('Failed to fetch');   // what a CORS-shaped failure looks like
  };
  WG._resetTileUrlForTest();
  return Promise.resolve()
    .then(() => fn(calls))
    .finally(() => { globalThis.fetch = realFetch; WG._resetTileUrlForTest(); });
}
const isTileJson = (u) => u === WG.TILEJSON_URL;
const tileJson = (template) => () => ({ ok: true, status: 200, json: async () => ({ tiles: [template] }) });
const okTile = () => ({ ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });
const http = (status) => () => ({ ok: false, status });
const underVersion = (template) => (u) => u.startsWith(template.replace(/\{z\}.*$/, ''));

test('tile url: the pinned fallback is a fillable template on the tile host', () => {
  WG._resetTileUrlForTest();
  assert.eq(WG.tileUrlTemplate(), PINNED, 'starts pinned');
  assert.eq(WG.tileUrlFor(7, 9), PINNED.replace('{z}', WG.Z).replace('{x}', 7).replace('{y}', 9), 'fills z/x/y');
  assert.truthy(PINNED.startsWith('https://tiles.openfreemap.org/'), 'pinned to the tile host');
});

test('tile url: the TileJSON tiles[0] replaces the pinned template', () =>
  withFetch([[isTileJson, tileJson(NEW)]], async (calls) => {
    const got = await WG.resolveTileUrl();
    assert.eq(got, NEW, 'resolves to the live template');
    assert.eq(WG.tileUrlTemplate(), NEW, 'and fetches under it from now on');
    assert.eq(calls.filter(isTileJson).length, 1, 'asked the TileJSON once');
  }));

test('tile url: nine tiles at boot ask the TileJSON once', () =>
  withFetch([[isTileJson, tileJson(NEW)]], async (calls) => {
    await Promise.all([1, 2, 3, 4, 5, 6, 7, 8, 9].map(() => WG.resolveTileUrl()));
    assert.eq(calls.filter(isTileJson).length, 1, 'one memoised ask');
  }));

test('tile url: a TileJSON from another host is refused', () =>
  withFetch([[isTileJson, tileJson('https://evil.example/planet/x/{z}/{x}/{y}.pbf')]], async () => {
    await WG.resolveTileUrl();
    assert.eq(WG.tileUrlTemplate(), PINNED, 'a fetched document does not get to redirect the tile host');
  }));

test('tile url: a TileJSON without a fillable template is refused', () =>
  withFetch([[isTileJson, tileJson('https://tiles.openfreemap.org/planet/x/14/1/2.pbf')]], async () => {
    await WG.resolveTileUrl();
    assert.eq(WG.tileUrlTemplate(), PINNED, 'no {z}/{x}/{y} means nothing to fill in');
  }));

test('tile url: an unreachable TileJSON leaves the template alone', () =>
  withFetch([], async () => {
    const got = await WG.resolveTileUrl();
    assert.eq(got, PINNED, 'never rejects — a first offline run still has the pinned one');
  }));

test('tile url: a TileJSON answering an error leaves the template alone', () =>
  withFetch([[isTileJson, http(503)]], async () => {
    await WG.resolveTileUrl();
    assert.eq(WG.tileUrlTemplate(), PINNED);
  }));

// The whole point: the snapshot rotates mid-session. The version we resolved
// at boot starts failing; one re-ask yields the new version; the tile lands.
test('tile url: a failed tile fetch re-asks the TileJSON and retries under the new version', () => {
  let asked = 0;
  const realNow = Date.now;
  let t = 1_000_000;
  Date.now = () => t;
  return withFetch([
    [isTileJson, () => (++asked === 1 ? tileJson(PINNED)() : tileJson(NEW)())],
    [underVersion(PINNED), http(404)],
    [underVersion(NEW), okTile],
  ], async (calls) => {
    await WG.resolveTileUrl();
    assert.eq(WG.tileUrlTemplate(), PINNED, 'boot resolved the (about to rotate) version');
    t += 5 * 60 * 1000;                                  // five minutes later the host rotated
    const got = await WG.fetchTileBytes(100, 200);
    assert.eq(got.fromCache, false);
    assert.eq(got.bytes.length, 3, 'the tile arrived');
    assert.eq(WG.tileUrlTemplate(), NEW, 'and the template moved with it');
    assert.eq(calls.length, 4, 'tilejson, old tile, tilejson, new tile — no more');
    assert.truthy(underVersion(PINNED)(calls[1]) && underVersion(NEW)(calls[3]), 'retried under the NEW version');
  }).finally(() => { Date.now = realNow; });
});

// A host that is simply down is asked once a minute, not once per tile of the
// ring — and the tile's own failure is what the caller sees, unchanged, so
// app.js's 4xx / failed classification still works.
test('tile url: a failure that is not a rotation is rethrown as-is, and the host is not hammered', () => {
  const realNow = Date.now;
  let t = 2_000_000;
  Date.now = () => t;
  return withFetch([
    [isTileJson, tileJson(NEW)],
    [underVersion(NEW), http(504)],
  ], async (calls) => {
    let err = null;
    try { await WG.fetchTileBytes(1, 1); } catch (e) { err = e; }
    assert.truthy(err && /HTTP 504/.test(err.message), 'the original error, not a resolver error: ' + (err && err.message));
    const asksAfterFirst = calls.filter(isTileJson).length;
    assert.eq(asksAfterFirst, 1, 'within the minute of the boot ask, the failure does not re-ask');
    t += 61 * 1000;
    err = null;
    try { await WG.fetchTileBytes(2, 2); } catch (e) { err = e; }
    assert.truthy(err && /HTTP 504/.test(err.message));
    assert.eq(calls.filter(isTileJson).length, 2, 'a minute on, one re-ask');
    let err3 = null;
    try { await WG.fetchTileBytes(3, 3); } catch (e) { err3 = e; }
    assert.eq(calls.filter(isTileJson).length, 2, 'and the next tile in the same minute does not ask again');
    assert.truthy(err3);
  }).finally(() => { Date.now = realNow; });
});

// The pinned fallback is the LAST known-good version, not the source of
// truth — but it must at least be shaped like one, or the offline first run
// has nothing to fetch under.
test('tile url: worldgen.js reaches the network only through the resolver', () => {
  const src = WORLDGEN_SRC;
  const direct = src.match(/fetch\(tileUrlFor\(/g) || [];
  assert.eq(direct.length, 1, 'exactly one raw tile fetch (inside fetchTileResponse), got ' + direct.length);
  assert.truthy(/await resolveTileUrl\(\);\s*\n\s*const under = _tileUrl;/.test(src), 'and it resolves first');
});

})();
