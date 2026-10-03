// Two rare crops use previously unused original crop rows; their meals grant
// timed utility, with seed, plant and food all reading the existing registries.
(function () {
  const T0 = 1_700_000_000_000;
  function lift(name) {
    const start = SCENE_SRC.indexOf(`\n  ${name}(`);
    const end = SCENE_SRC.indexOf('\n  }\n', start);
    return new Function('return ({' + SCENE_SRC.slice(start, end + 4) + '})')()[name];
  }
  const effects = lift('_consumeFoodEffects'), eat = lift('eatSelected');
  function scene(id) {
    return { save: { energy: 30, inv: [{ id, count: 1 }], selSlot: 0 },
      _zeroEnergyLocked: () => false, _consumeFoodEffects: effects,
      getMaxEnergy() { return Energy.maxEnergy(this.save); },
      buildInventoryDOM() {}, updateEnergyDOM() {}, flashLoot(text) { this.flashText = text; },
    };
  }
  const cases = [
    { id: 'dawnfruit', tier: 7, row: 6, hours: 23, duration: 180000, field: 'dawnfruitUntil', buff: 'dawnfruit' },
    { id: 'miracle_lettuce', tier: 6, row: 11, hours: 14, duration: 600000, field: 'miracleLettuceUntil', buff: 'lettuce' },
  ];

  test('utility crops: distinct reused art, shared seed bag and produce badge, correct tiers', () => {
    for (const { id, tier, row } of cases) {
      assert.eq(CROP_ROW[id], row);
      assert.falsy(CROP_SPRITE[id]);
      assert.eq(ITEM_BY_ID[id].baseTier, tier);
      assert.eq(ITEM_BY_ID[id + '_seed'].baseTier, tier);
      assert.eq(ITEM_BY_ID[id + '_seed'].grows, id);
      assert.eq(inventoryIconSource(id).sheet, 'crops');
      assert.eq(inventoryIconSource(id).frame, row * 9 + 7);
      assert.eq(inventoryIconSource(id + '_seed').frame, 143);
      assert.eq(iconBadgeItem(id + '_seed'), id);
      assert.truthy(ITEM_EFFECTS[id]); assert.truthy(ITEM_EFFECTS[id + '_seed']);
    }
    assert.eq(inventoryIconSource('potato').sheet, 'springcrops');
    assert.eq(inventoryIconSource('potato').frame, 5 * 14 + 8);
    assert.eq(inventoryIconSource('cress').sheet, 'springcrops');
    assert.eq(inventoryIconSource('cress').frame, 3 * 14 + 8);
  });

  test('utility crops: full growth follows the shared tier curve and requires four waterings', () => {
    for (const { id, hours } of cases) {
      const hold = Crops.stageHoldMs(id);
      assert.eq(hold, hours * 3600000);
      const plant = { crop: id, stage: 0, watered_t: T0 };
      const save = { planted: [plant] };
      let now = T0;
      for (let stage = 1; stage <= 4; stage++) {
        plant.watered_t = now;
        assert.falsy(Crops.advanceGrowth(save, now + hold - 1));
        now += hold;
        assert.truthy(Crops.advanceGrowth(save, now));
        assert.eq(plant.stage, stage);
        assert.eq(plant.watered_t, 0);
        assert.falsy(Crops.advanceGrowth(save, now + hold), 'the next stage needs another watering');
      }
      assert.truthy(Crops.isMature(plant));
    }
  });

  test('utility crops: obtainable as high-tier farm/park/food seeds and produce, outside ordinary shops', () => {
    for (const { id, tier } of cases) {
      assert.includes(ITEMS_BY_CLASS_TIER.seed[tier], id + '_seed');
      assert.includes(ITEMS_BY_CLASS_TIER.produce[tier], id);
      assert.falsy(BUY_LIST.includes(id + '_seed'));
      for (const [theme, group] of [['farm', 'farmSeeds'], ['park', 'parkSeeds']]) {
        assert.gt(ChestThemes.weights(theme, tier)[group], 0);
        const resolved = ChestThemes.resolve(group, tier, { theme });
        assert.includes(ChestThemes.selectableIds(resolved), id + '_seed');
      }
      assert.gt(ChestThemes.weights('food', tier).food, 0);
      assert.includes(ChestThemes.selectableIds(ChestThemes.resolve('food', tier, { theme: 'food' })), id,
        'food chests offer the crop itself, never its seed');
      assert.includes(ChestThemes.selectableIds(ChestThemes.resolve('farmProduce', tier, { theme: 'farm' })), id);
      assert.falsy(Object.keys(ChestThemes.members('flowers')).includes(id), 'a utility crop is not a flower');
    }
  });

  test('utility crops: eating grants only utility, shows its effect, consumes once and shares bite cooldown', () => {
    for (const { id, field, duration } of cases) {
      const s = scene(id), before = Date.now();
      assert.eq(FOOD_ENERGY[id], 0);
      assert.truthy(eat.call(s));
      assert.eq(s.save.energy, 30, 'first taste raises the cap without healing');
      assert.eq(s.save.maxEnergy, STARTING_ENERGY + Energy.tasteBonus(id));
      assert.includes(s.save.eaten, id);
      assert.inRange(s.save[field], before + duration, Date.now() + duration);
      assert.eq(Inventory.count(s.save, id), 0);
      assert.truthy(Energy.eatCooldownLeft(s.save) > 0);
      assert.falsy(s.flashText.includes('+0⚡'));
      s.save.inv = [{ id, count: 1 }]; s.save.selSlot = 0;
      assert.falsy(eat.call(s));
      assert.eq(Inventory.count(s.save, id), 1);
    }
  });

  test('utility crops: saved timers expire exactly and refresh without stacking or shortening', () => {
    for (const { id, field, duration, buff } of cases) {
      const s = scene(id);
      effects.call(s, id, false, T0);
      assert.eq(s.save[field], T0 + duration);
      const saved = JSON.parse(JSON.stringify(s.save));
      assert.eq(Buffs.until(buff, saved, {}), T0 + duration);
      assert.eq(Buffs.active(saved, {}, T0 + 1000).find(b => b.id === buff).remainingMs, duration - 1000);
      assert.falsy(Buffs.active(saved, {}, T0 + duration).some(b => b.id === buff));
      effects.call(s, id, false, T0 + 10000);
      assert.eq(s.save[field], T0 + duration + 10000, 'refresh from this bite, not add another whole duration');
      s.save[field] = T0 + duration * 3;
      effects.call(s, id, false, T0 + 20000);
      assert.eq(s.save[field], T0 + duration * 3, 'a longer existing timer survives');
    }
  });

  test('Dawnfruit: full view remains lit and reachable at zero energy and underground, with full peek', () => {
    const now = Date.now();
    const s = scene('dawnfruit');
    effects.call(s, 'dawnfruit', false, now);
    s.cellM = 5; s.depth = 5; s.save.energy = 0;
    s.peekM = { x: 0, y: 0 };
    assert.eq(reachRadiusM(s), VIEW_CELLS * 5);
    assert.eq(Lighting.lowEnergyFrac(s), 0);
    __peek._setPeekFromDrag.call(s, 4000, 4000);
    assert.inRange(Math.hypot(s.peekM.x, s.peekM.y), PEEK_MAX_CELLS * 5 - 1e-9, PEEK_MAX_CELLS * 5 + 1e-9);
    assert.truthy(Energy.dawnfruitActive(s.save, now + 179999));
    assert.falsy(Energy.dawnfruitActive(s.save, now + 180000));
    s.save.dawnfruitUntil = now - 1;
    assert.eq(reachRadiusM(s), 0);
    assert.eq(Lighting.lowEnergyFrac(s), 1);
    __peek._setPeekFromDrag.call(s, 4000, 4000);
    assert.inRange(Math.hypot(s.peekM.x, s.peekM.y), PEEK_MAX_CELLS * 2.5 - 1e-9, PEEK_MAX_CELLS * 2.5 + 1e-9);
  });

  test('Dawnfruit: an existing longer reach potion or positive buff is preserved', () => {
    const s = scene('dawnfruit');
    s.save.reachPotionUntil = T0 + 600000;
    s.save.coffeeUntil = T0 + 600000;
    effects.call(s, 'dawnfruit', false, T0);
    assert.eq(s.save.reachPotionUntil, T0 + 600000);
    assert.eq(s.save.coffeeUntil, T0 + 600000);
    assert.truthy(Energy.fullViewReachActive(s.save, T0 + 180000));
    assert.falsy(Energy.fullViewReachActive(s.save, T0 + 600000));
  });

  test('Miracle Lettuce: adds exactly one Luck alongside upgrades, Lucky Key and shrine fortune', () => {
    const s = scene('miracle_lettuce');
    s.save.luckUpgrades = 7;
    s.save.inv.push({ id: 'lucky_key', count: 1 });
    s.save.boonUntil = { fortune: T0 + 1200000 };
    const before = upgradeLuck(s.save, T0);
    effects.call(s, 'miracle_lettuce', false, T0);
    const bonus = CONSUMABLE_SPEC.miracle_lettuce.luckBonus * RARITY_TUNING.luckPerUpgrade;
    assert.inRange(upgradeLuck(s.save, T0) - before, bonus - 1e-9, bonus + 1e-9);
    effects.call(s, 'miracle_lettuce', false, T0 + 10000);
    assert.inRange(upgradeLuck(s.save, T0 + 10000) - before, bonus - 1e-9, bonus + 1e-9);
    assert.eq(upgradeLuck(s.save, T0 + 610000), before, 'expiry drops only the meal');
    assert.eq(s.save.luckUpgrades, 7);
  });
})();
