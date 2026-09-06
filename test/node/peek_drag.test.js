// Headless tests for the PEEK DRAG — dragging the map a little way to look at
// what the viewport is cutting off (app.js "PEEK DRAG", coords.js
// viewAnchorWorldM / viewAnchorCell).
//
// Two contracts, and they pull in opposite directions:
//
//   1. It is a CAMERA offset and NOTHING ELSE. playerM never moves, so reach,
//      the tap gates, fog reveal and tile loading all still measure from the
//      body. Peeking at a crate three cells away and tapping it must still say
//      "too far" — a camera that could reach would be a teleport.
//   2. Everything DRAWN measures from the anchor, and the tap conversion is the
//      exact inverse of it. A tap must land on the cell it was drawn over, or
//      the peek would hand every tap to whatever used to be under that pixel.
//
// Plus the input rule that makes the drag possible at all: a pointer that
// travelled is a drag and taps nothing; one that didn't is a tap.
//
// The peek methods and the pointer-release rule are lifted out of app.js by
// run.js (globalThis.__peek) so these drive the shipping code.

if (typeof VIEW_CELLS === 'undefined') globalThis.VIEW_CELLS = 11;
if (typeof CELL_PX === 'undefined') globalThis.CELL_PX = 32;

// A scene shaped like the real one, with round numbers so every expectation
// below can be worked out by hand. cellM = 7 (WorldGen.CELL_M) and CELL_PX = 32
// are the shipping values, so a cell is 32 screen px wide.
function peekScene(over) {
  const s = {
    startWorldM: { x: 10000, y: 20000 },
    mPerPx: 10,
    originPx: { x: 1000, y: 2000 },
    cellsPerTile: 51,
    cellM: 7,
    playerM: { x: 0, y: 0 },
    feetOffsetM: 2.2,
    depth: 0,
    viewCenterX: 176,
    viewCenterY: 200,
    viewSize: VIEW_CELLS * CELL_PX,
    peekM: { x: 0, y: 0 },
    _peekPointerId: null,
    _peekDragging: false,
    _peekReturning: false,
    save: { energy: 100, reachUpgrades: 0 },
  };
  Object.assign(s, __peek, over || {});
  return s;
}
const PX_PER_M = CELL_PX / 7;          // cellM = 7
// The suite's assert has no float compare; same shape as path_cobbles.test.js.
const near = (a, b, eps, m) => assert.inRange(a, b - eps, b + eps, m);

// ── The camera collapses onto the player when nothing is peeking ────────────

test('peek: with no drag the anchor IS the player', () => {
  const s = peekScene({ playerM: { x: 40, y: -25 } });
  const a = viewAnchorWorldM(s);
  assert.eq(a.x, s.startWorldM.x + s.playerM.x, 'anchor x sits on the body');
  assert.eq(a.y, s.startWorldM.y + s.playerM.y, 'anchor y sits on the body');
  const p = s.playerScreen();
  assert.eq(p.x, s.viewCenterX, 'the player is drawn at the viewport centre');
  assert.eq(p.y, s.viewCenterY, 'the player is drawn at the viewport centre');
});

test('peek: a scene with no peekM at all still projects (stub scenes, boot)', () => {
  const s = peekScene();
  delete s.peekM;
  const a = viewAnchorWorldM(s);
  assert.eq(a.x, s.startWorldM.x, 'no peek field reads as no peek');
  assert.eq(a.y, s.startWorldM.y, 'no peek field reads as no peek');
});

// ── The anchor moves by exactly the peek ────────────────────────────────────

test('peek: the anchor moves by the peek, in metres', () => {
  const s = peekScene({ peekM: { x: 14, y: -7 } });
  const a = viewAnchorWorldM(s);
  assert.eq(a.x, s.startWorldM.x + 14, 'two cells east');
  assert.eq(a.y, s.startWorldM.y - 7, 'one cell north');
});

