// Headless tests for interact.js — TAP_HANDLERS structure, ordering invariants,
// and where feasible: handler behaviour driven via stub ctx.
//
// Patch-history motivation:
//   ffe7f25  slime taps fall through (creature handler gap)
//   82004e8  taps die after opening a produce stand (object handler dedupe bug)
//   fishing-vs-can-refill ordering  (interaction-sweep-2026-05-27.md §Bug)

// ─── 1. Structural invariants ────────────────────────────────────────────────

test('TAP_HANDLERS: array exists and is non-empty', () => {
  assert.truthy(Array.isArray(TAP_HANDLERS), 'TAP_HANDLERS is an array');
  assert.gt(TAP_HANDLERS.length, 0, 'TAP_HANDLERS has entries');
});

test('TAP_HANDLERS: every entry has a string name and function try', () => {
  for (const h of TAP_HANDLERS) {
    assert.truthy(typeof h.name === 'string' && h.name.length > 0,
      `handler name must be a non-empty string, got: ${JSON.stringify(h.name)}`);
    assert.truthy(typeof h.try === 'function',
      `handler "${h.name}".try must be a function`);
  }
});

test('TAP_HANDLERS: no duplicate handler names', () => {
  const seen = new Set();
  for (const h of TAP_HANDLERS) {
    assert.falsy(seen.has(h.name), `duplicate handler name: "${h.name}"`);
    seen.add(h.name);
  }
});

// ─── 2. Ordering invariants ──────────────────────────────────────────────────

// Extract the name array once for all position tests.
// Current pinned order (as of 2026-06-06):
const HANDLER_NAMES = TAP_HANDLERS.map(h => h.name);

test('TAP_HANDLERS: work-progress is the FIRST handler (priority guard)', () => {
  assert.eq(HANDLER_NAMES[0], 'work-progress',
    'work-progress must be index 0 so an in-progress wheel eats every tap first');
});

test('TAP_HANDLERS: use-consumable is second (before treasure / creature)', () => {
  assert.eq(HANDLER_NAMES[1], 'use-consumable',
    'use-consumable must be index 1 — tap-on-feet with flute/book/potion runs before world probes');
});

test('TAP_HANDLERS: use-consumable precedes creature', () => {
  const iConsumable = HANDLER_NAMES.indexOf('use-consumable');
  const iCreature   = HANDLER_NAMES.indexOf('creature');
  assert.truthy(iConsumable < iCreature,
    'use-consumable must precede creature so a self-tap with a consumable item is handled first');
});

test('TAP_HANDLERS: creature precedes wildplant (animals eat taps near plants)', () => {
  const iCreature   = HANDLER_NAMES.indexOf('creature');
  const iWildplant  = HANDLER_NAMES.indexOf('wildplant');
  assert.truthy(iCreature < iWildplant,
    'creature must precede wildplant — a tap near a chicken beats the plant tap');
});

test('TAP_HANDLERS: wildplant precedes object', () => {
  const iWp  = HANDLER_NAMES.indexOf('wildplant');
  const iObj = HANDLER_NAMES.indexOf('object');
  assert.truthy(iWp < iObj, 'wildplant before object');
});

test('TAP_HANDLERS: staircase precedes object (stair takes priority)', () => {
  const iStair = HANDLER_NAMES.indexOf('staircase');
  const iObj   = HANDLER_NAMES.indexOf('object');
  assert.truthy(iStair < iObj,
    'staircase must precede object so a cave entrance tap is not swallowed by the generic object handler');
});

test('TAP_HANDLERS: cell-resolve precedes planted / can-refill / fishing / till', () => {
  const iCR = HANDLER_NAMES.indexOf('cell-resolve');
  for (const name of ['planted', 'can-refill', 'fishing', 'till', 'plant', 'flavor']) {
    const i = HANDLER_NAMES.indexOf(name);
    if (i === -1) continue; // tolerate future removals
    assert.truthy(iCR < i,
      `cell-resolve must precede "${name}" (cell info must be resolved first)`);
  }
});

