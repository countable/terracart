// Approved enemy roster owns final stats, declared habitats and variant limits.
(() => {
  test('roster: combat uses approved values without cave or giant multipliers', () => {
    for (const row of EnemyRoster.ROWS) {
      const live = Combat.monster(row.id);
      for (const key of ['hp', 'armor', 'dmg', 'tier', 'range', 'damageIntervalSeconds', 'attackHits']) {
        assert.eq(live[key], row[key], `${row.id}.${key}`);
      }
      assert.eq(Combat.sightCells(row.id), row.visionCells);
      assert.eq(Combat.spawnsUnderground(row.id), !!row.cave && row.attackType !== 'touch');
    }
  });
  test('roster: surface tiers stop at three and at least half are dungeon-only', () => {
    let dungeonOnly = 0, rolled = 0;
    for (const row of EnemyRoster.ROWS) {
      assert.gt(row.hp, 0);
      if (row.surface) assert.lte(row.tier, 3, row.id);
      const ambientSurface = row.surface?.weight > 0 && row.surface.biomes.length > 0;
      if (row.cave && !ambientSurface) dungeonOnly++;
      // Authored-only surface encounters have no biome weight. Like fauna
      // with their own seating rule, they are outside the ambient pool split.
      if (row.cave || ambientSurface) rolled++;
    }
    assert.gte(dungeonOnly, rolled / 2);
  });
  test('roster: retired giant aliases are gone; roster giants keep their own rows', () => {
    assert.eq(Combat.monster('giant_goblin'), undefined);
    assert.falsy(Combat.enemyKinds().includes('giant_goblin'));
    assert.eq(Combat.monster('giant_plant').hp, EnemyRoster.get('giant_plant').hp);
  });
  test('roster: shiny strength applies to every row while elite rewards respect eligibility', () => {
    for (const row of EnemyRoster.ROWS) {
      const c = { kind: row.id, shiny: true };
      assert.eq(Combat.isElite(c), row.eliteEligible);
      assert.eq(Combat.maxHp({ kind: row.id }), row.hp);
      assert.eq(Combat.maxHp(c), row.hp * 2);
      assert.eq(Combat.powerMul(c), 2);
      assert.eq(Combat.shinySpeedMul(c), 1.5);
    }
  });
})();
