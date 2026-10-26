// Themes are tested through the same groups and picker consumed by the game.
test('chest themes: commerce can award every gem at its tier above and below ground', () => {
  const gems = ['quartz', 'topaz', 'amethyst', 'sapphire', 'ruby', 'emerald', 'diamond'];
  for (const group of ['gems', 'caveGems']) {
    assert.eq(Object.keys(ChestThemes.members(group)).sort().join(), gems.slice().sort().join());
  }
  for (const depth of [0, 1]) for (const [index, id] of gems.entries()) {
    const tier = index + 1;
    const rng = makeRng32(1927);
    let found = false;
    for (let i = 0; i < 2000; i++) {
      const reward = resolveChestReward('commerce', { tier, bracket: 0, jackpotApplied: 0 }, {}, rng, { tier, depth });
      if (reward.id === id) found = true;
      if (reward.id && gems.includes(reward.id)) assert.lte(ITEM_BY_ID[reward.id].baseTier, tier);
    }
    assert.truthy(found, `${id} reaches commerce at T${tier}, depth ${depth}`);
  }
});

test('chest themes: T2 mushroom rewards are stacks and fish prices limit quantities', () => {
  assert.eq(itemValue('mushroom'), 5);
  assert.eq(ChestThemes.quantity('mushroom', 1, 1), 2, 'T2 budget branch buys two mushrooms');
  assert.eq(ChestThemes.quantity('mushroom', 2), 5);
  const rng = makeRng32(1927);
  let mushrooms = 0;
  for (let i = 0; i < 10000; i++) {
    const reward = pickReward('chest:food', {}, rng, { tier: 2 });
    if (reward.id !== 'mushroom') continue;
    mushrooms++;
    assert.gte(reward.qty, 2, 'actual T2 mushroom rewards exceed one');
  }
  assert.gt(mushrooms, 0);
  assert.eq(ChestThemes.quantity('minnow', 1, 1), 3, 'budget branch no longer buys four minnows');
  assert.eq(ChestThemes.quantity('trout', 4), 3, 'same-tier trout stack below the five-food cap');
  assert.eq(ChestThemes.quantity('salmon', 5), 3);
});

test('chest themes: T2 food keeps its chest allowance on a lower-quality roll', () => {
  const opts = { tier: 2 };
  const rng = makeRng32(1927);
  const seen = new Set();
  for (let i = 0; i < 10000; i++) {
    const r = resolveChestReward('food', { tier: 1, bracket: 1, jackpotApplied: 0 }, {}, rng, opts);
    if (['potato', 'cress', 'grilled_minnow', 'baked_potato', 'grilled_mushroom'].includes(r.id)) {
      seen.add(r.id);
      assert.gte(r.qty, 3, r.id + ' uses the T2 allowance');
    }
  }
  assert.eq(seen.size, 5, 'all affected starter foods remain selectable');
  assert.eq(ChestThemes.quantity('potato', 1, 1, 2), 4);
  assert.eq(ChestThemes.quantity('grilled_mushroom', 1, 1, 2), 3);
  assert.eq(ChestThemes.quantity('bass', 2, 0, 2), 1, 'expensive foods are not guaranteed multiples');
  assert.eq(ChestThemes.quantity('potato', 1, 1), 1, 'non-chest rolls retain their budget');
  assert.eq(ChestThemes.quantity('rope', 1, 1, 2), 1, 'the floor is for food');
  assert.eq(ChestThemes.quantity('potato', 3, 1, 2), ChestThemes.quantity('potato', 3, 1), 'jackpots keep their larger budget');
});

test('chest themes: supply rewards reach T4 tools and the T6 Evertorch', () => {
  for (const [id, tier] of [['javelin', 4], ['renovation_permit', 4], ['evertorch', 6]]) {
    const rng = makeRng32(1927);
    let seen = false;
    for (let i = 0; i < 2000; i++) {
      const r = resolveChestReward('roadside', { tier, bracket: 0, jackpotApplied: 1 }, {}, rng, { tier: 4 });
      if (r.id === id) seen = true;
    }
    assert.truthy(seen, id + ' is reachable through a roadside roll');
    assert.falsy(ChestThemes.eligible('supplies', tier - 1).includes(id), id + ' respects its tier');
  }
  assert.eq(itemValue('blank_scroll'), 50);
  assert.eq(itemValue('rainberry'), 18);
  assert.eq(itemValue('pairy'), 24);
  assert.eq(itemValue('worldpeach'), 250);
});

