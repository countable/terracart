(function () {
  const T0 = 1_700_000_000_000;
  function withClock(fn) {
    const old = Date.now;
    let now = T0;
    Date.now = () => now;
    try { fn(value => { now = value; }); }
    finally { Date.now = old; }
  }
  const APP_TABLES = (() => {
  const grab = (name) => {
    const m = SCENE_SRC.match(new RegExp('\\nconst ' + name + ' = \\{[\\s\\S]*?\\n\\};'));
    assert.truthy(m, name + ' table in app.js');
    return m[0];
  };
  return grab('SUMMON_HOOK') + grab('TIMED_BUFF_HOOKS');
})();
  function lift(name) {
    const start = SCENE_SRC.indexOf('\n  ' + name + '(');
    assert.truthy(start >= 0, name);
    const end = SCENE_SRC.indexOf('\n  }\n', start);
    return new Function(APP_TABLES + '\nreturn ({' + SCENE_SRC.slice(start, end + 4) + '})[' + JSON.stringify(name) + ']')();
  }

  test('shrinking potion: T4 lasts three minutes and halves size, max HP, and melee', () => {
    assert.eq(BASE_TIER.shrinking_potion, 4);
    const spec = CONSUMABLE_SPEC.shrinking_potion;
    assert.eq(spec.durationMs, 180_000);
    assert.eq(spec.scaleMul, 0.5);
    assert.eq(spec.maxHpMul, 0.5);
    assert.eq(spec.meleeDamageMul, 0.5);
    assert.eq(spec.visionCells, 1);
    assert.eq(spec.buff, 'shrinking');
  });

  test('shrinking potion: max HP rounds up and composes with Giant and permanent upgrades', () => {
    withClock(() => {
      const save = { eaten: ['potato'], vigourUpgrades: 2, training: { energy: 2 } };
      const baseline = Energy.maxEnergy(save);
      save.shrinkingPotionUntil = T0 + 180_000;
      assert.eq(Energy.maxEnergy(save), Math.ceil(baseline / 2));
      save.giantPotionUntil = T0 + 180_000;
      assert.eq(Energy.maxEnergy(save), Math.ceil((baseline + 100) / 2), 'Giant headroom is also halved');
      assert.eq(Energy.maxEnergy(save), Math.ceil((baseline + 100) / 2), 'repeated reads never compound');
      assert.eq(Energy.maxEnergy(save, T0 + 180_000), baseline);
    });
  });

  test('shrinking potion: drinking caps current HP without healing and extends the duration', () => {
    withClock(setNow => {
      const scene = {
        save: { inv: [{ id: 'shrinking_potion', count: 2 }], selSlot: 0, energy: 90 },
        _syncPlayerSkin() {}, updateEnergyDOM() {}, buildInventoryDOM() {}, showMessageModal() {},
      };
      for (const name of ['_selectedConsumable', '_spendScroll', '_consumeSelected', '_finishInventoryChange']) scene[name] = lift(name);
      const drink = lift('_useTimedBuff');
      assert.eq(drink.call(scene, 'shrinking_potion'), true);
      assert.eq(scene.save.energy, 50);
      assert.eq(scene.save.shrinkingPotionUntil, T0 + 180_000);
      scene.save.energy = 20;
      setNow(T0 + 60_000);
      assert.eq(drink.call(scene, 'shrinking_potion'), true);
      assert.eq(scene.save.energy, 20);
      assert.eq(scene.save.shrinkingPotionUntil, T0 + 360_000, 'the second bottle is banked on the first\'s end');
      assert.eq(Inventory.count(scene.save, 'shrinking_potion'), 0);
      assert.eq(drink.call(scene, 'shrinking_potion'), false);
    });
  });

  test('shrinking potion: expiry restores capacity without healing and Time removes it safely', () => {
    withClock(() => {
      const save = { energy: 35, shrinkingPotionUntil: T0 + 180_000 };
      assert.eq(Energy.expireShrinking(save, T0 + 179_999), false);
      assert.eq(Energy.maxEnergy(save), 50);
      assert.eq(Energy.expireShrinking(save, T0 + 180_000), true);
      assert.eq(save.maxEnergy, 100);
      assert.eq(save.energy, 35);
      assert.eq(Energy.expireShrinking(save, T0 + 180_001), false);
      save.shrinkingPotionUntil = T0 + 180_000;
      Energy.maxEnergy(save);
      PlayerTime.reset({ save });
      assert.eq(save.shrinkingPotionUntil, undefined);
      assert.eq(save.maxEnergy, 100);
      assert.eq(save.energy, 35);
    });
  });

  test('shrinking potion: stealth adds one to jewelry and disappears at expiry', () => {
    withClock(setNow => {
      const save = { inv: [] };
      const jewel = Object.keys(UNIQUE_JEWELRY).find(id => UNIQUE_JEWELRY[id].visionCells);
      assert.truthy(jewel);
      save.inv.push({ id: jewel, count: 1 });
      const baseline = jewelryVisionReduction(save);
      save.shrinkingPotionUntil = T0 + 180_000;
      assert.eq(jewelryVisionReduction(save), baseline + 1);
      setNow(T0 + 180_000);
      assert.eq(jewelryVisionReduction(save), baseline);
    });
  });

  test('shrinking potion: melee halves the whole hit including training and Giant damage', () => {
    withClock(setNow => {
      const match = SCENE_SRC.match(/const blow = ([\s\S]*?);\n/);
      assert.truthy(match, 'melee damage expression');
      const strike = SCENE_SRC.slice(SCENE_SRC.indexOf('  startCombat(victim'));
      const weapon = strike.match(/const weapon = Gear\.meleeWeapon\(this\.save\);/);
      assert.truthy(weapon, 'melee formula uses the actual selected or fallback melee weapon');
      const blow = new Function(weapon[0] + '\nreturn ' + match[1]);
      const scene = { save: { relics: {}, training: { melee: 2 }, giantPotionUntil: T0 + 240_000 },
        _attackMul: () => 2, _attackFlat: lift('_attackFlat') };
      const baseline = blow.call(scene);
      assert.gt(baseline, 5, 'training and Giant provide a real hit');
      scene.save.shrinkingPotionUntil = T0 + 180_000;
      assert.eq(blow.call(scene), baseline * 0.5);
      setNow(T0 + 180_000);
      assert.eq(blow.call(scene), baseline, 'Giant remains after Shrinking expires');
    });
  });

  test('shrinking potion: visual scale composes with Giant and feet stay anchored', () => {
    withClock(setNow => {
      const scene = { save: { shrinkingPotionUntil: T0 + 180_000 }, playerScale: 0.75,
        player: { setScale(value) { this.scale = value; } }, textures: { exists: () => false } };
      const sync = lift('_syncPlayerSkin');
      sync.call(scene);
      assert.eq(scene.player.scale, scene.playerScale * 0.5);
      assert.eq(scene.playerFeetNudgeY, -PLAYER_FEET_DROP_PX * scene.playerScale * 0.5);
      scene.save.giantPotionUntil = T0 + 180_000;
      sync.call(scene);
      assert.eq(scene.player.scale, scene.playerScale * 0.75);
      assert.eq(scene.playerFeetNudgeY, -PLAYER_FEET_DROP_PX * scene.playerScale * 0.75);
      setNow(T0 + 180_000);
      sync.call(scene);
      assert.eq(scene.player.scale, scene.playerScale);
      assert.eq(scene.playerFeetNudgeY, -PLAYER_FEET_DROP_PX * scene.playerScale);
    });
  });
})();
