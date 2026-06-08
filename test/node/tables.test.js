// Headless tests for the declarative data tables + tool helpers
// (src/items.js, src/util.js, src/worldgen.js namespace).

test('toolDurationMs: tier ladder 9s bare → 0.3s frost', () => {
  assert.eq(toolDurationMs({}, 'pick'), 9000, 'no tool = 9s (3× wood)');
  assert.eq(toolDurationMs({ pick: { tier: 1 } }, 'pick'), 3000, 'T1 = 3s');
  assert.eq(toolDurationMs({ pick: { tier: 7 } }, 'pick'), 300, 'T7 = 0.3s');
  // Strictly monotonic decreasing across the ladder.
  let prev = Infinity;
  for (let t = 1; t <= 7; t++) {
    const d = toolDurationMs({ pick: { tier: t } }, 'pick');
    assert.lt(d, prev, `tier ${t} faster than tier ${t - 1}`);
    prev = d;
  }
});

test('effectivePickCost: cheaper as the pick tier climbs', () => {
  const bare = effectivePickCost({});
  const t7 = effectivePickCost({ pick: { tier: 7 } });
  assert.gt(bare, t7, 'bare hands cost more energy than a T7 pick');
});

test('itemValue: a gold bar is worth more than a copper bar', () => {
  assert.gt(itemValue('gold_bar'), 0, 'gold bar has a value');
  assert.gt(itemValue('gold_bar'), itemValue('copper_bar'), 'gold > copper');
});

test('ITEM_BY_ID: registry is keyed by id and self-consistent', () => {
  assert.truthy(ITEM_BY_ID['wood'], 'wood item exists');
  assert.eq(ITEM_BY_ID['potato']?.id, 'potato', 'lookup id matches the entry id');
  assert.eq(ITEM_BY_ID['potato_seed']?.kind, 'seed', 'seed kind tagged');
});

test('TIER_BY_NUM: material tiers are named 1..7', () => {
  for (let t = 1; t <= 7; t++) {
    assert.truthy(TIER_BY_NUM[t]?.name, `tier ${t} has a name`);
  }
});

test('treeAxeReqTier / treeWoodMul: consistent, in-range', () => {
  for (const v of [{ variant: 'bush' }, { species: 'pine' }, { species: 'maple' }, {}]) {
    const o = { kind: 'tree', id: 't', ...v };
    const req = treeAxeReqTier(o);
    const mul = treeWoodMul(o);
    assert.inRange(req, 0, 7, 'axe requirement within tier range');
    assert.gte(mul, 1, 'wood multiplier at least 1');
  }
});

test('WorldGen namespace is present and usable headlessly', () => {
  assert.eq(typeof WorldGen, 'object', 'WorldGen exported');
  assert.eq(typeof WorldGen.lonLatToWorldPx, 'function', 'projection fn present');
  assert.eq(typeof WorldGen.Z, 'number', 'tile zoom is a number');
});