test('chest themes: T2 acorns fill the budget with a stack while fruit saplings stay single', () => {
  assert.eq(itemValue('acorn'), 5);
  assert.eq(itemValue('scarecrow'), 20);
  // T2's 24-coin budget at the seed share buys 3.84 acorns: round up to four.
  // A bracket raises the budget into the five-tree stack cap.
  assert.eq(ChestThemes.quantity('acorn', 2, 0), 4, 'T2 pays a planting stack');
  for (const bracket of [1, 2, 3]) {
    assert.eq(ChestThemes.quantity('acorn', 2, bracket), 5, 'brackets fill the planting stack');
  }
  assert.eq(ChestThemes.quantity('acorn', 7, 3), 5, 'ordinary stack cap still applies');
  for (const id of ['apple_sapling', 'worldpeach_sapling']) assert.eq(ChestThemes.quantity(id, 7, 3), 1);
});

test('chest themes: every authored path terminates and conserves probability', () => {
  assert.truthy(ChestThemes.validate());
  // Memorials mint no chest, and the unused pets theme is gone because
  // OpenMapTiles represents pet stores as shop/pet commerce POIs. `boss` is
  // a slain boss's hoard (scene_boss.js), never a POI's.
  assert.eq(Object.keys(ChestThemes.themes).length, 14);
  assert.falsy(ChestThemes.themes.memorial, 'no memorial theme');
  for (const theme of Object.keys(ChestThemes.themes)) for (let tier = 1; tier <= 7; tier++) {
    for (const depth of [0, 1]) {
      const opts = { theme, depth, chestTier: Math.min(5, tier) };
      const weights = ChestThemes.weights(theme, tier, opts);
      assert.inRange(Object.values(weights).reduce((a, b) => a + b, 0), 99.999, 100.001);
      for (const group of Object.keys(weights)) {
        const r = ChestThemes.resolve(group, tier, opts);
        if (r.kind !== 'item') continue;
        assert.gt(r.ids.length, 0, `${theme}/${tier}/${group} resolves`);
        for (const id of ChestThemes.selectableIds(r)) {
          const item = ITEM_BY_ID[id];
          assert.truthy(item && !item.shiny);
          assert.falsy(isTome(id), `${theme}/${tier}/${depth}/${group} keeps tomes for the scholar`);
          if (item.cooked) assert.eq(r.group, 'food', 'cooked meals stay in the food pool');
          assert.truthy(!item.caveOnly || depth > 0);
          assert.truthy(item.baseTier <= tier, 'the Book is a T1 item; every group member is tier-gated');
        }
      }
    }
  }
});

test('chest themes: cooked meals, spears and minerals are reachable at their quality tier', () => {
  const expected = [
    ...ITEMS.filter(item => item.cooked).map(item => ['food', 'food', item.id]),
    ['roadside', 'supplies', 'throwing_spear'], ['authority', 'supplies', 'throwing_spear'],
    ['roadside', 'materials', 'flint_shard'],
    ...Object.values(MINERAL_TIERS).map(row => ['roadside', 'materials', row.barId]),
  ];
  for (const [theme, group, id] of expected) {
    const tier = ITEM_BY_ID[id].baseTier;
    const opts = { theme, chestTier: Math.min(5, tier) };
    const pool = ChestThemes.resolve(group, tier, opts);
    assert.includes(ChestThemes.selectableIds(pool), id, id + ' can actually be selected');
    if (tier > 1) assert.falsy(ChestThemes.eligible(group, tier - 1, opts).includes(id), id + ' respects its tier');
    const rng = makeRng32(1927);
    let found = false;
    for (let i = 0; i < 2000 && !found; i++) {
      const reward = resolveChestReward(theme, { tier, bracket: 0, jackpotApplied: 0 }, {}, rng, { tier: opts.chestTier });
      found = reward.kind === 'item' && reward.id === id;
    }
    assert.truthy(found, id + ' reaches the chest reward');
  }
  for (let tier = 2; tier <= 7; tier++) {
    const pool = ChestThemes.resolve('materials', tier, { theme: 'roadside' });
    assert.eq(ChestThemes.selectableIds(pool).join(','), MINERAL_TIERS[tier].barId, 'materials advance beyond basic debris');
  }
});

