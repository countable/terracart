(function () {
  function neighbors(record) {
    const cells = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (dx || dy) cells.push({ depth: record.depth,
        cellIX: record.cellIX + dx, cellIY: record.cellIY + dy });
    }
    return cells;
  }
  const at = (save, x, y = 0, depth = 0) => save.groundFire[GroundFire.key(depth, x, y)];

  test('ground fire: trees survive, grass bushes and tar burn away, other objects are not fuel', () => {
    for (const kind of ['tree', 'fruittree']) {
      assert.truthy(GroundFire.flammable({ kind }));
      assert.truthy(GroundFire.survives({ kind }));
    }
    for (const object of [
      { kind: 'tar' }, { kind: 'bush' }, { kind: 'shrub' },
      { kind: 'wildplant', crop: 'longgrass' }, { kind: 'wildplant', crop: 'shrub' },
      { kind: 'wildplant', crop: 'bush' },
      { kind: 'wildplant', crop: 'shrub', _streetArt: 'bramble' },
      { kind: 'wildplant', crop: 'shrub', _plantArt: 'bramble' },
      { kind: 'shrub', _plantArt: 'bramble' },
    ]) {
      assert.truthy(GroundFire.flammable(object));
      assert.falsy(GroundFire.survives(object));
    }
    for (const object of [null, {}, { kind: 'rock' }, { kind: 'wildplant', crop: 'shell' },
      { kind: 'wildplant', crop: 'carrot' }, { kind: 'house', crop: 'shrub' }]) {
      assert.falsy(GroundFire.flammable(object));
      assert.falsy(GroundFire.survives(object));
    }
  });

  test('ground fire: lifetime is 10–30 seconds and burned cells never reignite', () => {
    const save = {};
    assert.truthy(GroundFire.ignite(save, 0, 0, 0, 100, () => 0));
    assert.truthy(GroundFire.ignite(save, 1, 0, 0, 100, () => 1));
    assert.eq(at(save, 0).until, 10100);
    assert.eq(at(save, 0, 0, 1).until, 30100);
    assert.falsy(GroundFire.active(at(save, 0), 99));
    assert.truthy(GroundFire.active(at(save, 0), 100));
    assert.truthy(GroundFire.active(at(save, 0), 10099));
    assert.falsy(GroundFire.active(at(save, 0), 10100));
    assert.falsy(GroundFire.ignite(save, 0, 0, 0, 500, () => 1));
    const expired = [];
    const opts = { onExtinguish: record => expired.push(record) };
    GroundFire.step(save, 40000, opts);
    GroundFire.step(save, 50000, opts);
    assert.eq(expired.length, 2, 'each fuel cleanup happens once');
    assert.falsy(GroundFire.ignite(save, 0, 0, 0, 50000));
    const loaded = JSON.parse(JSON.stringify(save));
    assert.falsy(GroundFire.ignite(loaded, 0, 0, 0, 60000), 'reload retains burned ground');
  });

  test('ground fire: spreads to diagonal fuel, skips bare ground and other depths', () => {
    const save = {};
    GroundFire.ignite(save, 0, 0, 0, 0, () => 0);
    const opts = { neighbors, flammable: cell => cell.cellIX === 1 && cell.cellIY === 1 };
    GroundFire.step(save, 999, opts, () => 0);
    assert.eq(Object.keys(save.groundFire).length, 1);
    GroundFire.step(save, 1000, opts, () => 0);
    assert.eq(Object.keys(save.groundFire).length, 2);
    assert.eq(at(save, 1, 1).litAt, 1000);
    assert.falsy(at(save, 1, 0));
    assert.falsy(at(save, 1, 1, 1));
  });

  test('ground fire: offline simulation matches small frames without fresh fire on return', () => {
    function simulate(times) {
      const save = {}, removed = [], added = [], live = new Set();
      let seed = 27;
      const rng = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
      GroundFire.ignite(save, 0, 0, 0, 0, rng);
      live.add(at(save, 0));
      for (const now of times) GroundFire.step(save, now, {
        records: live, neighbors,
        flammable: cell => cell.cellIY === 0 && cell.cellIX > 0 && cell.cellIX <= 5,
        onIgnite: record => { live.add(record); added.push(record.litAt); },
        onExtinguish: record => { live.delete(record); removed.push(record.cellIX); },
      }, rng);
      return { save, removed, added, remaining: live.size };
    }
    const coarse = simulate([60000]);
    const fine = simulate(Array.from({ length: 241 }, (_, i) => i * 250));
    assert.eq(JSON.stringify(coarse), JSON.stringify(fine));
    assert.eq(coarse.remaining, 0);
    assert.eq(coarse.removed.length, 6);
    assert.eq(coarse.added.join(','), '1000,2000,3000,4000,5000');
  });

  test('ground fire: an extinguishing source cannot spread at its expiry', () => {
    const save = {};
    GroundFire.ignite(save, 0, 0, 0, 0, () => 0);
    GroundFire.step(save, 9999, { neighbors, flammable: () => false });
    GroundFire.step(save, 10000, { neighbors, flammable: () => true });
    assert.eq(Object.keys(save.groundFire).length, 1);
    assert.truthy(at(save, 0).extinguished);
  });
})();
