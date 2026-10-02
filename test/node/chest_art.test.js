(function () {
  const chest = (over = {}) => ({ kind: 'chest', id: 'chest_art_test', x: 0, y: 0, ...over });

  test('chest art: all seven source tiers follow the visible container and cave cap', () => {
    for (let tier = 1; tier <= 7; tier++) {
      const o = chest(tier <= 5 ? { tierSeed: tier } : { tierSeed: 5, depth: tier === 6 ? 3 : 6 });
      assert.eq(chestTier(o), tier);
      assert.eq(chestOpeningArt(o), 'chest_t' + tier);
      const art = chestOpeningArt(o);
      const dims = webpDims('assets/art/' + art + '.webp');
      assert.truthy(dims && Math.abs(dims.w / dims.h - 352 / 448) < 0.01,
        art + ' exists at the story panel aspect ratio');
      assert.truthy(ART_THUMBS_SRC.includes(art + ": 'data:image/webp;base64,"),
        art + ' has a loading thumbnail');
    }
    for (const [depth, cap] of [[0, 5], [2, 5], [3, 6], [5, 6], [6, 7], [20, 7]]) {
      assert.eq(chestOpeningArt(chest({ tierSeed: 7, depth })), 'chest_t' + cap);
    }
    assert.eq(chestOpeningArt(chest({ tierSeed: 2, zoneNexus: 'tar' })), 'chest_t3');
  });

  test('chest art: supplies and special appearances keep their own paintings', () => {
    assert.eq(chestOpeningArt(chest({ crate: true, tierSeed: 5 })), 'kind_supplies');
    assert.eq(chestOpeningArt(chest({ quarryCrate: true, tierSeed: 5 })), 'chest_t1', 'a physical box stays wooden');
    assert.eq(chestOpeningArt(chest({ fixedLoot: { kind: 'relic', slot: 'axe', tier: 1 } })), 'chest_t2',
      'the starter relic reward does not recolor its source trunk');
    for (const poiClass of ['atm', 'bicycle_parking', 'waste_basket', 'lodging', 'place_of_worship', 'bakery']) {
      assert.eq(chestOpeningArt(chest({ poiClass })), null, poiClass + ' keeps its special ceremony');
      assert.eq(chestOpeningArt(chest({ poiClass, depth: 2, tierSeed: 3 })), 'chest_t4',
        poiClass + ' underground is an ordinary chest');
    }
    assert.eq(chestOpeningArt(chest({ banditStop: true })), null, 'a wagon stays a wagon');
  });

  test('chest art: item, relic, armor, cash and discarded gear share source art despite reward tier', () => {
    const original = globalThis.pickReward;
    try {
      for (const reward of [
        { kind: 'item', id: 'potato', qty: 1 },
        { kind: 'relic', slot: 'axe', tier: 1 },
        { kind: 'armor', slot: 'helmet', tier: 1 },
        { kind: 'gold', amount: 3 },
        { kind: 'gold', amount: 3, slot: 'axe', tier: 1 },
      ]) {
        let modal;
        const save = { opened: [], money: 0, relics: {}, armor: {} };
        const scene = makeScene({ showChestRewardModal(value) { modal = value; } });
        globalThis.pickReward = () => ({ ...reward });
        INTERACTABLES.chest.custom(makeCtx(scene, save), chest({ tierSeed: 4 }));
        assert.eq(modal.art, 'chest_t4', reward.kind + ' retains the source tier');
      }
    } finally { globalThis.pickReward = original; }
  });

  test('chest art: partial offers and reopening held loot retain the source painting', () => {
    const original = globalThis.pickReward;
    let modal, room = 0;
    const save = { opened: [], money: 0, relics: {}, armor: {} };
    const o = chest({ tierSeed: 5 });
    const scene = makeScene({ invRoomFor: () => room, showChestRewardModal(value) { modal = value; } });
    const ctx = makeCtx(scene, save);
    try {
      globalThis.pickReward = () => ({ kind: 'item', id: 'potato', qty: 3 });
      INTERACTABLES.chest.custom(ctx, o);
      assert.eq(modal.art, 'chest_t5');
      modal.actions[0].onClick();
      room = 9;
      INTERACTABLES.chest.custom(ctx, o);
      assert.eq(modal.art, 'chest_t5');
      assert.eq(scene.invCount('potato'), 3);
    } finally { globalThis.pickReward = original; }
  });
})();