// Authored shares less the equipment lane (ChestThemes.CHEST_GEAR), which
// also follows the chest tier: 7 points at T1, 28 from T4.
const nearShare = (got, want, msg) => assert.inRange(got, want - 1e-9, want + 1e-9, msg);
test('chest themes: high-tier weights use the chest tier, not jackpot quality', () => {
  nearShare(ChestThemes.weights('roadside', 7, { tier: 1 }).supplies, 40.5 * 83 / 90);
  nearShare(ChestThemes.weights('roadside', 1, { tier: 4 }).supplies, 40.5 * 62 / 90);
  nearShare(ChestThemes.weights('flora', 4, { tier: 4 }).flowerSeeds, 36);
  nearShare(ChestThemes.weights('flora', 7, { tier: 4 }).flowerSeeds, 36);
  nearShare(ChestThemes.weights('food', 4, { tier: 1 }).food, 93,
    'a starter jackpot keeps the food chest identity');
});

test('chest themes: cave mixture adds medicine and retains the location share', () => {
  for (let tier = 1; tier <= 7; tier++) {
    const w = ChestThemes.weights('school', tier, { depth: 1 });
    const rest = (100 - Math.min(28, 7 * tier)) / 100;   // less the equipment lane
    nearShare(w.books, 36 * rest, '60% of the surface book share');
    if (tier === 1) nearShare(w.antidote, 24 * rest);
    else nearShare(w.caveMagic, (tier === 2 ? 24 : 32) * rest);
  }
  for (const tier of [6, 7]) {
    const r = ChestThemes.resolve('caveMagic', tier, { depth: 1 });
    const topTier = Math.max(...r.ids.map(id => ITEM_BY_ID[id].baseTier));
    const rng = makeRng32(101);
    let powders = 0, topItems = 0;
    for (let i = 0; i < 5000; i++) {
      const id = ChestThemes.pickItem(r, tier, rng);
      assert.lte(ITEM_BY_ID[id].baseTier, tier, 'no medicine above the rolled tier');
      if (id.endsWith('_powder')) powders++;
      if (ITEM_BY_ID[id].baseTier === topTier) topItems++;
    }
    assert.inRange(topItems / 5000, 0.67, 0.73);
    assert.gt(powders, 150, 'deep magic retains useful lower-tier powders');
  }
});

test('chest themes: health stays in its medical-magic lane', () => {
  for (let tier = 1; tier <= 7; tier++) {
    const opts = { theme: 'health' };
    const recovery = ChestThemes.resolve('recovery', tier, opts);
    const ids = ChestThemes.selectableIds(recovery);
    if (tier < 2) assert.eq(recovery.group, 'restorative');
    else assert.eq(ids.join(','), tier >= 7 ? 'elixir' : 'healing_potion');
    const revival = ChestThemes.resolve('revival', tier, opts);
    if (tier < 3) assert.eq(revival.group, 'restorative');
    else assert.eq(ChestThemes.selectableIds(revival).join(','), tier >= 5 ? 'resurrection_potion' : 'revival_potion');
    // (A T2 chest lends a fifth of its row to the Book — ChestThemes.BOOK_T2_SHARE.)
    // ... and the equipment lane its CHEST_GEAR share.
    nearShare(ChestThemes.weights('health', tier).medicalMagic,
      100 - Math.min(28, 7 * tier) - (tier === 2 ? ChestThemes.BOOK_T2_SHARE : 0));
    const resolved = ChestThemes.resolve('medicalMagic', tier, opts);
    assert.eq(resolved.group, tier === 1 ? 'antidote' : 'medicalMagic');
    for (const id of ChestThemes.selectableIds(resolved)) {
      assert.truthy(['magic', 'unique_relic'].includes(ITEM_BY_ID[id].kind),
        id + ' is restorative magic or a selected healing relic');
    }
  }
});

test('chest themes: quantities use actual item price once and discard excess allowance', () => {
  assert.eq(ChestThemes.quantity('healing_potion', 4, 0), 3);
  assert.eq(ChestThemes.quantity('revival_potion', 4, 0), 3);
  assert.eq(ChestThemes.quantity('healing_potion', 5, 0), 6);
  for (const id of ['elixir', 'resurrection_potion', 'book', 'sunflower_seed', 'fireflower_seed', 'iceflower_seed']) {
    assert.eq(ChestThemes.quantity(id, 7, 3), 1, id + ' is a single reward');
  }
  assert.eq(ChestThemes.quantity('antidote', 4, 0), 6, 'cheap magic fills a single stack');
  assert.eq(ChestThemes.quantity('wood', 7, 3), 12, 'material stacks retain their cap');
});

