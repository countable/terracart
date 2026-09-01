// NOTHING IN A TILE BUILD MAY HOLD THE THREAD FOR LONG.
//
// A tile build is a generator: it yields, the slicer hands the frame back, the
// player gets to move. That contract is only as good as the LONGEST STRETCH
// BETWEEN TWO YIELDS — the budget can only be honoured at a yield, so one
// unbroken pass freezes the game for exactly as long as it runs, however small
// the budget is. Total build time is not the number that stutters; the worst
// block is. See rasterizeTileSliced, which reports it as
// `worst block <N>ms in <label>`.
//
// WHAT THIS CAUGHT. A device trace of the first ten seconds of a walk read
// `1.84s rasterize (9 slices @ 24.0ms, worst block 1397ms in after the layer
// loop)` — nine pauses in a two-second build, one of them holding the thread
// for a second and a half, repeated for all eight tiles of the neighbour ring.
// The culprit was the merged-house thinning at the end of the building layer:
// it asked "is any roof I have kept within one cell of this one" by SCANNING
// every roof kept so far, which is O(H^2) on a tile whose houses are mostly
// spread out — and it sat between the building block's last yield and the
// layer loop's, where the slicer could not reach it. It is a Set lookup over
// the nine cells now.
//
// So this file asserts the INVARIANT, not that one pass. Any future scatter,
// dedup or footprint pass that forgets to yield fails here.
(function () {
const T = WorldGen.T;

// A tile at the real scale the game builds: ~2.4 km of z14 tile at 7 m cells.
const CPE = 300;
const TILE_EDGE_M = CPE * WorldGen.CELL_M;
const EXTENT = 4096;
const M = (m) => m * (EXTENT / TILE_EDGE_M);
const rect = (x, y, w, h) => [{ x: M(x), y: M(y) }, { x: M(x + w), y: M(y) },
                              { x: M(x + w), y: M(y + h) }, { x: M(x), y: M(y + h) },
                              { x: M(x), y: M(y) }];
const poly = (pts) => pts.map(([x, y]) => ({ x: M(x), y: M(y) }));

// Deterministic jitter — the fixture must be the same tile every run.
function rngOf(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
}

// A dense town: `nb` detached buildings on a street grid, over residential and
// commercial ground with a wood and an orchard in it. Spread out on purpose —
// buildings that DON'T merge are the worst case for the thinning pass, because
// nothing is ever dropped, so the kept list only grows.
function townLayers(nb) {
  const rnd = rngOf(2468);
  const buildings = [];
  const side = Math.ceil(Math.sqrt(nb));
  const step = TILE_EDGE_M / side;
  for (let i = 0; i < nb; i++) {
    const gx = i % side, gy = Math.floor(i / side);
    buildings.push({ type: 3, tags: { render_height: 4 + rnd() * 4 },
      geom: [rect(gx * step + rnd() * 2, gy * step + rnd() * 2,
                  Math.min(step * 0.7, 9 + rnd() * 6), Math.min(step * 0.7, 8 + rnd() * 6))] });
  }
  const roads = [];
  for (let i = 0; i <= 11; i++) {
    const p = 20 + i * 180;
    roads.push({ type: 2, tags: { class: 'minor' }, geom: [poly([[0, p], [TILE_EDGE_M, p]])] });
    roads.push({ type: 2, tags: { class: 'minor' }, geom: [poly([[p, 0], [p, TILE_EDGE_M]])] });
  }
  roads.push({ type: 2, tags: { class: 'motorway' }, geom: [poly([[0, 1000], [TILE_EDGE_M, 1020]])] });
  const pois = [];
  for (let i = 0; i < 60; i++) {
    pois.push({ type: 1, tags: { class: 'restaurant', name: `p${i}` },
      geom: [[{ x: M(rnd() * TILE_EDGE_M), y: M(rnd() * TILE_EDGE_M) }]] });
  }
  return [
    { name: 'landcover', features: [
      { type: 3, tags: { class: 'grass' }, geom: [rect(0, 0, TILE_EDGE_M, TILE_EDGE_M)] },
      { type: 3, tags: { class: 'wood' }, geom: [rect(1300, 1300, 600, 600)] },
      { type: 3, tags: { class: 'orchard' }, geom: [rect(200, 1400, 300, 300)] },
    ] },
    { name: 'landuse', features: [
      { type: 3, tags: { class: 'residential' }, geom: [rect(0, 0, TILE_EDGE_M, TILE_EDGE_M)] },
      { type: 3, tags: { class: 'commercial' }, geom: [rect(150, 150, 400, 400)] },
      { type: 3, tags: { class: 'industrial' }, geom: [rect(1600, 250, 400, 300)] },
    ] },
    { name: 'water', features: [{ type: 3, tags: { class: 'lake' }, geom: [rect(1800, 1800, 250, 220)] }] },
    { name: 'transportation', features: roads },
    { name: 'building', features: buildings },
    { name: 'poi', features: pois },
  ];
}

// Drive the REAL step generator, timing every step. Returns the worst block and
// where it ended — the same two numbers rasterizeTileSliced reports to the boot
// profile, measured the same way.
function worstBlock(layers, cpe, edgeM) {
  const it = WorldGen.rasterizeTileSteps(layers, cpe, 13699, 7523, edgeM);
  let prev = Date.now(), worst = 0, at = 'the whole build', steps = 0, r;
  for (;;) {
    r = it.next();
    const now = Date.now(), dt = now - prev; prev = now;
    if (dt > worst) { worst = dt; at = r.done ? 'the tail past the last yield' : (r.value || 'unlabelled'); }
    if (r.done) break;
    steps++;
  }
  return { worst, at, steps, result: r.value };
}

// The bound is deliberately loose — twenty times the budget the live slicer
// aims at (RASTER_SLICE_LIVE_MS), so a slow or loaded CI box has room — and
// still an order of magnitude under what the bug it was written for cost. It
// is not a benchmark: it fails when a pass stops yielding, not when a machine
// is slow.
const BLOCK_CAP_MS = 400;

test('tile build: no single pass holds the thread (3000 buildings)', () => {
  const { worst, at, steps } = worstBlock(townLayers(3000), CPE, TILE_EDGE_M);
  assert.gt(steps, 100, 'a build this size must slice into many steps, not a handful');
  assert.lt(worst, BLOCK_CAP_MS, `worst unbroken block ${worst}ms, ending at "${at}" — that pass needs a yield`);
});

test('tile build: the worst block does not blow up with the building count', () => {
  // The thinning that caused this was quadratic: doubling the buildings
  // quadrupled the block. Both sizes are held to the same cap, so a pass that
  // scales with H^2 fails at the larger one however fast the box is.
  const { worst, at } = worstBlock(townLayers(6000), CPE, TILE_EDGE_M);
  assert.lt(worst, BLOCK_CAP_MS, `worst unbroken block ${worst}ms, ending at "${at}" — that pass needs a yield`);
});

// ── The thinning rule itself, pinned apart from its cost ──────────────────
// The rule: roofs are considered largest-area first, and one is dropped when a
// roof already kept has its anchor cell within Chebyshev 1 — so what survives
// is a set of anchors no two of which are neighbours. That is the whole point
// of the pass (a block of tiny abutting buildings must not read as a pile of
// crammed-together roofs), and it is exactly what the Set-of-cells lookup
// replaced a scan of the kept list with. If the rewrite had loosened the test
// in any direction, this is where it shows.
test('merged-house thinning: no two surviving roofs sit within one cell', () => {
  const C = WorldGen.CELL_M;
  // A solid 18x18 block of one-cell buildings, packed at the cell pitch: every
  // roof has a neighbour on all four sides, so the pass has to drop most of
  // them. (Sizes vary slightly so the largest-first ordering is meaningful.)
  const rnd = rngOf(97531);
  const tiny = [];
  for (let gy = 0; gy < 18; gy++) {
    for (let gx = 0; gx < 18; gx++) {
      const s = C * (0.55 + rnd() * 0.3);
      tiny.push({ type: 3, tags: {}, geom: [rect(200 + gx * C, 200 + gy * C, s, s)] });
    }
  }
  const layers = [
    { name: 'landuse', features: [{ type: 3, tags: { class: 'commercial' },
      geom: [rect(0, 0, TILE_EDGE_M, TILE_EDGE_M)] }] },
    { name: 'building', features: tiny },
  ];
  const { objects } = WorldGen.rasterizeTile(layers, CPE, 13699, 7523, TILE_EDGE_M);
  const anchors = objects.filter((o) => o.kind === 'house')
    .map((o) => [Math.floor(o.x / C), Math.floor(o.y / C)]);
  assert.gt(anchors.length, 8, 'the block still grows roofs — the test would pass vacuously on none');
  assert.lt(anchors.length, tiny.length / 2, 'a packed block is thinned, not left one roof per polygon');
  for (let i = 0; i < anchors.length; i++) {
    for (let j = i + 1; j < anchors.length; j++) {
      const d = Math.max(Math.abs(anchors[i][0] - anchors[j][0]),
                         Math.abs(anchors[i][1] - anchors[j][1]));
      assert.gt(d, 1, `two roofs kept ${d} cell(s) apart at ${anchors[i]} / ${anchors[j]}`);
    }
  }
});

// Separated buildings must all keep their roof — the thinning may only remove
// roofs that crowd one another, never thin an ordinary street.
test('merged-house thinning: buildings with a gap between them all keep a roof', () => {
  const C = WorldGen.CELL_M;
  const spread = [];
  for (let i = 0; i < 24; i++) {
    spread.push({ type: 3, tags: {}, geom: [rect(200 + i * C * 4, 200, C * 2, C * 2)] });
  }
  const layers = [
    { name: 'landuse', features: [{ type: 3, tags: { class: 'commercial' },
      geom: [rect(0, 0, TILE_EDGE_M, TILE_EDGE_M)] }] },
    { name: 'building', features: spread },
  ];
  const { objects, buildingShapes } = WorldGen.rasterizeTile(layers, CPE, 13699, 7523, TILE_EDGE_M);
  const houses = objects.filter((o) => o.kind === 'house').length;
  // Every building that isn't re-tiered to a castle (which draws a pad, not a
  // roof) keeps its sprite — the thinning takes none of them.
  const castles = buildingShapes.filter((s) => s.tier === T.BUILDING_LARGE).length;
  assert.eq(houses, spread.length - castles, 'a spread-out street is not thinned');
});

})();
