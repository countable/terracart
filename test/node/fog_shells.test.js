// The fog-of-war FRONTIER RAMP (src/render.js).
//
// The fog used to be one flat wash of FOG_ALPHA black with a hard 32px edge.
// It is now drawn as concentric SHELLS off the boundary of explored ground,
// each shell's outermost cells bitten at the corners. Three things about that
// are easy to break silently, and this pins all three:
//
//   • the shell FIELD — which cells are 1, 2 and 3 cells out from revealed
//     ground (fogShellField, pure);
//   • the alpha LADDER — each pass composites over the last, so the per-pass
//     alphas are not the table, and the deepest shell must still land exactly
//     on FOG_ALPHA. Softening the edge must not lighten the claim;
//   • the FILLS — no shell may paint a cell the player has actually been to.

const SHELL_R = 2;                      // FOG_SHELL_R: the kernel's reach in cells
const SHELL_DEEP = FOG_SHELL_D2.length + 1;

// Build a W×W bit square with `seed(x, y)` deciding each cell, in the same
// coordinate space fogShellField reports on: (0,0) is the first REPORTED cell,
// so the margin runs from -SHELL_R.
function shellField(D, seed) {
  const W = D + 2 * SHELL_R;
  const bits = new Uint8Array(W * W);
  for (let r = 0; r < W; r++) {
    for (let c = 0; c < W; c++) bits[r * W + c] = seed(c - SHELL_R, r - SHELL_R) ? 1 : 0;
  }
  const lvl = fogShellField(bits, W, null);
  return (x, y) => lvl[y * D + x];
}

test('fog shells: revealed ground is level 0 and never fogged', () => {
  const at = shellField(7, () => 1);
  for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
    assert.eq(at(x, y), 0, `fully explored ground at ${x},${y}`);
  }
});

test('fog shells: unexplored ground with nothing near it is the deepest shell', () => {
  const at = shellField(7, () => 0);
  for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
    assert.eq(at(x, y), SHELL_DEEP, `open unknown at ${x},${y}`);
  }
});

test('fog shells: the level ramps with distance from the nearest revealed cell', () => {
  // One revealed cell at the centre of a 9×9 window.
  const at = shellField(9, (x, y) => x === 4 && y === 4);
  assert.eq(at(4, 4), 0, 'the revealed cell itself');
  assert.eq(at(5, 4), 1, 'orthogonally touching it');
  assert.eq(at(5, 5), 1, 'diagonally touching it');
  assert.eq(at(6, 4), 2, 'two cells out');
  assert.eq(at(6, 5), 2, 'a knight-ish step out (d² = 5, still shell 2)');
  assert.eq(at(6, 6), SHELL_DEEP, 'the far diagonal corner is outside the disc');
  assert.eq(at(7, 4), SHELL_DEEP, 'three cells out');
});

test('fog shells: the ramp is monotone — no shell is darker than one behind it', () => {
  // A revealed half-plane: every column right of x=3 should be at or past the
  // shell of the column to its left, never lighter.
  const at = shellField(11, (x) => x <= 3);
  for (let y = 0; y < 11; y++) {
    for (let x = 1; x < 11; x++) {
      assert.gte(at(x, y), at(x - 1, y), `shell at ${x},${y} vs its neighbour`);
    }
  }
  assert.eq(at(4, 5), 1, 'the cell against the frontier');
  assert.eq(at(5, 5), 2, 'one behind it');
  assert.eq(at(6, 5), SHELL_DEEP, 'and then the interior');
});

test('fog shells: the field reads the margin, so an edge cell is not mis-shelled', () => {
  // Revealed ground lives ENTIRELY in the margin — outside the reported window.
  // A field that only looked at what it reports would call the whole window
  // interior; it has to see the explored cells one step off the edge.
  const at = shellField(7, (x) => x < 0);
  assert.eq(at(0, 3), 1, 'the reported edge is against revealed ground');
  assert.eq(at(1, 3), 2, 'and ramps inward from there');
});

