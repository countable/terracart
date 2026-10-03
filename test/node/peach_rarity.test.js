(function () {
  test('peach rarity: fruit and sapling are T7, with healing, cleansing and fruit price unchanged', () => {
    assert.eq(ITEM_BY_ID.peach.baseTier, 7);
    assert.eq(ITEM_BY_ID.peach_sapling.baseTier, 7);
    assert.eq(ITEM_BY_ID.peach_sapling.baseTier, BASE_TIER.peach_sapling);
    assert.eq(FOOD_ENERGY.peach, 16);
    assert.eq(itemValue('peach'), 10);
    assert.includes(ITEMS_BY_CLASS_TIER.produce[7], 'peach');
    assert.includes(ITEMS_BY_CLASS_TIER.seed[7], 'peach_sapling');
    for (let tier = 1; tier < 7; tier++) {
      assert.falsy((ITEMS_BY_CLASS_TIER.produce[tier] || []).includes('peach'));
      assert.falsy((ITEMS_BY_CLASS_TIER.seed[tier] || []).includes('peach_sapling'));
      assert.falsy(ChestThemes.eligible('food', tier, { theme: 'food', venueProduct: 'peach' }).includes('peach'));
      assert.falsy(ChestThemes.eligible('parkSeeds', tier, { theme: 'park' }).includes('peach_sapling'));
    }
    assert.includes(ChestThemes.eligible('food', 7, { theme: 'food' }), 'peach');
    assert.includes(ChestThemes.eligible('parkSeeds', 7, { theme: 'park' }), 'peach_sapling');
  });

  test('peach rarity: both procedural lanes use one deterministic one-in-fifty selector', () => {
    assert.eq(WorldGen.PEACH_ONE_IN, 50);
    let peaches = 0;
    for (let hash = 0; hash < 10000; hash++) {
      const species = WorldGen.fruitTreeSpecies(hash);
      assert.eq(species, WorldGen.fruitTreeSpecies(hash));
      if (species === 'peach') peaches++;
      else assert.eq(species, 'apple');
    }
    assert.eq(peaches, 200);
    assert.includes(WORLDGEN_SRC, 'species: fruitTreeSpecies(cellHash(tx, ty, ix, iy))');
    assert.includes(WORLDGEN_SRC, 'species: fruitTreeSpecies(ftHash),');
  });

  test('peach rarity: one orchard mixes species by cell and retains them in another metre frame', () => {
    const tx = 4, ty = 8192, n = 64, extent = 4096;
    const ring = [{ x: 0, y: 0 }, { x: extent, y: 0 }, { x: extent, y: extent }, { x: 0, y: extent }, { x: 0, y: 0 }];
    const layers = [{ name: 'landcover', features: [{ type: 3, tags: { class: 'orchard' }, geom: [ring] }] }];
    const trees = edge => WorldGen.rasterizeTile(layers, n, tx, ty, edge).objects.filter(o => o.kind === 'fruittree');
    const a = trees(1000), b = trees(1500);
    assert.gt(a.length, 1000, 'enough trees in one orchard to measure its mix');
    const peaches = a.filter(o => o.species === 'peach');
    assert.inRange(peaches.length / a.length, 0.01, 0.03, 'approximately one tree in fifty');
    assert.eq(JSON.stringify(a.map(o => [o.id, o.species])), JSON.stringify(b.map(o => [o.id, o.species])), 'species do not depend on the save metre frame');
    for (const tree of a) {
      const [ix, iy] = tree.id.split('_').slice(-2).map(Number);
      assert.eq(tree.species, WorldGen.fruitTreeSpecies(WorldGen.cellHash(tx, ty, ix, iy)));
    }
  });

  test('peach rarity: a peach shop name cannot create an unlimited peach market', () => {
    for (const name of ['Peach', 'Peaches', 'Peach Market', 'Fresh Peaches']) {
      for (const poiClass of ['supermarket', 'grocery', 'shop']) {
        const obj = { kind: 'chest', poiClass, subclass: 'peaches', name };
        assert.falsy(venueProductFor(obj) === 'peach');
        assert.falsy(produceStandFor(obj)?.item === 'peach');
      }
    }
  });

  test('peach rarity: saved planted trees remain peach trees and keep their daily harvest', () => {
    const day = 24 * 60 * 60 * 1000;
    const tree = { id: 'pft_saved_peach', x: 0, y: 0, species: 'peach', planted_t: Date.now() - 2 * day };
    const save = JSON.parse(JSON.stringify({ fruittrees: [tree], inv: [], selSlot: 0 }));
    SaveState.normalize(save);
    assert.eq(save.fruittrees.length, 1);
    assert.eq(save.fruittrees[0].species, 'peach');
    assert.eq(save.fruittrees[0].id, tree.id);
    const scene = makeScene({
      addToInv: (id, n) => Inventory.add(save, id, n).accepted,
    });
    const object = { ...save.fruittrees[0], kind: 'fruittree', planted: true };
    const ctx = makeCtx(scene, save);
    assert.truthy(INTERACTABLES.fruittree.custom(ctx, object));
    const first = Inventory.count(save, 'peach');
    assert.inRange(first, 1, 2);
    assert.truthy(INTERACTABLES.fruittree.custom(ctx, object));
    assert.eq(Inventory.count(save, 'peach'), first, 'a picked tree remains on cooldown');
    save.fruitPicked[tree.id] -= day;
    assert.truthy(INTERACTABLES.fruittree.custom(ctx, object));
    assert.inRange(Inventory.count(save, 'peach'), first + 1, first + 2);
  });
})();
