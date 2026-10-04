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

test('shop tiers: the lean halves per rank away, and the trader draws through it on its one lane', () => {
  assert.eq(Shops.tierAffinity(3, 3), 1);
  assert.eq(Shops.tierAffinity(1, 3), 1 / 4);
  assert.eq(Shops.tierAffinity(5, 3), 1 / 4);
  assert.eq(Shops.itemTier('potato_seed'), 1);
  assert.eq(Shops.itemTier('rainberry'), 4);
  const pick = SCENE_SRC.slice(SCENE_SRC.indexOf('  traderGivePick(house) {'));
  const body = pick.slice(0, pick.indexOf('\n  }\n'));
  assert.truthy(/const giveId = weightedPickBy\(ids, \(id\) => Shops\.tierAffinity\(Shops\.itemTier\(id\), tier\), rng\)/.test(body),
    'one weighted draw off the trader lane');
  assert.truthy(/const tier = Shops\.traderTier\(this\.save, house\);/.test(body), 'at the trader\'s own rank');
  assert.falsy(/Math\.floor\(rng\(\) \*/.test(body), 'the uniform draw is gone');
  // The smithy hands its tier to the forge roll; every badge reads shopTier.
  assert.truthy(/const smithTier = isBlacksmith \? Shops\.smithTier\(this\.save, house\) : undefined;/.test(SCENE_SRC));
  assert.truthy(/const tier = role === 'market' \? this\.marketTheme\(house\)\.tier : Shops\.shopTier\(this\.save, house, role\);/.test(SCENE_SRC), 'the offer blurb badge');
  assert.truthy(/const tier = role === 'market' \? scene\.marketTheme\(house\)\.tier : Shops\.shopTier\(scene\.save, house, role\);/.test(RENDER_SRC), 'the map badge');
  assert.truthy(/const tier = Shops\.shopTier\(this\.save, house, row\.role\) \|\| 0;/.test(SCENE_SRC), 'the Restored! card');
  assert.truthy(/const tier = tierOf\(row\);/.test(SCENE_SRC) && /tierBadgeHTML\(tier, 11\)/.test(SCENE_SRC), 'and the second-step restore card');
});
})();
