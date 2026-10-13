(function () {
  test('fire slime: natural fire immunity prevents burn status and damage without lava immunity', () => {
    const slime = { kind: 'fire_slime', energy: 100 };
    assert.truthy(Conditions.fireImmune(slime));
    assert.falsy(EnemyRoster.get(slime.kind).lavaImmune);
    assert.falsy(Combat.canBurn(slime));
    assert.falsy(Combat.ignite(slime, 1000));
    assert.falsy(Conditions.apply(slime, 'burning', 1000));
    assert.eq(Conditions.fireDamage(slime, 30, 1000), 0);
    slime._burnState = { remainingMs: 5000, nextTickMs: 1000 };
    slime._burnAtT = 0;
    assert.eq(Combat.burnTick(slime, 2000, true), 0);
    assert.falsy(slime._burnState, 'existing fire is extinguished');
    assert.truthy(Combat.damageDealt(slime, 5) > 0, 'ordinary attacks still hurt');
    assert.truthy(Combat.ignite({ kind: 'slime' }, 1000), 'ordinary slimes still burn');
  });

  test('fire slime: fireball blast leaves it unharmed while hurting nearby ordinary slimes', () => {
    const method = SCENE_SRC.match(/\n  (_friendlyShotHitsEnemy\([^\n]*\) \{\n[\s\S]*?\n  \})\n/);
    assert.truthy(method);
    const scene = new Function('return ({' + method[1] + '});')();
    scene._damageEnemy = (target, amount) => Combat.damageDealt(target, amount);
    const fire = { kind: 'fire_slime', id: 'fire', x: 7, y: 0 };
    const normal = { kind: 'slime', id: 'normal', x: 7, y: 1 };
    const before = Combat.hp(fire), normalBefore = Combat.hp(normal);
    const shot = Combat.spawnFireball(0, 0, { x: 1, y: 0 }, 7, CONSUMABLE_SPEC.fireball_scroll);
    Combat.stepShots([shot], 10, [fire, normal], 7,
      (target, projectile) => scene._friendlyShotHitsEnemy(target, projectile), { cellM: 7 });
    assert.eq(Combat.hp(fire), before);
    assert.lt(Combat.hp(normal), normalBefore);
    scene._friendlyShotHitsEnemy(fire, { damage: 5 });
    assert.lt(Combat.hp(fire), before, 'non-fire projectile still hurts');
  });
})();
