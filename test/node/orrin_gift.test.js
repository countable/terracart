test('Orrin gift: early dialogue grants a crude table once, with full-bag retry', () => {
  const oldPresent = Rewards.present;
  const rewards = [];
  Rewards.present = (scene, gift, opts) => rewards.push({ ...gift, reply: opts.extra.sub });
  try {
    for (const choiceIndex of [0, 1, 2]) {
      let full = true, offer, message, refreshes = 0;
      const scene = {
        save: { inv: [] }, _dialogOpen: () => false,
        showChestRewardModal(o) { offer = o; },
        showMessageModal(o) { message = o.body; },
        addToInv(id, qty, silent, opts) {
          assert.truthy(opts.deferRefresh, 'gift and acknowledgement persist together');
          return full ? 0 : Inventory.add(this.save, id, qty).accepted;
        },
        _finishInventoryChange() { refreshes++; },
      };
      const c = { kind: 'npc', id: 'orrin', role: 'archaeologist', name: 'Orrin', x: 0, y: 0 };
      NPC.interact(scene, c, 0, 0);
      assert.includes(offer.sub, 'crude table');
      assert.eq(Inventory.count(scene.save, 'table_oak'), 0, 'reading gives nothing');
      offer.actions.at(-1).onClick();
      assert.eq(MemoryStory.archaeologistConversation(scene.save).topic, 'introduction', 'leaving keeps the gift');
      NPC.interact(scene, c, 0, 0);
      offer.actions[choiceIndex].onClick();
      assert.includes(message, 'Make room');
      assert.eq(MemoryStory.archaeologistConversation(scene.save).topic, 'introduction', 'full bag keeps introduction available');
      full = false;
      NPC.interact(scene, c, 0, 0);
      const stale = offer.actions[choiceIndex];
      NPC.interact(scene, c, 0, 0);
      const accept = offer.actions[choiceIndex];
      accept.onClick(); accept.onClick(); stale.onClick();
      assert.eq(Inventory.count(scene.save, 'table_oak'), 1, 'double and stale answers never duplicate');
      assert.eq(refreshes, 1);
      assert.eq(rewards.at(-1).id, 'table_oak');
      assert.truthy(rewards.at(-1).reply.length > 0, 'gift card includes Orrin’s reply');
      scene.save = JSON.parse(JSON.stringify(scene.save));
      NPC.interact(scene, c, 0, 0);
      offer.actions[0].onClick();
      assert.eq(Inventory.count(scene.save, 'table_oak'), 1, 'later conversations do not repeat the gift');
    }
    assert.eq(rewards.length, 3, 'every introduction response awards one table');
    assert.eq(ITEM_BY_ID.table_oak.baseTier, 1, 'the gift uses the crude furniture style');
  } finally { Rewards.present = oldPresent; }
});
