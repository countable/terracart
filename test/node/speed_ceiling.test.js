// THE SPEED CEILING (creature_ai.js WILD_SPEED_CEILING_MPS — owner, Sep 2026):
// nothing wild ever moves faster than 10 m/s, shiny included, BY ITS BASE
// NUMBERS — no cap on top. This measures every lane a wild thing moves by:
//   · the tables: every gait / bolt row (faunaTopMps × SHINY_SPEED_MUL) and
//     every roster speed (foeChaseMps, the row's declared m/s);
//   · the crow's own tick, RUN (WILD_CROW_TICK_SRC) through roam and panic
//     dash, its per-tick speed sampled — a quadratic leg peaks at twice its
//     mean, so the glide formula is 2 × distance / CROW_FLIGHT_MPS. Its
//     RETREAT hop is THE ONE DECLARED EXCEPTION (creature_ai.js
//     CROW_DEPART_HOP has the reasoning: the hunt's odds cannot survive a
//     10 m/s hop), measured here as exactly that and nothing wider;
//   · the generic wander, RUN (__wander) for a bolting deer, a struck deer, a
//     struck bolting deer and a shiny of each — the hurry never stacks on a
//     bolt (no FLEE multipliers over a sprint), so a deer at four times its
//     bolt cannot come back.
(function () {
const CEIL = WILD_SPEED_CEILING_MPS;
const CM = WorldGen.CELL_M;

test('speed ceiling: the ceiling is 10 m/s and a brisk walk is well under it', () => {
  assert.eq(CEIL, 10);
  assert.lt(BRISK_WALK_MPS, CEIL / 2);
});

test('speed ceiling: every behaviour row — gait, bolt and shiny — sits under it', () => {
  for (const kind of Object.keys(SpriteLayout.CREATURE_BEHAVIOUR)) {
    const top = faunaTopMps(kind, CM);
    assert.lte(top * SHINY_SPEED_MUL, CEIL, `${kind}: ${top.toFixed(2)} m/s × shiny ${SHINY_SPEED_MUL}`);
  }
  assert.gt(faunaTopMps('deer', CM), BRISK_WALK_MPS, 'a deer still bolts faster than a brisk walk (fast fauna)');
  assert.gt(faunaTopMps('rabbit', CM), BRISK_WALK_MPS, 'so does a rabbit');
  // The butterfly's stated cap (maxMps) is no longer what paces it.
  const b = SpriteLayout.creatureBehaviour('butterfly');
  const pace = (g) => (g.stepCells ?? 1) * CM / ((g.stepMs ?? WANDER_STEP_MS) / 1000);
  assert.lt(Math.max(pace(b), pace(b.flee)), b.maxMps, 'the butterfly\'s base numbers sit under its own cap');
});

test('speed ceiling: every roster row\'s declared speed and chase pace sit under it', () => {
  for (const row of EnemyRoster.ROWS) {
    const mv = row.movement || {};
    for (const k of Object.keys(mv).filter((k) => /peedMetersPerSecond$/.test(k))) assert.lte(mv[k], CEIL, `${row.id}.${k}`);
    assert.lte(foeChaseMps({ kind: row.id }, CM), CEIL, `${row.id}: chase pace`);
  }
  assert.lte(Combat.GHOST_SPEED_MPS, CEIL);
  assert.lte(CROW_FLIGHT_MPS, CEIL, 'the crow\'s peak flight speed');
});

test('speed ceiling: the crow\'s retreat hop is the ONE declared exception — one hop, the hunt\'s odds', () => {
  const hop = CROW_DEPART_HOP.cells * CM / (CROW_DEPART_HOP.ms / 1000);
  assert.gt(hop * 2, CEIL, `the exception is real: the hop peaks at ${(hop * 2).toFixed(0)} m/s`);
  assert.eq(CROW_DEPART_HOP.ms, 1500, 'the glide crow_hunt_odds.test.js is tuned on — change both or neither');
  assert.truthy(/THE ONE EXCEPTION TO THE SPEED CEILING/.test(CREATURE_AI_SRC), 'declared where the number lives');
});

// ── The crow's tick, run ────────────────────────────────────────────────────
const crowScene = () => ({
  cellM: CM, cellAt: () => ({ loaded: true, type: 0 }), save: { planted: [] }, _nearAny: () => false,
  startWorldM: { x: 0, y: 0 }, originPx: { x: 0, y: 0 }, mPerPx: 1, cellsPerTile: WorldGen.TILE_PX / CM, placedRockSet: null,
});
const crowTick = (self, c, now, px, py) => new Function('c', 'now', 'px', 'py', WILD_CROW_TICK_SRC).call(self, c, now, px, py);
const departBody = (() => {
  const a = SCENE_SRC.indexOf('\n  _crowDepart(c, now = performance.now(), reason = \'sated\') {');
  return SCENE_SRC.slice(SCENE_SRC.indexOf('{', a) + 1, SCENE_SRC.indexOf('\n  }\n', a));
})();
const depart = new Function('c', 'now', 'reason', 'CROW_DEPART_MS', departBody);
function maxSpeed(step, seconds, dt = 50) {
  let peak = 0, moved = 0;
  for (let t = 0; t < seconds * 1000; t += dt) {
    const d = step(t);
    peak = Math.max(peak, d / (dt / 1000)); moved += d;
  }
  return { peak, moved };
}
test('speed ceiling: the crow — roaming, and dashing from a pet — never exceeds it; its retreat hop peaks at the declared burst', () => {
  const self = crowScene();
  const hopPeak = 2 * CROW_DEPART_HOP.cells * CM / (CROW_DEPART_HOP.ms / 1000);
  for (const mode of ['roam', 'flee', 'depart']) {
    let peak = 0, moved = 0;
    for (let trial = 0; trial < 20; trial++) {
      const c = { x: 100, y: 100, kind: 'crow' };
      if (mode === 'flee') { c._fleeAngle = Math.random() * 6.28; c._fleeUntilT = 30000; }
      if (mode === 'depart') depart(c, 0, 'hunted', CROW_DEPART_MS);
      const r = maxSpeed((t) => { const x = c.x, y = c.y; crowTick(self, c, t, 0, 0); return Math.hypot(c.x - x, c.y - y); }, 30);
      peak = Math.max(peak, r.peak); moved += r.moved;
    }
    assert.lte(peak, mode === 'depart' ? hopPeak * 1.02 : CEIL, `${mode}: peaked at ${peak.toFixed(2)} m/s`);
    assert.gt(moved, 20 * CM, `${mode}: the harness bites — the crow did move`);
  }
});

// ── The generic wander, run (a deer) ────────────────────────────────────────
const N = 64, TICK_MS = 100;
const entry = { cellsPerEdge: N, roadClass: new Uint8Array(N * N), grid: new Uint8Array(N * N), creatures: [] };
function mkScene(creature, feet) {
  const scene = {
    cellM: CM, depth: 0, tileEdgeM: N * CM,
    save: { energy: 80, money: 50, inv: [], caught: [], armor: {}, planted: [], fires: [], released: [], reachUpgrades: 0, scarecrows: [] },
    startWorldM: { x: 0, y: 0 }, playerM: { x: feet.x, y: feet.y }, feetOffsetM: 0,
    _starterTrailAnchor: () => ({ x: -1e6, y: 0 }),
    originPx: { x: 0, y: 0 }, mPerPx: CM, cellsPerTile: WorldGen.TILE_PX,
    viewCenterX: 0, viewCenterY: 0, _shots: [],
    isShadowActive: () => false,
    isUnnoticed() { return this.isShadowActive() || Combat.playerDowned(this.save.energy); },
    homeWorldPos: () => null, _castleWardPoints: () => [],
    playerToWorldCell: () => ({ tx: 0, ty: 0, ix: 0, iy: 0 }),
    cellAt: () => ({ loaded: true, type: 0 }),
    _cellBlocked: () => false, _nearAny: () => false, placedRockSet: null,
    _damageEnemy: () => false, resolveDefeat: () => {},
    _popEnergy: () => {}, _warnIfTiring: () => {}, _closeShopOnHit: () => {}, _flashPlayerHit() {},
    _losePlayerEnergy(d) { const b = this.save.energy; this.save.energy = Math.max(0, b - d); return b - this.save.energy; },
    _losePlayerToThief() { return 0; }, _trapperLay() {}, _cropRaidable: () => false,
    updateEnergyDOM: () => {}, flash: () => {}, _wildCrowTick: () => {},
  };
  scene.creatures = [creature];
  return scene;
}
function tick(scene) {
  const realNear = WorldGen.forEachItemNear, realGet = WorldGen.tileCache.get, realNow = performance.now;
  scene._simT = (scene._simT || 1e6) + TICK_MS;
  const t = scene._simT;
  WorldGen.forEachItemNear = (what, tx, ty, fn) => { if (what === 'creatures') for (const c of scene.creatures.slice()) fn(c, 0, 0); };
  WorldGen.tileCache.get = (k) => (k === WorldGen.tileKey(0, 0) ? entry : undefined);
  try { performance.now = () => t; __wander.call(scene); } finally {
    WorldGen.forEachItemNear = realNear; WorldGen.tileCache.get = realGet; performance.now = realNow;
  }
}
// A plain and a shiny deer id, off the shipping roll.
const ids = { plain: null, shiny: null };
for (let i = 0; i < 2000 && !(ids.plain && ids.shiny); i++) {
  const id = `deer_0_0_${i}`;
  if (isShiny(id, SHINY_RATE.animal)) ids.shiny ??= id; else ids.plain ??= id;
}
function runDeer(id, { near, struck }) {
  const deer = { kind: 'deer', id, x: 33.5 * CM, y: 32.5 * CM };
  // Near: one cell off (inside the deer's 5-cell bolt). Far: 7 cells off —
  // past the bolt, inside the 12-cell sim bubble (a deer beyond it does not
  // think at all).
  const feet = near ? { x: 32.5 * CM, y: 32.5 * CM } : { x: 26.5 * CM, y: 32.5 * CM };
  const scene = mkScene(deer, feet);
  let peak = 0, moved = 0;
  for (let ms = 0; ms < 30000; ms += TICK_MS) {
    if (struck && ms % 5000 === 0) { deer._fleeAngle = Math.random() * 6.28; deer._fleeUntilT = 1e6 + 200000; deer._nextChooseT = 0; }   // (tick's clock starts at 1e6)
    const x = deer.x, y = deer.y;
    tick(scene);
    const d = Math.hypot(deer.x - x, deer.y - y);
    peak = Math.max(peak, d / (TICK_MS / 1000)); moved += d;
  }
  return { peak, moved };
}
test('speed ceiling: a bolting, struck, or struck-and-bolting deer — plain or shiny — never exceeds it', () => {
  assert.truthy(ids.plain && ids.shiny, 'found a plain and a shiny id');
  for (const [label, id] of Object.entries(ids)) {
    for (const [mode, opts] of Object.entries({ bolting: { near: true }, struck: { struck: true }, both: { near: true, struck: true } })) {
      const r = runDeer(id, opts);
      assert.lte(r.peak, CEIL, `${label} deer, ${mode}: peaked at ${r.peak.toFixed(2)} m/s`);
      assert.gt(r.peak, BRISK_WALK_MPS, `${label} deer, ${mode}: the harness bites — it ran`);
    }
  }
});

test('speed ceiling: the hurry never stacks on a sprint (source pins)', () => {
  const w = SCENE_SRC.slice(SCENE_SRC.indexOf('  wanderCreatures() {'));
  assert.truthy(/const hurry = routed && !sprinting;/.test(w), 'the rout quickens what was not already running');
  assert.truthy(/\* shinyFast \* \(hurry \? FLEE_BEAT_MUL : 1\);/.test(w) && /\* \(hurry \? FLEE_STRIDE_MUL : 1\);/.test(w), 'both multipliers read it');
  assert.truthy(/const hurryM = bolt \? STEP_M \* \(bolt\.stepCells \?\? 1\) : base\.m \* FLEE_STRIDE_MUL;/.test(w), 'a struck kind with a bolt runs its bolt');
  assert.truthy(/const hurryMs = bolt \? \(bolt\.stepMs \?\? STEP_MS\) \* shinyFast : base\.ms \* FLEE_BEAT_MUL;/.test(w), 'over its own beat');
  assert.truthy(/c\._hopMs = Math\.max\(hurryMs, hurryM \/ maxMps \* 1000\);/.test(w), 'and glides the shove over that beat');
  assert.truthy(/\(2 \* d \/ CROW_FLIGHT_MPS\) \* 1000/.test(WILD_CROW_TICK_SRC), 'the crow\'s dash is twice its distance over the peak');
});
})();
