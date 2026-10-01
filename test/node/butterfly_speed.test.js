// A butterfly never outpaces 6 m/s, a shiny one 9 m/s (owner, Sep 2026): its
// wander gait, its bolt and the net wheel's flee all read ONE column, the
// behaviour row's `maxMps` (SpriteLayout.creatureMaxMps), and a shiny's cap
// rises by its own SHINY_SPEED_MUL.
(function () {
test('butterfly speed: the cap is the row\'s column and the classifier reads it', () => {
  assert.eq(SpriteLayout.creatureMaxMps('butterfly'), 6);
  assert.eq(SpriteLayout.creatureMaxMps('cow'), Infinity, 'no cap on a kind whose row names none');
  assert.lte(faunaTopMps('butterfly', WorldGen.CELL_M), 6, 'top speed over gait and bolt');
});

test('butterfly speed: every mover in the loop and the net wheel is held to it', () => {
  const w = SCENE_SRC;
  assert.eq(6 * SHINY_SPEED_MUL, 9, 'a shiny butterfly tops out at 9 m/s');
  assert.truthy(/const maxMps = SpriteLayout\.creatureMaxMps\(c\.kind\) \/ shinyFast;/.test(w),
    'the loop\'s cap rises with the shiny beat');
  assert.truthy(/stepMs = Math\.max\(stepMs, stepM \/ maxMps \* 1000\)/.test(w),
    'the wander glide stretches to the cap');
  assert.truthy(/c\._hopMs = Math\.max\(hurryMs, hurryM \/ maxMps \* 1000\);/.test(w),
    'the struck-prey shove is held to it too');
  assert.truthy(/FLEE_MPS = Math\.min\(isButterfly \? 5\.4 : 2, SpriteLayout\.creatureMaxMps\(c\.kind\)\) \* shinyFast;/.test(SCENE_SRC),
    'the net wheel\'s flee: capped, then quickened for a shiny');
});
})();
