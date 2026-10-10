(() => {
  test('enemy spawns: retired tints leave ordinary pools and surface candidates cap at T3', () => {
    for (const biome of ['GRASS', 'FOREST', 'ROCK', 'SAND', 'FARMLAND', 'RESIDENTIAL', 'PARK', 'COMMERCIAL', 'INDUSTRIAL', 'WETLAND', 'ORCHARD']) {
      const pool = EnemySpawns.surfaceRows(biome);
      for (const row of pool) {
        assert.lte(row.tier, 3);
        assert.truthy(row.surface.biomes.includes(biome));
        assert.falsy(row.attackType === 'touch', 'ghosts use their separate haunt budget');
        if (row.variantType === 'Tint' && row.surface.replaceBase !== false) assert.falsy(pool.some(other => other.id === row.variantOf));
      }
    }
    assert.falsy(EnemySpawns.surfaceRows('ORCHARD').some(row => ['copper_plant', 'bat', 'spider'].includes(row.id)));
    assert.eq(EnemySpawns.surfaceRows('ORCHARD').map(row => row.id).join(','), 'farmer_goblin');
    assert.falsy(EnemySpawns.surfaceRows('WETLAND').some(row => row.id === 'marsh_zombie'));
  });
  test('enemy spawns: ordinary landcover keeps its authored enemy families', () => {
    const pool = biome => EnemySpawns.surfaceRows(biome).map(row => row.id).sort().join(',');
    assert.eq(pool('FOREST'), 'bat,boar,giant_bear,plant,spider');
    assert.eq(pool('ROCK'), 'bat,skeleton,skeleton_soldier');
    assert.eq(pool('COMMERCIAL'), 'club_goblin,goblin,goblin_archer,sword_spirit');
    assert.eq(pool('INDUSTRIAL'), 'ash_zombie,marsh_zombie,zombie');
    assert.eq(pool('FARMLAND'), 'farmer_goblin');
    assert.eq(pool('PARK'), '', 'parks receive their enemies from their Nexus variant');
    assert.eq(pool('RESIDENTIAL'), 'ogre,thief,zombie');
    assert.eq(pool('RESIDENTIAL'), EnemySpawns.surfaceRows('RESIDENTIAL', { nearMinorRoad: true }).map(row => row.id).sort().join(','), 'ordinary road proximity does not choose species');
    for (const kind of ['marsh_zombie', 'ash_zombie']) {
      assert.eq(EnemyRoster.get(kind).surface.time, 'night');
      assert.falsy(EnemySpawns.caveRows(3).some(row => row.id === kind), 'restored industrial variants do not expand cave pools');
    }
  });
  test('enemy spawns: real surface draws share identities across modes and honour saved defeats', () => {
    const body = SPAWN_IN_TILE_SRC.slice(0, SPAWN_IN_TILE_SRC.indexOf('    // (Starter-cow'));
    const generate = spawnPassFn(body + '\nreturn creatures;');
    const run = (mode, caught = []) => {
      const previous = Difficulty.mode();
      Difficulty.setMode(mode);
      try {
        const scene = Object.assign(new SceneCreatures(), { tileEdgeM: 640, save: { caught },
          startWorldM: { x: -5000, y: 0 }, _pestFreeZone: () => null });
        return generate.call(scene, { cellsPerEdge: 64, grid: new Array(4096).fill(WorldGen.T.GRASS), objects: [] }, 0, 0);
      } finally { Difficulty.setMode(previous); }
    };
    const easy = run('easy').filter(c => c._surfaceSpawn);
    const hard = run('hard').filter(c => c._surfaceSpawn);
    const signature = arr => arr.map(c => `${c.id}:${c.kind}:${c.x},${c.y}:${c.shiny}`).join('|');
    assert.gt(easy.length, 30, 'the existing shared enemy budget remains populated');
    assert.lte(easy.length, 50, 'new species divide the budget');
    assert.eq(signature(easy), signature(hard.filter(c => !c._landEnemyReserve)), 'crow mode thinning cannot change subsequent enemy draws');
    assert.gt(hard.length, easy.length, 'hard adds the landcover reserve on top of the shared draws');
    const killed = easy[0].id;
    const after = run('easy', [killed]).filter(c => c._surfaceSpawn);
    assert.eq(signature(after), signature(easy.filter(c => c.id !== killed)), 'a kill suppresses only its own candidate');
  });
  test('enemy spawns: bounded caves never leak ghosts or undeclared giants', () => {
    for (let depth = 1; depth <= 12; depth++) {
      let giants = 0;
      for (let i = 0; i < 1000; i++) {
        const id = EnemySpawns.caveKind(depth, (i + 0.5) / 1000);
        const row = EnemyRoster.get(id);
        assert.truthy(row, `${id} is declared`);
        assert.gte(depth, row.cave.minDepth);
        if (row.cave.maxDepth != null) assert.lte(depth, row.cave.maxDepth);
        assert.falsy(row.attackType === 'touch');
        if (row.variantType === 'Giant') giants++;
      }
      assert.lte(giants, 50, `D${depth}: giants share at most five percent`);
    }
  });
  test('enemy spawns: the safe area — a foe too strong for its distance from Home is absent, never weakened', () => {
    const id = EnemySpawns.surfaceId(0, 0, 10, 10);
    const at = (kind, d) => ({ id, kind, x: d, y: 0, _surfaceSpawn: { x: d, y: 0, tx: 0, ty: 0, cx: 10, cy: 10 } });
    const scene = { save: {}, startWorldM: { x: 0, y: 0 }, _pestFreeZone: () => null };
    const near = at('goblin', 100);
    assert.falsy(EnemySpawns.surfaceActive(scene, near), 'a goblin seat by Home is empty for you');
    assert.falsy(Combat.isEnemy(near), 'and cannot be targeted');
    assert.eq(near.kind, 'goblin', 'never turned into anything else');
    assert.eq(near._hp, undefined, 'nor softened');
    assert.truthy(EnemySpawns.surfaceActive(scene, at('slime', 100)), 'a slime lives by Home');
    assert.falsy(EnemySpawns.surfaceActive(scene, at('skeleton', 100)), 'a T2 waits for 250 m');
    assert.truthy(EnemySpawns.surfaceActive(scene, at('skeleton', 500)), '…and is there from it');
    assert.falsy(EnemySpawns.surfaceActive(scene, at('goblin', 500)), 'a T3 waits for 750 m');
    assert.truthy(EnemySpawns.surfaceActive(scene, at('goblin', 1000)), '…and is there from it');
    assert.falsy(EnemySpawns.surfaceActive(scene, at('giant_skeleton', 1000)), 'a row\'s own minDistance binds too');
    const chaser = at('goblin', 1000);
    chaser.x = 0;
    assert.truthy(EnemySpawns.surfaceActive(scene, chaser), 'measured from the seat: a chaser does not vanish at the door');
    scene._pestFreeZone = () => ({ has: () => true });
    assert.falsy(EnemySpawns.surfaceActive(scene, at('slime', 1000)), 'the pest amnesty still hides every species');
  });
  test('enemy spawns: the safe area holds guards to the same bands, from the ruin', () => {
    const scene = { save: {}, startWorldM: { x: 0, y: 0 } };
    const guard = (kind, d) => ({ id: `lair_${kind}_${d}`, kind, x: d, y: 0, lair: 'L', lairX: d, lairY: 0 });
    assert.falsy(EnemySpawns.surfaceActive(scene, guard('goblin', 100)), 'a fort by Home stands empty');
    assert.falsy(EnemySpawns.surfaceActive(scene, guard('fire_slime', 100)), 'so does a tar yard (Fire Slime is T2)');
    assert.truthy(EnemySpawns.surfaceActive(scene, guard('fire_slime', 400)), 'from 250 m it is held');
    assert.truthy(EnemySpawns.surfaceActive(scene, guard('slime', 50)), 'a wreck\'s slimes stay');
    assert.eq(EnemySpawns.homeAllows('goblin', NaN), true, 'no Home, no safe area');
    assert.eq(typeof EnemySpawns.homeDemote, 'undefined', 'nothing is demoted any more');
  });
  test('enemy spawns: every foe the surface can hold has a distance from which it lives', () => {
    const kinds = new Set([...EnemyRoster.ROWS.filter(r => r.surface).map(r => r.id), 'fire_slime']);
    for (const ladder of Object.values(Lairs.KIND_ORDER)) for (const k of ladder) kinds.add(k);
    for (const kind of kinds) assert.truthy(EnemySpawns.homeAllows(kind, 5000), `${kind} lives somewhere`);
    assert.truthy(EnemySpawns.homeAllows('slime', 0), 'and something lives at Home');
    assert.eq(EnemySpawns.maxTierAt(0), 1); assert.eq(EnemySpawns.maxTierAt(300), 2); assert.eq(EnemySpawns.maxTierAt(900), 3);
  });
  test('enemy spawns: the quiet home hides non-slime garrison guards near Home on easy only', () => {
    const previous = Difficulty.mode();
    // The safe area measures from the starter anchor; put that a world away so
    // this test sees the quiet home alone.
    const scene = { save: {}, startWorldM: { x: 0, y: 0 }, _starterTrailAnchor: () => ({ x: -1e6, y: 0 }), homeWorldPos: () => ({ x: 0, y: 0 }) };
    const guard = (kind, at) => ({ id: `g_${kind}_${at}`, kind, x: at, y: 0, lair: `L${at}`, lairX: at, lairY: 0 });
    const quietM = Difficulty.PROFILES.easy.quietHomeM;
    assert.gt(quietM, 0);
    try {
      Difficulty.setMode('easy');
      const near = guard('skeleton', quietM - 1);
      assert.falsy(EnemySpawns.surfaceActive(scene, near), 'a guard by Home is asleep for you (a T2 the safe area would allow at this distance)');
      assert.falsy(Combat.isEnemy(near), 'and cannot be targeted');
      assert.falsy(EnemySpawns.surfaceActive(scene, guard('giant_skeleton', 10)));
      assert.truthy(EnemySpawns.surfaceActive(scene, guard('slime', 10)), 'a wreck\'s slimes stay');
      assert.truthy(EnemySpawns.surfaceActive(scene, guard('skeleton', quietM + 1)), 'past the ring the fort is held');
      const chaser = guard('skeleton', quietM + 1);
      chaser.x = 0;
      assert.truthy(EnemySpawns.surfaceActive(scene, chaser), 'measured from the ruin, so a chaser does not vanish');
      scene.homeWorldPos = () => null;
      assert.truthy(EnemySpawns.surfaceActive(scene, guard('skeleton', 300)), 'no Home, no quiet ring');
      scene.homeWorldPos = () => ({ x: 0, y: 0 });
      Difficulty.setMode('hard');
      assert.truthy(EnemySpawns.surfaceActive(scene, guard('skeleton', 300)), 'hard has no quiet home');
    } finally { Difficulty.setMode(previous); }
  });
  test('enemy spawns: new cell IDs and old ordinal or roamer defeats survive species changes', () => {
    const saved = new Set(['mon_goblin_4_-1_2_8', 'mon_giant_goblin_archer_4_-1_2_r9_12', 'mon_goblin_5_-1_2_3']);
    const old = EnemySpawns.legacyCaveDefeats(saved, 4, -1, 2);
    assert.truthy(old.pack.has(8));
    assert.falsy(old.pack.has(3));
    assert.truthy(old.cells.has('9_12'));
    assert.eq(EnemySpawns.caveId(4, -1, 2, 9, 12), 'enemy_cave_4_-1_2_9_12');
  });
})();

