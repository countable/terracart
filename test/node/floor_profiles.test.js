// The FLOOR PROFILES are the declarative owner of every floor-scoped cave
// rule (worldgen.js). These rows pin the exact behavior the old per-depth
// branches hardcoded, so a later identity shift is a row edit under test.
(() => {
  test('floor profiles: each shipped depth reads its old branch behavior', () => {
    assert.eq(WorldGen.floorProfile(1).terrain, 'above');
    assert.truthy(WorldGen.floorProfile(1).streetMirror, 'L1 projects the street mirror');
    assert.truthy(WorldGen.floorProfile(1).quarryProvenance, 'quarry seams descend one level');
    assert.eq(WorldGen.floorProfile(2).terrain, 'clearings');
    assert.eq(WorldGen.floorProfile(2).biome, 'deep_stone');
    assert.truthy(WorldGen.floorProfile(2).fallLandings, 'L2 carves landing pockets');
    assert.eq(WorldGen.floorProfile(3).terrain, 'open');
    assert.eq(WorldGen.floorProfile(3).biome, 'underdark');
    assert.eq(WorldGen.floorProfile(3).chestSource, 'surface', 'L3 mirrors the surface layer');
    assert.eq(WorldGen.floorProfile(4).terrain, 'surfacePaint');
    assert.eq(WorldGen.floorProfile(5).lava, true);
  });

  test('floor profiles: depths past the table inherit the default mirror', () => {
    for (const depth of [6, 7, 8, 12, 40]) {
      const row = WorldGen.floorProfile(depth);
      assert.eq(row.terrain, 'above');
      assert.eq(row.biome, 'cave');
      assert.falsy(row.lava);
      assert.falsy(row.streetMirror);
      assert.falsy(row.fallLandings);
      assert.eq(row.chestSource, 'above');
    }
  });

  test('floor profiles: rows are contiguous from floor 1, one lava level', () => {
    assert.eq(WorldGen.FLOOR_PROFILES.map(r => r.depth).join(','), '1,2,3,4,5');
    const lavaRows = WorldGen.FLOOR_PROFILES.filter(r => r.lava);
    assert.eq(lavaRows.length, 1, 'fire and ember rules key on THE lava level');
    assert.eq(WorldGen.LAVA_DEPTH, lavaRows[0].depth, 'LAVA_DEPTH derives from the row');
    assert.eq(WorldGen.LAVA_DEPTH, 5, 'shipped value unchanged by the refactor');
  });
})();
