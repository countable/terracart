// A revive lifts an empty bar to a share of it, ROUNDED (Energy.reviveLevel):
// a quarter at Home, a potion's own REVIVE_ITEM_FRAC (the feather is a flat 1)
// — energy is a whole number everywhere, and a bare maxE * 0.25 left a player
// on 22.25⚡ after reviving at a max of 89.

test('revive: a quarter of the bar, as a whole number', () => {
  assert.eq(Energy.REVIVE_FRAC, 0.25);
  assert.eq(Energy.reviveLevel(89), 22, '89 / 4 = 22.25 → 22');
  assert.eq(Energy.reviveLevel(90), 23, '22.5 → 23');
  assert.eq(Energy.reviveLevel(100), 25);
  assert.eq(Energy.reviveLevel(2), 1, 'never below 1');
  for (let m = 1; m <= 300; m++) assert.eq(Energy.reviveLevel(m) % 1, 0, `max ${m}: whole`);
});

test('revive: an item passes its own share, rounded the same way', () => {
  assert.eq(Energy.reviveLevel(89, 0.10), 9, '8.9 → 9');
  assert.eq(Energy.reviveLevel(5, 0.10), 1, 'never below 1');
});

test('revive: every share-of-the-bar revive uses it — Home on hard, the potions', () => {
  assert.eq((APP_JS_SRC.match(/Energy\.reviveLevel\(/g) || []).length, 2, 'two callers (the feather is a flat 1)');
  assert.falsy(/energy = [^;\n]*\* 0\.25/.test(APP_JS_SRC), 'no bare quarter-bar left');
});
