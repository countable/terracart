// The Shop cards (shops.js marketOffers): one line off the cycle until the
// ninth rebuild, then a rotating pair; a picked line is stored
// (save.shopLines) and its tier counts the markets before it on the same line.
(function () {
const h = (id) => ({ kind: 'house', tier: 9, id });

test('shop lines: one card off the cycle, then a pair that moves on with every restore', () => {
  assert.eq(Shops.MARKET_PAIR_FROM, 9);
  const save = { restoredHouses: {} };
  assert.eq(JSON.stringify(Shops.marketOffers(save, 2)), JSON.stringify([{ theme: 'seed', tier: 1 }]), 'the third rebuild: the first line');
  assert.eq(JSON.stringify(Shops.marketOffers(save, 7)), JSON.stringify([{ theme: 'seed', tier: 1 }]), 'the eighth: still one card');
  const themes = (order) => Shops.marketOffers(save, order).map((r) => r.theme).join();
  assert.eq(themes(8), 'seed,supply', 'the ninth: two cards');
  assert.eq(themes(9), 'potion,ore');
  assert.eq(themes(10), 'relic,seed', 'five lines: the pair wraps');
  assert.eq(themes(11), 'supply,potion');
  assert.eq(themes(12), 'ore,relic');
  assert.eq(themes(13), 'seed,supply', 'round again');
  assert.eq(themes(100), themes(100 + 5), 'the same pair every fifth rebuild');
  assert.falsy([8, 9, 10, 11, 12].some((o) => themes(o).includes('pet')), 'never a Pet Shop card off the cycle');
  // Picked lines are stored, and the tier counts the line's earlier shops.
  save.restoredHouses.a = 'plain';
  for (let i = 1; i < 8; i++) save.restoredHouses['p' + i] = 'plain';
  assert.eq(Houses.restoreAs(save, h('s1'), 'market:seed').theme, 'seed', 'the ninth may be a Seed Shop');
  assert.eq(save.shopLines.s1, 'seed');
  assert.eq(Shops.lineFor(save, h('s1')).theme, 'seed');
  assert.eq(Shops.lineFor(save, h('s1')).tier, 1);
  assert.eq(Houses.restoreAs(save, h('s2'), 'market:ore').theme, 'ore', 'the tenth: potion or ore');
  assert.eq(Houses.restoreAs(save, h('x'), 'market:potion'), null, 'not potion at the eleventh');
  assert.eq(Houses.restoreAs(save, h('x'), 'market:pet'), null, 'and never pets');
  assert.eq(Houses.restoreAs(save, h('s3'), 'market:seed').theme, 'seed', 'the eleventh: relic or seed again');
  assert.eq(Shops.lineFor(save, h('s3')).tier, 2, 'the second Seed Shop is the T2 one');
  assert.eq(Shops.lineFor(save, h('s2')).tier, 1);
  assert.eq(Shops.marketOffers(save, 13)[0].tier, 3, 'and the card says the third would be T3');
  assert.eq(Shops.shopTier(save, h('s3'), 'market'), 2);
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

test('pet shop: a one-off card from the 12th restore, a market plus its stamp, outside the cycle and never a tier up', () => {
  assert.eq(Houses.STORY_RESTORES.petshop, 12);
  assert.eq(Houses.buildOption('petshop').from, 12);
  assert.eq(Houses.buildOption('petshop').role, 'market', 'stored as a shop');
  assert.eq(Houses.buildOption('petshop').name, 'Pet Shop');
  assert.eq(Shops.roleLabel('market', 'pet'), 'Pet Shop');
  assert.eq(JSON.stringify(Shops.SOLO_LINES), JSON.stringify({ book: 'bookshopId', pet: 'petshopId' }), 'the one table of one-off lines');
  assert.truthy(Shops.themedStock('pet', 1).length, 'the line still has stock');
  const save = { restoredHouses: {} };
  assert.eq(Houses.restoreAs(save, h('h0'), 'plain').key, 'plain');
  assert.eq(Houses.restoreAs(save, h('p'), 'petshop'), null, 'not on offer yet');
  for (let i = 1; i < 11; i++) Houses.restoreAs(save, h('h' + i), i % 3 === 0 ? 'market:' + Shops.marketOffers(save, i)[0].theme : 'plain');
  assert.eq(Houses.restoredCount(save), 11);
  assert.eq(save.petshopId, undefined, 'an ordinary market is not it');
  assert.eq(Houses.restoreAs(save, h('p'), 'petshop').key, 'petshop', 'the twelfth may be the Pet Shop');
  assert.eq(save.restoredHouses.p, 'market');
  assert.eq(save.petshopId, 'p', 'the pick is stamped');
  assert.eq(Shops.soloLine(save, 'p'), 'pet'); assert.truthy(Shops.isSoloShop(save, 'p')); assert.falsy(Shops.isBookshop(save, 'p'));
  assert.eq(JSON.stringify(Shops.lineFor(save, h('p'))), JSON.stringify({ theme: 'pet', tier: 1 }), 'sells pets at T1');
  assert.eq(Houses.restoreAs(save, h('p2'), 'petshop'), null, 'once per save');
  assert.falsy(Houses.buildOptions(save, h('p2')).some((r) => r.key === 'petshop'), 'the card is gone');
  // Outside the cycle: the markets after it keep the lines they would have had.
  const before = Shops.marketLines(save).map((r) => r.theme + r.tier).join();
  assert.falsy(Shops.marketLines(save).some((r) => r.id === 'p'), 'not a market of the cycle');
  assert.eq(Houses.restoreAs(save, h('m'), 'market:' + Shops.marketOffers(save, 12)[0].theme).role, 'market');
  assert.eq(Shops.marketLines(save).map((r) => r.theme + r.tier).join().indexOf(before), 0, 'the markets before it are unmoved');
  assert.eq(Shops.lineTierFor(save, 'pet'), 1, 'and a Pet Shop never climbs a tier');
  // The Book Shop is the same kind of thing: both stamps may stand at once.
  for (let i = 13; i < 15; i++) Houses.restoreAs(save, h('h' + i), 'plain');
  assert.eq(Houses.restoreAs(save, h('b'), 'bookshop').key, 'bookshop');
  assert.eq(save.bookshopId, 'b'); assert.eq(save.petshopId, 'p');
  assert.eq(Shops.lineFor(save, h('b')).theme, 'book');
  assert.eq(Shops.lineFor(save, h('p')).theme, 'pet');
  // A market that picked the Pet line while it was still in the cycle keeps it.
  const old = { restoredHouses: { m: 'market' }, shopLines: { m: 'pet' } };
  assert.eq(Shops.lineFor(old, h('m')).theme, 'pet', 'an old Pet Shop still sells pets');
});
})();

test('shop lines: relic and magic shops follow their allowed tier ladders', () => {
  for (const [theme, expected] of [['relic', [2, 4, 6, 6]], ['potion', [1, 3, 5, 7, 7]]]) {
    const save = { restoredHouses: {}, shopLines: {} };
    for (let i = 0; i < expected.length; i++) {
      assert.eq(Shops.lineTierFor(save, theme), expected[i]);
      const id = theme + i;
      save.restoredHouses[id] = 'market'; save.shopLines[id] = theme;
      assert.eq(Shops.lineFor(save, { id }).theme, theme);
      assert.eq(Shops.lineFor(save, { id }).tier, expected[i]);
      assert.eq(Shops.themeAt(i * Shops.THEMES.length + Shops.THEMES.indexOf(theme)).tier, expected[i]);
    }
  }
});