test('TAP_HANDLERS: release precedes plant / till (must place animals before tilling)', () => {
  const iRelease = HANDLER_NAMES.indexOf('release');
  const iPlant   = HANDLER_NAMES.indexOf('plant');
  const iTill    = HANDLER_NAMES.indexOf('till');
  assert.truthy(iRelease < iPlant, 'release before plant');
  assert.truthy(iRelease < iTill,  'release before till');
});

test('TAP_HANDLERS: pickup-scarecrow precedes place-scarecrow (pick up before placing)', () => {
  const iPick  = HANDLER_NAMES.indexOf('pickup-scarecrow');
  const iPlace = HANDLER_NAMES.indexOf('place-scarecrow');
  assert.truthy(iPick < iPlace, 'pickup before place for scarecrow');
});

test('TAP_HANDLERS: extinguish-fire precedes light-fire (extinguish wins the tap)', () => {
  const iExt = HANDLER_NAMES.indexOf('extinguish-fire');
  const iLit = HANDLER_NAMES.indexOf('light-fire');
  assert.truthy(iExt < iLit, 'extinguish before light-fire');
});

test('TAP_HANDLERS: planted precedes can-refill (crop readout beats refill on water cell)', () => {
  const iPl  = HANDLER_NAMES.indexOf('planted');
  const iCan = HANDLER_NAMES.indexOf('can-refill');
  assert.truthy(iPl < iCan, 'planted before can-refill');
});

// ── BUG: can-refill precedes fishing in TAP_HANDLERS ─────────────────────────
// PATCH-HISTORY/BUG: interaction-sweep-2026-05-27.md documents that can-refill
// (line ~900 at the time of the sweep) sat before fishing, causing every water
// tap to refill the can silently while the player had a watering can — fishing
// was completely unreachable.  The handler was later patched to return false
// when save.relics?.rod is set, but the ARRAY ORDER was not changed: can-refill
// still appears before fishing in TAP_HANDLERS.  This test pins the current
// (unfixed ordering) order and flags it.  A correct fix would either swap the
// two handlers or confirm the in-handler rod guard is the intended long-term
// solution (in which case this comment should be updated and the order test
// flipped).
test('TAP_HANDLERS: can-refill appears BEFORE fishing (current — see PATCH-HISTORY/BUG)', () => {
  const iCan     = HANDLER_NAMES.indexOf('can-refill');
  const iFishing = HANDLER_NAMES.indexOf('fishing');
  assert.truthy(iCan !== -1, 'can-refill handler exists');
  assert.truthy(iFishing !== -1, 'fishing handler exists');
  // Pin the CURRENT (buggy-ordering) state. If this test starts failing it
  // means the order was swapped — remove this test and the BUG comment above.
  assert.truthy(iCan < iFishing,
    'can-refill precedes fishing in TAP_HANDLERS — ordering bug documented in interaction-sweep-2026-05-27.md');
});

test('TAP_HANDLERS: fishing precedes flavor (water tap must not become a label)', () => {
  const iFish   = HANDLER_NAMES.indexOf('fishing');
  const iFlavor = HANDLER_NAMES.indexOf('flavor');
  assert.truthy(iFish < iFlavor, 'fishing before flavor');
});

test('TAP_HANDLERS: flavor precedes plant and till (non-tillable label fires before farming)', () => {
  const iFlavor = HANDLER_NAMES.indexOf('flavor');
  const iPlant  = HANDLER_NAMES.indexOf('plant');
  const iTill   = HANDLER_NAMES.indexOf('till');
  assert.truthy(iFlavor < iPlant, 'flavor before plant');
  assert.truthy(iFlavor < iTill,  'flavor before till');
});

test('TAP_HANDLERS: plant precedes till (seed-in-hand beats un-till)', () => {
  const iPlant = HANDLER_NAMES.indexOf('plant');
  const iTill  = HANDLER_NAMES.indexOf('till');
  assert.truthy(iPlant < iTill, 'plant before till');
});

