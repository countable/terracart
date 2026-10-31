// THE SEWER (floor 1): its route lanes are drawn as channel water
// (FloorWallMaterials.isSewerChannel, the profile's `channelWater`), so
// worldgen reserves them before any pass and nothing — barrel, rock, torch,
// coin, X, creature — is born in the water; its barrels heap up on a
// `barrels` profile row of their own; and its vermin are the sewer rats, the
// heaviest draw of the first floor's natural regions.
(() => {
  const W = WorldGen, T = W.T;
  const spawn = new Function('entry', 'tx', 'ty', 'depth', SPAWN_CAVE_SRC.replace(/\n\s*\}\s*$/, ''));

  test('sewer: channel lanes are reserved, and nothing generated or spawned stands in the water', async () => {
    const N = 40, edge = N * W.CELL_M, tx = 931531, ty = 931532, key = W.tileKey(tx, ty);
    const grid = new Uint8Array(N * N).fill(T.PARK), spawnWhy = new Uint32Array(N * N), gameplayTiers = new Uint8Array(N * N).fill(1);
    // One footway across the middle and one down the tile: two projected
    // routes with a centre lane each.
    const layers = [{ name: 'transportation', extent: 4096, features: [
      { id: 7, type: 2, tags: { class: 'footway' }, geom: [[{ x: 100, y: 2048 }, { x: 4000, y: 2048 }]] },
      { id: 8, type: 2, tags: { class: 'path' }, geom: [[{ x: 1024, y: 100 }, { x: 1024, y: 4000 }]] }] }];
    W.setDepth(0).set(key, { status: 'ready', grid, baseGrid: grid.slice(), spawnWhy, gameplayTiers, layers,
      cellsPerEdge: N, tileEdgeM: edge, objects: [], genObjects: [], wildplants: [] });
    const index = o => Math.floor((o.y - ty * edge) / W.CELL_M) * N + Math.floor((o.x - tx * edge) / W.CELL_M);
    const oldTest = window.__TEST_MODE;
    window.__TEST_MODE = false;
    try {
      const entry = await W.loadTile.atDepth(1, tx, ty, 49);
      spawn.call({ tileEdgeM: edge, save: { caught: [] } }, entry, tx, ty, 1);
      assert.truthy(W.floorProfile(1).channelWater, 'the sewer row says its lanes are water');
      const lane = entry.underground.lane;
      assert.gt(lane.size, N, 'the fixture projects channel lanes');
      for (const i of lane) {
        assert.eq(entry.grid[i], T.CAVE_FLOOR, 'a channel is still walkable floor');
        assert.truthy(entry.undergroundReserved.has(i), 'every lane cell is reserved for the runtime draws too');
        assert.truthy(FloorWallMaterials.isSewerChannel(entry, i), 'and drawn as channel water');
      }
      const all = [...entry.objects, ...entry.wildplants, ...entry.extraTreasures, ...entry.caveCoinSeeds,
        ...entry.creatures, ...(entry.coinDrops || []), ...(entry.traps || [])];
      assert.gt(all.length, 40, 'the dry floor still populates');
      assert.gt(entry.creatures.length, 0, 'with monsters');
      for (const o of all) assert.falsy(lane.has(index(o)), `${o.kind || o.crop || 'reward'} ${o.id || ''} stands in the channel`);
      // Barrels: the sewer's own heap, all on dry floor.
      const barrels = entry.objects.filter(o => o.barrel);
      const budget = W.caveBarrelBudget(1);
      assert.gte(barrels.length, Math.floor(budget.min / 2), `the sewer heaps barrels (${barrels.length})`);
      // The natural cave beneath keeps its lanes as plain route floor.
      const below = await W.loadTile.atDepth(2, tx, ty, 49);
      assert.falsy(W.floorProfile(2).channelWater);
      for (const i of below.underground.lane) assert.falsy(FloorWallMaterials.isSewerChannel(below, i), 'no channel water on L2');
    } finally {
      window.__TEST_MODE = oldTest;
      for (let depth = 0; depth <= 2; depth++) W.setDepth(depth).delete(key);
      W.setDepth(0);
    }
  });

  test('sewer: rats are the first floor\'s heaviest natural draw, a two-level window, with sheet frames that exist', () => {
    const rat = EnemyRoster.get('rat');
    assert.truthy(rat && rat.tier === 1 && rat.surface === null, 'a cave-only tier-1 row');
    assert.includes(EnemyHabitats.FAMILIES.natural, 'rat');
    const l1 = EnemySpawns.caveRows(1);
    assert.truthy(l1.some(r => r.id === 'rat'), 'in the sewer');
    assert.truthy(EnemySpawns.caveRows(2).some(r => r.id === 'rat'), 'and the natural cave below');
    assert.falsy(EnemySpawns.caveRows(3).some(r => r.id === 'rat'), 'never the warrens');
    for (const row of l1) if (row.id !== 'rat') assert.gt(rat.cave.weight, row.cave.weight, `outweighs ${row.id}`);
    // Its own generated sheet: three 16px frames by four rows (down, left, right, up).
    assert.eq(rat.art.path, 'assets/Enemy/Rat.png');
    const frames = Object.values(rat.art.directions).flatMap(d => [...d.idle, ...d.move]);
    assert.eq(new Set(frames).size, 12, 'four directions, three frames each');
    for (const f of frames) assert.inRange(f, 0, 11);
    const dims = pngDims(rat.art.path);
    assert.eq(`${dims.w}x${dims.h}`, '48x64', 'the sheet holds exactly those frames');
    const art = SpriteLayout.creatureArt('rat');
    assert.truthy(art.directions && art.directionSideFacing === 'right');
    assert.truthy(SpriteLayout.creatureWanders('rat'));
    assert.truthy(Combat.isEnemy({ kind: 'rat' }));
  });

  test('sewer: channel water is fished from the sewer\'s own narrow pool, with two fish found nowhere else', () => {
    assert.eq(W.floorProfile(1).fishPool, 'sewer', 'the sewer row names its pool');
    assert.falsy(W.floorProfile(2).fishPool, 'the natural cave below fishes the surface table');
    const pool = FISH_POOLS.sewer, surface = new Set(FISH_SPECIES.map(f => f.id));
    assert.lt(pool.length, FISH_SPECIES.length, 'fewer species than the surface');
    const unique = pool.filter(f => !surface.has(f.id)).map(f => f.id);
    assert.eq(unique.join(), 'blind_cavefish,sewer_eel', 'two of its own');
    for (const id of unique) {
      const item = ITEM_BY_ID[id];
      assert.truthy(item && item.kind === 'produce' && item.dropWeight === 0, `${id} is produce that never drops`);
      assert.truthy(BASE_TIER[id] && PRICES[id] && FOOD_ENERGY[id] && COOKED_FOODS[id], `${id} has a tier, a price, a meal and a grill`);
      assert.truthy(ITEM_EFFECTS[id] && ITEM_EFFECTS[COOKED_FOODS[id].id], `${id} carries the fish eat copy`);
      assert.gt(Energy.fishRegenTotal(id), 0, `${id} regenerates like a fish`);
      assert.gt(Energy.fishRegenTotal(COOKED_FOODS[id].id), 0, `grilled ${id} too`);
      const icon = inventoryIconSource(id), dims = pngDims(`assets/Icons/Fish/Sewer/${item.name}.png`);
      assert.truthy(icon.sheet.startsWith('icon_') && dims && dims.w === 16 && dims.h === 16, `${id} has a 16px icon`);
      assert.truthy(new RegExp(`${icon.sheet}:\\s*\\{ url: 'assets/Icons/Fish/Sewer/${item.name}.png'`).test(SCENE_SRC), `${id}'s icon sheet is registered`);
      assert.truthy(animalLikesFood('cat', id), `the cat wants a ${id}`);
    }
    // The pool draws only its own species, every one of them, same for everyone.
    const seen = {};
    for (let i = 0; i < 4000; i++) {
      const id = fishSpotId(5, 6, i % 100, Math.floor(i / 100), 1);
      assert.truthy(id.startsWith('fish_d1_'), 'a sewer spot carries its depth');
      assert.truthy(id !== fishSpotId(5, 6, i % 100, Math.floor(i / 100)), 'and is never the pond\'s spot above it');
      const fish = spotFish(id, { pool: 'sewer' });
      assert.eq(fish, spotFish(id, { pool: 'sewer' }));
      seen[fish] = (seen[fish] || 0) + 1;
    }
    assert.eq(Object.keys(seen).sort().join(), pool.map(f => f.id).sort().join(), 'every pool species, nothing else');
    assert.gt(seen.blind_cavefish, seen.sewer_eel, 'the cavefish is the common one');
    // The tap handler: a channel cell casts like water, under the floor's pool.
    assert.truthy(/const channel = !!pool && FloorWallMaterials\.isSewerChannel\(entry, cellIdx, cell\.type\)/.test(INTERACT_SRC), 'a channel tap is a cast');
    assert.truthy(/if \(cell\.type !== TERRAIN\.WATER && !channel\) return false/.test(INTERACT_SRC));
    assert.truthy(/fishSpotId\(cell\.tx, cell\.ty, cell\.ix, cell\.iy, depth\)/.test(INTERACT_SRC), 'the spot carries the depth');
    assert.truthy(/const stock = pool \? \{ pool \} : entry\?\.zoneDress\?\.fishStock/.test(INTERACT_SRC), 'the floor\'s pool is the stock policy');
    // Shiny glints: the sewer's channel spots are listed (and drawn) like surface water.
    // One shiny spot in 20 stocked, one stocked cell in 3: a ten-row channel
    // (300 cells) is enough to hold a few.
    const N = 30, grid = new Uint8Array(N * N).fill(T.CAVE_FLOOR), lane = new Set();
    for (let y = 10; y < 20; y++) for (let x = 0; x < N; x++) lane.add(y * N + x);
    const entry = { grid, cellsPerEdge: N, depth: 1, underground: { lane } };
    const list = shinyFishSpots(entry, 5, 6);
    assert.gt(list.length, 0, 'a channel has shiny spots');
    for (const f of list) {
      assert.truthy(lane.has(f.iy * N + f.ix), 'only in the channel');
      assert.eq(f.id, fishSpotId(5, 6, f.ix, f.iy, 1));
    }
    assert.eq(shinyFishSpots({ grid, cellsPerEdge: N, depth: 2, underground: { lane } }, 5, 6).length, 0, 'a plain cave lane is not water');
    assert.truthy(/\(\(scene\.depth \|\| 0\) === 0 \|\| WorldGen\.floorProfile\(scene\.depth\)\.fishPool\)/.test(RENDER_SRC), 'the renderer glints a pooled floor');
  });
})();
