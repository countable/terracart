(function () {
  test('peach rarity: fruit and sapling are T7, with a premium fruit value and existing healing', () => {
    assert.eq(ITEM_BY_ID.worldpeach.baseTier, 7);
    assert.eq(ITEM_BY_ID.worldpeach_sapling.baseTier, 7);
    assert.eq(ITEM_BY_ID.worldpeach_sapling.baseTier, BASE_TIER.worldpeach_sapling);
    assert.eq(FOOD_ENERGY.worldpeach, 16);
    assert.eq(itemValue('worldpeach'), 250);
    assert.includes(ITEMS_BY_CLASS_TIER.produce[7], 'worldpeach');
    assert.includes(ITEMS_BY_CLASS_TIER.seed[7], 'worldpeach_sapling');
    for (let tier = 1; tier < 7; tier++) {
      assert.falsy((ITEMS_BY_CLASS_TIER.produce[tier] || []).includes('worldpeach'));
      assert.falsy((ITEMS_BY_CLASS_TIER.seed[tier] || []).includes('worldpeach_sapling'));
      assert.falsy(ChestThemes.eligible('food', tier, { theme: 'food', venueProduct: 'worldpeach' }).includes('worldpeach'));
      assert.falsy(ChestThemes.eligible('parkSeeds', tier, { theme: 'park' }).includes('worldpeach_sapling'));
    }
    assert.includes(ChestThemes.eligible('food', 7, { theme: 'food' }), 'worldpeach');
    assert.includes(ChestThemes.eligible('parkSeeds', 7, { theme: 'park' }), 'worldpeach_sapling');
  });

  test('peach rarity: both procedural lanes use one deterministic selector; rows roll one in fifty, lone trees one in ten', () => {
    assert.eq(WorldGen.PEACH_ONE_IN, 50);
    assert.eq(WorldGen.PEACH_ONE_IN_LONE, 10);
    let peaches = 0, lonePeaches = 0;
    for (let hash = 0; hash < 10000; hash++) {
      const species = WorldGen.fruitTreeSpecies(hash);
      assert.eq(species, WorldGen.fruitTreeSpecies(hash));
      if (species === 'worldpeach') peaches++;
      else assert.eq(species, 'apple');
      const lone = WorldGen.fruitTreeSpecies(hash, WorldGen.PEACH_ONE_IN_LONE);
      if (lone === 'worldpeach') lonePeaches++;
      else assert.eq(lone, 'apple');
      // The lone rate only adds peaches: a cell that is a peach in a row
      // stays a peach when it stands alone.
      if (species === 'worldpeach') assert.eq(lone, 'worldpeach');
    }
    assert.eq(peaches, 200);
    assert.eq(lonePeaches, 1000);
    // Planted rows (orchard landcover) keep the orchard rate.
    assert.includes(WORLDGEN_SRC, 'species: fruitTreeSpecies(cellHash(tx, ty, ix, iy))');
    // Standalone mapped / detected fruit trees are the rare find.
    assert.includes(WORLDGEN_SRC, 'species: fruitTreeSpecies(ftHash, PEACH_ONE_IN_LONE),');
  });

  test('peach rarity: a standalone sidecar fruit tree rolls its species at the lone rate by its settled cell', () => {
    const lat = 49.0, lon = -119.5;
    const gj = { features: [
      { type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { kind: 'fruittree', source: 'deepforest', species: 'peach', score: 0.9, crown_m: 6, size: 'medium' } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [lon + 0.0004, lat] }, properties: { kind: 'fruittree', osm_id: 12345 } },
    ] };
    const bins = WorldGen.buildBinsFromGeoJSON(gj, lat);
    const rows = [...bins.entries()].flatMap(([k, b]) => b.fruittrees.map(t => [k, t]));
    assert.eq(rows.length, 2);
    for (const [key, t] of rows) {
      assert.truthy(t.individual, 'a sidecar fruit tree is a standalone tree');
      const [tx, ty] = key.split('_').map(Number);
      const hash = WorldGen.cellHash(tx, ty, t.lix, t.liy);
      assert.eq(t.species, WorldGen.fruitTreeSpecies(hash, WorldGen.PEACH_ONE_IN_LONE));
      assert.falsy(t.species === 'peach', 'the classifier label is never trusted as a species');
    }
  });

  test('peach rarity: one orchard mixes species by cell and retains them in another metre frame', () => {
    const tx = 4, ty = 8192, n = 80, extent = 4096;
    const ring = [{ x: 0, y: 0 }, { x: extent, y: 0 }, { x: extent, y: extent }, { x: 0, y: extent }, { x: 0, y: 0 }];
    const layers = [{ name: 'landcover', features: [{type:3,tags:{class:'grass'},geom:[ring]}] }, { name: 'landcover', features: [{ type: 3, tags: { class: 'orchard' }, geom: [ring] }] }];
    const trees = edge => WorldGen.rasterizeTile(layers, n, tx, ty, edge).objects.filter(o => o.kind === 'fruittree');
    const a = trees(1000), b = trees(1500);
    assert.gt(a.length, 1000, 'enough trees in one orchard to measure its mix');
    const peaches = a.filter(o => o.species === 'worldpeach');
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
        assert.falsy(venueProductFor(obj) === 'worldpeach');
        assert.falsy(produceStandFor(obj)?.item === 'worldpeach');
      }
    }
  });

  test('peach rarity: saved planted trees remain peach trees and keep their daily harvest', () => {
    const day = 24 * 60 * 60 * 1000;
    const tree = { id: 'pft_saved_peach', x: 0, y: 0, species: 'worldpeach', planted_t: Date.now() - 2 * day };
    const save = JSON.parse(JSON.stringify({ fruittrees: [tree], inv: [], selSlot: 0 }));
    SaveState.normalize(save);
    assert.eq(save.fruittrees.length, 1);
    assert.eq(save.fruittrees[0].species, 'worldpeach');
    assert.eq(save.fruittrees[0].id, tree.id);
    const scene = makeScene({
      addToInv: (id, n) => Inventory.add(save, id, n).accepted,
    });
    const object = { ...save.fruittrees[0], kind: 'fruittree', planted: true };
    const ctx = makeCtx(scene, save);
    assert.truthy(INTERACTABLES.fruittree.custom(ctx, object));
    const first = Inventory.count(save, 'worldpeach');
    assert.inRange(first, 1, 2);
    assert.truthy(INTERACTABLES.fruittree.custom(ctx, object));
    assert.eq(Inventory.count(save, 'worldpeach'), first, 'a picked tree remains on cooldown');
    save.fruitPicked[tree.id] -= day;
    assert.truthy(INTERACTABLES.fruittree.custom(ctx, object));
    assert.inRange(Inventory.count(save, 'worldpeach'), first + 1, first + 2);
  });
})();
