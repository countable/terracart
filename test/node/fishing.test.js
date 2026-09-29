// Fishing: the cast's price, WHERE the fish are (secret one-fish spots), what
// an empty cast turns up and WHICH FISH the rod lands. Pinned against the
// module that owns them (items.js › the FISHING block) rather than against
// numbers retyped here.
//
// The one that is a MECHANIC rather than a rate is the species gate: a fish
// below its minTier is not in the pool at all, so bare hands land minnows and
// each better rod is what puts the next fish in the water. That is invisible
// from the bank, so the Book carries it — pinned at the bottom.

(function () {
const TIERS = [0, 1, 2, 3, 4, 5, 6, 7];

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

// --- The handler ----------------------------------------------------------

test('fishing: the handler rolls the module\'s numbers, not its own', () => {
  // It used to carry its own literals (0.55 - tier*0.05, 0.06, and the whole
  // fish table).
  assert.truthy(/rollFish\(tier\)/.test(INTERACT_SRC), 'the catch');
  assert.truthy(/rollEmptyCast\(\)/.test(INTERACT_SRC), 'the empty cast');
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

// --- Where the fish are ---------------------------------------------------
// A water cell holds one fish or none (FISH_STOCK_CHANCE, hashed off the
// tile + local cell id), nothing says which, and landing the fish empties the
// spot for good (save.fishedSpots).

test('fishing: about one spot in three is stocked, and the same for everyone', () => {
  let n = 0, stocked = 0;
  for (let ix = 0; ix < 60; ix++) {
    for (let iy = 0; iy < 60; iy++) {
      const id = fishSpotId(5, 7, ix, iy);
      n++;
      if (fishSpotStocked(id)) stocked++;
      assert.eq(fishSpotStocked(id), fishSpotStocked(fishSpotId(5, 7, ix, iy)), 'deterministic');
    }
  }
  assert.inRange(stocked / n, FISH_STOCK_CHANCE - 0.04, FISH_STOCK_CHANCE + 0.04, `share ${stocked}/${n}`);
  assert.eq(fishSpotId(1, 2, 3, 4), 'fish_1_2_3_4', 'id is tile + local cell');
});

test('fished spots persist as an id set bound at scene boot', () => {
  const app = ALL_SRC['app.js'];
  assert.truthy(app.includes("this.fishedSpotSet = bindIdSet(this.save, 'fishedSpots')"), 'bound');
  assert.falsy(/'fishedSpots'/.test(ALL_SRC['savemigrate.js'] || ''), 'never capped: gone forever');
});

(function () {
  const fishing = TAP_HANDLERS.find((h) => h.name === 'fishing');
  // First stocked / empty spot on a tile, found through the module's own hash.
  function spot(want) {
    for (let ix = 0; ix < 200; ix++) {
      if (fishSpotStocked(fishSpotId(0, 0, ix, 0)) === want) return ix;
    }
    throw new Error('no spot');
  }
  function cast(ix, fished, save = {}, tier = 7, rand = () => 0.99) {
    const loot = [], inv = [];
    const scene = {
      depth: 0, save,
      fishedSpotSet: fished,
      spendEnergy: () => true,
      startWorkProgress: (_x, _y, done) => done(),
      flashLoot: (text) => loot.push(text),
      addToInv: (id) => inv.push(id),
      spawnFishedSlime: () => false,
    };
    const ctx = { scene, save: Object.assign(save, { relics: tier ? { rod: { tier } } : {} }),
      sx: 0, sy: 0, cwmx: 0, cwmy: 0,
      cell: { type: TERRAIN.WATER, tx: 0, ty: 0, ix, iy: 0 } };
    const rnd = Math.random;
    Math.random = rand;                 // 0.99: an empty cast turns up nothing
    try { fishing.try(ctx); } finally { Math.random = rnd; }
    return { loot, inv };
  }

  test('fishing: a stocked spot gives one fish, then nothing ever again', () => {
    const fished = new Set();
    const ix = spot(true);
    const first = cast(ix, fished);
    assert.eq(first.inv.length, 1, 'a fish');
    assert.truthy(fished.has(fishSpotId(0, 0, ix, 0)), 'the spot is written down');
    for (let i = 0; i < 5; i++) {
      const again = cast(ix, fished);
      assert.eq(again.inv.length, 0, 'fished out');
      assert.truthy(/nothing biting/.test(again.loot[0]), 'and it reads like any bad cast');
    }
  });

  test('fishing: a stocked spot ALWAYS lands a fish, never above the rod', () => {
    // No whiff, no junk, no slime on a stocked spot: whatever the dice say,
    // the cast pays one fish off the rod's own pool.
    const ix = spot(true);
    for (const t of TIERS) {
      const allowed = new Set(fishTable(t).map((f) => f.id));
      for (const r of [0, 0.01, 0.3, 0.5, 0.99]) {
        const got = cast(ix, new Set(), {}, t, () => r);
        assert.eq(got.inv.length, 1, `tier ${t}, rng ${r}: a fish`);
        assert.truthy(allowed.has(got.inv[0]), `tier ${t} landed ${got.inv[0]}`);
        const minTier = FISH_SPECIES.find((f) => f.id === got.inv[0]).minTier;
        assert.lte(minTier, t, `${got.inv[0]} is at or below the rod`);
      }
    }
  });

  test('fishing: an empty spot never bites, and is not recorded', () => {
    const fished = new Set();
    const ix = spot(false);
    for (let i = 0; i < 5; i++) assert.eq(cast(ix, fished).inv.length, 0, 'no fish here');
    assert.eq(fished.size, 0, 'nothing to deplete');
  });
})();

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

// --- The empty cast -------------------------------------------------------

test('fishing: an empty cast now and then pays — treasure 1 in 50, a slime, junk', () => {
  assert.eq(FISH_EMPTY_TREASURE_CHANCE, 1 / 50, 'a treasure roll 1 in 50');
  assert.lt(FISH_SLIME_CHANCE, FISH_EMPTY_JUNK_CHANCE, 'a slime rarer than junk');
  const seq = (...v) => { let i = 0; return () => v[i++]; };
  const t = rollEmptyCast(seq(0, 0.99));
  assert.eq(t.kind, 'treasure');
  assert.eq(t.tier, FOUND_TREASURE_TIER_MAX, 'the tier is random, up to the chest max');
  assert.eq(rollEmptyCast(seq(0.5, 0)).kind, 'slime');
  const j = rollEmptyCast(seq(0.5, 0.5, 0, 0.4));
  assert.eq(j.kind, 'junk');
  assert.includes(FISH_EMPTY_JUNK, j.id);
  assert.eq(rollEmptyCast(seq(0.5, 0.5, 0.5)), null, 'mostly still nothing biting');
  for (const id of FISH_EMPTY_JUNK) assert.truthy(ITEM_BY_ID[id], `${id} is a real item`);
  const tiers = new Set(), kinds = {};
  let r = 1;
  const rng = () => { r = (r * 16807) % 2147483647; return r / 2147483647; };
  for (let i = 0; i < 20000; i++) {
    const e = rollEmptyCast(rng);
    const k = e ? e.kind : 'none';
    kinds[k] = (kinds[k] || 0) + 1;
    if (e && e.kind === 'treasure') tiers.add(e.tier);
  }
  assert.inRange(kinds.treasure / 20000, 0.015, 0.025, 'about 1 in 50');
  assert.eq(tiers.size, FOUND_TREASURE_TIER_MAX, 'every chest tier comes up');
  assert.gt(kinds.none, kinds.junk, 'nothing is still the commonest empty cast');
  // The handler rolls it on the whiff and pays a treasure through the one lane.
  assert.truthy(/const empty = rollEmptyCast\(\);/.test(INTERACT_SRC), 'rolled on the whiff');
  assert.truthy(/grantFoundTreasure\(scene, save, sx, sy, '🎣', empty\.tier, /.test(INTERACT_SRC),
    'the treasure is found treasure, with its fanfare');
});

// --- The hoe's finds ------------------------------------------------------

test('tilling: a furrow turns up flint 1 in 10, a stone 1 in 10, treasure 1 in 100', () => {
  assert.eq(TILL_TREASURE_CHANCE, 1 / 100);
  assert.eq(TILL_FLINT_CHANCE, 1 / 10);
  assert.eq(TILL_ROCK_CHANCE, 1 / 10);
  assert.eq(ITEM_BY_ID.coal.name, 'Flint', "flint is item id 'coal'");
  let r = 7;
  const rng = () => { r = (r * 16807) % 2147483647; return r / 2147483647; };
  const k = {};
  const N = 50000;
  for (let i = 0; i < N; i++) {
    const f = rollTillFind(rng);
    const key = !f ? 'none' : f.kind === 'treasure' ? 'treasure' : f.id;
    k[key] = (k[key] || 0) + 1;
    if (f && f.kind === 'treasure') assert.inRange(f.tier, 1, FOUND_TREASURE_TIER_MAX);
  }
  assert.inRange(k.treasure / N, 0.007, 0.013, 'about 1 in 100');
  assert.inRange(k.coal / N, 0.08, 0.12, 'about 1 in 10 flint');
  assert.inRange(k.rockfruit / N, 0.08, 0.12, 'about 1 in 10 stone');
  assert.truthy(/const find = rollTillFind\(\);/.test(INTERACT_SRC), 'rolled when the furrow finishes');
  assert.truthy(/grantFoundTreasure\(scene, save, sx, sy, '⛏', find\.tier, /.test(INTERACT_SRC),
    'buried treasure pays through the found-treasure lane');
  assert.truthy(/scene\.flashJackpot\?\.\(1, headline\)/.test(INTERACT_SRC), 'with the jackpot fanfare');
});
