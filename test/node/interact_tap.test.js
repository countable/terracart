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

test('TAP_HANDLERS: treasure is second (use-consumable removed — Use button now)', () => {
  assert.eq(HANDLER_NAMES[1], 'treasure',
    'treasure must be index 1 — the tap-on-feet use-consumable handler was removed in favour of the persistent Use button');
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

// ─── 2b. Flavor labels for non-tillable terrain ──────────────────────────────
// Regression: a tap on a COMMERCIAL (retail plaza) cell flashed a lone '·'.
// The flavor handler only named water / buildings / the road tiers, so every
// other non-tillable code — commercial, industrial, bare rock, pier, cave
// floor — fell through to the placeholder dot.

test('TERRAIN_FLAVOR: every non-tillable terrain code has a real label', () => {
  for (const code of NON_TILLABLE_CODES) {
    const label = TERRAIN_FLAVOR[code];
    assert.truthy(typeof label === 'string' && label.length > 0,
      `terrain code ${code} is non-tillable but has no TERRAIN_FLAVOR label`);
    assert.falsy(label === '\u00b7',
      `terrain code ${code} still shows the placeholder dot instead of a name`);
  }
});

test('TERRAIN_FLAVOR: commercial / industrial cells name themselves', () => {
  assert.eq(TERRAIN_FLAVOR[TERRAIN.COMMERCIAL], 'plaza', 'commercial label');
  assert.eq(TERRAIN_FLAVOR[TERRAIN.INDUSTRIAL], 'industrial yard', 'industrial label');
});

test('TERRAIN_FLAVOR: the pinned road / water / building labels are unchanged', () => {
  assert.eq(TERRAIN_FLAVOR[TERRAIN.WATER],          'water',    'water');
  assert.eq(TERRAIN_FLAVOR[TERRAIN.ROAD],           'road',     'road');
  assert.eq(TERRAIN_FLAVOR[TERRAIN.PATH],           'path',     'path');
  assert.eq(TERRAIN_FLAVOR[TERRAIN.ROAD_LG],        'highway',  'highway');
  assert.eq(TERRAIN_FLAVOR[TERRAIN.ROAD_MD],        'avenue',   'avenue');
  assert.eq(TERRAIN_FLAVOR[TERRAIN.BUILDING],       'building', 'building');
  assert.eq(TERRAIN_FLAVOR[TERRAIN.BUILDING_MED],   'building', 'building (med)');
  assert.eq(TERRAIN_FLAVOR[TERRAIN.BUILDING_LARGE], 'building', 'building (large)');
});

test('flavor handler: flashes the terrain label, not a dot', () => {
  const flavor = TAP_HANDLERS.find(h => h.name === 'flavor');
  const seen = [];
  const scene = makeScene({ flash: (msg) => seen.push(msg) });
  for (const code of NON_TILLABLE_CODES) {
    seen.length = 0;
    const ctx = makeCtx(scene, {});
    ctx.cell = { type: code };
    assert.truthy(flavor.try(ctx), `flavor consumes the tap on terrain ${code}`);
    assert.eq(seen.length, 1, `one flash for terrain ${code}`);
    assert.eq(seen[0], TERRAIN_FLAVOR[code], `label for terrain ${code}`);
  }
});

// ── Road-band cells are not tillable ────────────────────────────────────────
// The terrain grid under-reports roads (QC rules: a way rasterizes ONE cell
// wide however wide its drawn band is), so a cell can read "grass" while the
// screen shows asphalt. cellAt (app.js) now carries a roadMask-derived
// `underRoad` flag and the tillable gate is isTillableCell, not the type-only
// isTillable. Since `flavor` is pinned BEFORE `till` (ordering test above),
// flavor consuming the tap on an underRoad cell is what proves the hoe can
// never reach it.

test('flavor handler: a grass cell under a road band is NOT tillable — tap reads as road', () => {
  const flavor = TAP_HANDLERS.find(h => h.name === 'flavor');
  const seen = [];
  const scene = makeScene({ flash: (msg) => seen.push(msg) });
  const ctx = makeCtx(scene, {});
  ctx.cell = { type: TERRAIN.GRASS, underRoad: true };
  assert.truthy(flavor.try(ctx), 'flavor consumes the tap — till never runs');
  assert.eq(seen[0], TERRAIN_FLAVOR[TERRAIN.ROAD],
    'the label matches what the player sees (the drawn road), not the grid grass');
});

test('flavor handler: the same grass cell without the road band still tills', () => {
  const flavor = TAP_HANDLERS.find(h => h.name === 'flavor');
  const scene = makeScene();
  const ctx = makeCtx(scene, {});
  ctx.cell = { type: TERRAIN.GRASS, underRoad: false };
  assert.falsy(flavor.try(ctx), 'flavor passes — the tap falls through to till');
  // And a cellAt-shaped stub with no underRoad field at all (older tests,
  // sandbox scenes) behaves identically to the old type-only check.
  ctx.cell = { type: TERRAIN.GRASS };
  assert.falsy(flavor.try(ctx), 'missing underRoad field = tillable as before');
});

test('release handler: animals cannot be released onto a road-band cell', () => {
  const release = TAP_HANDLERS.find(h => h.name === 'release');
  const seen = [];
  const scene = makeScene({ flash: (msg) => seen.push(msg) });
  const save = { inv: [{ id: 'chicken', count: 4 }], selSlot: 0, released: [] };
  const ctx = Object.assign(makeCtx(scene, save), { cwmx: 0, cwmy: 0 });
  ctx.cell = { type: TERRAIN.GRASS, underRoad: true };
  assert.truthy(release.try(ctx), 'release consumes the tap');
  assert.eq(seen[0], "can't release here", 'refused on the road band');
  assert.eq(save.inv[0].count, 4, 'no animal consumed');
});

test('TAP_HANDLERS: plant precedes till (a tilled cell is planted, not re-tilled)', () => {
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

// (Section 4 — use-consumable handler behaviour — removed along with the
// handler itself: self-targeted consumables are used via the persistent Use
// button (syncConsumableButton in app.js), not by tapping your own feet.)

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
    'treasure',
    'creature',
    'wildplant',
    'coindrop',
    'staircase',
    'object',
    'cell-resolve',
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

// ─── 5. Cell-bounded tap targeting ───────────────────────────────────────────
// Every non-fauna target is hit-tested against its OWN CELL. The tap-precision
// disks this replaced (object 3.5 m, house 6 m, wild plant 4 m, treasure
// 7.5 m, plus tapReachM's cell-half-diagonal floor) had to reach the far corner
// of the target's own cell, which meant they also reached ~1 m INTO all four
// neighbours — so a tap on the empty cell above a tall tree / turret / market
// stall activated it. These tests pin both halves of the rule: the whole of the
// target's own cell hits, and nothing outside it does.

// A scene with a clean projection: 32 cells per 256 px tile → 8 px per cell,
// mPerPx 0.625 → a 5 m cell whose index is simply floor(metres / 5).
const makeGridScene = (over = {}) => Object.assign(makeScene(), {
  cellM: 5,
  cellsPerTile: 32,
  mPerPx: 5 / (WorldGen.TILE_PX / 32),
  originPx: { x: 0, y: 0 },
  startWorldM: { x: 0, y: 0 },
  playerM: { x: 2.5, y: 2.5 },
  feetOffsetM: 0,
  depth: 0,
}, over);

test('sameAbsCell: two points inside one cell match', () => {
  const scene = makeGridScene();
  assert.truthy(sameAbsCell(scene, 0.1, 0.1, 4.9, 4.9), 'opposite corners of cell (0,0) are the same cell');
});

test('sameAbsCell: a neighbouring cell never matches, however close the points', () => {
  const scene = makeGridScene();
  // 0.2 m apart, but astride the gridline at 5 m — a disk test would call this a hit.
  assert.falsy(sameAbsCell(scene, 4.9, 2.5, 5.1, 2.5), 'across the east gridline → different cells');
  assert.falsy(sameAbsCell(scene, 2.5, 4.9, 2.5, 5.1), 'across the south gridline → different cells');
});

test('findItemInTapCell: a corner tap in the item\'s own cell still hits it', () => {
  const orig = globalThis.WorldGen;
  try {
    const items = [{ x: 2.5, y: 2.5, id: 'w1' }];
    globalThis.WorldGen = Object.assign({}, orig, {
      forEachItem: (layer, cb) => { for (const it of items) cb(it); },
    });
    globalThis.distM2 = (ax, ay, bx, by) => (ax-bx)**2 + (ay-by)**2;
    const scene = makeGridScene();
    const found = findItemInTapCell(scene, 'wildplants', { x: 4.9, y: 4.9 });
    assert.truthy(found !== null, 'far corner of the item cell is still the item cell');
    assert.eq(found.id, 'w1', 'the item in the tapped cell');
  } finally { globalThis.WorldGen = orig; delete globalThis.distM2; }
});

test('findItemInTapCell: tall art does NOT make the cell above it tappable', () => {
  const orig = globalThis.WorldGen;
  try {
    // Item seated in cell (0,2); tap lands in cell (0,1), 2.6 m north of it —
    // comfortably inside the old 3.5 m object disk, outside its cell.
    const items = [{ x: 2.5, y: 12.5, id: 'tree1' }];
    globalThis.WorldGen = Object.assign({}, orig, {
      forEachItem: (layer, cb) => { for (const it of items) cb(it); },
    });
    globalThis.distM2 = (ax, ay, bx, by) => (ax-bx)**2 + (ay-by)**2;
    const scene = makeGridScene();
    assert.eq(findItemInTapCell(scene, 'objects', { x: 2.5, y: 9.9 }), null,
      'the cell north of the sprite is not the sprite');
    assert.truthy(findItemInTapCell(scene, 'objects', { x: 2.5, y: 10.1 }) !== null,
      'one gridline further south IS its cell');
  } finally { globalThis.WorldGen = orig; delete globalThis.distM2; }
});

test('findItemInTapCell: rejected items are skipped even in the tapped cell', () => {
  const orig = globalThis.WorldGen;
  try {
    const items = [{ x: 2.0, y: 2.0, id: 'picked' }, { x: 3.0, y: 3.0, id: 'fresh' }];
    globalThis.WorldGen = Object.assign({}, orig, {
      forEachItem: (layer, cb) => { for (const it of items) cb(it); },
    });
    globalThis.distM2 = (ax, ay, bx, by) => (ax-bx)**2 + (ay-by)**2;
    const scene = makeGridScene();
    const found = findItemInTapCell(scene, 'wildplants', { x: 2.5, y: 2.5 }, (it) => it.id !== 'picked');
    assert.eq(found.id, 'fresh', 'the accepted item in the cell wins');
  } finally { globalThis.WorldGen = orig; delete globalThis.distM2; }
});

test('staircase handler: fires on the stair\'s cell, not the cell above it', () => {
  const orig = globalThis.WorldGen;
  try {
    const items = [{ kind: 'staircase', dir: 'down', x: 2.5, y: 12.5, id: 's1' }];
    globalThis.WorldGen = Object.assign({}, orig, {
      forEachItem: (layer, cb) => { if (layer === 'objects') for (const it of items) cb(it); },
    });
    globalThis.distM2 = (ax, ay, bx, by) => (ax-bx)**2 + (ay-by)**2;
    let descended = 0;
    const scene = makeGridScene({ changeDepth: () => { descended++; } });
    const save = { energy: 100, reachUpgrades: 0, inv: [], selSlot: 0 };
    scene.save = save;
    const h = TAP_HANDLERS.find(h => h.name === 'staircase');
    const at = (x, y) => Object.assign(makeCtx(scene, save), { wm: { x, y }, pWorldX: 2.5, pWorldY: 2.5 });

    assert.eq(h.try(at(2.5, 9.9)), false, 'tap one cell north of the stairs falls through');
    assert.eq(descended, 0, 'no level change from the neighbouring cell');
    assert.eq(h.try(at(4.9, 14.9)), true, 'a corner tap inside the stair cell is consumed');
    assert.eq(descended, 1, 'level changed once');
  } finally { globalThis.WorldGen = orig; delete globalThis.distM2; }
});

// ─── 6. creature handler: tap the DRAWN body, not the foot cell ───────────────
// REGRESSION (this task): creatures are drawn feet-anchored (setOrigin 0.5,0.9)
// so the visible body sits well above the logical ground point. The old foot-
// centred tap disk missed the body and the tap fell through to the cell handler,
// tilling the tile UNDER the animal ("hard to tap, hits the tile below"). The
// handler now tests the tap against the sprite's drawn box. These tests drive
// the real 'creature' handler with a stubbed creatures layer + reach helpers.

// Run the creature handler against a single creature at world (0,0). The reach
// helpers are stubbed so tooFar() returns true (→ 'far') whenever the creature
// is FOUND — that lets us assert "found" (='far') vs "fell through" (=false)
// without exercising the full catch/feed flow. cellInReach=false forces 'far'.
function runCreatureTap(kind, wm, cellInReach) {
  const orig = {
    WG: globalThis.WorldGen, CIR: globalThis.cellInReach, WMC: globalThis.worldMetersToAbsCell,
  };
  const scene = Object.assign(makeScene(), { feetOffsetM: 0, cellM: 7, cellPx: 32, flash: () => {} });
  const save  = { caught: [], inv: [], selSlot: 0 };
  const ctx   = Object.assign(makeCtx(scene, save), { wm });
  const h = TAP_HANDLERS.find(x => x.name === 'creature');
  try {
    globalThis.WorldGen = Object.assign({}, orig.WG, {
      forEachItem: (layer, cb) => { if (layer === 'creatures') cb({ x: 0, y: 0, kind, id: `${kind}1` }); },
    });
    globalThis.cellInReach = () => cellInReach;
    globalThis.worldMetersToAbsCell = () => ({ cellIX: 0, cellIY: 0 });
    return h.try(ctx);
  } finally {
    globalThis.WorldGen = orig.WG;
    globalThis.cellInReach = orig.CIR;
    globalThis.worldMetersToAbsCell = orig.WMC;
  }
}

test('creature: a tap on the body ABOVE the foot resolves to the creature (chicken)', () => {
  // 1.6 m north of the foot ≈ 7 px up — the chicken body centre. This is OUTSIDE
  // the old 1.5 m foot disk, so before the fix the tap fell through (false).
  assert.eq(runCreatureTap('chicken', { x: 0, y: -1.6 }, false), 'far',
    'tap on the chicken body finds the creature (returns far, not false)');
});

test('creature: tall sprite (cow) is tappable far up its body', () => {
  // ~6 m north of the foot — high on the cow, well above any foot disk.
  assert.eq(runCreatureTap('cow', { x: 0, y: -6 }, false), 'far',
    'tap high on the cow body still finds the cow');
});

test('creature: a slime tap on the hopping blob resolves (not the tile below)', () => {
  assert.eq(runCreatureTap('slime', { x: 0, y: -2.5 }, false), 'far',
    'tap on the floated/hopping slime body finds the slime');
});

test('creature: a tap on the tile BELOW the foot does NOT grab the creature', () => {
  // 3 m south of the foot is below the sprite — must fall through (false) so the
  // cell handler can till it. (Only a small under-feet pad is forgiven.)
  assert.eq(runCreatureTap('chicken', { x: 0, y: 3 }, false), false,
    'tap well below the animal falls through to the cell handler');
});

test('creature: a tap two cells to the side finds nothing (false)', () => {
  assert.eq(runCreatureTap('chicken', { x: 14, y: 0 }, false), false,
    'far-side tap does not grab the creature');
});
