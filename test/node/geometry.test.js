(() => {
  test('geometry: z18 scope and explicit offline modes', () => {
    assert.eq(Geometry.tileAt(0, 0).x, 131072);
    assert.eq(Geometry.tileAt(0, 0).y, 131072);
    assert.truthy(Geometry.enabled(''));
    for (const query of ['?geometry=off', '?sandbox=true', '?test=true']) assert.falsy(Geometry.enabled(query));
  });
  test('geometry: request deduplication, retry and persistent empty coverage', async () => {
    const db = new Map(); let calls = 0, time = 0, fail = true;
    const tile = Geometry.tileAt(0, 0);
    const fc = { type: 'FeatureCollection', schemaVersion: 1, tile, coverage: { bbox: Geometry.bounds(tile) }, features: [], model: 'test', generatedAt: '2026-01-01T00:00:00Z' };
    const options = { origin: () => 'https://relay.example', get: async k => db.get(k), put: async (k, v) => db.set(k, JSON.parse(JSON.stringify(v))), now: () => time,
      request: async url => { calls++; assert.truthy(url.endsWith('/geometry/trees/18/131072/131072')); if (fail) throw Error('offline'); return { ok: true, json: async () => fc }; } };
    const client = Geometry.createClient(options);
    const a = client.warm(0, 0), b = client.warm(0, 0);
    assert.eq(a, b); await a; assert.eq(calls, 1);
    await client.warm(0, 0); assert.eq(calls, 1);
    time = 5001; fail = false;
    assert.truthy(await client.warm(0, 0)); assert.eq(calls, 2);
    assert.eq(await client.warm(0, 0), null); assert.eq(calls, 2);
    const restored = Geometry.createClient(options);
    assert.eq(Object.values(await restored.readParent(8192, 8192)).length, 1);
    await restored.warm(0, 0); assert.eq(calls, 2);
    assert.truthy([...db.keys()].every(k => k.includes('https%3A%2F%2Frelay.example/v1/')));
  });
  test('geometry: typed Gemini rows preserve source and known species', () => {
    const bins = WorldGen.buildBinsFromGeoJSON({ features: ['conifer', 'broadleaf', 'unknown'].map((tree_type, i) => ({
      geometry: { type: 'Point', coordinates: [i * 0.0001, 0] },
      properties: { kind: 'tree', source: 'gemini', tree_type, crown_m: 4, size: 'medium' },
    })) }, 0);
    const trees = [...bins.values()].flatMap(b => b.trees);
    assert.eq(trees.length, 3);
    assert.eq(trees[0].species, 'pine'); assert.eq(trees[1].species, 'maple');
    assert.truthy(trees[0].treeSpeciesFixed); assert.truthy(trees[1].treeSpeciesFixed);
    assert.falsy(trees[2].treeSpeciesFixed);
    assert.truthy(trees.every(t => t._treeSource === 'gemini' && Number.isInteger(t.lix)));
  });
  test('geometry: successful coverage replaces ambient trees and respects authored and player ownership', () => {
    const N = 32, grid = new Uint8Array(N * N).fill(WorldGen.T.FOREST);
    const at = (ix, iy) => ({ x: (ix + 0.5) * 7, y: (iy + 0.5) * 7 });
    const e = { cellsPerEdge: N, tileEdgeM: N * 7, grid, roadMask: new Uint8Array(N * N),
      objects: [{ kind: 'tree', id: 'tree_ambient', ...at(10, 10) },
        { kind: 'tree', id: 'tree_player', planted: true, ...at(12, 12) },
        { kind: 'tree', id: 'tree_outside', ...at(20, 20) }], wildplants: [], parkingTreasures: [], roadLabels: {} };
    const bin = { _geometryCoverage: [[8, 8, 16, 16]], trees: [{ kind: 'tree', species: 'maple', treeSpeciesFixed: true, _treeSource: 'gemini', lix: 10, liy: 10 }] };
    WorldGen.injectTileBin(e, bin, 0, 0);
    assert.falsy(e.objects.some(o => o.id === 'tree_ambient'));
    assert.truthy(e.objects.some(o => o.id === 'tree_player'));
    assert.truthy(e.objects.some(o => o.id === 'tree_outside'));
    const tree = e.objects.find(o => o._treeSource === 'gemini');
    assert.truthy(tree); assert.eq(tree.species, 'maple'); assert.truthy(tree.treeSpeciesFixed);
    assert.eq(tree.id, 'tree_sx_0_0_10_10');
    const authored = { ...e, objects: [], zone: { coverage: new Uint16Array(N * N).fill(1) } };
    WorldGen.injectTileBin(authored, bin, 0, 0);
    assert.eq(authored.objects.length, 0);
  });
  test('geometry: invalid coverage and malformed points remain retryable', async () => {
    const tile = Geometry.tileAt(0, 0), bbox = Geometry.bounds(tile);
    const good = { type: 'FeatureCollection', schemaVersion: 1, tile, coverage: { bbox }, model: 'test', generatedAt: 'now', features: [] };
    const malformed = { ...good, features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [NaN, 0] }, properties: {} }] };
    assert.truthy(Geometry.valid(good, tile));
    assert.falsy(Geometry.valid({ ...good, coverage: { bbox: [0, 0, 1, 1] } }, tile));
    assert.falsy(Geometry.valid(malformed, tile));
    let time = 0, writes = 0, calls = 0;
    const client = Geometry.createClient({ origin: () => 'http://example', get: async () => null, put: async () => { writes++; }, now: () => time,
      request: async () => ({ ok: true, json: async () => (++calls === 1 ? malformed : good) }) });
    assert.eq(await client.warm(0, 0), null); assert.eq(writes, 0);
    time = 5001; assert.truthy(await client.warm(0, 0)); assert.eq(writes, 2);
  });
  test('geometry: detached rebuilds serialize and depth changes leave surface untouched', async () => {
    const start = WORLDGEN_SRC.indexOf('  const _binRebuilds = new Map();');
    const end = WORLDGEN_SRC.indexOf('  // --- Underground cave generation', start);
    const shipped = WORLDGEN_SRC.slice(start, end).replace(/\bactiveDepth\b/g, 'getDepth()');
    const cache = new Map([['0/0', { status: 'ready', id: 'original' }]]);
    const waits = []; let depth = 0, builds = 0;
    const rebuild = new Function('cacheFor', 'tileKey', 'loadTile', 'getDepth', shipped + '\nreturn rebuildTileWithBin;')(
      () => cache, (x, y) => `${x}/${y}`, async () => {
        builds++; const fresh = { status: 'loading', id: builds };
        fresh.promise = new Promise(resolve => waits.push(() => { fresh.status = 'ready'; resolve(); }));
        return fresh;
      }, () => depth);
    const first = rebuild(0, 0, 0), second = rebuild(0, 0, 0);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    assert.eq(builds, 1, 'second build waits for first');
    waits.shift()(); assert.truthy(await first);
    await Promise.resolve(); await Promise.resolve();
    assert.eq(builds, 2); waits.shift()(); assert.truthy(await second); assert.eq(cache.get('0/0').id, 2);
    const third = rebuild(0, 0, 0);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    depth = 1; waits.shift()(); assert.falsy(await third); assert.eq(cache.get('0/0').id, 2);
    assert.falsy(await rebuild(0, 0, 0)); assert.eq(builds, 3, 'underground never starts a surface rebuild');
    depth = 0; const retry = rebuild(0, 0, 0);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    waits.shift()(); assert.truthy(await retry); assert.eq(cache.get('0/0').id, 4);
  });
  test('geometry: walking inside one ready z14 tile warms each new z18 tile', async () => {
    const original = WorldGen.warmGeometry; const calls = [];
    try {
      WorldGen.warmGeometry = async (lon, lat) => { calls.push(Geometry.tileAt(lon, lat)); return false; };
      const scale = 256 * 2 ** WorldGen.Z / 360;
      const scene = { depth: 0, playerM: { x: 180 * scale + 1, y: 256 * 2 ** WorldGen.Z / 2 + 1 },
        startWorldM: { x: 0, y: 0 }, mPerPx: 1, ensureTilesAround: async () => {} };
      const warm = liftSceneMethod('_warmGeometryAround', { START_LAT: 0, Geometry: { ...Geometry, enabled: () => true } });
      await warm.call(scene); await warm.call(scene); assert.eq(calls.length, 1);
      // z18 is sixteen z14 pixels wide. This crosses a geometry boundary,
      // while both locations remain in the same ready game tile.
      scene.playerM.x += 17; await warm.call(scene); assert.eq(calls.length, 2);
      assert.eq(Math.floor(calls[0].x / 16), Math.floor(calls[1].x / 16));
      assert.truthy(calls[0].x !== calls[1].x);
      const walk = SCENE_SRC.indexOf('this._warmGeometryAround();', SCENE_SRC.indexOf('this._lastCheckM = { ...this.playerM }'));
      assert.truthy(walk >= 0 && walk < SCENE_SRC.indexOf('if (!this._walkTileBlockSettled(tileCell))', walk));
    } finally { WorldGen.warmGeometry = original; }
  });
  test('geometry: concurrent clients merge immutable children without losing shared parent evidence', async () => {
    const db = new Map(); let transaction = Promise.resolve(), merges = 0;
    const clone = v => v == null ? null : JSON.parse(JSON.stringify(v));
    const options = { origin: () => 'http://shared', get: async key => clone(db.get(key)), put: async (key, value) => db.set(key, clone(value)),
      merge: (parent, child, fc) => {
        const next = transaction.then(async () => {
          merges++; const latest = clone(db.get(parent)) || {}; latest[child] = fc;
          await Promise.resolve(); db.set(parent, clone(latest)); return latest;
        });
        transaction = next; return next;
      },
      request: async url => {
        const parts = url.split('/'), tile = { z: 18, x: Number(parts[parts.length - 2]), y: Number(parts[parts.length - 1]) };
        return { ok: true, json: async () => ({ type: 'FeatureCollection', schemaVersion: 1, tile,
          coverage: { bbox: Geometry.bounds(tile) }, model: 'test', generatedAt: 'now', features: [] }) };
      } };
    const a = Geometry.createClient(options), b = Geometry.createClient(options);
    await Promise.all([a.warm(0, 0), b.warm(0.002, 0)]);
    const reopened = Geometry.createClient(options);
    assert.eq(Object.keys(await reopened.readParent(8192, 8192)).length, 2);
    assert.eq(merges, 2);
  });
})();
