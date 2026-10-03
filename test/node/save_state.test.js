// Current-save initialization and runtime normalization.

test('save state: backfills relic / armor / progression defaults on an empty save', () => {
  const save = {};
  SaveState.normalize(save);
  for (const slot of ['pick', 'axe', 'sword', 'bow', 'staff', 'can', 'hoe', 'bugnet', 'rod', 'bags']) {
    assert.truthy(slot in save.relics, 'relic slot ' + slot + ' present');
  }
  for (const slot of ['helmet', 'chest', 'legs', 'boots']) {
    assert.truthy(slot in save.armor, 'armor slot ' + slot + ' present');
  }
  assert.eq(save.deliveryCount, 0);
  assert.eq(typeof save.restoredHouses, 'object');
  assert.eq(save.activeWeapon, null, 'a fresh save has no active weapon yet');
});

test('save state: re-derives maxEnergy from armor and clamps energy into range', () => {
  const save = { energy: 9999, armor: {} };
  SaveState.normalize(save);
  assert.eq(save.maxEnergy, 100, 'empty armor → 100 base');
  assert.eq(save.energy, 100, 'over-cap energy clamped down');
  const fresh = { armor: {} };               // no energy at all
  SaveState.normalize(fresh);
  assert.eq(fresh.energy, 100, 'missing energy filled to max');
});

test('save state: a save with no memories field gets 0; junk is healed', () => {
  const fresh = {};
  SaveState.normalize(fresh);
  assert.eq(fresh.memories, 0);
  const junk = { memories: -4 };
  SaveState.normalize(junk);
  assert.eq(junk.memories, 0);
});

test('save state: history fields are capped at 5000 most-recent entries', () => {
  const big = Array.from({ length: 6000 }, (_, i) => 'id' + i);
  const save = { opened: big.slice() };
  SaveState.normalize(save);
  assert.eq(save.opened.length, 5000, 'capped');
  assert.eq(save.opened[0], 'id1000', 'kept the most-recent tail');
  assert.eq(save.opened[4999], 'id5999');
});

test('save state: placedRocks is exempt from the HISTORY_CAP trim (live map content)', () => {
  // A placed rockfruit stone is live, rendered map content — trimming it would
  // silently delete a rock the player put down, not just forget history the
  // way an old opened chest or broken rock does.
  const big = Array.from({ length: 6000 }, (_, i) => 'rock' + i);
  const save = { placedRocks: big.slice(), brokenRocks: big.slice() };
  SaveState.normalize(save);
  assert.eq(save.placedRocks.length, 6000, 'placedRocks left uncapped');
  assert.eq(save.brokenRocks.length, 5000, 'brokenRocks still capped, same as before');
});

test('save state: GCs stale save.shopState entries via ShopsMath (guarded, runs when loaded)', () => {
  // ShopsMath IS loaded in this bundle (shops_math.js loads before
  // save_state.test.js runs), so the runtime guard in normalize() should fire
  // and prune any entry whose stored bucket no longer matches.
  const staleHouse = { id: 'sm-stale' };
  const save = {};
  ShopsMath.bucketState(save, staleHouse, 0);   // seed a bucket-0 record
  assert.truthy(save.shopState['sm-stale'], 'seeded before normalization');
  // normalize() with no `now` runs the GC at Date.now() — well past bucket 0
  // for real wall-clock time, so the stale seed gets pruned.
  SaveState.normalize(save);
  assert.falsy(save.shopState['sm-stale'], 'stale shopState entry pruned by normalize()');
});

test('save state: chopped self-heal strips falsy ids (id-less tree bug)', () => {
  const save = { chopped: ['t1', undefined, 't2', null, ''] };
  SaveState.normalize(save);
  assert.eq(JSON.stringify(save.chopped), JSON.stringify(['t1', 't2']), 'only real ids survive');
});

test('save state: a date already on the save is never rewritten', () => {
  const save = { startedAt: 12345 };
  SaveState.normalize(save);
  assert.eq(save.startedAt, 12345, 'the save keeps the day it started');
  // Including across a session where the player has since played.
  const veteran = { startedAt: 999, tilled: ['1,1'] };
  SaveState.normalize(veteran);
  assert.eq(veteran.startedAt, 999, 'playing does not re-date it');
});

