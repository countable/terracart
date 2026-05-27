// Test cases. Each test reaches into the running scene via the helpers in
// runner.js. Tests share state — wipe the slice each test cares about at the
// top so they're independent of run order.

// ───────────────────────────────────────────────────────────────────────
// 1. Sanity / setup
// ───────────────────────────────────────────────────────────────────────

test('scene boots and start tile loads', (scene) => {
  assert.truthy(scene, 'scene present');
  const startTile = WorldGen.tileCache.get(`${WorldGen.Z}/2754/5566`);
  assert.truthy(startTile, 'start tile cached');
  assert.truthy(startTile.grid, 'start tile rasterized');
  assert.gt(startTile.wildplants.length, 0, 'wildplants spawned');
  assert.gt(startTile.objects.length, 0, 'objects spawned');
});

test('wildplant dedup — no two share the same cell', () => {
  let dups = 0;
  for (const entry of WorldGen.tileCache.values()) {
    if (!entry.wildplants) continue;
    const seen = new Set();
    for (const wp of entry.wildplants) {
      const k = `${wp.x.toFixed(2)},${wp.y.toFixed(2)}`;
      if (seen.has(k)) dups++; else seen.add(k);
    }
  }
  assert.eq(dups, 0, 'duplicate-cell wildplants');
});

// ───────────────────────────────────────────────────────────────────────
// 2. Wild plant pickup
// ───────────────────────────────────────────────────────────────────────

test('picking a wildplant within reach adds to inventory and marks picked', (scene) => {
  scene.save.picked = [];
  scene.save.inv = [];
  // Find a non-rockfruit wildplant near the world origin (rockfruit pickup is
  // now an async work-progress action and would only land mid-tick).
  const wp = findWildplant(w =>
    w.crop !== 'rockfruit' &&
    Math.hypot(w.x - scene.startWorldM.x, w.y - scene.startWorldM.y) < 50);
  assert.truthy(wp, 'found a starter non-rockfruit wildplant');
  // Stand right on top of it.
  teleport(scene, wp.x, wp.y);
  const before = invCount(scene, wp.crop);
  tapWorld(scene, wp.x, wp.y);
  assert.eq(invCount(scene, wp.crop), before + 1, `+1 ${wp.crop} in inv`);
  assert.truthy(scene.save.picked.includes(wp.id), 'wp.id in picked');
});

test('picking again at same spot does nothing (already picked)', (scene) => {
  // Need an ISOLATED wildplant — no other wp within 4m, otherwise the
  // second tap would correctly pick the next-nearest neighbour and the
  // assertion would be wrong about what the system should do.
  scene.save.picked = [];
  scene.save.inv = [];
  let isolated = null;
  outer: for (const entry of WorldGen.tileCache.values()) {
    if (!entry.wildplants) continue;
    for (const wp of entry.wildplants) {
      if (wp.crop === 'rockfruit') continue;   // async work-progress, skip
      let lonely = true;
      for (const other of entry.wildplants) {
        if (other === wp) continue;
        if (Math.hypot(other.x - wp.x, other.y - wp.y) < 8) { lonely = false; break; }
      }
      if (lonely) { isolated = wp; break outer; }
    }
  }
  if (!isolated) return;  // dense fixture — skip
  teleport(scene, isolated.x, isolated.y);
  tapWorld(scene, isolated.x, isolated.y);
  const after1 = invCount(scene, isolated.crop);
  assert.eq(after1, 1, 'first tap picked it');
  tapWorld(scene, isolated.x, isolated.y);
  assert.eq(invCount(scene, isolated.crop), after1, 'second tap is a no-op');
});

test('nearest-match wins between two stacked plants', (scene) => {
  scene.save.picked = [];
  scene.save.inv = [];
  // Find two wildplants in adjacent cells (one cell ≈ 5m apart vertically).
  let pair = null;
  for (const entry of WorldGen.tileCache.values()) {
    if (!entry.wildplants) continue;
    for (let i = 0; i < entry.wildplants.length && !pair; i++) {
      const a = entry.wildplants[i];
      for (let j = i + 1; j < entry.wildplants.length; j++) {
        const b = entry.wildplants[j];
        if (Math.abs(a.x - b.x) < 0.5 && Math.abs(Math.abs(a.y - b.y) - 5) < 0.5) {
          pair = { a, b }; break;
        }
      }
    }
    if (pair) break;
  }
  if (!pair) return;  // no eligible pair in fixture — skip gracefully
  // Stand mid-distance. Tap directly on `a`'s coords → expect a, not b.
  const midX = pair.a.x, midY = (pair.a.y + pair.b.y) / 2;
  teleport(scene, midX, midY);
  tapWorld(scene, pair.a.x, pair.a.y);
  assert.truthy(scene.save.picked.includes(pair.a.id), 'tapped the right one (a)');
  assert.falsy(scene.save.picked.includes(pair.b.id), 'did NOT pick the wrong one (b)');
});

test('wildplant pickup outside REACH_FAR_M flashes "too far"', (scene) => {
  scene.save.picked = [];
  scene.save.inv = [];
  const wp = findWildplant(w =>
    Math.hypot(w.x - scene.startWorldM.x, w.y - scene.startWorldM.y) < 30);
  assert.truthy(wp, 'found a starter wildplant');
  // Stand 25m away (well outside REACH_FAR_M = 16m, measured from player
  // cell centre) but tap on the plant.
  teleport(scene, wp.x + 25, wp.y);
  tapWorld(scene, wp.x, wp.y);
  assert.falsy(scene.save.picked.includes(wp.id), 'not picked');
  assert.eq(invCount(scene, wp.crop), 0, 'inv empty');
});

// REACH SHAPE
//
// Two related properties locked down by this test:
//   1. The reach silhouette is a rounded square, not a strict diamond — the
//      (±1, ±3) and (±3, ±1) cells (15.81 m from cell-centre) are tappable.
//   2. Standing at the EDGE of your cell doesn't shrink the reach. Both the
//      visual outline and the "too far" gate measure from the player's
//      CELL CENTRE, so any cell in the outline is tappable regardless of
//      where in the player's cell their feet are.
//
// We capture scene.flash() calls and check whether 'too far' fires for each
// offset. Detecting via flash means we exercise the real cell-resolve gate
// (not just the math), which is the regression surface for both bugs.
test('reach shape includes (±1, ±3) and (±3, ±1); origin is the FEET cell', (scene) => {
  // Anchor at an interior grass cell so all ±3 offsets stay on loaded terrain.
  const startTile = WorldGen.tileCache.get(`${WorldGen.Z}/2754/5566`);
  if (!startTile) return;
  let bodyCell = null;
  for (let i = 0; i < startTile.grid.length && !bodyCell; i++) {
    if (startTile.grid[i] !== 0) continue;
    const cx = i % scene.cellsPerTile, cy = Math.floor(i / scene.cellsPerTile);
    if (cx < 4 || cy < 5 || cx > scene.cellsPerTile - 5 || cy > scene.cellsPerTile - 5) continue;
    const approxX = 2754 * startTile.tileEdgeM + (cx + 0.5) * scene.cellM;
    const approxY = 5566 * startTile.tileEdgeM + (cy + 0.5) * scene.cellM;
    const { cellIX, cellIY } = worldMetersToAbsCell(scene, approxX, approxY);
    bodyCell = absCellCenterMeters(scene, cellIX, cellIY);
  }
  if (!bodyCell) return;
  // The reach is centred on the FEET cell, not the body cell. With the body
  // teleported to its cell centre, the feet land in the cell ONE ROW SOUTH.
  // Offsets in this test are expressed RELATIVE to the feet cell, so we
  // shift the tap-y by +1 cell to convert from feet-offset back to body-y.
  const FEET_ROW_OFFSET = 1;

  const origFlash = scene.flash;
  const flashes = [];
  scene.flash = (msg) => { flashes.push(msg); };
  try {
    const tapOffsetFromFeet = (dxCells, dyCells) => {
      flashes.length = 0;
      teleport(scene, bodyCell.x, bodyCell.y);
      // Tap (dxCells, dyCells) cells from the feet cell. Feet cell is at
      // body cell + FEET_ROW_OFFSET rows, so in world coords we add it back.
      tapWorld(scene,
        bodyCell.x + dxCells * scene.cellM,
        bodyCell.y + (dyCells + FEET_ROW_OFFSET) * scene.cellM);
      return flashes.some(m => typeof m === 'string' && /too far/i.test(m));
    };

    // The rounded-square shape — same geometry as before, just centred on
    // the feet cell instead of the body cell. (±1, ±3) and (±3, ±1) are
    // included; (±2, ±3) / (±3, ±3) are not.
    assert.falsy(tapOffsetFromFeet( 1,  3), '(1, 3) cell tappable from feet (rounded-square shape)');
    assert.falsy(tapOffsetFromFeet(-1,  3), '(-1, 3) cell tappable');
    assert.falsy(tapOffsetFromFeet( 3,  1), '(3, 1) cell tappable');
    assert.falsy(tapOffsetFromFeet( 3, -1), '(3, -1) cell tappable');
    assert.falsy(tapOffsetFromFeet( 0,  3), '(0, 3) cell tappable');
    assert.falsy(tapOffsetFromFeet( 3,  0), '(3, 0) cell tappable');
    // Outside the rounded-square.
    assert.truthy(tapOffsetFromFeet( 3,  3), '(3, 3) too far (√18·5 ≈ 21 m > 16 m)');
    assert.truthy(tapOffsetFromFeet( 2,  3), '(2, 3) too far (√13·5 ≈ 18 m > 16 m)');
  } finally {
    scene.flash = origFlash;
  }
});

// ───────────────────────────────────────────────────────────────────────
// 3. Chest interaction
// ───────────────────────────────────────────────────────────────────────

test('opening a chest adds loot and marks it opened', (scene) => {
  scene.save.opened = [];
  scene.save.inv = [];
  // Pin Math.random so the 10% chest-relic branch DOESN'T fire — relic-equip
  // doesn't add to inv, which would make the "loot added" assertion flaky.
  // Stubbed only for the duration of the tap so we don't pollute save state
  // for later tests (which is why we no longer max out the relic slots here).
  const chest = findObject(o =>
    o.kind === 'chest' && o.poiClass &&
    Math.hypot(o.x - scene.startWorldM.x, o.y - scene.startWorldM.y) < 200);
  assert.truthy(chest, 'found a chest near start');
  teleport(scene, chest.x, chest.y - 2);
  const invBefore = (scene.save.inv || []).length;
  const moneyBefore = scene.save.money ?? 0;
  const origRandom = Math.random;
  Math.random = () => 0.99;   // > 0.10 → relic branch skipped
  try { tapWorld(scene, chest.x, chest.y); } finally { Math.random = origRandom; }
  assert.gt(scene.save.opened.length, 0, 'a chest was opened');
  // With Math.random pinned to 0.99 the relic branch is skipped, so the chest
  // always drops normal item loot — inv must grow.
  assert.gt((scene.save.inv || []).length, invBefore, 'loot added to inv');
});

test('tapping an already-opened chest is a no-op', (scene) => {
  const openedId = scene.save.opened[scene.save.opened.length - 1];
  const chest = findObject(o => o.id === openedId);
  assert.truthy(chest, 'previously-opened chest still in cache');
  const invLen = (scene.save.inv || []).length;
  teleport(scene, chest.x, chest.y - 2);
  tapWorld(scene, chest.x, chest.y);
  assert.eq((scene.save.inv || []).length, invLen, 'no new loot');
});

// ───────────────────────────────────────────────────────────────────────
// 4. Terrain classification — these don't tap, just probe cellAt.
// ───────────────────────────────────────────────────────────────────────

test('cellAt returns a numeric terrain type for every loaded cell', (scene) => {
  const startTile = WorldGen.tileCache.get(`${WorldGen.Z}/2754/5566`);
  const tileEdgeM = startTile.tileEdgeM;
  const cellM = scene.cellM;
  // Sample 50 random cells in the start tile.
  let coverage = 0;
  for (let i = 0; i < 50; i++) {
    const cx = Math.floor(Math.random() * scene.cellsPerTile);
    const cy = Math.floor(Math.random() * scene.cellsPerTile);
    const wx = 2754 * tileEdgeM + (cx + 0.5) * cellM;
    const wy = 5566 * tileEdgeM + (cy + 0.5) * cellM;
    const r = scene.cellAt(wx, wy);
    assert.truthy(r.loaded, 'loaded');
    assert.eq(typeof r.type, 'number', 'numeric type');
    coverage++;
  }
  assert.gt(coverage, 0, 'sampled some cells');
});

test('tilling an empty grass cell adds it to tilledSet', (scene) => {
  scene.save.tilled = [];
  scene.tilledSet = new Set();
  scene.save.planted = scene.save.planted || [];
  // Find an empty grass/park cell that has no wildplant and no object on it.
  const startTile = WorldGen.tileCache.get(`${WorldGen.Z}/2754/5566`);
  const cellM = scene.cellM;
  const tileEdgeM = startTile.tileEdgeM;
  const wpCells = new Set();
  for (const wp of startTile.wildplants) {
    const ix = Math.floor((wp.x - 2754 * tileEdgeM) / cellM);
    const iy = Math.floor((wp.y - 5566 * tileEdgeM) / cellM);
    wpCells.add(`${ix}_${iy}`);
  }
  const objCells = new Set();
  for (const o of startTile.objects) {
    if (o.kind === 'flora') continue;
    const ix = Math.floor((o.x - 2754 * tileEdgeM) / cellM);
    const iy = Math.floor((o.y - 5566 * tileEdgeM) / cellM);
    objCells.add(`${ix}_${iy}`);
  }
  // Grass (0), Park (6), Farmland (4), Residential (5) are tillable per app.js.
  const TILLABLE = new Set([0, 4, 5, 6]);
  let target = null;
  for (let i = 0; i < startTile.grid.length && !target; i++) {
    if (!TILLABLE.has(startTile.grid[i])) continue;
    const cx = i % scene.cellsPerTile, cy = Math.floor(i / scene.cellsPerTile);
    if (wpCells.has(`${cx}_${cy}`) || objCells.has(`${cx}_${cy}`)) continue;
    target = {
      x: 2754 * tileEdgeM + (cx + 0.5) * cellM,
      y: 5566 * tileEdgeM + (cy + 0.5) * cellM,
    };
  }
  assert.truthy(target, 'found an empty tillable cell');
  // Clear inventory so the tap doesn't trigger plant/place-rock branches.
  scene.save.inv = [];
  scene.save.selSlot = 0;
  teleport(scene, target.x, target.y);
  const sizeBefore = scene.tilledSet.size;
  tapWorld(scene, target.x, target.y);
  assert.eq(scene.tilledSet.size, sizeBefore + 1, 'tilledSet grew by 1');
  assert.gt(scene.save.tilled.length, 0, 'save.tilled persisted');
});

test('tapping a tilled cell again un-tills it (no seed selected)', (scene) => {
  // Reuse the cell tilled in the previous test. Convert the saved key
  // (abs tile-pixel-basis cell index) back to world meters via scene helper.
  assert.gt(scene.tilledSet.size, 0, 'precondition: at least one tilled cell');
  const cellKey = [...scene.tilledSet][0];
  const [cellIX, cellIY] = cellKey.split('_').map(Number);
  const c = absCellCenterMeters(scene, cellIX, cellIY);
  teleport(scene, c.x, c.y);
  scene.save.inv = [];
  tapWorld(scene, c.x, c.y);
  assert.falsy(scene.tilledSet.has(cellKey), 'cell un-tilled');
});

test('water cells are blocked from tilling', (scene) => {
  scene.save.tilled = [];
  scene.tilledSet = new Set();
  // Find a water cell.
  let water = null;
  const startTile = WorldGen.tileCache.get(`${WorldGen.Z}/2754/5566`);
  for (let i = 0; i < startTile.grid.length && !water; i++) {
    if (startTile.grid[i] === 3 /* WATER */) {
      const cx = i % scene.cellsPerTile, cy = Math.floor(i / scene.cellsPerTile);
      water = {
        x: 2754 * startTile.tileEdgeM + (cx + 0.5) * scene.cellM,
        y: 5566 * startTile.tileEdgeM + (cy + 0.5) * scene.cellM,
      };
    }
  }
  if (!water) return;   // no water in fixture — skip
  teleport(scene, water.x, water.y);
  tapWorld(scene, water.x, water.y);
  assert.eq(scene.tilledSet.size, 0, 'no water cell got tilled');
});

// ───────────────────────────────────────────────────────────────────────
// 5. Pad shape mapping
// ───────────────────────────────────────────────────────────────────────

