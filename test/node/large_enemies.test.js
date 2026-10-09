test('large enemies: authored cardinal walking and attacks resolve without mirroring', () => {
  for (const kind of ['bugbear', 'troll', 'giant_bear', 'ogre', 'giant_reaper']) {
    const art = SpriteLayout.creatureArt(kind);
    assert.eq(art.fw, 32); assert.eq(art.fh, 32);
    assert.gt(art.fw * art.scale, 32, kind + ' renders larger than a cell');
    for (const [row, facing] of ['up', 'right', 'down', 'left'].entries()) {
      const creature = { kind, _facing: facing, _moveUntil: 1000 };
      for (let phase = 0; phase < 4; phase++) {
        const view = SpriteLayout.creatureAppearance(creature, phase * 140);
        assert.eq(view.frame, row * 8 + phase, kind + ' ' + facing + ' walk');
        assert.falsy(view.flipX);
      }
      Object.assign(creature, { _attackT0: 1000, _attackUntil: 1600 });
      for (let phase = 0; phase < 4; phase++) {
        assert.eq(SpriteLayout.creatureAppearance(creature, 1000 + phase * 150).frame, row * 8 + 4 + phase);
      }
      assert.eq(SpriteLayout.creatureAppearance(creature, 1600).frame, row * 8);
    }
  }
});

test('large enemies: forest bear, cave troll and citadel guards keep their habitats', () => {
  assert.truthy(EnemySpawns.surfaceRows('FOREST').some(r => r.id === 'giant_bear'));
  for (const biome of ['GRASS', 'PARK', 'RESIDENTIAL']) {
    assert.falsy(EnemySpawns.surfaceRows(biome).some(r => r.id === 'giant_bear'));
  }
  assert.includes(EnemyHabitats.SURFACE_FAMILIES.ancient_grove, 'giant_bear');
  for (const depth of [3]) {
    assert.truthy(EnemySpawns.caveRows(depth, { kinds: EnemyHabitats.FAMILIES.natural }).some(r => r.id === 'troll'));
  }
  for (const depth of [1, 2, 4, 5, 9]) assert.falsy(EnemySpawns.caveRows(depth).some(r => r.id === 'troll'));
  const entry = { cellsPerEdge: 8, tileEdgeM: 56 };
  assert.eq(EnemyHabitats.buildingKinds(entry, { tier: 12, key: 'citadel', ix: 3, iy: 3 }).join(), 'bugbear');
  assert.falsy(EnemyHabitats.buildingKinds(entry, { tier: 12, key: 'archive', ix: 3, iy: 3 }));
  assert.falsy(EnemySpawns.surfaceRows('FOREST').some(r => ['bugbear', 'giant_reaper', 'troll'].includes(r.id)));
});

test('large enemies: Residential supplies Ogres without ordinary road preferences and retains Home safety', () => {
  const N = 16, grid = new Array(N * N).fill(WorldGen.T.RESIDENTIAL);
  const e = { cellsPerEdge: N, grid, roadClass: new Uint8Array(N * N) };
  const eligible = () => EnemySpawns.surfaceRows('RESIDENTIAL', EnemyHabitats.surfaceAt(e, 8, 8)).some(r => r.id === 'ogre');
  assert.truthy(eligible(), 'Residential landcover owns the Ogre pool');
  grid[8 * N + 10] = WorldGen.T.ROAD;
  assert.truthy(eligible(), 'a nearby Small road does not alter the pool');
  assert.falsy(EnemySpawns.surfaceRows('FOREST', { nearMinorRoad: true }).some(r => r.id === 'ogre'));
  grid[8 * N + 10] = WorldGen.T.ROAD_MD;
  assert.truthy(eligible(), 'road size does not alter the Residential pool');
  grid[8 * N + 10] = WorldGen.T.ROAD;
  e.roadClass[8 * N + 8] = WorldGen.ROAD_CLASS_MAJOR_BUFFER;
  assert.truthy(eligible(), 'a safety exclusion changes seats rather than species selection');
  for (const kind of ['ogre', 'giant_bear', 'giant_reaper', 'bugbear']) {
    assert.falsy(EnemySpawns.homeAllows(kind, 749), kind + ' stays outside the safe area');
    assert.truthy(EnemySpawns.homeAllows(kind, 750));
    const scene = { startWorldM: { x: 0, y: 0 } };
    const creature = { kind, _surfaceSpawn: { x: 100, y: 0 } };
    assert.falsy(EnemySpawns.surfaceActive(scene, creature));
    assert.truthy(creature._surfaceInactive);
  }
});

test('large enemies: churchyard reapers stay in temples and ambient encounters retain the spawn gate', () => {
  const N = 64;
  for (const theme of ['stone_garden', 'ordered_graves', 'overgrown_graves', 'broken_masonry', 'silent_circle', 'ancient_grove']) {
    const e = { cellsPerEdge: N, tileEdgeM: 448, grid: new Array(N * N).fill(WorldGen.T.PARK),
      zone: { coverage: new Uint8Array(N * N).fill(1), anchors: [{ variant: theme }] } };
    const generated = EnemyHabitats.surfaceEncounters(e, 0, 0, new Set());
    assert.gt(generated.length, 0, theme + ' retains ambient encounters');
    assert.falsy(generated.some(c => c.kind === 'giant_reaper'), theme + ' reserves reapers for temples');
    if (theme === 'ancient_grove') assert.truthy(generated.some(c => c.kind === 'giant_bear'));
    assert.eq(JSON.stringify(generated), JSON.stringify(EnemyHabitats.surfaceEncounters(e, 0, 0, new Set())));
    e.spawnWhy = new Uint32Array(N * N).fill(WorldGen.SPAWN_WHY.PRIVATE);
    assert.eq(EnemyHabitats.surfaceEncounters(e, 0, 0, new Set()).length, 0, 'private land remains refused');
    delete e.spawnWhy;
    e.roadMask = new Uint8Array(N * N).fill(1);
    assert.eq(EnemyHabitats.surfaceEncounters(e, 0, 0, new Set()).length, 0, 'roads remain refused');
  }
  assert.falsy(EnemyRoster.get('giant_serpent'), 'serpent remains a draft');
});
