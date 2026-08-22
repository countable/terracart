// Path cobbles are placed by GEOMETRY, not by a density roll: a cell earns a
// stone only where the footpath actually runs through it — at least one full
// cell width of way inside the cell (worldgen accumulateLineSpan → pathCross).
//
// The old rule hashed the cell coords to a fixed density, which had no idea
// where the path was: it dropped stones on cells the path merely clipped the
// corner of, and left gaps in the middle of a straight run.
(() => {
  const W = 8, H = 8;
  // accumulateLineSpan takes MVT coords and a scale; feeding it cell-unit
  // points with mvtToCell = 1 lets these tests talk in plain cells.
  const span = (pts) => {
    const a = new Float32Array(W * H);
    WorldGen.accumulateLineSpan(a, W, H, pts.map(([x, y]) => ({ x, y })), 1);
    return a;
  };
  const at = (a, cx, cy) => a[cy * W + cx];
  const crosses = (v) => v >= WorldGen.PATH_CROSS_MIN_CELLS - 1e-3;
  const near = (a, b, eps, m) => assert.inRange(a, b - eps, b + eps, m);

  test('path cobbles: a straight run measures exactly one cell width per cell', () => {
    // Horizontal line along the middle of row 3, from x=1 to x=6.
    const a = span([[1, 3.5], [6, 3.5]]);
    for (let cx = 1; cx <= 5; cx++) {
      near(at(a, cx, 3), 1, 1e-3, `cell ${cx} spans one full width`);
      assert.truthy(crosses(at(a, cx, 3)), `cell ${cx} earns a cobble`);
    }
    assert.eq(at(a, 3, 2), 0, 'nothing bleeds into the row above');
    assert.eq(at(a, 3, 4), 0, 'nor below');
  });

  test('path cobbles: a corner clip falls short and stays bare', () => {
    // Barely nicks the corner of cell (4,4): a short diagonal near its edge.
    const a = span([[4.95, 3.95], [5.05, 4.05]]);
    assert.lt(at(a, 4, 3), 1, 'the clipped cell is under a full width');
    assert.falsy(crosses(at(a, 4, 3)), 'so it earns no cobble');
  });

  test('path cobbles: a way that stops inside a cell does not earn one', () => {
    // Enters cell (2,2) and ends halfway across it.
    const a = span([[1.0, 2.5], [2.5, 2.5]]);
    assert.truthy(crosses(at(a, 1, 2)), 'the cell it crosses fully qualifies');
    near(at(a, 2, 2), 0.5, 1e-3, 'the end cell holds only half a width');
    assert.falsy(crosses(at(a, 2, 2)), 'and so stays bare');
  });

  test('path cobbles: a diagonal crossing counts more than a straight one', () => {
    // Corner to corner through cell (2,2) is sqrt(2) cell widths.
    const a = span([[2, 2], [3, 3]]);
    near(at(a, 2, 2), Math.SQRT2, 1e-2, 'diagonal spans sqrt(2)');
    assert.truthy(crosses(at(a, 2, 2)), 'comfortably earns a cobble');
  });

  test('path cobbles: total measured length matches the real line length', () => {
    // Whatever the cell split, the pieces must add back up to the line.
    const pts = [[0.3, 0.7], [6.4, 4.2]];
    const a = span(pts);
    let total = 0;
    for (let i = 0; i < a.length; i++) total += a[i];
    const want = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]);
    near(total, want, 1e-2, 'no length is lost or double-counted');
  });

  test('path cobbles: two paths clipping the same cell can add up to a crossing', () => {
    // A junction: neither way crosses alone, but together the cell is well
    // covered — which is exactly where a stone belongs.
    const a = new Float32Array(W * H);
    const add = (pts) => WorldGen.accumulateLineSpan(
      a, W, H, pts.map(([x, y]) => ({ x, y })), 1);
    add([[3.5, 3.5], [4.5, 3.5]]);   // ends mid-cell (3,3), half a width
    add([[3.5, 3.5], [3.5, 4.5]]);   // and again downward
    assert.truthy(crosses(at(a, 3, 3)), 'the junction cell qualifies on the sum');
  });

  test('path cobbles: geometry outside the tile is dropped, not wrapped', () => {
    const a = span([[-4, 2.5], [-1, 2.5]]);
    let total = 0;
    for (let i = 0; i < a.length; i++) total += a[i];
    assert.eq(total, 0, 'nothing recorded for an off-tile way');
  });
})();

