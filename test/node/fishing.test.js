// Fishing: the cast's price, WHERE the fish are (secret one-fish spots), what
// an empty cast turns up and WHICH FISH the rod lands. Pinned against the
// module that owns them (items.js › the FISHING block) rather than against
// numbers retyped here.
//
// The landing rule is the rod's: a fish above the rod's tier gets away with
// 1 - 0.5 ** gap and stays in its spot. That is invisible from the bank, so
// the Book carries it — pinned at the bottom.

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
  assert.truthy(/spotFish\(spotId\)/.test(INTERACT_SRC), 'the spot\'s fish');
  assert.truthy(/fishCatchChance\(pick, tier, shiny\)/.test(INTERACT_SRC), 'the landing');
  assert.truthy(/rollEmptyCast\(/.test(INTERACT_SRC), 'the empty cast');
  assert.falsy(/id: 'goldenfish', +w:/.test(INTERACT_SRC), 'no second copy of the catch table');
});

// --- Which fish, and landing it -------------------------------------------

test('fishing: half of all fish are minnows, the rest shared evenly', () => {
  const w = Object.fromEntries(FISH_SPECIES.map((f) => [f.id, f.w]));
  assert.eq(w.minnow, 4, 'minnow 4');
  for (const id of ['bass', 'trout', 'salmon', 'goldenfish']) assert.eq(w[id], 1, `${id} 1`);
  const n = {}, N = 20000;
  for (let i = 0; i < N; i++) {
    const id = spotFish(fishSpotId(3, 9, i % 200, Math.floor(i / 200)));
    n[id] = (n[id] || 0) + 1;
    assert.eq(id, spotFish(fishSpotId(3, 9, i % 200, Math.floor(i / 200))), 'same fish for everyone');
  }
  assert.inRange(n.minnow / N, 0.47, 0.53, 'about half minnows');
  for (const id of ['bass', 'trout', 'salmon', 'goldenfish']) {
    assert.inRange(n[id] / N, 0.105, 0.145, `${id} about 1 in 8`);
  }
});

test('fishing: a fish above the rod gets away, halved per tier of gap', () => {
  for (const f of FISH_SPECIES) {
    const ft = fishTier(f.id);
    assert.eq(ft, BASE_TIER[f.id], `${f.id}'s tier is its BASE_TIER`);
    for (let rod = 0; rod <= 7; rod++) {
      const want = rod >= ft ? 1 : Math.pow(0.5, ft - rod);
      assert.eq(fishCatchChance(f.id, rod), want, `${f.id} on a tier ${rod} rod`);
    }
  }
  assert.eq(fishCatchChance('minnow', 0), 0.5, 'bare hands land a minnow half the time');
  assert.eq(fishCatchChance('goldenfish', 7), 1, 'a Frost rod never loses one');
});

// --- Shiny fish -------------------------------------------------------------

test('fishing: a shiny fish lives in a stocked spot, fights a tier harder and pays the bonus', () => {
  assert.eq(SHINY_RATE.fish, 0.05, 'shiny fish share the animal rate');
  let stocked = 0, shiny = 0;
  for (let i = 0; i < 40000; i++) {
    const id = fishSpotId(2, 4, i % 200, Math.floor(i / 200));
    if (fishSpotShiny(id)) { shiny++; assert.truthy(fishSpotStocked(id), 'only a stocked spot is shiny'); }
    if (fishSpotStocked(id)) stocked++;
  }
  assert.inRange(shiny / stocked, 0.035, 0.065, 'about 1 in 20 stocked spots');
  assert.eq(SHINY_FISH_TIER_UP, 1);
  for (const f of FISH_SPECIES) for (let rod = 0; rod <= 7; rod++) {
    assert.eq(fishCatchChance(f.id, rod, true), Math.pow(0.5, Math.max(0, fishTier(f.id) + 1 - rod)),
      `a shiny ${f.id} lands like tier ${fishTier(f.id) + 1} on a tier ${rod} rod`);
  }
  assert.eq(fishCatchChance('minnow', 1, true), 0.5, 'a Wood rod loses a shiny minnow half the time');
  assert.truthy(/if \(shiny\) scene\.awardShinyBonus\(pick, sx, sy\)/.test(INTERACT_SRC), 'landing one pays the shiny bonus');
});

test('fishing: the map glints exactly the shiny spots, off a per-tile list', () => {
  const N = 60;
  const grid = new Uint8Array(N * N).fill(WorldGen.T.WATER);
  grid[0] = 0;
  const entry = { grid, cellsPerEdge: N };
  const list = shinyFishSpots(entry, 1, 2);
  assert.truthy(list.length > 0, 'a lake has shiny spots');
  for (const f of list) {
    assert.eq(f.id, fishSpotId(1, 2, f.ix, f.iy));
    assert.truthy(fishSpotShiny(f.id));
  }
  let want = 0;
  for (let iy = 0; iy < N; iy++) for (let ix = 0; ix < N; ix++)
    if (grid[iy * N + ix] === WorldGen.T.WATER && fishSpotShiny(fishSpotId(1, 2, ix, iy))) want++;
  assert.eq(list.length, want, 'every shiny water spot, and only those');
  assert.eq(shinyFishSpots(entry, 1, 2), list, 'derived once per entry');
});

