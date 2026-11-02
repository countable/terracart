// Approved review choices must retain their identity and full directional art.
(() => {
  const expected = {
    thorn_ball: ['Green Thorn Ball', 2], dire_toad: ['Dire Toad', 2], sproutling: ['Sproutling', 3],
    wolfling: ['Wolfling', 5], butterfairy: ['ButterFairy', 2], giant_rat: ['Giant Rat', 2],
    nighthop: ['Nighthop', 4], fungusaur: ['Fungusaur', 3], corrupticore: ['Corrupticore', 3],
    locylady: ['Locylady', 2], beheld: ['Beheld', 5], cockathrice: ['Cockathrice', 4],
    tidal_force: ['Tidal Force', 3], craggan: ['Craggan', 5], leviathan: ['Leviathan', 4],
    lichling: ['Lichling', 3], velox: ['Velox', 2], shadow_scorpion: ['Shadow Scorpion', 4],
    watcher: ['Watcher', 6], gargirl: ['Gargirl', 5], infernal: ['Infernal', 6],
    stirgling: ['Stirgling', 4], ifrit: ['Ifrit', 7], gremling: ['Gremling', 1],
    tortadon: ['Tortadon', 3], darkling: ['Darkling', 2], spook: ['Spook', 1],
    nocturnus: ['Nocturnus', 2], swordasaurus: ['Swordasaurus', 2], grey_mage: ['Grey Mage', 5],
    spectrus: ['Spectrus', 1], portacular: ['Portacular', 3], roc: ['Roc', 2], judge: ['Judge', 5],
    black_dragon: ['Black Dragon', 7], blue_dragon: ['Blue Dragon', 7],
    white_dragon: ['White Dragon', 7], yellow_dragon: ['Yellow Dragon', 7],
  };
  test('rare roster: approved names and tiers are distinct encounter-only kinds', () => {
    const rows = EnemyRoster.ROWS.filter(row => row.rareEncounter);
    assert.eq(rows.length, Object.keys(expected).length);
    assert.eq(new Set(rows.map(row => row.id)).size, rows.length);
    for (const row of rows) {
      assert.eq(row.name, expected[row.id][0], row.id);
      assert.eq(row.tier, expected[row.id][1], row.id);
      assert.eq(row.surface.biomes.length, 0, 'ordinary surface pool excludes ' + row.id);
      assert.eq(row.cave, null, 'ordinary cave pool excludes ' + row.id);
      assert.eq(row.board, false, 'visit-only foes cannot block ordinary quest boards');
      assert.truthy(Pets.canCatch({ released: [] }, { id: 'review_' + row.id, kind: row.id }), row.id + ' is catchable');
    }
  });
  test('rare roster: every selected sprite keeps at least three authored poses in four directions', () => {
    const origins = new Set();
    for (const id of Object.keys(expected)) {
      const row = EnemyRoster.get(id), art = SpriteLayout.creatureArt(id);
      const dims = pngDims(row.art.path), cols = dims.w / row.art.frameWidth;
      const frameCount = cols * dims.h / row.art.frameHeight;
      const first = row.art.directions.down.move[0];
      const origin = row.art.path + ':' + first;
      assert.falsy(origins.has(origin), id + ' has its own reviewed block'); origins.add(origin);
      for (const facing of ['down', 'left', 'right', 'up']) {
        const frames = row.art.directions[facing].move;
        assert.gte(frames.length, 3, id + ' ' + facing);
        for (let i = 0; i < frames.length; i++) {
          assert.inRange(frames[i], 0, frameCount - 1, id);
          const appearance = SpriteLayout.creatureAppearance({ kind: id, _facing: facing, _moveUntil: 10000 }, i * art.frameMs);
          assert.eq(appearance.frame, frames[i], id + ' authored ' + facing);
          assert.falsy(appearance.flipX, id + ' never mirrors authored left/right');
        }
      }
    }
  });
  test('rare roster: selected supernatural attacks retain their shared status and cadence contracts', () => {
    assert.eq(EnemyRoster.get('butterfairy').projectileConditionDurationMs, 120000);
    assert.eq(EnemyRoster.get('judge').rareBehaviour.polymorphDurationMs, 180000);
    assert.eq(EnemyRoster.get('tortadon').conditionDurationMs, 3000);
    assert.eq(EnemyRoster.get('tidal_force').ability.intervalSeconds, 5);
    for (const id of ['tidal_force', 'spook', 'nocturnus']) {
      const row = EnemyRoster.get(id);
      assert.truthy(row.rareBehaviour.summonRenewable);
      assert.gt(row.ability.maxMinions, 0, 'summons remain bounded');
    }
    assert.eq(JSON.stringify(EnemyRoster.get('cockathrice').gaze), JSON.stringify(EnemyRoster.get('medusa').gaze));
  });
})();
