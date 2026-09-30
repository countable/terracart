// Tiny test runner. Tests register themselves via `test(name, fn)`. After all
// scripts load, harness.html calls `runTests(scene)` which awaits each one in
// order and renders pass/fail into #cases.
//
// Conventions:
//   - Each test is `async (scene) => { ... }`.
//   - Throw to fail. Use `assert.*` helpers from below.
//   - Tests share global save state via scene.save; each test resets the bits
//     it cares about at the top (`scene.save.picked = []`, etc.).

window.__tests = [];
function test(name, fn) { window.__tests.push({ name, fn }); }

const assert = {
  eq(a, b, msg) {
    if (a !== b) throw new Error(`${msg || 'eq'}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  },
  truthy(v, msg) { if (!v) throw new Error(`${msg || 'truthy'}: got ${JSON.stringify(v)}`); },
  falsy(v, msg) { if (v) throw new Error(`${msg || 'falsy'}: got ${JSON.stringify(v)}`); },
  gt(a, b, msg) { if (!(a > b)) throw new Error(`${msg || 'gt'}: ${a} !> ${b}`); },
  lt(a, b, msg) { if (!(a < b)) throw new Error(`${msg || 'lt'}: ${a} !< ${b}`); },
  approx(a, b, eps, msg) {
    if (Math.abs(a - b) > eps) throw new Error(`${msg || 'approx'}: |${a}-${b}|=${Math.abs(a-b)} > ${eps}`);
  },
};

// === Helpers ──────────────────────────────────────────────────────────
// These wrap awkward scene internals so individual tests read cleanly.

// Teleport the player to absolute world meters. Adjust playerM relative to
// startWorldM since the scene's "origin" is the start location.
function teleport(scene, wx, wy) {
  scene.playerM.x = wx - scene.startWorldM.x;
  scene.playerM.y = wy - scene.startWorldM.y;
  // Re-park the walk target too — movement is target-follow (app.js
  // _followStep), so a stale target would walk the body back off the mark.
  if (scene.syncMoveTarget) scene.syncMoveTarget();
}

// Seat a deterministic mineralrock on the first free grass cell around the
// player, in the player's own tile, and return {o, entry}. Terrain rock
// stopped breaking (edbf0b2), so mining tests drive a real object instead of
// hunting painted rock - worldgen's own rocks cluster where the fixture
// never promised them.
let __rockSeq = 0;
function placeMineralrock(scene, extra) {
  const wx = scene.startWorldM.x + scene.playerM.x;
  const wy = scene.startWorldM.y + scene.playerM.y;
  const tx = Math.floor(wx / scene.tileEdgeM), ty = Math.floor(wy / scene.tileEdgeM);
  const entry = WorldGen.tileCache.get(WorldGen.tileKey(tx, ty));
  if (!entry) return null;
  const N = entry.cellsPerEdge, M = entry.tileEdgeM / N;
  const pcx = Math.floor((wx - tx * entry.tileEdgeM) / M);
  const pcy = Math.floor((wy - ty * entry.tileEdgeM) / M);
  const taken = new Set(entry.objects.map(o =>
    Math.floor((o.x - tx * entry.tileEdgeM) / M) + '_' + Math.floor((o.y - ty * entry.tileEdgeM) / M)));
  // Grass first, then any walkable open ground (a residential lawn carries
  // worldgen's curbside rocks too); never road or building feet.
  const okTerrain = (t) => t === WorldGen.T.GRASS
    || (WorldGen.isWalkable(t) && !WorldGen.isRoadTerrain(t) && !WorldGen.isBuildingTerrain(t));
  for (const pass of [0, 1]) for (let d = 1; d < 48; d++)
    for (const [dx, dy] of [[d,0],[0,d],[-d,0],[0,-d],[d,d],[-d,-d],[d,-d],[-d,d]]) {
      const ix = pcx + dx, iy = pcy + dy;
      if (ix < 1 || iy < 1 || ix >= N - 1 || iy >= N - 1) continue;
      const t = entry.grid[iy * N + ix];
      if ((pass === 0 ? t !== WorldGen.T.GRASS : !okTerrain(t)) || taken.has(ix + '_' + iy)) continue;
      const o = WorldGen.makeObject('mineralrock',
        tx * entry.tileEdgeM + (ix + 0.5) * M, ty * entry.tileEdgeM + (iy + 0.5) * M,
        'test_rock_' + (++__rockSeq), extra || {});
      entry.objects.push(o);
      return { o, entry };
    }
  return null;
}

// Project a world-meter point to screen pixels (the same maths handleWorldTap
// reverses). Returns the (sx, sy) the tap handler expects.
function worldToScreen(scene, wx, wy) {
  // The scene's own projection, so this can't drift from the one the tap
  // handler reverses — it measures from the CAMERA ANCHOR, which is the player
  // except while a peek drag is live (app.js PEEK DRAG).
  const p = scene.worldMetersToScreen(wx, wy);
  return { sx: p.x, sy: p.y };
}

// Tap a world-meter point as if the user clicked there.
function tapWorld(scene, wx, wy) {
  const { sx, sy } = worldToScreen(scene, wx, wy);
  scene.handleWorldTap(sx, sy);
}

// Sum every stack of the given id in inventory.
function invCount(scene, id) {
  return (scene.save.inv || []).reduce((n, s) => n + (s && s.id === id ? (s.count || 1) : 0), 0);
}

// Find the first wildplant matching a predicate across the tile cache.
function findWildplant(pred) {
  for (const entry of WorldGen.tileCache.values()) {
    if (!entry.wildplants) continue;
    for (const wp of entry.wildplants) if (pred(wp)) return wp;
  }
  return null;
}

// Find the first object (chest/house/etc) matching a predicate.
function findObject(pred) {
  for (const entry of WorldGen.tileCache.values()) {
    if (!entry.objects) continue;
    for (const o of entry.objects) if (pred(o)) return o;
  }
  return null;
}

// Return the terrain type id at a world-meter coordinate.
function terrainAt(scene, wx, wy) {
  return scene.cellAt(wx, wy).type;
}

// === Runner ───────────────────────────────────────────────────────────
async function runTests(scene) {
  const list = document.getElementById('cases');
  let passed = 0, failed = 0;
  for (const t of window.__tests) {
    const row = document.createElement('div');
    row.className = 'case';
    row.textContent = `… ${t.name}`;
    list.appendChild(row);
    // Test isolation: clear any work wheel a prior test left running. Several
    // actions (till / mine / fish / catch) are async work wheels now, and the
    // work-progress tap handler swallows the NEXT tap while a wheel is live —
    // so a leaked wheel would silently eat the following test's first tap.
    // Tests drive taps synchronously without waiting out durMs, so we reset
    // here rather than relying on every test to clean up after itself.
    if (scene._workProgress) scene.cancelWorkProgress();
    try {
      await t.fn(scene);
      row.className = 'case pass';
      row.textContent = `✓ ${t.name}`;
      passed++;
    } catch (e) {
      row.className = 'case fail';
      row.textContent = `✗ ${t.name}`;
      const err = document.createElement('div');
      err.className = 'err';
      err.textContent = (e && e.stack) || String(e);
      row.appendChild(err);
      console.error(`FAIL: ${t.name}`, e);
      failed++;
    }
  }
  const sum = document.getElementById('summary');
  sum.className = 'summary ' + (failed === 0 ? 'ok' : 'fail');
  sum.textContent = `${passed} passed, ${failed} failed (${window.__tests.length} total)`;
}
