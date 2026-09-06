// Fishing: the cast's price, its whiff, its junk and WHICH FISH are in the
// water. Fishing paid too well (Sep 2026) — a Wood rod landed three species in
// the first minutes at 3⚡ a cast, which made a water tile a better living than
// any of the land. Four dials moved, and this file pins all four against the
// module that owns them (items.js › the FISHING block) rather than against
// numbers retyped here.
//
// The one that is a MECHANIC rather than a rate is the species gate: a fish
// below its minTier is not in the pool at all, so bare hands land minnows and
// each better rod is what puts the next fish in the water. That is invisible
// from the bank, so the Book carries it — pinned at the bottom.

(function () {
const TIERS = [0, 1, 2, 3, 4, 5, 6, 7];

// --- The whiff ------------------------------------------------------------

test('fishing: the whiff is the old ladder, doubled and capped', () => {
  // The pre-Sep-2026 curve, re-derived from the constants the module still
  // keeps rather than a copy: max(FLOOR, BASE - tier * PER_TIER).
  for (const t of TIERS) {
    const before = Math.max(FISH_WHIFF_FLOOR, FISH_WHIFF_BASE - t * FISH_WHIFF_PER_TIER);
    const want = Math.min(FISH_WHIFF_MAX, before * FISH_WHIFF_MULT);
    assert.eq(fishWhiffChance(t), want, `whiff at tier ${t}`);
    // Doubled where doubling fits, and never certain.
    assert.lte(fishWhiffChance(t), FISH_WHIFF_MAX, 'a cast is never hopeless');
    assert.gte(fishWhiffChance(t), before, 'never gentler than the old rate');
  }
  assert.eq(FISH_WHIFF_MULT, 2, 'the whiff doubled');
  assert.eq(fishWhiffChance(7), 2 * FISH_WHIFF_FLOOR, 'a Frost rod whiffs twice the old floor');
});

test('fishing: a better rod never whiffs more', () => {
  for (let t = 1; t <= 7; t++) {
    assert.lte(fishWhiffChance(t), fishWhiffChance(t - 1), `tier ${t} vs ${t - 1}`);
  }
  assert.lt(fishWhiffChance(7), fishWhiffChance(0), 'and the ladder still goes somewhere');
});

// --- The cost -------------------------------------------------------------

test('fishing: a cast costs double the shared tool ladder', () => {
  assert.eq(FISH_COST_MULT, 2, 'the cast cost doubled');
  // probEnergy rounds probabilistically, so drive it with a fixed rng: 0 always
  // takes the floor, so the spend is floor(mult × the curve's expectation).
  const always = () => 0;
  assert.eq(effectiveFishCost({}, always), Math.floor(2 * toolEnergyExpected(0)), 'bare-handed');
  assert.eq(effectiveFishCost({ rod: { tier: 1 } }, always), Math.floor(2 * toolEnergyExpected(1)), 'Wood rod');
  assert.eq(effectiveFishCost({ rod: { tier: 7 } }, always), Math.floor(2 * toolEnergyExpected(7)), 'Frost rod');
  // …and it is fishing's OWN multiplier: the other jobs on the shared curve
  // are untouched, or this would have been a global energy change.
  assert.eq(effectivePickCost({}, always), Math.floor(toolEnergyExpected(0, ENERGY_COST.rockBreak)), 'mining unchanged');
  assert.eq(effectiveCatchCost({}, always), Math.floor(toolEnergyExpected(0)), 'catching unchanged');
});

// --- The junk -------------------------------------------------------------

test('fishing: the boot doubled, the gear jackpot did not', () => {
  assert.eq(FISH_BOOT_CHANCE, 0.12, 'boots come up twice as often as the old 6%');
  assert.eq(FISH_JACKPOT_CHANCE, 0.02, 'the gear jackpot is untouched');
  assert.lt(FISH_JACKPOT_CHANCE, FISH_BOOT_CHANCE, 'and junk is commoner than treasure');
});

test('fishing: the handler rolls the module\'s numbers, not its own', () => {
  // The four dials are only one set if the handler reads them. It used to
  // carry its own literals (0.55 - tier*0.05, 0.06, and the whole fish table).
  assert.truthy(/fishWhiffChance\(tier\)/.test(INTERACT_SRC), 'whiff');
  assert.truthy(/< FISH_BOOT_CHANCE/.test(INTERACT_SRC), 'boot');
  assert.truthy(/< FISH_JACKPOT_CHANCE/.test(INTERACT_SRC), 'jackpot');
  assert.truthy(/rollFish\(tier\)/.test(INTERACT_SRC), 'the catch');
  assert.falsy(/0\.55 - tier \* 0\.05/.test(INTERACT_SRC), 'no second copy of the whiff curve');
  assert.falsy(/id: 'goldenfish', +w:/.test(INTERACT_SRC), 'no second copy of the catch table');
});

// --- The species gate -----------------------------------------------------

test('fishing: bare hands fish, and land minnows only', () => {
  const table = fishTable(0);
  assert.eq(table.length, 1, 'one species in the water');
  assert.eq(table[0].id, 'minnow', 'and it is the minnow');
  for (let i = 0; i < 200; i++) assert.eq(rollFish(0), 'minnow', 'every bare-handed catch');
});

test('fishing: a Wood rod adds ONE fish, not three', () => {
  // THE BUG, in the user's words: "I caught 3 species with a wood rod
  // immediately". A Wood rod opens the bass and stops there.
  const ids = fishTable(1).map((f) => f.id);
  assert.eq(ids.join(','), 'minnow,bass', 'the Wood pool');
  const seen = new Set();
  for (let i = 0; i < 400; i++) seen.add(rollFish(1));
  assert.eq(seen.size, 2, 'and 400 casts turn up no third species');
});

test('fishing: every rod up the ladder opens exactly one more fish', () => {
  let last = 0;
  for (const t of TIERS) {
    const n = fishTable(t).length;
    assert.gte(n, last, `tier ${t} never loses a species`);
    assert.lte(n - last, 1, `tier ${t} adds at most one`);
    last = n;
  }
  assert.eq(fishTable(7).length, FISH_SPECIES.length, 'a Frost rod fishes the whole table');
  assert.eq(fishTable(6).map((f) => f.id).includes('goldenfish'), false,
    'and the goldenfish is the Frost rod\'s alone');
});

test('fishing: a species is never rolled below its rod', () => {
  for (const f of FISH_SPECIES) {
    for (let t = 0; t < f.minTier; t++) {
      assert.falsy(fishTable(t).some((x) => x.id === f.id), `${f.id} at tier ${t}`);
    }
    assert.truthy(fishTable(f.minTier).some((x) => x.id === f.id), `${f.id} at its own tier`);
  }
  // 2000 casts at every tier: nothing off the pool ever comes out.
  for (const t of TIERS) {
    const allowed = new Set(fishTable(t).map((f) => f.id));
    for (let i = 0; i < 2000; i++) {
      assert.truthy(allowed.has(rollFish(t)), `tier ${t} landed something off its table`);
    }
  }
});

test('fishing: the pool is ordered by worth, and the rarer fish is the dearer', () => {
  // The gate has to agree with the price list, or a "rare" fish would be the
  // cheap one and the ladder would read backwards.
  const byTier = [...FISH_SPECIES].sort((a, b) => a.minTier - b.minTier);
  for (let i = 1; i < byTier.length; i++) {
    assert.gt(PRICES[byTier[i].id], PRICES[byTier[i - 1].id],
      `${byTier[i].id} is worth more than ${byTier[i - 1].id}`);
  }
  // And every species in the table is a real produce item the catalog knows.
  for (const f of FISH_SPECIES) {
    assert.truthy(ITEM_BY_ID[f.id], `${f.id} is in the catalog`);
    assert.eq(ITEM_BY_ID[f.id].kind, 'produce', `${f.id} is produce`);
  }
});

test('fishing: a rod also makes its own fish commoner', () => {
  // Two axes, not one: the gate says WHICH fish, the weights say how often.
  // A species' WEIGHT must never fall as the rod that opened it improves.
  // (Its SHARE can dip for one tier — the tier that opens the next species
  // takes a slice off everything already in the pool, which is the ladder
  // working, not a species getting rarer.)
  const weight = (id, t) => (fishTable(t).find((f) => f.id === id) || { w: 0 }).w;
  const share = (id, t) => {
    const table = fishTable(t);
    return weight(id, t) / table.reduce((a, b) => a + b.w, 0);
  };
  const opensAt = new Set(FISH_SPECIES.map((f) => f.minTier));
  for (const f of FISH_SPECIES) {
    if (f.id === 'minnow') continue;          // the minnow thins out on purpose
    for (let t = f.minTier + 1; t <= 7; t++) {
      assert.gte(weight(f.id, t), weight(f.id, t - 1), `${f.id} weight at tier ${t}`);
      if (!opensAt.has(t)) {
        assert.gte(share(f.id, t) + 1e-9, share(f.id, t - 1), `${f.id} share at tier ${t}`);
      }
    }
    // Over the whole ladder it is unambiguous: by Frost, every gated fish is a
    // bigger share of the catch than on the rod that first opened it.
    assert.gt(share(f.id, 7) + 1e-9, share(f.id, f.minTier), `${f.id} by Frost`);
  }
  assert.lt(share('minnow', 7), share('minnow', 0), 'and the minnow gives way');
});

// --- What the player is told ----------------------------------------------

test('fishing: the Book teaches the ladder, tier by tier', () => {
  // A gate nobody can see from the bank, and one no ✦ row can carry — so the
  // Book owns it, and the tier NAMES it quotes are re-derived from the same
  // FISH_SPECIES rows the roll reads (books.test.js' rule: never retype a
  // number a module owns).
  const tip = PLAY_TIPS.find((t) => /goldenfish/i.test(t));
  assert.truthy(tip, 'the Book has a fishing page');
  for (const f of FISH_SPECIES) {
    if (f.minTier === 0) continue;            // bare hands: the rod's own blurb
    const tierName = TIER_BY_NUM[f.minTier].name;
    const re = new RegExp(`${tierName}[^.]*${ITEM_BY_ID[f.id].name}|${ITEM_BY_ID[f.id].name}[^.]*${tierName}`, 'i');
    assert.truthy(re.test(tip), `the tip pairs ${ITEM_BY_ID[f.id].name} with ${tierName}`);
  }
});

test('fishing: the rod\'s blurb names the bare-handed ceiling', () => {
  const blurb = RELIC_DEFS.rod.blurb;
  assert.truthy(/bare hands/i.test(blurb), 'a cast still works bare-handed');
  assert.truthy(/minnow/i.test(blurb), 'and the blurb says what that gets you');
  assert.lte(blurb.length, 55, 'the ✦ row is one line');
});
})();
