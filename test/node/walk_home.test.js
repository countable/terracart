// Walk-home timing (src/app.js WALK_HOME_IDLE_MS / WALK_HOME_HINT_IDLE_MS).
//
// Letting go of the movement stick starts a debounce; when it expires the
// character walks itself back to where the GPS says it really is, and a little
// later a dashed lead line appears pointing the way.
//
// The debounce was 3000 ms, which measured as three full seconds of the
// character doing nothing at all after release — the offset sat frozen, then
// covered 43 m back in under three seconds once it finally started. All of the
// sluggishness was the wait. These pin the shape of the fix so a later retune
// can't quietly reintroduce it.

test('walk home: the return starts promptly after the stick is released', () => {
  assert.gt(WALK_HOME_IDLE_MS, 300,
    'below ~300ms the character twitches homeward on every thumb reposition');
  assert.lt(WALK_HOME_IDLE_MS, 1200,
    'above ~1.2s the character reads as ignoring you — this is the 3000ms bug');
});

test('walk home: the hint never precedes the walk it is describing', () => {
  // The lead line says "on my way back there". If it can appear before the walk
  // starts, it is pointing at something that has not begun.
  assert.gt(WALK_HOME_HINT_IDLE_MS, WALK_HOME_IDLE_MS,
    'the hint must wait for the walk it announces');
});

test('walk home: the hint is still reachable on an ordinary return', () => {
  // A typical return covers its distance in a couple of seconds. If the hint's
  // delay sits far beyond the walk's, the walk finishes first and the hint is
  // effectively dead code — which is what happened when the walk dropped to
  // 700ms while the hint stayed at 5000ms.
  const lag = WALK_HOME_HINT_IDLE_MS - WALK_HOME_IDLE_MS;
  assert.lt(lag, 3000,
    'the hint lands so long after the walk starts that most returns end first');
  assert.gt(lag, 200, 'the hint should stay quieter than the walk, not simultaneous');
});
