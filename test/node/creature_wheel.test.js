// Headless tests for the work-progress wheel's CROWN RULE
// (src/sprite_layout.js › creatureWheelDy, drawn by app.js _drawWorkProgress).
//
// The wheel used to sit at one flat offset for every animal — -21 px above the
// cell centre for a capture, -11 for a hunt. Animals are drawn feet-anchored at
// wildly different sizes, so that single number floated ~4 px clear above a
// chicken's head (the reported bug) and sat down at a perched crow's FEET.
// The rule now: the wheel RESTS ON the kind's crown — the ring's top edge lands
// on the top row of its visible art at rest, so the whole wheel sits on the
// animal. It used to CENTRE on the crown, which left a full radius (10 px) of
// ring in the sky above every animal — a constant overshoot, so it read as too
// high on all of them, and worst as a fraction of the small ones.
//
// tools/sprite_audit.js re-derives these numbers from the real PNGs (run as part
// of this suite); the pins below guard the CONTRACT — that the wheel is a
// function of the art, that it touches the body, that nothing floats above the
// crown, and that the correction is derived per kind rather than one offset.

const WHEEL_R = SpriteLayout.CREATURE_WHEEL_R + 1;   // outer radius (backing disc)
const OLD_HUNT_DY = -11;     // the flat pre-crown-rule hunt offset (still the fallback)

// Top of a kind's drawn art, relative to its projected cell centre — the same
// geometry render.js places the sprite with.
function artTop(kind) {
  const a = SpriteLayout.CREATURE_ART[kind];
  return SpriteLayout.CREATURE_GROUND_DY - a.float - (a.foot * a.fh - a.minY) * a.scale;
}
function artBottom(kind) {
  const a = SpriteLayout.CREATURE_ART[kind];
  return SpriteLayout.CREATURE_GROUND_DY - a.float - (a.foot * a.fh - a.maxY) * a.scale;
}

test('creature wheel: every kind rests its ring on its own crown', () => {
  for (const kind of Object.keys(SpriteLayout.CREATURE_ART)) {
    const dy = SpriteLayout.creatureWheelDy(kind);
    const h = artBottom(kind) - artTop(kind);
    const want = artTop(kind) + Math.min(WHEEL_R, h / 2);
    assert.inRange(dy - want, -0.5, 0.5, `${kind} wheel off its seating`);
  }
});

test('creature wheel: no ring floats above the crown of an animal that can seat it', () => {
  // The bug this rule replaced: the ring's top edge sat a full radius above the
  // art on EVERY kind. Any animal at least a wheel-diameter tall must now seat
  // it exactly, with nothing above the crown.
  for (const kind of Object.keys(SpriteLayout.CREATURE_ART)) {
    const h = artBottom(kind) - artTop(kind);
    if (h < 2 * WHEEL_R) continue;               // too short — clamped case below
    const top = SpriteLayout.creatureWheelDy(kind) - WHEEL_R;
    assert.inRange(top - artTop(kind), -0.5, 0.5, `${kind} ring top off the crown`);
  }
});

test('creature wheel: an animal shorter than the wheel centres on its midline', () => {
  // A butterfly is 12 px of art under a 20 px ring — seating the ring's top on
  // its crown would hang the wheel off its feet, so the drop is capped at half
  // the art and the wheel straddles the body instead.
  for (const kind of ['butterfly', 'purple_slime', 'slime', 'cat']) {
    const h = artBottom(kind) - artTop(kind);
    assert.lt(h, 2 * WHEEL_R, `${kind} is expected to be a short kind`);
    const mid = artTop(kind) + h / 2;
    assert.inRange(SpriteLayout.creatureWheelDy(kind) - mid, -0.5, 0.5,
      `${kind} wheel should centre on its midline`);
  }
});

test('creature wheel: the ring always overlaps the body it reports on', () => {
  for (const kind of Object.keys(SpriteLayout.CREATURE_ART)) {
    const dy = SpriteLayout.creatureWheelDy(kind);
    assert.gt(dy + WHEEL_R, artTop(kind), `${kind} wheel floats clear above the art`);
    assert.lt(dy - WHEEL_R, artBottom(kind), `${kind} wheel sits below the art`);
  }
});

test('creature wheel: every kind sits lower than the old centre-on-crown rule', () => {
  // The reported bug: the wheel was too high on every animal. The old rule put
  // the centre on the crown; each kind must now sit strictly lower than that.
  for (const kind of Object.keys(SpriteLayout.CREATURE_ART)) {
    assert.gt(SpriteLayout.creatureWheelDy(kind), artTop(kind),
      `${kind} wheel should sit below its crown, not on it`);
  }
});

