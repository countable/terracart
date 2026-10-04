// Sparse basic grounds use measured occupied-cell budgets, not a universal
// four-percent minimum. Small fields may be completely open for a given seed.
(function () {
test('basic flora: sparse pitches stay open over many deterministic seeds', () => {
  const N = 32, ring = [{x:256,y:256},{x:3584,y:256},{x:3584,y:3584},{x:256,y:3584}];
  let total = 0, cells = 0;
  for (let tx = 0; tx < 40; tx++) {
    const out = WorldGen.rasterizeTile([{name:'landuse',features:[{type:3,tags:{class:'pitch'},geom:[ring]}]}], N, tx, 5, N * 7);
    total += out.wildplants.filter(w => w.crop === 'longgrass' && w._biome === WorldGen.T.PITCH).length;
    cells += out.grid.filter(t => t === WorldGen.T.PITCH).length;
  }
  assert.inRange(total / cells, .001, .015, 'pitch tufts occupy a small fraction, without a four-percent floor');
});
test('basic flora: approved exclusions survive overlapping source polygons', () => {
  const T = WorldGen.T;
  for (const type of [T.GRASS,T.SCHOOL,T.COMMERCIAL,T.PLAYGROUND,T.ORCHARD]) {
    assert.falsy(BiomeProfiles.flora(type).some(f => f.crop === 'marigold'));
    assert.falsy(BiomeProfiles.allows('marigold',type));
  }
  for (const character of BiomeProfiles.PARK_CHARACTER_IDS)
    assert.falsy(BiomeProfiles.flora(T.PARK,character).some(f => f.crop === 'mushroom'));
  assert.falsy(BiomeProfiles.allows('mushroom',T.PARK));
  assert.falsy(BiomeProfiles.allows('mushroom',T.WASTELAND));
  assert.falsy(BiomeProfiles.yardAllows('longgrass',T.RESIDENTIAL));
  assert.truthy(BiomeProfiles.allows('mushroom',T.RESIDENTIAL));
  assert.truthy(BiomeProfiles.flora(T.RESIDENTIAL).some(f => f.crop === 'mushroom'));
  for (const type of [T.FARMLAND,T.GOLF]) {
    assert.eq(BiomeProfiles.flora(type).length,0);
    assert.falsy(BiomeProfiles.allows('longgrass',type));
  }
  // Special motifs are authored directly; the basic profile filter must not
  // remove their declared fungi or flower beds.
  assert.truthy(Object.values(ZoneVariants.materials).some(m => m.crop === 'mushroom'));
  assert.truthy(Object.values(ZoneVariants.materials).some(m => m.crop === 'marigold'));
});
test('basic fauna: deer stay in forest and residential, cats cannot use wasteland', () => {
  const T = WorldGen.T;
  for (const type of Object.values(T)) {
    assert.eq(BiomeProfiles.faunaAllows('deer',type), type === T.FOREST || type === T.RESIDENTIAL);
  }
  for (const pool of [BIOME_FAUNA.deer.primary,BIOME_FAUNA.deer.fallback])
    assert.eq([...pool].sort().join(),[T.FOREST,T.RESIDENTIAL].sort().join());
  for (const pool of [BIOME_FAUNA.cat.primary,BIOME_FAUNA.cat.fallback]) assert.falsy(pool.includes(T.WASTELAND));
  assert.falsy(BiomeProfiles.faunaAllows('cat',T.WASTELAND));
  assert.truthy(BiomeProfiles.faunaAllows('cat',T.RESIDENTIAL));
});
})();