// ── End to end, through the real rasterizer ───────────────────────────────
// The unit tests above pin the measurement; these pin that rasterizeTile
// actually wires it into the `pathCross` mask the renderer reads.
(function () {
const T = WorldGen.T;
const CPE = 64;
const TILE_EDGE_M = CPE * 7;
const EXTENT = 4096;
const CELL_MVT = EXTENT / CPE;
const cellToMvt = (c) => c * CELL_MVT + CELL_MVT / 2;
const pcLine = (cells) => cells.map(([cx, cy]) => ({ x: cellToMvt(cx), y: cellToMvt(cy) }));
const pcRing = pcLine;
const whole = () => pcRing([[0, 0], [CPE - 1, 0], [CPE - 1, CPE - 1], [0, CPE - 1]]);

// A park with one footpath running straight across the middle, and a second
// stub that pokes only a little way in from the edge.
function pcRasterize() {
  return WorldGen.rasterizeTile([
    { name: 'landuse', features: [
      { type: 3, tags: { class: 'park' }, geom: [whole()] },
    ] },
    { name: 'transportation', features: [
      { type: 2, tags: { class: 'path' }, geom: [pcLine([[8, 20], [56, 20]])] },
      // A stub only ~a third of a cell long, hanging off nothing.
      { type: 2, tags: { class: 'footway' },
        geom: [[{ x: cellToMvt(30), y: cellToMvt(50) },
                { x: cellToMvt(30) + CELL_MVT / 3, y: cellToMvt(50) }]] },
    ] },
  ], CPE, 0, 0, TILE_EDGE_M);
}

test('path cells: a path crossing the tile paints its cells', () => {
  const { grid } = pcRasterize();
  let painted = 0;
  for (let cx = 12; cx <= 52; cx++) if (grid[20 * CPE + cx] === T.PATH) painted++;
  assert.gt(painted, 20, 'the way that crosses the tile really is painted');
});

test('path cells: a stub that barely enters a cell paints nothing', () => {
  // A third of a cell of footway is not a crossing, so the cell keeps the park
  // it was drawn over — it stays tillable and spawnable, because no path runs
  // through it. This is the whole point: those cells used to become PATH.
  const { grid } = pcRasterize();
  assert.eq(grid[50 * CPE + 30], T.PARK, 'the clipped cell is still parkland');
});

test('path cells: a diagonal path stays 4-connected', () => {
  // The gate very nearly broke this. forEachLineCell stamps an extra elbow
  // cell on each diagonal step because the renderer draws orthogonal arms
  // only — without it consecutive cells touch at a corner and the path reads
  // as disconnected squares. That elbow is a connectivity device, not ground
  // the way crosses, so its measured span is ~0 and the gate deleted it:
  // a 45-degree footpath came out as 31 orphaned cells of 65.
  const e = WorldGen.rasterizeTile([
    { name: 'landuse', features: [{ type: 3, tags: { class: 'park' },
      geom: [whole()] }] },
    { name: 'transportation', features: [
      { type: 2, tags: { class: 'path' }, geom: [pcLine([[8, 8], [40, 40]])] },
      { type: 2, tags: { class: 'path' }, geom: [pcLine([[8, 55], [50, 48]])] },
    ] },
  ], CPE, 0, 0, TILE_EDGE_M);
  const g = e.grid;
  const isP = (x, y) => x >= 0 && y >= 0 && x < CPE && y < CPE && g[y * CPE + x] === T.PATH;
  let n = 0, orphan = 0;
  for (let y = 0; y < CPE; y++) {
    for (let x = 0; x < CPE; x++) {
      if (!isP(x, y)) continue;
      n++;
      if (!isP(x - 1, y) && !isP(x + 1, y) && !isP(x, y - 1) && !isP(x, y + 1)) orphan++;
    }
  }
  assert.gt(n, 40, 'the diagonal paths were painted');
  assert.eq(orphan, 0, 'and every path cell has a 4-connected neighbour');
});

test('path cells: nothing off the line becomes path', () => {
  const { grid } = pcRasterize();
  assert.eq(grid[2 * CPE + 2], T.PARK, 'a far corner of the park is untouched');
  // Neither row either side of the crossing path picks up stray cells.
  for (let cx = 12; cx <= 52; cx++) {
    assert.truthy(grid[18 * CPE + cx] !== T.PATH, `row 18 col ${cx} is not path`);
    assert.truthy(grid[22 * CPE + cx] !== T.PATH, `row 22 col ${cx} is not path`);
  }
});
})();
