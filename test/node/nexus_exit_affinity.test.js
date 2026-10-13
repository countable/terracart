(() => {
  const SV = StreetVariants, N = 60, extent = 600;
  const point = (x, y = 100) => ({ x, y });
  const way = (line, size = 'path', tags = {}) => ({ line, size, tags });
  function zone() {
    const coverage = new Uint16Array(N * N);
    for (let y = 9; y <= 10; y++) for (let x = 4; x < 10; x++) coverage[y * N + x] = 1;
    return { coverage, anchors: [{ kind: 'grove', variant: 'orchard', gx: 7, gy: 10 }] };
  }
  function sampler(lines, scale = 1) {
    const steps = SV.nexusExitAffinitySteps({ extent, lines }, zone(), N, scale);
    let step;
    do { step = steps.next(); } while (!step.done);
    return step.value;
  }
  const strength = context => Object.values(context).reduce((sum, value) => sum + value, 0);

  test('nexus exits: affinity fades along connected paths and Small roads over 150 metres', () => {
    assert.eq(SV.NEXUS_EXIT_AFFINITY_M, 150);
    for (const size of ['path', 'minor']) {
      const sample = sampler([way([point(50), point(400)], size)]);
      const near = sample(point(110), size), farther = sample(point(180), size);
      assert.gt(near.cultivated, 0, 'the exit carries the orchard affinity');
      assert.gt(strength(near), strength(farther));
      assert.gt(strength(farther), 0);
      assert.eq(strength(sample(point(260), size)), 0, 'beyond 150m from coverage the influence ends');
      assert.inRange(strength(near) - strength(farther), 70 / 150 - .000001, 70 / 150 + .000001,
        'affinity fades with travelled metres, independently of its number of traits');
    }
  });

  test('nexus exits: influence uses metres rather than raw tile coordinates', () => {
    const sample = sampler([way([point(50), point(400)])], 2);
    assert.gt(strength(sample(point(130), 'path')), 0);
    assert.eq(strength(sample(point(190), 'path')), 0, '90 tile units beyond coverage exceed the 150m radius');
  });

  test('nexus exits: disconnected parallel ways and grade-separated branches receive no influence', () => {
    const base = way([point(50), point(400)]);
    const bridge = { layer: 1, brunnel: 'bridge' };
    const tunnel = { layer: -1, brunnel: 'tunnel' };
    const sample = sampler([
      base, way([point(50, 120), point(400, 120)]),
      way([point(150), point(150, 200)], 'path', bridge),
      way([point(170), point(170, 200)], 'path', tunnel),
      way([point(190), point(190, 200)], 'minor'),
    ]);
    assert.gt(strength(sample(point(150), 'path')), 0);
    assert.eq(strength(sample(point(150, 120), 'path')), 0, 'a nearby parallel path is disconnected');
    assert.eq(strength(sample(point(150, 150), 'path', bridge)), 0, 'a bridge crossing is disconnected');
    assert.eq(strength(sample(point(170, 150), 'path', tunnel)), 0, 'a tunnel crossing is disconnected');
    assert.eq(strength(sample(point(190, 120), 'minor')), 0, 'road and path affinity networks remain separate');
  });

  test('nexus exits: true T branches connect to segment interiors and measure distance around the turn', () => {
    const sample = sampler([
      way([point(50), point(400)]), way([point(150), point(150, 240)]),
    ]);
    const onBranch = strength(sample(point(150, 150), 'path'));
    assert.gt(onBranch, 0, 'the endpoint joins the interior of the through path');
    assert.inRange(onBranch, strength(sample(point(200), 'path')) - .000001,
      strength(sample(point(200), 'path')) + .000001, 'equal route distance gives equal influence');
    assert.eq(strength(sample(point(150, 220), 'path')), 0,
      'a point nearby in straight-line distance can lie beyond the connected-route radius');
  });

  test('nexus exits: reversing and reordering source ways preserves the influence', () => {
    const lines = [way([point(50), point(400)]), way([point(150), point(150, 240)])];
    const original = sampler(lines);
    const reversed = sampler(lines.slice().reverse().map(rec => ({ ...rec, line: rec.line.slice().reverse() })));
    for (const p of [point(110), point(180), point(260), point(150, 150), point(150, 220)]) {
      const a = original(p, 'path'), b = reversed(p, 'path');
      assert.eq(Object.keys(a).sort().join(), Object.keys(b).sort().join());
      for (const trait of Object.keys(a)) assert.inRange(b[trait], a[trait] - 1e-9, a[trait] + 1e-9);
    }
  });
})();
