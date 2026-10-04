// Headless tests for the house/building identity core (src/houses.js) —
// starter blacksmith, restored-house shop roles, wreck restoration, fort
// unlocking and castle claiming, extracted from app.js's MapScene.

const plainHouse = { kind: 'house', tier: 9, address: 3 };   // shopType → null

// ── Starter blacksmith / shop role ──────────────────────────────────────────

test('isStarterBlacksmith: only the stamped house, and only with an id', () => {
  const save = { starterBlacksmithId: 'h1' };
  assert.truthy(Houses.isStarterBlacksmith(save, { id: 'h1' }));
  assert.falsy(Houses.isStarterBlacksmith(save, { id: 'h2' }), 'a different house');
  assert.falsy(Houses.isStarterBlacksmith(save, null), 'no house');
  assert.falsy(Houses.isStarterBlacksmith(save, {}), 'no id on the house');
  assert.falsy(Houses.isStarterBlacksmith({}, { id: 'h1' }), 'no stamped id in the save');
});

test('houseShopRole: frozen role wins over the address-derived fallback', () => {
  const save = { restoredHouses: { a: 'trader', b: 'plain' } };
  assert.eq(Houses.houseShopRole(save, { kind: 'house', id: 'a' }), 'trader');
  assert.eq(Houses.houseShopRole(save, { kind: 'house', id: 'b' }), null, "'plain' reads as no shop");
});

test('houseShopRole: legacy `true` / unrestored falls back to the starter smith then the address', () => {
  const save = { starterBlacksmithId: 'sb' };
  assert.eq(Houses.houseShopRole(save, { kind: 'house', id: 'sb' }), 'blacksmith');
  assert.eq(Houses.houseShopRole(save, plainHouse), null, 'address-derived, and this address has no shop');
  assert.eq(Houses.houseShopRole({}, { kind: 'tower', id: 'x' }), null, 'not even a house');
});

test('hasBlacksmith: the stamped starter smith or any restored one', () => {
  assert.truthy(Houses.hasBlacksmith({ starterBlacksmithId: 'a' }));
  assert.truthy(Houses.hasBlacksmith({ restoredHouses: { z: 'blacksmith' } }));
  assert.falsy(Houses.hasBlacksmith({ restoredHouses: { z: 'trader' } }));
  assert.falsy(Houses.hasBlacksmith({}));
});

test('displayRole: one verdict covers Home, forts, wrecks and frozen shops', () => {
  const cases = [
    ['unrestored tier-9 house', {}, { kind: 'house', tier: 9, id: 'h' }, 'wreck'],
    ['restored plain house', { restoredHouses: { h: 'plain' } }, { kind: 'house', tier: 9, id: 'h' }, 'plain'],
    ['fort', {}, { kind: 'house', tier: 11, id: 'f' }, 'fort'],
    ['Home trailer', { starterShopId: 'home' }, { kind: 'house', tier: 9, id: 'home' }, 'trailer'],
    ['non-house', {}, { kind: 'tower', tier: 9, id: 't' }, null],
  ];
  for (const role of ['blacksmith', 'trader', 'market', 'wizard']) {
    cases.push([`frozen ${role}`, { restoredHouses: { h: role } },
      { kind: 'house', tier: 9, id: 'h' }, role]);
  }
  for (const [label, save, house, expected] of cases) {
    assert.eq(Houses.displayRole(save, house), expected, label);
  }
});

test('displayRole: Home wins over a tier-derived role', () => {
  const save = { starterShopId: 'home', restoredHouses: { home: 'wizard' } };
  assert.eq(Houses.displayRole(save, { kind: 'house', tier: 11, id: 'home' }), 'trailer');
  assert.eq(Houses.displayRole({}, { kind: 'house', tier: 12, id: 'castle-house' }), 'plain',
    'isHouseWreck keeps non-tier-9 buildings out of the wreck role');
});

test('render: each visible house carries one owner-resolved display role', () => {
  const resolves = RENDER_SRC.match(/Houses\.displayRole\(scene\.save, o\)/g) || [];
  assert.eq(resolves.length, 1, 'render resolves the owner once per collected house');
  assert.truthy(/objList\.push\(\{ o, dx, dy, wide, houseRole \}\)/.test(RENDER_SRC),
    'the frame item carries the resolved role');
  assert.falsy(/scene\.houseShopRole/.test(RENDER_SRC),
    'render does not reconstruct the shop part of the display role');
});

