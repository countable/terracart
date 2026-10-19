// Native terrain selection must use complete cells and preserve the legacy
// renderer contract: stable variant keys, authored cave overrides and shore layers.
(() => {
  const art = new Function('lerp', TEXTURES_SRC + '\nreturn { setSelectedTerrainSource, drawSelectedTerrain, drawBiomeTexture, drawInteriorFloorTexture, BIOME_TEX };')((a, b, t) => a + (b - a) * t);
  const source = { width: 112, height: 16 };
  function canvas() {
    const draws = [];
    return { draws, save() {}, restore() {}, drawImage(...args) { draws.push(args); } };
  }
  test('selected terrain: both grass and lava variants retain their native crop and repeat stably', () => {
    art.setSelectedTerrainSource(source);
    for (const [type, frames] of [[0, [4, 5]], [26, [2, 3]]]) {
      for (let variant = 0; variant < 8; variant++) {
        const ctx = canvas();
        art.drawBiomeTexture(ctx, 32, type, variant, 0.75);
        assert.eq(ctx.draws.length, 1, 'only the native tile is drawn, without procedural marks');
        assert.eq(ctx.draws[0][0], source, 'registered native atlas');
        assert.eq(ctx.draws[0].slice(1).join(','), `${frames[variant % 2] * 16},0,16,16,0,0,32,32`, 'complete native16 crop, stable variant');
        assert.eq(ctx.imageSmoothingEnabled, false, 'nearest-neighbour scaling');
      }
    }
  });
  test('selected terrain: building polygon floors and grid cells share the same selected tile', () => {
    art.setSelectedTerrainSource(source);
    for (const type of [9, 12]) {
      const ground = canvas(), polygon = canvas();
      art.drawBiomeTexture(ground, 32, type);
      art.drawInteriorFloorTexture(polygon, 32, {}, type);
      assert.eq(JSON.stringify(ground.draws), JSON.stringify(polygon.draws), 'building representations agree');
    }
  });
  test('selected terrain: water and unselected biomes keep their existing painters', () => {
    art.setSelectedTerrainSource(source);
    for (const type of [1, 3, 11, 23, 25]) {
      const ctx = canvas();
      assert.falsy(art.drawSelectedTerrain(ctx, 32, type), 'no native override');
      assert.eq(ctx.draws.length, 0, 'caller may use the existing painter');
    }
    art.setSelectedTerrainSource(null);
    assert.falsy(art.drawSelectedTerrain(canvas(), 32, 0), 'missing atlas falls back gracefully');
  });
})();
