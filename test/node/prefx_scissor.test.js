// PRE-FX SCISSOR GUARD (render.js guardPreFxScissor): Phaser 3.87's PreFX
// pipeline draws a shiny sprite and its FX passes into offscreen targets with
// the camera's scissor still enabled. The map camera is a sub-viewport
// (_applyMapZoom), so its scissor clipped or emptied those targets and shiny
// props vanished or showed a slice. The guard lifts the scissor around the
// pipeline's quad and restores it after. Driven against a fake Phaser
// namespace and GL; the app.js wiring is pinned as source text.

(function () {

function fakePhaser() {
  let enabled = true;
  const log = [];
  const gl = { SCISSOR_TEST: 0x0C11,
    isEnabled(cap) { return cap === this.SCISSOR_TEST && enabled; },
    enable(cap) { if (cap === this.SCISSOR_TEST) { enabled = true; log.push('on'); } },
    disable(cap) { if (cap === this.SCISSOR_TEST) { enabled = false; log.push('off'); } } };
  const seen = [];
  function PreFXPipeline() { this.gl = gl; }
  PreFXPipeline.prototype.batchQuad = function (sprite) { seen.push({ sprite, scissor: enabled }); return 'drawn'; };
  function FXPipeline() { PreFXPipeline.call(this); }
  FXPipeline.prototype = Object.create(PreFXPipeline.prototype);
  const NS = { Renderer: { WebGL: { Pipelines: { PreFXPipeline, FXPipeline } } } };
  return { NS, gl, log, seen, setScissor(v) { enabled = v; }, isScissorOn: () => enabled };
}

test('prefx guard: the quad draws with the scissor off, and the scissor comes back after', () => {
  const f = fakePhaser();
  assert.truthy(Render.guardPreFxScissor(f.NS), 'patched');
  const fx = new f.NS.Renderer.WebGL.Pipelines.FXPipeline();
  assert.eq(fx.batchQuad('rock'), 'drawn', 'the original return value passes through');
  assert.eq(f.seen.length, 1);
  assert.eq(f.seen[0].sprite, 'rock', 'arguments pass through');
  assert.falsy(f.seen[0].scissor, 'scissor OFF while the pipeline draws its targets');
  assert.truthy(f.isScissorOn(), 'scissor restored for the next ordinary batch');
  assert.eq(f.log.join(','), 'off,on');
});

test('prefx guard: a scissor that was already off is left alone', () => {
  const f = fakePhaser();
  Render.guardPreFxScissor(f.NS);
  f.setScissor(false);
  new f.NS.Renderer.WebGL.Pipelines.FXPipeline().batchQuad('bush');
  assert.eq(f.log.length, 0, 'no enable/disable calls');
  assert.falsy(f.isScissorOn());
});

test('prefx guard: the scissor is restored even when the draw throws', () => {
  const f = fakePhaser();
  f.NS.Renderer.WebGL.Pipelines.PreFXPipeline.prototype.batchQuad = () => { throw new Error('boom'); };
  Render.guardPreFxScissor(f.NS);
  let threw = false;
  try { new f.NS.Renderer.WebGL.Pipelines.FXPipeline().batchQuad(); } catch (e) { threw = true; }
  assert.truthy(threw);
  assert.truthy(f.isScissorOn(), 'restored in finally');
});

test('prefx guard: idempotent, and a no-op without a WebGL Phaser', () => {
  const f = fakePhaser();
  Render.guardPreFxScissor(f.NS);
  const once = f.NS.Renderer.WebGL.Pipelines.PreFXPipeline.prototype.batchQuad;
  assert.truthy(Render.guardPreFxScissor(f.NS), 'second call reports patched');
  assert.eq(f.NS.Renderer.WebGL.Pipelines.PreFXPipeline.prototype.batchQuad, once, 'not wrapped twice');
  new f.NS.Renderer.WebGL.Pipelines.FXPipeline().batchQuad('x');
  assert.eq(f.log.join(','), 'off,on', 'one off/on pair, not two');
  assert.falsy(Render.guardPreFxScissor(null), 'no Phaser: nothing to patch');
  assert.falsy(Render.guardPreFxScissor({ Renderer: {} }), 'Canvas-only build: nothing to patch');
});

test('prefx guard: app.js installs it before the game is created', () => {
  const app = SCENE_SRC;   // app.js and its scene mixins, as text
  const guard = app.indexOf('Render.guardPreFxScissor();');
  const game = app.indexOf('new Phaser.Game({');
  assert.truthy(guard > 0, 'app.js calls Render.guardPreFxScissor()');
  assert.truthy(game > guard, 'before new Phaser.Game');
});
})();
