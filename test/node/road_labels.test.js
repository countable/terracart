// Street-name labels (worldgen roadLabels): named footpaths carry them like
// vehicle roads, on the shared one-anchor-per-LABEL_PERIOD walk.
test('road labels: a named footpath carries a label anchor, as a road does', () => {
  const W = WorldGen, key = '2753_5567';
  const [tx, ty] = key.split('_').map(Number);
  const N = W.cellsPerEdgeForTile(ty);
  const r = W.rasterizeTile(MVT.decodeTile(FIXTURE_TILES[key]), N, tx, ty, W.tileEdgeMeters(W.latOfRowCentre(ty)));
  const on = t => Object.entries(r.roadLabels).filter(([k]) => {
    const [ix, iy] = k.split('_').map(Number);
    return r.grid[iy * N + ix] === t;
  });
  assert.gt(on(W.T.ROAD).length, 0, 'roads are labelled');
  const paths = on(W.T.PATH);
  assert.gt(paths.length, 0, 'named paths are labelled too');
  for (const [, info] of paths) {
    assert.truthy(info.text && !/\s/.test(info.text), 'a path label is one whole word');
    assert.truthy(info.angle > -Math.PI / 2 - 1e-9 && info.angle <= Math.PI / 2 + 1e-9, 'never upside down');
  }
});
test('road labels: the render pass draws anchors on path cells', () => {
  assert.truthy(/if \(!isTilled && \(isRoadType\(type\) \|\| type === T_PATH\)\) \{\s*\/\/ Look up this cell's label anchor/.test(RENDER_SRC),
    'the label gate admits PATH cells');
});
