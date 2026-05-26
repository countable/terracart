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
  scene._ease = null;
}

// Project a world-meter point to screen pixels (the same maths handleWorldTap
// reverses). Returns the (sx, sy) the tap handler expects.
function worldToScreen(scene, wx, wy) {
  const pWorldX = scene.startWorldM.x + scene.playerM.x;
  const pWorldY = scene.startWorldM.y + scene.playerM.y;
  const dx = wx - pWorldX, dy = wy - pWorldY;
  const sx = scene.viewCenterX + (dx / scene.cellM) * 32;   // CELL_PX = 32
  const sy = scene.viewCenterY + (dy / scene.cellM) * 32;
  return { sx, sy };
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
  // Expose result for any outer scraper.
  window.__testResults = { passed, failed, total: window.__tests.length };
}
