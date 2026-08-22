// _starterGuidanceGoal — the (light-green) starter arrow's per-step target.
//
// Patch-history motivation: every ladder step past "Break ground" used to aim
// the arrow at the nearest unopened `chest_start_*`. Once the supply crates
// packed into the near part of the walk (TRAIL_SPAN) a player opened all four
// early, leaving the relic chest — a full screen away — as the only unopened
// target, so for most of the ladder the one arrow on screen pointed at the
// horizon while the chip asked them to tap their tilled soil, their crop, a
// wreck or their own house. The arrow did not point at the intended space.
// These tests pin the per-step aiming rules to the space each chip step is
// actually talking about.
//
// The methods under test are lifted out of src/app.js by run.js (they live on
// the Phaser scene class), so these run against the real shipping code.

(() => {
  const N = 40;                 // cells per tile edge in these fixtures
  const CELL_M = 7;
  const TILE_EDGE_M = N * CELL_M;

  // Scene stub carrying what _starterGuidanceGoal and its helpers touch. The
  // coords helpers (worldMetersToAbsCell / absCellCenterMeters) read
  // originPx / mPerPx / cellsPerTile, so those are self-consistent: one cell
  // of TILE_PX/cellsPerTile pixels measures exactly CELL_M metres.
  function makeScene(over = {}) {
    const cellsPerTile = N;
    const cellPx = WorldGen.TILE_PX / cellsPerTile;
    return Object.assign({
      save: {},
      cellM: CELL_M,
      tileEdgeM: TILE_EDGE_M,
      cellsPerTile,
      mPerPx: CELL_M / cellPx,
      originPx: { x: 0, y: 0 },
      startWorldM: { x: 0, y: 0 },
      playerM: { x: 0, y: 0 },
      tilledSet: new Set(),
      _starterGuidanceGoal: __starterArrow._starterGuidanceGoal,
      _nearestStarterCrate: __starterArrow._nearestStarterCrate,
      _isHouseWreck: __starterArrow._isHouseWreck,
      _wreckRestoreCost: __starterArrow._wreckRestoreCost,
    }, over);
  }
  const cellCentre = (cx, cy) => ({ x: (cx + 0.5) * CELL_M, y: (cy + 0.5) * CELL_M });
  const keyOf = (cx, cy) => cellKeyFromAbsCell(cx, cy);

  // _nearestStarterCrate scans the REAL WorldGen.tileCache — swap in a fixture
  // tile for the duration of a test and always restore what was there.
  function withTiles(objects, fn) {
    const saved = new Map(WorldGen.tileCache);
    WorldGen.tileCache.clear();
    WorldGen.tileCache.set('fixture', { objects });
    try { fn(); } finally {
      WorldGen.tileCache.clear();
      for (const [k, v] of saved) WorldGen.tileCache.set(k, v);
    }
  }
  const crate = (cx, cy, n) => Object.assign(
    { kind: 'chest', id: `chest_start_test_${n}`, crate: true }, cellCentre(cx, cy));
  const STEP = Object.fromEntries(
    ['chest', 'till', 'plant', 'restore', 'harvest', 'sell'].map(e => [e, { event: e }]));

  test('starter arrow: step 1 points at the nearest unopened crate', () => {
    const scene = makeScene({ save: { opened: ['chest_start_test_1'] } });
    withTiles([crate(2, 0, 1), crate(4, 0, 2), crate(8, 0, 3)], () => {
      const g = scene._starterGuidanceGoal(STEP.chest);
      // Crate 1 is nearest but already opened — the arrow moves on to crate 2.
      assert.eq(g.id, 'chest_start_test_2', 'nearest UNOPENED crate wins');
    });
  });

  test('starter arrow: "Break ground" points at the plot middle, crates only as a fallback', () => {
    const plotAt = cellCentre(5, 5);        // top-left cell centre
    const scene = makeScene({ save: { starterPlotAt: plotAt } });
    withTiles([crate(2, 0, 1)], () => {
      const g = scene._starterGuidanceGoal(STEP.till);
      assert.eq(g.x, plotAt.x + CELL_M / 2, 'aims at the 2x2 middle (x)');
      assert.eq(g.y, plotAt.y + CELL_M / 2, 'aims at the 2x2 middle (y)');
      // No plot carved (mid-river spawn) → the old crate bearing.
      const bare = makeScene();
      assert.eq(bare._starterGuidanceGoal(STEP.till).id, 'chest_start_test_1',
        'no plot → nearest crate');
    });
  });

  test('starter arrow: "Sow a seed" points at the tilled-but-empty soil', () => {
    const scene = makeScene({
      save: {
        inv: [{ id: 'potato_seed', count: 3 }],
        // One tilled cell is already planted — the arrow must skip it.
        planted: [Object.assign({ crop: 'potato', stage: 0 }, cellCentre(3, 3))],
      },
      tilledSet: new Set([keyOf(3, 3), keyOf(4, 3)]),
    });
    withTiles([crate(9, 9, 1)], () => {
      const g = scene._starterGuidanceGoal(STEP.plant);
      const want = cellCentre(4, 3);
      assert.inRange(g.x - want.x, -0.001, 0.001, 'empty tilled cell (x)');
      assert.inRange(g.y - want.y, -0.001, 0.001, 'empty tilled cell (y)');
    });
  });

  test('starter arrow: "Sow a seed" with an empty seed pocket points back at the crates', () => {
    // The seeds are IN the crates (nearest first) — an arrow at bare soil
    // would strand a player who skipped a crate with nothing to plant.
    const scene = makeScene({
      save: { inv: [{ id: 'wood', count: 5 }] },
      tilledSet: new Set([keyOf(4, 3)]),
    });
    withTiles([crate(9, 9, 1)], () => {
      assert.eq(scene._starterGuidanceGoal(STEP.plant).id, 'chest_start_test_1',
        'no seed held → the crate that holds one');
    });
  });

  test('starter arrow: "Rebuild a neighbour" points at the nearest wreck', () => {
    const cost = __starterArrow._wreckRestoreCost(null);
    const wreck = (cx, cy, id, tier) => Object.assign(
      { kind: 'house', id, tier: tier ?? 9 }, cellCentre(cx, cy));
    const scene = makeScene({
      save: {
        inv: [{ id: cost.id, count: cost.qty }],
        restoredHouses: { h_done: 'plain' },
      },
    });
    withTiles([
      wreck(2, 2, 'h_done'),        // nearest, already restored — skipped
      wreck(3, 3, 'h_fort', 11),    // a fort — not a wreck, skipped
      wreck(5, 5, 'h_target'),
      crate(1, 1, 1),
    ], () => {
      assert.eq(scene._starterGuidanceGoal(STEP.restore).id, 'h_target',
        'nearest restorable wreck wins over a nearer crate');
    });
  });

  test('starter arrow: "Rebuild a neighbour" without the materials points at the crates', () => {
    const scene = makeScene({ save: { inv: [] } });
    const wreck = Object.assign({ kind: 'house', id: 'h_target', tier: 9 }, cellCentre(5, 5));
    withTiles([wreck, crate(8, 8, 1)], () => {
      assert.eq(scene._starterGuidanceGoal(STEP.restore).id, 'chest_start_test_1',
        'the restore price is in the crates');
    });
  });

  test('starter arrow: "Bring in the crop" points at the planted crop', () => {
    const plant = Object.assign({ crop: 'potato', stage: 1 }, cellCentre(6, 2));
    const scene = makeScene({ save: { planted: [plant] } });
    withTiles([crate(2, 2, 1)], () => {
      const g = scene._starterGuidanceGoal(STEP.harvest);
      assert.eq(g.x, plant.x, 'the crop, not the nearer crate (x)');
      assert.eq(g.y, plant.y, 'the crop, not the nearer crate (y)');
    });
  });

  test('starter arrow: "Cash out at Home" points at the trail anchor', () => {
    const anchor = { x: 140, y: 210 };
    const scene = makeScene({ save: { starterCratesAt: anchor } });
    withTiles([crate(2, 2, 1)], () => {
      const g = scene._starterGuidanceGoal(STEP.sell);
      assert.eq(g.x, anchor.x, 'Home (x)');
      assert.eq(g.y, anchor.y, 'Home (y)');
      // No frozen anchor → the projection origin is Home (same resolution
      // rule as _slimeFreeZone).
      const bare = makeScene({ startWorldM: { x: 70, y: 70 } });
      const g2 = bare._starterGuidanceGoal(STEP.sell);
      assert.eq(g2.x, 70, 'falls back to startWorldM (x)');
      assert.eq(g2.y, 70, 'falls back to startWorldM (y)');
    });
  });
})();
