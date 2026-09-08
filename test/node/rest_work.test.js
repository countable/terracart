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

// The rest block of update(): from the HOME-ONLY comment to the street sweep.
const block = (() => {
  const a = app.indexOf('const atHome = this.isRestingAtHome(pWX, pWY);');
  const b = app.indexOf('this._sweepStreets();', a);
  assert.truthy(a > 0 && b > a, 'found the passive-rest block in update()');
  return app.slice(a, b);
})();

test('rest/work: "working" is the wheel, held for REST_SETTLE_S past the last job', () => {
  // The wheel alone let a bare-handed 9⚡ job come straight back: the rest
  // resumed the instant it cleared. A wheel up on any frame pushes the hold
  // out, and `working` reads the wheel OR the hold — one lane, two reasons.
  assert.truthy(/if \(this\._workProgress\) this\._holdRest\(restNow\);/.test(block),
    'every frame a wheel is up re-arms the rest hold');
  assert.truthy(/const working = !!this\._workProgress \|\| restNow < \(this\._restHoldUntil \?\? 0\);/.test(block),
    '`working` is the wheel OR the settle hold, nothing else');
  assert.falsy(/const working = !!this\._workProgress;/.test(block),
    'the wheel-only definition is gone');
});

test('rest/work: a spend holds the rest too, through the one helper', () => {
  // spendEnergy is the gate every job\'s price goes through (interact.js,
  // interactables.js, the auto-mine's dig), so a plant or a harvest — jobs
  // with no wheel — hold the rest the same way a chop does.
  const spend = (() => {
    const a = app.indexOf('  spendEnergy(cost, sx, sy, cell = null) {');
    const b = app.indexOf('  _holdRest(now = performance.now()) {', a);
    assert.truthy(a > 0 && b > a, 'found spendEnergy and _holdRest');
    return app.slice(a, b);
  })();
  assert.truthy(/if \(r\.spent > 0\) this\._holdRest\(\);/.test(spend),
    'a successful spend re-arms the hold (a refused one does not)');
  assert.truthy(/_holdRest\(now = performance\.now\(\)\) \{\s*\n\s*this\._restHoldUntil = now \+ REST_SETTLE_S \* 1000;/.test(app),
    '_holdRest is the one writer of _restHoldUntil, off REST_SETTLE_S');
  const writers = app.match(/this\._restHoldUntil = /g) || [];
  assert.eq(writers.length, 1, 'nothing else writes the hold');
  // The stick walk's per-cell drain is travel, not a job: it writes
  // save.energy directly and must NOT hold the rest.
  const stickAt = app.indexOf('while (this._steerCostAccrue >= STEER_DRAIN_LUMP) {');
  assert.truthy(stickAt > 0, 'found the stick-walk cost loop');
  const stick = app.slice(stickAt, stickAt + 400);
  assert.falsy(/_holdRest/.test(stick), 'the stick walk does not hold the rest');
});

test('rest/work: why — an instant resume hands a bare-handed chop back within seconds', () => {
  // Lifted: the Home rest rate from app.js, the bare-handed chop from items.js
  // (a bush is one size unit, so the price is ENERGY_COST.chop itself).
  const hm = app.match(/const HOME_FULL_REST_S = (\d+);/);
  const sm = app.match(/const REST_SETTLE_S = (\d+);/);
  assert.truthy(hm && sm, 'HOME_FULL_REST_S and REST_SETTLE_S are plain literals');
  const ratePerS = STARTING_ENERGY / Number(hm[1]);
  const bareChop = effectiveChopCost({}, { size: 'bush' });
  assert.eq(bareChop, ENERGY_COST.chop, 'a bare-handed bush costs the table price');
  const paybackS = bareChop / ratePerS;
  assert.truthy(paybackS < toolDurationMs(null, 'axe') / 1000,
    `an ungated resume returns the ${bareChop}⚡ in ${paybackS.toFixed(1)} s — less than the ${toolDurationMs(null, 'axe') / 1000} s the job took`);
  // The settle must outlast that payback, or the bar can be full again
  // before a settle has even passed — the price has to stay readable for
  // at least as long as the rest would need to erase it.
  assert.truthy(Number(sm[1]) >= paybackS,
    `REST_SETTLE_S (${sm[1]} s) outlasts the ${paybackS.toFixed(1)} s payback of the dearest bare-handed job`);
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
