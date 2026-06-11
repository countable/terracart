// Tests for WorldGen.erodePavementBlobs — the post-paint pass that dissolves
// the strict interior of merged road/path blobs (parking lots, plaza loops,
// sidewalk meshes) back to the under-biome, so pavement reads as lines and
// loops instead of flood-filled zones.
//
// Grids are built directly (no MVT round-trip): a small w×h Uint8Array plus
// pathUnder/roadUnder maps keyed "x_y", exactly what rasterizeTile hands the
// pass after painting.

const _T = WorldGen.T;

function _mkGrid(w, h, fill) {
  const g = new Uint8Array(w * h);
  if (fill) g.fill(fill);
  return g;
}
// Paint a cell and record its under-biome the way paintCell does.
function _stamp(grid, w, under, x, y, type, prev) {
  if (under && grid[y * w + x] !== type) under[`${x}_${y}`] = prev ?? grid[y * w + x];
  grid[y * w + x] = type;
}
function _count(grid, type) {
  let n = 0;
  for (const t of grid) if (t === type) n++;
  return n;
}

test('erode: 1-wide straight road is untouched', () => {
  const w = 9, h = 9;
  const grid = _mkGrid(w, h, _T.GRASS);
  const roadUnder = {};
  for (let x = 0; x < w; x++) _stamp(grid, w, roadUnder, x, 4, _T.ROAD);
  const n = WorldGen.erodePavementBlobs(grid, w, h, {}, roadUnder);
  assert.eq(n, 0, 'nothing eroded');
  assert.eq(_count(grid, _T.ROAD), 9, 'road line intact');
});

test('erode: 2-wide lane (dual carriageway) is untouched', () => {
  const w = 9, h = 9;
  const grid = _mkGrid(w, h, _T.GRASS);
  const roadUnder = {};
  for (let x = 0; x < w; x++) {
    _stamp(grid, w, roadUnder, x, 4, _T.ROAD);
    _stamp(grid, w, roadUnder, x, 5, _T.ROAD);
  }
  const n = WorldGen.erodePavementBlobs(grid, w, h, {}, roadUnder);
  assert.eq(n, 0, 'nothing eroded');
  assert.eq(_count(grid, _T.ROAD), 18, 'both lanes intact');
});

test('erode: 2-wide diagonal staircase is untouched', () => {
  // What paintLine's 4-connected diagonal stamping produces: at each step k,
  // cells (k, k) and (k+1, k).
  const w = 12, h = 12;
  const grid = _mkGrid(w, h, _T.GRASS);
  const pathUnder = {};
  for (let k = 0; k < 11; k++) {
    _stamp(grid, w, pathUnder, k, k, _T.PATH);
    _stamp(grid, w, pathUnder, k + 1, k, _T.PATH);
  }
  const n = WorldGen.erodePavementBlobs(grid, w, h, pathUnder, {});
  assert.eq(n, 0, 'staircase intact');
});

test('erode: solid path blob keeps its perimeter, interior restores under-biome', () => {
  const w = 13, h = 13;
  const grid = _mkGrid(w, h, _T.RESIDENTIAL);
  const pathUnder = {};
  // 7×7 solid PATH blob at (3..9, 3..9), painted over residential.
  for (let y = 3; y <= 9; y++) for (let x = 3; x <= 9; x++)
    _stamp(grid, w, pathUnder, x, y, _T.PATH);
  const n = WorldGen.erodePavementBlobs(grid, w, h, pathUnder, {});
  assert.eq(n, 25, '5×5 interior eroded');
  // Interior is residential again, with its pathUnder records dropped.
  for (let y = 4; y <= 8; y++) for (let x = 4; x <= 8; x++) {
    assert.eq(grid[y * w + x], _T.RESIDENTIAL, `interior (${x},${y}) restored`);
    assert.falsy(pathUnder[`${x}_${y}`] != null, `stale pathUnder dropped at (${x},${y})`);
  }
  // Perimeter ring survives.
  for (let x = 3; x <= 9; x++) {
    assert.eq(grid[3 * w + x], _T.PATH, 'top edge kept');
    assert.eq(grid[9 * w + x], _T.PATH, 'bottom edge kept');
  }
  for (let y = 3; y <= 9; y++) {
    assert.eq(grid[y * w + 3], _T.PATH, 'left edge kept');
    assert.eq(grid[y * w + 9], _T.PATH, 'right edge kept');
  }
});

