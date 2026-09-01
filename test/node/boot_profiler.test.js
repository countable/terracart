// Headless tests for the older-device performance-profiling hooks added to
// answer: how much of a frame is Phaser's own render step vs our JS, which
// layer rebuild is expensive on a cell-crossing frame, how much drawObjects
// walks per frame, and what device is slow (see window.__boot in index.html,
// and its report handler `debug-load-profile`).
//
// Two halves:
//   1. render.js, road_overlay.js and building_overlay.js all load headlessly
//      (see run.js), so their ticks/counters are exercised for REAL against a
//      recording `window.__boot` stub.
//   2. app.js can't load headlessly (it needs Phaser) — its hooks (the
//      update()/drawCells/drawObjects ticks, the 'phaser render' game-event
//      wiring, the window.__boot.device line) are pinned as source text
//      (APP_JS_SRC, exposed by run.js) instead, same trick spawn_roads.test.js
//      uses for ROAD_OVERLAY_SRC. Likewise the border-crossing stamp and the
//      fog-paint tick sit deep inside Render.drawCells, which needs a full
//      Graphics-shaped scene fixture nothing else in this suite builds — text
//      pins on RENDER_SRC cover those two instead of a large new fixture.
//
// Every test that sets window.__boot restores it to undefined afterward
// (try/finally) — window IS the shared vm global every other *.test.js file
// in this run also sees, so a stub left behind would leak into them.