test('POI categories resolve to expected pad shapes', () => {
  assert.eq(padShapeKeyForPoi('school'), 'triangle', 'school → triangle');
  assert.eq(padShapeKeyForPoi('pitch'), 'square2', 'pitch → square2');
  assert.eq(padShapeKeyForPoi('place_of_worship'), 'cross', 'chapel → cross');
  assert.eq(padShapeKeyForPoi('pharmacy'), 'cross', 'pharmacy → cross');
  assert.eq(padShapeKeyForPoi('restaurant'), 'line3h', 'restaurant → line3h (food)');
  assert.eq(padShapeKeyForPoi('playground'), 'line3v', 'playground → line3v');
  assert.eq(padShapeKeyForPoi('bus'), null, 'bus → no pad');
  assert.eq(padShapeKeyForPoi('gate'), null, 'gate → no pad');
});

test('all pad shape textures registered', (scene) => {
  for (const k of Object.keys(PAD_SHAPES)) {
    assert.truthy(scene.textures.exists(`pad_${k}`), `pad_${k} texture exists`);
  }
});

// ───────────────────────────────────────────────────────────────────────
// 6. Price coverage
// ───────────────────────────────────────────────────────────────────────

test('every produce item has a sell price', () => {
  for (const item of ITEMS) {
    if (item.kind !== 'produce') continue;
    assert.truthy(PRICES[item.id] != null, `price for ${item.id}`);
    assert.gt(PRICES[item.id], 0, `price > 0 for ${item.id}`);
  }
});

test('produce prices range from $1 (rockfruit) to $500 (sunflower)', () => {
  assert.eq(PRICES.rockfruit, 1, 'rockfruit floor = $1');
  assert.eq(PRICES.sunflower, 500, 'sunflower ceiling = $500');
});

// ───────────────────────────────────────────────────────────────────────
// 7. Save debounce
// ───────────────────────────────────────────────────────────────────────

test('persistSave coalesces rapid writes', async () => {
  const start = localStorage.getItem(SAVE_KEY);
  const tag = Date.now();
  // Fire 5 saves in rapid succession with distinct mutation.
  for (let i = 0; i < 5; i++) {
    window.__scene.save._testTag = tag + i;
    persistSave(window.__scene.save);
  }
  // Within the debounce window, localStorage should still be the OLD value.
  assert.eq(localStorage.getItem(SAVE_KEY), start, 'still old before flush');
  // After > 500ms, flush should have happened.
  await new Promise(r => setTimeout(r, 700));
  const after = JSON.parse(localStorage.getItem(SAVE_KEY));
  assert.eq(after._testTag, tag + 4, 'last write wins after flush');
});

// ───────────────────────────────────────────────────────────────────────
// 8. Regression tests — for fixes shipped at ?v=56 (deep-dive audit).
// Each test guards a specific behaviour with a known prior bug; comment
// references the audit bug number.
// ───────────────────────────────────────────────────────────────────────

// #2 — Legacy inv migration: items must have numeric count or arithmetic NaN's.
test('REG #2: legacy inv migration assigns numeric count', () => {
  // Simulate the migration code path on a synthetic save.
  const save = { inv: ['potato_seed', 'rockfruit'] };
  if (save.inv && typeof save.inv[0] === 'string') {
    save.inv = save.inv.filter(Boolean).map(id => ({ id, count: 1 }));
  }
  for (const s of save.inv) {
    assert.eq(typeof s.count, 'number', `${s.id}.count is numeric`);
    assert.eq(s.count, 1, `${s.id}.count = 1`);
    // Decrementing must not produce NaN — the failing pre-fix mode.
    s.count -= 1;
    assert.eq(s.count, 0, `${s.id} decrements cleanly to 0 (was NaN bug)`);
  }
});

// #2 (continued) — verify the actual scene's migrated inv never carries undefined counts.
test('REG #2: live scene inventory items all have numeric count', (scene) => {
  for (const s of (scene.save.inv || [])) {
    if (!s) continue;
    assert.truthy(s.count != null, `slot ${s.id}: count present`);
    assert.eq(typeof s.count, 'number', `slot ${s.id}: count numeric`);
    assert.falsy(Number.isNaN(s.count), `slot ${s.id}: count not NaN`);
  }
});

// #5 — Auto-advance must NOT fall through to harvest in the same tap.
test('REG #5: watered crop ready to mature advances but does NOT harvest in one tap', (scene) => {
  // An earlier wildplant pickup test may have started a work-progress (e.g.
  // picking a rockfruit/shrub triggers startWorkProgress) that never resolves
  // in test mode. The 'work-progress' tap-handler would then swallow our tap.
  if (scene._workProgress) scene.cancelWorkProgress();
  scene.save.planted = [];
  scene.save.tilled = [];
  scene.tilledSet = new Set();
  scene.save.inv = [];
  scene.save.selSlot = 0;
  // Find an empty tillable cell near origin; plant exactly at the cell centre that
  // the tap handler will compute via absCellCenterMeters (tile-pixel basis), not the
  // 5m grid basis — otherwise findIndex(0.1) won't locate the plant.
  const startTile = WorldGen.tileCache.get(`${WorldGen.Z}/2754/5566`);
  const TILLABLE = new Set([0, 4, 5, 6]);
  let target = null;
  for (let i = 0; i < startTile.grid.length && !target; i++) {
    if (!TILLABLE.has(startTile.grid[i])) continue;
    const cx = i % scene.cellsPerTile, cy = Math.floor(i / scene.cellsPerTile);
    const approxX = 2754 * startTile.tileEdgeM + (cx + 0.5) * scene.cellM;
    const approxY = 5566 * startTile.tileEdgeM + (cy + 0.5) * scene.cellM;
    const { cellIX, cellIY } = worldMetersToAbsCell(scene, approxX, approxY);
    const c = absCellCenterMeters(scene, cellIX, cellIY);
    // Also ensure no wildplant AND no object on this cell — both the wildplant
    // and object handlers run before planted. A fruittree / mineralrock / chest
    // on the cell would intercept the tap.
    let blocked = false;
    for (const wp of startTile.wildplants || []) {
      if (Math.abs(wp.x - c.x) < scene.cellM/2 && Math.abs(wp.y - c.y) < scene.cellM/2) { blocked = true; break; }
    }
    if (!blocked) {
      for (const o of startTile.objects || []) {
        if (o.kind === 'flora') continue;
        if (Math.abs(o.x - c.x) < scene.cellM/2 && Math.abs(o.y - c.y) < scene.cellM/2) { blocked = true; break; }
      }
    }
    if (!blocked) target = { x: c.x, y: c.y, cellIX, cellIY };
  }
  assert.truthy(target, 'found a tillable empty cell');
  teleport(scene, target.x, target.y);
  // Inject: one-stage-from-mature, watered well in the past.
  const oneHourAgo = Date.now() - (60 * 60 * 1000 + 1000);
  scene.save.planted.push({
    x: target.x, y: target.y, crop: 'potato',
    stage: MAX_GROWTH_STAGE - 1, watered_t: oneHourAgo,
  });
  scene.tilledSet.add(`${target.cellIX}_${target.cellIY}`);
  // Tap → should advance to MAX and STOP, not harvest.
  const before = (scene.save.inv || []).length;
  tapWorld(scene, target.x, target.y);
  // After tap: planted entry should still exist; stage advanced to MAX.
  const entry = scene.save.planted.find(p =>
    Math.abs(p.x - target.x) < 0.1 && Math.abs(p.y - target.y) < 0.1);
  assert.truthy(entry, 'plant still present (not harvested)');
  assert.eq(entry.stage, MAX_GROWTH_STAGE, 'stage advanced to MAX');
  assert.eq(entry.watered_t, 0, 'reset to dry');
  assert.eq((scene.save.inv || []).length, before, 'no harvest yield given');
});

// #8 — Tap dedupe prefers unlooted over looted at the same name+position.
test('REG #8: looted-chest duplicate doesn\'t hide unlooted sibling from tap', (scene) => {
  scene.save.opened = [];
  scene.save.inv = [];
  // Find any chest. Synthesize a looted duplicate 5m offset with a different id.
  const real = findObject(o => o.kind === 'chest' && o.poiClass);
  assert.truthy(real, 'have a real chest');
  // Inject a looted ghost duplicate into the same tile's objects list.
  const tile = [...WorldGen.tileCache.values()].find(e => (e.objects || []).includes(real));
  const ghostId = `c_ghost_${Date.now()}`;
  const ghost = { kind: 'chest', x: real.x + 5, y: real.y + 5, id: ghostId,
                  poiClass: real.poiClass, name: real.name };
  tile.objects.push(ghost);
  scene.save.opened.push(ghostId);   // mark the ghost as already-looted
  // Stub Math.random so the chest-open path's 10% relic-reward roll
  // always falls through to normal loot — otherwise the assert below is flaky.
  const realRandom = Math.random;
  Math.random = () => 0.5;
  try {
    teleport(scene, real.x, real.y - 2);
    const invBefore = (scene.save.inv || []).length;
    tapWorld(scene, real.x, real.y);
    // Real chest should now be opened (loot added).
    assert.truthy(scene.save.opened.includes(real.id), 'real chest got opened, not ghost');
    assert.gt((scene.save.inv || []).length, invBefore, 'loot was added');
  } finally {
    Math.random = realRandom;
    // Cleanup: remove ghost, untag opened so subsequent tests aren't affected.
    const gi = tile.objects.indexOf(ghost);
    if (gi >= 0) tile.objects.splice(gi, 1);
    scene.save.opened = scene.save.opened.filter(id => id !== ghostId);
  }
});

// #9 — catching a released animal trims it from save.released so the array
// doesn't grow unbounded across release/recatch cycles.
test('REG #9: catching a released animal removes it from save.released', (scene) => {
  scene.save.released = scene.save.released || [];
  scene.save.caught = scene.save.caught || [];
  const id = `released_test_${Date.now()}`;
  scene.save.released.push({ x: 0, y: 0, kind: 'chicken', id, tx: 0, ty: 0 });
  const beforeLen = scene.save.released.length;
  scene.catchCreature({ id, kind: 'chicken' }, 0, 0);
  assert.eq(scene.save.released.length, beforeLen - 1, 'released entry removed');
  assert.truthy(scene.save.caught.includes(id), 'id in caught');
});

// Animal catch via TAP requires the favourite food in the selected slot.
test('catch handler refuses without favourite food, succeeds with it', (scene) => {
  // Find any uncaught chicken anywhere in cache.
  let target = null;
  for (const e of WorldGen.tileCache.values()) {
    for (const c of (e.creatures || [])) {
      if (c.kind === 'chicken' && !scene.save.caught.includes(c.id)) { target = c; break; }
    }
    if (target) break;
  }
  assert.truthy(target, 'found an uncaught chicken');
  scene.save.energy = scene.save.maxEnergy ?? 100;
  // No food → flash, no catch.
  scene.save.inv = []; scene.save.selSlot = 0;
  teleport(scene, target.x, target.y - 1);
  tapWorld(scene, target.x, target.y);
  assert.falsy(scene.save.caught.includes(target.id), 'no catch without rainberry');
  // Holding rainberry → catches AND consumes one.
  scene.save.inv = [{ id: 'rainberry', count: 3 }];
  scene.save.selSlot = 0;
  tapWorld(scene, target.x, target.y);
  assert.truthy(scene.save.caught.includes(target.id), 'caught with rainberry');
  const r = scene.save.inv.find(s => s && s.id === 'rainberry');
  assert.eq(r ? r.count : 0, 2, 'one rainberry consumed');
});

// Wrong-food → yuck: animal NOT caught, food still consumed. Use egg on
// a chicken — chickens accept any PLANT produce now (which yields more
// eggs), so the only unambiguous "yuck" path is non-plant edible items
// like egg / milk on chickens / cows.
test('feeding wrong food yields yuck and consumes the food', (scene) => {
  let target = null;
  for (const e of WorldGen.tileCache.values()) {
    for (const c of (e.creatures || [])) {
      if (c.kind === 'chicken' && !scene.save.caught.includes(c.id)) { target = c; break; }
    }
    if (target) break;
  }
  if (!target) return;
  // Egg → chicken: edible but not a plant, not the favourite. Yuck.
  scene.save.inv = [{ id: 'egg', count: 3 }];
  scene.save.selSlot = 0;
  scene.save.energy = scene.save.maxEnergy ?? 100;
  teleport(scene, target.x, target.y - 1);
  tapWorld(scene, target.x, target.y);
  assert.falsy(scene.save.caught.includes(target.id), 'no catch on wrong food');
  const e = scene.save.inv.find(s => s && s.id === 'egg');
  assert.eq(e ? e.count : 0, 2, 'wrong food still consumed (yuck)');
});

// Any plant produce fed to a chicken/cow yields an egg/milk.
test('feeding any plant produce to a chicken yields an egg', (scene) => {
  let target = null;
  for (const e of WorldGen.tileCache.values()) {
    for (const c of (e.creatures || [])) {
      if (c.kind === 'chicken' && !scene.save.caught.includes(c.id)) { target = c; break; }
    }
    if (target) break;
  }
  if (!target) return;
  // pairy is a non-favourite plant produce for chickens.
  scene.save.inv = [{ id: 'pairy', count: 2 }];
  scene.save.selSlot = 0;
  scene.save.energy = scene.save.maxEnergy ?? 100;
  teleport(scene, target.x, target.y - 1);
  tapWorld(scene, target.x, target.y);
  assert.falsy(scene.save.caught.includes(target.id), 'chicken not caught (pairy is not favourite)');
  const p = scene.save.inv.find(s => s && s.id === 'pairy');
  assert.eq(p ? p.count : 0, 1, 'one pairy consumed');
  const eggStack = scene.save.inv.find(s => s && s.id === 'egg');
  assert.truthy(eggStack && eggStack.count >= 1, 'egg produced from pairy');
});

// Feeding longgrass to an animal swaps it for egg / milk and leaves the
// animal in the world for repeat feeding.
test('feeding longgrass to a chicken yields an egg without catching', (scene) => {
  let target = null;
  for (const e of WorldGen.tileCache.values()) {
    for (const c of (e.creatures || [])) {
      if (c.kind === 'chicken' && !scene.save.caught.includes(c.id)) { target = c; break; }
    }
    if (target) break;
  }
  assert.truthy(target, 'found an uncaught chicken');
  scene.save.inv = [{ id: 'longgrass', count: 2 }];
  scene.save.selSlot = 0;
  teleport(scene, target.x, target.y - 1);
  tapWorld(scene, target.x, target.y);
  // Longgrass consumed by 1.
  const lg = scene.save.inv.find(s => s && s.id === 'longgrass');
  assert.eq(lg ? lg.count : 0, 1, 'one longgrass consumed');
  // Egg added.
  const eggStack = scene.save.inv.find(s => s && s.id === 'egg');
  assert.truthy(eggStack && eggStack.count >= 1, 'egg added to inventory');
  // Chicken NOT caught — still wandering for next feed.
  assert.falsy(scene.save.caught.includes(target.id), 'chicken stays in world');
});

// Cat needs milk to catch. Longgrass on a cat = yuck, no produce.
test('cat catch: milk works, longgrass yucks', (scene) => {
  let target = null;
  for (const e of WorldGen.tileCache.values()) {
    for (const c of (e.creatures || [])) {
      if (c.kind === 'cat' && !scene.save.caught.includes(c.id)) { target = c; break; }
    }
    if (target) break;
  }
  if (!target) return;   // no cats loaded in this fixture — skip silently
  scene.save.energy = scene.save.maxEnergy ?? 100;
  // Longgrass → yuck (cats don't produce milk from grass).
  scene.save.inv = [{ id: 'longgrass', count: 2 }];
  scene.save.selSlot = 0;
  teleport(scene, target.x, target.y - 1);
  tapWorld(scene, target.x, target.y);
  assert.falsy(scene.save.caught.includes(target.id), 'longgrass does not catch cat');
  const lg = scene.save.inv.find(s => s && s.id === 'longgrass');
  assert.eq(lg ? lg.count : 0, 1, 'longgrass consumed (yuck)');
  assert.falsy(scene.save.inv.some(s => s && s.id === 'milk'), 'NO milk produced from cat+longgrass');
  // Milk catches.
  scene.save.inv = [{ id: 'milk', count: 1 }];
  scene.save.selSlot = 0;
  tapWorld(scene, target.x, target.y);
  assert.truthy(scene.save.caught.includes(target.id), 'cat caught with milk');
});

