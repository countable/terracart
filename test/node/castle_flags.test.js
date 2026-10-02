(function () {
  test('castle flags: restoring swaps family skulls for the existing single player banner', () => {
    for (const id of CastleStyles.ids) {
      const towers = [
        { kind: 'tower', castle: id, flagPost: false },
        { kind: 'tower', castle: id, flagPost: true },
        { kind: 'tower', castle: id, flagPost: false },
      ];
      let claimed = false;
      const scene = { isCastleClaimed: () => claimed };
      const flags = () => towers.map(o => Render.castleFlagTexture(scene, o)).filter(Boolean);
      assert.eq(flags().join(), Array(3).fill(`castle_skull_flag_${id}`).join(), `${id}: all unrestored towers fly their family skull`);
      claimed = true;
      assert.eq(flags().join(), 'castle_flag', 'restoration leaves the original player banner');
      assert.eq(Render.castleFlagTexture({ isClaimedKey: () => false }, towers[1]), `castle_skull_flag_${id}`, 'claim-key fallback agrees');
      assert.eq(Render.castleFlagTexture({}, towers[1]), null, 'no invented state without claim data');
    }
    const key = 'castle_12_34';
    assert.eq(Render.castleFlagTexture({ isClaimedKey: () => false }, { castle: key }),
      `castle_skull_flag_${CastleStyles.get(key).id}`, 'generated castles share their wall and tower family');
  });
  test('castle flags: four cached square dark banners have distinct heraldic geometry', () => {
    const start = TEXTURES_SRC.indexOf('function makeCastleSkullFlagTexture(');
    const end = TEXTURES_SRC.indexOf('// Procedural "pot of gold"', start);
    const bake = new Function(TEXTURES_SRC.slice(start, end) + '; return makeCastleSkullFlagTexture;')();
    const images = new Map();
    let refreshed = 0;
    const scene = { textures: {
      exists: key => images.has(key),
      createCanvas(key, w, h) {
        assert.eq(w, 16); assert.eq(h, 18);
        const pixels = new Map(); images.set(key, pixels);
        const ctx = { fillStyle: '', fillRect(x, y, rw, rh) {
          for (let cy = y; cy < y + rh; cy++) for (let cx = x; cx < x + rw; cx++) pixels.set(`${cx},${cy}`, this.fillStyle);
        } };
        return { getContext: () => ctx, refresh: () => refreshed++ };
      },
    } };
    bake(scene); bake(scene);
    assert.eq(images.size, 4, 'one canvas per family, reused on repeat');
    assert.eq(refreshed, 4, 'one upload per canvas');
    const cloths = new Set(), geometry = new Set();
    for (const id of CastleStyles.ids) {
      const pixels = images.get(`castle_skull_flag_${id}`);
      assert.truthy(pixels, `${id}: matching runtime texture key`);
      const cloth = pixels.get('14,11'); cloths.add(cloth);
      const color = parseInt(cloth.slice(1), 16);
      assert.lt(Math.max(color >> 16, (color >> 8) & 255, color & 255), 80, `${id}: cloth stays dark`);
      let silhouette = '', emblemPixels = 0;
      for (let y = 2; y < 12; y++) for (let x = 5; x < 15; x++) {
        const pixel = pixels.get(`${x},${y}`);
        assert.truthy(pixel, 'cloth fills the square, not a triangular pennant');
        const emblem = pixel !== cloth;
        silhouette += emblem ? 'X' : '.';
        if (emblem) emblemPixels++;
      }
      assert.gt(emblemPixels, 18, `${id}: a readable emblem survives at native size`);
      geometry.add(silhouette);
    }
    assert.eq(cloths.size, 4, 'every family has its own dark cloth');
    assert.eq(geometry.size, 4, 'families differ by emblem shape as well as colour');
  });
})();
