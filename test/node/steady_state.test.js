// ── Steady state: what a step costs while nothing is changing ─────────────
//
// A GPS walker spends most of a session standing still or strolling, with
// every tile loaded. Each rule below keeps one answer (which only moves on a
// crossing, a claim or the clock) derived once and re-read, and pins it
// against regressing into a per-step walk. (The lightmap's own gate is still_frames.test.js.)

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
  WorldGen.forEachItemNear = (what, tx, ty, fn) => {
    if (what !== 'creatures') return;
    for (const c of s.creatures) { s._nearVisits = (s._nearVisits || 0) + 1; fn(c, 0, 0); }
  };
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

test('steady state: still feet reuse one active creature bubble between far-seat rechecks', () => {
  const near = { kind: 'slime', id: 'near', x: 2 * CELL, y: 0 };
  const far = { kind: 'slime', id: 'far', x: (CREATURE_SIM_CELLS + 5) * CELL, y: 0 };
  const s = scene([near, far]);
  const T0 = 1e6;
  for (let i = 0; i < 10; i++) tick(s, T0 + i * 50);
  // Other once-only setup (the night pump) may share the same neighbourhood
  // walker on the first tick. The old per-tick bubble scan alone would visit
  // these two seats 20 times here; the memo keeps the whole startup total low.
  assert.lte(s._nearVisits, 6, 'the ring is not walked once per still tick');
  assert.eq(s._activeCreatures.length, 1, 'only the near seat feeds movement, combat and render');
  const beforeClock = s._nearVisits;
  tick(s, T0 + SURFACE_RECHECK_MS);
  assert.gt(s._nearVisits, beforeClock, 'the slow far-seat clock refreshes the ring');
});