test('TAP_HANDLERS: till is the last or near-last handler', () => {
  const iTill = HANDLER_NAMES.indexOf('till');
  // till should be within the last 3 handlers (currently it IS the last one)
  assert.truthy(iTill >= HANDLER_NAMES.length - 3,
    'till must be a terminal handler — only fires when nothing else matched the cell');
});

// ─── 3. work-progress handler behaviour ─────────────────────────────────────

test('work-progress: returns false when no work in progress', () => {
  const scene = makeScene();
  const save  = { inv: [], selSlot: 0 };
  const ctx   = Object.assign(makeCtx(scene, save), { wm: { x: 0, y: 0 }, pWorldX: 0, pWorldY: 0 });
  const h = TAP_HANDLERS.find(h => h.name === 'work-progress');
  // No _workProgress on scene → should return false (fall through)
  assert.eq(h.try(ctx), false, 'no work in progress → false');
});

test('work-progress: swallows tap within 150ms of wheel start (prevents self-cancel)', () => {
  const scene = makeScene();
  scene._workProgress = { startT: performance.now() };  // just started
  const save = { inv: [], selSlot: 0 };
  const ctx  = Object.assign(makeCtx(scene, save), { wm: { x: 0, y: 0 }, pWorldX: 0, pWorldY: 0 });
  const h = TAP_HANDLERS.find(h => h.name === 'work-progress');
  assert.eq(h.try(ctx), true, 'early tap returns true (swallowed) to prevent wheel self-cancel');
});

test('work-progress: aborts and returns true after 150ms', () => {
  let aborted = false;
  const scene = Object.assign(makeScene(), {
    abortWorkProgress: () => { aborted = true; },
  });
  scene._workProgress = { startT: performance.now() - 200 };  // old enough
  const save = { inv: [], selSlot: 0 };
  const ctx  = Object.assign(makeCtx(scene, save), { wm: { x: 0, y: 0 }, pWorldX: 0, pWorldY: 0 });
  const h = TAP_HANDLERS.find(h => h.name === 'work-progress');
  assert.eq(h.try(ctx), true, 'stale work-progress returns true (consumed)');
  assert.truthy(aborted, 'abortWorkProgress was called');
});

// ─── 4. use-consumable handler behaviour ────────────────────────────────────

test('use-consumable: returns false when tap is far from player (> 1.5m)', () => {
  const scene = Object.assign(makeScene(), { showOfferModal: () => {} });
  const save  = { inv: [{ id: 'book', count: 1 }], selSlot: 0 };
  // Tap 3m away from player
  const ctx = Object.assign(makeCtx(scene, save), {
    wm: { x: 3, y: 0 }, pWorldX: 0, pWorldY: 0, sx: 0, sy: 0,
  });
  const h = TAP_HANDLERS.find(h => h.name === 'use-consumable');
  assert.eq(h.try(ctx), false, 'far tap passes through');
});

test('use-consumable: returns false when no item selected (empty hand)', () => {
  const scene = Object.assign(makeScene(), { showOfferModal: () => {} });
  const save  = { inv: [], selSlot: 0 };
  const ctx = Object.assign(makeCtx(scene, save), {
    wm: { x: 0, y: 0 }, pWorldX: 0, pWorldY: 0, sx: 0, sy: 0,
  });
  const h = TAP_HANDLERS.find(h => h.name === 'use-consumable');
  assert.eq(h.try(ctx), false, 'empty inv → pass through');
});

test('use-consumable: book tap near player opens offer modal and returns true', () => {
  let modal = null;
  const scene = Object.assign(makeScene(), {
    showOfferModal: (opts) => { modal = opts; },
    readBook: () => {},
  });
  const save = { inv: [{ id: 'book', count: 1 }], selSlot: 0 };
  const ctx = Object.assign(makeCtx(scene, save), {
    wm: { x: 0.5, y: 0 }, pWorldX: 0, pWorldY: 0, sx: 0, sy: 0,
  });
  const h = TAP_HANDLERS.find(h => h.name === 'use-consumable');
  assert.eq(h.try(ctx), true, 'book tap near player consumed');
  assert.truthy(modal !== null, 'offer modal was opened');
  assert.truthy(modal.title.toLowerCase().includes('book'), 'modal title mentions book');
});

