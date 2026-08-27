// Headless tests for the energy core (src/energy.js) — cap / spend / offline-
// rest / tired-threshold math extracted from app.js's MapScene.

test('maxEnergy: armor-derived cap wins and is written back to save', () => {
  const save = { maxEnergy: 100, armor: { helmet: { tier: 3 } } };
  const cap = Energy.maxEnergy(save);
  assert.gt(cap, 100, 'armor raises the cap above the 100 base');
  assert.eq(save.maxEnergy, cap, 'cap written back so writers/UI agree');
});

test('maxEnergy: armor is the source of truth — empty armor = 100 base, written back', () => {
  // maxEnergyFromArmor always returns ≥ STARTING_ENERGY, so the cap is ALWAYS
  // armor-derived and overwrites any stored save.maxEnergy (the `?? maxEnergy`
  // fallback only matters if items.js isn't loaded). Pin that invariant.
  const save = { maxEnergy: 137, armor: {} };
  assert.eq(Energy.maxEnergy(save), 100, 'empty armor = STARTING_ENERGY (100)');
  assert.eq(save.maxEnergy, 100, 'stored max overwritten by the armor-derived cap');
});

test('maxEnergy: first-taste bonus — +1 per distinct edible in save.eaten', () => {
  const save = { armor: {}, eaten: ['potato', 'nut', 'berry'] };
  assert.eq(Energy.maxEnergy(save), 103, '3 tasted foods = +3 over the 100 base');
  assert.eq(save.maxEnergy, 103, 'bonus folded into the written-back cap');
  save.eaten.push('milk');
  assert.eq(Energy.maxEnergy(save), 104, 'a new taste grows the cap by 1');
  assert.eq(Energy.maxEnergy({ armor: {} }), 100, 'no eaten list = no bonus');
});

test('spend: success deducts and clamps at 0, reports before/spent', () => {
  const save = { energy: 50, maxEnergy: 100 };
  const r = Energy.spend(save, 30);
  assert.eq(r.ok, true);
  assert.eq(r.before, 50, 'before captured');
  assert.eq(r.spent, 30, 'spent reported');
  assert.eq(save.energy, 20, 'energy deducted');
});

test('spend: insufficient energy is a no-op (ok=false, no mutation)', () => {
  const save = { energy: 10, maxEnergy: 100 };
  const r = Energy.spend(save, 40);
  assert.eq(r.ok, false, 'cannot afford');
  assert.eq(save.energy, 10, 'energy untouched on failure');
});

test('spend: cost ≤ 0 is a free success that never touches energy', () => {
  const save = { energy: 10, maxEnergy: 100 };
  const r = Energy.spend(save, 0);
  assert.eq(r.ok, true);
  assert.eq(r.spent, 0, 'nothing spent');
  assert.eq(save.energy, 10, 'energy unchanged');
});

test('tiredThreshold: 30% of maxEnergy', () => {
  assert.eq(Energy.tiredThreshold({ maxEnergy: 200 }), 60);
  assert.eq(Energy.tiredThreshold({}), 30, 'defaults to 30% of 100');
});

test('crossedTired: true only when a drain dips below 30%', () => {
  const save = { maxEnergy: 100, energy: 25 };   // tired line = 30
  assert.eq(Energy.crossedTired(save, 35), true, '35 → 25 crosses the line');
  assert.eq(Energy.crossedTired(save, 28), false, 'already below before the drain');
  save.energy = 40;
  assert.eq(Energy.crossedTired(save, 80), false, 'stayed above the line');
});

test('crossedTired: a Potion of Reach silences the warning', () => {
  const save = { maxEnergy: 100, energy: 25, reachPotionUntil: Date.now() + 60000 };
  assert.eq(Energy.crossedTired(save, 35), false, 'potion pins reach → no tired warning');
});

test('applyOfflineRest: pro-rates the gap and clamps at the cap', () => {
  const FULL = Energy.OFFLINE_FULL_REST_MS;
  // Half an hour at a 100 cap → +50, but capped by headroom.
  const save = { energy: 20, maxEnergy: 100, armor: {} };
  const gained = Energy.applyOfflineRest(save, FULL / 2);
  assert.eq(gained, 50, 'half the full-rest window restores half the bar');
  assert.eq(save.energy, 70);
  // A long gap can only fill to the cap.
  const capped = Energy.applyOfflineRest({ energy: 90, maxEnergy: 100, armor: {} }, FULL * 5);
  assert.eq(capped, 10, 'clamped to remaining headroom');
});

test('applyOfflineRest: a zero/negative gap restores nothing', () => {
  const save = { energy: 20, maxEnergy: 100, armor: {} };
  assert.eq(Energy.applyOfflineRest(save, 0), 0);
  assert.eq(Energy.applyOfflineRest(save, -5), 0);
  assert.eq(save.energy, 20, 'untouched');
});
