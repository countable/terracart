// A bearing fruit tree WEARS its fruit (src/render.js's fruit pass, seated by
// SpriteLayout.fruitCrownOffset over CROWN_BOUNDS in src/sprite_layout.js).
//
// The rule these pin: the tree's ART is the same whether or not it is bearing.
// It used to swap to the sheet's fruiting frame and dim to 70% once picked, so
// a worked orchard turned into a row of faded, subtly different trees; now the
// FRUIT is the thing that appears and disappears, and it is placed off the
// tree sprite that was just drawn rather than at a hand-picked offset.
//
// (The crown boxes themselves are re-derived from the real PNGs by
// tools/sprite_audit.js — see the `fruit-tree crown:` cases in run.js.)

(function () {
const SL = SpriteLayout;
// The two mature frames the renderer draws — apple 4, peach 3.
const MATURE = [['apple_tree', 4], ['peach_tree', 3]];
// How a wild fruit tree is drawn (RENDER_SPEC.fruittree): origin, scale, and
// the 1.10 Y stretch. Mirrors the sprite_audit scenario of the same name.
const ORIGIN_Y = 0.95, TREE_SCALE = 0.85, SCALE_Y_MUL = 1.10;

test('fruit overlay: every mature fruit-tree frame has a crown to hang fruit on', () => {
  for (const [key, frame] of MATURE) {
    const c = SL.CROWN_BOUNDS[`${key}:${frame}`];
    assert.truthy(c, `${key}:${frame} has a crown box`);
    assert.lt(c.minY, c.maxY, `${key} crown has height`);
    assert.lt(c.minX, c.maxX, `${key} crown has width`);
  }
});

test('fruit overlay: the crown is the canopy — it stops above the trunk', () => {
  // The art runs on down through the trunk to the root base; the crown must
  // not. If it did, the fruit would hang on bare bark — which is exactly what
  // reading the full ART_BOUNDS box would have done.
  for (const [key, frame] of MATURE) {
    const art = SL.ART_BOUNDS[`${key}:${frame}`];
    const crown = SL.CROWN_BOUNDS[`${key}:${frame}`];
    assert.eq(crown.minY, art.minY, `${key}: crown starts at the top of the art`);
    assert.lt(crown.maxY, art.maxY, `${key}: crown ends above the art's base`);
  }
});

test('fruit overlay: the fruit sits on the crown of the tree as drawn', () => {
  for (const [key, frame] of MATURE) {
    const art = SL.ART_BOUNDS[`${key}:${frame}`];
    const crown = SL.CROWN_BOUNDS[`${key}:${frame}`];
    const scaleX = TREE_SCALE, scaleY = TREE_SCALE * SCALE_Y_MUL;
    const off = SL.fruitCrownOffset(key, frame, 0.5, ORIGIN_Y, scaleX, scaleY);
    assert.truthy(off, `${key}: an offset came back`);
    // Screen rows of the drawn art, relative to the sprite's anchor.
    const artTop    = (art.minY - ORIGIN_Y * art.fh) * scaleY;
    const artBottom = (art.maxY - ORIGIN_Y * art.fh) * scaleY;
    const crownBottom = (crown.maxY - ORIGIN_Y * crown.fh) * scaleY;
    assert.gt(off.dyPx, artTop, `${key}: fruit is below the canopy top (not in the sky)`);
    assert.lt(off.dyPx, crownBottom, `${key}: fruit is above the trunk`);
    assert.lt(off.dyPx, artBottom, `${key}: fruit is on the tree`);
    // Horizontally centred on the trunk line, like the tree itself.
    assert.eq(Math.round(off.dxPx * 100) / 100, 0, `${key}: fruit is centred on the tree`);
  }
});

test('fruit overlay: the seating scales WITH the tree, it is not a flat offset', () => {
  // A half-size sapling carries its fruit at half the drop — the one thing a
  // hand-tuned px offset cannot do (see the creature-wheel rule for the bug
  // this shape has already caused once).
  const [key, frame] = MATURE[0];
  const full = SL.fruitCrownOffset(key, frame, 0.5, ORIGIN_Y, 0.85, 0.85 * SCALE_Y_MUL);
  const half = SL.fruitCrownOffset(key, frame, 0.5, ORIGIN_Y, 0.425, 0.425 * SCALE_Y_MUL);
  assert.eq(Math.round(half.dyPx * 1000) / 1000, Math.round(full.dyPx / 2 * 1000) / 1000,
    'half the scale → half the drop');
});

test('fruit overlay: a frame with no crown (sprout / young tree) gets no fruit', () => {
  assert.eq(SL.fruitCrownOffset('apple_tree', 0, 0.5, ORIGIN_Y, 0.85, 0.935), null, 'sprout');
  assert.eq(SL.fruitCrownOffset('apple_tree', 2, 0.5, ORIGIN_Y, 0.85, 0.935), null, 'young tree');
  assert.eq(SL.fruitCrownOffset('nope_tree', 4, 0.5, ORIGIN_Y, 0.85, 0.935), null, 'unknown sheet');
});

// ── The render.js side, pinned as source text (RENDER_SPEC is a const inside
//    drawObjects, so there is no value to reach for). ────────────────────────

test('fruit overlay: the sheets’ own fruiting frames are never drawn', () => {
  // apple 7 / peach 5 are the cells that draw fruit INTO the tree. Drawing one
  // is the old behaviour coming back: the tree would change under the player
  // on a pick, and it would then be wearing an overlay fruit as well.
  const frames = RENDER_FRUIT_FRAMES_SRC;
  assert.truthy(/apple:\s*\{\s*grow:\s*\[0, 2, 4, 5, 4\], mature: 4 \}/.test(frames),
    'apple ends its life cycle on the mature frame, not the fruiting one');
  assert.truthy(/peach:\s*\{\s*grow:\s*\[0, 2, 3, 4, 3\], mature: 3 \}/.test(frames),
    'peach ends its life cycle on the mature frame, not the fruiting one');
  assert.truthy(!/fruit:/.test(frames), 'no fruiting-frame entry is left to pick up');
});

test('fruit overlay: the tree’s frame does not depend on whether it is bearing', () => {
  const spec = RENDER_FRUITTREE_SPEC_SRC;
  const frameFn = spec.slice(spec.indexOf('frame: (o) =>'), spec.indexOf('origin:'));
  assert.truthy(!/_ftPicked|_ftBearing/.test(frameFn),
    'the frame picker reads growth only — never the picked/bearing state');
  assert.truthy(/o\.planted \? fr\.grow\[_ftStage\(o\)\] : fr\.mature/.test(frameFn),
    'growth frames for a sapling, the mature frame for a wild tree');
});

test('fruit overlay: a picked tree is not dimmed — the fruit is simply gone', () => {
  // The 0.7 alpha on a regrowing tree was the other half of "the sprite
  // changes when you pick it".
  assert.truthy(!/setAlpha/.test(RENDER_FRUITTREE_SPEC_SRC),
    'the fruittree hook no longer touches alpha');
});

test('fruit overlay: the fruit is placed off the tree sprite, not by hand', () => {
  const hook = RENDER_FRUITTREE_SPEC_SRC;
  assert.truthy(/_ftBearing\(o\)/.test(hook), 'bearing decides whether a fruit is drawn at all');
  assert.truthy(/fruitCrownOffset\(/.test(hook), 'seated by the shared crown rule');
  assert.truthy(/inventoryIconSource\(o\.species\)/.test(hook),
    'the fruit wears its own inventory icon, per species');
  assert.truthy(/scale: s\.scaleX/.test(hook), 'drawn at the tree’s own scale');
  assert.truthy(/depth: s\.depth \+ 0\.5/.test(hook),
    'painter rule: just above its own tree, still under a lower screen row');
});

test('fruit overlay: the fruit pass renders through its own pool', () => {
  assert.truthy(/scene\.fruitPool/.test(RENDER_FRUIT_PASS_SRC),
    'the pass has a pool of its own so unused fruit sprites are hidden each frame');
  assert.truthy(/scene\.objectsContainer/.test(RENDER_FRUIT_PASS_SRC),
    'and lives in the world layer, where the depth sort can interleave it');
});
})();
