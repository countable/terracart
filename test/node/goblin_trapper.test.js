// goblin_trapper.test.js — the GOBLIN TRAPPER and the player's MAGIC TRAP.
//
// What this suite defends:
//
//  1. THE TRAPPER IS A ROW. It is a MONSTERS row (combat.js) — so it is an
//     enemy, has a giant, is warded, pays a bounty — whose `dmg` is 0 and
//     whose `lays` is 'trap'. It never lands a blow: the monster hit/arrow
//     path asks Combat.monsterHits, never `kind === 'goblin_trapper'`. It is
//     the goblin's sheet drawn red (CREATURE_ART tint), and it drops a Magic
//     Trap (CREATURE_BEHAVIOUR drop) ON TOP of its bounty coin.
//  2. ITS SNARES ARE THE EXISTING TRAP, AS SESSION STATE. Traps.layTrap puts
//     an ordinary trap record on entry.laidTraps; trapAt / _tickTraps / the
//     render pass / the disarm kit all see it; springing or disarming it never
//     writes save.sprungTraps / save.disarmedTraps; it expires.
//  3. THE MAGIC TRAP IS PLACED STATE that glows: save.magicTraps (id from the
//     cell), a Lighting.KINDS row with its own collector, a cave-only tier-2
//     find; an ENEMY stepping on it is held (the frost freeze) and hurt as a
//     player kill, and the trap is spent.

