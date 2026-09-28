// EACH LEVEL IS ITS TIER'S MINE (worldgen.js caveOreTiers / caveOreWeights /
// caveRockP): underground, each of the level's ore tiers — its own and the one
// below, real ore only (tier 2, copper, and up) — is CAVE_ORE_SHARE (10 %) of
// the rocks, the rest plain. Level 1 is all plain, level 2 10 % copper, level 3
// 10 % copper + 10 % iron … level 7 and below crimson + frost. This table is
// the VISIBLE ore rocks only; plain rocks keep their hidden bar roll on break.
(function () {
test('cave ore: level N\'s ore rocks are tier N and N-1, real ore only', () => {
  assert.eq(JSON.stringify(WorldGen.caveOreTiers(1)), '[]', 'level 1: no ore');
  assert.eq(JSON.stringify(WorldGen.caveOreTiers(2)), '[2]', 'level 2: copper');
  assert.eq(JSON.stringify(WorldGen.caveOreTiers(3)), '[2,3]', 'level 3: copper + iron');
  assert.eq(JSON.stringify(WorldGen.caveOreTiers(7)), '[6,7]', 'level 7: crimson + frost');
  assert.eq(JSON.stringify(WorldGen.caveOreTiers(12)), '[6,7]', 'and every level below');
  for (let d = 2; d <= 9; d++) {
    const w = WorldGen.caveOreWeights(d);
    assert.truthy(Math.abs(w.reduce((a, b) => a + b, 0) - 1) < 1e-9, `level ${d} weights sum to 1`);
    for (const t of WorldGen.caveOreTiers(d)) assert.truthy(w[t - 1] > 0, `level ${d} rolls tier ${t}`);
  }
});

test('cave ore: 10% of the rocks per ore tier, the rest plain', () => {
  assert.eq(WorldGen.caveRockP(1), 1, 'level 1 all plain');
  assert.truthy(Math.abs(WorldGen.caveRockP(2) - 0.9) < 1e-9, 'level 2 90% plain');
  for (let d = 3; d <= 9; d++) assert.truthy(Math.abs(WorldGen.caveRockP(d) - 0.8) < 1e-9, `level ${d} 80% plain`);
  assert.eq(WorldGen.caveRockP(0), 0.9, 'the surface is unchanged');
});
})();
