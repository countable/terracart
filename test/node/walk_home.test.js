// Walk-home timing (src/app.js WALK_HOME_IDLE_MS / WALK_HOME_HINT_IDLE_MS).
//
// Letting go of the movement stick starts a debounce; when it expires the
// character walks itself back to where the GPS says it really is, and a little
// later a dashed lead line appears pointing the way.
//
// The debounce has been wrong in both directions. At 3000 ms it read as the
// character ignoring you; chasing that it went to 700 ms and then 500 ms, which
// is a hair-trigger — players nudge themselves along in short pushes, and every
// beat between pushes started a return, so the character leaned back against
// the direction of travel all the way. 5000 ms is what playtesting settled on:
// past the longest natural gap between two deliberate pushes. These pin that
// shape so a later retune can't quietly reintroduce either failure.

test('walk home: the debounce outlasts an ordinary pause between stick pushes', () => {
  assert.gt(WALK_HOME_IDLE_MS, 3500,
    'below ~3.5s the character starts home between nudges — this is the 500ms bug');
  assert.lt(WALK_HOME_IDLE_MS, 8000,
    'above ~8s a player who has genuinely stopped is left waiting');
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
// The debounce says WHEN the return starts; the ramp says how it starts. A flat
// switch-on is a cliff: whatever the timer is, the first frame past it yanks the
// character backwards at full walking pace. Easing in from nothing means a push
// that lands just after the timer expires gives up almost no ground, while a
// real stop still gets home at walking pace — so the timer can be generous
// without the return feeling like a lurch when it finally fires.

test('walk home: the return eases in rather than switching on at full pace', () => {
  assert.gt(WALK_HOME_RAMP_MS, 600,
    'too short a ramp is a cliff again — the character lurches back between nudges');
  assert.lt(WALK_HOME_RAMP_MS, 2500,
    'too long a ramp and a genuine stop crawls home');
});

test('walk home: a pause that outlasts the debounce still costs almost nothing', () => {
  // What the player actually gives up if the debounce expires and they push
  // again. The ramp is squared, so ground lost over an overshoot of `ms` past
  // the timer is the integral of t^2 — a fraction of what a flat return would
  // have taken.
  const lost = (ms) => {
    const t = Math.min(1, Math.max(0, ms - WALK_HOME_IDLE_MS) / WALK_HOME_RAMP_MS);
    return (t ** 3) / 3;            // ∫t² dt, in units of ramp-length × full speed
  };
  const flat = (ms) => Math.max(0, ms - WALK_HOME_IDLE_MS) / WALK_HOME_RAMP_MS;
  // 400ms past the debounce — a push that lands just too late to hold it off.
  const ms = WALK_HOME_IDLE_MS + 400;
  assert.lt(lost(ms), flat(ms) * 0.25,
    'a push just past the debounce should cost a fraction of what a flat return would');
});

test('walk home: once it starts, the return is not a crawl', () => {
  // The debounce is deliberately generous, so everything after it has to feel
  // decisive: full walking pace within a couple of seconds of the walk starting.
  assert.lt(WALK_HOME_RAMP_MS, 2000,
    'full walking pace should arrive within a couple of seconds of the walk starting');
});
