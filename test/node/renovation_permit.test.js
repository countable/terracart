// THE RENOVATION PERMIT (items.js renovation_permit, a T4 supply; houses.js
// renovateTo / renovate): spent on a standing shop, smithy or trader to raise
// it one rank — only a rank the memory ladder has opened (Shops.tierCap) and,
// for a shop, one its line still allows (Shops.lineBuildable).
(function () {
const h = (id) => ({ kind: 'house', tier: 9, id });
const mem = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => ['memory:' + i, 1]));

test('renovation permit: a T4 supply with an icon, a price, a story line and no bag action', () => {
  const it = ITEM_BY_ID[Houses.PERMIT_ID];
  assert.eq(Houses.PERMIT_ID, 'renovation_permit');
  assert.truthy(it && it.kind === 'supply', 'a supply');
  assert.eq(it.baseTier, 4);
  assert.truthy(PRICES.renovation_permit > PRICES.javelin, 'dearer than the other T4 supply');
  assert.truthy(ITEM_EFFECTS.renovation_permit && !/[0-9%]/.test(ITEM_EFFECTS.renovation_permit), 'a hint, no numbers');
  assert.eq(MINERAL_ICON_SHEET.renovation_permit.sheet, 'icon_book');
  const frame = MINERAL_ICON_SHEET.renovation_permit.frame;
  for (const [id, art] of Object.entries(MINERAL_ICON_SHEET)) {
    if (id !== 'renovation_permit' && art.sheet === 'icon_book') assert.falsy(art.frame === frame, `${id} shares the permit's scroll`);
  }
  assert.truthy(Shops.THEME_POOL.supply().includes('renovation_permit'), 'on the Supply line (a T4: the trader and the lanes past T3)');
  assert.falsy(CONSUMABLE_SPEC.renovation_permit, 'no bag action: it is spent at a building');
});

test('renovation permit: raises a ranked building one rank, only to a rank that is open', () => {
  const save = { restoredHouses: {}, discovered: {} };
  Houses.restoreAs(save, h('h0'), 'plain');
  Houses.restoreAs(save, h('s'), 'blacksmith:1');
  Houses.restoreAs(save, h('m'), 'market:seed:1');
  Houses.restoreAs(save, h('p'), 'market:potion:1');
  for (let i = 4; i < 12; i++) Houses.restoreAs(save, h('h' + i), 'plain');
  Houses.restoreAs(save, h('t'), 'turret');
  Houses.restoreAs(save, h('pet'), 'petshop');
  // Unranked things take no permit.
  assert.eq(Houses.renovateTo(save, h('h0')).why, 'unranked', 'a House');
  assert.eq(Houses.renovateTo(save, h('t')).why, 'unranked', 'a turret');
  assert.eq(Houses.renovateTo(save, h('pet')).why, 'unranked', 'a one-off shop');
  assert.eq(Houses.renovateTo(save, h('nope')).why, 'unranked', 'a wreck');
  // The memory ladder gates the next rank.
  assert.eq(Houses.renovateTo(save, h('s')).why, 'memories'); assert.eq(Houses.renovateTo(save, h('s')).need, 5, 'and says how many');
  assert.eq(Houses.renovate(save, h('s')), null, 'nothing written');
  assert.eq(Shops.smithTier(save, h('s')), 1);
  save.discovered = mem(5);
  assert.eq(Houses.renovateTo(save, h('s')).tier, 2);
  assert.eq(Houses.renovate(save, h('s')), 2);
  assert.eq(save.shopTiers.s, 2, 'the rank ledger'); assert.eq(Shops.smithTier(save, h('s')), 2, 'every badge reads it');
  assert.eq(Houses.renovateTo(save, h('s')).why, 'memories', 'T3 waits for ten');
  // A shop climbs on its line.
  assert.eq(Houses.renovate(save, h('m')), 2);
  assert.eq(JSON.stringify(Shops.lineFor(save, h('m'))), JSON.stringify({ theme: 'seed', tier: 2 }));
  save.discovered = mem(30);
  assert.eq(Houses.renovate(save, h('m')), 3);
  assert.eq(Houses.renovateTo(save, h('m')).why, 'line', 'Seed ends at T3');
  // Magic: one per tier — a standing T3 Magic Shop blocks the T1 one's climb.
  Houses.restoreAs(save, h('p2'), 'market:potion:3');
  assert.eq(Houses.renovateTo(save, h('p')).why, 'line', 'a T3 Magic Shop already stands');
  assert.eq(Houses.renovate(save, h('p2')), 5, 'the T3 one climbs to T5');
  assert.eq(Houses.renovateTo(save, h('p')).tier, 3, 'and the T1 one may follow');
  Houses.restoreAs(save, h('r'), 'market:relic:2');
  assert.eq(Houses.renovate(save, h('r')), 4);
  assert.eq(Houses.renovate(save, h('r')), 6);
  assert.eq(Houses.renovateTo(save, h('r')).why, 'line');
  // The top rank.
  save.shopTiers.s = 7;
  assert.eq(Houses.renovateTo(save, h('s')).why, 'top');
  // A legacy house with no stored rank climbs from its derived one.
  const old = { restoredHouses: { a: 'plain', s1: 'blacksmith', s2: 'blacksmith' }, discovered: mem(30) };
  assert.eq(Shops.smithTier(old, h('s2')), 2, 'the second smithy was T2');
  assert.eq(Houses.renovate(old, h('s2')), 3);
  assert.eq(Shops.smithTier(old, h('s2')), 3);
});

test('renovation permit: the shop tap with a permit in hand offers the work, spends the permit after the pick, and refuses aloud', () => {
  const start = SCENE_SRC.indexOf('  shopInteract(sx, sy, house');
  const src = SCENE_SRC.slice(start, SCENE_SRC.indexOf('\n  }\n', start));
  assert.truthy(/sel\.id === Houses\.PERMIT_ID && \(sel\.count \?\? 0\) > 0 && shopType && shopType !== 'turret' && !castle/.test(src), 'a ranked door, the permit held');
  assert.truthy(/const to = Houses\.renovateTo\(this\.save, house\);/.test(src), 'one question');
  assert.truthy(/acceptLabel: 'Renovate',/.test(src));
  assert.truthy(/if \(Inventory\.remove\(this\.save, Houses\.PERMIT_ID, 1\) < 1\) \{/.test(src), 'spent on accept');
  assert.truthy(/const tier = Houses\.renovate\(this\.save, house\);/.test(src), 'then written');
  assert.truthy(src.indexOf('Inventory.remove(this.save, Houses.PERMIT_ID, 1)') < src.indexOf('Houses.renovate(this.save, house)'), 'the permit first');
  assert.truthy(/this\.flash\(`Needs \$\{to\.need\} memories`, sx, sy\)/.test(src), 'the refusal names the memories');
  assert.truthy(/this\.flash\('This line goes no higher', sx, sy\)/.test(src));
  for (const m of ['Needs 30 memories', 'This line goes no higher', 'Already the top rank']) assert.lt(m.length, MAP_MSG_MAX + 1, m);
});
})();