(function () {
// wanderCreatures is the SceneCreatures mixin's (scene_creatures.js); the trap
// tick, the magic trap and the rest are app.js's. Lift from both.
const APP = APP_JS_SRC + '\n' + SCENE_CREATURES_SRC;
const liftMethod = (sig) => {
  const start = APP.indexOf('\n  ' + sig);
  const end = start < 0 ? -1 : APP.indexOf('\n  }\n', start);
  if (start < 0 || end < 0) throw new Error(`could not lift ${sig}`);
  return APP.slice(start + 1, end + 4);
};
const liftLine = (re, what) => {
  const m = APP.match(re);
  if (!m) throw new Error(`could not lift ${what}`);
  return m[0];
};

// ── 1. The row ────────────────────────────────────────────────────────────
test('trapper: a MONSTERS row that lands no blow and lays a trap', () => {
  const row = Combat.monster('goblin_trapper');
  assert.truthy(row, 'registered in the monster table');
  assert.truthy(Combat.isEnemyKind('goblin_trapper'), 'so it is an enemy (wards, bounty, auto-fire)');
  assert.eq(row.dmg, 0, 'no blow of its own');
  assert.falsy(Combat.monsterHits('goblin_trapper'), 'monsterHits says so');
  assert.truthy(Combat.monsterHits('goblin') && Combat.monsterHits('goblin_archer'), 'the others still hit');
  assert.eq(Combat.monsterLays('goblin_trapper'), 'trap', 'it lays a trap');
  assert.eq(Combat.monsterLays('goblin'), null, 'nothing else does');
  // A giant is derived, and inherits the habit.
  assert.truthy(Combat.isEnemyKind('giant_goblin_trapper'), 'it has a giant');
  assert.eq(Combat.monsterLays('giant_goblin_trapper'), 'trap', 'which lays too');
  assert.falsy(Combat.monsterHits('giant_goblin_trapper'), 'and never hits');
  assert.gte(row.minDepth, Combat.monster('goblin_archer').minDepth,
    'met no shallower than the archer (the garrison ladder never runs backwards)');
  assert.gt(Combat.enemyBounty('goblin_trapper', row.minDepth), 0, 'and it pays a bounty');
});

test('trapper: the goblin sheet drawn red, and a Magic Trap on its kill', () => {
  const SL = SpriteLayout;
  assert.eq(SL.creatureSheet('goblin_trapper'), SL.creatureSheet('goblin'), 'the goblin\'s own art');
  assert.eq(SL.creatureTint('goblin_trapper'), SL.TRAPPER_TINT, 'tinted apart from it');
  assert.truthy(SL.creatureTint('goblin') !== SL.TRAPPER_TINT, 'the plain goblin wears its own colours');
  // Red: the tint keeps the red channel and cuts green and blue.
  const t = SL.TRAPPER_TINT;
  assert.eq((t >> 16) & 255, 255, 'full red');
  assert.lt((t >> 8) & 255, 128, 'green cut');
  assert.lt(t & 255, 128, 'blue cut');
  // One body, one ground line: every geometry column matches the goblin's.
  const a = SL.CREATURE_ART.goblin_trapper, g = SL.CREATURE_ART.goblin;
  for (const k of ['fw', 'fh', 'scale', 'foot', 'float', 'minY', 'maxY', 'frames'])
    assert.eq(a[k], g[k], `${k} matches the goblin row`);
  assert.eq(SL.creatureDrop('goblin_trapper'), 'magic_trap', 'its kill drops a Magic Trap');
  assert.truthy(SL.creatureWanders('goblin_trapper'), 'and it thinks');
});

test('trapper: the third rung of the fort and castle garrison', () => {
  for (const tier of [11, 12]) {
    assert.eq(Lairs.KIND_ORDER[tier].join(), 'goblin,goblin_archer,goblin_trapper', `tier ${tier}`);
    assert.eq(Lairs.kindsAt(tier, 0.5).indexOf('goblin_trapper'), -1, 'not in a middling ruin');
    assert.truthy(Lairs.kindsAt(tier, 1).includes('goblin_trapper'), 'but in a strong one');
  }
  assert.falsy(Lairs.KIND_ORDER[9].includes('goblin_trapper'), 'a wreck is still slimes');
});

test('trapper: the hit and the arrow ask the row, never the kind', () => {
  const start = APP.indexOf('  wanderCreatures() {');
  const w = APP.slice(start, APP.indexOf('\n  }\n', start));
  assert.truthy(/const hits = Combat\.monsterHits\(c\.kind\);/.test(w), 'the attack reads monsterHits');
  assert.truthy(/const clear = hits && \(m\.range <= 1 \|\|/.test(w), 'and both halves are behind it');
  assert.falsy(/goblin_trapper/.test(w), 'no kind literal in the sim loop');
  assert.truthy(/if \(Combat\.monsterLays\(c\.kind\) && !isTame && !unnoticed && !standDown\) \{\s*\n\s*this\._trapperLay\(c, now, px, py\);/.test(w),
    'laying is gated like a blow: unnoticed (NOTHING HUNTS A BODY) and standDown (wards, rest)');
});

// ── The trapper, simmed through the REAL wanderCreatures ───────────────────
const CELL = 7;
function trapperScene(creature, over = {}) {
  const scene = Object.assign({
    cellM: CELL, depth: 3,
    save: { energy: 100, caught: [], armor: {}, planted: [], fires: [], released: [] },
    startWorldM: { x: 0, y: 0 }, playerM: { x: 0, y: 0 },
    originPx: { x: 0, y: 0 }, mPerPx: CELL, cellsPerTile: WorldGen.TILE_PX,
    viewCenterX: 0, viewCenterY: 0, _shots: [],
    isShadowActive: () => false,
    isUnnoticed() { return this.isShadowActive() || Combat.playerDowned(this.save.energy); },
    homeWorldPos: () => null,
    _castleWardPoints: () => [],
    playerToWorldCell: () => ({ tx: 0, ty: 0, ix: 0, iy: 0 }),
    cellAt: () => ({ loaded: true, type: 0 }),
    _cellBlocked: () => false,
    _nearAny: () => false,
    placedRockSet: null, resolveDefeat: () => {},
    _popEnergy: () => {}, _warnIfTiring: () => {}, _flashPlayerHit: () => {}, _closeShopOnHit: () => {},
    _losePlayerEnergy(d) { const b = this.save.energy ?? 0; this.save.energy = Math.max(0, b - d); return b - this.save.energy; },
    updateEnergyDOM: () => {}, flash: () => {}, _wildCrowTick: () => {},
    lays: 0,
    _trapperLay() { this.lays++; },
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
const run = (scene, s) => { for (let t = 0; t < s * 1000; t += 250) tick(scene, 250); };
const cellsOff = (c) => Math.hypot(c.x, c.y) / CELL;

test('trapper sim: in contact it never takes a point off the bar, and it lays', () => {
  const g = { kind: 'goblin_trapper', id: 'mon_trap_sim_1', x: 0.5 * CELL, y: 0, _wanderOffInMs: 1e12 };
  const scene = trapperScene(g);
  run(scene, 30);
  assert.eq(scene.save.energy, 100, 'thirty seconds beside it and not one point gone');
  assert.eq(scene._shots.length, 0, 'and no arrow either');
  assert.gt(scene.lays, 0, 'it tried to lay');
  // It HOLDS ITS DISTANCE: started half a cell off, it backs out to its ring.
  assert.gt(cellsOff(g), 1.5, `it backed off to ${cellsOff(g).toFixed(2)} cells`);
  // The control: a plain goblin in the same spot bites.
  const gob = { kind: 'goblin', id: 'mon_trap_sim_2', x: 0.5 * CELL, y: 0, _wanderOffInMs: 1e12 };
  const s2 = trapperScene(gob);
  run(s2, 10);
  assert.lt(s2.save.energy, 100, 'the control: a goblin in contact does bite');
});

test('trapper sim: nothing lays for a body — an empty bar is unnoticed', () => {
  const g = { kind: 'goblin_trapper', id: 'mon_trap_sim_3', x: 2 * CELL, y: 0, _wanderOffInMs: 1e12 };
  const scene = trapperScene(g, { save: { energy: 0, caught: [], armor: {}, planted: [], fires: [], released: [] } });
  run(scene, 20);
  assert.eq(scene.lays, 0, 'a downed player is not there to lay for');
  const s2 = trapperScene({ kind: 'goblin_trapper', id: 'mon_trap_sim_4', x: 2 * CELL, y: 0, _wanderOffInMs: 1e12 },
    { isShadowActive: () => true });
  run(s2, 20);
  assert.eq(s2.lays, 0, 'nor a shadowed one');
});

// ── 2. Laid snares: the existing trap, as session state ───────────────────
const N = 20, EDGE = N * CELL;
function mkEntry(over = {}) {
  return Object.assign({
    cellsPerEdge: N, tileEdgeM: EDGE,
    grid: new Uint8Array(N * N),            // 0: walkable grass
    roadMask: new Uint8Array(N * N),
    _spawnOpts: { occupied: new Set() },
    traps: [],
  }, over);
}

test('laid traps: layTrap puts an ordinary trap record on entry.laidTraps', () => {
  const e = mkEntry();
  const t = Traps.layTrap(e, 2, 3, EDGE, 5, 6, 'mon_x', 1000, 2);
  assert.eq(e.laidTraps.length, 1, 'on its own list');
  assert.eq(e.traps.length, 0, 'never in the generated one');
  assert.eq(t._ix, 5); assert.eq(t._iy, 6);
  assert.eq(t.x, 2 * EDGE + 5.5 * CELL, 'the cell centre in world metres, like a generated trap');
  assert.eq(t.id, 'laid_d2_2_3_5_6', 'level + tile + cell');
  assert.eq(t._by, 'mon_x');
  assert.eq(t._expiresAt, 1000 + Traps.LAID_LIFE_MS, 'it expires');
  assert.eq(Traps.trapAt(e, 5, 6, 1000), t, 'trapAt finds it');
  assert.eq(Traps.trapAt(e, 5, 6, 1000 + Traps.LAID_LIFE_MS), null, 'until it has expired');
});

test('laid traps: springing and disarming never touch the save', () => {
  const e = mkEntry();
  const save = {};
  const t = Traps.layTrap(e, 0, 0, EDGE, 1, 1, 'mon_y', 0, 0);
  assert.falsy(Traps.isTrapSprung(save, t));
  assert.truthy(Traps.springTrap(save, t), 'the first contact springs it');
  assert.falsy(Traps.springTrap(save, t), 'once');
  assert.truthy(Traps.isTrapSprung(save, t));
  assert.truthy(Traps.disarmTrap(save, t), 'a kit shuts it');
  assert.truthy(Traps.isTrapDisarmed(save, t));
  assert.falsy(Traps.isLive(t, 0), 'a disarmed snare is out of play');
  assert.eq(save.sprungTraps, undefined, 'no sprung id minted');
  assert.eq(save.disarmedTraps, undefined, 'no disarmed id minted');
  // A GENERATED trap still goes through the save, as it always has.
  const gen = { id: 'trap_0_0_4_4', _ix: 4, _iy: 4 };
  assert.truthy(Traps.springTrap(save, gen));
  assert.eq(save.sprungTraps.join(), 'trap_0_0_4_4', 'the generated one is recorded by id');
  assert.truthy(Traps.disarmTrap(save, gen));
  assert.eq(save.disarmedTraps.join(), 'trap_0_0_4_4');
});

test('laid traps: canLay is walkable, off the road, under nothing, no trap there', () => {
  const e = mkEntry();
  assert.truthy(Traps.canLay(e, 3, 3), 'open grass');
  e.roadMask[3 * N + 4] = 1;
  assert.falsy(Traps.canLay(e, 4, 3), 'not under the drawn road band');
  e._spawnOpts.occupied.add(3 * N + 5);
  assert.falsy(Traps.canLay(e, 5, 3), 'not under a seated object');
  e.grid[3 * N + 6] = WorldGen.T.WATER;
  assert.falsy(Traps.canLay(e, 6, 3), 'not in water');
  e.traps.push({ id: 'trap_g', _ix: 7, _iy: 3 });
  assert.falsy(Traps.canLay(e, 7, 3), 'not on a generated trap');
  Traps.layTrap(e, 0, 0, EDGE, 8, 3, 'm', Date.now(), 0);
  assert.falsy(Traps.canLay(e, 8, 3), 'not on a laid one');
  assert.falsy(Traps.canLay(e, -1, 3), 'not off the tile');
  const cave = mkEntry();
  cave.grid.fill(WorldGen.T.CAVE_FLOOR);
  assert.truthy(Traps.canLay(cave, 3, 3), 'cave floor takes one');
  cave.grid[3 * N + 4] = WorldGen.T.CAVE_WALL;
  assert.falsy(Traps.canLay(cave, 4, 3), 'a cave wall does not');
});

test('laid traps: pruned in place when spent, and counted per trapper', () => {
  const e = mkEntry();
  const a = Traps.layTrap(e, 0, 0, EDGE, 1, 1, 'A', 0, 0);
  const b = Traps.layTrap(e, 0, 0, EDGE, 2, 1, 'A', 5000, 0);
  Traps.layTrap(e, 0, 0, EDGE, 3, 1, 'B', 5000, 0);
  assert.eq(Traps.laidOut([e], 'A', 1000), 2, 'A has two out');
  b._sprung = true;
  assert.eq(Traps.laidOut([e], 'A', 1000), 1, 'a sprung jaw no longer counts toward the cap');
  const left = Traps.pruneLaid(e, Traps.LAID_LIFE_MS + 1);
  assert.eq(left, 2, 'the first one expired');
  assert.truthy(a._gone, 'and is flagged for anyone still holding it');
  assert.eq(e.laidTraps.indexOf(a), -1, 'compacted out');
});

test('laid traps: the points tried are strictly between the bodies, midpoint first', () => {
  const pts = Traps.layPoints(0, 0, 4 * CELL, 0, CELL);
  assert.eq(pts.length, 3, 'three cells between two bodies four cells apart');
  assert.eq(pts[0].x, 2 * CELL, 'the midpoint first');
  for (const p of pts) assert.truthy(p.x > 0 && p.x < 4 * CELL, 'never an endpoint');
  assert.eq(Traps.layPoints(0, 0, CELL, 0, CELL).length, 0, 'adjacent: nowhere between');
});

test('laid traps: every consumer reads both lists — tick, draw, kit, rebuild', () => {
  const tick = APP.slice(APP.indexOf('  _tickTraps(dt) {'));
  assert.truthy(/if \(trap\._laid && !Traps\.isLive\(trap, Date\.now\(\)\)\) \{ this\._trapHere = null; return; \}/.test(tick.slice(0, 5000)),
    'an expired snare under the feet stops biting');
  assert.truthy(/Traps\.springTrap\(this\.save, trap\)/.test(tick.slice(0, 6000)), 'the bite springs either kind');
  assert.truthy(/for \(const tr of entry\.laidTraps\)/.test(RENDER_SRC), 'the render pass draws them');
  assert.truthy(/sprung: !!tr\._sprung/.test(RENDER_SRC), 'in the sprung texture once sprung');
  assert.truthy(/Traps\.disarmTrap\(save, trap\)/.test(INTERACT_SRC), 'the kit shuts them');
  assert.truthy(/if \(prev\.laidTraps && !fresh\.laidTraps\) fresh\.laidTraps = prev\.laidTraps;/.test(ALL_SRC['worldgen.js']),
    'a tile rebuilt under the player carries them, like the coins');
});

// _trapperLay, lifted and RUN on a one-tile stub.
const makeLay = new Function('TRAPPER_LAY_MS', 'TRAPPER_LAY_SLACK_CELLS', 'absCellCenterMeters',
  `return {\n${liftMethod('_trapperLay(c, now, px, py) {')}\n};`);
function layScene(entry, over = {}) {
  // The cadence is pinned as source below (the archer's arrow beat).
  const LAY_MS = Combat.MONSTER_SHOT_INTERVAL_MS;
  const SLACK = Number(liftLine(/const TRAPPER_LAY_SLACK_CELLS = (\d+);/, 'slack').match(/(\d+);/)[1]);
  const methods = makeLay(LAY_MS, SLACK, (s, ix, iy) => ({ x: (ix + 0.5) * CELL, y: (iy + 0.5) * CELL }));
  const cellAt = (x, y) => {
    const ix = Math.floor(x / CELL), iy = Math.floor(y / CELL);
    return { tx: 0, ty: 0, ix, iy, cellIX: ix, cellIY: iy, loaded: true };
  };
  return Object.assign(Object.create(methods), {
    cellM: CELL, tileEdgeM: EDGE, depth: 2, save: { magicTraps: [] },
    playerToWorldCell: () => ({ tx: 0, ty: 0, cx: 1.5, cy: 5.5 }),
    cellAt,
  }, over);
}
function withTile0(entry, fn) {
  const key = WorldGen.tileKey(0, 0);
  const had = WorldGen.tileCache.get(key);
  WorldGen.tileCache.set(key, entry);
  try { return fn(); } finally {
    if (had) WorldGen.tileCache.set(key, had); else WorldGen.tileCache.delete(key);
  }
}

test('trapper lays: on the empty cell midway, up to its cap, on the cadence', () => {
  const e = mkEntry();
  withTile0(e, () => {
    const scene = layScene(e);
    const g = { kind: 'goblin_trapper', id: 'mon_lay_1', x: 5.5 * CELL, y: 5.5 * CELL };
    const px = 1.5 * CELL, py = 5.5 * CELL;          // four cells west
    scene._trapperLay(g, 0, px, py);
    assert.eq((e.laidTraps || []).length, 1, 'one snare down');
    const t = e.laidTraps[0];
    assert.eq(`${t._ix},${t._iy}`, '3,5', 'on the cell midway between them');
    assert.eq(t.id, 'laid_d2_0_0_3_5', 'at the scene\'s depth');
    scene._trapperLay(g, 1, px, py);
    assert.eq(e.laidTraps.length, 1, 'not again before its cadence');
    for (let k = 1; k < 10; k++) scene._trapperLay(g, k * Combat.MONSTER_SHOT_INTERVAL_MS, px, py);
    assert.eq(e.laidTraps.length, Traps.LAID_MAX, `never more than ${Traps.LAID_MAX} out`);
    for (const s of e.laidTraps) {
      assert.truthy(!(s._ix === 1 && s._iy === 5), 'never the player\'s cell');
      assert.truthy(!(s._ix === 5 && s._iy === 5), 'never its own');
    }
    assert.eq(e.traps.length, 0, 'the generated list is untouched');
  });
});

test('trapper lays: never on a Magic Trap, never out of its range', () => {
  const e = mkEntry();
  withTile0(e, () => {
    const scene = layScene(e, { save: { magicTraps: [
      { id: 'mtrap_d2_0_0_3_5', x: 3.5 * CELL, y: 5.5 * CELL, depth: 2 },
      { id: 'mtrap_d2_0_0_2_5', x: 2.5 * CELL, y: 5.5 * CELL, depth: 2 },
      { id: 'mtrap_d2_0_0_4_5', x: 4.5 * CELL, y: 5.5 * CELL, depth: 2 },
    ] } });
    const g = { kind: 'goblin_trapper', id: 'mon_lay_2', x: 5.5 * CELL, y: 5.5 * CELL };
    scene._trapperLay(g, 0, 1.5 * CELL, 5.5 * CELL);
    assert.eq((e.laidTraps || []).length, 0, 'every cell between holds the player\'s trap');
    const far = { kind: 'goblin_trapper', id: 'mon_lay_3', x: 19.5 * CELL, y: 5.5 * CELL };
    const s2 = layScene(e);
    s2._trapperLay(far, 0, 1.5 * CELL, 5.5 * CELL);
    assert.eq((e.laidTraps || []).length, 0, 'eighteen cells off is out of range');
  });
});

// ── 3. The Magic Trap ─────────────────────────────────────────────────────
test('magic trap: a tier-2, cave-only consumable with its own ✦ line', () => {
  const it = ITEM_BY_ID.magic_trap;
  assert.truthy(it, 'registered');
  assert.eq(it.kind, 'consumable');
  assert.eq(it.baseTier, 2, 'tier 2');
  assert.truthy(it.caveOnly, 'cave only');
  assert.gt(PRICES.magic_trap, 0, 'priced');
  assert.truthy(MINERAL_ICON_SHEET.magic_trap, 'it has an icon');
  const line = ITEM_EFFECTS.magic_trap;
  assert.truthy(line && line.length <= 55, `a ✦ line within 55 chars (${line && line.length})`);
  // Never in the surface pool: no chest, X or shop draws it from class/tier.
  for (const byT of Object.values(ITEMS_BY_CLASS_TIER))
    for (const ids of Object.values(byT)) assert.falsy(ids.includes('magic_trap'), 'not in the class/tier pool');
  assert.truthy(CAVE_SUPPLY_SKEW.favourite.ids.magic_trap > 0, 'the cave supplies reach it');
});

function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
test('magic trap: a shallow cave chest pays one, a surface chest never does', () => {
  const count = (depth) => {
    const rng = seeded(606 + depth);
    let n = 0;
    for (let i = 0; i < 6000; i++) {
      const r = pickReward('chest:park', { relics: {}, armor: {} }, rng, { tier: 2, depth });
      if (r && r.kind === 'item' && r.id === 'magic_trap') n++;
    }
    return n;
  };
  assert.eq(count(0), 0, 'never on the surface');
  assert.gt(count(1), 0, 'underground, now and then');
});

test('magic trap: a magenta light row, collected like the campfires', () => {
  const row = Lighting.KINDS.magic_trap;
  assert.truthy(row, 'a row in Lighting.KINDS');
  const r = (row.colour >> 16) & 255, g = (row.colour >> 8) & 255, b = row.colour & 255;
  assert.truthy(r > 200 && b > 150 && g < 100, 'magenta: red and blue, no green');
  assert.eq(row.pulse, Lighting.KINDS.poi.pulse, 'it breathes on the POI\'s slow beat');
  assert.lt(Lighting.radiusCells('magic_trap'), Lighting.radiusCells('poi'), 'smaller than a POI');
  assert.eq(Lighting.sourceKind({}, { kind: '_magic_trap' }), 'magic_trap', 'sourceKind names it');
  const scene = {
    depth: 1, cellM: 5,
    save: { magicTraps: [
      { id: 'mtrap_d1_0_0_1_1', x: 3, y: 4, depth: 1 },
      { id: 'mtrap_d0_0_0_1_1', x: 3, y: 4, depth: 0 },
      { id: 'mtrap_d1_0_0_90_1', x: 900, y: 4, depth: 1 },
    ] },
  };
  Lighting.beginFrame(scene);
  assert.eq(Lighting.collectMagicTraps(scene, 0, 0, 30), 1, 'this level, in range: one');
  assert.eq(scene._lights[0].kind, 'magic_trap');
  assert.eq(scene._lights[0].id, 'mtrap_d1_0_0_1_1', 'keyed by the trap id, so frameKey moves when one goes');
  const d = LIGHTING_SRC.slice(LIGHTING_SRC.indexOf('  function draw(scene, ax, ay, halfM) {'));
  assert.truthy(/collectMagicTraps\(scene, ax, ay, halfM\);/.test(d), 'draw() collects them every frame');
  assert.truthy(/for \(const mt of PlacedFloor\.forDepth\(scene\.save\.magicTraps, _curDepth\)\)/.test(RENDER_SRC),
    'and a tinted scuff marks the cell on the trap layer (it lies on the ground)');
});

test('magic trap: placed on an empty cell, the id from the cell, never a clock', () => {
  const src = INTERACT_SRC.slice(INTERACT_SRC.indexOf("{ name: 'place-magic-trap'"),
    INTERACT_SRC.indexOf("{ name: 'place-rock'"));
  assert.truthy(/sel\.id === 'magic_trap'/.test(src), 'armed by the item');
  assert.truthy(/Traps\.canLay\(entry, cell\.ix, cell\.iy\)/.test(src), 'the one "can a trap sit here" test');
  assert.truthy(/id: Traps\.magicTrapId\(scene\.depth, cell\.tx, cell\.ty, cell\.ix, cell\.iy\)/.test(src),
    'the id is the level + tile + local cell');
  assert.truthy(/PlacedFloor\.stampDepth\(/.test(src), 'stamped with its level');
  assert.falsy(/Date\.now|Math\.random/.test(src), 'no clock, no dice');
  assert.truthy(/consumeSelected\(save\)/.test(src), 'spends one');
  assert.eq(Traps.magicTrapId(2, 5, -3, 7, 8), 'mtrap_d2_5_-3_7_8');
});

// _tickMagicTraps, lifted and RUN.
const makeTick = new Function('MAGIC_TRAP_TICK_MS', 'MAGIC_TRAP_HOLD_MS', 'magicTrapDamage',
  'worldMetersToAbsCell', 'cellKeyFromAbsCell', 'persistSave', 'CELL_PX',
  `return {\n${liftMethod('_tickMagicTraps() {')}\n};`);
function tickScene(creatures, traps) {
  const hold = Combat.fireIntervalMs('staff');
  const dmgFn = () => Combat.shotDamage({ bow: { tier: BASE_TIER.magic_trap } }, 'bow');
  const methods = makeTick(100, hold, dmgFn,
    (s, x, y) => ({ cellIX: Math.floor(x / CELL), cellIY: Math.floor(y / CELL) }),
    (a, b) => `${a}_${b}`, () => {}, 32);
  const hits = [];
  const scene = Object.assign(Object.create(methods), {
    depth: 1, startWorldM: { x: 0, y: 0 }, save: { caught: [], magicTraps: traps },
    playerToWorldCell: () => ({ tx: 0, ty: 0 }),
    _damageEnemy: (c, amount, source) => { hits.push({ c, amount, source }); return false; },
    _cellToastAt: () => ({ x: 0, y: 0 }), flash: () => {},
  });
  return { scene, hits, run() {
    const real = WorldGen.forEachItemNear;
    WorldGen.forEachItemNear = (what, tx, ty, fn) => { if (what === 'creatures') creatures.forEach((c) => fn(c)); };
    try { scene._tickMagicTraps(); } finally { WorldGen.forEachItemNear = real; }
  } };
}

test('magic trap: an ENEMY on the cell is held and hurt as a player kill; the trap is spent', () => {
  const trap = { id: 'mtrap_d1_0_0_3_3', x: 3.5 * CELL, y: 3.5 * CELL, depth: 1 };
  const other = { id: 'mtrap_d1_0_0_9_9', x: 9.5 * CELL, y: 9.5 * CELL, depth: 1 };
  const foe = { kind: 'goblin', id: 'mon_mt_1', x: 3.2 * CELL, y: 3.8 * CELL };
  const deer = { kind: 'deer', id: 'deer_mt', x: 9.5 * CELL, y: 9.5 * CELL };
  const { scene, hits, run } = tickScene([foe, deer], [trap, other]);
  const before = Date.now();
  run();
  assert.eq(hits.length, 1, 'one hit — the deer on the other trap is game, never a target');
  assert.eq(hits[0].c, foe);
  assert.eq(hits[0].source, 'player', 'the player set it: a trap kill is a player kill');
  assert.eq(hits[0].amount, Combat.shotDamage({ bow: { tier: 2 } }, 'bow'), 'one tier-2 bow shot');
  assert.gte(foe._frozenUntil, before + Combat.fireIntervalMs('staff'), 'held one staff beat (the frost freeze)');
  assert.eq(scene.save.magicTraps.map((t) => t.id).join(), other.id, 'the sprung trap is spent, the other kept');
  // A tamed slime is a pet, never a target.
  const pet = { kind: 'slime', id: 'released_slime_1', x: 9.5 * CELL, y: 9.5 * CELL };
  const t2 = tickScene([pet], [{ ...other }]);
  t2.run();
  assert.eq(t2.hits.length, 0, 'a pet walks over it');
  // Another level's trap is not armed here.
  const t3 = tickScene([{ kind: 'goblin', id: 'mon_mt_2', x: 3.5 * CELL, y: 3.5 * CELL }],
    [{ ...trap, depth: 0 }]);
  t3.run();
  assert.eq(t3.hits.length, 0, 'only this level\'s traps spring');
});

test('magic trap: the numbers are derived from the tables they stand for', () => {
  assert.truthy(/const MAGIC_TRAP_HOLD_MS = Combat\.fireIntervalMs\('staff'\);/.test(APP), 'hold = one staff beat');
  assert.truthy(/return Combat\.shotDamage\(\{ bow: \{ tier: BASE_TIER\.magic_trap \} \}, 'bow'\);/.test(APP),
    'damage = one bow shot at the item\'s own tier');
  assert.truthy(/const TRAPPER_LAY_MS = Combat\.MONSTER_SHOT_INTERVAL_MS;/.test(APP), 'the lay cadence is the archer\'s');
  assert.truthy(/this\._tickMagicTraps\(\);/.test(APP), 'the scan runs in update()');
});

// The kill: the drop AND the coin.
const METHODS = [
  "resolveDefeat(victim, source = 'player') {",
  '_dropBountyCoin(victim, amount) {',
].map(liftMethod).join(',\n');
const makeKill = new Function('grantTreasureRoll', 'Quests', 'persistSave', `return {\n${METHODS}\n};`);
test('trapper: its kill drops a Magic Trap ON TOP of the bounty coin — for the player only', () => {
  const key = WorldGen.tileKey(7311, 4111);
  const had = WorldGen.tileCache.get(key);
  const entry = { cellsPerEdge: 200, tileEdgeM: 1000, creatures: [] };
  WorldGen.tileCache.set(key, entry);
  try {
    for (const [source, wantDrop] of [['player', true], ['pet', true], ['turret', false]]) {
      entry.coinDrops = [];
      const inv = [];
      const methods = makeKill(() => {}, { onKill: () => false }, () => {});
      const scene = Object.assign(Object.create(methods), {
        save: { money: 0, caught: [] }, depth: 3, tileEdgeM: 1000, cellsPerTile: 200,
        viewCenterX: 0, viewCenterY: 0,
        addToInv: (id) => inv.push(id), flash: () => {}, flashLoot: () => {}, flashShiny: () => {},
        awardShinyBonus: () => {}, _bankDiscovery: () => false,
      });
      const v = { kind: 'goblin_trapper', id: `mon_tr_${source}`, x: 7311 * 1000 + 12, y: 4111 * 1000 + 17 };
      const realRandom = Math.random;
      Math.random = () => 0.99;                     // no treasure roll in the way
      try { scene.resolveDefeat(v, source); } finally { Math.random = realRandom; }
      assert.eq(entry.coinDrops.length, 1, `${source}: the bounty coin falls`);
      assert.eq(inv.includes('magic_trap'), wantDrop, `${source}: the Magic Trap ${wantDrop ? 'is' : 'is not'} paid`);
    }
  } finally {
    if (had) WorldGen.tileCache.set(key, had); else WorldGen.tileCache.delete(key);
  }
});

test('trapper: the Book says what no item can — it lays, and what it pays', () => {
  const i = PLAY_TIPS.findIndex((t) => /red goblin/i.test(t));
  assert.gte(i, 0, 'a tip about the trapper');
  const goblins = PLAY_TIPS.findIndex((t) => /^Goblins hold the deep/.test(t));
  assert.eq(i, goblins + 1, 'right after the goblins are introduced (the underground section)');
});
})();
