// Tests for WorldGen.tidyFootprintCells — the building-footprint tidy pass
// that coerces janky rasterized footprints (diagonal-only contacts, 1-wide
// notches, stray crumbs) into nicer tilings before painting.
//
// Helper: normalize a cell list for comparison.
const _norm = (cells) => cells.map(([x, y]) => `${x},${y}`).sort().join(' ');
const _hasCell = (cells, x, y) => cells.some(([cx, cy]) => cx === x && cy === y);

// Invariant checkers used across tests.
function _assertNoDiagonalOnly(cells, m) {
  const s = new Set(cells.map(([x, y]) => `${x},${y}`));
  const has = (x, y) => s.has(`${x},${y}`);
  for (const [x, y] of cells) {
    for (const dy of [-1, 1]) {
      if (has(x + 1, y + dy) && !has(x + 1, y) && !has(x, y + dy)) {
        throw new Error((m || 'no-diagonal') + `: diagonal-only contact at (${x},${y})/(${x + 1},${y + dy})`);
      }
    }
  }
}
function _assertNoNotch(cells, m) {
  const s = new Set(cells.map(([x, y]) => `${x},${y}`));
  const has = (x, y) => s.has(`${x},${y}`);
  for (const [x, y] of cells) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ex = x + dx, ey = y + dy;
      if (has(ex, ey)) continue;
      const n = (has(ex + 1, ey) ? 1 : 0) + (has(ex - 1, ey) ? 1 : 0)
              + (has(ex, ey + 1) ? 1 : 0) + (has(ex, ey - 1) ? 1 : 0);
      if (n >= 3) throw new Error((m || 'no-notch') + `: unfilled notch at (${ex},${ey})`);
    }
  }
}

test('tidy: solid rectangle is untouched', () => {
  const rect = [];
  for (let y = 0; y < 3; y++) for (let x = 0; x < 4; x++) rect.push([x, y]);
  const out = WorldGen.tidyFootprintCells(rect, true);
  assert.eq(_norm(out), _norm(rect), 'rectangle unchanged');
});

test('tidy: genuine L-shape (2-cell-wide arms) is untouched', () => {
  // 4x4 L: vertical arm x:0-1 y:0-3, horizontal arm x:0-3 y:2-3.
  const L = [];
  for (let y = 0; y < 4; y++) for (let x = 0; x < 2; x++) L.push([x, y]);
  for (let y = 2; y < 4; y++) for (let x = 2; x < 4; x++) L.push([x, y]);
  const out = WorldGen.tidyFootprintCells(L, true);
  assert.eq(_norm(out), _norm(L), 'L-shape with wide recess unchanged');
});

test('tidy: two diagonal cells get bridged into an L-tromino', () => {
  const out = WorldGen.tidyFootprintCells([[0, 0], [1, 1]], false);
  assert.eq(out.length, 3, 'one bridge cell added');
  _assertNoDiagonalOnly(out, 'bridged');
  assert.truthy(_hasCell(out, 0, 0) && _hasCell(out, 1, 1), 'original cells kept');
});

test('tidy: anti-diagonal pair also bridged', () => {
  const out = WorldGen.tidyFootprintCells([[1, 0], [0, 1]], false);
  assert.eq(out.length, 3, 'one bridge cell added');
  _assertNoDiagonalOnly(out, 'bridged');
});

test('tidy: diagonal staircase becomes 4-connected with no corner contacts', () => {
  const out = WorldGen.tidyFootprintCells([[0, 0], [1, 1], [2, 2], [3, 3]], false);
  _assertNoDiagonalOnly(out);
  _assertNoNotch(out);
  // Still contains the original cells.
  for (const [x, y] of [[0, 0], [1, 1], [2, 2], [3, 3]]) {
    assert.truthy(_hasCell(out, x, y), `kept (${x},${y})`);
  }
  // 4-connectivity: flood from the first cell reaches everything.
  const s = new Set(out.map(([x, y]) => `${x},${y}`));
  const q = [out[0]]; const seen = new Set([`${out[0][0]},${out[0][1]}`]);
  while (q.length) {
    const [x, y] = q.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = `${x + dx},${y + dy}`;
      if (s.has(k) && !seen.has(k)) { seen.add(k); q.push([x + dx, y + dy]); }
    }
  }
  assert.eq(seen.size, out.length, 'single 4-connected component');
});

test('tidy: 1-wide notch in a rectangle edge is filled', () => {
  // 4x3 rect missing (2,0) — a 1-cell bite out of the top edge.
  const cells = [];
  for (let y = 0; y < 3; y++) for (let x = 0; x < 4; x++) {
    if (x === 2 && y === 0) continue;
    cells.push([x, y]);
  }
  const out = WorldGen.tidyFootprintCells(cells, false);
  assert.truthy(_hasCell(out, 2, 0), 'notch filled');
  assert.eq(out.length, 12, 'only the notch added');
});

test('tidy: interior 1-cell hole is filled', () => {
  const cells = [];
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
    if (x === 1 && y === 1) continue;
    cells.push([x, y]);
  }
  const out = WorldGen.tidyFootprintCells(cells, false);
  assert.truthy(_hasCell(out, 1, 1), 'hole filled');
  assert.eq(out.length, 9, 'only the hole added');
});

test('tidy: dropCrumbs keeps largest blob, drops stray fragment', () => {
  // 2x2 block + a far-away single cell.
  const cells = [[0, 0], [1, 0], [0, 1], [1, 1], [5, 5]];
  const out = WorldGen.tidyFootprintCells(cells, true);
  assert.eq(out.length, 4, 'crumb dropped');
  assert.falsy(_hasCell(out, 5, 5), 'stray cell gone');
});

test('tidy: dropCrumbs=false keeps disconnected fragments', () => {
  const cells = [[0, 0], [1, 0], [0, 1], [1, 1], [5, 5]];
  const out = WorldGen.tidyFootprintCells(cells, false);
  assert.eq(out.length, 5, 'fragment kept for non-small tiers');
});

test('tidy: deterministic — same input, same output', () => {
  const cells = [[0, 0], [1, 1], [2, 1], [3, 2], [5, 5], [0, 2]];
  const a = WorldGen.tidyFootprintCells(cells, true);
  const b = WorldGen.tidyFootprintCells(cells.map(c => [...c]), true);
  assert.eq(_norm(a), _norm(b), 'stable output');
});

test('tidy: result never violates the two invariants on random blobs', () => {
  const rng = WorldGen.makeRng(1234);
  for (let trial = 0; trial < 50; trial++) {
    const cells = [];
    const seen = new Set();
    const n = 2 + Math.floor(rng() * 10);
    for (let i = 0; i < n; i++) {
      const x = Math.floor(rng() * 6), y = Math.floor(rng() * 6);
      const k = `${x},${y}`;
      if (!seen.has(k)) { seen.add(k); cells.push([x, y]); }
    }
    const out = WorldGen.tidyFootprintCells(cells, true);
    _assertNoDiagonalOnly(out, `trial ${trial}`);
    _assertNoNotch(out, `trial ${trial}`);
    assert.gte(out.length, 1, `trial ${trial}: non-empty`);
  }
});