test('chest themes: unrelated gear and items never leak across themes', () => {
  const rng = makeRng32(400);
  for (const theme of Object.keys(ChestThemes.themes)) for (const tier of [1, 2, 3, 4, 5]) {
    for (const depth of [0, 1]) for (let i = 0; i < 100; i++) {
      const r = pickChestReward(theme, { relics: {}, armor: {} }, rng, { tier, depth });
      assert.truthy(r);
      assert.eq(r.consolation, 0, 'capped quantity never grants cash');
      if (r.kind === 'item') {
        assert.eq(r.cls, ITEM_BY_ID[r.id].kind);
        assert.lte(r.qty, ['wood', 'rubble'].includes(r.id) ? 12 : ChestThemes.cap(r.id));
      }
      if (r.kind === 'relic' || r.kind === 'armor') {
        assert.truthy(r.slot !== 'ring');
        // The equipment lane (ChestThemes.CHEST_GEAR) may hand any slot at any tier.
        if (r.resolvedGroup === 'bonusGear') continue;
        assert.gt(tier, 1);
        if (r.resolvedGroup === 'supplies') {
          assert.eq(tier, 2);
          assert.eq(r.kind, 'relic');
          assert.eq(r.tier, 1);
          assert.includes(['dagger', 'lance', 'musket'], r.slot);
        } else if (theme === 'authority') assert.eq(r.kind, 'armor');
        if (['school', 'civic'].includes(theme)) assert.includes(
          r.resolvedGroup === 'supplies' ? ['dagger', 'lance', 'musket'] : ['bag', 'watering_can', 'hoe', 'fishing_rod', 'net'], r.slot);
      }
    }
  }
});

test('chest themes: gear starts a tier low and rerolls an exact duplicate once before coins', () => {
  const slots = ChestThemes.gearSlots('bonusGear');
  const wearing = tier => ({
    relics: Object.fromEntries(slots.filter(s => s.kind === 'relic').map(s => [s.slot, { tier }])),
    armor: Object.fromEntries(slots.filter(s => s.kind === 'armor').map(s => [s.slot, { tier }])),
    inv: Gear.uniqueRelics().map(it => ({ id: it.id, count: 1 })),
  });
  const gearRolls = (save, quality, chestTier, seed) => {
    const rng = makeRng32(seed);
    const out = [];
    for (let i = 0; i < 6000; i++) {
      const r = resolveChestReward('culture', { tier: quality, bracket: 0, jackpotApplied: 0 }, save, rng, { tier: chestTier });
      if (['culturalGear', 'bonusGear'].includes(r.resolvedGroup) && (r.kind !== 'gold' || r.slot)) out.push(r);
    }
    return out;
  };
  // Nothing worn: a T3 roll offers T2 gear. A material-tier weapon (1, 3, 5)
  // has no T2 rung and would fall under the chest floor, so it keeps T3.
  const materialTiers = slot => RELIC_DEFS[slot]?.tiers;
  const fresh = gearRolls({ relics: {}, armor: {} }, 3, 3, 31).filter(r => r.kind === 'relic' || r.kind === 'armor');
  assert.gt(fresh.length, 500);
  for (const r of fresh) {
    if (r.kind === 'relic' && materialTiers(r.slot)) assert.eq(r.tier, 3, r.slot + ' keeps the chest floor');
    else assert.lte(r.tier, 2, 'the first roll starts one tier under the chest');
  }
  assert.gt(fresh.filter(r => r.tier === 2).length / fresh.length, 0.8);
  // Everything worn at T2: the T2 duplicate rerolls at the full T3, so
  // upgrades still arrive; without the reroll every one of these would be coins.
  const worn = gearRolls(wearing(2), 3, 3, 32);
  const upgrades = worn.filter(r => r.kind !== 'gold');
  for (const r of upgrades) assert.eq(r.tier, 3, 'the reroll drops the penalty');
  assert.inRange(upgrades.length / worn.length, 0.4, 0.85, 'the reroll upgrades most exact duplicates');
  // A second exact duplicate pays the usual half-price coins.
  const twice = gearRolls(wearing(1), 1, 2, 33);
  assert.gt(twice.length, 500);
  for (const r of twice) {
    assert.eq(r.kind, 'gold');
    assert.eq(r.amount, Math.max(1, Math.floor(gearPrice(r.gearKind, r.slot, r.tier) / 2)));
  }
});

