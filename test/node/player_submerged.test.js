(function () {
  function method(name) {
    const start = SCENE_SRC.indexOf('\n  ' + name + '(');
    const end = SCENE_SRC.indexOf('\n  }\n', start);
    return new Function('return ({' + SCENE_SRC.slice(start, end + 4) + '})[' + JSON.stringify(name) + ']')();
  }
  function fixture(fn) {
    const key = WorldGen.tileKey(997, 998), previous = WorldGen.tileCache.get(key);
    const cell = { loaded: true, tx: 997, ty: 998, ix: 1, iy: 1, cellIX: 51, cellIY: 52, type: WorldGen.T.WATER };
    const entry = { cellsPerEdge: 4, slowCells: new Map() };
    const scene = { save: { energy: 100 }, startWorldM: { x: 40, y: 60 }, playerM: { x: 2, y: 3 },
      _obstacleStep: { liftPx: 0 }, playerFeetNudgeY: -9,
      cellAt(x, y) { assert.eq(x, 42); assert.eq(y, 63); return cell; },
      player: { frame: { realWidth: 16, realHeight: 16 },
        setCrop(...args) { this.isCropped = !!args.length; this.crop = args; } } };
    WorldGen.tileCache.set(key, entry);
    try { fn(scene, cell, entry, method('_updatePlayerSubmersion')); }
    finally { if (previous) WorldGen.tileCache.set(key, previous); else WorldGen.tileCache.delete(key); }
  }
  test('submerged player: water and tar hide lower half at waist-height without moving world feet', () => fixture((s, c, e, update) => {
    for (const type of [WorldGen.T.WATER, WorldGen.T.TAR_YARD]) {
      c.type = type; update.call(s);
      assert.truthy(s._playerSubmerged);
      assert.eq(s.player.crop.join(','), '0,0,16,8');
      assert.eq(method('playerBodyDy').call(s), 0);
      assert.eq(s.playerM.x, 2); assert.eq(s.playerM.y, 3);
    }
    c.type = WorldGen.T.GRASS; update.call(s);
    assert.falsy(s._playerSubmerged); assert.falsy(s.player.isCropped);
    assert.eq(method('playerBodyDy').call(s), -9);
  }));
  test('submerged player: current animation and skin frame dimensions own the crop, independent of heading', () => fixture((s, c, e, update) => {
    for (const heading of [0, 90, 180, 270]) {
      s.compassDeg = heading;
      for (const size of [16, 32]) {
        s.player.frame = { realWidth: size, realHeight: size };
        update.call(s);
        assert.eq(s.player.crop.join(','), [0, 0, size, size / 2].join(','));
      }
    }
  }));
  test('submerged player: puddles respect permanent burned-out tar, not unrelated stakes', () => fixture((s, c, e, update) => {
    c.type = WorldGen.T.GRASS; e.slowCells.set(5, 'tar'); update.call(s);
    assert.truthy(s._playerSubmerged);
    s.save.groundFire = { [GroundFire.key(0, 51, 52)]: { litAt: Date.now() - 2000, until: Date.now() + 60000 } };
    update.call(s); assert.truthy(s._playerSubmerged, 'active tar still exists');
    s.save.groundFire[GroundFire.key(0, 51, 52)].extinguished = true;
    update.call(s); assert.falsy(s._playerSubmerged);
    delete s.save.groundFire; e.slowCells.set(5, 'stakes'); update.call(s);
    assert.falsy(s._playerSubmerged);
  }));
  test('submerged player: flight, dragon, collapse and prop support restore full sprite', () => fixture((s, c, e, update) => {
    const states = [
      [() => s.save.flightPotionUntil = Date.now() + 60000, () => delete s.save.flightPotionUntil],
      [() => s.isDragonActive = () => true, () => delete s.isDragonActive],
      [() => s.save.energy = 0, () => s.save.energy = 100],
      [() => s._obstacleStep.liftPx = 3, () => s._obstacleStep.liftPx = 0],
    ];
    for (const [enable, disable] of states) {
      update.call(s); assert.truthy(s.player.isCropped);
      enable(); update.call(s);
      assert.falsy(s._playerSubmerged); assert.falsy(s.player.isCropped);
      disable();
    }
    c.loaded = false; update.call(s); assert.falsy(s._playerSubmerged);
  }));
})();
