(() => {
  test('cottage emblems reuse canonical shop and trade glyphs', () => {
    for (const role of ['seed', 'supply', 'potion', 'relic', 'pet', 'book', 'blacksmith'])
      assert.eq(AuthoredRoofPalette.emblemGlyph(role), Render.shopSignGlyph(role, role), role);
    assert.eq(AuthoredRoofPalette.emblemGlyph('shop'), Render.shopSignGlyph('supply'));
    assert.eq(AuthoredRoofPalette.emblemGlyph('trader'), TRADE_ARROW_PX);
    assert.eq(AuthoredRoofPalette.emblemGlyph('plain'), null, 'no invented residential symbol');
    const dice=AuthoredRoofPalette.emblemGlyph('fort');
    assert.eq(dice.length,9);assert.eq(dice[4],'#...#...#','five-pip dice identity');
  });

  test('roof palette batches read each source once and preserve alpha and excluded faces', () => {
    const previous = globalThis.Phaser;
    globalThis.Phaser = { Textures: { FilterMode: { NEAREST: 0 } } };
    try {
      const input = new Uint8ClampedArray([
        160, 50, 30, 255, 160, 50, 30, 128, 90, 90, 90, 255, 0, 0, 0, 0,
        30, 60, 160, 255, 30, 60, 160, 255,
      ]);
      const image = { width: 6, height: 1 }, textures = new Map();
      let reads = 0;
      const source = { key: 'source', getSourceImage: () => image };
      const scene = { textures: {
        exists: key => textures.has(key), get: key => textures.get(key),
        createCanvas(key) {
          const context = {
            drawImage() {},
            getImageData() { reads++; return { data: input.slice() }; },
            createImageData() { return { data: new Uint8ClampedArray(input.length) }; },
            putImageData(pixels) { this.pixels = pixels.data; },
          };
          const texture = { key, getContext: () => context, refresh() {}, setFilter() {} };
          textures.set(key, texture); return texture;
        },
      } };
      const sources = new WeakMap();
      const model = () => ({ authoredKey: 'trader', faces: [
        { kind: 'roof', roofPalette: true }, { kind: 'roof', roofPalette: false },
      ] });
      const blueModel = model(), redModel = model();
      const blue = AuthoredRoofPalette.prepare(scene, source, blueModel, 'blue', sources);
      const red = AuthoredRoofPalette.prepare(scene, source, redModel, 'red', sources);
      assert.eq(reads, 1, 'source atlas is read once across palette variants');
      for (const texture of [blue, red]) {
        const pixels = texture.getContext().pixels;
        assert.eq(Array.from(pixels.slice(0, 16)).join(), Array.from(input.slice(0, 16)).join(),
          'warm timber, grayscale, alpha and transparent pixels stay exact');
        assert.eq(Array.from(pixels.slice(16, 20)).join(), Array.from(pixels.slice(20, 24)).join(),
          'repeated colors share the same remapping');
      }
      assert.truthy(blue.getContext().pixels[16] !== red.getContext().pixels[16], 'palettes remain distinct');
      assert.eq(blueModel.faces[0].texture, blue);
      assert.eq(blueModel.faces[1].texture, source, 'excluded faces keep the original material');
      assert.eq(AuthoredRoofPalette.prepare(scene, source, model(), 'blue', sources), blue);
      assert.eq(reads, 1, 'cached texture needs no new read');
    } finally {
      if (previous === undefined) delete globalThis.Phaser;
      else globalThis.Phaser = previous;
    }
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
      assert.eq(calls.creates, 1);
      assert.eq(calls.reads, 1, 'only the startup roof bake reads pixels');
      assert.eq(result.roof.width, 128); assert.eq(result.roof.height, 32);
      assert.eq(result.sign.width, 128); assert.eq(result.sign.height, 32);
      assert.eq(result.roof.context.copy[0], image, 'samples the prepared roof itself');
      assert.eq(result.roof, result.sign, 'both plaques share one atlas');
      const paints = result.roof.context.rects;
      const roofPaints = paints.filter(({ ink }) => ink.startsWith('rgb('));
      assert.gt(roofPaints.length, 10, 'roof backing, grain and embossed glyph are painted');
      for (const { ink } of roofPaints) {
        const rgb = ink.match(/\d+/g).map(Number);
        assert.lt(Math.abs(rgb[0] / rgb[2] - 2 / 3), .02, 'RGB ratio preserves roof hue');
      }
      assert.truthy(paints.some(({ rect }) => rect.join(',') === '0,0,32,32'), 'opaque roof plaque top');
      assert.truthy(paints.some(({ rect }) => rect.join(',') === '40,0,32,32'), 'opaque wooden plaque top');
      assert.lt(result.roofUV[2], result.signUV[0], 'face regions do not overlap');
      for (const uv of [result.roofSideUV, result.signSideUV, result.bracketUV]) {
        const x = uv[0] * result.roof.width, y = uv[1] * result.roof.height;
        assert.truthy(paints.some(({ rect: [rx, ry, w, h] }) => x > rx && x < rx + w && y > ry && y < ry + h),
          'thickness and brackets sample opaque painted swatches');
      }
      assert.eq(result.roofRelief, undefined, 'rounded thickness belongs to geometry, not pixel quads');
      assert.eq(AuthoredRoofPalette.prepareEmblem(scene, 'seed', 'lime', source), result);
      for (let i = 0; i < 100; i++) assert.eq(AuthoredRoofPalette.getEmblem(scene, 'seed', 'lime'), result);
      assert.eq(calls.creates, 1, 'placement and repeated startup reuse textures');
      assert.eq(calls.reads, 1, 'placement performs no pixel reads');
      assert.eq(AuthoredRoofPalette.getEmblem(scene, 'seed', 'blue'), null, 'palette is part of cache identity');
      assert.eq(AuthoredRoofPalette.prepareEmblem(scene, 'plain', 'yellow', source), null);
    } finally {
      if (previous === undefined) delete globalThis.Phaser;
      else globalThis.Phaser = previous;
    }
  });
})();
