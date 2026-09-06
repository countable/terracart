// The lit cobble's GLOW (Sep 2026 — "the cobble activation art is a dull
// lavender"). A lit stone used to be the same grey pebble recoloured flat
// violet; now its baked copy carries a soft halo of its own silhouette in a
// padded margin and a white-hot core over its middle, and drawCells draws it
// larger by exactly the pad so the STONE keeps its cell size while the halo
// spills around it.
//
// The rule this pins is the roadOverlayWidthM discipline: ONE pair of numbers,
// both sides. The baker (app.js create()) pads by LIT_COBBLE_GLOW_PAD; the
// drawer (render.js drawCells) scales by LIT_COBBLE_GLOW_SCALE, which is
// derived from the pad — so widening the halo can never shrink the stone, and
// an unlit stone (drawn from the unpadded sheet) is never scaled at all.
// app.js can't load headlessly, so its side is pinned as source text.

(function () {

test('cobble glow: the drawer\'s scale is derived from the baker\'s pad', () => {
  assert.gt(LIT_COBBLE_GLOW_PAD, 0, 'there is a halo margin');
  assert.lte(LIT_COBBLE_GLOW_PAD, 1, 'no wider than the stone itself on each side');
  assert.eq(LIT_COBBLE_GLOW_SCALE, 1 + 2 * LIT_COBBLE_GLOW_PAD,
    'the sprite grows by exactly the two margins, so the stone stays its cell size');
});

test('cobble glow: the baker pads by the pad, halos the silhouette, and adds a core', () => {
  const a = APP_JS_SRC;
  const start = a.indexOf('    if (typeof LIT_COBBLE_FRAMES !== \'undefined\' && typeof document !== \'undefined\') {');
  assert.gt(start, 0, 'found the lit-cobble bake');
  const body = a.slice(start, a.indexOf('this.textures.addCanvas(key, cvs);', start));
  assert.truthy(/const padFrac = \(typeof LIT_COBBLE_GLOW_PAD === 'number'\) \? LIT_COBBLE_GLOW_PAD : 0;/.test(body),
    'the pad is render.js\'s LIT_COBBLE_GLOW_PAD, not a number of its own');
  assert.truthy(/const pad = Math\.round\(cw \* padFrac\);\n\s+const cvs = document\.createElement\('canvas'\);\n\s+cvs\.width = cw \+ 2 \* pad; cvs\.height = ch \+ 2 \* pad;/.test(body),
    'the canvas is the frame plus a pad on every side');
  assert.truthy(/cctx\.shadowColor = UI_TRAIL_LIT;\n\s+cctx\.shadowBlur = pad;/.test(body),
    'the halo is the silhouette blurred out into the margin, in the trail violet');
  assert.truthy(/cctx\.globalCompositeOperation = 'source-atop';\n\s+cctx\.fillStyle = UI_TRAIL_LIT;/.test(body),
    'stone and halo are recoloured to the same violet the counter is drawn in');
  assert.truthy(/cctx\.globalCompositeOperation = 'lighter';[\s\S]*createRadialGradient\(cx, cy, 0, cx, cy, cw \/ 2\)[\s\S]*rgba\(255,255,255,0\.55\)/.test(body),
    'a white core is ADDED over the stone\'s middle');
});

test('cobble glow: drawCells scales only the LIT copy, on top of the pop', () => {
  const R = RENDER_SRC;
  assert.truthy(/const dsize = size \* flashMul \* \(useActiveTex \? LIT_COBBLE_GLOW_SCALE : 1\);/.test(R),
    'the lit texture is drawn LIT_COBBLE_GLOW_SCALE larger; an unlit stone is not');
  // The lit frames are still the four the sheet lights — the bake loops the
  // same list the drawer keys by.
  assert.eq(LIT_COBBLE_FRAMES.length, 4);
  for (const f of LIT_COBBLE_FRAMES) assert.eq(litCobbleTexKey(f), `cobble_lit_${f}`);
});

})();
