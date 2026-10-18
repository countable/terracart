(function () {
  const chest = (over = {}) => ({ kind: 'chest', id: 'chest_art_test', x: 0, y: 0, ...over });

  test('chest art: all seven source tiers follow the visible container and cave cap', () => {
    for (let tier = 1; tier <= 7; tier++) {
      const o = chest(tier <= 5 ? { tierSeed: tier } : { tierSeed: 5, depth: tier === 6 ? 4 : 7 });
      assert.eq(chestTier(o), tier);
      assert.eq(chestOpeningArt(o), 'chest_t' + tier);
      const art = chestOpeningArt(o);
      const dims = webpDims('assets/art/' + art + '.webp');
      assert.truthy(dims && Math.abs(dims.w / dims.h - 4 / 3) < 0.01,
        art + ' exists at the story panel aspect ratio');
      assert.truthy(ART_THUMBS_SRC.includes(art + ": 'data:image/webp;base64,"),
        art + ' has a loading thumbnail');
    }
    for (const [depth, cap] of [[0, 5], [2, 5], [3, 5], [4, 6], [6, 6], [7, 7], [20, 7]]) {
      assert.eq(chestOpeningArt(chest({ tierSeed: 7, depth })), 'chest_t' + cap);
    }
    assert.eq(chestOpeningArt(chest({ tierSeed: 2, zoneNexus: 'tar' })), 'chest_t3');
  });

  test('chest art: supplies and special appearances keep their own paintings', () => {
    assert.eq(chestOpeningArt(chest({ crate: true, tierSeed: 5 })), 'treasure_crate');
    assert.eq(chestOpeningArt(chest({ quarryCrate: true, tierSeed: 5 })), 'treasure_crate', 'a physical box keeps its own painting');
    assert.eq(chestOpeningArt(chest({ fixedLoot: { kind: 'relic', slot: 'axe', tier: 1 } })), 'chest_t2',
      'the starter relic reward does not recolor its source trunk');
    for (const poiClass of ['atm', 'bicycle_parking', 'lodging', 'place_of_worship', 'bakery']) {
      assert.eq(chestOpeningArt(chest({ poiClass })), null, poiClass + ' keeps its special ceremony');
      assert.eq(chestOpeningArt(chest({ poiClass, depth: 2, tierSeed: 3 })), 'chest_t4',
        poiClass + ' underground is an ordinary chest');
    }
    assert.eq(chestOpeningArt(chest({ banditStop: true })), null, 'a wagon stays a wagon');
  });

  test('barrel art: new items open one card in barrels and pots', () => {
    const original = globalThis.rollBarrel;
    try {
      globalThis.rollBarrel = () => ({ kind: 'item', id: 'wood', qty: 2 });
      for (const barrelStyle of ['barrel', 'clay_pot']) {
        let cards = 0, toasts = 0;
        const save = { opened: [] };
        const o = chest({ id: 'art_' + barrelStyle, barrel: true, barrelStyle });
        const scene = makeScene({ flashLoot() { toasts++; }, showChestRewardModal(card) {
          cards++;
          assert.eq(card.art, barrelStyle === 'barrel' ? 'treasure_barrel' : undefined);
          assert.includes(save.opened, o.id);
          assert.eq(scene.invCount('wood'), 2);
        } });
        const ctx = makeCtx(scene, save);
        INTERACTABLES.chest.custom(ctx, o);
        INTERACTABLES.chest.custom(ctx, o);
        assert.eq(cards, 1);
        assert.eq(toasts, 0);
        assert.eq(scene.invCount('wood'), 2);
      }
    } finally { globalThis.rollBarrel = original; }
  });

  test('small containers: held items toast while unheld items and higher chests show cards', () => {
    const original = globalThis.rollBarrel;
    try {
      globalThis.rollBarrel = () => ({ kind: 'item', id: 'wood', qty: 2 });
      for (const shape of [{ barrel: true, barrelStyle: 'barrel' },
        { barrel: true, barrelStyle: 'clay_pot' }, { tierSeed: 1 }, { crate: true }, { tierSeed: 2 }]) {
        for (const held of [false, true]) {
          let cards = 0, toasts = 0;
          const save = { opened: [], inv: held ? [{ id: 'wood', count: 1 }] : [] };
          const scene = makeScene({ showChestRewardModal() { cards++; }, flashLoot() { toasts++; } });
          const ctx = makeCtx(scene, save);
          INTERACTABLES.chest.custom(ctx, chest({ ...shape, ...(shape.barrel ? {} : { fixedLoot: { id: 'wood', qty: 2 } }) }));
          const toast = held && shape.tierSeed !== 2;
          assert.eq(cards, toast ? 0 : 1, JSON.stringify({ shape, held }));
          assert.eq(toasts, toast ? 1 : 0);
          assert.eq(scene.invCount('wood'), 2);
        }
      }
    } finally { globalThis.rollBarrel = original; }
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
