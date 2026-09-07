// THE TRAILER MUST NOT OUTLIVE A REAL HOUSE ON ITS OWN FOOTING.
//
// WHAT BROKE. ensureStarterShopId synthesizes the starter trailer only when
// no house is visible on screen — but "visible" reads entry.objects, which is
// the POST cross-tile-dedup list. That dedup's outcome depends on which
// neighbour tiles happen to be cached at build time (the same volatility
// CLAUDE.md documents for the cave-entrance staircase: "a tile can be
// REBUILT under you"), so a house can be deduped away on the build that ran
// when the trailer was first synthesized, then survive on a later rebuild
// (warmOverpass's evict-and-rebuild) or on the next page load (a cold tile
// cache re-runs the whole dedup and can land on a different outcome). Once
// the trailer is locked in as save.starterShopId, ensureStarterShopId never
// re-evaluates it — so the phantom trailer and the newly-arrived real house
// end up sharing one cell: "the trailer takes over a house footing, and the
// house appears after a refresh."
//
// THE FIX. ensureStarterTrailerObject (the per-frame keep-alive for the
// synthetic trailer) now checks its own owning tile for a real house sharing
// its exact cell, and defers to it — dropping the synthetic trailer and
// adopting the real house as Home — instead of leaving both parked on the
// same footing forever.
//
// (app.js needs Phaser and cannot be loaded headlessly, so this drives the
// shipping method body lifted verbatim by run.js, the same trick
// spawn_rebuild.test.js uses for rebuildTileWithBin's neighbour, the spawn gate.)

function estScene(save) {
  return {
    save,
    depth: 0,
    mPerPx: 1,
    originPx: { x: 0, y: 0 },
    startWorldM: { x: 0, y: 0 },
    cellsPerTile: WorldGen.TILE_PX,   // 1 world-metre == 1 cell, for simple arithmetic
    _starterTrailerObj: null,
    _cratesAt: null,
    _setStarterCratesAt(x, y) { if (!this._cratesAt) this._cratesAt = { x, y }; },
    clearHomeTrailerOverlap() {},
  };
}

function runEnsureStarterTrailerObject(scene) {
  new Function(ENSURE_STARTER_TRAILER_SRC).call(scene);
}

// A tile small enough to sit at (0,0) under the trailer's own (mPerPx=1,
// TILE_PX-cells-per-tile) lookup math: tx = floor((x/mPerPx)/TILE_PX).
const EST_KEY = WorldGen.tileKey(0, 0);

test('starter trailer footing: with no real house nearby, the trailer injects as usual', () => {
  const scene = estScene({ starterTrailer: { id: 'starter_trailer', x: 10.5, y: 20.5, tier: 9, address: 1 },
    starterShopId: 'starter_trailer' });
  const entry = { objects: [] };
  WorldGen.tileCache.set(EST_KEY, entry);
  try {
    runEnsureStarterTrailerObject(scene);
    assert.truthy(entry.objects.some(o => o.id === 'starter_trailer'), 'the trailer is injected');
    assert.eq(scene.save.starterShopId, 'starter_trailer', 'still Home');
    assert.truthy(scene.save.starterTrailer, 'trailer record kept');
  } finally { WorldGen.tileCache.delete(EST_KEY); }
});

test('starter trailer footing: a real house on the exact same cell is adopted instead', () => {
  const scene = estScene({ starterTrailer: { id: 'starter_trailer', x: 10.5, y: 20.5, tier: 9, address: 1 },
    starterShopId: 'starter_trailer' });
  // Same absolute cell as the trailer (floor(10.5)=10, floor(20.5)=20) but not
  // bit-identical coordinates — the two positions are snapped by different
  // code paths (worldgen's footprint centroid vs the trailer's own snap), so
  // the fix has to compare CELLS, not exact floats.
  const realHouse = { kind: 'house', id: 'h_real', x: 10.9, y: 20.1 };
  const entry = { objects: [realHouse] };
  WorldGen.tileCache.set(EST_KEY, entry);
  try {
    runEnsureStarterTrailerObject(scene);
    assert.falsy(scene.save.starterTrailer, 'the synthetic trailer record is dropped');
    assert.eq(scene.save.starterShopId, 'h_real', 'the real house is adopted as Home instead');
    assert.falsy(entry.objects.some(o => o._synthetic), 'no phantom trailer left in the tile');
    assert.truthy(entry.objects.includes(realHouse), 'the real house is untouched');
  } finally { WorldGen.tileCache.delete(EST_KEY); }
});

test('starter trailer footing: an already-injected trailer is removed once the house appears', () => {
  // Simulates the exact regression: the trailer injected on an earlier frame
  // (or an earlier session), then the tile got rebuilt and now also carries
  // the real house on the same footing.
  const scene = estScene({ starterTrailer: { id: 'starter_trailer', x: 10.5, y: 20.5, tier: 9, address: 1 },
    starterShopId: 'starter_trailer' });
  const phantom = { kind: 'house', id: 'starter_trailer', x: 10.5, y: 20.5, _synthetic: true };
  const realHouse = { kind: 'house', id: 'h_real', x: 10.9, y: 20.1 };
  const entry = { objects: [phantom, realHouse] };
  WorldGen.tileCache.set(EST_KEY, entry);
  try {
    scene._starterTrailerObj = phantom;
    runEnsureStarterTrailerObject(scene);
    assert.falsy(entry.objects.includes(phantom), 'the phantom trailer object is removed from the tile');
    assert.eq(scene.save.starterShopId, 'h_real', 'the real house takes over as Home');
  } finally { WorldGen.tileCache.delete(EST_KEY); }
});

test('starter trailer footing: a house in a NEIGHBOURING cell is left alone (not a footing conflict)', () => {
  const scene = estScene({ starterTrailer: { id: 'starter_trailer', x: 10.5, y: 20.5, tier: 9, address: 1 },
    starterShopId: 'starter_trailer' });
  const neighbour = { kind: 'house', id: 'h_neighbour', x: 25.5, y: 20.5 };   // different cell
  const entry = { objects: [neighbour] };
  WorldGen.tileCache.set(EST_KEY, entry);
  try {
    runEnsureStarterTrailerObject(scene);
    assert.eq(scene.save.starterShopId, 'starter_trailer', 'a neighbouring house does not evict the trailer');
    assert.truthy(scene.save.starterTrailer, 'trailer record kept');
    assert.truthy(entry.objects.some(o => o.id === 'starter_trailer'), 'the trailer is still injected');
  } finally { WorldGen.tileCache.delete(EST_KEY); }
});
