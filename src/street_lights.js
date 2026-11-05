// Street lamp silhouettes and their emitter anchors share one table. Restoration
// still controls every light; themed art never creates a second light source.
const StreetLights = (() => {
  const ART = {
    hanging_lantern: { scale: 1.25, rise: .55, offset: .25 },
    wooden_lantern: { scale: 1.25, rise: .65, offset: .12 },
    fire_pedestal: { scale: 1.2, rise: .65, offset: 0 },
    green_orb: { scale: 1.2, rise: .65, offset: 0 },
    street_lantern: { scale: 1, rise: 1, offset: 0 },
    tall_lantern: { scale: .48, rise: 1, offset: 0 },
    paired_candles: { scale: 2, rise: .44, offset: 0 },
    flame_pillar: { scale: 1.3, rise: .69, offset: 0 },
    upright_flame: { scale: 1.2, rise: .71, offset: 0 },
  };
  const VARIANTS = {
    hedgerow:'hanging_lantern', trade:'hanging_lantern',
    lantern:'wooden_lantern', promenade:'tall_lantern', parkpath:'street_lantern',
    pilgrim:'fire_pedestal', burned:'flame_pillar', fire_path:'upright_flame', barricade:'upright_flame',
    golden_path:'paired_candles',
    poison_path:'green_orb', confusion_path:'green_orb',
  };
  function forVariant(variant) { return VARIANTS[variant] || null; }
  function art(o) { return !o.suppressed && ART[o._streetArt] || null; }
  function key(o) { return art(o) ? 'street_decor_' + o._streetArt + (o.lit ? '' : '_unlit') : o.lit ? 'rogue_lamp' : 'rogue_lamp_unlit'; }
  function scale(o) { return art(o)?.scale || 1.25; }
  function after(sprite, o) {
    sprite.clearTint?.();
  }
  // Source-space emitter regions. Only the light changes: posts, bowls,
  // contact ink and the frame's seating bounds survive extinguishing.
  const GLASS = {
    hanging_lantern: [17, 12, 24, 19], wooden_lantern: [9, 10, 16, 20],
    street_lantern: [5, 12, 11, 18], tall_lantern: [17, 10, 32, 27],
    green_orb: [3, 2, 13, 11],
  };
  function statePixels(data, width, name, lit) {
    if (!ART[name]) return data;
    const glass = GLASS[name];
    for (let i = 0; i < data.length; i += 4) {
      if (!data[i + 3]) continue;
      const x = i / 4 % width, y = Math.floor(i / 4 / width);
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (lit) {
        // This source is a cold, empty lantern. Light its recessed glass;
        // the surrounding frame and metal post keep their original palette.
        if (name === 'street_lantern' && x >= 5 && x < 11 && y >= 12 && y < 18) {
          data[i] = 255; data[i + 1] = y === 12 ? 186 : 222; data[i + 2] = y === 12 ? 92 : 151;
        }
        continue;
      }
      const flame = name === 'fire_pedestal' && r >= 200 && b < 160
        || name === 'flame_pillar' && r === 255
        || name === 'upright_flame' && r >= 240
        || name === 'paired_candles' && y < 6;
      if (flame) { data[i] = data[i + 1] = data[i + 2] = data[i + 3] = 0; continue; }
      if (glass && x >= glass[0] && x < glass[2] && y >= glass[1] && y < glass[3]) {
        const shade = Math.round((r * .2126 + g * .7152 + b * .0722) * .28);
        data[i] = shade; data[i + 1] = shade + 3; data[i + 2] = shade + 5;
      }
    }
    return data;
  }
  function bake(scene, name) {
    if (!ART[name]) return;
    const sourceKey = 'street_decor_' + name;
    const source = scene.textures.get(sourceKey).getSourceImage();
    // Most source images already depict the lit state. The metal lantern
    // needs its glass lit as well as an extinguished counterpart.
    for (const lit of name === 'street_lantern' ? [false, true] : [false]) {
      const canvas = document.createElement('canvas');
      canvas.width = source.width; canvas.height = source.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(source, 0, 0);
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      statePixels(image.data, canvas.width, name, lit); ctx.putImageData(image, 0, 0);
      const textureKey = sourceKey + (lit ? '' : '_unlit');
      if (scene.textures.exists(textureKey)) scene.textures.remove(textureKey);
      scene.textures.addSpriteSheet(textureKey, canvas, { frameWidth: canvas.width, frameHeight: canvas.height });
    }
  }
  return { ART, VARIANTS, forVariant, art, key, scale, after, statePixels, bake };
})();
if (typeof window !== 'undefined') window.StreetLights = StreetLights;
