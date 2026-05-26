// Sandbox mode — a synthetic test world that replaces the player's start tile
// with a 5×5 grid of 5×5-cell biome plots, each pre-populated with every
// interactable thing native to that biome. Loaded by appending `?sandbox=true`
// to the URL.
//
// Why this exists:
//   Every interactable in the game is gated by either the underlying terrain
//   type (tilling needs soil, rocks break to rockfruit, debris spawns per
//   polygon) or by a sparse worldgen roll (chests, trees, towers, special
//   shops). Reproducing all of them in one place by walking the real map
//   takes minutes. The sandbox compresses every biome + every native item
//   into a 25×25-cell square the player can walk across in seconds.
//
// How it works:
//   1. detect() reads location.search for `sandbox=true`.
//   2. install(scene) pre-populates WorldGen.tileCache with a ready synthetic
//      tile entry for the player's start-tile coord. WorldGen.loadTile is a
//      `if (tileCache.has(key)) return tileCache.get(key)` short-circuit, so
//      the network fetch is bypassed entirely. Surrounding tiles get filled
//      with plain grass so edges read clean instead of black.
//   3. The 5×5 grid of biome plots is laid out at the tile's CENTRE so the
//      player (who starts at startWorldM, which lat/lon-projects somewhere
//      inside the start tile) doesn't need teleporting to find it. We also
//      explicitly position playerM to the grid's player-spawn plot.
//
// Dependencies (globals):
//   WorldGen — Z, tileCache, cellsPerEdgeForLat, tileEdgeMeters, makeRng
//   COLORS / NON_TILLABLE  — only needed by callers; this module only
//     populates entry.grid with terrain type codes.
//
// Exports as a global:
//   Sandbox.detect()       → bool
//   Sandbox.install(scene) → void

