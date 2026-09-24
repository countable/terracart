// A FOE WANDERS OFF NOW AND THEN — so none piles up against a campfire ring.
//
// A slime refused at a lit fire's ring (the fire ward refuses its target
// CELLS) keeps stalking the player standing inside it, gets every hop toward
// them refused, and stands on the ring's edge. Over a long rest they pile up.
// Every few minutes (WANDER_OFF_MIN_MS + random × WANDER_OFF_SPREAD_MS of time
// spent thinking) each wild foe turns its back and walks out to the edge of its
// range — the sim bubble, CREATURE_SIM_CELLS, since a foe has no notice radius
// of its own — times a random [1, WANDER_OFF_MAX_MUL]. It does not bite on the
// way, and WANDER_OFF_TIMEOUT_MS ends it if it cannot arrive.
//
// It is a new REASON in existing lanes, not a mover of its own: `standDown`
// (the attack gates), `routed` (the flee pace Home's rout runs at) and one
// more away-angle branch in the chain every step shares. The schedule itself
// is the top-level helper monsterWanderingOff, lifted by run.js as
// __monsterWanderingOff; the loop is the REAL wanderCreatures (__wander).
(function () {
const app = APP_JS_SRC;
const numOf = (name) => {
  const m = app.match(new RegExp(`\\nconst ${name} = ([-\\d.]+);`));
  if (!m) throw new Error(`no const ${name} in app.js`);
  return +m[1];
};
const MIN_MS = numOf('WANDER_OFF_MIN_MS');
const SPREAD_MS = numOf('WANDER_OFF_SPREAD_MS');
const MAX_MUL = numOf('WANDER_OFF_MAX_MUL');
const TIMEOUT_MS = numOf('WANDER_OFF_TIMEOUT_MS');
const TICK_CAP_MS = numOf('WANDER_OFF_TICK_CAP_MS');
const SIM_CELLS = numOf('CREATURE_SIM_CELLS');

const withRandom = (value, fn) => {
  const real = Math.random;
  Math.random = () => value;
  try { return fn(); } finally { Math.random = real; }
};

test('wander-off: every two to five minutes, rerolled per foe', () => {
  assert.eq(MIN_MS, 2 * 60 * 1000, 'no sooner than two minutes');
  assert.eq(MIN_MS + SPREAD_MS, 5 * 60 * 1000, 'no later than five');
  assert.eq(MAX_MUL, 2, 'how far it goes is randomised by up to 2×');
  assert.gt(TIMEOUT_MS, 0, 'it has a timeout');
  assert.lt(TIMEOUT_MS, MIN_MS, 'and the timeout is shorter than the gap between wander-offs');
});

test('wander-off: the schedule counts time spent THINKING, rolled in [MIN, MIN+SPREAD]', () => {
  const W = __monsterWanderingOff;
  for (const [r, due] of [[0, MIN_MS], [0.999999, MIN_MS + SPREAD_MS * 0.999999]]) {
    const c = { kind: 'slime' };
    let t = 1e6;
    withRandom(r, () => {
      assert.falsy(W(c, t, 0, 7), 'not on its first tick');
      assert.truthy(c._wanderOffInMs >= MIN_MS && c._wanderOffInMs <= MIN_MS + SPREAD_MS,
        'rolled inside the window');
      // Just short of due: still hunting.
      while (t < 1e6 + due - 2 * TICK_CAP_MS) { t += 250; assert.falsy(W(c, t, 0, 7), 'not yet'); }
      // A long gap (frozen out of the bubble) counts for no more than the cap.
      const left = c._wanderOffInMs;
      assert.falsy(W(c, t + 3600e3, 0, 7), 'an hour frozen does not trip it');
      assert.eq(left - c._wanderOffInMs, TICK_CAP_MS, 'the gap is capped');
      t += 3600e3;
      let started = false;
      for (let i = 0; i < 20 && !started; i++) { t += 250; started = W(c, t, 0, 7); }
      assert.truthy(started, 'and it goes once the schedule runs out');
    });
  }
});

test('wander-off: out to the edge of its range × [1, 2], ends on arrival or timeout', () => {
  const W = __monsterWanderingOff;
  const CELL = 7, RANGE = SIM_CELLS * CELL;
  const start = (r) => {
    const c = { kind: 'slime', _wanderOffInMs: 1, _wanderOffSimT: 1e6 };
    withRandom(r, () => assert.truthy(W(c, 1e6 + 250, 0, CELL), 'starts'));
    return c;
  };
  const near = start(0), far = start(0.999999);
  assert.inRange(near._wanderOffDistM, RANGE - 1e-6, RANGE + 1e-6, 'at least the edge of its range');
  assert.inRange(far._wanderOffDistM, RANGE * MAX_MUL - 1e-3, RANGE * MAX_MUL, 'at most twice it');
  // Arrival ends it and schedules the next one.
  assert.truthy(W(near, 1e6 + 500, RANGE - 1, CELL), 'still going short of the mark');
  assert.falsy(W(near, 1e6 + 750, RANGE + 0.01, CELL), 'arrived: back to normal');
  assert.eq(near._wanderOffUntilT, null, 'the wander-off is over');
  assert.truthy(near._wanderOffInMs >= MIN_MS - TICK_CAP_MS, 'and the next one is minutes away');
  // The timeout ends it however far it got.
  assert.truthy(W(far, 1e6 + TIMEOUT_MS - 1, 0, CELL), 'still going before the timeout');
  assert.falsy(W(far, 1e6 + 250 + TIMEOUT_MS, 0, CELL), 'gives up at the timeout');
});

test('wander-off: one more reason in the lanes that exist, not a lane of its own', () => {
  const start = app.indexOf('  wanderCreatures() {');
  const w = app.slice(start, app.indexOf('\n  }\n', start));
  assert.truthy(/const wanderOff = !isTame && !c\.lair && Combat\.isEnemy\(c\)\s*&& monsterWanderingOff\(/.test(w),
    'only a wild, non-lair enemy wanders off');
  assert.truthy(/const standDown = homeWard \|\| wanderOff \|\| /.test(w),
    'while it goes it does not leech, hit, shoot or charge (standDown)');
  assert.truthy(/const routed = homeWard \|\| wanderOff;/.test(w), 'it runs at the rout pace');
  const ward = w.indexOf('} else if (homeWard) {');
  const off = w.indexOf('} else if (wanderOff) {');
  const slime = w.indexOf("} else if (c.kind === 'slime') {");
  const mon = w.indexOf('} else if (isMon) {');
  assert.gt(off, ward, "Home's ward outranks it");
  assert.lt(off, slime, 'it outranks the slime\'s stalk');
  assert.lt(off, mon, 'and the monsters\' stalk');
  const branch = w.slice(off, w.indexOf('} else if', off + 5));
  assert.truthy(/angle = Math\.atan2\(c\.y - py, c\.x - px\)/.test(branch), 'away from the player');
  assert.falsy(/continue;/.test(branch), 'an angle, never a refused cell');
});

// ── Ticked for real: a slime piled against a campfire the player sits at ──
const CELL = 7;
const TICK_MS = 250;
const FIRE = { x: 0, y: 0 };
function fireScene(creature, over = {}) {
  const scene = Object.assign({
    cellM: CELL, depth: 0,
    save: { energy: 100, caught: [], armor: {}, planted: [], fires: [], released: [] },
    startWorldM: { x: 0, y: 0 }, playerM: { x: 0, y: 0 },
    originPx: { x: 0, y: 0 }, mPerPx: CELL, cellsPerTile: WorldGen.TILE_PX,
    viewCenterX: 0, viewCenterY: 0, _shots: [],
    isShadowActive: () => false,
    isUnnoticed() { return this.isShadowActive() || Combat.playerDowned(this.save.energy); },
    homeWorldPos: () => null,
    playerToWorldCell: () => ({ tx: 0, ty: 0, ix: 0, iy: 0 }),
    cellAt: () => ({ loaded: true, type: 0 }),
    _cellBlocked: () => false,
    // The fire at the player's feet refuses every cell within 4 of it.
    _nearAny: (what, x, y, r) => what === 'fires' && Math.hypot(x - FIRE.x, y - FIRE.y) <= r * CELL,
    placedRockSet: null, resolveDefeat: () => {},
    _popEnergy: () => {}, _warnIfTiring: () => {}, _flashPlayerHit: () => {},
    updateEnergyDOM: () => {}, flash: () => {}, _wildCrowTick: () => {},
  }, over);
  scene.creatures = [creature];
  return scene;
}
function tick(scene, ms) {
  const realForEach = WorldGen.forEachItem, realNear = WorldGen.forEachItemNear, realNow = performance.now;
  scene._simT = (scene._simT || 1e6) + ms;
  const t = scene._simT;
  const walk = (what, fn) => { if (what === 'creatures') for (const c of scene.creatures) fn(c, 0, 0); };
  WorldGen.forEachItem = walk;
  WorldGen.forEachItemNear = (what, tx, ty, fn) => walk(what, fn);
  try { performance.now = () => t; __wander.call(scene); }
  finally { WorldGen.forEachItem = realForEach; WorldGen.forEachItemNear = realNear; performance.now = realNow; }
}
const run = (scene, s) => { for (let t = 0; t < s * 1000; t += TICK_MS) tick(scene, TICK_MS); };
const cells = (c) => Math.hypot(c.x, c.y) / CELL;

test('wander-off sim: a slime piled on the fire ring stays there, then leaves', () => {
  const slime = { kind: 'slime', id: 'slime_fire_1', x: 4.5 * CELL, y: 0 };
  const scene = fireScene(slime);
  run(scene, 60);
  assert.lt(cells(slime), 7, 'the control: a minute in, it is still hanging on the ring');
  // Bring its wander-off due, and watch it go.
  slime._wanderOffInMs = 1;
  run(scene, TIMEOUT_MS / 1000);
  assert.gt(cells(slime), SIM_CELLS - 1.5, 'it walked out to the edge of its range');
});

test('wander-off sim: it does not bite on the way, even starting in contact', () => {
  const slime = { kind: 'slime', id: 'slime_fire_2', x: 0.5 * CELL, y: 0,
    _wanderOffInMs: 1, _wanderOffSimT: 1e6 };   // due on the first tick
  const scene = fireScene(slime, { _nearAny: () => false });
  run(scene, 30);
  assert.eq(scene.save.energy, 100, 'not one point of the bar while it wanders off');
  assert.gt(cells(slime), 4, 'and it did leave');
});

test('wander-off sim: a pet never wanders off its owner', () => {
  const pet = { kind: 'slime', id: 'released_slime_1757000000000_1', x: CELL, y: 0, _wanderOffInMs: 1 };
  run(fireScene(pet, { _nearAny: () => false }), 1);
  assert.eq(pet._wanderOffUntilT, undefined, 'the schedule never even runs for a pet');
});

test('wander-off: each kind retreats its own fraction of the range (default a full retreat)', () => {
  assert.eq(Combat.retreatMul('slime'), 1, 'the surface slime: full retreat');
  assert.eq(Combat.retreatMul('cave_slime'), 1, 'a kind with no retreat column: full');
  assert.eq(Combat.retreatMul('goblin'), 0.5, 'a goblin goes half as far — and comes back');
  assert.eq(Combat.retreatMul('giant_goblin'), 0.5, 'a giant inherits its base kind');
  assert.eq(Combat.retreatMul('purple_slime'), 0.75);
  const W = __monsterWanderingOff;
  const CELL = 7, RANGE = SIM_CELLS * CELL;
  const c = { kind: 'goblin', _wanderOffInMs: 1, _wanderOffSimT: 1e6 };
  withRandom(0, () => assert.truthy(W(c, 1e6 + 250, 0, CELL), 'starts'));
  assert.inRange(c._wanderOffDistM, RANGE * 0.5 - 1e-6, RANGE * 0.5 + 1e-6, 'range × retreat × 1');
  assert.truthy(/Combat\.retreatMul\(c\.kind\)/.test(APP_JS_SRC), 'the distance reads the kind\'s row');
});

})();
