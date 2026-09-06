// THE CANVAS IS NOT THE GRID.
//
// W × H (352 × 844) is the LOGICAL grid every other line of this codebase
// thinks in. The canvas backing store is that grid times RENDER_SCALE — the
// exact CSS→device ratio of the canvas — so the buffer is the same size as the
// screen area it covers and the browser composites it 1:1, with no resampling
// step at all. Until Sep 2026 the canvas WAS 352 × 844: on a DPR-3 phone that
// is under a third of the screen's linear resolution, magnified by a
// fractional factor with nearest-neighbour, so every terrain edge, road band,
// building outline and progress ring was drawn coarse and then re-chunked
// unevenly on the way to the glass.
//
// Three things have to agree or the picture is wrong in a way no other test
// notices — it still renders, just at the wrong size or the wrong sharpness:
//
//   1. index.html's fitGame must PUBLISH the scale it applied. It is the only
//      code that measures the screen; app.js runs after it and can only be
//      told.
//   2. The Phaser config must ask for a device-sized buffer AND the reciprocal
//      zoom. Phaser's Scale.NONE sets canvas.width from the game size and the
//      canvas's CSS size to game size × zoom, so the two must be reciprocal or
//      the canvas lays out at the wrong number of CSS px inside #game's own
//      transform — which would compound, not cancel.
//   3. The camera must put the logical grid back on that buffer, from origin
//      (0,0) so the transform is a pure scale with no scroll term to keep in
//      sync.
//
// app.js needs Phaser and can't load headlessly, so the wiring is pinned as
// source text; renderScale() itself is lifted and driven for real (run.js).
// The pointer half of the contract — canvas px in, logical px out — lives in
// peek_drag.test.js, next to the tap rules it protects.

(function () {
const app = APP_JS_SRC;
const html = INDEX_HTML_SRC;

// ── renderScale(): the real function, driven at real screens ───────────────

// Drive it by setting the globals it reads, the way the browser does.
function at(cssScale, dpr) {
  const prevW = globalThis.window, prevD = globalThis.devicePixelRatio;
  globalThis.window = { __gameCssScale: cssScale, devicePixelRatio: dpr };
  globalThis.devicePixelRatio = dpr;
  try { return renderScale(); }
  finally { globalThis.window = prevW; globalThis.devicePixelRatio = prevD; }
}

test('canvas scale: a real phone gets its real pixels', () => {
  // 393-wide phone (iPhone 15/16) filling the width: 393/352 = 1.116.
  assert.inRange(at(393 / 352, 3), 3.34, 3.36, 'DPR-3 phone renders at ~3.35x');
  // 430-wide Pro Max, and the desktop preview column at the same width.
  assert.inRange(at(430 / 352, 2), 2.44, 2.45, 'DPR-2 retina renders at ~2.44x');
  assert.eq(at(1, 1), 1, 'a plain 1x screen is unchanged — no free upscale');
});

test('canvas scale: never coarser than the grid it replaced', () => {
  // A viewport narrower than 352 CSS px scales #game DOWN. The buffer must not
  // follow it below the logical grid: the game would then be drawing fewer
  // pixels than it has cells to put them in, which is a regression on the
  // fixed 352-wide canvas this replaced, not an optimisation.
  assert.eq(at(0.8, 1), 1, 'a narrow 1x viewport still gets the full grid');
  assert.inRange(at(0.8, 2), 1.6, 1.6, 'but a narrow 2x screen keeps its DPR');
});

test('canvas scale: the cap is a guard, not a ceiling real devices hit', () => {
  // If a real phone were being capped, the buffer would stop matching the
  // screen and the browser would resample it — the exact fault this change
  // removes. The cap only exists so a pathological DPR can't ask the GPU for
  // a 7-megapixel buffer.
  assert.gte(RENDER_SCALE_MAX, 3.36, 'a DPR-3 phone is not capped');
  assert.eq(at(2, 8), RENDER_SCALE_MAX, 'an absurd DPR is');
});

test('canvas scale: a missing publish degrades to the logical grid', () => {
  // app.js runs after fitGame, but a boot order that ever changed must fail
  // soft — the old fixed-size canvas — not with a NaN-sized buffer.
  assert.eq(at(undefined, 1), 1, 'no published scale reads as 1');
  assert.eq(at(1, undefined), 1, 'no devicePixelRatio reads as 1');
});

// ── The wiring: index.html publishes, app.js consumes ──────────────────────

test('canvas scale: fitGame publishes the scale it applied', () => {
  assert.truthy(/window\.__gameCssScale = s;/.test(html),
    'index.html publishes __gameCssScale');
  assert.truthy(/window\.__onGameScaleChange\?\.\(/.test(html),
    'and tells the game when it changed');
  // Both layout branches must go through it, or one of portrait/desktop would
  // silently keep whatever scale the other last published.
  assert.eq((html.match(/publishLayout\(root, top, s, vh\);/g) || []).length, 2,
    'both fitGame branches publish');
  assert.falsy(/getComputedStyle\(g\)\.transform\.match/.test(app),
    'app.js reads the published number, not a matrix() string');
});

test('canvas scale: the Phaser config asks for a device-sized buffer', () => {
  assert.truthy(/width: W \* RENDER_SCALE, height: H \* RENDER_SCALE,/.test(app),
    'the backing store is the logical grid times the render scale');
  assert.truthy(/zoom: 1 \/ RENDER_SCALE,/.test(app),
    'and the reciprocal zoom lays it back out at logical CSS size');
});

test('canvas scale: the camera is a pure scale — origin 0, no scroll', () => {
  const m = app.match(/function applyRenderScale\(cam\) \{[\s\S]*?\n\}/);
  assert.truthy(m, 'applyRenderScale exists');
  const fn = m[0];
  assert.truthy(/cam\.originX = 0;/.test(fn) && /cam\.originY = 0;/.test(fn),
    'origin (0,0) — a 0.5 origin needs a compensating scroll of (W/2)(1-zoom)');
  assert.truthy(/setScroll\(0, 0\)\.setZoom\(RENDER_SCALE\)/.test(fn),
    'no scroll term, zoom is the render scale');
  assert.truthy(/applyRenderScale\(this\.cameras\.main\);/.test(app),
    'create() points the main camera at the logical grid');
});

test('canvas scale: the canvas follows the screen, and pays for it once', () => {
  const m = app.match(/window\.__onGameScaleChange = \(\) => \{[\s\S]*?\n\};/);
  assert.truthy(m, 'app.js installs the resize hook');
  const fn = m[0];
  // Resizing a WebGL drawing buffer reallocates it and fitGame fires on every
  // resize event, so a scale that wobbles in the last decimal (iOS Safari's
  // collapsing toolbar does exactly this) must not reallocate per frame.
  assert.truthy(/Math\.abs\(next - RENDER_SCALE\) < 0\.01/.test(fn),
    'an imperceptible change costs nothing');
  // setZoom BEFORE resize: ScaleManager.resize reads the current zoom to work
  // out the canvas's CSS size, so a stale one lays the new buffer out wrong.
  const zoomAt = fn.indexOf('game.scale.setZoom');
  const resizeAt = fn.indexOf('game.scale.resize');
  assert.truthy(zoomAt >= 0 && resizeAt >= 0, 'both are called');
  assert.lt(zoomAt, resizeAt, 'setZoom comes first — resize reads the zoom');
  // The resize grows the cameras but leaves their transform alone, so the zoom
  // is still the OLD scale until this puts the logical grid back on them.
  assert.truthy(/applyRenderScale\(scene\.cameras\.main\)/.test(fn),
    'and the cameras are re-pointed afterwards');
});
})();
