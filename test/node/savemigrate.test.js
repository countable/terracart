// Headless tests for the save-migration core (src/savemigrate.js) — the
// one-time save-shape migrations extracted from MapScene.create().

test('migrate: backfills relic / armor / progression defaults on an empty save', () => {
  const save = {};
  SaveMigrate.migrate(save);
  for (const slot of ['pick', 'axe', 'ring', 'amulet', 'sword', 'bow', 'staff', 'can', 'hoe', 'bugnet', 'rod', 'bags']) {
    assert.truthy(slot in save.relics, 'relic slot ' + slot + ' present');
  }
  for (const slot of ['helmet', 'chest', 'legs', 'boots']) {
    assert.truthy(slot in save.armor, 'armor slot ' + slot + ' present');
  }
  assert.eq(save.deliveryCount, 0);
  assert.eq(typeof save.houseSatisfied, 'object');
  assert.eq(typeof save.restoredHouses, 'object');
  assert.eq(save.activeWeapon, null, 'a fresh save has no active weapon yet');
});

test('migrate: backfills activeWeapon for a veteran save that predates weapon selection', () => {
  // Older saves had every owned weapon fighting at once; default to sword (the
  // one that used to auto-engage regardless of what else was carried) so a
  // veteran's combat behaviour doesn't change on this alone, falling back to
  // bow then staff for a save that never had a sword.
  const swordSave = { relics: { sword: { tier: 2 }, bow: { tier: 5 } } };
  SaveMigrate.migrate(swordSave);
  assert.eq(swordSave.activeWeapon, 'sword', 'sword wins when owned');
  const bowSave = { relics: { bow: { tier: 3 }, staff: { tier: 1 } } };
  SaveMigrate.migrate(bowSave);
  assert.eq(bowSave.activeWeapon, 'bow', 'bow wins over staff when no sword');
  const staffSave = { relics: { staff: { tier: 1 } } };
  SaveMigrate.migrate(staffSave);
  assert.eq(staffSave.activeWeapon, 'staff', 'staff is the last resort');
  // Already-migrated saves (or one that deliberately switched to bow) must not
  // be overridden back to sword just because a sword is also owned.
  const switched = { relics: { sword: { tier: 2 }, bow: { tier: 2 } }, activeWeapon: 'bow' };
  SaveMigrate.migrate(switched);
  assert.eq(switched.activeWeapon, 'bow', 'an existing choice is never overridden');
});

test('migrate: re-derives maxEnergy from armor and clamps energy into range', () => {
  const save = { energy: 9999, armor: {} };
  SaveMigrate.migrate(save);
  assert.eq(save.maxEnergy, 100, 'empty armor → 100 base');
  assert.eq(save.energy, 100, 'over-cap energy clamped down');
  const fresh = { armor: {} };               // no energy at all
  SaveMigrate.migrate(fresh);
  assert.eq(fresh.energy, 100, 'missing energy filled to max');
});

test('migrate: inv string-array → {id,count} objects', () => {
  const save = { inv: ['wood', 'coal', null, 'wood'] };
  const persist = SaveMigrate.migrate(save);
  assert.eq(persist, true, 'a real migration → persist');
  assert.truthy(save.inv.every((s) => s && typeof s === 'object' && typeof s.count === 'number'));
});

test('migrate: venison folds into meat (counts summed)', () => {
  const save = { inv: [{ id: 'venison', count: 3 }, { id: 'meat', count: 2 }, { id: 'wood', count: 1 }] };
  const persist = SaveMigrate.migrate(save);
  assert.eq(persist, true);
  const meat = save.inv.find((s) => s.id === 'meat');
  assert.eq(meat.count, 5, '3 venison + 2 meat');
  assert.falsy(save.inv.find((s) => s.id === 'venison'), 'venison gone');
  assert.truthy(save.inv.find((s) => s.id === 'wood'), 'unrelated stack kept');
});

