// EACH LEVEL IS ITS TIER'S MINE (worldgen.js caveOreWeights / caveRockP):
// underground rocks are CAVE_PLAIN_P plain, and the ore is the level's own
// tier and the tier below in equal shares — level 3 is 10 % iron, 10 % copper.
// A tier-N ore wants a tier N-1 pick, so each level's ore forges the pick for
// the next. The table tops out at 7 (frost + crimson) for every level below.
(function () {
test('cave ore: level N holds tier N and tier N-1 ore, half each', () => {
  for (let d = 2; d <= 7; d++) {
    const w = WorldGen.caveOreWeights(d);
    assert.eq(w.reduce((a, b) => a + b, 0), 1, `level ${d} sums to 1`);
    assert.eq(w[d - 1], 0.5, `level ${d}: half its own tier`);
    assert.eq(w[d - 2], 0.5, `level ${d}: half the tier below`);
  }
  assert.eq(WorldGen.caveOreWeights(1)[0], 1, 'level 1: all tier 1 (which breaks into copper)');
  assert.eq(JSON.stringify(WorldGen.caveOreWeights(9)), JSON.stringify(WorldGen.caveOreWeights(7)),
    'below 7 stays frost + crimson');
});

test('cave ore: underground is four fifths plain rock, the surface nine tenths', () => {
  for (let d = 1; d <= 9; d++) assert.eq(WorldGen.caveRockP(d), 0.8, `level ${d}`);
  assert.eq(WorldGen.caveRockP(0), 0.9, 'the surface is unchanged');
});
})();
