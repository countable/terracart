// Regression guard: A TILLED CELL IS ONE BAKED BED, NOT A PER-FRAME PATH.
//
// Until Sep 2026 render.js painted every tilled cell's soil as a flat fill on
// the cell graphics — and, when the cell sat at a sand/residential zone corner,
// as a fillRoundedRect wearing the ZONE's corner radii (nothing to do with the
// plot). Phaser's fillRoundedRect tessellates four arcs at a fixed 100 steps
// each and triangulates the ~400-point polygon, and cellGfx is cleared every
// frame, so rounding a plot as geometry cost hundreds of triangles per cell
// per frame. Now the bed is BAKED into the `tilled_N` texture (textures.js
// drawTilledTex): an opaque soil pad inset TILLED_INSET_PX from every edge,
// corners of TILLED_CORNER_PX, transparent ring outside — so each cell reads
// as its own bed with the ground colour showing between neighbours, and
// render.js draws no soil fill at all; the watered darkening is a sprite tint
// on that pad (a wash on the graphics under an opaque pad would be hidden;
// one over it would darken the ground ring too).
//
// These tests run the real drawTilledTex against a recording 2D context (no
// canvas needed) and pin the render.js side as source text.

(function () {
// textures.js is lifted by run.js into TILLED_TEX (the test vm has no require()).
const T = TILLED_TEX;

// A 2D context that records every call and property set, in order.
function recorder() {
  const ops = [];
  const ctx = new Proxy({}, {
    get: (_, k) => (...a) => { ops.push([k, ...a]); },
    set: (_, k, v) => { ops.push(['set:' + k, v]); return true; },
  });
  return { ctx, ops };
}

const SIZE = 32;

test('tilled bed: the pad is inset from every cell edge', () => {
  assert.truthy(T.TILLED_INSET_PX >= 1, 'an inset of at least one logical px');
  for (let v = 0; v < T.TILLED_VARIANTS; v++) {
    const { ctx, ops } = recorder();
    T.drawTilledTex(ctx, SIZE, T.seededRand(7919 + v));
    // Every path vertex (moveTo/lineTo endpoints and arcTo control+end points).
    const xs = [], ys = [];
    for (const [k, ...a] of ops) {
      if (k === 'moveTo' || k === 'lineTo') { xs.push(a[0]); ys.push(a[1]); }
      if (k === 'arcTo') { xs.push(a[0], a[2]); ys.push(a[1], a[3]); }
    }
    assert.truthy(xs.length >= 12, `variant ${v}: the bed is a path, not a bare rect`);
    assert.truthy(Math.min(...xs) === T.TILLED_INSET_PX && Math.min(...ys) === T.TILLED_INSET_PX,
      `variant ${v}: the pad starts INSET px in from the top/left edge`);
    assert.truthy(Math.max(...xs) === SIZE - T.TILLED_INSET_PX && Math.max(...ys) === SIZE - T.TILLED_INSET_PX,
      `variant ${v}: the pad ends INSET px short of the bottom/right edge`);
    // The four corners are rounded with the one radius.
    const arcs = ops.filter(([k]) => k === 'arcTo');
    assert.eq(arcs.length, 4, `variant ${v}: four rounded corners`);
    for (const a of arcs) assert.eq(a[5], T.TILLED_CORNER_PX, `variant ${v}: corner radius is TILLED_CORNER_PX`);
  }
});

test('tilled bed: the pad is opaque soil and the furrows are clipped to it', () => {
  const { ctx, ops } = recorder();
  T.drawTilledTex(ctx, SIZE, T.seededRand(7919));
  const idx = (k) => ops.findIndex(([n]) => n === k);
  const fillAt = idx('fill'), clipAt = idx('clip'), restoreAt = idx('restore');
  assert.truthy(fillAt > 0 && clipAt > fillAt, 'the pad is filled, then becomes the clip');
  // The fill style in force at fill() is the opaque soil colour.
  const styleBefore = ops.slice(0, fillAt).filter(([n]) => n === 'set:fillStyle').pop();
  assert.eq(styleBefore && styleBefore[1], '#' + T.TILLED_COLOR.toString(16).padStart(6, '0'),
    'the pad is TILLED_COLOR, fully opaque');
  // Every furrow / grain rect lands inside the clip.
  const rects = ops.map((o, i) => [i, o]).filter(([, [n]]) => n === 'fillRect');
  assert.truthy(rects.length > 0, 'furrows and grain are still drawn');
  for (const [i] of rects) assert.truthy(i > clipAt && i < restoreAt, 'a furrow rect is drawn inside the clip');
  // Nothing paints the ring: no fillRect before the clip, and the clip is restored.
  assert.truthy(restoreAt > clipAt, 'the clip is restored');
});

test('tilled bed: render.js paints no soil fill and no rounded path for a tilled cell', () => {
  const src = RENDER_SRC;
  assert.truthy(!/TILLED_COLOR/.test(src), 'render.js no longer reaches for TILLED_COLOR');
  // The one fillRoundedRect left is the terrain zone-corner fill; none is
  // reached from a tilled test.
  assert.truthy(!/isTilled[\s\S]{0,400}fillRoundedRect/.test(src),
    'no fillRoundedRect within reach of the isTilled branch');
  assert.truthy(!/if \(isWatered\) \{\s*g\.fillStyle/.test(src),
    'the watered darkening is not a wash on the cell graphics');
});

test('tilled bed: the watered tint rides the pad sprite, on every frame', () => {
  const src = RENDER_SRC;
  const m = src.match(/ns\.setTint\(isWatered \? WATERED_TINT : 0xffffff\);/);
  assert.truthy(m, 'the tilled pad sprite is tinted from isWatered, and cleared when not');
  const tint = src.match(/const WATERED_TINT = (0x[0-9a-f]{6});/);
  assert.truthy(tint, 'WATERED_TINT is a module constant');
  // The old wash was 22% black: a multiply of ~0.78 per channel.
  const ch = parseInt(tint[1], 16) & 255;
  assert.truthy(Math.abs(ch / 255 - 0.78) < 0.02, 'the tint matches the 22% black wash it replaced');
});
})();