// ── What a wreck can become ───────────────────────────────────────────────────

test('buildOptions: the catalogue unlocks by how many wrecks already stand', () => {
  const from = Object.fromEntries(Houses.BUILD_OPTIONS.map((r) => [r.key, r.from]));
  assert.eq(JSON.stringify(from), JSON.stringify({ plain: 1, blacksmith: 2, market: 3, trader: 5, turret: 8, petshop: 12, bookshop: 15, wizard: 30 }), 'the ladder');
  const mem = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => ['memory:' + i, 1]));
  const keys = (order, save = { restoredHouses: {}, discovered: {} }) => Houses.buildOptions(save, plainHouse, order).map((r) => r.key).join();
  assert.eq(keys(0), 'plain', 'the first restore is a House and nothing else');
  assert.eq(keys(1), 'plain,blacksmith:1', 'the second adds the smithy');
  assert.eq(keys(2), 'plain,blacksmith:1,market:seed:1,market:supply:1,market:potion:1,market:relic:1', 'the third adds a Shop card per line (no Ore Shop)');
  assert.eq(keys(3), keys(2), 'the fourth adds nothing');
  assert.eq(keys(4), keys(2) + ',trader:1');
  assert.eq(keys(7), keys(4) + ',turret');
  assert.eq(keys(9), keys(7), 'the tenth: still T1 only — ranks climb by memories, not wrecks');
  // Five memories open T2, whatever the restore count.
  assert.eq(keys(9, { restoredHouses: {}, discovered: mem(5) }), 'plain,blacksmith:1,blacksmith:2,market:seed:1,market:seed:2,market:supply:1,market:supply:2,market:potion:1,market:potion:2,market:relic:1,market:relic:2,trader:1,trader:2,turret', 'five memories: a card per rank, T2 unlocked');
  assert.truthy(keys(4, { restoredHouses: {}, discovered: mem(5) }).includes('blacksmith:2'), 'even at the fifth restore');
  assert.truthy(keys(11).endsWith(',turret,petshop'), 'the twelfth: the Pet Shop');
  assert.truthy(keys(14, { restoredHouses: {}, discovered: mem(10) }).includes('market:seed:3') && keys(14).endsWith(',turret,petshop,bookshop'), 'ten memories: T3; the fifteenth: the Book Shop');
  assert.truthy(keys(29).endsWith(',petshop,bookshop,wizard'), 'the thirtieth: the tower');
  // LINE_RULES: Seed and Supply stop at T3; Magic and Relic run on.
  const k20 = keys(19, { restoredHouses: {}, discovered: mem(15) }).split(',');
  assert.truthy(k20.includes('market:seed:3') && !k20.includes('market:seed:4'), 'no T4 Seed Shop');
  assert.truthy(k20.includes('market:supply:3') && !k20.includes('market:supply:4'), 'no T4 Supply Shop');
  assert.truthy(k20.includes('market:potion:4') && k20.includes('market:relic:4'), 'Magic and Relic reach T4');
  assert.truthy(k20.includes('blacksmith:4') && k20.includes('trader:4'));
  // Magic is one per tier: a standing T1 Magic Shop removes that card, not the T2.
  const magic = { restoredHouses: { m: 'market' }, shopLines: { m: 'potion' }, shopTiers: { m: 1 }, discovered: mem(5) };
  const km = keys(9, magic).split(',');
  assert.falsy(km.includes('market:potion:1'), 'the T1 Magic Shop stands: no second');
  assert.truthy(km.includes('market:potion:2') && km.includes('market:seed:1'), 'the T2 one, and every other line, still');
  assert.eq(Houses.buildOptions({ restoredHouses: {}, bookshopId: 'b' }, plainHouse, 20).map((r) => r.key).includes('bookshop'), false, 'one Book Shop per save');
  assert.eq(Houses.buildOptions({ restoredHouses: {}, petshopId: 'p' }, plainHouse, 20).map((r) => r.key).includes('petshop'), false, 'one Pet Shop per save');
  assert.eq(Houses.restoredCount({ restoredHouses: { a: 'plain', b: 'market' } }), 2, 'the order is the ledger\'s size');
  for (const row of Houses.BUILD_OPTIONS) {
    assert.truthy(row.blurb && row.art && row.role, `${row.key} carries its blurb, painting and role`);
  }
  for (const r of Houses.buildOptions({ restoredHouses: {}, discovered: mem(5) }, plainHouse, 9)) {
    if (r.ranked) assert.truthy(Number.isInteger(r.tier) && r.tier >= 1, `${r.key} carries its numeric rank`);
    else assert.falsy(r.tier, `${r.key} has no rank`);
  }
  assert.eq(Houses.buildOption('turret').role, 'turret');
  assert.eq(Houses.buildOption('bookshop').role, 'market', 'the Book Shop is stored as a market plus its stamp');
  assert.eq(Houses.buildOption('petshop').role, 'market', 'the Pet Shop too');
  assert.eq(Houses.buildOption('petshop').solo, 'pet'); assert.eq(Houses.buildOption('bookshop').solo, 'book');
  assert.truthy(Houses.buildOption('plain').pinned && Houses.buildOption('wizard').pinned, 'the House and the tower are pinned');
  assert.eq(Shops.roleLabel('turret'), 'Turret');
});

