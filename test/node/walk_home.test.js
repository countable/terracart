// Walk-home timing (src/app.js WALK_HOME_IDLE_MS / WALK_HOME_HINT_IDLE_MS).
//
// Letting go of the movement stick starts a debounce; when it expires the
// character walks itself back to where the GPS says it really is, and a little
// later a dashed lead line appears pointing the way.
//
// The debounce has been wrong in both directions. At 3000 ms it read as the
// character ignoring you; chasing that it went to 700 ms and then 500 ms, which
// is a hair-trigger — players nudge themselves along in short pushes, and every
// beat between pushes started a return, so the character leaned back against
// the direction of travel all the way. 5000 ms is what playtesting settled on:
// past the longest natural gap between two deliberate pushes. These pin that
// shape so a later retune can't quietly reintroduce either failure.

test('walk home: the debounce outlasts an ordinary pause between stick pushes', () => {
  assert.gt(WALK_HOME_IDLE_MS, 3500,
    'below ~3.5s the character starts home between nudges — this is the 500ms bug');
  assert.lt(WALK_HOME_IDLE_MS, 8000,
    'above ~8s a player who has genuinely stopped is left waiting');
});

test('walk home: the hint never precedes the walk it is describing', () => {
  // The lead line says "on my way back there". If it can appear before the walk
  // starts, it is pointing at something that has not begun.
  assert.gt(WALK_HOME_HINT_IDLE_MS, WALK_HOME_IDLE_MS,
    'the hint must wait for the walk it announces');
});

test('walk home: the hint is still reachable on an ordinary return', () => {
  // A typical return covers its distance in a couple of seconds. If the hint's
  // delay sits far beyond the walk's, the walk finishes first and the hint is
  // effectively dead code — which is what happened when the walk dropped to
  // 700ms while the hint stayed at 5000ms.
  const lag = WALK_HOME_HINT_IDLE_MS - WALK_HOME_IDLE_MS;
  assert.lt(lag, 3000,
    'the hint lands so long after the walk starts that most returns end first');
  assert.gt(lag, 200, 'the hint should stay quieter than the walk, not simultaneous');
});

// ── The ramp ──────────────────────────────────────────────────────────────
// The debounce says WHEN the return starts; the ramp says how it starts. A flat
// switch-on is a cliff: whatever the timer is, the first frame past it yanks the
// character backwards at full walking pace. Easing in from nothing means a push
// that lands just after the timer expires gives up almost no ground, while a
// real stop still gets home at walking pace — so the timer can be generous
// without the return feeling like a lurch when it finally fires.

test('walk home: the return eases in rather than switching on at full pace', () => {
  assert.gt(WALK_HOME_RAMP_MS, 600,
    'too short a ramp is a cliff again — the character lurches back between nudges');
  assert.lt(WALK_HOME_RAMP_MS, 2500,
    'too long a ramp and a genuine stop crawls home');
});

test('walk home: a pause that outlasts the debounce still costs almost nothing', () => {
  // What the player actually gives up if the debounce expires and they push
  // again. The ramp is squared, so ground lost over an overshoot of `ms` past
  // the timer is the integral of t^2 — a fraction of what a flat return would
  // have taken.
  const lost = (ms) => {
    const t = Math.min(1, Math.max(0, ms - WALK_HOME_IDLE_MS) / WALK_HOME_RAMP_MS);
    return (t ** 3) / 3;            // ∫t² dt, in units of ramp-length × full speed
  };
  const flat = (ms) => Math.max(0, ms - WALK_HOME_IDLE_MS) / WALK_HOME_RAMP_MS;
  // 400ms past the debounce — a push that lands just too late to hold it off.
  const ms = WALK_HOME_IDLE_MS + 400;
  assert.lt(lost(ms), flat(ms) * 0.25,
    'a push just past the debounce should cost a fraction of what a flat return would');
});

test('walk home: once it starts, the return is not a crawl', () => {
  // The debounce is deliberately generous, so everything after it has to feel
  // decisive: full walking pace within a couple of seconds of the walk starting.
  assert.lt(WALK_HOME_RAMP_MS, 2000,
    'full walking pace should arrive within a couple of seconds of the walk starting');
});

