// _carveStarterPond — the guaranteed 2x2 fishing pond two screens from Home.
//
// Fishing is a tap on a WATER cell, and nothing about a spawn promises one
// within walking distance: a suburban start can be a kilometre from the
// nearest creek, and the whole fishing loop simply doesn't exist for that
// player. The pond is what makes it always reachable — carved TWO SCREENS out
// (past the relic chest and the starter ring), beside a POI chest when one
// stands in the band, frozen once on the save and repainted in place on every
// rebuild of its tile.
//
// The methods under test are lifted out of src/app.js by run.js (they live on
// the Phaser scene class), so these run against the real shipping code.

(() => {
  const T = { GRASS: 0, FOREST: 1, WATER: 3, RESIDENTIAL: 5, ROAD: 7, BUILDING: 9 };
  const CELL_M = 7;

  // Scene stub carrying only what the pond pass touches. The coords helpers
  // (worldMetersToAbsCell / absCellCenterMeters) read originPx / mPerPx /
  // cellsPerTile, so those are chosen so one cell of TILE_PX/cellsPerTile
  // pixels measures exactly CELL_M metres — the starter_plot fixture's trick.
  function makePondScene(N, anchorCell, over = {}) {
    const cellPx = WorldGen.TILE_PX / N;
    const a = anchorCell != null ? cellCentre(anchorCell, anchorCell) : null;
    return Object.assign({
      save: a ? { starterCratesAt: a } : {},
      cellM: CELL_M,
      tileEdgeM: N * CELL_M,
      cellsPerTile: N,
      mPerPx: CELL_M / cellPx,
      originPx: { x: 0, y: 0 },
      startWorldM: { x: 0, y: 0 },
      depth: 0,
      _starterTrailAnchor() { return this.save.starterCratesAt || null; },
    }, __pond, over);
  }
  // World-metre centre of a tile-0/0-local cell.
  const cellCentre = (cx, cy) => ({ x: (cx + 0.5) * CELL_M, y: (cy + 0.5) * CELL_M });

  function makeEntry(N, fill = T.GRASS, objects = [], wildplants = []) {
    return {
      cellsPerEdge: N, tileEdgeM: N * CELL_M, status: 'ready', _spawned: true,
      grid: new Uint8Array(N * N).fill(fill),
      objects, wildplants,
    };
  }
  const at = (entry, cx, cy) => entry.grid[cy * entry.cellsPerEdge + cx];
  const setCell = (entry, cx, cy, t) => { entry.grid[cy * entry.cellsPerEdge + cx] = t; };
  const countOf = (entry, t) => {
    let n = 0;
    for (let i = 0; i < entry.grid.length; i++) if (entry.grid[i] === t) n++;
    return n;
  };
  // The top-left cell of the pond the scene just froze (tile 0/0 basis).
  function pondCell(scene) {
    const p = scene.save.starterPondAt;
    if (!p) return null;
    return { cx: Math.round((p.x - CELL_M / 2) / CELL_M), cy: Math.round((p.y - CELL_M / 2) / CELL_M) };
  }
  const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));

  // The pass reads its neighbours (and the anchor tile's own objects) out of
  // the live WorldGen.tileCache. Run each case against an empty one, with the
  // fixture tiles it registers, and put back whatever another test left.
  function withCache(tiles, fn) {
    const saved = new Map(WorldGen.tileCache);
    WorldGen.tileCache.clear();
    for (const [tx, ty, e] of tiles) WorldGen.tileCache.set(WorldGen.tileKey(tx, ty), e);
    try { return fn(); } finally {
      WorldGen.tileCache.clear();
      for (const [k, v] of saved) WorldGen.tileCache.set(k, v);
    }
  }

  // The big fixture: 80 cells a side with the anchor mid-tile, so the whole
  // band (POND_MAX_CELLS out, plus the shore) sits inside one tile and no
  // deferral is in play.
  const N = 80, A = 40;

  test('starter pond: the band is two screens out, in the one unit the player can see', () => {
    assert.eq(POND_MIN_CELLS, 2 * VIEW_CELLS, 'POND_MIN_CELLS is exactly two viewports');
    assert.gt(POND_MAX_CELLS, POND_MIN_CELLS, 'the band has some width to search');
    // ...and past everything else the starter kit lays down, so the second
    // outing finds something new rather than the ring it already saw.
    assert.gt(POND_MIN_CELLS, HomeArea.RING_MAX_CELLS, 'beyond the starter ring');
  });

  test('starter pond: an open field gets a 2x2 of water two screens from Home', () => {
    const scene = makePondScene(N, A);
    const entry = makeEntry(N);
    withCache([[0, 0, entry]], () => scene._carveStarterPond(entry, 0, 0));
    const c = pondCell(scene);
    assert.truthy(c, 'a pond was frozen on the save');
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      assert.eq(at(entry, c.cx + dx, c.cy + dy), T.WATER, `cell +${dx}+${dy} is water`);
    }
    assert.eq(countOf(entry, T.WATER), 4, 'exactly the 2x2 was painted');
    const d = cheb(c.cx, c.cy, A, A);
    assert.inRange(d, POND_MIN_CELLS, POND_MAX_CELLS, `top-left is ${d} cells out: in the band`);
    // Nearest ring first: an open field seats it right at two screens.
    assert.eq(d, POND_MIN_CELLS, 'an unobstructed field seats it on the near edge of the band');
  });

  test('starter pond: the frozen point is the top-left cell centre, on the tap grid', () => {
    const scene = makePondScene(N, A);
    const entry = makeEntry(N);
    withCache([[0, 0, entry]], () => scene._carveStarterPond(entry, 0, 0));
    const p = scene.save.starterPondAt;
    const { cellIX, cellIY } = worldMetersToAbsCell(scene, p.x, p.y);
    const back = absCellCenterMeters(scene, cellIX, cellIY);
    assert.inRange(back.x - p.x, -0.001, 0.001, 'x is already a cell centre');
    assert.inRange(back.y - p.y, -0.001, 0.001, 'y is already a cell centre');
  });

  test('starter pond: a POI chest in the band pulls the pond beside it', () => {
    const scene = makePondScene(N, A);
    // A real POI chest (it carries a poiClass) 26 cells due east — inside the
    // band, but not where the nearest-ring scan would otherwise look first
    // (that lands on the ring at 22, in the scan's top-left corner).
    const POI = { cx: A + 26, cy: A };
    const entry = makeEntry(N, T.GRASS, [
      Object.assign({ kind: 'chest', poiClass: 'cafe', id: 'poi_cafe' }, cellCentre(POI.cx, POI.cy)),
    ]);
    withCache([[0, 0, entry]], () => scene._carveStarterPond(entry, 0, 0));
    const c = pondCell(scene);
    assert.truthy(c, 'a pond was frozen');
    // Chebyshev distance from the 2x2 to the chest.
    const dx = Math.max(c.cx - POI.cx, POI.cx - (c.cx + 1), 0);
    const dy = Math.max(c.cy - POI.cy, POI.cy - (c.cy + 1), 0);
    const dp = Math.max(dx, dy);
    assert.inRange(dp, 2, POND_POI_CELLS, `pond is ${dp} cells from the chest: beside it, off its doorstep`);
    assert.eq(at(entry, POI.cx, POI.cy), T.GRASS, 'the chest cell itself is dry');
    assert.truthy(entry.objects.some(o => o.id === 'poi_cafe'), 'the chest is still standing');
  });

  test('starter pond: a starter crate is not a POI', () => {
    const scene = makePondScene(N, A);
    // Same spot, but a supply crate (no poiClass) — the pond must not be
    // drawn to it; it seats on the near edge of the band as on an open field.
    const entry = makeEntry(N, T.GRASS, [
      Object.assign({ kind: 'chest', crate: true, id: 'chest_start_0_0_1' }, cellCentre(A + 26, A)),
    ]);
    withCache([[0, 0, entry]], () => scene._carveStarterPond(entry, 0, 0));
    const c = pondCell(scene);
    assert.truthy(c, 'a pond was frozen');
    assert.eq(cheb(c.cx, c.cy, A, A), POND_MIN_CELLS, 'seated on the band edge, not beside the crate');
  });

  test('starter pond: never paints over water, buildings or roads', () => {
    for (const [name, code] of [['water', T.WATER], ['building', T.BUILDING], ['road', T.ROAD]]) {
      const scene = makePondScene(N, A);
      const entry = makeEntry(N, code);
      withCache([[0, 0, entry]], () => scene._carveStarterPond(entry, 0, 0));
      assert.falsy(scene.save.starterPondAt, `all-${name} tile freezes no pond`);
      for (let i = 0; i < entry.grid.length; i++) {
        if (entry.grid[i] !== code) throw new Error(`all-${name}: grid cell ${i} was repainted`);
      }
    }
  });

  test('starter pond: a drawn road band is refused even where the grid says grass', () => {
    // The terrain under-reports the road (see entry.roadMask in worldgen):
    // an all-grass grid whose mask covers the whole band must seat nothing.
    const scene = makePondScene(N, A);
    const entry = makeEntry(N);
    entry.roadMask = new Uint8Array(N * N).fill(1);
    withCache([[0, 0, entry]], () => scene._carveStarterPond(entry, 0, 0));
    assert.falsy(scene.save.starterPondAt, 'nothing seated under the asphalt');
    assert.eq(countOf(entry, T.WATER), 0, 'grid untouched');
  });

  test('starter pond: only where Home can walk to — a moat cuts the band off', () => {
    const scene = makePondScene(N, A);
    const entry = makeEntry(N);
    // A ring of river at 20 cells: the band beyond it is dry ground the
    // player would have to swim to.
    for (let dy = -20; dy <= 20; dy++) {
      for (let dx = -20; dx <= 20; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) === 20) setCell(entry, A + dx, A + dy, T.WATER);
      }
    }
    const before = countOf(entry, T.WATER);
    withCache([[0, 0, entry]], () => scene._carveStarterPond(entry, 0, 0));
    assert.falsy(scene.save.starterPondAt, 'no pond across the river');
    assert.eq(countOf(entry, T.WATER), before, 'grid untouched');
  });

  test('starter pond: a wall on one side moves it to the other, not through it', () => {
    const scene = makePondScene(N, A);
    const entry = makeEntry(N);
    // Everything from the anchor's own row northward is one solid building
    // (the anchor cell itself stays clear so the walk has somewhere to start).
    for (let cy = 0; cy <= A + 1; cy++) for (let cx = 0; cx < N; cx++) setCell(entry, cx, cy, T.BUILDING);
    setCell(entry, A, A, T.GRASS);
    setCell(entry, A, A + 1, T.GRASS);
    withCache([[0, 0, entry]], () => scene._carveStarterPond(entry, 0, 0));
    const c = pondCell(scene);
    assert.truthy(c, 'a pond was still found');
    assert.gt(c.cy, A, 'it went south, where the walk is');
    assert.inRange(cheb(c.cx, c.cy, A, A), POND_MIN_CELLS, POND_MAX_CELLS, 'and stayed in the band');
  });

  test('starter pond: a cell something stands on is skipped, and the shore is dry ground', () => {
    const scene = makePondScene(N, A);
    // Trees on every cell of the near ring and its shore, so the pond has to
    // step out — and must not overlap a single one of them.
    const trees = [];
    for (let dy = -24; dy <= 24; dy++) {
      for (let dx = -24; dx <= 24; dx++) {
        const r = Math.max(Math.abs(dx), Math.abs(dy));
        if (r < 21 || r > 24) continue;
        if ((dx + dy) % 3 !== 0) continue;
        trees.push(Object.assign({ kind: 'tree', id: `t${dx}_${dy}` }, cellCentre(A + dx, A + dy)));
      }
    }
    const entry = makeEntry(N, T.GRASS, trees);
    withCache([[0, 0, entry]], () => scene._carveStarterPond(entry, 0, 0));
    const c = pondCell(scene);
    assert.truthy(c, 'a pond was found further out');
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const hit = trees.some(o => Math.floor(o.x / CELL_M) === c.cx + dx && Math.floor(o.y / CELL_M) === c.cy + dy);
      assert.falsy(hit, `cell +${dx}+${dy} holds no tree`);
    }
    // Every cell ringing the pond is walkable, dry ground.
    for (let dy = -1; dy <= 2; dy++) {
      for (let dx = -1; dx <= 2; dx++) {
        if (dx >= 0 && dx <= 1 && dy >= 0 && dy <= 1) continue;
        const t = at(entry, c.cx + dx, c.cy + dy);
        assert.truthy(WorldGen.isWalkable(t) && t !== T.WATER, `shore cell ${dx},${dy} is dry ground (type ${t})`);
      }
    }
  });

  test('starter pond: a frozen pond is repainted in place on a rebuild, never re-chosen', () => {
    const scene = makePondScene(N, A);
    const first = makeEntry(N);
    withCache([[0, 0, first]], () => scene._carveStarterPond(first, 0, 0));
    const c = pondCell(scene);
    assert.truthy(c, 'first build froze a pond');
    const frozen = { x: scene.save.starterPondAt.x, y: scene.save.starterPondAt.y };

    // Rebuild the SAME tile with the surroundings changed so a fresh search
    // would go elsewhere (a chest beside the far side of the band), and with
    // a regenerated rock standing in the pond. It is repainted where it is
    // — a pond that moved would strand a player who had walked to it — and
    // the rock is swept out of the water.
    const rebuilt = makeEntry(N, T.GRASS, [
      Object.assign({ kind: 'mineralrock', id: 'rock_in_pond' }, cellCentre(c.cx, c.cy)),
      Object.assign({ kind: 'chest', poiClass: 'park', id: 'poi_park' }, cellCentre(A, A - 27)),
    ]);
    withCache([[0, 0, rebuilt]], () => scene._carveStarterPond(rebuilt, 0, 0));
    assert.eq(scene.save.starterPondAt.x, frozen.x, 'frozen x unchanged');
    assert.eq(scene.save.starterPondAt.y, frozen.y, 'frozen y unchanged');
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      assert.eq(at(rebuilt, c.cx + dx, c.cy + dy), T.WATER, `cell +${dx}+${dy} is water again`);
    }
    assert.eq(countOf(rebuilt, T.WATER), 4, 'exactly the 2x2 was repainted');
    assert.falsy(rebuilt.objects.some(o => o.id === 'rock_in_pond'), 'the rock in the pond was swept');
    assert.truthy(rebuilt.objects.some(o => o.id === 'poi_park'), 'everything else still stands');
  });

  test('starter pond: a pond frozen on a neighbouring tile is left to that tile', () => {
    const scene = makePondScene(N, A, { save: { starterCratesAt: cellCentre(A, A), starterPondAt: { x: -100, y: -100 } } });
    const entry = makeEntry(N);
    withCache([[0, 0, entry]], () => scene._carveStarterPond(entry, 0, 0));
    assert.eq(scene.save.starterPondAt.x, -100, 'frozen point untouched');
    assert.eq(countOf(entry, T.WATER), 0, 'nothing painted on this tile');
  });

  test('starter pond: no anchor yet, no pond yet', () => {
    const scene = makePondScene(N, null);
    const entry = makeEntry(N);
    withCache([[0, 0, entry]], () => scene._carveStarterPond(entry, 0, 0));
    assert.falsy(scene.save.starterPondAt, 'nothing frozen before the anchor resolves');
    assert.eq(countOf(entry, T.WATER), 0, 'grid untouched');
  });

  test('starter pond: waits, bounded, for the tiles the band reaches into', () => {
    // 60 cells a side with the anchor mid-tile: the band's far corners fall
    // on neighbours that never load. The first passes defer; the ninth plans
    // with what it can see rather than leaving the player with no water.
    const M = 60, B = 30;
    const scene = makePondScene(M, B);
    const entry = makeEntry(M);
    withCache([[0, 0, entry]], () => {
      for (let i = 0; i < 8; i++) {
        scene._carveStarterPond(entry, 0, 0);
        assert.falsy(scene.save.starterPondAt, `pass ${i + 1} deferred while the band is half loaded`);
      }
      scene._carveStarterPond(entry, 0, 0);
    });
    const c = pondCell(scene);
    assert.truthy(c, 'the bounded wait ran out and a pond was seated');
    assert.eq(countOf(entry, T.WATER), 4, 'painted into the tile that could be seen');
  });

  test('starter pond: the late-anchor sweep plans from a tile that already spawned', () => {
    // The anchor resolves after the tiles around it spawned (a slow first
    // GPS fix): _carveStarterPondAround walks the cache and seats the pond.
    const scene = makePondScene(N, A);
    const entry = makeEntry(N);
    withCache([[0, 0, entry]], () => scene._carveStarterPondAround());
    assert.truthy(pondCell(scene), 'a pond was frozen from the cache sweep');
    assert.eq(countOf(entry, T.WATER), 4, 'and painted');
  });

  test('starter pond: a painted cell is water to the fishing tap', () => {
    const scene = makePondScene(N, A);
    const entry = makeEntry(N);
    withCache([[0, 0, entry]], () => scene._carveStarterPond(entry, 0, 0));
    const c = pondCell(scene);
    const type = at(entry, c.cx, c.cy);
    assert.eq(type, TERRAIN.WATER, 'the pond cell is the terrain code the rod handler keys off');
    const tap = makeScene();
    const save = { relics: { rod: { tier: 1 } }, inv: [], selSlot: 0 };
    const ctx = Object.assign(makeCtx(tap, save), { cell: { type }, sx: 0, sy: 0, cwmx: 0, cwmy: 0 });
    const h = TAP_HANDLERS.find(hh => hh.name === 'fishing');
    assert.eq(h.try(ctx), true, 'a cast is made on the pond');
  });
})();
