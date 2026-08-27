// Headless tests for the enemy HEALTH BAR's seating
// (src/sprite_layout.js › creatureHealthBarTop, drawn by app.js
// _drawEnemyHealthBar / _drawEnemyHealth / _drawWorkProgress).
//
// The bar replaced the floating health RING: health used to be stroked with
// the work wheel's exact geometry, so a foe you'd shot once and a rock you
// were mining wore the same circle. The rule now: enemy health is a BAR that
// floats a fixed sliver of sky ABOVE the kind's crown — the top row of its
// visible art at rest — like a name-plate, while the work wheel stays a ring
// seated ON the body. Both are derived per kind from the same CREATURE_ART
// table; neither is a flat offset.

const HB_W = SpriteLayout.HEALTH_BAR_W;
const HB_H = SpriteLayout.HEALTH_BAR_H;
const HB_GAP = SpriteLayout.HEALTH_BAR_GAP;

// Top of a kind's drawn art, relative to its projected cell centre — the same
// geometry render.js places the sprite with (and creature_wheel.test.js pins).
function hbArtTop(kind) {
  const a = SpriteLayout.CREATURE_ART[kind];
  return SpriteLayout.CREATURE_GROUND_DY - a.float - (a.foot * a.fh - a.minY) * a.scale;
}

test('health bar: the dimensions are sane and match the wheel family', () => {
  assert.gt(HB_W, 0, 'bar width');
  assert.gt(HB_H, 0, 'bar height');
  assert.gte(HB_GAP, 0, 'bar gap');
  // Sized to the wheel's stroked diameter so the two combat readouts read as
  // one family — a resize of either should be a deliberate joint decision.
  assert.eq(HB_W, SpriteLayout.CREATURE_WHEEL_R * 2, 'bar width = wheel diameter');
});

test('health bar: every kind hangs its bar a fixed gap above its own crown', () => {
  for (const kind of Object.keys(SpriteLayout.CREATURE_ART)) {
    const top = SpriteLayout.creatureHealthBarTop(kind);
    const want = hbArtTop(kind) - HB_GAP - HB_H;
    assert.inRange(top - want, -0.5, 0.5, `${kind} bar off its seating`);
  }
});

test('health bar: the bar clears the art entirely — above the crown, never on it', () => {
  for (const kind of Object.keys(SpriteLayout.CREATURE_ART)) {
    const bottom = SpriteLayout.creatureHealthBarTop(kind) + HB_H;
    assert.lt(bottom, hbArtTop(kind), `${kind} bar overlaps its art`);
  }
});

test('health bar: distinct from the work wheel — never seated where the ring is', () => {
  // The whole point of the bar: a fight and a job must not share a shape OR a
  // seat. On any animal tall enough to seat the wheel, the ring's outer edge
  // tops out AT the crown — so the bar, hanging a gap ABOVE the crown, must
  // clear it. (Short kinds centre the wheel on their midline, poking it above
  // the crown; there the two can overlap vertically, which is fine — a foe
  // never wears both at once.)
  const outerR = SpriteLayout.CREATURE_WHEEL_R + 1;
  function hbArtBottom(kind) {
    const a = SpriteLayout.CREATURE_ART[kind];
    return SpriteLayout.CREATURE_GROUND_DY - a.float - (a.foot * a.fh - a.maxY) * a.scale;
  }
  for (const kind of Object.keys(SpriteLayout.CREATURE_ART)) {
    if (hbArtBottom(kind) - hbArtTop(kind) < 2 * outerR) continue;  // short kind
    const barBottom = SpriteLayout.creatureHealthBarTop(kind) + HB_H;
    const wheelTop = SpriteLayout.creatureWheelDy(kind) - outerR;
    assert.lt(barBottom, wheelTop + 1, `${kind} bar sits down in the wheel's seat`);
  }
});

test('health bar: the seat is derived per kind, not one flat offset', () => {
  // Same contract the wheel carries: a cow's bar must clear a chicken's, and
  // a chicken's a cat's — monotone with the art, which one number can't be.
  const topCow = SpriteLayout.creatureHealthBarTop('cow');
  const topChicken = SpriteLayout.creatureHealthBarTop('chicken');
  const topCat = SpriteLayout.creatureHealthBarTop('cat');
  assert.lt(topCow, topChicken, 'cow bar above chicken bar');
  assert.lt(topChicken, topCat, 'chicken bar above cat bar');
});

test('health bar: an unknown kind falls back above the fallback wheel', () => {
  const top = SpriteLayout.creatureHealthBarTop('nessie');
  assert.truthy(Number.isFinite(top), 'fallback is a number');
  const fallbackWheelTop = SpriteLayout.creatureWheelDy('nessie')
    - (SpriteLayout.CREATURE_WHEEL_R + 1);
  assert.lt(top + HB_H, fallbackWheelTop + 1, 'fallback bar clears the fallback wheel');
});
