// Headless tests for the declarative data tables + tool helpers
// (src/items.js, src/util.js, src/worldgen.js namespace).

test('toolDurationMs: tier ladder 9s bare → 0.3s frost', () => {
  assert.eq(toolDurationMs({}, 'pick'), 9000, 'no tool = 9s (2.25× wood)');
  assert.eq(toolDurationMs({ pick: { tier: 1 } }, 'pick'), 4000, 'T1 = 4s');
  assert.eq(toolDurationMs({ pick: { tier: 7 } }, 'pick'), 300, 'T7 = 0.3s');
  // Strictly monotonic decreasing across the ladder.
  let prev = Infinity;
  for (let t = 1; t <= 7; t++) {
    const d = toolDurationMs({ pick: { tier: t } }, 'pick');
    assert.lt(d, prev, `tier ${t} faster than tier ${t - 1}`);
    prev = d;
  }
});

// The ladder is GEOMETRIC — every rung ~1.54× the one below (TIER_STEP), so no
// upgrade is a dud. The ladder it replaced wandered from 1.25× (copper→iron,
// which read as no upgrade at all) to 1.67×, so this pins the SHAPE, not just
// the endpoints: an edit that flattens one rung to make a tier "feel right"
// fails here rather than shipping.
test('toolDurationMs: every rung is ~1.5× the one below it', () => {
  for (let t = 2; t <= 7; t++) {
    const step = TOOL_DURATION_MS[t - 1] / TOOL_DURATION_MS[t];
    assert.lt(Math.abs(step - TIER_STEP), 0.03,
      `tier ${t - 1}→${t} steps ${step.toFixed(3)}×, want ~${TIER_STEP.toFixed(3)}×`);
  }
  // Both ends stay where they were tuned; the curve between them is derived.
  assert.eq(TOOL_DURATION_MS[1], 4000, 'wood end pinned');
  assert.eq(TOOL_DURATION_MS[7], 300, 'frost end pinned');
  // Bare hands is NOT on the curve — it's the always-possible floor at 9s.
  assert.eq(toolDurationMs({}, 'pick') / TOOL_DURATION_MS[1], 2.25, 'bare hands = 2.25× wood');
});

test('effectivePickCost: cheaper as the pick tier climbs', () => {
  const bare = effectivePickCost({});
  const t7 = effectivePickCost({ pick: { tier: 7 } });
  assert.gt(bare, t7, 'bare hands cost more energy than a T7 pick');
});

