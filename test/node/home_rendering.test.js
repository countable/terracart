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
