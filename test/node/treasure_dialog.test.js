(() => {
  test('X treasure: claims and pays before its own acknowledgment, without rerolling on another tap', () => {
    const handler = TAP_HANDLERS.find(h => h.name === 'treasure');
    const cache = new Map(WorldGen.tileCache), originalPick = globalThis.pickReward, originalFar = globalThis.tooFar;
    try {
      for (const mark of [
        { id: 'dig_normal', x: 2, y: 2 },
        { id: 'dig_bonus', x: 2, y: 2, rollBonus: 2 },
      ]) {
        const save = { foundTreasures: [], hiddenDiscoveries: { [mark.id]: true } };
        let cards = 0, rolls = 0, toast = 0;
        const scene = makeScene({ save, cellM: WorldGen.CELL_M, cellsPerTile: 48,
          tileEdgeM: 48 * WorldGen.CELL_M, startWorldM: { x: 0, y: 0 },
          originPx: { x: 0, y: 0 }, mPerPx: 1,
          digTreasureOpts: () => ({ tier: 3, rollBonus: 1 }),
          flashLoot() { toast++; },
          showChestRewardModal(card) {
            cards++;
            assert.includes(save.foundTreasures, mark.id, 'claim precedes presentation');
            assert.eq(scene.invCount('wood'), 2, 'reward is already paid');
            assert.eq(card.kind, 'treasure');
            assert.eq(card.header, 'X marks the spot');
            assert.eq(card.art, 'treasure_dig');
          },
        });
        const ctx = { ...makeCtx(scene, save), wm: { x: mark.x, y: mark.y } };
        WorldGen.tileCache.clear();
        WorldGen.tileCache.set('dig_test', { treasure: mark });
        globalThis.tooFar = () => false;
        globalThis.pickReward = (context, sv, rng, opts) => {
          rolls++;
          assert.eq(context, treasureContextFor(mark));
          assert.eq(opts.tier, 3, 'cave tier stays intact');
          assert.eq(opts.rollBonus, mark.rollBonus || 1, 'authored bonus overrides the cave bonus');
          return { kind: 'item', id: 'wood', qty: 2 };
        };
        assert.eq(handler.try(ctx), true);
        assert.truthy(ctx.dirty);
        assert.eq(handler.try(ctx), false);
        assert.eq(cards, 1);
        assert.eq(rolls, 1);
        assert.eq(toast, 0, 'dialog replaces the ordinary reward toast');
        assert.eq(scene.invCount('wood'), 2);
      }
    } finally {
      globalThis.pickReward = originalPick;
      globalThis.tooFar = originalFar;
      WorldGen.tileCache.clear();
      for (const [key, value] of cache) WorldGen.tileCache.set(key, value);
    }
  });
})();
