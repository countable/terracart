// Exercise the real drink and damage helpers without a Phaser scene.
(function () {
  const T0 = 1_700_000_000_000;
  function sceneMethod(name) {
    const start = SCENE_SRC.indexOf('\n  ' + name + '(');
    assert.truthy(start >= 0, `found ${name}`);
    const end = SCENE_SRC.indexOf('\n  }\n', start);
    return new Function('return ({' + SCENE_SRC.slice(start, end + 4)
      + '})[' + JSON.stringify(name) + ']')();
  }
  function withClock(fn) {
    const original = Date.now;
    let now = T0;
    Date.now = () => now;
    try { fn(value => { now = value; }); }
    finally { Date.now = original; }
  }
  function potionScene(id = 'giant_potion', count = 2) {
    return {
      save: { inv: [{ id, count }], selSlot: 0, energy: 40 },
      _finishConsumable: sceneMethod('_finishConsumable'),
      buildInventoryDOM() {},
      updateEnergyDOM() {},
      _syncPlayerSkin() {},
      showMessageModal() {},
    };
  }

  test('giant potion: T4 drink offers melee damage and size for three minutes', () => {
    assert.eq(BASE_TIER.giant_potion, 4);
    assert.eq(ITEM_BY_ID.giant_potion.kind, 'magic');
    assert.eq(ITEM_BY_ID.giant_potion.potion, true);
    assert.eq(PRICES.giant_potion, 100);
    assert.eq(CONSUMABLE_SPEC.giant_potion.method, 'drinkGiantPotion');
    assert.eq(CONSUMABLE_SPEC.giant_potion.durationMs, 180_000);
    assert.eq(CONSUMABLE_SPEC.giant_potion.damageBonus, 5);
    assert.eq(CONSUMABLE_SPEC.giant_potion.maxHpBonus, 100);
    assert.eq(CONSUMABLE_SPEC.giant_potion.scaleMul, 1.5);
    assert.truthy(Shops.themedStock('potion', 4).includes('giant_potion'));
  });

  test('giant potion: drinking consumes one flask, refreshes without stacking, and expires', () => {
    withClock(setNow => {
      const scene = potionScene();
      const drink = sceneMethod('drinkGiantPotion');
      assert.eq(drink.call(scene), true);
      assert.eq(scene.save.inv[0].count, 1);
      assert.eq(scene.save.giantPotionUntil, T0 + 180_000);
      assert.eq(scene.save.energy, 40, 'drinking increases capacity without healing');
      assert.eq(Combat.giantDamageBonus(scene.save), 5);
      setNow(T0 + 60_000);
      assert.eq(drink.call(scene), true);
      assert.eq(Inventory.count(scene.save, 'giant_potion'), 0);
      assert.eq(scene.save.giantPotionUntil, T0 + 240_000, 'fresh duration, no accumulated time');
      assert.eq(Combat.giantDamageBonus(scene.save), 5, 'second drink does not double damage');
      assert.eq(Combat.giantDamageBonus(scene.save, T0 + 239_999), 5);
      assert.eq(Combat.giantDamageBonus(scene.save, T0 + 240_000), 0, 'expires at the boundary');
      assert.eq(Combat.giantDamageBonus({}, T0), 0, 'old saves have no bonus');
    });
  });

  test('giant potion: empty or wrong selections cannot activate the buff; drinking consumes the flask', () => {
    withClock(() => {
      const drink = sceneMethod('drinkGiantPotion');
      for (const scene of [potionScene('giant_potion', 0), potionScene('reach_potion')]) {
        assert.eq(drink.call(scene), false);
        assert.eq(scene.save.giantPotionUntil, undefined);
      }
      const scene = potionScene('giant_potion', 1);
      assert.eq(drink.call(scene), true);
      assert.eq(Inventory.count(scene.save, 'giant_potion'), 0);
      assert.eq(scene.save.giantPotionUntil, T0 + 180_000);
    });
  });

  test('giant potion: melee gains five alongside training; bows, staff and speed do not', () => {
    withClock(() => {
      const flat = sceneMethod('_attackFlat');
      const scene = { save: { training: { melee: 2, ranged: 2, magic: 2 }, giantPotionUntil: T0 + 1 } };
      assert.eq(Combat.TRAINING_SLOT_KIND.bow, 'ranged');
      assert.eq(Combat.TRAINING_SLOT_KIND.staff, 'magic');
      for (const kind of ['melee', 'ranged', 'magic']) {
        assert.eq(flat.call(scene, kind), Combat.trainingBonus(scene.save, kind) + (kind === 'melee' ? 5 : 0));
      }
      assert.eq(flat.call(scene, 'speed'), 0);
      scene.save.giantPotionUntil = T0;
      assert.eq(flat.call(scene, 'melee'), Combat.trainingBonus(scene.save, 'melee'));
      assert.eq(flat.call(scene, 'ranged'), Combat.trainingBonus(scene.save, 'ranged'));
      assert.truthy(/Combat\.meleeSwingDamage\([^;]+\)\s*\+ this\._attackFlat\('melee'\)/.test(SCENE_SRC),
        'melee adds the flat bonus after its attack multiplier');
      assert.truthy(/Combat\.shotDamage\([^\n]+\) \* dmgMul\s*\+ this\._attackFlat\(Combat\.TRAINING_SLOT_KIND\[slot\]\)/.test(SCENE_SRC),
        'projectiles add the flat bonus after their attack multiplier');
    });
  });

  test('giant potion: saved expiry drives its countdown and removes it when expired', () => {
    const save = { giantPotionUntil: T0 + 180_000 };
    assert.eq(Buffs.KINDS.giant.save, 'giantPotionUntil');
    assert.eq(Buffs.active(save, {}, T0).find(row => row.id === 'giant').remainingMs, 180_000);
    assert.falsy(Buffs.active(save, {}, T0 + 180_000).some(row => row.id === 'giant'));
  });

  test('giant potion: max HP gains exactly 100 temporarily alongside permanent upgrades', () => {
    withClock(setNow => {
      const save = { eaten: ['potato'], vigourUpgrades: 2, training: { energy: 2 } };
      const baseline = Energy.maxEnergy(save);
      save.giantPotionUntil = T0 + 180_000;
      assert.eq(Energy.maxEnergy(save), baseline + 100);
      assert.eq(Energy.maxEnergy(save), baseline + 100, 'recalculation never stacks the cap');
      setNow(T0 + 180_000);
      assert.eq(Energy.maxEnergy(save), baseline, 'expiry removes only the temporary cap');
    });
  });

  test('giant potion: expiry clamps excess HP without healing a wounded player', () => {
    const save = { energy: 150, giantPotionUntil: T0 + 180_000 };
    assert.eq(Energy.expireGiant(save, T0 + 179_999), false);
    assert.eq(save.energy, 150, 'active giant keeps its extra HP');
    assert.eq(Energy.expireGiant(save, T0 + 180_000), true);
    assert.eq(save.giantPotionUntil, undefined);
    assert.eq(save.energy, Energy.maxEnergy(save, T0 + 180_000));
    assert.eq(Energy.expireGiant(save, T0 + 180_001), false, 'expiry is handled once');
    save.energy = 40;
    save.giantPotionUntil = T0;
    assert.eq(Energy.expireGiant(save, T0), true);
    assert.eq(save.energy, 40, 'expiry cannot heal');
  });

  test('giant potion: sprite grows with its foot offset and returns to normal at expiry', () => {
    withClock(setNow => {
      const sync = sceneMethod('_syncPlayerSkin');
      for (const ready of [true, false]) {
        setNow(T0);
        const scene = {
          save: { giantPotionUntil: T0 + 180_000 },
          player: { setScale(value) { this.scale = value; } },
          playerScale: 0.75,
          textures: { exists: () => ready },
          anims: { get: () => ({ frames: [1] }) },
        };
        const art = SpriteLayout.playerArt(scene.save);
        const baseScale = ready ? art.scale : scene.playerScale;
        const footDrop = ready ? art.footDrop : PLAYER_FEET_DROP_PX;
        sync.call(scene);
        assert.eq(scene.player.scale, baseScale * 1.5, 'loaded skin or fallback grows');
        assert.eq(scene.playerFeetNudgeY, -footDrop * baseScale * 1.5, 'feet remain at the ground anchor');
        sync.call(scene);
        assert.eq(scene.player.scale, baseScale * 1.5, 'frame updates do not compound scale');
        setNow(T0 + 180_000);
        sync.call(scene);
        assert.eq(scene.player.scale, baseScale);
        assert.eq(scene.playerFeetNudgeY, -footDrop * baseScale);
      }
    });
  });

  test('giant potion: dragon transformation preserves its own scale and restores it at expiry', () => {
    withClock(setNow => {
      const sync = sceneMethod('_syncPlayerSkin');
      const scene = {
        save: { giantPotionUntil: T0 + 180_000 },
        player: { setScale(value) { this.scale = value; } },
        _dragonActive: true, dragonScale: 0.4, playerScale: 0.75,
      };
      sync.call(scene);
      assert.eq(scene.player.scale, scene.dragonScale * 1.5);
      assert.eq(scene.playerFeetNudgeY, -PLAYER_FEET_DROP_PX * scene.playerScale * 1.5);
      setNow(T0 + 180_000);
      sync.call(scene);
      assert.eq(scene.player.scale, scene.dragonScale);
      assert.eq(scene.playerFeetNudgeY, -PLAYER_FEET_DROP_PX * scene.playerScale);
    });
  });
})();
