// Foes keep a little room between them (creature_ai.js FOE_SPACING_CELLS),
// inside their own pace, and the minor streets are no wall to the wild.
(function () {
  function scene() {
    return { cellM: 7, depth: 2, save: { energy: 100, armor: {} },
      cellAt: () => ({ loaded: true, type: WorldGen.T.CAVE_FLOOR }),
      _cellBlocked: () => false, _nearAny: () => false, _shots: [], _foeBodies: [],
      _losePlayerEnergy(n) { this.save.energy -= n; return n; } };
  }
  test('foe spacing: two stacked foes beside the player part to the spacing and no faster than their pace', () => {
    const s = scene(), row = EnemyRoster.get('zombie');
    const a = { kind: 'zombie', id: 'a', x: 7, y: 0 }, b = { kind: 'zombie', id: 'b', x: 7, y: 0 };
    s._foeBodies = [a, b];
    const dt = 1 / 60, pace = row.movement.speedMetersPerSecond * dt;
    for (let f = 0; f < 600; f++) {
      for (const c of [a, b]) {
        const x0 = c.x, y0 = c.y;
        rosterEnemyMove(s, c, row, 1000 + f * 16, 0, 0, false, false, null, dt);
        assert.truthy(Math.hypot(c.x - x0, c.y - y0) <= pace + 1e-9, 'within its pace');
      }
    }
    assert.truthy(Math.hypot(a.x - b.x, a.y - b.y) >= 0.8 * FOE_SPACING_CELLS * s.cellM, 'parted');
    for (const c of [a, b]) assert.truthy(Math.hypot(c.x, c.y) <= 1.2 * s.cellM, 'still at the player');
  });
  test('foe spacing: a lone foe, or one with room, feels no push', () => {
    const s = scene();
    const a = { kind: 'zombie', id: 'a', x: 0, y: 0 }, b = { kind: 'zombie', id: 'b', x: s.cellM, y: 0 };
    s._foeBodies = [a];
    assert.eq(foeSpacingPush(s, a), null);
    s._foeBodies = [a, b];
    assert.eq(foeSpacingPush(s, a), null);
    b.x = 0.3 * s.cellM;
    assert.lt(foeSpacingPush(s, a).x, 0, 'pushed away from its neighbour');
  });
  function samePush(s, c) {
    const index = s._foeSpacingIndex;
    const indexed = foeSpacingPush(s, c);
    s._foeSpacingIndex = null;
    const brute = foeSpacingPush(s, c);
    s._foeSpacingIndex = index;
    assert.eq(indexed?.x, brute?.x, 'same x as full ordered scan');
    assert.eq(indexed?.y, brute?.y, 'same y as full ordered scan');
  }
  test('foe spacing bins: preserve ordered pushes across overlaps and negative boundaries', () => {
    const s = scene(), r = FOE_SPACING_CELLS * s.cellM;
    s._foeBodies = Array.from({ length: 180 }, (_, i) => ({
      id: 'foe' + i, x: ((i * 13) % 29 - 14) * r / 4,
      y: ((i * 17) % 31 - 15) * r / 4,
    }));
    s._foeBodies.push({ id: 'overlap', x: s._foeBodies[0].x, y: s._foeBodies[0].y });
    s._foeSpacingIndex = buildFoeSpacingIndex(s);
    for (const c of s._foeBodies) samePush(s, c);
    // Simulate sequential movement, including jumps across several buckets.
    // Later creatures must see those moves on this tick, not the next one.
    for (const c of s._foeBodies) {
      samePush(s, c);
      c.x += r * 2.3;
      c.y -= r * 1.1;
      updateFoeSpacingIndex(s._foeSpacingIndex, c);
      for (const other of s._foeBodies.slice(0, 6)) samePush(s, other);
    }
  });
  test('foe spacing bins: a moved neighbour enters and leaves the query immediately', () => {
    const s = scene(), r = FOE_SPACING_CELLS * s.cellM;
    const a = { id: 'a', x: -0.1 * r, y: 0 }, b = { id: 'b', x: 4 * r, y: 0 };
    s._foeBodies = [a, b];
    s._foeSpacingIndex = buildFoeSpacingIndex(s);
    assert.eq(foeSpacingPush(s, a), null);
    b.x = 0.1 * r;
    updateFoeSpacingIndex(s._foeSpacingIndex, b);
    assert.lt(foeSpacingPush(s, a).x, 0);
    samePush(s, a);
    b.x = -5 * r;
    updateFoeSpacingIndex(s._foeSpacingIndex, b);
    assert.eq(foeSpacingPush(s, a), null);
    assert.eq(s._foeSpacingIndex.buckets.size, 2, 'empty buckets removed');
  });
  test('foe spacing bins: a thousand distant foes do not enter the candidate scan', () => {
    const s = scene(), r = FOE_SPACING_CELLS * s.cellM;
    const a = { id: 'a', x: 0, y: 0 }, b = { id: 'b', x: r / 2, y: 0 };
    s._foeBodies = [a, b, ...Array.from({ length: 1000 }, (_, i) => ({
      id: 'distant' + i, x: (i + 10) * r, y: 10 * r,
    }))];
    s._foeSpacingIndex = buildFoeSpacingIndex(s);
    assert.eq(foeSpacingCandidates(s._foeSpacingIndex, a).length, 2);
    samePush(s, a);
    // An unrelated new list must never read a previous pass's index.
    s._foeBodies = [a, { id: 'new', x: -r / 2, y: 0 }];
    samePush(s, a);
    assert.gt(foeSpacingPush(s, a).x, 0);
  });
  test('foe spacing bins: another attacker splitting a slime updates its bucket immediately', () => {
    const s = Object.assign(scene(), { tileEdgeM: 280, playerM: { x: 0, y: 0 },
      originPx: { x: 0, y: 0 }, mPerPx: 7, cellsPerTile: WorldGen.TILE_PX,
      startWorldM: { x: 0, y: 0 }, viewCenterX: 0, viewCenterY: 0 });
    const slime = { kind: 'split_slime', id: 'split', x: 140, y: 140, _hp: 32 };
    const neighbour = { kind: 'zombie', id: 'neighbour', x: 140, y: 148 };
    s._foeBodies = [slime, neighbour];
    s._foeSpacingIndex = buildFoeSpacingIndex(s);
    const key = WorldGen.tileKey(0, 0), previous = WorldGen.tileCache.get(key);
    const entry = { cellsPerEdge: 40, tileEdgeM: 280, grid: new Uint8Array(1600), creatures: [slime, neighbour] };
    WorldGen.tileCache.set(key, entry);
    try {
      assert.eq(foeSpacingPush(s, neighbour), null);
      const twin = enemySplit(s, slime, 0, slime.y, 1000);
      assert.truthy(twin, 'slime splits during an attack');
      assert.truthy(foeSpacingPush(s, neighbour), 'moved original is now near neighbour');
      samePush(s, neighbour);
      assert.eq(s._foeSpacingIndex.records.has(twin), false, 'newborn joins next pass');
    } finally {
      if (previous) WorldGen.tileCache.set(key, previous);
      else WorldGen.tileCache.delete(key);
    }
  });
  test('roads: minor streets and paths are crossable; the major tiers are not', () => {
    const T = WorldGen.T;
    assert.falsy(Combat.faunaBlocksCell(T.ROAD), 'minor street');
    assert.falsy(Combat.faunaBlocksCell(T.PATH), 'path');
    assert.truthy(Combat.faunaBlocksCell(T.ROAD_MD), 'medium road');
    assert.truthy(Combat.faunaBlocksCell(T.ROAD_LG), 'large road');
    const s = scene(), row = EnemyRoster.get('zombie'), c = { kind: 'zombie', x: 0, y: 0 };
    s.cellAt = () => ({ loaded: true, type: T.ROAD });
    assert.truthy(enemyCanStep(s, c, row, 3, 0), 'a foe steps onto a side street');
    s.cellAt = () => ({ loaded: true, type: T.ROAD_LG });
    assert.falsy(enemyCanStep(s, c, row, 3, 0), 'never onto a major road');
  });
})();