test('ranks: one card per rank the memory ladder has unlocked — T2 at five memories, a rank every five, T7 at thirty', () => {
  assert.eq(Shops.MEMORIES_PER_TIER, 5); assert.eq(Shops.SHOP_TIER_MAX, 7);
  const mem = (n) => ({ restoredHouses: {}, discovered: Object.fromEntries(Array.from({ length: n }, (_, i) => ['memory:' + i, 1])) });
  assert.eq(Shops.memoryTotal(mem(7)), 7, 'the discovered ledger, as MemoryStory counts it');
  assert.eq(Shops.memoryTotal(mem(7)), MemoryStory.total(mem(7)));
  assert.eq(Shops.memoryTotal({}), 0);
  assert.eq(Houses.ranks(mem(0)).join(), '1'); assert.eq(Houses.ranks(mem(4)).join(), '1');
  assert.eq(Houses.ranks(mem(5)).join(), '1,2', 'five memories');
  assert.eq(Houses.ranks(mem(10)).join(), '1,2,3');
  assert.eq(Houses.ranks(mem(30)).join(), '1,2,3,4,5,6,7', 'thirty: every rank');
  assert.eq(Houses.ranks(mem(500)).length, 7, 'and never more');
  assert.eq(Shops.tierCap(mem(0)), 1); assert.eq(Shops.tierCap(mem(9)), 2); assert.eq(Shops.tierCap(mem(10)), 3); assert.eq(Shops.tierCap(mem(99)), 7);
  assert.eq(Shops.tierUnlockMemories(1), 0); assert.eq(Shops.tierUnlockMemories(2), 5); assert.eq(Shops.tierUnlockMemories(7), 30);
  // Wrecks restored play no part.
  const many = mem(0); for (let i = 0; i < 40; i++) many.restoredHouses['w' + i] = 'plain';
  assert.eq(Shops.tierCap(many), 1, 'forty wrecks and no memories: T1');
  assert.eq(Shops.traderTierAt(10), 2, 'the legacy trader derivation keeps its old restore-number ladder');
});

// WHAT EACH CARD COSTS (owner, Oct 2026): a House keeps the ladder, a shop
// pays stones per tier by its role, a turret a flat five.
test('buildCost: the House ladder, stones per tier for shops, a flat five for a turret', () => {
  const save = { restoredHouses: {}, discovered: { 'memory:0': 1, 'memory:1': 1, 'memory:2': 1, 'memory:3': 1, 'memory:4': 1 } };
  const h = { kind: 'house', tier: 9, id: 'h' };
  const by = (key, order = 9) => Houses.buildOptions(save, h, order).find((r) => r.key === key);
  assert.eq(Houses.buildCost(save, h, by('plain')).qty, Houses.wreckRestoreCost(save, h).qty, 'a House is the ladder');
  assert.eq(Houses.buildCost(save, h, null).qty, Houses.wreckRestoreCost(save, h).qty, 'no card: the ladder');
  assert.eq(JSON.stringify(Houses.BUILD_ROCKS_PER_TIER), JSON.stringify({ trader: 2, market: 3, blacksmith: 4 }));
  assert.eq(Houses.TURRET_ROCKS, 5);
  assert.eq(Houses.buildCost(save, h, by('turret')).qty, 5, 'a turret is five, always');
  assert.eq(Houses.buildCost(save, h, by('blacksmith:1'), 9).qty, 4, 'a T1 smithy: 4 × tier 1');
  assert.eq(Houses.buildCost(save, h, by('blacksmith:2'), 9).qty, 8, 'a T2 smithy: 4 × 2');
  assert.falsy(by('trader:1', 3), 'no trader card before the fifth');
  assert.eq(Houses.buildCost(save, h, by('trader:1', 4), 4).qty, 2, 'a T1 trader: 2 × 1');
  assert.eq(Houses.buildCost(save, h, by('trader:2'), 9).qty, 4, 'a T2 trader: 2 × 2');
  assert.eq(Houses.buildCost(save, h, by('market:seed:1', 2), 2).qty, 3, 'a T1 shop line: 3 × 1');
  assert.eq(Houses.buildCost(save, h, by('market:relic:2'), 9).qty, 6, 'a T2 shop line: 3 × 2');
  for (const c of [Houses.buildCost(save, h, by('turret')), Houses.buildCost(save, h, by('plain'))]) {
    assert.eq(c.id, 'rubble'); assert.eq(c.material, 'stone');
  }
});