(function () {

if (typeof CELL_PX === 'undefined') globalThis.CELL_PX = 32;

// A minimal recording profiler: same call shape as the real window.__boot
// (tick(name, ms), count(name, n)), but just records calls for assertions
// instead of aggregating them — the real aggregation (n/sum/worst) is
// index.html's job, not src's.
function makeBootStub() {
  const ticks = [], counts = [];
  return {
    ticks, counts,
    tick(name, ms) { ticks.push({ name, ms }); },
    count(name, n) { counts.push({ name, n }); },
    lastTick(name) { return ticks.filter(t => t.name === name).pop(); },
    lastCount(name) { return counts.filter(c => c.name === name).pop(); },
  };
}

// ── RoadOverlay / BuildingOverlay rebuild ticks ─────────────────────────────
// Same fixture geometry road_overlay.test.js / building_overlay.test.js use:
// mPerPx = 10 → tileEdgeM = 2560, cellsPerTile = 512 → one cell is 5 m.
const TILE_EDGE_M = 2560;
function makeGfxStub() {
  return {
    ops: [],
    clear() { this.ops.length = 0; },
    lineStyle() {}, beginPath() {}, moveTo() {}, lineTo() {}, strokePath() {},
    fillPoly() {}, strokePoly() {}, insetStroke() {}, texturePoly() {}, gridPoly() {},
    eraseRect() {}, decorPath() {}, texturePhase() {}, commit() {},
  };
}
function makeContainerStub() {
  return { visible: true, x: 0, y: 0, setVisible(v) { this.visible = v; return this; }, setPosition(x, y) { this.x = x; this.y = y; return this; } };
}
function makeOverlayScene(over) {
  const base = {
    startWorldM: { x: 0, y: 0 }, playerM: { x: 0, y: 0 },
    mPerPx: 10, originPx: { x: 0, y: 0 },
    cellM: 5, cellsPerTile: 512, depth: 0, save: {},
    viewCenterX: 176, viewCenterY: 176, viewLeft: 0, viewTop: 0, viewSize: 352,
    roadGeomGfx: makeGfxStub(), roadGeomContainer: makeContainerStub(),
    buildingGeomGfx: makeGfxStub(), buildingGeomContainer: makeContainerStub(),
    isClaimedKey: () => true,
    playerToWorldCell() {
      const tilePx = WorldGen.TILE_PX;
      const wx = this.originPx.x + this.playerM.x / this.mPerPx;
      const wy = this.originPx.y + this.playerM.y / this.mPerPx;
      const tx = Math.floor(wx / tilePx), ty = Math.floor(wy / tilePx);
      const cellPxSize = tilePx / this.cellsPerTile;
      return { tx, ty, cx: (wx - tx * tilePx) / cellPxSize, cy: (wy - ty * tilePx) / cellPxSize };
    },
  };
  return Object.assign(base, over);
}
const line = (pts, tags) => ({ type: 2, tags: tags || {}, geom: [pts] });
function putRoadTile(tx, ty, features) {
  WorldGen.tileCache.set(`${WorldGen.Z}/${tx}/${ty}`, {
    tileEdgeM: TILE_EDGE_M,
    layers: [{ name: 'transportation', extent: 4096, features }],
  });
}
function putBuildingTile(tx, ty, shapes) {
  WorldGen.tileCache.set(`${WorldGen.Z}/${tx}/${ty}`, { tileEdgeM: TILE_EDGE_M, buildingShapes: shapes });
}

test('boot profiler: road overlay rebuild ticks when window.__boot is present', () => {
  WorldGen.tileCache.clear();
  putRoadTile(0, 0, [line([{ x: 0, y: 0 }, { x: 16, y: 0 }])]);
  const scene = makeOverlayScene();
  const boot = makeBootStub();
  window.__boot = boot;
  try {
    RoadOverlay.draw(scene);
    const t = boot.lastTick('road overlay rebuild');
    assert.truthy(t, 'road overlay rebuild ticked');
    assert.gte(t.ms, 0, 'tick reported a non-negative duration');
  } finally {
    window.__boot = undefined;
    WorldGen.tileCache.clear();
  }
});

test('boot profiler: road overlay draw does not throw with window.__boot absent', () => {
  WorldGen.tileCache.clear();
  putRoadTile(0, 0, [line([{ x: 0, y: 0 }, { x: 16, y: 0 }])]);
  const scene = makeOverlayScene();
  window.__boot = undefined;
  RoadOverlay.draw(scene);   // throws on failure — no return value to assert
  WorldGen.tileCache.clear();
});

test('boot profiler: building overlay rebuild ticks when window.__boot is present', () => {
  WorldGen.tileCache.clear();
  putBuildingTile(0, 0, [{ tier: 9, ownerKey: 'b1', ring: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] }]);
  const scene = makeOverlayScene();
  const boot = makeBootStub();
  window.__boot = boot;
  try {
    BuildingOverlay.draw(scene);
    const t = boot.lastTick('building overlay rebuild');
    assert.truthy(t, 'building overlay rebuild ticked');
    assert.gte(t.ms, 0, 'tick reported a non-negative duration');
  } finally {
    window.__boot = undefined;
    WorldGen.tileCache.clear();
  }
});

test('boot profiler: building overlay draw does not throw with window.__boot absent', () => {
  WorldGen.tileCache.clear();
  putBuildingTile(0, 0, [{ tier: 9, ownerKey: 'b1', ring: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] }]);
  const scene = makeOverlayScene();
  window.__boot = undefined;
  BuildingOverlay.draw(scene);
  WorldGen.tileCache.clear();
});

