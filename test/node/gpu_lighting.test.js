(function () {
  // Exercise the actual orchestration function while replacing expensive light
  // collectors and canvas painters. This verifies immediate fallback, not pixels.
  function lightingDrawFixture(success) {
    const calls = { gpu: 0, refresh: 0, base: 0, reach: 0, copies: 0 };
    const context = () => ({ clearRect() {}, fillRect() {}, drawImage() { calls.copies++; } });
    const canvas = () => ({ width: 16, height: 16, getContext: context });
    const noop = () => {};
    const deps = {
      document: { createElement: canvas }, window: {}, CELL_PX: 32, REACH_OUTPUT_K: 1,
      lightClock: () => 0, pulseClock: () => 0,
      collectMagicTraps: noop, collectFires: noop, collectLamps: noop, collectPlayer: noop,
      collectBolts: noop, collectBlasts: noop, criticalLights: () => null,
      critPaintProfile: (scene, p) => p, profile: () => ({ lit: 1, edge: 0, litColour: 0xffffff }),
      daylight: () => 1, radiusCells: () => 5, playerLightMul: () => 1,
      reachRadiusM: () => 0, ensurePlayerCookie: () => ({}),
      reachFrames: () => [], reachFramesKey: () => 'fade',
      coverFrame: () => ({ canvas: canvas(), revision: 'cover', key: 'cover', x: 0, y: 0 }),
      frameKey: () => 'frame', contributionPending: () => false,
      contributionFrames: () => ({ items: [], rebuilt: false, deferred: false }),
      worldCookieFrames: () => ({ items: [], excluded: [], cached: 0 }),
      baseFrameKey: () => 'base',
      paintStaticLayer: () => { calls.base++; }, blitStatic: noop,
      paintReachContribution: () => { calls.reach++; },
      LightingGPU: { active: () => true,
        draw(scene, plan) { calls.gpu++; calls.plan = plan; return success; } },
    };
    const begin = LIGHTING_SRC.indexOf('  function draw(scene, ax, ay, halfM) {');
    const end = LIGHTING_SRC.indexOf('\n  window.Lighting =', begin);
    const draw = new Function(...Object.keys(deps), LIGHTING_SRC.slice(begin, end) + '; return draw;')(...Object.values(deps));
    const scene = { cellM: 5, viewLeft: 0, viewTop: 0, viewCenterX: 8, viewCenterY: 8,
      lightTex: { width: 16, height: 16, context: context(), refresh() { calls.refresh++; } } };
    return { scene, calls, draw: () => draw(scene, 0, 0, 20) };
  }

  test('GPU lighting: successful composition avoids final Canvas upload and reuses a still frame', () => {
    const f = lightingDrawFixture(true);
    assert.eq(f.draw(), true);
    assert.eq(f.calls.gpu, 1);
    assert.eq(f.calls.refresh, 0, 'GPU composition does not refresh the Canvas texture');
    assert.eq(f.calls.reach, 0, 'Canvas contribution compositor is bypassed');
    assert.eq(f.calls.plan.base.revision, 1, 'first base canvas carries a revision');
    assert.eq(f.draw(), false, 'unchanged light key skips both backends');
    assert.eq(f.calls.gpu, 1);
  });

  test('GPU lighting: failed composition paints Canvas immediately and invalidates the still key', () => {
    const f = lightingDrawFixture(false);
    assert.eq(f.draw(), true);
    assert.eq(f.calls.gpu, 1);
    assert.eq(f.calls.refresh, 1, 'failure falls through to Canvas in this frame');
    assert.eq(f.calls.reach, 1, 'Canvas contribution is composed on failure');
    assert.eq(f.calls.copies, 1, 'cover mask is included in fallback');
    assert.eq(f.scene.lightTex.__lightKey, null, 'failed GPU key cannot suppress recovery');
    assert.eq(f.draw(), true, 'same visual input still retries after failure');
    assert.eq(f.calls.refresh, 2);
  });
  function gpuFixture() {
    let serial = 0;
    const calls = { uploads: [], deleted: [], listeners: {}, textures: new Map(), draws: 0 };
    const parameter = token => token === 'VIEWPORT' || token === 'SCISSOR_BOX'
      ? [0, 0, 16, 16] : token === 'COLOR_CLEAR_VALUE' ? [0, 0, 0, 0] : null;
    const gl = new Proxy({ isContextLost: () => false, getParameter: parameter,
      isEnabled: () => false, getAttribLocation: () => 0, getUniformLocation: () => ({}),
      drawArrays() { if (calls.fail) throw Error('forced draw failure'); calls.draws++; } },
      { get(o, k) { if (k in o) return o[k]; return /^[A-Z_0-9]+$/.test(k) ? k : () => {}; } });
    const texture = () => ({ webGLTexture: ++serial,
      update(c) { calls.uploads.push(c); } });
    const renderer = { type: 2, gl, currentFramebuffer: null,
      pipelines: { clear() {}, rebind() {} },
      createProgram: () => ({ webGLProgram: ++serial }),
      createVertexBuffer: () => ({ webGLBuffer: ++serial }),
      createTexture2D(...args) { if (args[6]) calls.uploads.push(args[6]); return texture(); },
      createFramebuffer() { if (calls.failTarget) throw Error('target allocation failure'); return { webGLFramebuffer: ++serial }; },
      resetViewport() {}, resetScissor() {}, restoreStencilMask() { calls.stencilRestored = true; },
      canvasToTexture(c, old) { calls.uploads.push(c); return old || texture(); },
      deleteTexture(t) { calls.deleted.push(t); }, deleteFramebuffer() {}, deleteProgram() {}, deleteBuffer() {},
      on(name, fn) { calls.listeners[name] = fn; }, off(name) { delete calls.listeners[name]; } };
    const scene = { _gpuLightingRequested: true, game: { renderer },
      events: { once(name, fn) { calls.shutdown = fn; } },
      textures: { exists: key => calls.textures.has(key), remove: key => calls.textures.delete(key),
        addGLTexture(key, t) { calls.textures.set(key, t); } },
      lightTex: { key: 'canvas-light', __lightKey: 'old' },
      lightMap: { setTexture(key) { this.key = key; this.texture = { key }; return this; } } };
    const plan = { width: 16, height: 16,
      base: { canvas: { width: 16, height: 16 }, revision: 1 },
      reach: { masks: [], gradient: null, gain: 1 }, world: [], stamps: [], cover: null };
    return { scene, renderer, calls, plan };
  }
  function withGPU(fn) {
    const previous = globalThis.Phaser;
    globalThis.Phaser = { WEBGL: 2, Renderer: { Events: {} } };
    try { fn(); } finally { globalThis.Phaser = previous; }
  }

  test('GPU lighting: explicit opt-in and WebGL backend gate resource creation', () => withGPU(() => {
    const f = gpuFixture();
    f.scene._gpuLightingRequested = false;
    assert.eq(LightingGPU.active(f.scene), false);
    assert.eq(f.scene._lightingGPU, undefined, 'disabled prototype allocates nothing');
    f.scene._gpuLightingRequested = true; f.renderer.type = 1;
    assert.eq(LightingGPU.active(f.scene), false, 'Canvas backend stays supported');
    assert.eq(f.scene._lightingGPU, undefined);
    f.renderer.type = 2;
    assert.eq(LightingGPU.active(f.scene), true);
    assert.eq(f.scene.lightMap.key, 'canvas-light', 'gate restores Canvas texture');
  }));

  test('GPU lighting: cached source uploads change only with revision or dimensions', () => withGPU(() => {
    const f = gpuFixture();
    assert.eq(LightingGPU.draw(f.scene, f.plan), true);
    assert.eq(f.calls.uploads.length, 1);
    assert.eq(LightingGPU.draw(f.scene, f.plan), true);
    assert.eq(f.calls.uploads.length, 1, 'same canvas/revision reuses GPU pixels');
    f.plan.base.revision++;
    LightingGPU.draw(f.scene, f.plan);
    assert.eq(f.calls.uploads.length, 2, 'changed pixels upload once');
    f.plan.base.canvas.width = 32;
    LightingGPU.draw(f.scene, f.plan);
    assert.eq(f.calls.uploads.length, 3, 'resizing source invalidates even unchanged revision');
    assert.eq(LightingGPU.status(f.scene).frames, 4);
  }));

  test('GPU lighting: draw failure disables prototype and restores immediate Canvas source', () => withGPU(() => {
    const f = gpuFixture(); f.calls.fail = true;
    assert.eq(LightingGPU.draw(f.scene, f.plan), false);
    assert.eq(f.scene.lightMap.key, 'canvas-light');
    assert.eq(f.scene.lightTex.__lightKey, null);
    assert.eq(LightingGPU.active(f.scene), false);
    assert.eq(LightingGPU.status(f.scene).reason, 'forced draw failure');
  }));

  test('GPU lighting: context lifecycle invalidates uploads and shutdown releases scene references', () => withGPU(() => {
    const f = gpuFixture();
    LightingGPU.draw(f.scene, f.plan);
    f.calls.listeners.losewebgl();
    assert.eq(LightingGPU.active(f.scene), false);
    assert.eq(f.scene.lightMap.key, 'canvas-light');
    f.calls.listeners.restorewebgl();
    assert.eq(LightingGPU.active(f.scene), true);
    LightingGPU.draw(f.scene, f.plan);
    assert.eq(f.calls.uploads.length, 2, 'restored context reuploads original source');
    f.calls.shutdown();
    assert.eq(f.scene._lightingGPU, null);
    assert.eq(f.scene._lightGPUBase, null);
    assert.eq(f.calls.textures.size, 0);
    assert.eq(Object.keys(f.calls.listeners).length, 0);
    assert.truthy(f.calls.deleted.length > 0, 'source textures are deleted');
  }));
  test('GPU lighting: evicted canvases release GPU resources after their last composed frame', () => withGPU(() => {
    const f = gpuFixture();
    f.plan.world = [{ canvas: { width: 32, height: 32 }, revision: 1, sx: 0, sy: 0 }];
    LightingGPU.draw(f.scene, f.plan);
    assert.eq(LightingGPU.status(f.scene).textures, 2);
    f.plan.world = [];
    LightingGPU.draw(f.scene, f.plan);
    assert.eq(LightingGPU.status(f.scene).textures, 1, 'only current source remains pinned');
    assert.eq(f.calls.deleted.length, 1);
    assert.eq(f.calls.stencilRestored, true, 'Phaser mask state is restored');
    assert.eq(LightingGPU.status(f.scene).active, true);
  }));

  test('GPU lighting: failed target allocation deletes its unattached texture', () => withGPU(() => {
    const f = gpuFixture(); f.calls.failTarget = true;
    assert.eq(LightingGPU.draw(f.scene, f.plan), false);
    assert.eq(f.calls.deleted.length, 1, 'failed FBO creation cannot leak its texture');
    assert.eq(f.scene.lightMap.key, 'canvas-light');
  }));

  test('GPU lighting: offscreen rendering falls back without disturbing pending GL draws', () => withGPU(() => {
    const f = gpuFixture(); f.renderer.currentFramebuffer = { webGLFramebuffer: 123 };
    let cleared = false;
    f.renderer.pipelines.clear = () => { cleared = true; };
    assert.eq(LightingGPU.draw(f.scene, f.plan), false);
    assert.eq(cleared, false, 'offscreen caller retains pending pipeline');
    assert.eq(f.calls.draws, 0);
    assert.eq(f.calls.uploads.length, 0);
    assert.eq(f.renderer.currentFramebuffer.webGLFramebuffer, 123);
  }));
})();
