// An isolated Phaser trial must stay in front of the DOM HUD until it exits.
test('modal gate: stable open dialogs do not repeatedly reset the stick and observers stop on shutdown', () => {
  const start = MODAL_SHELL_SRC.indexOf('\n  _installModalPadGate() {');
  const method = MODAL_SHELL_SRC.slice(start + 1, MODAL_SHELL_SRC.indexOf('\n  }\n', start) + 4);
  let reads = 0, resets = 0, disconnected = 0, shutdown;
  const doc = {
    getElementById: () => null,
    querySelectorAll: () => [{ id: 'message-modal', getClientRects() { reads++; return [1]; } }],
    body: { classList: { toggle() {} } },
  };
  const Observer = class { observe() {} disconnect() { disconnected++; } };
  const Scene = new Function('document', 'MutationObserver', `return class { ${method} }`)(doc, Observer);
  const scene = new Scene();
  scene.events = { once(name, fn) { assert.eq(name, 'shutdown'); shutdown = fn; } };
  scene._movePadHeld = true;
  scene._resetMovePad = () => { resets++; scene._movePadHeld = false; };
  scene._installModalPadGate();
  for (let i = 0; i < 10; i++) scene._syncModalGate();
  assert.eq(resets, 1, 'only the held pointer needs releasing');
  assert.eq(reads, 11, 'one visibility read per dialog per sync');
  scene._installModalPadGate();
  assert.eq(disconnected, 1, 'reinstall retires the previous observer');
  shutdown();
  assert.eq(disconnected, 2, 'shutdown disconnects the current observer');
  assert.eq(scene._syncModalGate, undefined);
});

test('temple modal gate: observer sync preserves the trial and restores HUD only after all overlays close', () => {
  const source = MODAL_SHELL_SRC;
  const start = source.indexOf('\n  _installModalPadGate() {');
  assert.truthy(start >= 0, 'live modal gate method is present');
  const method = source.slice(start + 1, source.indexOf('\n  }\n', start) + 4);
  let dialogs = [], gated = false, cheers = 0;
  const doc = {
    getElementById() { return null; },
    querySelectorAll() { return dialogs; },
    body: { classList: { toggle(name, on) { assert.eq(name, 'modal-open'); gated = on; } } },
  };
  const Observer = class { constructor(callback) { this.callback = callback; } observe() {} };
  const Scene = new Function('document', 'MutationObserver', `return class { ${method} }`)(doc, Observer);
  const scene = new Scene();
  scene._templeSceneActive = true;
  scene._pendingStarterCheers = [{}];
  scene._flushStarterCheers = () => { cheers++; };
  scene._installModalPadGate();
  assert.truthy(gated, 'trial hides HUD without a DOM modal');
  assert.eq(cheers, 0, 'queued story cheers wait behind the trial');
  scene._modalPadObserver.callback();
  assert.truthy(gated, 'an unrelated DOM mutation cannot reveal HUD');
  scene._templeSceneActive = false;
  dialogs = [{ getClientRects: () => [1] }];
  scene._syncModalGate();
  assert.truthy(gated, 'reward dialog retains gate after trial shutdown');
  dialogs = [];
  scene._syncModalGate();
  assert.falsy(gated, 'closing final overlay restores HUD');
  assert.eq(cheers, 1, 'queued cheers resume once the screen is clear');
});

test('temple modal gate: returning from a resized trial updates the paused surface camera before resume', () => {
  const previous = { Phaser: globalThis.Phaser, document: globalThis.document,
    applyRenderScale: globalThis.applyRenderScale };
  let scale = 2, trial, shutdown, resumed = 0;
  globalThis.Phaser = { Scene: class {} };
  globalThis.applyRenderScale = camera => { camera.zoom = scale; };
  globalThis.document = { body: { classList: { contains: () => false, add() {}, remove() {} } } };
  const camera = { zoom: 2 };
  const source = { cameras: { main: camera }, events: { once() {}, off() {} },
    scene: { manager: { getScene() {}, add(_key, value) { trial = value; } },
      pause() {}, isPaused: () => true, resume() { assert.eq(camera.zoom, scale, 'camera fits before surface resumes'); resumed++; } } };
  try {
    TempleScene.enter(source, {}, { kind: 'duel', size: 7, x: 0, y: 0, cellM: 7 });
    const text = () => ({ setOrigin() { return this; }, setInteractive() { return this; }, on() { return this; } });
    trial.add = { graphics: () => ({}), container: () => ({}), text };
    trial.cameras = { main: { setBackgroundColor() {} } };
    trial.input = { on() {} };
    trial.events = { once(_event, callback) { shutdown = callback; } };
    trial.restartTrial = () => {};
    trial.create();
    scale = 1.1;
    assert.eq(camera.zoom, 2, 'paused surface still has its old scale');
    shutdown();
    assert.eq(camera.zoom, 1.1, 'shutdown applies the new viewport scale');
    assert.eq(resumed, 1);
    assert.falsy(source._templeSceneActive);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});
