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
test('road labels: ink follows the surface each label is printed on', () => {
  const lum = hex => { const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); return .2126 * r + .7152 * g + .0722 * b; };
  const keys = ['plain', 'suppressed', 'parkpath', 'lantern', 'burned', 'haunted_forest_path', 'surface:md', 'surface:lg'];
  const inks = keys.map(k => RoadOverlay.labelInk(k));
  assert.eq(new Set(inks.map(i => i.fill)).size, keys.length, 'every surface has its own ink');
  for (const [k, ink] of keys.map((k, i) => [k, inks[i]])) {
    assert.truthy(/^#[0-9a-f]{6}$/.test(ink.fill) && /^#[0-9a-f]{6}$/.test(ink.halo) && /^#[0-9a-f]{6}$/.test(ink.lip), `${k} inks are colours`);
    // Engraved: the glyphs sit on the far side of the stone from the lip.
    assert.truthy((lum(ink.fill) - lum(ink.halo)) * (lum(ink.lip) - lum(ink.halo)) < 0, `${k}: groove and lip straddle the stone`);
  }
  assert.gt(lum(RoadOverlay.labelInk('surface:lg').fill), lum(RoadOverlay.labelInk('surface:lg').halo), 'the dark highway takes light ink');
  assert.lt(lum(RoadOverlay.labelInk('plain').fill), lum(RoadOverlay.labelInk('plain').halo), 'pale stone takes dark ink');
  assert.eq(RoadOverlay.labelInk('no_such_variant').fill, RoadOverlay.labelInk('plain').fill, 'an unknown key reads as plain');
});
test('road labels: a Nexus path anchor still names and inks its theme', () => {
  const row = StreetVariants.VARIANT_BY_ID.parkpath, N = 8, mid = 4.5 * 4096 / N;
  const entry = { cellsPerEdge: N, roadClass: new Uint8Array(N * N), streetMarks: new Uint8Array(N * N),
    streetIndex: { extent: 4096, lines: [], nexusCoverage: new Uint8Array(N * N).fill(1),
      dressingLines: [{ size: 'path', key: 'p', variant: row.id, halfW: 1, line: [{ x: mid, y: 0 }, { x: mid, y: 4096 }] }] } };
  const view = Render.roadLabelView(entry, 4, 3, 8, { text: 'Common' });
  assert.eq(view.text, `Common ${StreetVariants.labelName(row)}`);
  assert.eq(view.ink, 'parkpath');
  assert.eq(Render.roadLabelView(entry, 0, 0, 7, { text: 'Elm' }).ink, 'suppressed', 'a suppressed minor road wears the Nexus tone');
  assert.eq(Render.roadLabelView(entry, 0, 0, 14, { text: 'Gordon' }).ink, 'surface:md');
});
