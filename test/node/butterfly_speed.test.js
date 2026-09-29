// A butterfly never outpaces 6 m/s (owner, Sep 2026): its wander gait, its
// bolt, the net wheel's flee and a shiny's quickening all read ONE column,
// the behaviour row's `maxMps` (SpriteLayout.creatureMaxMps).
(function () {
test('butterfly speed: the cap is the row\'s column and the classifier reads it', () => {
  assert.eq(SpriteLayout.creatureMaxMps('butterfly'), 6);
  assert.eq(SpriteLayout.creatureMaxMps('cow'), Infinity, 'no cap on a kind whose row names none');
  assert.lte(faunaTopMps('butterfly', WorldGen.CELL_M), 6, 'top speed over gait and bolt');
});

test('butterfly speed: every mover in the loop and the net wheel is held to it', () => {
  const w = SCENE_CREATURES_SRC;
  assert.truthy(/stepMs = Math\.max\(stepMs, stepM \/ SpriteLayout\.creatureMaxMps\(c\.kind\) \* 1000\)/.test(w),
    'the wander glide stretches to the cap (shiny included: it is applied after)');
  assert.truthy(/stepM \* FLEE_STRIDE_MUL \/ SpriteLayout\.creatureMaxMps\(c\.kind\) \* 1000/.test(w),
    'the struck-prey shove is held to it too');
  assert.truthy(/FLEE_MPS = Math\.min\([^;]*SpriteLayout\.creatureMaxMps\(c\.kind\)\)/.test(APP_JS_SRC),
    'the net wheel\'s flee, shiny included');
});
})();
