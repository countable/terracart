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

test('buildOptions: the cards unlock by how many wrecks already stand', () => {
  const from = Object.fromEntries(Houses.BUILD_OPTIONS.map((r) => [r.key, r.from]));
  assert.eq(JSON.stringify(from), JSON.stringify({ plain: 1, blacksmith: 2, market: 3, trader: 5, turret: 8, bookshop: 15, wizard: 30 }), 'the ladder');
  const keys = (order) => Houses.buildOptions({ restoredHouses: {}, discovered: {} }, plainHouse, order).map((r) => r.key).join();
  assert.eq(keys(0), 'plain', 'the first restore is a House and nothing else');
  assert.eq(keys(1), 'plain,blacksmith', 'the second adds the smithy');
  assert.eq(keys(2), 'plain,blacksmith,market:seed', 'the third adds the Shop card, named for its line');
  assert.eq(keys(3), 'plain,blacksmith,market:seed', 'the fourth adds nothing');
  assert.eq(keys(4), 'plain,blacksmith,market:seed,trader');
  assert.eq(keys(7), 'plain,blacksmith,market:seed,trader,turret');
  assert.eq(keys(8), 'plain,blacksmith,market:seed,market:supply,trader,turret', 'the ninth: two Shop cards');
  assert.eq(keys(14), 'plain,blacksmith,market:seed,market:supply,trader,turret,bookshop');
  assert.eq(keys(29), 'plain,blacksmith,market:seed,market:supply,trader,turret,bookshop,wizard');
  assert.eq(Houses.buildOptions({ restoredHouses: {}, bookshopId: 'b' }, plainHouse, 20).map((r) => r.key).includes('bookshop'), false, 'one Book Shop per save');
  assert.eq(Houses.restoredCount({ restoredHouses: { a: 'plain', b: 'market' } }), 2, 'the order is the ledger\'s size');
  for (const row of Houses.BUILD_OPTIONS) {
    assert.truthy(row.blurb && row.art && row.role, `${row.key} carries its blurb, painting and role`);
  }
  assert.eq(Houses.buildOption('turret').role, 'turret');
  assert.eq(Houses.buildOption('bookshop').role, 'market', 'the Book Shop is stored as a market plus its stamp');
  assert.eq(Shops.roleLabel('turret'), 'Turret');
});

test('buildOptions: one smithy per tier, the next from restore number tier × 5', () => {
  const sm = Houses.buildOption('blacksmith');
  const save = { restoredHouses: { a: 'blacksmith' } };
  assert.eq(sm.tier(save, 5), 2, 'the next smithy would be tier 2');
  assert.falsy(sm.offered(save, 8), 'not at the ninth rebuild');
  assert.truthy(sm.offered(save, 9), 'the tenth may be the T2 smithy');
  assert.truthy(sm.offered(save, 40), 'and any later one');
  save.restoredHouses.b = 'blacksmith';
  assert.eq(sm.tier(save, 0), 3);
  assert.falsy(sm.offered(save, 13)); assert.truthy(sm.offered(save, 14), 'the fifteenth may be the T3 smithy');
  assert.truthy(sm.offered({ restoredHouses: {} }, 1), 'the first follows the ladder, not the five rule');
  for (const k of 'cdefg') save.restoredHouses[k] = 'blacksmith';
  assert.eq(Shops.smithCount(save), 7);
  assert.falsy(sm.offered(save, 500), 'seven tiers, seven smithies');
  assert.eq(Houses.buildOption('trader').tier({}, 4), 1, 'the fifth rebuild raises a T1 trader');
  assert.eq(Houses.buildOption('trader').tier({}, 9), 2, 'the tenth a T2');
  assert.eq(Houses.buildOption('trader').tier({}, 9), Shops.traderTierAt(10));
  assert.eq(Houses.buildOptions({ restoredHouses: {} }, plainHouse, 2).find((r) => r.key === 'market:seed').tier(), 1);
});

