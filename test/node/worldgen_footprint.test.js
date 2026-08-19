// Tests for WorldGen.assignBuildingFootprints — the building-footprint
// assignment that replaced centre-sampling + last-writer-wins ownership.
//
// The contract it has to keep (all four are load-bearing, see the comment
// block above assignBuildingFootprints in worldgen.js):
//   1. footprints NEVER overlap — a cell belongs to at most one building;
//   2. a cell more than FOOT_COVER_MIN covered by a polygon belongs to it
//      (when no other polygon covers that cell more);
//   3. every building that covers any real fraction of a cell gets at least
//      one cell — nothing silently vanishes from the map;
//   4. the result is a pure function of the polygons — reordering the input
//      changes nothing, so two tiles agree on a building clipped by the seam.

const FP = {
  min: WorldGen.FOOT_COVER_MIN,
  bonus: WorldGen.FOOT_RECT_BONUS,
  rescue: WorldGen.FOOT_RESCUE_MIN,
};

// Polygons are handed to the assigner in MVT units; pass mvtToCell = 1 so the
// test coordinates ARE cell coordinates.
const poly = (pts, areaM2 = 100, tier = 30) => ({ ring: pts.map(([x, y]) => ({ x, y })), areaM2, tier });
const rect = (x0, y0, x1, y1, areaM2) => poly([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], areaM2);
const rotRect = (cx, cy, w, h, rot, areaM2) => {
  const c = Math.cos(rot), s = Math.sin(rot);
  return poly([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]]
    .map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]), areaM2);
};
const assign = (polys, w = 16, h = 16, pad = 0) =>
  WorldGen.assignBuildingFootprints(polys, 1, w, h, pad);
const norm = (cells) => cells.map(([x, y]) => `${x},${y}`).sort().join(' ');

// ─── cellCoverFraction ──────────────────────────────────────────────────────

test('cellCoverFraction: a cell fully inside the polygon reads 1', () => {
  const r = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }];
  assert.eq(WorldGen.cellCoverFraction(r, 1, 1), 1, 'interior cell fully covered');
});

test('cellCoverFraction: a half-covered cell reads 0.5', () => {
  const r = [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 0.5, y: 1 }, { x: 0, y: 1 }];
  assert.eq(WorldGen.cellCoverFraction(r, 0, 0), 0.5, 'exactly half');
});

test('cellCoverFraction: an untouched cell reads 0', () => {
  const r = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  assert.eq(WorldGen.cellCoverFraction(r, 5, 5), 0, 'far cell not covered');
});

test('cellCoverFraction: a triangle clipped by the cell reads its true area', () => {
  // Right triangle covering the lower-left half of cell (0,0).
  const r = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }];
  assert.eq(Math.abs(WorldGen.cellCoverFraction(r, 0, 0) - 0.5) < 1e-12, true, 'half a cell');
});

// ─── 1. no overlaps ─────────────────────────────────────────────────────────

test('footprints: an axis-aligned building rasterizes to exactly its cells', () => {
  const out = assign([rect(2, 2, 5, 4)]);
  const want = [];
  for (let y = 2; y < 4; y++) for (let x = 2; x < 5; x++) want.push([x, y]);
  assert.eq(norm(out[0]), norm(want), 'exactly the covered 3x2 block');
});

test('footprints: abutting row houses never share a cell', () => {
  // Six 1.5-cell-wide units in a terrace, sharing walls, no overlap in space.
  const polys = [];
  for (let i = 0; i < 6; i++) polys.push(rect(1 + i * 1.5, 3, 2.5 + i * 1.5, 5.2, 110));
  const out = assign(polys);
  const seen = new Map();
  for (let i = 0; i < out.length; i++) for (const [x, y] of out[i]) {
    const k = `${x},${y}`;
    assert.falsy(seen.has(k), `cell ${k} claimed by both building ${seen.get(k)} and ${i}`);
    seen.set(k, i);
  }
});

