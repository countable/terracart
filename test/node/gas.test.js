(function () {
  const mass = state => [...state.cells.values()].reduce((sum, c) => sum + c.density, 0);
  const near = (actual, expected) => assert.truthy(Math.abs(actual - expected) < 1e-9, `${actual} ≈ ${expected}`);
  const openBox = (x, y) => Math.abs(x) <= 20 && Math.abs(y) <= 20 ? 'open' : 'unknown';
  const room = (x, y) => Math.abs(x) <= 2 && Math.abs(y) <= 2 ? 'open' : 'wall';

  test('gas: advances once per second, simultaneously into cardinal cells', () => {
    const state = Gas.create();
    Gas.inject(state, 0, 0);
    assert.eq(Gas.advance(state, 999, openBox), 0);
    assert.eq(state.cells.size, 1);
    assert.eq(Gas.advance(state, 1, openBox), 1);
    assert.eq(state.cells.size, 5);
    near(state.cells.get('0,0').density, .5);
    for (const id of ['1,0', '-1,0', '0,1', '0,-1']) near(state.cells.get(id).density, .125);
    assert.falsy(state.cells.has('1,1'), 'new gas does not diffuse again within the same second');
    near(mass(state), 1);
  });

  test('gas: walls and unloaded cells retain their share without absorbing mass', () => {
    const state = Gas.create({ minDensity: 0 });
    Gas.inject(state, 0, 0);
    Gas.advance(state, 1000, (x, y) => x === 1 ? 'wall' : y === 1 ? 'unknown' : 'open');
    near(state.cells.get('0,0').density, .75);
    assert.falsy(state.cells.has('1,0'));
    assert.falsy(state.cells.has('0,1'));
    near(mass(state), 1);
  });

  test('gas: outdoor clouds spread and eventually disappear when thin', () => {
    const state = Gas.create();
    Gas.inject(state, 0, 0);
    for (let second = 0; second < 120; second++) Gas.advance(state, 1000, openBox);
    assert.eq(state.cells.size, 0);
  });

  test('gas: thin cells vanish in sealed rooms and at unloaded boundaries', () => {
    for (const terrain of [room, () => 'unknown', () => 'wall']) {
      const state = Gas.create();
      Gas.inject(state, 0, 0, state.config.minDensity / 2);
      Gas.advance(state, 1000, terrain);
      assert.eq(state.cells.size, 0, 'enclosure never exempts thin gas');
    }
    const state = Gas.create();
    Gas.inject(state, 0, 0, .3);
    for (let second = 0; second < 30; second++) Gas.advance(state, 1000, room);
    assert.eq(state.cells.size, 0, 'a normal puff fully thins out in a sealed room');
  });

  test('gas: cutoff is strictly below the configured density and preserves dense neighbours', () => {
    const state = Gas.create({ minDensity: .05 });
    Gas.inject(state, 0, 0, .049);
    Gas.inject(state, 2, 0, .05);
    Gas.inject(state, 4, 0, .1);
    Gas.advance(state, 1000, () => 'unknown');
    assert.falsy(state.cells.has('0,0'));
    near(state.cells.get('2,0').density, .05);
    near(state.cells.get('4,0').density, .1);
  });

  test('gas: sparse-cell caps bound work without losing above-threshold gas', () => {
    const state = Gas.create({ maxCells: 6, minDensity: 0 });
    let reads = 0;
    Gas.inject(state, 0, 0, .01);
    for (let second = 0; second < 30; second++) {
      reads = 0;
      Gas.advance(state, 1000, () => { reads++; return 'open'; });
      assert.truthy(reads < 100, 'finite work on an infinitely open callback');
      assert.truthy(state.cells.size <= 6);
      near(mass(state), .01);
    }
    assert.falsy(Gas.inject(state, 50, 50), 'new sources cannot exceed memory cap');
    assert.truthy(Gas.inject(state, 0, 0, .01), 'existing sources still emit');
    near(mass(state), .02);
  });

  test('gas: long frame gaps cap catch-up and preserve fractional-second timing', () => {
    const state = Gas.create({ minDensity: 0 });
    Gas.inject(state, 0, 0);
    Gas.advance(state, 250, room);
    assert.eq(Gas.advance(state, 3600000, room), 5);
    assert.eq(state.remainderMs, 250);
    assert.eq(Gas.advance(state, 750, room), 1);
    near(mass(state), 1);
  });

  test('gas: mapped neighbors drive diffusion before the density cutoff', () => {
    const state = Gas.create({ minDensity: 0 });
    const neighbors = (x, y) => [{ x: x + 10, y }, { x: x - 10, y }, { x, y: y + 1 }, { x, y: y - 1 }];
    const terrain = (x, y) => y === 0 && (x === 0 || x === 10) ? 'open' : 'wall';
    Gas.inject(state, 0, 0, .01);
    Gas.advance(state, 1000, terrain, neighbors);
    assert.eq(state.cells.size, 2);
    near(state.cells.get('10,0').density, .00125);
    near(mass(state), .01);
    state.config.minDensity = .025;
    Gas.advance(state, 1000, (x, y) => x === 20 && y === 0 ? 'unknown' : terrain(x, y), neighbors);
    assert.eq(state.cells.size, 0);
  });
})();
