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

// ── The ramp ──────────────────────────────────────────────────────────────
// Dropping the debounce to 700ms fixed "the character ignores me" and created
// its mirror image: players nudge themselves along in short pushes, and any
// gap longer than the timer had the character walking BACK against them. Driven
// with a 500ms push / 900ms pause pattern, 23% of the player's forward travel
// was spent going backwards across 7 direction reversals; at the old 3000ms it
// was 0% and 0.
//
// The fix is to remove the cliff rather than to pick a better number: the timer
// says when the return starts, and the speed eases in from nothing over the
// ramp. An interrupted nudge gives up almost no ground; a real stop still gets
// home at walking pace. The same pattern now measures 0% backward.

test('walk home: the return eases in rather than switching on at full pace', () => {
  assert.gt(WALK_HOME_RAMP_MS, 600,
    'too short a ramp is a cliff again — the character lurches back between nudges');
  assert.lt(WALK_HOME_RAMP_MS, 2500,
    'too long a ramp and a genuine stop crawls home');
});

test('walk home: an ordinary pause between nudges stays nearly free', () => {
  // What the player actually gives up if they pause and push again. The ramp is
  // squared, so ground lost over a pause of `ms` is the integral of t^2 — a
  // fraction of what a flat return would have taken.
  const lost = (ms) => {
    const t = Math.min(1, Math.max(0, ms - WALK_HOME_IDLE_MS) / WALK_HOME_RAMP_MS);
    return (t ** 3) / 3;            // ∫t² dt, in units of ramp-length × full speed
  };
  const flat = (ms) => Math.max(0, ms - WALK_HOME_IDLE_MS) / WALK_HOME_RAMP_MS;
  // A 900ms gap — a normal beat between two stick pushes.
  assert.lt(lost(900), flat(900) * 0.25,
    'a normal pause between nudges should cost a fraction of what a flat return would');
});

test('walk home: a real stop is still under way quickly', () => {
  // The complaint that started this was three seconds of the character doing
  // nothing. Whatever the ramp does, the walk must BEGIN well inside a second.
  assert.lt(WALK_HOME_IDLE_MS, 900, 'the return must begin well inside a second');
  // ...and reach full pace soon enough that the trip home is not a crawl.
  assert.lt(WALK_HOME_IDLE_MS + WALK_HOME_RAMP_MS, 2200,
    'full walking pace should arrive within a couple of seconds of release');
});
