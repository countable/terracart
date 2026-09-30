// A POI chest's TIER is its class's DENSITY on its own tile (loot.js
// CHEST_DENSITY_TIERS / chestTier, stamped by worldgen.js stampPoiDensity),
// raised by cave depth and a zone's nexus — identical for every player,
// wherever their Home is, and the SAME tier its loot rolls at (there is no
// roll-side twin any more: the Home rings, CHEST_TIER_HOME_RINGS_M, are
// gone). Pins: the table (1 → T4, 25 → T1), the fixed classes (public art),
// no Home input anywhere, the stamp over a real rasterize, the look and the
// restock following the new tier, and the cave mirrors carrying the count.
(() => {
  const chest = (poiClass, poiDensity, extra = {}) => ({ kind: 'chest', poiClass, poiDensity, x: 0, y: 0, id: 'c_' + poiClass + '_' + poiDensity, ...extra });

  test('chest tier: the density table — 1 of a kind is T4, 25 or more is T1', () => {
    const want = { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2, 10: 2, 24: 2, 25: 1, 26: 1, 500: 1 };
    for (const [n, t] of Object.entries(want)) assert.eq(chestDensityTier(Number(n)), t, n + ' of a kind');
    assert.eq(CHEST_DENSITY_T1_AT, 25, 'dense is 25');
    assert.eq(chestDensityTier(0), CHEST_TIER_UNSTAMPED, 'no count → the unstamped fallback');
    assert.eq(chestDensityTier(undefined), CHEST_TIER_UNSTAMPED, 'nor does a missing one');
    assert.eq(CHEST_TIER_UNSTAMPED, 2, 'which is the old unlisted-class T2');
    // The table is ordered and total: first row whose threshold is met wins.
    for (let i = 1; i < CHEST_DENSITY_TIERS.length; i++) {
      assert.gt(CHEST_DENSITY_TIERS[i - 1].atLeast, CHEST_DENSITY_TIERS[i].atLeast, 'thresholds fall');
      assert.lt(CHEST_DENSITY_TIERS[i - 1].tier, CHEST_DENSITY_TIERS[i].tier, 'tiers rise as the count falls');
    }
    assert.eq(CHEST_DENSITY_TIERS[CHEST_DENSITY_TIERS.length - 1].atLeast, 1, 'every stamped chest has a row');
  });

  test('chest tier: the same rule for every class — density, not category', () => {
    for (const cls of Object.keys(POI_CATEGORY)) {
      if (CHEST_CLASS_TIER[cls] != null) continue;
      assert.eq(chestTier(chest(cls, 1)), 4, cls + ' alone is T4');
      assert.eq(chestTier(chest(cls, 25)), 1, cls + ' in a crowd is T1');
    }
    assert.truthy(typeof CHEST_TIER_BY_CATEGORY === 'undefined', 'the category tier table is gone');
  });

  test('chest tier: public art is a fixed T1 one-time trunk', () => {
    for (const n of [1, 3, 30]) {
      const art = chest('art_gallery', n);
      assert.eq(chestTier(art), 1, 'T1 at ' + n + ' of a kind');
      assert.eq(chestLook(art).texKey, 'chest', 'wears the trunk, never the crate');
      assert.falsy(restocks(art), 'and never restocks');
    }
    const art = chest('art_gallery', 30);
    const sets = spentSets(null, { opened: [art.id] });
    assert.truthy(isSpent(art, sets), 'spent in save.opened, for good');
    assert.eq(chestTier(chest('art_gallery', 1, { depth: 2 })), 2, 'the depth bonus still applies');
  });

  test('chest tier: Home is no input — no rings, no roll-side twin, the same tier and look anywhere', () => {
    assert.truthy(typeof CHEST_TIER_HOME_RINGS_M === 'undefined', 'the Home rings are gone');
    assert.truthy(typeof chestRollTier === 'undefined', 'and the Home-softened roll with them');
    assert.truthy(typeof chestTierHomeDrop === 'undefined', 'and its drop');
    const chests = Object.keys(POI_CATEGORY).flatMap((cls, i) =>
      [1, 3, 30].map((n) => chest(cls, n, { x: 100 + i, y: 200, depth: i % 3, id: 'c' + i + '_' + n })));
    const seen = () => chests.map((o) => { const c = { ...o }; return chestTier(c) + ':' + chestLook(c).texKey; }).join(',');
    const prev = HomeArea.worldM;
    try {
      HomeArea.worldM = null;
      const none = seen();
      HomeArea.setOrigin(100, 200);
      const near = seen();
      HomeArea.setOrigin(1e7, 1e7);
      const far = seen();
      assert.eq(near, none, 'a Home on top of the chest changes nothing');
      assert.eq(far, none, 'nor a Home far away');
    } finally { HomeArea.worldM = prev; }
    // Source: the tier code reads no Home at all.
    const tierSrc = LOOT_SRC.slice(LOOT_SRC.indexOf('const CHEST_DENSITY_TIERS'), LOOT_SRC.indexOf('function chestLook('));
    assert.falsy(/HomeArea|homeWorldPos|homeM/.test(tierSrc), 'loot.js tier code never reads Home');
  });

  test('chest tier: depth and nexus stack on the density tier, capped at T5', () => {
    for (const n of [1, 3, 10, 30]) {
      const base = chestDensityTier(n);
      for (let d = 0; d <= 12; d++) {
        const t = chestTier(chest('park', n, { depth: d }));
        assert.eq(t, Math.min(CHEST_TIER_MAX, base + Math.floor(d / 2)), `density ${n} at depth ${d}`);
      }
      assert.eq(chestTier(chest('park', n, { zoneNexus: 'grove' })), Math.min(CHEST_TIER_MAX, base + ZONE_NEXUS_TIER_BONUS),
        `density ${n} nexus`);
    }
  });

  test('chest tier: the look and the restock follow the tier — a dense class is a crate, a rare one a trunk', () => {
    const dense = chest('bus', 25), rare = chest('bus', 1), mid = chest('shelter', 7);
    assert.eq(chestLook(dense).texKey, 'box', '25 bus stops: each is a crate');
    assert.truthy(restocks(dense), 'and restocks');
    assert.eq(chestLook(rare).texKey, 'chest', 'the one bus stop: a trunk');
    assert.falsy(restocks(rare), 'one-time');
    assert.eq(chestLook(mid).texKey, 'chest', 'a T2 shelter: a trunk');
    assert.falsy(restocks(mid), 'one-time');
    const nexus = chest('fuel', 30, { zoneNexus: 'tar' });
    assert.eq(chestTier(nexus), 2, 'a dense class at a nexus is T2');
    assert.falsy(restocks(nexus), 'so it is no crate');
  });

  test('chest tier: stampPoiDensity counts each class on the tile, and only surface POI chests', () => {
    const objs = [
      chest('bus', undefined, { id: 'a' }), chest('bus', undefined, { id: 'b' }), chest('bus', undefined, { id: 'c' }),
      chest('florist', undefined, { id: 'd' }),
      chest('bus', undefined, { id: 'e', crate: true }),
      chest('bus', undefined, { id: 'f', depth: 1, caveOf: 'x' }),
      { kind: 'tree', id: 't', x: 0, y: 0 },
    ];
    objs[0]._chestLook = { texKey: 'stale' };
    WorldGen.stampPoiDensity(objs);
    assert.eq(objs.slice(0, 3).map((o) => o.poiDensity).join(','), '3,3,3', 'three bus stops');
    assert.eq(objs[3].poiDensity, 1, 'one florist');
    assert.eq(objs[4].poiDensity, undefined, 'a starter crate is not counted or stamped');
    assert.eq(objs[5].poiDensity, undefined, 'nor is a cave copy');
    assert.falsy(objs[0]._chestLook && objs[0]._chestLook.texKey === 'stale', 'a changed count drops the memoised look');
  });

  test('chest tier: a real rasterize stamps every POI chest with its class count', () => {
    const CPE = 64, EXT = 4096, CELL = EXT / CPE, EDGE = 640;
    const pt = (ix, iy) => [[{ x: (ix + 0.5) * CELL, y: (iy + 0.5) * CELL }]];
    const feats = [];
    for (let i = 0; i < 6; i++) feats.push({ type: 1, tags: { class: 'bus' }, geom: pt(4 + i * 3, 10) });
    feats.push({ type: 1, tags: { class: 'florist', name: 'Bloom' }, geom: pt(30, 30) });
    const r = WorldGen.rasterizeTile([{ name: 'poi', features: feats }], CPE, 0, 0, EDGE);
    const chests = r.objects.filter((o) => o.kind === 'chest');
    const bus = chests.filter((o) => o.poiClass === 'bus');
    assert.gt(bus.length, 1, 'bus stops survive the build');
    for (const o of chests) {
      assert.eq(o.poiDensity, chests.filter((c) => c.poiClass === o.poiClass).length, o.id + ' carries its class count');
    }
    const fl = chests.find((o) => o.poiClass === 'florist');
    if (fl) assert.eq(chestTier(fl), 4, 'the lone florist is T4');
  });

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
    // One school on the tile: density 1, the T4 surface tier, carried down.
    assert.eq(a.poiDensity, 1, 'the surface chest\'s density rides down');
    assert.eq(chestTier(a), 4, 'depth 1 keeps the surface tier');
  });

  test('cave chests: the recursion keeps the SURFACE id and re-stamps depth', () => {
    const d1 = WorldGen.caveChestsFrom([poiChest(2, 2, 'school')], floorGrid(), N, TX, TY, TILE_M, 1, new Set());
    const d2 = WorldGen.caveChestsFrom(d1, floorGrid(), N, TX, TY, TILE_M, 2, new Set());
    assert.eq(d2.length, 1, 'mirrored again');
    assert.eq(d2[0].id, 'c_2_2_d2', 'depth-2 id off the surface id, not off _d1');
    assert.eq(d2[0].caveOf, 'c_2_2', 'surface id carried');
    assert.eq(d2[0].depth, 2, 'depth re-stamped');
    assert.eq(d2[0].poiDensity, 1, 'the density is carried, not recounted off the cave level');
    assert.eq(chestTier(d2[0]), 5, 'a lone school is T5 two levels down');
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
      assert.eq(chestTier(deep.find(c => c.caveOf === 'c_lib')), 5, 'the lone library is T5 two levels down');
    } finally {
      WorldGen.setDepth(0);
      WorldGen.tileCache.delete(key);
      WorldGen.setDepth(1); WorldGen.tileCache.delete(key);
      WorldGen.setDepth(2); WorldGen.tileCache.delete(key);
      WorldGen.setDepth(0);
    }
  });

  test('chest: underground, a stand POI is a plain chest and a pot / rack / barrel is a plain chest', () => {
    const stall = { kind: 'chest', poiClass: 'bakery', name: 'Corner Bakery', x: 0, y: 0 };
    assert.truthy(produceStandFor(stall), 'a bakery on the surface is a stand');
    const under = { ...stall, depth: 1, id: 'x_d1' };
    assert.eq(produceStandFor(under), null, 'the same bakery one level down is a chest');
    for (const cls of ['atm', 'bicycle_parking', 'waste_basket']) {
      const o = { kind: 'chest', poiClass: cls, x: 0, y: 0, depth: 2, poiDensity: 1 };
      assert.falsy(isPotOfGold(o) || isBikeRack(o) || isBarrel(o), cls + ' underground is none of its surface selves');
      assert.eq(chestLook(o).texKey, 'chest', 'and wears the trunk');
    }
    assert.truthy(/if \(isPotOfGold\(o\)\) \{/.test(INTERACTABLES_SRC), 'the pot hijack asks the one predicate');
    assert.eq(chestLook({ kind: 'chest', poiClass: 'atm', x: 0, y: 0 }).texKey, 'potofgold',
      'an ATM on the surface wears the pot of gold');
    assert.truthy(!/_isCoinBurst|_chestIsBox/.test(RENDER_SRC),
      'render.js keeps no second copy of the look');
  });

  test('chest tier: the drawer and the roll read the one tier', () => {
    // render.js draws the gem and interactables.js rolls the loot off the SAME
    // chestTier(o) — there is no Home-softened twin to tell apart. (A Wishing
    // Well's boon lifts the roll by Shrines.FORTUNE_TIER_BONUS while it runs.)
    assert.truthy(/const tier = chestTier\(o\);/.test(RENDER_SRC), 'render.js draws chestTier(o)');
    assert.truthy(/chestTier\(o\) : 2\) \+ fortune\);/.test(INTERACTABLES_SRC), 'interactables.js rolls at chestTier(o)');
    for (const src of [RENDER_SRC, INTERACTABLES_SRC, SCENE_SRC]) {
      assert.falsy(/chestRollTier|CHEST_TIER_HOME_RINGS_M|chestTierHomeDrop/.test(src), 'no Home ring reader survives');
    }
  });
})();
