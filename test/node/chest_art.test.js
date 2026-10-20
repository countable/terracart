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

  test('pot art: pottery has its own landscape painting and loading thumbnail', () => {
    const art = chestOpeningArt(chest({ barrel: true, barrelStyle: 'clay_pot' }));
    assert.eq(art, 'treasure_pot');
    const dims = webpDims('assets/art/' + art + '.webp');
    assert.truthy(dims && Math.abs(dims.w / dims.h - 4 / 3) < .01);
    assert.truthy(ART_THUMBS_SRC.includes(art + ": 'data:image/webp;base64,"));
  });

  test('barrel art: new items open one card in barrels and pots', () => {
    const original = globalThis.rollBarrel;
    try {
      globalThis.rollBarrel = () => ({ kind: 'item', id: 'wood', qty: 2 });
      for (const barrelStyle of ['barrel', 'clay_pot']) {
        let cards = 0, toasts = 0;
        const save = { opened: [] };
        const o = chest({ id: 'art_' + barrelStyle, barrel: true, barrelStyle });
        const scene = makeScene({ worldIconHTML: (key, size, frame) => `${key}:${frame}`, flashLoot() { toasts++; }, showChestRewardModal(card) {
          cards++;
          assert.eq(card.art, barrelStyle === 'barrel' ? 'treasure_barrel' : 'treasure_pot');
          assert.eq(card.kindIcon, `${barrelStyle}:${chestLook(o).frame}`, 'the dialog header uses the same container sprite');
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

  test('small containers: isSmallContainer is the one kind group the barrel and chest lanes read', () => {
    for (const shape of [{ barrel: true, barrelStyle: 'barrel' }, { barrel: true, barrelStyle: 'clay_pot' },
      { poiClass: 'waste_basket' }, { tierSeed: 1 }, { crate: true, tierSeed: 5 }, { quarryCrate: true, tierSeed: 5 },
      { poiClass: 'bus' }]) {
      assert.truthy(isSmallContainer(chest(shape)), JSON.stringify(shape));
    }
    for (const shape of [{ tierSeed: 2 }, { tierSeed: 5 }, { banditStop: true }, { poiClass: 'bicycle_parking' },
      { poiClass: 'place_of_worship' }, { poiClass: 'bakery', tierSeed: 1 }, { poiClass: 'waste_basket', depth: 2 },
      { kind: 'mineralrock', tierSeed: 1 }]) {
      assert.falsy(isSmallContainer(chest(shape)), JSON.stringify(shape));
    }
    assert.falsy(isSmallContainer(null));
    // The chest lane reads the predicate, never the sprite's texKey.
    assert.truthy(/const toastOnly = isSmallContainer\(o\) && !dress\.sub && carriesItem\(save, lootId\);/.test(INTERACTABLES_SRC));
    assert.falsy(/texKey === 'box'/.test(INTERACTABLES_SRC), 'no inline box-look test in the registry');
    assert.falsy(/texKey === 'clay_pot'/.test(INTERACTABLES_SRC), 'the barrel header reads the row name');
  });

  test('small containers: a toast still fires onDismiss, and a chest with its own line keeps the card', () => {
    // A T1 box holding an already-carried item toasts — and the deferred
    // Book-read release wired to onDismiss still runs, once, right away.
    const box = () => chest({ id: 'box_held', tierSeed: 1, fixedLoot: { id: 'wood', qty: 2 } });
    {
      let cards = 0, toasts = 0, reveals = 0;
      const save = { opened: [], inv: [{ id: 'wood', count: 1 }] };
      const scene = makeScene({ showChestRewardModal() { cards++; }, flashLoot() { toasts++; },
        _revealPendingBookReads() { reveals++; } });
      INTERACTABLES.chest.custom(makeCtx(scene, save), box());
      assert.eq(cards, 0); assert.eq(toasts, 1);
      assert.eq(reveals, 1, 'the toast releases what the card would have on dismiss');
    }
    // The same box at a trail's end carries the trail line: the card shows it
    // even though the item is carried, and onDismiss fires only when dismissed.
    const original = HomeArea.isTrailChest;
    try {
      HomeArea.isTrailChest = (scene, o) => o.id === 'box_held';
      let toasts = 0, reveals = 0, card = null;
      const save = { opened: [], inv: [{ id: 'wood', count: 1 }] };
      const scene = makeScene({ showChestRewardModal(c) { card = c; }, flashLoot() { toasts++; },
        _revealPendingBookReads() { reveals++; } });
      INTERACTABLES.chest.custom(makeCtx(scene, save), box());
      assert.eq(toasts, 0, 'a dressed chest never toasts');
      assert.truthy(card, 'the card opens');
      assert.includes(card.sub, 'The trail’s end holds a richer find.');
      assert.eq(card.kind, 'treasure');
      assert.eq(reveals, 0);
      card.onDismiss();
      assert.eq(reveals, 1, 'the card still releases the deferred read on dismiss');
    } finally { HomeArea.isTrailChest = original; }
    // Rewards.present itself: toast mode fires onDismiss once; card mode hands it to the modal.
    {
      let fired = 0, modal = null;
      const scene = makeScene({ showChestRewardModal(c) { modal = c; } });
      assert.truthy(Rewards.present(scene, { kind: 'item', id: 'wood', qty: 1 }, { mode: 'toast', extra: { onDismiss: () => fired++ } }));
      assert.eq(fired, 1);
      assert.truthy(Rewards.present(scene, { kind: 'gold', amount: 3 }, { mode: 'toast', extra: { onDismiss: () => fired++ } }));
      assert.eq(fired, 2, 'coins too');
      assert.truthy(Rewards.present(scene, { kind: 'item', id: 'wood', qty: 1 }, { extra: { onDismiss: () => fired++ } }));
      assert.eq(fired, 2, 'a card waits for its dismissal');
      modal.onDismiss(); assert.eq(fired, 3);
    }
  });

  test('small containers: a barrel releases a deferred Book read on whichever path presents', () => {
    const original = globalThis.rollBarrel;
    try {
      globalThis.rollBarrel = () => ({ kind: 'item', id: 'book', qty: 1 });
      // A scene without the loot card (Rewards.present → false): the grant
      // deferred the read, so the toast must release it, once, at once.
      {
        const grants = [];
        let reveals = 0, toasts = 0;
        const save = { opened: [], inv: [] };
        const scene = makeScene({ showChestRewardModal: undefined, flashLoot() { toasts++; },
          addToInv(id, n, silent, opts) { grants.push({ id, opts }); return n; },
          _revealPendingBookReads() { reveals++; } });
        INTERACTABLES.chest.custom(makeCtx(scene, save), chest({ id: 'barrel_book_toast', barrel: true, barrelStyle: 'barrel' }));
        assert.eq(grants.length, 1); assert.eq(grants[0].id, 'book');
        assert.truthy(grants[0].opts.deferBookRead, 'a new item defers its read behind the ceremony');
        assert.eq(toasts, 1); assert.eq(reveals, 1, 'the toast released the deferred read');
      }
      // A scene with the card: the read waits for the card's dismissal.
      for (const barrelStyle of ['barrel', 'clay_pot']) {
        let reveals = 0, toasts = 0, card = null;
        const save = { opened: [], inv: [] };
        const scene = makeScene({ showChestRewardModal(c) { card = c; }, flashLoot() { toasts++; },
          addToInv(id, n) { return n; }, _revealPendingBookReads() { reveals++; } });
        INTERACTABLES.chest.custom(makeCtx(scene, save), chest({ id: 'barrel_book_card_' + barrelStyle, barrel: true, barrelStyle }));
        assert.eq(toasts, 0); assert.truthy(card);
        assert.eq(card.header, barrelStyle === 'clay_pot' ? 'Inside the clay pot' : 'Inside the barrel');
        assert.eq(reveals, 0, 'not before the card closes');
        card.onDismiss(); assert.eq(reveals, 1);
      }
      // An already-carried item never defers, and its toast's release is a harmless no-op call.
      {
        const grants = [];
        let reveals = 0, cards = 0, toasts = 0;
        const save = { opened: [], inv: [{ id: 'wood', count: 1 }] };
        globalThis.rollBarrel = () => ({ kind: 'item', id: 'wood', qty: 2 });
        const scene = makeScene({ showChestRewardModal() { cards++; }, flashLoot() { toasts++; },
          addToInv(id, n, silent, opts) { grants.push(opts); return n; }, _revealPendingBookReads() { reveals++; } });
        INTERACTABLES.chest.custom(makeCtx(scene, save), chest({ id: 'barrel_wood_held', barrel: true, barrelStyle: 'barrel' }));
        assert.falsy(grants[0].deferBookRead); assert.eq(cards, 0); assert.eq(toasts, 1); assert.eq(reveals, 1);
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
