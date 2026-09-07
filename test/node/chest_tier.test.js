// Chest tier vs distance from Home (loot.js chestTier / chestTierHomeDrop).
//
// A chest's BASE tier is a fixed lookup from its POI class. Near Home it is
// demoted one tier per ring of CHEST_TIER_HOME_RINGS_M it stands inside —
// within 700 m is one down, within 350 m is two — and never below T1, so the
// lowtier boxes are untouched. Home is HomeArea.worldM, the spawn origin in
// the same world-metre frame every object's x/y lives in; when it isn't set
// (headless, or before the scene publishes it) nothing is demoted.
//
// Every reader resolves through chestTier(poiClass, x, y, depth): the sprite/gem in
// render.js and the loot roll in interactables.js — so a chest can't draw as
// one tier and pay as another. The source sweep at the bottom pins that no
// caller has fallen back to the position-less lookup.
(() => {
  const HX = 100000, HY = 200000;
  const withHome = (fn) => {
    const prev = HomeArea.worldM;
    HomeArea.setOrigin(HX, HY);
    try { fn(); } finally { HomeArea.worldM = prev; }
  };
  // A point `d` metres due east of Home.
  const east = (d) => [HX + d, HY];

  test('chest tier: the rings are 700 m then 350 m', () => {
    assert.eq(JSON.stringify(CHEST_TIER_HOME_RINGS_M), '[700,350]', 'rings');
  });

  test('chest tier: no origin → no demotion', () => {
    const prev = HomeArea.worldM;
    HomeArea.worldM = null;
    try {
      assert.eq(chestTierHomeDrop(0, 0), 0, 'drop without an origin');
      assert.eq(chestTier('florist', 0, 0), 4, 'flora keeps T4');
      assert.eq(chestTier('florist'), 4, 'position-less lookup is the base tier');
    } finally { HomeArea.worldM = prev; }
  });

  test('chest tier: one tier down inside 700 m, two inside 350 m', () => withHome(() => {
    assert.eq(chestTierHomeDrop(...east(1000)), 0, 'beyond 700 m');
    assert.eq(chestTierHomeDrop(...east(700)),  1, 'on the 700 m ring counts as inside');
    assert.eq(chestTierHomeDrop(...east(701)),  0, 'just outside 700 m');
    assert.eq(chestTierHomeDrop(...east(500)),  1, 'between the rings');
    assert.eq(chestTierHomeDrop(...east(350)),  2, 'on the 350 m ring');
    assert.eq(chestTierHomeDrop(...east(100)),  2, 'deep inside');
    assert.eq(chestTierHomeDrop(HX, HY),        2, 'at Home itself');
  }));

  test('chest tier: the drop is radial, not axis-aligned', () => withHome(() => {
    // 300 m at 45°: hypot ≈ 424 m — inside 700, outside 350.
    assert.eq(chestTierHomeDrop(HX + 300, HY + 300), 1, 'diagonal 424 m');
    // 500 m at 45°: hypot ≈ 707 m — outside both.
    assert.eq(chestTierHomeDrop(HX + 500, HY - 500), 0, 'diagonal 707 m');
  }));

  test('chest tier: every class demotes by ring, floored at T1', () => withHome(() => {
    const bands = [[1000, 0], [500, 1], [100, 2]];
    for (const cls of Object.keys(POI_CATEGORY)) {
      const base = CHEST_TIER_BY_CATEGORY[POI_CATEGORY[cls]] || 2;
      for (const [d, drop] of bands) {
        const t = chestTier(cls, ...east(d));
        assert.eq(t, Math.max(1, base - drop), cls + ' at ' + d + ' m');
        assert.gte(t, 1, cls + ' never below T1');
        assert.lte(t, base, cls + ' never above its base');
      }
    }
  }));

  test('chest tier: worked examples — flora, civic, park, lowtier', () => withHome(() => {
    assert.eq(chestTier('florist', ...east(1000)), 4, 'flora far out is T4');
    assert.eq(chestTier('florist', ...east(500)),  3, 'flora inside 700 m is T3');
    assert.eq(chestTier('florist', ...east(100)),  2, 'flora inside 350 m is T2');
    assert.eq(chestTier('school',  ...east(500)),  2, 'civic inside 700 m is T2');
    assert.eq(chestTier('school',  ...east(100)),  1, 'civic inside 350 m is T1');
    assert.eq(chestTier('park',    ...east(500)),  1, 'park inside 700 m is already the floor');
    assert.eq(chestTier('park',    ...east(100)),  1, 'park inside 350 m stays T1');
    assert.eq(chestTier('bus',     ...east(100)),  1, 'lowtier is as it was');
    assert.eq(chestTier('bus',     ...east(1000)), 1, 'lowtier is as it was, far out too');
  }));

  test('chest tier: an unknown class falls back to T2 and still demotes', () => withHome(() => {
    assert.eq(chestTier('no_such_class', ...east(1000)), 2, 'fallback base');
    assert.eq(chestTier('no_such_class', ...east(500)),  1, 'fallback demoted');
    assert.eq(chestTier(undefined, ...east(100)),        1, 'no class at all');
  }));

  // ── Depth: the cave mirrors are promoted ─────────────────────────────
  test('chest tier: the depth step is 2 levels and the cap is T5', () => {
    assert.eq(CHEST_TIER_DEPTH_STEP, 2, 'levels per tier');
    assert.eq(CHEST_TIER_MAX, 5, 'cap');
    assert.truthy(CHEST_TIER_COLOR[5], 'T5 has a gem colour');
    assert.eq(CHEST_TIER_COLOR[1], null, 'T1 still draws no gem');
  });

  test('chest tier: one tier up per two levels down', () => {
    const want = { 0: 0, 1: 0, 2: 1, 3: 1, 4: 2, 5: 2, 6: 3, 9: 4 };
    for (const [d, b] of Object.entries(want)) {
      assert.eq(chestTierDepthBonus(Number(d)), b, 'depth ' + d);
    }
    assert.eq(chestTierDepthBonus(undefined), 0, 'surface object (no depth field)');
    assert.eq(chestTierDepthBonus(-2), 0, 'a negative depth is the surface');
  });

  test('chest tier: depth promotes every class, capped at T5', () => {
    const prev = HomeArea.worldM;
    HomeArea.worldM = null;
    try {
      for (const cls of Object.keys(POI_CATEGORY)) {
        const base = CHEST_TIER_BY_CATEGORY[POI_CATEGORY[cls]] || 2;
        for (let d = 0; d <= 12; d++) {
          const t = chestTier(cls, 0, 0, d);
          assert.eq(t, Math.min(5, base + Math.floor(d / 2)), cls + ' at depth ' + d);
          assert.lte(t, CHEST_TIER_MAX, cls + ' never above the cap');
        }
      }
      assert.eq(chestTier('florist', 0, 0, 1), 4, 'flora at depth 1 is the surface tier');
      assert.eq(chestTier('florist', 0, 0, 2), 5, 'flora at depth 2 is T5');
      assert.eq(chestTier('florist', 0, 0, 40), 5, 'and never more');
      // The ladder is pure math over any class — a lowtier POI never actually
      // reaches a cave (chestMirrorsUnderground), but the function doesn't care.
      assert.eq(chestTier('bus', 0, 0, 2), 2, 'the ladder applies to a lowtier base too');
      assert.eq(chestTier('bus', 0, 0, 8), 5, 'and caps at T5');
    } finally { HomeArea.worldM = prev; }
  });

  test('chest tier: the Home demotion is floored BEFORE the depth bonus', () => withHome(() => {
    // Park (T2) inside 350 m: surface floor T1; two levels down it is T2, not
    // clamp(2 - 2 + 1) = T1. Going underground always buys the tier.
    assert.eq(chestTier('park', ...east(100), 0), 1, 'park under Home, surface');
    assert.eq(chestTier('park', ...east(100), 2), 2, 'park under Home, depth 2');
    assert.eq(chestTier('school', ...east(100), 4), 3, 'civic under Home, depth 4');
    assert.eq(chestTier('florist', ...east(1000), 2), 5, 'flora far out, depth 2');
  }));

  test('chest tier: rarity.js carries a T5 curve that the picker honours', () => {
    const mod = RARITY_TUNING.chestTierMod;
    assert.truthy(mod[5], 'chestTierMod[5] exists');
    assert.gt(mod[5].chainSteps, mod[4].chainSteps, 'T5 takes more boost steps than T4');
    assert.gte(mod[5].chainMax, 5, 'the chain alone can reach T5');
    assert.eq(mod[5].relicCap, 7, 'no relic ceiling below the ladder top');
    // Seeded rolls at T5 never exceed the absolute ceilings and never crash.
    let seed = 1;
    const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x80000000; };
    for (let i = 0; i < 300; i++) {
      const r = pickReward('chest:civic', { relics: {}, armor: {} }, rng, { tier: 5 });
      assert.truthy(r, 'T5 roll produced a reward');
      if (r.tier != null) assert.lte(r.tier, 7, 'tier within the ladder');
    }
  });

  // ── The cave mirrors themselves (worldgen.js caveChestsFrom) ─────────
  const CAVE_FLOOR = WorldGen.T.CAVE_FLOOR, CAVE_WALL = WorldGen.T.CAVE_WALL;
  const N = 8, TILE_M = 80, TX = 3, TY = 5;   // 10 m cells
  const centre = (lix, liy) => ({ x: TX * TILE_M + (lix + 0.5) * 10, y: TY * TILE_M + (liy + 0.5) * 10 });
  const floorGrid = () => new Uint8Array(N * N).fill(CAVE_FLOOR);
  const poiChest = (lix, liy, poiClass, extra = {}) => Object.assign(
    { kind: 'chest', ...centre(lix, liy), id: 'c_' + lix + '_' + liy, poiClass, name: 'Test ' + poiClass }, extra);

  test('cave chests: every POI chest overhead is mirrored at its own point, stamped with depth', () => {
    const above = [poiChest(2, 2, 'school'), poiChest(5, 6, 'florist'),
      { kind: 'staircase', dir: 'down', ...centre(0, 0), id: 's' },
      { kind: 'tree', ...centre(1, 1), id: 't' }];
    const occ = new Set();
    const out = WorldGen.caveChestsFrom(above, floorGrid(), N, TX, TY, TILE_M, 1, occ);
    assert.eq(out.length, 2, 'two chests mirrored');
    const a = out[0];
    assert.eq(a.kind, 'chest', 'kind');
    assert.eq(a.poiClass, 'school', 'class kept');
    assert.eq(a.name, 'Test school', 'name kept');
    assert.eq(a.depth, 1, 'depth stamped');
    assert.eq(a.x, centre(2, 2).x, 'same world x');
    assert.eq(a.y, centre(2, 2).y, 'same world y');
    assert.eq(a.id, 'c_2_2_d1', 'own id per level');
    assert.eq(a.caveOf, 'c_2_2', 'remembers the surface chest');
    assert.truthy(occ.has(2 * N + 2), 'its cell is claimed against the rocks');
    assert.eq(chestTier(a.poiClass, a.x, a.y, a.depth), 3, 'depth 1 keeps the surface tier');
  });

  test('cave chests: the recursion keeps the SURFACE id and re-stamps depth', () => {
    const d1 = WorldGen.caveChestsFrom([poiChest(2, 2, 'school')], floorGrid(), N, TX, TY, TILE_M, 1, new Set());
    const d2 = WorldGen.caveChestsFrom(d1, floorGrid(), N, TX, TY, TILE_M, 2, new Set());
    assert.eq(d2.length, 1, 'mirrored again');
    assert.eq(d2[0].id, 'c_2_2_d2', 'depth-2 id off the surface id, not off _d1');
    assert.eq(d2[0].caveOf, 'c_2_2', 'surface id carried');
    assert.eq(d2[0].depth, 2, 'depth re-stamped');
    assert.eq(chestTier(d2[0].poiClass, d2[0].x, d2[0].y, d2[0].depth), 4, 'civic is T4 two levels down');
  });

  test('cave chests: lowtier street furniture never goes underground', () => {
    assert.eq(JSON.stringify([...CHEST_CAVE_SKIP_CATEGORIES]), '["lowtier"]', 'only lowtier is excluded');
    const lowtier = Object.keys(POI_CATEGORY).filter(c => POI_CATEGORY[c] === 'lowtier');
    const others  = Object.keys(POI_CATEGORY).filter(c => POI_CATEGORY[c] !== 'lowtier');
    assert.gt(lowtier.length, 10, 'the lowtier roster is real');
    for (const c of lowtier) assert.falsy(chestMirrorsUnderground(c), c + ' stays on the surface');
    for (const c of others)  assert.truthy(chestMirrorsUnderground(c), c + ' mirrors down');
    assert.truthy(chestMirrorsUnderground('no_such_class'), 'an unlisted class (T2 fallback) still mirrors');
    // And the mirror itself honours it: a bus stop beside a school yields one chest.
    const above = [poiChest(1, 1, 'bus'), poiChest(2, 2, 'toilets'), poiChest(3, 3, 'atm'), poiChest(5, 5, 'school')];
    const out = WorldGen.caveChestsFrom(above, floorGrid(), N, TX, TY, TILE_M, 1, new Set());
    assert.eq(out.length, 1, 'only the school came down');
    assert.eq(out[0].poiClass, 'school', 'and it is the school');
  });

  test('cave chests: starter crates and fixed-loot chests stay on the surface', () => {
    const above = [poiChest(1, 1, 'school', { crate: true }),
      { kind: 'chest', ...centre(2, 2), id: 'chest_start_1', fixedLoot: { wood: 9 }, crate: true },
      { kind: 'chest', ...centre(3, 3), id: 'relic', fixedLoot: { relic: 'axe' }, name: 'Old Chest' },
      { kind: 'chest', ...centre(4, 4), id: 'noclass', name: 'Nameless' }];
    const out = WorldGen.caveChestsFrom(above, floorGrid(), N, TX, TY, TILE_M, 1, new Set());
    assert.eq(out.length, 0, 'nothing mirrored');
  });

  test('cave chests: a POI under a wall steps to the nearest floor cell', () => {
    const grid = floorGrid();
    // Wall out a 3×3 block around (4,4): the chest must land on ring 2.
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) grid[(4 + dy) * N + (4 + dx)] = CAVE_WALL;
    const occ = new Set();
    const out = WorldGen.caveChestsFrom([poiChest(4, 4, 'park')], grid, N, TX, TY, TILE_M, 1, occ);
    assert.eq(out.length, 1, 'relocated, not dropped');
    const lix = Math.floor((out[0].x - TX * TILE_M) / 10), liy = Math.floor((out[0].y - TY * TILE_M) / 10);
    assert.eq(Math.max(Math.abs(lix - 4), Math.abs(liy - 4)), 2, 'on the nearest open ring');
    assert.eq(grid[liy * N + lix], CAVE_FLOOR, 'on floor');
    assert.truthy(occ.has(liy * N + lix), 'the new cell is claimed');
  });

  test('cave chests: a POI with no floor within reach is dropped, and never lands on a stair', () => {
    const wall = new Uint8Array(N * N).fill(CAVE_WALL);
    assert.eq(WorldGen.caveChestsFrom([poiChest(4, 4, 'park')], wall, N, TX, TY, TILE_M, 1, new Set()).length, 0,
      'all wall → dropped');
    const grid = floorGrid();
    const occ = new Set([4 * N + 4]);   // a stair already sits on the POI's cell
    const out = WorldGen.caveChestsFrom([poiChest(4, 4, 'park')], grid, N, TX, TY, TILE_M, 1, occ);
    assert.eq(out.length, 1, 'still placed');
    assert.falsy(out[0].x === centre(4, 4).x && out[0].y === centre(4, 4).y, 'but not on the stair');
    assert.eq(WorldGen.CAVE_CHEST_SEEK_CELLS, 3, 'seek radius pinned');
  });

  test('cave chests: two POIs on one cell get two cells', () => {
    const out = WorldGen.caveChestsFrom([poiChest(4, 4, 'park'), poiChest(4, 4, 'school', { id: 'c_other' })],
      floorGrid(), N, TX, TY, TILE_M, 1, new Set());
    assert.eq(out.length, 2, 'both placed');
    assert.falsy(out[0].x === out[1].x && out[0].y === out[1].y, 'on different cells');
  });

  test('cave chests: loadTile.atDepth builds the level with the chests in it', async () => {
    const lat = 49.9;
    const tileEdgeM = WorldGen.tileEdgeMeters(lat);
    const n = WorldGen.cellsPerEdgeForLat(lat);
    const tx = 1000, ty = 2000;
    const mPerCell = tileEdgeM / n;
    const at = (lix, liy) => ({ x: tx * tileEdgeM + (lix + 0.5) * mPerCell, y: ty * tileEdgeM + (liy + 0.5) * mPerCell });
    const grid = new Uint8Array(n * n).fill(WorldGen.T.GRASS);
    grid[7 * n + 7] = WorldGen.T.WATER;   // the POI under water sits on a wall down here
    const surface = { status: 'ready', grid, cellsPerEdge: n, tileEdgeM, depth: 0,
      objects: [{ kind: 'chest', ...at(3, 3), id: 'c_lib', poiClass: 'library', name: 'Library' },
                { kind: 'chest', ...at(7, 7), id: 'c_pond', poiClass: 'park', name: 'Pond' }],
      wildplants: [], parkingTreasures: [], roadLabels: {}, pathUnder: {} };
    const key = WorldGen.Z + '/' + tx + '/' + ty;
    const prevDepth = WorldGen.tileCache;
    WorldGen.setDepth(0);
    WorldGen.tileCache.set(key, surface);
    try {
      const lvl1 = await WorldGen.loadTile.atDepth(1, tx, ty, lat);
      const chests = lvl1.objects.filter(o => o.kind === 'chest');
      assert.eq(chests.length, 2, 'both POIs reach depth 1');
      const lib = chests.find(c => c.caveOf === 'c_lib');
      assert.truthy(lib && lib.x === at(3, 3).x && lib.y === at(3, 3).y, 'library at its own point');
      assert.eq(lib.depth, 1, 'depth 1');
      const pond = chests.find(c => c.caveOf === 'c_pond');
      assert.truthy(pond, 'pond chest relocated off the wall');
      assert.falsy(pond.x === at(7, 7).x && pond.y === at(7, 7).y, 'not on the water cell');
      // No rock shares a chest's cell.
      const cellOf = (o) => Math.floor((o.y - ty * tileEdgeM) / mPerCell) * n + Math.floor((o.x - tx * tileEdgeM) / mPerCell);
      const chestCells = new Set(chests.map(cellOf));
      for (const o of lvl1.objects) {
        if (o.kind === 'mineralrock') assert.falsy(chestCells.has(cellOf(o)), 'rock ' + o.id + ' sits on a chest');
      }
      const lvl2 = await WorldGen.loadTile.atDepth(2, tx, ty, lat);
      const deep = lvl2.objects.filter(o => o.kind === 'chest');
      assert.eq(deep.length, 2, 'and depth 2');
      assert.eq(deep.find(c => c.caveOf === 'c_lib').id, 'c_lib_d2', 'own id at depth 2');
      assert.eq(chestTier('library', 0, 0, 2), 4, 'the library chest is T4 two levels down');
    } finally {
      WorldGen.setDepth(0);
      WorldGen.tileCache.delete(key);
      WorldGen.setDepth(1); WorldGen.tileCache.delete(key);
      WorldGen.setDepth(2); WorldGen.tileCache.delete(key);
      WorldGen.setDepth(0);
    }
  });

  test('chest: underground, a stand POI is a plain chest and a coin-burst POI is a plain chest', () => {
    const stall = { kind: 'chest', poiClass: 'bakery', name: 'Corner Bakery', x: 0, y: 0 };
    assert.truthy(produceStandFor(stall), 'a bakery on the surface is a stand');
    const under = { ...stall, depth: 1, id: 'x_d1' };
    assert.eq(produceStandFor(under), null, 'the same bakery one level down is a chest');
    assert.truthy(/\(o\.poiClass === 'atm' \|\| o\.poiClass === 'bicycle_parking'\) && !\(o\.depth > 0\)/.test(INTERACTABLES_SRC),
      'the coin-burst hijack stands down underground');
    assert.truthy(/_isCoinBurst = \(o\) => \(o\.poiClass === 'atm' \|\| o\.poiClass === 'bicycle_parking'\) && !\(o\.depth > 0\)/.test(RENDER_SRC),
      'and the pot-of-gold look stands down with it');
  });

  test('chest tier: every shipping reader passes the chest position', () => {
    const sources = { 'render.js': RENDER_SRC, 'interactables.js': INTERACTABLES_SRC };
    for (const [f, src] of Object.entries(sources)) {
      const calls = src.match(/chestTier\(o\.poiClass[^)]*\)/g) || [];
      assert.gt(calls.length, 0, f + ' resolves chest tiers through chestTier');
      for (const c of calls) {
        assert.eq(c, 'chestTier(o.poiClass, o.x, o.y, o.depth)', f + ': ' + c + ' must pass o.x, o.y, o.depth');
      }
    }
  });
})();