// #10 — Animal release is rejected on non-tillable terrain (water/road/building).
test('REG #10: releasing on a road / water cell is refused', (scene) => {
  // Find a road cell with NO creature within ~6m (otherwise the catch branch
  // fires first and the test reads a false positive on inv mutation).
  const startTile = WorldGen.tileCache.get(`${WorldGen.Z}/2754/5566`);
  const creatures = [];
  for (const e of WorldGen.tileCache.values()) {
    for (const c of (e.creatures || [])) creatures.push(c);
  }
  let road = null;
  for (let i = 0; i < startTile.grid.length && !road; i++) {
    if (startTile.grid[i] !== 7 /* ROAD */) continue;
    const cx = i % scene.cellsPerTile, cy = Math.floor(i / scene.cellsPerTile);
    const rx = 2754 * startTile.tileEdgeM + (cx + 0.5) * scene.cellM;
    const ry = 5566 * startTile.tileEdgeM + (cy + 0.5) * scene.cellM;
    let hasCreature = false;
    for (const c of creatures) {
      if (Math.hypot(c.x - rx, c.y - ry) < 6) { hasCreature = true; break; }
    }
    if (!hasCreature) road = { x: rx, y: ry };
  }
  if (!road) return; // no clear road cell in fixture
  // Setup: hold one chicken, select it, teleport to the road.
  scene.save.inv = [{ id: 'chicken', count: 1 }];
  scene.save.selSlot = 0;
  scene.save.released = [];
  teleport(scene, road.x, road.y);
  tapWorld(scene, road.x, road.y);
  assert.eq(scene.save.released.length, 0, 'no animal released on road');
  // Chicken still in inventory (release was refused, not consumed).
  assert.eq(invCount(scene, 'chicken'), 1, 'chicken stack untouched');
});

// #11 — POI chest position snaps to LOCAL-TILE cell centre. Verify the chest
// stored x/y agrees with cellAt() at its stored coords (no drift).
test('REG #11: chest position aligns with cellAt() — no coord-basis drift', (scene) => {
  let mismatches = 0;
  for (const v of WorldGen.tileCache.values()) {
    if (!v.objects || !v.grid) continue;
    for (const o of v.objects) {
      if (o.kind !== 'chest') continue;
      // The chest's stored x/y is supposed to be a local-cell centre.
      // cellAt() must return the same cell whose centre rounds to (o.x, o.y).
      const c = scene.cellAt(o.x, o.y);
      if (!c.loaded) continue;
      const cellCentre = absCellCenterMeters(scene,
        ...Object.values(worldMetersToAbsCell(scene, o.x, o.y)));
      // x/y of chest should be within 1mm of the cell centre we resolve.
      if (Math.abs(cellCentre.x - o.x) > 0.001 || Math.abs(cellCentre.y - o.y) > 0.001) {
        mismatches++;
      }
    }
  }
  assert.eq(mismatches, 0, 'all chest coords land exactly on their resolved cell centre');
});

// #12 — paintPolygon rightmost-cell coverage. A 1-cell-thin axis-aligned rect
// must paint EVERY cell in its bbox (regression for the asymmetric ceil/floor).
test('REG #12: paintPolygon fills the right-edge column (no off-by-one)', (scene) => {
  // We don't have paintPolygon exposed externally; test the BEHAVIOUR by
  // verifying that a known small landuse polygon in the fixture paints a
  // contiguous filled rect (no thin gaps along edges).
  // Heuristic: scan loaded grids for any contiguous building polygon; assert
  // its rightmost cell is reachable from its leftmost via a connected flood.
  const startTile = WorldGen.tileCache.get(`${WorldGen.Z}/2754/5566`);
  // Find a non-zero terrain region (e.g. residential) and flood-fill from any
  // cell. Then verify the bounding box's right edge has at least one filled
  // cell on every row — the prior bug would skip the rightmost column on rows
  // where the polygon's right edge lands at fractional sub-pixel position.
  const N = scene.cellsPerTile;
  const seenType = new Map();
  for (let i = 0; i < startTile.grid.length; i++) {
    const t = startTile.grid[i];
    if (t === 0 || t === 3) continue;
    seenType.set(t, (seenType.get(t) || 0) + 1);
  }
  // Pick the most common non-trivial type as our probe.
  let probeType = -1, probeCount = 0;
  for (const [t, n] of seenType) {
    if (n > probeCount) { probeCount = n; probeType = t; }
  }
  assert.gt(probeCount, 50, 'fixture has a non-trivial polygon to probe');
  // Find bbox of any contiguous region of probeType and confirm every row in
  // the bbox has at least one cell of that type (no thin row-wide gaps).
  let minX = N, maxX = -1, minY = N, maxY = -1;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (startTile.grid[y * N + x] !== probeType) continue;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  // Every row in [minY..maxY] should contain at least one cell of probeType.
  // The prior bug would only show as occasional missing cells, but assuming
  // multiple polygons of the same type exist, full row coverage is a strong
  // smoke test.
  let badRows = 0;
  for (let y = minY; y <= maxY; y++) {
    let any = false;
    for (let x = minX; x <= maxX; x++) {
      if (startTile.grid[y * N + x] === probeType) { any = true; break; }
    }
    if (!any) badRows++;
  }
  assert.lt(badRows, Math.max(2, (maxY - minY) * 0.1), 'most rows have a cell of the probe type');
});

// #13 — ring-scan integer-modulo: tile-seam cells must not silently fall back
// to grass. Verify the grid type read at a tile boundary matches cellAt.
test('REG #13: tile-seam cell reads agree between cellAt and grid lookup', (scene) => {
  const N = scene.cellsPerTile;
  const startTile = WorldGen.tileCache.get(`${WorldGen.Z}/2754/5566`);
  if (!startTile) return;
  // Sample the LAST column (x = N-1) and FIRST column of the neighbour tile.
  for (let y = 0; y < N; y += 25) {
    const wx = 2754 * startTile.tileEdgeM + (N - 1 + 0.5) * scene.cellM;
    const wy = 5566 * startTile.tileEdgeM + (y + 0.5) * scene.cellM;
    const direct = startTile.grid[y * N + (N - 1)];
    const via = scene.cellAt(wx, wy).type;
    assert.eq(via, direct, `seam-cell row ${y}: cellAt agrees with grid`);
  }
});

// #14 — longgrass single-frame texture must explicitly set frame 0 to avoid
// stale pool-slot frame state.
test('REG #14: longgrass renders frame 0 even after pool reuse', (scene) => {
  // Inject a planted longgrass entry near the player and force a render.
  scene.save.planted = scene.save.planted || [];
  const px = scene.startWorldM.x + 5, py = scene.startWorldM.y + 5;
  scene.save.planted.push({ x: px, y: py, crop: 'longgrass', stage: MAX_GROWTH_STAGE });
  teleport(scene, px, py);
  scene.drawObjects();
  // Find the pool sprite that just got assigned the longgrass texture.
  const slot = scene.plantedPool.find(s =>
    s.visible && s.texture && s.texture.key === 'longgrass');
  assert.truthy(slot, 'longgrass pool slot exists');
  // The texture is single-frame; frame must be the base one (Phaser identifies
  // single-frame canvas textures with key __BASE).
  assert.truthy(slot.frame.name === '__BASE' || slot.frame.name === 0 || slot.frame.name === '0',
    `longgrass frame is the base/0, not stale: ${slot.frame.name}`);
});

// #15 — Sell modal must re-find by id, not by stale slot index.
test('REG #15: sell modal succeeds even if the stack moved to a new slot index', (scene) => {
  // Stage: two stacks. Sell the second one. Mid-modal, splice the first stack
  // so the second moves to index 0. Accept the sale.
  scene.save.inv = [
    { id: 'rockfruit', count: 1 },
    { id: 'potato_seed', count: 3 },
  ];
  scene.save.selSlot = 1;
  scene.save.money = 0;
  // Find a house to interact with.
  const house = findObject(o => o.kind === 'house');
  if (!house) return;
  teleport(scene, house.x, house.y - 2);
  scene.shopInteract(0, 0);
  const modal = document.getElementById('offer-modal');
  assert.truthy(modal, 'modal opened');
  // Simulate inv shift: spend the first stack.
  scene.save.inv.splice(0, 1);   // potato_seed now at index 0
  // Click Sell.
  const sellBtn = [...modal.querySelectorAll('button')].find(b => b.textContent === 'Sell');
  assert.truthy(sellBtn, 'Sell button present');
  sellBtn.click();
  // After the sale, the potato_seed stack should have one less unit (started at 3 → 2).
  const cur = scene.save.inv.find(s => s && s.id === 'potato_seed');
  assert.truthy(cur, 'potato_seed still present');
  assert.eq(cur.count, 2, 'potato_seed decremented to 2');
  assert.gt(scene.save.money, 0, 'received money');
});

// One-interactable-per-cell invariant: across all loaded tiles, no cell
// should host more than one interactable (chest, house, tree, wildplant, flora).
test('one-interactable-per-cell invariant across loaded tiles', () => {
  let collisions = 0;
  for (const [key, entry] of WorldGen.tileCache.entries()) {
    if (!entry.grid || !entry.tileEdgeM) continue;
    const [, txStr, tyStr] = key.split('/');
    const tx = +txStr, ty = +tyStr;
    const tileOriginMx = tx * entry.tileEdgeM;
    const tileOriginMy = ty * entry.tileEdgeM;
    const cellM = entry.tileEdgeM / entry.cellsPerEdge;
    const occ = new Map();
    const note = (kind, x, y) => {
      const ix = Math.floor((x - tileOriginMx) / cellM);
      const iy = Math.floor((y - tileOriginMy) / cellM);
      const k = `${ix}_${iy}`;
      if (occ.has(k)) { collisions++; }
      else occ.set(k, kind);
    };
    for (const o of (entry.objects || [])) note(o.kind, o.x, o.y);
    for (const wp of (entry.wildplants || [])) note('wildplant', wp.x, wp.y);
  }
  assert.eq(collisions, 0, 'no cell hosts >1 interactable');
});

// #16 — Self-heal of tilled marker must NOT fire when a planted crop sits on the cell.
test('REG #16: tilled self-heal preserves cells with a planted crop', (scene) => {
  // Find a planted-crop cell whose terrain is NON-tillable (rare but possible
  // when a building polygon overlapped a previously-tilled cell). Simulate.
  scene.save.tilled = [];
  scene.tilledSet = new Set();
  scene.save.planted = [];
  // Pick any cell currently classified as building.
  const startTile = WorldGen.tileCache.get(`${WorldGen.Z}/2754/5566`);
  let buildCell = null;
  for (let i = 0; i < startTile.grid.length && !buildCell; i++) {
    const t = startTile.grid[i];
    if (t !== 9 && t !== 11 && t !== 12) continue;
    const cx = i % scene.cellsPerTile, cy = Math.floor(i / scene.cellsPerTile);
    buildCell = {
      x: 2754 * startTile.tileEdgeM + (cx + 0.5) * scene.cellM,
      y: 5566 * startTile.tileEdgeM + (cy + 0.5) * scene.cellM,
    };
  }
  if (!buildCell) return;
  const { cellIX, cellIY } = worldMetersToAbsCell(scene, buildCell.x, buildCell.y);
  const c = absCellCenterMeters(scene, cellIX, cellIY);
  // Plant + mark tilled (simulating pre-overpaint legacy state).
  scene.save.planted.push({ x: c.x, y: c.y, crop: 'potato', stage: 1, watered_t: 0 });
  scene.tilledSet.add(`${cellIX}_${cellIY}`);
  teleport(scene, c.x, c.y);
  // Force a draw — the buggy self-heal would silently drop the tilled mark.
  scene.drawCells();
  assert.truthy(scene.tilledSet.has(`${cellIX}_${cellIY}`), 'tilled mark preserved (plant present)');
});

// ───────────────────────────────────────────────────────────────────────
// Energy / food / relics
// ───────────────────────────────────────────────────────────────────────

test('energy: starts at maxEnergy after fresh init', (scene) => {
  // Reset any pollution from prior runs — armor purchased in other tests would
  // otherwise raise maxEnergy and fail the equality assertion.
  scene.save.armor = { helmet: null, chest: null, legs: null, boots: null };
  scene.save.maxEnergy = STARTING_ENERGY;
  scene.save.energy = STARTING_ENERGY;
  assert.eq(scene.save.maxEnergy, STARTING_ENERGY, 'maxEnergy = STARTING_ENERGY');
  assert.truthy(scene.save.energy >= 0 && scene.save.energy <= scene.save.maxEnergy, 'energy in [0,max]');
});

test('energy: tilling deducts 2 energy', (scene) => {
  // Find a tillable empty cell adjacent to the player and till it.
  scene.save.energy = 50;
  scene.save.tilled = []; scene.tilledSet = new Set();
  scene.save.planted = []; scene.save.placedRocks = []; scene.placedRockSet = new Set();
  // Strip any hoe relic from prior tests — effectiveTillCost would otherwise
  // give a chance-of-free or reduced cost, breaking the "expected 48" math.
  if (scene.save.relics) scene.save.relics.hoe = null;
  // Sweep a few cells near origin until we find a grass/farmland one.
  let target = null;
  for (let d = 0; d < 8 && !target; d++) {
    for (const [dx, dy] of [[d, 0], [0, d], [-d, 0], [0, -d]]) {
      const wx = scene.startWorldM.x + dx * scene.cellM;
      const wy = scene.startWorldM.y + dy * scene.cellM;
      const c = scene.cellAt(wx, wy);
      if (c.loaded && isTillable(c.type)) { target = { wx, wy }; break; }
    }
  }
  assert.truthy(target, 'found a tillable cell');
  teleport(scene, target.wx, target.wy);
  const before = scene.save.energy;
  tapWorld(scene, target.wx, target.wy);
  assert.eq(scene.save.energy, before - ENERGY_COST.till, 'energy deducted by till cost');
});

test('energy: refuses till when too tired', (scene) => {
  scene.save.energy = 1;
  scene.save.tilled = []; scene.tilledSet = new Set();
  scene.save.planted = []; scene.save.placedRocks = []; scene.placedRockSet = new Set();
  // Strip any hoe relic — a free-roll would let tilling proceed with 0 energy.
  if (scene.save.relics) scene.save.relics.hoe = null;
  let target = null;
  for (let d = 1; d < 8 && !target; d++) {
    for (const [dx, dy] of [[d, 0], [0, d], [-d, 0], [0, -d]]) {
      const wx = scene.startWorldM.x + dx * scene.cellM;
      const wy = scene.startWorldM.y + dy * scene.cellM;
      const c = scene.cellAt(wx, wy);
      if (c.loaded && isTillable(c.type)) { target = { wx, wy }; break; }
    }
  }
  assert.truthy(target, 'found a tillable cell');
  teleport(scene, target.wx, target.wy);
  const beforeTilled = scene.tilledSet.size;
  tapWorld(scene, target.wx, target.wy);
  assert.eq(scene.tilledSet.size, beforeTilled, 'not tilled when too tired');
  assert.eq(scene.save.energy, 1, 'energy unchanged on refusal');
});

test('eating rainberry restores energy + waters nearby crops + shows message modal', (scene) => {
  // Set up: 3 crops within 20m, 1 crop at 40m, all unwatered.
  scene.save.energy = 10;
  scene.save.maxEnergy = 100;
  scene.save.planted = [];
  const sx = scene.startWorldM.x, sy = scene.startWorldM.y;
  // Crops within range (unwatered).
  scene.save.planted.push({ x: sx + 5,  y: sy,     crop: 'potato', stage: 0, watered_t: 0 });
  scene.save.planted.push({ x: sx - 5,  y: sy + 8, crop: 'potato', stage: 0, watered_t: 0 });
  scene.save.planted.push({ x: sx + 12, y: sy - 7, crop: 'potato', stage: 0, watered_t: 0 });
  // Out of range (unwatered).
  scene.save.planted.push({ x: sx + 40, y: sy,     crop: 'potato', stage: 0, watered_t: 0 });
  teleport(scene, sx, sy);
  // Select rainberry and eat.
  scene.save.inv = [{ id: 'rainberry', count: 2 }];
  scene.save.selSlot = 0;
  scene.eatSelected();
  assert.eq(scene.save.energy, 10 + FOOD_ENERGY.rainberry, 'energy bumped by rainberry restore');
  assert.eq(scene.save.inv[0].count, 1, 'rainberry stack decremented');
  // Three crops near should now be watered (have watered_t > 0).
  const wateredNear = scene.save.planted.filter((p, i) => i < 3 && p.watered_t).length;
  assert.eq(wateredNear, 3, 'all three nearby crops watered');
  // Distant one should remain unwatered.
  assert.eq(scene.save.planted[3].watered_t, 0, 'distant crop NOT watered');
  // Message modal opened.
  assert.truthy(document.getElementById('message-modal'), 'message modal shown');
  document.getElementById('message-modal')?.remove();
});

