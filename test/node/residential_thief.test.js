// The damaging purse raid uses the normal attack, damage and coin writers.
(function () {
  const foe = (id = 'residential_thief_1') => ({ id, kind: 'thief', x: 0, y: 0 });
  function scene(money = 30, armor = {}) {
    const s = { cellM: 7, depth: 2, save: { energy: 100, armor, money },
      cellAt: () => ({ loaded: true, type: WorldGen.T.CAVE_FLOOR }),
      _cellBlocked: () => false, _nearAny: () => false, messages: [],
      _losePlayerEnergy(n) { const lost = Math.min(this.save.energy, n); this.save.energy -= lost; return lost; },
      _toast(text) { this.messages.push(text); }, _flashPlayerHit: () => {}, _closeShopOnHit: () => {} };
    const writer = SCENE_SRC.match(/\n  (_losePlayerCoins\([^\n]*\) \{\n[\s\S]*?\n  \})\n/);
    assert.truthy(writer);
    Object.assign(s, new Function('return ({' + writer[1] + '});')());
    return s;
  }
  function attack(s, c, time = 10000, inactive = false) {
    const row = EnemyRoster.get(c.kind);
    rosterEnemyAttack(s, c, row, time, 1, 0, inactive, 0.1);
    rosterEnemyAttack(s, c, row, time + row.windupSeconds * 1000, 1, 0, inactive, 0.1);
  }
  test('residential thief: one damaging hit steals up to fifteen coins and shows the actual amount', () => {
    const row = EnemyRoster.get('thief');
    assert.eq(row.dmg, 15); assert.eq(row.hitAndRun.coins, 15); assert.falsy(row.pirate);
    for (const purse of [30, 7, 0]) {
      const s = scene(purse), c = foe();
      attack(s, c);
      const loss = Combat.incomingDamage({ energy: 100, armor: {}, mode: s.save.mode }, 15);
      assert.eq(s.save.energy, 100 - loss, 'the ordinary damage formula lands');
      assert.eq(s.save.money, Math.max(0, purse - 15));
      assert.eq(s.messages[0], `Thief stole ${Math.min(15, purse)} coins!`);
      assert.truthy(Combat.raidSpent(s.save, c), 'empty purses still spend the one landed raid');
      assert.eq(s.save.enemyRaids.length, 1); assert.falsy(s.save.thefts, 'daily bird thefts stay independent');
      const energy = s.save.energy;
      attack(s, c, 20000);
      assert.eq(s.save.energy, energy); assert.eq(s.messages.length, 1);
      assert.eq(s.save.enemyRaids.length, 1);
    }
  });
  test('residential thief: armor applies and failed, warded or downed hits do not spend a raid', () => {
    const protectedScene = scene(30, { chestplate: { tier: 3 } }), protectedFoe = foe();
    attack(protectedScene, protectedFoe);
    assert.eq(protectedScene.save.energy, 100 - Combat.incomingDamage({ energy: 100, armor: protectedScene.save.armor }, 15));
    assert.gt(protectedScene.save.energy, 100 - Combat.incomingDamage({ energy: 100, armor: {} }, 15), 'real armor reduces the hit');
    for (const status of ['zero_loss', 'inactive', 'downed']) {
      const s = scene(), c = foe();
      if (status === 'zero_loss') s._losePlayerEnergy = () => 0;
      if (status === 'downed') s.save.energy = 0;
      attack(s, c, 10000, status === 'inactive');
      assert.eq(s.save.money, 30); assert.falsy(Combat.raidSpent(s.save, c));
      assert.falsy(s.save.enemyRaids); assert.eq(s.messages.length, 0);
    }
  });
  test('residential thief: a spent raid flees immediately and remains spent after save reload', () => {
    const s = scene(), c = foe(), row = EnemyRoster.get(c.kind);
    attack(s, c);
    rosterEnemyMove(s, c, row, 11000, 28, 0, false, false, null, 0.1);
    assert.lt(c.x, 0, 'the first post-hit step runs away from the player');
    const loaded = scene(); loaded.save = JSON.parse(JSON.stringify(s.save));
    const respawn = foe();
    assert.truthy(Combat.raidSpent(loaded.save, respawn), 'stable encounter ID restores permanent retreat');
    const before = loaded.save.energy;
    attack(loaded, respawn, 100000);
    assert.eq(loaded.save.energy, before); assert.eq(loaded.messages.length, 0);
    rosterEnemyMove(loaded, respawn, row, 101000, 28, 0, false, false, null, 0.1);
    assert.lt(respawn.x, 0, 'reload cannot restart pursuit');
    assert.falsy(Combat.raidSpent(loaded.save, foe('another_thief')), 'other encounter IDs retain their own raid');
  });
})();