test('steady state: movement, combat and render share the active creature bubble', () => {
  const wander = String(__wander);
  assert.truthy(/for \(const c of activeCreatures\) \{\s*tickCreature\(c\);/.test(wander),
    'movement walks the bubble, not the whole ring');
  const combat = SCENE_SRC.slice(SCENE_SRC.indexOf('  _combatTick(dt) {'), SCENE_SRC.indexOf('  _turretFire('));
  assert.truthy(/for \(const c of this\._activeCreatures\) considerCreature\(c\);/.test(combat),
    'combat reuses the same bubble');

  const body = RENDER_SRC.slice(RENDER_SRC.indexOf('Render.drawObjects = function drawObjects(scene)'));
  const loop = body.slice(body.indexOf('const consideredCreatures = frameCreatures || fallbackCreatures;'), body.indexOf('creatureList.push({ c, dx, dy });'));
  assert.truthy(loop.includes('frameCreatures || fallbackCreatures'), 'the live sim bubble feeds the draw pass');
  // The cull is coords.js cullToView: only a creature inside the view box is
  // handed to the callback that asks.
  const cull = loop.indexOf('cullToView(consideredCreatures, pWorldX, pWorldY, halfM, (c, dx, dy) => {');
  const ask = loop.indexOf('EnemySpawns.surfaceActive(scene, c)');
  assert.truthy(cull > 0 && ask > cull, 'render culls before the surface gate');
});

// ── Turrets are derived per tile, not walked out of every object ──────────
function towerHelper() {
  const src = SCENE_SRC;
  const start = src.indexOf('  _forEachTowerNear(pc, fn) {');
  assert.truthy(start > 0, 'the helper exists');
  // The one-line wrapper and the shared derived-near scan it rides.
  const one = src.slice(start, src.indexOf('\n', start)).trim();
  const d = src.indexOf('  _forEachDerivedNear(pc, kind, fn) {');
  const text = one + ',\n' + src.slice(d, src.indexOf('\n  }\n', d) + 4).trim();
  // Class methods, lifted as object-literal methods (the __wander trick).
  const o = (new Function(`return ({ ${text} });`))();
  return o._forEachTowerNear.bind(o);
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
  const src = SCENE_SRC;
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

// ── The lightmap's static layer is baked while it holds ───────────────────
test('steady state: ground atlas frames swap only when the key or requested frame changes', () => {
  const source = RENDER_SRC.match(/function setTextureIfDifferent\([\s\S]*?\n\}/)[0];
  const swap = new Function(source + '; return setTextureIfDifferent;')();
  let writes = 0;
  const sprite = { texture: { key: 'ruin' }, frame: { name: 2 },
    setTexture(key, frame) { writes++; this.texture.key = key; this.frame.name = frame; } };
  assert.eq(swap(sprite, 'ruin', 2), false);
  assert.eq(swap(sprite, 'ruin'), false, 'key-only callers preserve their existing frame behavior');
  assert.eq(writes, 0);
  assert.eq(swap(sprite, 'ruin', 3), true);
  assert.eq(swap(sprite, 'ruin', 3), false);
  assert.eq(swap(sprite, 'ruin-unclaimed', 3), true);
  assert.eq(writes, 2, 'one change for the frame, one for the condition');
});

// A recording 2D context: every call is logged against the canvas it was
// made on, and createRadialGradient hands back a stop-taker.
function fakeCanvasWorld() {
  const log = [];
  const makeCtx = (name) => new Proxy({}, {
    get(t, prop) {
      if (prop in t) return t[prop];
      if (prop === 'createRadialGradient' || prop === 'createLinearGradient') return () => ({ addColorStop() {} });
      return (...args) => { log.push({ canvas: name, op: prop, args }); };
    },
    set(t, prop, v) { t[prop] = v; return true; },
  });
  let n = 0;
  const createElement = () => {
    const c = { width: 0, height: 0, name: `c${++n}` };
    const ctx = makeCtx(c.name);
    c.getContext = () => ctx;
    return c;
  };
  return { log, makeCtx, createElement };
}

test('steady state: a still, breathing view bakes the lightmap\'s static layer once and copies it after', () => {
  const W = 352;
  const fk = fakeCanvasWorld();
  const realCreate = document.createElement, realNow = Date.now;
  document.createElement = fk.createElement;
  const tex = { width: W, height: W, context: fk.makeCtx('tex'), refresh() {} };
  const scene = {
    depth: 0, cellM: 7, cellsPerTile: WorldGen.TILE_PX,
    startWorldM: { x: 0, y: 0 }, playerM: { x: 3.5, y: 3.5 }, originPx: { x: 0, y: 0 }, mPerPx: 7,
    save: { energy: 100, maxEnergy: 100, fires: [] },
    _atmos: { dim: 0x1a2a1e },
    isClaimedKey: () => false,
    viewCenterX: W / 2, viewCenterY: W / 2, viewLeft: 0, viewTop: 0,
    lightTex: tex,
  };
  const P = Lighting.PULSE_TICK_MS;
  let t = 1e12;
  const paint = () => {
    scene._lights = [{ kind: 'poi', dx: 7, dy: 7, id: 'c_1_1' }];   // drawObjects' offer
    fk.log.length = 0;
    Date.now = () => t;
    const painted = Lighting.draw(scene, 0, 0, 50);
    Date.now = realNow;
    const on = (canvas, op) => fk.log.filter((e) => e.canvas === canvas && e.op === op).length;
    const blits = fk.log.filter((e) => e.canvas === 'tex' && e.op === 'drawImage' && e.args[0] && e.args[0] === (scene._lightStatic || {}).canvas).length;
    const bakedOn = scene._lightStatic ? scene._lightStatic.canvas.name : null;
    return { painted, texFloor: on('tex', 'fillRect'), bakes: bakedOn ? on(bakedOn, 'fillRect') : 0, blits };
  };
  try {
    const a = paint();
    assert.truthy(a.painted, 'the first step paints');
    assert.eq(a.texFloor, 1, 'straight onto the lightmap');
    assert.eq(a.bakes, 0, 'nothing baked on a first sight of the static inputs');
    t += P;                                              // the breath ticks; nothing else moves
    const b = paint();
    assert.truthy(b.painted, 'the breath repaints');
    assert.eq(b.bakes, 1, 'the static inputs held: the layer is baked once');
    assert.eq(b.texFloor, 0, 'and copied, not repainted, onto the lightmap');
    assert.eq(b.blits, 1);
    t += P;
    const c = paint();
    assert.truthy(c.painted);
    assert.eq(c.bakes + c.texFloor, 0, 'while they hold, no floor, ramp or plateau is painted at all');
    assert.eq(c.blits, 1, 'one copy of the baked layer');
    // Walk a little: the static inputs move and the paint goes direct again.
    scene.playerM = { x: 5, y: 3.5 };
    t += P;
    const d = paint();
    assert.eq(d.texFloor, 1, 'a moved view paints its static layer directly');
    assert.eq(d.blits, 0, 'the stale bake is not used');
  } finally {
    document.createElement = realCreate;
    Date.now = realNow;
  }
  // frameKey is built on the static key, so the two cannot drift apart.
  const d = LIGHTING_SRC.slice(LIGHTING_SRC.indexOf('  function frameKey('));
  assert.truthy(/let k = staticFrameKey\(ps, ox, oy, prof, r0, rMax, reachM, rp, pc, pcPx\);/.test(d), 'frameKey starts from staticFrameKey');
});

// ── The footprint trail repaints only when a print moves ──────────────────
test('steady state: the footprint trail is rebuilt only when a drawn print moves or fades', () => {
  const a = SCENE_SRC;
  const blk = a.slice(a.indexOf('const prints = [];'), a.indexOf('// Pairy chest-compass indicator.'));
  assert.truthy(/printKey \+= `\$\{sx2\},\$\{sy2\},\$\{fp\.alpha\},\$\{fp\.ux\},\$\{fp\.uy\},\$\{fp\.side\};`;/.test(blk),
    'the key names every input of a print: its drawn point, ink, step and foot');
  const gate = blk.indexOf('if (printKey !== this._footprintKey) {');
  const clear = blk.indexOf('this.footprintGfx.clear();');
  assert.truthy(gate > 0 && clear > gate, 'the clear and redraw sit behind the key');
  assert.eq((a.match(/footprintGfx\.clear\(\)/g) || []).length, 1, 'and nothing else clears (or draws on) the trail');
});

// ── drawObjects: three boxes offer exactly the lights one wide box did ────
test('steady state: the split sprite / light walks offer every pre-cull light once, and nothing a single wide walk would not', () => {
  WorldGen.tileCache.clear();
  const cellM = 7;
  const halfM = (VIEW_CELLS / 2 + 1) * cellM;
  const rng = WorldGen.makeRng(3, 5, 0);
  const objects = [];
  const kinds = ['torch', 'house', 'tower', 'tree', 'tree', 'rock'];
  for (let i = 0; i < 1500; i++) {
    const kind = kinds[i % kinds.length];
    objects.push({ kind, id: `${kind}_${i}`, castle: kind === 'tower' ? 'k' : undefined,
      x: (rng() - 0.5) * 500, y: (rng() - 0.5) * 500 });
  }
  WorldGen.tileCache.set(`${WorldGen.Z}/0/0`, { objects });
  const scene = {
    startWorldM: { x: 0, y: 0 }, playerM: { x: 0, y: 0 },
    cellM, depth: 0,
    save: { picked: [], caught: [], planted: [], starterShopId: 'house_1' },
    viewCenterX: 176, viewCenterY: 176,
    placedRockSet: null, brokenRockSet: new Set(),
    isClaimedKey: () => true,                      // every house and castle restored: all lit
    playerToWorldCell() { return { tx: 0, ty: 0, cx: 0, cy: 0 }; },
  };
  const counts = [];
  window.__boot = { tick() {}, count(name, n) { counts.push({ name, n }); } };
  try {
    try { Render.drawObjects(scene); } catch (_) { /* expected — no Phaser stub past the walks */ }
    const got = (scene._lights || []).map((L) => L.id);
    assert.eq(new Set(got).size, got.length, 'no light offered twice');
    // The single-wide-walk truth: every object whose light reaches the view.
    const want = objects.filter((o) => {
      const kind = Lighting.sourceKind(scene, o);
      if (!kind) return false;
      const pad = Lighting.radiusCells(kind) * cellM;
      return Math.abs(o.x) <= halfM + pad && Math.abs(o.y) <= halfM + pad;
    }).map((o) => o.id);
    assert.gt(want.length, 20, 'the fixture lights a good few');
    assert.eq(got.slice().sort().join(','), want.slice().sort().join(','), 'the same lights, whichever walk offered them');
    // And the walk is smaller than one wide box over every object would be.
    const scanned = counts.filter((c) => c.name === 'drawObjects scanned').pop().n;
    const lM = halfM + Lighting.objectLightPadCells() * cellM, C = WorldGen.CHUNK_M;
    const chunkIn = (v) => Math.floor(v / C) >= Math.floor(-lM / C) && Math.floor(v / C) <= Math.floor(lM / C);
    const wide = objects.filter((o) => chunkIn(o.x) && chunkIn(o.y)).length;
    assert.lt(scanned, wide, `walked ${scanned}, where one wide box would open ${wide}`);
  } finally {
    window.__boot = undefined;
    WorldGen.tileCache.clear();
  }
});

})();