test('migrate: golden_<kind> folds into shiny_<kind>; goldenfish untouched', () => {
  const save = { inv: [
    { id: 'golden_cow', count: 1 }, { id: 'shiny_cow', count: 2 }, { id: 'goldenfish', count: 4 },
  ] };
  SaveMigrate.migrate(save);
  const shinyCow = save.inv.find((s) => s.id === 'shiny_cow');
  assert.eq(shinyCow.count, 3, '1 golden_cow + 2 shiny_cow');
  assert.falsy(save.inv.find((s) => s.id === 'golden_cow'), 'golden_cow renamed away');
  assert.truthy(save.inv.find((s) => s.id === 'goldenfish'), 'goldenfish (no underscore) preserved');
});

test('migrate: released animals carry the golden flag over to shiny', () => {
  const save = { released: [{ kind: 'cow', golden: true }, { kind: 'dog' }] };
  SaveMigrate.migrate(save);
  assert.eq(save.released[0].shiny, true, 'golden → shiny');
  assert.falsy('golden' in save.released[0], 'old flag removed');
  assert.falsy('shiny' in save.released[1], 'untagged animal unchanged');
});

test('migrate: strips a free WOODEN pick/axe once, leaves upgraded tools', () => {
  const save = { relics: { pick: { tier: 1 }, axe: { tier: 3 } } };
  SaveMigrate.migrate(save);
  assert.eq(save.relics.pick, null, 'tier-1 pick stripped');
  assert.eq(save.relics.axe.tier, 3, 'tier-3 axe earned → kept');
  assert.eq(save.starterToolsStripped, true, 'gated so it never re-strips');
  // A re-forged wooden pick on an already-stripped save survives.
  save.relics.pick = { tier: 1 };
  SaveMigrate.migrate(save);
  assert.eq(save.relics.pick.tier, 1, 're-forged wooden tool not re-wiped');
});

test('migrate: history fields are capped at 5000 most-recent entries', () => {
  const big = Array.from({ length: 6000 }, (_, i) => 'id' + i);
  const save = { opened: big.slice() };
  SaveMigrate.migrate(save);
  assert.eq(save.opened.length, 5000, 'capped');
  assert.eq(save.opened[0], 'id1000', 'kept the most-recent tail');
  assert.eq(save.opened[4999], 'id5999');
});

test('migrate: placedRocks is exempt from the HISTORY_CAP trim (live map content)', () => {
  // A placed rockfruit stone is live, rendered map content — trimming it would
  // silently delete a rock the player put down, not just forget history the
  // way an old opened chest or broken rock does.
  const big = Array.from({ length: 6000 }, (_, i) => 'rock' + i);
  const save = { placedRocks: big.slice(), brokenRocks: big.slice() };
  SaveMigrate.migrate(save);
  assert.eq(save.placedRocks.length, 6000, 'placedRocks left uncapped');
  assert.eq(save.brokenRocks.length, 5000, 'brokenRocks still capped, same as before');
});

test('migrate: GCs stale save.shopState entries via ShopsMath (guarded, runs when loaded)', () => {
  // ShopsMath IS loaded in this bundle (shops_math.js loads before
  // savemigrate.test.js runs), so the runtime guard in migrate() should fire
  // and prune any entry whose stored bucket no longer matches.
  const staleHouse = { id: 'sm-stale' };
  const save = {};
  ShopsMath.bucketState(save, staleHouse, 0);   // seed a bucket-0 record
  assert.truthy(save.shopState['sm-stale'], 'seeded before migrate');
  // migrate() with no `now` runs the GC at Date.now() — well past bucket 0
  // for real wall-clock time, so the stale seed gets pruned.
  SaveMigrate.migrate(save);
  assert.falsy(save.shopState['sm-stale'], 'stale shopState entry pruned by migrate()');
});

