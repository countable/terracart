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

  test('gas: sealed room conserves even gas below the disappearance threshold', () => {
    const state = Gas.create();
    Gas.inject(state, 0, 0, .1);
    for (let second = 0; second < 200; second++) Gas.advance(state, 1000, room);
    assert.eq(state.cells.size, 25);
    near(mass(state), .1);
    assert.truthy([...state.cells.values()].every(c => c.density < state.config.minDensity));
  });

  test('gas: topology is reconsidered after a sealed room gains an exterior opening', () => {
    const state = Gas.create();
    Gas.inject(state, 0, 0, .01);
    Gas.advance(state, 1000, room);
    near(mass(state), .01);
    Gas.advance(state, 1000, (x, y) => x === 3 && y === 0 ? 'unknown' : room(x, y));
    assert.eq(state.cells.size, 0);
  });

  test('gas: ventilation of one disconnected region cannot erase sealed gas', () => {
    const state = Gas.create();
    Gas.inject(state, 0, 0, .01);
    Gas.inject(state, 10, 0, .01);
    const terrain = (x, y) => Math.abs(x) <= 2 && Math.abs(y) <= 2 ? 'open'
      : Math.abs(x - 10) <= 2 && Math.abs(y) <= 2 ? 'open'
      : x === 13 && y === 0 ? 'unknown' : 'wall';
    Gas.advance(state, 1000, terrain);
    near(mass(state), .01);
    assert.truthy([...state.cells.values()].every(c => c.x < 3));
  });

  test('gas: traversal and sparse-cell caps conserve gas when topology is uncertain', () => {
    const state = Gas.create({ maxCells: 6, maxTopologyCells: 12 });
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
    const state = Gas.create();
    Gas.inject(state, 0, 0);
    Gas.advance(state, 250, room);
    assert.eq(Gas.advance(state, 3600000, room), 5);
    assert.eq(state.remainderMs, 250);
    assert.eq(Gas.advance(state, 750, room), 1);
    near(mass(state), 1);
  });

  test('gas: mapped neighbors drive both diffusion and enclosure traversal', () => {
    const state = Gas.create();
    const neighbors = (x, y) => [{ x: x + 10, y }, { x: x - 10, y }, { x, y: y + 1 }, { x, y: y - 1 }];
    const terrain = (x, y) => y === 0 && (x === 0 || x === 10) ? 'open' : 'wall';
    Gas.inject(state, 0, 0, .01);
    Gas.advance(state, 1000, terrain, neighbors);
    assert.eq(state.cells.size, 2);
    near(state.cells.get('10,0').density, .00125);
    near(mass(state), .01);
    Gas.advance(state, 1000, (x, y) => x === 20 && y === 0 ? 'unknown' : terrain(x, y), neighbors);
    assert.eq(state.cells.size, 0);
  });
})();