test('fog shells: the alpha ladder composites to the table, ending on FOG_ALPHA', () => {
  // Each pass draws over the last, so cumulative = 1 - Π(1 - aᵢ).
  let acc = 0;
  for (let i = 0; i < FOG_SHELL_A.length; i++) {
    const step = fogShellStep(i);
    assert.inRange(step, 0, 1, `pass ${i} alpha is a valid alpha`);
    acc = 1 - (1 - acc) * (1 - step);
    assert.lt(Math.abs(acc - FOG_SHELL_A[i]), 1e-9,
      `pass ${i} composites to ${FOG_SHELL_A[i]}, got ${acc}`);
  }
  assert.lt(Math.abs(acc - FOG_ALPHA), 1e-9,
    'the deepest shell still lands on the old flat FOG_ALPHA — the edge softens, the claim does not');
});

test('fog shells: the ladder only ever gets darker inward', () => {
  for (let i = 1; i < FOG_SHELL_A.length; i++) {
    assert.gt(FOG_SHELL_A[i], FOG_SHELL_A[i - 1], `shell ${i} is darker than shell ${i - 1}`);
  }
  assert.lt(FOG_SHELL_A[0], FOG_ALPHA, 'the frontier is lighter than the interior');
});

test('fog shells: a corner bite is a real bite, and sometimes no bite at all', () => {
  // A table of all-equal values would be a straight edge again; a table with no
  // zero castellates every straight front into battlements.
  assert.includes(Array.from(FOG_BEVEL_PX), 0, 'some cells keep a square corner');
  assert.gt(Math.max(...FOG_BEVEL_PX), 0, 'and some are actually bitten');
  assert.lt(Math.max(...FOG_BEVEL_PX) * 2, CELL_PX, 'a bite cannot eat the whole cell');
});

// ── The fills ─────────────────────────────────────────────────────────────
// drawFogShell needs a Graphics; a recorder is enough, since what matters is
// WHERE it fills, not how it looks.
function shellRecorder() {
  const rects = [];
  let alpha = 0;
  return {
    rects,
    fillStyle(_c, a) { alpha = a; },
    fillRect(x, y, w, h) { if (w > 0 && h > 0) rects.push({ x, y, w, h, alpha }); },
  };
}

// Drive the real pass over a synthetic shell field. `seenAt(col, row)` decides
// explored ground in the same -2..VIEW_CELLS+1 space drawCells hands it.
function shellPaint(seenAt) {
  const half = (VIEW_CELLS - 1) / 2;
  const scene = { viewCenterX: 0, viewCenterY: 0 };
  const D = VIEW_CELLS + 4;
  const W = D + 2 * SHELL_R;
  const bits = new Uint8Array(W * W);
  for (let r = 0; r < W; r++) {
    for (let c = 0; c < W; c++) {
      bits[r * W + c] = seenAt(c - SHELL_R - 2, r - SHELL_R - 2) ? 1 : 0;
    }
  }
  const lvl = fogShellField(bits, W, null);
  const LVL = (col, row) => lvl[(row + 2) * D + (col + 2)];
  const VEIL = () => 0;
  const g = shellRecorder();
  for (let s = 0; s < FOG_SHELL_A.length; s++) {
    drawFogShell(g, scene, LVL, VEIL, Math.max(1, s), fogShellStep(s), s !== 0, 0, 0, half);
  }
  // Screen rect of a cell, in the same whole-cell basis the pass lays out in.
  const cellBox = (col, row) => ({
    x: (col - half) * CELL_PX, y: (row - half) * CELL_PX, w: CELL_PX, h: CELL_PX,
  });
  return { rects: g.rects, cellBox };
}

