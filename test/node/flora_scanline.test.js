// Run the actual flora scatter against the polygon ray test it replaces.
// Candidate order determines RNG consumption and therefore saved world IDs.
(function () {
  const start = WORLDGEN_SRC.indexOf('    function* spawnDebrisSteps(');
  const end = WORLDGEN_SRC.indexOf('\n    }', start) + 6;
  const scatterSource = WORLDGEN_SRC.slice(start, end);
  const pointStart = WORLDGEN_SRC.indexOf('  function pointInRings(');
  const pointEnd = WORLDGEN_SRC.indexOf('\n  }', pointStart) + 4;
  const contains = new Function(WORLDGEN_SRC.slice(pointStart, pointEnd) + '\nreturn pointInRings;')();
  const rngStart = WORLDGEN_SRC.indexOf('  function makeRng(');
  const rngEnd = WORLDGEN_SRC.indexOf('\n  }', rngStart) + 4;
  const makeRng = new Function('_reviewSalt', WORLDGEN_SRC.slice(rngStart, rngEnd) + '\nreturn makeRng;')(0);
  const rect = (x0, y0, x1, y1) => [
    { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 },
  ];
  function run(rings, step, density, patch) {
    const points = rings.flat();
    const bb = { minX: Math.min(...points.map(p => p.x)), maxX: Math.max(...points.map(p => p.x)),
      minY: Math.min(...points.map(p => p.y)), maxY: Math.max(...points.map(p => p.y)) };
    const env = {
      makeRng, bboxOf: () => bb, tx: 0, ty: 0, TILE_EXTENT: 4096,
      CELL_M: step, mvtToM: 1, mvtToCell: 1 / step, w: 64, h: 64,
      cellCenterMeters: (ix, iy) => ({ mx: ix + .5, my: iy + .5 }),
      cellId: (_, tx, ty, ix, iy) => `${tx}/${ty}/${ix}/${iy}`,
      makeWildplant: (crop, x, y, id, meta) => ({ crop, x, y, id, ...meta }),
      BiomeProfiles: { patchMul: (_, x, y) => (Math.sin(x + y) + 1) / 2 },
      wildplants: [],
    };
    const factory = new Function('env', 'const {' + Object.keys(env).join(',') + '} = env;\n'
      + scatterSource + '\nreturn spawnDebrisSteps;');
    const it = factory(env)(rings, 'test', 12345, density, density, patch);
    const yielded = [];
    for (let next = it.next(); !next.done; next = it.next()) yielded.push(next.value);
    const expected = [], rng = makeRng(12345);
    rng(); // The density roll occurs even when its two bounds coincide.
    for (let y = bb.minY; y <= bb.maxY; y += step) {
      for (let x = bb.minX; x <= bb.maxX; x += step) {
        if (!contains(rings, x + step * .5, y + step * .5)) continue;
        const ix = Math.floor(x * env.mvtToCell), iy = Math.floor(y * env.mvtToCell);
        if (ix < 0 || iy < 0 || ix >= env.w || iy >= env.h) continue;
        const d = patch ? density * env.BiomeProfiles.patchMul(patch, x + step * .5, y + step * .5) : density;
        if (rng() < d) expected.push({ crop: 'test', x: ix + .5, y: iy + .5,
          id: `0/0/${ix}/${iy}`, _ix: ix, _iy: iy });
      }
    }
    assert.eq(JSON.stringify(env.wildplants), JSON.stringify(expected), 'flora identity, order and rolls match ray testing');
    return yielded;
  }
  test('flora scanline: holes, overlapping rings and exact crossing boundaries retain seeded output', () => {
    const shapes = [
      [rect(0, 0, 20, 20), rect(4.5, 4.5, 12.5, 12.5)],
      [rect(-4, -4, 15, 15), rect(7.5, 2.5, 23.5, 17.5)],
      [[{ x: 0, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }, { x: 20, y: 0 }]],
      [rect(0, 0, 20, 20), rect(0, 0, 20, 20)],
      [rect(-8, -5, 70, 68)],
    ];
    for (const rings of shapes) for (const step of [1, 1.3, 2]) {
      run(rings, step, 1, null);
      run(rings, step, .43, {});
      run(rings.map(r => r.slice().reverse()), step, .43, {});
    }
  });
  test('flora scanline: tile-wide scatter retains row yields', () => {
    const yielded = run([rect(0, 0, 40, 40)], 1, .43, {});
    assert.gt(yielded.length, 3);
    assert.truthy(yielded.every(label => label === 'flora scatter rows'));
  });
})();
