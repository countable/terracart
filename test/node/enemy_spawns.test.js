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
  test('enemy spawns: Home is an activation overlay and movement cannot change the selected tier', () => {
    const id = EnemySpawns.surfaceId(0, 0, 10, 10);
    const c = { id, kind: 'goblin', x: 800, y: 0, _surfaceSpawn: { x: 800, y: 0, tx: 0, ty: 0, cx: 10, cy: 10 } };
    const scene = { save: {}, startWorldM: { x: 800, y: 0 }, _pestFreeZone: () => null };
    assert.falsy(EnemySpawns.surfaceActive(scene, c), 'strong foe hidden near Home');
    assert.falsy(Combat.isEnemy(c), 'inactive foe cannot be auto-targeted');
    scene.startWorldM = { x: -2000, y: 0 };
    assert.truthy(EnemySpawns.surfaceActive(scene, c), 'same world candidate activates far from Home');
    c.x = -2000;
    assert.truthy(EnemySpawns.surfaceActive(scene, c), 'walking toward Home does not reroll or demote the creature');
    assert.eq(c.id, id);
    assert.eq(c.kind, 'goblin');
    scene._pestFreeZone = () => ({ has: () => true });
    assert.falsy(EnemySpawns.surfaceActive(scene, c), 'tutorial protects against all species');
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
  test('enemy spawns: tier thinning matches the declared bands without reseeding identities', () => {
    for (const band of EnemyRoster.SURFACE_TIERS) {
      const accepted = [1, 2, 3].map(tier => EnemySpawns.tierAcceptance(tier, band.minDistance) * EnemyRoster.SURFACE_TIERS.at(-1).tierWeights[tier]);
      const total = accepted.reduce((a, b) => a + b, 0);
      for (let tier = 1; tier <= 3; tier++) assert.inRange(accepted[tier - 1] / total,
        (band.tierWeights[tier] || 0) - 1e-9, (band.tierWeights[tier] || 0) + 1e-9);
    }
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
