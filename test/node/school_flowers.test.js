(function () {
test('wild forget-me-nots belong only to school ground, including polygon overlap filtering', () => {
  for (const terrain of Object.values(WorldGen.T)) {
    const flowers = BiomeProfiles.flora(terrain).filter(f => f.crop === 'forgetmenot');
    assert.eq(flowers.length > 0, terrain === WorldGen.T.SCHOOL, 'only school profiles scatter forget-me-nots');
    assert.eq(BiomeProfiles.allows('forgetmenot', terrain), terrain === WorldGen.T.SCHOOL,
      'final terrain filter cannot leak school flowers onto adjacent ground');
  }
  for (const character of BiomeProfiles.PARK_CHARACTER_IDS) {
    assert.falsy(BiomeProfiles.flora(WorldGen.T.PARK, character).some(f => f.crop === 'forgetmenot'));
  }
  assert.truthy(BiomeProfiles.flora(WorldGen.T.GRASS).some(f => f.crop === 'flowers'), 'other ground keeps ordinary flowers');
  assert.falsy(Object.values(ZoneVariants.materials).some(m => m.crop === 'forgetmenot'), 'special zones use other flowers');
});
test('all generated biome and zone flowers have canonical map art', () => {
  const crops = new Set();
  for (const terrain of Object.values(WorldGen.T)) {
    for (const fl of BiomeProfiles.flora(terrain)) crops.add(fl.crop);
  }
  for (const character of BiomeProfiles.PARK_CHARACTER_IDS) {
    for (const fl of BiomeProfiles.flora(WorldGen.T.PARK, character)) crops.add(fl.crop);
  }
  for (const material of Object.values(ZoneVariants.materials)) {
    if (material.kind === 'wildplant') crops.add(material.crop);
  }
  for (const crop of crops) assert.truthy(CROP_SPRITE[crop] || Number.isInteger(CROP_ROW[crop]),
    `${crop} has explicit map art instead of the arbitrary crop fallback`);
  assert.eq(CROP_SPRITE.flowers.sheet, 'props');
  assert.eq(CROP_SPRITE.flowers.frame, 12, 'same pink blossom as the inventory icon');
});
test('school flowers actually spawn on school tiles but not ordinary grassland', () => {
  const ring = [{x:0,y:0},{x:4096,y:0},{x:4096,y:4096},{x:0,y:4096}];
  const build = cls => WorldGen.rasterizeTile([{ name: cls === 'grass' ? 'landcover' : 'landuse', features: [
    { type: 3, tags: { class: cls }, geom: [ring] },
  ] }], 64, 3, 5, 64 * 7);
  const school = build('school'), grass = build('grass');
  assert.gt(school.wildplants.filter(w => w.crop === 'forgetmenot').length, 0);
  assert.eq(grass.wildplants.filter(w => w.crop === 'forgetmenot').length, 0);
  assert.gt(grass.wildplants.filter(w => w.crop === 'flowers').length, 0);
});
})();
