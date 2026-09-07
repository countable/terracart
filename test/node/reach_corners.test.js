// The lit reach boundary rounds its corners — by ONE rule, in ONE pass.
//
// The reach silhouette is a staircase of whole cells, and the lightmap
// plateau (lighting.js) draws its edge. Rounding the corners by
// REACH_CORNER_PX only reads right if every corner of the staircase is
// rounded exactly once, with nothing left square and no fillet drawn twice by
// the two cells that meet at it. The geometry comes from coords.js'
// ReachCorner, and this test drives plateauCellPath over the real reach disc
// (cellInReach) with a recording context to check the picture agrees.
//
// A WHITE OUTLINE used to be traced over the same staircase by render.js
// (Render.reachOutlineCell), and this file's job was to pin that the line
// rounded exactly the corners the light did. It was removed in Sep 2026 — the
// plateau is lit brightly enough (PLATEAU_OUTPUT_K) to carry the tap
// affordance on its own, and a line over it drew the boundary a second time.
// The last test below pins that it stays gone.

(function () {

if (typeof CELL_PX === 'undefined') globalThis.CELL_PX = 32;
if (typeof VIEW_CELLS === 'undefined') globalThis.VIEW_CELLS = 11;

const RC = ReachCorner;
const R = REACH_CORNER_PX;

// A surface scene with the base reach: 2.5 cells (+1 m) about cell (0, 0).
function scene() {
  return {
    startWorldM: { x: 0, y: 0 }, playerM: { x: 0, y: 0 }, originPx: { x: 0, y: 0 },
    mPerPx: 1, feetOffsetM: 0, cellsPerTile: WorldGen.TILE_PX / 5, cellM: 5, depth: 0,
    save: { energy: 100, maxEnergy: 100, reachUpgrades: 0 },
  };
}

test('reach corners: the radius is 2 px and the rule is self-consistent', () => {
  assert.eq(R, 2, 'the smidge: border radius 2');
  assert.eq(RC.R, R, 'the rule carries the same radius the plateau reads');
  for (const h of [false, true]) for (const v of [false, true]) for (const d of [false, true]) {
    const cx = RC.convex(h, v), fl = RC.fillet(h, v, d);
    assert.falsy(cx && fl, `a corner is convex or a fillet, never both (${h},${v},${d})`);
    if (fl) {
      // The diagonal cell sees the same corner with h/v swapped and the
      // diagonal (this cell) lit: it must NOT draw the fillet a second time.
      assert.falsy(RC.fillet(v, h, true), 'the diagonal cell does not own the same fillet');
    }
  }
});

// Drive the plateau path over every reach cell of the disc; return what it drew.
function drawDisc() {
  const s = scene();
  const reach = (c, r) => cellInReach(s, c, r);
  const ops = [];                                     // plateau path ops
  const ctx = {};
  for (const op of ['moveTo', 'lineTo', 'arcTo', 'closePath', 'rect']) ctx[op] = (...a) => ops.push([op, ...a]);
  let cells = 0;
  const edges = [];   // [sx, sy, top, bot, lft, rgt] per lit cell, for the checks below
  for (let row = -4; row <= 4; row++) {
    for (let col = -4; col <= 4; col++) {
      if (!reach(col, row)) continue;
      cells++;
      const sx = col * CELL_PX, sy = row * CELL_PX;
      const top = !reach(col, row - 1), bot = !reach(col, row + 1);
      const lft = !reach(col - 1, row), rgt = !reach(col + 1, row);
      const dTL = reach(col - 1, row - 1), dTR = reach(col + 1, row - 1);
      const dBL = reach(col - 1, row + 1), dBR = reach(col + 1, row + 1);
      edges.push([sx, sy, top, bot, lft, rgt, dTL, dTR, dBL, dBR]);
      Lighting.plateauCellPath(ctx, sx, sy, top, bot, lft, rgt, dTL, dTR, dBL, dBR);
    }
  }
  return { cells, ops, edges };
}

const key = (x, y) => `${x.toFixed(4)},${y.toFixed(4)}`;

test('reach corners: every corner of the staircase is rounded exactly once', () => {
  const { cells, ops, edges } = drawDisc();
  assert.gt(cells, 12, 'the fixture lights a real disc, not a dot');
  // Every arcTo's control point IS the corner point, for an outer corner and
  // a fillet alike — so the round is tangent to both edges that meet there.
  const rounded = ops.filter(o => o[0] === 'arcTo').map(o => key(o[1], o[2]));
  assert.gt(rounded.length, 0, 'the plateau rounds corners');
  assert.eq(new Set(rounded).size, rounded.length, 'no corner is rounded twice (a fillet drawn by both cells)');
  // Every arcTo carries the rule's radius, never one of its own.
  for (const op of ops) if (op[0] === 'arcTo') assert.eq(op[5], R, 'an arc is drawn at ReachCorner.R');
  // And the count agrees with the rule applied cell by cell: nothing the rule
  // calls a corner was left square, and nothing else was rounded.
  let want = 0;
  for (const [, , top, bot, lft, rgt, dTL, dTR, dBL, dBR] of edges) {
    for (const [h, v, d] of [[lft, top, dTL], [rgt, top, dTR], [lft, bot, dBL], [rgt, bot, dBR]]) {
      if (RC.convex(h, v) || RC.fillet(h, v, d)) want++;
    }
  }
  assert.eq(rounded.length, want, 'the path rounds exactly the corners the rule names');
});

test('reach corners: a fillet is the sliver between the corner and the arc', () => {
  const { ops } = drawDisc();
  // The fillet subpath starts AT the corner, runs R along this cell's
  // horizontal edge, then arcs back to the diagonal cell's vertical edge —
  // so the lit area gains exactly the notch the staircase would otherwise cut.
  let fillets = 0;
  for (let i = 0; i < ops.length; i++) {
    if (ops[i][0] !== 'arcTo') continue;
    const prev = ops[i - 1];
    if (prev[0] === 'lineTo' && ops[i - 2] && ops[i - 2][0] === 'moveTo' && ops[i + 1] && ops[i + 1][0] === 'closePath') {
      fillets++;
      assert.eq(key(ops[i - 2][1], ops[i - 2][2]), key(ops[i][1], ops[i][2]), 'a fillet subpath starts at its corner');
      assert.eq(Math.hypot(prev[1] - ops[i][1], prev[2] - ops[i][2]), R, 'and runs R along the horizontal edge');
      assert.eq(Math.hypot(ops[i][3] - ops[i][1], ops[i][4] - ops[i][2]), R, 'and arcs to a point R away on the vertical one');
    }
  }
  assert.gt(fillets, 0, 'the disc has inner corners at all');
});

test('reach corners: the plateau reads the rule, and the radius lives in coords.js only', () => {
  const L = LIGHTING_SRC;
  assert.truthy(/plateauCellPath\(ctx, sx, sy,/.test(L) && /ctx\.beginPath\(\);[\s\S]*?ctx\.fill\(\);/.test(L),
    'the plateau is one path of rounded cells, filled once');
  assert.falsy(/ctx\.fillRect\(sx, sy, CELL_PX, CELL_PX\)/.test(L), 'the square per-cell fillRect plateau is gone');
  // The helper's radius is the rule's, never a literal of its own.
  const i = L.indexOf('function plateauCellPath(');
  const fn = L.slice(i, L.indexOf('\n  }\n', i));
  assert.truthy(/const RC = \(typeof ReachCorner !== 'undefined'\) \? ReachCorner : null;/.test(fn), 'plateauCellPath reads ReachCorner');
  assert.truthy(/const R = RC\.R;/.test(fn), 'plateauCellPath takes its radius from the rule');
  assert.falsy(/\b\d+(\.\d+)?\s*\*\s*(R|m)\b|\bR\s*=\s*\d/.test(fn), 'plateauCellPath carries no radius or scale of its own');
  assert.truthy(/const REACH_CORNER_PX = 2;/.test(COORDS_SRC), 'the radius is coords.js\' one number');
});

test('reach corners: the white outline is gone, and stays gone', () => {
  // Removed Sep 2026: the light carries the affordance now (see the header).
  // If the boundary ever stops reading, widen the plateau's step in
  // lighting.js — do not stroke a line over it again.
  const r = RENDER_SRC;
  assert.falsy(/reachOutlineCell/.test(r), 'the outline helper is gone from render.js');
  assert.falsy(/isReach\(/.test(r), 'and so is the per-cell reach loop that called it');
  assert.falsy(/reachCornerArcs|ARC_MID/.test(r), 'and the arc helper it needed');
  // The one thing left on the reach layer is the unmapped-tile reveal.
  assert.truthy(/const gr = scene\.reachGfx \|\| g;/.test(r), 'the reach layer still carries the unmapped-tile reveal');
  assert.truthy(/gr\.fillStyle\(COLORS\[UNMAPPED_T\]/.test(r), 'which is what it paints');
  // ReachCorner keeps only what the plateau reads: the edge-shortening pair
  // existed for the stroked line and went with it.
  assert.eq(typeof RC.shortenH, 'undefined', 'shortenH was the outline\'s, and left with it');
  assert.eq(typeof RC.shortenV, 'undefined', 'shortenV likewise');
});

})();
