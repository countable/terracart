// LAVA — dungeon level WorldGen.LAVA_DEPTH (5) turns the rock under the town's
// BUILDINGS into lava (T.CAVE_LAVA): the water tile in red, walkable, and it
// burns Combat.LAVA_DMG_PER_S (2) a second off the player's energy and an
// enemy's HP alike. Only that level: the levels above keep rock there, and so
// does every level below (lava overhead reads as WALL to the derivation).

(function () {
const T = WorldGen.T;

test('lava: the numbers', () => {
  assert.eq(WorldGen.LAVA_DEPTH, 5, 'level 5 of the dungeon');
  assert.eq(Combat.LAVA_DMG_PER_S, 2, '2 a second');
  assert.truthy(WorldGen.isWalkable(T.CAVE_LAVA), 'you can walk into it — that is the danger');
  assert.falsy(WorldGen.isWalkable(T.CAVE_WALL), 'unlike rock');
});

test('lava: level 5 turns BUILDING rock to lava — not road or water rock, and no other level', async () => {
  const lat = 49.9;
  const tileEdgeM = WorldGen.tileEdgeMeters(lat);
  const n = WorldGen.cellsPerEdgeForLat(lat);
  const tx = 1003, ty = 2007;
  const grid = new Uint8Array(n * n).fill(T.GRASS);
  const HOUSE = 5 * n + 5, SHOP = 5 * n + 6, CIVIC = 5 * n + 7, ROAD = 9 * n + 9, POND = 12 * n + 12;
  grid[HOUSE] = T.BUILDING; grid[SHOP] = T.BUILDING_MED; grid[CIVIC] = T.BUILDING_LARGE;
  grid[ROAD] = T.ROAD; grid[POND] = T.WATER;
  const surface = { status: 'ready', grid, baseGrid: grid.slice(), cellsPerEdge: n, tileEdgeM, depth: 0,
    objects: [], wildplants: [], parkingTreasures: [], roadLabels: {}, pathUnder: {} };
  const key = WorldGen.Z + '/' + tx + '/' + ty;
  WorldGen.setDepth(0);
  WorldGen.tileCache.set(key, surface);
  try {
    const lv = {};
    for (let d = 1; d <= 6; d++) lv[d] = await WorldGen.loadTile.atDepth(d, tx, ty, lat);
    for (const i of [HOUSE, SHOP, CIVIC]) {
      assert.eq(lv[5].grid[i], T.CAVE_LAVA, `building cell ${i} is lava on level 5`);
      for (const d of [1, 2, 3, 4, 6]) assert.eq(lv[d].grid[i], T.CAVE_WALL, `and rock on level ${d}`);
    }
    for (const i of [ROAD, POND]) {
      for (let d = 1; d <= 6; d++) assert.eq(lv[d].grid[i], T.CAVE_WALL, `road/water cell ${i} is rock on level ${d}`);
    }
    let lava = 0;
    for (let i = 0; i < n * n; i++) if (lv[5].grid[i] === T.CAVE_LAVA) lava++;
    assert.eq(lava, 3, 'exactly the three building cells');
    // Level 6 is exactly what it would be under plain rock: same grid as level 4.
    assert.eq(Array.from(lv[6].grid).join(), Array.from(lv[4].grid).join(), 'level 6 unchanged by the lava above');
    // Nothing generated sits in the lava.
    const N = n, mPerCell = tileEdgeM / n;
    const cellOf = (o) => Math.floor((o.y - ty * tileEdgeM) / mPerCell) * N + Math.floor((o.x - tx * tileEdgeM) / mPerCell);
    for (const o of lv[5].objects.concat(lv[5].wildplants || [])) {
      assert.falsy(lv[5].grid[cellOf(o)] === T.CAVE_LAVA, `${o.kind} ${o.id} is not in the lava`);
    }
  } finally {
    for (let d = 0; d <= 6; d++) { WorldGen.setDepth(d); WorldGen.tileCache.delete(key); }
    WorldGen.setDepth(0);
  }
});

test('lava: drawn as the water tile in red, shore and all', () => {
  assert.truthy(/26: \{ variants: 1, draw: drawLavaTex, animPhases: WATER_ANIM_PHASES, animMs: WATER_ANIM_MS \}/.test(TEXTURES_SRC),
    'one seamless periodic wave, on the water clock');
  assert.truthy(/function drawLavaTex\([^)]*\) \{\s*\n\s*drawWaterTex\(ctx, size, rng, phaseFrac, LAVA_INKS\);/.test(TEXTURES_SRC),
    'the water drawing, in lava inks');
  assert.truthy(/type === WATER \|\| type === LAVA/.test(RENDER_SRC), 'and water\'s shoreline');
});

test('lava: the player burns on the surface and lava level, by the feet, through the one writer', () => {
  const m = SCENE_SRC.match(/\n  _tickLava\(dt\) \{([\s\S]*?)\n  \}\n/);
  assert.truthy(m, '_tickLava exists');
  const b = m[1];
  assert.truthy(/this\.depth !== 0 && this\.depth !== WorldGen\.LAVA_DEPTH/.test(b), 'surface craters and lava level');
  assert.truthy(/Combat\.playerDowned\(this\.save\.energy\)/.test(b), 'never off an empty bar');
  assert.truthy(/this\.playerToWorldCell\(\)/.test(b), 'the feet, not the camera');
  assert.truthy(/Combat\.LAVA_DMG_PER_S \* dt/.test(b), 'at the shared rate');
  assert.truthy(/Conditions\.fireDamage\(this\.save, pips\);[\s\S]*this\._losePlayerEnergy\(damage\)/.test(b), 'banked whole, through Energy.set + the flinch');
  assert.truthy(/this\._popEnergy\(-burned, \{ ix, iy, label: '🔥 lava' \}\)/.test(b), 'popped on its cell');
  assert.truthy(/this\._tickLava\(dt\);/.test(SCENE_SRC), 'and ticked');
});

test('lava: an enemy standing in it burns at the same rate, and the kill is the ground\'s', () => {
  const src = SCENE_SRC;
  assert.truthy(/!isTame && Combat\.isEnemy\(c\) && !Conditions\.fireImmune\(c\) && !Combat\.monster\(c\.kind\)\?\.lavaImmune && \(this\.depth === 0 \|\| this\.depth === WorldGen\.LAVA_DEPTH\)/.test(src), 'enemies, surface and lava level');
  assert.truthy(/under\.type === WorldGen\.T\.CAVE_LAVA\s*\n\s*&& this\._damageEnemy\(c, Combat\.LAVA_DMG_PER_S, 'lava'\)\) return;/.test(src),
    'through _damageEnemy at the shared rate');
  assert.falsy(Combat.isPlayerKill('lava'), 'not a player kill: the bounty coin and nothing else');
});
})();

