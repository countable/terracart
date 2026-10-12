const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const root = {
  WorldGen: { isLotLane: tags => tags.service === 'parking_aisle', classifyLine: () => 1,
    roadOverlayWidthM: tags => tags.class === 'path' ? 2 : 20, PATH_CLASSES: new Set(['path']) },
  StreetVariants: {
    VARIANT_BY_ID: { lantern: { title: 'Lantern Row' }, promenade: { title: 'The promenade' }, barricade: { title: 'The barricade' } },
    lineStyles: (e, f) => f.tags.class === 'path'
      ? [{ a: 0, b: 100, key: 'a', variant: 'promenade' }, { a: 100, b: 200, key: 'b', variant: 'barricade' }]
      : [{ a: 0, b: 200, variant: null }],
    roadStoryFor: () => null, selectionWeights: () => [{ id: 'lantern', nameMultiplier: 4 }],
  },
};
vm.runInNewContext(fs.readFileSync('src/streets.js', 'utf8'), root);
vm.runInNewContext(fs.readFileSync('tools/map-review-paths.js', 'utf8'), root);
vm.runInNewContext(fs.readFileSync('tools/map-review-routes.js', 'utf8'), root);
const api = root.MapReviewRoutes;
const path = { type: 2, id: 42, tags: { class: 'path', name: '<Lamp trail>' }, geom: [[{ x: 100, y: 200 }, { x: 300, y: 200 }]] };
const road = { type: 2, id: 43, tags: { class: 'minor' }, geom: [[{ x: 200, y: 100 }, { x: 200, y: 300 }]] };
const entry = { tx: 0, ty: 0, layers: [{ name: 'transportation', extent: 4096, features: [path, road] }],
  streetIndex: { lines: [], pathSections: [{ key: 'a', size: 'path', segmentLengthM: 300,
    selectedVariant: 'lantern', affinityContext: { coastal: 1 }, featureIds: [42] }] } };
const world = { scene: { depth: 0 }, tiles: [entry] };
const inspect = (x, y, zoom = 2) => api.inspect({ world, point: { x, y }, edge: 4096,
  project: p => ({ x: p.x * zoom, y: p.y * zoom }) });
assert.match(inspect(150, 202).content, /The promenade/);
assert.match(inspect(150, 202).content, /Scenic override/);
assert.match(inspect(150, 202).content, /300 m/);
assert.match(inspect(150, 202).content, /coastal 100%/);
assert.match(inspect(150, 202).content, /&lt;Lamp trail&gt;/);
assert.match(inspect(250, 200).content, /The barricade/);
assert.equal(inspect(200, 200).hits.length, 3, 'a crossing at a theme boundary exposes the road and both path sections');
assert.ok(inspect(208, 150), 'wide road surface remains clickable away from centre');
assert.equal(inspect(150, 204), null, 'ground beyond six screen pixels stays ground');
assert.ok(inspect(150, 204, 1), 'small click tolerance follows zoom');
assert.equal(inspect(500, 500), null);
assert.equal(inspect(-100, 200), null, 'unloaded tiles do not borrow buffered geometry');
world.scene.depth = 1;
assert.equal(inspect(150, 200), null, 'surface roads do not intercept underground clicks');
assert.equal(api.distance({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 }), 5);
const clip = root.MapReviewPaths.clipLine;
assert.equal(clip([{ x: -30, y: 100 }, { x: 0, y: 100 }], 4096).length, 0,
  'unassigned buffer ending at the tile edge contributes no plain path');
const trimmed = clip([{ x: -30, y: 100 }, { x: 4120, y: 100 }], 4096);
assert.equal(trimmed.length, 1);
assert.equal(trimmed[0][0].x, 0);
assert.equal(trimmed[0][1].x, 4096);
const reentry = clip([{ x: 20, y: 20 }, { x: -20, y: 40 }, { x: 20, y: 60 }], 100);
assert.equal(reentry.length, 2, 'separate in-tile runs must not join through the buffer');
console.log('Route inspection and tile-buffer clipping checks passed.');