test('buildOptions: a card is NEW when the player has no such building, or none at that rank', () => {
  const h = (id) => ({ kind: 'house', tier: 9, id });
  const cards = (save) => Houses.buildOptions(save, plainHouse);
  const isNew = (save, key) => Houses.isNewPick(save, cards(save).find((r) => r.key === key));
  const save = { restoredHouses: {}, discovered: {} };
  assert.truthy(isNew(save, 'plain'), 'the first House is new');
  Houses.restoreAs(save, h('h0'), 'plain');
  assert.falsy(isNew(save, 'plain'), 'a second House is not');
  assert.truthy(isNew(save, 'blacksmith:1'), 'no smithy yet');
  Houses.restoreAs(save, h('s1'), 'blacksmith:1');
  assert.falsy(isNew(save, 'blacksmith:1'), 'a second T1 smithy is a duplicate');
  assert.truthy(isNew(save, 'market:seed:1'), 'no Seed Shop yet');
  Houses.restoreAs(save, h('m1'), 'market:seed:1');
  assert.falsy(isNew(save, 'market:seed:1'), 'a second T1 Seed Shop is a duplicate');
  assert.truthy(isNew(save, 'market:supply:1'), 'a line never raised is new');
  for (let i = 3; i < 9; i++) Houses.restoreAs(save, h('h' + i), 'plain');
  assert.eq(Houses.restoredCount(save), 9);
  for (let i = 0; i < 5; i++) save.discovered['memory:' + i] = 1;   // five memories: T2 opens
  assert.truthy(isNew(save, 'market:seed:2'), 'the T2 Seed Shop is a rank the player lacks');
  assert.truthy(isNew(save, 'blacksmith:2'), 'the T2 smithy too');
  assert.truthy(isNew(save, 'trader:1') && isNew(save, 'trader:2'), 'no trader at all');
  Houses.restoreAs(save, h('t1'), 'trader:2');
  assert.truthy(isNew(save, 'trader:1'), 'a T1 trader is still new');
  assert.falsy(isNew(save, 'trader:2'), 'a second T2 is not');
  assert.truthy(isNew(save, 'turret'), 'no turret');
  Houses.restoreAs(save, h('tw'), 'turret');
  assert.falsy(isNew(save, 'turret'));
  for (let i = 11; i < 15; i++) Houses.restoreAs(save, h('h' + i), 'plain');
  assert.truthy(isNew(save, 'petshop') && isNew(save, 'bookshop'), 'the one-offs are new while none stands');
  assert.falsy(Houses.isNewPick(save, null));
  assert.truthy(/\+ \(Houses\.isNewPick\(this\.save, row\) \? newBadgeHTML\(\) : ''\)/.test(SCENE_SRC), 'the card wears the pill');
  assert.truthy(/NEW<\/span>/.test(newBadgeHTML()), 'the pill says NEW');
});

