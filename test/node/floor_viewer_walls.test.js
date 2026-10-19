// Exercise the generated mask and actual atlas draw calls, without a browser.
(() => {
  const entry = (N, tx, points) => {
    const grid = new Uint8Array(N * N).fill(WorldGen.T.CAVE_FLOOR);
    for (const [x, y] of points) grid[y * N + x] = WorldGen.T.CAVE_WALL;
    return { cellsPerEdge: N, tx, ty: 0, grid };
  };
  test('floor viewer walls: connected cells expose only their outer edges', () => {
    const walls = FloorViewerWalls.cells(entry(4, 0, [[1, 1], [2, 1]]), 4, 4, 2);
    assert.eq(walls.length, 2);
    assert.eq(walls[0].mask, 1 | 4 | 8);
    assert.eq(walls[1].mask, 1 | 2 | 4);
    const points = [];
    for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) points.push([x, y]);
    const centre = FloorViewerWalls.cells(entry(5, 0, points), 5, 5, 2).find(w => w.x === 2 && w.y === 2);
    assert.eq(centre.mask, 0, 'interior cap has no exposed rim');
  });
  test('floor viewer walls: lava variation is stable in absolute cells across tile partitions', () => {
    const small = FloorViewerWalls.cells(entry(4, -2, [[1, 1]]), 4, 4, 6)[0];
    const large = FloorViewerWalls.cells(entry(8, -1, [[1, 1]]), 8, 8, 6)[0];
    assert.eq(small.variant, large.variant);
    assert.eq(small.variant, FloorWallMaterials.variant(6, -7, 1));
    assert.eq(FloorViewerWalls.cells(entry(4, 0, []), 4, 4, 5).length, 0, 'open cavern stays free of wall art');
  });
  test('floor viewer walls: raised caps cover a full cell and only exposed south faces draw', () => {
    const calls = [], ctx = { drawImage: (...args) => calls.push(args) }, atlas = {};
    FloorViewerWalls.draw(ctx, atlas, {mask: 4, variant: 2}, 64, 96, 32);
    assert.eq(calls.length, 2);
    assert.eq(calls[0].slice(1).join(), '128,64,32,32,64,77,32,32');
    assert.eq(calls[1].slice(1).join(), '64,128,32,19,64,109,32,19');
    calls.length = 0;
    FloorViewerWalls.draw(ctx, atlas, {mask: 1, variant: 0}, 64, 96, 32);
    assert.eq(calls.length, 1, 'no internal south face');
  });
})();
