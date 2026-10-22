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
    assert.eq(cloths.size, 3, 'Citadel and Ruin share black; Bastion is grey and Archive brown');
    assert.eq(images.get('castle_skull_flag_citadel').get('14,11'), '#111111');
    assert.eq(images.get('castle_skull_flag_ruin').get('14,11'), '#111111');
    assert.eq(images.get('castle_skull_flag_bastion').get('14,11'), '#484848');
    assert.eq(images.get('castle_skull_flag_archive').get('14,11'), '#493425');
    assert.eq(geometry.size, 4, 'families differ by emblem shape as well as colour');
  });
})();

(function () {
  test('FDR castle geometry replaces only covered surface tower artwork', () => {
    const tower = { kind: 'tower', id: 'turret-cell', castle: 'covered' };
    const geometry = { source: 'castles', layout: { towers: [] } };
    const scene = { depth: 0, _fdrCastleLayouts: new Map(),
      textures: { exists: () => true, get: () => ({ get: () => ({ width: 48, height: 48 }) }) },
      isClaimedKey: () => true };
    const pass = Render.objectAppearance(scene, new Map());
    const appearance = () => Render.resolveObjectAppearance(pass, tower);
    const original = JSON.stringify(tower);
    assert.eq(Render.objectAppearanceIsStable(tower), false, 'tower appearance is never cached as static scenery');
    assert.truthy(appearance().visible, 'legacy tower appears before footprint geometry arrives');
    scene._fdrCastleLayouts.set('covered', geometry);
    assert.eq(appearance().visible, false, 'emitted model hides duplicate tower and its sprite shadow');
    assert.eq(Render.fdrCastleLayout(scene, { kind: 'house', castle: 'covered' }), null, 'house turret and wizard roles stay separate');
    assert.eq(Render.fdrCastleLayout(scene, { kind: 'temple', castle: 'covered' }), null, 'temples remain separate');
    assert.eq(Render.fdrCastleLayout(scene, { kind: 'tower', castle: 'other' }), null, 'uncovered castles keep fallback');
    scene.depth = 1;
    assert.truthy(appearance().visible, 'surface cache cannot suppress underground artwork');
    scene.depth = 0; scene._fdrCastleLayouts.clear();
    assert.truthy(appearance().visible, 'removing geometry restores legacy artwork immediately');
    assert.eq(JSON.stringify(tower), original, 'gameplay turret data unchanged');
  });
  test('FDR castle flags use distinct model crowns and follow overlay pan offsets', () => {
    const model = { source: 'castles', layout: { towers: [
      { x: 10, y: 20, height: 32 }, { x: 70, y: 20, height: 32 },
    ] } };
    const scene = { _fdrCastleLayouts: new Map([['covered', model]]),
      _wallPerspective: { castles: { x: 100, y: 200 } }, isClaimedKey: () => false };
    const items = [
      { o: { kind: 'tower', castle: 'covered', id: 'a' }, dx: 110, dy: 220 },
      { o: { kind: 'tower', castle: 'covered', id: 'b', flagPost: true }, dx: 110, dy: 220 },
      { o: { kind: 'tower', castle: 'covered', id: 'c' }, dx: 170, dy: 220 },
      { o: { kind: 'tower', castle: 'fallback', id: 'd' }, dx: 300, dy: 300 },
    ];
    const project = (x,y) => ({x,y}), before = JSON.stringify(items);
    const flags = Render.castleFlagItems(scene, items, project);
    assert.eq(flags.length, 3, 'one flag per emitted crown plus legacy fallback');
    assert.eq(flags[0].o.id, 'b', 'designated banner gets a crown first');
    assert.eq(flags[0]._castleFlagSeat.x, 110); assert.eq(flags[0]._castleFlagSeat.y, 220);
    assert.eq(flags[0]._castleFlagSeat.height, 36);
    assert.eq(flags[1]._castleFlagSeat.x, 170, 'second flag uses distinct tower');
    assert.eq(flags[2], items[3], 'fallback keeps original seating');
    scene.isClaimedKey = () => true;
    scene._wallPerspective.castles.x += 7;
    const restored = Render.castleFlagItems(scene, items, project);
    assert.eq(restored.length, 1, 'restoration retains only the designated player banner');
    assert.eq(restored[0]._castleFlagSeat.x, 117, 'current overlay offset is used after pan');
    assert.eq(JSON.stringify(items), before, 'visual assignment never changes world records');
  });
})();