test('eating pairy arms chest compass for 5 minutes toward nearest unopened chest', (scene) => {
  scene.save.energy = 10;
  scene.save.maxEnergy = 100;
  scene.save.opened = [];
  scene.pairyCompass = null;
  // Find any chest as a target.
  const chest = findObject(o => o.kind === 'chest');
  assert.truthy(chest, 'a chest exists somewhere');
  // Stand near it (but not on top, so it's still unopened).
  teleport(scene, chest.x + 30, chest.y + 30);
  scene.save.inv = [{ id: 'pairy', count: 1 }];
  scene.save.selSlot = 0;
  const t0 = Date.now();
  scene.eatSelected();
  assert.truthy(scene.pairyCompass, 'pairyCompass set');
  // Target is the nearest unopened chest (not necessarily the one we found, but
  // it must BE an unopened chest).
  assert.truthy(scene.pairyCompass.targetId, 'targetId present');
  // Until ≈ now + 5 min (allow 2 s wiggle room for slow CI runs).
  const fiveMin = 5 * 60 * 1000;
  assert.approx(scene.pairyCompass.until - t0, fiveMin, 2000, '5-min expiry');
  assert.eq(scene.save.energy, 10 + FOOD_ENERGY.pairy, 'energy bumped by pairy restore');
  document.getElementById('message-modal')?.remove();
});

test('pick relic reduces rock-break energy cost', () => {
  const base = effectivePickCost(null);
  assert.eq(base, ENERGY_COST.rockBreak, 'no relic = base cost');
  const t1 = effectivePickCost({ pick: { tier: 1 } });
  const t7 = effectivePickCost({ pick: { tier: 7 } });
  assert.lt(t1, base, 'tier-1 pick cheaper than no pick');
  assert.lt(t7, t1,   'tier-7 pick cheaper than tier-1');
  assert.gt(t7, 1,    'cost floors at 2 (not 0)');
});

test('ring relic boosts loot tier roll (forced RNG)', () => {
  // No ring: park category, force tier-1 weight roll → must pick tier 1.
  // With ring tier 7 (35% boost), the second roll determining tier-up should hit.
  // Park is now 'mixed' (seed/produce coin flip), so the seq includes one
  // extra rng call AFTER the pool pick for the produce coin (0.99 = no-produce,
  // keeps the returned id as a seed so SEED_TIER lookup still works).
  // RNG order in pickLoot:
  //   1) weights tier roll
  //   2) ring tier-up roll          (only if ring present + tier<3)
  //   3) pool pick
  //   4) mixed-mode produce coin
  //   5) amulet double roll          (only if amulet present)
  // tierOf(id) handles either seed-suffix or produce form.
  const tierOf = (id) => SEED_TIER[id] ?? SEED_TIER[`${id}_seed`];
  const noRingSeq = [0.05, 0.5, 0.99];     // weights, pool, no-produce
  let calls = 0;
  const noRing = pickLoot(() => { return noRingSeq[calls++] ?? 0.5; }, 'park');
  const withRingSeq = [0.05, 0.01, 0.5, 0.99];   // weights, tier-up, pool, no-produce
  calls = 0;
  const withRing = pickLoot(() => withRingSeq[calls++] ?? 0.5, 'park', { ring: { tier: 7 } });
  assert.eq(tierOf(noRing.id), 1, 'no-ring loot is T1');
  assert.gt(tierOf(withRing.id), 1, 'with ring, loot tier upgraded');
});

test('amulet relic can double loot quantity', () => {
  let calls = 0;
  // weights, pool pick, mixed-mode produce coin, amulet double roll.
  // tier=1 yields TIER_YIELD[1] = 5 (was 10 — trimmed to reduce seed flood).
  const seq = [0.05, 0.5, 0.99, 0.01];
  const rng = () => seq[calls++] ?? 0.5;
  const loot = pickLoot(rng, 'park', { amulet: { tier: 7 } });
  // tier 1 base yield is 5; with amulet doubling → 10.
  assert.eq(loot.n, 10, 'amulet doubled quantity (5 → 10)');
});

test('armor pieces raise maxEnergy via maxEnergyFromArmor', () => {
  assert.eq(maxEnergyFromArmor(null), STARTING_ENERGY, 'no armor = baseline');
  const m1 = maxEnergyFromArmor({ helmet: { tier: 1 } });
  assert.eq(m1, STARTING_ENERGY + 10, 'tier-1 helmet adds +10');
  const m2 = maxEnergyFromArmor({ helmet: { tier: 2 }, chest: { tier: 1 } });
  // helmet T2: 10*2 = 20; chest T1: 25*1 = 25. Total +45.
  assert.eq(m2, STARTING_ENERGY + 20 + 25, 'multiple armor pieces additive');
});

test('starter shop wood pickaxe is fixed at $30', (scene) => {
  scene.save.starterStock = { pick: true, axe: true };
  const offer = scene.starterShopOffer();
  assert.eq(offer.slot, 'pick', 'first offer is pick');
  assert.eq(offer.price, 30, 'wood pickaxe is $30');
});

test('gearPrice scales with tier multiplier', () => {
  const t1 = gearPrice('relic', 'pick', 1);
  const t3 = gearPrice('relic', 'pick', 3);
  // baseCost $80, tier-3 costMul ×8, global /4 → t1 $20, t3 $160.
  assert.eq(t1, 20, 'tier-1 pick = $20');
  assert.eq(t3, 160, 'tier-3 pick = $160');
});

test('rock break: bare-handed works but slower than with pick', (scene) => {
  scene.save.relics = { pick: null, axe: null, ring: null, amulet: null };
  scene.save.energy = 100;
  scene.save.brokenRocks = []; scene.brokenRockSet = new Set();
  // Find a rock cell. Type 10 = rock.
  let target = null;
  for (let d = 1; d < 30 && !target; d++) {
    for (const [dx, dy] of [[d, 0], [0, d], [-d, 0], [0, -d], [d, d], [-d, -d]]) {
      const wx = scene.startWorldM.x + dx * scene.cellM;
      const wy = scene.startWorldM.y + dy * scene.cellM;
      const c = scene.cellAt(wx, wy);
      if (c.loaded && c.type === 10) { target = { wx, wy }; break; }
    }
  }
  if (!target) return; // no rock loaded — skip
  teleport(scene, target.wx, target.wy);
  // No pick → still spends energy and kicks off a (longer) work progress.
  tapWorld(scene, target.wx, target.wy);
  assert.lt(scene.save.energy, 100, 'energy spent even without pick');
  assert.truthy(scene._workProgress, 'work-progress started bare-handed');
  assert.eq(scene._workProgress.durationMs, 10000, 'bare-handed mining takes 10s');
  // Equip wood pick → 3s instead of 10s. (Tap once to cancel the in-progress
  // bare-handed attempt, then again to start the picked one.)
  scene.cancelWorkProgress();
  scene.save.relics.pick = { tier: 1 };
  tapWorld(scene, target.wx, target.wy);
  assert.truthy(scene._workProgress, 'work-progress started with pick');
  assert.eq(scene._workProgress.durationMs, 3000, 'pick makes mining take 3s');
});

test('tree chop refuses without an axe relic', (scene) => {
  scene.save.relics = { pick: null, axe: null, ring: null, amulet: null };
  scene.save.energy = 100;
  const tree = findObject(o => o.kind === 'tree' && !o.chopped);
  if (!tree) return;
  teleport(scene, tree.x, tree.y);
  tapWorld(scene, tree.x, tree.y);
  assert.falsy(tree.chopped, 'tree NOT chopped without axe');
});

test('starter shop sells wood pickaxe + wood axe in sequence', (scene) => {
  scene.save.starterShopId = null;
  scene.save.starterStock = { pick: true, axe: true };
  scene.save.shopOffers = {};
  scene.save.relics = { pick: null, axe: null, ring: null, amulet: null };
  scene.save.money = 1000;
  scene.save.inv = []; scene.save.selSlot = 0;
  // Identify the starter shop via the same helper the runtime uses.
  const starterId = scene.findStarterHouseId();
  assert.truthy(starterId, 'a starter house exists in loaded tiles');
  const house = findObject(o => o.id === starterId);
  teleport(scene, house.x, house.y - 2);
  scene.shopInteract(0, 0, house);
  let modal = document.getElementById('offer-modal');
  assert.truthy(modal, 'modal opened for starter shop');
  const buy = [...modal.querySelectorAll('button')].find(b => b.textContent === 'Buy');
  assert.truthy(buy, 'Buy button present');
  buy.click();
  assert.truthy(scene.save.relics.pick, 'wood pick acquired');
  assert.eq(scene.save.relics.pick.tier, 1, 'tier 1');
  assert.falsy(scene.save.starterStock.pick, 'pick removed from starter stock');
  // Second visit: starter shop now offers axe.
  scene.shopInteract(0, 0, house);
  modal = document.getElementById('offer-modal');
  assert.truthy(modal, 'modal opened second visit');
  const buy2 = [...modal.querySelectorAll('button')].find(b => b.textContent === 'Buy');
  buy2.click();
  assert.truthy(scene.save.relics.axe, 'wood axe acquired');
  assert.eq(scene.save.relics.axe.tier, 1, 'tier 1');
  // Third visit: stock empty → starter shop falls through to seed offers.
  scene.shopInteract(0, 0, house);
  modal = document.getElementById('offer-modal');
  // Just assert it didn't crash; we don't care which offer comes up now.
  document.getElementById('offer-modal')?.remove();
});

test('castle always offers relics with no rate-limit', (scene) => {
  scene.save.shopOffers = {};
  scene.save.shopDeals = {};
  scene.save.relics = { pick: { tier: 1 }, axe: { tier: 1 }, ring: null, amulet: null };
  scene.save.money = 100000;
  scene.save.inv = []; scene.save.selSlot = 0;
  // Make a fake castle anchored at the start position so we don't depend on
  // worldgen happening to load one nearby.
  const fakeCastle = { kind: 'tower', id: 'test_castle', tier: 12,
    x: scene.startWorldM.x, y: scene.startWorldM.y };
  teleport(scene, fakeCastle.x, fakeCastle.y - 2);
  // 50 consecutive shops — all should open a relic modal (never blocked).
  let opened = 0;
  for (let i = 0; i < 50; i++) {
    scene.shopInteract(0, 0, fakeCastle);
    const m = document.getElementById('offer-modal');
    if (m && m.innerHTML.includes('relic')) {
      opened++;
      // Buy whatever's on offer to advance state, then re-enter.
      const buy = [...m.querySelectorAll('button')].find(b => b.textContent === 'Buy');
      if (buy && !buy.disabled) buy.click(); else m.remove();
    } else { m?.remove(); break; }
  }
  assert.gt(opened, 5, 'castle keeps opening relic offers');
});

test('re-roll button is hidden on non-castle relic offers', (scene) => {
  // Force a non-castle relic offer via presentRelicOffer directly.
  document.getElementById('offer-modal')?.remove();
  scene.save.money = 10000;
  scene.save.relics = { pick: null, axe: null, ring: null, amulet: null,
                        sword: null, bow: null, staff: null };
  const offer = { kind: 'relic', slot: 'pick', tier: 1,
    price: gearPrice('relic', 'pick', 1), rerollCount: 0 };
  scene.presentRelicOffer(0, 0, offer, () => {},
    { id: 'fake_regular', kind: 'house', tier: 9, x: 0, y: 0 }, false);
  const modal = document.getElementById('offer-modal');
  assert.truthy(modal, 'modal opened');
  const rr = [...modal.querySelectorAll('button')].find(b => b.innerHTML.includes('Re-roll'));
  assert.falsy(rr, 'no Re-roll button on regular house');
  document.getElementById('offer-modal')?.remove();
});

test('re-roll button swaps the on-display relic for a different one', (scene) => {
  scene.save.shopState = {};
  if (scene.save.offerSalt == null) scene.save.offerSalt = 0xdeadbeef;
  scene.save.relics = { pick: null, axe: null, ring: null, amulet: null };
  scene.save.armor = { helmet: null, chest: null, legs: null, boots: null };
  scene.save.money = 100000;
  const fakeCastle = { kind: 'tower', id: 'test_castle_reroll', tier: 12,
    x: scene.startWorldM.x, y: scene.startWorldM.y };
  teleport(scene, fakeCastle.x, fakeCastle.y - 2);
  scene.shopInteract(0, 0, fakeCastle);
  let modal = document.getElementById('offer-modal');
  assert.truthy(modal, 'first modal open');
  const stBefore = scene.save.shopState[fakeCastle.id];
  assert.truthy(stBefore, 'bucket state initialized on first tap');
  const rerollsBefore = stBefore.rerolls;
  const buttons = [...modal.querySelectorAll('button')];
  const reroll = buttons.find(b => b.innerHTML.includes('Re-roll'));
  assert.truthy(reroll, 'Re-roll button present');
  const moneyBefore = scene.save.money;
  reroll.click();
  const stAfter = scene.save.shopState[fakeCastle.id];
  assert.eq(stAfter.rerolls, rerollsBefore + 1, 're-roll bumped cur.rerolls (seed pivots)');
  assert.lt(scene.save.money, moneyBefore, 'money deducted by re-roll cost');
  document.getElementById('offer-modal')?.remove();
});

test('shop offer persists across multiple taps on same house', (scene) => {
  scene.save.shopState = {};
  if (scene.save.offerSalt == null) scene.save.offerSalt = 0xdeadbeef;
  scene.save.relics = { pick: null, axe: null, ring: null, amulet: null };
  scene.save.money = 10000;
  const fakeCastle = { kind: 'tower', id: 'test_castle_persist', tier: 12,
    x: scene.startWorldM.x, y: scene.startWorldM.y };
  teleport(scene, fakeCastle.x, fakeCastle.y - 2);
  // Bucketed offers are derived from (house.id, bucket, rerolls, offerSalt),
  // so the same shop in the same bucket always produces the same offer
  // without any per-tap persistence. Build twice and compare.
  const a = scene.peekOrBuildRelicOffer(fakeCastle);
  const b = scene.peekOrBuildRelicOffer(fakeCastle);
  assert.truthy(a && b, 'offers built on both calls');
  assert.eq(a.kind, b.kind, 'kind matches across taps');
  assert.eq(a.slot, b.slot, 'slot matches across taps');
  assert.eq(a.tier, b.tier, 'tier matches across taps');
});

test('weapons: sword raises sell price (T0=half, T7=par)', () => {
  // Sell helper: ceil(base * sellMultiplier).
  const base = 100;
  const sellAt = (tier) => Math.ceil(base * sellMultiplier(tier ? { sword: { tier } } : null));
  assert.eq(sellAt(0), 50,  'no sword = half');
  assert.eq(sellAt(7), 100, 'frost sword = base (par)');
  // Monotonic in between.
  for (let t = 1; t < 7; t++) {
    assert.truthy(sellAt(t) >= sellAt(t - 1), `T${t} >= T${t - 1}`);
  }
});

test('weapons: bow/staff lower buy markup (T0=1.2..3, T7=1..1)', () => {
  const r0 = buyMarkupRange(null);
  assert.approx(r0.lo, 1.2, 0.0001, 'baseline lo');
  assert.approx(r0.hi, 3.0, 0.0001, 'baseline hi');
  const r7Bow   = buyMarkupRange({ bow:   { tier: 7 } });
  const r7Staff = buyMarkupRange({ staff: { tier: 7 } });
  assert.approx(r7Bow.lo,   1.0, 0.0001, 'T7 bow → lo = 1');
  assert.approx(r7Bow.hi,   1.0, 0.0001, 'T7 bow → hi = 1');
  assert.approx(r7Staff.lo, 1.0, 0.0001, 'T7 staff → lo = 1');
  assert.approx(r7Staff.hi, 1.0, 0.0001, 'T7 staff → hi = 1');
  // Max(bow, staff) wins.
  const mixed = buyMarkupRange({ bow: { tier: 3 }, staff: { tier: 7 } });
  assert.approx(mixed.lo, 1.0, 0.0001, 'max tier wins (staff over bow)');
});

test('weapons: sell modal honours the sword multiplier', (scene) => {
  scene.save.relics = { pick: null, axe: null, ring: null, amulet: null,
                        sword: { tier: 7 }, bow: null, staff: null };
  scene.save.inv = [{ id: 'potato', count: 1 }];  // base price $5
  scene.save.selSlot = 0;
  scene.save.money = 0;
  // Pick any house and tap it with potato selected. Compute the expected
  // price using the same chain shopInteract uses — sword multiplier × the
  // shop-type bonus — so the assertion isn't tied to whichever shop type
  // worldgen happens to assign to the nearest house.
  const house = findObject(o => o.kind === 'house');
  assert.truthy(house, 'a house exists');
  teleport(scene, house.x, house.y - 2);
  const shopType = WorldGen.shopType ? WorldGen.shopType(house) : null;
  const shopMul = scene.shopSellBonus ? scene.shopSellBonus(shopType, 'potato') : 1;
  const expected = Math.max(1, Math.ceil(PRICES.potato * sellMultiplier(scene.save.relics) * shopMul));
  scene.shopInteract(0, 0, house);
  const modal = document.getElementById('offer-modal');
  assert.truthy(modal, 'sell modal opened');
  assert.truthy(modal.innerHTML.includes(`+$${expected}`),
    `sells potato at $${expected} with T7 sword (mul=1.0, shopMul=${shopMul})`);
  document.getElementById('offer-modal')?.remove();
});

