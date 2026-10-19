// Home is a presentation override; generated road selections stay reusable.
test('Home rendering: themed road crossing splits exactly around Home and keeps its physical middle', () => {
  const scene = { depth: 0, save: { starterCratesAt: { x: 0, y: 0 } } };
  const pts = [{ x: -100, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 }];
  const runs = RoadOverlay.homeRoadRuns(scene, pts);
  assert.eq(runs.length, 3);
  assert.falsy(runs[0].home); assert.truthy(runs[1].home); assert.falsy(runs[2].home);
  assert.eq(runs[0].pts.at(-1).x, -50);
  assert.eq(runs[1].pts[0].x, -50); assert.eq(runs[1].pts.at(-1).x, 50);
  assert.eq(runs[2].pts[0].x, 50);
  assert.eq(pts.length, 3, 'input line is immutable');
  const deep = RoadOverlay.homeRoadRuns({ ...scene, depth: 1 }, pts);
  assert.eq(deep.length, 1); assert.falsy(deep[0].home);
});

test('Home rendering: Home label takes precedence over underlying road and nexus labels only on surface', () => {
  const scene = { depth: 0, save: { starterCratesAt: { x: 0, y: 0 } } };
  const entries = [{ tx: 0, ty: 0,
    zone: { anchors: [{ kind: 'grove', gx: 0, gy: 0, lx: 0, ly: 0, owned: true, variant: 'meadow' }] },
    streetIndex: { extent: 100, lines: [{ key: 'home road', variant: 'golden', line: [{ x: -20, y: 0 }, { x: 20, y: 0 }] }] },
  }];
  const labels = Render.variantLabelRecords(entries, 100, 0, 0, 100, scene);
  assert.eq(labels.length, 1); assert.eq(labels[0].text, 'Zone: Home');
  const deep = Render.variantLabelRecords(entries, 100, 0, 0, 100, { ...scene, depth: 1 });
  assert.eq(deep.length, 2); assert.falsy(deep.some(l => l.id === 'home'));
  assert.eq(entries[0].streetIndex.lines[0].variant, 'golden');
});

test('Home roads: shared pavement selection and hot-road effects yield to Home without changing generated themes', () => {
  for (const size of ['minor', 'path']) {
    const N = 20, extent = 200;
    const line = [{ x: 0, y: 95 }, { x: 200, y: 95 }];
    const feature = { geom: [line] };
    const rec = { fi: 0, li: 0, line, size, variant: 'burned', selectedVariant: 'burned', halfW: 5,
      nexusSuppressedRanges: [[0, 20]] };
    const source = { extent, lines: [rec] };
    const scene = { depth: 0, tileEdgeM: extent, save: { starterCratesAt: { x: 100, y: 100 } } };
    const entry = { depth: 0, tileEdgeM: extent, cellsPerEdge: N, streetIndex: source,
      grid: new Uint8Array(N * N).fill(WorldGen.T.ROAD), objects: [] };
    HomeVariant.apply(scene, entry, 0, 0);
    const styles = StreetVariants.lineStyles(entry, feature, 0, 0, 1);
    assert.eq(JSON.stringify(styles.map(p => [p.a, p.b, p.variant])),
      '[[0,20,null],[20,50,"burned"],[50,150,null],[150,200,"burned"]]');
    assert.falsy(StreetVariants.hotRoadAt(entry, 5.01, 9.5), 'themed end caps cannot burn Home');
    assert.truthy(StreetVariants.hotRoadAt(entry, 17, 9.5), 'outside retains its theme');
    assert.eq(entry.streetIndex, source); assert.eq(rec.homeSuppressedRanges, undefined);
    assert.eq(StreetVariants.variantAt(rec, 100), 'burned', 'generated and cave source remains themed');
    entry._homeVariantGenerating = true;
    assert.eq(StreetVariants.indexFor(entry), source);
    delete entry._homeVariantGenerating;
    entry.depth = 2;
    assert.eq(StreetVariants.indexFor(entry), source, 'Home suppression is surface only');
  }
});
