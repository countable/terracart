// Quest ladders — the castle BOARD (three generated slots) and the first-session
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
// The two ladders share this file and nothing else. The starter chain is the
// first-session guidance chip; the castle BOARD is three generated jobs that
// never run out. Neither may move the other.
test('isolation: finishing the starter chain does not touch the castle board', () => {
  const save = {};
  for (const step of STARTER_CHAIN) Quests.onStarterEvent(save, step.event);
  assert.truthy(Quests.starterAllDone(save), 'starter chain finished');
  assert.eq(Quests.completedCount(save), 0, 'no castle quest was claimed by it');
});

test('isolation: claiming castle quests does not retire the starter chip', () => {
  const save = {};
  for (let i = 0; i < QUEST_SLOTS; i++) {
    const q = Quests.slot(save, i);
    q.have = q.need;
    Quests.claim(save, i);
  }
  assert.eq(Quests.completedCount(save), QUEST_SLOTS, 'three claimed');
  assert.falsy(Quests.starterAllDone(save), 'starter chip still guiding');
});

test('isolation: the two ladders keep their state in separate save keys', () => {
  const save = {};
  Quests.onStarterEvent(save, STARTER_CHAIN[0].event);
  Quests.slot(save, 0);
  assert.truthy(save.starter, 'starter state');
  assert.truthy(save.quests, 'board state');
  assert.falsy(save.starter.slots, 'the chip has no board');
  assert.falsy(save.quests.step, 'the board has no chain step');
});

const plantHandler = () => TAP_HANDLERS.find((h) => h.name === 'plant');

// A tap context on a tilled cell, for the seedless-tap tests below.
const tilledCtx = (save, flashes) => {
  const scene = makeScene({
    tilledSet: new Set(['7,7']),
    flash: (msg) => flashes.push(msg),
    buildInventoryDOM: () => {},
  });
  return { scene, save, sx: 0, sy: 0, dirty: false, cellKey: '7,7', cwmx: 0, cwmy: 0 };
};

test('plant: mid-ladder, a seedless tap on tilled soil instructs instead of un-tilling', () => {
  const save = { inv: [], selSlot: 0, tilled: ['7,7'], planted: [] };
  // Walk the ladder to the planting step.
  Quests.onStarterEvent(save, 'chest');
  Quests.onStarterEvent(save, 'till');
  assert.eq(Quests.starterCurrent(save).event, 'plant', 'on the plant step');

  const flashes = [];
  const ctx = tilledCtx(save, flashes);
  assert.eq(plantHandler().try(ctx), true, 'tap is consumed');
  assert.truthy(ctx.scene.tilledSet.has('7,7'), 'soil survives — the till is not undone');
  assert.truthy(/seed/i.test(flashes.join(' ')), `names the missing seed, got: ${flashes.join(' ')}`);
});

test('plant: past the ladder, a seedless tap STILL leaves the soil alone', () => {
  // The un-till used to live here, gated to players the ladder had finished
  // with. A veteran's plot is worth no less than a beginner's.
  const save = { inv: [], selSlot: 0, tilled: ['7,7'], planted: [] };
  Quests.starterSkipAll(save);

  const flashes = [];
  const ctx = tilledCtx(save, flashes);
  assert.eq(plantHandler().try(ctx), true, 'tap is consumed');
  assert.truthy(ctx.scene.tilledSet.has('7,7'), 'soil survives');
  assert.eq(ctx.dirty, false, 'and nothing was changed to persist');
  assert.truthy(/seed/i.test(flashes.join(' ')), `names the missing seed, got: ${flashes.join(' ')}`);
});

test('plant: nothing in the game undoes a till by tapping it', () => {
  // Any selection that is not plantable lands in the same branch — a mineral,
  // a tool, an animal. None of them may cost the player their ground.
  for (const id of ['wood', 'rockfruit', 'chicken']) {
    const save = { inv: [{ id, count: 3 }], selSlot: 0, tilled: ['7,7'], planted: [] };
    Quests.starterSkipAll(save);
    const flashes = [];
    const ctx = tilledCtx(save, flashes);
    assert.eq(plantHandler().try(ctx), true, `tap consumed holding ${id}`);
    assert.truthy(ctx.scene.tilledSet.has('7,7'), `soil survives holding ${id}`);
  }
});

// ── Inventory category tabs ─────────────────────────────────────────────────

test('inventory tabs: every category carries a label for its glyph', () => {
  for (const c of INV_CATS) {
    assert.truthy(c.label, `${c.key} has a label`);
    assert.truthy(c.sym, `${c.key} has a glyph`);
    // The tab strip is ~46px per tab on a phone; long words would ellipsise.
    assert.lt(c.label.length, 10, `${c.key} label "${c.label}" fits the tab`);
  }
});