test('peek: the drawn window slides by the peek, in cells', () => {
  const base = peekScene();
  const before = viewAnchorCell(base);
  const after = viewAnchorCell(peekScene({ peekM: { x: 3 * 7, y: 0 } }));
  const cells = (after.tx - before.tx) * base.cellsPerTile + (after.cx - before.cx);
  // The tile-pixel basis is metres/mPerPx, so three cells of peek is three
  // cells of window — the same shift drawCells hands every per-cell pass.
  const cellsPerPx = base.cellsPerTile / WorldGen.TILE_PX;
  near(cells, (3 * 7 / base.mPerPx) * cellsPerPx, 1e-9,
    'the window moved by the peek and nothing else');
});

// ── The projection stays invertible: a tap lands where it looks ─────────────

test('peek: screen→world is the exact inverse of world→screen while peeking', () => {
  const s = peekScene({ peekM: { x: 11, y: -4 }, playerM: { x: 33, y: 12 } });
  for (const [wx, wy] of [[10000, 20000], [10123, 19870], [9950, 20044]]) {
    const p = worldMetersToScreen(s, wx, wy);
    const back = screenToWorldMeters(s, p.x, p.y);
    near(back.x, wx, 1e-9, 'round-trips in x');
    near(back.y, wy, 1e-9, 'round-trips in y');
  }
});

test('peek: a tap on the pixel a thing is drawn at resolves to that thing', () => {
  // A crate two cells east of the player. Peek west so the crate slides across
  // the screen, then tap the pixel it now occupies: the tap must land in the
  // crate's own cell, not the cell that pixel used to show.
  const s = peekScene();
  const crateX = s.startWorldM.x + 2 * 7, crateY = s.startWorldM.y;
  const restPx = worldMetersToScreen(s, crateX, crateY);
  s.peekM = { x: -2 * 7, y: 0 };
  const peekPx = worldMetersToScreen(s, crateX, crateY);
  near(peekPx.x - restPx.x, 2 * 7 * PX_PER_M, 1e-9,
    'the crate slid two cells east on screen');
  const wm = screenToWorldMeters(s, peekPx.x, peekPx.y);
  assert.truthy(sameAbsCell(s, wm.x, wm.y, crateX, crateY),
    'the tap resolves into the crate\'s cell');
});

test('peek: the SAME pixel means a different cell once the camera has moved', () => {
  const s = peekScene();
  const at = screenToWorldMeters(s, s.viewCenterX, s.viewCenterY);
  s.peekM = { x: 3 * 7, y: 0 };
  const moved = screenToWorldMeters(s, s.viewCenterX, s.viewCenterY);
  near(moved.x - at.x, 3 * 7, 1e-9,
    'the centre pixel now reads three cells further east');
});

// ── …but the PLAYER has not moved ───────────────────────────────────────────

test('peek: the camera does not move the body, so reach is unchanged', () => {
  const s = peekScene();
  const cellBefore = playerReachCell(s);
  const target = { x: s.startWorldM.x + 3 * 7, y: s.startWorldM.y };
  const tc = worldMetersToAbsCell(s, target.x, target.y);
  const reachBefore = cellInReach(s, tc.cellIX, tc.cellIY);
  // Peek right onto the target — the camera is now centred on it.
  s.peekM = { x: 3 * 7, y: 0 };
  const cellAfter = playerReachCell(s);
  assert.eq(cellAfter.cellIX, cellBefore.cellIX, 'the reach origin stayed on the body');
  assert.eq(cellAfter.cellIY, cellBefore.cellIY, 'the reach origin stayed on the body');
  assert.eq(cellInReach(s, tc.cellIX, tc.cellIY), reachBefore,
    'peeking at a cell does not bring it into reach');
});

test('peek: the player is drawn off-centre by exactly the peek', () => {
  const s = peekScene({ peekM: { x: 2 * 7, y: -7 } });
  const p = s.playerScreen();
  near(p.x, s.viewCenterX - 2 * 7 * PX_PER_M, 1e-9, 'two cells west of centre');
  near(p.y, s.viewCenterY + 7 * PX_PER_M, 1e-9, 'one cell south of centre');
  // The sprite has to land where the ground under it went, or the character
  // would swim across the map as it slides.
  const body = worldMetersToScreen(s, s.startWorldM.x + s.playerM.x,
                                      s.startWorldM.y + s.playerM.y);
  near(p.x, body.x, 1e-9, 'the sprite sits on its own projected position');
  near(p.y, body.y, 1e-9, 'the sprite sits on its own projected position');
});

