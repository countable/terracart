(function () {
  const gems = ['quartz', 'topaz', 'amethyst', 'sapphire', 'ruby', 'emerald', 'diamond'];
  test('cave gems: seven pictured deposits share their item rarity and mining requirement', () => {
    gems.forEach((id, i) => {
      const deposit = mineralDeposit({ deposit: id });
      assert.eq(deposit.item, id);
      assert.eq(deposit.yieldTier, i + 1);
      assert.eq(deposit.requiredTier, Math.max(1, i));
      assert.eq(ITEM_BY_ID[id].baseTier, i + 1);
      assert.truthy(ITEM_EFFECTS[id]);
      assert.truthy(PRICES[id] > 0);
      assert.truthy(SpriteLayout.ART_BOUNDS[`${deposit.artKey}:${deposit.artFrame}`]);
    });
    assert.eq(mineralDeposit({ deposit: 'crystal' }), mineralDeposit({ deposit: 'sapphire' }));
  });
  test('cave gems: each deposit pays exactly its pictured stone and stays mined', () => {
    for (const id of gems) {
      const scene = makeScene();
      const save = { relics: { pickaxe: { tier: 7 } } };
      const o = { id: `gem-${id}`, kind: 'mineralrock', deposit: id, x: 0, y: 0 };
      assert.truthy(runInteractable(makeCtx(scene, save), o));
      for (const other of [...gems, 'rubble', 'flint_shard', 'copper_bar']) {
        assert.eq(scene.invCount(other), other === id ? 1 : 0, `${id} pays only ${id}`);
      }
      assert.truthy(scene.brokenRockSet.has(o.id));
      runInteractable(makeCtx(scene, save), o);
      assert.eq(scene.invCount(id), 1, 'spent deposit pays once');
    }
  });
  test('cave gems: low gems use the existing gemstone icon sheet on every item surface', () => {
    for (const [id, frame] of Object.entries({ quartz: 6, amethyst: 2, topaz: 4 })) {
      const icon = inventoryIconSource(id);
      assert.eq(icon.sheet, 'gems');
      assert.eq(icon.frame, frame);
    }
    assert.truthy(SCENE_SRC.includes("gems:        { url: 'assets/Icons/RPG icons/Extras/Gemstones.png'"));
    assert.eq(pngDims('assets/Objects/Cave/props.png').w, 144);
    assert.eq(pngDims('assets/Objects/Cave/poison_vent_inactive.png').w, 24);
  });
})();