// ── Render.drawObjects: entries scanned / kept ──────────────────────────────
// Render.drawObjects draws real sprites via Phaser (scene.add, textures,
// pools) well past the counting loop this test targets, so the fixture below
// is deliberately NOT a full Phaser stub — it only has to survive the loop
// that counts. Whatever Render.drawObjects does past that point is expected
// to throw against this minimal fixture; the counts are read back before
// that, and a throw afterward can't un-record them.
function setOfLocal(a) { return new Set(a || []); }
test('boot profiler: drawObjects counts entries scanned and kept', () => {
  WorldGen.tileCache.clear();
  const halfM = (VIEW_CELLS / 2 + 1) * 7;   // cellM=7 below — matches app.js's real cell
  const farAway = halfM * 100;
  WorldGen.tileCache.set(`${WorldGen.Z}/0/0`, {
    objects: [
      { kind: 'tree', x: 5, y: 0, id: 'o1' },            // in range -> kept
      { kind: 'tree', x: farAway, y: 0, id: 'o2' },       // out of range -> scanned only
      { kind: 'chest', x: 3, y: 3, id: 'c1' },            // in range -> kept
      { kind: 'chest', x: 3.2, y: 3.2, id: 'c2' },        // same cellKey as c1 -> dup, scanned only
    ],
    creatures: [
      { id: 'cr1', x: 2, y: 2 },   // not caught, in range -> kept
      { id: 'cr2', x: 2, y: 2 },   // caught -> scanned only
    ],
    wildplants: [
      { id: 'wp1', x: 1, y: 1, crop: 'wheat' },   // not picked, in range -> kept
      { id: 'wp2', x: 1, y: 1, crop: 'wheat' },   // picked -> scanned only
    ],
  });
  const scene = {
    startWorldM: { x: 0, y: 0 }, playerM: { x: 0, y: 0 },
    cellM: 7, depth: 0,
    save: { picked: ['wp2'], caught: ['cr2'], planted: [] },
    viewCenterX: 176, viewCenterY: 176,
    placedRockSet: null, brokenRockSet: new Set(),
    playerToWorldCell() { return { tx: 0, ty: 0, cx: 0, cy: 0 }; },
  };
  const boot = makeBootStub();
  window.__boot = boot;
  try {
    try { Render.drawObjects(scene); } catch (_) { /* expected — no Phaser stub past the loop */ }
    const scanned = boot.lastCount('drawObjects scanned');
    const kept = boot.lastCount('drawObjects kept');
    assert.truthy(scanned, 'scanned count recorded');
    assert.truthy(kept, 'kept count recorded');
    assert.eq(scanned.n, 8, 'scanned = every object + creature + wildplant iterated');
    assert.eq(kept.n, 4, 'kept = the 4 that survived culling/dedup/caught/picked');
  } finally {
    window.__boot = undefined;
    WorldGen.tileCache.clear();
  }
});

// ── Source pins: app.js hooks that can't load headlessly ───────────────────
test('boot profiler (pin): update() ticks the whole frame and a crossing-frame label', () => {
  assert.truthy(/_uB\.tick\('update \(all\)', _dt\)/.test(APP_JS_SRC), 'update (all) ticked');
  assert.truthy(/_uB\.tick\('update @crossing', _dt\)/.test(APP_JS_SRC), 'update @crossing ticked');
  assert.truthy(/this\._boot_crossing/.test(APP_JS_SRC), 'update() reads the crossing flag drawCells stamps');
});

test('boot profiler (pin): drawCells forwarder ticks a crossing-frame label too', () => {
  assert.truthy(/B\.tick\('drawCells @crossing', dt\)/.test(APP_JS_SRC), 'drawCells @crossing ticked');
});

test('boot profiler (pin): create() wires the game-level prerender/postrender events', () => {
  assert.truthy(/this\.game\.events\.on\('prerender'/.test(APP_JS_SRC), 'prerender listener registered');
  assert.truthy(/this\.game\.events\.on\('postrender'/.test(APP_JS_SRC), 'postrender listener registered');
  assert.truthy(/__boot\?\.tick\('phaser render'/.test(APP_JS_SRC), 'phaser render tick fired from postrender');
});

test('boot profiler (pin): create() populates window.__boot.device', () => {
  assert.truthy(/window\.__boot\.device = device/.test(APP_JS_SRC), 'device object assigned onto window.__boot');
  assert.truthy(/deviceMemory/.test(APP_JS_SRC), 'navigator.deviceMemory read');
  assert.truthy(/WEBGL_debug_renderer_info/.test(APP_JS_SRC), 'unmasked GPU strings read (guarded)');
});

test('boot profiler (pin): render.js stamps the crossing flag and ticks the fog repaint', () => {
  assert.truthy(/scene\._boot_crossing = borderDirty/.test(RENDER_SRC), 'border-crossing flag stamped from borderDirty');
  assert.truthy(/_fogB\.tick\('fog paint'/.test(RENDER_SRC), 'fog repaint ticked');
});

})();
