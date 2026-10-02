// Mystic Reef's small ore budget uses ordinary mineralrock gates and identities.
(() => {
  const ore = out => out.objects.filter(o => o.zoneVariant === 'mystic_reef' && o.kind === 'mineralrock' && o.yieldTier > 1);
  function context(owned = true) {
    const N = 64, cell = WorldGen.CELL_M, a = {
      kind: 'beach', variant: 'mystic_reef', gx: 32.5 * 4096 / N, gy: 32.5 * 4096 / N,
      lx: 32.5 * 4096 / N, ly: 32.5 * 4096 / N, upm: N * cell / 4096,
      R: 140, owned, key: 112, rotation: 0
    };
    const grid = new Uint8Array(N * N).fill(WorldGen.T.WATER), coverage = new Uint16Array(N * N);
    for (let y = 23; y <= 41; y++) for (let x = 29; x <= 44; x++) {
      grid[y * N + x] = WorldGen.T.SAND; coverage[y * N + x] = 1;
    }
    return { N, tx: 0, ty: 0, tileEdgeM: N * cell, grid, chests: [],
      field: { anchors: [a], coverage, idx: new Uint16Array(N * N), under: new Uint8Array(N * N) },
      spawnOpts: { occupied: new Set(), spawnWhy: new Uint16Array(N * N), roadMask: new Uint8Array(N * N), roadClass: new Uint8Array(N * N) } };
  }
  function dress(c) {
    c.zoneDress = ZoneDressing.dress(c);
    const it = ReefLayout.dressSteps(c); let step;
    do { step = it.next(); } while (!step.done);
    return c.zoneDress;
  }
  test('Mystic Reef ore: sparse dry-land budget keeps ordinary pick requirements and stable identities', () => {
    const c = context(), out = dress(c), rocks = ore(out), cfg = ZoneVariants.byId('mystic_reef').reef.landOre;
    assert.eq(rocks.length, cfg.count);
    assert.eq(rocks.length, 3, 'one small budget per site');
    for (const rock of rocks) {
      assert.eq(c.grid[rock._iy * c.N + rock._ix], WorldGen.T.SAND, 'ore stays on dry eligible ground');
      assert.includes([2, 3, 4], rock.yieldTier);
      assert.eq(rock.requiredTier, rock.yieldTier - 1);
      assert.truthy(INTERACTABLES.mineralrock.gate(rock, { relics: {} }), 'ore cannot be gathered barehanded');
      assert.eq(INTERACTABLES.mineralrock.gate(rock, { relics: { pick: { tier: rock.requiredTier } } }), null);
    }
    assert.eq(JSON.stringify(rocks), JSON.stringify(ore(dress(context()))), 'reload preserves mineral types, seats and spent IDs');
    assert.eq(ore(dress(context(false))).length, 0, 'an observing tile cannot duplicate the site budget');
    assert.eq(out.wildplants.filter(o => o.zoneLayer === 'find').length, 1, 'starflower remains the one authored find');
  });
  test('Mystic Reef ore: occupied and restricted ground cannot acquire a deposit', () => {
    const baseline = ore(dress(context())), c = context();
    const occupied = baseline[0]._iy * c.N + baseline[0]._ix;
    const restricted = baseline[1]._iy * c.N + baseline[1]._ix;
    c.spawnOpts.occupied.add(occupied); c.spawnOpts.spawnWhy[restricted] = WorldGen.SPAWN_WHY.RESTRICTED;
    const rocks = ore(dress(c));
    assert.lte(rocks.length, 3);
    for (const rock of rocks) {
      const i = rock._iy * c.N + rock._ix;
      assert.falsy(i === occupied || i === restricted, 'existing spawn gate remains authoritative');
    }
    const blocked = context(); blocked.spawnOpts.spawnWhy.fill(WorldGen.SPAWN_WHY.RESTRICTED);
    assert.eq(ore(dress(blocked)).length, 0);
  });
})();
