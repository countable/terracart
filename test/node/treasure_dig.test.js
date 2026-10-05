// A dug-up X pays ONE find, on the spot — no pick.
//
// For a while in Sep 2026 an X opened the road ladder's "take your pick"
// dialog (two finds, keep one). It went back to a single roll: the ladder's
// pick (app.js _offerTreasurePick) is the only "several finds, keep one".
// app.js can't load headlessly, so the wiring is pinned as source text.

test('treasure dig: the mark is spent, then ONE roll pays from the X pool', () => {
  const src = INTERACT_SRC;
  // A mark may carry its own rollBonus (a hedgerow close's hoard —
  // StreetVariants.dress); every other mark rolls exactly as before.
  assert.truthy(/save\.foundTreasures = \[\.\.\.found, tr\.id\];[\s\S]{0,500}?\n\s*grantTreasureRoll\(scene, save, sx, sy, '✕', 'treasure:default',\s*tr\.rollBonus > 0 \? \{ \.\.\.\(dig \|\| \{\}\), rollBonus: tr\.rollBonus \} : dig\);/.test(src),
    'the mark is spent (no reload re-roll), then the single roll pays, cave-skewed underground');
  assert.falsy(/digTreasurePick/.test(src), 'no pick on the dig');
  assert.falsy(/digTreasurePick/.test(SCENE_SRC), 'and no pick method left behind');
});

test('treasure dig: the pick lane is the road ladder\'s alone', () => {
  const n = (SCENE_SRC.match(/this\._offerTreasurePick\(\{/g) || []).length;
  assert.eq(n, 1, 'only _fireTrailPrize opens the pick');
});