test('erode: road line crossing a path blob is protected', () => {
  const w = 13, h = 13;
  const grid = _mkGrid(w, h, _T.GRASS);
  const pathUnder = {}, roadUnder = {};
  for (let y = 3; y <= 9; y++) for (let x = 3; x <= 9; x++)
    _stamp(grid, w, pathUnder, x, y, _T.PATH);
  // Horizontal road straight through the blob's middle row.
  for (let x = 0; x < w; x++) _stamp(grid, w, roadUnder, x, 6, _T.ROAD);
  WorldGen.erodePavementBlobs(grid, w, h, pathUnder, roadUnder);
  for (let x = 0; x < w; x++)
    assert.eq(grid[6 * w + x], _T.ROAD, `road cell (${x},6) survives`);
  // Path cells orthogonally adjacent to the road have a wrong-kind neighbour
  // → also protected (the road keeps a path verge).
  for (let x = 4; x <= 8; x++) {
    assert.eq(grid[5 * w + x], _T.PATH, `path verge above road at (${x},5)`);
    assert.eq(grid[7 * w + x], _T.PATH, `path verge below road at (${x},7)`);
  }
  // Cells two rows off the road and inside the perimeter DO erode.
  assert.eq(grid[4 * w + 5], _T.GRASS, 'deep interior above the verge eroded');
  assert.eq(grid[8 * w + 5], _T.GRASS, 'deep interior below the verge eroded');
});

test('erode: road flanked by sidewalk paths (3-wide band) is untouched', () => {
  const w = 11, h = 9;
  const grid = _mkGrid(w, h, _T.RESIDENTIAL);
  const pathUnder = {}, roadUnder = {};
  for (let x = 0; x < w; x++) {
    _stamp(grid, w, pathUnder, x, 3, _T.PATH);
    _stamp(grid, w, roadUnder, x, 4, _T.ROAD);
    _stamp(grid, w, pathUnder, x, 5, _T.PATH);
  }
  const n = WorldGen.erodePavementBlobs(grid, w, h, pathUnder, roadUnder);
  assert.eq(n, 0, 'road-with-sidewalks band intact');
});

test('erode: mixed vehicle tiers count as one kind', () => {
  // Solid blob of alternating ROAD / ROAD_MD — still erodes as one blob.
  const w = 11, h = 11;
  const grid = _mkGrid(w, h, _T.COMMERCIAL);
  const roadUnder = {};
  for (let y = 3; y <= 7; y++) for (let x = 3; x <= 7; x++)
    _stamp(grid, w, roadUnder, x, y, (x + y) % 2 ? _T.ROAD : _T.ROAD_MD);
  const n = WorldGen.erodePavementBlobs(grid, w, h, {}, roadUnder);
  assert.eq(n, 9, '3×3 interior eroded across tier mix');
  for (let y = 4; y <= 6; y++) for (let x = 4; x <= 6; x++)
    assert.eq(grid[y * w + x], _T.COMMERCIAL, `interior (${x},${y}) restored`);
});

test('erode: blob touching the tile edge erodes its seam-side cells too', () => {
  // Out-of-tile neighbours count as same-kind pavement — the adjacent tile
  // rasterizes the same geometry from its buffer, so both sides must agree.
  const w = 10, h = 10;
  const grid = _mkGrid(w, h, _T.GRASS);
  const pathUnder = {};
  // Blob occupying the top-left corner: (0..4, 0..4).
  for (let y = 0; y <= 4; y++) for (let x = 0; x <= 4; x++)
    _stamp(grid, w, pathUnder, x, y, _T.PATH);
  WorldGen.erodePavementBlobs(grid, w, h, pathUnder, {});
  assert.eq(grid[0], _T.GRASS, 'corner cell (0,0) eroded — blob continues off-tile');
  assert.eq(grid[3 * w + 3], _T.GRASS, 'inner cell eroded');
  // The sides facing real unpaved ground keep their perimeter.
  for (let k = 0; k <= 4; k++) {
    assert.eq(grid[4 * w + k], _T.PATH, `bottom perimeter (${k},4) kept`);
    assert.eq(grid[k * w + 4], _T.PATH, `right perimeter (4,${k}) kept`);
  }
});

test('erode: missing under record falls back to neighbour mode, then grass', () => {
  const w = 9, h = 9;
  const grid = _mkGrid(w, h, _T.GRASS);
  const pathUnder = {};
  for (let y = 2; y <= 6; y++) for (let x = 2; x <= 6; x++)
    _stamp(grid, w, pathUnder, x, y, _T.PATH, _T.PARK);
  // Knock out the centre cell's record — it should borrow PARK from its ring.
  delete pathUnder['4_4'];
  WorldGen.erodePavementBlobs(grid, w, h, pathUnder, {});
  assert.eq(grid[4 * w + 4], _T.PARK, 'centre borrowed neighbour under-biome');
  assert.eq(grid[3 * w + 3], _T.PARK, 'recorded cells restore their own');
});