test('migrate: chopped self-heal strips falsy ids (id-less tree bug)', () => {
  const save = { chopped: ['t1', undefined, 't2', null, ''] };
  SaveMigrate.migrate(save);
  assert.eq(JSON.stringify(save.chopped), JSON.stringify(['t1', 't2']), 'only real ids survive');
});

test('migrate: the discovery counter folds into a cap-exempt badge stack', () => {
  // 14 banked points on a no-bag save: every one must survive (capExempt).
  const save = { inv: [{ id: 'wood', count: 2 }], discovery: 14, relics: {} };
  const persist = SaveMigrate.migrate(save);
  assert.eq(persist, true, 'counter→stack is a real migration → persist');
  assert.eq(Inventory.count(save, 'discovery'), 14, 'all points kept past the bag cap');
  assert.eq('discovery' in save, false, 'legacy counter field dropped');
  // Second run: field is gone → idempotent, stack untouched.
  SaveMigrate.migrate(save);
  assert.eq(Inventory.count(save, 'discovery'), 14, 'no double-grant on re-migrate');
  // A zero counter is dropped without creating a stack.
  const zero = { inv: [], discovery: 0 };
  SaveMigrate.migrate(zero);
  assert.eq('discovery' in zero, false, 'zero counter dropped');
  assert.eq(zero.inv.find((s) => s.id === 'discovery'), undefined, 'no empty badge stack');
});

// ── Dating a save ───────────────────────────────────────────────────────────
// Nothing reads startedAt today (the pest amnesty that used to now reads
// hasHarvested, below), but a date can only be stamped honestly once, so the
// stamping stays and stays pinned: a save that predates the field must never
// look freshly started.

test('migrate: a brand-new save is dated now', () => {
  const save = {};
  const before = Date.now();
  assert.truthy(SaveMigrate.migrate(save), 'stamping is real data — it persists');
  assert.gte(save.startedAt, before, 'dated at load');
  assert.falsy(save.startedAt > Date.now(), 'and not in the future');
});

test('migrate: a save that has been PLAYED is dated to the past, not to today', () => {
  // The bug this guards: stamping every undated save with today's date gives a
  // veteran a permanent first day — a fresh grace period on every load.
  for (const played of [{ tilled: ['1,1'] }, { planted: [{}] }, { opened: ['chest_1'] },
                        { restoredHouses: { h1: 1 } }, { money: 999 }]) {
    const save = { ...played };
    SaveMigrate.migrate(save);
    assert.eq(save.startedAt, 0, `a save with ${Object.keys(played)[0]} is dated long past`);
  }
});

test('migrate: a date already on the save is never rewritten', () => {
  const save = { startedAt: 12345 };
  SaveMigrate.migrate(save);
  assert.eq(save.startedAt, 12345, 'the save keeps the day it started');
  // Including across a session where the player has since played.
  const veteran = { startedAt: 999, tilled: ['1,1'] };
  SaveMigrate.migrate(veteran);
  assert.eq(veteran.startedAt, 999, 'playing does not re-date it');
});

// ── Settling hasHarvested (the pest amnesty's off-switch) ───────────────────
// app.js keeps the starting area free of slimes and crows until the save's
// first crop is harvested (interact.js stamps save.hasHarvested = true at the
// harvest site). A save that predates the flag can't be asked directly, so
// migration settles it once: a PLAYED save is assumed past its first harvest —
// a veteran must never wake up to a pest-free home.

test('migrate: a brand-new save still has its first harvest (and the amnesty) ahead', () => {
  const save = {};
  assert.truthy(SaveMigrate.migrate(save), 'settling the flag is real data — it persists');
  assert.eq(save.hasHarvested, false, 'not harvested yet');
});

test('migrate: a PLAYED legacy save is treated as already past its first harvest', () => {
  for (const played of [{ tilled: ['1,1'] }, { planted: [{}] }, { opened: ['chest_1'] },
                        { restoredHouses: { h1: 1 } }, { money: 999 }]) {
    const save = { ...played };
    SaveMigrate.migrate(save);
    assert.eq(save.hasHarvested, true,
      `a save with ${Object.keys(played)[0]} gets no retroactive amnesty`);
  }
});

