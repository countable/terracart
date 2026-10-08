// Ranks (shops.js storedTier / smithTier / traderTier / shopTier, owner Oct
// 2026): the rank is the player's pick, stamped in save.shopTiers; houses
// from before ranks were stored keep the derivations that raised them (the
// Nth smithy was tier N, a trader took the ladder's rank at its restore
// number); the barter leans to the trader's rank.
(function () {
const h = (id) => ({ kind: 'house', tier: 9, id });

test('shop tiers: the stamped rank wins; a legacy smithy is the Nth in ledger order', () => {
  const save = { restoredHouses: { a: 'plain', s1: 'blacksmith', b: 'market', s2: 'blacksmith', s3: 'blacksmith' } };
  assert.eq(Shops.smithTier(save, h('s1')), 1);
  assert.eq(Shops.smithTier(save, h('s2')), 2);
  assert.eq(Shops.smithTier(save, h('s3')), 3);
  assert.eq(Shops.smithTier(save, h('zz')), 1, 'a smith off the ledger (the stamped starter) is tier 1');
  assert.eq(Shops.shopTier(save, h('s2'), 'blacksmith'), 2);
  save.shopTiers = { s2: 1, s3: 1 };
  assert.eq(Shops.smithTier(save, h('s2')), 1, 'stamped T1: two T1 smithies stand');
  assert.eq(Shops.smithTier(save, h('s3')), 1);
  assert.eq(Shops.roleTierCount(save, 'blacksmith', 1), 3); assert.eq(Shops.roleTierCount(save, 'blacksmith', 2), 0);
});

test('shop tiers: a legacy trader takes the rank of the restore number that raised it; a stamped one its stamp', () => {
  assert.eq(Shops.traderTierAt(5), 1); assert.eq(Shops.traderTierAt(9), 1);
  assert.eq(Shops.traderTierAt(10), 2); assert.eq(Shops.traderTierAt(34), 6); assert.eq(Shops.traderTierAt(99), 7, 'capped at the top rank');
  const save = { restoredHouses: {} };
  for (let i = 0; i < 12; i++) save.restoredHouses['r' + i] = i === 4 || i === 9 || i === 11 ? 'trader' : 'plain';
  assert.eq(Shops.traderTier(save, h('r4')), 1, 'the fifth rebuild');
  assert.eq(Shops.traderTier(save, h('r9')), 2, 'the tenth');
  assert.eq(Shops.traderTier(save, h('r11')), 2, 'the twelfth: any number at a tier');
  assert.eq(Shops.traderTier(save, h('legacy')), 1, 'off the ledger: tier 1');
  assert.eq(Shops.shopTier(save, h('r9'), 'trader'), 2);
  assert.eq(Shops.shopTier(save, h('r9'), 'plain'), null);
  assert.eq(Shops.shopTier(save, h('r9'), 'turret'), null);
  save.shopTiers = { r11: 1 };
  assert.eq(Shops.traderTier(save, h('r11')), 1, 'the stamp wins');
  assert.eq(Shops.roleTierCount(save, 'trader', 1), 2); assert.eq(Shops.roleTierCount(save, 'trader', 2), 1);
});

test('shop tiers: the trader draws only its own tier on its one lane', () => {
  assert.eq(Shops.itemTier('potato_seed'), 1);
  assert.eq(Shops.itemTier('rainberry'), 4);
  const pick = SCENE_SRC.slice(SCENE_SRC.indexOf('  traderGivePick(house) {'));
  const body = pick.slice(0, pick.indexOf('\n  }\n'));
  assert.includes(body, 'Shops.traderStock(tier)');
  assert.includes(body, 'Shops.traderTier(this.save, house)');
  // The smithy hands its tier to the forge roll; every badge reads shopTier.
  assert.truthy(/const smithTier = isBlacksmith \? Shops\.smithTier\(this\.save, house\) : undefined;/.test(SCENE_SRC));
  assert.truthy(/const tier = role === 'market' \? this\.marketTheme\(house\)\.tier : Shops\.shopTier\(this\.save, house, role\);/.test(SCENE_SRC), 'the offer blurb badge');
  assert.truthy(/const tier = role === 'market' \? scene\.marketTheme\(house\)\.tier : Shops\.shopTier\(scene\.save, house, role\);/.test(RENDER_SRC), 'the map badge');
  assert.truthy(/const tier = Shops\.shopTier\(this\.save, house, row\.role\) \|\| 0;/.test(SCENE_SRC), 'the Restored! card');
  assert.truthy(/tierBadgeHTML\(row\.tier, 9, 4\)/.test(SCENE_SRC), 'and the flat restore card\'s rank badge');
});
test('trader stock: every non-gear item is available at exactly its own tier', () => {
  const equipment = new Set(Gear.uniqueRelics().map(item => item.id));
  for (const item of Object.values(ITEM_BY_ID)) {
    const tier = Shops.itemTier(item.id);
    if (tier < 1 || tier > Shops.SHOP_TIER_MAX) continue;
    assert.eq(Shops.traderStock(tier).includes(item.id), !equipment.has(item.id) && !item.progressionOnly, item.id);
    if (!equipment.has(item.id) && !item.progressionOnly) assert.eq(Shops.traderPrices()[item.id], itemValue(item.id), item.id + ' value');
  }
  for (let tier = 1; tier <= Shops.SHOP_TIER_MAX; tier++) {
    assert.gt(Shops.traderStock(tier).length, 0);
    for (const id of Shops.traderStock(tier)) assert.eq(Shops.itemTier(id), tier, id);
  }
});

test('trader offers: sign and barter share the full tier pool and never ask for gear', () => {
  const names = ['traderGivePick', 'traderGoodsName', 'peekTraderGearSwap', 'peekOrBuildTraderOffer'];
  const methods = names.map(name => {
    const start = SCENE_SRC.indexOf('\n  ' + name + '(');
    return SCENE_SRC.slice(start, SCENE_SRC.indexOf('\n  }\n', start) + 4);
  });
  const proto = (0, eval)('({' + methods.join(',') + '})');
  const gear = Gear.uniqueRelics()[0];
  const scene = Object.assign(Object.create(proto), {
    save: { inv: [{ id: gear.id, count: 1 }], relics: {}, restoredHouses: {} },
    shopRng: () => () => 0.99, priceMul: () => 1, guildPrice: (_, n) => n,
  });
  const house = { id: 'trader' };
  const offer = scene.peekOrBuildTraderOffer(house);
  assert.truthy(offer);
  assert.eq(Shops.itemTier(offer.giveId), 1);
  assert.eq(scene.traderGoodsName(house), itemName(offer.giveId));
  assert.truthy(Object.hasOwn(Shops.traderPrices(), offer.askId));
  assert.truthy(offer.askId !== offer.giveId);
});

})();
