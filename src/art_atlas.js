// Logical sprite sheets share one decoded image and one GPU TextureSource.
// Numeric frames stay local to their original keys; atlas rectangles own offsets.
const ArtAtlas = (() => {
  function register(scene, data) {
    const manager = scene.textures;
    const master = manager.get(data.key);
    for (const [key, asset] of Object.entries(data.entries)) {
      // A selected art profile can replace an alias with its own sheet. The
      // shared atlas may finish loading first: do not claim that sheet's key
      // while its image is still in flight, or Phaser keeps the wrong pixels.
      const selected = typeof ASSETS !== 'undefined' ? ASSETS[key] : null;
      if (selected && (selected.kind !== 'atlas-alias' || selected.atlasKey !== data.key)) continue;
      if (manager.exists(key)) continue;
      let texture;
      if (manager.create && master.source) {
        // Phaser's addSpriteSheetFromAtlas creates another TextureSource (and
        // GPU upload). An empty Texture lets aliases share the original source.
        texture = manager.create(key, []);
        texture.source = master.source.slice();
        const destroy = texture.destroy;
        texture.destroy = function () {
          // The master owns the shared source. Removing an alias must not
          // delete its siblings' image or WebGL texture.
          this.source = [];
          return destroy.call(this);
        };
      } else {
        // Dashboard adapters have only image/frame registration, no GPU source.
        texture = manager.addImage(key, master.getSourceImage());
      }
      const base = asset.sheetRect;
      texture.remove('__BASE');
      texture.add('__BASE', 0, base.x, base.y, base.width, base.height);
      for (const [frame, rect] of Object.entries(asset.frameRects)) {
        texture.add(Number(frame), 0, rect.x, rect.y, rect.width, rect.height);
      }
      // Phaser normally sets firstFrame while parsing a spritesheet.
      texture.firstFrame = 0;
    }
  }
  function install(assets, data) {
    Object.assign(assets, data.entries);
    assets[data.key] = { kind: 'image', path: data.path, onLoad: scene => register(scene, data) };
  }
  return { install, register };
})();
