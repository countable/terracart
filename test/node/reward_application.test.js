(() => {
  test('reward grant: item capacity, gear and cash share the same payout rules', () => {
    const save = { money: 10, inv: [{ id: 'potato', count: 8 }], relics: {}, armor: {} };
    let dirty = 0, options;
    const scene = {
      addToInv(id, qty, silent, opts) { options = opts; return Inventory.add(save, id, qty).accepted; },
      markRelicsDirty() { dirty++; },
    };
    const result = Rewards.apply(save, { kind: 'item', id: 'potato', qty: 3, consolation: 2 }, scene,
                                 { deferBookRead: true });
    assert.eq(result.accepted, 1, 'reports actual capacity');
    assert.eq(Inventory.count(save, 'potato'), 9);
    assert.eq(save.money, 12, 'consolation paid once');
    assert.truthy(options.deferBookRead, 'book ceremony options reach the scene');
    Rewards.apply(save, { kind: 'armor', slot: 'helmet', tier: 3 }, scene);
    assert.eq(save.armor.helmet.tier, 3);
    assert.eq(dirty, 1);
    Rewards.apply(save, { kind: 'gold', amount: 17, slot: 'axe', consolation: 1 }, scene);
    assert.eq(save.money, 30, 'gear cash-out and consolation both paid');
    assert.eq(Rewards.apply(save, { kind: 'unknown', consolation: 99 }, scene), null);
    assert.eq(save.money, 30, 'unknown rewards do not pay');
  });

  test('chest: leaving an item defers its consolation until the saved roll is claimed', () => {
    const original = globalThis.pickReward;
    const save = { money: 0, opened: [], relics: {}, armor: {} };
    const chest = { id: 'deferred_reward_test', kind: 'chest', x: 0, y: 0 };
    let modal, room = 0;
    const scene = makeScene({ invRoomFor: () => room, showChestRewardModal(m) { modal = m; } });
    const ctx = makeCtx(scene, save);
    try {
      globalThis.pickReward = () => ({ kind: 'item', id: 'potato', qty: 3, consolation: 7 });
      INTERACTABLES.chest.custom(ctx, chest);
      assert.eq(save.money, 0, 'opening the choice pays nothing');
      modal.actions[0].onClick();
      assert.eq(save.money, 0, 'leaving pays nothing');
      assert.eq(save.chestHold[chest.id].consolation, 7, 'coins stay with the saved roll');
      room = 9;
      INTERACTABLES.chest.custom(ctx, chest);
      assert.eq(scene.invCount('potato'), 3);
      assert.eq(save.money, 7);
      INTERACTABLES.chest.custom(ctx, chest);
      assert.eq(save.money, 7, 'an emptied chest cannot pay twice');
    } finally { globalThis.pickReward = original; }
  });

  test('road rewards: identical rolls pay a sixth of the cash and preserve other rewards', () => {
    const context = LOOT_CONTEXTS['treasure:road'];
    const multiplier = context.cashMul;
    assert.eq(multiplier, 1 / 6);
    let cash = 0, items = 0;
    try {
      for (let i = 1; i <= 300; i++) {
        context.cashMul = 1;
        const before = pickReward('treasure:road', { relics: {}, armor: {} }, seeded(i), { rollBonus: 3 });
        context.cashMul = multiplier;
        const after = pickReward('treasure:road', { relics: {}, armor: {} }, seeded(i), { rollBonus: 3 });
        if (before.kind === 'gold') {
          assert.eq(after.amount, Math.max(1, Math.round(before.amount * multiplier)));
          cash++;
          before.amount = after.amount;
        } else { items++; }
        assert.eq(JSON.stringify(after), JSON.stringify(before), 'only the cash amount changes');
      }
      assert.gt(cash, 20);
      assert.gt(items, 100);
      assert.eq(LOOT_CONTEXTS['chest:commerce'].cashMul, undefined, 'other cash pools keep their multiplier');
    } finally { context.cashMul = multiplier; }
  });
})();
