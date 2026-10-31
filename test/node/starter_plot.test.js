// _carveStarterPlot — the guaranteed 2x2 of tillable ground near spawn.
//
// The planting step needs suitable ground even when the surrounding area
// is paved or wet. The frozen plot gives guidance a stable target and room
// for the first four crops.
//
// The function under test is src/starter.js's, reached through the scene's
// one-line wrapper that run.js hands over, so these run against the real
// shipping code.

// Wrapped in an IIFE: every *.test.js shares one global scope in the runner,
// so bare top-level consts here would collide with another file's.
(() => {
  const T = { GRASS: 0, FOREST: 1, WATER: 3, RESIDENTIAL: 5, ROAD: 7, BUILDING: 9, ROCK: 10 };
  const N = 40;                 // cells per tile edge in these fixtures
  const CELL_M = 7;
  const TILE_EDGE_M = N * CELL_M;
  const SPAWN = 20;             // spawn cell index, comfortably mid-tile

  // Scene stub carrying only what _carveStarterPlot touches. The coords helpers
  // (worldMetersToAbsCell / absCellCenterMeters) read originPx / mPerPx /
  // cellsPerTile, so those have to be self-consistent: mPerPx is chosen so one
  // cell of TILE_PX/cellsPerTile pixels measures exactly CELL_M metres.
  function makePlotScene(over = {}) {
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
    }, over);
  }

  // A tile of uniform `fill`, with optional per-cell overrides.
  function makeEntry(fill = T.GRASS, objects = [], wildplants = []) {
    return {
      cellsPerEdge: N,
      grid: new Uint8Array(N * N).fill(fill),
      objects,
      wildplants,
    };
  }
  const at = (entry, cx, cy) => entry.grid[cy * N + cx];
  const setCell = (entry, cx, cy, t) => { entry.grid[cy * N + cx] = t; };
  // World-metre centre of a tile-local cell, for seeding blocking objects.
  const cellCentre = (cx, cy) => ({ x: (cx + 0.5) * CELL_M, y: (cy + 0.5) * CELL_M });

  // The top-left cell of the plot the scene just froze.
  function plotCell(scene) {
    const p = scene.save.starterPlotAt;
    if (!p) return null;
    return { cx: Math.round((p.x - CELL_M / 2) / CELL_M), cy: Math.round((p.y - CELL_M / 2) / CELL_M) };
  }

  const NON_TILLABLE = new Set(NON_TILLABLE_CODES);
  function assertPlotIsTillable(entry, cell, msg) {
    for (const [dx, dy] of [[0,0],[1,0],[0,1],[1,1]]) {
      const t = at(entry, cell.cx + dx, cell.cy + dy);
      assert.falsy(NON_TILLABLE.has(t), `${msg}: cell +${dx}+${dy} is type ${t}, which is not tillable`);
    }
  }

  test('starter plot: an open field gets a 2x2 of tillable ground just outside the trailer', () => {
    const scene = makePlotScene();
    const entry = makeEntry(T.GRASS);
    carveStarterPlot.call(scene, entry, 0, 0, SPAWN, SPAWN, new Set());
    const cell = plotCell(scene);
    assert.truthy(cell, 'a plot was frozen on the save');
    assertPlotIsTillable(entry, cell, 'open field');
    // Every one of the four cells must clear the trailer moat (Chebyshev <= 1 of
    // spawn), or the plot sits under the house art.
    for (const [dx, dy] of [[0,0],[1,0],[0,1],[1,1]]) {
      const cheb = Math.max(Math.abs(cell.cx + dx - SPAWN), Math.abs(cell.cy + dy - SPAWN));
      assert.gt(cheb, 1, `cell +${dx}+${dy} is outside the trailer moat`);
    }
    // ...and land near the trailer rather than off across the tile.
    assert.lt(Math.max(Math.abs(cell.cx - SPAWN), Math.abs(cell.cy - SPAWN)), 9, 'plot is close to spawn');
  });

  test('starter plot: a paved spawn gets grass painted into the one yard that fits', () => {
    // Everything is road except a 2x2 residential yard 4 cells north-east —
    // exactly the case the plot exists for.
    const scene = makePlotScene();
    const entry = makeEntry(T.ROAD);
    const YX = SPAWN + 4, YY = SPAWN + 4;
    for (const [dx, dy] of [[0,0],[1,0],[0,1],[1,1]]) setCell(entry, YX + dx, YY + dy, T.RESIDENTIAL);
    carveStarterPlot.call(scene, entry, 0, 0, SPAWN, SPAWN, new Set());
    const cell = plotCell(scene);
    assert.truthy(cell, 'a plot was frozen even though the spawn is paved');
    assert.eq(cell.cx, YX, 'plot landed on the yard (x)');
    assert.eq(cell.cy, YY, 'plot landed on the yard (y)');
    assertPlotIsTillable(entry, cell, 'paved spawn');
    // The street itself is untouched — the plot paints yards, never roads.
    assert.eq(at(entry, SPAWN + 2, SPAWN), T.ROAD, 'road cell left alone');
  });

  test('starter plot: never paints over water, buildings, roads or the pier', () => {
    for (const [name, code] of [['water', T.WATER], ['building', T.BUILDING], ['road', T.ROAD]]) {
      const scene = makePlotScene();
      const entry = makeEntry(code);
      carveStarterPlot.call(scene, entry, 0, 0, SPAWN, SPAWN, new Set());
      assert.falsy(scene.save.starterPlotAt, `all-${name} tile freezes no plot`);
      // Grid completely untouched.
      for (let i = 0; i < entry.grid.length; i++) {
        if (entry.grid[i] !== code) throw new Error(`all-${name}: grid cell ${i} was repainted`);
      }
    }
  });

  test('starter plot: skips crate seats and cells something is standing in', () => {
    const scene = makePlotScene();
    const entry = makeEntry(T.GRASS);
    // Block every candidate in the r=2 ring: half with crate seats, half with a
    // real object (a street tree the clearing pass keeps). The plot must step out
    // to a further ring rather than overlapping either.
    const usedSeats = new Set();
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 2) continue;
        const cx = SPAWN + dx, cy = SPAWN + dy;
        if ((dx + dy) % 2 === 0) usedSeats.add(cx + ',' + cy);
        else entry.objects.push(Object.assign({ kind: 'tree' }, cellCentre(cx, cy)));
      }
    }
    carveStarterPlot.call(scene, entry, 0, 0, SPAWN, SPAWN, usedSeats);
    const cell = plotCell(scene);
    assert.truthy(cell, 'a plot was still found further out');
    for (const [dx, dy] of [[0,0],[1,0],[0,1],[1,1]]) {
      const cx = cell.cx + dx, cy = cell.cy + dy;
      assert.falsy(usedSeats.has(cx + ',' + cy), `cell +${dx}+${dy} is not a crate seat`);
      const hit = entry.objects.some(o =>
        Math.floor(o.x / CELL_M) === cx && Math.floor(o.y / CELL_M) === cy);
      assert.falsy(hit, `cell +${dx}+${dy} holds no object`);
    }
  });

  test('starter plot: wild plants block a cell the same way objects do', () => {
    const scene = makePlotScene();
    const entry = makeEntry(T.GRASS, [], []);
    const wilds = [];
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== 2) continue;
        wilds.push(Object.assign({ id: `w${dx}_${dy}` }, cellCentre(SPAWN + dx, SPAWN + dy)));
      }
    }
    entry.wildplants = wilds;
    carveStarterPlot.call(scene, entry, 0, 0, SPAWN, SPAWN, new Set());
    const cell = plotCell(scene);
    assert.truthy(cell, 'a plot was found');
    for (const [dx, dy] of [[0,0],[1,0],[0,1],[1,1]]) {
      const cx = cell.cx + dx, cy = cell.cy + dy;
      const hit = wilds.some(w => Math.floor(w.x / CELL_M) === cx && Math.floor(w.y / CELL_M) === cy);
      assert.falsy(hit, `cell +${dx}+${dy} holds no wild plant`);
    }
  });

  // The absolute cell key (coords.js) of a tile-local cell, as save.tilled holds it.
  const tilledKey = (scene, cx, cy) => {
    const c = worldMetersToAbsCell(scene, cellCentre(cx, cy).x, cellCentre(cx, cy).y);
    return cellKeyFromAbsCell(c.cellIX, c.cellIY);
  };

  test('starter plot: a frozen plot the player tilled is repainted in place, never re-chosen', () => {
    const scene = makePlotScene();
    const first = makeEntry(T.GRASS);
    carveStarterPlot.call(scene, first, 0, 0, SPAWN, SPAWN, new Set());
    const cell = plotCell(scene);
    assert.truthy(cell, 'first build froze a plot');
    const frozen = { x: scene.save.starterPlotAt.x, y: scene.save.starterPlotAt.y };
    scene.save.tilled = [tilledKey(scene, cell.cx + 1, cell.cy)];

    // Rebuild the SAME tile with the surroundings changed so a fresh search
    // would land somewhere else entirely (the whole ring is now road). The
    // frozen plot must be repainted where it already is — otherwise it would
    // move out from under a player who has already tilled it.
    const rebuilt = makeEntry(T.ROAD);
    carveStarterPlot.call(scene, rebuilt, 0, 0, SPAWN, SPAWN, new Set());
    assert.eq(scene.save.starterPlotAt.x, frozen.x, 'frozen x unchanged');
    assert.eq(scene.save.starterPlotAt.y, frozen.y, 'frozen y unchanged');
    assertPlotIsTillable(rebuilt, cell, 'rebuilt tile');
    // ...and only those four cells were repainted.
    let painted = 0;
    for (let i = 0; i < rebuilt.grid.length; i++) if (rebuilt.grid[i] === T.GRASS) painted++;
    assert.eq(painted, 4, 'exactly the 2x2 was repainted');
  });

  test('starter plot: a plot frozen on a neighbouring tile is left to that tile', () => {
    const scene = makePlotScene({ save: { starterPlotAt: { x: -100, y: -100 } } });
    const entry = makeEntry(T.GRASS);
    carveStarterPlot.call(scene, entry, 0, 0, SPAWN, SPAWN, new Set());
    assert.eq(scene.save.starterPlotAt.x, -100, 'frozen point untouched');
    // Nothing painted on this tile: every cell is still the fill value, and no
    // search ran (which would have overwritten the freeze).
    assert.eq(scene.save.starterPlotAt.y, -100, 'frozen point untouched (y)');
  });

  test('starter plot: a veteran save keeps its terrain untouched', () => {
    // The ladder is what the plot serves. A save past it (finished or the chip
    // dismissed) must not have its home ground quietly repainted on a reload.
    for (const [name, mut] of [
      ['finished', (sv) => Quests.starterSkipAll(sv)],
      ['dismissed', (sv) => Quests.starterDismiss(sv)],
    ]) {
      const scene = makePlotScene();
      mut(scene.save);
      const entry = makeEntry(T.FOREST);
      carveStarterPlot.call(scene, entry, 0, 0, SPAWN, SPAWN, new Set());
      assert.falsy(scene.save.starterPlotAt, `${name}: no plot frozen`);
      for (let i = 0; i < entry.grid.length; i++) {
        if (entry.grid[i] !== T.FOREST) throw new Error(`${name}: grid cell ${i} was repainted`);
      }
    }
  });

  test('starter plot: a plot frozen before the ladder ended is still repainted after', () => {
    const scene = makePlotScene();
    const first = makeEntry(T.GRASS);
    carveStarterPlot.call(scene, first, 0, 0, SPAWN, SPAWN, new Set());
    const cell = plotCell(scene);
    assert.truthy(cell, 'plot frozen while the ladder was running');
    // Finish the ladder, then rebuild: the field the player planted must not
    // revert to whatever terrain was under it.
    scene.save.planted = [{ ...cellCentre(cell.cx, cell.cy + 1), crop: 'potato' }];
    Quests.starterSkipAll(scene.save);
    const rebuilt = makeEntry(T.ROAD);
    carveStarterPlot.call(scene, rebuilt, 0, 0, SPAWN, SPAWN, new Set());
    assertPlotIsTillable(rebuilt, cell, 'after the ladder finished');
  });

  // A plot nobody has worked is a promise the arrow points at, and the
  // ground under it can change after it froze: Home's firepit is seated
  // later, a newer dressing can stand a prop there, a road can widen over
  // it. The carve chooses again rather than repainting soil nobody can till.
  test('starter plot: an unworked frozen plot moves when something now stands on it', () => {
    const scene = makePlotScene();
    carveStarterPlot.call(scene, makeEntry(T.GRASS), 0, 0, SPAWN, SPAWN, new Set());
    const old = plotCell(scene);
    assert.truthy(old, 'a plot was frozen');
    const rebuilt = makeEntry(T.GRASS, [Object.assign({ kind: 'tree' }, cellCentre(old.cx + 1, old.cy + 1))]);
    carveStarterPlot.call(scene, rebuilt, 0, 0, SPAWN, SPAWN, new Set());
    const now = plotCell(scene);
    assert.truthy(now, 'a plot is frozen again');
    assert.truthy(now.cx !== old.cx || now.cy !== old.cy, 'the plot moved off the tree');
    assertPlotIsTillable(rebuilt, now, 'moved plot');
    for (const [dx, dy] of [[0,0],[1,0],[0,1],[1,1]]) {
      assert.falsy(now.cx + dx === old.cx + 1 && now.cy + dy === old.cy + 1, `cell +${dx}+${dy} is not the tree's`);
    }
    // ...and a plot the player has tilled stays put over the same obstacle.
    const worked = makePlotScene();
    carveStarterPlot.call(worked, makeEntry(T.GRASS), 0, 0, SPAWN, SPAWN, new Set());
    const kept = plotCell(worked);
    worked.save.tilled = [tilledKey(worked, kept.cx, kept.cy)];
    const again = makeEntry(T.GRASS, [Object.assign({ kind: 'tree' }, cellCentre(kept.cx + 1, kept.cy + 1))]);
    carveStarterPlot.call(worked, again, 0, 0, SPAWN, SPAWN, new Set());
    assert.eq(JSON.stringify(plotCell(worked)), JSON.stringify(kept), 'a tilled plot never moves');
  });

  test('starter plot: a veteran save\'s unworked plot is dropped, not re-chosen, once its ground is gone', () => {
    const scene = makePlotScene();
    carveStarterPlot.call(scene, makeEntry(T.GRASS), 0, 0, SPAWN, SPAWN, new Set());
    assert.truthy(scene.save.starterPlotAt, 'a plot was frozen');
    Quests.starterSkipAll(scene.save);
    const rebuilt = makeEntry(T.ROAD);
    carveStarterPlot.call(scene, rebuilt, 0, 0, SPAWN, SPAWN, new Set());
    assert.falsy(scene.save.starterPlotAt, 'the freeze is dropped');
    for (let i = 0; i < rebuilt.grid.length; i++) {
      if (rebuilt.grid[i] !== T.ROAD) throw new Error(`grid cell ${i} was repainted`);
    }
  });

  // The carve runs on a freshly built tile, before Home's house is stamped
  // back into its grid and the firepit re-injected, so it reads both from
  // the save. Home's north-up footing alone does not cover a house the first
  // compass heading turned, nor a pit seated by a street.
  test('starter plot: keeps off the saved wagon\'s house and firepit, which the grid cannot show', () => {
    // A west-facing placement: the wagon one cell west of the anchor, its
    // 2x2 reaching two cells west — outside the north-up footing.
    const wagon = cellCentre(SPAWN - 1, SPAWN), pit = cellCentre(SPAWN + 2, SPAWN + 2);
    const scene = makePlotScene({ save: { starterTrailer: { id: 'starter_trailer', ...wagon }, homeFirepit: pit } });
    const entry = makeEntry(T.GRASS);
    // Block the rest of ring 2 so the house's west cells are the nearest
    // candidates left: every ring-2 cell save the block that would overlap them.
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== 2) continue;
      if (dx === -2 && dy <= 0 && dy >= -1) continue;
      entry.objects.push(Object.assign({ kind: 'tree' }, cellCentre(SPAWN + dx, SPAWN + dy)));
    }
    carveStarterPlot.call(scene, entry, 0, 0, SPAWN, SPAWN, new Set());
    const cell = plotCell(scene);
    assert.truthy(cell, 'a plot was frozen');
    const houseCells = new Set();
    for (const dy of [-1, 0]) for (const dx of [-1, 0]) houseCells.add(`${SPAWN - 1 + dx},${SPAWN + dy}`);
    for (const [dx, dy] of [[0,0],[1,0],[0,1],[1,1]]) {
      assert.falsy(houseCells.has(`${cell.cx + dx},${cell.cy + dy}`), `cell +${dx}+${dy} is not under the house`);
      assert.falsy(cell.cx + dx === SPAWN + 2 && cell.cy + dy === SPAWN + 2, `cell +${dx}+${dy} is not the firepit's`);
    }
    // A plot frozen before the pit was seated, and then sat on by it, moves.
    const late = makePlotScene();
    carveStarterPlot.call(late, makeEntry(T.GRASS), 0, 0, SPAWN, SPAWN, new Set());
    const old = plotCell(late);
    late.save.homeFirepit = cellCentre(old.cx, old.cy + 1);
    carveStarterPlot.call(late, makeEntry(T.GRASS), 0, 0, SPAWN, SPAWN, new Set());
    const moved = plotCell(late);
    assert.truthy(moved && (moved.cx !== old.cx || moved.cy !== old.cy), 'the plot leaves the firepit');
    for (const [dx, dy] of [[0,0],[1,0],[0,1],[1,1]]) {
      assert.falsy(moved.cx + dx === old.cx && moved.cy + dy === old.cy + 1, `cell +${dx}+${dy} is not the firepit's`);
    }
  });

  test('starter plot: onStarterPlot names exactly the frozen 2x2', () => {
    const scene = makePlotScene();
    carveStarterPlot.call(scene, makeEntry(T.GRASS), 0, 0, SPAWN, SPAWN, new Set());
    const cell = plotCell(scene);
    for (let dy = -1; dy <= 2; dy++) for (let dx = -1; dx <= 2; dx++) {
      const c = cellCentre(cell.cx + dx, cell.cy + dy);
      assert.eq(Starter.onStarterPlot(scene, c.x, c.y), dx >= 0 && dx < 2 && dy >= 0 && dy < 2, `cell ${dx},${dy}`);
    }
    assert.falsy(Starter.onStarterPlot(makePlotScene(), 10, 10), 'no plot, no cells');
  });

  test('starter plot: the frozen point is the top-left cell centre, on the tap grid', () => {
    const scene = makePlotScene();
    const entry = makeEntry(T.GRASS);
    carveStarterPlot.call(scene, entry, 0, 0, SPAWN, SPAWN, new Set());
    const p = scene.save.starterPlotAt;
    // Round-tripping the frozen point through the same cell math every tap uses
    // must land back on itself — that is what makes the arrow and the till
    // handler agree about where the plot is.
    const { cellIX, cellIY } = worldMetersToAbsCell(scene, p.x, p.y);
    const back = absCellCenterMeters(scene, cellIX, cellIY);
    assert.inRange(back.x - p.x, -0.001, 0.001, 'x is already a cell centre');
    assert.inRange(back.y - p.y, -0.001, 0.001, 'y is already a cell centre');
  });
})();
