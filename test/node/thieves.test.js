// THE THIEVES — the RAVEN (the crow's body in blue-black; its swoop takes
// COINS from the purse) and the GULL (the crow's body in white, on the shore;
// its swoop takes FOOD out of the bag). ONE lane for both:
//   · what a kind steals is its roster row's `steals` column ('coins' /
//     'food') — Combat.theftKind; nothing else makes a thief;
//   · the snatch goes through the ONE enemy-hit site (creature_ai.js
//     rosterEnemyAttack → Combat.incomingTheft, a TAKE { what, n, id? } or
//     null → scene._losePlayerToThief, app.js) and never touches energy;
//   · coins: ONE coin (Combat.THEFT_COINS), never below $0. Food: ONE piece
//     off the bag's biggest meal (Combat.theftFood — the highest FOOD_ENERGY
//     stack);
//   · one snatch per thief per UTC day (save.thefts — Combat.bankTheft /
//     theftSated), then it is sated and flies off on the rout lane;
//   · nothing hunts a body, nothing sees you under a Shadow Powder.
// The raven is seated by the fauna spawner (BIOME_FAUNA, last in FAUNA_ORDER)
// and kept out of the starting area's pest amnesty like the crow; the gull by
// the shore rule (shore_fauna.test.js).
(function () {

// ── The rows ────────────────────────────────────────────────────────────────
test('thieves: the raven is a roster foe on the crow\'s sheet — coins, fast, off the board, seated with the animals', () => {
  const row = EnemyRoster.get('raven');
  assert.truthy(row, 'a roster row');
  assert.eq(row.steals, 'coins', 'its damage kind is coins');
  assert.eq(Combat.theftKind('raven'), 'coins');
  assert.eq(row.dmg, 0, 'it lands no blow on the bar');
  assert.eq(row.surface, null, 'never in the slime-seat roll');
  assert.eq(row.cave, null, 'never underground');
  assert.truthy(Combat.isEnemy({ kind: 'raven', id: 'raven_0_0_1' }), 'hostile through the monster table');
  assert.falsy(Combat.onQuestBoard('raven'), 'off the quest board — a thief, not a kill job');
  assert.falsy(Combat.spawnsUnderground('raven'));
  assert.falsy(SpriteLayout.isGame('raven'), 'a foe, not game');
  assert.eq(creatureSpawnClass('raven'), 'fastEnemy', 'it out-flies a brisk walk: a FAST foe (kerb rules)');
  assert.gt(foeChaseMps({ kind: 'raven' }, WorldGen.CELL_M), BRISK_WALK_MPS);
  const a = SpriteLayout.creatureArt('raven'), crow = SpriteLayout.creatureArt('crow');
  assert.eq(a.sheet, 'raven', 'its own recoloured texture');
  for (const k of ['fw', 'fh', 'scale', 'foot', 'float', 'minY', 'maxY', 'airborne']) {
    assert.eq(a[k], crow[k], `one body, one ground line: ${k} matches the crow`);
  }
  assert.truthy(row.palette, 'recoloured by its row\'s palette');
  assert.gt(Combat.enemyBounty('raven', 0), 0, 'felling one pays');
  // Seated like an animal: a BIOME_FAUNA row, appended after every species
  // before it (only the later horse follows) so no earlier seat moved.
  assert.eq(FAUNA_ORDER.slice(-2).join(','), 'raven,horse', 'appended after the older species');
  assert.truthy(BIOME_FAUNA.raven && BIOME_FAUNA.raven.base > 0, 'a per-tile count');
  assert.truthy(PEST_FREE_GUARD_SRC.includes("kindStr === 'raven'"), 'kept out of the starting area with the crow and the slime');
});

test('thieves: the theft kinds are the two roster columns, and only those', () => {
  const thieves = EnemyRoster.ROWS.filter((r) => r.steals).map((r) => r.id).sort();
  assert.eq(thieves.join(','), 'gull,raven', 'two thieves');
  for (const row of EnemyRoster.ROWS) {
    if (row.steals) assert.eq(row.dmg, 0, `${row.id}: a thief lands no blow`);
    else assert.eq(Combat.theftKind(row.id), null, `${row.id}: a biter steals nothing`);
  }
  assert.eq(Combat.theftAmount('slime'), 0);
  assert.eq(Combat.theftAmount('gull'), 0, 'a food thief has no coin amount');
});

// ── The take, in Combat ─────────────────────────────────────────────────────
test('thieves: incomingTheft (coins) — one coin, never past the purse, never on a body, once a day', () => {
  const now = Date.UTC(2026, 8, 29, 12);
  const raven = { kind: 'raven', id: 'raven_1_2_3' };
  const amount = Combat.theftAmount('raven');
  assert.eq(amount, 1, 'a raven takes ONE coin (owner: "just one coin, then retreat")');
  assert.eq(amount, Combat.THEFT_COINS, 'off the one constant');
  assert.gt(Combat.enemyBounty('raven', 0), amount, 'and is worth more felled than fed');
  const save = { energy: 50, money: 100 };
  assert.eq(JSON.stringify(Combat.incomingTheft(save, raven, now)), JSON.stringify({ what: 'coins', n: amount }));
  assert.eq(Combat.incomingTheft({ energy: 50, money: 1 }, raven, now).n, 1, 'the last coin goes, never below $0');
  assert.eq(Combat.incomingTheft({ energy: 50, money: 0 }, raven, now), null, 'an empty purse: nothing to take');
  assert.eq(Combat.incomingTheft({ energy: 0, money: 100 }, raven, now), null, 'nothing hunts a body');
  assert.eq(Combat.incomingTheft(save, { kind: 'bat', id: 'b' }, now), null, 'a biter steals nothing');
  Combat.bankTheft(save, raven, now);
  assert.truthy(Combat.theftSated(save, raven, now), 'sated once it has stolen');
  assert.eq(Combat.incomingTheft(save, raven, now), null, 'the cap: one snatch per raven per day');
  assert.eq(Combat.incomingTheft(save, { kind: 'raven', id: 'raven_9_9_9' }, now).n, amount, 'another raven is its own ledger line');
  const tomorrow = now + 24 * 3600 * 1000;
  assert.falsy(Combat.theftSated(save, raven, tomorrow), 'a new UTC day, a hungry raven');
  Combat.bankTheft(save, raven, tomorrow);
  assert.eq(save.thefts.ids.length, 1, 'the ledger resets on a new day');
  assert.eq(save.energy, 50, 'energy untouched throughout');
});

test('thieves: incomingTheft (food) — one piece off the biggest meal, nothing from a bag with no food, one ledger', () => {
  const now = Date.UTC(2026, 8, 29, 12);
  const gull = { kind: 'gull', id: 'gull_1_2_3_4' };
  const bag = () => ({ energy: 50, money: 100, inv: [{ id: 'berry', count: 3 }, { id: 'rope', count: 2 }, { id: 'salmon', count: 1 }, { id: 'nut', count: 9 }] });
  assert.gt(FOOD_ENERGY.salmon, FOOD_ENERGY.berry, 'the fixture: salmon is the biggest meal');
  assert.falsy(FOOD_ENERGY.rope, 'and rope is not food');
  assert.eq(Combat.theftFood(bag()), 'salmon', 'the biggest meal in the bag');
  assert.eq(Combat.theftFood({ inv: [{ id: 'berry', count: 2 }, { id: 'apple', count: 1 }] }), 'apple', 'FOOD_ENERGY decides, not stack size');
  assert.eq(Combat.theftFood({ inv: [{ id: 'berry', count: 2 }, { id: 'onion', count: 1 }] }), 'berry', 'a tie goes to the first stack');
  assert.eq(Combat.theftFood({ inv: [{ id: 'rope', count: 2 }, { id: 'berry', count: 0 }] }), null, 'no food, or an emptied stack: nothing');
  assert.eq(Combat.theftFood({}), null);
  const save = bag();
  assert.eq(JSON.stringify(Combat.incomingTheft(save, gull, now)), JSON.stringify({ what: 'food', id: 'salmon', n: 1 }), 'ONE piece');
  assert.eq(Combat.incomingTheft({ energy: 50, money: 100, inv: [{ id: 'rope', count: 1 }] }, gull, now), null, 'a bag with no food: nothing to take');
  assert.eq(Combat.incomingTheft({ ...bag(), energy: 0 }, gull, now), null, 'nothing hunts a body');
  assert.eq(save.money, 100, 'the purse is not the gull\'s');
  Combat.bankTheft(save, gull, now);
  assert.eq(Combat.incomingTheft(save, gull, now), null, 'sated: one snatch per gull per day');
  // One ledger for both kinds of thief.
  const raven = { kind: 'raven', id: 'raven_1_2_3' };
  assert.truthy(Combat.incomingTheft(save, raven, now), 'a raven is not sated by the gull\'s meal');
  Combat.bankTheft(save, raven, now);
  assert.eq(save.thefts.ids.join(), 'gull_1_2_3_4,raven_1_2_3', 'both on the one day ledger');
});

// ── The take, RUN through the one hit site ──────────────────────────────────
const CELL = 7, N = 64, EDGE = N * CELL, TICK_MS = 100;
function mkScene(creature, feet, save) {
  const scene = {
    cellM: CELL, depth: 0, tileEdgeM: EDGE,
    save: { energy: 80, money: 50, inv: [{ id: 'berry', count: 3 }, { id: 'rope', count: 1 }], caught: [], armor: {}, planted: [], fires: [], released: [], reachUpgrades: 0, ...save },
    startWorldM: { x: 0, y: 0 }, playerM: { x: feet.x, y: feet.y }, feetOffsetM: 0,
    _starterTrailAnchor: () => ({ x: -1e6, y: 0 }),
    originPx: { x: 0, y: 0 }, mPerPx: CELL, cellsPerTile: WorldGen.TILE_PX,
    viewCenterX: 0, viewCenterY: 0, _shots: [], _laid: 0, _flinch: 0, _energyCalls: 0,
    isShadowActive: () => false,
    isUnnoticed() { return this.isShadowActive() || Combat.playerDowned(this.save.energy); },
    homeWorldPos: () => null, _castleWardPoints: () => [],
    playerToWorldCell: () => ({ tx: 0, ty: 0, ix: 0, iy: 0 }),
    cellAt: () => ({ loaded: true, type: 0 }),
    _cellBlocked: () => false, _nearAny: () => false, placedRockSet: null,
    _damageEnemy: () => false, resolveDefeat: () => {},
    _popEnergy: () => {}, _warnIfTiring: () => {}, _closeShopOnHit: () => {},
    _flashPlayerHit() { this._flinch++; },
    _losePlayerEnergy(d) { this._energyCalls++; const b = this.save.energy; this.save.energy = Math.max(0, b - d); return b - this.save.energy; },
    // app.js _losePlayerToThief, in miniature: coins off the purse, food out
    // of the bag (Inventory.remove — the shipping bag writer), the thief
    // sated, the flinch. (Its source is pinned below.)
    _losePlayerToThief(take, c) {
      let taken = 0;
      if (take.what === 'coins') { this.save.money -= take.n; taken = take.n; }
      else if (take.what === 'food') taken = Inventory.remove(this.save, take.id, take.n);
      if (taken > 0) { Combat.bankTheft(this.save, c); this._flashPlayerHit(taken); }
      return taken;
    },
    _trapperLay() { this._laid++; },
    updateEnergyDOM: () => {}, flash: () => {}, _wildCrowTick: () => {},
  };
  scene.creatures = [creature];
  return scene;
}
const entry = { cellsPerEdge: N, roadClass: new Uint8Array(N * N), grid: new Uint8Array(N * N), creatures: [] };
function tick(scene) {
  const realNear = WorldGen.forEachItemNear, realGet = WorldGen.tileCache.get, realNow = performance.now;
  scene._simT = (scene._simT || 1e6) + TICK_MS;
  const t = scene._simT;
  WorldGen.forEachItemNear = (what, tx, ty, fn) => { if (what === 'creatures') for (const c of scene.creatures.slice()) fn(c, 0, 0); };
  WorldGen.tileCache.get = (k) => (k === WorldGen.tileKey(0, 0) ? entry : undefined);
  try { performance.now = () => t; __wander.call(scene); } finally {
    WorldGen.forEachItemNear = realNear; WorldGen.tileCache.get = realGet; performance.now = realNow;
  }
}
const at = (col, row) => ({ x: (col + 0.5) * CELL, y: (row + 0.5) * CELL });
const berries = (s) => Inventory.count(s, 'berry');
function run(kind, save, seconds = 40, shadow = false) {
  const feet = at(32, 32);
  const thief = { kind, id: `${kind}_0_0_33_32`, ...at(33, 32) };
  const scene = mkScene(thief, feet, save);
  if (shadow) scene.isShadowActive = () => true;
  for (let ms = 0; ms < seconds * 1000; ms += TICK_MS) tick(scene);
  return { scene, thief, feet, far: Math.hypot(thief.x - feet.x, thief.y - feet.y) };
}

test('thieves: a raven\'s swoop takes coins through the hit site — once — and never energy or food', () => {
  const r = run('raven', {});
  const amount = Combat.theftAmount('raven');
  assert.eq(r.scene.save.money, 50 - amount, 'exactly one snatch of its worth in 40 s');
  assert.eq(r.scene.save.energy, 80, 'the bar untouched');
  assert.eq(berries(r.scene.save), 3, 'the bag untouched');
  assert.eq(r.scene._energyCalls, 0, 'the energy writer never called');
  assert.eq(r.scene._flinch, 1, 'the body flinches when the snatch lands');
  assert.truthy(Combat.theftSated(r.scene.save, r.thief), 'and the raven is sated');
  assert.gt(r.far, 6 * CELL, 'a sated raven has flown off');
});

test('thieves: a gull\'s swoop takes one piece of food through the hit site — once — and never energy or coins', () => {
  const r = run('gull', {});
  assert.eq(berries(r.scene.save), 2, 'exactly one berry gone in 40 s');
  assert.eq(Inventory.count(r.scene.save, 'rope'), 1, 'the rope is not food');
  assert.eq(r.scene.save.money, 50, 'the purse untouched');
  assert.eq(r.scene.save.energy, 80, 'the bar untouched');
  assert.eq(r.scene._energyCalls, 0, 'the energy writer never called');
  assert.eq(r.scene._flinch, 1, 'the body flinches when the snatch lands');
  assert.truthy(Combat.theftSated(r.scene.save, r.thief), 'and the gull is sated');
  assert.gt(r.far, 6 * CELL, 'a sated gull has flown off');
});

test('thieves: no snatch from a body, from under a Shadow Powder, twice in a day, or where there is nothing to take', () => {
  for (const kind of ['raven', 'gull']) {
    const downed = run(kind, { energy: 0 });
    assert.eq(downed.scene.save.money, 50, `${kind}: nothing hunts a body (purse)`);
    assert.eq(berries(downed.scene.save), 3, `${kind}: nothing hunts a body (bag)`);
    const shadow = run(kind, {}, 40, true);
    assert.eq(shadow.scene.save.money + berries(shadow.scene.save), 53, `${kind}: unnoticed — the powder hides the purse and the bag`);
    const sated = run(kind, { thefts: { day: Combat.theftDay(Date.now()), ids: [`${kind}_0_0_33_32`] } });
    assert.eq(sated.scene.save.money + berries(sated.scene.save), 53, `${kind}: one that stole today takes nothing more`);
    assert.eq(sated.scene._flinch, 0);
  }
  const broke = run('raven', { money: 0 });
  assert.eq(broke.scene.save.money, 0, 'an empty purse stays at $0');
  assert.eq(broke.scene._flinch, 0, 'and nothing lands');
  const hungry = run('gull', { inv: [{ id: 'rope', count: 1 }] });
  assert.eq(Inventory.count(hungry.scene.save, 'rope'), 1, 'a bag with no food loses nothing');
  assert.eq(hungry.scene._flinch, 0, 'and nothing lands');
});

test('thieves: the theft is ONE lane — the hit site and the scene writer (source pins)', () => {
  const hit = CREATURE_AI_SRC.slice(CREATURE_AI_SRC.indexOf('function rosterEnemyAttack('));
  const body = hit.slice(0, hit.indexOf('\n}\n'));
  assert.truthy(/} else if \(row\.steals\) \{[\s\S]*?const take = Combat\.incomingTheft\(scene\.save, c, Date\.now\(\)\);[\s\S]*?if \(take\) scene\._losePlayerToThief\(take, c\);/.test(body),
    'the snatch is a branch of the one enemy-hit site');
  const branch = body.slice(body.indexOf('} else if (row.steals) {'), body.indexOf('} else {', body.indexOf('} else if (row.steals) {')));
  assert.falsy(/_losePlayerEnergy|incomingDamage|Energy\.set|_losePlayerCoins|_losePlayerFood/.test(branch),
    'the theft branch never touches energy, and never picks the writer itself');
  const lift = (sig) => { const a = SCENE_SRC.slice(SCENE_SRC.indexOf(sig)); return a.slice(0, a.indexOf('\n  }\n')); };
  const dispatch = lift('  _losePlayerToThief(take, thief) {');
  assert.truthy(/take\.what === 'coins'\) return this\._losePlayerCoins\(take\.n, thief\)/.test(dispatch), 'coins to the purse writer');
  assert.truthy(/take\.what === 'food'\) return this\._losePlayerFood\(take\.id, take\.n, thief\)/.test(dispatch), 'food to the bag writer');
  const coins = lift('  _losePlayerCoins(n, thief) {');
  assert.truthy(/addMoney\(this\.save, -taken\)/.test(coins), 'off the purse');
  assert.truthy(/Math\.min\(purse,/.test(coins), 'never below $0');
  assert.truthy(/Combat\.bankTheft\(this\.save, thief\)/.test(coins), 'the thief sated');
  assert.truthy(/this\._flashPlayerHit\(taken\)/.test(coins), 'the body flinches');
  assert.truthy(/this\._popCellNumber\(`-\$\{taken\}`/.test(coins), 'the number lands on the player\'s cell');
  assert.falsy(/energy|Energy\./.test(coins.replace(/\/\/.*$/gm, '')), 'no energy in the coin writer');
  const food = lift('  _losePlayerFood(id, n, thief) {');
  assert.truthy(/Inventory\.remove\(this\.save, id,/.test(food), 'out of the bag through the one bag writer');
  assert.truthy(/Combat\.bankTheft\(this\.save, thief\)/.test(food), 'the thief sated');
  assert.truthy(/this\._flashPlayerHit\(taken\)/.test(food), 'the body flinches');
  assert.truthy(/this\._popCellNumber\(`-\$\{taken\} \$\{name\}`/.test(food), 'the piece is named on the player\'s cell');
  assert.truthy(/buildInventoryDOM\(\)/.test(food), 'the bar rebuilt');
  assert.falsy(/energy|Energy\.|addMoney/.test(food.replace(/\/\/.*$/gm, '')), 'no energy and no coins in the food writer');
  const w = SCENE_CREATURES_SRC.slice(SCENE_CREATURES_SRC.indexOf('  wanderCreatures() {'));
  assert.truthy(/const sated = !isTame && !!Combat\.theftKind\(c\.kind\) && Combat\.theftSated\(this\.save, c\);/.test(w),
    'sated is read once per creature, only for a thief');
  assert.truthy(/const routed = warded \|\| wanderOff \|\| sated \|\| frightened \|\| psychotic;/.test(w), 'a sated thief flies off on the rout lane');
});

})();
