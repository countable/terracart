// FINDING 1 — a hit wild crow must actually flee, not freeze.
//
// A hit wild crow runs _wildCrowTick's "fleeing" phase: short fast dashes away
// from the hit angle, reusing the FLIGHT-phase fields (_flightUntilT/
// _startX,Y/_targetX,Y/_flightT0) and the eased-interpolation code of a normal
// orbit glide. c.x/c.y are written nowhere else for a wild crow, so an early
// return would freeze it for the full 8s flee window. _fleeDash marks a leg as
// a panic dash; without it a crow hit mid-glide would keep coasting to its
// STALE pre-hit target for up to 1200ms. (The crop raid — orbit, landing and
// the perch count — is checked below.)
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
  // The roam's placed-rock check projects the target (worldMetersToAbsCell).
  startWorldM: { x: 0, y: 0 }, originPx: { x: 0, y: 0 }, mPerPx: 1, cellsPerTile: WorldGen.TILE_PX, placedRockSet: null,
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
  // Mid-flight toward some roam point at x=10 — 700ms into a 1000ms
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

// THE CROW RAIDS AGAIN (owner, Oct 2026 — it did until Sep 2026). It cases a
// crop it may eat (_cropRaidable), lands ON its cell, sits CROW_RAID_PERCHES
// perch cycles there and eats it, then leaves sated (_crowDepart).
const raidSelf = (planted) => {
  const save = { planted };
  return makeSelf({
    save,
    // The real predicate is app.js's (raiderEatsCrop, home_ward.test.js pins
    // it); the stub keeps its one rule that matters here — never potato.
    _cropRaidable: (p) => p.crop !== 'potato',
    _crowDepart(c, now) { c._departUntilT = now + 150000; c._perchUntilT = now; c._flightUntilT = null; },
    flash() {},
  });
};

test('crow raid: a crow on a planted crop eats it after its perches, then leaves', () => {
  const crop = { x: 0, y: 0, crop: 'berry' };
  const self = raidSelf([crop]);
  const c = { x: 0, y: 0, kind: 'crow' };
  let t = 0;
  for (; t <= 600000 && self.save.planted.length; t += 100) tick(self, c, t);
  assert.eq(self.save.planted.length, 0, 'the crop is eaten');
  assert.truthy(c._departUntilT > t - 100, 'and the sated crow is leaving');
  assert.falsy(c._destroyCropRef, 'with no count left on it');
});

test('crow raid: it sits the full count on the crop before it eats', () => {
  const crop = { x: 0, y: 0, crop: 'berry' };
  const self = raidSelf([crop]);
  // Landing on the crop starts the count; one landing is not a meal.
  const c = { x: 0.1, y: 0, kind: 'crow', _startX: 1, _startY: 0, _targetX: 0.1, _targetY: 0,
              _flightT0: 0, _flightUntilT: 100 };
  tick(self, c, 100);
  assert.eq(c._destroyCropRef, crop, 'the first landing starts the count');
  assert.eq(c._destroyCyclesLeft, CROW_RAID_PERCHES, 'at the full count');
  assert.eq(self.save.planted.length, 1, 'nothing eaten yet');
});

test('crow raid: never a potato, and a hit crow drops its count', () => {
  const self = raidSelf([{ x: 0, y: 0, crop: 'potato' }]);
  const c = { x: 0, y: 0, kind: 'crow' };
  for (let t = 0; t <= 120000; t += 100) tick(self, c, t);
  assert.eq(self.save.planted.length, 1, 'the potato survives two minutes of crow');
  const crop = { x: 0, y: 0, crop: 'berry' };
  const s2 = raidSelf([crop]);
  const d = { x: 0, y: 0, kind: 'crow', _destroyCropRef: crop, _destroyCyclesLeft: 1,
              _fleeAngle: 0, _fleeUntilT: 9000 };
  tick(s2, d, 1000);
  assert.falsy(d._destroyCropRef, 'a mauled crow abandons the crop');
});

test('crow raid: the crow reads the one raider predicate and its row\'s flag', () => {
  assert.truthy(SpriteLayout.creatureBehaviour('crow').raidsCrops, 'the crow row says it raids crops');
  assert.truthy(/this\._cropRaidable\(p\)/.test(WILD_CROW_TICK_SRC), 'its tick asks _cropRaidable');
  assert.falsy(/raiderEatsCrop\(/.test(WILD_CROW_TICK_SRC), 'never the bare kind test');
});

})();
