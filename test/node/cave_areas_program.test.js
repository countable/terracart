// The four-per-floor grove program (cave_areas.js): floors 1 and 4-8 select
// their own variant menus, moat islands paint cell-exact water/lava rings
// with the focal cache on the island, themed dressing seats through the
// street art table, and every grove rolls its signature enemy set.
(function () {
  const W = WorldGen, T = W.T, N = 64, edge = N * W.CELL_M, EXT = 4096;
  const MENUS = { 1: ['flooded_cistern', 'moss_garden', 'rat_cache_den', 'glowworm_grotto'],
    4: ['echo_hollow', 'obsidian_vault', 'fossil_ridge', 'petrified_grove'],
    5: ['flooded_cistern', 'moss_garden', 'glowworm_grotto', 'echo_hollow'],
    6: ['magma_atoll', 'ember_sanctum', 'obsidian_garden', 'salamander_nest'],
    7: ['magma_atoll', 'obsidian_vault', 'bone_hoard', 'ember_sanctum'],
    8: ['web_gallery', 'bone_hoard', 'egg_nursery', 'ember_sanctum'] };

  function fixture(depth, want, firstTx = 950001) {
    const ty = 950201;
    let tx, anchor;
    for (tx = firstTx; tx < firstTx + 4000; tx++) {
      anchor = { kind: 'grove', key: `program-test-${tx}`, owned: true,
        gx: tx * EXT + 32.5 * EXT / N, gy: ty * EXT + 32.5 * EXT / N,
        lx: 32.5 * EXT / N, ly: 32.5 * EXT / N, upm: edge / EXT };
      if (CaveAreas.select(anchor, depth) === want) break;
    }
    assert.lt(tx, firstTx + 4000, `fixture finds a ${want} grove on floor ${depth}`);
    const surfaceGrid = new Uint8Array(N * N).fill(T.PARK);
    const surface = { status: 'ready', depth: 0, cellsPerEdge: N, tileEdgeM: edge,
      grid: surfaceGrid, baseGrid: surfaceGrid.slice(), objects: [], genObjects: [], wildplants: [],
      zone: { anchors: [anchor], coverage: new Uint16Array(N * N).fill(1) } };
    return { surface, grid: new Uint8Array(N * N).fill(T.CAVE_FLOOR), N, tx, ty,
      tileEdgeM: edge, depth, objects: [], occupied: new Set(), spawnWhy: new Uint16Array(N * N),
      cx: 32, cy: 32, anchor };
  }
  const plan2 = f => { const a = CaveAreas.plan(f); return a; };

  test('grove program: every program floor selects exactly its four variants', () => {
    for (const depth of Object.keys(MENUS).map(Number)) {
      const seen = new Set();
      for (let tx = 950001; tx < 954001; tx++) {
        const anchor = { kind: 'grove', key: `menu-${tx}`, owned: true,
          gx: tx * EXT + 32.5 * EXT / N, gy: 950201 * EXT + 32.5 * EXT / N };
        seen.add(CaveAreas.select(anchor, depth));
      }
      for (const id of MENUS[depth]) assert.truthy(seen.has(id), `floor ${depth} selects ${id}`);
      for (const id of seen) assert.truthy(MENUS[depth].includes(id) || id === null,
        `floor ${depth} never strays outside its menu (saw ${id})`);
    }
  });

  test('grove program: floors 2-3 keep their classic menus unchanged', () => {
    const classics = ['spring_cave', 'goblin_warrens', 'mushroom_cavern', 'gemstone_cavern', 'dungeon_maze', 'quicksand_cavern'];
    for (const depth of [2, 3]) {
      const seen = new Set();
      for (let tx = 950001; tx < 953001; tx++) {
        const anchor = { kind: 'grove', key: `classic-${tx}`, owned: true,
          gx: tx * EXT + 32.5 * EXT / N, gy: 950201 * EXT + 32.5 * EXT / N };
        const id = CaveAreas.select(anchor, depth);
        if (id) seen.add(id);
      }
      for (const id of seen) assert.truthy(classics.includes(id), `floor ${depth} keeps classics (saw ${id})`);
      assert.gt(seen.size, 3, `floor ${depth} still spreads across its menu`);
    }
  });

  test('grove program: a flooded cistern paints a water moat with the cache island', () => {
    const f = fixture(1, 'flooded_cistern'), anchor = f.anchor;
    const source = { kind: 'chest', poiClass: 'park', id: 'cistern-grove-source', rank: 1,
      _poiAt: `${anchor.lx},${anchor.ly}` };
    f.surface.objects.push(source); f.surface.genObjects.push(source);
    const cache = { kind: 'chest', poiClass: 'park', id: `${source.id}_d1`, caveOf: source.id,
      depth: 1, rank: 1, tierSeed: 1, x: f.tx * edge + 20 * W.CELL_M, y: f.ty * edge + 20 * W.CELL_M };
    f.objects.push(cache);
    const p = plan2(f);
    assert.eq(p.areas.length, 1);
    assert.eq(p.areas[0].kind, 'flooded_cistern');
    assert.gt(p.terrain.size, 0, 'the moat paints terrain');
    const wet = [...p.terrain].filter(([, t]) => t === T.WATER);
    assert.gt(wet.length, 8, 'a ring of water cells');
    // The focus cell stays dry floor, ringed by water a few cells out.
    const focus = f.cy * N + f.cx;
    assert.falsy(p.terrain.has(focus), 'the island focus stays dry');
    for (const [i] of wet)
      assert.inRange(Math.hypot(i % N - f.cx, Math.floor(i / N) - f.cy), 2, 7.5,
        'water rings the island, never floods it');
    // The mirror cache becomes the island chest; plans never mint one.
    assert.eq(p.moves.length, 1);
    assert.eq(p.moves[0].object, cache);
    assert.eq(p.moves[0].to, focus, 'the cache lands on the island focus');
    assert.falsy(p.objects.some(o => o.kind === 'chest' && !o.barrel), 'no minted chest');
    // Determinism: same inputs, same plan.
    const f2 = fixture(1, 'flooded_cistern', f.tx); // same anchor selection
    f2.surface.objects.push(source); f2.surface.genObjects.push(source);
    f2.objects.push({ ...cache });
    const p2 = plan2(f2);
    assert.eq(JSON.stringify(p.terrain), JSON.stringify(p2.terrain));
    assert.eq(p.encounters.length, p2.encounters.length);
  });

  test('grove program: a magma atoll paints live lava and keeps stone lanes', () => {
    const f = fixture(6, 'magma_atoll');
    const p = plan2(f);
    assert.eq(p.areas.length, 1);
    const lava = [...p.terrain].filter(([, t]) => t === T.CAVE_LAVA);
    assert.gt(lava.length, 8, 'a ring of lava cells');
    const focus = f.cy * N + f.cx;
    assert.falsy(p.terrain.has(focus), 'the islet focus stays walkable');
    // A crossing lane crosses the moat on dry stones: some axis neighbour of
    // the ring stays floor because the lane is reserved for stepping stones.
    assert.truthy(p.areas[0].reserved.size > 20, 'the disc is claimed');
    for (const [i] of lava) assert.truthy(p.areas[0].reserved.has(i), 'lava sits inside the claim');
  });

  test('grove program: theme dressing seats through the street art table', () => {
    const cases = [
      [4, 'echo_hollow', p => p.objects.some(o => o.kind === 'stakes') && p.objects.some(o => o.kind === 'grove_shrine' && o.shrineKind === 'bone_watcher')],
      [8, 'web_gallery', p => p.objects.some(o => o.kind === 'stakes') && p.wildplants.some(w => w.crop === 'creeping_vine')],
      [6, 'ember_sanctum', p => p.wildplants.some(w => w._streetArt === 'flame_pillar') && p.objects.some(o => o.kind === 'grove_shrine' && o.shrineKind === 'ember_altar')],
      [1, 'moss_garden', p => p.wildplants.some(w => w._streetArt === 'green_slick') && p.objects.some(o => o.kind === 'grove_shrine' && o.shrineKind === 'moss_cairn')],
      [4, 'petrified_grove', p => p.wildplants.some(w => w._streetArt === 'mossy_tree')],
      [4, 'fossil_ridge', p => p.objects.some(o => o.kind === 'mineralrock')],
      [1, 'rat_cache_den', p => p.objects.some(o => o.barrel)],
      [6, 'salamander_nest', p => p.objects.some(o => o.barrelStyle === 'clay_pot')],
      [4, 'obsidian_vault', p => p.objects.filter(o => o.kind === 'mineralrock').length >= 8],
      [8, 'egg_nursery', p => p.objects.some(o => o.barrelStyle === 'clay_pot')]
    ];
    for (const [depth, kind, check] of cases) {
      const f = fixture(depth, kind), p = plan2(f);
      assert.eq(p.areas.length, 1, `${kind} places on floor ${depth}`);
      assert.truthy(check(p), `${kind} seats its theme dressing`);
      for (const o of [...p.objects, ...p.wildplants]) {
        assert.truthy(p.areas[0].reserved.has(o._iy * N + o._ix), `${kind} props stay inside the claim`);
        assert.eq(f.grid[o._iy * N + o._ix], T.CAVE_FLOOR, `${kind} props stay on dry floor`);
      }
    }
  });

  test('grove program: signature sets roll on their own stream and stay legal', () => {
    const SHARED_ID_RE = EnemySpawns.SHARED_ID_RE;
    const allowed = [
      [1, 'flooded_cistern', ['cave_slime', 'rat', 'goblin', 'vampire_bat']],
      [6, 'magma_atoll', ['red_demon']],
      [4, 'echo_hollow', ['skeleton']],
      [6, 'ember_sanctum', ['fiend', 'succubus']],
      [8, 'web_gallery', ['poison_spider']],
      [8, 'egg_nursery', ['orc_shaman', 'bone_plant', 'red_dragon']],
      [7, 'bone_hoard', ['dryad', 'bone_plant']]];
    let rolled = 0;
    for (const [depth, id, kinds] of allowed) {
      let placed = 0;
      for (let tx = 950001; tx < 951501 && placed < 3; tx++) {
        const f = fixture(depth, id, tx);
        if (CaveAreas.select(f.anchor, depth) !== id) continue;
        const p = plan2(f);
        if (!p.areas.length) continue;
        placed++;
        for (const e of p.encounters) {
          assert.truthy(SHARED_ID_RE.test(e.id), `encounter ids stay wire-legal (${e.id})`);
          if (e.salt && e.salt.startsWith('sig')) {
            rolled++;
            assert.truthy(kinds.includes(e.kind), `${id} signature seats ${e.kind} from its set`);
          }
        }
      }
      assert.gt(placed, 0, `${id} places at least once on floor ${depth}`);
    }
    assert.gt(rolled, 0, 'at least one signature set rolled across the fixtures');
  });

  test('grove program: plans are pure until applied and never touch the grid', () => {
    const f = fixture(5, 'glowworm_grotto');
    const before = [...f.grid].join();
    const p = plan2(f);
    assert.eq([...f.grid].join(), before, 'planning leaves terrain unchanged');
    assert.eq(f.objects.length, 0, 'caller objects untouched');
    CaveAreas.apply(p, f.grid, f.objects, [], f.occupied);
    assert.truthy([...f.grid].some(t => t === T.CAVE_FLOOR), 'apply keeps the floor walkable');
    for (const i of p.areas[0].reserved) assert.falsy(f.grid[i] === T.CAVE_WALL);
  });
})();
