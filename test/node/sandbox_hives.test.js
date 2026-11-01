(function () {
  function fixture(run) {
    const built = Sandbox.buildForTest({ cellsPerEdge: 128, tx: 0, ty: 0 });
    const entry = built.entry, key = WorldGen.tileKey(0, 0), previous = WorldGen.tileCache.get(key);
    const house = entry.objects.find(o => o._sandboxProbe === 'mushroom-hive');
    const bee = entry.objects.find(o => o._sandboxProbe === 'bee-hive');
    const scene = { save: { caught: [] }, depth: 0, cellM: built.cellM, cellsPerTile: 128,
      tileEdgeM: entry.tileEdgeM, originPx: { x: 0, y: 0 }, mPerPx: entry.tileEdgeM / WorldGen.TILE_PX,
      startWorldM: { x: 0, y: 0 }, playerM: { x: house.x, y: house.y + 4 * built.cellM },
      _cellBlocked: () => false,
      cellAt(x, y) {
        const ix = Math.floor(x / this.cellM), iy = Math.floor(y / this.cellM);
        return { tx: 0, ty: 0, ix, iy, loaded: ix >= 0 && iy >= 0 && ix < 128 && iy < 128,
          type: entry.grid[iy * 128 + ix] };
      },
    };
    WorldGen.tileCache.set(key, entry);
    try { run(scene, entry, house, bee); }
    finally { if (previous) WorldGen.tileCache.set(key, previous); else WorldGen.tileCache.delete(key); }
  }

  test('sandbox hives: authored mushroom house spawns, clears and restores through live systems', () => fixture((s, e, h, bee) => {
    assert.eq(bee.kind, 'hive');
    assert.eq(SandboxDestinations.find('bee-hive').scene, 'HIVES');
    assert.eq(SandboxDestinations.find('mushroom-hive').scene, 'HIVES');
    Sandbox.seedHouseState(s.save, e);
    assert.truthy(Hives.active(s.save, h), 'stocking the lab leaves the hive active');
    Hives.tick(s, .1);
    for (let ms = 0; ms < Hives.KINDS.mushroom.intervalMs; ms += 100) Hives.tick(s, .1);
    const children = Hives.living(s, h);
    assert.eq(children.length, 1, 'the real minute clock seats a child in the authored map');
    assert.eq(children[0].kind, 'mushroom_monster');
    assert.truthy(Hives.damage(s, h, Hives.KINDS.mushroom.hp));
    assert.falsy(Hives.spawn(s, h), 'a cleared house stops spawning');
    assert.truthy(Houses.isHouseWreck(s.save, h), 'clearing preserves the wreck');
    assert.truthy(Houses.restoreAs(s.save, h, 'plain'));
    assert.falsy(Hives.active(s.save, h));
  }));

  test('sandbox hives: reload restores harvest and births without resetting unrelated hives', () => fixture((s, e, h, bee) => {
    Sandbox.seedHouseState(s.save, e);
    const child = Hives.spawn(s, h);
    assert.truthy(child);
    s.save.caught = [child.id, `hivebee_${bee.id}_${utcDayKey()}_0`, 'outside_hive_1'];
    Hives.damage(s, h, Hives.KINDS.mushroom.hp);
    s.save.hives.outside = { hp: 5, serial: 7 };
    Macros.markToday(s.save, bee.id);
    Macros.markToday(s.save, 'outside');
    Macros.markServiceToday(s.save, bee.id);
    s._hives = { clocks: new Map([[h.id, 100], ['outside', 200]]) };
    Sandbox.resetFixtureProgress(s, e);
    assert.falsy(Macros.usedToday(s.save, bee.id));
    assert.truthy(Macros.usedToday(s.save, 'outside'));
    assert.truthy(Macros.serviceUsedToday(s.save, bee.id), 'service ledger is independent');
    assert.eq(s.save.caught.join(), 'outside_hive_1');
    assert.eq(s.save.hives.outside.serial, 7);
    assert.eq(Hives.health(s.save, h), Hives.KINDS.mushroom.hp);
    assert.falsy(s._hives.clocks.has(h.id));
    assert.eq(s._hives.clocks.get('outside'), 200);
    assert.eq(Hives.living(s, h).length, 0);
    const again = Hives.spawn(s, h);
    assert.truthy(again);
    assert.eq(again.id, child.id, 'fresh serial is not suppressed by an old defeat ledger');
    assert.eq(Hives.living(s, h).length, 1);
  }));
})();
