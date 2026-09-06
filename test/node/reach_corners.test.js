// The lit reach boundary rounds its corners — by ONE rule both passes read.
//
// The reach silhouette is a staircase of whole cells, drawn twice: the
// lightmap plateau (lighting.js — the bright area's sharp edge) and the white
// outline over it (render.js — the tap affordance). Rounding its corners by
// REACH_CORNER_PX only reads right if the line rounds exactly the corners the
// light does, with nothing left square and no gap where an edge was cut short
// for an arc that never came. Both passes take their corner geometry from
// coords.js' ReachCorner, and this test drives both helpers over the real
// reach disc (cellInReach) with recording stubs to check the picture agrees.

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
  assert.eq(RC.R, R, 'the rule carries the same radius both consumers read');
  for (const h of [false, true]) for (const v of [false, true]) for (const d of [false, true]) {
    const cx = RC.convex(h, v), fl = RC.fillet(h, v, d);
    assert.falsy(cx && fl, `a corner is convex or a fillet, never both (${h},${v},${d})`);
    if (cx) assert.truthy(RC.shortenH(h, d) && RC.shortenV(v, d), 'a rounded outer corner shortens both edges');
    if (fl) {
      assert.truthy(RC.shortenH(h, d), 'a fillet shortens the horizontal edge it continues');
      // The diagonal cell sees the same corner with h/v swapped and the
      // diagonal (this cell) lit: it must shorten its vertical edge and NOT
      // draw the fillet a second time.
      assert.truthy(RC.shortenV(h, true), 'the diagonal cell shortens its vertical edge to meet the fillet');
      assert.falsy(RC.fillet(v, h, true), 'the diagonal cell does not own the same fillet');
    }
    // A square corner (neither round) leaves both edges full length only when
    // nothing continues them: the diagonal is dark and the edge runs on.
    if (!cx && !fl && !d) assert.falsy(RC.shortenH(h, d) && !h, 'a straight-through corner is not shortened');
  }
});

// Drive both helpers over every reach cell of the disc; return what they drew.
function drawDisc() {
  const s = scene();
  const reach = (c, r) => cellInReach(s, c, r);
  const segs = [];                                    // outline: [x0, y0, x1, y1]
  const gr = { lineBetween: (a, b, c, d) => segs.push([a, b, c, d]) };
  const ops = [];                                     // plateau path ops
  const ctx = {};
  for (const op of ['moveTo', 'lineTo', 'arcTo', 'closePath', 'rect']) ctx[op] = (...a) => ops.push([op, ...a]);
  let cells = 0;
  for (let row = -4; row <= 4; row++) {
    for (let col = -4; col <= 4; col++) {
      if (!reach(col, row)) continue;
      cells++;
      const sx = col * CELL_PX, sy = row * CELL_PX;
      const top = !reach(col, row - 1), bot = !reach(col, row + 1);
      const lft = !reach(col - 1, row), rgt = !reach(col + 1, row);
      const dTL = reach(col - 1, row - 1), dTR = reach(col + 1, row - 1);
      const dBL = reach(col - 1, row + 1), dBR = reach(col + 1, row + 1);
      Render.reachOutlineCell(gr, sx, sy, top, bot, lft, rgt, dTL, dTR, dBL, dBR);
      Lighting.plateauCellPath(ctx, sx, sy, top, bot, lft, rgt, dTL, dTR, dBL, dBR);
    }
  }
  return { cells, segs, ops };
}

const key = (x, y) => `${x.toFixed(4)},${y.toFixed(4)}`;
const isInt = (v) => Math.abs(v - Math.round(v)) < 1e-9;

test('reach corners: the outline is closed loops with every corner rounded', () => {
  const { cells, segs } = drawDisc();
  assert.gt(cells, 12, 'the fixture lights a real disc, not a dot');
  assert.gt(segs.length, 0, 'the outline was drawn');
  // Every endpoint is shared by exactly two primitives: no gap where an edge
  // was cut short, no stub, no arc left dangling.
  const ends = new Map();
  for (const [x0, y0, x1, y1] of segs) {
    for (const k of [key(x0, y0), key(x1, y1)]) ends.set(k, (ends.get(k) || 0) + 1);
  }
  for (const [k, n] of ends) assert.eq(n, 2, `outline endpoint ${k} is shared by ${n} segments, not 2`);
  // Straight segments lie on cell edges; where two meet at a point they are
  // collinear — a horizontal meeting a vertical would be a square corner.
  const straight = segs.filter(([x0, y0, x1, y1]) => [x0, y0, x1, y1].every(isInt));
  const dirAt = new Map();
  for (const [x0, y0, x1, y1] of straight) {
    assert.truthy(x0 === x1 || y0 === y1, 'a straight outline segment is axis-aligned');
    const dir = x0 === x1 ? 'v' : 'h';
    for (const k of [key(x0, y0), key(x1, y1)]) {
      const prev = dirAt.get(k);
      assert.truthy(!prev || prev === dir, `square corner left at ${k}`);
      dirAt.set(k, dir);
    }
  }
  assert.gt(straight.length, 0, 'the edges are still drawn between the rounds');
  assert.gt(segs.length - straight.length, 0, 'some corners were rounded');
});

