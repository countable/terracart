(() => {
  const N = 64;
  const run = it => { let r; do { r = it.next(); } while (!r.done); return r.value; };
  const rect = (w, h) => Array.from({ length: w * h }, (_, i) => (Math.floor(i / w) + 4) * N + i % w + 4);
  const plan = (id, cells, owned = true) => run(QuarryLayout.planSteps({ a: { owned }, variant: ZoneVariants.byId(id), cells }, { N, tx: 4, ty: 5 }));
  test('quarry layout: crater follows the footprint and reserves an entrance', () => {
    const small = plan('quarry-crater', rect(12, 8)), large = plan('quarry-crater', rect(36, 28));
    assert.eq(small.landmarks.length, 1); assert.eq(large.landmarks.length, 1);
    assert.truthy(large.landmarks[0].radii[0] > small.landmarks[0].radii[0]);
    assert.truthy(large.landmarks[0].radii[1] > small.landmarks[0].radii[1]);
    assert.eq(large.finds.length, 2, 'finite ore does not grow with area');
    assert.truthy(large.hazards.length > 0);
    for (const i of large.clear) assert.falsy(large.background.has(i), 'entrance and rewards stay clear');
    for (const f of large.finds) assert.falsy(large.hazards.includes(f.i), 'ore avoids lava');
  });
  test('quarry layout: patches fit whole inside irregular footprints', () => {
    const cells = rect(35, 27).filter(i => i % N < 23 || Math.floor(i / N) > 15), covered = new Set(cells);
    for (const id of ['quarry-abandoned', 'quarry-strip-mine', 'quarry-stronghold']) {
      const p = plan(id, cells);
      assert.truthy(p.landmarks.length > 0);
      for (const m of p.landmarks) {
        assert.truthy(m.size >= 3 && m.size <= 8);
        if (id === 'quarry-stronghold') assert.eq(m.size, 5);
        const [left, top, right, bottom] = m.bounds;
        for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) assert.truthy(covered.has(y * N + x));
        for (const [x, y] of m.doors || []) assert.falsy(p.background.has(y * N + x));
      }
      for (const i of p.background.keys()) assert.truthy(covered.has(i));
    }
  });
  test('quarry layout: finite site budgets never multiply with modules or observers', () => {
    const cells = rect(48, 48);
    assert.eq(plan('quarry-abandoned', cells).finds.length, 2);
    const stronghold = plan('quarry-stronghold', cells);
    assert.eq(stronghold.finds.length, 3); assert.eq(stronghold.guards.length, 3);
    for (const id of ['quarry-abandoned', 'quarry-stronghold', 'quarry-crater']) {
      const observer = plan(id, cells, false);
      assert.eq(observer.finds.length, 0); assert.eq(observer.guards.length, 0);
    }
  });
  test('quarry layout: tiny foundations decline placement and cell ordering cannot reroll a layout', () => {
    assert.eq(plan('quarry-stronghold', rect(4, 4)).landmarks.length, 0);
    const cells = rect(30, 30), a = plan('quarry-strip-mine', cells), b = plan('quarry-strip-mine', cells.slice().reverse());
    assert.eq(JSON.stringify([...a.background]), JSON.stringify([...b.background]));
    const candidates = [...a.background].filter(([i]) => {
      const x = i % N, y = Math.floor(i / N); return (x + y) % 7 === 0 || (y % 7 === 2 && x - 4 > 23);
    });
    assert.eq([...a.background.values()].filter(m => m === 'crystal').length, Math.round(candidates.length / 4));
  });
  test('quarry layout: clipped scatter survives changed component bounds and has no finite rewards', () => {
    const cells = rect(30, 30), extended = rect(45, 45);
    const make = (list, gx) => run(QuarryLayout.planSteps({ a: { owned: false, clipped: true, gx }, variant: ZoneVariants.byId('quarry-strip-mine'), cells: list }, { N, tx: 4, ty: 5 }));
    const a = make(cells, 40), b = make(extended, 1000);
    for (const i of cells) assert.eq(a.background.get(i), b.background.get(i), 'surviving cells never reroll');
    assert.eq(a.finds.length, 0); assert.eq(a.guards.length, 0); assert.eq(a.hazards.length, 0);
  });
})();
