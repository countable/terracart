(() => {
  function method(src, name, asyncMethod = false) {
    const lead = asyncMethod ? 'async ' : '';
    const m = src.match(new RegExp(`^  ${lead}${name}\\(([^)]*)\\) \\{([\\s\\S]*?)^  \\}`, 'm'));
    assert.truthy(m, `extract ${name}`);
    return { args: m[1], body: m[2] };
  }

  test('boot overlap: preload starts the saved-depth centre tile', async () => {
    const src = ALL_SRC['app.js'];
    assert.truthy(src.includes('this._kickBootTile?.();'), 'Phaser preload starts the tile kick');
    const m = method(src, '_kickBootTile');
    const calls = [];
    const entry = { status: 'loading', promise: Promise.resolve() };
    const WorldGen = {
      tileXYForLonLat(lon, lat) { calls.push(['xy', lon, lat]); return { x: 12, y: 34 }; },
      setDepth(depth) { calls.push(['depth', depth]); },
      loadTile(tx, ty, lat) { calls.push(['load', tx, ty, lat]); return Promise.resolve(entry); },
    };
    const run = new Function('window', 'Sandbox', 'loadSave', 'WorldGen', 'START_LON', 'START_LAT',
      `return function(${m.args}) {${m.body}}`)({}, { detect: () => false }, () => ({ depth: 3 }),
        WorldGen, -119.4, 49.8);
    const scene = {};
    run.call(scene);
    await Promise.resolve();
    assert.eq(calls.map((c) => c.join(':')).join(','),
      'xy:-119.4:49.8,depth:3,load:12:34:49.8');
    assert.eq(scene._bootTileKick.tx, 12);
    assert.eq(scene._bootTileKick.ty, 34);
    assert.eq(scene._bootTileKick.depth, 3);
    assert.eq(await scene._bootTileKick.promise, entry);
  });

  test('boot overlap: tile pass consumes the matching preload without a second load', async () => {
    const m = method(SCENE_GEO_SRC, '_loadTileEntry', true);
    const entry = { status: 'ready' };
    let loads = 0;
    const WorldGen = {
      tileKey: (tx, ty) => `${tx}/${ty}`,
      tileCache: new Map([['12/34', entry]]),
      loadTile() { loads++; return Promise.resolve({ status: 'fallback' }); },
    };
    const run = new Function('WorldGen', 'START_LAT',
      `return async function(${m.args}) {${m.body}}`)(WorldGen, 49.8);
    const scene = { depth: 2, _bootTileKick: { tx: 12, ty: 34, depth: 2, promise: Promise.resolve(entry) } };
    assert.eq(await run.call(scene, 12, 34), entry);
    assert.eq(loads, 0, 'matching kick is the only load');
    assert.eq(scene._bootTileKick, null, 'kick is consumed once');
  });

  test('boot overlap: an atomically replaced early entry falls back to live cache', async () => {
    const m = method(SCENE_GEO_SRC, '_loadTileEntry', true);
    const early = { status: 'ready' }, live = { status: 'ready' };
    let loads = 0;
    const WorldGen = {
      tileKey: (tx, ty) => `${tx}/${ty}`,
      tileCache: new Map([['12/34', live]]),
      loadTile() { loads++; return Promise.resolve(live); },
    };
    const run = new Function('WorldGen', 'START_LAT',
      `return async function(${m.args}) {${m.body}}`)(WorldGen, 49.8);
    const scene = { depth: 0, _bootTileKick: { tx: 12, ty: 34, depth: 0, promise: Promise.resolve(early) } };
    assert.eq(await run.call(scene, 12, 34), live);
    assert.eq(loads, 1, 'replacement is read through loadTile');
  });

  test('boot overlap: high-priority hints use the executed script URLs', () => {
    const preloadUrls = [...INDEX_HTML_SRC.matchAll(
      /<link(?=[^>]*\brel=["']preload["'])(?=[^>]*\bas=["']script["'])[^>]+\bhref=["']([^"']+)["'][^>]*>/g,
    )].map((m) => m[1]);
    const phaser = (INDEX_HTML_SRC.match(/<script src=["'](vendor\/phaser\.js\?v=[^"']+)/) || [])[1];
    const app = (INDEX_HTML_SRC.match(/APP_SRC\s*=\s*['"]([^'"]+)/) || [])[1];
    assert.truthy(phaser && preloadUrls.includes(phaser), 'Phaser preload matches its script tag');
    assert.truthy(app && preloadUrls.includes(app), 'app preload matches APP_SRC');
  });
})();
