(function () {
  test('medicinal herbs: shared map/inventory art, pet effect and healing ingredient', () => {
    for (const id of ['petnip', 'woundwort']) {
      const icon = inventoryIconSource(id), sprite = CROP_SPRITE[id];
      assert.eq(icon.sheet, sprite.sheet);
      assert.eq(icon.frame, sprite.frame);
      assert.truthy(PRICES[id] > 0);
    }
    assert.eq(ITEM_BY_ID.petnip.petFood.maxHp, 1);
    assert.truthy(BREW_RECIPES.find(r => r.id === 'healing_potion').cost.some(c => c.id === 'woundwort'));
    const flora = BiomeProfiles.flora(WorldGen.T.SCHOOL);
    assert.truthy(flora.some(r => r.crop === 'petnip'));
    assert.truthy(flora.some(r => r.crop === 'woundwort'));
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

  test('medicinal herbs: deterministic plain Small-road forage with a rarer potion herb', () => {
    const plants = herbs();
    const common = plants.filter(p => p.crop === 'petnip').length;
    const rare = plants.filter(p => p.crop === 'woundwort').length;
    assert.gt(rare, 0);
    assert.gt(common, rare * 3);
    assert.eq(JSON.stringify(plants), JSON.stringify(herbs()));
    assert.eq(new Set(plants.map(p => `${p.x},${p.y}`)).size, plants.length);
    assert.eq(herbs('major').length, 0);
    assert.eq(herbs('path').length, 0);
    assert.eq(herbs('minor', true).length, 0, 'shared road gate excludes blocked cells');
    assert.eq(herbs('minor', false, true).length, 0, 'Nexus retains its authored content');
  });
})();