// ── Too far to walk ───────────────────────────────────────────────────────
// The return's DISTANCE, not its timing. Everything above tunes a walk; these
// pin the case where walking is the wrong answer at all.
//
// A high-tier amulet moves the stick tens of metres a second, so a few seconds
// of steering puts the character half a kilometre from the player's real
// position. The body chases at DEBUG_SPEED_MUL x walk pace at best (14 m/s),
// which makes that return the better part of a minute of watching a character
// walk in a straight line — with the stick unusable under it, because grabbing
// it just starts the whole debounce again.
//
// The GPS fix path already had the answer: past GPS_SNAP_M a jumped fix PLACES
// the body rather than walking it, because that far is travel the player never
// made on foot. The gap is the same gap whichever side opened it, so the walk
// home reads the same constant. These tests drive the real _driftHome (lifted
// out of src/app.js by run.js) rather than a copy of its arithmetic.

// A scene stub with only what _driftHome touches. `awayM` places the body that
// far east of the fix; the stick has been idle long enough for the return to
// have started.
function walkHomeScene(awayM, opts = {}) {
  return {
    depth: opts.depth ?? 0,
    gpsM: opts.noGps ? null : { x: 0, y: 0 },
    playerM: { x: awayM, y: 0 },
    _manualOffsetM: { x: opts.offset ?? awayM, y: 0 },
    _targetM: { x: awayM, y: 0 },
    _gpsManualOverride: false,
    _workProgress: null,
    // The wheel gate reads _busyWheel (an AUTO wheel — auto-mining — doesn't
    // count as busy), so the stub answers the same question the scene does.
    _busyWheel() { const wp = this._workProgress; return (wp && !wp.auto) ? wp : null; },
    _stickPushed: () => false,
    _walkRelics: () => [],
    _lastStickT: Date.now() - (opts.idleMs ?? (WALK_HOME_IDLE_MS + WALK_HOME_RAMP_MS + 500)),
    _steerDistAccrue: 0,
    _steerCostAccrue: 0,
    _followPaused: false,
    _driftingHome: false,
    _gpsAwayM: __walkHome._gpsAwayM,
    syncMoveTarget: __walkHome.syncMoveTarget,
    _placeBodyOnFix: __walkHome._placeBodyOnFix,
    _carveLanding: __walkHome._carveLanding,
    // What the placement's landing carve reads: the cell under the feet. The
    // surface never asks; underground `landing` says what the fix stands in
    // (25 = CAVE_WALL) and `dug` records what the shipping dig was told.
    startWorldM: { x: 0, y: 0 },
    feetOffsetM: 0,
    cellsPerTile: 16,
    cellAt: () => ({ tx: 3, ty: 4, ix: 5, iy: 6, loaded: opts.landing != null,
                     type: opts.landing ?? 0 }),
    dug: [],
    digCaveWall(tx, ty, ix, iy, cellIX, cellIY) { this.dug.push([tx, ty, ix, iy, cellIX, cellIY]); },
    // A warp snaps the peek camera home; this scene never peeks (no peekM), so
    // the real method early-outs — it just has to be here to be called.
    clearPeek: __walkHome.clearPeek,
  };
}
const drift = (scene, dt = 1 / 60) => __walkHome._driftHome.call(scene, dt);

test('walk home: a half-kilometre return is instant, not a trudge', () => {
  const scene = walkHomeScene(500);
  drift(scene);
  assert.eq(Math.round(__walkHome._gpsAwayM.call(scene)), 0,
    'the body should be standing on the fix after one frame, not walking toward it');
  assert.eq(Math.hypot(scene._manualOffsetM.x, scene._manualOffsetM.y), 0,
    'the stick offset has to go with it, or the body walks straight back off');
});

test('walk home: the instant return uses the same gap the GPS fix path snaps on', () => {
  const near = walkHomeScene(GPS_SNAP_M - 1);
  drift(near);
  assert.gt(__walkHome._gpsAwayM.call(near), 1,
    `inside ${GPS_SNAP_M}m the return is still a walk — a fix at this range doesn't snap either`);
  const far = walkHomeScene(GPS_SNAP_M + 1);
  drift(far);
  assert.eq(Math.round(__walkHome._gpsAwayM.call(far)), 0,
    `past ${GPS_SNAP_M}m it is placed, exactly as a jumped fix would be`);
});

