// Seam ownership — the rule that replaced the cross-tile spawn dedup.
//
// An MVT tile carries every feature inside its BUFFER, so a POI point near a
// seam, or a building straddling one, reaches two (or four) tiles. The old
// answer was collectDedupIndex: each newly-built tile dropped any chest/house
// near one already in the cache — so the copy that survived was the one in
// whichever tile LOADED FIRST. Two players (or one player before and after a
// rebuild) could hold different houses under different ids, and the dedup ran
// outside the sliced build scanning the whole cache.
//
// Now each copy is minted by exactly one tile, decided from the data alone:
//   • a POI (chest / parking X) belongs to the tile whose square [0, EXTENT)
//     holds its point;
//   • a house belongs to the tile whose square holds its FULL footprint's
//     anchor — both tiles shape the building with the same 3-cell pad, so
//     both compute the same anchor — and the other tile's half of the
//     footprint resolves to the owner's id.
// These tests build the two tiles either side of a seam, in either order.
(function () {
const T = WorldGen.T;
const CPE = 64;
const EDGE_M = CPE * 7;
const EXTENT = 4096;
const CELL_MVT = EXTENT / CPE;
const TY = 5, TXA = 10, TXB = 11;       // A is west of B; the seam is A's x = EXTENT
const rect = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }, { x: x0, y: y0 }];
// One small house straddling the seam, most of it in A: in A's MVT units it
// runs from 2.3 cells west of the seam to 1.3 cells east of it.
const HOUSE_A = rect(EXTENT - 2.3 * CELL_MVT, 20.2 * CELL_MVT, EXTENT + 1.3 * CELL_MVT, 22.8 * CELL_MVT);
const shift = (ring, dx) => ring.map((p) => ({ x: p.x + dx, y: p.y }));
// A POI 0.6 cells east of the seam: inside B's square, in A's buffer.
const POI_A = { x: EXTENT + 0.6 * CELL_MVT, y: 40.5 * CELL_MVT };
function layersFor(dx) {
  return [
    { name: 'building', features: [{ type: 3, tags: {}, geom: [shift(HOUSE_A, dx)] }] },
    { name: 'poi', features: [
      { type: 1, tags: { class: 'restaurant', name: 'Seam Cafe' }, geom: [[{ x: POI_A.x + dx, y: POI_A.y }]] },
      { type: 1, tags: { class: 'parking' }, geom: [[{ x: POI_A.x + dx, y: POI_A.y + 8 * CELL_MVT }]] },
    ] },
  ];
}
const buildA = () => WorldGen.rasterizeTile(layersFor(0), CPE, TXA, TY, EDGE_M);
const buildB = () => WorldGen.rasterizeTile(layersFor(-EXTENT), CPE, TXB, TY, EDGE_M);
const houses = (r) => r.objects.filter((o) => o.kind === 'house');
const chests = (r) => r.objects.filter((o) => o.kind === 'chest');
// Every ownerKey stamped on a building cell of this tile.
const cellKeys = (r) => {
  const out = new Set();
  for (let i = 0; i < r.owners.length; i++) if (r.owners[i]) out.add(r.ownerKeys[r.owners[i]]);
  return out;
};

test('seam ownership: the cross-tile dedup index is gone', () => {
  assert.eq(WorldGen.collectDedupIndex, undefined,
    'a load-order dedup must not come back — ownership is decided from the data');
});

test('seam ownership: a house straddling a seam is minted by exactly ONE tile', () => {
  const a = buildA(), b = buildB();
  const all = [...houses(a), ...houses(b)];
  assert.eq(all.length, 1, 'one building, one house object across both tiles');
  const h = all[0];
  assert.eq(houses(a).length, 1, 'the tile holding most of the footprint owns it');
  assert.truthy(/^h_10_5_\d+_\d+$/.test(h.id), `owner id is tile + local cell: ${h.id}`);
  // Both halves of the footprint resolve to the owner's id, so a claim reads
  // the same from either side of the seam.
  assert.truthy(cellKeys(a).has(h.id), 'the owner tile\'s cells resolve to the house');
  assert.truthy(cellKeys(b).has(h.id), 'the other tile\'s half resolves to the SAME house');
  assert.eq(cellKeys(b).size, 1, 'and to nothing else');
});

test('seam ownership: load order changes nothing (same survivors, same ids)', () => {
  const ab = [buildA(), buildB()];
  const ba = [buildB(), buildA()].reverse();
  const sig = (rs) => rs.map((r) => r.objects.map((o) => `${o.kind}:${o.id}`).sort().join(',')).join(' | ');
  assert.eq(sig(ba), sig(ab), 'building the tiles in the other order yields the identical world');
});

test('seam ownership: a POI in a tile\'s buffer is minted only by the tile that owns its point', () => {
  const a = buildA(), b = buildB();
  assert.eq(chests(a).length, 0, 'the west tile sees the point in its buffer and leaves it');
  assert.eq(chests(b).length, 1, 'the east tile owns the point and mints the chest');
  assert.truthy(/^c_11_5_\d+_\d+$/.test(chests(b)[0].id), `chest id is tile + cell: ${chests(b)[0].id}`);
  assert.eq(a.parkingTreasures.length, 0, 'same for a parking X: not the west tile\'s');
  assert.eq(b.parkingTreasures.length, 1, 'the owner lays the X');
  assert.truthy(/^t_park_11_5_\d+_\d+$/.test(b.parkingTreasures[0].id), 'parking id is tile + cell');
});

test('seam ownership: a building wholly inside one tile is untouched by the rule', () => {
  const inner = [{ name: 'building', features: [{ type: 3, tags: {},
    geom: [rect(10.2 * CELL_MVT, 10.2 * CELL_MVT, 12.8 * CELL_MVT, 12.8 * CELL_MVT)] }] }];
  const r = WorldGen.rasterizeTile(inner, CPE, TXA, TY, EDGE_M);
  assert.eq(houses(r).length, 1, 'an interior house is still minted');
  assert.eq(T.BUILDING, houses(r)[0].tier, 'as a small house');
});
})();
