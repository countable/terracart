// THE SHORE'S OWN FAUNA — the crab (the chicken of the beach) and the gull
// (a waterfront thief whose swoop takes FOOD out of the bag, not energy).
//   · a KIND is a ROW: art + behaviour in SpriteLayout, hostility only in the
//     roster / monster table (the gull), the spawn class off speed data;
//   · seated by their own rule (scene_creatures.js spawnShoreFauna, off
//     biome_profiles.js SHORE_FAUNA): shore sand (+ piers for the gull), a
//     count that follows the waterline, each species on its own stream, ids
//     from the seat cell;
//   · the gull's snatch is the THIEVES' lane (test/node/thieves.test.js —
//     rosterEnemyAttack → Combat.incomingTheft → scene._losePlayerToThief),
//     shared with the raven's coins: one snatch per bird per UTC day, then
//     it is sated and flies off.
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

test('shore fauna: the gull is a roster foe on the crow\'s sheet, fast, off the board, thieving food not biting', () => {
  const row = EnemyRoster.get('gull');
  assert.truthy(row, 'a roster row');
  assert.eq(row.steals, 'food', 'its damage kind is food — a piece out of the bag (the raven takes the coins)');
  assert.eq(Combat.theftKind('gull'), 'food');
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

// ── The seats ───────────────────────────────────────────────────────────────
// spawnShoreFauna, lifted and RUN on a synthetic beach.
const lift = () => {
  const i = SCENE_SRC.indexOf('  spawnShoreFauna(');
  const j = SCENE_SRC.indexOf('\n  }\n', i);
  return new Function(`return ({ ${SCENE_SRC.slice(i, j + 4)} });`)().spawnShoreFauna;
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
    fn.call({ tileEdgeM: NB * CM }, creatures, b.shore, b.pierCells, NB, 3, 4, CM, b.grid, {}, {}, caught, b.coverage);
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

test('shore fauna: beach nexus coverage excludes ambient shore and pier animals', () => {
  const b = beach(); b.coverage = new Uint16Array(NB * NB);
  for (const i of b.shore.cells) b.coverage[i] = 1;
  for (const i of b.pierCells) b.coverage[i] = 1;
  assert.eq(seat(b).length, 0);
  for (const i of b.shore.cells) if (i < NB * 20) b.coverage[i] = 0;
  const animals = seat(b);
  assert.gt(animals.length, 0);
  assert.truthy(animals.every(c => !b.coverage[cellOf(c)]));
});

})();
