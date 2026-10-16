// A dug-up X pays ONE find, on the spot — no pick.
//
// For a while in Sep 2026 an X opened the road ladder's "take your pick"
// dialog (two finds, keep one). It went back to a single roll: the ladder's
// pick (app.js _offerTreasurePick) is the only "several finds, keep one".
// The live tap and one-time payout are exercised in treasure_dialog.test.js.

test('treasure dig: an X never opens a multi-reward pick', () => {
  const src = INTERACT_SRC;
  assert.falsy(/digTreasurePick/.test(src), 'no pick on the dig');
  assert.falsy(/digTreasurePick/.test(SCENE_SRC), 'and no pick method left behind');
});

test('treasure dig: the pick lane is the road ladder\'s alone', () => {
  const n = (SCENE_SRC.match(/this\._offerTreasurePick\(\{/g) || []).length;
  assert.eq(n, 1, 'only _fireTrailPrize opens the pick');
});
