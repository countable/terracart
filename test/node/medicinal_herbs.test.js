(function () {
  test('medicinal herbs: shared map/inventory art, pet effect and Growth Powder ingredient', () => {
    for (const id of ['petnip', 'nettle']) {
      const icon = inventoryIconSource(id), sprite = CROP_SPRITE[id];
      assert.eq(icon.sheet, sprite.sheet);
      assert.eq(icon.frame, sprite.frame);
      assert.truthy(PRICES[id] > 0);
    }
    assert.eq(ITEM_BY_ID.petnip.petFood.maxHp, 1);
    assert.truthy(HOME_RECIPES.find(r => r.id === 'growth_powder').cost.some(c => c.id === 'nettle'));
    const flora = BiomeProfiles.flora(WorldGen.T.SCHOOL);
    assert.truthy(flora.some(r => r.crop === 'petnip'));
    assert.truthy(flora.some(r => r.crop === 'nettle'));
  });

  function herbs(size = 'minor', blocked = false, nexus = false) {
    const N = 128, ext = N * WorldGen.CELL_M;
    const lines = [20, 45, 70, 95].map(y => ({
      key: `herbal-road-${y}`, size, variant: null, halfW: 4,
      line: [{ x: 0, y: y * 7 }, { x: ext, y: y * 7 }],
    }));
    return StreetVariants.dress({
      tx: 5, ty: 7, N, tileEdgeM: ext,
      index: { extent: ext, lines, dressingLines: [],
        nexusCoverage: new Uint8Array(N * N).fill(nexus ? 1 : 0) },
      grid: new Uint8Array(N * N).fill(WorldGen.T.GRASS),
      spawnOpts: { occupied: new Set(), roadMask: new Uint8Array(N * N).fill(blocked ? 1 : 0) },
    }).wildplants;
  }

  test('medicinal herbs: deterministic plain Small-road forage with a rarer powder herb', () => {
    const plants = herbs();
    const common = plants.filter(p => p.crop === 'petnip').length;
    const rare = plants.filter(p => p.crop === 'nettle').length;
    assert.gt(rare, 0);
    assert.gt(common, rare * 3);
    assert.eq(JSON.stringify(plants), JSON.stringify(herbs()));
    assert.eq(new Set(plants.map(p => `${p.x},${p.y}`)).size, plants.length);
    assert.eq(herbs('major').length, 0);
    assert.eq(herbs('path').length, 0);
    assert.eq(herbs('minor', true).length, 0, 'shared road gate excludes blocked cells');
    assert.eq(herbs('minor', false, true).length, 0, 'Nexus retains its authored content');
  });

  test('plain Small roads: a few sparse ordinary bushes among the herbs', () => {
    const plants = herbs();
    const bushCrops = StreetVariants.PLAIN_BUSHES.map(b => b.crop);
    const bushes = plants.filter(p => bushCrops.includes(p.crop));
    const herbCount = plants.filter(p => p.crop === 'petnip' || p.crop === 'nettle').length;
    assert.gt(bushes.length, 0, 'some bushes');
    assert.lt(bushes.length * 4, herbCount, 'sparse beside the herbs');
    assert.truthy(bushes.every(p => p._street === 'plain'));
    assert.eq(herbs('major').filter(p => bushCrops.includes(p.crop)).length, 0, 'normal Small roads only');
    // Ordinary bushes lead; berry and poisonberry bushes are mixed in.
    assert.eq(JSON.stringify(bushCrops), JSON.stringify(['shrub', 'berry', 'poisonberry']));
    assert.eq(StreetVariants.PLAIN_BUSHES.at(-1).below, StreetVariants.PLAIN_BUSH_P);
    const count = crop => bushes.filter(p => p.crop === crop).length;
    assert.gt(count('shrub'), count('berry'));
  });
})();
