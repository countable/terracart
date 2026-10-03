(function () {
  test('castle damage: ruin patterns are cached, sparse and stable across tile cells', () => {
    const patterns = new Set();
    for (let i = 0; i < 256; i++) {
      const key = `castle-damage-${i}`, pattern = CastleStyles.damagePattern(key);
      if (!pattern) continue;
      patterns.add(pattern);
      assert.eq(pattern, CastleStyles.damagePattern(key), 'reuse the geometry object');
      let missingSlabs = 0;
      for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
        const cell = CastleStyles.damageCell(key, x, y);
        assert.eq(cell, CastleStyles.damageCell(key, x + 3, y - 3), 'a stable 3 by 3 repeat');
        assert.eq(cell, pattern.cells[CastleStyles.damageCellIndex(x, y)], 'tiled and sheet paths agree');
        for (const r of cell.rects) {
          assert.gte(r.x, 0); assert.gte(r.y, 0);
          assert.lte(r.x + r.w, 32); assert.lte(r.y + r.h, 32);
          if (r.ink === 'floor') missingSlabs++;
        }
        assert.truthy(cell.missing >= -1 && cell.missing < 4, 'valid merlon or no additional missing tooth');
      }
      assert.eq(missingSlabs, 1, 'one missing slab per nine cells keeps courtyards open');
    }
    assert.eq(patterns.size, 4, 'geometry memory is bounded to four repeats');
    for (const id of ['citadel', 'bastion', 'archive']) {
      assert.eq(CastleStyles.damagePattern(id), null);
      assert.eq(CastleStyles.damageCell(id, 0, 0), null);
      assert.eq(CastleStyles.damageTexture({}, id, false), null, 'other families allocate no textures');
    }
  });
  test('castle damage: combined floor sheets reuse paving, cache by condition and bound texture count', () => {
    const textures = new Map(), source = {}, sheetKeys = new Set();
    let uploads = 0;
    const scene = { textures: {
      exists: key => key === 'biome12_0' || textures.has(key),
      get: () => ({ getSourceImage: () => source }),
      createCanvas(key, w, h) {
        assert.eq(w, 96); assert.eq(h, 96);
        const record = { draws: 0, fills: [], frames: [], ctx: null };
        const ctx = record.ctx = { globalAlpha: 1, fillStyle: '',
          drawImage(image) { assert.eq(image, source); record.draws++; },
          fillRect(x, y, rw, rh) { record.fills.push([x, y, rw, rh, this.fillStyle, this.globalAlpha]); } };
        textures.set(key, record);
        return { getContext: () => ctx, add: (i, _, x, y, fw, fh) => record.frames.push([i, x, y, fw, fh]), refresh: () => uploads++ };
      },
    } };
    for (let i = 0; i < 128; i++) for (const claimed of [true, false]) {
      const key = `castle-damage-${i}`, texture = CastleStyles.damageTexture(scene, key, claimed);
      if (!texture) continue;
      sheetKeys.add(texture);
      assert.eq(CastleStyles.damageTexture(scene, key, claimed), texture);
    }
    assert.eq(sheetKeys.size, 8, 'four repeats times two material conditions');
    assert.eq(uploads, 8, 'each sheet uploads only once');
    for (const record of textures.values()) {
      assert.eq(record.draws, 9, 'all frames retain the existing paving texture');
      assert.eq(record.frames.length, 9, 'tiled floors reuse one of nine sheet frames');
      assert.gt(record.fills.length, 0, 'damage paints after the paving');
      assert.eq(record.ctx.globalAlpha, 1, 'next cell cannot inherit crack alpha');
    }
  });
})();
