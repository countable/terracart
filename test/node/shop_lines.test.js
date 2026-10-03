// The Shop cards (shops.js marketOffers): one line off the cycle until the
// ninth rebuild, then a rotating pair; a picked line is stored
// (save.shopLines) and its tier counts the markets before it on the same line.
(function () {
const h = (id) => ({ kind: 'house', tier: 9, id });

test('shop lines: one card off the cycle, then a pair that moves on with every restore', () => {
  assert.eq(Shops.MARKET_PAIR_FROM, 9);
  const save = SaveState.defaults({ restoredHouses: {} });
  assert.eq(JSON.stringify(Shops.marketOffers(save, 2)), JSON.stringify([{ theme: 'seed', tier: 1 }]), 'the third rebuild: the first line');
  assert.eq(JSON.stringify(Shops.marketOffers(save, 7)), JSON.stringify([{ theme: 'seed', tier: 1 }]), 'the eighth: still one card');
  const themes = (order) => Shops.marketOffers(save, order).map((r) => r.theme).join();
  assert.eq(themes(8), 'seed,supply', 'the ninth: two cards');
  assert.eq(themes(9), 'potion,ore');
  assert.eq(themes(10), 'relic,pet');
  assert.eq(themes(11), 'seed,supply', 'round again');
  assert.eq(themes(100), themes(100 + 3), 'the same pair every third rebuild');
  // Picked lines are stored, and the tier counts the line's earlier shops.
  save.restoredHouses.a = 'plain';
  for (let i = 1; i < 8; i++) save.restoredHouses['p' + i] = 'plain';
  assert.eq(Houses.restoreAs(save, h('s1'), 'market:seed').theme, 'seed', 'the ninth may be a Seed Shop');
  assert.eq(save.shopLines.s1, 'seed');
  assert.eq(Shops.lineFor(save, h('s1')).theme, 'seed');
  assert.eq(Shops.lineFor(save, h('s1')).tier, 1);
  assert.eq(Houses.restoreAs(save, h('s2'), 'market:ore').theme, 'ore', 'the tenth: potion or ore');
  assert.eq(Houses.restoreAs(save, h('x'), 'market:seed'), null, 'not seed at the eleventh');
  assert.eq(Houses.restoreAs(save, h('s3'), 'market:pet').theme, 'pet');
  assert.eq(Houses.restoreAs(save, h('s4'), 'market:seed').theme, 'seed', 'the twelfth: seed again');
  assert.eq(Shops.lineFor(save, h('s4')).tier, 2, 'the second Seed Shop is the T2 one');
  assert.eq(Shops.lineFor(save, h('s2')).tier, 1);
  assert.eq(Shops.marketOffers(save, 14)[0].tier, 3, 'and the card says the third would be T3');
  assert.eq(Shops.shopTier(save, h('s4'), 'market'), 2);
});

test('shop lines: a market with no stored line keeps the cycle\'s answer beside the picked ones', () => {
  const save = { restoredHouses: { m1: 'market', m2: 'market', s: 'market', m3: 'market' }, shopLines: { s: 'seed' } };
  const lines = Shops.marketLines(save);
  assert.eq(lines.map((r) => r.theme).join(), 'seed,supply,seed,ore', 'legacy markets take the cycle by position, the pick its own');
  assert.eq(lines.map((r) => r.tier).join(), '1,1,2,1', 'the picked Seed Shop is the second on its line');
  assert.eq(Shops.lineFor(save, h('m3')).theme, Shops.themeAt(3).theme, 'a legacy market reads exactly as before');
  assert.eq(Shops.lineFor(save, h('s')).tier, 2);
  assert.eq(Shops.lineTierFor(save, 'seed'), 3);
  assert.eq(Shops.lineTierFor(save, 'pet'), 1);
});
})();