test('fishing: the rarer fish is the dearer', () => {
  const byTier = [...FISH_SPECIES].sort((a, b) => fishTier(a.id) - fishTier(b.id));
  for (let i = 1; i < byTier.length; i++) {
    assert.gt(PRICES[byTier[i].id], PRICES[byTier[i - 1].id],
      `${byTier[i].id} is worth more than ${byTier[i - 1].id}`);
  }
  for (const f of FISH_SPECIES) {
    assert.truthy(ITEM_BY_ID[f.id], `${f.id} is in the catalog`);
    assert.eq(ITEM_BY_ID[f.id].kind, 'produce', `${f.id} is produce`);
  }
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

  test('fishing: a stocked spot always bites: its fish, landed or got away', () => {
    // No whiff, no junk, no slime on a stocked spot. The fish is the spot's
    // own; a roll under fishCatchChance lands it, anything else loses it and
    // leaves it there.
    for (let k = 0, found = 0; found < 12 && k < 400; k++) {
      if (!fishSpotStocked(fishSpotId(0, 0, k, 0))) continue;
      found++;
      const fish = spotFish(fishSpotId(0, 0, k, 0));
      for (const t of TIERS) {
        const p = fishCatchChance(fish, t);
        const landed = cast(k, new Set(), {}, t, () => p - 1e-9);
        assert.eq(landed.inv.join(), fish, `tier ${t}: lands the spot's ${fish}`);
        if (p < 1) {
          const fished = new Set();
          const lost = cast(k, fished, {}, t, () => p);
          assert.eq(lost.inv.length, 0, `tier ${t}: the ${fish} got away`);
          assert.truthy(/got away/.test(lost.loot[0]), 'and says so');
          assert.eq(fished.size, 0, 'and it is still there');
        }
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

test('fishing: the Book teaches the landing rule, and the rod says it', () => {
  const tip = PLAY_TIPS.find((t) => /slip the hook/i.test(t));
  assert.truthy(tip, 'the Book has a fishing page');
  assert.truthy(/halves/i.test(tip), 'each tier short halves the odds');
  assert.truthy(/stays/i.test(tip), 'and the fish stays put');
  const blurb = RELIC_DEFS.rod.blurb;
  assert.truthy(/get away/i.test(blurb), 'the rod keeps big fish on the line');
  assert.lte(blurb.length, 55, 'the ✦ row is one line');
});
})();

// --- The empty cast -------------------------------------------------------

test('fishing: an empty cast now and then pays — treasure rod tier / 100, a slime, junk', () => {
  assert.eq(FISH_EMPTY_TREASURE_PER_TIER, 1 / 100, 'a treasure roll of rod tier / 100');
  assert.lt(FISH_SLIME_CHANCE, FISH_EMPTY_JUNK_CHANCE, 'a slime rarer than junk');
  const seq = (...v) => { let i = 0; return () => v[i++]; };
  const t = rollEmptyCast(seq(0, 0.99), 1);
  assert.eq(t.kind, 'treasure');
  assert.eq(t.tier, FOUND_TREASURE_TIER_MAX, 'the tier is random, up to the chest max');
  assert.eq(rollEmptyCast(seq(0, 0.99), 0), null, 'bare hands never find treasure');
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
    const e = rollEmptyCast(rng, 7);
    const k = e ? e.kind : 'none';
    kinds[k] = (kinds[k] || 0) + 1;
    if (e && e.kind === 'treasure') tiers.add(e.tier);
  }
  assert.inRange(kinds.treasure / 20000, 0.055, 0.085, 'about 7 in 100 at tier 7');
  assert.eq(tiers.size, FOUND_TREASURE_TIER_MAX, 'every chest tier comes up');
  assert.gt(kinds.none, kinds.junk, 'nothing is still the commonest empty cast');
  // The handler rolls it on the whiff and pays a treasure through the one lane.
  assert.truthy(/const empty = rollEmptyCast\(Math\.random, tier\);/.test(INTERACT_SRC), 'rolled on the whiff');
  assert.truthy(/grantFoundTreasure\(scene, save, sx, sy, '🎣', empty\.tier, /.test(INTERACT_SRC),
    'the treasure is found treasure, with its fanfare');
});

// --- The hoe's finds ------------------------------------------------------

test('tilling: a furrow turns up flint 1 in 10, a stone 1 in 10, treasure hoe tier / 200', () => {
  assert.eq(TILL_TREASURE_PER_TIER, 1 / 200);
  assert.eq(rollTillFind(() => 0, 0)?.kind === 'treasure', false, 'bare hands never find treasure');
  assert.eq(TILL_FLINT_CHANCE, 1 / 10);
  assert.eq(TILL_ROCK_CHANCE, 1 / 10);
  assert.eq(ITEM_BY_ID.coal.name, 'Flint', "flint is item id 'coal'");
  let r = 7;
  const rng = () => { r = (r * 16807) % 2147483647; return r / 2147483647; };
  const k = {};
  const N = 50000;
  for (let i = 0; i < N; i++) {
    const f = rollTillFind(rng, 7);
    const key = !f ? 'none' : f.kind === 'treasure' ? 'treasure' : f.id;
    k[key] = (k[key] || 0) + 1;
    if (f && f.kind === 'treasure') assert.inRange(f.tier, 1, FOUND_TREASURE_TIER_MAX);
  }
  assert.inRange(k.treasure / N, 0.03, 0.04, 'about 3.5 in 100 at tier 7');
  assert.inRange(k.coal / N, 0.08, 0.12, 'about 1 in 10 flint');
  assert.inRange(k.rockfruit / N, 0.08, 0.12, 'about 1 in 10 stone');
  assert.truthy(/const find = rollTillFind\(Math\.random, save\.relics\?\.hoe\?\.tier \|\| 0\);/.test(INTERACT_SRC), 'rolled when the furrow finishes');
  assert.truthy(/grantFoundTreasure\(scene, save, sx, sy, '⛏', find\.tier, /.test(INTERACT_SRC),
    'buried treasure pays through the found-treasure lane');
  assert.truthy(/scene\.flashJackpot\?\.\(1, headline\)/.test(INTERACT_SRC), 'with the jackpot fanfare');
});