test('creature wheel: the drop scales with the animal, it is not one offset', () => {
  // "Never re-tune the wheel with a flat px offset" — the whole point is that
  // the correction is derived. A cow can give up a full radius; a purple slime
  // (10 px of art) can only give up half its height, so the drops must differ.
  const drop = (k) => SpriteLayout.creatureWheelDy(k) - artTop(k);
  assert.inRange(drop('cow'), 9.5, 10.5, 'cow gives up a full radius');
  assert.lt(drop('purple_slime'), drop('cow') - 3, 'a short kind drops less');
  assert.lt(drop('butterfly'), drop('cow') - 3, 'a butterfly drops less');
});

test('creature wheel: a perched crow no longer wears its wheel at its feet', () => {
  // The crow's art floats 13 px off its tile, so the old hunt offset put the
  // ring at the very bottom of the bird — visually detached from it.
  assert.gte(artBottom('crow'), OLD_HUNT_DY, 'crow art bottom vs old flat offset');
  assert.lt(SpriteLayout.creatureWheelDy('crow'), artBottom('crow'), 'crow wheel is up on the bird');
});

test('creature wheel: taller kinds get higher wheels than shorter ones', () => {
  // Monotonicity is the whole point of deriving it from the art: a cow's wheel
  // must clear a chicken's, and a chicken's a cat's.
  const dyCow = SpriteLayout.creatureWheelDy('cow');
  const dyChicken = SpriteLayout.creatureWheelDy('chicken');
  const dyCat = SpriteLayout.creatureWheelDy('cat');
  assert.lt(dyCow, dyChicken, 'cow wheel above chicken wheel');
  assert.lt(dyChicken, dyCat, 'chicken wheel above cat wheel');
});

test('creature wheel: an unknown kind falls back to the old flat creature offset', () => {
  assert.eq(SpriteLayout.creatureWheelDy('nessie'), OLD_HUNT_DY);
});

// ── The table is the renderer's source of truth, not a copy of it ──────────
test('CREATURE_ART covers every kind render.js draws by name', () => {
  const kinds = ['chicken', 'cow', 'cat', 'dog', 'deer', 'rabbit', 'crow', 'butterfly',
                 'slime', 'cave_slime', 'purple_slime', 'goblin', 'goblin_archer'];
  for (const k of kinds) {
    assert.truthy(SpriteLayout.CREATURE_ART[k], `CREATURE_ART missing ${k}`);
  }
});

test('CREATURE_ART entries are complete and sane', () => {
  for (const [kind, a] of Object.entries(SpriteLayout.CREATURE_ART)) {
    assert.truthy(a.fw > 0 && a.fh > 0, `${kind} frame size`);
    assert.gt(a.scale, 0, `${kind} scale`);
    assert.inRange(a.foot, 0, 1, `${kind} foot origin`);
    assert.gte(a.float, 0, `${kind} float`);
    assert.inRange(a.minY, 0, a.fh, `${kind} minY`);
    assert.inRange(a.maxY, 0, a.fh, `${kind} maxY`);
    assert.gt(a.maxY, a.minY, `${kind} art has height`);
  }
});

// ── A STATIC target's wheel is centred in its cell ─────────────────────────
// Rocks, trees, crops, fish and a cave wall are all worked in ONE cell, and
// the wheel over them is centred on that cell: the anchor is snapped to the
// cell centre and no offset is added. Until Sep 2026 it sat at a flat -7 px
// above the anchor, which read as riding up the cell rather than on it.
// app.js can't load headlessly, so the placement is pinned as source text.
test('static wheel: centred on the cell — snapped to its centre, no flat lift', () => {
  const app = APP_JS_SRC;
  const m = app.match(/const dyWheel = creature \? SpriteLayout\.creatureWheelDy\(creature\.kind\) : (-?\d+);/);
  assert.truthy(m, 'the static branch of dyWheel is a literal');
  assert.eq(Number(m[1]), 0, 'and that literal is 0 — no flat lift off the cell centre');
  assert.truthy(/if \(!creature\) \{\s*const ac = worldMetersToAbsCell\(this, ax, ay\);\s*const cc = absCellCenterMeters\(this, ac\.cellIX, ac\.cellIY\);/.test(app),
    'a static anchor is snapped to its cell centre before projection');
});
