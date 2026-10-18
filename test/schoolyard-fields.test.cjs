const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function fixture() {
  const N = 20, tileCache = new Map();
  const context = {
    SchoolyardGame: { SPEC: { size: 7 } },
    WorldGen: { T: { SCHOOL: 15 }, tileCache, tileKey: (x, y) => `16/${x}/${y}`,
      privateVetoAt: () => false, spawnOptsOf: e => e,
      isSpawnCell: (grid, w, h, x, y, opts, cls) => { assert.equal(cls, 'reward'); return !opts.blocked?.has(y * w + x); } },
    tileCellToAbs: (s, tx, ty, x, y) => ({ cellIX: tx * N + x, cellIY: ty * N + y }),
    absCellOffset: (s, x, y, dx, dy) => ({ cellIX: x + dx, cellIY: y + dy }),
    absCellToTile: (s, x, y) => ({ tx: Math.floor(x / N), ty: Math.floor(y / N) }),
    SpawnOwnership: { footprintCells: (s, o) => [{ cellIX: o.x, cellIY: o.y }] },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('src/schoolyard_fields.js', 'utf8'), context);
  function tile(tx) {
    const entry = { grid: new Uint8Array(N * N), cellsPerEdge: N, _spawned: true, objects: [] };
    tileCache.set(`16/${tx}/0`, entry); return entry;
  }
  function paint(entry, x0, x1) { for (let y = 5; y <= 13; y++) for (let x = x0; x <= x1; x++) entry.grid[y * N + x] = 15; }
  return { scene: { depth: 0, save: {} }, fields: context.SchoolyardFields.fields, tile, paint };
}
test('one centered flag, safe connected board, stable after object placement', () => {
  const f = fixture(), e = f.tile(0); f.paint(e, 5, 13);
  const [first] = f.fields(f.scene);
  assert.equal(first.cellIX, 9); assert.equal(first.cellIY, 9); assert.equal(first.cells.length, 49);
  e.objects.push({ x: 10, y: 9 });
  e.blocked = new Set([8 * 20 + 9]);
  const [second] = f.fields(f.scene);
  assert.equal(second.id, first.id); assert.equal(second.cellIX, 9);
  assert.equal(second.cells.length, 47);
  assert.ok(!second.cells.some(c => c.cellIX === 10 && c.cellIY === 9));
  e.objects.push({ x: 9, y: 9 });
  assert.equal(f.fields(f.scene).length, 0, 'occupied flag disappears without relocating');
});
test('field spanning tiles waits for its full boundary and produces one flag', () => {
  const f = fixture(), left = f.tile(0); f.paint(left, 14, 19);
  assert.equal(f.fields(f.scene).length, 0);
  const right = f.tile(1); f.paint(right, 0, 5);
  const fields = f.fields(f.scene);
  assert.equal(fields.length, 1); assert.equal(fields[0].cellIX, 19);
  assert.equal(fields[0].cells.length, 49);
});
test('non-school and underground scenes do not acquire flags', () => {
  const f = fixture(); f.tile(0);
  assert.equal(f.fields(f.scene).length, 0);
  f.scene.depth = 1;
  assert.equal(f.fields(f.scene).length, 0);
});
