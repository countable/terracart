// Shared sources must outlive individual logical sheet aliases.
(function () {
  function fixture() {
    const source = { image: {}, destroyed: false, destroy() { this.destroyed = true; } };
    const textures = new Map([[SelectedWorldAtlas.key, { source: [source] }]]);
    let creates = 0;
    const manager = {
      get: key => textures.get(key), exists: key => textures.has(key),
      create(key, sources) {
        creates++;
        assert.eq(sources.length, 0, 'aliases allocate no separate image or GPU source');
        const texture = {
          source: sources, frames: {},
          add(name, index, x, y, width, height) { this.frames[name] = { index, x, y, width, height }; },
          remove(name) { delete this.frames[name]; },
          destroy() {
            for (const owned of this.source) owned.destroy();
            textures.delete(key);
          },
        };
        textures.set(key, texture);
        return texture;
      },
    };
    return { scene: { textures: manager }, source, textures, creates: () => creates };
  }
  test('art atlas: all logical frames share one source and retain their packed rectangles', () => {
    const f = fixture();
    ArtAtlas.register(f.scene, SelectedWorldAtlas);
    for (const [key, asset] of Object.entries(SelectedWorldAtlas.entries)) {
      const texture = f.textures.get(key);
      assert.eq(texture.source[0], f.source, key + ' shares the atlas source');
      assert.eq(texture.firstFrame, 0);
      assert.eq(Object.keys(texture.frames).length, Object.keys(asset.frameRects).length + 1);
      for (const [frame, rect] of Object.entries(asset.frameRects)) {
        for (const dimension of ['x', 'y', 'width', 'height']) {
          assert.eq(texture.frames[frame][dimension], rect[dimension], `${key}:${frame} ${dimension}`);
        }
      }
    }
    const count = f.creates();
    const barrel = f.textures.get('barrel');
    ArtAtlas.register(f.scene, SelectedWorldAtlas);
    assert.eq(f.creates(), count, 'registration is idempotent');
    assert.eq(f.textures.get('barrel'), barrel);
  });
  test('art atlas: removing an alias preserves the master and sibling sources', () => {
    const f = fixture();
    ArtAtlas.register(f.scene, SelectedWorldAtlas);
    f.textures.get('barrel').destroy();
    assert.eq(f.textures.has('barrel'), false);
    assert.eq(f.source.destroyed, false, 'alias does not destroy master-owned source');
    assert.eq(f.textures.get('box').source[0], f.source);
    assert.eq(f.textures.get(SelectedWorldAtlas.key).source[0], f.source);
    ArtAtlas.register(f.scene, SelectedWorldAtlas);
    assert.eq(f.textures.get('barrel').source[0], f.source, 'removed alias can be registered again');
  });
})();
