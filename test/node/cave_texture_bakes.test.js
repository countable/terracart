(() => {
  const assets = () => Function('SpriteLayout', 'EnemyRoster', `${ASSETS_SRC}; return ASSETS;`)(SpriteLayout, EnemyRoster);

  test('prebuilt cave sheets preserve every connected-wall and chasm frame', () => {
    const catalog = assets();
    for (const [key, columns, rows, height] of [['cave_wall_edges', 64, 4, 35], ['cave_chasm', 16, 1, 32]]) {
      const asset = catalog[key], size = pngDims(asset.path);
      assert.eq(asset.kind, 'spritesheet', key);
      assert.eq(asset.frameWidth, 32, key);
      assert.eq(asset.frameHeight, height, key);
      assert.eq(size.w, columns * 32, key);
      assert.eq(size.h, rows * height, key);
      assert.falsy(asset.deferred, 'cave bakes must be available before scene creation');
    }
    for (let depth = 1; depth <= 7; depth++) {
      const key = 'floor-wall-' + FloorWallMaterials.theme(depth).id;
      const asset = catalog[key], size = pngDims(asset.path);
      assert.eq(asset.kind, 'image', key);
      assert.eq(size.w, 512, key);
      assert.eq(size.h, 160, key);
      assert.falsy(asset.deferred, key);
    }
  });

  test('preloaded cave atlases bypass procedural canvas creation', () => {
    const catalog = assets();
    const scene = {textures: {
      exists: key => !!catalog[key],
      get: key => catalog[key],
      createCanvas: () => { throw new Error('Preloaded cave texture tried to bake'); },
    }};
    const painters = new Function('lerp', TEXTURES_SRC + '\nreturn {makeCaveWallEdges, makeCaveChasmTexture};')(
      (a, b, t) => a + (b - a) * t);
    painters.makeCaveWallEdges(scene, 32);
    painters.makeCaveChasmTexture(scene, 32);
    for (let depth = 1; depth <= 7; depth++) {
      assert.eq(FloorWallMaterials.prepare(scene, depth), catalog['floor-wall-l' + depth]);
    }
  });
})();
