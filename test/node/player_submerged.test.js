(function () {
  function method(name) {
    const start = SCENE_SRC.indexOf('\n  ' + name + '(');
    const end = SCENE_SRC.indexOf('\n  }\n', start);
    return new Function('return ({' + SCENE_SRC.slice(start, end + 4) + '})[' + JSON.stringify(name) + ']')();
  }
  function fixture(fn) {
    const key = WorldGen.tileKey(997, 998), previous = WorldGen.tileCache.get(key);
    const cell = { loaded: true, tx: 997, ty: 998, ix: 1, iy: 1, cellIX: 0, cellIY: 0, type: WorldGen.T.WATER };
    const entry = { cellsPerEdge: 4, slowCells: new Map() };
    const scene = { save: { energy: 100 }, startWorldM: { x: 40, y: 60 }, playerM: { x: 2, y: 3 },
      cellM: 5, cellsPerTile: 32, tileEdgeM: 160, mPerPx: 160 / WorldGen.TILE_PX, originPx: { x: 0, y: 0 },
      _obstacleStep: { liftPx: 0 }, playerFeetNudgeY: -9,
      cellAt(x, y) { assert.eq(x, 40 + this.playerM.x); assert.eq(y, 60 + this.playerM.y); return cell; },
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
  test('sewer water: underground movement permits wading without relaxing spawn safety', () => {
    const blocked = method('_cellBlocked');
    for (const depth of [0, 1, 2, 7]) {
      const s = { depth, cellAt: () => ({ loaded: true, type: WorldGen.T.WATER }) };
      assert.falsy(blocked.call(s, 0, 0), 'water is traversable at depth ' + depth);
      if (depth) {
        s.cellAt = () => ({ loaded: true, type: WorldGen.T.CAVE_WALL });
        assert.truthy(blocked.call(s, 0, 0), 'walls remain solid');
        s.cellAt = () => ({ loaded: false });
        assert.falsy(blocked.call(s, 0, 0), 'tile seams do not trap the player');
      }
    }
    assert.falsy(WorldGen.isWalkable(WorldGen.T.WATER), 'water remains excluded from land spawn safety');
  });
  test('sewer water: route channels and actual water share the waist-up pose, decking and dry stone do not', () => fixture((s, c, e, update) => {
    s.depth = e.depth = 1; e.underground = { lane: new Set([5]) };
    for (const type of [WorldGen.T.WATER, WorldGen.T.CAVE_FLOOR]) {
      c.type = type; update.call(s);
      assert.truthy(s._playerSubmerged);
      assert.eq(s.player.crop.join(','), '0,0,16,8');
      s._obstacleStep.liftPx = 3; update.call(s);
      assert.falsy(s.player.isCropped, 'standing on a raised prop clears the waterline');
      s._obstacleStep.liftPx = 0;
    }
    c.type = WorldGen.T.PIER; update.call(s);
    assert.falsy(s.player.isCropped, 'pier decking is dry');
    c.type = WorldGen.T.CAVE_FLOOR; e.underground.lane.clear(); update.call(s);
    assert.falsy(s.player.isCropped, 'ordinary sewer stone is dry');
    e.underground.lane.add(5); s.depth = e.depth = 2; update.call(s);
    assert.falsy(s.player.isCropped, 'routes on other floors are dry');
    c.type = WorldGen.T.WATER; update.call(s);
    assert.truthy(s.player.isCropped, 'actual water wades on other floors too');
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
    s.save.groundFire = { [GroundFire.key(0, 0, 0)]: { litAt: Date.now() - 2000, until: Date.now() + 60000 } };
    update.call(s); assert.truthy(s._playerSubmerged, 'active tar still exists');
    s.save.groundFire[GroundFire.key(0, 0, 0)].extinguished = true;
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
  test('submerged player: a basin follows the feet cell and current depth indoors and outdoors', () => fixture((s, c, e, update) => {
    for (const [depth, type] of [[0, WorldGen.T.GRASS], [0, WorldGen.T.BUILDING], [2, WorldGen.T.CAVE_FLOOR]]) {
      s.depth = depth; c.type = type;
      s.save.furniture = [{ id: 'tub', itemId: 'washtub', x: 42.5, y: 62.5, depth }];
      update.call(s);
      assert.truthy(s._playerSubmerged);
      assert.eq(s.player.crop.join(','), '0,0,16,8');
      assert.eq(method('playerBodyDy').call(s), 0);
      update.call(s); assert.truthy(s._playerSubmerged, 'stationary updates retain the pose');
      s.playerM.x = 7; c.cellIX = 1;
      update.call(s); assert.falsy(s._playerSubmerged, 'stepping off clears it');
      s.playerM.x = 0; c.cellIX = 0;
      update.call(s); assert.truthy(s._playerSubmerged, 'the cell boundary uses the resolved feet cell');
      s.playerM.x = 2;
      s.depth = depth + 1;
      update.call(s); assert.falsy(s._playerSubmerged, 'a basin on another floor cannot submerge');
      s.depth = depth;
      s.save.furniture[0].itemId = 'table_oak';
      update.call(s); assert.falsy(s._playerSubmerged, 'ordinary furniture is dry');
    }
  }));
  test('submerged player: basin yields to flight, dragon, collapse and support, and pickup clears the pose', () => fixture((s, c, e, update) => {
    c.type = WorldGen.T.GRASS;
    SaveState.defaults(s.save);
    const tub = { id: 'tub', itemId: 'washtub', x: 42.5, y: 62.5, depth: 0 };
    s.save.furniture = [tub];
    for (const [enable, disable] of [
      [() => s.save.flightPotionUntil = Date.now() + 60000, () => delete s.save.flightPotionUntil],
      [() => s.isDragonActive = () => true, () => delete s.isDragonActive],
      [() => s.save.energy = 0, () => s.save.energy = 100],
      [() => s._obstacleStep.liftPx = 3, () => s._obstacleStep.liftPx = 0],
    ]) {
      update.call(s); assert.truthy(s._playerSubmerged);
      enable(); update.call(s);
      assert.falsy(s._playerSubmerged); assert.falsy(s.player.isCropped);
      disable();
    }
    update.call(s); assert.truthy(s._playerSubmerged);
    Object.assign(s, { _placedFurniture: SceneFurniture.prototype._placedFurniture,
      addToInv: (id, n) => Inventory.add(s.save, id, n).accepted,
      _finishInventoryChange() {}, drawObjects() {}, flashAtPlayer() {} });
    assert.truthy(SceneFurniture.prototype.pickupFurniture.call(s, tub));
    assert.eq(s.save.furniture.length, 0);
    update.call(s);
    assert.falsy(s._playerSubmerged); assert.falsy(s.player.isCropped);
    assert.eq(method('playerBodyDy').call(s), -9);
  }));
  test('foliage cover: grass preserves the full standing body and hedges retain their crop', () => fixture((s,c,e,update) => {
    c.type=WorldGen.T.GRASS;
    const grass={kind:'wildplant',crop:'longgrass',x:42,y:63};
    s._obstacleStep=ObstacleStep.sample(42,63,[grass],5);
    s._playerSubmerged=true; s.player.setCrop(0,0,16,8);
    for (let i=0;i<2;i++) {
      update.call(s); assert.falsy(s._playerSubmerged); assert.falsy(s.player.isCropped);
      assert.eq(method('playerBodyDy').call(s),-9, 'grass roots and player feet share the ground plane');
    }
    for (const plant of [{...grass,crop:'shrub',_plantArt:'zone_hedge'}]) {
      s._obstacleStep=ObstacleStep.sample(42,63,[plant],5);
      for (let i=0;i<2;i++) { update.call(s); assert.truthy(s._playerSubmerged); assert.eq(s.player.crop.join(','),'0,0,16,8'); }
      s.save.flightPotionUntil=Date.now()+60000; update.call(s); assert.falsy(s.player.isCropped);
      delete s.save.flightPotionUntil;
      s._obstacleStep=ObstacleStep.sample(42,63,[plant,{kind:'mineralrock',x:42,y:63}],5);
      update.call(s); assert.truthy(s.player.isCropped,'a small prop does not remove foliage cover');
      s._obstacleStep=ObstacleStep.sample(42,63,[],5); update.call(s);
      assert.falsy(s.player.isCropped); assert.eq(method('playerBodyDy').call(s),-9);
    }
  }));

})();
