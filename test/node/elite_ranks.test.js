// Elite ranks — src/combat.js › ELITE_RANKS / rollEliteRank / eliteRank, the
// stamp in WorldGen.makeCreature, the ascendant's summon (creature_ai.js
// supportAbility), and the look render.js gives them: a vivid sheet, a
// rank-coloured twin rune circle, and creature shadows seated 3 px higher.
(function () {
  const R = Combat.ELITE_RANKS;

  test('elite ranks: power and pace per rank, a plain elite unchanged', () => {
    const base = Combat.creatureMaxHp('goblin');
    const make = rank => ({ kind: 'goblin', id: `g_${rank}`, shiny: true, ...(rank ? { eliteRank: rank } : {}) });
    assert.eq(Combat.maxHp(make(null)), base * 2, 'an unstamped shiny is a plain elite');
    assert.eq(Combat.maxHp(make('elite')), base * 2);
    assert.eq(Combat.maxHp(make('possessed')), base * 3, 'possessed: three times the stats');
    assert.eq(Combat.maxHp(make('ascendant')), base * 4, 'ascendant: four times the stats');
    assert.eq(Combat.powerMul(make('possessed')), 3, 'damage and bounty read the same factor');
    assert.eq(Combat.shinySpeedMul(make('elite')), 1.5);
    assert.inRange(Combat.shinySpeedMul(make('possessed')), 2.0999, 2.1001, 'possessed: 1.4x an elite\'s pace');
    assert.eq(Combat.shinySpeedMul(make('ascendant')), 1.5);
    assert.eq(Combat.eliteRank({ kind: 'deer', id: 'd', shiny: true, eliteRank: 'possessed' }), null,
      'a shiny animal is never ranked');
  });

  test('elite ranks: rolled once off the stable id, at the table\'s shares', () => {
    const counts = { elite: 0, possessed: 0, ascendant: 0 };
    for (let i = 0; i < 20000; i++) counts[Combat.rollEliteRank('goblin', `t_${i}`)]++;
    assert.inRange(counts.ascendant / 20000, R.ascendant.share - 0.01, R.ascendant.share + 0.01);
    assert.inRange(counts.possessed / 20000, R.possessed.share - 0.015, R.possessed.share + 0.015);
    assert.eq(Combat.rollEliteRank('goblin', 'same'), Combat.rollEliteRank('goblin', 'same'), 'deterministic');
    assert.eq(Combat.rollEliteRank('crab', 'x'), null, 'a kind that cannot be an elite has no rank');
    assert.eq(Combat.rollEliteRank('deer', 'x'), null);
    const shiny = WorldGen.makeCreature('goblin', 0, 0, 't_1', { shiny: true });
    assert.eq(shiny.eliteRank, Combat.rollEliteRank('goblin', 't_1'), 'makeCreature stamps the roll');
    assert.eq(WorldGen.makeCreature('goblin', 0, 0, 't_1', { shiny: false }).eliteRank, undefined);
    assert.eq(WorldGen.makeCreature('goblin', 0, 0, 't_1', { shiny: true, eliteRank: 'ascendant' }).eliteRank, 'ascendant',
      'an explicit rank wins');
  });

  test('elite ranks: possessed and ascendant are each 5% of elites', () => {
    assert.eq(R.possessed.share, 0.05);
    assert.eq(R.ascendant.share, 0.05);
  });

  test('elite placement: never within the clear radius of a generated staircase', () => {
    const cellM = 7, R_M = EnemySpawns.ELITE_STAIR_CLEAR_CELLS * cellM;
    let id = null;
    for (let i = 0; i < 2000 && !id; i++) if (isShiny(`st_${i}`, SHINY_RATE.monster)) id = `st_${i}`;
    const stair = { kind: 'staircase', dir: 'up', x: 0, y: 0 };
    const entry = (objects) => ({ objects });
    assert.truthy(EnemySpawns.rollsElite(entry([]), 'goblin', id, 0, 0, cellM), 'a shiny roll with no stair is an elite');
    assert.falsy(EnemySpawns.rollsElite(entry([stair]), 'goblin', id, R_M - 1, 0, cellM), 'inside the radius: plain');
    assert.truthy(EnemySpawns.rollsElite(entry([stair]), 'goblin', id, R_M + 1, 0, cellM), 'outside it: elite');
    assert.truthy(EnemySpawns.rollsElite(entry([{ ...stair, _synthetic: true }]), 'goblin', id, 0, 0, cellM),
      'a player\'s own stair never changes the shared world');
    assert.truthy(EnemySpawns.rollsElite({ genObjects: [], objects: [stair] }, 'goblin', id, 0, 0, cellM),
      'a cave reads its generated layer');
    assert.falsy(EnemySpawns.rollsElite(entry([]), 'crab', id, 0, 0, cellM), 'an ineligible kind never is');
    for (const [file, src] of [['scene_creatures.js', DURATION_SOURCES['scene_creatures.js']], ['lairs.js', ENERGY_WRITE_SOURCES['lairs.js']]]) {
      assert.falsy(/isShiny\([^)]*SHINY_RATE\.monster\)/.test(src), `${file} asks EnemySpawns.rollsElite, not the raw roll`);
    }
  });

  test('elite ranks: an ascendant summons plain copies of its basic form, one every 5 s', () => {
    const row = EnemyRoster.get('goblin');
    const plain = { kind: 'goblin', id: 'p', shiny: true, eliteRank: 'possessed' };
    assert.eq(supportAbility(plain, row), row.ability, 'other ranks keep the row\'s own ability');
    const asc = { kind: 'goblin', id: 'a', shiny: true, eliteRank: 'ascendant' };
    const a = supportAbility(asc, row);
    assert.eq(a.type, 'summon');
    assert.eq(a.kind, 'goblin', 'its basic form');
    assert.eq(a.intervalSeconds, 5);
    assert.eq(supportAbility(asc, row), a, 'one stable object per creature');
    const variant = EnemyRoster.ROWS.find(r => r.variantOf && r.eliteEligible !== false);
    assert.eq(supportAbility({ kind: variant.id, id: 'v', shiny: true, eliteRank: 'ascendant' }, variant).kind,
      variant.variantOf, 'a variant summons the kind it varies');

    const s = { cellM: 7, depth: 2, save: { energy: 100, armor: {} }, _cellBlocked: () => false,
      cellAt: () => ({ loaded: true, type: WorldGen.T.CAVE_FLOOR }), _nearAny: () => false,
      startWorldM: { x: 0, y: 0 }, originPx: { x: 0, y: 0 }, mPerPx: 7, cellsPerTile: WorldGen.TILE_PX };
    const n = WorldGen.TILE_PX, key = WorldGen.tileKey(0, 0), old = WorldGen.tileCache.get(key);
    const c = { ...asc, x: 14, y: 14 };
    const entry = { cellsPerEdge: n, grid: new Uint8Array(n * n).fill(WorldGen.T.CAVE_FLOOR), creatures: [c], _spawnOpts: {} };
    const previous = WorldGen.forEachItemNear;
    WorldGen.tileCache.set(key, entry);
    WorldGen.forEachItemNear = (what, tx, ty, fn) => entry.creatures.forEach(fn);
    try {
      let t = 10000;
      for (let i = 0; i < 40; i++, t += 250) enemySupportTick(s, c, row, t, true);
      const kids = entry.creatures.slice(1);
      assert.inRange(kids.length, 1, 2, 'about one per 5 s over 10 s');
      assert.truthy(kids.every(k => k.kind === 'goblin' && !k.shiny), 'plain copies, never elites');
      for (let i = 0; i < 400; i++, t += 250) enemySupportTick(s, c, row, t, true);
      assert.eq(entry.creatures.length - 1, R.ascendant.ability.maxMinions, 'bounded by its slots');
    } finally {
      WorldGen.forEachItemNear = previous;
      if (old) WorldGen.tileCache.set(key, old); else WorldGen.tileCache.delete(key);
    }
  });

  test('elite look: creature shadows sit 3 px above the ground point; props do not move', () => {
    const sprite = () => ({ setOrigin() { return this; }, setDisplaySize() { return this; },
      setPosition(x, y) { this.x = x; this.y = y; return this; }, setAlpha() { return this; },
      texture: { key: 'bldg_shadow' }, setTexture() { return this; } });
    for (const look of ['creature', 'airborne']) {
      const s = sprite(); seatShadow(s, look, 20, 10, 50);
      assert.eq(s.y, 47, `${look} shadow lifted`);
    }
    const p = sprite(); seatShadow(p, 'prop', 20, 10, 50);
    assert.eq(p.y, 50, 'a prop\'s shadow stays on its ground point');
  });

  test('elite look: vivid sheet, rank-coloured twin circle, warp only for warping ranks', () => {
    const px = new Uint8ClampedArray([100, 150, 50, 255]);
    vividPixels(px);
    const spread = (a) => Math.max(a[0], a[1], a[2]) - Math.min(a[0], a[1], a[2]);
    assert.gt(spread(px), 100, 'saturation raised');
    assert.eq(R.elite.ring, 0xffffff, 'a regular elite\'s circle is white');
    assert.eq(R.possessed.ring >> 16, 0xff, 'possessed red');
    assert.gt(R.ascendant.ring & 0xff, R.ascendant.ring >> 16, 'ascendant blue');
    assert.falsy(R.elite.warp, 'a plain elite does not bend space');
    assert.truthy(R.possessed.warp && R.ascendant.warp);
    assert.truthy(/const ring = Combat\.eliteRank\(item\.c\)\.ring;[\s\S]{0,200}Render\.canvasTint\(scene, key, ring\)/.test(RENDER_SRC),
      'the circle wears its rank colour on Canvas as well as WebGL');
    assert.truthy(/\['outer', 'inner'\]\.map\(band =>/.test(RENDER_SRC), 'both bands drawn under every elite');
    assert.truthy(/bakeRingBand\('elite_ring', 120,/.test(SCENE_SRC) && /bakeRingBand\('elite_ring_inner', 45,/.test(SCENE_SRC),
      'rotation strips baked over each band\'s period');
    assert.truthy(/if \(!Render\.canShine\(scene\) \|\| !eliteWarpPipeline\(scene\)\) return;/.test(RENDER_SRC),
      'the warp pass needs the graphics-FX opt-in');
    // No elites on screen: the pass comes off the camera.
    let removed = 0;
    const cam = { setPostPipeline() {}, getPostPipeline: () => ({ discs: new Float32Array(16) }),
      removePostPipeline() { removed++; } };
    Render.setEliteWarp({ cameras: { main: cam } }, []);
    assert.eq(removed, 1);
  });
})();
