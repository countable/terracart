// An isolated Phaser trial must stay in front of the DOM HUD until it exits.
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