// ── The drag itself ─────────────────────────────────────────────────────────

test('peek drag: the map follows the finger', () => {
  const s = peekScene();
  s._setPeekFromDrag(32, 0);       // drag one cell east
  // Dragging east pulls the ground east, so the CAMERA moves west.
  near(s.peekM.x, -7, 1e-9, 'one cell of camera, the other way');
  const p = s.playerScreen();
  near(p.x - s.viewCenterX, 32, 1e-9,
    'the player travelled with the ground, by the drag exactly');
});

test('peek drag: no drag can outrun the loaded world', () => {
  const s = peekScene();
  s._setPeekFromDrag(4000, 4000);
  const mag = Math.hypot(s.peekM.x, s.peekM.y) / s.cellM;
  near(mag, PEEK_MAX_CELLS, 1e-9, 'clamped to the cap, in cells');
  // The cap has to stay inside the 3×3 tile neighbourhood every world pass
  // scans, and comfortably inside the half-view so the character is never
  // dragged off the map.
  assert.lt(PEEK_MAX_CELLS, VIEW_CELLS / 2, 'the player stays on screen');
});

test('peek drag: the clamp keeps the direction it was given', () => {
  const s = peekScene();
  s._setPeekFromDrag(-300, 300);
  assert.gt(s.peekM.x, 0, 'dragging west moves the camera east');
  assert.lt(s.peekM.y, 0, 'dragging south moves the camera north');
  near(s.peekM.x, -s.peekM.y, 1e-9, 'a 45° drag stays at 45°');
});

test('peek drag: letting go springs the camera home', () => {
  const s = peekScene();
  s._setPeekFromDrag(96, 96);
  s._releasePeek();
  assert.truthy(s._peekReturning, 'the spring-back is armed');
  let last = Math.hypot(s.peekM.x, s.peekM.y);
  for (let i = 0; i < 200 && s.isPeeking(); i++) {
    s._tickPeek(1 / 60);
    const now = Math.hypot(s.peekM.x, s.peekM.y);
    assert.lte(now, last, 'the camera only ever moves toward the player');
    last = now;
  }
  assert.eq(s.isPeeking(), false, 'it lands exactly on the player, not near it');
  assert.eq(s._peekReturning, false, 'and stops ticking once it is home');
});

test('peek drag: the spring-back is over in well under a second', () => {
  const s = peekScene();
  s._setPeekFromDrag(0, PEEK_MAX_CELLS * CELL_PX * 4);   // clamped to the cap
  s._releasePeek();
  let frames = 0;
  while (s.isPeeking() && frames < 600) { s._tickPeek(1 / 60); frames++; }
  assert.lt(frames / 60, 0.6, 'a peek that hangs about would read as a stuck camera');
});

test('peek drag: a warp snaps the camera back with no spring', () => {
  const s = peekScene();
  s._setPeekFromDrag(90, 0);
  s.clearPeek();
  assert.eq(s.isPeeking(), false, 'the camera is on the body immediately');
  assert.eq(s._peekReturning, false, 'and nothing is left easing');
});

// ── Tap or drag ─────────────────────────────────────────────────────────────
// The rule the whole feature turns on: a pointer that dragged the map taps
// NOTHING. Sliding the map off a tree must not chop it.

function tapScene(over) {
  const taps = [];
  const s = peekScene(Object.assign({
    _peekPointerId: 1,
    handleWorldTap(sx, sy) { taps.push({ sx, sy }); },
  }, over || {}));
  s.taps = taps;
  return s;
}

test('tap/drag: a pointer that never travelled taps where it lifted', () => {
  const s = tapScene({ _peekDragging: false });
  s.endPeekPointer({ id: 1, x: 120, y: 130 });
  assert.eq(s.taps.length, 1, 'the tap fired');
  assert.eq(s.taps[0].sx, 120, 'at the pixel it lifted on');
  assert.eq(s.taps[0].sy, 130, 'at the pixel it lifted on');
});

