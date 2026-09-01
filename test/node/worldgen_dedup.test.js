// Tests for WorldGen.collectDedupIndex — the cross-tile spawn-dedup index a
// newly-built tile's chests and houses are checked against.
//
// The load-bearing contract is the skipKey: while rebuildTileWithBin replaces
// a tile in place (its Overpass bin landed after it rasterized), the tile's
// own live entry stays in the cache and must be EXCLUDED from the index for
// BOTH kinds. The rebuild spawns its chests and houses at exactly the
// coordinates of the copies it is about to swap out, so an index that still
// sees the old entry dedupes the rebuild against itself and drops them all.
// That happened to houses for real: the skip originally covered only the
// chest index, and every rebuilt tile kept its painted brick footprints but
// lost every house sprite.

const mkCache = () => new Map([
  ['14/5/5', { objects: [
    { kind: 'chest', name: 'Old Mill', x: 100, y: 200 },
    { kind: 'house', x: 350, y: 420 },
    { kind: 'house', x: 357, y: 420 },
    { kind: 'tree', x: 1, y: 2 },              // other kinds are not indexed
  ] }],
  ['14/5/6', { objects: [
    { kind: 'chest', name: 'old mill ', x: 900, y: 900 },   // same name, case/space-insensitive
    { kind: 'house', x: 800, y: 810 },
  ] }],
  ['14/6/5', {}],                              // entry with no objects — skipped
  ['14/6/6', null],                            // dead entry — skipped
]);

test('dedup index: collects chests by normalized name and houses by position', () => {
  const { byName, housePositions } = WorldGen.collectDedupIndex(mkCache(), null);
  assert.eq(byName.size, 1, 'both chests share one normalized name key');
  assert.eq(byName.get('old mill').length, 2, 'both positions recorded under it');
  assert.eq(housePositions.length, 3, 'every cached house position indexed');
});

test('dedup index: skipKey excludes that tile\'s houses AND chests (rebuild-in-place)', () => {
  const { byName, housePositions } = WorldGen.collectDedupIndex(mkCache(), '14/5/5');
  // The regression: houses from the entry being replaced must not be indexed,
  // or the rebuild drops every one of its own house sprites as a "duplicate"
  // and the tile's building footprints render bare.
  assert.eq(housePositions.length, 1, 'skipped tile contributes no house positions');
  assert.eq(housePositions[0].x, 800, 'the remaining house is the other tile\'s');
  assert.eq(byName.get('old mill').length, 1, 'skipped tile contributes no chests');
});

test('dedup index: other tiles still index normally while one is skipped', () => {
  const { byName, housePositions } = WorldGen.collectDedupIndex(mkCache(), '14/5/6');
  assert.eq(housePositions.length, 2, 'houses of non-skipped tiles survive');
  assert.eq(byName.get('old mill').length, 1, 'chest of the non-skipped tile survives');
});

