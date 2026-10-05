// The shared world-generation helpers the footprint pass introduced (Oct
// 2026): ONE ring scan / disc order / box scan (WorldGen.ringCells,
// discOffsets, boxCells), the tile frame and its occupancy set
// (tileFrame / occupiedIndexSet), the entry's full spawn options
// (spawnOptsOf — the consistency fix: a starter placer or a trapper's snare is
// judged by the same gate as everything else on the tile), the cave floor
// table (CAVE_PASSES), the verge dressing table (StreetVariants.VERGE_ROWS),
// the habitat sites as lair candidates with GROUPS rows (EnemyHabitats
// habitatLairs → Lairs marsh / stronghold) and the one garrison inheritance
// list (Lairs.GARRISON_INHERIT).
(function () {
  const W = WorldGen, T = W.T;

  test('ring scan: ringCells walks Chebyshev rings nearest first, dy outer then dx, and stops on the first truthy visit', () => {
    const seen = [];
    W.ringCells(5, 5, 0, 2, (x, y, r) => { seen.push(`${x},${y}:${r}`); return null; });
    const want = ['5,5:0'];
    for (let r = 1; r <= 2; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        want.push(`${5 + dx},${5 + dy}:${r}`);
      }
    }
    assert.eq(seen.join(' '), want.join(' '), 'the old hand-written loops, exactly');
    assert.eq(W.ringCells(0, 0, 1, 3, (x, y) => (x === 2 && y === -1 ? { x, y } : null)).x, 2, 'the visit\'s value is the result');
    assert.eq(JSON.stringify(W.nearestRingCell(0, 0, 1, 3, (x, y) => y === 1)), JSON.stringify({ ix: -1, iy: 1 }), 'nearestRingCell: the first ring cell the predicate admits');
    assert.eq(W.nearestRingCell(0, 0, 1, 1, () => false), null, 'or null');
    assert.eq(W.RING_ORDER.length, 8);
    assert.eq(JSON.stringify(W.RING_ORDER[0]), JSON.stringify([0, -1]), 'the compass ring starts north');
  });

  test('disc offsets: nearest first, ties row-major, memoised per radius; box cells clip to the grid', () => {
    const R = 3;
    const old = [];
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 <= R * R) old.push({ dx, dy, d2 });
    }
    old.sort((a, b) => a.d2 - b.d2 || a.dy - b.dy || a.dx - b.dx);
    assert.eq(JSON.stringify(W.discOffsets(R)), JSON.stringify(old), 'the order the seat-back searches always walked');
    assert.truthy(W.discOffsets(R) === W.discOffsets(R), 'built once');
    const cells = [];
    W.boxCells(4, 4, 0, 3, 1, (x, y, i) => { cells.push([x, y, i]); return null; });
    assert.eq(JSON.stringify(cells), JSON.stringify([[0, 2, 8], [1, 2, 9], [0, 3, 12], [1, 3, 13]]), 'clipped at the edge, y outer');
    assert.truthy(W.anyNeighbour8(3, 3, 1, 1, (x, y) => x === 2 && y === 2));
    assert.falsy(W.anyNeighbour8(3, 3, 1, 1, (x, y) => x === 1 && y === 1), 'the cell itself is not its own neighbour');
    assert.eq(W.countNeighbours8(3, 3, 0, 0, () => true), 3, 'a corner has three');
  });

  test('tile frame: one spelling of cell ⇄ metre, and the occupancy set keyed by the flat index', () => {
    const entry = { cellsPerEdge: 10 };
    const f = W.tileFrame(entry, 2, 3, 70);
    assert.eq(f.N, 10); assert.eq(f.cellM, 7); assert.eq(f.ox, 140); assert.eq(f.oy, 210);
    assert.eq(JSON.stringify(f.cellOf(140 + 7 * 4 + 1, 210 + 7 * 9 + 6)), JSON.stringify({ ix: 4, iy: 9 }));
    assert.eq(f.idxOf(140 + 7 * 4 + 1, 210 + 7 * 9 + 6), 94);
    assert.eq(f.idxOf(139, 210), -1, 'outside the square');
    assert.eq(JSON.stringify(f.centre(4, 9)), JSON.stringify({ x: 140 + 4.5 * 7, y: 210 + 9.5 * 7 }));
    const occ = W.occupiedIndexSet(f, [{ x: 141, y: 211 }, { x: 0, y: 0 }], [{ x: f.centre(9, 9).x, y: f.centre(9, 9).y }]);
    assert.eq([...occ].sort((a, b) => a - b).join(), '0,99', 'in-tile records only, flat indices');
  });

  test('spawn options of a live entry: the stamped options under the entry\'s masks, the caller\'s extras on top', () => {
    const occupied = new Set([3]), pois = [{ ix: 1, iy: 1 }];
    const entry = { roadMask: 'rm', spawnWhy: 'sw', roadClass: 'rc', quietMask: 'qm',
      _spawnOpts: { roadMask: 'stale', spawnWhy: 'stale', occupied, pois } };
    const o = W.spawnOptsOf(entry);
    assert.eq(o.roadMask, 'rm'); assert.eq(o.spawnWhy, 'sw'); assert.eq(o.roadClass, 'rc'); assert.eq(o.quiet, 'qm');
    assert.truthy(o.occupied === occupied && o.pois === pois, 'the generated occupancy and the POI frontage ride along');
    const mine = new Set();
    assert.truthy(W.spawnOptsOf(entry, { occupied: mine }).occupied === mine, 'a placer\'s own occupancy replaces the generated one');
    assert.truthy(o !== entry._spawnOpts, 'a fresh object: a pass that extends it never writes the entry\'s');
    // The gate reads them: a private lot cell is lifted by a POI in reach,
    // which a thin { roadMask, spawnWhy } pair never carried.
    const N = 8, grid = new Uint8Array(N * N).fill(T.RESIDENTIAL);
    const lot = { roadMask: null, spawnWhy: null, _spawnOpts: { pois: [{ ix: 4, iy: 4 }] } };
    assert.truthy(W.isSpawnCell(grid, N, N, 4, 5, W.spawnOptsOf(lot), 'minor'), 'frontage by the POI');
    assert.falsy(W.isSpawnCell(grid, N, N, 4, 5, { roadMask: null, spawnWhy: null }, 'minor'), 'the thin pair refuses it');
  });

  test('cave floor passes: one ordered table, each scatter row off its own stream salt', () => {
    const ids = W.CAVE_PASSES.map((r) => r.id);
    assert.eq(ids.join(), 'chasms,rocks,mushrooms,rings,wallTorches,coins,treasureMarks,floorTorches,barrels,drills', 'the order the level is laid in');
    const salts = new Set();
    for (const r of W.CAVE_PASSES) {
      if (r.run) continue;
      assert.truthy(typeof r.emit === 'function', `${r.id} lays its piece`);
      assert.truthy(r.pivot ? (r.cluster || r.pick) : (r.count && r.pick), `${r.id} walks the floor one of the two ways`);
      assert.falsy(salts.has(r.salt), `${r.id}: its own salt`);
      salts.add(r.salt);
    }
    // The driver seats only free CAVE_FLOOR cells and claims them.
    const N = 12, grid = new Uint8Array(N * N).fill(T.CAVE_FLOOR), occupied = new Set([0]);
    const level = W.cavePassLevel(grid, N, 1, 1, N * W.CELL_M, 1, occupied);
    W.runCavePass({ id: 't', salt: 1, count: () => 3, tries: 1, pick: () => ({ lix: 0, liy: 0 }), emit: (L, c) => L.objects.push(c) }, level);
    assert.eq(level.objects.length, 0, 'an occupied cell takes nothing');
    W.runCavePass({ id: 't', salt: 1, count: () => 3, tries: 1, pick: () => ({ lix: 1, liy: 0 }), emit: (L, c) => L.objects.push(c) }, level);
    assert.eq(level.objects.length, 1, 'a free cell takes one, then it is claimed');
    assert.truthy(occupied.has(1));
  });

  test('verge rows: every variant walks its verges the one way, the differences as columns', () => {
    const rows = StreetVariants.VERGE_ROWS;
    for (const [v, list] of Object.entries(rows)) {
      for (const row of list) {
        assert.truthy(row.step && typeof row.emit === 'function', `${v}: a step and a piece`);
        assert.truthy(row.side === 'both' || typeof row.side === 'function', `${v}: a side (or both)`);
      }
    }
    assert.truthy(rows.golden[0].fill, 'the golden road fills every free verge cell (a column, not an accident)');
    assert.truthy(rows.burned[1].retry, 'the burned row\'s torch tries the other side');
    assert.eq(rows.hedgerow[0].walk, 1, 'the hedgerow stands on the kerb cell alone — an obstacle leaves a gap');
    assert.truthy(rows.burned[0].stream && rows.burned[0].draw, 'the debris rolls side and kind off its stream, every sample');
    for (const v of ['overgrown', 'toadstool', 'orchard']) assert.falsy(rows[v][0].retry || rows[v][0].fill, `${v}: the first free cell on its side`);
  });

  test('habitat sites: lair candidates with a GROUPS row, woken by the garrison lifecycle', () => {
    assert.eq(Lairs.TIER_GROUP.habitat_marsh, 'marsh');
    assert.eq(Lairs.TIER_GROUP.habitat_stronghold, 'stronghold');
    for (const tier of Object.keys(Lairs.HABITAT_TIER_GUARDS)) {
      assert.truthy(Lairs.FIXED_GUARD_TIERS.has(tier) && Lairs.ALWAYS_AWAKE_TIERS.has(tier), `${tier}: fixed, every mode`);
      assert.eq(Lairs.OCCUPANCY[tier].rate, 1, `${tier}: always held`);
      assert.truthy(Lairs.KIND_ORDER[tier], `${tier}: a ladder row (lairs.test pins the two tables agree)`);
    }
    const N = 40, CELL_M = W.CELL_M, TILE_M = N * CELL_M;
    const mk = (tx, ty) => {
      const grid = new Uint8Array(N * N).fill(T.WETLAND), roadMask = new Uint8Array(N * N);
      return { grid, roadMask, cellsPerEdge: N, tileEdgeM: TILE_M, buildingShapes: [], creatures: [], objects: [],
        streetLairs: [], _spawnOpts: { roadMask } };
    };
    let tx = 0, ty = 0, entry = mk(0, 0), lairs = EnemyHabitats.habitatLairs(entry, tx, ty);
    for (let k = 1; !lairs.length && k < 200; k++) { tx = k; entry = mk(tx, ty); lairs = EnemyHabitats.habitatLairs(entry, tx, ty); }
    assert.gt(lairs.length, 0, 'a marsh tile rolls at least one site');
    assert.truthy(lairs.every((L) => L.tier === 'habitat_marsh' && /^habitat_surface_\d+_\d+_\d+_\d+$/.test(L.sid)), 'marsh candidates, cell-keyed sids');
    assert.eq(entry.streetLairs.length, lairs.length, 'handed to the entry\'s lair candidates');
    assert.eq(entry.habitatSites.length, lairs.length, 'and recorded for variantAt');
    assert.eq(EnemyHabitats.variantAt(entry, entry.habitatSites[0].cx, entry.habitatSites[0].cy), 'hungry_marsh');
    assert.eq(EnemyHabitats.surfaceSites, undefined, 'the old seater is gone: habitatLairs is the one entry point');
    // The scene pushes the habitat candidates BEFORE the attractor filter, so
    // a marsh in a yard or a field's interior is refused or relocated like a
    // gate's foe — through the entry's full spawn options.
    const spawn = SCENE_SRC;
    const habitatAt = spawn.indexOf('EnemyHabitats.habitatLairs(entry, tx, ty);');
    const filterAt = spawn.indexOf('const lairOpts = WorldGen.spawnOptsOf(entry);');
    assert.truthy(habitatAt > 0 && filterAt > habitatAt && filterAt - habitatAt < 200, 'habitat lairs are pushed right ahead of the lair filter, which reads spawnOptsOf');
    assert.falsy(/habitatGuards|habitatSeats|surfaceSites/.test(spawn), 'no second habitat seater beside it');
    // Wake it: the whole group stands, each guard a lair guard of the site.
    const prev = Difficulty.mode();
    Difficulty.setMode('hard');
    try {
      const L = lairs[0];
      Lairs.stepResidency([{ entry, tx, ty }], { cellM: CELL_M, tileEdgeM: TILE_M,
        playerM: { x: tx * TILE_M + L.lx, y: ty * TILE_M + L.ly }, homeM: { x: -1e6, y: -1e6 }, isClaimed: () => false, caughtSet: new Set() });
    } finally { Difficulty.setMode(prev); }
    const guards = entry.creatures.filter((c) => c.lair === lairs[0].sid);
    assert.eq(guards.map((g) => g.kind).sort().join(), 'plant,slime', 'the marsh\'s two');
    for (const g of guards) {
      assert.truthy(g.immobile && Number.isFinite(g.lairX) && g.group === 'marsh', 'a garrison member');
      assert.truthy(g.id.startsWith(`lair_${lairs[0].sid}_`), 'the lair id lane');
    }
  });

  test('garrison inheritance: one list, the overlays that hide a summoner included', () => {
    const L = Lairs.GARRISON_INHERIT;
    for (const k of ['lair', 'immobile', 'lairX', 'lairY', 'lairR', 'keepHW', 'keepHH', 'aggroCells', 'homeX', 'homeY']) assert.includes(L, k);
    for (const k of ['_surfaceSpawn', 'habitat', 'zoneVariant', '_hunting']) assert.includes(L, k, `${k}: a hidden necromancer hides its skeletons`);
  });
})();
