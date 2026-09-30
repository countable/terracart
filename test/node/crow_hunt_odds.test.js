// THE HUNT IS TIMED, NOT ROLLED (creature_ai.js CROW_DEPART_HOP). Owner, Sep
// 2026: "a 50/50 chance to catch them with a T1 net, depending on timing,
// standing right on it." This drives the REAL _wildCrowTick (lifted by run.js
// as WILD_CROW_TICK_SRC) and the real _crowDepart body through a point-blank
// hunt, thousands of times, against the real net ladder (toolDurationMs) and
// the real reach rule (coords.js cellInReach), and pins the odds:
//   · bare hands never take a crow;
//   · a wood net at point blank is a coin flip — and stays one a cell off,
//     because a GPS fix is never exactly on the bird;
//   · a tier-3 net nearly always does.
// The tap lands at a uniformly random moment of the crow's own rhythm, which
// is what "depending on timing" means: the perch it has left decides.

(function () {
const CELL = 7;
const HOP = eval('(' + CREATURE_AI_SRC.match(/const CROW_DEPART_HOP = (\{[^}]*\});/)[1] + ')');
const DEPART_MS = eval(CREATURE_AI_SRC.match(/const CROW_DEPART_MS = (\[[^\]]*\]);/)[1]);
const dsig = '\n  _crowDepart(c, now = performance.now(), reason = \'sated\') {';
const da = SCENE_SRC.indexOf(dsig);
assert.truthy(da > 0, 'found _crowDepart');
const departBody = SCENE_SRC.slice(SCENE_SRC.indexOf('{', da) + 1, SCENE_SRC.indexOf('\n  }\n', da));
const departFn = new Function('c', 'now', 'reason', 'CROW_DEPART_MS', departBody);
const tickFn = new Function('c', 'now', 'px', 'py', 'CROW_DEPART_HOP', WILD_CROW_TICK_SRC);
// The hunt wheel's escape grace, as _drawWorkProgress ships it (1 s out of
// the lit reach, continuously).
const GRACE_MS = (() => {
  const m = SCENE_SRC.match(/if \(now - wp\._outSinceT >= (\d+)\) \{\s*\/\/ 1 s grace — matches the catch wheel/);
  assert.truthy(m, 'found the hunt wheel\'s grace');
  return Number(m[1]);
})();

// A surface scene at full energy, no reach upgrades, the frame at the origin
// so world metres are local metres and a cell is CELL px (cellPxSize).
const makeScene = () => ({
  cellM: CELL, depth: 0,
  originPx: { x: 0, y: 0 }, startWorldM: { x: 0, y: 0 }, mPerPx: 1,
  cellsPerTile: WorldGen.TILE_PX / CELL, feetOffsetM: 0,
  playerM: { x: 0, y: 0 },
  save: { energy: 50, reachUpgrades: 0, planted: [] },
  cellAt: () => ({ loaded: true, type: 0 }),
  _nearAny: () => false,
  _crowDepart(c, now, reason) { departFn(c, now, reason, DEPART_MS); },
});

// One point-blank hunt with a net of `tier` (0 = bare hands), the player
// within `dist` cells of the crow at the tap. True = caught.
function hunt(tier, dist) {
  const scene = makeScene();
  const c = { x: 100 + Math.random() * CELL, y: 100 + Math.random() * CELL, kind: 'crow' };
  const DT = 50;
  let t = 0;
  // Let the crow settle into its rhythm; the tap comes at a random moment of it.
  const warm = 5000 + Math.random() * 6000;
  for (; t < warm; t += DT) tickFn.call(scene, c, t, 0, 0, HOP);
  const a = Math.random() * Math.PI * 2, r = Math.random() * dist * CELL;
  scene.playerM = { x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r };
  const inReach = () => { const k = worldMetersToAbsCell(scene, c.x, c.y); return cellInReach(scene, k.cellIX, k.cellIY); };
  if (!inReach()) return null;   // (a half-cell offset can straddle a cell edge; not a hunt)
  const relics = tier > 0 ? { bugnet: { tier } } : {};
  const wheelMs = toolDurationMs(relics, 'bugnet');
  scene._crowDepart(c, t, 'hunted');                      // interact.js: the hunt starts
  const end = t + wheelMs;
  let outSince = null;
  for (; t < end; t += DT) {
    tickFn.call(scene, c, t, scene.playerM.x, scene.playerM.y, HOP);
    if (!inReach()) { outSince = outSince ?? t; if (t - outSince >= GRACE_MS) return false; }
    else outSince = null;
  }
  return true;
}
function odds(tier, dist, trials) {
  let won = 0, n = 0;
  for (let i = 0; i < trials; i++) { const r = hunt(tier, dist); if (r == null) continue; n++; if (r) won++; }
  assert.gt(n, trials * 0.8, 'nearly every trial is a hunt');
  return won / n;
}

test('crow hunt odds: a wood net at point blank is a coin flip, decided by timing', () => {
  const p = odds(1, 0.5, 4000);
  assert.inRange(p, 0.42, 0.58, `T1 within half a cell: ${(p * 100).toFixed(0)}%`);
  // A GPS fix is never exactly on the bird: the flip holds a cell off.
  const q = odds(1, 1.5, 4000);
  assert.inRange(q, 0.38, 0.58, `T1 within a cell and a half: ${(q * 100).toFixed(0)}%`);
});

test('crow hunt odds: bare hands never take a crow; a tier-3 net nearly always does', () => {
  const bare = odds(0, 0.5, 1500);
  assert.lt(bare, 0.05, `bare hands: ${(bare * 100).toFixed(0)}%`);
  const t3 = odds(3, 1.0, 1500);
  assert.gt(t3, 0.9, `T3 within a cell: ${(t3 * 100).toFixed(0)}%`);
});

test('crow hunt odds: the retreat hop clears the base reach from wherever the crow sat', () => {
  // Three whole cells out, on any bearing, is past 2.5 cells + 1 m —
  // coords.js reachRadiusM — so the hop ends the hunt and never a die roll on
  // its direction (the old 2–2.5-cell hop landed inside the diamond half the
  // time).
  const scene = makeScene();
  assert.gt(HOP.cells * CELL, reachRadiusM(scene), 'a retreat hop out-reaches the base reach');
  assert.eq(HOP.cells, 3);
  assert.eq(HOP.ms, 1500, 'the glide the odds above are tuned on');
});
})();
