const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const storage = new Map();
const caches = new Map();
let savesDisabled = false;
const W = {
  TILE_PX: 256, T: { GRASS: 0, CAVE_WALL: 25, CAVE_LAVA: 26 },
  tileEdgeMeters: () => 1000, isWalkable: t => t !== 25,
  tileKey: (x, y) => `${x}/${y}`,
  tileCacheFor(d) { if (!caches.has(d)) caches.set(d, new Map()); return caches.get(d); },
  setDepth(d) { this.tileCache = this.tileCacheFor(d); },
  loadTile: Object.assign(() => { throw Error('Unexpected real tile fetch'); }, {
    atDepth: (d, x, y) => ({ generated: true, depth: d, x, y }),
  }),
};
const context = vm.createContext({ URLSearchParams, Uint8Array, Uint8ClampedArray,
  Uint16Array, Uint32Array, Int8Array, Int16Array, Int32Array, Float32Array, Float64Array,
  Set, Map, ArrayBuffer, Promise, WorldGen: W,
  location: { search: '?sandbox=true&sandboxMap=floor-viewer' },
  sessionStorage: { setItem: (k, v) => storage.set(k, v), getItem: k => storage.get(k) },
  disableSave: () => { savesDisabled = true; }, loadSave: () => ({ realSave: true }),
  HomeArea: { setOrigin() {} },
});
vm.runInContext(fs.readFileSync('src/floor_sandbox.js', 'utf8'), context);
const F = context.FloorSandbox;
assert.equal(F.active(), true);
assert.equal(savesDisabled, true);
assert.equal(context.loadSave().realSave, undefined);
assert.throws(() => F.read(), /reviewer/);
const entry = { grid: new Uint8Array(3600), cellsPerEdge: 60, tileEdgeM: 420,
  owners: new Uint16Array([1, 256]), reserved: new Set([3, 7]),
  mappings: new Map([['x', new Set([9])]]), viewerSave: { starterShopId: 'home' } };
const cave = { ...entry, grid: new Uint8Array(3600).fill(25) };
cave.grid[12 * 60 + 26] = 26; // Closer lava must lose to a safe floor.
cave.grid[12 * 60 + 27] = 24;
F.write({ 0: entry, 1: cave }, 1, 42, 0);
const copy = F.read();
assert.equal(copy, F.read());
assert(copy.entries[0].grid instanceof Uint8Array);
assert(copy.entries[0].owners instanceof Uint16Array);
assert.equal(copy.entries[0].owners[1], 256);
assert(copy.entries[0].reserved instanceof Set);
assert(copy.entries[0].mappings.get('x') instanceof Set);
assert(copy.entries[0].mappings.get('x').has(9));
const scene = { save: {}, playerM: {}, syncMoveTarget() { this.synced = true; } };
F.configure(scene);
assert.equal(scene.cellsPerTile, 60);
assert.equal(scene.cellsForRow(100), 60);
assert.equal(scene.cellM, 7);
assert.equal(scene.originPx.x * scene.mPerPx, 178.5);
F.install(scene);
assert.equal(scene.depth, 1);
assert.equal(scene.playerM.x, 14);
assert.equal(scene.playerM.y, 0);
assert.equal(scene.synced, true);
assert.equal(scene.save.starterShopId, 'home');
(async () => {
  assert.equal((await W.loadTile(0, 0)).grid, copy.entries[1].grid);
  assert.equal((await W.loadTile(1, 0)).grid[0], 25);
  assert.equal((await W.loadTile.atDepth(0, 1, 0)).grid[0], 0);
  assert.equal((await W.loadTile.atDepth(2, 0, 0)).generated, true);
  W.tileCacheFor(0).clear();
  assert.equal((await W.loadTile.atDepth(0, 0, 0)).grid, copy.entries[0].grid);
  console.log('Floor sandbox transfer, isolation, geometry, and spawn checks passed.');
})().catch(e => { console.error(e); process.exitCode = 1; });