test('use-consumable: flute tap near player opens offer modal and returns true', () => {
  let modal = null;
  const scene = Object.assign(makeScene(), {
    showOfferModal: (opts) => { modal = opts; },
    playFlute: () => {},
  });
  const save = { inv: [{ id: 'flute', count: 1 }], selSlot: 0 };
  const ctx = Object.assign(makeCtx(scene, save), {
    wm: { x: 0, y: 0 }, pWorldX: 0, pWorldY: 0, sx: 0, sy: 0,
  });
  const h = TAP_HANDLERS.find(h => h.name === 'use-consumable');
  assert.eq(h.try(ctx), true, 'flute tap consumed');
  assert.truthy(modal !== null, 'offer modal opened');
});

test('use-consumable: non-consumable item near player falls through (returns false)', () => {
  let modal = null;
  const scene = Object.assign(makeScene(), { showOfferModal: (o) => { modal = o; } });
  // 'wood' is not a consumable item
  const save = { inv: [{ id: 'wood', count: 5 }], selSlot: 0 };
  const ctx = Object.assign(makeCtx(scene, save), {
    wm: { x: 0, y: 0 }, pWorldX: 0, pWorldY: 0, sx: 0, sy: 0,
  });
  const h = TAP_HANDLERS.find(h => h.name === 'use-consumable');
  assert.eq(h.try(ctx), false, 'non-consumable item falls through');
  assert.falsy(modal, 'no modal for non-consumable item');
});

// ─── 5. consumeSelected helper ───────────────────────────────────────────────

test('consumeSelected: decrements stack count by 1', () => {
  const save = { inv: [{ id: 'coal', count: 3 }], selSlot: 0 };
  consumeSelected(save);
  assert.eq(save.inv[0].count, 2, 'count decremented');
  assert.eq(save.inv.length, 1, 'stack still exists');
});

test('consumeSelected: splices out the stack when count reaches 0', () => {
  const save = { inv: [{ id: 'coal', count: 1 }, { id: 'wood', count: 2 }], selSlot: 0 };
  consumeSelected(save);
  assert.eq(save.inv.length, 1, 'exhausted stack removed');
  assert.eq(save.inv[0].id, 'wood', 'remaining stack is wood');
});

test('consumeSelected: clamps selSlot when it falls off the end after splice', () => {
  // selSlot points at the last item; splicing it must pull selSlot back to 0.
  const save = { inv: [{ id: 'wood', count: 2 }, { id: 'coal', count: 1 }], selSlot: 1 };
  consumeSelected(save);
  assert.eq(save.inv.length, 1, 'coal stack removed');
  assert.eq(save.selSlot, 0, 'selSlot clamped to last valid index');
});

test('consumeSelected: no-op when selSlot points to an empty slot', () => {
  const save = { inv: [], selSlot: 0 };
  consumeSelected(save);   // must not throw
  assert.eq(save.inv.length, 0, 'inv unchanged');
});

test('consumeSelected: n=2 decrements by 2', () => {
  const save = { inv: [{ id: 'coal', count: 5 }], selSlot: 0 };
  consumeSelected(save, 2);
  assert.eq(save.inv[0].count, 3, 'count decremented by 2');
});

// ─── 6. can-refill handler behaviour ────────────────────────────────────────

test('can-refill: returns false on non-water cell', () => {
  const scene = makeScene();
  const save  = { relics: { can: { tier: 1 } }, canCharges: 0, inv: [], selSlot: 0 };
  const ctx = Object.assign(makeCtx(scene, save), {
    cell: { type: 1 /* GRASS, not water */ }, sx: 0, sy: 0,
  });
  const h = TAP_HANDLERS.find(h => h.name === 'can-refill');
  assert.eq(h.try(ctx), false, 'non-water cell → fall through');
  assert.eq(save.canCharges, 0, 'charges unchanged');
});