test('save state: a settled flag is never rewritten', () => {
  // The harvest site wrote true — playing on (or not) must not flip it back…
  const harvested = { hasHarvested: true };
  SaveState.normalize(harvested);
  assert.eq(harvested.hasHarvested, true, 'true stays true');
  // …and a save settled false that has since played-but-not-harvested keeps
  // its grace: the backfill is only for saves the flag has never reached.
  const midLadder = { hasHarvested: false, tilled: ['1,1'] };
  SaveState.normalize(midLadder);
  assert.eq(midLadder.hasHarvested, false, 'tilling is not harvesting');
});

test('save state: a save already on the metres ladder is left alone', () => {
  const save = { trail: { metres: 137.5, prizes: 2 }, streets: { '14/1/2': { 'a:1': [0, 40] } } };
  SaveState.normalize(save);
  assert.eq(save.trail.metres, 137.5, 'the fractional total is untouched');
  assert.eq(save.trail.prizes, 2, 'and the prizes');
  assert.eq(Streets.totalM(Streets.restoredList(save, '14/1/2', 'a:1')), 40,
    'and the streets already restored stay restored');
});

test('save state: a fresh save starts on the first rung with nothing restored', () => {
  const save = {};
  SaveState.normalize(save);
  assert.eq(save.trail.metres, 0, 'no metres');
  assert.eq(save.trail.prizes, 0, 'no prizes');
  assert.eq(Trail.goalFor(save.trail.prizes), Trail.GOAL_STEP_M, 'and the first goal ahead');
  assert.eq(typeof save.streets, 'object', 'the streets map exists');
  assert.eq(Streets.epoch(save), 0, 'and its epoch starts at zero');
});

test('save state: a hand-edited trail row is repaired rather than trusted', () => {
  // A NaN total would poison every readout the ladder draws; a junk trail
  // object would crash the first bank.
  const junk = { trail: { metres: 'lots', prizes: null } };
  SaveState.normalize(junk);
  assert.eq(junk.trail.metres, 0, 'a non-number total reads as nothing banked');
  assert.eq(junk.trail.prizes, 0, 'and so do the prizes');
  const notObj = { trail: 5, streets: 'nope' };
  SaveState.normalize(notObj);
  assert.eq(notObj.trail.metres, 0, 'a trail that is not an object is replaced');
  assert.eq(typeof notObj.streets, 'object', 'and so is a streets map that is not one');
});

test('save state: first-session fields initialize once without a schema stamp', () => {
  const save = {};
  const now = Date.now();
  assert.truthy(SaveState.normalize(save));
  assert.gte(save.startedAt, now);
  assert.eq(save.hasHarvested, false);
  assert.eq(save.trail.greeted, false);
  assert.eq(save.schema, undefined);
  assert.falsy(SaveState.normalize(save));
});

test('save state: retired data is not converted into current progress', () => {
  const save = { money: 10, relics: { ring: { tier: 5 }, amulet: { tier: 4 } },
    inv: [{ id: 'flute', count: 1 }, { id: 'discovery', count: 4 }],
    opened: ['c_1_2_3_4'], trail: { stones: 10 }, quests: { step: 3 } };
  const bag = save.inv;
  SaveState.normalize(save);
  assert.eq(save.inv, bag, 'no bag rewriting');
  assert.eq(save.money, 10, 'no retired gear refunds');
  assert.eq(save.luckUpgrades, 0);
  assert.eq(save.memories, 0);
  assert.eq(save.trail.metres, 0);
  assert.eq(Object.keys(save.coinBurstClaimed).length, 0, 'seeded empty (SAVE_DEFAULTS), no take invented');
  assert.eq(Object.keys(save.foundWild).length, 0, 'ownership does not imply a wild find');
  Quests.board(save);
  assert.eq(save.quests.done, 0, 'no retired quest progress transfer');
  assert.falsy(save.castlesLegacyOpen);
});
