(() => {
  const N = 20, size = N * N;
  const scene = { depth: 0, tileEdgeM: 200, save: { starterCratesAt: { x: 1000, y: 1000 } } };
  function entry() {
    return { depth: 0, cellsPerEdge: N, tileEdgeM: 200,
      grid: new Uint8Array(size).fill(WorldGen.T.GROVE),
      baseGrid: new Uint8Array(size).fill(WorldGen.T.GROVE),
      variantBaseGrid: new Uint8Array(size).fill(WorldGen.T.GRASS),
      zone: { coverage: new Uint8Array(size), anchors: [{ kind: 'grove', variant: 'mushroom_grove' }] },
      streetArea: new Uint8Array(size), streetAreaVariants: new Uint8Array(size),
      objects: [], wildplants: [], creatures: [] };
  }
  function rect(mask, x, y, w, h, value = 1) {
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) mask[(y + dy) * N + x + dx] = value;
  }
  test('variant remnants: discard 15 cells, retain 16, and count disconnected pieces separately', () => {
    for (const owner of ['zone', 'road']) {
      const e = entry(), mask = owner === 'zone' ? e.zone.coverage : e.streetArea;
      rect(mask, 2, 2, 5, 3); rect(mask, 10, 2, 4, 4); rect(mask, 2, 10, 3, 3);
      const discarded = WorldGen.smallVariantMask(e);
      assert.eq(discarded.reduce((a, b) => a + b, 0), 24);
      assert.eq(discarded[2 * N + 2], 1); assert.eq(discarded[2 * N + 10], 0);
      assert.eq(mask[2 * N + 2], 1, 'generated coverage is immutable');
    }
  });
  test('variant remnants: Home cuts a large Nexus into independently counted remnants', () => {
    const e = entry(); rect(e.zone.coverage, 2, 2, 10, 4);
    e.homeVariant = new Uint8Array(size); rect(e.homeVariant, 5, 2, 1, 4);
    e._homeVariantGenerating = true;
    const mask = WorldGen.smallVariantMask(e);
    assert.eq(mask.reduce((a, b) => a + b, 0), 12);
    assert.eq(mask[2 * N + 5], 0, 'Home itself is not discarded');
    assert.eq(mask[2 * N + 6], 0, '24-cell remainder stays');
    e.variantDiscarded = mask;
    assert.eq(WorldGen.variantOwnerAt(e, 2 * N + 2), 'zone', 'shared generation ignores cleanup');
    e._homeVariantGenerating = false;
    assert.eq(WorldGen.variantOwnerAt(e, 2 * N + 2), null);
    assert.eq(WorldGen.zoneAnchorAt(e, 2 * N + 2), null);
  });
  test('variant remnants: different anchors and road variants cannot combine their minimum area', () => {
    const e = entry(); rect(e.zone.coverage, 2, 2, 3, 3); rect(e.zone.coverage, 5, 2, 3, 3, 2);
    rect(e.streetArea, 2, 10, 6, 3);
    rect(e.streetAreaVariants, 2, 10, 3, 3, 1); rect(e.streetAreaVariants, 5, 10, 3, 3, 2);
    assert.eq(WorldGen.smallVariantMask(e).reduce((a, b) => a + b, 0), 36);
  });
  test('variant remnants: uncertain tile-edge fragments and underground coverage stay intact', () => {
    const e = entry(); rect(e.zone.coverage, 0, 2, 2, 3);
    assert.eq(WorldGen.smallVariantMask(e).reduce((a, b) => a + b, 0), 0);
    rect(e.zone.coverage, 5, 5, 2, 3); e.depth = 2;
    assert.eq(WorldGen.smallVariantMask(e).reduce((a, b) => a + b, 0), 0);
  });
  test('variant remnants: sliced numeric components match reference ownership across mixed fields', () => {
    // Independent string-key traversal retains the original owner/code identity
    // rule, including equal numeric codes belonging to different owners.
    const reference = e => {
      const n = e.cellsPerEdge, out = new Uint8Array(n * n), seen = new Set();
      if ((e.depth || 0) !== 0) return out;
      const view = { ...e, _homeVariantGenerating: false, variantDiscarded: null };
      const coverage = e.zone?.coverage || e.zone?.idx;
      const codes = e.streetAreaVariants || e.streetArea?.variants;
      const key = i => {
        const owner = WorldGen.variantOwnerAt(view, i);
        return owner === 'zone' ? `zone:${coverage[i]}`
          : owner === 'road' ? `road:${codes?.[i] || 0}` : null;
      };
      for (let start = 0; start < out.length; start++) {
        const k = key(start);
        if (!k || seen.has(start)) continue;
        const cells = [start]; seen.add(start);
        let edge = false;
        for (let at = 0; at < cells.length; at++) {
          const i = cells[at], x = i % n, y = Math.floor(i / n);
          if (!x || !y || x === n - 1 || y === n - 1) edge = true;
          for (const next of [x ? i - 1 : -1, x < n - 1 ? i + 1 : -1,
            y ? i - n : -1, y < n - 1 ? i + n : -1]) {
            if (next >= 0 && !seen.has(next) && key(next) === k) {
              seen.add(next); cells.push(next);
            }
          }
        }
        if (!edge && cells.length < 16) for (const i of cells) out[i] = 1;
      }
      return out;
    };
    for (let seed = 1; seed <= 12; seed++) {
      const e = entry(), rng = WorldGen.makeRng(seed);
      e.homeVariant = new Uint8Array(size);
      e.variantDiscarded = new Uint8Array(size).fill(1); // Must be ignored.
      e.caveAreas = { reserved: new Set() };
      e._homeVariantGenerating = true; // Home still cuts live remnants.
      for (let i = 0; i < size; i++) {
        e.zone.coverage[i] = Math.floor(rng() * 4);
        e.streetArea[i] = rng() < .8 ? 1 : 0;
        e.streetAreaVariants[i] = Math.floor(rng() * 3);
        e.homeVariant[i] = rng() < .15 ? 1 : 0;
        if (rng() < .1) e.caveAreas.reserved.add(i);
      }
      if (seed % 2) { e.zone.idx = e.zone.coverage; delete e.zone.coverage; }
      if (seed % 3) { e.streetArea.variants = e.streetAreaVariants; delete e.streetAreaVariants; }
      if (seed === 12) e.depth = 1;
      const expected = reference(e).join(',');
      assert.eq(WorldGen.smallVariantMask(e).join(','), expected, `sync seed ${seed}`);
      assert.eq(WorldGen.runSteps(WorldGen.smallVariantMaskSteps(e)).join(','), expected, `sliced seed ${seed}`);
    }
  });
  test('variant remnants: a large single component and an empty field yield bounded work', () => {
    for (const occupied of [false, true]) {
      const n = 128, e = { cellsPerEdge: n, zone: { coverage: new Uint8Array(n * n).fill(occupied ? 1 : 0) } };
      const it = WorldGen.smallVariantMaskSteps(e), counts = {};
      let result = it.next();
      while (!result.done) {
        counts[result.value] = (counts[result.value] || 0) + 1;
        assert.eq(e.variantDiscarded, undefined, 'preparation does not publish a partial result');
        result = it.next();
      }
      assert.eq(counts['variant remnant owners'], 16);
      assert.eq(counts['variant remnant scan'], 16);
      assert.eq(counts['variant remnant components'] || 0, occupied ? 16 : 0,
        'one large component yields internally');
      assert.eq(result.value.reduce((sum, v) => sum + v, 0), 0, 'edge component and empty field both survive');
    }
  });
  test('variant remnants: live content, terrain and road themes clear while saved content and sources survive', () => {
    const e = entry(), i = 2 * N + 2; rect(e.zone.coverage, 2, 2, 3, 3);
    rect(e.streetArea, 2, 2, 3, 3);
    const plant = { id: 'mushroom', crop: 'mushroom', x: 25, y: 25, gasEmitter: true };
    const kept = { id: 'planted', kind: 'tree', x: 25, y: 25, planted: true };
    e.objects = [{ id: 'nexus', kind: 'tree', x: 25, y: 25, zoneVariant: 'mushroom_grove' }, kept];
    e.wildplants = [plant]; e.creatures = [{ id: 'wild', kind: 'chicken', x: 25, y: 25 }];
    e.streetGround = new Uint8Array(size).fill(1); e.streetMarks = new Uint8Array(size).fill(1);
    e.slowCells = new Map([[i, 'tar']]);
    const source = { extent: 200, lines: [{ line: [{ x: 20, y: 25 }, { x: 50, y: 25 }], variant: 'burned', size: 'minor' }] };
    e.streetIndex = source; e.grid[i + 1] = WorldGen.T.WATER;
    HomeVariant.apply(scene, e, 0, 0);
    assert.eq(e.objects.length, 1); assert.eq(e.objects[0], kept);
    assert.eq(e.wildplants.length, 0); assert.eq(e.creatures.length, 0);
    assert.eq(e.grid[i], WorldGen.T.GRASS); assert.eq(e.grid[i + 1], WorldGen.T.WATER);
    assert.eq(HabitatSpawns.resolve(e, i).type, WorldGen.T.GRASS, "fallback habitat follows restored ground");
    assert.eq(e.baseGrid[i], WorldGen.T.GROVE); assert.eq(e.zone.coverage[i], 1);
    assert.eq(e.streetGround[i], 0); assert.eq(e.streetMarks[i], 0); assert.falsy(e.slowCells.has(i));
    assert.eq(StreetVariants.variantAt(StreetVariants.indexFor(e).lines[0], 15), null);
    assert.eq(StreetVariants.variantAt(source.lines[0], 15), 'burned');
    const key = WorldGen.tileKey(0, 0), previous = WorldGen.tileCache.get(key);
    WorldGen.tileCache.set(key, e);
    try {
      assert.falsy(HomeVariant.allows(scene, plant));
      assert.falsy(MushroomGas.sourcePresent(scene, plant));
      assert.truthy(HomeVariant.allows(scene, kept));
    } finally { if (previous) WorldGen.tileCache.set(key, previous); else WorldGen.tileCache.delete(key); }
  });
})();
