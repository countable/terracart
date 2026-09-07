// ── Still frames: the loop's cadence and the lightmap's gate ──────────────
//
// A GPS walker spends most of a session standing still, and until Sep 2026
// every step repainted the lightmap and re-uploaded it to the GPU whether or
// not a single input had moved — at the display's own refresh rate, since
// the Phaser config carried no fps cap at all. Two things hold now: the loop
// STEPS on FPS_LIMIT (30/s) rather than on vsync, and Lighting.draw keys each
// step on everything the paint reads (frameKey) and reuses the last upload
// when the key stands. What animates reads a quantised clock (lightClock),
// so an animated view repaints at LIGHT_TICK_MS steps, not per frame.
//
// The pure half (the key, the clock, the animates test) runs for real here;
// draw() needs a canvas and is pinned as source text, like lighting.test.js.

(function () {

function scene(over) {
  return Object.assign({
    depth: 0, cellM: 5,
    startWorldM: { x: 0, y: 0 }, playerM: { x: 0, y: 0 }, originPx: { x: 0, y: 0 },
    mPerPx: 10, feetOffsetM: 0, cellsPerTile: 512,
    save: { energy: 100, maxEnergy: 100, fires: [] },
    _atmos: { dim: 0x1a2a1e },
    isClaimedKey: () => false,
    _lights: [],
  }, over);
}
const PS = { x: 176, y: 422 };
const RP = { cellIX: 10, cellIY: 20 };
const PC = { tx: 1, ty: 2, cx: 3.25, cy: 4.5 };
function keyFor(s, over = {}) {
  const o = Object.assign({ ps: PS, ox: 0, oy: 0, prof: Lighting.profile(s), r0: 64, rMax: 300, reachM: 10, rp: RP, pc: PC, now: 1000 }, over);
  return Lighting.frameKey(s, o.ps, o.ox, o.oy, o.prof, o.r0, o.rMax, o.reachM, o.rp, o.pc, o.now);
}

test('still frames: the lightmap clock steps, and steps fast enough', () => {
  const T = Lighting.LIGHT_TICK_MS;
  assert.inRange(T, 50, 100, 'between 10 and 20 repaints a second for an animated view');
  assert.eq(Lighting.lightClock(0), 0);
  assert.eq(Lighting.lightClock(T - 1), 0, 'inside a tick the clock stands');
  assert.eq(Lighting.lightClock(T), T, 'and moves by whole ticks');
  assert.eq(Lighting.lightClock(7 * T + T / 2), 7 * T);
});

test('still frames: a still view keys the same, a moved one differently', () => {
  const s = scene();
  assert.eq(keyFor(s), keyFor(s), 'identical inputs, identical key');
  assert.truthy(keyFor(s) !== keyFor(s, { ps: { x: 177, y: 422 } }), 'the feet moved (a peek)');
  assert.truthy(keyFor(s) !== keyFor(s, { pc: { tx: 1, ty: 2, cx: 3.3, cy: 4.5 } }), 'the anchor slid a fraction of a cell');
  assert.truthy(keyFor(s) !== keyFor(s, { rp: { cellIX: 11, cellIY: 20 } }), 'the reach cell changed');
  assert.truthy(keyFor(s) !== keyFor(s, { reachM: 5 }), 'the reach shrank (the dark, or an empty bar)');
  assert.truthy(keyFor(s) !== keyFor(s, { prof: Lighting.profile(s, 0.2) }), 'the sun went down');
  assert.truthy(keyFor(s) !== keyFor(s, { rp: null, pc: null }), 'the plateau went away');
  // The list of lights is in the key, field by field.
  const lit = scene({ _lights: [{ kind: 'cobble', dx: 3, dy: -4, id: 'lamp1' }] });
  assert.truthy(keyFor(s) !== keyFor(lit), 'a lamp came into view');
  const moved = scene({ _lights: [{ kind: 'cobble', dx: 4, dy: -4, id: 'lamp1' }] });
  assert.truthy(keyFor(lit) !== keyFor(moved), 'or moved on screen');
});

test('still frames: only what animates puts the clock in the key', () => {
  // A lamp and a restored house are steady rows: no flicker, no pulse — so
  // two different instants key the same and a still view never repaints.
  const steady = scene({ _lights: [{ kind: 'cobble', dx: 3, dy: -4, id: 'l' }, { kind: 'building', dx: 0, dy: 9, id: 'b' }] });
  assert.falsy(Lighting.animates(steady), 'steady rows do not animate');
  assert.eq(keyFor(steady, { now: 1000 }), keyFor(steady, { now: 99000 }), 'no time term for a steady view');
  // A fire flickers, a POI breathes, a blast drives its own alpha and scale.
  for (const L of [
    { kind: 'fire', dx: 1, dy: 1, id: 'f' },
    { kind: 'poi', dx: 1, dy: 1, id: 'p' },
    { kind: 'blast', dx: 1, dy: 1, id: 'x', r: 2.5, colour: 0xffffff, a: 0.5, s: 1.2 },
  ]) {
    const s = scene({ _lights: [L] });
    assert.truthy(Lighting.animates(s), `${L.kind} animates`);
    const T = Lighting.LIGHT_TICK_MS;
    assert.eq(keyFor(s, { now: Lighting.lightClock(10 * T + 3) }), keyFor(s, { now: Lighting.lightClock(10 * T + T - 1) }),
      `${L.kind}: within one tick the key stands`);
    assert.truthy(keyFor(s, { now: 10 * T }) !== keyFor(s, { now: 11 * T }), `${L.kind}: across a tick it moves`);
  }
});

test('still frames: draw() reads the quantised clock and gates before it touches the canvas', () => {
  const d = LIGHTING_SRC.slice(LIGHTING_SRC.indexOf('  function draw(scene, ax, ay, halfM) {'));
  assert.truthy(/const now = lightClock\(Date\.now\(\)\);/.test(d), 'the frame clock is the lightmap\'s own, not the wall clock');
  const gate = d.indexOf('if (key === tex.__lightKey)');
  const paint = d.indexOf('const ctx = tex.context;');
  const refresh = d.indexOf('tex.refresh();');
  assert.truthy(gate > 0 && paint > gate && refresh > paint, 'the gate sits before the first canvas call, the upload last');
  assert.eq((d.match(/tex\.refresh\(\);/g) || []).length, 1, 'one upload per painted step, none on a reused one');
  assert.truthy(/if \(key === tex\.__lightKey\) \{[\s\S]*?return false;/.test(d), 'a matching key returns without painting');
  assert.truthy(/tex\.__lightKey = key;/.test(d), 'and a painted key is remembered on the texture itself, so a rebuilt texture starts fresh');
});

test('still frames: the loop steps on a cap, and the profile can tell the cap from the passes', () => {
  const a = APP_JS_SRC;
  assert.truthy(/const FPS_LIMIT_DEFAULT = 30;/.test(a), 'thirty steps a second by default');
  const cfg = a.slice(a.indexOf('new Phaser.Game({'));
  assert.truthy(/fps: \{ limit: FPS_LIMIT \},/.test(cfg), 'the Phaser config carries the cap');
  assert.truthy(/urlNumParam\('fps'\)/.test(a) && /urlNumParam\('rscale'\)/.test(a), 'both A/B knobs read off the URL');
  // The profile: still steps apart from walking ones, the lightmap apart
  // from the object scan it runs inside, and the cadence line that says
  // whether the cap or the passes are the lever.
  assert.truthy(/_uB\.tick\('update @still', _dt\);/.test(a), 'update ticks its still steps');
  assert.truthy(/tick\('phaser render @still', dt\)/.test(a), 'so does the render');
  assert.truthy(/B\.tick\('drawObjects', performance\.now\(\) - t0 - \(this\._boot_lightMs \|\| 0\)\);/.test(a),
    'drawObjects takes the lightmap\'s own time back out');
  assert.truthy(/B\.tick\('lighting', dt\);/.test(LIGHTING_SRC), 'the lightmap ticks itself');
  assert.truthy(/main thread busy/.test(INDEX_HTML_SRC) && /lightmap repainted on/.test(INDEX_HTML_SRC),
    'the viewer prints the busy share and the repaint rate');
});

})();
