// Paint the pet with the same texture and tint as the world. In particular,
// palette-swapped butterflies and enemies must never inherit another's colour.
const PetStoryArt = (() => {
  function forKind(scene, kind) {
    scene._ensureAsset?.('pet_story_clearing');
    const art = SpriteLayout.creatureArt(kind);
    if (!art || !scene.textures?.exists(art.sheet)
        || !scene.textures.exists('pet_story_clearing')) return null;
    const texture = scene.textures.get(art.sheet);
    const frame = texture.get(texture.frameTotal === 1 ? '__BASE' : (art.directions?.down?.idle?.[0] ?? 0));
    const source = frame?.source?.image || texture.getSourceImage();
    if (!frame || !source) return null;
    const sprite = document.createElement('canvas');
    sprite.width = frame.width; sprite.height = frame.height;
    const pixels = sprite.getContext('2d');
    pixels.drawImage(source, frame.cutX, frame.cutY, frame.width, frame.height,
      0, 0, frame.width, frame.height);
    const rgba = pixels.getImageData(0, 0, sprite.width, sprite.height);
    const tint = SpriteLayout.creatureTint(kind);
    let left = sprite.width, top = sprite.height, right = -1, bottom = -1;
    for (let y = 0; y < sprite.height; y++) for (let x = 0; x < sprite.width; x++) {
      const i = (y * sprite.width + x) * 4;
      if (!rgba.data[i + 3]) continue;
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
      rgba.data[i] *= ((tint >> 16) & 255) / 255;
      rgba.data[i + 1] *= ((tint >> 8) & 255) / 255;
      rgba.data[i + 2] *= (tint & 255) / 255;
    }
    if (right < left) return null;
    pixels.putImageData(rgba, 0, 0);
    const canvas = document.createElement('canvas');
    canvas.width = 352; canvas.height = 448;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(scene.textures.get('pet_story_clearing').getSourceImage(), 0, 0, 352, 448);
    const w = right - left + 1, h = bottom - top + 1;
    const scale = Math.max(1, Math.floor(Math.min(128 / w, 100 / h)));
    const ground = 160, lift = SpriteLayout.creatureAirborne(kind) ? 18 : 0;
    ctx.fillStyle = '#0005';
    ctx.beginPath(); ctx.ellipse(176, ground, w * scale * .42, 6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = SpriteLayout.creatureAlpha(kind);
    ctx.drawImage(sprite, left, top, w, h, Math.round((352 - w * scale) / 2),
      ground - lift - h * scale, w * scale, h * scale);
    return canvas.toDataURL();
  }
  return { forKind };
})();
