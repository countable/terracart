/* Roof variants share the authored UVs and shading. Prepare these alongside
   the source materials at startup; placement only reuses cached textures. */
(function(root) {
  'use strict';
  const COLORS = Object.freeze({
    yellow: [46, .76], slate: [213, .24], green: [139, .47],
    teal: [180, .57], lime: [83, .58], blue: [211, .60], purple: [270, .48],
    red: [2, .62], orange: [27, .76], plum: [312, .43], rose: [340, .55],
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
  const emblems = new WeakMap();
  const EMBLEM_SIZE = 32;

  function emblemGlyph(role) {
    if (typeof Render === 'undefined') return null;
    // Reuse the actual category signs, including the smith's armour symbol.
    // Traders already use this arrow for their barter; generic shops use supplies.
    if (role === 'trader') return typeof TRADE_ARROW_PX !== 'undefined' ? TRADE_ARROW_PX : null;
    if (role === 'fort') return [
      '#########', '#.......#', '#.#...#.#', '#.......#', '#...#...#',
      '#.......#', '#.#...#.#', '#.......#', '#########'];
    return Render.shopSignGlyph(role === 'shop' ? 'supply' : role, role);
  }

  function getEmblem(scene, role, colorName) {
    return emblems.get(scene.textures)?.get(role + ':' + colorName) || null;
  }

  function prepareEmblem(scene, role, colorName, roofTexture) {
    const existing = getEmblem(scene, role, colorName);
    if (existing) return existing;
    const glyph = emblemGlyph(role), color = COLORS[colorName];
    if (!glyph || !color || !roofTexture) return null;
    // Center the visible ink rather than the padded glyph box. This also
    // balances top-heavy marks such as the smith's shield within the plaque.
    const cells = glyph.flatMap((row, y) => [...row].flatMap((cell, x) => cell === '#' ? [{x, y}] : []));
    if (!cells.length) return null;
    const scale = 2;
    const left = Math.round(EMBLEM_SIZE / 2 - scale * cells.reduce((sum, p) => sum + p.x + .5, 0) / cells.length);
    const top = Math.round(EMBLEM_SIZE / 2 - scale * cells.reduce((sum, p) => sum + p.y + .5, 0) / cells.length);
    const key = `authored:emblem:${role}:${colorName}:plaques`;
    let texture = scene.textures.exists(key) ? scene.textures.get(key) : null;
    if (!texture) {
      // Roof, front board and their solid sides share one startup atlas. The
      // geometry supplies rounded corners and thickness, not alpha cutouts.
      texture = scene.textures.createCanvas(key, 512, 1024);
      const context = texture.getContext();
      context.imageSmoothingEnabled = false;
      context.drawImage(roofTexture.getSourceImage(), 256, 616, EMBLEM_SIZE, EMBLEM_SIZE,
        0, 0, EMBLEM_SIZE, EMBLEM_SIZE);
      const data = context.getImageData(0, 0, EMBLEM_SIZE, EMBLEM_SIZE).data;
      const sum = [0, 0, 0];
      let count = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (!data[i + 3]) continue;
        for (let c = 0; c < 3; c++) sum[c] += data[i + c];
        count++;
      }
      const rgb = sum.map(value => value / Math.max(1, count)), peak = Math.max(...rgb);
      const roofInk = gain => {
        const factor = Math.min(gain, peak ? 255 / peak : gain);
        return `rgb(${rgb.map(value => Math.round(value * factor)).join(',')})`;
      };
      const rect = (ink, x, y, w, h) => {
        context.fillStyle = ink;
        context.fillRect(x, y, w, h);
      };
      const symbol = (x0, offset, ink) => {
        context.fillStyle = ink;
        glyph.forEach((row, y) => [...row].forEach((cell, x) => {
          if (cell === '#') context.fillRect(x0 + left + x * scale + offset,
            top + y * scale + offset, scale, scale);
        }));
      };
      // The roof plaque wears the roof's own paint with restrained grain.
      // Light and shadow edges emboss the glyph without a contrasting ink.
      rect(roofInk(.82), 0, 0, EMBLEM_SIZE, EMBLEM_SIZE);
      for (let y = 5; y < EMBLEM_SIZE; y += 6) rect(roofInk(.77), 0, y, EMBLEM_SIZE, 1);
      symbol(0, 1, roofInk(.46));
      symbol(0, -1, roofInk(1.45));
      symbol(0, 0, roofInk(.92));
      rect(roofInk(.55), 80, 0, 4, 4);

      const look = role === 'fort'
        ? { background: roofInk(1.35), shadow: roofInk(.42), ink: roofInk(.3) }
        : Render.shopSignLook(null);
      rect(look.background, 40, 0, EMBLEM_SIZE, EMBLEM_SIZE);
      for (let y = 5; y < EMBLEM_SIZE; y += 6) rect(look.shadow, 40, y, EMBLEM_SIZE, 1);
      symbol(40, 1, look.shadow);
      symbol(40, 0, look.ink);
      rect(look.shadow, 84, 0, 4, 4);
      rect('#302b25', 88, 0, 4, 4);
      texture.refresh();
      texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
    }
    if (!emblems.has(scene.textures)) emblems.set(scene.textures, new Map());
    const faceUV = x => [(x + .5) / 512, .5 / 1024, (x + EMBLEM_SIZE - .5) / 512, (EMBLEM_SIZE - .5) / 1024];
    const result = { roof: texture, sign: texture, roofUV: faceUV(0), signUV: faceUV(40),
      roofSideUV: [81.5 / 512, 1.5 / 1024], signSideUV: [85.5 / 512, 1.5 / 1024],
      bracketUV: [89.5 / 512, 1.5 / 1024] };
    emblems.get(scene.textures).set(role + ':' + colorName, result);
    return result;
  }

  root.AuthoredRoofPalette = { COLORS, prepare, roofFace, prepareEmblem, getEmblem, emblemGlyph };
})(typeof window !== 'undefined' ? window : globalThis);