test('chest themes: alternate weapons use only their three material tiers', () => {
  const rng = makeRng32(1872);
  for (const slot of ['dagger', 'lance', 'musket']) {
    assert.truthy(ChestThemes.gearSlots('culturalGear').some(row => row.slot === slot));
    const found = new Set();
    for (let chestTier = 2; chestTier <= 5; chestTier++) for (let i = 0; i < 200; i++) {
      const r = rollGearUpgrade(rng, {}, chestTier, {}, [{ kind: 'relic', slot }]);
      assert.eq(r.kind, 'relic');
      assert.includes([1, 3, 5], r.tier);
      found.add(r.tier);
    }
    assert.eq(found.size, 3, slot + ' can drop at every material tier');
    const top = reconcileRelicOffer({ slot, tier: 2 }, { relics: { [slot]: { tier: 3 } } }, () => 0.99);
    assert.eq(top.tier, 5, 'duplicate walk-up stops at Magic');
    const owned = reconcileRelicOffer({ slot, tier: 7 }, { relics: { [slot]: { tier: 5 } } }, () => 0.99);
    assert.eq(owned.kind, 'gold', 'Magic cannot upgrade beyond its final tier');
  }
});

test('chest themes: T2 supplies introduce Rusty weapons only in empty slots', () => {
  const slots = ['dagger', 'lance', 'musket'];
  const rng = makeRng32(497);
  const found = new Set();
  for (const tier of [1, 2, 3]) for (let i = 0; i < 1500; i++) {
    const r = resolveChestReward('roadside', { tier: 7, bracket: 0, jackpotApplied: 0 }, {}, rng, { tier });
    if (r.kind !== 'relic' || r.group === 'bonusGear') continue;
    assert.eq(tier, 2, 'starter weapons require displayed T2 even with jackpot quality');
    assert.eq(r.tier, 1);
    assert.includes(slots, r.slot);
    found.add(r.slot);
  }
  assert.eq(found.size, 3);
  for (const ownedTier of [1, 3, 5]) {
    const save = { relics: Object.fromEntries(slots.map(slot => [slot, { tier: ownedTier }])) };
    for (let i = 0; i < 500; i++) {
      const r = resolveChestReward('roadside', { tier: 2, bracket: 0, jackpotApplied: 0 }, save, rng, { tier: 2 });
      if (r.group === 'bonusGear') continue;
      assert.truthy(r.kind !== 'relic', 'supply rolls do not duplicate or downgrade held weapons');
    }
  }
});

test('chest themes: school-only Book exception and named venue preference', () => {
  assert.eq(ChestThemes.resolve('books', 1, { theme: 'school' }).group, 'books');
  // The Book became a T1 item (with the tomes), so a low culture roll
  // pays a Book where it used to fall through to a torch.
  assert.eq(ChestThemes.resolve('books', 1, { theme: 'culture' }).group, 'books');
  const opts = { theme: 'food', venueProduct: 'potato' };
  const pool = ChestThemes.resolve('food', 5, opts);
  const rng = makeRng32(222);
  let potatoes = 0;
  for (let i = 0; i < 5000; i++) if (ChestThemes.pickItem(pool, 5, rng, opts) === 'potato') potatoes++;
  assert.inRange(potatoes / 5000, 0.67, 0.73);
  assert.eq(ChestThemes.resolve('foodSeeds', 3, { theme: 'food', venueProduct: 'milk' }).group, 'food');
});

test('chest themes: high-tier rolls keep quality and one reward through quantity-heavy chains', () => {
  for (const theme of Object.keys(ChestThemes.themes)) for (const tier of [3, 4, 5]) {
    const rng = makeRng32(707 + tier);
    for (let i = 0; i < 250; i++) {
      const reward = pickChestReward(theme, { relics: {}, armor: {} }, rng, { tier });
      assert.gte(reward.rolledTier, tier);
      assert.eq(reward.consolation, 0);
      if (reward.slot) assert.gte(reward.tier, tier - 1, 'equipment has its own floor');
      if (reward.kind === 'item') {
        assert.truthy(typeof reward.id === 'string');
        assert.gte(reward.qty, 1);
        assert.lte(reward.qty, ChestThemes.cap(reward.id));
        if (theme === 'roadside' && reward.group === 'materials') assert.gte(ITEM_BY_ID[reward.id].baseTier, tier);
        if (theme === 'health') assert.truthy(['magic', 'unique_relic'].includes(ITEM_BY_ID[reward.id].kind));
        if (theme === 'flora' && tier >= 4 && ['flowers', 'flowerSeeds'].includes(reward.group))
          assert.gte(ITEM_BY_ID[reward.id].baseTier, 4);
      }
    }
  }
});