test('offerCards: N = restored + 1 — the House, up to three NEW, the rest duplicates, each a window that slides with every wreck', () => {
  const h = (id) => ({ kind: 'house', tier: 9, id });
  assert.eq(Houses.NEW_SLOTS, 3);
  const save = { restoredHouses: {}, discovered: {} };
  const offer = (s = save) => Houses.offerCards(s, plainHouse).map((r) => r.key);
  assert.eq(offer().join(), 'plain', 'one card for the first wreck');
  Houses.restoreAs(save, h('h0'), 'plain');
  assert.eq(offer().join(), 'plain,blacksmith:1', 'two for the second');
  Houses.restoreAs(save, h('h1'), 'plain');
  assert.eq(offer().length, 3, 'three for the third');
  assert.eq(offer()[0], 'plain', 'the House always leads');
  // A window of NEW cards over the catalogue (table order), two of the five
  // ranked cards here; the window's offset is the restore order.
  assert.eq(offer().join(), 'plain,market:supply:1,market:potion:1', 'order 2: the window starts two cards in');
  Houses.restoreAs(save, h('h2'), 'plain');
  assert.eq(offer().join(), 'plain,market:potion:1,market:relic:1,blacksmith:1', 'order 3: slid one card along, three NEW now');
  Houses.restoreAs(save, h('h3'), 'plain');
  assert.eq(offer().join(), 'plain,market:relic:1,trader:1,blacksmith:1', 'order 4: wraps round; still three NEW');
  for (let i = 4; i < 8; i++) Houses.restoreAs(save, h('h' + i), 'plain');
  let o = offer();
  // Nine slots for the ninth wreck, but nothing stands except Houses: no
  // duplicates to fill the slots past the three NEW, so they stay empty.
  assert.eq(o.length, 4, 'the House and three NEW');
  assert.eq(o.filter((k) => k === 'plain').length, 1, 'the House once');
  assert.eq(Houses.buildOptions(save, plainHouse).filter((r) => !r.pinned).length, 7, 'out of seven NEW on the table');
  // Raise a smithy and a Seed Shop: they move from the NEW pool to the duplicates.
  Houses.restoreAs(save, h('s'), 'blacksmith:1');
  Houses.restoreAs(save, h('m'), 'market:seed:1');
  o = Houses.offerCards(save, plainHouse);
  const fresh = o.filter((r) => !r.pinned && Houses.isNewPick(save, r)).map((r) => r.key);
  const dups = o.filter((r) => !r.pinned && !Houses.isNewPick(save, r)).map((r) => r.key);
  assert.eq(fresh.length, 3, 'three NEW');
  assert.eq(dups.join(), 'blacksmith:1,market:seed:1', 'the two duplicates fill the slots after them');
  assert.eq(o.length, 6, 'eleven slots, six cards');
  assert.eq(o.map((r) => r.key).indexOf(fresh[0]), 1, 'NEW cards sit right after the House');
  assert.truthy(o.map((r) => r.key).indexOf(dups[0]) > o.map((r) => r.key).indexOf(fresh[2]), 'duplicates after them');
  // The wizard's tower is pinned beside the House while its story offers it.
  const story = { restoredHouses: Object.fromEntries(Array.from({ length: 29 }, (_, i) => ['w' + i, 'plain'])), discovered: {} };
  const so = offer(story);
  assert.eq(so[0], 'plain'); assert.eq(so[1], 'wizard', 'canon never waits on the rotation');
  assert.eq(so.length, 5, 'then three NEW; no duplicates stand');
  // The modal reads the offer, never the whole catalogue.
  const start = SCENE_SRC.indexOf('  presentWreckRestoreModal(sx, sy, house) {');
  const src = SCENE_SRC.slice(start, SCENE_SRC.indexOf('\n  }\n', start));
  assert.truthy(/const options = Houses\.offerCards\(this\.save, house\);/.test(src), 'the cards are the offer');
});

test('buildOptions: the T1 Blacksmith card is suggested until the lane has a smithy', () => {
  const by = (save, key, order = 9) => Houses.buildOptions(save, plainHouse, order).find((r) => r.key === key);
  assert.truthy(by({ restoredHouses: {} }, 'blacksmith:1').suggested({ restoredHouses: {} }));
  const five = { restoredHouses: {}, discovered: { a: 1, b: 1, c: 1, d: 1, e: 1 } };
  assert.falsy(by(five, 'blacksmith:2').suggested(five), 'only the T1 card');
  assert.falsy(by({ restoredHouses: { a: 'blacksmith' } }, 'blacksmith:1').suggested({ restoredHouses: { a: 'blacksmith' } }));
  assert.falsy(by({ restoredHouses: {} }, 'blacksmith:1').suggested({ starterBlacksmithId: 'a' }));
});

