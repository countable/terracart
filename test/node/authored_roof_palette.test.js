(() => {
  test('cottage emblems reuse canonical shop and trade glyphs', () => {
    for (const role of ['seed', 'supply', 'potion', 'relic', 'pet', 'book', 'blacksmith'])
      assert.eq(AuthoredRoofPalette.emblemGlyph(role), Render.shopSignGlyph(role, role), role);
    assert.eq(AuthoredRoofPalette.emblemGlyph('shop'), Render.shopSignGlyph('supply'));
    assert.eq(AuthoredRoofPalette.emblemGlyph('trader'), TRADE_ARROW_PX);
    assert.eq(AuthoredRoofPalette.emblemGlyph('plain'), null, 'no invented residential symbol');
  });

  test('cottage embossing preserves roof paint and warms shared textures only once', () => {
    const previous = globalThis.Phaser;
    globalThis.Phaser = { Textures: { FilterMode: { NEAREST: 0 } } };
    try {
      const textures = new Map(), calls = { reads: 0, creates: 0 }, image = {};
      const source = { getSourceImage: () => image };
      const scene = { textures: {
        exists: key => textures.has(key), get: key => textures.get(key),
        createCanvas(key, width, height) {
          calls.creates++;
          const context = { rects: [], fillRect(...rect) { this.rects.push({ rect, ink: this.fillStyle }); },
            drawImage(...args) { this.copy = args; },
            getImageData(x, y, w, h) {
              calls.reads++;
              return { data: new Uint8Array(Array.from({ length: w * h }, () => [80, 100, 120, 255]).flat()) };
            },
            putImageData(pixels) { this.pixels = pixels.data; } };
          const texture = { key, width, height, context, getContext: () => context, refresh() {}, setFilter() {} };
          textures.set(key, texture); return texture;
        }
      } };
      assert.eq(AuthoredRoofPalette.getEmblem(scene, 'seed', 'lime'), null);
      const result = AuthoredRoofPalette.prepareEmblem(scene, 'seed', 'lime', source);
      assert.eq(calls.creates, 2);
      assert.eq(calls.reads, 1, 'only the startup roof bake reads pixels');
      assert.eq(result.roof.width, 512); assert.eq(result.roof.height, 1024);
      assert.eq(result.sign.width, 512); assert.eq(result.sign.height, 1024);
      assert.eq(result.roof.context.copy[0], image, 'samples the prepared roof itself');
      const swatches = result.roof.context.rects;
      assert.eq(swatches.length, 2, 'one opaque highlight and shadow swatch');
      for (const { ink } of swatches) {
        const rgb = ink.match(/\d+/g).map(Number);
        assert.lt(Math.abs(rgb[0] / rgb[2] - 2 / 3), .02, 'RGB ratio preserves roof hue');
      }
      const covered = new Set();
      for (const span of result.roofRelief) {
        assert.truthy(span.u > 0 && span.u < 1 && span.v > 0 && span.v < 1);
        for (let y = span.y; y < span.y + span.h; y++) for (let x = span.x; x < span.x + span.w; x++) {
          const key = x + ':' + y;
          assert.falsy(covered.has(key), 'merged runs do not overlap');
          covered.add(key);
        }
      }
      const glyph = Render.shopSignGlyph('seed');
      const filled = (x, y) => glyph[Math.floor((y - 7) / 2)]?.[Math.floor((x - 7) / 2)] === '#';
      for (let y = 1; y < 31; y++) for (let x = 1; x < 31; x++)
        assert.eq(covered.has(x + ':' + y), filled(x, y) !== filled(x - 1, y - 1), 'only relief edges cover existing tiles');
      assert.gt(covered.size, 0);
      assert.lt(covered.size, 200, 'no rectangular replacement roof patch');
      assert.lt(result.roofRelief.length, covered.size, 'runs merge pixels into fewer quads');
      assert.eq(AuthoredRoofPalette.prepareEmblem(scene, 'seed', 'lime', source), result);
      for (let i = 0; i < 100; i++) assert.eq(AuthoredRoofPalette.getEmblem(scene, 'seed', 'lime'), result);
      assert.eq(calls.creates, 2, 'placement and repeated startup reuse textures');
      assert.eq(calls.reads, 1, 'placement performs no pixel reads');
      assert.eq(AuthoredRoofPalette.getEmblem(scene, 'seed', 'blue'), null, 'palette is part of cache identity');
      assert.eq(AuthoredRoofPalette.prepareEmblem(scene, 'plain', 'yellow', source), null);
    } finally {
      if (previous === undefined) delete globalThis.Phaser;
      else globalThis.Phaser = previous;
    }
  });
})();
