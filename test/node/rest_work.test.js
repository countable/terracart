// Regression guard: WORKING IS NOT RESTING.
//
// The passive rests in app.js update() — Home (HOME_FULL_REST_S) and campfire
// warmth (FIRE_FULL_REST_S) — must pause while a work wheel runs. Until Sep
// 2026 they didn't, and a new player's first till was free: the starter
// trailer is dropped under the player at spawn and the starter plot is carved
// two cells from it — inside Home's rest ring (HOME_R), so the Home
// rest ticked at maxE / HOME_FULL_REST_S under a wheel that had already cost
// ENERGY_COST.till — and handed it back before the wheel finished. The bar
// read the same number before and after ("tilling takes no energy").
//
// app.js needs Phaser and can't load headlessly, so the gate is pinned as
// source text (APP_JS_SRC is lifted by run.js). The arithmetic test below is
// the reason the gate exists: if the rates or the till ever change so a
// wheel can't out-earn its cost, the gate is still right, just no longer load-
// bearing — never drop it to "fix" that test.

(function () {
const app = APP_JS_SRC;

// The rest block of update(): from the HOME-ONLY comment to the cobble sweep.
const block = (() => {
  const a = app.indexOf('const atHome = this.isRestingAtHome(pWX, pWY);');
  const b = app.indexOf('this._sweepCobbleTrails();', a);
  assert.truthy(a > 0 && b > a, 'found the passive-rest block in update()');
  return app.slice(a, b);
})();

test('rest/work: a running work wheel is the one "working" signal', () => {
  assert.truthy(/const working = !!this\._workProgress;/.test(block),
    '`working` is derived from _workProgress, the wheel every job runs on');
});

test('rest/work: the Home rest pauses while working', () => {
  assert.truthy(/if \(atHome && !working && \(this\.save\.energy \?\? 0\) < maxE\)/.test(block),
    'the Home rest branch carries the !working gate');
});

test('rest/work: campfire warmth pauses while working', () => {
  assert.truthy(/if \(!working && !locked && this\._nearAny\('fires', pWX, pWY, FIRE_REST_R\)\)/.test(block),
    'the campfire branch carries the !working gate (and, on hard mode, the zero-energy lockout too)');
});

test('rest/work: why — an ungated Home rest out-earns a bare-handed starter till', () => {
  // Lifted, not restated: HOME_FULL_REST_S from app.js, the till cost and the
  // hoe ladder from items.js, and the two halvings the till handler applies
  // (global 2× speed-up, then the grassland half-time — the starter plot is
  // painted GRASS) from interact.js.
  const hm = app.match(/const HOME_FULL_REST_S = (\d+);/);
  assert.truthy(hm, 'HOME_FULL_REST_S is a plain literal');
  const homeRestS = Number(hm[1]);
  assert.truthy(/tillMs = Math\.round\(tillMs \/ 2\);\s*\n\s*if \(GRASSLAND_TILL\.has\(cell\.type\)\) tillMs = Math\.round\(tillMs \/ 2\);/.test(INTERACT_SRC),
    'the till handler halves the wheel twice on grassland');
  const tillMs = Math.round(Math.round(toolDurationMs(null, 'hoe') / 2) / 2);
  const maxE = STARTING_ENERGY;
  const restedDuringWheel = maxE * (tillMs / 1000) / homeRestS;
  assert.truthy(restedDuringWheel >= ENERGY_COST.till,
    `an ungated rest returns ${restedDuringWheel.toFixed(2)}⚡ during a ${tillMs} ms till that cost ${ENERGY_COST.till}⚡ — the gate is load-bearing`);
});
})();