// Exercise the shipping hazard branch: immunity belongs to the creature, not
// to the infernal region, so ordinary foes crossing that region still burn.
test('lava: demons resist lava while neighbouring mortal enemies still burn', () => {
  const start = SCENE_SRC.indexOf('      if (!isTame && Combat.isEnemy(c) && !Conditions.fireImmune(c)');
  assert.truthy(start >= 0, 'shipping lava branch was found');
  const end = SCENE_SRC.indexOf('      if (enemyFireEscapeTick', start);
  const tick = new Function('c', 'isTame', 'now', SCENE_SRC.slice(start, end));
  const hurt = [];
  const scene = { depth: WorldGen.LAVA_DEPTH, cellAt: () => ({ loaded: true, type: WorldGen.T.CAVE_LAVA }),
    _damageEnemy: (c, dmg) => { hurt.push([c.kind, dmg]); return false; } };
  tick.call(scene, { kind: 'red_demon' }, false, 1000);
  tick.call(scene, { kind: 'skeleton' }, false, 1000);
  assert.eq(hurt.length, 1); assert.eq(hurt[0][0], 'skeleton'); assert.eq(hurt[0][1], Combat.LAVA_DMG_PER_S);
});

test('lava: surface vents burn fractional player time and stop on safe ground', () => {
  const body = SCENE_SRC.match(/\n  _tickLava\(dt\) \{([\s\S]*?)\n  \}\n/)[1];
  const tick = new Function('dt', 'tileCellToAbs', body);
  const key = WorldGen.tileKey(19371, 29371), prior = WorldGen.tileCache.get(key);
  const entry = {cellsPerEdge: 1, grid: new Uint8Array([WorldGen.T.CAVE_LAVA])};
  const scene = {depth: 0, startWorldM: {}, save: {energy: 20},
    playerToWorldCell: () => ({tx: 19371, ty: 29371, cx: 0, cy: 0}),
    _lastLavaFlashT: Infinity, _popEnergy() {}, _ignitePlayer() {},
    _losePlayerEnergy(n) { this.save.energy -= n; return n; }};
  const step = dt => tick.call(scene, dt, () => ({cellIX: 0, cellIY: 0}));
  WorldGen.tileCache.set(key, entry);
  try {
    step(.25); assert.eq(scene.save.energy, 20);
    step(.25); assert.eq(scene.save.energy, 19, 'half a second burns one energy');
    step(.25); entry.grid[0] = WorldGen.T.GRASS; step(.25);
    assert.eq(scene._lavaAccum, 0, 'safe ground clears fractional burn');
    entry.grid[0] = WorldGen.T.CAVE_LAVA; step(.25);
    assert.eq(scene.save.energy, 19, 'old fractional burn does not resume');
    scene.depth = 1; step(1); assert.eq(scene.save.energy, 19);
    scene.depth = 0; scene.save.energy = 0; step(1); assert.eq(scene.save.energy, 0);
  } finally {
    if (prior) WorldGen.tileCache.set(key, prior); else WorldGen.tileCache.delete(key);
  }
});

test('lava: surface vents respect enemy immunity, pets and the shared burn cooldown', () => {
  const start = SCENE_SRC.indexOf('      if (!isTame && Combat.isEnemy(c) && !Conditions.fireImmune(c)');
  assert.truthy(start >= 0, 'shipping lava branch was found');
  const end = SCENE_SRC.indexOf('      if (enemyFireEscapeTick', start);
  const tick = new Function('c', 'isTame', 'now', SCENE_SRC.slice(start, end));
  const hurt = [], scene = {depth: 0,
    cellAt: () => ({loaded: true, type: WorldGen.T.CAVE_LAVA}),
    _damageEnemy: (c, damage, source) => { hurt.push({c, damage, source}); return false; }};
  const mortal = {kind: 'skeleton'};
  tick.call(scene, {kind: 'red_demon'}, false, 1000);
  tick.call(scene, {kind: 'slime'}, true, 1000);
  tick.call(scene, {kind: 'skeleton', fireResistancePotionUntil: Date.now() + 180000}, false, 1000);
  tick.call(scene, mortal, false, 1000); tick.call(scene, mortal, false, 1100);
  assert.eq(hurt.length, 1); assert.eq(hurt[0].source, 'lava');
  assert.eq(hurt[0].damage, Combat.LAVA_DMG_PER_S);
  tick.call(scene, mortal, false, 2000); assert.eq(hurt.length, 2);
});