test('chest themes: a high-tier venue does not force starter food', () => {
  const rng = makeRng32(909);
  for (let i = 0; i < 1000; i++) {
    const reward = pickChestReward('food', {}, rng, { tier: 4, venueProduct: 'potato' });
    if (reward.group === 'food') assert.gte(ITEM_BY_ID[reward.id].baseTier, 4);
  }
});

test('chest themes: commerce holds its identity underground - coins, gems and furniture', () => {
  const w = ChestThemes.weights('commerce', 5, { depth: 1 });
  assert.eq(Object.keys(w).sort().join(), ['bonusGear', 'cash', 'caveGems', 'furniture', 'gems'].sort().join(),
    'no field supplies, no magic pools, no traps at depth');
});


test('chest themes: all authored pools exclude tomes and retain other unique relics', () => {
  for (const group of Object.keys(ChestThemes.groups)) {
    for (let tier = 1; tier <= 7; tier++) for (const depth of [0, 1]) {
      const ids = ChestThemes.eligible(group, tier, { theme: 'culture', depth, chestTier: tier });
      for (const id of ids) assert.falsy(isTome(id), `${group}/${tier}/${depth}: ${id}`);
    }
  }
  const relics = ChestThemes.eligible('uniqueRelics', 7);
  for (const item of ITEMS.filter(item => item.kind === 'unique_relic' && !isTome(item.id) && !item.progressionOnly)) {
    assert.includes(relics, item.id, item.id + ' remains treasure');
  }
  for (const kind of Object.values(ITEMS_BY_CLASS_TIER)) for (const ids of Object.values(kind)) {
    for (const id of ids) assert.falsy(isTome(id), id + ' cannot enter generic treasure or barrel loot');
  }
});

test('reward rolls: a stack is the roll budget over the price, and a qty jackpot only raises the budget', () => {
  assert.eq(ChestThemes.budget(2, 0), TIER_VALUE[2]);
  assert.eq(ChestThemes.budget(2, 2), TIER_VALUE[2] * 2, 'each bracket adds half the tier budget');
  // A same-tier roll with no brackets: about two potions, about four seeds.
  assert.eq(ChestThemes.quantity('reach_potion', 4, 0), 2);
  assert.eq(ChestThemes.quantity('starfruit_seed', 3, 0), 4);
  // Brackets are budget, not a capped counter: quantity steps past three
  // still grow the budget instead of turning into consolation coins.
  const q = rollRewardQuality({ chainSteps: 6, chainMax: 1, maxTier: 1 }, 'seed', { relics: {}, armor: {} }, () => 0);
  assert.gt(q.bracket, 3);
  assert.eq(q.wastedQtyBumps, 0);
  // Every reward context sizes its stacks through the one budget function;
  // no context adds dice or a flat bonus on top.
  const original = ChestThemes.quantity;
  let last = null;
  ChestThemes.quantity = (...args) => (last = original(...args));
  try {
    const rng = makeRng32(77);
    for (const ctx of ['treasure:default', 'treasure:elite', 'treasure:road', 'treasure:vista', 'treasure:shrine', 'chest:farm']) {
      for (let i = 0; i < 300; i++) {
        last = null;
        const r = pickReward(ctx, { relics: {}, armor: {} }, rng, { tier: 3, rollBonus: i % 4 });
        if (r?.kind !== 'item' || r.cls === 'bundle' || r.cls === 'unique_relic') continue;
        assert.eq(r.qty, last, `${ctx} ${r.id} uses the budget quantity`);
      }
    }
  } finally { ChestThemes.quantity = original; }
  assert.falsy(/LOW_TIER_SEED_QTY_BONUS/.test(INTERACT_SRC.slice(INTERACT_SRC.indexOf('function grantTreasureRoll('))),
    'a treasure roll adds no seed bonus to the budgeted stack');
});


