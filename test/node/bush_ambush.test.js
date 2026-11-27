// BUSH AMBUSHERS (environment_populations.js BUSH_AMBUSHERS; owner, Nov 2026:
// "15% of bushes should have ambushes", easy 3%, thieves and slimes by area).
(function () {
  const EP = EnvironmentalPopulations, easy = Difficulty.PROFILES.easy, hard = Difficulty.PROFILES.hard;
  const bushIds = n => Array.from({ length: n }, (_, i) => `wp_${i % 97}_${Math.floor(i / 97)}_${i % 13}_${i % 31}`);

  test('bush ambush: the difficulty table owns the shares (easy 3%, hard 15%)', () => {
    assert.eq(easy.bushAmbushShare, 0.03);
    assert.eq(hard.bushAmbushShare, 0.15);
  });

  test('bush ambush: about 15% of hard bushes hide a foe, 3% of easy, and easy is a subset of hard', () => {
    let seated = 0, onHard = 0, onEasy = 0;
    const ids = bushIds(20000);
    for (const id of ids) {
      if (!EP.bushAmbusherKind(id, 'GRASS')) continue;
      seated++;
      const c = { kind: 'slime', _bushAmbush: id };
      const h = EP.bushAmbushVisible(c, hard), e = EP.bushAmbushVisible(c, easy);
      if (h) onHard++;
      if (e) { onEasy++; assert.truthy(h, `${id}: an easy ambush is also a hard one`); }
    }
    assert.eq(seated, onHard, 'the world seats exactly the largest mode\'s share');
    assert.inRange(onHard / ids.length, 0.14, 0.16, `hard share ${onHard / ids.length}`);
    assert.inRange(onEasy / ids.length, 0.025, 0.035, `easy share ${onEasy / ids.length}`);
    assert.truthy(EP.bushAmbushVisible({ kind: 'slime' }, easy), 'no other foe is hidden by this lane');
  });

  test('bush ambush: the area picks the foe — thieves among houses and shops, slimes in the open and the woods', () => {
    const ids = bushIds(20000).filter(id => EP.bushAmbusherKind(id, 'GRASS'));
    const kinds = terrain => new Set(ids.map(id => EP.bushAmbusherKind(id, WorldGen.T[terrain])));
    assert.truthy(kinds('RESIDENTIAL').has('thief') && kinds('RESIDENTIAL').has('slime'));
    assert.truthy(kinds('COMMERCIAL').has('thief'));
    assert.eq([...kinds('FOREST')].join(), 'moss_slime');
    assert.falsy(kinds('GRASS').has('thief'), 'no thief in open country');
    assert.eq([...kinds('SAND')].join(), '', 'unlisted ground holds none');
    for (const rows of Object.values(EP.BUSH_AMBUSHERS)) for (const row of rows) {
      assert.truthy(EnemyRoster.get(row.kind)?.surface, `${row.kind} is a surface roster foe`);
      assert.gt(row.weight, 0);
    }
    assert.eq(EP.bushAmbusherKind(ids[0], 'RESIDENTIAL'), EP.bushAmbusherKind(ids[0], 'RESIDENTIAL'), 'deterministic');
  });

  test('bush ambush: only wild bushes — never a nest bush, a golden bush or another plant', () => {
    assert.truthy(EP.isAmbushBush({ kind: 'wildplant', crop: 'shrub', id: 'a' }) || isNestBush('shrub', 'a'));
    assert.falsy(EP.isAmbushBush({ kind: 'wildplant', crop: 'longgrass', id: 'a' }));
    assert.falsy(EP.isAmbushBush({ kind: 'wildplant', crop: 'goldenberry', id: 'a' }));
    let nest = null;
    for (let i = 0; i < 5000 && !nest; i++) if (isNestBush('shrub', `n${i}`)) nest = `n${i}`;
    assert.truthy(nest);
    assert.falsy(EP.isAmbushBush({ kind: 'wildplant', crop: 'shrub', id: nest }), 'a nest bush keeps its own secret');
  });

  test('bush ambush: a tile pass seats ambushers on their bushes, shared and surface-gated', () => {
    const N = 32, cellM = 7, edge = N * cellM, tx = 3, ty = -2, scene = { tileEdgeM: edge };
    const grid = new Uint8Array(N * N).fill(WorldGen.T.RESIDENTIAL);
    const wildplants = [];
    for (let iy = 0; iy < N; iy += 2) for (let ix = 0; ix < N; ix += 2)
      wildplants.push({ kind: 'wildplant', crop: 'shrub', id: `wp_${tx}_${ty}_${ix}_${iy}`,
        x: tx * edge + (ix + .5) * cellM, y: ty * edge + (iy + .5) * cellM });
    const entry = { grid, cellsPerEdge: N, tileEdgeM: edge, wildplants, objects: [] };
    const out = EP.bushes(scene, [], N, tx, ty, cellM, grid, {}, new Set(), entry);
    const expected = wildplants.filter(o => EP.isAmbushBush(o) && EP.bushAmbusherKind(o.id, grid[0]));
    assert.gt(expected.length, 0, 'the fixture rolls some ambushers');
    assert.eq(entry.bushAmbushPopulation.requested, expected.length);
    for (const c of out) {
      const bush = wildplants.find(o => o.id === c._bushAmbush);
      assert.truthy(bush, 'each foe names its bush');
      assert.eq(c.id, `bushfoe_${bush.id}`, 'its id is the bush\'s, so every player meets the same foe');
      assert.eq(c.x, bush.x); assert.eq(c.y, bush.y);
      assert.truthy(c.ambush && c._sharedId && c._surfaceSpawn, 'an ambusher on the surface lane');
      assert.truthy(['thief', 'slime'].includes(c.kind));
    }
    const again = EP.bushes(scene, [], N, tx, ty, cellM, grid, {}, new Set(), { ...entry });
    assert.eq(again.map(c => c.id + c.kind).join(), out.map(c => c.id + c.kind).join(), 'the same tile, the same ambushers');
    const caught = EP.bushes(scene, [], N, tx, ty, cellM, grid, {}, new Set([out[0].id]), { ...entry });
    assert.eq(caught.length, out.length - 1, 'a defeated ambusher stays gone');
  });

  test('bush ambush: the scene runs the pass after every other population draw', () => {
    const path = SCENE_SRC.indexOf('this.spawnPathVariantFauna(creatures'), bush = SCENE_SRC.indexOf('this.spawnBushAmbushers(', path);
    assert.gt(path, -1); assert.gt(bush, path, 'after the path fauna');
    const cull = SCENE_SRC.indexOf('this._cullOffLiveGround(entry', bush);
    assert.truthy(cull > bush && cull - bush < 400, 'before the per-player cull');
  });

  test('bush ambush: surfaceActive hides an ambusher past the active mode\'s share', () => {
    const ids = bushIds(4000);
    const easyOnly = ids.find(id => EP.bushAmbushVisible({ _bushAmbush: id }, easy));
    const hardOnly = ids.find(id => EP.bushAmbushVisible({ _bushAmbush: id }, hard) && !EP.bushAmbushVisible({ _bushAmbush: id }, easy));
    const body = id => ({ kind: 'slime', id: 'bushfoe_' + id, x: 0, y: 0, ambush: true, _bushAmbush: id,
      _surfaceSpawn: { tx: 0, ty: 0, cx: 0, cy: 0, x: 0, y: 0 } });
    const was = Difficulty.mode();
    try {
      Difficulty.setMode('easy');
      assert.falsy(EnemySpawns.surfaceActive({}, body(hardOnly)), 'hard\'s extra bush is empty on easy');
      assert.truthy(EnemySpawns.surfaceActive({}, body(easyOnly)), 'easy\'s own share shows');
      Difficulty.setMode('hard');
      assert.truthy(EnemySpawns.surfaceActive({}, body(hardOnly)), 'hard shows it');
    } finally { Difficulty.setMode(was); }
  });
})();