test('fog fills: explored ground is never painted over', () => {
  // A revealed disc around the player, exactly what walking leaves behind.
  const seenAt = (c, r) => {
    const dx = c - 5, dy = r - 5;
    return dx * dx + dy * dy <= 9;
  };
  const { rects, cellBox } = shellPaint(seenAt);
  for (let row = -1; row <= VIEW_CELLS; row++) {
    for (let col = -1; col <= VIEW_CELLS; col++) {
      if (!seenAt(col, row)) continue;
      const b = cellBox(col, row);
      for (const q of rects) {
        const hit = q.x < b.x + b.w && q.x + q.w > b.x && q.y < b.y + b.h && q.y + q.h > b.y;
        assert.falsy(hit, `a fog rect covers explored cell ${col},${row}`);
      }
    }
  }
});

test('fog fills: unexplored ground is fully covered, corner bites included', () => {
  // Every fogged cell must end up at its shell's cumulative alpha somewhere —
  // and the under-wash means even a bitten corner is covered by SOMETHING.
  const seenAt = (c, r) => {
    const dx = c - 5, dy = r - 5;
    return dx * dx + dy * dy <= 9;
  };
  const { rects, cellBox } = shellPaint(seenAt);
  for (let row = -1; row <= VIEW_CELLS; row++) {
    for (let col = -1; col <= VIEW_CELLS; col++) {
      if (seenAt(col, row)) continue;
      const b = cellBox(col, row);
      // Sample the cell's four corners a pixel in — the bite is taken out of
      // the shell pass, but the under-wash below it is square.
      for (const [px, py] of [[1, 1], [CELL_PX - 1, 1], [1, CELL_PX - 1], [CELL_PX - 1, CELL_PX - 1]]) {
        const x = b.x + px, y = b.y + py;
        const covered = rects.some((q) => x >= q.x && x < q.x + q.w && y >= q.y && y < q.y + q.h);
        assert.truthy(covered, `fogged cell ${col},${row} has a hole at ${px},${py}`);
      }
    }
  }
});

test('fog fills: the frontier really is bitten — some corners are lighter than their cell', () => {
  const seenAt = (c, r) => {
    const dx = c - 5, dy = r - 5;
    return dx * dx + dy * dy <= 9;
  };
  const { rects, cellBox } = shellPaint(seenAt);
  // Total coverage at a point, composited the way the passes stack.
  const at = (x, y) => rects.reduce((a, q) => (
    x >= q.x && x < q.x + q.w && y >= q.y && y < q.y + q.h ? 1 - (1 - a) * (1 - q.alpha) : a), 0);
  let bitten = 0;
  for (let row = -1; row <= VIEW_CELLS; row++) {
    for (let col = -1; col <= VIEW_CELLS; col++) {
      if (seenAt(col, row)) continue;
      const b = cellBox(col, row);
      const mid = at(b.x + CELL_PX / 2, b.y + CELL_PX / 2);
      for (const [px, py] of [[1, 1], [CELL_PX - 1, 1], [1, CELL_PX - 1], [CELL_PX - 1, CELL_PX - 1]]) {
        if (at(b.x + px, b.y + py) < mid - 1e-9) { bitten++; }
      }
    }
  }
  assert.gt(bitten, 0, 'no corner anywhere on the frontier was bitten — the edge is still a staircase');
});

test('fog fills: the deepest shell reaches full FOG_ALPHA', () => {
  // Nothing revealed anywhere: the whole window is interior.
  const { rects, cellBox } = shellPaint(() => false);
  const b = cellBox(5, 5);
  const x = b.x + CELL_PX / 2, y = b.y + CELL_PX / 2;
  const total = rects.reduce((a, q) => (
    x >= q.x && x < q.x + q.w && y >= q.y && y < q.y + q.h ? 1 - (1 - a) * (1 - q.alpha) : a), 0);
  assert.lt(Math.abs(total - FOG_ALPHA), 1e-9, `deep fog composites to ${total}, want ${FOG_ALPHA}`);
});