test('footprints: partly overlapping polygons split the contested cells', () => {
  // OSM does ship overlapping / multipart buildings. Neither may be swallowed
  // and neither may share a cell: the more-covering polygon takes each
  // contested cell, the other keeps the rest.
  const out = assign([rect(1, 1, 5, 5, 800), rect(4, 1, 8, 5, 800)]);
  assert.gt(out[0].length, 0, 'first building keeps cells');
  assert.gt(out[1].length, 0, 'second building keeps cells');
  const a = new Set(out[0].map(([x, y]) => `${x},${y}`));
  for (const [x, y] of out[1]) assert.falsy(a.has(`${x},${y}`), 'no shared cell');
});

test('footprints: a polygon fully inside another does not punch a hole in it', () => {
  // A duplicate / multipart ring sitting entirely within a bigger building
  // covers no cell more than its host does, and the rescue pass only takes
  // FREE cells — so it drops out rather than carving a gap out of the host.
  const out = assign([rect(1, 1, 9, 9, 3000), rect(3, 3, 4.6, 4.6, 120)]);
  assert.eq(out[1].length, 0, 'the enclosed ring claims nothing');
  const host = new Set(out[0].map(([x, y]) => `${x},${y}`));
  for (let y = 3; y < 4; y++) for (let x = 3; x < 4; x++) {
    assert.truthy(host.has(`${x},${y}`), `host keeps cell ${x},${y}`);
  }
});

// ─── 2. the coverage rule ───────────────────────────────────────────────────

test('footprints: every cell over the cover threshold is claimed by its building', () => {
  const b = rotRect(6, 6, 3.4, 2.6, 0.4);
  const out = assign([b]);
  const got = new Set(out[0].map(([x, y]) => `${x},${y}`));
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    if (WorldGen.cellCoverFraction(b.ring, x, y) > FP.min) {
      assert.truthy(got.has(`${x},${y}`), `cell ${x},${y} is over ${FP.min} covered but unclaimed`);
    }
  }
});

test('footprints: a barely-touched cell is NOT claimed', () => {
  // A cell the polygon only grazes (well under the rescue floor) stays free —
  // the building has plenty of other cells, so no rescue applies.
  const b = rect(2, 2, 5.05, 4);
  const out = assign([b]);
  const got = new Set(out[0].map(([x, y]) => `${x},${y}`));
  assert.falsy(got.has('5,2'), 'the 5% sliver column is not part of the building');
});

// ─── 3. at least one cell each ──────────────────────────────────────────────

test('footprints: a building smaller than the threshold still gets one cell', () => {
  // 0.6 x 0.6 of a cell = 36% cover: under the 45% bar, over the rescue floor.
  const out = assign([poly([[3.2, 3.2], [3.8, 3.2], [3.8, 3.8], [3.2, 3.8]], 18)]);
  assert.eq(out[0].length, 1, 'exactly one cell — no more, no less');
  assert.eq(norm(out[0]), '3,3', 'the cell it sits in');
});

test('footprints: crowded sub-threshold buildings each get their own cell', () => {
  const polys = [];
  for (let i = 0; i < 4; i++) polys.push(poly([[1 + i, 1], [1.7 + i, 1], [1.7 + i, 1.7], [1 + i, 1.7]], 24));
  const out = assign(polys);
  const seen = new Set();
  for (let i = 0; i < out.length; i++) {
    assert.eq(out[i].length, 1, `building ${i} got one cell`);
    const k = norm(out[i]);
    assert.falsy(seen.has(k), 'each took a different cell');
    seen.add(k);
  }
});

test('footprints: a shed straddling a cell corner still gets a cell', () => {
  // 0.8 x 0.8 of a cell centred on a corner: only ~16% of each of four cells,
  // under the per-cell bar everywhere, but 64% of a cell in total — plainly a
  // building, so the rescue (which floors on TOTAL area) keeps it.
  const out = assign([poly([[3.6, 3.6], [4.4, 3.6], [4.4, 4.4], [3.6, 4.4]], 31)]);
  assert.eq(out[0].length, 1, 'one cell for the straddling shed');
});

test('footprints: a mere sliver of a building claims nothing', () => {
  // 2% of a cell — below FOOT_RESCUE_MIN, so it drops out rather than
  // occupying a whole cell it barely touches.
  const out = assign([poly([[4.0, 4.0], [4.15, 4.0], [4.15, 4.15], [4.0, 4.15]], 1)]);
  assert.eq(out[0].length, 0, 'sub-rescue-floor building claims no cell');
});

