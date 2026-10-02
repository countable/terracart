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
    assert.lte(large.hazards.length, ZoneVariantData.quarryLayouts.craterMaxHazards, 'a few vents keep the bowl readable');
    for (const i of large.clear) assert.falsy(large.background.has(i), 'entrance and rewards stay clear');
    for (const f of large.finds) assert.falsy(large.hazards.includes(f.i), 'ore avoids lava');
  });
  test('quarry layout: crater chooses intact ground beside holes and irregular arms', () => {
    const footprints = [
      rect(36, 28).filter(i => i % N < 16 || Math.floor(i / N) > 20),
      rect(36, 28).filter(i => i % N < 16 || i % N > 27 || Math.floor(i / N) < 12 || Math.floor(i / N) > 23)
    ];
    for (const cells of footprints) {
      const covered = new Set(cells), p = plan('quarry-crater', cells), crater = p.landmarks[0];
      assert.truthy(crater, 'an intact crater fits an outdoor pocket');
      const [cx, cy] = crater.centre, [rx, ry] = crater.radii;
      assert.truthy(covered.has(cy * N + cx), 'centre is actual usable ground');
      for (let y = Math.floor(cy - ry * 1.04); y <= Math.ceil(cy + ry * 1.04); y++) {
        for (let x = Math.floor(cx - rx * 1.04); x <= Math.ceil(cx + rx * 1.04); x++) {
          if (Math.hypot((x - cx) / rx, (y - cy) / ry) <= 1.04) assert.truthy(covered.has(y * N + x), 'whole bowl and rim avoid the missing footprint');
        }
      }
      for (const [i] of p.background) {
        const d = Math.hypot((i % N - cx) / rx, (Math.floor(i / N) - cy) / ry);
        assert.lte(d, 1.04, 'all rim stones belong to one coherent crater');
        assert.truthy([[-1,0],[1,0],[0,-1],[0,1]].some(([dx,dy]) =>
          Math.hypot((i % N + dx - cx) / rx, (Math.floor(i / N) + dy - cy) / ry) > 1.04), 'rim follows the raster boundary');
      }
      assert.eq(p.finds.length, 2);
      assert.eq(JSON.stringify([...p.background]), JSON.stringify([...plan('quarry-crater', cells.slice().reverse()).background]), 'input order cannot move the crater');
    }
    assert.eq(plan('quarry-crater', rect(4, 30)).landmarks.length, 0, 'a skinny strip cannot pretend to contain a bowl');
  });
  test('quarry layout: strip benches align with the usable footprint and leave cross-cuts', () => {
    for (const [w, h, axis] of [[32, 9, 'x'], [9, 32, 'y']]) {
      const p = plan('quarry-strip-mine', rect(w, h));
      assert.gt(p.landmarks.length, 1);
      for (const m of p.landmarks) {
        const [left, top, right, bottom] = m.bounds;
        assert.eq(m.axis, axis);
        assert.eq(axis === 'x' ? bottom - top + 1 : right - left + 1, 3, 'bench is a narrow intact module');
        const middle = axis === 'x' ? left + Math.floor((right - left + 1) / 2) : top + Math.floor((bottom - top + 1) / 2);
        for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
          if ((axis === 'x' ? x : y) === middle) assert.falsy(p.background.has(y * N + x), 'cross-cut stays open');
        }
      }
      assert.eq(p.guards.length, 2, 'narrow modules do not multiply inhabitants');
    }
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
    const strip = plan('quarry-strip-mine', cells);
    assert.eq(strip.guards.length, 2, 'slime budget does not grow with the number of benches');
    for (const guard of strip.guards) {
      assert.eq(guard.material, 'split_slime');
      assert.falsy(strip.background.has(guard.i), 'slimes occupy open cuts');
    }
    const stronghold = plan('quarry-stronghold', cells);
    assert.eq(stronghold.finds.length, 3); assert.eq(stronghold.guards.length, 3);
    for (const id of ['quarry-abandoned', 'quarry-stronghold', 'quarry-crater', 'quarry-strip-mine']) {
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
  test('quarry selection: retain fitting roll and use actual layouts for narrow or tiny sites', () => {
    const variants = ZoneVariants.forKind('quarry');
    const start = variants.findIndex(v => v.id === 'quarry-stronghold');
    const choose = cells => run(QuarryLayout.variantForSteps(cells, { N, tx: 4, ty: 5 }, start));
    assert.eq(choose(rect(48, 48)), 'quarry-stronghold', 'adequate sites keep their existing roll');
    const partial = rect(5, 5);
    assert.eq(choose(partial), 'quarry-stronghold', 'one complete foundation preserves a small ruin');
    assert.eq(plan('quarry-stronghold', partial).finds.length, 1, 'finite counts remain maxima, not a reason to erase the variant');
    const narrow = rect(4, 24), selected = choose(narrow);
    assert.truthy(selected !== 'quarry-stronghold', 'a long site without a whole foundation cannot be a fortress');
    assert.truthy(selected !== 'quarry', 'narrow ground can still host a smaller authored layout');
    const row = ZoneVariants.byId(selected), fitted = plan(selected, narrow);
    if (row.finds.count) assert.gt(fitted.finds.length, 0);
    if (row.guards.count) assert.gt(fitted.guards.length, 0);
    assert.eq(choose(narrow.slice().reverse()), selected, 'source order cannot choose another variant');
    assert.eq(choose(rect(2, 2)), 'quarry', 'small slivers keep ordinary quarry scatter');
  });
  test('quarry clipped inhabitants: one fixed seat per block, independent of fragments and anchor', () => {
    const cells = rect(48, 48);
    const make = list => run(QuarryLayout.planSteps({ a: { owned: false, clipped: true },
      variant: ZoneVariants.byId('quarry-strip-mine'), cells: list }, { N, tx: 4, ty: 5 }));
    const whole = make(cells), left = make(cells.filter(i => i % N < 24)), right = make(cells.filter(i => i % N >= 24));
    const slimes = [...whole.background].filter(([, material]) => material === 'split_slime');
    assert.gt(slimes.length, 0);
    const spacing = ZoneVariantData.quarryLayouts.clippedInhabitantSpacingCells;
    const blocks = slimes.map(([i]) => `${Math.floor((4 * N + i % N) / spacing)},${Math.floor((5 * N + Math.floor(i / N)) / spacing)}`);
    assert.eq(new Set(blocks).size, slimes.length, 'no block grants two inhabitants');
    for (const [i, material] of whole.background) assert.eq((i % N < 24 ? left : right).background.get(i), material);
    assert.eq(whole.guards.length, 0, 'no finite budget is minted');
    assert.eq(whole.finds.length, 0);
  });
})();