(function (global) {
  // Single source of truth for the biome layout. Each cell of this 5×5 grid
  // is one biome plot rendered as a 5×5 cluster of cells of that terrain
  // type. -1 = player spawn cell (filled with grass; player teleports here).
  // Terrain type codes match app.js COLORS{}.
  const PLOT_LAYOUT = [
    [ 0,  1,  2,  3,  4 ],   //  grass | forest | sand | water | farmland
    [ 5,  6,  7,  8,  9 ],   //  resid | park   | road | path  | small house
    [10, 11, 12, 13, 14 ],   //  rock  | bld_md | castle | road_lg | road_md
    [15, 16, 17, 18, 19 ],   //  school | comm  | indust | playgrd | pitch
    [20, 21, 22, -1,  0 ],   //  wetland | golf | orchard | PLAYER | grass+chest
  ];
  const PLOT_W = 5;            // cells per plot edge
  const GRID_W = PLOT_LAYOUT[0].length;
  const GRID_H = PLOT_LAYOUT.length;
  const GRID_CELLS_W = GRID_W * PLOT_W;
  const GRID_CELLS_H = GRID_H * PLOT_W;

  // Accept any "truthy-ish" value so people can type `?sandbox=1`, `?sandbox`,
  // `?sandbox=yes`, etc. Only `false` / `0` / `no` / empty-after-equals disable.
  function detect() {
    try {
      const sp = new URLSearchParams(location.search);
      if (!sp.has('sandbox')) return false;
      const v = (sp.get('sandbox') || '').toLowerCase();
      return v !== 'false' && v !== '0' && v !== 'no';
    } catch (_) { return false; }
  }

  // Pre-install a "ready" synthetic tile entry into WorldGen.tileCache so
  // WorldGen.loadTile() short-circuits on the cache lookup. The entry mirrors
  // the shape rasterizeTile() returns, plus a creatures[] array (normally
  // added by app.js spawnInTile — we set it here so spawnInTile is skipped).
  function makeTileEntry({ tx, ty, cellsPerEdge, tileEdgeM, cellM, populate }) {
    const grid = new Uint8Array(cellsPerEdge * cellsPerEdge);   // default 0 = grass
    const objects = [];
    const wildplants = [];
    const creatures = [];

    // Helper: cell index → world metres at cell centre.
    const wmAt = (ix, iy) => ({
      x: tx * tileEdgeM + (ix + 0.5) * cellM,
      y: ty * tileEdgeM + (iy + 0.5) * cellM,
    });

    populate({ grid, objects, wildplants, creatures, cellsPerEdge, wmAt, tx, ty });

    return {
      status: 'ready',
      grid,
      objects,
      wildplants,
      creatures,
      parkingTreasures: [],
      roadLetters: {},
      treasure: null,
      tileEdgeM,
      cellsPerEdge,
      fromCache: true,
      // loadTile awaits entry.promise when status === 'loading'; ours is
      // ready so it's never awaited, but harmless to satisfy the shape.
      promise: Promise.resolve(null),
    };
  }

  function install(scene) {
    // Flag the scene so other systems (GPS, etc.) know to behave differently.
    scene._sandboxMode = true;
    // If a previous session had already started watching GPS (the safety
    // modal click in a prior page load), kill the watch so an incoming fix
    // doesn't race the teleport at the bottom of this function.
    if (scene.gpsWatchId != null && navigator.geolocation) {
      try { navigator.geolocation.clearWatch(scene.gpsWatchId); } catch (_) {}
      scene.gpsWatchId = null;
    }
    scene.gpsAvailable = false;
    const cellsPerEdge = scene.cellsPerTile;
    const tileEdgeM = scene.tileEdgeM;
    const cellM = scene.cellM;
    // Anchor the grid at the centre of the start tile so the player's
    // start (somewhere inside the tile) is close to it. We also reposition
    // the player to the dedicated PLAYER plot below.
    const gridOriginIX = Math.floor((cellsPerEdge - GRID_CELLS_W) / 2);
    const gridOriginIY = Math.floor((cellsPerEdge - GRID_CELLS_H) / 2);

    // Player's start tile.
    const startCell = scene.playerToWorldCell();
    const centreTX = startCell.tx;
    const centreTY = startCell.ty;

    // Build the centre tile (the actual sandbox) and 8 grass-only neighbours
    // so the viewport edge doesn't show "loading…" tiles.
    for (let dty = -1; dty <= 1; dty++) {
      for (let dtx = -1; dtx <= 1; dtx++) {
        const tx = centreTX + dtx, ty = centreTY + dty;
        const key = `${WorldGen.Z}/${tx}/${ty}`;
        if (WorldGen.tileCache.has(key)) continue;
        const isCentre = (dtx === 0 && dty === 0);
        const entry = makeTileEntry({
          tx, ty, cellsPerEdge, tileEdgeM, cellM,
          populate: isCentre
            ? populateSandbox.bind(null, gridOriginIX, gridOriginIY)
            : () => { /* grass everywhere, no items */ },
        });
        WorldGen.tileCache.set(key, entry);
      }
    }

    // Teleport the player to the PLAYER plot's centre cell. PLAYER is the
    // -1 marker in PLOT_LAYOUT; find it.
    let pgx = 0, pgy = 0;
    for (let gy = 0; gy < GRID_H; gy++) {
      for (let gx = 0; gx < GRID_W; gx++) {
        if (PLOT_LAYOUT[gy][gx] === -1) { pgx = gx; pgy = gy; }
      }
    }
    const playerCellIX = gridOriginIX + pgx * PLOT_W + Math.floor(PLOT_W / 2);
    const playerCellIY = gridOriginIY + pgy * PLOT_W + Math.floor(PLOT_W / 2);
    const targetWorldX = centreTX * tileEdgeM + (playerCellIX + 0.5) * cellM;
    const targetWorldY = centreTY * tileEdgeM + (playerCellIY + 0.5) * cellM;
    scene.playerM.x = targetWorldX - scene.startWorldM.x;
    scene.playerM.y = targetWorldY - scene.startWorldM.y;
    // Cancel any GPS-ease that might overwrite our teleport.
    scene._ease = null;
    // Pretend a GPS fix arrived so the UI doesn't sit in "no GPS" mode.
    scene.gpsM = { x: scene.playerM.x, y: scene.playerM.y };
  }

  // Lay out the biome plots into the tile's grid + populate every plot with
  // every native interactable. Called once per sandbox install.
  function populateSandbox(originIX, originIY, ctx) {
    const { grid, objects, wildplants, creatures, cellsPerEdge, wmAt, tx, ty } = ctx;

    // Helper: stable id base so save.picked / save.opened / save.caught
    // stay meaningful across reloads of the same sandbox tile.
    const baseId = `sb_${tx}_${ty}`;

    for (let gy = 0; gy < GRID_H; gy++) {
      for (let gx = 0; gx < GRID_W; gx++) {
        const biome = PLOT_LAYOUT[gy][gx];
        const terrain = biome === -1 ? 0 : biome;   // player plot is grass
        const ix0 = originIX + gx * PLOT_W;
        const iy0 = originIY + gy * PLOT_W;
        // Fill the plot's 5×5 cells with the biome's terrain code.
        for (let dy = 0; dy < PLOT_W; dy++) {
          for (let dx = 0; dx < PLOT_W; dx++) {
            const ix = ix0 + dx, iy = iy0 + dy;
            if (ix < 0 || iy < 0 || ix >= cellsPerEdge || iy >= cellsPerEdge) continue;
            grid[iy * cellsPerEdge + ix] = terrain;
          }
        }
        populatePlot(biome, ix0, iy0, gx, gy, { objects, wildplants, creatures, wmAt, baseId });
      }
    }
  }

  // Centred cell of a plot (used as the natural anchor for single objects).
  const PLOT_MID = Math.floor(PLOT_W / 2);

  function populatePlot(biome, ix0, iy0, gx, gy, { objects, wildplants, creatures, wmAt, baseId }) {
    const plotTag = `${gx}_${gy}`;
    // Convenience for "cell (dx, dy) inside this plot".
    const at = (dx, dy) => wmAt(ix0 + dx, iy0 + dy);

    // ── Common helpers ─────────────────────────────────────────────
    const pushCreature = (kind, dx, dy, n) => {
      const { x, y } = at(dx, dy);
      creatures.push({ x, y, kind, id: `${baseId}_${plotTag}_${kind}_${n}` });
    };
    const pushWildplant = (crop, dx, dy) => {
      const { x, y } = at(dx, dy);
      const cellIX = ix0 + dx, cellIY = iy0 + dy;
      wildplants.push({ x, y, crop, _ix: cellIX, _iy: cellIY,
        id: `${baseId}_wp_${plotTag}_${crop}_${dx}_${dy}` });
    };
    const pushFlora = (variant, dx, dy) => {
      const { x, y } = at(dx, dy);
      objects.push({ kind: 'flora', x, y, deco: 'flower', variant,
        id: `${baseId}_fl_${plotTag}_${variant}_${dx}_${dy}` });
    };
    const pushTree = (variant, dx, dy) => {
      const { x, y } = at(dx, dy);
      objects.push({ kind: 'tree', x, y, variant,
        id: `${baseId}_tree_${plotTag}_${variant}_${dx}_${dy}` });
    };
    const pushChest = (poiClass, name, dx, dy) => {
      const { x, y } = at(dx, dy);
      objects.push({ kind: 'chest', x, y, poiClass, name,
        id: `${baseId}_chest_${plotTag}_${dx}_${dy}` });
    };
    const pushHouse = (dx, dy, address = 0) => {
      const { x, y } = at(dx, dy);
      objects.push({ kind: 'house', x, y, tier: 9, address,
        id: `${baseId}_house_${plotTag}_${dx}_${dy}` });
    };
    const pushTower = (dx, dy) => {
      const { x, y } = at(dx, dy);
      objects.push({ kind: 'tower', x, y,
        id: `${baseId}_tower_${plotTag}_${dx}_${dy}` });
    };

    switch (biome) {
      case 0: {   // GRASS — small herd + flowers + longgrass
        pushCreature('chicken', 0, 0, 1);
        pushCreature('chicken', 4, 1, 2);
        pushCreature('cow',     2, 2, 1);
        pushCreature('cat',     0, 4, 1);
        pushCreature('dog',     4, 4, 1);
        pushFlora(0, 1, 1); pushFlora(1, 3, 1);
        pushFlora(2, 1, 3); pushFlora(3, 3, 3);
        pushWildplant('longgrass', 2, 0);
        pushWildplant('longgrass', 2, 4);
        // A bonus chest in the duplicate-grass plot at (4, 4) — see PLOT_LAYOUT.
        if (gx === 4 && gy === 4) {
          pushChest('shop', 'Sandbox Chest', PLOT_MID, PLOT_MID);
        }
        break;
      }
      case 1: {   // FOREST — every tree variant, shrubs, nuts
        for (let v = 0; v < 5; v++) {
          const dx = (v % 5);   // line them up on the top row of the plot
          pushTree(v, dx, 0);
        }
        pushWildplant('shrub', 0, 2);
        pushWildplant('shrub', 2, 2);
        pushWildplant('shrub', 4, 2);
        pushWildplant('nut',   1, 4);
        pushWildplant('nut',   3, 4);
        break;
      }
      case 2: {   // SAND — no native spawns; place one cat for movement testing
        pushCreature('cat', PLOT_MID, PLOT_MID, 1);
        break;
      }
      case 3: {   // WATER — unwalkable; nothing to put on top
        break;
      }
      case 4: {   // FARMLAND — chickens + cows; soil is tillable
        pushCreature('chicken', 0, 0, 1);
        pushCreature('chicken', 4, 0, 2);
        pushCreature('cow',     2, 2, 1);
        pushCreature('cow',     4, 4, 2);
        break;
      }
      case 5: {   // RESIDENTIAL — rockfruit + a small house + shop variants
        pushWildplant('rockfruit', 0, 0);
        pushWildplant('rockfruit', 4, 0);
        pushWildplant('rockfruit', 0, 4);
        pushWildplant('rockfruit', 4, 4);
        // Three shop houses at the centre row — addresses pick shop type.
        pushHouse(1, PLOT_MID, 9);   // blacksmith
        pushHouse(2, PLOT_MID, 6);   // market
        pushHouse(3, PLOT_MID, 8);   // trader
        break;
      }
      case 6: {   // PARK — shrubs + flowers + longgrass + a cat/dog
        pushWildplant('shrub', 0, 0);
        pushWildplant('shrub', 4, 0);
        pushWildplant('shrub', 2, 2);
        pushFlora(0, 1, 1);
        pushFlora(1, 3, 1);
        pushFlora(2, 1, 3);
        pushWildplant('longgrass', 2, 4);
        pushCreature('cat', 0, 4, 1);
        pushCreature('dog', 4, 4, 1);
        break;
      }
      case 9:    // SMALL HOUSE — building tile is its own interactable
      case 11:   // BUILDING_MED — the building IS the thing
      case 12:   // BUILDING_LARGE — castle, also self-rendering
        break;
      case 10: { // ROCK — solid 5×5; tap any cell to break and roll loot
        // No items needed — the rock terrain itself is the interactable.
        break;
      }
      case 15:   // SCHOOL
      case 18:   // PLAYGROUND
      case 19:   // PITCH
      case 20:   // WETLAND
      case 21: { // GOLF — all grassland-family; longgrass + flowers
        pushFlora(0, 1, 1);
        pushFlora(1, 3, 1);
        pushFlora(2, 2, 3);
        if (biome !== 20) {   // wetland doesn't grow longgrass
          pushWildplant('longgrass', 2, 0);
          pushWildplant('longgrass', 2, 4);
        }
        break;
      }
      case 16:   // COMMERCIAL — mushrooms + a high-tier chest
      case 17: { // INDUSTRIAL — same; rocky-family
        pushWildplant('mushroom', 1, 1);
        pushWildplant('mushroom', 3, 3);
        pushChest('shop', biome === 16 ? 'Sandbox Mall' : 'Sandbox Factory',
                  PLOT_MID, PLOT_MID);
        break;
      }
      case 22: { // ORCHARD — fruit trees + chest
        pushTree(2, 0, 0); pushTree(3, 4, 0);
        pushTree(2, 0, 4); pushTree(3, 4, 4);
        pushChest('parking', 'Sandbox Orchard', PLOT_MID, PLOT_MID);
        break;
      }
      case -1: { // PLAYER spawn — small starter kit so test taps land on something
        // A nearby tower (cardinal landmark) and a chest at the corner.
        pushTower(0, 0);
        pushChest('shop', 'Sandbox Start Chest', 4, 4);
        // A single chicken to verify creature catching at spawn.
        pushCreature('chicken', 3, 3, 1);
        break;
      }
      // Roads / paths (7, 8, 13, 14) get no items — the cobble overlay is
      // generated at render time from the terrain code alone.
      default:
        break;
    }
  }

  global.Sandbox = { detect, install };
})(window);
