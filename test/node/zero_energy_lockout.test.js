// Hard mode's zero-energy lockout: once the tank reads empty on hard, every
// ordinary recovery path (food, campfire rest, offline/passive rest) refuses.
// Only two things still work — reaching the trailer, or eating a Crow
// Feather — and both put the bar at exactly 25% of max, never a free full
// tank. Easy mode is untouched: _zeroEnergyLocked() is always false there,
// so every existing path (all pinned by energy.test.js / rest_work.test.js)
// behaves exactly as it did before this feature.
//
// app.js needs Phaser and can't load headlessly, so every gate here is
// pinned as source text (APP_JS_SRC, lifted by run.js).

(function () {
const app = APP_JS_SRC;

test('lockout: _zeroEnergyLocked is hard-mode-only, and reads energy live', () => {
  const a = app.indexOf('_zeroEnergyLocked() {');
  const b = app.indexOf('\n  }\n', a);
  assert.truthy(a > 0 && b > a, 'found _zeroEnergyLocked in app.js');
  const body = app.slice(a, b);
  assert.truthy(/Difficulty\.isHard\(\)/.test(body), 'gated on Difficulty.isHard()');
  assert.truthy(/\(this\.save\.energy \?\? 0\) <= 0/.test(body), 'true only at (or below) zero');
});

test('lockout: eatSelected refuses every food while locked, except a feather revive', () => {
  const a = app.indexOf('eatSelected() {');
  const b = app.indexOf('\n  }\n', a);
  assert.truthy(a > 0 && b > a, 'found eatSelected in app.js');
  const body = app.slice(a, b);
  assert.truthy(/const locked = this\._zeroEnergyLocked\(\);/.test(body),
    'eatSelected checks the lockout');
  assert.truthy(/featherRevive = locked && sel\.id === 'crow_feather'/.test(body),
    'only a Crow Feather gets through the lockout');
  assert.truthy(/if \(locked && !featherRevive\) return false;/.test(body),
    'every other food refuses outright while locked');
  assert.truthy(/this\.getMaxEnergy\(\) \* 0\.25/.test(body),
    'the feather revive is exactly a quarter of max, not a flat FOOD_ENERGY number');
});

test('lockout: crow_feather carries no ordinary FOOD_ENERGY — it only works through the lockout', () => {
  assert.eq(FOOD_ENERGY.crow_feather, undefined,
    'no flat restore value: eating one outside the lockout must refuse, same as before this feature');
});

test('lockout: the Eat button only offers the feather while the lockout actually holds', () => {
  const a = app.indexOf('syncEatButton() {');
  const b = app.indexOf('\n  }\n', a);
  assert.truthy(a > 0 && b > a, 'found syncEatButton in app.js');
  const body = app.slice(a, b);
  assert.truthy(/featherRevive = !!sel && sel\.id === 'crow_feather' && this\._zeroEnergyLocked\(\)/.test(body),
    'the button computes the same feather-revive condition eatSelected uses');
});

test('lockout: the trailer instantly floors you at 25%, not a gradual trickle', () => {
  const a = app.indexOf('const atHome = this.isRestingAtHome(pWX, pWY);');
  const b = app.indexOf('this._sweepCobbleTrails();', a);
  assert.truthy(a > 0 && b > a, 'found the passive-rest block in update()');
  const block = app.slice(a, b);
  assert.truthy(/const locked = this\._zeroEnergyLocked\(\);/.test(block),
    'the rest block reads the lockout');
  assert.truthy(/if \(atHome && locked\) \{[\s\S]{0,200}this\.save\.energy = maxE \* 0\.25;/.test(block),
    'arriving home while locked sets energy straight to a quarter of max');
  // The ordinary gradual accrual branch must still exist UNCHANGED for the
  // non-locked case (easy mode, or hard mode once above zero) — rest_work.
  // test.js already pins its !working gate; this just confirms it survived
  // as a fallback rather than being replaced outright.
  assert.truthy(/else if \(atHome && !working && \(this\.save\.energy \?\? 0\) < maxE\) \{/.test(block),
    'the normal Home accrual still runs once the lockout is not in effect');
});

test('lockout: a campfire is not the trailer — its rest is blocked too while locked', () => {
  const a = app.indexOf('const atHome = this.isRestingAtHome(pWX, pWY);');
  const b = app.indexOf('this._sweepCobbleTrails();', a);
  const block = app.slice(a, b);
  assert.truthy(/if \(!working && !locked && this\._nearAny\('fires', pWX, pWY, FIRE_REST_R\)\)/.test(block),
    'the campfire branch is gated on !locked, same as !working');
});

test('lockout: time away does not revive you either', () => {
  const a = app.indexOf('applyOfflineRest(gapMs) {');
  const b = app.indexOf('\n  }\n', a);
  assert.truthy(a > 0 && b > a, 'found applyOfflineRest in app.js');
  const body = app.slice(a, b);
  assert.truthy(/if \(this\._zeroEnergyLocked\(\)\) return;/.test(body),
    'offline/background rest refuses while the lockout holds');
});
})();