test('can-refill: returns false when player has no watering can', () => {
  const scene = makeScene();
  const save  = { relics: {}, canCharges: 0, inv: [], selSlot: 0 };
  const ctx = Object.assign(makeCtx(scene, save), {
    cell: { type: 3 /* WATER */ }, sx: 0, sy: 0,
  });
  const h = TAP_HANDLERS.find(h => h.name === 'can-refill');
  assert.eq(h.try(ctx), false, 'no can → fall through');
  assert.eq(save.canCharges, 0, 'charges unchanged');
});

// PATCH-HISTORY/BUG: This guard was added AFTER the interaction-sweep-2026-05-27
// documented that can-refill ate every water tap when the player owned a can.
// The fix: if the player also has a rod, can-refill bails and fishing gets the tap.
// The array order (can-refill before fishing) was not fixed — the in-handler guard is
// the current workaround.  Verified here so any regression is caught immediately.
test('can-refill: returns false when player has both can AND rod (rod wins water tap)', () => {
  const scene = makeScene();
  const save  = { relics: { can: { tier: 1 }, rod: { tier: 1 } }, canCharges: 0, inv: [], selSlot: 0 };
  let flashed = false;
  scene.flash = () => { flashed = true; };
  const ctx = Object.assign(makeCtx(scene, save), {
    cell: { type: 3 /* WATER */ }, sx: 0, sy: 0,
  });
  const h = TAP_HANDLERS.find(h => h.name === 'can-refill');
  assert.eq(h.try(ctx), false,
    'can-refill must return false when rod is present — fishing must get the tap');
  assert.eq(save.canCharges, 0, 'charges must not be set when rod is present');
  assert.falsy(flashed, 'no flash when handler bails');
});

test('can-refill: refills to 50 charges on water tap when can is owned (no rod)', () => {
  let flashed = false;
  const scene = Object.assign(makeScene(), { flash: () => { flashed = true; } });
  const save  = { relics: { can: { tier: 1 } }, canCharges: 0, inv: [], selSlot: 0 };
  const ctx = Object.assign(makeCtx(scene, save), {
    cell: { type: 3 /* WATER */ }, sx: 0, sy: 0,
  });
  const h = TAP_HANDLERS.find(h => h.name === 'can-refill');
  assert.eq(h.try(ctx), true, 'refill consumed the tap');
  assert.eq(save.canCharges, 50, 'canCharges set to 50');
  assert.truthy(ctx.dirty, 'ctx.dirty set for persistence');
  assert.truthy(flashed, 'flash shown to player');
});

// ─── 7. findClosestItem helper ───────────────────────────────────────────────

test('findClosestItem: returns null when layer is empty', () => {
  // Stub WorldGen.forEachItem to iterate nothing
  const orig = globalThis.WorldGen;
  try {
    globalThis.WorldGen = Object.assign({}, orig, {
      forEachItem: (layer, cb) => { /* empty */ },
    });
    globalThis.distM2 = (ax, ay, bx, by) => (ax-bx)**2 + (ay-by)**2;
    const result = findClosestItem('creatures', 0, 0, 5);
    assert.eq(result, null, 'no items → null');
  } finally {
    globalThis.WorldGen = orig;
    delete globalThis.distM2;
  }
});

test('findClosestItem: finds the item within reach radius', () => {
  const orig = globalThis.WorldGen;
  try {
    const items = [{ x: 2, y: 0, kind: 'chicken', id: 'c1' }];
    globalThis.WorldGen = Object.assign({}, orig, {
      forEachItem: (layer, cb) => { for (const it of items) cb(it); },
    });
    globalThis.distM2 = (ax, ay, bx, by) => (ax-bx)**2 + (ay-by)**2;
    const found = findClosestItem('creatures', 0, 0, 5);
    assert.truthy(found !== null, 'item within radius found');
    assert.eq(found.id, 'c1', 'correct item returned');
  } finally {
    globalThis.WorldGen = orig;
    delete globalThis.distM2;
  }
});