test('chest themes: materials spend the same price-based budget at every tier', () => {
  for (const id of ['wood', 'rubble']) {
    const price = Math.max(1, PRICES[id] || itemValue(id));
    for (let tier = 1; tier <= 7; tier++) for (const bracket of [0, 1, 3]) {
      const expected = Math.min(12, Math.max(1, Math.floor(ChestThemes.budget(tier, bracket) / price)));
      assert.eq(ChestThemes.quantity(id, tier, bracket), expected, `${id} T${tier} bracket ${bracket}`);
      assert.eq(ChestThemes.quantityForBudget(id, ChestThemes.budget(tier, bracket)), expected,
        'explicit container budgets and tier budgets agree');
    }
    assert.eq(ChestThemes.quantityForBudget(id, 0), 1, 'minimum one item');
    assert.eq(ChestThemes.quantityForBudget(id, price * 5), 5, 'five units of price buy five items');
    assert.eq(ChestThemes.quantityForBudget(id, price * 100), 12, 'surplus budget respects stack cap');
  }
});


test('chest themes: furniture keeps a ten percent lane through tier and cave overlays', () => {
  const catalog = ITEMS.filter(item => item.kind === 'furniture').map(item => item.id).sort();
  assert.eq(Object.keys(ChestThemes.members('furniture')).sort().join(), catalog.join());
  for (const theme of ['culture', 'commerce', 'roadside']) {
    assert.eq(ChestThemes.themes[theme].weights.furniture, 10);
    assert.eq(ChestThemes.highTierWeights[theme].furniture, 10);
    for (let tier = 1; tier <= 7; tier++) for (const depth of [0, 1]) {
      const weights = ChestThemes.weights(theme, tier, { tier, depth });
      assert.eq(weights.furniture, 10, `${theme}/${tier}/${depth}`);
      assert.inRange(Object.values(weights).reduce((a, b) => a + b, 0), 99.999999, 100.000001);
      const pool = ChestThemes.resolve('furniture', tier, { theme, depth, chestTier: tier });
      assert.eq(pool.group, 'furniture', 'every rung terminates in a furnishing');
      assert.gt(pool.ids.length, 0);
      for (const id of pool.ids) {
        assert.eq(ITEM_BY_ID[id].kind, 'furniture');
        assert.lte(ITEM_BY_ID[id].baseTier, tier);
        assert.eq(ChestThemes.cap(id), 1);
        assert.eq(ChestThemes.quantity(id, tier, 100), 1, 'a jackpot never duplicates the furnishing');
      }
    }
  }
  assert.eq(LOOT_CONTEXTS['treasure:default'].classBias.furniture, LOOT_CONTEXTS['treasure:default'].classBias.supply);
});

test('chest themes: boss and vista paths never award furniture', () => {
  for (const theme of ['boss', 'vista']) for (let tier = 1; tier <= 7; tier++) for (const depth of [0, 1]) {
    const opts = { theme, tier, depth, chestTier: tier };
    const weights = ChestThemes.weights(theme, tier, opts);
    assert.falsy(weights.furniture);
    for (const group of Object.keys(weights)) {
      const pool = ChestThemes.resolve(group, tier, opts);
      for (const id of pool.ids || []) assert.falsy(ITEM_BY_ID[id].kind === 'furniture');
    }
  }
  assert.falsy(LOOT_CONTEXTS['treasure:vista'].classBias.furniture);
});

test('chest themes: furniture rolls remain ordinary one-item rewards', () => {
  const rng = makeRng32(714);
  for (const theme of ['culture', 'commerce', 'roadside']) {
    let found = 0;
    for (let i = 0; i < 300; i++) {
      const reward = resolveChestReward(theme, { tier: 3, bracket: 10 }, {}, rng, { tier: 3 });
      if (reward.group !== 'furniture') continue;
      assert.eq(reward.kind, 'item'); assert.eq(reward.qty, 1);
      assert.eq(ITEM_BY_ID[reward.id].kind, 'furniture'); found++;
    }
    assert.gt(found, 0, theme + ' reaches the lane');
  }
  let found = 0;
  for (let i = 0; i < 500; i++) {
    const reward = pickReward('treasure:default', {}, rng);
    if (reward.kind === 'item' && ITEM_BY_ID[reward.id].kind === 'furniture') {
      assert.eq(reward.qty, 1); found++;
    }
  }
  assert.gt(found, 0, 'ordinary buried treasure reaches furniture');
});