test('enemy spawns: Nexus ownership replaces ordinary landcover before species selection', () => {
  const entry = { cellsPerEdge: 1, grid: [WorldGen.T.GRASS], zone: { coverage: [1],
    anchors: [{ kind: 'grove', variant: 'mushroom_grove', key: 'grove_test' }] }, streetArea: [1] };
  const owner = HabitatSpawns.resolve(entry, 0);
  assert.eq(owner.zoneSlot, 1);
  assert.truthy(HabitatSpawns.enemyRows(owner.profile, owner.type).some(row => row.id === 'mushroom_monster'));
  assert.falsy(HabitatSpawns.enemyRows(owner.profile, owner.type).some(row => row.id === 'slime'));
});

test('enemy spawns: mini vampire bats are retired from enemy and spawn tables', () => {
  assert.eq(EnemyRoster.get('mini_vampire_bat'), null);
  assert.falsy(Combat.monster('mini_vampire_bat'));
  for (let depth = 1; depth <= 20; depth++) {
    assert.falsy(EnemySpawns.caveRows(depth).some(row => row.id === 'mini_vampire_bat'));
  }
  assert.truthy(EnemyRoster.get('vampire_bat'), 'regular vampire bats remain');
});

test('enemy spawns: evening busy-road suppression hides fixed fauna and enemy seats reversibly', () => {
  const daylight = Lighting.daylight, key = WorldGen.tileKey(321, 654), previous = WorldGen.tileCache.get(key);
  const roadClass = new Uint8Array(4); roadClass[0] = WorldGen.ROAD_CLASS_MAJOR_BUFFER;
  WorldGen.tileCache.set(key, { cellsPerEdge: 2, roadClass });
  const scene = { depth: 0, save: {}, startWorldM: { x: -5000, y: 0 }, _pestFreeZone: () => null };
  try {
    for (const [kind, metadata] of [['rabbit', '_habitatSpawn'], ['slime', '_surfaceSpawn']]) {
      const c = { id: `busy_${kind}`, kind, x: 5000, y: 5000,
        [metadata]: { tx: 321, ty: 654, cx: 0, cy: 0, x: 0, y: 0 } };
      Lighting.daylight = () => 1;
      assert.truthy(EnemySpawns.surfaceActive(scene, c));
      Lighting.daylight = () => .1;
      assert.falsy(EnemySpawns.surfaceActive(scene, c), 'evening suppresses the original seat even after movement');
      assert.truthy(c._busyRoadInactive);
      assert.eq(c.x, 5000); assert.eq(c.y, 5000, 'suppression does not relocate inhabitants');
      Lighting.daylight = () => 1;
      assert.truthy(EnemySpawns.surfaceActive(scene, c), 'daylight restores the same candidate');
      assert.falsy(c._busyRoadInactive);
      if (metadata === '_habitatSpawn') {
        c._surfaceInactive = true;
        Lighting.daylight = () => .1; EnemySpawns.surfaceActive(scene, c);
        Lighting.daylight = () => 1;
        assert.falsy(EnemySpawns.surfaceActive(scene, c), 'an unrelated fauna inactive reason survives the overlay');
      }
    }
    Lighting.daylight = () => .1;
    for (const extra of [{ pet: true }, { lair: 'guard' }, { summoned: true }]) {
      const c = { kind: 'rabbit', _habitatSpawn: { tx: 321, ty: 654, cx: 0, cy: 0 }, ...extra };
      assert.truthy(EnemySpawns.busyRoadAllows(scene, c));
    }
    assert.truthy(EnemySpawns.busyRoadAllows({ ...scene, depth: 1 }, {
      kind: 'rabbit', _habitatSpawn: { tx: 321, ty: 654, cx: 0, cy: 0 } }));
    assert.truthy(EnemySpawns.busyRoadAllows(scene, {
      kind: 'rabbit', _habitatSpawn: { tx: 321, ty: 654, cx: 1, cy: 0 } }), 'ordinary free ground stays active in evening');
  } finally {
    Lighting.daylight = daylight;
    if (previous) WorldGen.tileCache.set(key, previous); else WorldGen.tileCache.delete(key);
  }
});