test('findClosestItem: ignores items beyond reach radius', () => {
  const orig = globalThis.WorldGen;
  try {
    const items = [{ x: 10, y: 0, kind: 'chicken', id: 'c2' }];
    globalThis.WorldGen = Object.assign({}, orig, {
      forEachItem: (layer, cb) => { for (const it of items) cb(it); },
    });
    globalThis.distM2 = (ax, ay, bx, by) => (ax-bx)**2 + (ay-by)**2;
    const found = findClosestItem('creatures', 0, 0, 5);
    assert.eq(found, null, 'item at 10m is outside 5m radius → null');
  } finally {
    globalThis.WorldGen = orig;
    delete globalThis.distM2;
  }
});

test('findClosestItem: accept filter excludes rejected items', () => {
  const orig = globalThis.WorldGen;
  try {
    const items = [
      { x: 1, y: 0, kind: 'slime', id: 's1' },
      { x: 2, y: 0, kind: 'chicken', id: 'c3' },
    ];
    globalThis.WorldGen = Object.assign({}, orig, {
      forEachItem: (layer, cb) => { for (const it of items) cb(it); },
    });
    globalThis.distM2 = (ax, ay, bx, by) => (ax-bx)**2 + (ay-by)**2;
    // Only accept chickens
    const found = findClosestItem('creatures', 0, 0, 5, (it) => it.kind === 'chicken');
    assert.truthy(found !== null, 'a valid item was found');
    assert.eq(found.id, 'c3', 'slime was filtered out, chicken returned');
  } finally {
    globalThis.WorldGen = orig;
    delete globalThis.distM2;
  }
});

test('findClosestItem: returns the CLOSEST item when multiple are in reach', () => {
  const orig = globalThis.WorldGen;
  try {
    const items = [
      { x: 4, y: 0, kind: 'chicken', id: 'far' },
      { x: 1, y: 0, kind: 'chicken', id: 'near' },
    ];
    globalThis.WorldGen = Object.assign({}, orig, {
      forEachItem: (layer, cb) => { for (const it of items) cb(it); },
    });
    globalThis.distM2 = (ax, ay, bx, by) => (ax-bx)**2 + (ay-by)**2;
    const found = findClosestItem('creatures', 0, 0, 5);
    assert.eq(found.id, 'near', 'nearest item wins');
  } finally {
    globalThis.WorldGen = orig;
    delete globalThis.distM2;
  }
});

test('findClosestItem: function reach is evaluated per-item', () => {
  const orig = globalThis.WorldGen;
  try {
    const items = [
      { x: 3, y: 0, kind: 'cow',     id: 'cow1',  r: 5 },  // 3m from tap, r=5 → in reach
      { x: 3, y: 0, kind: 'chicken', id: 'chick1', r: 1 },  // 3m from tap, r=1 → out of reach
    ];
    globalThis.WorldGen = Object.assign({}, orig, {
      forEachItem: (layer, cb) => { for (const it of items) cb(it); },
    });
    globalThis.distM2 = (ax, ay, bx, by) => (ax-bx)**2 + (ay-by)**2;
    // Reach is a per-item function using the item's own `r` field
    const found = findClosestItem('creatures', 0, 0, (item) => item.r);
    assert.truthy(found !== null, 'cow (large reach) was found');
    assert.eq(found.id, 'cow1', 'chicken was filtered out by its own reach');
  } finally {
    globalThis.WorldGen = orig;
    delete globalThis.distM2;
  }
});

// ─── 8. tooFar helper ────────────────────────────────────────────────────────

test('tooFar: returns false (in reach) when cellInReach returns true for the foot', () => {
  const scene = makeScene();
  // Inject the cell-reach helpers that tooFar checks first
  const origCIR = globalThis.cellInReach;
  const origWMC = globalThis.worldMetersToAbsCell;
  try {
    globalThis.worldMetersToAbsCell = () => ({ cellIX: 0, cellIY: 0 });
    globalThis.cellInReach = () => true;  // player is always in reach
    const ctx = Object.assign(makeCtx(scene, {}), {
      wm: { x: 5, y: 5 }, sx: 0, sy: 0,
    });
    assert.eq(tooFar(ctx, 5, 5), false, 'in-reach cell → tooFar returns false');
  } finally {
    globalThis.cellInReach = origCIR;
    globalThis.worldMetersToAbsCell = origWMC;
  }
});

