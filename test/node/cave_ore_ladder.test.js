// EACH LEVEL IS ITS TIER'S MINE (worldgen.js caveOreTiers / caveOreWeights /
// caveRockP): underground, each of the level's ore tiers — its own and the one
// below, real ore only (tier 2, copper, and up) — is CAVE_ORE_SHARE (10 %) of
// the rocks, the rest plain. The ladder's floor is copper: levels 1 and 2 are
// 10 % copper (level 1 was all plain until Oct 2026), level 3 10 % copper +
// 10 % iron … level 7 and below crimson + frost. This table is
// the VISIBLE ore rocks only; plain rocks keep their hidden bar roll on break.
(function () {
test('cave ore: level N\'s ore rocks are tier N and N-1, real ore only', () => {
  assert.eq(JSON.stringify(WorldGen.caveOreTiers(1)), '[2]', 'level 1: copper — the ladder starts on the first level down');
  assert.eq(JSON.stringify(WorldGen.caveOreTiers(2)), '[2]', 'level 2: copper');
  assert.eq(JSON.stringify(WorldGen.caveOreTiers(3)), '[2,3]', 'level 3: copper + iron');
  assert.eq(JSON.stringify(WorldGen.caveOreTiers(7)), '[6,7]', 'level 7: crimson + frost');
  assert.eq(JSON.stringify(WorldGen.caveOreTiers(12)), '[6,7]', 'and every level below');
  for (let d = 1; d <= 9; d++) {
    const w = WorldGen.caveOreWeights(d);
    assert.truthy(Math.abs(w.reduce((a, b) => a + b, 0) - 1) < 1e-9, `level ${d} weights sum to 1`);
    for (const t of WorldGen.caveOreTiers(d)) assert.truthy(w[t - 1] > 0, `level ${d} rolls tier ${t}`);
  }
});

test('cave ore: 10% of the rocks per ore tier, the rest plain', () => {
  assert.truthy(Math.abs(WorldGen.caveRockP(1) - 0.9) < 1e-9, 'level 1 90% plain, 10% copper');
  assert.truthy(Math.abs(WorldGen.caveRockP(2) - 0.9) < 1e-9, 'level 2 90% plain');
  for (let d = 3; d <= 9; d++) assert.truthy(Math.abs(WorldGen.caveRockP(d) - 0.8) < 1e-9, `level ${d} 80% plain`);
  assert.eq(WorldGen.caveRockP(0), 0.9, 'the surface is unchanged');
});

test('cave ore: every fired vein boosts one ore tier the level offers', () => {
  const weights = WorldGen.caveOreWeights(3);
  const baseTotal = weights.reduce((sum, weight) => sum + weight, 0);
  for (let seed = 1; seed <= 100; seed++) {
    const table = WorldGen.rollVeinTable(WorldGen.makeRng(seed), weights, 1, null);
    const boosted = table.tierW.map((total, i) => total - (i ? table.tierW[i - 1] : 0));
    const changed = boosted.map((weight, i) => weight !== weights[i] ? i : -1).filter((i) => i >= 0);
    assert.eq(changed.length, 1, `seed ${seed}: one tier is boosted`);
    assert.truthy(weights[changed[0]] > 0, `seed ${seed}: the boosted tier is offered`);
    assert.eq(boosted[changed[0]], weights[changed[0]] * 10, `seed ${seed}: the offered tier gets the vein multiplier`);
    assert.gt(table.totalW, baseTotal, `seed ${seed}: every fired vein changes the table`);
  }
});
})();