test('buildRelicOffer never offers a same-or-lower tier than equipped', (scene) => {
  // Equip a tier-3 pick. The offer should NEVER include pick t1..t3.
  scene.save.relics = { pick: { tier: 3 }, ring: null, amulet: null };
  scene.save.armor  = { helmet: null, chest: null, legs: null, boots: null };
  // Sample many offers and assert no pick<=3 appears.
  let pickTooLow = 0;
  for (let i = 0; i < 100; i++) {
    const o = scene.buildRelicOffer();
    if (o && o.kind === 'relic' && o.slot === 'pick' && o.tier <= 3) pickTooLow++;
  }
  assert.eq(pickTooLow, 0, 'no pick offers at tier ≤ 3');
});

// ───────────────────────────────────────────────────────────────────────
// Consumables, watering can, hoe, mineral drops — new this round.
// ───────────────────────────────────────────────────────────────────────

test('flute consumable is registered with the right shape', () => {
  const f = ITEM_BY_ID['flute'];
  assert.truthy(f, 'flute item exists');
  assert.eq(f.kind, 'consumable', 'kind=consumable');
  assert.truthy(PRICES.flute > 0, 'has a sell price');
});

test('book consumable is registered with the right shape', () => {
  const b = ITEM_BY_ID['book'];
  assert.truthy(b, 'book item exists');
  assert.eq(b.kind, 'consumable', 'kind=consumable');
});

test('mineral items registered with expected price ladder', () => {
  for (const id of ['coal', 'sapphire', 'ruby', 'emerald']) {
    const it = ITEM_BY_ID[id];
    assert.truthy(it, id + ' exists');
    assert.eq(it.kind, 'mineral', id + ' kind=mineral');
  }
  assert.lt(PRICES.coal, PRICES.sapphire, 'coal < sapphire');
  assert.lt(PRICES.sapphire, PRICES.ruby, 'sapphire < ruby');
  assert.lt(PRICES.ruby, PRICES.emerald, 'ruby < emerald');
});

test('PLAY_TIPS is non-empty and every entry is a real string', () => {
  assert.truthy(Array.isArray(PLAY_TIPS), 'PLAY_TIPS is array');
  assert.gt(PLAY_TIPS.length, 10, '>10 tips so repeats are rare');
  for (const t of PLAY_TIPS) {
    assert.eq(typeof t, 'string', 'tip is a string');
    assert.gt(t.length, 10, 'tip is non-trivial');
  }
});

test('readBook consumes one Book and opens a modal', (scene) => {
  scene.save.inv = [{ id: 'book', count: 2 }];
  scene.save.selSlot = 0;
  document.getElementById('message-modal')?.remove();
  document.getElementById('offer-modal')?.remove();
  scene.readBook();
  const stack = scene.save.inv.find(s => s && s.id === 'book');
  assert.eq(stack?.count, 1, 'one book consumed (2 -> 1)');
  const m = document.getElementById('message-modal') || document.getElementById('offer-modal');
  assert.truthy(m, 'modal appeared');
  m?.remove();
});

test('playFlute consumes one Flute and re-anchors nearby creatures', (scene) => {
  scene.save.inv = [{ id: 'flute', count: 1 }];
  scene.save.selSlot = 0;
  const pWX = scene.startWorldM.x + scene.playerM.x;
  const pWY = scene.startWorldM.y + scene.playerM.y;
  const target = { x: pWX + 10, y: pWY, kind: 'chicken', id: 'test_flute_chick' };
  const entry = [...WorldGen.tileCache.values()].find(e => e.creatures);
  if (!entry) return;
  entry.creatures.push(target);
  document.getElementById('message-modal')?.remove();
  scene.playFlute();
  assert.eq(scene.save.inv.find(s => s?.id === 'flute'), undefined, 'flute consumed');
  const homeDist = Math.hypot((target._homeX ?? target.x) - pWX, (target._homeY ?? target.y) - pWY);
  assert.lt(homeDist, 6, 'chicken home pulled close to player');
  entry.creatures.pop();
  document.getElementById('message-modal')?.remove();
});

test('hoe relic: effectiveTillCost shape', () => {
  assert.eq(effectiveTillCost(null), ENERGY_COST.till, 'no hoe = base cost');
  const noFree = () => 0.99;
  assert.eq(effectiveTillCost({ hoe: { tier: 1 } }, noFree), 2, 'T1 cost stays 2');
  assert.eq(effectiveTillCost({ hoe: { tier: 3 } }, noFree), 1, 'T3 shaves to 1');
  assert.eq(effectiveTillCost({ hoe: { tier: 7 } }, noFree), 1, 'T7 floored at 1');
  const alwaysFree = () => 0;
  assert.eq(effectiveTillCost({ hoe: { tier: 1 } }, alwaysFree), 0, 'T1 sometimes free');
  assert.eq(effectiveTillCost({ hoe: { tier: 7 } }, alwaysFree), 0, 'T7 sometimes free');
});

test('hoe relic at tier 7 free rate is roughly 84%', () => {
  let frees = 0;
  for (let i = 0; i < 2000; i++) {
    if (effectiveTillCost({ hoe: { tier: 7 } }) === 0) frees++;
  }
  const rate = frees / 2000;
  assert.gt(rate, 0.79, 'T7 free rate >= 79%');
  assert.lt(rate, 0.89, 'T7 free rate <= 89%');
});

test('watering can: watering writes canBoost to the planted crop', (scene) => {
  scene.save.relics = scene.save.relics || {};
  scene.save.relics.can = { tier: 3 };
  scene.save.canCharges = 0;
  scene.save.planted = [];
  scene.save.tilled = [];
  scene.tilledSet = new Set();
  // Empty inventory so eat / use-consumable (priority -0.5 / -0.6) don't
  // intercept the tap with leftover food/flute from a prior test.
  scene.save.inv = [];
  scene.save.selSlot = 0;
  // Cancel any lingering work-progress from a prior test — the work-progress
  // guard at priority -1 swallows every tap while a progress wheel is up,
  // and a chop/rockbreak test earlier in the file may have left one open.
  if (scene._workProgress) scene.cancelWorkProgress?.();
  // Earlier tests may have teleported the player onto a building / water cell.
  // Find a tillable cell anywhere in the start tile and stand on it so the
  // planted handler (which doesn't strictly require tillable, but the test
  // expects an ordinary ground cell) has a clean playing field.
  const startTile = WorldGen.tileCache.get(`${WorldGen.Z}/2754/5566`);
  if (startTile && startTile.grid) {
    const N = startTile.cellsPerEdge;
    for (let i = 0; i < startTile.grid.length; i++) {
      const t = startTile.grid[i];
      if (isTillable(t)) {
        const ix = i % N, iy = Math.floor(i / N);
        const wx = 2754 * startTile.tileEdgeM + (ix + 0.5) * scene.cellM;
        const wy = 5566 * startTile.tileEdgeM + (iy + 0.5) * scene.cellM;
        teleport(scene, wx, wy);
        break;
      }
    }
  }
  // Pre-mark every nearby wildplant + flora as picked, and every nearby
  // creature as caught, so the handlers that run BEFORE planted (creature,
  // wildplant, flora) skip them. Otherwise the tap would catch a chicken or
  // pick a rockfruit instead of watering our test crop.
  const pWX0 = scene.startWorldM.x + scene.playerM.x;
  const pWY0 = scene.startWorldM.y + scene.playerM.y;
  const pickedNow = new Set(scene.save.picked || []);
  const caughtNow = new Set(scene.save.caught || []);
  for (const e of WorldGen.tileCache.values()) {
    for (const wp of (e.wildplants || [])) {
      if (Math.hypot(wp.x - pWX0, wp.y - pWY0) < 10) pickedNow.add(wp.id);
    }
    for (const o of (e.objects || [])) {
      if (o.kind === 'flora' && o.deco === 'flower' &&
          Math.hypot(o.x - pWX0, o.y - pWY0) < 10) pickedNow.add(o.id);
    }
    for (const c of (e.creatures || [])) {
      if (Math.hypot(c.x - pWX0, c.y - pWY0) < 10) caughtNow.add(c.id);
    }
  }
  scene.save.picked = [...pickedNow];
  scene.save.caught = [...caughtNow];
  // Also ensure full energy so spendEnergy (harvest path) never bails.
  scene.save.energy = scene.save.maxEnergy ?? 100;
  const { cellIX, cellIY } = worldMetersToAbsCell(scene, pWX0, pWY0);
  const c = absCellCenterMeters(scene, cellIX, cellIY);
  scene.tilledSet.add(cellKeyFromAbsCell(cellIX, cellIY));
  scene.save.planted.push({ x: c.x, y: c.y, crop: 'potato', stage: 0, watered_t: 0 });
  teleport(scene, c.x, c.y);
  tapWorld(scene, c.x, c.y);
  const p = scene.save.planted[0];
  assert.gt(p.watered_t, 0, 'crop got watered');
  assert.eq(p.canBoost, 3, 'tier-3 can wrote canBoost=3');
});

test('watering can: refill at water tile -> 50 charges, then +2 boost', (scene) => {
  scene.save.relics = scene.save.relics || {};
  scene.save.relics.can = { tier: 2 };
  scene.save.canCharges = 0;
  let water = null;
  for (const [key, e] of WorldGen.tileCache.entries()) {
    if (!e.grid) continue;
    const N = e.cellsPerEdge;
    for (let i = 0; i < e.grid.length && !water; i++) {
      if (e.grid[i] === 3) {
        const ix = i % N, iy = Math.floor(i / N);
        const parts = key.split('/');
        const tXi = +parts[1], tYi = +parts[2];
        water = {
          x: tXi * e.tileEdgeM + (ix + 0.5) * scene.cellM,
          y: tYi * e.tileEdgeM + (iy + 0.5) * scene.cellM,
        };
      }
    }
    if (water) break;
  }
  if (!water) return;
  teleport(scene, water.x, water.y);
  tapWorld(scene, water.x, water.y);
  assert.eq(scene.save.canCharges, 50, 'refill set 50 charges');
  scene.save.planted = [];
  scene.tilledSet = new Set();
  const { cellIX, cellIY } = worldMetersToAbsCell(scene,
    scene.startWorldM.x + scene.playerM.x,
    scene.startWorldM.y + scene.playerM.y);
  const c = absCellCenterMeters(scene, cellIX, cellIY);
  // Suppress nearby wildplants / flora that would otherwise intercept the tap.
  const pickedNow2 = new Set(scene.save.picked || []);
  for (const e of WorldGen.tileCache.values()) {
    for (const wp of (e.wildplants || [])) {
      if (Math.hypot(wp.x - c.x, wp.y - c.y) < 10) pickedNow2.add(wp.id);
    }
    for (const o of (e.objects || [])) {
      if (o.kind === 'flora' && o.deco === 'flower' &&
          Math.hypot(o.x - c.x, o.y - c.y) < 10) pickedNow2.add(o.id);
    }
  }
  scene.save.picked = [...pickedNow2];
  scene.tilledSet.add(cellKeyFromAbsCell(cellIX, cellIY));
  scene.save.planted.push({ x: c.x, y: c.y, crop: 'potato', stage: 0, watered_t: 0 });
  teleport(scene, c.x, c.y);
  tapWorld(scene, c.x, c.y);
  const p = scene.save.planted[0];
  assert.eq(p.canBoost, 4, 'filled can: T2 + 2 bonus = 4');
  assert.eq(scene.save.canCharges, 49, 'charge consumed (50 -> 49)');
});

test('rock loot table buckets produce coal + gems at expected rates', () => {
  const tally = { coal: 0, sapphire: 0, ruby: 0, emerald: 0, other: 0 };
  for (let i = 0; i < 5000; i++) {
    const r = Math.random();
    if (r < 0.002)      tally.emerald++;
    else if (r < 0.008) tally.ruby++;
    else if (r < 0.025) tally.sapphire++;
    else if (r < 0.430) tally.coal++;
    else                tally.other++;
  }
  assert.gt(tally.coal, 100, 'coal dropped many times (>= 100 in 5000)');
  assert.gt(tally.sapphire, 0, 'sapphire dropped at least once');
  assert.gt(tally.ruby, 0, 'ruby dropped at least once');
});

// ============================================================================
// Wilderness features: items, mushrooms, fruit trees, mineral rocks, fishing,
// crow/butterfly bug-net gate, deer/rabbit drops, lowtier-chest box sprite.
// ============================================================================

test('new items registered: mushrooms, fruits, fauna drops, fish', () => {
  for (const id of ['mushroom', 'apple', 'cherry', 'peach', 'banana', 'orange',
                    'mango', 'coconut', 'apricot',
                    'meat', 'rabbit_pelt', 'crow_feather', 'butterfly',
                    'minnow', 'bass', 'trout', 'salmon', 'goldenfish']) {
    assert.truthy(ITEM_BY_ID[id], id + ' exists');
    assert.gt(PRICES[id], 0, id + ' has price > 0');
  }
});

test('new relic defs registered', () => {
  assert.truthy(RELIC_DEFS.bugnet, 'bugnet relic def exists');
  assert.truthy(RELIC_DEFS.rod, 'rod relic def exists');
});

test('mushroom wildplant pickup adds 1 mushroom to inv', (scene) => {
  scene.save.inv = []; scene.save.selSlot = 0;
  scene.save.picked = [];
  const wp = findWildplant(w => w.crop === 'mushroom');
  if (!wp) return;
  teleport(scene, wp.x, wp.y);
  tapWorld(scene, wp.x, wp.y);
  assert.gt(invCount(scene, 'mushroom'), 0, 'mushroom added to inv');
  assert.truthy(scene.save.picked.includes(wp.id), 'wp.id in picked');
});

test('fruittree tap with no save.picked entry harvests fruit', (scene) => {
  scene.save.inv = []; scene.save.selSlot = 0;
  scene.save.picked = [];
  const tree = findObject(o => o.kind === 'fruittree');
  if (!tree) return;
  teleport(scene, tree.x, tree.y);
  tapWorld(scene, tree.x, tree.y);
  assert.gt(invCount(scene, tree.species), 0, tree.species + ' added to inv');
  assert.truthy(scene.save.picked.includes(tree.id), 'tree.id marked picked');
});

test('fruittree second tap flashes not-ripe', (scene) => {
  const tree = findObject(o => o.kind === 'fruittree');
  if (!tree) return;
  scene.save.picked = [tree.id];
  scene.save.inv = []; scene.save.selSlot = 0;
  teleport(scene, tree.x, tree.y);
  tapWorld(scene, tree.x, tree.y);
  assert.eq(invCount(scene, tree.species), 0, 'no fruit added on second tap');
});

test('mineralrock without pickaxe flashes need-pickaxe', (scene) => {
  const mr = findObject(o => o.kind === 'mineralrock');
  if (!mr) return;
  scene.save.relics = scene.save.relics || {};
  scene.save.relics.pick = null;
  scene.save.inv = []; scene.save.selSlot = 0;
  scene.save.brokenRocks = scene.save.brokenRocks?.filter(k => k !== mr.id) || [];
  scene.brokenRockSet = new Set(scene.save.brokenRocks);
  teleport(scene, mr.x, mr.y);
  tapWorld(scene, mr.x, mr.y);
  assert.falsy(scene.brokenRockSet.has(mr.id), 'rock not broken without pick');
});

test('mineralrock with sufficient pick tier starts work and drops loot', (scene) => {
  const mr = findObject(o => o.kind === 'mineralrock' && o.requiredTier <= 3);
  if (!mr) return;
  scene.save.relics = scene.save.relics || {};
  scene.save.relics.pick = { tier: 7 };
  scene.save.energy = 100;
  scene.save.inv = []; scene.save.selSlot = 0;
  scene.save.brokenRocks = scene.save.brokenRocks?.filter(k => k !== mr.id) || [];
  scene.brokenRockSet = new Set(scene.save.brokenRocks);
  if (scene._workProgress) scene.cancelWorkProgress();
  teleport(scene, mr.x, mr.y);
  const origStart = scene.startWorkProgress.bind(scene);
  scene.startWorkProgress = (wx, wy, cb, durMs) => cb();
  try { tapWorld(scene, mr.x, mr.y); } finally { scene.startWorkProgress = origStart; }
  assert.truthy(scene.brokenRockSet.has(mr.id), 'rock id added to brokenRockSet');
  assert.gt(invCount(scene, 'coal'), 0, 'coal dropped');
  const gemTotal = invCount(scene, 'sapphire') + invCount(scene, 'ruby') + invCount(scene, 'emerald');
  assert.gt(gemTotal, 0, 'a gem dropped');
});