test('reach corners: the line rounds exactly the corners the light does', () => {
  const { segs, ops } = drawDisc();
  // The plateau's rounds: every arcTo's control point IS the corner point,
  // for an outer corner and a fillet alike.
  const lightCorners = ops.filter(o => o[0] === 'arcTo').map(o => key(o[1], o[2]));
  assert.eq(new Set(lightCorners).size, lightCorners.length, 'no corner is rounded twice (a fillet drawn by both cells)');
  assert.gt(lightCorners.length, 0, 'the plateau rounds corners');
  // The outline's rounds: an arc is two segments meeting at a fractional 45°
  // point; its corner is the axis-aligned candidate nearer that point (the
  // other one is the arc's centre, a full R away).
  const byMid = new Map();
  for (const sg of segs) {
    const [x0, y0, x1, y1] = sg;
    if (!isInt(x0) || !isInt(y0)) { const k = key(x0, y0); byMid.set(k, (byMid.get(k) || []).concat([[x1, y1]])); }
    if (!isInt(x1) || !isInt(y1)) { const k = key(x1, y1); byMid.set(k, (byMid.get(k) || []).concat([[x0, y0]])); }
  }
  const lineCorners = [];
  for (const [mk, endsOf] of byMid) {
    assert.eq(endsOf.length, 2, `arc midpoint ${mk} joins ${endsOf.length} segments`);
    const [mx, my] = mk.split(',').map(Number);
    const [[ax, ay], [bx, by]] = endsOf;
    const cands = [[ax, by], [bx, ay]];
    cands.sort((p, q) => Math.hypot(p[0] - mx, p[1] - my) - Math.hypot(q[0] - mx, q[1] - my));
    const [px, py] = cands[0];
    assert.truthy(Math.abs(Math.hypot(ax - px, ay - py) - R) < 1e-9 && Math.abs(Math.hypot(bx - px, by - py) - R) < 1e-9,
      `the arc at ${mk} is tangent R from its corner`);
    lineCorners.push(key(px, py));
  }
  assert.eq([...lineCorners].sort().join(' '), [...lightCorners].sort().join(' '),
    'the outline rounds the same corner points the plateau does');
  // The fillet subpath is the sliver between the corner and the arc: it starts
  // AT the corner, so the lit area gains exactly what the outline's arc encloses.
  for (let i = 0; i < ops.length; i++) {
    if (ops[i][0] !== 'arcTo') continue;
    const prev = ops[i - 1];
    if (prev[0] === 'lineTo' && ops[i - 2] && ops[i - 2][0] === 'moveTo' && ops[i + 1] && ops[i + 1][0] === 'closePath') {
      assert.eq(key(ops[i - 2][1], ops[i - 2][2]), key(ops[i][1], ops[i][2]), 'a fillet subpath starts at its corner');
      assert.truthy(Math.hypot(prev[1] - ops[i][1], prev[2] - ops[i][2]) === R, 'and runs R along the horizontal edge');
    }
  }
});

test('reach corners: both passes read the rule, and the radius lives in coords.js only', () => {
  const L = LIGHTING_SRC, r = RENDER_SRC;
  assert.truthy(/plateauCellPath\(ctx, sx, sy,/.test(L) && /ctx\.beginPath\(\);[\s\S]*?ctx\.fill\(\);/.test(L),
    'the plateau is one path of rounded cells, filled once');
  assert.falsy(/ctx\.fillRect\(sx, sy, CELL_PX, CELL_PX\)/.test(L), 'the square per-cell fillRect plateau is gone');
  assert.truthy(/Render\.reachOutlineCell\(gr, sx, sy, top, bot, lft, rgt,/.test(r), 'drawCells traces each cell through the rounded helper');
  // Each helper's radius is the rule's, never a literal of its own.
  const body = (src, start, end) => { const i = src.indexOf(start); return src.slice(i, src.indexOf(end, i)); };
  const plateau = body(L, 'function plateauCellPath(', '\n  }\n');
  const outline = body(r, 'Render.reachOutlineCell = function', '\n};\n');
  for (const [name, fn] of [['plateauCellPath', plateau], ['reachOutlineCell', outline]]) {
    assert.truthy(/const RC = \(typeof ReachCorner !== 'undefined'\) \? ReachCorner : null;/.test(fn), `${name} reads ReachCorner`);
    assert.truthy(/const R = RC\.R;/.test(fn), `${name} takes its radius from the rule`);
    assert.falsy(/\b\d+(\.\d+)?\s*\*\s*(R|m)\b|\bR\s*=\s*\d/.test(fn), `${name} carries no radius or scale of its own`);
  }
  assert.truthy(/const REACH_CORNER_PX = 2;/.test(COORDS_SRC), 'the radius is coords.js\' one number');
});

})();
