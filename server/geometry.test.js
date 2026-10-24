'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createGeometryService, parseTile, tileAt, bbox, convertTrees, imagery, detect } = require('./geometry');
const { createServer } = require('./index');
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const tile = tileAt(49.25, -123.1);
const tree = { box_2d: [100, 200, 300, 400], tree_type: 'conifer', species: 'pine', size: 'medium', confidence: 'high' };
const image = async () => ({ data: Buffer.from('test'), provider: 'Esri World Imagery', zoom: 20, width: 1024, height: 1024 });
async function temp(fn) { const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'geometry-')); try { await fn(cacheDir); } finally { await fs.rm(cacheDir, { recursive: true, force: true }); } }
test('canonical routes and strict coordinate validation', () => {
  assert.deepEqual(parseTile(new URL('http://x/geometry/trees?lat=49.25&lon=-123.1')), tile);
  assert.deepEqual(parseTile(new URL(`http://x/geometry/trees/18/${tile.x}/${tile.y}`)), tile);
  for (const route of ['/geometry/trees?lat=&lon=1', '/geometry/trees?lat=91&lon=0', '/geometry/trees?lat=0&lon=180', '/geometry/trees?lat=0&lat=1&lon=0', '/geometry/trees/19/1/1', '/geometry/trees/18/-1/0', '/geometry/trees/18/262144/0']) assert.throws(() => parseTile(new URL('http://x' + route)));
});
test('native y,x boxes georeference correctly and stable ids deduplicate', () => {
  const result = convertTrees({ trees: [tree, tree] }, tile);
  assert.equal(result.length, 1);
  const box = bbox(tile), [lon, lat] = result[0].geometry.coordinates;
  assert.ok(Math.abs(lon - (box[0] + (box[2] - box[0]) * .3)) < 1e-10);
  assert.ok(lat > box[1] && lat < box[3]);
  assert.equal(result[0].properties.treeSpeciesFixed, true);
  assert.equal(result[0].properties.species_basis, 'game_type_mapping');
  assert.equal(convertTrees({ trees: [{ ...tree, tree_type: 'broadleaf', species: 'pine' }] }, tile)[0].properties.species, 'maple');
  assert.equal(convertTrees({ trees: [{ ...tree, tree_type: 'unknown' }] }, tile)[0].properties.species, undefined);
  assert.ok(result[0].properties.crown_m > 0);
  assert.deepEqual(convertTrees({ trees: [tree] }, tile), result);
  for (const box_2d of [[0,0,0,1], [-1,0,1,1], [0,0,1001,1], [0,0,NaN,1]]) assert.throws(() => convertTrees({ trees: [{ ...tree, box_2d }] }, tile));
  assert.throws(() => convertTrees({}, tile));
});
test('padded context offsets centers and assigns shared-border crowns to one tile', () => {
  const padded = { width: 1280, height: 1280, coreBox: { left: 128, top: 128, width: 1024, height: 1024 } };
  // Native center x=900 maps exactly to the core east boundary and is excluded.
  const edge = { ...tree, box_2d: [400, 850, 600, 950] };
  assert.equal(convertTrees({ trees: [edge] }, tile, padded).length, 0);
  // The same crown on the eastern tile has native x=100, its west boundary.
  const adjacent = { ...tree, box_2d: [400, 50, 600, 150] };
  const next = { ...tile, x: tile.x + 1 };
  const feature = convertTrees({ trees: [adjacent] }, next, padded)[0];
  assert.ok(feature); assert.equal(feature.geometry.coordinates[0], bbox(tile)[2]);
  assert.ok(feature.properties.bbox[0] < bbox(next)[0]);
  const contextOnly = { ...tree, box_2d: [0, 0, 80, 80] };
  assert.equal(convertTrees({ trees: [contextOnly] }, tile, padded).length, 0);
  const asymmetric = { ...tree, box_2d: [200, 300, 400, 500] };
  const converted = convertTrees({ trees: [asymmetric] }, tile, padded)[0];
  const box = bbox(tile);
  assert.ok(Math.abs(converted.geometry.coordinates[0] - (box[0] + (box[2] - box[0]) * .375)) < 1e-10);
});
test('disk cache survives service recreation with no model key, including empty results', () => temp(async cacheDir => {
  let calls = 0;
  const options = { cacheDir, imagery: image, detect: async () => { calls++; return { trees: [] }; } };
  const first = await createGeometryService(options).get(tile);
  assert.deepEqual(first.features, []);
  const second = await createGeometryService({ cacheDir, apiKey: '' }).get(tile);
  assert.deepEqual(first, second); assert.equal(calls, 1);
}));
test('failures and malformed cache retry, concurrent requests share work', () => temp(async cacheDir => {
  let calls = 0;
  const service = createGeometryService({ cacheDir, imagery: image, detect: async () => { calls++; if (calls === 1) throw new Error('upstream'); return { trees: [tree] }; } });
  await assert.rejects(service.get(tile));
  assert.deepEqual(await fs.readdir(cacheDir), []);
  await fs.writeFile(path.join(cacheDir, `v1-18-${tile.x}-${tile.y}.json`), '{broken');
  const results = await Promise.all(Array.from({ length: 10 }, () => service.get(tile)));
  assert.equal(calls, 2); results.forEach(r => assert.deepEqual(r, results[0]));
}));
test('cold generation budget is bounded while cached reads remain available', () => temp(async cacheDir => {
  const service = createGeometryService({ cacheDir, imagery: image, detect: async () => ({ trees: [] }), coldBudget: 1 });
  await service.get(tile);
  await assert.rejects(service.get({ ...tile, x: tile.x + 1 }), e => e.status === 429);
  assert.equal((await service.get(tile)).features.length, 0);
}));
test('imagery mosaic falls back as a whole and distinguishes no imagery', async () => {
  const sharp = require('sharp');
  const pixels = Buffer.alloc(256 * 256 * 3);
  for (let i = 0; i < pixels.length; i++) pixels[i] = i % 251;
  const data = await sharp(pixels, { raw: { width: 256, height: 256, channels: 3 } }).jpeg().toBuffer();
  const urls = [];
  const fetcher = async url => { urls.push(url); return { ok: true, status: 200, headers: new Headers({ 'blank-tile': url.includes('/tile/20/') ? 'true' : 'false' }), arrayBuffer: async () => data }; };
  const result = await imagery(tile, fetcher, new AbortController().signal);
  assert.equal(result.zoom, 19); assert.equal(result.width, 640);
  assert.equal(urls.length, 17);
  assert.equal((await sharp(result.data).metadata()).width, 640);
  const borderUrls = [];
  const border = await imagery({ z: 18, x: 0, y: 0 }, async url => { borderUrls.push(url); return { ok: true, status: 200, headers: new Headers(), arrayBuffer: async () => data }; }, new AbortController().signal);
  assert.equal(border.width, 1280); assert.equal(border.height, 1152);
  assert.deepEqual(border.coreBox, { left: 128, top: 0, width: 1024, height: 1024 });
  assert.ok(borderUrls.every(url => !url.includes('/-')));
  assert.ok(borderUrls.some(url => url.endsWith('/1048575')));
  await assert.rejects(imagery(tile, async () => ({ status: 404, headers: new Headers() }), new AbortController().signal), /No satellite imagery/);
});
test('provider responses reject truncated or invalid model JSON', async () => {
  const input = await image();
  for (const body of [{ choices: [{ finish_reason: 'length', message: { content: '{"trees":[]}' } }] }, { choices: [{ finish_reason: 'stop', message: { content: 'not json' } }] }, {}]) {
    await assert.rejects(detect(input, async () => ({ ok: true, json: async () => body }), new AbortController().signal, 'test'));
  }
});
test('timeouts fail without caching an empty result', () => temp(async cacheDir => {
  const service = createGeometryService({ cacheDir, imagery: image, detect: async () => new Promise(() => {}), timeoutMs: 10 });
  await assert.rejects(service.get(tile), e => e.status === 504);
  assert.deepEqual(await fs.readdir(cacheDir), []);
}));
test('HTTP routes share relay port and support CORS, errors and OPTIONS', async () => {
  const app = createServer({ geometry: { get: async t => ({ tile: t, features: [] }) } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  try {
    assert.equal((await (await fetch(base)).json()).ok, true);
    const res = await fetch(base + '/geometry/trees?lat=49.25&lon=-123.1');
    assert.equal(res.headers.get('access-control-allow-origin'), '*'); assert.deepEqual((await res.json()).tile, tile);
    assert.equal((await fetch(base + '/geometry/trees?lat=NaN&lon=0')).status, 400);
    assert.equal((await fetch(base + '/geometry/trees', { method: 'OPTIONS' })).status, 204);
    assert.equal((await fetch(base + '/geometry/trees', { method: 'POST' })).status, 405);
  } finally { await app.relay.close(); await new Promise(resolve => app.server.close(resolve)); }
});
(async () => { let failures = 0; for (const {name,fn} of tests) { try { await fn(); console.log('PASS ' + name); } catch (error) { failures++; console.error('FAIL ' + name, error); } } process.exitCode = failures ? 1 : 0; })();