// ─── 4. rectangle bias ──────────────────────────────────────────────────────

test('footprints: the rect bonus fills a cell the bare threshold would drop', () => {
  // A rotated building: some fringe cells inside its bounding box land between
  // FOOT_COVER_MIN/FOOT_RECT_BONUS and FOOT_COVER_MIN, and the bonus takes them.
  const b = rotRect(8, 8, 3.6, 2.8, 0.35);
  const cells = assign([b])[0];
  let bonusCells = 0;
  for (const [x, y] of cells) {
    const c = WorldGen.cellCoverFraction(b.ring, x, y);
    if (c <= FP.min && c * FP.bonus > FP.min) bonusCells++;
  }
  assert.gt(bonusCells, 0, 'at least one cell joined on the rectangle bonus');
});

test('footprints: the bonus only reaches inside the footprint bounding box', () => {
  const b = rotRect(8, 8, 3.6, 2.8, 0.35);
  const cells = assign([b])[0];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of cells) {
    const c = WorldGen.cellCoverFraction(b.ring, x, y);
    if (c > FP.min) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }
  for (const [x, y] of cells) {
    assert.truthy(x >= minX && x <= maxX && y >= minY && y <= maxY,
      `cell ${x},${y} lies outside the body's bounding box`);
  }
});

// ─── 5. order independence (tile-seam stability) ────────────────────────────

test('footprints: reordering the input changes nothing', () => {
  const polys = [
    rect(1, 1, 3.4, 3.4, 280), rotRect(7, 3, 3.2, 2.4, 0.3, 190),
    rect(3.2, 6, 6.6, 8.8, 400), rotRect(10, 9, 4.4, 3.1, -0.5, 320),
    poly([[12.2, 2.2], [12.9, 2.2], [12.9, 2.9], [12.2, 2.9]], 24),
    rect(9.5, 2.6, 11.2, 4.4, 150),
  ];
  const straight = assign(polys);
  const order = [4, 0, 5, 3, 1, 2];
  const shuffledOut = assign(order.map(i => polys[i]));
  for (let k = 0; k < order.length; k++) {
    assert.eq(norm(shuffledOut[k]), norm(straight[order[k]]),
      `building ${order[k]} got a different footprint when the input was reordered`);
  }
});

test('footprints: a building clipped by the tile edge is padded, not truncated', () => {
  // pad = 3 lets the assigner see the out-of-tile half so both tiles that draw
  // this building shape it the same way; the caller paints only in-bounds.
  const out = assign([rect(-2, 4, 2.4, 6.4, 300)], 16, 16, 3);
  assert.truthy(out[0].some(([x]) => x < 0), 'cells past the tile edge are assigned');
  assert.truthy(out[0].some(([x]) => x >= 0), 'in-bounds cells too');
});

// ─── 6. shape cleanup stays claim-aware ─────────────────────────────────────

test('tidyFootprintCells: the isFree veto blocks a notch fill', () => {
  // A U shape whose notch would normally be filled…
  const u = [[0, 0], [1, 0], [2, 0], [0, 1], [2, 1], [0, 2], [1, 2], [2, 2]];
  const filled = WorldGen.tidyFootprintCells(u, false);
  assert.truthy(filled.some(([x, y]) => x === 1 && y === 1), 'notch filled when the cell is free');
  const blocked = WorldGen.tidyFootprintCells(u, false, (x, y) => !(x === 1 && y === 1));
  assert.falsy(blocked.some(([x, y]) => x === 1 && y === 1), 'notch left alone when the cell is taken');
});

test('footprints: tidy never takes a cell from a neighbouring building', () => {
  // A C-shaped building wrapped around a small one sitting in its mouth: the
  // tidy pass would love to fill that cell, and must not.
  const c = poly([[1, 1], [4, 1], [4, 2], [2, 2], [2, 3], [4, 3], [4, 4], [1, 4]], 600);
  const plug = rect(2.05, 2.05, 2.95, 2.95, 45);
  const out = assign([c, plug]);
  const cSet = new Set(out[0].map(([x, y]) => `${x},${y}`));
  assert.eq(norm(out[1]), '2,2', 'the plug keeps its cell');
  assert.falsy(cSet.has('2,2'), 'the C-shape did not tidy its way onto the plug');
});
