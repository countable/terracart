(() => {
  const N = 64;
  const run = it => { let r; do { r = it.next(); } while (!r.done); return r.value; };
  const rect = (w, h) => Array.from({ length: w * h }, (_, i) => (Math.floor(i / w) + 4) * N + i % w + 4);
  const plan = (id, cells, owned = true) => run(QuarryLayout.planSteps({ a: { owned }, variant: ZoneVariants.byId(id), cells }, { N, tx: 4, ty: 5 }));
  test('quarry selection: stable weighted rolls make abandoned sites rarer and strongholds more common', () => {
    const variants = ZoneVariants.forKind('quarry'), counts = {};
    for (let n = 0; n < 1000; n++) {
      const hash = Math.floor((n + .5) / 1000 * 4294967296);
      const index = QuarryLayout.weightedIndexForHash(hash);
      assert.eq(index, QuarryLayout.weightedIndexForHash(hash), 'stable for a site hash');
      const id = variants[index].id;
      counts[id] = (counts[id] || 0) + 1;
    }
    assert.eq(counts['quarry-abandoned'], 200);
    assert.eq(counts['quarry-stronghold'], 300);
    assert.eq(counts['quarry-strip-mine'], 250);
    assert.eq(counts['quarry-crater'], 250);
  });
  test('quarry selection: rejected craters redistribute by eligible weights and stay stable', () => {
    const cells = rect(9, 9), counts = {}, variants = ZoneVariants.forKind('quarry');
    const total = 1000;
    for (let n = 0; n < total; n++) {
      const variantHash = Math.floor((n + .5) / total * 4294967296);
      const start = QuarryLayout.weightedIndexForHash(variantHash);
      const context = { N, tx: 4, ty: 5, variantHash };
      const chosen = run(QuarryLayout.variantForSteps(cells, context, start));
      counts[chosen] = (counts[chosen] || 0) + 1;
      if (variants[start].id !== 'quarry-crater') assert.eq(chosen, variants[start].id, 'fitting original rolls stay put');
      if (n % 25 === 0) assert.eq(run(QuarryLayout.variantForSteps(cells.slice().reverse(), context, start)), chosen, 'cell traversal cannot change the fallback');
    }
    assert.falsy(counts['quarry-crater']);
    const eligible = variants.filter(v => v.id !== 'quarry-crater');
    const weight = eligible.reduce((sum, v) => sum + v.weight, 0);
    for (const v of eligible) assert.inRange(counts[v.id] / total, v.weight / weight - .035, v.weight / weight + .035, v.id + ' receives only its weighted share');
  });
  test('stronghold joins: cardinal neighbours select straights, corners, T pieces, cross and end caps', () => {
    const i = 10 * N + 10, offsets = { N: -N, E: 1, S: N, W: -1 };
    const connections = ['EW','NS','ES','WS','NE','NW','NEW','NES','ESW','NSW','NESW','S','W','N','E'];
    for (const [frame, directions] of connections.entries()) {
      const cells = new Set([i, ...[...directions].map(d => i + offsets[d])]);
      assert.eq(QuarryLayout.wallFrameAt(cells, i, N), frame, directions);
    }
    assert.eq(QuarryLayout.wallFrameAt(new Set([i]), i, N), null, 'isolated remnants remain rubble');
    assert.eq(QuarryLayout.wallFrameAt(new Set([N - 1, N, 2 * N - 1]), N - 1, N), 11,
      'a tile edge never wraps its east connection onto the next row');
  });
  test('stronghold joins: open doors and clipped footprints determine actual piece orientation', () => {
    for (const cells of [rect(5,5), rect(4,4), rect(5,5).filter(i => i !== 4*N+6)]) {
      const p = plan('quarry-stronghold', cells), walls = new Set([...p.background.keys()].filter(i=>p.background.get(i)!=='clay_pot'));
      assert.gt(p.wallFrames.size, 0);
      for (const [i, material] of p.background) {
        if (material === 'clay_pot') continue;
        const frame = QuarryLayout.wallFrameAt(walls, i, N);
        assert.eq(material, frame == null ? 'stone' : 'stronghold_wall');
        assert.eq(p.wallFrames.get(i), frame == null ? undefined : frame);
        assert.falsy(p.clear.has(i), 'doorways and finite reward seats stay open');
      }
      const reversed = plan('quarry-stronghold', cells.slice().reverse());
      assert.eq(JSON.stringify([...p.wallFrames]), JSON.stringify([...reversed.wallFrames]));
    }
    const whole = plan('quarry-stronghold', rect(5,5));
    assert.eq(whole.wallFrames.get(4*N+4), 2, 'top-left joins east and south');
    assert.eq(whole.wallFrames.get(4*N+8), 3, 'top-right joins west and south');
    assert.eq(whole.wallFrames.get(8*N+4), 4, 'bottom-left joins north and east');
    assert.eq(whole.wallFrames.get(8*N+8), 5, 'bottom-right joins north and west');
    assert.eq(whole.background.get(8*N+5), 'stronghold_wall');
    assert.eq(whole.wallFrames.get(8*N+5), 12, 'east-facing tip caps the left side of the doorway');
    assert.eq(whole.background.get(8*N+7), 'stronghold_wall');
    assert.eq(whole.wallFrames.get(8*N+7), 14, 'west-facing tip caps the right side of the doorway');
    assert.falsy(whole.background.has(8*N+6), 'the doorway stays open between its capped walls');
  });
  test('quarry layout: crater follows the footprint and reserves an entrance', () => {
    const small = plan('quarry-crater', rect(12, 8)), large = plan('quarry-crater', rect(36, 28));
    assert.eq(small.landmarks.length, 1); assert.eq(large.landmarks.length, 1);
    assert.truthy(large.landmarks[0].radii[0] > small.landmarks[0].radii[0]);
    assert.truthy(large.landmarks[0].radii[1] > small.landmarks[0].radii[1]);
    assert.eq(large.finds.length, 2, 'finite ore does not grow with area');
    assert.truthy(large.hazards.length > 0);
    assert.eq(large.hazards.length, 24, 'five by five pool surrounds its dry central island');
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
  test('quarry layout: long broad ground keeps a compact bowl instead of a racetrack', () => {
    for (const cells of [rect(9, 50), rect(50, 9)]) {
      const p = plan('quarry-crater', cells), [rx, ry] = p.landmarks[0].radii;
      assert.lte(Math.max(rx, ry) / Math.min(rx, ry), ZoneVariantData.quarryLayouts.craterMaxAspectRatio);
      assert.eq(p.finds.length, 2, 'compact bowl retains the same finite ore budget');
    }
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
      assert.eq(p.guards.length, 3, 'narrow modules do not multiply inhabitants');
      assert.eq(p.finds.length, 0, 'buried finds roll beneath actual stones after layout placement');
    }
  });
  test('quarry layout: intact patches and surviving foundation walls respect irregular footprints', () => {
    const cells = rect(35, 27).filter(i => i % N < 23 || Math.floor(i / N) > 15), covered = new Set(cells);
    for (const id of ['quarry-abandoned', 'quarry-strip-mine', 'quarry-stronghold']) {
      const p = plan(id, cells);
      assert.truthy(p.landmarks.length > 0);
      for (const m of p.landmarks) {
        assert.truthy(m.size >= 3 && m.size <= 8);
        if (id === 'quarry-stronghold') assert.eq(m.size, 5);
        const [left, top, right, bottom] = m.bounds;
        if (!m.partial) for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) assert.truthy(covered.has(y * N + x));
        for (const [x, y] of m.doors || []) assert.falsy(p.background.has(y * N + x));
      }
      for (const i of p.background.keys()) assert.truthy(covered.has(i));
    }
  });
  test('quarry ruins: partial foundations survive building holes and cropped edges without filling them', () => {
    const holes = rect(5,5).filter(i => i !== 6*N+6 && i !== 6*N+7);
    for (const cells of [holes, rect(4,4), rect(4,18)]) {
      const covered=new Set(cells), p=plan('quarry-stronghold',cells);
      assert.gt(p.landmarks.length,0,'recognizable surviving walls remain');
      assert.truthy(p.landmarks.some(m=>m.partial),'diagnostics report incomplete foundations');
      assert.gt(p.background.size,4,'the remnant reads as walls rather than one loose rock');
      for (const i of [...p.background.keys(),...p.clear,...p.finds.map(f=>f.i),...p.guards.map(g=>g.i)]) assert.truthy(covered.has(i),'nothing is placed or reserved through the obstruction');
      assert.inRange(p.finds.length,1,3); assert.inRange(p.guards.length,1,3);
      assert.eq(new Set([...p.finds,...p.guards].map(o=>o.i)).size,p.finds.length+p.guards.length,'finds and guards have distinct surviving seats');
      const rebuilt=plan('quarry-stronghold',cells.slice().reverse());
      assert.eq(JSON.stringify([...p.background]),JSON.stringify([...rebuilt.background]));
      assert.eq(JSON.stringify(p.finds),JSON.stringify(rebuilt.finds));
      assert.eq(JSON.stringify(p.guards),JSON.stringify(rebuilt.guards));
    }
    assert.eq(plan('quarry-stronghold',rect(2,24)).landmarks.length,0,'an isolated thin wall is not a fortress');
  });
  test('quarry layout: finite site budgets never multiply with modules or observers', () => {
    const cells = rect(48, 48);
    assert.eq(plan('quarry-abandoned', cells).finds.length, 2);
    const strip = plan('quarry-strip-mine', cells);
    assert.eq(strip.guards.length, 3, 'inhabitant budget does not grow with the number of benches');
    assert.eq(strip.guards.filter(g => g.material === 'split_slime').length, 2);
    assert.eq(strip.guards.filter(g => g.material === 'wurm').length, 1);
    assert.eq(strip.finds.length, 0, 'strip mine treasure is per rock, not a finite site budget');
    for (const guard of strip.guards) {
      assert.includes(['split_slime', 'wurm'], guard.material);
      assert.falsy(strip.background.has(guard.i), 'inhabitants occupy open cuts');
    }
    const stronghold = plan('quarry-stronghold', cells);
    assert.eq(stronghold.finds.length, 3); assert.eq(stronghold.guards.length, 3);
    for (const id of ['quarry-abandoned', 'quarry-stronghold', 'quarry-crater', 'quarry-strip-mine']) {
      const observer = plan(id, cells, false);
      assert.eq(observer.finds.length, 0); assert.eq(observer.guards.length, 0);
    }
  });
  test('quarry layout: tiny foundations decline placement and cell ordering cannot reroll a layout', () => {
    assert.eq(plan('quarry-stronghold', rect(3, 3)).landmarks.length, 0);
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
    assert.eq(choose(partial), 'quarry-stronghold', 'one intact five-cell foundation qualifies for ruins');
    for (const cells of [rect(5, 40), rect(40, 5)]) assert.eq(choose(cells), 'quarry-stronghold', 'five-cell-wide lots retain their ruins roll in either orientation');
    assert.eq(plan('quarry-stronghold', partial).finds.length, 1, 'direct layout budgets remain maxima independent of shape selection');
    const narrow = rect(4, 24), selected = choose(narrow);
    assert.eq(selected, 'quarry-stronghold', 'a cropped but readable foundation may follow a narrow boundary');
    assert.truthy(selected !== 'quarry', 'narrow ground can still host a smaller authored layout');
    const row = ZoneVariants.byId(selected), fitted = plan(selected, narrow);
    if (row.finds.count) assert.gt(fitted.finds.length, 0);
    if (row.guards.count) assert.gt(fitted.guards.length, 0);
    assert.eq(choose(narrow.slice().reverse()), selected, 'source order cannot choose another variant');
    assert.eq(choose(rect(2, 2)), null, 'small slivers remain ordinary ground');
  });
  test('quarry selection: small and narrow sites admit fitting ruins but exclude craters', () => {
    const variants = ZoneVariants.forKind('quarry'), allowed = ['quarry-abandoned', 'quarry-strip-mine', 'quarry-stronghold'];
    for (const cells of [rect(5, 5), rect(9, 9), rect(8, 40), rect(40, 5)]) {
      const selected = new Set();
      for (let start = 0; start < variants.length; start++) {
        const id = run(QuarryLayout.variantForSteps(cells, { N, tx: 4, ty: 5 }, start));
        assert.includes(allowed, id, 'narrow sites allow ruins without admitting a crater');
        selected.add(id);
      }
      assert.eq(selected.size, 3, 'stable rolls retain all three fitting alternatives');
    }
  });
  test('quarry selection: actual broad pockets qualify despite skinny arms, bounding boxes do not', () => {
    const variants = ZoneVariants.forKind('quarry');
    const narrowL = [...new Set([...rect(4, 36), ...rect(36, 4)])];
    const broadL = [...new Set([...rect(12, 12), ...rect(3, 40)])];
    for (const id of ['quarry-crater', 'quarry-stronghold']) {
      const start = variants.findIndex(v => v.id === id);
      const choose = cells => run(QuarryLayout.variantForSteps(cells, { N, tx: 4, ty: 5 }, start));
      assert.includes(['quarry-abandoned', 'quarry-strip-mine', 'quarry-stronghold'], choose(narrowL), 'thin arms admit readable ruins but never a crater');
      assert.eq(choose(broadL), id, 'a wide usable pocket keeps its large-site roll');
      assert.eq(choose(broadL.slice().reverse()), id, 'source order cannot change the shape class');
    }
  });
  test('quarry clipped inhabitants: one fixed seat per block, independent of fragments and anchor', () => {
    const cells = rect(48, 48);
    const make = list => run(QuarryLayout.planSteps({ a: { owned: false, clipped: true },
      variant: ZoneVariants.byId('quarry-strip-mine'), cells: list }, { N, tx: 4, ty: 5 }));
    const whole = make(cells), left = make(cells.filter(i => i % N < 24)), right = make(cells.filter(i => i % N >= 24));
    const inhabitants = [...whole.background].filter(([, material]) => ['split_slime', 'wurm'].includes(material));
    assert.gt(inhabitants.filter(([, material]) => material === 'split_slime').length, 0);
    assert.gt(inhabitants.filter(([, material]) => material === 'wurm').length, 0);
    const spacing = ZoneVariantData.quarryLayouts.clippedInhabitantSpacingCells;
    const blocks = inhabitants.map(([i]) => `${Math.floor((4 * N + i % N) / spacing)},${Math.floor((5 * N + Math.floor(i / N)) / spacing)}`);
    assert.eq(new Set(blocks).size, inhabitants.length, 'no block grants two inhabitants');
    for (const [i, material] of whole.background) assert.eq((i % N < 24 ? left : right).background.get(i), material);
    assert.eq(whole.guards.length, 0, 'no finite budget is minted');
    assert.eq(whole.finds.length, 0);
  });
})();
