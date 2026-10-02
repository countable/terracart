(function () {
  test('castle flags: restoring swaps all skulls for the existing single player banner', () => {
    const towers = [
      { kind: 'tower', castle: 'citadel', flagPost: false },
      { kind: 'tower', castle: 'citadel', flagPost: true },
      { kind: 'tower', castle: 'citadel', flagPost: false },
    ];
    let claimed = false;
    const scene = { isCastleClaimed: o => o.castle === 'citadel' && claimed };
    const flags = () => towers.map(o => Render.castleFlagTexture(scene, o)).filter(Boolean);
    assert.eq(flags().join(), 'castle_skull_flag,castle_skull_flag,castle_skull_flag', 'all unrestored towers fly skulls');
    claimed = true;
    assert.eq(flags().join(), 'castle_flag', 'restoration leaves the original player banner');
    assert.eq(Render.castleFlagTexture({ isClaimedKey: () => false }, towers[1]), 'castle_skull_flag', 'claim-key fallback agrees');
    assert.eq(Render.castleFlagTexture({}, towers[1]), null, 'no invented state without claim data');
  });
  test('castle flags: skull canvas is square black cloth with a contrasting opaque emblem', () => {
    const start = TEXTURES_SRC.indexOf('function makeCastleSkullFlagTexture(');
    const end = TEXTURES_SRC.indexOf('// Procedural "pot of gold"', start);
    const bake = new Function(TEXTURES_SRC.slice(start, end) + '; return makeCastleSkullFlagTexture;')();
    const pixels = new Map();
    const ctx = { fillStyle: '', fillRect(x, y, w, h) {
      for (let cy = y; cy < y + h; cy++) for (let cx = x; cx < x + w; cx++) pixels.set(`${cx},${cy}`, this.fillStyle);
    } };
    let made = 0, refreshed = 0;
    const scene = { textures: {
      exists: () => made > 0,
      createCanvas(key, w, h) {
        assert.eq(key, 'castle_skull_flag'); assert.eq(w, 16); assert.eq(h, 18); made++;
        return { getContext: () => ctx, refresh: () => refreshed++ };
      },
    } };
    bake(scene); bake(scene);
    assert.eq(made, 1, 'one cached canvas'); assert.eq(refreshed, 1, 'one texture upload');
    // Ten rows and columns of complete cloth distinguish a square banner
    // from a triangular pennant; negative space must survive around the skull.
    for (let y = 2; y < 12; y++) for (let x = 5; x < 15; x++) assert.truthy(pixels.has(`${x},${y}`));
    const cloth = pixels.get('5,2'), ink = pixels.get('9,3');
    assert.truthy(cloth !== ink, 'the skull contrasts with its black cloth');
    assert.eq(pixels.get('8,5'), cloth, 'the left eye retains dark negative space');
    assert.eq(pixels.get('12,5'), cloth, 'the right eye retains dark negative space');
  });
})();
