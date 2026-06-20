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
