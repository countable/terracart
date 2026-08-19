// Headless tests for WorldGen.paintLine — the road/path/pier rasterizer.
//
// Regression guard for the half-cell bias: paintLine used Math.round() on the
// cell-space vertex coords, which selects the cell whose top-LEFT CORNER is
// nearest the point rather than the cell that CONTAINS it. Every road, path
// and pier came out half a cell south-east of its own OSM way — half a cell
// off the buildings/water around it (paintPolygon centre-samples, so those
// are right) and half a cell off the road-geometry overlay drawn from the
// same source linework.
//
// WorldGen is injected by run.js. Grids here are plain cell space: paintLine
// takes mvtToCell = 1 so the input coords ARE cell-space coords.

const T = WorldGen.T;

function makeGrid(w, h) { return { grid: new Uint8Array(w * h), w, h }; }
function painted(g) {
  const out = [];
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (g.grid[y * g.w + x]) out.push(`${x},${y}`);
  return out.sort();
}
// One 1-cell-wide way, coords already in cell space.
function paint(g, pts, type) {
  WorldGen.paintLine(g.grid, g.w, g.h, pts, type ?? T.ROAD, 1, 1);
  return g;
}

test('paintLine: a vertex paints the cell that CONTAINS it', () => {
  // (3.7, 2.7) is inside cell (3,2) — 70% of the way across it, not in (4,3).
  const g = makeGrid(8, 8);
  paint(g, [{ x: 3.7, y: 2.7 }, { x: 3.7, y: 2.7 }]);
  assert.eq(painted(g).join(' '), '3,2', 'no half-cell bias toward (4,3)');
});

test('paintLine: a cell-centre vertex paints its own cell', () => {
  const g = makeGrid(8, 8);
  paint(g, [{ x: 5.5, y: 1.5 }, { x: 5.5, y: 1.5 }]);
  assert.eq(painted(g).join(' '), '5,1', 'centre of cell (5,1) paints (5,1)');
});

test('paintLine: a north-south way stays in its own column', () => {
  // A way running down the right-hand side of column 2 (x = 2.9) must paint
  // column 2 for its whole length — never column 3.
  const g = makeGrid(8, 8);
  paint(g, [{ x: 2.9, y: 0.2 }, { x: 2.9, y: 5.8 }]);
  const cells = painted(g);
  assert.eq(cells.length, 6, 'six cells, rows 0..5');
  for (const c of cells) assert.eq(c.split(',')[0], '2', 'column 2 only: ' + c);
});

test('paintLine: an east-west way stays in its own row', () => {
  const g = makeGrid(8, 8);
  paint(g, [{ x: 0.2, y: 4.9 }, { x: 5.8, y: 4.9 }]);
  const cells = painted(g);
  assert.eq(cells.length, 6, 'six cells, columns 0..5');
  for (const c of cells) assert.eq(c.split(',')[1], '4', 'row 4 only: ' + c);
});

test('paintLine: agrees with the polygon rasterizer on a shared edge', () => {
  // paintPolygon decides membership by cell centre; paintLine must land in the
  // same cell for the same point. A way along x = 1.2 lives in column 1, which
  // is where a building whose footprint covers cell centre (1.5, y) also sits.
  const g = makeGrid(6, 6);
  paint(g, [{ x: 1.2, y: 0.5 }, { x: 1.2, y: 2.5 }]);
  for (const c of painted(g)) assert.eq(c.split(',')[0], '1', 'column 1: ' + c);
});

test('paintLine: a diagonal way is 4-connected (L-elbows, no corner gaps)', () => {
  const g = makeGrid(8, 8);
  paint(g, [{ x: 0.5, y: 0.5 }, { x: 4.5, y: 4.5 }]);
  const set = new Set(painted(g));
  // Every painted cell must have an orthogonal neighbour that's also painted
  // — otherwise the renderer draws disconnected squares.
  for (const k of set) {
    const [x, y] = k.split(',').map(Number);
    const ok = set.has(`${x+1},${y}`) || set.has(`${x-1},${y}`) ||
               set.has(`${x},${y+1}`) || set.has(`${x},${y-1}`);
    assert.truthy(ok, `cell ${k} is corner-connected only`);
  }
  assert.truthy(set.has('0,0') && set.has('4,4'), 'both endpoints painted');
});

test('paintLine: records the biome it covered in `under`', () => {
  const g = makeGrid(6, 6);
  g.grid.fill(T.PARK);
  const under = {};
  WorldGen.paintLine(g.grid, g.w, g.h, [{ x: 1.2, y: 1.2 }, { x: 3.2, y: 1.2 }], T.PATH, 1, 1, under);
  assert.eq(under['1_1'], T.PARK, 'park recorded under the path cell');
});

test('paintLine: stays inside the grid', () => {
  const g = makeGrid(4, 4);
  paint(g, [{ x: -6.5, y: 1.5 }, { x: 9.5, y: 1.5 }]);
  const cells = painted(g);
  assert.eq(cells.length, 4, 'only the four in-bounds cells of row 1');
  for (const c of cells) assert.eq(c.split(',')[1], '1', 'row 1: ' + c);
});
