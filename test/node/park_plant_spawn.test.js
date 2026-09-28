(function () {
  const N = 96, EDGE = 672, TX = 4, TY = -3;
  const park = () => new Uint8Array(N * N).fill(WorldGen.T.PARK);
  const spawn = (grid, opts) => WorldGen.spawnParkPlants(grid, N, N, TX, TY, EDGE, opts);
  const cell = p => {
    const cx = Math.floor((p.x - TX * EDGE) / (EDGE / N));
    const cy = Math.floor((p.y - TY * EDGE) / (EDGE / N));
    return cy * N + cx;
  };
  test('park plants: stable positions and IDs on park ground only', () => {
    const grid = park();
    const a = spawn(grid), b = spawn(grid);
    assert.gt(a.length, 10, 'large park supports enemies');
    assert.lt(a.length, 100, 'sparse hazards, not a carpet');
    assert.eq(JSON.stringify(a), JSON.stringify(b), 'rebuild is deterministic');
    assert.eq(new Set(a.map(p => p.id)).size, a.length);
    for (const p of a) {
      assert.eq(p.kind, 'plant');
      assert.truthy(/^plant_4_-3_\d+_\d+$/.test(p.id));
      assert.eq(grid[cell(p)], WorldGen.T.PARK);
    }
    for (const terrain of [WorldGen.T.GRASS, WorldGen.T.FOREST, WorldGen.T.RESIDENTIAL, WorldGen.T.WATER]) {
      assert.eq(spawn(new Uint8Array(N * N).fill(terrain)).length, 0, `no plants on ${terrain}`);
    }
  });
  test('park plants: road masks and occupied cells remove only those candidates', () => {
    const grid = park(), all = spawn(grid), roadMask = new Uint8Array(N * N);
    roadMask[cell(all[0])] = 1;
    const occupied = new Set([cell(all[1])]);
    const before = [...occupied];
    const kept = spawn(grid, { roadMask, occupied });
    assert.eq(JSON.stringify(kept), JSON.stringify(all.slice(2)), 'no reroll of blocked enemies');
    assert.eq(JSON.stringify([...occupied]), JSON.stringify(before), 'input occupancy untouched');
  });
  test('park plants: metre frame scales positions without changing local identities', () => {
    const a = spawn(park());
    const b = WorldGen.spawnParkPlants(park(), N, N, TX, TY, EDGE * 2);
    assert.eq(a.map(p => p.id).join(), b.map(p => p.id).join());
    for (let i = 0; i < a.length; i++) {
      assert.eq(b[i].x, a[i].x * 2);
      assert.eq(b[i].y, a[i].y * 2);
    }
  });
})();