test('tap/drag: a pointer that DRAGGED taps nothing', () => {
  const s = tapScene({ _peekDragging: true });
  s.endPeekPointer({ id: 1, x: 120, y: 130 });
  assert.eq(s.taps.length, 0, 'sliding the map off a tree must not chop it');
});

test('tap/drag: either way the drag is released, so the next tap works', () => {
  for (const dragged of [false, true]) {
    const s = tapScene({ _peekDragging: dragged });
    s.endPeekPointer({ id: 1, x: 10, y: 10 });
    assert.eq(s._peekPointerId, null, 'the pointer let go of the camera');
    assert.eq(s._peekDragging, false, 'and the drag flag is clear');
  }
});

test('tap/drag: a second finger lifting is not the drag pointer, and taps nothing', () => {
  const s = tapScene({ _peekDragging: true });
  s.endPeekPointer({ id: 2, x: 40, y: 40 });
  assert.eq(s.taps.length, 0, 'the other finger does not tap');
  assert.eq(s._peekPointerId, 1, 'and does not steal the drag');
});

test('tap/drag: the slop is big enough for a shaky finger, small enough to aim', () => {
  // A tap on a phone rolls a few pixels; a cell is CELL_PX wide, so the slop
  // must stay well under one cell or a deliberate tap could become a drag.
  assert.gte(PEEK_DRAG_SLOP_PX, 4, 'a rolling finger still taps');
  assert.lt(PEEK_DRAG_SLOP_PX, CELL_PX / 2, 'a tap never turns into a drag');
});

// ── The canvas is not the grid ──────────────────────────────────────────────
// The canvas backing store is RENDER_SCALE× the logical 352×844 grid so the
// picture is 1:1 with the screen (src/app.js, the canvas-resolution note by
// W/H). Phaser reports pointer positions in THAT space, and everything the tap
// path does with them — the cell hit test, the reach gate, the drag slop — is
// in logical px. So the conversion is not cosmetic: leave it out on a DPR-3
// phone and every tap lands three times too far down and right, which on an
// 11-cell view means off the map entirely.
//
// These drive the shipped `_gamePt` and the shipped `endPeekPointer` at the
// scales real devices actually produce (2 = a retina laptop, 3 = a modern
// phone), by reassigning the same RENDER_SCALE binding app.js re-reads on
// resize. Restored to 1 afterwards so nothing below inherits a scaled grid.

test('hidpi: a pointer converts from canvas px to logical px', () => {
  const s = peekScene();
  for (const rs of [1, 2, 3]) {
    RENDER_SCALE = rs;
    const g = s._gamePt({ x: 120 * rs, y: 130 * rs });
    assert.eq(g.x, 120, `x at ${rs}x`);
    assert.eq(g.y, 130, `y at ${rs}x`);
  }
  RENDER_SCALE = 1;
});

test('hidpi: a tap lands on the same logical point at every canvas scale', () => {
  for (const rs of [1, 2, 3]) {
    RENDER_SCALE = rs;
    const s = tapScene({ _peekDragging: false });
    // The same physical spot on the glass, reported in that scale's canvas px.
    s.endPeekPointer({ id: 1, x: 120 * rs, y: 130 * rs });
    assert.eq(s.taps.length, 1, `the tap fired at ${rs}x`);
    assert.eq(s.taps[0].sx, 120, `x is logical, not canvas, at ${rs}x`);
    assert.eq(s.taps[0].sy, 130, `y is logical, not canvas, at ${rs}x`);
  }
  RENDER_SCALE = 1;
});

