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
    const scale = 2, left = (EMBLEM_SIZE - glyph[0].length * scale) / 2;
    const top = (EMBLEM_SIZE - glyph.length * scale) / 2;
    const filled = (x, y) => {
      const row = Math.floor((y - top) / scale), col = Math.floor((x - left) / scale);
      return glyph[row]?.[col] === '#';
    };
    const make = (kind, paint) => {
      const key = `authored:emblem:${role}:${colorName}:${kind}`;
      if (scene.textures.exists(key)) return scene.textures.get(key);
      const texture = scene.textures.createCanvas(key, 512, 1024);
      const context = texture.getContext();
      context.imageSmoothingEnabled = false;
      paint(context);
      texture.refresh();
      texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
      return texture;
    };
    // Emit only the relief edges, never a rectangular tile patch. Adjacent
    // equal runs share a quad; the roof's original tile phase stays untouched.
    const roofRelief = [], active = new Map();
    const toneAt = (x, y) => filled(x, y) === filled(x - 1, y - 1) ? 0 : filled(x, y) ? 1 : -1;
    for (let y = 1; y < EMBLEM_SIZE - 1; y++) {
      const next = new Map();
      for (let x = 1; x < EMBLEM_SIZE - 1;) {
        const tone = toneAt(x, y), start = x++;
        if (!tone) continue;
        while (x < EMBLEM_SIZE - 1 && toneAt(x, y) === tone) x++;
        const w = x - start, key = `${start}:${w}:${tone}`, prior = active.get(key);
        const span = prior || { x: start, y, w, h: 0,
          u: (tone > 0 ? 65.5 : 69.5) / 512, v: 1.5 / 1024 };
        span.h++;
        if (!prior) roofRelief.push(span);
        next.set(key, span);
      }
      active.clear();
      for (const [key, span] of next) active.set(key, span);
    }
    const roof = make('roof', context => {
      // Sample the actual recolored paint once at startup. The renderer draws
      // opaque light/shadow swatches only on the relief spans above.
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
      for (const [x, gain] of [[64, 1.45], [68, .58]]) {
        // Scale RGB together rather than mixing in a differently colored ink.
        const factor = Math.min(gain, peak ? 255 / peak : gain);
        context.fillStyle = `rgb(${rgb.map(value => Math.round(value * factor)).join(',')})`;
        context.fillRect(x, 0, 4, 4);
      }
    });
    const sign = make('sign', context => {
      const look = Render.shopSignLook(null);
      context.fillStyle = look.rim;
      context.fillRect(0, 0, EMBLEM_SIZE, EMBLEM_SIZE);
      context.fillStyle = look.background;
      context.fillRect(1, 1, EMBLEM_SIZE - 2, EMBLEM_SIZE - 2);
      context.fillStyle = look.shadow;
      context.fillRect(7, 0, 2, 5);
      context.fillRect(23, 0, 2, 5);
      for (const [offset, ink] of [[1, look.shadow], [0, look.ink]]) {
        context.fillStyle = ink;
        glyph.forEach((row, y) => [...row].forEach((cell, x) => {
          if (cell === '#') context.fillRect(left + x * scale, top + y * scale + offset, scale, scale);
        }));
      }
    });
    if (!emblems.has(scene.textures)) emblems.set(scene.textures, new Map());
    const uv = [.5 / 512, .5 / 1024, (EMBLEM_SIZE - .5) / 512, (EMBLEM_SIZE - .5) / 1024];
    const result = { roof, sign, roofRelief, signUV: uv };
    emblems.get(scene.textures).set(role + ':' + colorName, result);
    return result;
  }

  root.AuthoredRoofPalette = { COLORS, prepare, roofFace, prepareEmblem, getEmblem, emblemGlyph };
})(typeof window !== 'undefined' ? window : globalThis);
