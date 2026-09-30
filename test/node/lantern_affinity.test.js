(function () {
const SV = StreetVariants, N = 40;
const line = [{ x: 5, y: 20 }, { x: 30, y: 20 }];
function apply(grid, pois = [], lines = [line]) {
  const index = { extent: N, lines: lines.map(line => ({ line, key: 'destination', affinityKey: 'destination', size: 'major', variantEligible: true })) };
  for (const _ of SV.applyAffinitiesSteps(index, null, N, 7, { grid, pois })) {}
  return index.lines[0].affinityContext;
}
const probability = context => SV.selectionWeights(null, 'major', context).find(r => r.id === 'lantern').probability;
test('Lantern Row favours streets beside public areas and approaches to POI rewards', () => {
  const grid = new Uint8Array(N * N).fill(WorldGen.T.RESIDENTIAL);
  const plain = apply(grid);
  const poi = apply(grid, [{ ix: 32, iy: 20 }]);
  assert.gt(poi.destination, 0, 'road endpoint detects nearby real POI');
  assert.gt(probability(poi), probability(plain), 'destination affinity increases Lantern Row share');
  const far = apply(grid, [{ ix: 38, iy: 20 }]);
  assert.eq(far.destination, undefined, 'distant POI cannot bias this street');
  for (let x = 5; x <= 30; x++) grid[22 * N + x] = WorldGen.T.PARK;
  const park = apply(grid);
  assert.gt(probability(park), probability(plain), 'nearby public ground favours lanterns without a named POI');
  for (const terrain of [WorldGen.T.ROAD, WorldGen.T.ROAD_MD, WorldGen.T.ROAD_LG, WorldGen.T.PATH]) {
    assert.eq(apply(new Uint8Array(N * N).fill(terrain)).destination, undefined,
      'routes alone are not destinations');
  }
});
test('Lantern destination affinity receives public ground during real tile generation', () => {
  const layers = [
    { name: 'landuse', features: [{ type: 3, tags: { class: 'park' }, geom: [[
      { x: 0, y: 0 }, { x: 4096, y: 0 }, { x: 4096, y: 4096 }, { x: 0, y: 4096 },
    ]] }] },
    { name: 'transportation', extent: 4096, features: [{ type: 2,
      tags: { class: 'secondary', name: 'Public Approach' },
      geom: [[{ x: 1000, y: 2048 }, { x: 3000, y: 2048 }]] }] },
  ];
  const tile = WorldGen.rasterizeTile(layers, 64, 5, 7, 64 * 7);
  assert.gt(tile.streetIndex.lines[0].affinityContext.destination, 0,
    'late affinity pass receives the actual public land grid');
});
test('Lantern destination affinity preserves rarity, duplicate geometry and ordering', () => {
  const grid = new Uint8Array(N * N).fill(WorldGen.T.RESIDENTIAL), pois = [{ ix: 32, iy: 20 }];
  const plain = apply(grid), destination = apply(grid, pois);
  const reversed = apply(grid, pois, [line.slice().reverse(), line]);
  assert.eq(JSON.stringify(destination), JSON.stringify(reversed));
  assert.inRange(Object.values(destination).reduce((sum, n) => sum + n, 0), .999999, 1.000001);
  for (let i = 0; i < 1000; i++) {
    assert.eq(!!SV.variantFor('lantern-destination-' + i, null, 'major', plain),
      !!SV.variantFor('lantern-destination-' + i, null, 'major', destination));
  }
});
})();