test('tooFar: returns true and flashes when cellInReach returns false', () => {
  let flashed = false;
  const scene = Object.assign(makeScene(), { flash: () => { flashed = true; } });
  const origCIR = globalThis.cellInReach;
  const origWMC = globalThis.worldMetersToAbsCell;
  try {
    globalThis.worldMetersToAbsCell = () => ({ cellIX: 99, cellIY: 99 });
    globalThis.cellInReach = () => false;
    const ctx = Object.assign(makeCtx(scene, {}), {
      wm: { x: 9999, y: 9999 }, sx: 0, sy: 0,
    });
    assert.eq(tooFar(ctx, 9999, 9999), true, 'out-of-reach cell → tooFar returns true');
    assert.truthy(flashed, '"Just out of reach" flash shown');
  } finally {
    globalThis.cellInReach = origCIR;
    globalThis.worldMetersToAbsCell = origWMC;
  }
});

// ─── 9. interactTap view-bounds guard ────────────────────────────────────────

test('interactTap: returns early without calling any handler when tap is outside the play area', () => {
  // We need worldMetersToAbsCell stub since interactTap calls it after the bounds check.
  // But the bounds check fires FIRST — so if we give a tap outside viewLeft/viewSize,
  // no handler should run.  Verify by confirming a handler array tap counter stays 0.
  let handlerCalls = 0;
  const origHandlers = TAP_HANDLERS.slice();  // snapshot
  // Temporarily mutate the first handler to count calls — restore after.
  const firstHandler = TAP_HANDLERS[0];
  const origTry = firstHandler.try;
  firstHandler.try = (ctx) => { handlerCalls++; return origTry(ctx); };
  try {
    const scene = Object.assign(makeScene(), {
      viewLeft: 0, viewTop: 0, viewSize: 500,
      // These would be called IF tap were inside bounds — keep stubs so we
      // don't crash if the guard somehow passes.
      screenToWorldMeters: () => ({ x: 0, y: 0 }),
      startWorldM: { x: 0, y: 0 }, playerM: { x: 0, y: 0 },
      feetOffsetM: 0,
    });
    const origWMC = globalThis.worldMetersToAbsCell;
    globalThis.worldMetersToAbsCell = () => ({ cellIX: 0, cellIY: 0 });
    try {
      // sx=9999 is outside viewLeft(0) + viewSize(500) = 500
      interactTap(scene, 9999, 250);
      assert.eq(handlerCalls, 0, 'no handler ran for out-of-bounds tap');
    } finally {
      globalThis.worldMetersToAbsCell = origWMC;
    }
  } finally {
    firstHandler.try = origTry;
  }
});

test('interactTap: dispatches handlers for a tap inside the play area (work-progress fires)', () => {
  // When a stale work wheel is in progress, work-progress is the FIRST handler
  // and returns true (consuming the tap) after calling abortWorkProgress.
  // This verifies the dispatch reaches at least the first handler for an
  // in-bounds tap, without needing the full scene graph (cell-resolve etc.)
  // that requires originPx / mPerPx / cellAt stubs.
  let aborted = false;
  const origWMC = globalThis.worldMetersToAbsCell;
  const origACC = globalThis.absCellCenterMeters;
  // Stub both coordinate helpers so interactTap can build its ctx without crashing.
  globalThis.worldMetersToAbsCell = () => ({ cellIX: 0, cellIY: 0 });
  globalThis.absCellCenterMeters  = () => ({ x: 0, y: 0 });
  try {
    const scene = Object.assign(makeScene(), {
      viewLeft: 0, viewTop: 0, viewSize: 500,
      screenToWorldMeters: () => ({ x: 0, y: 0 }),
      startWorldM: { x: 0, y: 0 }, playerM: { x: 0, y: 0 },
      feetOffsetM: 0,
      abortWorkProgress: () => { aborted = true; },
      _workProgress: { startT: performance.now() - 300 },  // stale → will abort
    });
    scene.save = { inv: [], selSlot: 0, picked: [], planted: [], opened: [], caught: [], tilled: [] };
    interactTap(scene, 100, 100);
    assert.truthy(aborted, 'abortWorkProgress called — work-progress handler ran for in-bounds tap');
  } finally {
    globalThis.worldMetersToAbsCell = origWMC;
    globalThis.absCellCenterMeters  = origACC;
  }
});

