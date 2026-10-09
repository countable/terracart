// Explicitly triggered encounters still obey geographical exclusions.
(function () {
  function world(fn) {
    const N = 32, cellM = 7, edge = N * cellM;
    const entry = { cellsPerEdge: N, grid: new Uint8Array(N * N).fill(WorldGen.T.GRASS),
      spawnWhy: new Uint16Array(N * N), creatures: [], roadClass: new Uint8Array(N * N),
      _spawnOpts: { occupied: new Set(), pois: [] } };
    const scene = { depth: 0, cellM, tileEdgeM: edge, save: { caught: [] },
      startWorldM: { x: 0, y: 0 }, originPx: { x: 0, y: 0 }, mPerPx: 7, cellsPerTile: N,
      cellAt: () => ({ loaded: true, type: WorldGen.T.GRASS }), _cellBlocked: () => false,
      _nearAny: () => false };
    const previousGet = WorldGen.tileCache.get, previousNear = WorldGen.forEachItemNear;
    WorldGen.tileCache.get = key => key === WorldGen.tileKey(0, 0) ? entry : undefined;
    WorldGen.forEachItemNear = (what, tx, ty, each) => entry.creatures.forEach(each);
    try { fn({ scene, entry, x: 108.5, y: 108.5 }); }
    finally { WorldGen.tileCache.get = previousGet; WorldGen.forEachItemNear = previousNear; }
  }
  test('triggered creatures: headstone ghosts and fished slimes refuse hard exclusion masks', () => {
    for (const reason of ['RESTRICTED', 'QUIET', 'KINDERGARTEN', 'FARM_INTERIOR', 'GOLF', 'SENSITIVE']) {
      world(({ scene, entry, x, y }) => {
        entry.spawnWhy.fill(WorldGen.SPAWN_WHY[reason]);
        assert.eq(raiseGhostAt(scene, x, y, 10000, 'headstone'), null, reason + ' refuses tapped ghosts');
        assert.eq(fishedSlimeSpawn(scene, 10000, x, y, { tx: 0, ty: 0 }), null, reason + ' refuses hooked slimes');
        assert.eq(entry.creatures.length, 0, reason + ' never partially creates a creature');
      });
    }
  });
  test('triggered creatures: the fast ghost honors kerb suppression but ordinary open seats remain', () => world(({ scene, entry, x, y }) => {
    entry.spawnWhy.fill(WorldGen.SPAWN_WHY.KERB);
    assert.eq(raiseGhostAt(scene, x, y, 10000, 'headstone'), null);
    entry.spawnWhy.fill(0);
    const ghost = raiseGhostAt(scene, x, y, 10000, 'headstone');
    assert.truthy(ghost); assert.eq(ghost.x, x); assert.eq(ghost.y, y);
    const slime = fishedSlimeSpawn(scene, 10000, x, y, { tx: 0, ty: 0 });
    assert.truthy(slime); assert.eq(slime.kind, 'slime');
    assert.inRange(Math.hypot(slime.x - x, slime.y - y), 6.999, 7.001);
    assert.truthy(slime._lastDamagedT, 'hooked slimes retain their angry reaction');
  }));
  test('triggered creatures: a headstone ghost may share its authored trigger cell', () => world(({ scene, entry, x, y }) => {
    entry._spawnOpts.occupied.add(15 * entry.cellsPerEdge + 15);
    assert.truthy(raiseGhostAt(scene, x, y, 10000, 'headstone'));
  }));
  test('triggered creatures: summons preserve finite slots and refuse hard geographical exclusions', () => {
    for (const reason of ['RESTRICTED', 'QUIET', 'FARM_INTERIOR', 'SENSITIVE']) world(({ scene, entry, x, y }) => {
      const master = { id: 'event_master', kind: 'necromancer', x, y };
      entry.creatures.push(master);
      entry.spawnWhy.fill(WorldGen.SPAWN_WHY[reason]);
      assert.falsy(enemySummon(scene, master, EnemyRoster.get(master.kind).ability), reason);
      assert.eq(entry.creatures.length, 1);
      assert.falsy(scene.save.caught.length, 'denied seats do not spend a summon slot');
    });
  });
})();
