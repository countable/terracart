test('coastal shrubs: authored beaches and beach parks use palms', () => {
  for (const row of ZoneVariantData.variants.filter(v => v.zone === 'beach' || v.id === 'marine_meadow')) {
    assert.eq(row.materialLooks.shrub, 'palm', row.id);
    const p = { crop: 'shrub', id: 'coastal-bush', _plantArt: row.materialLooks.shrub };
    assert.eq(wildplantSprite(p).sheet, 'beach_palms');
    assert.includes([2, 3, 4, 5], wildplantFrame(p));
    assert.eq(wildplantFrame(p), wildplantFrame({ ...p }), 'stable on reload');
  }
  assert.eq(wildplantOutput('shrub'), 'wood');
  assert.eq(wildplantWorkRelic('shrub'), 'axe');
});
test('coastal shrubs: ordinary sand gets palms without changing other bush looks', () => {
  assert.eq(wildplantSprite({ crop: 'shrub', _biome: WorldGen.T.SAND }).sheet, 'beach_palms');
  assert.eq(wildplantSprite({ crop: 'shrub', _biome: WorldGen.T.GRASS }).sheet, CROP_SPRITE.shrub.sheet);
  assert.eq(wildplantSprite({ crop: 'shrub', _biome: WorldGen.T.SAND, _cave: true }).sheet, CROP_SPRITE.shrub.sheet);
  assert.eq(wildplantSprite({ crop: 'shrub', _biome: WorldGen.T.SAND, _plantArt: 'clipped' }).sheet, 'approved_clipped_hedge');
});
