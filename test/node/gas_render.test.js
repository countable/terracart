// Gas must remain legible as air without covering neighbouring solid cells.
function gasPaintRects(density, seed = 0) {
  const rects = [];
  let alpha = 0;
  const g = {
    fillStyle(_color, a) { alpha = a; },
    fillRect(x, y, width, height) { rects.push({ x, y, width, height, alpha }); },
  };
  GasRender.paintCell(g, 100, 200, 32, density, seed, 1.5);
  return rects;
}

test('gas rendering: cloud geometry never crosses the simulation cell edge', () => {
  for (const seed of [0, 1, 42, 996]) {
    const rects = gasPaintRects(1, seed);
    assert.gt(rects.length, 8);
    for (const r of rects) {
      assert.gte(r.x, 100);
      assert.gte(r.y, 200);
      assert.lte(r.x + r.width, 132);
      assert.lte(r.y + r.height, 232);
      assert.gt(r.alpha, 0);
      assert.lt(r.alpha, 0.5);
    }
  }
});

test('gas rendering: thinner gas is more transparent and absent gas paints nothing', () => {
  assert.eq(gasPaintRects(0).length, 0);
  const dense = gasPaintRects(1), thin = gasPaintRects(0.2);
  assert.eq(dense.length, thin.length);
  dense.forEach((r, i) => assert.lt(thin[i].alpha, r.alpha));
  for (const r of gasPaintRects(100)) assert.lt(r.alpha, 0.5);
});

test('gas rendering: a newly diffused neighbour is a visible translucent veil', () => {
  const neighbour = gasPaintRects(0.25);
  assert.gt(Math.max(...neighbour.map(r => r.alpha)), 0.15);
  assert.gt(Math.max(...gasPaintRects(0.025).map(r => r.alpha)), 0.05);
});

test('gas rendering: cached simulation frames fade, cull and follow the camera', () => {
  const originalCells = MushroomGas.cells;
  let cells = [{ cellIX: 0, cellIY: 0, density: 1 },
    { cellIX: 100, cellIY: 100, density: 1 }];
  let clears = 0;
  const rects = [];
  let alpha = 0;
  const s = {
    time: { now: 0 }, depth: 0,
    startWorldM: { x: 0, y: 0 }, originPx: { x: 0, y: 0 },
    playerM: { x: 0, y: 0 }, peekM: { x: 0, y: 0 },
    cellsPerTile: 16, mPerPx: 1, tileEdgeM: WorldGen.TILE_PX,
    cellM: WorldGen.TILE_PX / 16,
    viewLeft: 0, viewTop: 0, viewSize: 320, viewCenterX: 160, viewCenterY: 160,
    gasGfx: {
      clear() { clears++; rects.length = 0; },
      fillStyle(_color, a) { alpha = a; },
      fillRect(x, y, width, height) { rects.push({ x, y, width, height, alpha }); },
    },
  };
  try {
    MushroomGas.cells = () => cells;
    GasRender.draw(s);
    assert.eq(rects.length, 0, 'new gas fades in from transparent');
    s.time.now = 400;
    GasRender.draw(s);
    assert.eq(rects.length, gasPaintRects(1).length, 'offscreen cloud is culled');
    const x = rects[0].x;
    const count = clears;
    s.time.now = 410;
    GasRender.draw(s);
    assert.eq(clears, count, 'unchanged frame skips geometry');
    s.peekM.x = s.cellM;
    GasRender.draw(s);
    assert.lt(rects[0].x, x, 'peek moves gas with the world');
    cells = [];
    GasRender.draw(s);
    assert.gt(rects.length, 0, 'removed gas fades out');
    s.time.now = 800;
    GasRender.draw(s);
    assert.eq(rects.length, 0);
    assert.eq(s._gasVisual.cells.size, 0);
    s.depth = 1;
    GasRender.draw(s);
    assert.eq(rects.length, 0, 'surface gas cannot leak underground');
  } finally {
    MushroomGas.cells = originalCells;
  }
});
