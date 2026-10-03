(function () {
  const W = WorldGen;
  function towers(width, height, ox, oy, footprint, blocked = () => false) {
    const steps = W.castleTowerCellsSteps(width, height, ox, oy,
      (x, y) => footprint(x + ox, y + oy), (x, y) => blocked(x + ox, y + oy));
    let r = steps.next();
    while (!r.done) r = steps.next();
    return r.value.map(([x, y]) => [x + ox, y + oy]);
  }
  const rectOwner = (x0, y0, x1, y1) => (x, y) =>
    x >= x0 && y >= y0 && x <= x1 && y <= y1 ? 1 : null;
  const norm = cells => cells.map(p => p.join(',')).sort().join(' ');

  test('castle towers: seats favour available corners without adding density', () => {
    const owner = rectOwner(3, 3, 12, 12);
    const cells = towers(20, 20, 0, 0, owner);
    const keys = new Set(cells.map(p => p.join(',')));
    for (const corner of ['3,3', '12,3', '3,12', '12,12']) assert.truthy(keys.has(corner), corner);
    assert.inRange(cells.length, 4, 8, '36 wall cells keep about one seat per five');
    for (const [x, y] of cells) {
      assert.eq(owner(x, y), 1);
      assert.truthy(x === 3 || x === 12 || y === 3 || y === 12, 'same cell as perimeter wall');
    }
  });

  test('castle towers: tile seams neither create walls nor change corner seats', () => {
    const owner = rectOwner(4, 4, 26, 26);
    const whole = towers(32, 32, 0, 0, owner);
    const split = [];
    for (const oy of [0, 16]) for (const ox of [0, 16]) split.push(...towers(16, 16, ox, oy, owner));
    assert.eq(norm(split), norm(whole), 'four tiles agree with the unsplit footprint');
    assert.falsy(split.some(([x, y]) => x > 4 && x < 26 && y > 4 && y < 26), 'no interior seam towers');
  });

  test('castle towers: a blocked corner leaves its seat on an available wall', () => {
    const owner = rectOwner(3, 3, 12, 12);
    const cells = towers(20, 20, 0, 0, owner, (x, y) => x === 3 && y === 3);
    assert.falsy(cells.some(([x, y]) => x === 3 && y === 3));
    assert.truthy(cells.some(([x, y]) => x === 3 && y < 7 || y === 3 && x < 7), 'nearby wall keeps a seat');
  });

  test('castle towers: tiny footprints never gain a tower for every corner', () => {
    const cells = towers(10, 10, 0, 0, rectOwner(2, 2, 3, 3));
    assert.lte(cells.length, 1, 'corner preference spends only an existing lattice seat');
  });

  test('castle towers: negative absolute coordinates are deterministic and sliced', () => {
    const owner = rectOwner(-20, -20, -3, -3);
    assert.eq(norm(towers(32, 32, -32, -32, owner)), norm(towers(32, 32, -32, -32, owner)));
    const steps = W.castleTowerCellsSteps(256, 256, 0, 0, () => null);
    let yields = 0;
    for (const label of steps) { assert.eq(label, 'tower corner seats'); yields++; }
    assert.gt(yields, 30, 'empty tile scans yield too');
  });
})();
