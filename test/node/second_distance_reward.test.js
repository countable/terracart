// Exercise the actual road offer and reward payer, including reload-safe gear state.
(() => {
  const makeRewardScene = save => ({
    save: SaveState.defaults({ money: 0, inv: [], relics: {}, armor: {}, ...save }),
    iconSpanHTML: id => `<i>${id}</i>`,
    gearIconHTML: (kind, slot, tier) => `<i>${kind}:${slot}:${tier}</i>`,
    coinIconHTML: () => '<i>coin</i>',
    markRelicsDirty() {},
    addToInv(id, qty) { return Inventory.add(this.save, id, qty).accepted; },
    _claimTrailReward: liftSceneMethod('_claimTrailReward'),
  });

  test('second distance reward: fixed row offers nine spears, Wood Boots and three Pairys', () => {
    const row = Trail.secondDistanceChoices({});
    assert.eq(row.length, 3);
    assert.eq(row[0].kind, 'item'); assert.eq(row[0].id, 'throwing_spear'); assert.eq(row[0].qty, 9);
    assert.eq(row[1].kind, 'armor'); assert.eq(row[1].slot, 'boots'); assert.eq(row[1].tier, 1);
    assert.eq(row[2].kind, 'item'); assert.eq(row[2].id, 'pairy'); assert.eq(row[2].qty, 3);
    assert.truthy(ITEM_BY_ID[row[0].id]); assert.truthy(ITEM_BY_ID[row[2].id]);
    row[0].qty = 1; row[1].tier = 7;
    assert.eq(Trail.secondDistanceChoices({})[0].qty, 9, 'a presentation cannot mutate the next offer');
    assert.eq(Trail.secondDistanceChoices({})[1].tier, 1);
  });

  test('second distance reward: boots step above the highest owned tier and survive reload', () => {
    for (const tier of [1, 2, 3, 4, 5, 6]) {
      const save = JSON.parse(JSON.stringify({ armor: { boots: { tier } } }));
      const row = Trail.secondDistanceChoices(save);
      assert.eq(row[1].kind, 'armor'); assert.eq(row[1].tier, tier + 1);
      assert.eq(save.armor.boots.tier, tier, 'viewing an offer never equips it');
    }
  });

  test('second distance reward: already owning Frost Boots offers their normal duplicate cash value', () => {
    const scene = makeRewardScene({ armor: { boots: { tier: 7 } } });
    const row = Trail.secondDistanceChoices(scene.save), cash = row[1];
    const expected = reconcileRelicOffer({ kind: 'armor', slot: 'boots', tier: 7 }, scene.save, () => 0);
    assert.eq(row.length, 3); assert.eq(cash.kind, 'gold'); assert.eq(cash.amount, expected.amount);
    const card = scene._claimTrailReward(cash);
    assert.eq(card.name, `+${expected.amount}`, 'the middle card honestly shows cash');
    assert.eq(scene.save.money, expected.amount);
    assert.eq(scene.save.armor.boots.tier, 7, 'never downgrades owned boots');
  });

  test('second distance reward: real offer bypasses random groups and grants nothing until selection', () => {
    const scene = makeRewardScene({}); let offered;
    scene._offerTreasurePick = options => { offered = options; };
    liftSceneMethod('_fireTrailPrize', { TRAIL_PRIZE_HEADER: 'Thank you for repairing the roads!' }).call(scene, 2, () => {});
    assert.eq(offered.choices.length, 3);
    assert.eq(offered.choices[0].id, 'throwing_spear'); assert.eq(offered.choices[1].slot, 'boots');
    assert.eq(offered.choices[2].id, 'pairy');
    assert.eq(Inventory.count(scene.save, 'throwing_spear'), 0);
    assert.eq(Inventory.count(scene.save, 'pairy'), 0);
    assert.falsy(scene.save.armor.boots);
  });

  test('second distance reward: selecting each card grants only its stack or automatically worn boots', () => {
    for (let choice = 0; choice < 3; choice++) {
      const scene = makeRewardScene({});
      const selected = Trail.secondDistanceChoices(scene.save)[choice];
      assert.truthy(scene._claimTrailReward(selected));
      assert.eq(Inventory.count(scene.save, 'throwing_spear'), choice === 0 ? 9 : 0);
      assert.eq(Inventory.count(scene.save, 'pairy'), choice === 2 ? 3 : 0);
      assert.eq(scene.save.armor.boots?.tier || 0, choice === 1 ? 1 : 0);
      const loaded = JSON.parse(JSON.stringify(scene.save));
      assert.eq(loaded.armor.boots?.tier || 0, choice === 1 ? 1 : 0);
      assert.falsy(loaded.trail?.firstWeaponClaimed, 'the second reward does not claim the first weapon');
    }
  });

  test('second distance reward: later fixed progression rewards keep their ordinary rules', () => {
    assert.eq(Trail.fixedPrize(3, {}).slot, 'pickaxe');
    assert.eq(Trail.fixedPrize(3, { relics: { pickaxe: { tier: 1 } } }), null);
    assert.eq(Trail.fixedPrize(5, {}).id, 'serpent_idol');
    assert.truthy(Trail.fixedPrize(5, {}).sole);
    const first = Trail.firstWeaponChoices();
    assert.eq(first.map(r => r.slot).join(','), 'sword,bow,staff');
  });
})();