test('hidpi: the drag slop is measured in logical px, not canvas px', () => {
  // A finger that rolled just under the slop is a TAP. Measured in raw canvas
  // px it would clear the slop on any HiDPI screen, so the same shaky tap that
  // works on a desktop would silently become a drag — and tap nothing — on a
  // phone. The slop is a human-hand distance; it has to stay in the grid the
  // hand sees.
  const roll = PEEK_DRAG_SLOP_PX - 1;
  for (const rs of [1, 2, 3]) {
    RENDER_SCALE = rs;
    const s = tapScene();
    s._peekDownX = 100; s._peekDownY = 100;
    s._peekFromM = { x: 0, y: 0 };
    const at = s._gamePt({ x: (100 + roll) * rs, y: 100 * rs });
    assert.lt(Math.hypot(at.x - s._peekDownX, at.y - s._peekDownY),
              PEEK_DRAG_SLOP_PX, `a sub-slop roll stays a tap at ${rs}x`);
  }
  RENDER_SCALE = 1;
});

// ── The darkness has to be drawn wider than the frame ───────────────────────
// The distance falloff (render.js drawCells) is ~100 concentric rings cached
// about the VIEWPORT CENTRE and slid by the peek offset with setPosition
// instead of being rebuilt at the player's new screen position every frame of
// a drag. That cache is why the ring set can't stop at the frame edge: a peek
// pulls the far side of the disc inward, and past the last ring nothing is
// drawn at all — the darkness's own outer edge showed as a circular arc cutting
// across the corner of the map.
//
// So Render.falloffRadii splits the one radius in two: the RAMP still ends at
// the viewport's half-diagonal (its shape and the measured luminance spread are
// untouched), and the rings keep going flat past it, far enough that no peek
// can reach their edge.

test('falloff: the ramp still ends at the viewport half-diagonal', () => {
  const vs = VIEW_CELLS * CELL_PX;
  const { rRamp } = Render.falloffRadii(vs);
  near(rRamp, Math.hypot(vs, vs) / 2, 1e-9,
       'the ramp is graded over the visible square, not past it');
});

test('falloff: the rings are drawn past every pixel a peek can expose', () => {
  const vs = VIEW_CELLS * CELL_PX;
  const { rRamp, rOut } = Render.falloffRadii(vs);
  // The furthest the cached image can be slid: the drag clamp, in screen px.
  const peekPx = PEEK_MAX_CELLS * CELL_PX;
  assert.gte(rOut, rRamp + peekPx,
             'a full-magnitude peek still lands inside the drawn rings');
  // ...and that is the drag's OWN clamp, not a number of its own — a bigger
  // PEEK_MAX_CELLS has to widen the rings with it or the edge comes back.
  near(rOut - rRamp, peekPx, 1e-9, 'the margin IS the peek clamp');
});

test('falloff: no visible corner escapes the rings under a peek in any direction', () => {
  const vs = VIEW_CELLS * CELL_PX;
  const { rOut } = Render.falloffRadii(vs);
  const s = peekScene();
  const half = vs / 2;
  // Push the peek to the clamp in a ring of directions, then measure the worst
  // visible corner in the ring image's own (unslid) coordinates: the viewport
  // corner offset by the peek.
  for (let a = 0; a < 16; a++) {
    const th = (a / 16) * Math.PI * 2;
    s._setPeekFromDrag(-Math.cos(th) * 1000, -Math.sin(th) * 1000);
    const pk = { x: s.peekM.x * PX_PER_M, y: s.peekM.y * PX_PER_M };
    for (const cx of [-half, half]) {
      for (const cy of [-half, half]) {
        const d = Math.hypot(cx + pk.x, cy + pk.y);
        assert.lte(d, rOut, `corner (${cx},${cy}) is covered at ${a}/16`);
      }
    }
  }
  s.clearPeek();
});

test('falloff: the ring loop clamps the ramp instead of running past it', () => {
  // The loop itself needs Phaser, so pin it as source text: it must walk out to
  // rOut while the ramp parameter saturates at 1. Extrapolating t past rRamp
  // would drive the alpha above FALLOFF_A and reintroduce a graded edge.
  const src = RENDER_SRC;
  assert.truthy(/for \(let r = r0; r < rOut; r \+= STEP\)/.test(src),
                'the rings are drawn out to rOut');
  assert.truthy(/const t = Math\.min\(1, \(r - r0\) \/ \(rRamp - r0\)\)/.test(src),
                'the ramp parameter is clamped at the ramp radius');
  assert.falsy(/rMax/.test(src), 'the old single radius is gone');
});
