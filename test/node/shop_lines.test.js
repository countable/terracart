// Shop LINES and RANKS (shops.js LINE_RULES, lineBuildable, storedTier):
// a market sells one line at one rank, both the player's pick, stamped on
// the save; any number may stand at a rank but for a line's own cap; the
// Pet and Book lines are one-off stamps outside the table.
(function () {
const h = (id) => ({ kind: 'house', tier: 9, id });

test('shop lines: the one table — Seed and Supply to T3, Magic one per tier to T7, Relic to T7, no Ore', () => {
  assert.eq(Shops.THEMES.join(), 'seed,supply,potion,relic');
  assert.eq(JSON.stringify(Shops.LINE_RULES), JSON.stringify({
    seed: { maxTier: 3 }, supply: { maxTier: 3 }, potion: { maxTier: 7, perTier: 1 }, relic: { maxTier: 7 },
  }));
  assert.eq(Shops.THEMES.join(), Object.keys(Shops.LINE_RULES).join(), 'THEMES is the table\'s keys');
  for (const k of ['ore']) {
    assert.falsy(Shops.LINE_RULES[k] || Shops.THEME_LABEL[k] || Shops.THEME_BLURB[k] || Shops.THEME_POOL[k], 'the Ore Shop is gone: ' + k);
  }
  const save = { restoredHouses: {} };
  assert.truthy(Shops.lineBuildable(save, 'seed', 3)); assert.falsy(Shops.lineBuildable(save, 'seed', 4), 'Seed stops at T3');
  assert.truthy(Shops.lineBuildable(save, 'supply', 3)); assert.falsy(Shops.lineBuildable(save, 'supply', 4));
  assert.truthy(Shops.lineBuildable(save, 'relic', 7)); assert.falsy(Shops.lineBuildable(save, 'relic', 8));
  assert.falsy(Shops.lineBuildable(save, 'ore', 1) || Shops.lineBuildable(save, 'pet', 1) || Shops.lineBuildable(save, 'book', 1), 'not lines of the table');
  assert.falsy(Shops.lineBuildable(save, 'seed', 0));
  // Magic: one per tier.
  const magic = { restoredHouses: { a: 'market', b: 'market' }, shopLines: { a: 'potion', b: 'seed' }, shopTiers: { a: 2, b: 2 } };
  assert.falsy(Shops.lineBuildable(magic, 'potion', 2), 'a T2 Magic Shop stands');
  assert.truthy(Shops.lineBuildable(magic, 'potion', 1) && Shops.lineBuildable(magic, 'potion', 3), 'other ranks still open');
  assert.truthy(Shops.lineBuildable(magic, 'seed', 2), 'a second T2 Seed Shop may stand');
  assert.eq(Shops.lineCount(magic, 'potion', 2), 1); assert.eq(Shops.lineCount(magic, 'seed', 1), 0);
});

test('shop lines: the pick stamps line and rank; duplicates stand at one rank; legacy markets keep their derivations', () => {
  const save = { restoredHouses: {} };
  Houses.restoreAs(save, h('h0'), 'plain'); Houses.restoreAs(save, h('h1'), 'plain');
  assert.eq(Houses.restoreAs(save, h('s1'), 'market:seed:1').theme, 'seed');
  assert.eq(Houses.restoreAs(save, h('s2'), 'market:seed:1').theme, 'seed', 'a second T1 Seed Shop');
  assert.eq(save.shopLines.s2, 'seed'); assert.eq(save.shopTiers.s2, 1);
  assert.eq(Shops.lineFor(save, h('s1')).tier, 1); assert.eq(Shops.lineFor(save, h('s2')).tier, 1, 'both T1: the rank is the stamp, not a count');
  assert.eq(Shops.shopTier(save, h('s2'), 'market'), 1);
  assert.eq(Houses.restoreAs(save, h('x'), 'market:seed:2'), null, 'T2 waits for five memories');
  for (let i = 4; i < 9; i++) Houses.restoreAs(save, h('h' + i), 'plain');
  assert.eq(Houses.restoredCount(save), 9);
  assert.eq(Houses.restoreAs(save, h('x'), 'market:seed:2'), null, 'not for wrecks');
  save.discovered = { a: 1, b: 1, c: 1, d: 1, e: 1 };
  assert.eq(Houses.restoreAs(save, h('s3'), 'market:seed:2').tier, 2);
  assert.eq(Shops.lineFor(save, h('s3')).tier, 2);
  assert.eq(Shops.lineCount(save, 'seed', 1), 2); assert.eq(Shops.lineCount(save, 'seed', 2), 1);
  assert.eq(Houses.restoreAs(save, h('p1'), 'market:potion:1').theme, 'potion');
  assert.eq(Houses.restoreAs(save, h('p2'), 'market:potion:1'), null, 'the Magic Shop is one per tier');
  assert.eq(Houses.restoreAs(save, h('p2'), 'market:potion:2').tier, 2, 'the next rank is open');
  // Legacy: a market with a stored line but no stored rank takes one past
  // the markets before it on that line; one with no line keeps the cycle.
  const old = { restoredHouses: { m1: 'market', m2: 'market', s: 'market', m3: 'market' }, shopLines: { s: 'seed' } };
  const lines = Shops.marketLines(old);
  assert.eq(lines.map((r) => r.theme).join(), 'seed,supply,seed,relic', 'legacy markets take the cycle by position, the pick its own');
  assert.eq(lines.map((r) => r.tier).join(), '1,1,2,1', 'the picked Seed Shop is the second on its line');
  assert.eq(Shops.lineFor(old, h('m3')).theme, Shops.themeAt(3).theme, 'a legacy market reads exactly as before');
  assert.eq(Shops.lineFor(old, h('s')).tier, 2);
  assert.eq(Shops.storedTier(old, 's'), null); assert.eq(Shops.storedTier({ shopTiers: { s: 3 } }, 's'), 3);
  assert.eq(Shops.storedTier({ shopTiers: { s: 99 } }, 's'), 7, 'clamped to the top rank');
});

test('pet shop: a one-off card from the 12th restore, a market plus its stamp, outside the lines table and never a tier up', () => {
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
  for (let i = 1; i < 11; i++) Houses.restoreAs(save, h('h' + i), i % 3 === 0 ? 'market:seed:1' : 'plain');
  assert.eq(Houses.restoredCount(save), 11);
  assert.eq(save.petshopId, undefined, 'an ordinary market is not it');
  assert.eq(Houses.restoreAs(save, h('p'), 'petshop').key, 'petshop', 'the twelfth may be the Pet Shop');
  assert.eq(save.restoredHouses.p, 'market');
  assert.eq(save.petshopId, 'p', 'the pick is stamped');
  assert.eq(Shops.soloLine(save, 'p'), 'pet'); assert.truthy(Shops.isSoloShop(save, 'p')); assert.falsy(Shops.isBookshop(save, 'p'));
  assert.eq(JSON.stringify(Shops.lineFor(save, h('p'))), JSON.stringify({ theme: 'pet', tier: 1 }), 'sells pets at T1');
  assert.eq(Houses.restoreAs(save, h('p2'), 'petshop'), null, 'once per save');
  assert.falsy(Houses.buildOptions(save, h('p2')).some((r) => r.key === 'petshop'), 'the card is gone');
  assert.falsy(Houses.buildOptions(save, h('p2')).some((r) => r.theme === 'pet'), 'and pets are no Shop line');
  assert.falsy(Shops.marketLines(save).some((r) => r.id === 'p'), 'not a market of the lines table');
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