test('restoreAs: freezes the pick, stamps what it owns, refuses what is not in the catalogue', () => {
  const save = { restoredHouses: {} };
  const h = (id) => ({ kind: 'house', tier: 9, id });
  assert.eq(Houses.restoreAs(save, h('a'), 'blacksmith:1'), null, 'not offered on the first restore');
  assert.eq(save.restoredHouses.a, undefined, 'and nothing was written');
  assert.eq(Houses.restoreAs(save, h('a'), 'plain').key, 'plain');
  assert.eq(save.restoredHouses.a, 'plain', 'the role string, never a bare true');
  assert.eq(Houses.restoreAs(save, h('b'), 'blacksmith:1').role, 'blacksmith');
  assert.eq(save.starterBlacksmithId, 'b', 'the first smithy is the wooden-tool forge');
  assert.eq(save.shopTiers.b, 1, 'its rank is stamped');
  assert.eq(Houses.restoreAs(save, h('b2'), 'blacksmith:1').role, 'blacksmith', 'a second T1 smithy may stand at once');
  assert.eq(save.starterBlacksmithId, 'b', 'and is not the wooden-tool forge');
  assert.eq(Houses.restoreAs(save, h('c'), 'blacksmith:2'), null, 'a T2 smithy waits for five memories');
  for (let i = 3; i < 9; i++) Houses.restoreAs(save, h('p' + i), 'plain');
  assert.eq(Houses.restoredCount(save), 9);
  assert.eq(Houses.restoreAs(save, h('c'), 'blacksmith:2'), null, 'however many wrecks stand');
  save.discovered = { a: 1, b: 1, c: 1, d: 1, e: 1 };
  assert.eq(Houses.restoreAs(save, h('c'), 'blacksmith:2').role, 'blacksmith');
  assert.eq(Shops.smithTier(save, h('c')), 2, 'and is tier 2, off the stamp');
  assert.eq(Shops.shopTier(save, h('b2'), 'blacksmith'), 1, 'the second T1 smithy stays T1');
  assert.eq(Houses.restoreAs(save, h('a'), 'market:seed:1'), null, 'a restored house is never relabelled');
  assert.eq(save.restoredHouses.a, 'plain');
  assert.eq(Houses.restoreAs(save, h('m'), 'market:seed:2').theme, 'seed');
  assert.eq(save.shopLines.m, 'seed'); assert.eq(save.shopTiers.m, 2, 'a shop stamps its line and rank');
  assert.eq(JSON.stringify(Shops.lineFor(save, h('m'))), JSON.stringify({ theme: 'seed', tier: 2 }));
  assert.eq(Houses.restoreAs(save, h('x'), 'market:seed:4'), null, 'no such rank for the Seed line');
  for (let i = 11; i < 14; i++) Houses.restoreAs(save, h('f' + i), 'plain');
  assert.eq(Houses.restoredCount(save), 14);
  assert.eq(Houses.restoreAs(save, h('book'), 'bookshop').key, 'bookshop');
  assert.eq(save.restoredHouses.book, 'market');
  assert.eq(save.bookshopId, 'book');
  assert.eq(Houses.restoreAs(save, h('book2'), 'bookshop'), null, 'once per save');
  assert.eq(Houses.restoreAs(save, h('t'), 'turret').role, 'turret');
  assert.eq(Houses.restoreAs(save, h('t2'), 'turret').role, 'turret', 'any number of turrets');
  assert.eq(Houses.displayRole(save, h('t')), 'turret', 'every surface reads the pick');
  assert.eq(Houses.houseShopRole(save, h('book')), 'market');
});

// ── Shop charm ───────────────────────────────────────────────────────────────

test('shopCharmMul: 0.5 while an unexpired charm is on the house, else 1', () => {
  const now = 1_000_000;
  const save = { shopCharm: { h1: now + 5000 } };
  assert.eq(Houses.shopCharmMul(save, { id: 'h1' }, now), 0.5, 'charm still running');
  assert.eq(Houses.shopCharmMul(save, { id: 'h1' }, now + 6000), 1, 'expired');
  assert.eq(Houses.shopCharmMul(save, { id: 'h2' }, now), 1, 'a different house has none');
  assert.eq(Houses.shopCharmMul({}, { id: 'h1' }, now), 1, 'no shopCharm table at all');
  assert.eq(Houses.shopCharmMul(save, null, now), 1, 'no house');
});

// ── Wreck detection + restore cost ──────────────────────────────────────────

