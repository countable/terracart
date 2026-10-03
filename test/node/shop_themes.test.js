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
  // The FIRST Supply Shop (T1) sells the cave staples — and the spear with
  // them (owner, Oct 2026: a T1 supply like the torch); rope and the disarm
  // kit wait for the T2 round.
  const s1 = Shops.themedStock('supply', 1);
  for (const id of ['wood', 'rubble', 'torch', 'throwing_spear']) assert.truthy(s1.includes(id), `T1 supply shop stocks ${id}`);
  assert.falsy(s1.includes('rope'), 'rope is the T2 round');
  assert.truthy(Shops.themedStock('supply', 2).includes('rope'));
  for (const [tier, id] of [[2, 'wood_shield'], [4, 'metal_shield'], [5, 'field_scope'], [6, 'gold_shield'], [7, 'orb']]) {
    assert.falsy(Shops.themedStock('supply', tier).includes(id), `${id} is reward-only`);
  }
  // Antidote fills the T1 Magic shop; other medicines follow at their tiers.
  const p1 = Shops.themedStock('potion', 1);
  assert.truthy(p1.includes('antidote'), 'T1 magic shop stocks the cure');
  assert.falsy(p1.includes('dragon_powder'), 'not the T4 dragon powder');
  assert.falsy(Shops.themedStock('potion', 6).includes('elixir'), 'Elixir waits for T7');
  assert.truthy(Shops.themedStock('potion', 7).includes('elixir'), 'T7 magic shop stocks Elixir');
  assert.falsy(Shops.THEME_POOL.potion().includes('orb'), 'Orb is reward-only');
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
    assert.truthy(ShopsMath.themedRerollCost(n) < ShopsMath.smithyRerollCost(n), 'under the smith at every step');
  }
});

test('smithy: the re-roll is $5, then ×1.5 rounded down, and the forge offer uses it', () => {
  const got = [0, 1, 2, 3, 4, 5, 6].map((n) => ShopsMath.smithyRerollCost(n));
  assert.eq(got.join(), '5,7,10,15,22,33,49');
  assert.truthy(/next => this\.presentBlacksmithOffer\(sx, sy, next, recordDeal, house\),\s*\{ cost: ShopsMath\.smithyRerollCost, current: offer \}\);/.test(SCENE_SRC),
    'presentBlacksmithOffer passes the smithy curve');
});

test('themed shops: prices sit above list', () => {
  const save = { relics: {} };
  for (const id of ['torch', 'healing_potion', 'iron_bar', 'cow', 'potato_seed']) {
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
  const app = SCENE_SRC;
  assert.truthy(/if \(shopType === 'market'\) \{\s*\n\s*this\.presentThemedShop\(sx, sy, house, recordDeal\);/.test(app),
    'a shop tap opens the themed shop');
  assert.truthy(/return Shops\.lineFor\(this\.save, house\);/.test(app), 'one resolver (lineFor — the bookshop override, then the cycle)');
  assert.truthy(/const rng = house\?\.id \? this\.shopRng\(house, 'theme'\) : Math\.random;/.test(app),
    'the stock holds for the hour on its own lane');
  assert.truthy(/this\.buildShopOffer\(id, ShopsMath\.listPrice\(this\.save, id, itemValue\(id\)\), \{ house \}\)/.test(app),
    'priced by the shared markup off the list price (only the Book climbs)');
  assert.truthy(/\{ cost: ShopsMath\.themedRerollCost, peek: \(\) => this\.themedShopPick\(house\), current: id \}/.test(app),
    'the cheap re-roll moves the item on');
  assert.truthy(/peekOrBuildRelicOffer\(house, \{ maxTier: tier \}\)/.test(app), 'the relic line is capped at its tier');
  assert.falsy(/isFirstMarket/.test(app + RENDER_SRC), 'the old first-market seed shop is folded into the themes');
});

test('themed shops: no re-roll where the tier stocks one item', () => {
  // The ore line is one bar a tier — a re-roll would sell the same bar again.
  const single = [];
  for (const t of ['seed', 'supply', 'potion', 'ore', 'pet']) {
    for (let tier = 1; tier <= 8; tier++) if (Shops.themedStock(t, tier).length === 1) single.push(`${t} T${tier}`);
  }
  assert.truthy(single.some(k => k.startsWith('ore')), `some ore tier is a single item: ${single.join(', ')}`);
  const app = SCENE_SRC;
  assert.truthy(/secondary: this\._themedStockCount\(house\) > 1\s*\?\s*this\._makeRerollSecondary/.test(app),
    'the themed item offers its re-roll only when the stock has another item');
  assert.truthy(/_themedStockCount\(house\) \{[\s\S]{0,200}?Shops\.themedStock\(theme, tier\)\.length/.test(app),
    'counted off the same stock the pick draws from');
});


test('themed shops: three market digits and one blacksmith digit on small houses', () => {
  const roles = Array.from({ length: 10 }, (_, address) => Shops.shopType({ kind: 'house', tier: WorldGen.T.BUILDING, address }));
  assert.eq(roles.map((r, i) => r === 'market' ? i : null).filter(x => x !== null).join(), '2,4,6');
  assert.eq(roles.map((r, i) => r === 'blacksmith' ? i : null).filter(x => x !== null).join(), '9');
  assert.eq(Shops.shopType({ kind: 'house', tier: WorldGen.T.BUILDING_MED, address: 24 }), null, 'forts do not become markets');
  assert.eq(Houses.houseShopRole({ restoredHouses: { old: 'plain' } }, { kind: 'house', id: 'old', tier: WorldGen.T.BUILDING, address: 24 }), null, 'existing frozen roles stay put');
});

test('themed shops: Potion of Taming and magic traps fill tier 3 supplies; dragon powder stays tier 4 Magic', () => {
  assert.eq(Shops.themedStock('supply', 3).slice().sort().join(), 'magic_trap,taming_potion');
  assert.eq(Shops.themedStock('supply', 4).slice().sort().join(), 'javelin', 'T4 has its own supply stock');
  for (const id of ['taming_potion', 'magic_trap']) {
    assert.eq(ITEM_BY_ID[id].baseTier, 3);
    assert.eq(ITEM_BY_ID[id].kind, 'supply');
    assert.falsy(Shops.themedStock('supply', 2).includes(id), 'no early supply stock');
  }
  assert.eq(ITEM_BY_ID.dragon_powder.baseTier, 4);
  assert.eq(ITEM_BY_ID.dragon_powder.kind, 'magic');
  assert.truthy(Shops.themedStock('potion', 4).includes('dragon_powder'));
  assert.falsy(Shops.themedStock('potion', 3).includes('dragon_powder'));
  assert.falsy(Shops.THEME_POOL.supply().includes('dragon_powder'));
});