// Growing a crop out — the seed cost, the tilling/watering/waiting — has to
// pay back at least 3x the seed price, or the loop isn't worth it next to
// just selling the seed itself. rockfruit is DELIBERATELY EXEMPT: its produce
// is already the game's $1 price FLOOR (wild debris, free off any rock), so
// no seed price above $0 clears 3x — its $8 seed stands on its own terms
// instead, priced as a stone/building-material commodity rather than a
// grow-for-profit crop (see items.js PRICES comment).
test('crop economy: produce sells for at least 3x its own seed (rockfruit exempt)', () => {
  for (const crop of Object.keys(CROP_ROW)) {
    const seedId = `${crop}_seed`;
    if (PRICES[seedId] == null || PRICES[crop] == null) continue;
    if (crop === 'rockfruit') continue;
    assert.gte(PRICES[crop], PRICES[seedId] * 3,
      `${crop}: produce $${PRICES[crop]} should be at least 3x its $${PRICES[seedId]} seed`);
  }
  assert.eq(PRICES.rockfruit_seed, 8, 'rockfruit seed is intentionally untouched by the 3x rule');
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

test('ITEMS_BY_CLASS_TIER: never surfaces a shiny variant', () => {
  // Shiny animals are a 5% wild-catch-only bonus (10× value) — a chest that
  // rolls the 'animal' class must never be able to hand one out directly.
  for (const [cls, byT] of Object.entries(ITEMS_BY_CLASS_TIER)) {
    for (const [t, ids] of Object.entries(byT)) {
      for (const id of ids) {
        assert.truthy(!ITEM_BY_ID[id]?.shiny, `${cls} T${t} pool excludes shiny ${id}`);
      }
    }
  }
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

// A tree whose id doesn't hash shiny — shiny trees gate on a Gold axe whatever
// their size, which would mask the size ladder these tests are checking.
function plainTree(props) {
  for (let i = 0; ; i++) {
    const id = `t_${props.species || 'any'}_${props.size || 'none'}_${i}`;
    if (!isShiny(id, SHINY_RATE.tree)) return { kind: 'tree', variant: 3, ...props, id };
  }
}

test('treeAxeReqTier: the size ladder climbs, and only the biggest needs Gold', () => {
  for (const species of ['maple', 'birch', 'pine']) {
    const tier = (size) => treeAxeReqTier(plainTree({ species, size }));
    assert.eq(tier('bush'), 0, `${species} bush fells bare-handed`);
    assert.lt(tier('small'), tier('medium'), `${species}: small easier than medium`);
    assert.lt(tier('medium'), tier('large'), `${species}: medium easier than large`);
    // Gold (4) is the shiny/top gate — no non-shiny tree below 'large' may want it.
    assert.lt(tier('small'), 4, `${species} small doesn't need a Gold axe`);
    assert.lt(tier('medium'), 4, `${species} medium doesn't need a Gold axe`);
  }
});

test('treeAxeReqTier: a size-less hardwood gates below a large one', () => {
  // Regression: size-less trees class off their canopy scale, and maple's
  // sprite-sheet base (0.85 vs 0.62) used to read as a bigger TREE — so every
  // size-less maple classed 'full' and, with the hardwood +1, demanded the same
  // Gold axe as a large one, sapling art and all.
  const large = treeAxeReqTier(plainTree({ species: 'maple', size: 'large' }));
  for (const variant of [1, 2, 3, 4]) {
    const sizeless = treeAxeReqTier(plainTree({ species: 'maple', variant }));
    assert.lt(sizeless, large, `size-less maple (variant ${variant}) fells easier than a large one`);
  }
  // The growth stage the maple sheet DRAWS is the size class it gates on:
  // a sprout/young frame can't demand as much axe as a mature canopy.
  const sprout = treeAxeReqTier(plainTree({ species: 'maple', variant: 1 }));
  const mature = treeAxeReqTier(plainTree({ species: 'maple', variant: 3 }));
  assert.lt(sprout, mature, 'a maple sprout fells easier than a mature maple');
  assert.eq(treeGrowthStage({ variant: 0 }), 1, 'stump frame 0 clamps to the sprout frame');
  assert.eq(treeGrowthStage({ variant: 4 }), 3, 'stump frame 4 clamps to the mature frame');
  assert.eq(treeGrowthStage({}), 2, 'no variant = young');
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

test('steerSpeedMul: bare hands cover a cell a second, the amulet goes up from there', () => {
  // The baseline is 6× walk pace on purpose: WALK_M_S (1.4) × 6 ≈ 8.4 m/s, a
  // little over one WorldGen.CELL_M cell per second. Real walk pace crawls
  // across an 11-cell view, which is what "the default walk speed is super
  // slow" was. It was lifted from 5× (a flat one cell/second) because that
  // still read as a drag over the whole opening.
  //
  // The TOP moved instead: 15.5 -> 24. The old ladder sounded wide and did not
  // play wide — 1.2 cells a second bare-handed against 3.1 at the top, so a
  // top-tier amulet felt like a bare-handed one with a tailwind. The floor is
  // load-bearing and stays; the widening lands in the per-tier step.
  assert.eq(steerSpeedMul({}), 6, 'no relics');
  assert.eq(steerSpeedMul({ amulet: null }), 6, 'no amulet');
  assert.eq(steerSpeedMul({ amulet: { tier: 7 } }), 24, 'T7 (Frost)');
  // The reason the number moved at all: the ladder has to be worth climbing.
  assert.gte(steerSpeedMul({ amulet: { tier: 7 } }) / steerSpeedMul({}), 3.5,
    'the top of the ladder is a different way of moving, not a nudge');
  assert.inRange(steerSpeedMul({}) * 1.4, WorldGen.CELL_M - 0.5, WorldGen.CELL_M + 2,
    'bare baseline is ~one cell per second');
  // Monotonic, and never below the bare-handed baseline.
  let prev = 0;
  for (let t = 0; t <= 7; t++) {
    const v = steerSpeedMul({ amulet: { tier: t } });
    assert.gte(v, 6, `tier ${t} at least the baseline`);
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

test('steer curves: the borrowed buff tiers rank above Frost and never pay you to walk', () => {
  // Two buffs borrow an amulet tier instead of adding a movement mode (app.js
  // _walkRelics): Dragon Powder walks as tier 8, the Speed potion as tier 9.
  // Both run the linear cost curve negative — the floor is what keeps a minute
  // of either from REFUNDING energy.
  const DRAGON = 8, POTION = 9;
  for (const t of [DRAGON, POTION]) {
    assert.gt(steerEnergyCost({ amulet: { tier: t } }), 0, `tier ${t} still costs something`);
    assert.lt(steerEnergyCost({ amulet: { tier: t } }), steerEnergyCost({ amulet: { tier: 7 } }),
      `tier ${t} cheaper than Frost`);
  }
  // Speed ranks bare < Frost < dragon < potion.
  const speeds = [0, 7, DRAGON, POTION].map(t => steerSpeedMul({ amulet: { tier: t } }));
  for (let i = 1; i < speeds.length; i++) {
    assert.gt(speeds[i], speeds[i - 1], `speeds ascend: ${speeds.join(' < ')}`);
  }
});