// ── houseNear: the same answer the linear scan gave, without the scan ──────
//
// "Is a house already within HOUSE_DEDUP_M of this one" was a walk of every
// house in every cached tile, run once per house of the tile being built — so
// its cost was (houses per tile) x (houses in the ring), growing with each tile
// the neighbour ring added, and it runs AFTER rasterize resolves, outside the
// sliced build where nothing can break it up. A boot trace charged it six
// frames over 100ms (worst 253ms) with no span more specific than
// `neighbour ring (in the background)` open. The index buckets houses by
// HOUSE_DEDUP_M now and probes nine buckets.
//
// These tests pin the ANSWER, since that is what the rewrite could have
// changed: a bucketing that misses a neighbour lets duplicate roofs through,
// and one that over-reaches eats real houses off a dense street.
(function () {
const near = (idx, x, y) => idx.houseNear(x, y);
// The rule as it was written: any indexed house within 6 m, Euclidean.
const brute = (idx, x, y) => idx.housePositions.some((p) => {
  const dx = p.x - x, dy = p.y - y;
  return dx * dx + dy * dy <= 36;
});

test('house dedup: agrees with a full scan everywhere, including bucket seams', () => {
  // A ring of houses on deliberately awkward coordinates — negative, on and
  // either side of the 6 m bucket boundaries, and clustered — then probed on a
  // fine lattice that straddles every seam.
  const cache = new Map([['14/1/1', { objects: [] }]]);
  const objs = cache.get('14/1/1').objects;
  let s = 20250901;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < 400; i++) objs.push({ kind: 'house', x: (rnd() - 0.5) * 400, y: (rnd() - 0.5) * 400 });
  for (let i = 0; i < 40; i++) objs.push({ kind: 'house', x: i * 6, y: 0 });       // exactly on the seams
  const idx = WorldGen.collectDedupIndex(cache, null);
  let probes = 0, agreed = 0;
  for (let x = -60; x <= 60; x += 1.5) {
    for (let y = -60; y <= 60; y += 1.5) {
      probes++;
      if (near(idx, x, y) === brute(idx, x, y)) agreed++;
    }
  }
  assert.gt(probes, 5000, 'the lattice actually probed the space');
  assert.eq(agreed, probes, 'the bucketed answer differs from the full scan somewhere');
});

test('house dedup: the radius is exactly HOUSE_DEDUP_M, not a bucket', () => {
  const cache = new Map([['14/1/1', { objects: [{ kind: 'house', x: 100, y: 100 }] }]]);
  const idx = WorldGen.collectDedupIndex(cache, null);
  assert.eq(near(idx, 105.9, 100), true, 'just inside 6 m is a duplicate');
  assert.eq(near(idx, 106.1, 100), false, 'just outside 6 m is a different house');
  // The diagonal is the case a naive 3x3-bucket test gets wrong: two houses can
  // share a neighbouring bucket and still be 8 m apart.
  assert.eq(near(idx, 104.5, 104.5), false, 'a diagonal neighbour outside the radius survives');
  assert.eq(near(idx, 104, 104), true, 'a diagonal neighbour inside it does not');
});

test('house dedup: a kept house is indexed for the rest of the same tile', () => {
  // Two roofs of the SAME tile land on the same spot (a building duplicated
  // across the seam of the tile being built). The first is kept, and it has to
  // be in the index by the time the second is judged.
  const idx = WorldGen.collectDedupIndex(new Map(), null);
  assert.eq(near(idx, 500, 500), false, 'nothing indexed yet');
  idx.addHouse(500, 500);
  assert.eq(near(idx, 502, 501), true, 'the house just kept is now a duplicate source');
  assert.eq(idx.housePositions.length, 1, 'and it joins the flat index too');
});

test('house dedup: a full neighbour ring of houses stays cheap', () => {
  // The shape that stuttered: eight cached tiles of houses, then a ninth tile's
  // worth judged against them. Held to a block cap rather than a benchmark —
  // the old scan took seconds here, so a machine being slow cannot fail it, but
  // anything that goes quadratic again will.
  const cache = new Map();
  let s = 13699;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const EDGE = 2366;
  for (let t = 0; t < 8; t++) {
    const objects = [];
    const ox = (t % 3) * EDGE, oy = Math.floor(t / 3) * EDGE;
    for (let i = 0; i < 4000; i++) objects.push({ kind: 'house', x: ox + rnd() * EDGE, y: oy + rnd() * EDGE });
    cache.set(`14/${t}/0`, { objects });
  }
  const idx = WorldGen.collectDedupIndex(cache, null);
  assert.eq(idx.housePositions.length, 32000, 'the ring is as big as a dense ring really is');
  const t0 = Date.now();
  let kept = 0;
  for (let i = 0; i < 4000; i++) {
    const x = EDGE * 0.9 + rnd() * EDGE, y = rnd() * EDGE;
    if (!idx.houseNear(x, y)) { idx.addHouse(x, y); kept++; }
  }
  const took = Date.now() - t0;
  assert.gt(kept, 0, 'the pass actually kept houses — not a vacuous timing');
  assert.lt(took, 400, `judging one tile against the ring took ${took}ms — the index went linear again`);
});
})();