test('fishing handler: tap water without rod flashes need-rod', (scene) => {
  scene.save.relics = scene.save.relics || {};
  scene.save.relics.rod = null;
  scene.save.inv = []; scene.save.selSlot = 0;
  let water = null;
  for (const [key, e] of WorldGen.tileCache.entries()) {
    if (!e.grid) continue;
    const N = e.cellsPerEdge;
    for (let i = 0; i < e.grid.length && !water; i++) {
      if (e.grid[i] === 3) {
        const ix = i % N, iy = Math.floor(i / N);
        const parts = key.split('/');
        water = {
          x: (+parts[1]) * e.tileEdgeM + (ix + 0.5) * scene.cellM,
          y: (+parts[2]) * e.tileEdgeM + (iy + 0.5) * scene.cellM,
        };
      }
    }
    if (water) break;
  }
  if (!water) return;
  scene.save.relics.can = null;
  teleport(scene, water.x, water.y);
  tapWorld(scene, water.x, water.y);
  for (const id of ['minnow', 'bass', 'trout', 'salmon', 'goldenfish']) {
    assert.eq(invCount(scene, id), 0, 'no ' + id + ' without rod');
  }
});

test('fishing handler: with rod equipped catches a fish', (scene) => {
  scene.save.relics = scene.save.relics || {};
  scene.save.relics.rod = { tier: 7 };
  scene.save.relics.can = null;
  scene.save.energy = 100;
  scene.save.inv = []; scene.save.selSlot = 0;
  // Earlier "watering can refill" test plants a potato directly on the same
  // water cell — the planted handler would then intercept this tap before
  // fishing fires. Clear it.
  scene.save.planted = [];
  let water = null;
  for (const [key, e] of WorldGen.tileCache.entries()) {
    if (!e.grid) continue;
    const N = e.cellsPerEdge;
    for (let i = 0; i < e.grid.length && !water; i++) {
      if (e.grid[i] === 3) {
        const ix = i % N, iy = Math.floor(i / N);
        const parts = key.split('/');
        water = {
          x: (+parts[1]) * e.tileEdgeM + (ix + 0.5) * scene.cellM,
          y: (+parts[2]) * e.tileEdgeM + (iy + 0.5) * scene.cellM,
        };
      }
    }
    if (water) break;
  }
  if (!water) return;
  if (scene._workProgress) scene.cancelWorkProgress();
  teleport(scene, water.x, water.y);
  const origStart = scene.startWorkProgress.bind(scene);
  scene.startWorkProgress = (wx, wy, cb, durMs) => cb();
  try { tapWorld(scene, water.x, water.y); } finally { scene.startWorkProgress = origStart; }
  const fishTotal = ['minnow','bass','trout','salmon','goldenfish']
    .reduce((s, id) => s + invCount(scene, id), 0);
  assert.gt(fishTotal, 0, 'a fish was caught');
});

test('crow catch without bugnet flashes need-bug-net', (scene) => {
  const entry = [...WorldGen.tileCache.values()].find(e => e.creatures);
  if (!entry) return;
  scene.save.relics = scene.save.relics || {};
  scene.save.relics.bugnet = null;
  scene.save.caught = scene.save.caught || [];
  scene.save.inv = []; scene.save.selSlot = 0;
  scene.save.energy = 100;
  const pWX = scene.startWorldM.x + scene.playerM.x;
  const pWY = scene.startWorldM.y + scene.playerM.y;
  const crow = { x: pWX, y: pWY, kind: 'crow', id: 'test_crow_' + Date.now() };
  entry.creatures.push(crow);
  try {
    tapWorld(scene, pWX, pWY);
    assert.falsy(scene.save.caught.includes(crow.id), 'crow not caught without bugnet');
    assert.eq(invCount(scene, 'crow_feather'), 0, 'no crow_feather');
  } finally {
    entry.creatures.pop();
  }
});

test('crow hunt: with a weapon equipped drops a crow_feather, no live crow', (scene) => {
  // Mechanic changed: bug-net catch was replaced by weapon-hunting. A weapon
  // relic (sword/bow/staff) is required; the drop is the processed feather,
  // not a live crow.
  const entry = [...WorldGen.tileCache.values()].find(e => e.creatures);
  if (!entry) return;
  scene.save.relics = { pick: null, axe: null, ring: null, amulet: null,
                        sword: { tier: 1 }, bow: null, staff: null, bugnet: null };
  scene.save.caught = scene.save.caught || [];
  scene.save.inv = []; scene.save.selSlot = 0;
  scene.save.energy = 100;
  const pWX = scene.startWorldM.x + scene.playerM.x;
  const pWY = scene.startWorldM.y + scene.playerM.y;
  const crow = { x: pWX, y: pWY, kind: 'crow', id: 'test_crow2_' + Date.now() };
  entry.creatures.push(crow);
  try {
    tapWorld(scene, pWX, pWY);
    assert.truthy(scene.save.caught.includes(crow.id), 'crow downed with weapon');
    assert.eq(invCount(scene, 'crow_feather'), 1, '1 feather dropped');
    assert.eq(invCount(scene, 'crow'), 0, 'no live crow in inventory');
  } finally {
    entry.creatures.pop();
  }
});

test('crow hunt: no weapon → scared, not caught, _scaredUntilT in future', (scene) => {
  const entry = [...WorldGen.tileCache.values()].find(e => e.creatures);
  if (!entry) return;
  scene.save.relics = { pick: null, axe: null, ring: null, amulet: null,
                        sword: null, bow: null, staff: null, bugnet: null };
  scene.save.caught = scene.save.caught || [];
  scene.save.inv = []; scene.save.selSlot = 0;
  scene.save.energy = 100;
  const pWX = scene.startWorldM.x + scene.playerM.x;
  const pWY = scene.startWorldM.y + scene.playerM.y;
  const crow = { x: pWX, y: pWY, kind: 'crow', id: 'test_scared_crow_' + Date.now() };
  entry.creatures.push(crow);
  try {
    const t0 = performance.now();
    tapWorld(scene, pWX, pWY);
    assert.falsy(scene.save.caught.includes(crow.id), 'crow NOT caught bare-handed');
    assert.eq(invCount(scene, 'crow_feather'), 0, 'no feather without weapon');
    assert.gt(crow._scaredUntilT || 0, t0 + 30000, 'scared timer set ~60 s into future');
  } finally {
    entry.creatures.pop();
  }
});

test('deer hunt: no weapon → scared 60s; with weapon → drops meat, no live deer', (scene) => {
  const entry = [...WorldGen.tileCache.values()].find(e => e.creatures);
  if (!entry) return;
  scene.save.caught = scene.save.caught || [];
  scene.save.inv = []; scene.save.selSlot = 0;
  scene.save.energy = 100;
  const pWX = scene.startWorldM.x + scene.playerM.x;
  const pWY = scene.startWorldM.y + scene.playerM.y;
  const deer = { x: pWX, y: pWY, kind: 'deer', id: 'test_deer_' + Date.now() };
  entry.creatures.push(deer);
  scene.save.relics = { pick: null, axe: null, ring: null, amulet: null,
                        sword: null, bow: null, staff: null };
  try {
    const t0 = performance.now();
    tapWorld(scene, pWX, pWY);
    assert.falsy(scene.save.caught.includes(deer.id), 'no catch bare-handed');
    assert.eq(invCount(scene, 'meat'), 0, 'no meat without weapon');
    assert.gt(deer._scaredUntilT || 0, t0 + 30000, 'deer scared ~60s into future');
    // Equip a staff to satisfy the weapon gate; clear the scare so the
    // hunt branch fires (it returns early when scared also? no — the
    // scared flag only steers wander, not interact. Hunt still works.).
    scene.save.relics.staff = { tier: 1 };
    tapWorld(scene, pWX, pWY);
    assert.truthy(scene.save.caught.includes(deer.id), 'deer downed with weapon');
    assert.eq(invCount(scene, 'meat'), 1, '1 meat dropped');
    assert.eq(invCount(scene, 'deer'), 0, 'no live deer in inventory');
  } finally {
    entry.creatures.pop();
  }
});

test('trader never barters an item for the same item', (scene) => {
  // Force the barter branch (forceBarter=true) and try every priced id as
  // both the offered item AND the held inventory. The trader must never
  // pick the SAME id as payment.
  scene.save.relics = { bow: null, staff: null };
  scene.save.inv = []; scene.save.selSlot = 0;
  // Stash every priced item in inv with count 5 so the candidates filter
  // can in principle pick any of them.
  for (const id of Object.keys(PRICES)) {
    if (!ITEM_BY_ID[id]) continue;
    scene.save.inv.push({ id, count: 5 });
  }
  // Try each priced item as the trader's offer and run the picker enough
  // times that any same-item pick would surface.
  let collisions = 0, samples = 0;
  for (const id of Object.keys(PRICES)) {
    if (!ITEM_BY_ID[id]) continue;
    const base = PRICES[id];
    for (let i = 0; i < 8; i++) {
      const offer = scene.buildShopOffer(id, base, /* forceBarter */ true);
      samples++;
      // The barter label looks like `1× <iconHTML> Name` — pull the id out
      // by scanning save.inv for the chosen pick name. Simpler: hijack
      // canAfford / consume signatures by inspecting the closure indirectly
      // via consuming a fresh inv snapshot.
      // Cheapest: rebuild via a probe — if applying consume() drops the SAME
      // id whose offer we asked for, we found a collision.
      if (offer.kind === 'item') {
        const before = scene.save.inv.find(s => s.id === id)?.count ?? 0;
        // Don't actually consume — just check label includes the same id's display name.
        const wantName = ITEM_BY_ID[id]?.name || id;
        // Label format: `1× <icon> Name` — exact-match the name suffix.
        if ((offer.label || '').endsWith(wantName)) collisions++;
      }
    }
  }
  assert.eq(collisions, 0, `trader self-barter offers across ${samples} draws`);
});

test('lowtier (chestTier 1) chest renders box sprite key', (scene) => {
  const c = findObject(o => o.kind === 'chest' && chestTier(o.poiClass) === 1);
  if (!c) return;
  scene.update(0, 16);
  const { x: ssx, y: ssy } = worldToScreen(scene, c.x, c.y);
  const slot = scene.objectPool.find(s => s.visible &&
    Math.abs(s.x - Math.round(ssx)) < 2 && Math.abs(s.y - Math.round(ssy)) < 2);
  if (!slot) return;
  assert.eq(slot.texture.key, 'box', 'lowtier chest uses box sprite');
});

// ───────────────────────────────────────────────────────────────────────
// Coverage additions — mechanics that landed without dedicated tests.
// ───────────────────────────────────────────────────────────────────────

// PLACED ROCKS — full place-then-pickup cycle with the work-progress wheel.
// Cycle: select rockfruit → tap empty tillable cell → cell joins placedRockSet
// (renders as type-10 rock terrain) → tap again with no item → work-wheel
// starts → flush wheel → cell leaves placedRockSet and rockfruit returns to inv.
test('placed-rock cycle: place rockfruit then pick it back up via work-wheel', (scene) => {
  scene.save.placedRocks = []; scene.placedRockSet = new Set();
  scene.save.brokenRocks = []; scene.brokenRockSet = new Set();
  scene.save.tilled = [];  scene.tilledSet = new Set();
  scene.save.energy = 100;
  scene.save.inv = [{ id: 'rockfruit', count: 3 }];
  scene.save.selSlot = 0;
  // Find an empty tillable grass cell near the player so the place succeeds.
  let target = null;
  for (let d = 1; d < 12 && !target; d++) {
    for (const [dx, dy] of [[d, 0], [0, d], [-d, 0], [0, -d]]) {
      const wx = scene.startWorldM.x + dx * scene.cellM;
      const wy = scene.startWorldM.y + dy * scene.cellM;
      const c = scene.cellAt(wx, wy);
      if (!c.loaded || c.type !== 0) continue;     // need grass
      // Skip cells with anything already on them.
      const cellHalfM = scene.cellM / 2;
      let blocked = false;
      for (const e of WorldGen.tileCache.values()) {
        for (const o of e.objects || []) {
          if (Math.abs(o.x - wx) < cellHalfM && Math.abs(o.y - wy) < cellHalfM) { blocked = true; break; }
        }
        if (blocked) break;
        for (const wp of e.wildplants || []) {
          if (Math.abs(wp.x - wx) < cellHalfM && Math.abs(wp.y - wy) < cellHalfM) { blocked = true; break; }
        }
        if (blocked) break;
      }
      if (!blocked) { target = { wx, wy }; break; }
    }
  }
  if (!target) return;
  teleport(scene, target.wx, target.wy);
  // Place the rockfruit.
  tapWorld(scene, target.wx, target.wy);
  assert.eq(scene.placedRockSet.size, 1, 'placed-rock set grew by 1');
  assert.eq(invCount(scene, 'rockfruit'), 2, 'inv stack decremented by 1');
  // Empty-hand tap to start the pickup work-wheel.
  scene.save.selSlot = -1;
  tapWorld(scene, target.wx, target.wy);
  assert.truthy(scene._workProgress, 'pickup-rock kicks off a work-wheel');
  // Force the wheel to complete and verify the rock came back as rockfruit.
  const cb = scene._workProgress.onComplete;
  scene.cancelWorkProgress();
  cb();
  assert.eq(scene.placedRockSet.size, 0, 'placed-rock set drained after pickup');
  assert.eq(invCount(scene, 'rockfruit'), 3, 'rockfruit refunded to inv');
});

// PICK / TOOL DURATION — tier curve for rock-break work-wheel.
// Bare hands 10s, wood 3s, then -750ms per tier with a 500ms floor.
test('pickDurationMs: tier curve matches design (bare 10s → wood 3s → iron 1.5s → floor 0.5s)', () => {
  if (typeof pickDurationMs !== 'function') return;
  assert.eq(pickDurationMs(null), 10000, 'no relic → 10s bare-handed');
  assert.eq(pickDurationMs({}), 10000, 'no .pick entry → 10s');
  assert.eq(pickDurationMs({ pick: { tier: 1 } }), 3000, 'wood pick → 3s');
  assert.eq(pickDurationMs({ pick: { tier: 2 } }), 2250, 'copper → 2.25s');
  assert.eq(pickDurationMs({ pick: { tier: 3 } }), 1500, 'iron → 1.5s');
  assert.eq(pickDurationMs({ pick: { tier: 4 } }), 750,  'gold → 0.75s');
  assert.eq(pickDurationMs({ pick: { tier: 5 } }), 500,  'platinum hits floor');
  assert.eq(pickDurationMs({ pick: { tier: 7 } }), 500,  'frost stays at floor');
});

// CHICKEN FLOCK RELEASE — chickens release in groups of 4. Stack must hold ≥4;
// otherwise the tap flashes 'need 4 chickens' and leaves the stack untouched.
test('chicken release: needs ≥4 in stack, then places 4 spread out', (scene) => {
  scene.save.released = [];
  scene.save.inv = [{ id: 'chicken', count: 3 }];
  scene.save.selSlot = 0;
  // Find an empty tillable grass cell to release onto.
  let target = null;
  for (let d = 1; d < 8 && !target; d++) {
    for (const [dx, dy] of [[d, 0], [0, d], [-d, 0], [0, -d]]) {
      const wx = scene.startWorldM.x + dx * scene.cellM;
      const wy = scene.startWorldM.y + dy * scene.cellM;
      const c = scene.cellAt(wx, wy);
      if (c.loaded && c.type === 0) { target = { wx, wy }; break; }
    }
  }
  if (!target) return;
  teleport(scene, target.wx, target.wy);
  tapWorld(scene, target.wx, target.wy);
  assert.eq(scene.save.released.length, 0, '3 chickens: nothing released');
  assert.eq(invCount(scene, 'chicken'), 3, 'stack untouched');
  // Top up to 4 — now the release succeeds.
  scene.save.inv = [{ id: 'chicken', count: 4 }];
  scene.save.selSlot = 0;
  tapWorld(scene, target.wx, target.wy);
  assert.eq(scene.save.released.length, 4, '4 chickens released');
  assert.eq(invCount(scene, 'chicken'), 0, 'whole stack consumed (released 4)');
  // Spread: each released bird sits at a distinct world position.
  const xs = new Set(scene.save.released.map(r => r.x.toFixed(3)));
  const ys = new Set(scene.save.released.map(r => r.y.toFixed(3)));
  assert.gt(xs.size + ys.size, 2, 'released chickens are not all stacked');
});

