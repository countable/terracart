(function () {
  const uniques = () => ITEMS.filter(item => item.kind === 'unique_relic' && !isTome(item.id) && !item.progressionOnly);
  const held = ids => ({ inv: ids.map(id => ({ id, count: 1 })), relics: {}, armor: {} });
  const quality = { tier: 7, bracket: 5, jackpotApplied: 0 };

  test('unique relic rewards: civic owns a broad lane; culture, authority and vista add 5%', () => {
    // A boss's hoard is its own lane: half equipment, half unique relics.
    assert.eq(JSON.stringify(ChestThemes.weights('boss', 4, { depth: 0 })), JSON.stringify({ culturalGear: 50, uniqueRelics: 50 }));
    for (const theme of Object.keys(ChestThemes.themes).filter(t => t !== 'boss')) for (const tier of [1, 2, 7]) for (const depth of [0, 2]) {
      const weights = ChestThemes.weights(theme, tier, { depth });
      const share = theme === 'civic' ? 25 * (depth > 0 ? 0.6 : 1)
        : tier >= 2 && ['culture', 'authority', 'vista'].includes(theme) ? 5 : 0;
      assert.eq(weights.uniqueRelics || 0, share, `${theme} T${tier} depth${depth}`);
      assert.inRange(Object.values(weights).reduce((sum, value) => sum + value, 0), 100 - 1e-9, 100 + 1e-9);
    }
  });

  test('unique relic rewards: every held item is excluded before highest/lower tier selection', () => {
    const items = uniques().sort((a, b) => a.baseTier - b.baseTier);
    assert.eq(items.length, 18, 'eighteen treasure finds; tomes belong to the scholar');
    const available = [items[0], items[items.length - 1]];
    const save = held(items.filter(item => !available.includes(item)).map(item => item.id));
    const opts = { save, theme: 'culture' };
    const resolved = ChestThemes.resolve('uniqueRelics', 7, opts);
    assert.eq(resolved.ids.length, 2);
    for (const item of available) assert.includes(resolved.ids, item.id);
    assert.eq(ChestThemes.pickItem(resolved, 7, () => 0, opts), available[0].id, 'lower-tier draw has no held copies');
    assert.eq(ChestThemes.pickItem(resolved, 7, () => 0.999, opts), available[1].id, 'highest-tier draw has no held copies');
    for (const item of items) {
      const one = ChestThemes.resolve('uniqueRelics', 7, { save: held([item.id]), theme: 'culture' });
      assert.falsy(one.ids.includes(item.id), item.id);
    }
  });

  test('unique relic rewards: a jackpot never pays a unique item from a physical T1 chest', () => {
    for (const theme of ['culture', 'authority', 'vista', 'civic']) for (const depth of [0, 2]) {
      if (theme !== 'civic') assert.falsy(ChestThemes.weights(theme, 7, { tier: 1, depth }).uniqueRelics);
      const reward = resolveChestReward(theme, quality, held([]), () => 0.999, { tier: 1, depth });
      assert.falsy(ITEM_BY_ID[reward.id]?.kind === 'unique_relic');
    }
  });

  test('unique relic rewards: the shipping chooser passes the save and pays one unowned item', () => {
    for (const missing of uniques()) {
      const save = held(uniques().filter(item => item.id !== missing.id).map(item => item.id));
      const result = resolveChestReward('culture', quality, save, () => 0.999, { tier: 4 });
      assert.eq(result.group, 'uniqueRelics');
      assert.eq(result.id, missing.id);
      assert.eq(result.tier, missing.baseTier, 'the relic keeps its fixed equipment tier');
      assert.eq(result.rolledTier, 7, 'quality metadata retains the original roll');
      assert.eq(result.qty, 1, 'quantity jackpots never duplicate a unique relic');
    }
  });

  test('unique relic rewards: exhausted eligible tier falls back to magic, but absent copies can be found again', () => {
    const save = held(uniques().map(item => item.id));
    const result = resolveChestReward('culture', quality, save, () => 0.999, { tier: 4 });
    assert.eq(ITEM_BY_ID[result.id].kind, 'magic'); assert.eq(result.resolvedGroup, 'magic'); assert.truthy(result.fallback);
    const low = ChestThemes.resolve('uniqueRelics', 2, { save, theme: 'culture' });
    assert.eq(low.group, 'magic', 'do not jump above the rolled tier');
    const first = uniques()[0];
    save.inv.find(slot => slot.id === first.id).count = 0;
    const available = ChestThemes.resolve('uniqueRelics', 7, { save, theme: 'culture' });
    assert.includes(available.ids, first.id, 'held-state policy, not lifetime collection');
  });

  test('unique relic rewards: a saved chest acquired elsewhere becomes coins once on reopening', () => {
    const id = uniques()[0].id;
    const chest = { id: 'held_unique_chest', kind: 'chest', x: 0, y: 0 };
    const save = JSON.parse(JSON.stringify({ ...held([id]), money: 0, opened: [],
      chestHold: { [chest.id]: { id, n: 1, consolation: 7 } } }));
    let modal;
    const scene = makeScene({
      invRoomFor: item => Inventory.roomFor(save, item),
      addToInv: (item, qty) => Inventory.add(save, item, qty).accepted,
      showChestRewardModal(value) { modal = value; },
    });
    const ctx = makeCtx(scene, save);
    INTERACTABLES.chest.custom(ctx, chest);
    assert.eq(Inventory.count(save, id), 1);
    assert.eq(save.money, itemValue(id) + 7);
    assert.falsy(save.chestHold[chest.id]);
    assert.includes(save.opened, chest.id);
    assert.eq(modal.name, '+' + itemValue(id));
    INTERACTABLES.chest.custom(ctx, chest);
    assert.eq(save.money, itemValue(id) + 7, 'the consumed saved chest cannot pay twice');
  });

  test('unique relic rewards: final grant protects delayed or fixed payloads and keeps ordinary quantities', () => {
    const id = uniques()[0].id, save = { inv: [], money: 0 };
    const scene = { addToInv: (item, qty) => Inventory.add(save, item, qty).accepted };
    const reward = { kind: 'item', id, qty: 3, consolation: 2 };
    assert.eq(Rewards.apply(save, reward, scene).accepted, 1);
    assert.eq(Inventory.count(save, id), 1);
    const duplicate = Rewards.apply(save, reward, scene);
    assert.eq(duplicate.accepted, 0);
    assert.eq(duplicate.money, itemValue(id) + 2);
    assert.eq(Inventory.count(save, id), 1);
    assert.eq(Rewards.apply(save, { kind: 'item', id: 'potato', qty: 3 }, scene).accepted, 3);
  });
})();
