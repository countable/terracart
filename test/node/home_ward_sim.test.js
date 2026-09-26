// THE WARD, RUN — a slime driven off the doorstep, ticked for real.
//
// home_ward.test.js pins the ward as SOURCE TEXT, because the branch lives
// inside wanderCreatures and a regex was all there was. A regex cannot tell
// you the foe actually left: for months the ward read correctly and behaved
// badly, because it was a bare radius test (a turnstile — out at four cells,
// unwarded, straight back in) driven at the kind's own amble (0.45 cells every
// 7.5 s, so a minute of oozing just to clear the ring). Both bugs are
// invisible to a source pin and obvious after ten seconds of simulation.
//
// So this file runs the REAL method (run.js lifts it as __wander) against the
// same stub scene lair_chase_sim.test.js uses, with Home switched ON.
(function () {

const CELL = 7;                        // WorldGen.CELL_M
const HOME = { x: 0, y: 0 };           // the trailer, at the origin
const TICK_MS = 250;                   // well under any kind's step cadence

// The world: Home at the origin, the player standing on it, one slime, and
// nothing else — no fires, no scarecrows, no rocks, all ground walkable.
function wardScene(creature, over = {}) {
  const scene = Object.assign({
    cellM: CELL, depth: 0,
    save: { energy: 1e6, caught: [], armor: {}, planted: [], fires: [], released: [] },
    startWorldM: { x: 0, y: 0 },
    playerM: { x: 0, y: 0 },
    originPx: { x: 0, y: 0 }, mPerPx: CELL, cellsPerTile: WorldGen.TILE_PX,
    viewCenterX: 0, viewCenterY: 0,
    _shots: [],
    isShadowActive: () => false,
    isUnnoticed() { return this.isShadowActive() || Combat.playerDowned(this.save.energy); },
    homeWorldPos: () => HOME,                 // the ward is ON
    _castleWardPoints: () => [],              // no claimed castle near
    playerToWorldCell: () => ({ tx: 0, ty: 0, ix: 0, iy: 0 }),
    cellAt: () => ({ loaded: true, type: 0 }),   // 0 = GRASS, walkable
    _cellBlocked: () => false,
    _nearAny: () => false,
    placedRockSet: null,
    resolveDefeat: () => {},
    _popEnergy: () => {}, _warnIfTiring: () => {}, _flashPlayerHit: () => {}, _closeShopOnHit: () => {},
    _losePlayerEnergy(d) { const b = this.save.energy ?? 0; this.save.energy = Math.max(0, b - d); return b - this.save.energy; },
    updateEnergyDOM: () => {}, flash: () => {}, _wildCrowTick: () => {},
  }, over);
  scene.creatures = [creature];
  return scene;
}

// Same harness as lair_chase_sim: one clock per scene, both tile walkers
// pointed at the scene's own list. `Near` is the one the creature loop uses.
function tick(scene, ms) {
  const realForEach = WorldGen.forEachItem;
  const realNear = WorldGen.forEachItemNear;
  const realNow = performance.now;
  scene._simT = (scene._simT || 1e6) + ms;
  const t = scene._simT;
  const walk = (what, fn) => {
    if (what !== 'creatures') return;
    for (const c of scene.creatures) fn(c, 0, 0);
  };
  WorldGen.forEachItem = walk;
  WorldGen.forEachItemNear = (what, tx, ty, fn) => walk(what, fn);
  try {
    performance.now = () => t;
    __wander.call(scene);
  } finally {
    WorldGen.forEachItem = realForEach;
    WorldGen.forEachItemNear = realNear;
    performance.now = realNow;
  }
}
const run = (scene, seconds) => {
  for (let t = 0; t < seconds * 1000; t += TICK_MS) tick(scene, TICK_MS);
};
// A wild slime on the doormat: one cell from Home, well inside HOME_R.
const mkSlime = (over = {}) => Object.assign({
  kind: 'slime', id: 'slime_ward_1', x: CELL, y: 0,
}, over);
const fromHome = (c) => Math.hypot(c.x - HOME.x, c.y - HOME.y) / CELL;

test('ward: a slime on the doormat is out of the ring in seconds, not minutes', () => {
  // The pace half. At the kind's own amble this took about a minute, which is
  // long enough that the player watching it decides the ward is broken.
  const slime = mkSlime();
  const scene = wardScene(slime);
  let clearedAt = null;
  for (let t = 0; t < 60000 && clearedAt == null; t += TICK_MS) {
    tick(scene, TICK_MS);
    if (fromHome(slime) > HOME_R) clearedAt = t / 1000;
  }
  assert.truthy(clearedAt != null, 'it leaves the ring at all');
  assert.lt(clearedAt, 20, `out of the ring in ${clearedAt}s — a wait the player can watch`);
});

test('ward: it keeps going to the bubble instead of bobbing on the doorstep', () => {
  // The latch half, and the bug the player actually reported: with a bare
  // radius test the foe crossed HOME_R, stopped being warded, and turned
  // straight back around — so it lived in the doorway, in and out of the same
  // three cells, forever. Run a minute and a half and look at where it is.
  const slime = mkSlime();
  const scene = wardScene(slime);
  run(scene, 90);
  assert.gt(fromHome(slime), CREATURE_SIM_CELLS - 1,
    'it ran the whole way out, not to the ring and back');
  // And it is out there because it is FROZEN, which is what "gone" means in a
  // world simulated one bubble at a time: past the cull it takes no more steps.
  const wasX = slime.x, wasY = slime.y;
  run(scene, 60);
  assert.eq(slime.x, wasX, 'frozen past the sim bubble, not orbiting the ring');
  assert.eq(slime.y, wasY, 'and it stays where it stopped');
});

test('ward: it never turns back inside the ring on the way out', () => {
  // Sampled every tick, not just at the end: an oscillation that happened to
  // finish outside would pass the test above and still be the reported bug.
  const slime = mkSlime();
  const scene = wardScene(slime);
  let peak = 0, dips = 0;
  for (let t = 0; t < 90000; t += TICK_MS) {
    tick(scene, TICK_MS);
    const d = fromHome(slime);
    if (d > peak) peak = d;
    if (peak > HOME_R && d <= HOME_R) dips++;
  }
  assert.eq(dips, 0, 'once it is out of the ring it never comes back into it');
});

test('ward: it cannot bite on the way out — the whole way out', () => {
  // A ward that let a slime leech its way to the door would make the doorstep
  // no safer, only slower to lose the bar on. The player stands ON Home with
  // the slime in contact, which is the worst case the leech has.
  const slime = mkSlime({ x: 0, y: 0 });
  const scene = wardScene(slime, { save: {
    energy: 100, caught: [], armor: {}, planted: [], fires: [], released: [] } });
  run(scene, 90);
  assert.eq(scene.save.energy, 100, 'not one point of the bar, at any distance');
});

test('ward: no Home, no ward — the same slime hangs around the player', () => {
  // The control. If the slime wandered off on its own this file would be
  // measuring nothing at all, so run the identical scene with Home switched
  // off: it stays about the player, meandering, the way a pest does.
  const slime = mkSlime();
  const scene = wardScene(slime, { homeWorldPos: () => null });
  run(scene, 90);
  assert.lt(fromHome(slime), CREATURE_SIM_CELLS - 1,
    'without Home there is nothing driving it off');
});

// A CASTLE YOU CLAIMED wards like Home: the same latch and rout, from the
// turret the foe strayed near. Home switched OFF, one claimed turret at the
// origin where Home stood.
test('ward: a claimed castle routs a foe the way Home does', () => {
  const slime = mkSlime();
  const tower = { kind: 'tower', castle: 'castle_1', x: 0, y: 0 };
  const scene = wardScene(slime, { homeWorldPos: () => null, _castleWardPoints: () => [tower] });
  run(scene, 90);
  assert.gt(fromHome(slime), CREATURE_SIM_CELLS - 1, 'it ran the whole way out from the turret');
});

test('ward: a goblin runs from a claimed castle too', () => {
  const gob = { kind: 'goblin', id: 'mon_ward_gob', x: CELL, y: 0 };
  const tower = { kind: 'tower', castle: 'castle_1', x: 0, y: 0 };
  const scene = wardScene(gob, { homeWorldPos: () => null, _castleWardPoints: () => [tower] });
  run(scene, 90);
  assert.gt(fromHome(gob), CREATURE_SIM_CELLS - 1, 'a cave monster is an enemy and is warded');
});

test('ward: wardTrip — Home first, else the nearest turret inside the ring', () => {
  const r2 = (HOME_R * CELL) ** 2;
  const home = { x: 0, y: 0 }, far = { x: 100 * CELL, y: 0 }, near = { x: 3 * CELL, y: 0 };
  assert.eq(__wardTrip({ x: CELL, y: 0 }, home, [near], r2), home, 'inside Home\'s ring: Home');
  assert.eq(__wardTrip({ x: 5 * CELL, y: 0 }, null, [far, near], r2), near, 'the turret it is near');
  assert.eq(__wardTrip({ x: 50 * CELL, y: 0 }, home, [near], r2), null, 'outside every ring: nothing');
});

test('ward: only a CLAIMED castle\'s turrets ward, and only on the surface', () => {
  const src = APP_JS_SRC;
  const body = src.slice(src.indexOf('  _castleWardPoints(now, pc) {'), src.indexOf('  homeWorldPos() {'));
  assert.truthy(/if \(\(this\.depth \|\| 0\) !== 0 \|\| !pc\) return \[\];/.test(body), 'surface only');
  assert.truthy(/o\.kind === 'tower' && this\.isClaimedKey\(o\.castle\)/.test(body), 'the turret test _turretFire reads');
});

test('ward: a tamed slime is a pet and is not driven from its own home', () => {
  const pet = mkSlime({ id: 'released_slime_1757000000000_424242' });
  const scene = wardScene(pet);
  run(scene, 90);
  assert.lt(fromHome(pet), CREATURE_SIM_CELLS - 1, 'a pet lives at Home like you do');
});

})();
