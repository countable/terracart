// L1-2 have thin copper seams; the ore ladder starts in deep stone on L3.
(function () {
test('cave ore: deep stone starts the copper mine, capped at tiers 6-7 on L8', () => {
  assert.eq(JSON.stringify(WorldGen.caveOreTiers(1)), '[]', 'level 1: no tier of its own');
  assert.eq(JSON.stringify(WorldGen.caveOreTiers(2)), '[]', 'level 2: thin seam only');
  assert.eq(JSON.stringify(WorldGen.caveOreTiers(3)), '[2]', 'level 3: copper');
  assert.eq(JSON.stringify(WorldGen.caveOreTiers(8)), '[6,7]', 'level 8: crimson + frost');
  assert.eq(JSON.stringify(WorldGen.caveOreTiers(12)), '[6,7]', 'and every level below');
  for (let d = 1; d <= 9; d++) {
    const w = WorldGen.caveOreWeights(d);
    assert.truthy(Math.abs(w.reduce((a, b) => a + b, 0) - 1) < 1e-9, `level ${d} weights sum to 1`);
    for (const t of WorldGen.caveOreTiers(d)) assert.truthy(w[t - 1] > 0, `level ${d} rolls tier ${t}`);
  }
});

test('cave ore: 10% of the rocks per ore tier, the rest plain', () => {
  assert.eq(WorldGen.LEVEL1_COPPER_SHARE, 0.05, 'a thin copper seam on level 1');
  assert.truthy(Math.abs(WorldGen.caveRockP(1) - 0.95) < 1e-9, 'level 1 95% plain, 5% copper');
  assert.eq(WorldGen.caveOreWeights(1)[1], 1, 'and what it rolls is copper');
  assert.truthy(Math.abs(WorldGen.caveRockP(2) - 0.95) < 1e-9, 'level 2 95% plain');
  assert.truthy(Math.abs(WorldGen.caveRockP(3) - 0.9) < 1e-9, 'deep stone 90% plain');
  for (let d = 4; d <= 9; d++) assert.truthy(Math.abs(WorldGen.caveRockP(d) - 0.8) < 1e-9, `level ${d} 80% plain`);
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


test('cave flint: L2 has regular deterministic seams throughout ordinary rock clusters', () => {
  const N = 120, edge = N * WorldGen.CELL_M;
  const generate = depth => {
    const rocks = [];
    WorldGen.spawnCaveRocks(new Uint8Array(N * N).fill(WorldGen.T.CAVE_FLOOR),
      N, 3, 5, edge, depth, rocks, new Set());
    return rocks;
  };
  const first = generate(2), plain = first.filter(o => o.caveVariant != null);
  const seams = plain.filter(o => o.rockMaterial === 'flint');
  assert.gt(seams.length, 40, 'common enough to find without a special area');
  assert.inRange(seams.length / plain.length, .18, .32, 'about one quarter of ordinary rocks');
  assert.eq(JSON.stringify(first), JSON.stringify(generate(2)), 'stable placement and materials');
  const quadrants = new Set(seams.map(o => `${o.x < 3.5 * edge},${o.y < 5.5 * edge}`));
  assert.eq(quadrants.size, 4, 'distributed across the floor');
  assert.eq(first.filter(o => o.yieldTier > 1 && o.rockMaterial === 'flint').length, 0, 'ore is preserved');
  assert.eq(generate(3).filter(o => o.rockMaterial === 'flint').length, 0, 'other floor populations unchanged');
});
