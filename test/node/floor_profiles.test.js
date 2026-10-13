// The FLOOR PROFILES are the declarative owner of every floor-scoped cave
// rule (worldgen.js). These rows pin the intended eight-floor terrain ladder and the independent progression gates.
(() => {
  test('floor profiles: eight distinct floor identities follow the catalog', () => {
    const expected = [
      ['above', 'cave'], ['city', 'goblin_city'], ['clearings', 'deep_stone'],
      ['open', 'underdark'], ['surfacePaint', 'haunted_city'], ['above', 'lava'],
      ['above', 'dragon'], ['above', 'dragon_roost'],
    ];
    expected.forEach(([terrain, biome], i) => {
      assert.eq(WorldGen.floorProfile(i + 1).terrain, terrain);
      assert.eq(WorldGen.floorProfile(i + 1).biome, biome);
    });
    assert.truthy(WorldGen.floorProfile(2).fallLandings);
    assert.eq(WorldGen.floorProfile(3).arrivalStory, 'dungeon_stone');
    assert.eq(WorldGen.floorProfile(4).arrivalStory, 'dungeon_underdark');
    assert.eq(WorldGen.floorProfile(4).chestSource, 'surface');
    assert.eq(WorldGen.floorProfile(5).entryKey, 'level4Key');
    assert.eq(WorldGen.floorProfile(6).lava, true);
    for (const [depth, cap] of [[3, 5], [4, 6], [6, 6], [7, 7]])
      assert.eq(chestTierMaxFor(depth), cap);
  });

  test('floor profiles: authored caves and pressure traps retain their shipped floors', () => {
    for (const depth of [0, 1, 2, 3, 4, 5, 6, 8, 40]) {
      const row = WorldGen.floorProfile(depth);
      assert.eq(row.pressureTraps, depth === 2, 'ball and wall traps live on L2 only');
      if (depth) assert.eq(row.vents.join(), depth === 1 ? 'confusion' : 'poison,fire,paralysis', 'L1 vents confusion only');
      assert.eq(!!row.caveAreas, depth === 1 || depth === 2);
      assert.eq(row.streetMirror, depth === 1 || depth === 2);
    }
    const first = WorldGen.floorProfile(1).caveAreas, second = WorldGen.floorProfile(2).caveAreas;
    assert.eq(first.weights.map(r => r.weight).join(','), '50,15,30,5,15', 'L1 favours slime springs over goblin warrens');
    assert.eq(second.weights.map(r => r.weight).join(','), '20,45,25,10,15');
    assert.eq(first.carveWalls, false);
    assert.eq(second.carveWalls, true);
    assert.eq(first.goblins, 12);
    assert.eq(second.goblins, 16);
  });

  test('floor profiles: depths past the table inherit the default mirror', () => {
    for (const depth of [9, 12, 40]) {
      const row = WorldGen.floorProfile(depth);
      assert.eq(row.terrain, 'above');
      assert.eq(row.biome, 'cave');
      assert.falsy(row.lava);
      assert.falsy(row.streetMirror);
      assert.falsy(row.fallLandings);
      assert.falsy(row.pressureTraps);
      assert.eq(row.caveAreas, null);
      assert.eq(row.streetGems, null);
      assert.eq(row.chestSource, 'above');
    }
  });

  test('floor profiles: rows are contiguous from floor 1, one lava level', () => {
    assert.eq(WorldGen.FLOOR_PROFILES.map(r => r.depth).join(','), '1,2,3,4,5,6,7,8');
    const lavaRows = WorldGen.FLOOR_PROFILES.filter(r => r.lava);
    assert.eq(lavaRows.length, 1, 'fire and ember rules key on THE lava level');
    assert.eq(WorldGen.LAVA_DEPTH, lavaRows[0].depth, 'LAVA_DEPTH derives from the row');
    assert.eq(WorldGen.LAVA_DEPTH, 6, 'lava follows the haunted city');
  });
})();