test('walk home: an ordinary stroll off the GPS is still walked', () => {
  // The whole feel of the stick is that you can step off your real position and
  // stroll back. A snap threshold low enough to catch that would replace the
  // walk home with a rubber band.
  const scene = walkHomeScene(30);
  drift(scene);
  // The walk moves the OFFSET (and drags the target with it); the body follows
  // in _followStep, so it is still standing where it was after one frame — that
  // it hasn't been placed on the fix is the whole point here.
  assert.eq(scene.playerM.x, 30, 'a 30m return must not warp the body');
  const off = Math.hypot(scene._manualOffsetM.x, scene._manualOffsetM.y);
  assert.lt(off, 30, 'the offset should be bleeding off');
  assert.gt(off, 15, 'one frame of a 30m return should not cover half of it');
  assert.eq(scene._driftingHome, true, 'this is a walk, so the hint should know about it');
});

test('walk home: distance decides HOW the return is made, never when it starts', () => {
  // Mid-push (inside the debounce) nothing returns, however big the gap. A warp
  // that ignored the debounce would be the 500ms hair-trigger bug with a
  // teleport on the end.
  const scene = walkHomeScene(500, { idleMs: WALK_HOME_IDLE_MS - 500 });
  drift(scene);
  assert.eq(Math.round(__walkHome._gpsAwayM.call(scene)), 500,
    'the debounce still owns when the return begins');
});

// ── Underground ───────────────────────────────────────────────────────────
// Until Sep 2026 the walk home was surface-only, so a stick walk down a cave
// parked the character that far off the GPS for good: every later fix
// re-targeted fix + offset and nothing ever bled the offset away. The one real
// reason to keep it out of the caves was the far snap dropping the body inside
// solid rock; the placement now carves its landing cell instead.

test('walk home: underground the offset bleeds just as it does on the surface', () => {
  const scene = walkHomeScene(30, { depth: 2, landing: 24 });
  drift(scene);
  assert.lt(Math.hypot(scene._manualOffsetM.x, scene._manualOffsetM.y), 30,
    'a cave walk home has to close the gap the stick opened');
  assert.truthy(scene._driftingHome, 'and it counts as walking home');
  assert.eq(scene.dug.length, 0, 'a walked return digs nothing');
});

test('walk home: underground a half-kilometre return is placed, same as the surface', () => {
  const scene = walkHomeScene(500, { depth: 2, landing: 24 /* CAVE_FLOOR */ });
  drift(scene);
  assert.eq(Math.round(__walkHome._gpsAwayM.call(scene)), 0,
    'the body should be standing on the fix after one frame');
  assert.eq(scene.dug.length, 0, 'landing on open floor digs nothing');
});

test('walk home: a body placed into rock has its landing cell carved', () => {
  const scene = walkHomeScene(500, { depth: 2, landing: 25 /* CAVE_WALL */ });
  drift(scene);
  assert.eq(Math.round(__walkHome._gpsAwayM.call(scene)), 0, 'placed on the fix');
  assert.eq(scene.dug.length, 1, 'the wall under the feet is dug out — never a body inside rock');
  assert.eq(scene.dug[0].join(','), '3,4,5,6,53,70',
    'through the shipping digCaveWall with the absolute cell (tx*N+ix, ty*N+iy)');
});

test('walk home: a placement onto an unloaded tile carves once the grid lands', () => {
  // "Too far" usually means the tile under the fix isn't loaded yet, so the
  // snap can't know what it landed in. The tile loader re-asks per cave tile,
  // scoped to the tile that just arrived.
  const scene = walkHomeScene(500, { depth: 2 });   // landing: unloaded
  drift(scene);
  assert.eq(scene.dug.length, 0, 'nothing to carve while the cell is unknown');
  scene.cellAt = () => ({ tx: 3, ty: 4, ix: 5, iy: 6, loaded: true, type: 25 });
  __walkHome._carveLanding.call(scene, { tx: 9, ty: 9 });
  assert.eq(scene.dug.length, 0, 'a different tile arriving is not the one under the feet');
  __walkHome._carveLanding.call(scene, { tx: 3, ty: 4 });
  assert.eq(scene.dug.length, 1, 'the tile under the feet arriving carves the pocket');
  scene.depth = 0;
  __walkHome._carveLanding.call(scene);
  assert.eq(scene.dug.length, 1, 'the surface never digs');
});

