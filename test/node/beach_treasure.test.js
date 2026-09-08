// Buried X marks on SAND — and the cell packing that decides where any bonus
// mark lands.
//
// A tile's X marks are a flat scatter of 4-10 over every walkable cell, plus a
// bonus stream beside footpaths. Over a 2.4 km tile the flat scatter is
// nothing at all along a strip of shoreline, and a beach is the one ground
// people actually dig — so sand gets its own stream, capped by the beach's own
// size (BEACH_X_PER_CELLS) so a golf bunker can't draw the whole roll.
//
// These drive the SHIPPING block (run.js lifts it out of spawnInTile as
// __bonusXMarks), because the thing that broke here is exactly the kind of
// thing a transcription reproduces: the path stream packed its cells as
// `cx * 256 + cy` while cellsPerEdge is tileEdgeM / 7 — over 256 anywhere
// below ~43° latitude — so every path cell in the bottom of the tile decoded
// to a different cell and its "roadside" X was dropped somewhere else.

(function () {
const T = WorldGen.T;
const PATH = 8;
const CELL_M = 7;

// A tile bigger than 256 cells per edge: what the equator actually builds
// (2446 m / 7 m ≈ 349), and what the old packing could not survive.
const N = 300;

function makeEntry(paint) {
  const grid = new Uint8Array(N * N).fill(T.GRASS);
  const entry = { grid, cellsPerEdge: N, extraTreasures: [], objects: [], roadMask: null };
  if (paint) paint(grid);
  return entry;
}
// The scene bits the lifted block reads.
const scene = { tileEdgeM: N * CELL_M, cellM: CELL_M };
// A deterministic stream, so a failure is reproducible.
function rngFrom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const run = (entry, seed) => {
  __bonusXMarks.call(scene, entry, 3, 4, N, rngFrom(seed), {});
  return entry.extraTreasures;
};
const cellOf = (t) => ({
  ix: Math.round((t.x - 3 * scene.tileEdgeM) / CELL_M - 0.5),
  iy: Math.round((t.y - 4 * scene.tileEdgeM) / CELL_M - 0.5),
});
// A beach strip: `w` cells wide down the left edge, which is the shape a real
// shoreline rasterizes to.
const beach = (w) => (grid) => {
  for (let cy = 0; cy < N; cy++) for (let cx = 0; cx < w; cx++) grid[cy * N + cx] = T.SAND;
};

// --- The beach stream -------------------------------------------------------

test('beach X: a shoreline carries marks, and they are ON the sand', () => {
  const entry = makeEntry(beach(6));
  const marks = run(entry, 1);
  const sandMarks = marks.filter((t) => /^treasure_sand_/.test(t.id));
  assert.gt(sandMarks.length, 0, 'the beach got marks');
  for (const t of sandMarks) {
    const { ix, iy } = cellOf(t);
    assert.eq(entry.grid[iy * N + ix], T.SAND, `mark ${t.id} is on sand`);
    // A beach is DUG: the mark sits on the sand itself, not beside it the way
    // the path stream seats one off the trail.
    assert.eq(t.id, `treasure_sand_3_4_${ix}_${iy}`, 'and its id names that cell');
  }
});

test('beach X: no sand, no beach marks', () => {
  const marks = run(makeEntry(), 2);
  assert.eq(marks.filter((t) => /^treasure_sand_/.test(t.id)).length, 0,
    'an inland tile gets none of this stream');
});

test('beach X: the roll is capped by the beach\'s own size', () => {
  // One mark per BEACH_X_PER_CELLS cells of sand, so a sandpit gets a mark and
  // a shoreline gets the roll — a small patch can never draw the whole 4-8.
  for (const [w, seedCount] of [[1, 8], [2, 8], [6, 8]]) {
    const cells = w * N;
    const cap = Math.max(1, Math.floor(cells / BEACH_X_PER_CELLS));
    for (let seed = 1; seed <= seedCount; seed++) {
      const n = run(makeEntry(beach(w)), seed).filter((t) => /^treasure_sand_/.test(t.id)).length;
      assert.lte(n, Math.min(8, cap), `a ${cells}-cell beach, seed ${seed}`);
    }
  }
  // A four-cell sandpit: one mark at most, however the roll falls.
  const pit = (grid) => { for (let i = 0; i < 4; i++) grid[(10 + i) * N + 10] = T.SAND; };
  for (let seed = 1; seed <= 20; seed++) {
    assert.lte(run(makeEntry(pit), seed).filter((t) => /^treasure_sand_/.test(t.id)).length, 1,
      'a sandpit is not a beach');
  }
});

test('beach X: sand is dug more than the ground around it', () => {
  // The point of the stream. Measured as marks per cell: the beach's own rate
  // against the tile-wide scatter's share of the same cells (4-10 marks over
  // every walkable cell of a 300×300 tile).
  const w = 6, sand = w * N;
  let marks = 0;
  const RUNS = 40;
  for (let seed = 1; seed <= RUNS; seed++) {
    marks += run(makeEntry(beach(w)), seed).filter((t) => /^treasure_sand_/.test(t.id)).length;
  }
  const beachRate = marks / RUNS / sand;
  const flatRate = 7 / (N * N);            // the flat scatter's midpoint, per cell
  assert.gt(beachRate, flatRate * 10, 'a beach cell is far likelier to hide one');
});

test('beach X: two builds of the same tile bury the same marks', () => {
  // A tile can be rebuilt under the player; the ids are cell-derived so
  // save.foundTreasures keeps a dug X dug.
  const a = run(makeEntry(beach(6)), 7).map((t) => t.id).sort();
  const b = run(makeEntry(beach(6)), 7).map((t) => t.id).sort();
  assert.eq(a.join('|'), b.join('|'), 'same tile, same seed, same marks');
  assert.eq(new Set(a).size, a.length, 'and no mark is buried twice');
});

// --- The packing, which the path stream depends on --------------------------

test('bonus X: a path mark lands beside THAT path, past 256 cells down', () => {
  // The regression: cells were packed `cx * 256 + cy`, so a path cell at
  // cy ≥ 256 decoded to (cx + 1, cy - 256) — a legal cell (isSpawnCell still
  // vetted it) in a different part of the tile, which is why nothing ever
  // looked broken except that the marks were not beside the paths.
  const deep = (grid) => {
    for (let cx = 4; cx < 40; cx++) grid[280 * N + cx] = PATH;
  };
  let placed = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const entry = makeEntry(deep);
    for (const t of run(entry, seed)) {
      if (!/^treasure_path_/.test(t.id)) continue;
      placed++;
      const { ix, iy } = cellOf(t);
      assert.eq(t.id, `treasure_path_3_4_${ix}_${iy}`, 'the id names the cell it sits on');
      const beside = [[1, 0], [-1, 0], [0, 1], [0, -1]]
        .some(([dx, dy]) => entry.grid[(iy + dy) * N + (ix + dx)] === PATH);
      assert.truthy(beside, `mark at ${ix},${iy} is 4-connected to the path at row 280`);
      assert.truthy(entry.grid[iy * N + ix] !== PATH, 'and off the trail itself');
    }
  }
  assert.gt(placed, 0, 'the path stream actually placed something');
});

test('bonus X: one grid pass feeds both streams', () => {
  // spawnInTile runs post-rasterize, where nothing slices — a second scan of
  // every cell would be a second unbroken 100k-cell block charged to no span
  // the boot profile can name.
  const src = SPAWN_IN_TILE_SRC;
  const scans = src.match(/for \(let cy = 0; cy < N; cy\+\+\)/g) || [];
  assert.eq(scans.length, 1, 'one walk of the grid, not one per stream');
  assert.truthy(/sandCells\.push\(cy \* N \+ cx\)/.test(src), 'sand collected in it');
  assert.truthy(/pathCells\.push\(cy \* N \+ cx\)/.test(src), 'paths collected in it');
  // (the comment above the pass still NAMES the old packing — what must not
  // come back is the expression itself, in a push or a decode)
  assert.falsy(/push\(cx \* 256 \+ cy\)/.test(src), 'nothing packs cells at 256 any more');
  assert.falsy(/Math\.floor\(cell \/ 256\)/.test(src), 'and nothing decodes them at 256 either');
});
})();
