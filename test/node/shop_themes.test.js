// THEMED SHOPS. A shop (role key 'market') sells one LINE, chosen by its place
// in the save's restore order of shops: seed, supply, potion, ore, relic, pet,
// then round again a tier up (shops.js themeAt / shopOrder). Each visit sells
// one random item from the line at the shop's tier, priced above list, with a
// re-roll that starts at $2 and grows ×1.5 rounded down.

test('themed shops: the lines come in order, then round again a tier up', () => {
  assert.eq(Shops.THEMES.join(), 'seed,supply,potion,ore,relic,pet');
  const want = ['seed', 'supply', 'potion', 'ore', 'relic', 'pet'];
  for (let i = 0; i < 6; i++) {
    assert.eq(Shops.themeAt(i).theme, want[i], 'shop #' + (i + 1));
    assert.eq(Shops.themeAt(i).tier, 1, 'the first round is tier 1');
  }
  assert.eq(Shops.themeAt(6).theme, 'seed', 'the seventh shop starts round two');
  assert.eq(Shops.themeAt(6).tier, 2, 'one tier higher');
  assert.eq(Shops.themeAt(17).tier, 3);
});

test('themed shops: the order is the save\'s restore order of SHOPS — old markets convert in place', () => {
  // A save that restored shops before themes existed: its markets take lines
  // in the order they were rebuilt, blacksmiths / traders / houses skipped.
  const save = { restoredHouses: { b: 'blacksmith', m1: 'market', t: 'trader', h: 'plain', m2: 'market', m3: 'market' } };
  assert.eq(Shops.shopOrder(save, { id: 'm1' }), 0);
  assert.eq(Shops.shopOrder(save, { id: 'm2' }), 1);
  assert.eq(Shops.shopOrder(save, { id: 'm3' }), 2);
  assert.eq(Shops.themeAt(Shops.shopOrder(save, { id: 'm1' })).theme, 'seed', 'the first shop is still the seed shop');
  // A market the record doesn't name still gets a stable first-round line.
  const a = Shops.shopOrder(save, { id: 'legacy_x' });
  assert.eq(Shops.shopOrder(save, { id: 'legacy_x' }), a, 'stable');
  assert.inRange(a, 0, 5, 'within the first round');
});

test('themed shops: stock is the line at the nearest tier it carries (ties lower)', () => {
  for (const t of ['seed', 'supply', 'potion', 'ore', 'pet']) {
    for (let tier = 1; tier <= 8; tier++) {
      const stock = Shops.themedStock(t, tier);
      assert.truthy(stock.length, `${t} T${tier} has stock`);
      for (const id of stock) assert.truthy(ITEM_BY_ID[id], `${id} is a real item`);
    }
  }
  // Potions start at T2: a tier-1 potion shop sells the T2 ones.
  const p1 = Shops.themedStock('potion', 1);
  assert.truthy(p1.includes('vigor_potion'), 'T1 potion shop → the T2 potions');
  assert.falsy(p1.includes('dragon_powder'), 'not the T3 powders');
  // A pet shop stocks every pet across its rounds.
  const pets = new Set();
  for (let tier = 1; tier <= 7; tier++) for (const id of Shops.themedStock('pet', tier)) pets.add(id);
  for (const id of ['chicken', 'cow', 'cat', 'dog', 'deer', 'rabbit', 'crow', 'butterfly']) {
    assert.truthy(pets.has(id), 'the pet shop sells ' + id);
  }
  // The magical flower seeds stay find-only.
  for (let tier = 1; tier <= 7; tier++) {
    for (const id of Shops.themedStock('seed', tier)) assert.truthy(BUY_LIST.includes(id), id + ' is a shop seed');
  }
  assert.eq(Shops.themedStock('relic', 1).length, 0, 'the relic line is gear, rolled by Gear');
});

test('themed shops: the pick is off the caller\'s seeded rng', () => {
  const seq = (v) => () => v;
  const stock = Shops.themedStock('ore', 4);
  assert.eq(Shops.pickThemed('ore', 4, seq(0)), stock[0]);
  assert.eq(Shops.pickThemed('ore', 4, seq(0.9999)), stock[stock.length - 1]);
});

test('themed shops: the re-roll is $2, then ×1.5 rounded down — cheaper than the smith', () => {
  const got = [0, 1, 2, 3, 4, 5, 6].map((n) => ShopsMath.themedRerollCost(n));
  assert.eq(got.join(), '2,3,4,6,9,13,19');
  for (let n = 0; n < 8; n++) {
    assert.truthy(ShopsMath.themedRerollCost(n) < 5 * Math.pow(2, n), 'under the smith at every step');
  }
});

test('themed shops: prices sit above list', () => {
  const save = { relics: {} };
  for (const id of ['torch', 'vigor_potion', 'iron_bar', 'cow', 'potato_seed']) {
    const base = itemValue(id);
    for (const r of [0, 0.5, 0.999]) {
      assert.gte(ShopsMath.buyPrice(save, base, () => r), base, id + ' at or above list');
    }
  }
});

test('themed shops: a relic shop sells up to its tier, never at or below what you wear', () => {
  const save = { relics: {}, armor: {} };
  const o = Gear.buildRelicOffer(save, () => 0.99, { maxTier: 1 });
  assert.eq(o.tier, 1, 'a tier-1 relic shop sells tier 1 to a bare player');
  // Wearing tier 3 everywhere: nothing at or below it, and the cap gives way
  // to the lowest tier still above.
  const worn = { relics: {}, armor: {} };
  for (const s of Object.keys(RELIC_DEFS)) worn.relics[s] = { tier: 3 };
  for (const s of Object.keys(ARMOR_DEFS)) worn.armor[s] = { tier: 3 };
  for (const r of [0, 0.3, 0.7, 0.99]) {
    const p = Gear.buildRelicOffer(worn, () => r, { maxTier: 1 });
    assert.eq(p.tier, 4, 'the lowest tier above what is worn');
  }
});

test('themed shops: the wiring — the tap, the stock, the price and the re-roll', () => {
  const app = APP_JS_SRC;
  assert.truthy(/if \(shopType === 'market'\) \{\s*\n\s*this\.presentThemedShop\(sx, sy, house, recordDeal\);/.test(app),
    'a shop tap opens the themed shop');
  assert.truthy(/return Shops\.themeAt\(Shops\.shopOrder\(this\.save, house\)\);/.test(app), 'one resolver');
  assert.truthy(/const rng = house\?\.id \? this\.shopRng\(house, 'theme'\) : Math\.random;/.test(app),
    'the stock holds for the hour on its own lane');
  assert.truthy(/this\.buildShopOffer\(id, itemValue\(id\), \{ house \}\)/.test(app), 'priced by the shared markup');
  assert.truthy(/\{ cost: ShopsMath\.themedRerollCost, peek: \(\) => this\.themedShopPick\(house\) \}/.test(app),
    'the cheap re-roll moves the item on');
  assert.truthy(/peekOrBuildRelicOffer\(house, \{ maxTier: tier \}\)/.test(app), 'the relic line is capped at its tier');
  assert.falsy(/isFirstMarket/.test(app + RENDER_SRC), 'the old first-market seed shop is folded into the themes');
});
