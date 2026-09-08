// THE CHASE, RUN — not pinned as source text.
//
// The lair state machine (Lairs.guardState) is pure and lairs.test.js drives
// it directly. The loop that CONSUMES it is not: wanderCreatures is ~680 lines
// inside app.js, and when the chase shipped, every claim about the movement —
// that a guard leaves its seat, closes the distance, turns round at the leash,
// walks back and lands on its spot, and cannot bite on the way — was a regex
// against the source. A regex cannot tell you the guard actually moved.
//
// So this file runs the REAL method (run.js lifts it as __wander, constants
// and all) against a stub scene, ticking it the way update() does and reading
// the creature's position back. Everything here is behaviour, not text.
(function () {

const CELL = 7;                       // WorldGen.CELL_M
const AGGRO_M = Lairs.LAIR_AGGRO_CELLS * CELL;
const LEASH_M = Lairs.LAIR_LEASH_CELLS * CELL;

// A scene with one creature and nothing else in the world: no Home, no fires,
// no scarecrows, no rocks, all ground walkable. Everything wanderCreatures
// reaches for, and nothing it does not.
function mkScene(creature, over = {}) {
  const scene = Object.assign({
    cellM: CELL, depth: 0,
    // A deep bar by default. These are movement tests, and a goblin landing 8
    // damage every two seconds empties a hundred-point bar in half a minute —
    // at which point `unnoticed` fires (Combat.playerDowned) and the garrison
    // correctly stops chasing a body. Real behaviour, wrong experiment. The
    // bite test below sets its own bar.
    save: { energy: 1e6, caught: [], armor: {}, planted: [], fires: [], released: [] },
    startWorldM: { x: 0, y: 0 },
    playerM: { x: 0, y: 0 },
    // The projection coords.js needs for worldMetersToAbsCell (the placed-rock
    // lookup calls it on every candidate step). One cell = CELL metres, and
    // the origin is the world origin, so an abs cell is just wm / CELL.
    originPx: { x: 0, y: 0 }, mPerPx: CELL, cellsPerTile: WorldGen.TILE_PX,
    viewCenterX: 0, viewCenterY: 0,
    _shots: [],
    isShadowActive: () => false,
    // The one read for "no hostile takes an interest in the player" — a Shadow
    // Powder, or a bar run to zero (app.js isUnnoticed). Stubbed to the real
    // expression rather than a constant, so the test that switches notice off
    // (and any that accidentally kill the player) behave as the game does.
    isUnnoticed() { return this.isShadowActive() || Combat.playerDowned(this.save.energy); },
    homeWorldPos: () => null,                 // no Home: the ward is out of it
    playerToWorldCell: () => ({ tx: 0, ty: 0, ix: 0, iy: 0 }),
    cellAt: () => ({ loaded: true, type: 0 }),   // 0 = GRASS, walkable
    _cellBlocked: () => false,
    _nearAny: () => false,                    // no fires, no scarecrows
    placedRockSet: null,
    resolveDefeat: () => {},
    _popEnergy: () => {}, _warnIfTiring: () => {}, _flashPlayerHit: () => {},
    updateEnergyDOM: () => {}, flash: () => {}, _wildCrowTick: () => {},
  }, over);
  scene.creatures = [creature];
  return scene;
}

// wanderCreatures walks the world through WorldGen.forEachItemNear (the 3x3
// tile ring), so point both walkers at the scene's own list for the duration
// of a run. Note it is `Near` that drives the creature loop — stubbing only
// forEachItem gives a sim in which nothing ever moves and every assertion
// below passes for the wrong reason.
function tick(scene, ms) {
  const realForEach = WorldGen.forEachItem;
  const realNear = WorldGen.forEachItemNear;
  const realNow = performance.now;
  // ONE clock per scene, advanced by `ms` a tick. Re-reading the real clock
  // here would leave `now` standing still between ticks, and the movement
  // block only runs when its own `_nextChooseT` comes due — so nothing would
  // ever take a step and every assertion below would pass for the wrong
  // reason. (It did, the first time this file was written.)
  scene._simT = (scene._simT || 1e6) + ms;
  const t = scene._simT;
  const walk = (what, fn) => {
    if (what !== 'creatures') return;
    for (const c of scene.creatures) fn(c, 0, 0);
  };
  WorldGen.forEachItem = walk;
  WorldGen.forEachItemNear = (what, tx, ty, fn) => walk(what, fn);
  try {
    // One choose-step per call: the loop only picks a new target when its own
    // clock is due, so the sim advances in the cadence the game runs at.
    performance.now = () => t;
    __wander.call(scene);
  } finally {
    WorldGen.forEachItem = realForEach;
    WorldGen.forEachItemNear = realNear;
    performance.now = realNow;
  }
}

// A goblin garrison guard seated at (0,0), its ruin's centre at (0,0).
function mkGuard(over = {}) {
  return Object.assign({
    kind: 'goblin', id: 'lair_0_0_0', x: 0, y: 0,
    immobile: true, lair: '0_0', lairX: 0, lairY: 0, lairR: 0,
    seatX: 0, seatY: 0,
  }, over);
}
const distFromSeat = (g) => Math.hypot(g.x - g.seatX, g.y - g.seatY);
const distToPlayer = (g, s) => Math.hypot(g.x - s.playerM.x, g.y - s.playerM.y);

// Run `seconds` of game time, in frames. The tick MUST be well under a kind's
// own step cadence (STEP_MS / speed, five seconds for a goblin): the loop
// chooses a target and then LERPS onto it across later ticks, so a tick as
// long as the cadence re-chooses every time, leaves the interpolation at zero
// and moves nothing at all — which looks exactly like a guard that refuses to
// leave its seat. Ticking at a frame-ish rate is also what the game does.
const TICK_MS = 250;
function run(scene, seconds) {
  for (let i = 0; i < (seconds * 1000) / TICK_MS; i++) tick(scene, TICK_MS);
}
// A goblin covers STEP_M * 0.6 every STEP_MS / speed — about 0.84 m/s. Sizing
// the runs off that rather than off a step count keeps them readable.
const GOBLIN_MPS = (CELL * 0.6) / (5000 / MONSTERS.goblin.speed / 1000);

test('chase sim: a guard nobody is near does not move, ever', () => {
  const g = mkGuard();
  const scene = mkScene(g, { playerM: { x: 60 * CELL, y: 0 } });
  run(scene, 120);
  assert.eq(distFromSeat(g), 0, 'a garrison drifted off its ruin with nobody near it');
  assert.falsy(g._hunting, 'and it thinks it is hunting');
});

test('chase sim: the garrison LEAVES its seat and closes on the player', () => {
  const g = mkGuard();
  // Standing just inside the aggro ring, past the guard so it has to travel.
  const scene = mkScene(g, { playerM: { x: AGGRO_M - CELL, y: 0 } });
  const before = distToPlayer(g, scene);
  run(scene, 90);
  assert.truthy(g._hunting, 'the garrison never noticed the player');
  assert.gt(distFromSeat(g), CELL, 'it noticed and stayed put — it never left its seat');
  assert.lt(distToPlayer(g, scene), before - CELL,
    `it moved without closing: ${before.toFixed(1)}m → ${distToPlayer(g, scene).toFixed(1)}m`);
  // And it is a CHASE, not a wander: it ends up close enough to bite.
  assert.lt(distToPlayer(g, scene), 2 * CELL, 'it never actually reached the player');
});

test('chase sim: it never strays further than the leash from its ruin', () => {
  // With a real footprint radius, so this pins the bound that actually
  // applies: the rings are measured from the ruin's EDGE, so the reach from
  // its CENTRE is lairR + leash. A lairR of 0 would pin a tighter number than
  // the game ever enforces.
  const g = mkGuard({ lairR: 3 * CELL });
  // The player walks steadily away; the guard follows until the leash breaks.
  const scene = mkScene(g, { playerM: { x: 0, y: 0 } });
  let worst = 0;
  // The player walks off at a real 1.4 m/s — faster than a goblin's 0.84, so
  // this is the escape the design promises rather than a teleport.
  for (let i = 0; i < (300 * 1000) / TICK_MS; i++) {
    scene.playerM.x = Math.min(1.4 * (i * TICK_MS) / 1000, 200 * CELL);
    tick(scene, TICK_MS);
    worst = Math.max(worst, Math.hypot(g.x - g.lairX, g.y - g.lairY));
  }
  // The leash is measured from the ruin; the guard's own stride can carry it
  // one step past the moment it turns round, so allow that and no more.
  const stride = CELL * 0.6;
  assert.lte(worst, g.lairR + LEASH_M + stride + 1e-6,
    `a guard reached ${worst.toFixed(1)}m from its ruin, past the leash`);
  // And it really did chase — a test that never left the seat would pass the
  // bound above for the wrong reason.
  assert.gt(worst, 2 * CELL, 'the guard never moved, so the leash proved nothing');
});

test('chase sim: once the player is clear it WALKS HOME and lands on its seat', () => {
  const g = mkGuard();
  // Four cells off — inside the aggro ring, far enough that closing on it is
  // a real walk. A player standing ON the guard gives it nowhere to go.
  const scene = mkScene(g, { playerM: { x: 4 * CELL, y: 0 } });
  run(scene, 25);                                  // drag it off the seat
  assert.gt(distFromSeat(g), CELL, 'the guard never left its seat to begin with');
  const away = distFromSeat(g);
  // Past the leash (10 cells) but still inside the SIM BUBBLE
  // (CREATURE_SIM_CELLS, 12) — beyond the bubble nothing thinks at all, so a
  // guard would freeze mid-street instead of walking back. That the leash sits
  // inside the bubble is what makes the walk home happen at all; lairs.test.js
  // pins the relation.
  scene.playerM.x = 11 * CELL;
  run(scene, 200);
  assert.falsy(g._hunting, 'it is still hunting a player who left');
  assert.lt(distFromSeat(g), away, 'it gave up but did not come home');
  // Lands ON the seat, not near it: the shortened last step is what stops it
  // orbiting the spot forever.
  assert.lte(distFromSeat(g), Lairs.LAIR_SEAT_EPS_CELLS * CELL,
    `it settled ${distFromSeat(g).toFixed(2)}m from its seat instead of on it`);
  assert.eq(Lairs.guardState(g, { x: 60 * CELL, y: 0 }, CELL), 'hold', 'and it is at rest again');
  // Home for good: another forty steps must not move it.
  const rest = { x: g.x, y: g.y };
  run(scene, 120);
  assert.eq(Math.hypot(g.x - rest.x, g.y - rest.y), 0, 'it wandered off after settling');
});

test('chase sim: outrun far enough and it FREEZES mid-walk — then resumes', () => {
  // The one thing the trace showed that no source pin would have: a guard
  // walking home stops dead once the player passes CREATURE_SIM_CELLS (84m),
  // because wanderCreatures culls it and nothing thinks for it at all. That is
  // the ordinary frozen-outside-the-bubble rule every creature obeys, and it
  // is benign here for two reasons this test holds:
  //
  //   IT IS NEVER FROZEN IN VIEW. The bubble is outside the sprite cull, so by
  //   the time a returning guard stops it is already off screen.
  //   IT RESUMES, and never drifts. Coming back inside the bubble puts it
  //   straight back on the walk home; and if the player goes far enough for
  //   residency to sleep the garrison, the next wake re-seats it exactly where
  //   garrisonFor always puts it. There is no state that decays.
  const g = mkGuard();
  const scene = mkScene(g, { playerM: { x: 4 * CELL, y: 0 } });
  run(scene, 25);
  const away = distFromSeat(g);
  assert.gt(away, CELL, 'the guard never left its seat');
  // Well past the sim bubble: nothing runs for it.
  scene.playerM.x = 40 * CELL;
  run(scene, 200);
  const frozen = distFromSeat(g);
  assert.truthy(Math.abs(frozen - away) < 1e-9, 'something moved a creature outside the sim bubble');
  assert.gt(frozen, Lairs.LAIR_SEAT_EPS_CELLS * CELL, 'the fixture should leave it off its seat');
  // Frozen, but never where it can be seen frozen.
  const cullCornerM = (VIEW_CELLS / 2 + 1) * Math.SQRT2 * CELL;
  assert.gt(CREATURE_SIM_CELLS * CELL, cullCornerM,
    'a guard could freeze on screen — the bubble is inside the sprite cull');
  // Come back: it picks the walk home straight up and lands on its seat.
  scene.playerM.x = 11 * CELL;
  run(scene, 200);
  assert.lte(distFromSeat(g), Lairs.LAIR_SEAT_EPS_CELLS * CELL,
    'a guard that froze on its way home never started again');
});

test('chase sim: it does not bite on the walk home', () => {
  // The player escaped, and a guard still leeching on its way back would mean
  // they had not. Driven through the REAL leech: energy is the readout.
  const g = mkGuard({ kind: 'cave_slime' });
  const scene = mkScene(g, { playerM: { x: 0, y: 0 } });
  scene.save.energy = 400;                          // enough to survive the bites
  run(scene, 20);
  assert.lt(scene.save.energy, 400, 'a garrison standing on the player never bit it');
  // Now leave. The guard is off its seat and walking back; park the player far
  // enough out to break the leash but keep reading the bar.
  scene.save.energy = 400;
  scene.playerM.x = LEASH_M + 20 * CELL;
  run(scene, 200);
  assert.eq(scene.save.energy, 400, 'it bit the player on its way home');
});

test('chase sim: a campfire cannot freeze a guard walking home', () => {
  // The fire ward refuses a TARGET CELL, so a guard walking home past one used
  // to have all six attempts rejected and stall in the street — the scarecrow
  // stall, arriving through the ward that warns about it. `!c.lair` is what
  // exempts it, and this is that exemption RUN: _nearAny says every cell is
  // next to a fire, which would refuse every step a wild slime could pick.
  const g = mkGuard({ kind: 'cave_slime' });        // a kind the fire DOES ward
  const scene = mkScene(g, { playerM: { x: 4 * CELL, y: 0 }, _nearAny: () => true });
  run(scene, 40);
  assert.gt(distFromSeat(g), CELL, 'the fire ward froze a garrison on its own doorstep');
  scene.playerM.x = 11 * CELL;                     // past the leash, inside the bubble
  run(scene, 200);
  assert.lte(distFromSeat(g), Lairs.LAIR_SEAT_EPS_CELLS * CELL,
    'the fire ward stranded a guard on its way home');
});

test('chase sim: a player nobody can notice is not chased', () => {
  // Shadow Powder / a downed player (app.js `unnoticed`). The garrison loses
  // interest and walks home rather than milling about where they vanished.
  const g = mkGuard();
  const scene = mkScene(g, { playerM: { x: 4 * CELL, y: 0 } });
  run(scene, 25);
  assert.gt(distFromSeat(g), CELL, 'never left the seat');
  scene.isShadowActive = () => true;
  run(scene, 200);   // the player has not moved — it is the notice that went
  assert.falsy(g._hunting, 'it is hunting someone it cannot see');
  assert.lte(distFromSeat(g), Lairs.LAIR_SEAT_EPS_CELLS * CELL,
    'a shadowed player left the garrison standing in the street');
});

test('chase sim: the sim bubble is a HARD cut, and resuming does not snap', () => {
  // There is no grace on CREATURE_SIM_CELLS — one comparison per creature per
  // frame, no hysteresis, unlike the lair wake/sleep and aggro/leash pairs.
  // That is right, because being simmed only decides whether a creature MAY
  // take a step: a flicker at the boundary creates and destroys nothing, which
  // is exactly what the lair rings' hysteresis exists to prevent.
  //
  // The thing that would make it wrong is a SNAP. A step is a wall-clock lerp
  // (`u = (now - _stepT0) / _hopMs`), so a creature frozen mid-step has u
  // pinned at 1 by the time it is simmed again, and completing that stale step
  // would teleport it up to a full stride on the frame it resumes. It does not
  // happen, and only because the choose-step runs BEFORE the lerp and resets
  // _startX/_stepT0 — so the stale target is discarded rather than completed.
  // Reorder those two and the teleport is back, silently.
  const c = { kind: 'cow', id: 'cow_1', x: 0, y: 0 };
  const scene = mkScene(c, { playerM: { x: 3 * CELL, y: 0 } });
  run(scene, 50);
  // Catch it mid-stride.
  let frozen = null;
  for (let i = 0; i < 400 && !frozen; i++) {
    tick(scene, TICK_MS);
    const u = (scene._simT - c._stepT0) / (c._hopMs || 5000);
    if (u > 0.05 && u < 0.35) frozen = { x: c.x, y: c.y };
  }
  assert.truthy(frozen, 'never caught the creature mid-step — the fixture is wrong');
  // Out of the bubble: nothing thinks for it, so nothing moves it.
  scene.playerM.x = c.x + CREATURE_SIM_CELLS * CELL + 20;
  run(scene, 30);
  assert.eq(Math.hypot(c.x - frozen.x, c.y - frozen.y), 0,
    'something moved a creature outside the sim bubble');
  // Back in range: it picks a FRESH step from where it stands.
  scene.playerM.x = c.x;
  const before = { x: c.x, y: c.y };
  tick(scene, TICK_MS);
  const jumped = Math.hypot(c.x - before.x, c.y - before.y);
  const oneFrame = CELL * (TICK_MS / 5000);
  assert.lte(jumped, oneFrame + 1e-9,
    `resuming teleported the creature ${jumped.toFixed(2)}m — the stale step was completed`);
  // And the boundary is outside the sprite cull anyway, so none of it is ever
  // on screen: that margin is what buys the hard cut.
  assert.gt(CREATURE_SIM_CELLS * CELL, (VIEW_CELLS / 2 + 1) * Math.SQRT2 * CELL,
    'the sim bubble is inside the sprite cull — a freeze would be visible');
});

test('chase sim: an ordinary wild monster is untouched by any of it', () => {
  // The guard branches must not have changed how a normal cave monster moves:
  // no lair, no seat, no leash — it stalks and keeps stalking.
  // Inside the sim bubble (CREATURE_SIM_CELLS) or nothing thinks at all.
  const m = { kind: 'goblin', id: 'wild_1', x: 0, y: 0 };
  const scene = mkScene(m, { playerM: { x: 10 * CELL, y: 0 }, depth: 1 });
  const start = Math.hypot(m.x - scene.playerM.x, m.y - scene.playerM.y);
  run(scene, 60);
  assert.lt(Math.hypot(m.x - scene.playerM.x, m.y - scene.playerM.y), start - 5 * CELL,
    'a wild monster stopped hunting when the lair branches went in');
  assert.falsy(m._hunting, 'a wild monster picked up the lair hysteresis flag');
});

})();
