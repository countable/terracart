// ── Steady state: what a step costs while nothing is changing ─────────────
//
// A GPS walker spends most of a session standing still or strolling, with
// every tile loaded. The Sep 2026 phone profile read a still step costing as
// much as a moving one — per-step work whose answer only moves on a crossing,
// a claim or the clock. Each rule below keeps one such answer derived once
// and re-read, and each is pinned where it could quietly regress into a
// per-step walk again. (The lightmap's own gate is still_frames.test.js.)

(function () {

// ── Surface foes outside the sim bubble are re-asked on a clock ───────────
// wanderCreatures used to call EnemySpawns.surfaceActive for EVERY surface
// seat in the 3×3 ring before its range cull — hundreds on a town's tiles.
// Inside the bubble it still asks every tick; outside, once per
// SURFACE_RECHECK_MS, and a stale "inactive" stamp still keeps it out.
const CELL = 7;
function scene(creatures) {
  const s = {
    cellM: CELL, depth: 0,
    save: { energy: 1e6, caught: [], armor: {}, planted: [], fires: [], released: [] },
    startWorldM: { x: 0, y: 0 }, playerM: { x: 0, y: 0 },
    originPx: { x: 0, y: 0 }, mPerPx: CELL, cellsPerTile: WorldGen.TILE_PX,
    viewCenterX: 0, viewCenterY: 0, _shots: [],
    isShadowActive: () => false,
    isUnnoticed() { return false; },
    homeWorldPos: () => null,
    _castleWardPoints: () => [],
    playerToWorldCell: () => ({ tx: 0, ty: 0, ix: 0, iy: 0 }),
    cellAt: () => ({ loaded: true, type: 0 }),
    _cellBlocked: () => false, _nearAny: () => false, placedRockSet: null,
    resolveDefeat: () => {},
    _popEnergy: () => {}, _warnIfTiring: () => {}, _flashPlayerHit: () => {}, _closeShopOnHit: () => {},
    _losePlayerEnergy: () => 0,
    updateEnergyDOM: () => {}, flash: () => {}, _wildCrowTick: () => {},
  };
  s.creatures = creatures;
  return s;
}
function tick(s, atMs) {
  const realNear = WorldGen.forEachItemNear, realNow = performance.now;
  WorldGen.forEachItemNear = (what, tx, ty, fn) => { if (what === 'creatures') for (const c of s.creatures) fn(c, 0, 0); };
  try { performance.now = () => atMs; __wander.call(s); }
  finally { WorldGen.forEachItemNear = realNear; performance.now = realNow; }
}

test('steady state: a surface foe outside the sim bubble is re-asked once a SURFACE_RECHECK_MS, one inside every tick', () => {
  const at = { x: 0, y: 0, tx: 0, ty: 0, cx: 0, cy: 0 };
  const farM = (CREATURE_SIM_CELLS + 5) * CELL;
  const near = { kind: 'slime', id: 'near', x: 2 * CELL, y: 0, _surfaceSpawn: at };
  const far = { kind: 'slime', id: 'far', x: farM, y: 0, _surfaceSpawn: at };
  const asked = { near: 0, far: 0 };
  const real = EnemySpawns.surfaceActive;
  let answer = true;
  EnemySpawns.surfaceActive = (sc, c) => { asked[c.id]++; c._surfaceInactive = !answer; return answer; };
  try {
    const s = scene([near, far]);
    const T0 = 1e6, STEP = 50;
    const ticks = Math.round(SURFACE_RECHECK_MS / STEP) * 3;   // three recheck periods
    for (let i = 0; i < ticks; i++) tick(s, T0 + i * STEP);
    assert.eq(asked.near, ticks, 'inside the bubble: asked every tick');
    assert.inRange(asked.far, 3, 4, 'outside it: once per recheck period, not per tick');
    // The stale answer is still obeyed: go inactive, and the far foe is
    // skipped between asks exactly as it would have been.
    answer = false;
    tick(s, T0 + ticks * STEP + SURFACE_RECHECK_MS);
    assert.truthy(far._surfaceInactive, 'the recheck stamps the new answer');
    const before = asked.far;
    tick(s, T0 + ticks * STEP + SURFACE_RECHECK_MS + STEP);
    assert.eq(asked.far, before, 'not re-asked inside the period');
    assert.truthy(far._surfaceInactive, 'and still out');
  } finally {
    EnemySpawns.surfaceActive = real;
  }
  assert.gte(SURFACE_RECHECK_MS, 250, 'a real saving over the ~30 Hz step');
  assert.lte(SURFACE_RECHECK_MS, 2000, 'and never stale for longer than a couple of seconds');
});

test('steady state: drawObjects culls a creature to the viewport before asking whether it is here', () => {
  const body = RENDER_SRC.slice(RENDER_SRC.indexOf('Render.drawObjects = function drawObjects(scene)'));
  const loop = body.slice(body.indexOf('for (const c of entry.creatures) {'), body.indexOf('creatureList.push({ c, dx, dy });'));
  const cull = loop.indexOf('if (Math.abs(dx) > halfM || Math.abs(dy) > halfM) continue;');
  const ask = loop.indexOf('EnemySpawns.surfaceActive(scene, c)');
  assert.truthy(cull > 0 && ask > cull, 'the cull comes first');
});

// ── Turrets are derived per tile, not walked out of every object ──────────
function towerHelper() {
  const src = APP_JS_SRC;
  const start = src.indexOf('  _forEachTowerNear(pc, fn) {');
  assert.truthy(start > 0, 'the helper exists');
  const end = src.indexOf('\n  }\n', start);
  const text = src.slice(start, end + 4).trim();
  // A class method, lifted as an object-literal method (the __wander trick).
  return (new Function(`return ({ ${text} });`))()._forEachTowerNear;
}

test('steady state: the turret scans read a per-tile tower list that re-derives on every mutation', () => {
  const each = towerHelper();
  WorldGen.tileCache.clear();
  const objects = [
    { kind: 'tree', id: 't', x: 0, y: 0 },
    { kind: 'tower', id: 'a', castle: 'k', x: 1, y: 0 },
    { kind: 'house', id: 'h', x: 2, y: 0 },
  ];
  const entry = { objects };
  WorldGen.tileCache.set(WorldGen.tileKey(0, 0), entry);
  const ids = () => { const out = []; each({ tx: 0, ty: 0 }, (o) => out.push(o.id)); return out.join(','); };
  try {
    assert.eq(ids(), 'a', 'only the turrets');
    const d1 = entry._towers;
    assert.eq(ids(), 'a');
    assert.eq(entry._towers, d1, 'derived once while the array stands');
    objects.push({ kind: 'tower', id: 'b', x: 3, y: 0 });
    assert.eq(ids(), 'a,b', 'a push is seen');
    objects.splice(1, 1);
    assert.eq(ids(), 'b', 'a splice is seen');
    entry.objects = objects.filter((o) => o.kind !== 'house');
    assert.eq(ids(), 'b', 'a reassigned array is re-read');
    entry.objects.splice(entry.objects.findIndex((o) => o.id === 'b'), 1);
    entry.objects.push({ kind: 'tower', id: 'c', x: 4, y: 0 });
    assert.eq(ids(), 'c', 'a same-length swap is seen through the tail');
    // A neighbour tile in the ring counts; one past it does not.
    WorldGen.tileCache.set(WorldGen.tileKey(1, 1), { objects: [{ kind: 'tower', id: 'n', x: 0, y: 0 }] });
    WorldGen.tileCache.set(WorldGen.tileKey(2, 0), { objects: [{ kind: 'tower', id: 'x', x: 0, y: 0 }] });
    assert.eq(ids(), 'c,n', 'the 3×3 ring, nothing past it');
  } finally {
    WorldGen.tileCache.clear();
  }
  const src = APP_JS_SRC;
  const ward = src.slice(src.indexOf('  _castleWardPoints(now, pc) {'), src.indexOf('  _forEachTowerNear(pc, fn) {'));
  const fire = src.slice(src.indexOf('  _turretFire(now, px, py, halfSpanM, enemies, pc) {'), src.indexOf('  _drawShots() {'));
  for (const [name, body] of [['_castleWardPoints', ward], ['_turretFire', fire]]) {
    assert.truthy(/this\._forEachTowerNear\(pc, /.test(body), `${name} reads the tower list`);
    assert.falsy(/forEachItemNear\('objects'/.test(body), `${name} no longer walks every object of the ring`);
  }
});

// ── Ground sprites swap only when their key changes ───────────────────────
test('steady state: drawCells swaps a ground sprite\'s texture only when its key moves', () => {
  const body = RENDER_SRC.slice(RENDER_SRC.indexOf('Render.drawCells = function'));
  assert.truthy(/if \(setTextureIfDifferent\(ns, texKey\)\) ns\.setDisplaySize\(CELL_PX, CELL_PX\);/.test(body),
    'the ground sprite: swapped and resized together, only on a change');
  assert.falsy(/\bns\.setTexture\(/.test(body), 'no unconditional swap of the ground sprite');
  assert.truthy(/if \(cs\.texture\.key !== 'pier' \|\| cs\.frame\.name !== PIER_FRAME\) \{/.test(body),
    'the pier plank likewise');
});

})();