// ─── 10. Full handler-name snapshot (guards against accidental renames) ───────

test('TAP_HANDLERS: full handler-name list matches the known snapshot', () => {
  // This is a canary. If a handler is added, removed, or renamed, this test
  // fails loudly so the ordering tests above can be updated.
  const EXPECTED = [
    'work-progress',
    'use-consumable',
    'treasure',
    'creature',
    'wildplant',
    'coindrop',
    'staircase',
    'object',
    'cell-resolve',
    'path-stone',
    'building-zone',
    'release',
    'pickup-rock',
    'pickup-scarecrow',
    'place-scarecrow',
    'extinguish-fire',
    'light-fire',
    'place-rock',
    'planted',
    'can-refill',
    'fishing',
    'cave-wall',
    'flavor',
    'plant',
    'till',
  ];
  assert.eq(HANDLER_NAMES.length, EXPECTED.length,
    `handler count: expected ${EXPECTED.length}, got ${HANDLER_NAMES.length}. ` +
    `Diff: added=[${HANDLER_NAMES.filter(n=>!EXPECTED.includes(n))}] ` +
    `removed=[${EXPECTED.filter(n=>!HANDLER_NAMES.includes(n))}]`);
  for (let i = 0; i < EXPECTED.length; i++) {
    assert.eq(HANDLER_NAMES[i], EXPECTED[i],
      `handler at index ${i}: expected "${EXPECTED[i]}", got "${HANDLER_NAMES[i]}"`);
  }
});

// ─── 5. Tap-precision radius scales with cell size ───────────────────────────
// The REACH_*_M tap-precision constants were hand-tuned to a 5 m cell. tapReachM
// floors them at the cell half-diagonal so a tap anywhere in a target's OWN cell
// still resolves to it after CELL_M is retuned (the "tapping keeps breaking"
// regression when the cell grew past 5 m). These tests pin that invariant so a
// future cell-size change can't silently shrink the tappable area below the cell.

test('tapReachM: covers the cell half-diagonal at any cell size', () => {
  for (const cellM of [5, 6, 7, 9]) {
    const scene = { cellM };
    const halfDiag = cellM * Math.SQRT1_2;
    // A tap at the far corner of an item's own cell is up to halfDiag from its
    // centre; the precision radius must cover that (with the +0.5 m epsilon).
    assert.gte(tapReachM(scene, 0), halfDiag,
      `cellM=${cellM}: floor ${tapReachM(scene, 0)} must cover half-diagonal ${halfDiag}`);
  }
});

test('tapReachM: never bleeds into a neighbouring cell centre', () => {
  // The floor must stay under a full cell so it can't grab an item centred in
  // the adjacent cell (which sits exactly cellM away from the tap's cell).
  for (const cellM of [5, 6, 7, 9]) {
    assert.lt(tapReachM({ cellM }, 0), cellM,
      `cellM=${cellM}: floor must stay below one cell to avoid neighbour grabs`);
  }
});

test('tapReachM: preserves a larger hand-tuned base radius', () => {
  // House/treasure radii (6 m / 7.5 m) already exceed the 7 m half-diagonal and
  // must pass through unchanged.
  assert.eq(tapReachM({ cellM: 7 }, 7.5), 7.5, 'treasure radius preserved at 7 m cell');
});

test('tapReachM: REACH_OBJECT_M=3.5 was the 5 m cell half-diagonal', () => {
  // Documents WHY the floor exists: at 5 m the constant already equalled the
  // half-diagonal, so taps worked; at 7 m it no longer does without the floor.
  assert.lt(3.5, tapReachM({ cellM: 7 }, 3.5),
    'at a 7 m cell the bare 3.5 m radius is smaller than the floor');
});