test('migrate: a settled flag is never rewritten', () => {
  // The harvest site wrote true — playing on (or not) must not flip it back…
  const harvested = { hasHarvested: true };
  SaveMigrate.migrate(harvested);
  assert.eq(harvested.hasHarvested, true, 'true stays true');
  // …and a save settled false that has since played-but-not-harvested keeps
  // its grace: the backfill is only for saves the flag has never reached.
  const midLadder = { hasHarvested: false, tilled: ['1,1'] };
  SaveMigrate.migrate(midLadder);
  assert.eq(midLadder.hasHarvested, false, 'tilling is not harvesting');
});

test('hasPlayed: the tells are marks only a player could leave', () => {
  assert.falsy(SaveMigrate.hasPlayed({}), 'an empty save has not been played');
  assert.falsy(SaveMigrate.hasPlayed(null), 'nor a missing one');
  assert.falsy(SaveMigrate.hasPlayed({ tilled: [], planted: [], opened: [] }),
    'nor one with the fields present but empty');
  assert.truthy(SaveMigrate.hasPlayed({ tilled: ['1,1'] }), 'broken ground');
  assert.truthy(SaveMigrate.hasPlayed({ opened: ['c'] }), 'an opened chest');
  assert.truthy(SaveMigrate.hasPlayed({ restoredHouses: { h: 1 } }), 'a restored neighbour');
});

// ── Cobble trails: per-path counters → one ladder ─────────────────────────
test('migrate: folds the old per-path trail rows into a flat lit list', () => {
  // The old shape carried a counter, a prize count and a done flag per NAMED
  // WAY per tile. All that survives is which stones are lit.
  const save = {
    pathStones: {
      '14/1/2': {
        'Mill Lane':  { stones: ['3_4', '4_4'], prizes: 1, done: false },
        'Oak Street': { stones: ['4_4', '9_9'], prizes: 0, done: false },
        'Done Road':  { stones: [], prizes: 2, done: true },
      },
      '14/1/3': { 'Long Walk': { stones: ['1_1'], prizes: 0, done: false } },
    },
  };
  assert.truthy(SaveMigrate.migrate(save), 'a real migration forces a persist');
  assert.truthy(Array.isArray(save.pathStones['14/1/2']), 'the tile is a flat list now');
  assert.eq(save.pathStones['14/1/2'].sort().join(','), '3_4,4_4,9_9',
    'every lit cell survives, once each');
  assert.eq(save.pathStones['14/1/3'].join(','), '1_1', 'and other tiles too');
  // Prizes are NOT carried: they were won on a different rule (a cul-de-sac
  // paid what a high street did), so carrying them would hand a veteran a
  // 400-stone first goal for walks nobody asked them to make.
  assert.eq(save.trail.prizes, 0, 'everyone starts at the first rung');
  assert.eq(save.trail.stones, 0, 'with nothing banked');
});

test('migrate: a save already on the ladder is left alone', () => {
  const save = { pathStones: { '14/1/2': ['3_4'] }, trail: { stones: 6, prizes: 2 } };
  SaveMigrate.migrate(save);
  assert.eq(save.pathStones['14/1/2'].join(','), '3_4', 'the list is untouched');
  assert.eq(save.trail.stones, 6, 'and so is the count');
  assert.eq(save.trail.prizes, 2, 'and the prizes');
});

test('migrate: a fresh save starts on the first rung', () => {
  const save = {};
  SaveMigrate.migrate(save);
  assert.eq(save.trail.stones, 0, 'no stones');
  assert.eq(save.trail.prizes, 0, 'no prizes');
  assert.eq(Trail.goalFor(save.trail.prizes), Trail.GOAL_STEP, 'and the first goal ahead');
});
