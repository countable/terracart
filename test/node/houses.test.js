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

// ── Pre-seeded restore roles ─────────────────────────────────────────────────

test('preseedRestoreRole: the fixed opening run, then the address, and the wizard at 15', () => {
  assert.eq(JSON.stringify(Houses.PRESEED_RESTORE_ROLES),
    JSON.stringify({ 0: 'blacksmith', 1: 'trader', 2: 'plain', 3: 'market', 14: 'wizard' }),
    'the table itself');
  const save = { restoredHouses: { a: 'blacksmith' }, starterBlacksmithId: 'a' };
  assert.eq(Houses.preseedRestoreRole(save, 1, plainHouse), 'trader');
  assert.eq(Houses.preseedRestoreRole(save, 4, { kind: 'house', tier: 9, address: 16 }), 'market', 'rebuild 5 follows its address');
  assert.eq(Houses.preseedRestoreRole(save, 5, plainHouse), 'plain', 'a plain address stays plain');
  assert.eq(Houses.preseedRestoreRole(save, 14, plainHouse), 'wizard');
});

test('preseedRestoreRole: a save with no blacksmith gets one on its next rebuild', () => {
  const save = { restoredHouses: { a: 'trader', b: 'plain', c: true } };
  assert.eq(Houses.preseedRestoreRole(save, 3, plainHouse), 'blacksmith', 'whatever slot it is');
  assert.eq(Houses.preseedRestoreRole({ restoredHouses: {} }, 0, plainHouse), 'blacksmith', 'a new save: slot 0 anyway');
  const has = { restoredHouses: { a: 'trader', z: 'blacksmith' } };
  assert.eq(Houses.preseedRestoreRole(has, 3, plainHouse), 'market', 'once there is one, the run resumes');
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
  assert.eq(cost.id, 'rockfruit');
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

test('isBuildingSealed: a castle is sealed until claimed, legacy-opened, or old-gate-opened', () => {
  const tower = { kind: 'tower', castle: 'b_1_1', tier: 12, id: 'tw_1' };
  assert.truthy(Houses.isBuildingSealed({}, tower), 'freshly generated: sealed');
  assert.falsy(Houses.isBuildingSealed({}, { kind: 'house', tier: 9 }), 'not a castle at all');
  assert.falsy(Houses.isBuildingSealed({ castlesLegacyOpen: true }, tower), 'old three-quest chain finished');
  assert.falsy(Houses.isBuildingSealed({ openedCastles: { tw_1: true } }, tower), 'opened under the retired delivery gate');
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

test('castleServiceUsedToday / markCastleServiceUsed: once per castle per UTC day', () => {
  const save = {};
  const tower = { castle: 'b_1_1' };
  const day1 = new Date('2026-09-26T12:00:00Z');
  assert.falsy(Houses.castleServiceUsedToday(save, tower, day1), 'not used yet');
  Houses.markCastleServiceUsed(save, tower, day1);
  assert.truthy(Houses.castleServiceUsedToday(save, tower, day1), 'used today');
  const laterSameDay = new Date('2026-09-26T23:00:00Z');
  assert.truthy(Houses.castleServiceUsedToday(save, tower, laterSameDay), 'same UTC day, still used');
  const nextDay = new Date('2026-09-27T00:00:00Z');
  assert.falsy(Houses.castleServiceUsedToday(save, tower, nextDay), 'a new UTC day pours again');
});

test('markCastleServiceUsed: prunes every OTHER castle\'s stale day stamp', () => {
  const save = { castleServiceClaimed: { old_castle: '20000101' } };
  const day1 = new Date('2026-09-26T12:00:00Z');
  Houses.markCastleServiceUsed(save, { castle: 'b_1_1' }, day1);
  assert.falsy('old_castle' in save.castleServiceClaimed, 'stale stamp pruned');
  assert.truthy('b_1_1' in save.castleServiceClaimed, 'the current one kept');
});

test('castleServiceUsedToday / markCastleServiceUsed: no castle key is a silent no-op', () => {
  const save = {};
  assert.falsy(Houses.castleServiceUsedToday(save, { kind: 'house' }), 'not a castle');
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
