// Fixed class/restoration surfaces remain independent of street variants.
(function () {
  const WIDTH = 40;
  const LINE = [{ x: 0, y: 0 }, { x: 300, y: 0 }];
  function record(family, restored, run = LINE, options = {}, scene = { cellM: 7 }) {
    const ink = [], cuts = [];
    const target = {
      decorPath(w, color, points, alpha, roadWidth) {
        ink.push({ w, color, points, alpha, roadWidth });
      },
      cutPath(w, points, roadWidth) { cuts.push({ w, points, roadWidth }); },
    };
    RoadSurfaces.decorate(scene, target, run, WIDTH, family, restored, { pxPerM: 1, ...options });
    return { ink, cuts };
  }
  function close(a, b, message) { assert.inRange(a, b - 1e-8, b + 1e-8, message); }
  function horizontalSpan(row) {
    const xs = row.points.map(p => p.x);
    return Math.max(...xs) - Math.min(...xs);
  }

  test('fixed road surfaces: only Medium/Large classification selects a family', () => {
    for (const cls of ['secondary', 'tertiary']) {
      assert.eq(RoadSurfaces.familyFor({ class: cls }), 'md', cls);
      assert.eq(RoadSurfaces.familyFor({ class: cls, name: 'Berry Orchard Lane' }), 'md', 'name does not create a variant');
    }
    for (const cls of ['motorway', 'trunk', 'primary']) assert.eq(RoadSurfaces.familyFor({ class: cls }), 'lg', cls);
    for (const cls of ['minor', 'residential', 'service', 'path', 'footway', 'cycleway', 'rail']) {
      assert.eq(RoadSurfaces.familyFor({ class: cls }), null, cls + ' keeps its own renderer');
    }
    assert.eq(RoadSurfaces.familyFor(null), null, 'missing source class has no fixed-road treatment');
  });

  test('fixed road surfaces: route decoration is deterministic and follows camera translation', () => {
    for (const family of ['md', 'lg']) for (const restored of [false, true]) {
      const first = record(family, restored);
      assert.eq(JSON.stringify(record(family, restored)), JSON.stringify(first), 'rebuilds reproduce the same marks');
      const translated = record(family, restored, LINE.map(p => ({ x: p.x + 37, y: p.y - 19 })));
      for (const list of ['ink', 'cuts']) {
        assert.eq(translated[list].length, first[list].length, 'camera motion does not add/remove marks');
        for (let i = 0; i < first[list].length; i++) {
          assert.eq(translated[list][i].points.length, first[list][i].points.length);
          first[list][i].points.forEach((p, j) => {
            close(translated[list][i].points[j].x, p.x + 37);
            close(translated[list][i].points[j].y, p.y - 19);
          });
        }
      }
    }
  });

  test('fixed road surfaces: partial source intervals retain the original-way fracture and conduit phase', () => {
    // 72 original metres at 1.25px/m places this section at x90, deliberately
    // between trace samples. The remaining samples must match the whole way.
    for (const restored of [false, true]) {
      const whole = record('lg', restored, LINE, { pxPerM: 1.25 });
      const part = record('lg', restored, [{ x: 90, y: 0 }, { x: 300, y: 0 }], { startM: 72, pxPerM: 1.25 });
      const fullTrace = whole.ink[0].points.filter(p => p.x > 90);
      const partTrace = part.ink[0].points.filter(p => p.x > 90);
      assert.eq(partTrace.length, fullTrace.length);
      partTrace.forEach((p, i) => { close(p.x, fullTrace[i].x); close(p.y, fullTrace[i].y); });
      if (restored) {
        const glyphs = rows => rows.filter(row => horizontalSpan(row) < 16 && row.points.every(p => Math.abs(p.y) < WIDTH * .25));
        const fullGlyphs = glyphs(whole.ink).filter(row => row.points.every(p => p.x > 90));
        const partGlyphs = glyphs(part.ink).filter(row => row.points.every(p => p.x > 90));
        assert.gt(partGlyphs.length, 0, 'the partial repair still contains native glyph strokes');
        assert.eq(partGlyphs.length, fullGlyphs.length, 'repair clipping keeps glyph positions and repeat phase');
        partGlyphs.forEach((row, i) => row.points.forEach((p, j) => {
          close(p.x, fullGlyphs[i].points[j].x); close(p.y, fullGlyphs[i].points[j].y);
        }));
      }
    }
  });

  test('fixed road surfaces: damaged Medium roads lose chunks and clean edges return only after restoration', () => {
    const broken = record('md', false), restored = record('md', true);
    assert.gt(broken.cuts.length, 0, 'unrestored road silhouette has real missing pieces');
    assert.gt(broken.ink.length, 0, 'weathered road has cracks');
    assert.falsy(broken.ink.some(row => horizontalSpan(row) > 100), 'no continuous polished drain or kerb on the broken road');
    assert.eq(restored.cuts.length, 0, 'restoration removes the edge cutouts');
    for (const side of [-1, 1]) {
      assert.truthy(restored.ink.some(row => horizontalSpan(row) > 100
        && row.points.every(p => p.y * side > WIDTH * .3)), 'restored gravel has a finished edge on each side');
    }
    assert.truthy(broken.cuts.every(row => row.roadWidth === WIDTH), 'damage shares the owning road width for occlusion');
  });

  test('fixed road surfaces: Large restoration replaces the central scar with paired channels and native glyph strokes', () => {
    const scar = record('lg', false), conduit = record('lg', true);
    assert.truthy(scar.ink.some(row => row.w > WIDTH * .1 && horizontalSpan(row) > 100), 'unrestored road has a broad continuous central fracture');
    assert.falsy(conduit.ink.some(row => row.w > WIDTH * .1), 'restored conduit does not retain the old central tear');
    for (const side of [-1, 1]) {
      assert.truthy(conduit.ink.some(row => horizontalSpan(row) > 100
        && row.points.every(p => p.y * side > WIDTH * .25)), 'conduit carries a continuous channel on each side');
    }
    const glyphs = conduit.ink.filter(row => horizontalSpan(row) < 16 && row.points.every(p => Math.abs(p.y) < WIDTH * .25));
    assert.gt(glyphs.length, 20, 'several native glyph silhouettes are stamped along the road');
    assert.eq(conduit.cuts.length, 0, 'the stabilized road bed remains whole');
  });

  test('fixed road surfaces: source length outside the viewport does not multiply decoration work', () => {
    const scene = { cellM: 7, viewLeft: 0, viewTop: 0, viewSize: 352 };
    const distant = record('lg', true, [{ x: 5000, y: 5000 }, { x: 9000, y: 9000 }], {}, scene);
    assert.eq(distant.ink.length, 0, 'fully distant ways emit nothing');
    const long = record('lg', true, [{ x: -100000, y: 176 }, { x: 100000, y: 176 }], {}, scene);
    assert.gt(long.ink.length, 0, 'the in-view portion is still drawn');
    assert.lt(long.ink.length, 200, 'glyph count follows viewport size rather than full source length');
    assert.truthy(long.ink.every(row => row.points.every(p => p.x > -100 && p.x < 450)), 'emitted points remain near the viewport');
  });

  test('fixed road surfaces: atlas setup caches four state tiles without pixel reads and clears stale sources', () => {
    const original = document.createElement, draws = [];
    document.createElement = () => {
      const ctx = { drawImage(...args) { draws.push(args); },
        getImageData() { throw new Error('production material setup must not read pixels'); } };
      return { width: 0, height: 0, getContext: () => ctx };
    };
    try {
      const source = { width: 512, height: 128 };
      RoadSurfaces.setSource(source);
      const tiles = ['md', 'lg'].flatMap(family => [false, true].map(state => {
        const tile = RoadSurfaces.tile(family, state);
        assert.truthy(tile, 'all fixed class/state combinations load');
        assert.eq(RoadSurfaces.tile(family, state), tile, 'repeat requests reuse their canvas');
        assert.eq(tile.width, 128); assert.eq(tile.height, 128);
        return tile;
      }));
      assert.eq(new Set(tiles).size, 4, 'class/state combinations do not overwrite each other');
      assert.eq(draws.length, 4, 'each atlas frame is cropped once');
      RoadSurfaces.setSource(null);
      assert.eq(RoadSurfaces.tile('md', false), null, 'an unloaded source cannot leave stale art');
      assert.eq(RoadSurfaces.tile('lg', true), null);
    } finally {
      RoadSurfaces.setSource(null);
      document.createElement = original;
    }
  });
})();
