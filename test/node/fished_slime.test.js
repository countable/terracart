// THE FISHED SLIME — now and then a cast hooks a wild slime instead of a fish
// (items.js FISH_SLIME_CHANCE). It lands on a land cell BESIDE the player and
// comes up angry: the real spawner (run.js __fishedSlimeSpawn) seats it, and
// the real lifted wanderCreatures (run.js __wander) has it leech at once.
//
// What is pinned:
//   · the rate: a rarer pull than the boot, rolled by the fishing handler;
//   · the seat: exactly one cell from the feet, never on water / a road /
//     a building, and no slime at all when nothing beside the player is land;
//   · the temper: stamped as struck (the slimeCharging lane), so it attacks;
//   · the id: session state, minted off the clock and pruned like the ghost's.
(function () {

const CELL = 7;                          // WorldGen.CELL_M
const P = { x: CELL / 2, y: CELL / 2 };  // the player's feet, mid-cell
const WATER = TERRAIN.WATER;
const GRASS = TERRAIN.GRASS;

function slimeScene(cellType = () => GRASS) {
  const entry = { creatures: [] };
  const scene = {
    cellM: CELL, depth: 0,
    save: { energy: 100, caught: [], armor: {}, planted: [], fires: [], released: [], reachUpgrades: 0 },
    startWorldM: { x: 0, y: 0 },
    playerM: { x: P.x, y: P.y },
    feetOffsetM: 0,
    originPx: { x: 0, y: 0 }, mPerPx: CELL, cellsPerTile: WorldGen.TILE_PX,
    viewCenterX: 0, viewCenterY: 0,
    _shots: [],
    isShadowActive: () => false,
    isUnnoticed() { return this.isShadowActive() || Combat.playerDowned(this.save.energy); },
    homeWorldPos: () => null,
    _castleWardPoints: () => [],
    playerToWorldCell: () => ({ tx: 0, ty: 0, ix: 0, iy: 0 }),
    cellAt: (x, y) => ({ loaded: true, type: cellType(x, y) }),
    _cellBlocked: () => false,
    _nearAny: () => false,
    placedRockSet: null,
    _damageEnemy: () => false,
    resolveDefeat: () => {},
    _popEnergy: () => {},
    _warnIfTiring: () => {}, _flashPlayerHit: () => {}, _closeShopOnHit: () => {},
    _losePlayerEnergy(d) { const b = this.save.energy ?? 0; this.save.energy = Math.max(0, b - d); return b - this.save.energy; },
    updateEnergyDOM: () => {}, flash: () => {}, _wildCrowTick: () => {},
  };
  scene._entry = entry;
  return scene;
}

function spawn(scene, now = 1e6) {
  const realGet = WorldGen.tileCache.get;
  WorldGen.tileCache.get = () => scene._entry;
  try {
    return __fishedSlimeSpawn(scene, now, P.x, P.y, { tx: 3, ty: -4 });
  } finally {
    WorldGen.tileCache.get = realGet;
  }
}

function tick(scene, ms) {
  const realForEach = WorldGen.forEachItem;
  const realNear = WorldGen.forEachItemNear;
  const realNow = performance.now;
  scene._simT = (scene._simT || 1e6) + ms;
  const t = scene._simT;
  const walk = (what, fn) => {
    if (what !== 'creatures') return;
    for (const c of scene._entry.creatures.slice()) fn(c, 0, 0);
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

test('fished slime: a rarer pull than the boot, rolled by the handler', () => {
  assert.gt(FISH_SLIME_CHANCE, 0, 'it can happen');
  assert.lt(FISH_SLIME_CHANCE, FISH_BOOT_CHANCE, 'but less often than an old boot');
  assert.truthy(/< FISH_SLIME_CHANCE && scene\.spawnFishedSlime/.test(INTERACT_SRC),
    'the fishing handler rolls the module\'s number and seats it through the spawner');
});

test('fished slime: lands one cell from the feet, on land, as a wild slime', () => {
  for (let i = 0; i < 40; i++) {
    const s = slimeScene();
    const c = spawn(s);
    assert.truthy(c, 'a slime came up');
    assert.eq(c.kind, 'slime', 'a wild slime — an enemy');
    assert.truthy(Combat.isEnemy(c), 'and the game treats it as one');
    assert.eq(s._entry.creatures.length, 1, 'pushed into the player\'s tile');
    const d = Math.hypot(c.x - P.x, c.y - P.y) / CELL;
    assert.truthy(Math.abs(d - 1) < 1e-9, `beside the player (${d} cells)`);
  }
});

test('fished slime: never lands in the water', () => {
  // Water everywhere but due south of the player.
  const landOnlySouth = (x, y) => (y > P.y + CELL / 2 && Math.abs(x - P.x) < 1e-6 ? GRASS : WATER);
  for (let i = 0; i < 40; i++) {
    const s = slimeScene(landOnlySouth);
    const c = spawn(s);
    assert.truthy(c, 'it found the one land cell');
    assert.eq(s.cellAt(c.x, c.y).type, GRASS, 'and sits on it');
  }
  const s = slimeScene(() => WATER);
  assert.eq(spawn(s), null, 'no land beside you, no slime');
  assert.eq(s._entry.creatures.length, 0, 'and nothing was pushed');
});

test('fished slime: comes up angry and attacks at once', () => {
  const s = slimeScene();
  const c = spawn(s);
  assert.truthy(c._lastDamagedT != null && Date.now() - c._lastDamagedT < 1000,
    'stamped as struck — slimeCharging\'s lane, not a new flag');
  const before = s.save.energy;
  for (let t = 0; t < 3000; t += 100) tick(s, 100);
  assert.lt(s.save.energy, before, 'it leeches the player within a few seconds of landing');
});

test('fished slime: session state, pruned like the ghost', () => {
  const c = spawn(slimeScene());
  assert.truthy(/^fished_slime_3_-4_/.test(c.id), `id minted on the player's tile (${c.id})`);
  assert.truthy(/\(\?:pest_crow\|ghost\|fished_slime\)_/.test(APP_JS_SRC),
    'save.caught prune names the fished slime\'s prefix');
});

})();
