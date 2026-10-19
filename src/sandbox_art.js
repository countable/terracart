// Session-only review art uses the normal asset catalog and render pools.
(function (root) {
  'use strict';
  const tileKey = (depth, role) => `sandbox-${depth}-tile-${role}`;
  const propKey = object => `sandbox-${object.sandboxDepth}-prop-${object.sandboxArtKey}`;
  function register(data, catalog) {
    for (const [depth, entry] of Object.entries(data.entries)) {
      if (!entry.sandboxArt) continue;
      for (const [role, uri] of Object.entries(entry.sandboxArt.tiles)) {
        if (!uri) continue;
        const key = tileKey(depth, role);
        catalog[key] = {kind: 'image', path: uri, onLoad(scene) {
          const image = scene.textures.get(key).getSourceImage();
          const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
          const g = canvas.getContext('2d'); g.imageSmoothingEnabled = false;
          for (let y = 0; y < 32; y += image.height) for (let x = 0; x < 32; x += image.width)
            g.drawImage(image, x, y);
          scene.textures.remove(key); scene.textures.addCanvas(key, canvas);
        }};
      }
      for (const [name, art] of Object.entries(entry.sandboxArt.props))
        catalog[propKey({sandboxDepth: depth, sandboxArtKey: name})] = {kind: 'image', path: art.uri};
    }
  }
  function groundTexture(entry, index, type) {
    if (!entry?.sandboxArt) return null;
    const cell = entry.sandboxCells?.[index];
    if (!cell || cell === 'wall') return null;
    // L1 water always uses the same sewer source as the real game.
    if (entry.depth === 1 && typeof FloorWallMaterials !== 'undefined') {
      const water = FloorWallMaterials.groundTexture(entry, index, type);
      if (water) return water;
    }
    const role = cell === 'water' || cell === 'lava' ? 'water' : cell === 'accent' || cell === 'path' ? 'accent' : 'ground';
    return entry.sandboxArt.tiles[role] ? tileKey(entry.depth, role) : null;
  }
  function propScale(object, scene) {
    const image = scene.textures.get(propKey(object)).getSourceImage();
    return Math.min(29 / image.width, 31 / image.height);
  }
  root.SandboxArt = {register, groundTexture, propKey, propScale};
  if (root.FloorSandbox?.active() && root.ASSETS) register(root.FloorSandbox.read(), root.ASSETS);
})(typeof window !== 'undefined' ? window : globalThis);
