// Exercise the late affinity pass through real tile generation.
(function () {
const SV = StreetVariants, N = 64, tx = 5, ty = 7, edge = N * 7;
const line = [{ x: 600, y: 2048 }, { x: 3000, y: 2048 }];
function layers(name) {
  return [
    { name: 'landcover', features: [{ type: 3, tags: { class: 'meadow' }, geom: [[
      { x: 0, y: 0 }, { x: 4096, y: 0 }, { x: 4096, y: 4096 }, { x: 0, y: 4096 },
    ]] }] },
    { name: 'transportation', extent: 4096,
      features: [{ type: 2, tags: { class: 'minor', name }, geom: [line] }] },
    { name: 'transportation_name', features: [{ type: 2, tags: { name }, geom: [line] }] },
    { name: 'poi', features: [] },
  ];
}
function nameFor(hedged) {
  for (let n = 0; n < 10000; n++) {
    const name = 'Affinity probe ' + n;
    const r = SV.buildIndex(layers(name), tx, ty, edge / 4096).lines[0];
    if (r.variant && r.rocks === !hedged && SV.rocksFor(r.key, r.size, null)) return name;
  }
  throw new Error('No road fixture with the required initial rock eligibility');
}
for (const hedged of [false, true]) test(`street affinities: ${hedged ? 'new' : 'removed'} verge rocks preserve the cave substrate`, () => {
  const original = SV.applyAffinitiesSteps;
  try {
    const name = nameFor(hedged);
    // Capture the seeded substrate before the late, contextual theme choice.
    SV.applyAffinitiesSteps = function* () {};
    const before = WorldGen.rasterizeTile(layers(name), N, tx, ty, edge);
    SV.applyAffinitiesSteps = function* (index) {
      for (const r of index.lines) {
        r.variant = hedged ? null : 'toadstool';
        r.rocks = SV.rocksFor(r.key, r.size, r.variant);
      }
      if (hedged) index.dressingLines = [];
      else for (const r of index.dressingLines || []) r.variant = 'toadstool';
      yield 'forced affinity';
    };
    const after = WorldGen.rasterizeTile(layers(name), N, tx, ty, edge);
    const surface = after.objects.filter(o => o._street && !o.chestTopUp);
    const cave = after.caveSource.objects.filter(o => o._street);
    if (hedged) {
      assert.gt(surface.length, 0, 'newly eligible verge has rocks');
      assert.eq(cave.length, 0, 'new surface rocks cannot create cave entrances');
      const ids = surface.map(o => o.id);
      assert.eq(new Set(ids).size, ids.length, 'new rocks have distinct cell identities');
    } else {
      assert.eq(surface.length, 0, 'Mushroom Lane has no generic rock clusters');
      assert.gt(cave.length, 0, 'original rock clusters still seed caves');
    }
    assert.eq(JSON.stringify(after.caveSource), JSON.stringify(before.caveSource),
      'contextual preference cannot alter cave-generation inputs');
  } finally {
    SV.applyAffinitiesSteps = original;
  }
});
test('Mushroom Lane removes generic rocks through the real affinity and terrain pipeline', () => {
  const name = nameFor(false), original = SV.variantFor;
  try {
    SV.variantFor = () => 'toadstool';
    const result = WorldGen.rasterizeTile(layers(name), N, tx, ty, edge);
    assert.truthy(result.streetArea.some(Boolean));
    assert.truthy(result.streetIndex.lines.every(r => !r.rocks));
    assert.gt(result.caveSource.objects.filter(o => o._street === true).length, 0,
      'the original rock substrate remains available to caves');
    assert.eq(result.objects.filter(o => o._street === true).length, 0,
      'no generic street rocks survive on the surface');
    assert.gt(result.streetDress.wildplants.length, 0, 'the variant still supplies its own flora');
  } finally {
    SV.variantFor = original;
  }
});
})();