// WHAT EACH CARD COSTS (owner, Oct 2026): a House keeps the ladder, a shop
// pays stones per tier by its role, a turret a flat five.
test('buildCost: the House ladder, stones per tier for shops, a flat five for a turret', () => {
  const save = { restoredHouses: {} };
  const h = { kind: 'house', tier: 9, id: 'h' };
  const by = (key, order = 9) => Houses.buildOptions(save, h, order).find((r) => r.key === key);
  assert.eq(Houses.buildCost(save, h, by('plain')).qty, Houses.wreckRestoreCost(save, h).qty, 'a House is the ladder');
  assert.eq(Houses.buildCost(save, h, null).qty, Houses.wreckRestoreCost(save, h).qty, 'no card: the ladder');
  assert.eq(JSON.stringify(Houses.BUILD_ROCKS_PER_TIER), JSON.stringify({ trader: 2, market: 3, blacksmith: 4 }));
  assert.eq(Houses.TURRET_ROCKS, 5);
  assert.eq(Houses.buildCost(save, h, by('turret')).qty, 5, 'a turret is five, always');
  assert.eq(Houses.buildCost(save, h, by('blacksmith'), 9).qty, 4, 'the first smithy: 4 × tier 1');
  assert.falsy(Houses.buildOptions(save, h, 3).find((r) => r.key === 'trader'), 'no trader card before the fifth');
  assert.eq(Houses.buildCost(save, h, Houses.buildOptions(save, h, 4).find((r) => r.key === 'trader'), 4).qty, 2, 'a T1 trader: 2 × 1');
  assert.eq(Houses.buildCost(save, h, Houses.buildOptions(save, h, 9).find((r) => r.key === 'trader'), 9).qty, 4, 'a T2 trader: 2 × 2');
  const market = Houses.buildOptions(save, h, 2).find((r) => r.key === 'market:seed');
  assert.eq(Houses.buildCost(save, h, market, 2).qty, 3, 'a T1 shop line: 3 × 1');
  const smithy = { restoredHouses: { a: 'blacksmith' } };
  const sm2 = Houses.buildOptions(smithy, h, 9).find((r) => r.key === 'blacksmith');
  assert.eq(Houses.buildCost(smithy, h, sm2, 9).qty, 8, 'the second smithy is T2: 4 × 2');
  for (const c of [Houses.buildCost(save, h, by('turret')), Houses.buildCost(save, h, by('plain'))]) {
    assert.eq(c.id, 'rubble'); assert.eq(c.material, 'stone');
  }
});

test('buildOptions: the Blacksmith card is suggested until the lane has a smithy', () => {
  const sm = Houses.buildOption('blacksmith');
  assert.truthy(sm.suggested({ restoredHouses: {} }));
  assert.falsy(sm.suggested({ restoredHouses: { a: 'blacksmith' } }));
  assert.falsy(sm.suggested({ starterBlacksmithId: 'a' }));
});

test('restoreAs: freezes the pick, stamps what it owns, refuses what is not offered', () => {
  const save = { restoredHouses: {} };
  const h = (id) => ({ kind: 'house', tier: 9, id });
  assert.eq(Houses.restoreAs(save, h('a'), 'blacksmith'), null, 'not offered on the first restore');
  assert.eq(save.restoredHouses.a, undefined, 'and nothing was written');
  assert.eq(Houses.restoreAs(save, h('a'), 'plain').key, 'plain');
  assert.eq(save.restoredHouses.a, 'plain', 'the role string, never a bare true');
  assert.eq(Houses.restoreAs(save, h('b'), 'blacksmith').role, 'blacksmith');
  assert.eq(save.starterBlacksmithId, 'b', 'the first smithy is the wooden-tool forge');
  assert.eq(Houses.restoreAs(save, h('c'), 'blacksmith'), null, 'a second smithy waits for the tenth rebuild');
  for (let i = 2; i < 9; i++) Houses.restoreAs(save, h('p' + i), 'plain');
  assert.eq(Houses.restoreAs(save, h('c'), 'blacksmith').role, 'blacksmith');
  assert.eq(Shops.smithTier(save, h('c')), 2, 'and is tier 2');
  assert.eq(save.starterBlacksmithId, 'b', 'a second smithy is not the wooden-tool forge');
  assert.eq(Houses.restoreAs(save, h('a'), 'market:seed'), null, 'a restored house is never relabelled');
  assert.eq(save.restoredHouses.a, 'plain');
  for (let i = 10; i < 14; i++) Houses.restoreAs(save, h('f' + i), 'plain');
  assert.eq(Houses.restoredCount(save), 14);
  assert.eq(Houses.restoreAs(save, h('book'), 'bookshop').key, 'bookshop');
  assert.eq(save.restoredHouses.book, 'market');
  assert.eq(save.bookshopId, 'book');
  assert.eq(Houses.restoreAs(save, h('book2'), 'bookshop'), null, 'once per save');
  assert.eq(Houses.restoreAs(save, h('t'), 'turret').role, 'turret');
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
