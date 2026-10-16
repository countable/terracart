(() => {
  const well = { kind: 'well', id: 'test-well', x: 8, y: 8 };
  test('well: clears every debuff, preserves buffs and energy, and can cure again', () => {
    const save = { energy: 50, coffeeUntil: Date.now() + 60000 };
    Energy.startFishRegen(save, 'bass');
    const coffee = save.coffeeUntil, fish = JSON.stringify(save.fishRegen);
    const messages = [];
    const scene = makeScene({ save, flash: text => messages.push(text) });
    for (let tap = 0; tap < 2; tap++) {
      for (const id of Object.keys(Conditions.DEFINITIONS)) Conditions.apply(save, id);
      const ctx = makeCtx(scene, save);
      assert.eq(runInteractable(ctx, well), true);
      assert.falsy(Conditions.hasDebuffs(save));
      assert.truthy(ctx.dirty, 'persist the cure');
      assert.eq(save.energy, 50);
      assert.eq(save.coffeeUntil, coffee);
      assert.eq(JSON.stringify(save.fishRegen), fish);
      assert.includes(messages[tap], 'Debuffs cleared');
    }
    const ctx = makeCtx(scene, save);
    assert.eq(runInteractable(ctx, well), true);
    assert.falsy(ctx.dirty, 'a healthy visit has no condition change to save');
    assert.eq(messages[2], 'Cool, clear water.');
  });

  test('well: an out-of-reach tap cannot cure conditions', () => {
    const save = { energy: 50 };
    Conditions.apply(save, 'poison');
    const scene = makeScene({ save, cellM: 16, cellsPerTile: 16,
      tileEdgeM: 256, startWorldM: { x: 0, y: 0 }, originPx: { x: 0, y: 0 },
      mPerPx: 256 / WorldGen.TILE_PX });
    const ctx = { ...makeCtx(scene, save), wm: { x: well.x, y: well.y } };
    const each = WorldGen.forEachItem, far = tooFar;
    try {
      WorldGen.forEachItem = (layer, visit) => { visit(well); };
      tooFar = () => true;
      assert.eq(TAP_HANDLERS.find(h => h.name === 'object').try(ctx), 'far');
      assert.truthy(Conditions.active(save, 'poison'));
      assert.falsy(ctx.dirty);
    } finally {
      WorldGen.forEachItem = each;
      tooFar = far;
    }
  });
})();
