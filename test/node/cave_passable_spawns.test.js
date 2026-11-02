(() => {
  const spawn = new Function('entry', 'tx', 'ty', 'depth', SPAWN_CAVE_SRC.replace(/\n\s*\}\s*$/, ''));
  const fixture = () => {
    const grid = new Array(64 * 64).fill(WorldGen.T.CAVE_FLOOR);
    return { cellsPerEdge: 64, tileEdgeM: 640, grid, baseGrid: grid.slice(), objects: [], genObjects: [] };
  };
  const run = (entry, depth = 1) => {
    spawn.call({ tileEdgeM: 640, save: { caught: [] } }, entry, 0, 0, depth);
    return entry.creatures;
  };
  const cell = c => Math.floor(c.y / 10) * 64 + Math.floor(c.x / 10);
  test('cave ambient creatures share passable props but reject movement blockers', () => {
    const baseline = run(fixture()).filter(Combat.isEnemy);
    assert.gte(baseline.length, 6, 'the control supplies enough real deterministic seats');
    const shared = fixture();
    shared.objects = shared.genObjects = baseline.map((c, i) => ({
      kind: i % 2 ? 'mineralrock' : 'chest', x: c.x, y: c.y,
    }));
    const creatures = run(shared);
    for (const c of baseline) {
      assert.truthy(creatures.some(other => other.id === c.id && cell(other) === cell(c)));
      assert.truthy(shared._spawnOpts.occupied.has(cell(c)));
    }
    const blocked = fixture();
    const terrain = [WorldGen.T.CAVE_WALL, WorldGen.T.WATER, WorldGen.T.BUILDING,
      WorldGen.T.EXCLUSION_ROCK, WorldGen.T.ROCKY_GROUND];
    for (let i = 0; i < terrain.length; i++) blocked.grid[cell(baseline[i])] = blocked.baseGrid[cell(baseline[i])] = terrain[i];
    blocked.objects.push({ kind: 'mineralrock', pushable: true, x: baseline[5].x, y: baseline[5].y });
    const forbidden = new Set(baseline.slice(0, 6).map(cell));
    const remaining = run(blocked);
    assert.gt(remaining.length, 0);
    assert.falsy(remaining.some(c => forbidden.has(cell(c))));
  });
  test('cave roost dragons share passable props without changing their reserved seat', () => {
    const baseline = run(fixture(), 9).filter(c => c.kind === 'red_dragon' && c._habitatRegion);
    assert.gt(baseline.length, 0, 'the fixture contains an actual finite roost');
    const shared = fixture();
    shared.objects = shared.genObjects = baseline.map(c => ({ kind: 'chest', x: c.x, y: c.y }));
    const creatures = run(shared, 9);
    for (const c of baseline) {
      assert.truthy(creatures.some(other => other.id === c.id && cell(other) === cell(c)));
      assert.eq(creatures.filter(other => cell(other) === cell(c)).length, 1,
        'ambient enemies cannot reuse the roost seat');
    }
  });
})();
