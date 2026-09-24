// Walking round a wall commits to a side (src/app.js _detourDir /
// DETOUR_COMMIT_MS).
//
// Underground the body follows a target through open cells, and when a wall
// stops its progress _detourDir offers a one-cell sidestep round it. The side
// used to be re-read EVERY FRAME from the target's lean off the body's heading
// — and the sidestep itself swings that lean: the first jog puts the body off
// the target's line, the target now leans the other way, and the next frame
// jogged straight back. Behind a one-cell rock with the target dead ahead the
// body vibrated on the spot forever ("keeps switching directions, vibrating in
// one spot"). The fix holds the chosen side (_detourHold) while the jogs last
// and DETOUR_COMMIT_MS past the last one.
//
// app.js can't load headlessly, so _followStep and _detourDir are lifted out of
// APP_JS_SRC and run for real on a stub cave (the trap_pin / walk_home idiom),
// with a fake clock standing in for performance.now().

(function () {
const app = APP_JS_SRC;

const lift = (sig) => {
  const start = app.indexOf('\n  ' + sig);
  const end = start < 0 ? -1 : app.indexOf('\n  }\n', start);
  assert.truthy(start > 0 && end > start, `found ${sig}`);
  return app.slice(start + 1, end + 4);
};
const num = (name) => {
  const m = app.match(new RegExp(`const ${name} = ([\\d.]+);`));
  assert.truthy(m, `found ${name} in src/app.js`);
  return parseFloat(m[1]);
};

const COMMIT_MS = num('DETOUR_COMMIT_MS');
const clock = { t: 0, now() { return this.t; } };
const methods = new Function('WALK_M_S', 'DEBUG_SPEED_MUL', 'FOLLOW_RAMP_M',
  'DETOUR_COMMIT_MS', 'performance', 'steerSpeedMul',
  `return {\n${lift('_followStep(dt) {')},\n${lift('_detourDir(ux, uy) {')}\n};`)(
  num('WALK_M_S'), num('DEBUG_SPEED_MUL'), num('FOLLOW_RAMP_M'), COMMIT_MS, clock, () => 1);

const M = 7;   // cell edge, metres
// A stub cave: `walls` is a list of [cx, cy] cells, the body starts at the
// centre of cell `from`, the target sits at the centre of cell `to`. Every
// side _detourDir returns is recorded in `sides` (0 for "no detour").
function cave(walls, from, to) {
  clock.t = 0;
  const solid = new Set(walls.map(([x, y]) => `${x},${y}`));
  const s = Object.assign({
    cellM: M, feetOffsetM: 0, startWorldM: { x: 0, y: 0 },
    playerM: { x: (from[0] + 0.5) * M, y: (from[1] + 0.5) * M },
    _targetM: { x: (to[0] + 0.5) * M, y: (to[1] + 0.5) * M },
    compassDeg: 0, _followPaused: false, _stickHeading: null, _detourHold: null,
    mined: 0, sides: [],
    _busyWheel: () => null, _stickPushed: () => false, _walkRelics: () => [],
    _playDirected() {},
    _startAutoMine() { this.mined++; },
    _cellBlocked(x, y) { return solid.has(`${Math.floor(x / M)},${Math.floor(y / M)}`); },
  }, methods);
  const detour = s._detourDir;
  s._detourDir = function (ux, uy) {
    const d = detour.call(this, ux, uy);
    this.sides.push(d ? (d.x || d.y) : 0);
    return d;
  };
  return s;
}
const run = (s, seconds, dt = 1 / 30) => {
  for (let i = 0; i < seconds / dt; i++) { clock.t += dt * 1000; s._followStep(dt); }
};
const flips = (sides) => {
  let n = 0;
  for (let i = 1; i < sides.length; i++) if (sides[i] && sides[i - 1] && sides[i] !== sides[i - 1]) n++;
  return n;
};

test('detour: the hold is a beat, not a lock', () => {
  assert.gte(COMMIT_MS, 500, 'under half a second the flip-flop comes back between jogs');
  assert.lte(COMMIT_MS, 3000, 'past a few seconds the next wall inherits a stale side');
});

test('detour: a rock dead ahead is walked round on ONE side, not vibrated behind', () => {
  // The target straight past a one-cell rock: no lean at all, so the first jog
  // is what creates one — pointing back the way it came.
  const s = cave([[1, 0]], [0, 0], [10, 0]);
  run(s, 10);
  assert.gt(s.sides.length, 0, 'the rock was met and a detour asked for');
  assert.eq(flips(s.sides), 0, `the side flipped ${flips(s.sides)} times — the body vibrated in place`);
  assert.eq(s.mined, 0, 'a one-cell rock with open floor round it is walked round, not dug');
  assert.gt(s.playerM.x, 2 * M, 'the body got past the rock');
  assert.lt(Math.hypot(s._targetM.x - s.playerM.x, s._targetM.y - s.playerM.y), M * 0.2,
    'and on to the target');
});

test('detour: a target leaning a little off the line rounds the rock too', () => {
  // The same rock with the target a shade to one side — the lean picks the
  // first side, and the first jog carries the body across the target's line,
  // which is where the lean used to turn round and talk it back out.
  for (const off of [0.3, -0.3]) {
    const s = cave([[1, 0]], [0, 0], [10, 0]);
    s._targetM.y += off;
    run(s, 10);
    assert.eq(flips(s.sides), 0, `target ${off} m off the line: the side flipped`);
    assert.eq(s.sides[0], Math.sign(off), `target ${off} m off the line: the lean chose first`);
    assert.gt(s.playerM.x, 2 * M, `target ${off} m off the line: the body got past the rock`);
  }
});

test('detour: a held side wins over the lean, and lapses after DETOUR_COMMIT_MS', () => {
  // Open floor both sides of a rock east of the body. Hold the NORTH side
  // (-1), then ask with a heading that leans SOUTH (+y).
  const s = cave([[1, 0]], [0, 0], [10, 0]);
  s._detourHold = { fx: 1, fy: 0, side: -1, until: COMMIT_MS };
  clock.t = COMMIT_MS - 1;
  assert.eq(s._detourDir(0.99, 0.1).y, -1, 'a live hold keeps its side against the lean');
  assert.eq(s._detourHold.until, COMMIT_MS - 1 + COMMIT_MS, 'and using it re-stamps it');
  clock.t = s._detourHold.until + 1;
  assert.eq(s._detourDir(0.99, 0.1).y, 1, 'a lapsed hold hands the choice back to the lean');
});

test('detour: a hold on another heading axis is not reused', () => {
  // Committed to going round a wall heading EAST; now blocked heading SOUTH —
  // a different wall, which gets its own choice (the lean, here west).
  const s = cave([[0, 1]], [0, 0], [0, 10]);
  clock.t = 0;
  s._detourHold = { fx: 1, fy: 0, side: 1, until: COMMIT_MS };
  const d = s._detourDir(-0.1, 0.99);
  assert.eq(d.x, -1, 'heading south, the westward lean decides');
  assert.eq(d.y, 0, 'and the jog is across the new heading');
});

test('detour: a held side that has closed does not wall the body in', () => {
  // The held north side is solid now; the open south side is still offered.
  const s = cave([[1, 0], [0, -1]], [0, 0], [10, 0]);
  clock.t = 0;
  s._detourHold = { fx: 1, fy: 0, side: -1, until: COMMIT_MS };
  assert.eq(s._detourDir(1, 0).y, 1, 'the other side is taken');
  assert.eq(s._detourHold.side, 1, 'and becomes the new hold');
});

test('detour: a warp drops the hold with the target', () => {
  const src = lift('syncMoveTarget() {');
  assert.truthy(/this\._detourHold = null;/.test(src),
    'syncMoveTarget clears _detourHold — a side of a wall back where the body was');
});
})();
