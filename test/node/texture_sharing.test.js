(() => {
  function assets() {
    return Function('SpriteLayout', 'EnemyRoster', `${ASSETS_SRC}; return ASSETS;`)(SpriteLayout, EnemyRoster);
  }
  test('shared enemy atlases load once and preserve every authored directional frame', () => {
    const loaded = assets();
    const path = 'assets/Enemy/spr_mini_monsters_spritesheet.png';
    const rows = EnemyRoster.ROWS.filter(row => !row.variantOf && row.art.path === path);
    assert.gt(rows.length, 1);
    assert.eq(Object.values(loaded).filter(asset => asset.path === path).length, 1);
    const sheet = SpriteLayout.creatureSheet(rows[0].id);
    for (const row of rows) {
      const art = SpriteLayout.creatureArt(row.id);
      assert.eq(art.sheet, sheet, row.id);
      assert.eq(loaded[art.sheet].frameWidth, row.art.frameWidth);
      assert.eq(loaded[art.sheet].frameHeight, row.art.frameHeight);
      for (const [facing, poses] of Object.entries(row.art.directions)) {
        for (const [pose, frames] of Object.entries(poses)) {
          assert.eq(JSON.stringify(art.directions[facing][pose]), JSON.stringify(frames), `${row.id} ${facing} ${pose}`);
        }
        const c = { kind:row.id, _facing:facing };
        assert.eq(SpriteLayout.creatureAppearance(c, 0).frame, poses.idle[0]);
      }
    }
    for (const row of EnemyRoster.ROWS.filter(row => row.palette && !row.variantOf)) {
      assert.eq(SpriteLayout.creatureSheet(row.id), row.id, 'recoloured textures stay independent');
      assert.eq(typeof loaded[row.id].onLoad, 'function');
    }
  });
  test('shipwreck runtime texture preserves logical footprint at native 2x resolution', () => {
    const asset = assets().shipwreck_shrine;
    const original = pngDims('assets/Objects/Beach/shipwreck_shrine.png');
    const runtime = pngDims(asset.path);
    const art = SpriteLayout.SHIPWRECK_SHRINE_ART;
    assert.eq(runtime.w, asset.frameWidth);
    assert.eq(runtime.h, asset.frameHeight);
    assert.eq(runtime.w * art.scale, SpriteLayout.CELL_PX * art.extentCells);
    assert.eq(runtime.w / runtime.h, original.w / original.h);
    assert.lte(runtime.w * runtime.h, original.w * original.h / 64);
  });
})();
