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
test('shore fauna: the crab is an animal row — art, behaviour, a shell when fed, caught with a shell', () => {
  const art = SpriteLayout.creatureArt('crab');
  assert.truthy(art, 'the crab draws');
  assert.eq(art.sheet, 'crab');
  assert.eq(art.fw, 16);
  assert.truthy(SpriteLayout.creatureWanders('crab'), 'it wanders');
  assert.eq(SpriteLayout.creatureProduce('crab').item, 'shell', 'a fed crab gives the beach pickup');
  assert.truthy(ITEM_BY_ID.crab && ITEM_BY_ID.crab.kind === 'animal', 'a species eligible for the pet roster');
  assert.truthy(ITEM_BY_ID.shiny_crab, 'shiny variant has catalogue art');
  assert.truthy(animalLikesFood('crab', 'shell'), 'a shell is its favourite');
  assert.truthy(ITEM_EFFECTS.minnow, 'the minnow has its own story hint');
  assert.truthy(Combat.isEnemyKind('crab'), 'wild crabs attack');
  assert.falsy(Combat.isEnemy({kind:'crab',id:'pet_crab',pet:true}), 'tamed crabs remain friendly');
  const save = { released: [] }, crab = {kind:'crab',id:'wild_crab'};
  assert.truthy(Pets.likes(crab, 'shell'), 'giving it a shell starts the catch');
  assert.falsy(Combat.isTame(crab), 'a wild crab is not tame');
  assert.truthy(Pets.canCatch(save, crab));
  assert.falsy(SpriteLayout.isGame('crab'), 'never game');
  assert.eq(creatureSpawnClass('crab'), 'enemy', 'a slow shore enemy');
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
    fn.call({ tileEdgeM: NB * CM }, creatures, b.shore, b.pierCells, NB, 3, 4, CM, b.grid, {spawnWhy:b.spawnWhy || new Uint16Array(NB*NB)}, {spawnWhy:b.spawnWhy || new Uint16Array(NB*NB)}, caught, b.coverage, b.entry || null, b.authored || []);
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

test('shore fauna: crabs on shore sand only, gulls on the beach only, counted off the waterline', () => {
  const b = beach();
  const out = seat(b);
  const crabs = out.filter((c) => c.kind === 'crab'), gulls = out.filter((c) => c.kind === 'gull');
  const shore = new Set(b.shore.cells), pier = new Set(b.pierCells);
  const want = (k, lenM) => Math.min(SHORE_FAUNA[k].max, Math.floor(lenM / SHORE_FAUNA[k].perShoreM));
  assert.eq(crabs.length, want('crab', b.shore.shoreM), 'one crab per perShoreM of waterline, capped');
  assert.eq(gulls.length, want('gull', b.shore.shoreM), 'gulls count the beach waterline only');
  assert.gt(crabs.length, 14, 'ordinary beaches have a common crab population');
  for (const c of crabs) assert.eq(c.shiny, faunaShiny(c.kind, c.id), 'hostile crabs retain their animal shiny chance');
  assert.gt(gulls.length, 0);
  for (const c of crabs) {
    assert.truthy(shore.has(cellOf(c)), `crab ${c.id} on shore sand`);
    assert.eq(b.grid[cellOf(c)], T.SAND);
  }
  for (const g of gulls) assert.truthy(shore.has(cellOf(g)), `gull ${g.id} on the beach`);
  for (const c of out) {
    const at = c._habitatSpawn;
    assert.eq(c.id, WorldGen.cellId(c.kind, 3, 4, at.sourceCx, at.sourceCy), 'the canonical cell keeps the saved identity when occupancy relocates its seat');
    assert.truthy(shore.has(at.sourceCy * NB + at.sourceCx) || pier.has(at.sourceCy * NB + at.sourceCx), 'the identity belongs to its raw shore habitat');
  }
  assert.eq(new Set(out.map((c) => c.id)).size, out.length, 'each canonical identity is unique');
  assert.eq(new Set(out.map(cellOf)).size, out.length, 'all shore species share physical seat reservations');
});

test('shore fauna: no shore, no crabs — inland sand and a tile without water hold none', () => {
  const b = beach();
  assert.eq(seat({ ...b, shore: null, pierCells: [] }).length, 0, 'the sandpit alone seats nothing');
  const pierOnly = seat({ ...b, shore: null });
  assert.falsy(pierOnly.some((c) => c.kind === 'crab' || c.kind === 'gull'), 'a pier holds neither crabs nor gulls');
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

// The shoreline length owns abundance; safety removes destinations only.
test('shore fauna: restricted shore holes preserve population counts when legal fringe remains', () => {
  const baseline = seat(beach()), b = beach();
  b.spawnWhy = new Uint16Array(NB * NB);
  for (const i of [...b.shore.cells, ...b.pierCells]) if (Math.floor(i / NB) < 70)
    b.spawnWhy[i] = WorldGen.SPAWN_WHY.RESTRICTED;
  const relocated = seat(b);
  for (const kind of SHORE_FAUNA_ORDER)
    assert.eq(relocated.filter(c => c.kind === kind).length, baseline.filter(c => c.kind === kind).length,
      `${kind}: holes do not suppress the shoreline budget`);
  for (const c of relocated) assert.eq(b.spawnWhy[cellOf(c)], 0, 'shore fauna choose a legal seat');
});

function nativeBeach() {
  const b = beach(); b.coverage = new Uint16Array(NB * NB);
  for (const i of [...b.shore.cells, ...b.pierCells]) b.coverage[i] = 1;
  b.entry = { cellsPerEdge: NB, tileEdgeM: NB * CM, grid: b.grid,
    zone: { coverage: b.coverage, anchors: [
      { key: 'native_beach', kind: 'beach', variant: 'shellwater_strand', gx: 10, gy: 10 }] } };
  return b;
}
// A beach zone claims most of a real beach (any OSM natural=beach), so its
// native list must carry the gull or real beaches have none.
test('shore fauna: Beach Nexus supplies native Crabs, Sea Turtles and Gulls without ordinary shoreline duplication', () => {
  const b = nativeBeach(), creatures = seat(b);
  assert.truthy(creatures.some(c => c.kind === 'sea_turtle'));
  assert.truthy(creatures.some(c => c.kind === 'crab'));
  assert.truthy(creatures.some(c => c.kind === 'gull'));
  assert.truthy(creatures.every(c => ['crab', 'sea_turtle', 'gull'].includes(c.kind)));
  assert.truthy(creatures.every(c => c.id.startsWith('shore_habitat_') && c.zoneVariant === 'shellwater_strand'));
  assert.truthy(b.entry.shorePopulation.every(row => row.key.startsWith('zone:')));
});
test('shore fauna: authored native Crabs satisfy the owner budget even after their saved capture', () => {
  const baseline = seat(nativeBeach()).filter(c => c.kind === 'crab');
  assert.gt(baseline.length, 0);
  const b = nativeBeach();
  b.authored = [{ ...baseline[0], id: 'authored_native_crab' }];
  const generated = seat(b), afterCapture = seat(b, new Set(['authored_native_crab']));
  assert.eq(generated.filter(c => c.kind === 'crab').length, baseline.length - 1);
  assert.eq(generated.map(c => `${c.id}@${c.x},${c.y}`).join('|'),
    afterCapture.map(c => `${c.id}@${c.x},${c.y}`).join('|'), 'capturing the authored animal does not supply a replacement');
  const row = b.entry.shorePopulation.find(row => row.kind === 'crab');
  assert.eq(row.authored, 1);
  assert.eq(row.requested, baseline.length);
});


test('shore fauna: safety relocation preserves canonical identities and captured animals stay gone', () => {
  const original = seat(beach());
  const holes = beach(); holes.spawnWhy = new Uint16Array(NB * NB);
  for (const i of [...holes.shore.cells, ...holes.pierCells]) if (Math.floor(i / NB) < 70)
    holes.spawnWhy[i] = WorldGen.SPAWN_WHY.RESTRICTED;
  const relocated = seat(holes);
  assert.eq(relocated.map(c => c.id).join('|'), original.map(c => c.id).join('|'),
    'safety may move seats, but cannot mint different animal identities');
  const caught = original.find(c => c._habitatSpawn.sourceCy < 70).id;
  const after = seat(holes, new Set([caught]));
  assert.eq(after.map(c => `${c.id}@${c.x},${c.y}`).join('|'),
    relocated.filter(c => c.id !== caught).map(c => `${c.id}@${c.x},${c.y}`).join('|'),
    'an original captured animal stays gone without releasing its relocated seat');
});


test('shore fauna: foreign cave and unresolved Road Variant owners cannot receive ordinary shore populations', () => {
  for (const owner of ['cave', 'road']) {
    const b = nativeBeach(); delete b.entry.zone; b.coverage = null;
    if (owner === 'cave') b.entry.caveAreas = { reserved: new Set([...b.shore.cells, ...b.pierCells]) };
    else b.entry.streetArea = new Uint8Array(NB * NB).fill(1);
    const out = seat(b);
    assert.eq(out.length, 0, `${owner}: absence of a population profile cannot reopen a claimed shore`);
  }
});

})();
