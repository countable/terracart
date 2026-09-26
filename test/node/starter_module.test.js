// starter_module.test.js — the starter-area placers live in src/starter.js,
// and MapScene keeps ONE-LINE wrappers for them.
//
// The seventeen methods moved out of app.js verbatim (`this` → `scene`). The
// scene still answers to every old name — callers inside app.js, and the
// placers themselves (they call each other THROUGH the scene, so a stub scene
// can stand in for any one) — so each wrapper must exist with the same params
// and hand them, in order, to Starter.<name>(this, …). A wrapper that dropped
// or reordered an argument would still parse and would be caught by nothing
// else: most starter tests reach the code through a wrapper they were handed.

(() => {
  // app.js method name → Starter export, with the params it takes.
  const MOVED = {
    _starterTrailAnchor: '',
    _pestFreeZone: 'tx, ty',
    _setStarterCratesAt: 'x, y',
    _placeStarterTrail: 'entry, tx, ty',
    _scatterStarterStash: 'entry, tx, ty, spawnIX, spawnIY, usedSeats',
    _revealStarterTrail: 'entry, tx, ty, spawnIX, spawnIY',
    _placeStarterRelicChest: 'entry, tx, ty, spawnIX, spawnIY, usedSeats, seatWant',
    _carveStarterPlot: 'entry, tx, ty, spawnIX, spawnIY, usedSeats',
    _carveStarterPond: 'entry, tx, ty',
    _paintPond: 'entry, tx, ty, cx, cy',
    _carveStarterPondAround: '',
    _starterHomeObject: 'rec',
    _starterHomeWildplant: 'rec',
    _starterHomeStream: 'entry, rec',
    _provisionStarterHome: 'entry, tx, ty, spawnIX, spawnIY, usedSeats',
    _placeHomeGreeter: 'entry, tx, ty',
    _stripStarterCrates: 'entry',
  };
  const exportName = (m) => m.charAt(1).toLowerCase() + m.slice(2);
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  test('starter module: Starter exports all seventeen placers, and nothing else', () => {
    assert.truthy(typeof Starter === 'object' && Starter, 'starter.js defines window.Starter');
    const want = Object.keys(MOVED).map(exportName).sort();
    assert.eq(Object.keys(Starter).sort().join(), want.join(), 'the export list');
    for (const k of want) assert.eq(typeof Starter[k], 'function', `Starter.${k} is a function`);
  });

  test('starter module: each scene wrapper delegates with its params, in order', () => {
    const app = APP_JS_SRC;
    for (const [m, params] of Object.entries(MOVED)) {
      const args = params ? 'this, ' + params : 'this';
      const line = `  ${m}(${params}) { return Starter.${exportName(m)}(${args}); }`;
      const re = new RegExp('^' + esc(line) + '$', 'gm');
      const hits = app.match(re) || [];
      assert.eq(hits.length, 1, `app.js has exactly one wrapper: ${line.trim()}`);
      // ...and no second, full-bodied definition of the same method shadowing it.
      const defs = app.match(new RegExp('^  ' + esc(m) + '\\(', 'gm')) || [];
      assert.eq(defs.length, 1, `${m} is defined once in app.js`);
    }
  });

  test('starter module: the functions take the scene first, as the wrappers pass it', () => {
    const src = STARTER_JS_SRC;
    for (const [m, params] of Object.entries(MOVED)) {
      const sig = `  function ${exportName(m)}(scene${params ? ', ' + params : ''}) {`;
      assert.truthy(src.includes(sig), `starter.js: ${sig.trim()}`);
    }
    // The move was `this` → `scene`: a stray `this` in a placer's CODE would
    // read the module's IIFE receiver, not the scene.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.falsy(/\bthis\b/.test(code), 'no `this` left in starter.js code');
  });

  test('starter module: a wrapper really forwards to the module (behavioural)', () => {
    const seen = [];
    const orig = Starter.paintPond;
    Starter.paintPond = function (...a) { seen.push(a); return 'ok'; };
    try {
      const scene = { tag: 'scene' };
      const r = __pond._paintPond.call(scene, 'E', 1, 2, 3, 4);
      assert.eq(r, 'ok', 'the return value comes back');
      assert.eq(seen.length, 1, 'called once');
      assert.eq(seen[0][0], scene, 'scene first');
      assert.eq(seen[0].slice(1).join(), 'E,1,2,3,4', 'then the params in order');
    } finally {
      Starter.paintPond = orig;
    }
  });
})();