test('isHouseWreck: a plain tier-9 house not yet restored and not Home', () => {
  assert.truthy(Houses.isHouseWreck({}, { kind: 'house', tier: 9, id: 'h1' }));
  assert.falsy(Houses.isHouseWreck({}, { kind: 'house', tier: 11, id: 'h1' }), 'a fort, not a wreck');
  assert.falsy(Houses.isHouseWreck({}, { kind: 'house', tier: 12, id: 'h1' }), 'a castle, not a wreck');
  assert.falsy(Houses.isHouseWreck({}, { kind: 'tower', tier: 9, id: 'h1' }), 'not even a house');
  assert.falsy(Houses.isHouseWreck({ starterShopId: 'h1' }, { kind: 'house', tier: 9, id: 'h1' }), 'Home is never a wreck');
  assert.falsy(Houses.isHouseWreck({ restoredHouses: { h1: 'trader' } }, { kind: 'house', tier: 9, id: 'h1' }), 'already restored');
});

test('wreckRestoreCost: rockfruit, stepping with how many houses are already restored', () => {
  assert.eq(Houses.wreckRestoreCost({}, {}).qty, wreckRestoreQty(0), 'first rebuild');
  assert.eq(Houses.wreckRestoreCost({ restoredHouses: { a: 'trader', b: 'plain' } }, {}).qty, wreckRestoreQty(2));
  const cost = Houses.wreckRestoreCost({}, {});
  assert.eq(cost.id, 'rubble');
  assert.eq(cost.material, 'stone');
});

// ── Fort unlock ladder + lock ────────────────────────────────────────────────

test('fortUnlockCost: START + STEP per fort already unsealed, capped at the ceiling', () => {
  assert.eq(Houses.fortUnlockCost({}), FORT_UNLOCK_WOOD_START, 'the first fort');
  assert.eq(Houses.fortUnlockCost({ unlockedForts: { a: true } }), FORT_UNLOCK_WOOD_START + FORT_UNLOCK_WOOD_STEP);
  assert.eq(Houses.fortUnlockCost({ unlockedForts: { a: true, b: true } }), FORT_UNLOCK_WOOD_START + 2 * FORT_UNLOCK_WOOD_STEP);
  // Enough already-unsealed forts to blow past the ceiling.
  const many = {};
  for (let i = 0; i < 20; i++) many['f' + i] = true;
  assert.eq(Houses.fortUnlockCost({ unlockedForts: many }), FORT_UNLOCK_WOOD, 'capped');
});

test('isFortLocked: a tier-11 fort not yet in unlockedForts', () => {
  assert.truthy(Houses.isFortLocked({}, { tier: 11, id: 'f1' }));
  assert.falsy(Houses.isFortLocked({ unlockedForts: { f1: true } }, { tier: 11, id: 'f1' }), 'already unsealed');
  assert.falsy(Houses.isFortLocked({}, { tier: 9, id: 'f1' }), 'not a fort');
  assert.falsy(Houses.isFortLocked({}, null), 'no house');
});

// ── Castle identity, sealing and claiming ───────────────────────────────────

test('castleKey: the footprint key stamped on the turret, or null', () => {
  assert.eq(Houses.castleKey({ castle: 'b_1_1' }), 'b_1_1');
  assert.eq(Houses.castleKey({}), null);
  assert.eq(Houses.castleKey(null), null);
});

test('isBuildingSealed: a castle is sealed until claimed', () => {
  const tower = { kind: 'tower', castle: 'b_1_1', tier: 12, id: 'tw_1' };
  assert.truthy(Houses.isBuildingSealed({}, tower), 'freshly generated: sealed');
  assert.falsy(Houses.isBuildingSealed({}, { kind: 'house', tier: 9 }), 'not a castle at all');
  assert.truthy(Houses.isBuildingSealed({ castlesLegacyOpen: true }, tower), 'retired global flag grants no access');
  assert.truthy(Houses.isBuildingSealed({ openedCastles: { tw_1: true } }, tower), 'retired delivery flag grants no access');
  const claimed = {};
  Houses.claimCastle(claimed, tower);
  assert.falsy(Houses.isBuildingSealed(claimed, tower), 'claimed outright');
});

