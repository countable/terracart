(() => {
  test('enemy spawns: biome tints replace parents and ordinary surface candidates cap at T3', () => {
    for (const biome of ['GRASS', 'FOREST', 'ROCK', 'SAND', 'FARMLAND', 'RESIDENTIAL', 'PARK', 'COMMERCIAL', 'INDUSTRIAL', 'WETLAND', 'ORCHARD']) {
      const pool = EnemySpawns.surfaceRows(biome);
      for (const row of pool) {
        assert.lte(row.tier, 3);
        assert.truthy(row.surface.biomes.includes(biome));
        assert.falsy(row.attackType === 'touch', 'ghosts use their separate haunt budget');
        if (row.variantType === 'Tint') assert.falsy(pool.some(other => other.id === row.variantOf));
      }
    }
    assert.truthy(EnemySpawns.surfaceRows('ORCHARD').some(row => row.id === 'copper_plant'));
    assert.falsy(EnemySpawns.surfaceRows('ORCHARD').some(row => row.id === 'plant'));
    assert.truthy(EnemySpawns.surfaceRows('WETLAND').some(row => row.id === 'marsh_zombie'));
  });
  test('enemy spawns: real surface draws share identities across modes and honour saved defeats', () => {
    const body = SPAWN_IN_TILE_SRC.slice(0, SPAWN_IN_TILE_SRC.indexOf('    // (Starter-cow'));
    const generate = new Function('entry', 'tx', 'ty', body + '\nreturn creatures;');
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
    assert.eq(signature(easy), signature(hard), 'crow mode thinning cannot change subsequent enemy draws');
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
  test('enemy spawns: Home DEMOTES a wild foe for this player — never hides it, never re-rolls it', () => {
    const id = EnemySpawns.surfaceId(0, 0, 10, 10);
    const at = (d) => ({ id, kind: 'goblin', x: d, y: 0, _surfaceSpawn: { x: d, y: 0, tx: 0, ty: 0, cx: 10, cy: 10 } });
    const scene = { save: {}, startWorldM: { x: 0, y: 0 }, _pestFreeZone: () => null };
    const near = at(100);
    assert.truthy(EnemySpawns.surfaceActive(scene, near), 'a goblin seat by Home is live…');
    assert.eq(near.kind, 'slime', '…as a T1 slime inside 250 m');
    assert.eq(near._genKind, 'goblin', 'the world\'s kind is kept');
    assert.eq(near.id, id, 'same seat, same id — a kill spends the same record');
    assert.truthy(Combat.isEnemy(near), 'and it is a real foe');
    const mid = at(500);
    EnemySpawns.surfaceActive(scene, mid);
    assert.eq(mid.kind, 'skeleton', 'T2 is the ceiling out to 750 m');
    const far = at(1000);
    EnemySpawns.surfaceActive(scene, far);
    assert.eq(far.kind, 'goblin', 'past 750 m it is what the world made it');
    near.x = -2000;
    EnemySpawns.surfaceActive(scene, near);
    assert.eq(near.kind, 'slime', 'measured from the seat: walking it anywhere changes nothing');
    scene.startWorldM = { x: -5000, y: 0 };
    EnemySpawns.surfaceActive(scene, near);
    assert.eq(near.kind, 'goblin', 'idempotent off the generated kind');
    scene._pestFreeZone = () => ({ has: () => true });
    assert.falsy(EnemySpawns.surfaceActive(scene, near), 'the pest amnesty still hides every species');
  });
  test('enemy spawns: family first, then the band\'s stand-in; the HP pool follows the new kind', () => {
    assert.eq(EnemySpawns.homeDemote('giant_spider', 100), 'spider', 'a giant becomes its own kind');
    assert.eq(EnemySpawns.homeDemote('giant_skeleton', 1000), 'skeleton', 'a row\'s own minDistance binds too');
    assert.eq(EnemySpawns.homeDemote('giant_skeleton', 200), 'slime', 'and keeps falling until it fits');
    assert.eq(EnemySpawns.homeDemote('fire_slime', 100), 'slime', 'a zone kind with a tier demotes like any other');
    assert.eq(EnemySpawns.homeDemote('fire_slime', 400), 'fire_slime', 'T2 is fine from 250 m');
    assert.eq(EnemySpawns.homeDemote('goblin', NaN), 'goblin', 'no Home, no demotion');
    const g = { id: 'lair_x_0', kind: 'goblin', lair: 'x', lairX: 50, lairY: 0, _hp: 40 };
    EnemySpawns.surfaceActive({ save: {}, startWorldM: { x: 0, y: 0 } }, g);
    assert.eq(g.kind, 'slime', 'a garrison guard by Home is demoted from its RUIN\'s distance');
    assert.eq(g._hp, undefined, 'its old pool is dropped so the slime\'s applies');
  });
  test('enemy spawns: every foe the surface can hold demotes to one allowed at every distance', () => {
    const kinds = new Set([...EnemyRoster.ROWS.filter(r => r.surface).map(r => r.id), 'fire_slime']);
    for (const ladder of Object.values(Lairs.KIND_ORDER)) for (const k of ladder) kinds.add(k);
    for (const kind of kinds) {
      for (let d = 0; d <= 2000; d += 50) {
        const k = EnemySpawns.homeDemote(kind, d);
        const tier = Combat.monster(k)?.tier ?? EnemyRoster.get(k)?.tier;
        assert.lte(tier, EnemySpawns.maxTierAt(d), `${kind} at ${d} m → ${k} (T${tier})`);
        assert.gte(d, EnemyRoster.get(k)?.surface?.minDistance || 0, `${kind} at ${d} m → ${k} is too close`);
        assert.truthy(Combat.isEnemyKind(k), `${k} is a real enemy`);
      }
    }
    assert.eq(EnemySpawns.maxTierAt(0), 1); assert.eq(EnemySpawns.maxTierAt(300), 2); assert.eq(EnemySpawns.maxTierAt(900), 3);
  });
  test('enemy spawns: the quiet home hides non-slime garrison guards near Home on easy only', () => {
    const previous = Difficulty.mode();
    const scene = { save: {}, startWorldM: { x: 0, y: 0 }, homeWorldPos: () => ({ x: 0, y: 0 }) };
    const guard = (kind, at) => ({ id: `g_${kind}_${at}`, kind, x: at, y: 0, lair: `L${at}`, lairX: at, lairY: 0 });
    const quietM = Difficulty.PROFILES.easy.quietHomeM;
    assert.gt(quietM, 0);
    try {
      Difficulty.setMode('easy');
      const near = guard('goblin', quietM - 1);
      assert.falsy(EnemySpawns.surfaceActive(scene, near), 'a fort goblin by Home is asleep for you');
      assert.falsy(Combat.isEnemy(near), 'and cannot be targeted');
      assert.falsy(EnemySpawns.surfaceActive(scene, guard('giant_skeleton', 10)));
      assert.truthy(EnemySpawns.surfaceActive(scene, guard('slime', 10)), 'a wreck\'s slimes stay');
      assert.truthy(EnemySpawns.surfaceActive(scene, guard('goblin', quietM + 1)), 'past the ring the fort is held');
      const chaser = guard('goblin', quietM + 1);
      chaser.x = 0;
      assert.truthy(EnemySpawns.surfaceActive(scene, chaser), 'measured from the ruin, so a chaser does not vanish');
      scene.homeWorldPos = () => null;
      assert.truthy(EnemySpawns.surfaceActive(scene, guard('goblin', 10)), 'no Home, no quiet ring');
      scene.homeWorldPos = () => ({ x: 0, y: 0 });
      Difficulty.setMode('hard');
      assert.truthy(EnemySpawns.surfaceActive(scene, guard('goblin', 10)), 'hard has no quiet home');
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
