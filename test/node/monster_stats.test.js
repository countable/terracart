// Approved enemy roster owns final stats, declared habitats and variant limits.
(() => {
  test('roster: combat uses approved values without cave or giant multipliers', () => {
    assert.eq(CAVE_ENEMY_MUL, 1);
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
    let dungeonOnly = 0;
    for (const row of EnemyRoster.ROWS) {
      assert.gt(row.hp, 0);
      if (row.surface) assert.lte(row.tier, 3, row.id);
      if (row.cave && !row.surface) dungeonOnly++;
    }
    assert.gte(dungeonOnly, EnemyRoster.ROWS.length / 2);
  });
  test('roster: legacy giant saves resolve without entering spawn or quest pools', () => {
    assert.truthy(Combat.monster('giant_goblin'));
    assert.falsy(Combat.spawnsUnderground('giant_goblin'));
    assert.falsy(Combat.enemyKinds().includes('giant_goblin'));
    assert.eq(Combat.monster('giant_plant').hp, EnemyRoster.get('giant_plant').hp);
  });
  test('roster: elites respect eligibility and never stack with size variants', () => {
    for (const row of EnemyRoster.ROWS) {
      const c = { kind: row.id, shiny: true };
      assert.eq(Combat.isElite(c), row.eliteEligible);
      assert.eq(Combat.maxHp(c), row.hp * (row.eliteEligible ? 2 : 1));
    }
  });
})();
