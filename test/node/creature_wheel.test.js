// Headless tests for the work-progress wheel's CROWN RULE
// (src/sprite_layout.js › creatureWheelDy, drawn by app.js _drawWorkProgress).
//
// The wheel used to sit at one flat offset for every animal — -21 px above the
// cell centre for a capture, -11 for a hunt. Animals are drawn feet-anchored at
// wildly different sizes, so that single number floated ~4 px clear above a
// chicken's head (the reported bug) and sat down at a perched crow's FEET.
// The rule now: the wheel centre lands on the kind's crown — the top row of its
// visible art at rest — so half the ring covers the body and half is clear sky.
//
// tools/sprite_audit.js re-derives these numbers from the real PNGs (run as part
// of this suite); the pins below guard the CONTRACT — that the wheel is a
// function of the art, that it touches the body, and that it moved the reported
// 4 px down on the chicken.

const WHEEL_R = 10;          // app.js: R + 1, the ring's outer radius
const OLD_CATCH_DY = -21;    // the flat pre-crown-rule capture offset
const OLD_HUNT_DY = -11;     // the flat pre-crown-rule hunt offset

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

test('creature wheel: every kind is centred on its own crown', () => {
  for (const kind of Object.keys(SpriteLayout.CREATURE_ART)) {
    const dy = SpriteLayout.creatureWheelDy(kind);
    assert.inRange(dy - artTop(kind), -0.5, 0.5, `${kind} wheel off the crown`);
  }
});

test('creature wheel: the ring always overlaps the body it reports on', () => {
  for (const kind of Object.keys(SpriteLayout.CREATURE_ART)) {
    const dy = SpriteLayout.creatureWheelDy(kind);
    assert.gt(dy + WHEEL_R, artTop(kind), `${kind} wheel floats clear above the art`);
    assert.lt(dy - WHEEL_R, artBottom(kind), `${kind} wheel sits below the art`);
  }
});

test('creature wheel: chicken drops ~4px from the old flat capture offset', () => {
  // The reported bug, pinned: 16×16 sheet at 1.20 → the chicken's crown is
  // 17.2 px above its cell centre, not the 21 the flat offset assumed.
  const dy = SpriteLayout.creatureWheelDy('chicken');
  assert.inRange(dy - OLD_CATCH_DY, 3.5, 4.5, 'chicken wheel should sit ~4px lower');
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
