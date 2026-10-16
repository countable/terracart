// Isolated module instances exercise the same storage across page reloads.
function fogPreference(storage) {
  const w = { localStorage: storage };
  new Function('window', FOG_SRC)(w);
  return w.Fog;
}
function fogStorage() {
  const values = new Map();
  return { getItem: k => values.get(k) ?? null,
    setItem: (k, v) => values.set(k, v) };
}

test('fog setting: off by default, persisted both ways across reloads', () => {
  const storage = fogStorage();
  const fog = fogPreference(storage);
  assert.eq(fog.enabled, false);
  fog.setEnabled(true);
  assert.eq(fog.enabled, true);
  const next = fogPreference(storage);
  assert.eq(next.enabled, true);
  next.setEnabled(false);
  assert.eq(next.enabled, false);
  assert.eq(fogPreference(storage).enabled, false);
});

test('fog setting: inaccessible storage defaults off and failed write preserves state', () => {
  const fog = fogPreference({ getItem() { throw Error('blocked'); },
    setItem() { throw Error('full'); } });
  assert.eq(fog.enabled, false);
  let failed = false;
  try { fog.setEnabled(true); } catch { failed = true; }
  assert.eq(failed, true);
  assert.eq(fog.enabled, false);
});

test('fog setting: exploration survives toggles and continues while disabled', () => {
  const enabled = Fog.enabled;
  try {
    Fog.setEnabled(false);
    Fog.init({}, 64);
    Fog.reveal(10, 10);
    Fog.setEnabled(true);
    assert.eq(Fog.seen(0, 0, 10, 10), true);
    Fog.setEnabled(false);
    Fog.reveal(30, 30);
    const save = {};
    Fog.flush(save);
    Fog.init(save, 64);
    Fog.setEnabled(true);
    assert.eq(Fog.seen(0, 0, 10, 10), true);
    assert.eq(Fog.seen(0, 0, 30, 30), true);
  } finally { Fog.setEnabled(enabled); }
});

test('fog setting: menu reflects saved preference and toggles without reload', () => {
  const start = INDEX_HTML_SRC.indexOf("    // Fog loads with the game modules");
  const end = INDEX_HTML_SRC.indexOf('    // FX pools', start);
  assert.gt(start, -1);
  const fog = fogPreference(fogStorage());
  fog.setEnabled(true);
  const button = { setAttribute(k, v) { this[k] = v; },
    addEventListener(event, fn) { this.click = fn; } };
  const doc = { getElementById: () => button,
    addEventListener(event, fn) { fn(); } };
  new Function('document', 'Fog', INDEX_HTML_SRC.slice(start, end))(doc, fog);
  assert.eq(button.textContent, 'Fog of war: on');
  assert.eq(button['aria-pressed'], 'true');
  button.click({ stopPropagation() {} });
  assert.eq(fog.enabled, false);
  assert.eq(button.textContent, 'Fog of war: off');
  assert.eq(button['aria-pressed'], 'false');
});

test('fog appearance: neutral grey interior is nearly opaque', () => {
  const r = FOG_COLOR >> 16 & 255, g = FOG_COLOR >> 8 & 255, b = FOG_COLOR & 255;
  assert.eq(r, g);
  assert.eq(g, b);
  assert.inRange(r, 96, 160);
  assert.inRange(fogRampAlpha(99), 0.9, 1);
});

test('fog setting: stationary live toggle repaints surface, hides in caves, skips disabled paint', () => {
  const start = RENDER_SRC.indexOf('  if (scene.fogTex && scene.fogImage && scene.fogContainer)');
  const end = RENDER_SRC.indexOf('\n};', start);
  assert.gt(start, -1);
  const draw = new Function('scene', 'Fog', 'paintFogTexture', `
    const fracX = 0, fracY = 0, CELL_PX = 32, VIEW_CELLS = 11;
    const half = 5, baseCellIX = 20, baseCellIY = 20, borderDirty = false;
    const VEIL = () => 0, window = {};
    ${RENDER_SRC.slice(start, end)}
  `);
  const fog = fogPreference(fogStorage());
  const scene = { depth: 0, fogTex: {}, viewCenterX: 100, viewCenterY: 100,
    fogImage: { setVisible(on) { this.visible = on; }, setPosition() {} },
    fogContainer: { setPosition() {} } };
  let paints = 0;
  const frame = () => draw(scene, fog, () => paints++);
  frame();
  assert.eq(scene.fogImage.visible, false);
  assert.eq(paints, 0);
  fog.setEnabled(true);
  frame();
  assert.eq(scene.fogImage.visible, true);
  assert.eq(paints, 1);
  frame();
  assert.eq(paints, 1, 'stationary enabled frame reuses the texture');
  fog.setEnabled(false);
  frame();
  assert.eq(scene.fogImage.visible, false);
  assert.eq(paints, 1);
  scene.depth = 1;
  fog.setEnabled(true);
  frame();
  assert.eq(scene.fogImage.visible, false);
  assert.eq(paints, 1, 'caves keep their own darkness');
  scene.depth = 0;
  frame();
  assert.eq(scene.fogImage.visible, true);
  assert.eq(paints, 2);
});