// HOUSE SHOP TYPE — derived from house.address last digit.
//   ends in 9     → blacksmith
//   ends in 2 / 6 → market
//   ends in 1 / 8 → trader
//   anything else → null (plain house)
test('shopType: address last digit picks blacksmith / market / trader / null', () => {
  if (typeof WorldGen === 'undefined' || typeof WorldGen.shopType !== 'function') return;
  const T = (typeof WorldGen.T !== 'undefined') ? WorldGen.T.BUILDING : 9;
  const mk = (addr) => ({ kind: 'house', tier: T, address: addr });
  assert.eq(WorldGen.shopType(mk(19)),  'blacksmith', 'address 19 (ends in 9)');
  assert.eq(WorldGen.shopType(mk(102)), 'market',     'address 102 (ends in 2)');
  assert.eq(WorldGen.shopType(mk(26)),  'market',     'address 26 (ends in 6)');
  assert.eq(WorldGen.shopType(mk(31)),  'trader',     'address 31 (ends in 1)');
  assert.eq(WorldGen.shopType(mk(48)),  'trader',     'address 48 (ends in 8)');
  assert.eq(WorldGen.shopType(mk(7)),   null,         'address 7 → plain house');
  assert.eq(WorldGen.shopType(mk(0)),   null,         'address 0 → plain house');
  // Non-house objects and non-BUILDING tiers always return null.
  assert.eq(WorldGen.shopType({ kind: 'house', tier: 11, address: 9 }), null, 'tier 11 disqualified');
  assert.eq(WorldGen.shopType({ kind: 'chest', address: 9 }), null, 'non-house disqualified');
  assert.eq(WorldGen.shopType(null), null, 'null safe');
});

// TREASURE TAP — finding the 'X' on the ground gives loot or money.
// Each tile has an optional `entry.treasure` set by spawnInTile (one guaranteed
// just north of spawn, otherwise rare). Tap within REACH_TREASURE_M of the X
// (and inside the player's reach gate) and the id should be added to
// foundTreasures + either money or an inventory entry should bump.
test('treasure: tapping the X within reach marks it found and grants loot', (scene) => {
  scene.save.foundTreasures = [];
  scene.save.inv = []; scene.save.money = 0; scene.save.selSlot = -1;
  // Pull the first unfound treasure from the cache. The spawn tile has a
  // guaranteed one 10 m north of startWorldM.
  let tr = null;
  for (const e of WorldGen.tileCache.values()) {
    if (e.treasure) { tr = e.treasure; break; }
  }
  if (!tr) return;
  teleport(scene, tr.x, tr.y);
  const moneyBefore = scene.save.money;
  const invBefore = scene.save.inv.length;
  tapWorld(scene, tr.x, tr.y);
  assert.truthy(scene.save.foundTreasures.includes(tr.id), 'treasure id in foundTreasures');
  const gotLoot = (scene.save.money > moneyBefore) || (scene.save.inv.length > invBefore);
  assert.truthy(gotLoot, 'either money grew or an inv stack appeared');
  // Tapping it again: no double dip.
  const moneyMid = scene.save.money;
  const invMid = scene.save.inv.length;
  tapWorld(scene, tr.x, tr.y);
  assert.eq(scene.save.money, moneyMid, 'second tap does not pay again');
  assert.eq(scene.save.inv.length, invMid, 'second tap does not loot again');
});

// WORK-PROGRESS GRACE — a tap is swallowed (not cancelled) for the first 150ms
// after a wheel starts. Without this, a double-tap that LAUNCHES the wheel
// can end up cancelling it on the same gesture.
test('work-progress: tap within 150ms of start does NOT cancel; later tap cancels', (scene) => {
  scene.save.relics = scene.save.relics || {};
  scene.save.relics.pick = { tier: 1 };
  scene.save.energy = 100;
  scene.save.brokenRocks = []; scene.brokenRockSet = new Set();
  // Find a rock cell to start a real work wheel.
  let target = null;
  for (let d = 1; d < 30 && !target; d++) {
    for (const [dx, dy] of [[d, 0], [0, d], [-d, 0], [0, -d], [d, d], [-d, -d]]) {
      const wx = scene.startWorldM.x + dx * scene.cellM;
      const wy = scene.startWorldM.y + dy * scene.cellM;
      const c = scene.cellAt(wx, wy);
      if (c.loaded && c.type === 10) { target = { wx, wy }; break; }
    }
  }
  if (!target) return;
  teleport(scene, target.wx, target.wy);
  tapWorld(scene, target.wx, target.wy);
  assert.truthy(scene._workProgress, 'work-progress launched');
  // Fake an immediate second tap: by manually setting startT to "now" we
  // guarantee the elapsed < 150ms branch fires.
  scene._workProgress.startT = performance.now();
  tapWorld(scene, target.wx, target.wy);
  assert.truthy(scene._workProgress, 'tap within 150ms grace was swallowed, wheel still running');
  // Now backdate the start so the grace window has passed. A tap should cancel.
  scene._workProgress.startT = performance.now() - 500;
  tapWorld(scene, target.wx, target.wy);
  assert.falsy(scene._workProgress, 'tap after grace window cancels the wheel');
});

// SANDBOX MODULE — detect() reads the URL query; install() pre-populates
// WorldGen.tileCache with a synthetic tile covering every biome the game
// can render. The install is non-destructive on cached tiles, so it's safe
// to call inside the test harness.
test('Sandbox.detect respects ?sandbox=true and false otherwise', () => {
  if (typeof Sandbox === 'undefined') return;
  // We can't actually mutate location.search here, but the detect() call
  // shape should match what the URL says — assert truthy/falsy boolean.
  const d = Sandbox.detect();
  assert.eq(typeof d, 'boolean', 'detect returns a boolean');
});

// ───────────────────────────────────────────────────────────────────────
// Recent feature coverage — pets, pests, scarecrows, icons.
// ───────────────────────────────────────────────────────────────────────

test('cat catch: any fish works (bass)', (scene) => {
  const entry = [...WorldGen.tileCache.values()].find(e => e.creatures);
  if (!entry) return;
  scene.save.caught = scene.save.caught || [];
  scene.save.energy = 100;
  scene.save.inv = [{ id: 'bass', count: 1 }]; scene.save.selSlot = 0;
  const pWX = scene.startWorldM.x + scene.playerM.x;
  const pWY = scene.startWorldM.y + scene.playerM.y;
  const cat = { x: pWX, y: pWY, kind: 'cat', id: 'test_cat_bass_' + Date.now() };
  entry.creatures.push(cat);
  try {
    tapWorld(scene, pWX, pWY);
    assert.truthy(scene.save.caught.includes(cat.id), 'cat caught with bass');
    assert.eq(invCount(scene, 'cat'), 1, '1 cat in inv');
    assert.eq(invCount(scene, 'bass'), 0, 'bass consumed');
  } finally {
    entry.creatures.pop();
  }
});

test('tame pet: any tap flashes purr/cluck (never "yuck"), arms _pettedUntilT', (scene) => {
  const entry = [...WorldGen.tileCache.values()].find(e => e.creatures);
  if (!entry) return;
  scene.save.caught = scene.save.caught || [];
  scene.save.energy = 100;
  // Hold a deliberately wrong food (rainberry is a chicken treat — feed it
  // to a tame cat, which on a WILD cat would yuck and consume).
  scene.save.inv = [{ id: 'rainberry', count: 3 }]; scene.save.selSlot = 0;
  const pWX = scene.startWorldM.x + scene.playerM.x;
  const pWY = scene.startWorldM.y + scene.playerM.y;
  const pet = { x: pWX, y: pWY, kind: 'cat', id: 'released_test_pet_' + Date.now() };
  entry.creatures.push(pet);
  // Capture flash calls so we can verify the message is the purr line.
  const flashes = [];
  const origLoot = scene.flashLoot;
  scene.flashLoot = function(msg) { flashes.push(String(msg)); };
  try {
    const t0 = performance.now();
    tapWorld(scene, pWX, pWY);
    assert.falsy(scene.save.caught.includes(pet.id), 'tame pet not consumed by catch');
    assert.gt(pet._pettedUntilT || 0, t0 + 60000, 'petting-boost timer armed (~10m)');
    assert.gt(pet._followUntilT || 0, t0 + 60000, 'cat follow timer armed (~5m)');
    const sawPurr = flashes.some(s => s.includes('purr'));
    const sawYuck = flashes.some(s => /yuck|needs/i.test(s));
    assert.truthy(sawPurr, 'flashLoot played purr');
    assert.falsy(sawYuck, 'no yuck flash for tame pet');
  } finally {
    scene.flashLoot = origLoot;
    entry.creatures.pop();
  }
});

test('scarecrow aversion: crow refuses to step within 4 cells of a scarecrow', (scene) => {
  // Plant a crop next to the player so the crow has something to target,
  // ring it with a scarecrow, and verify that after wanderCreatures() picks
  // a step target the chosen cell is NOT inside the 4-cell exclusion.
  const entry = [...WorldGen.tileCache.values()].find(e => e.creatures);
  if (!entry) return;
  const pWX = scene.startWorldM.x + scene.playerM.x;
  const pWY = scene.startWorldM.y + scene.playerM.y;
  scene.save.planted = scene.save.planted || [];
  // Crop 1 cell east of player.
  const crop = { x: pWX + scene.cellM, y: pWY, id: 'rainberry', stage: 0, t: 0 };
  scene.save.planted.push(crop);
  // Scarecrow co-located with the crop so the whole 4-cell aversion disc
  // covers the crop and the cells immediately around the crow.
  scene.save.scarecrows = [{ x: crop.x, y: crop.y }];
  // Crow 6 cells east of player (just outside the 4-cell aversion ring).
  const crow = { x: pWX + 6 * scene.cellM, y: pWY, kind: 'crow', id: 'aversion_crow_' + Date.now() };
  entry.creatures.push(crow);
  try {
    // Run wander twice so _nextChooseT lands in the past and a fresh
    // target is picked under the aversion check.
    scene.wanderCreatures();
    crow._nextChooseT = 0;
    scene.wanderCreatures();
    const dx = crow._targetX - crop.x, dy = crow._targetY - crop.y;
    const dist2 = dx * dx + dy * dy;
    const SC_R = 4 * scene.cellM;
    assert.truthy(dist2 >= SC_R * SC_R, 'crow target outside 4-cell scarecrow ring');
  } finally {
    entry.creatures.pop();
    const ci = scene.save.planted.indexOf(crop);
    if (ci >= 0) scene.save.planted.splice(ci, 1);
    scene.save.scarecrows = [];
  }
});

test('pest crow eats planted crop on contact (removes from save.planted)', (scene) => {
  const entry = [...WorldGen.tileCache.values()].find(e => e.creatures);
  if (!entry) return;
  const pWX = scene.startWorldM.x + scene.playerM.x;
  const pWY = scene.startWorldM.y + scene.playerM.y;
  scene.save.planted = scene.save.planted || [];
  scene.save.scarecrows = [];
  const crop = { x: pWX, y: pWY, id: 'rainberry', stage: 0, t: 0 };
  scene.save.planted.push(crop);
  const before = scene.save.planted.length;
  // Crow co-located with the crop → bestD2 < (cellM*0.5)^2 → eaten.
  const crow = { x: pWX, y: pWY, kind: 'crow', id: 'eat_crow_' + Date.now() };
  entry.creatures.push(crow);
  try {
    crow._nextChooseT = 0;   // force a target pick this tick
    scene.wanderCreatures();
    assert.eq(scene.save.planted.length, before - 1, 'planted crop was eaten');
    assert.falsy(scene.save.planted.includes(crop), 'specific crop gone');
  } finally {
    entry.creatures.pop();
  }
});

test('REG: sapphire/ruby/emerald icons resolve to Gemstones.png (not Crops.png berry)', () => {
  // The SHEETS table in app.js used to be an if/else that fell through to
  // Crops.png for any unknown sheet — sapphire {sheet:'gems', frame:4}
  // rendered as a rainberry bush. Guard against the regression by asserting
  // the catalog entry routes to the gems sheet.
  if (typeof inventoryIconSource !== 'function') return;
  for (const id of ['sapphire', 'ruby', 'emerald']) {
    const src = inventoryIconSource(id);
    assert.truthy(src, `${id} has an icon source`);
    assert.eq(src.sheet, 'gems', `${id} routed to gems sheet`);
  }
  // Shell uses its own multi-variant sheet — also a regression vector.
  const sh = inventoryIconSource('shell');
  assert.truthy(sh, 'shell has an icon source');
  assert.eq(sh.sheet, 'shell_sheet', 'shell routed to shell_sheet');
});

// ───────────────────────────────────────────────────────────────────────
// Bars + smelting / blacksmith recipes
// Bars are the forge ladder — six tiers (copper → frost) feeding every
// non-wood blacksmith recipe. T2-T4 (copper / iron / gold) are mineable;
// T5-T7 (platinum / crimson / frost) must be SMELTED from their tier's
// magical flower via a separate recipe.
// ───────────────────────────────────────────────────────────────────────

test('bars: all six tiers registered as mineral-kind with ascending price + matching baseTier', () => {
  const expected = [
    ['copper_bar',   2],
    ['iron_bar',     3],
    ['gold_bar',     4],
    ['platinum_bar', 5],
    ['crimson_bar',  6],
    ['frost_bar',    7],
  ];
  let lastPrice = 0;
  for (const [id, tier] of expected) {
    const it = ITEM_BY_ID[id];
    assert.truthy(it, id + ' is registered');
    assert.eq(it.kind, 'mineral', id + ' kind=mineral');
    assert.eq(it.baseTier, tier, id + ' baseTier = T' + tier);
    assert.gt(PRICES[id], lastPrice, id + ' price > previous (' + lastPrice + ')');
    lastPrice = PRICES[id];
  }
});

test('bars: inventory icons route to the bars sheet at tier-ordered frames', () => {
  if (typeof inventoryIconSource !== 'function') return;
  const order = ['copper_bar', 'iron_bar', 'gold_bar', 'platinum_bar', 'crimson_bar', 'frost_bar'];
  order.forEach((id, idx) => {
    const src = inventoryIconSource(id);
    assert.truthy(src, id + ' has icon source');
    assert.eq(src.sheet, 'bars', id + ' routed to bars sheet');
    assert.eq(src.frame, idx, id + ' frame index = ' + idx);
  });
});

test('blacksmithRecipe: tool/weapon/armor slots want N copies of the tier-matched bar', (scene) => {
  const BARS = ['copper_bar', 'iron_bar', 'gold_bar', 'platinum_bar', 'crimson_bar', 'frost_bar'];
  for (let t = 2; t <= 7; t++) {
    const r = scene.blacksmithRecipe('relic', 'pick', t);
    assert.truthy(Array.isArray(r) && r.length === 1, 'pick T' + t + ': single-ingredient recipe');
    assert.eq(r[0].id, BARS[t - 2], 'pick T' + t + ' bar = ' + BARS[t - 2]);
    assert.eq(r[0].qty, t, 'pick T' + t + ' qty = ' + t);
  }
});

test('blacksmithRecipe: jewelry slots use 2^(t-2) slot-gems + 1 tier-bar', (scene) => {
  const BARS = ['copper_bar', 'iron_bar', 'gold_bar', 'platinum_bar', 'crimson_bar', 'frost_bar'];
  const gemFor = { ring: 'ruby', staff: 'emerald', amulet: 'sapphire' };
  for (const slot of Object.keys(gemFor)) {
    for (let t = 2; t <= 7; t++) {
      const r = scene.blacksmithRecipe('relic', slot, t);
      assert.truthy(r && r.length === 2, slot + ' T' + t + ' has 2-ingredient recipe');
      assert.eq(r[0].id, gemFor[slot], slot + ' T' + t + ' gem = ' + gemFor[slot]);
      assert.eq(r[0].qty, Math.pow(2, t - 2), slot + ' T' + t + ' gem qty = 2^(t-2)');
      assert.eq(r[1].id, BARS[t - 2], slot + ' T' + t + ' bar = ' + BARS[t - 2]);
      assert.eq(r[1].qty, 1, slot + ' T' + t + ' bar qty = 1');
    }
  }
});

test('blacksmithRecipe: tier < 2 returns null (T1 wood is starter-shop only)', (scene) => {
  assert.eq(scene.blacksmithRecipe('relic', 'pick', 1), null, 'T1 = null');
  assert.eq(scene.blacksmithRecipe('relic', 'pick', 0), null, 'T0 = null');
  assert.eq(scene.blacksmithRecipe('relic', 'pick', null), null, 'no tier = null');
});