// ── Pace ──────────────────────────────────────────────────────────────────
// The return is a little brisker than the stick walk that opened the gap: the
// player has stopped and is watching a gap they didn't ask for close, so it
// should read as purposeful — but it is still a walk, not a run.

test('walk home: the return is brisker than a stick walk, but still a walk', () => {
  assert.gt(WALK_HOME_SPEED_MUL, 1, 'the walk home should outpace the stroll that opened the gap');
  assert.lt(WALK_HOME_SPEED_MUL, 2, 'double pace reads as running, not walking home');
});

test('walk home: once the ramp is at full, the offset bleeds at the brisker pace', () => {
  // Idle long past the ramp: one frame should close exactly one frame of the
  // stick pace (WALK_M_S × steerSpeedMul, no amulet here) × WALK_HOME_SPEED_MUL
  // — the multiplier is applied to the return itself, not just declared.
  const dt = 1 / 60;
  const scene = walkHomeScene(30);
  drift(scene, dt);
  const off = Math.hypot(scene._manualOffsetM.x, scene._manualOffsetM.y);
  const perFrame = WALK_M_S * steerSpeedMul(scene._walkRelics()) * WALK_HOME_SPEED_MUL * dt;
  assert.lt(Math.abs((30 - off) - perFrame), 1e-6,
    `one full-pace frame should bleed ${perFrame.toFixed(4)}m, got ${(30 - off).toFixed(4)}m`);
});

// ── The countdown on the stick ────────────────────────────────────────────
// Let go of the stick and the cap shows the seconds until the character walks
// itself back. It reads the same gates as _driftHome (lifted alongside it by
// run.js), so the number is only ever shown for a walk that will happen.

test('walk home countdown: counts whole seconds down from the moment the stick is released', () => {
  const at = (idleMs) => __walkHome._walkHomeCountdownS.call(walkHomeScene(30, { idleMs }));
  assert.eq(at(0), Math.ceil(WALK_HOME_IDLE_MS / 1000), 'the full count the instant you let go');
  assert.eq(at(1000), Math.ceil((WALK_HOME_IDLE_MS - 1000) / 1000), 'one second later, one less');
  assert.eq(at(WALK_HOME_IDLE_MS - 100), 1, 'the last fraction of a second still reads 1, never 0');
  assert.eq(at(WALK_HOME_IDLE_MS), null, 'gone the moment the walk starts');
  assert.eq(at(WALK_HOME_IDLE_MS + 5000), null, 'and stays gone while it walks');
});

test('walk home countdown: only shown when there is a walk to count down to', () => {
  const idleMs = 1000;
  const count = (opts, patch) => {
    const scene = Object.assign(walkHomeScene(30, { idleMs, ...opts }), patch || {});
    return __walkHome._walkHomeCountdownS.call(scene);
  };
  assert.truthy(count({}) > 0, 'baseline: off the GPS, stick released → counting');
  assert.eq(count({ offset: 0 }), null, 'standing on the fix: nothing to walk back');
  assert.eq(count({}, { _stickPushed: () => true }), null, 'stick still pushed: no walk pending');
  assert.eq(count({}, { _workProgress: { auto: false } }), null, 'mid-wheel: busy, not idle');
  assert.truthy(count({ depth: 2 }) > 0, 'underground the walk home is the same promise');
  assert.eq(count({ noGps: true }), null, 'no fix driving: nothing to return to');
  assert.eq(count({}, { _gpsManualOverride: true }), null, 'keyboard takeover owns the target');
});

test('walk home: a body lagging behind a spent offset is still brought home', () => {
  // The offset bleeds at stick pace while the body chases at DEBUG_SPEED_MUL x
  // walk pace, so the offset can reach zero with the body hundreds of metres
  // behind it. Measuring the gap by the OFFSET would call that return finished
  // and leave the player watching the last 400m on foot.
  const scene = walkHomeScene(400, { offset: 0 });
  drift(scene);
  assert.eq(Math.round(__walkHome._gpsAwayM.call(scene)), 0,
    'the gap is body-to-fix, not whatever is left of the stick offset');
});