test('isCastleClaimed / claimCastle: idempotent, presence not truthiness, non-castles refused', () => {
  const save = {};
  const tower = { kind: 'tower', castle: 'b_1_1' };
  assert.falsy(Houses.isCastleClaimed(save, tower), 'nothing claimed yet');
  assert.truthy(Houses.claimCastle(save, tower), 'the claim took');
  assert.falsy(Houses.claimCastle(save, tower), 'a second claim is a no-op');
  assert.truthy(Houses.isCastleClaimed(save, tower), 'still claimed');
  assert.eq(save.claimedCastles['b_1_1'], 0, 'stored as never-drawn (falsy value)');
  assert.truthy(Houses.isCastleClaimed(save, tower), 'presence, not truthiness');
  assert.falsy(Houses.claimCastle({}, { kind: 'house', id: 'h1' }), 'no castle key: refused');
  assert.falsy(Houses.isCastleClaimed({}, { kind: 'house', id: 'h1' }), 'and stays unclaimed');
  assert.falsy(Houses.isCastleClaimed({}, null), 'nor does nothing');
});

test('castleServiceUsed / markCastleServiceUsed: once per castle per twelve hours', () => {
  const save = {};
  const tower = { castle: 'b_1_1' };
  const H = 60 * 60 * 1000;
  const t0 = Date.parse('2026-09-26T12:00:00Z');
  assert.eq(Houses.CASTLE_SERVICE_MS, 12 * H, 'twelve hours');
  assert.falsy(Houses.castleServiceUsed(save, tower, t0), 'not used yet');
  assert.eq(Houses.castleServiceWaitMs(save, tower, t0), 0, 'no wait to print');
  Houses.markCastleServiceUsed(save, tower, t0);
  assert.eq(save.castleServiceClaimed['b_1_1'], t0, 'stamped with the moment, not a day key');
  assert.truthy(Houses.castleServiceUsed(save, tower, t0), 'used now');
  assert.eq(Houses.castleServiceWaitMs(save, tower, t0 + 5 * H), 7 * H, 'five hours on: seven to go');
  assert.truthy(Houses.castleServiceUsed(save, tower, t0 + 12 * H - 1), 'a millisecond short: still spent');
  assert.falsy(Houses.castleServiceUsed(save, tower, t0 + 12 * H), 'twelve hours on: pours again');
  assert.eq(Houses.castleServiceWaitMs(save, tower, t0 + 20 * H), 0, 'and the wait never goes negative');
});

test('markCastleServiceUsed: prunes every OTHER castle\'s spent stamp, keeps a live one', () => {
  const H = 60 * 60 * 1000;
  const now = Date.parse('2026-09-26T12:00:00Z');
  const save = { castleServiceClaimed: { old_castle: now - 13 * H, live_castle: now - 3 * H, legacy_castle: '20000101' } };
  Houses.markCastleServiceUsed(save, { castle: 'b_1_1' }, now);
  assert.falsy('old_castle' in save.castleServiceClaimed, 'spent stamp pruned');
  assert.falsy('legacy_castle' in save.castleServiceClaimed, 'a non-numeric stamp is no stamp, pruned too');
  assert.truthy('live_castle' in save.castleServiceClaimed, 'a castle still owed nine hours keeps its stamp');
  assert.truthy('b_1_1' in save.castleServiceClaimed, 'the current one kept');
});

test('castleServiceUsed / markCastleServiceUsed: no castle key is a silent no-op', () => {
  const save = {};
  assert.falsy(Houses.castleServiceUsed(save, { kind: 'house' }), 'not a castle');
  Houses.markCastleServiceUsed(save, { kind: 'house' });
  assert.falsy(save.castleServiceClaimed, 'nothing written');
});

// ── isClaimedKey: every way a building can become yours ─────────────────────

test('isClaimedKey: Home, a rebuilt wreck, an unsealed fort, a claimed castle', () => {
  assert.falsy(Houses.isClaimedKey({}, 'h1'), 'nothing claimed');
  assert.falsy(Houses.isClaimedKey({}, null), 'no key at all');
  assert.truthy(Houses.isClaimedKey({ starterShopId: 'h1' }, 'h1'), 'Home');
  assert.truthy(Houses.isClaimedKey({ restoredHouses: { h1: 'trader' } }, 'h1'), 'rebuilt wreck');
  assert.truthy(Houses.isClaimedKey({ unlockedForts: { f1: true } }, 'f1'), 'unsealed fort');
  assert.truthy(Houses.isClaimedKey({ claimedCastles: { c1: 0 } }, 'c1'), 'claimed castle, presence not truthiness');
  assert.falsy(Houses.isClaimedKey({ restoredHouses: { h1: 'trader' } }, 'h2'), 'a different key');
});
