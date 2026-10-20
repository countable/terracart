/* Roof variants share the authored UVs and shading. Prepare these alongside
   the source materials at startup; placement only reuses cached textures. */
(function(root) {
  'use strict';
  const COLORS = Object.freeze({
    yellow: [46, .76], slate: [213, .24], green: [139, .47],
    teal: [180, .57], lime: [83, .58], blue: [211, .60], purple: [270, .48],
    red: [2, .62], orange: [27, .76], plum: [312, .43],
    copper: [24, .59], rust: [18, .59]
  });

  function roofFace(face, key) {
    if (face.roofPalette === false || face.kind !== 'roof' ||
        ['chimney', 'porch', 'dormer'].includes(face.feature)) return false;
    if (face.roofPalette === true) return true;
    const p = face.points;
    if (!p || p.length < 3) return false;
    // The separate timber-strip atlas is never roofing. Adobe coping uses
    // the same columns below that strip and is part of its roof palette.
    if (p.every(v => v.tu * 512 >= 480 && v.tv * 1024 < 616)) return false;
    const a = p[0], b = p[1], c = p[2];
    const nz = (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
    if (nz <= 1e-8) return false;
    const uvArea = Math.abs((b.tu-a.tu)*(c.tv-a.tv)-(b.tv-a.tv)*(c.tu-a.tu));
    // Constant UVs on ordinary models are pipe caps, beam ends and shadow
    // closures. Flat adobe decks deliberately use a single painted swatch.
    return uvArea > 1e-10 || key.startsWith('flat_');
  }

  function recolor(r, g, b, color, key) {
    const hi = Math.max(r, g, b), lo = Math.min(r, g, b);
    if (hi < 30 || hi-lo < 9) return [r, g, b];
    // Blue slate shares source rectangles with warm timber ridges. Keep
    // those timber pixels unchanged even when the ridge is a roof face.
    if ((key === 'com' || key === 'trader') && r > b * 1.1) return [r, g, b];
    const light = (hi+lo)/510;
    const saturation = (hi-lo)/255/(1-Math.abs(2*light-1));
    const [hue, targetSaturation] = color;
    const sat = targetSaturation * .8 + saturation * .2;
    const chroma = (1-Math.abs(2*light-1))*sat;
    const h = hue/60, x = chroma*(1-Math.abs(h%2-1)), m = light-chroma/2;
    const rgb = h<1 ? [chroma,x,0] : h<2 ? [x,chroma,0] : h<3 ? [0,chroma,x]
      : h<4 ? [0,x,chroma] : h<5 ? [x,0,chroma] : [chroma,0,x];
    return rgb.map(v => Math.round((v+m)*255));
  }

  function prepare(scene, texture, model, colorName) {
    if (!texture || !model || !COLORS[colorName]) return texture;
    const key = model.authoredKey || model.key || '';
    const cacheKey = texture.key + ':roof:' + key + ':' + colorName;
    let variant;
    if (scene.textures.exists(cacheKey)) variant = scene.textures.get(cacheKey);
    else {
      const image = texture.getSourceImage();
      variant = scene.textures.createCanvas(cacheKey, image.width, image.height);
      const context = variant.getContext();
      context.imageSmoothingEnabled = false;
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, image.width, image.height);
      const data = pixels.data;
      for (let i=0; i<data.length; i+=4) {
        if (!data[i+3]) continue;
        const rgb = recolor(data[i], data[i+1], data[i+2], COLORS[colorName], key);
        data[i] = rgb[0]; data[i+1] = rgb[1]; data[i+2] = rgb[2];
      }
      context.putImageData(pixels, 0, 0);
      variant.refresh();
      variant.setFilter(Phaser.Textures.FilterMode.NEAREST);
    }
    for (const face of model.faces || []) {
      face.texture = roofFace(face, key) ? variant : texture;
    }
    return variant;
  }
  root.AuthoredRoofPalette = { COLORS, prepare, roofFace };
})(typeof window !== 'undefined' ? window : globalThis);