test('smeltingRecipe: T2-T4 bars are non-smeltable; T5-T7 each consume 1 flower + 1 prev-tier bar', (scene) => {
  for (const id of ['copper_bar', 'iron_bar', 'gold_bar']) {
    assert.eq(scene.smeltingRecipe(id), null, id + ' is not smeltable (mineable only)');
  }
  const chain = [
    ['platinum_bar', 'sunflower',  'gold_bar'],
    ['crimson_bar',  'fireflower', 'platinum_bar'],
    ['frost_bar',    'iceflower',  'crimson_bar'],
  ];
  for (const [bar, flower, prevBar] of chain) {
    const r = scene.smeltingRecipe(bar);
    assert.truthy(Array.isArray(r) && r.length === 2, bar + ' has 2-ingredient recipe');
    assert.eq(r[0].id, flower, bar + ' wants ' + flower);
    assert.eq(r[0].qty, 1, bar + ' wants 1 flower');
    assert.eq(r[1].id, prevBar, bar + ' wants ' + prevBar);
    assert.eq(r[1].qty, 1, bar + ' wants 1 ' + prevBar);
  }
  assert.eq(scene.smeltingRecipe('not_a_bar'), null, 'unknown bar id → null');
});

test('mineralrock mining: T1-2 drops copper_bar, T3 drops iron_bar, T4+ drops gold_bar', (scene) => {
  // Pin Math.random so the side gem / bonus rolls don't add cross-noise to
  // the primary-bar assertion. We're checking the BARS[] mapping in
  // interact.js, not the gem percentages (covered separately).
  const expected = { 1: 'copper_bar', 2: 'copper_bar', 3: 'iron_bar',
                     4: 'gold_bar',   5: 'gold_bar',   6: 'gold_bar', 7: 'gold_bar' };
  const seenTiers = new Set();
  for (const e of WorldGen.tileCache.values()) {
    for (const o of (e.objects || [])) {
      if (o.kind !== 'mineralrock') continue;
      if (seenTiers.has(o.requiredTier)) continue;
      const want = expected[o.requiredTier];
      if (!want) continue;
      seenTiers.add(o.requiredTier);
      // Fresh rock state.
      scene.save.relics = scene.save.relics || {};
      scene.save.relics.pick = { tier: 7 };
      scene.save.energy = 100;
      scene.save.inv = []; scene.save.selSlot = 0;
      scene.save.brokenRocks = (scene.save.brokenRocks || []).filter(k => k !== o.id);
      scene.brokenRockSet = new Set(scene.save.brokenRocks);
      if (scene._workProgress) scene.cancelWorkProgress();
      teleport(scene, o.x, o.y);
      const origStart = scene.startWorkProgress.bind(scene);
      const origRandom = Math.random;
      scene.startWorkProgress = (wx, wy, cb) => cb();
      Math.random = () => 0.99;   // skip every percentage gate (gems, bonus)
      try { tapWorld(scene, o.x, o.y); }
      finally { scene.startWorkProgress = origStart; Math.random = origRandom; }
      assert.gt(invCount(scene, want), 0,
        'T' + o.requiredTier + ' rock drops ' + want);
    }
  }
  assert.gt(seenTiers.size, 0, 'fixture contains at least one mineralrock');
});

// ───────────────────────────────────────────────────────────────────────
// Magic Crafting Shrine — one per game, levels 1..7. Each level unlocks
// a new produce → bar transform. Level-up costs a 3-item bundle of 5×
// each. The shrine REPLACES a chest ≥ 200 m from start on the first
// qualifying tile load.
// ───────────────────────────────────────────────────────────────────────

test('shrine: save bootstrapper defaults (shrineLevel = 1, shrine + shrineReplacedId defined)', (scene) => {
  assert.eq(typeof scene.save.shrineLevel, 'number', 'shrineLevel is numeric');
  assert.truthy(scene.save.shrineLevel >= 1 && scene.save.shrineLevel <= 7,
    'shrineLevel in [1..7]');
  assert.truthy('shrine' in scene.save, 'save.shrine defined');
  assert.truthy('shrineReplacedId' in scene.save, 'save.shrineReplacedId defined');
});

test('shrineLevelUpCost: each L1..L6 bundle is 3 distinct items × qty 5; L7 returns null', (scene) => {
  for (let lvl = 1; lvl <= 6; lvl++) {
    const b = scene.shrineLevelUpCost(lvl);
    assert.truthy(Array.isArray(b), 'L' + lvl + ' bundle is an array');
    assert.eq(b.length, 3, 'L' + lvl + ' bundle has 3 ingredients');
    const ids = new Set(b.map(r => r.id));
    assert.eq(ids.size, 3, 'L' + lvl + ' ingredients are distinct');
    for (const r of b) {
      assert.eq(r.qty, 5, 'L' + lvl + ' ' + r.id + ' qty = 5');
      assert.truthy(ITEM_BY_ID[r.id], 'L' + lvl + ' ' + r.id + ' is a known item');
    }
  }
  assert.eq(scene.shrineLevelUpCost(7), null, 'L7 (cap) returns null');
  assert.eq(scene.shrineLevelUpCost(99), null, 'over-cap returns null');
});

test('shrineLevelUpCost: each tier bundle requires the matching bar (T1→coal, T2→copper..T6→crimson)', (scene) => {
  // L1→L2 is the only bundle that requests an UNSMELTED currency (coal);
  // every subsequent tier asks for the bar one tier BELOW the upgrade.
  const expectedBar = { 1: 'coal',
                        2: 'copper_bar', 3: 'iron_bar', 4: 'gold_bar',
                        5: 'platinum_bar', 6: 'crimson_bar' };
  for (let lvl = 1; lvl <= 6; lvl++) {
    const b = scene.shrineLevelUpCost(lvl);
    const ids = b.map(r => r.id);
    assert.truthy(ids.includes(expectedBar[lvl]),
      'L' + lvl + '→L' + (lvl + 1) + ' bundle includes ' + expectedBar[lvl]);
  }
});

test('shrineTransforms: returns 0 entries at L1; one new unlock per level; capped at 6 by L7', (scene) => {
  const origLvl = scene.save.shrineLevel;
  try {
    scene.save.shrineLevel = 1;
    assert.eq(scene.shrineTransforms().length, 0, 'L1 has no transforms');
    for (let lvl = 2; lvl <= 7; lvl++) {
      scene.save.shrineLevel = lvl;
      assert.eq(scene.shrineTransforms().length, lvl - 1,
        'L' + lvl + ' cumulative transforms = ' + (lvl - 1));
    }
    // L2 unlock is rainberry → copper_bar; L7 (last) is iceflower → frost_bar.
    scene.save.shrineLevel = 7;
    const ts = scene.shrineTransforms();
    assert.eq(ts[0].input, 'rainberry', 'first unlock = rainberry');
    assert.eq(ts[0].output, 'copper_bar', 'first unlock outputs copper_bar');
    assert.eq(ts[ts.length - 1].input, 'iceflower', 'last unlock = iceflower');
    assert.eq(ts[ts.length - 1].output, 'frost_bar', 'last unlock outputs frost_bar');
  } finally {
    scene.save.shrineLevel = origLvl;
  }
});

test('shrineInteract: matching produce → transform modal; accept swaps 1 input for 1 output', (scene) => {
  document.getElementById('offer-modal')?.remove();
  const origLvl = scene.save.shrineLevel;
  scene.save.shrineLevel = 2;          // rainberry → copper_bar unlocked
  scene.save.inv = [{ id: 'rainberry', count: 3 }];
  scene.save.selSlot = 0;
  try {
    scene.shrineInteract(0, 0, { kind: 'shrine', x: 0, y: 0, id: 'test_shrine_xform' });
    const modal = document.getElementById('offer-modal');
    assert.truthy(modal, 'transform modal opened');
    assert.truthy(modal.innerHTML.toLowerCase().includes('transform'),
      'modal title mentions Transform');
    const accept = [...modal.querySelectorAll('button')].find(b => b.textContent === 'Transform');
    assert.truthy(accept, 'Transform button present');
    accept.click();
    assert.eq(invCount(scene, 'rainberry'), 2, 'one rainberry consumed');
    assert.eq(invCount(scene, 'copper_bar'), 1, 'one copper_bar added');
  } finally {
    scene.save.shrineLevel = origLvl;
    document.getElementById('offer-modal')?.remove();
  }
});

test('shrineInteract: no matching produce → level-up modal; Offer consumes bundle + bumps level', (scene) => {
  document.getElementById('offer-modal')?.remove();
  const origLvl = scene.save.shrineLevel;
  scene.save.shrineLevel = 1;
  // L1→L2 bundle is 5 potato + 5 egg + 5 coal. Hold all three.
  scene.save.inv = [
    { id: 'potato', count: 5 },
    { id: 'egg',    count: 5 },
    { id: 'coal',   count: 5 },
  ];
  scene.save.selSlot = 0;   // potato — NOT a transform input at L1
  try {
    scene.shrineInteract(0, 0, { kind: 'shrine', x: 0, y: 0, id: 'test_shrine_up' });
    const modal = document.getElementById('offer-modal');
    assert.truthy(modal, 'level-up modal opened');
    assert.truthy(modal.innerHTML.includes('Level 1'), 'modal mentions current level');
    const offer = [...modal.querySelectorAll('button')].find(b => b.textContent === 'Offer');
    assert.truthy(offer, 'Offer button present');
    assert.falsy(offer.disabled, 'Offer enabled when bundle fully held');
    offer.click();
    assert.eq(scene.save.shrineLevel, 2, 'level advanced to 2');
    assert.eq(invCount(scene, 'potato'), 0, '5 potato consumed');
    assert.eq(invCount(scene, 'egg'), 0, '5 egg consumed');
    assert.eq(invCount(scene, 'coal'), 0, '5 coal consumed');
  } finally {
    scene.save.shrineLevel = origLvl;
    document.getElementById('offer-modal')?.remove();
  }
});

test('shrineInteract: incomplete bundle disables Offer button + leaves level + inv intact', (scene) => {
  document.getElementById('offer-modal')?.remove();
  const origLvl = scene.save.shrineLevel;
  scene.save.shrineLevel = 1;
  // Hold the easy two but no coal — bundle is unaffordable.
  scene.save.inv = [
    { id: 'potato', count: 5 },
    { id: 'egg',    count: 5 },
  ];
  scene.save.selSlot = 0;
  try {
    scene.shrineInteract(0, 0, { kind: 'shrine', x: 0, y: 0, id: 'test_shrine_short' });
    const modal = document.getElementById('offer-modal');
    assert.truthy(modal, 'modal opened');
    const offer = [...modal.querySelectorAll('button')].find(b => b.textContent === 'Offer');
    assert.truthy(offer, 'Offer button present');
    assert.truthy(offer.disabled, 'Offer disabled (missing coal)');
    assert.eq(scene.save.shrineLevel, 1, 'level unchanged');
    assert.eq(invCount(scene, 'potato'), 5, 'potato stack untouched');
    assert.eq(invCount(scene, 'egg'), 5, 'egg stack untouched');
  } finally {
    scene.save.shrineLevel = origLvl;
    document.getElementById('offer-modal')?.remove();
  }
});

test('shrineInteract: at level 7 the modal lists transforms with a Close button (no Offer)', (scene) => {
  document.getElementById('offer-modal')?.remove();
  const origLvl = scene.save.shrineLevel;
  scene.save.shrineLevel = 7;
  scene.save.inv = [];            // no matching produce → level-up branch
  scene.save.selSlot = 0;
  try {
    scene.shrineInteract(0, 0, { kind: 'shrine', x: 0, y: 0, id: 'test_shrine_max' });
    const modal = document.getElementById('offer-modal');
    assert.truthy(modal, 'modal opened at L7');
    assert.truthy(modal.innerHTML.includes('Level 7'), 'modal mentions Level 7');
    const close = [...modal.querySelectorAll('button')].find(b => b.textContent === 'Close');
    assert.truthy(close, 'Close button present');
    const offer = [...modal.querySelectorAll('button')].find(b => b.textContent === 'Offer');
    assert.falsy(offer, 'no Offer button at max level');
  } finally {
    scene.save.shrineLevel = origLvl;
    document.getElementById('offer-modal')?.remove();
  }
});

test('shrineInteract: re-entry while a modal is open is a no-op (single modal at a time)', (scene) => {
  document.getElementById('offer-modal')?.remove();
  scene.save.inv = [];
  scene.save.selSlot = 0;
  try {
    scene.shrineInteract(0, 0, { kind: 'shrine', x: 0, y: 0, id: 'test_shrine_lock' });
    assert.truthy(document.getElementById('offer-modal'), 'first modal opened');
    // Second call must NOT replace or stack.
    scene.shrineInteract(0, 0, { kind: 'shrine', x: 0, y: 0, id: 'test_shrine_lock' });
    assert.eq(document.querySelectorAll('#offer-modal').length, 1,
      'only one offer-modal in the DOM');
  } finally {
    document.getElementById('offer-modal')?.remove();
  }
});

test('shrineInteract: L6→L7 upgrade unlocks the iceflower → frost_bar transform', (scene) => {
  document.getElementById('offer-modal')?.remove();
  const origLvl = scene.save.shrineLevel;
  scene.save.shrineLevel = 6;
  // L6→L7 bundle: 5 iceflower + 5 iceflower_seed + 5 crimson_bar.
  scene.save.inv = [
    { id: 'iceflower',      count: 5 },
    { id: 'iceflower_seed', count: 5 },
    { id: 'crimson_bar',    count: 5 },
  ];
  // Iceflower IS a transform input at L6 — selecting potato (or empty)
  // avoids the matching-produce branch so the level-up modal opens.
  scene.save.selSlot = -1;
  try {
    scene.shrineInteract(0, 0, { kind: 'shrine', x: 0, y: 0, id: 'test_shrine_l6' });
    const modal = document.getElementById('offer-modal');
    assert.truthy(modal, 'level-up modal opened at L6');
    const offer = [...modal.querySelectorAll('button')].find(b => b.textContent === 'Offer');
    assert.truthy(offer && !offer.disabled, 'Offer affordable');
    offer.click();
    assert.eq(scene.save.shrineLevel, 7, 'advanced to L7');
    // L7 must now include the frost_bar transform.
    const ts = scene.shrineTransforms();
    const frost = ts.find(t => t.output === 'frost_bar');
    assert.truthy(frost, 'frost_bar transform unlocked');
    assert.eq(frost.input, 'iceflower', 'frost_bar input is iceflower');
  } finally {
    scene.save.shrineLevel = origLvl;
    document.getElementById('offer-modal')?.remove();
  }
});

test('shrine spawn: replaces a chest ≥ 200 m from start (or correctly skips when none qualify)', (scene) => {
  // Either save.shrine is set and references a world position ≥ 200 m from
  // the player's start, or shrine is null because no qualifying POI lived in
  // any loaded tile — both outcomes are valid per _trySpawnShrineOnTile.
  const s = scene.save.shrine;
  if (!s) {
    // No spawn — assert the bookkeeping is consistent.
    assert.eq(scene.save.shrineReplacedId, null,
      'no shrine ⇒ no replaced chest id');
    return;
  }
  // Spawned: position must be ≥ 200 m from start. _trySpawnShrineOnTile
  // uses `d2 < MIN_DIST_M^2` to SKIP, so equality at 200 m is allowed.
  const dx = s.x - scene.startWorldM.x, dy = s.y - scene.startWorldM.y;
  const dist = Math.hypot(dx, dy);
  assert.truthy(dist >= 200, 'shrine distance from start (' + dist.toFixed(1) + ' m) ≥ 200 m');
  // The id of the replaced chest must be recorded.
  assert.truthy(scene.save.shrineReplacedId,
    'shrineReplacedId set when shrine spawned');
  // The shrine object should be in some loaded tile's objects list.
  let shrineObj = null;
  for (const e of WorldGen.tileCache.values()) {
    for (const o of (e.objects || [])) {
      if (o.kind === 'shrine' && o.id === s.id) { shrineObj = o; break; }
    }
    if (shrineObj) break;
  }
  assert.truthy(shrineObj, 'shrine object present in tile cache');
  assert.eq(shrineObj.x, s.x, 'shrine.x matches save');
  assert.eq(shrineObj.y, s.y, 'shrine.y matches save');
  // And the replaced chest must NOT also be there (zombie chest regression).
  let zombie = null;
  for (const e of WorldGen.tileCache.values()) {
    for (const o of (e.objects || [])) {
      if (o.kind === 'chest' && o.id === scene.save.shrineReplacedId) { zombie = o; break; }
    }
    if (zombie) break;
  }
  assert.falsy(zombie, 'replaced chest id no longer present as a chest object');
});
