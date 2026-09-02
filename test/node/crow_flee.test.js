// FINDING 1 — a hit wild crow must actually flee, not freeze.
//
// WHAT BROKE. _wildCrowTick's very first line was
//   if (c._fleeUntilT && c._fleeUntilT > now) return;
// with a comment claiming the crow "skips crop logic and runs". It doesn't
// run: c.x/c.y are written NOWHERE else in this file for a wild crow (crows
// are diverted into _wildCrowTick instead of the generic wander body), so
// returning before touching them froze the crow in place for the full 8s
// flee window a pet hit arms — while the pet kept landing hits on a
// stationary target.
//
// THE FIX. _wildCrowTick now treats "fleeing" as its own phase that launches
// short fast dashes away from the hit angle, reusing the same FLIGHT-phase
// fields (_flightUntilT/_startX,Y/_targetX,Y/_flightT0) — and the existing
// eased-interpolation code — that a normal orbit glide uses. A NEW flag,
// _fleeDash, marks a flight leg as belonging to a panic dash; without it a
// crow hit mid-glide toward a crop would keep coasting to that STALE
// pre-hit target for up to 1200ms before the flee ever took effect, which
// is the secondary effect the finding asked to confirm.
//
// _wildCrowTick can't load headlessly (it needs Phaser, being a method on
// the scene class) so it's driven the way spawn_rebuild.test.js drives the
// spawn gate: the real method body, lifted verbatim by run.js into
// WILD_CROW_TICK_SRC, run via `new Function(...).call(stub, …)` against a
// minimal scene stub — not a transcription of the logic that could drift.
(function () {

const makeSelf = (over = {}) => Object.assign({
  cellM: 1,
  cellAt: () => ({ loaded: true, type: 0 }),   // 0 is not in FAUNA_BLOCKED_TYPES — never blocks a dash target
  save: { planted: [] },
  _nearAny: () => false,
}, over);

const tick = (self, c, now, px = 0, py = 0) =>
  new Function('c', 'now', 'px', 'py', WILD_CROW_TICK_SRC).call(self, c, now, px, py);

test('crow flee: a hit crow moves within the flee window (was frozen 8s solid)', () => {
  const self = makeSelf();
  const c = { x: 0, y: 0, kind: 'crow' };
  // Mirrors exactly what the pet-fight code stamps on a hit prey (app.js
  // ~6300): fleeAngle away from the pet, an 8s flee window.
  c._fleeAngle = 0;              // flee toward +x
  c._fleeUntilT = 1000 + 8000;
  tick(self, c, 1000);           // reacts to the hit: picks a dash target
  tick(self, c, 1150);           // partway through that dash: should be moving
  assert.truthy(c.x !== 0 || c.y !== 0,
    `crow did not move at all while fleeing (x=${c.x}, y=${c.y}) — FINDING 1: the early ` +
    `\`return\` froze it instead of running`);
});

test('crow flee: keeps dashing for the whole ~8s window, ending up well clear of the hit', () => {
  const self = makeSelf();
  const c = { x: 0, y: 0, kind: 'crow' };
  c._fleeAngle = 0;   // flee toward +x
  c._fleeUntilT = 1000 + 8000;
  let t = 1000;
  for (let i = 0; i < 60; i++) {   // 60 ticks * 150ms = 9s, comfortably past the window
    t += 150;
    tick(self, c, t);
  }
  assert.gt(c.x, 3,
    `crow only reached x=${c.x} after the whole flee window — should have covered several ` +
    `cells fleeing in +x`);
});

test('crow flee: a crow mid ORBIT-glide when hit redirects on its very next tick, ' +
     'not after coasting to the stale pre-hit target', () => {
  const self = makeSelf();
  // Mid-flight toward some crop-orbit point at x=10 — 700ms into a 1000ms
  // glide that started at x=0 — when the pet lands its hit.
  const c = {
    x: 5, y: 0, kind: 'crow',
    _startX: 0, _startY: 0, _targetX: 10, _targetY: 0,
    _flightT0: 0, _flightUntilT: 1000,   // a NORMAL glide: _fleeDash is unset
  };
  c._fleeAngle = Math.PI;   // flee toward -x (away from whatever hit it)
  c._fleeUntilT = 700 + 8000;
  tick(self, c, 700);    // hit lands: must NOT just keep interpolating the old glide
  tick(self, c, 850);    // partway through whatever glide is now active
  assert.lt(c.x, 5,
    `crow kept coasting toward its stale pre-hit target instead of fleeing immediately ` +
    `(x=${c.x}, started at 5, old target was 10) — the _fleeDash guard is what tells a ` +
    `fresh dash apart from a leftover pre-hit glide`);
});

test('crow flee: abandons an in-progress crop-destroy pause instead of finishing the meal', () => {
  const self = makeSelf();
  const crop = { x: 0, y: 0 };
  const c = {
    x: 0, y: 0, kind: 'crow',
    _destroyCropRef: crop, _destroyCyclesLeft: 1, _destroyAtT: 500,
  };
  c._fleeAngle = 0;
  c._fleeUntilT = 100 + 8000;
  tick(self, c, 100);
  assert.eq(c._destroyCropRef, null, 'a mauled crow kept its crop-destroy pause armed');
  assert.eq(c._destroyCyclesLeft, 0, 'a mauled crow kept its destroy-cycle countdown');
  assert.eq(c._destroyAtT, null, 'a mauled crow kept its destroy timer armed');
});

})();
