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

test('path cobbles: the rasterizer publishes a pathCross mask', () => {
  const e = pcRasterize();
  assert.truthy(e.pathCross, 'entry carries the mask');
  assert.eq(e.pathCross.length, CPE * CPE, 'one entry per cell');
});

test('path cobbles: a path crossing the tile marks its cells', () => {
  const { grid, pathCross } = pcRasterize();
  let painted = 0, marked = 0;
  for (let cx = 12; cx <= 52; cx++) {
    if (grid[20 * CPE + cx] === T.PATH) {
      painted++;
      if (pathCross[20 * CPE + cx] === 1) marked++;
    }
  }
  assert.gt(painted, 20, 'the path really was painted across the tile');
  assert.eq(marked, painted, 'and every cell it runs through earns a cobble');
});

test('path cobbles: a stub that barely enters a cell earns nothing', () => {
  const { pathCross } = pcRasterize();
  assert.eq(pathCross[50 * CPE + 30], 0, 'a third of a cell is not a crossing');
});

test('path cobbles: cells with no path at all stay unmarked', () => {
  const { grid, pathCross } = pcRasterize();
  for (let i = 0; i < pathCross.length; i++) {
    if (pathCross[i] === 1) {
      assert.truthy(grid[i] === T.PATH || grid[i] === T.ROAD || grid[i] === T.ROAD_MD
        || grid[i] === T.ROAD_LG || grid[i] === T.PARK,
        `marked cell ${i} has terrain ${grid[i]}`);
    }
  }
  assert.eq(pathCross[2 * CPE + 2], 0, 'a far corner of the park is bare');
});
})();
