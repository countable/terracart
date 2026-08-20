// Quest ladders — the castle chain (QUEST_CHAIN) and the first-session
// starter chain (STARTER_CHAIN). The two are deliberately independent; the
// isolation tests below are the guard that keeps them that way, because the
// castle vault gate reads allDone() and a leak would silently reprice it.

// ── Starter chain: shape ────────────────────────────────────────────────────

test('starter chain: every step has an event, title, body and reward', () => {
  assert.gt(STARTER_CHAIN.length, 0, 'chain is non-empty');
  for (const s of STARTER_CHAIN) {
    assert.truthy(s.id, 'id');
    assert.truthy(s.event, `${s.id} event`);
    assert.truthy(s.title, `${s.id} title`);
    assert.truthy(s.body, `${s.id} body`);
    assert.gt(s.reward?.money ?? 0, 0, `${s.id} reward`);
  }
});

test('starter chain: step ids and events are unique', () => {
  const ids = new Set(STARTER_CHAIN.map((s) => s.id));
  assert.eq(ids.size, STARTER_CHAIN.length, 'unique ids');
  const evs = new Set(STARTER_CHAIN.map((s) => s.event));
  assert.eq(evs.size, STARTER_CHAIN.length, 'unique events');
});

// The chip's guidance is only honest if the loop it describes is possible in
// order: you cannot sell a crop you have not harvested, or harvest one you
// have not planted. Pin the ordering so a future reshuffle has to be deliberate.
test('starter chain: teaches the loop in a playable order', () => {
  const order = STARTER_CHAIN.map((s) => s.event);
  assert.eq(order.indexOf('chest'), 0, 'supplies come first');
  assert.lt(order.indexOf('till'), order.indexOf('plant'), 'till before plant');
  assert.lt(order.indexOf('plant'), order.indexOf('harvest'), 'plant before harvest');
  assert.lt(order.indexOf('harvest'), order.indexOf('sell'), 'harvest before sell');
  // A crop needs real time to mature — the restore step is what fills it.
  assert.lt(order.indexOf('restore'), order.indexOf('harvest'), 'restore fills the grow wait');
});

// ── Starter chain: progression ──────────────────────────────────────────────

test('starter chain: a fresh save opens on the first step', () => {
  const save = {};
  assert.eq(Quests.starterCurrent(save).id, STARTER_CHAIN[0].id, 'first step');
  assert.eq(Quests.starterStepIndex(save), 0, 'index 0');
  assert.eq(Quests.starterTotal(), STARTER_CHAIN.length, 'total');
  assert.falsy(Quests.starterAllDone(save), 'not done');
  assert.falsy(Quests.starterHidden(save), 'chip visible');
});

test('starter chain: an unrelated event does not advance the ladder', () => {
  const save = {};
  assert.eq(Quests.onStarterEvent(save, 'sell'), null, 'out-of-order event ignored');
  assert.eq(Quests.starterStepIndex(save), 0, 'still on step 0');
});

test('starter chain: the matching event completes the step and advances', () => {
  const save = {};
  const done = Quests.onStarterEvent(save, STARTER_CHAIN[0].event);
  assert.eq(done?.id, STARTER_CHAIN[0].id, 'returns the completed step');
  assert.eq(Quests.starterStepIndex(save), 1, 'advanced');
  assert.eq(Quests.starterCurrent(save).id, STARTER_CHAIN[1].id, 'now on step 2');
});

test('starter chain: repeating a completed step does not double-advance', () => {
  const save = {};
  Quests.onStarterEvent(save, STARTER_CHAIN[0].event);
  assert.eq(Quests.onStarterEvent(save, STARTER_CHAIN[0].event), null, 'ignored');
  assert.eq(Quests.starterStepIndex(save), 1, 'still 1');
});

test('starter chain: walking every step finishes and hides the ladder', () => {
  const save = {};
  for (const s of STARTER_CHAIN) {
    assert.eq(Quests.onStarterEvent(save, s.event)?.id, s.id, `${s.id} completes`);
  }
  assert.truthy(Quests.starterAllDone(save), 'all done');
  assert.truthy(Quests.starterHidden(save), 'chip hidden');
  assert.eq(Quests.starterCurrent(save), null, 'no current step');
  assert.eq(Quests.starterStepIndex(save), STARTER_CHAIN.length, 'index clamps to total');
});

test('starter chain: events after the ladder finishes are inert', () => {
  const save = {};
  Quests.starterSkipAll(save);
  assert.eq(Quests.onStarterEvent(save, STARTER_CHAIN[0].event), null, 'no step to complete');
  assert.eq(Quests.starterStepIndex(save), STARTER_CHAIN.length, 'index unchanged');
});

test('starter chain: dismissing hides the chip without completing the ladder', () => {
  const save = {};
  Quests.starterDismiss(save);
  assert.truthy(Quests.starterHidden(save), 'hidden');
  assert.falsy(Quests.starterAllDone(save), 'not actually completed');
  // A dismissed ladder still tracks quietly, so re-showing it is coherent.
  assert.eq(Quests.onStarterEvent(save, STARTER_CHAIN[0].event)?.id, STARTER_CHAIN[0].id,
    'still tracks while dismissed');
});

test('starter chain: skipAll retires the ladder for a veteran save', () => {
  const save = {};
  Quests.starterSkipAll(save);
  assert.truthy(Quests.starterAllDone(save), 'done');
  assert.truthy(Quests.starterHidden(save), 'hidden');
});

// ── Isolation from the castle chain ─────────────────────────────────────────
//
// The castle vault opens on Quests.allDone(), which must walk QUEST_CHAIN
// alone. If the starter steps ever leaked into that tally, every castle in
// the game would silently reprice its gate.

test('isolation: finishing the starter chain does not open the castle vault', () => {
  const save = {};
  for (const s of STARTER_CHAIN) Quests.onStarterEvent(save, s.event);
  assert.truthy(Quests.starterAllDone(save), 'starter done');
  assert.falsy(Quests.allDone(save), 'castle chain still sealed');
  assert.eq(Quests.current(save).id, QUEST_CHAIN[0].id, 'castle chain untouched at step 0');
});

test('isolation: finishing the castle chain does not retire the starter chip', () => {
  const save = {};
  for (let i = 0; i < QUEST_CHAIN.length; i++) Quests.advance(save);
  assert.truthy(Quests.allDone(save), 'castle chain done');
  assert.falsy(Quests.starterAllDone(save), 'starter chain untouched');
  assert.eq(Quests.starterCurrent(save).id, STARTER_CHAIN[0].id, 'starter still at step 0');
});

test('isolation: the two ladders keep their state in separate save keys', () => {
  const save = {};
  Quests.onStarterEvent(save, STARTER_CHAIN[0].event);
  Quests.advance(save);
  assert.eq(save.starter.step, 1, 'starter state in save.starter');
  assert.eq(save.quests.step, 1, 'castle state in save.quests');
});
