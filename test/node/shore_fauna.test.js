// THE SHORE'S OWN FAUNA — the crab (the chicken of the beach) and the gull
// (a waterfront thief whose swoop takes COINS, not energy).
//   · a KIND is a ROW: art + behaviour in SpriteLayout, hostility only in the
//     roster / monster table (the gull), the spawn class off speed data;
//   · seated by their own rule (scene_creatures.js spawnShoreFauna, off
//     biome_profiles.js SHORE_FAUNA): shore sand (+ piers for the gull), a
//     count that follows the waterline, each species on its own stream, ids
//     from the seat cell;
//   · the gull's snatch goes through the ONE enemy-hit site
//     (rosterEnemyAttack → Combat.incomingTheft → scene._losePlayerCoins) and
//     never touches energy; one snatch per gull per UTC day, then it is
//     sated and flies off.
(function () {

// ── The rows ────────────────────────────────────────────────────────────────
test('shore fauna: the crab is an animal row — art, behaviour, a shell when fed, tamed with a minnow', () => {
  const art = SpriteLayout.creatureArt('crab');
  assert.truthy(art, 'the crab draws');
  assert.eq(art.sheet, 'crab');
  assert.eq(art.fw, 16);
  assert.truthy(SpriteLayout.creatureWanders('crab'), 'it wanders');
  assert.eq(SpriteLayout.creatureProduce('crab').item, 'shell', 'a fed crab gives the beach pickup');
  assert.truthy(ITEM_BY_ID.crab && ITEM_BY_ID.crab.kind === 'animal', 'caught, it is a Crab in the bag');
  assert.truthy(ITEM_BY_ID.shiny_crab, 'and a shiny one keeps its own stack');
  assert.truthy(animalLikesFood('crab', 'minnow'), 'a minnow tames it');
  assert.truthy(ITEM_EFFECTS.minnow, 'the minnow has its own story hint');
  assert.falsy(Combat.isEnemyKind('crab'), 'never a foe');
  assert.falsy(SpriteLayout.isGame('crab'), 'never game');
  assert.eq(creatureSpawnClass('crab'), 'fauna', 'a slow animal, off its own gait');
});

test('shore fauna: the gull is a roster foe on the crow\'s sheet, fast, off the board, thieving not biting', () => {
  const row = EnemyRoster.get('gull');
  assert.truthy(row, 'a roster row');
  assert.eq(row.steals, 'coins', 'its damage kind is coins');
  assert.eq(row.dmg, 0, 'it lands no blow on the bar');
  assert.eq(row.surface, null, 'never in the slime-seat roll');
  assert.eq(row.cave, null, 'never underground');
  assert.truthy(Combat.isEnemy({ kind: 'gull', id: 'gull_0_0_1_1' }), 'hostile through the monster table');
  assert.falsy(Combat.onQuestBoard('gull'), 'off the quest board');
  assert.falsy(Combat.spawnsUnderground('gull'));
  assert.falsy(SpriteLayout.isGame('gull'), 'a foe, not game');
  assert.eq(creatureSpawnClass('gull'), 'fastEnemy', 'it out-flies a brisk walk: a FAST foe (kerb rules)');
  assert.gt(foeChaseMps({ kind: 'gull' }, WorldGen.CELL_M), BRISK_WALK_MPS);
  const a = SpriteLayout.creatureArt('gull'), crow = SpriteLayout.creatureArt('crow');
  assert.eq(a.sheet, 'gull', 'its own recoloured texture');
  for (const k of ['fw', 'fh', 'scale', 'foot', 'float', 'minY', 'maxY', 'airborne']) {
    assert.eq(a[k], crow[k], `one body, one ground line: ${k} matches the crow`);
  }
  assert.truthy(row.palette, 'recoloured by its row\'s palette');
  assert.gt(Combat.enemyBounty('gull', 0), 0, 'felling one pays');
});

// ── The theft, in Combat ────────────────────────────────────────────────────
test('shore fauna: incomingTheft — its bounty, never past the purse, never on a body, once a day', () => {
  const now = Date.UTC(2026, 8, 29, 12);
  const gull = { kind: 'gull', id: 'gull_1_2_3_4' };
  const amount = Combat.theftAmount('gull');
  assert.eq(amount, Combat.enemyBounty('gull', 0), 'what it takes is what it is worth');
  assert.gt(amount, 0);
  const save = { energy: 50, money: 100 };
  assert.eq(Combat.incomingTheft(save, gull, now), amount);
  assert.eq(Combat.incomingTheft({ energy: 50, money: 1 }, gull, now), 1, 'never below $0');
  assert.eq(Combat.incomingTheft({ energy: 50, money: 0 }, gull, now), 0);
  assert.eq(Combat.incomingTheft({ energy: 0, money: 100 }, gull, now), 0, 'nothing hunts a body');
  assert.eq(Combat.incomingTheft(save, { kind: 'bat', id: 'b' }, now), 0, 'a biter steals nothing');
  assert.eq(Combat.theftAmount('slime'), 0);
  Combat.bankTheft(save, gull, now);
  assert.truthy(Combat.theftSated(save, gull, now), 'sated once it has stolen');
  assert.eq(Combat.incomingTheft(save, gull, now), 0, 'the cap: one snatch per gull per day');
  assert.eq(Combat.incomingTheft(save, { kind: 'gull', id: 'gull_9_9_9_9' }, now), amount, 'another gull is its own ledger line');
  const tomorrow = now + 24 * 3600 * 1000;
  assert.falsy(Combat.theftSated(save, gull, tomorrow), 'a new UTC day, a hungry gull');
  Combat.bankTheft(save, gull, tomorrow);
  assert.eq(save.thefts.ids.length, 1, 'the ledger resets on a new day');
  assert.eq(save.energy, 50, 'energy untouched throughout');
});

// ── The theft, RUN through the one hit site ─────────────────────────────────
const CELL = 7, N = 64, EDGE = N * CELL, TICK_MS = 100;
function mkScene(creature, feet, save) {
  const scene = {
    cellM: CELL, depth: 0, tileEdgeM: EDGE,
    save: { energy: 80, money: 50, caught: [], armor: {}, planted: [], fires: [], released: [], reachUpgrades: 0, ...save },
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
    // app.js _losePlayerCoins, in miniature: off the purse, the thief sated,
    // the flinch. (Its source is pinned below.)
    _losePlayerCoins(n, c) { this.save.money -= n; Combat.bankTheft(this.save, c); this._flashPlayerHit(n); return n; },
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
function run(save, seconds = 40) {
  const feet = at(32, 32);
  const gull = { kind: 'gull', id: 'gull_0_0_33_32', ...at(33, 32) };
  const scene = mkScene(gull, feet, save);
  let far = 0;
  for (let ms = 0; ms < seconds * 1000; ms += TICK_MS) {
    tick(scene);
    far = Math.max(far, Math.hypot(gull.x - feet.x, gull.y - feet.y));
  }
  return { scene, gull, far, feet };
}

test('shore fauna: a gull\'s swoop takes coins through the hit site — once — and never energy', () => {
  const r = run({});
  const amount = Combat.theftAmount('gull');
  assert.eq(r.scene.save.money, 50 - amount, 'exactly one snatch of its worth in 40 s');
  assert.eq(r.scene.save.energy, 80, 'the bar untouched');
  assert.eq(r.scene._energyCalls, 0, 'the energy writer never called');
  assert.eq(r.scene._flinch, 1, 'the body flinches when the snatch lands');
  assert.truthy(Combat.theftSated(r.scene.save, r.gull), 'and the gull is sated');
  assert.gt(Math.hypot(r.gull.x - r.feet.x, r.gull.y - r.feet.y), 6 * CELL, 'a sated gull has flown off');
});

test('shore fauna: no snatch from a body, from under a Shadow Powder, or twice in a day', () => {
  const downed = run({ energy: 0 });
  assert.eq(downed.scene.save.money, 50, 'nothing hunts a body');
  const shadow = (() => {
    const feet = at(32, 32);
    const gull = { kind: 'gull', id: 'gull_0_0_33_32', ...at(33, 32) };
    const scene = mkScene(gull, feet, {});
    scene.isShadowActive = () => true;
    for (let ms = 0; ms < 40000; ms += TICK_MS) tick(scene);
    return scene;
  })();
  assert.eq(shadow.save.money, 50, 'unnoticed: the powder hides the purse too');
  const sated = run({ thefts: { day: Combat.theftDay(Date.now()), ids: ['gull_0_0_33_32'] } });
  assert.eq(sated.scene.save.money, 50, 'a gull that stole today takes nothing more');
  assert.eq(sated.scene._flinch, 0);
  const broke = run({ money: 0 });
  assert.eq(broke.scene.save.money, 0, 'an empty purse stays at $0');
  assert.eq(broke.scene._flinch, 0, 'and nothing lands');
});

test('shore fauna: the theft is ONE lane — the hit site and the scene writer (source pins)', () => {
  const hit = CREATURE_AI_SRC.slice(CREATURE_AI_SRC.indexOf('function rosterEnemyAttack('));
  const body = hit.slice(0, hit.indexOf('\n}\n'));
  assert.truthy(/} else if \(row\.steals\) \{[\s\S]*?Combat\.incomingTheft\(scene\.save, c, Date\.now\(\)\)[\s\S]*?scene\._losePlayerCoins\(taken, c\)/.test(body),
    'the snatch is a branch of the one enemy-hit site');
  const branch = body.slice(body.indexOf('} else if (row.steals) {'), body.indexOf('} else {', body.indexOf('} else if (row.steals) {')));
  assert.falsy(/_losePlayerEnergy|incomingDamage|Energy\.set/.test(branch), 'the theft branch never touches energy');
  const app = APP_JS_SRC.slice(APP_JS_SRC.indexOf('  _losePlayerCoins(n, thief) {'));
  const fn = app.slice(0, app.indexOf('\n  }\n'));
  assert.truthy(/addMoney\(this\.save, -taken\)/.test(fn), 'off the purse');
  assert.truthy(/Math\.min\(purse,/.test(fn), 'never below $0');
  assert.truthy(/Combat\.bankTheft\(this\.save, thief\)/.test(fn), 'the thief sated');
  assert.truthy(/this\._flashPlayerHit\(taken\)/.test(fn), 'the body flinches');
  assert.truthy(/this\._popCellNumber\(`-\$\{taken\}`/.test(fn), 'the number lands on the player\'s cell');
  assert.falsy(/energy|Energy\./.test(fn.replace(/\/\/.*$/gm, '')), 'no energy in the coin writer');
  const w = SCENE_CREATURES_SRC.slice(SCENE_CREATURES_SRC.indexOf('  wanderCreatures() {'));
  assert.truthy(/const sated = !isTame && !!Combat\.theftKind\(c\.kind\) && Combat\.theftSated\(this\.save, c\);/.test(w),
    'sated is read once per creature, only for a thief');
  assert.truthy(/const routed = warded \|\| wanderOff \|\| sated \|\| frightened;/.test(w), 'a sated thief flies off on the rout lane');
});

// ── The seats ───────────────────────────────────────────────────────────────
// spawnShoreFauna, lifted and RUN on a synthetic beach.
const lift = () => {
  const i = SCENE_CREATURES_SRC.indexOf('  spawnShoreFauna(');
  const j = SCENE_CREATURES_SRC.indexOf('\n  }\n', i);
  return new Function(`return ({ ${SCENE_CREATURES_SRC.slice(i, j + 4)} });`)().spawnShoreFauna;
};
const T = WorldGen.T, NB = 80, CM = WorldGen.CELL_M;
function beach() {
  // Grass everywhere; a sand strip down the east side (cols 60..69), the
  // shore being its seaward half (cols 65..69); an inland sandpit (cols
  // 10..14) the shore mask does not hold; a pier out along row 40.
  const grid = new Uint8Array(NB * NB).fill(T.GRASS);
  const shoreCells = [];
  for (let y = 0; y < NB; y++) {
    for (let x = 60; x < 70; x++) grid[y * NB + x] = T.SAND;
    for (let x = 65; x < 70; x++) shoreCells.push(y * NB + x);
    if (y >= 20 && y < 30) for (let x = 10; x < 15; x++) grid[y * NB + x] = T.SAND;
  }
  const pierCells = [];
  for (let x = 70; x < 78; x++) { grid[40 * NB + x] = T.PIER; pierCells.push(40 * NB + x); }
  return { grid, shore: { cells: shoreCells, shoreM: NB * CM }, pierCells };
}
function seat(b, caught = new Set(), order) {
  const fn = lift();
  const creatures = [];
  const was = globalThis.SHORE_FAUNA_ORDER;
  if (order) globalThis.SHORE_FAUNA_ORDER = order;
  try {
    fn.call({ tileEdgeM: NB * CM }, creatures, b.shore, b.pierCells, NB, 3, 4, CM, b.grid, {}, {}, caught);
  } finally { globalThis.SHORE_FAUNA_ORDER = was; }
  return creatures;
}
const cellOf = (c) => Math.floor((c.y - 4 * NB * CM) / CM) * NB + Math.floor((c.x - 3 * NB * CM) / CM);

test('shore fauna: metal slimes use a sparse independent population with persistent identities', () => {
  const b=beach(), all=seat(b), metals=all.filter(c=>c.kind==='metal_slime');
  const count=Math.min(SHORE_FAUNA.metal_slime.max,
    Math.floor((b.shore.shoreM+b.pierCells.length*CM)/SHORE_FAUNA.metal_slime.perShoreM));
  assert.eq(metals.length,count); assert.gt(count,0);
  assert.eq(metals.map(c=>c.id).join(),seat(b,new Set(),['metal_slime']).map(c=>c.id).join(),
    'other species never reroll the metal stream');
  assert.eq(seat(b,new Set(metals.map(c=>c.id))).filter(c=>c.kind==='metal_slime').length,0,
    'defeated metal slimes do not respawn');
});

test('shore fauna: crabs on shore sand only, gulls on the shore or the pier, counted off the waterline', () => {
  const b = beach();
  const out = seat(b);
  const crabs = out.filter((c) => c.kind === 'crab'), gulls = out.filter((c) => c.kind === 'gull');
  const shore = new Set(b.shore.cells), pier = new Set(b.pierCells);
  const want = (k, lenM) => Math.min(SHORE_FAUNA[k].max, Math.floor(lenM / SHORE_FAUNA[k].perShoreM));
  assert.eq(crabs.length, want('crab', b.shore.shoreM), 'one crab per perShoreM of waterline, capped');
  assert.eq(gulls.length, want('gull', b.shore.shoreM + b.pierCells.length * CM), 'gulls count the pier too');
  assert.gt(crabs.length, 0);
  assert.gt(gulls.length, 0);
  for (const c of crabs) {
    assert.truthy(shore.has(cellOf(c)), `crab ${c.id} on shore sand`);
    assert.eq(b.grid[cellOf(c)], T.SAND);
  }
  for (const g of gulls) assert.truthy(shore.has(cellOf(g)) || pier.has(cellOf(g)), `gull ${g.id} on the shore or the pier`);
  for (const c of out) {
    const i = cellOf(c);
    assert.eq(c.id, WorldGen.cellId(c.kind, 3, 4, i % NB, Math.floor(i / NB)), 'the id is the seat cell');
  }
  assert.eq(new Set(out.map((c) => c.id)).size, out.length, 'no two on one cell');
});

test('shore fauna: no shore, no crabs — inland sand and a tile without water hold none', () => {
  const b = beach();
  assert.eq(seat({ ...b, shore: null, pierCells: [] }).length, 0, 'the sandpit alone seats nothing');
  const pierOnly = seat({ ...b, shore: null });
  assert.falsy(pierOnly.some((c) => c.kind === 'crab'), 'a pier holds no crab');
});

test('shore fauna: deterministic, each species on its own stream, a catch hides without moving the rest', () => {
  const b = beach();
  const a = seat(b), again = seat(beach());
  assert.eq(a.map((c) => c.id).join(), again.map((c) => c.id).join(), 'two builds, the same seats');
  const crabsOnly = seat(b, new Set(), ['crab']);
  assert.eq(crabsOnly.map((c) => c.id).join(), a.filter((c) => c.kind === 'crab').map((c) => c.id).join(),
    'the crabs do not move whether or not the gull draws');
  const gullsOnly = seat(b, new Set(), ['gull']);
  assert.eq(gullsOnly.map((c) => c.id).join(), a.filter((c) => c.kind === 'gull').map((c) => c.id).join(),
    'nor the gulls whether or not the crab draws');
  const gone = a[0].id;
  const after = seat(b, new Set([gone]));
  assert.eq(after.map((c) => c.id).join(), a.filter((c) => c.id !== gone).map((c) => c.id).join(),
    'a caught crab is hidden; every other seat stays');
});

test('shore fauna: the shore pass runs inside spawnInTile, after every shared draw (source pin)', () => {
  const s = SPAWN_IN_TILE_SRC;
  const call = s.indexOf('this.spawnShoreFauna(creatures, shore, pierCells');
  assert.gt(call, 0, 'spawnInTile seats the shore fauna');
  assert.lt(call, s.indexOf('this._cullOffLiveGround('), 'before the per-player cull');
  assert.gt(call, s.indexOf('const EXTRA_X_COUNT'), 'after the tile stream\'s last draw');
  assert.truthy(/else if \(t === WorldGen\.T\.PIER\) pierCells\.push/.test(s), 'the pier cells come out of the one grid pass');
});

})();
