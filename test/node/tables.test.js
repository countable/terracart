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

test('HomeArea.softwoodSpeciesNear: forces pine near spawn, exempts bushes', () => {
  HomeArea.setOrigin(0, 0);
  // A normal-sized tree near the origin is forced to softwood (pine)…
  assert.eq(HomeArea.softwoodSpeciesNear(10, 10, 'maple', 'medium'), 'pine',
    'medium tree near spawn becomes softwood');
  assert.eq(HomeArea.softwoodSpeciesNear(10, 10, 'birch'), 'pine',
    'size-less tree near spawn becomes softwood');
  // …but a bush-tier crown keeps its own species (it renders as a uniform bush
  // and is already bare-hands tier-0, so the pine stamp would only mislabel it).
  assert.eq(HomeArea.softwoodSpeciesNear(10, 10, 'maple', 'bush'), 'maple',
    'bush near spawn keeps its own species');
  // Far from spawn nothing is overridden, regardless of size.
  assert.eq(HomeArea.softwoodSpeciesNear(9999, 9999, 'maple', 'medium'), 'maple',
    'tree far from spawn keeps its species');
  assert.eq(HomeArea.softwoodSpeciesNear(9999, 9999, 'maple', 'bush'), 'maple',
    'bush far from spawn keeps its species');
});

test('WorldGen namespace is present and usable headlessly', () => {
  assert.eq(typeof WorldGen, 'object', 'WorldGen exported');
  assert.eq(typeof WorldGen.lonLatToWorldPx, 'function', 'projection fn present');
  assert.eq(typeof WorldGen.Z, 'number', 'tile zoom is a number');
});

// ── Amulet: stick walking ────────────────────────────────────────────────────
// The stick is always present and always works; the amulet is purely an upgrade
// to it. Both curves therefore have to answer for a bare hand (tier 0) — the
// old ghost-mode pair returned 0 there, meaning "no pad at all", and callers
// had to paper over it with `|| 8` / `|| 1`.

test('steerSpeedMul: bare hands walk at 1×, the amulet only makes it faster', () => {
  assert.eq(steerSpeedMul({}), 1, 'no relics');
  assert.eq(steerSpeedMul({ amulet: null }), 1, 'no amulet');
  assert.eq(steerSpeedMul({ amulet: { tier: 1 } }), 1.5, 'T1');
  assert.eq(steerSpeedMul({ amulet: { tier: 7 } }), 4.5, 'T7 (Frost)');
  // Monotonic, and never below the bare-handed baseline.
  let prev = 0;
  for (let t = 0; t <= 7; t++) {
    const v = steerSpeedMul({ amulet: { tier: t } });
    assert.gte(v, 1, `tier ${t} at least walk pace`);
    assert.gt(v, prev, `tier ${t} beats tier ${t - 1}`);
    prev = v;
  }
});

test('steerEnergyCost: 1 pip/cell bare, ~7× cheaper at Frost', () => {
  assert.eq(steerEnergyCost({}), 1, 'no relics — full price');
  assert.eq(steerEnergyCost({ amulet: { tier: 1 } }), 1, 'T1 matches bare hands');
  assert.inRange(steerEnergyCost({ amulet: { tier: 7 } }), 0.149, 0.151, 'T7 ≈ 0.15');
  // Monotonic downward, and always something — walking off the GPS is never free.
  let prev = Infinity;
  for (let t = 1; t <= 7; t++) {
    const v = steerEnergyCost({ amulet: { tier: t } });
    assert.gt(v, 0, `tier ${t} still costs`);
    assert.truthy(v <= prev, `tier ${t} no dearer than tier ${t - 1}`);
    prev = v;
  }
});

test('steerEnergyCost: the speed potion’s synthetic tier 9 never pays you to walk', () => {
  // drinkSpeedPotion stands in a tier-9 amulet, which runs the linear curve
  // negative — the floor is what keeps a minute of Speed from REFUNDING energy.
  const v = steerEnergyCost({ amulet: { tier: 9 } });
  assert.gt(v, 0, 'still positive');
  assert.lt(v, steerEnergyCost({ amulet: { tier: 7 } }), 'still cheaper than Frost');
  assert.gt(steerSpeedMul({ amulet: { tier: 9 } }), steerSpeedMul({ amulet: { tier: 7 } }),
    'and faster than Frost');
});
