// GENERATED BARRELS (owner, Oct 2026): a chest stamped `barrel: true` with no
// POI behind it — strewn over the first cave level (worldgen.js caveBarrels)
// and dressed into the seep and the quarries (zone-variants.json `barrel`) —
// smashed on the surface bin's own lane (loot.js isBarrel / rollBarrel): a
// coin, a spear, a torch or an apple when it holds anything,
// BARREL_EMPTY_P_GENERATED (70 %) empty, back daily on the one day ledger.
(function () {
function seeded(seed) {
  let a = seed >>> 0;
  return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

test('generated barrel: a `barrel: true` chest is a barrel at any depth; a bin\'s cave mirror still is not', () => {
  assert.truthy(isBarrel({ kind: 'chest', barrel: true, depth: 1, id: 'cbarrel_1_0_0_3_4' }));
  assert.truthy(isBarrel({ kind: 'chest', barrel: true, id: 'zt_0_0_1_1' }), 'a dressed one on the surface');
  assert.falsy(isBarrel({ kind: 'chest', barrel: true, fixedLoot: { kind: 'item', id: 'iron_bar' } }), 'a fixed find is a crate, whatever it wears');
  assert.truthy(isBarrel({ kind: 'chest', poiClass: 'waste_basket' }), 'the surface bin');
  assert.falsy(isBarrel({ kind: 'chest', poiClass: 'waste_basket', depth: 2 }), 'its mirror underground is a plain chest');
  assert.falsy(isBarrel({ kind: 'mineralrock', barrel: true }), 'only a chest');
});

test('generated barrel: 70% empty, else a coin, a spear, a torch or an apple', () => {
  assert.eq(BARREL_EMPTY_P_GENERATED, 0.7);
  const rng = seeded(7), o = { kind: 'chest', barrel: true, id: 'cbarrel_1_0_0_1_1' };
  let empty = 0; const got = new Set();
  for (let i = 0; i < 20000; i++) {
    const r = rollBarrel(o, rng);
    if (r.kind === 'empty') { empty++; continue; }
    got.add(r.kind === 'gold' ? 'coin' : r.id);
    if (r.kind === 'gold') assert.inRange(r.amount, 1, 3, 'a few coins');
  }
  assert.lt(Math.abs(empty / 20000 - 0.7), 0.015, 'seven in ten are empty');
  assert.eq([...got].sort().join(','), 'apple,coin,spear,torch', 'and nothing else');
  // The surface bin keeps its density-read emptiness (a lone bin: 60 %).
  let binEmpty = 0; const bin = { kind: 'chest', poiClass: 'waste_basket', poiDensity: 1 };
  for (let i = 0; i < 20000; i++) if (rollBarrel(bin, rng).kind === 'empty') binEmpty++;
  assert.lt(Math.abs(binEmpty / 20000 - BARREL_EMPTY_P_BASE), 0.015);
});

test('level 1: a dozen-odd barrels on free floor cells, off their own stream, positional ids; no other level', () => {
  const N = 40, grid = new Uint8Array(N * N).fill(WorldGen.T.CAVE_FLOOR);
  grid[5 * N + 5] = WorldGen.T.CAVE_WALL;
  const occupied = new Set([7 * N + 7]);
  const objects = [];
  WorldGen.caveBarrels(objects, grid, N, 3, 4, N * WorldGen.CELL_M, 1, occupied);
  assert.eq(WorldGen.CAVE_BARREL_DEPTH, 1);
  assert.inRange(objects.length, WorldGen.CAVE_BARREL_MIN, WorldGen.CAVE_BARREL_MIN + WorldGen.CAVE_BARREL_SPAN - 1);
  const cells = new Set();
  for (const b of objects) {
    assert.eq(b.kind, 'chest'); assert.truthy(b.barrel && isBarrel(b)); assert.eq(b.depth, 1);
    const m = /^cbarrel_1_3_4_(\d+)_(\d+)$/.exec(b.id);
    assert.truthy(m, `positional id: ${b.id}`);
    const idx = Number(m[2]) * N + Number(m[1]);
    assert.falsy(idx === 5 * N + 5 || idx === 7 * N + 7, 'never on a wall or a taken cell');
    assert.falsy(cells.has(idx), 'one per cell'); cells.add(idx);
    assert.truthy(occupied.has(idx), 'and it claims its cell');
  }
  const again = [];
  WorldGen.caveBarrels(again, grid, N, 3, 4, N * WorldGen.CELL_M, 1, new Set([7 * N + 7]));
  assert.eq(again.map(b => b.id).join(), objects.map(b => b.id).join(), 'deterministic');
  const deeper = [];
  WorldGen.caveBarrels(deeper, grid, N, 3, 4, N * WorldGen.CELL_M, 2, new Set());
  assert.eq(deeper.length, 0, 'level 2 has none');
  // Wired last in the level build, after the torches, so nothing seated moves.
  assert.truthy(/caveFloorTorches\(objects, grid, N, x, y, tileEdgeM, depth, wildplants, occupied\);\s*\n\s*caveBarrels\(objects, grid, N, x, y, tileEdgeM, depth, occupied\);/.test(WORLDGEN_SRC));
});

test('quarry: the clipped benches read the whole density table, stone and crystal where they were', () => {
  const b = ZoneVariants.byId('quarry').background;
  assert.truthy(b.materialDensity.barrel > 0, 'the quarry scatter carries barrels');
  const sum = Object.values(b.materialDensity).reduce((a, v) => a + v, 0);
  assert.lt(Math.abs(sum - b.nominalDensity), 1e-12, 'the mix sums to the nominal density');
  assert.truthy(/else if \(h < d\.crystal \+ d\.stone \+ \(d\.barrel \|\| 0\)\) put\(x, y, 'barrel'\);/.test(QUARRY_LAYOUT_SRC), 'clipped benches place barrels past the stone band');
  assert.truthy(/put\(r, b, 'barrel'\)/.test(QUARRY_LAYOUT_SRC), 'the abandoned quarry leaves one at a patch corner');
});
})();
