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
    // Plant a treasure X one cell north of spawn (within REACH_TREASURE_M)
    // so the tester can verify treasure-tap loot without hunting for one.
    const centreEntry = WorldGen.tileCache.get(`${WorldGen.Z}/${centreTX}/${centreTY}`);
    if (centreEntry && !centreEntry.treasure) {
      centreEntry.treasure = {
        id: `sandbox_treasure_${centreTX}_${centreTY}`,
        x: targetWorldX,
        y: targetWorldY - cellM,
      };
    }
    // Debug biome labels — a thin white-on-black caption at each plot's
    // centre. Helps a tester orient (the terrain colours are subtle and the
    // grid layout is non-obvious from inside the game). Anchored as Phaser
    // text on its own container above the cell paint, below sprites.
    installBiomeLabels(scene, gridOriginIX, gridOriginIY, centreTX, centreTY,
                       cellsPerEdge, tileEdgeM, cellM);
  }

  // Lazy-create a labels container the first time install runs; subsequent
  // installs (e.g. resetTestState → Sandbox.install) recreate the labels in
  // the same container.
  function installBiomeLabels(scene, originIX, originIY, tx, ty, cellsPerEdge, tileEdgeM, cellM) {
    if (!scene._sandboxLabels) {
      scene._sandboxLabels = scene.add.container(0, 0).setDepth(50);
    }
    scene._sandboxLabels.removeAll(true);
    scene._sandboxLabelData = [];
    for (let gy = 0; gy < GRID_H; gy++) {
      for (let gx = 0; gx < GRID_W; gx++) {
        const biome = PLOT_LAYOUT[gy][gx];
        const name = BIOME_NAMES[biome] || (biome === -1 ? 'PLAYER' : `?${biome}`);
        // Anchor at the plot CENTRE (not the top row) so the label is in
        // viewport range when the player is on or beside the plot. The top-
        // row anchor put labels for nearby plots 5 cells too high, just
        // outside the 32m halfM cull.
        const cellIX = originIX + gx * PLOT_W + Math.floor(PLOT_W / 2);
        const cellIY = originIY + gy * PLOT_W + Math.floor(PLOT_W / 2);
        const wx = tx * tileEdgeM + (cellIX + 0.5) * cellM;
        const wy = ty * tileEdgeM + (cellIY + 0.5) * cellM;
        const t = scene.add.text(0, 0, name, {
          font: 'bold 8px ui-monospace, monospace',
          color: '#ffffff',
          backgroundColor: 'rgba(0,0,0,0.6)',
          padding: { x: 3, y: 1 },
        }).setOrigin(0.5, 0).setVisible(false);
        scene._sandboxLabels.add(t);
        scene._sandboxLabelData.push({ wx, wy, t });
      }
    }
    // Hook into the update loop so labels follow the camera. We attach a
    // post-update tick that re-positions every label from its world coord
    // each frame. The container has its own depth so it sits above cells.
    if (!scene._sandboxLabelTickInstalled) {
      scene._sandboxLabelTickInstalled = true;
      const reposition = () => {
        const data = scene._sandboxLabelData;
        if (!data) return;
        const pWX = scene.startWorldM.x + scene.playerM.x;
        const pWY = scene.startWorldM.y + scene.playerM.y;
        const halfM = (VIEW_CELLS / 2 + 1) * scene.cellM;
        for (const d of data) {
          const dx = d.wx - pWX, dy = d.wy - pWY;
          if (Math.abs(dx) > halfM || Math.abs(dy) > halfM) {
            d.t.setVisible(false); continue;
          }
          const sx = scene.viewCenterX + (dx / scene.cellM) * CELL_PX;
          const sy = scene.viewCenterY + (dy / scene.cellM) * CELL_PX;
          d.t.setVisible(true).setPosition(Math.round(sx), Math.round(sy));
        }
      };
      // Hook into a method we KNOW runs every scene tick. Phaser binds
      // scene.update via its system, so a direct `scene.update = ...` patch
      // doesn't intercept — but wanderCreatures is called from inside
      // scene.update each frame, and we own the reference. Wrap it so
      // reposition fires immediately after the wander step every frame.
      const origWander = scene.wanderCreatures.bind(scene);
      scene.wanderCreatures = function () {
        const r = origWander();
        try { reposition(); } catch (_) { /* never throw in update */ }
        return r;
      };
    }
  }

  // Friendly names for the biome plot labels. Numeric keys match the terrain
  // type codes in app.js COLORS{}.
  const BIOME_NAMES = {
    0:  'GRASS',
    1:  'FOREST',
    2:  'SAND',
    3:  'WATER',
    4:  'FARMLAND',
    5:  'RESIDENT',
    6:  'PARK',
    7:  'ROAD',
    8:  'PATH',
    9:  'HOUSE',
    10: 'ROCK',
    11: 'FORT',
    12: 'CASTLE',
    13: 'ROAD_LG',
    14: 'ROAD_MD',
    15: 'SCHOOL',
    16: 'COMMERCIAL',
    17: 'INDUSTRY',
    18: 'PLAYGROUND',
    19: 'PITCH',
    20: 'WETLAND',
    21: 'GOLF',
    22: 'ORCHARD',
  };

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
    // Fruit trees yield their species (apple, cherry, …) when tapped — gated
    // by save.picked. One species per tree so the test driver can probe all
    // eight by tapping different cells in the orchard.
    const pushFruitTree = (species, dx, dy) => {
      const { x, y } = at(dx, dy);
      objects.push({ kind: 'fruittree', x, y, species,
        id: `${baseId}_ft_${plotTag}_${species}_${dx}_${dy}` });
    };
    // Mineral rocks gate on pickaxe tier — `requiredTier` 1..7 maps onto the
    // MATERIAL_TIERS ladder. Drops coal + a gem scaled by tier.
    const pushMineralRock = (requiredTier, dx, dy) => {
      const { x, y } = at(dx, dy);
      objects.push({ kind: 'mineralrock', x, y, requiredTier,
        id: `${baseId}_mr_${plotTag}_t${requiredTier}_${dx}_${dy}` });
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
        // A bonus chest in the duplicate-grass plot at (4, 4) — see
        // PLOT_LAYOUT. Uses the 'playground' POI class so the line3v pad
        // shape gets a sample.
        if (gx === 4 && gy === 4) {
          pushChest('playground', 'Sandbox Chest', PLOT_MID, PLOT_MID);
        }
        break;
      }
      case 1: {   // FOREST — every tree variant, shrubs, nuts, wild fauna.
        for (let v = 0; v < 5; v++) {
          const dx = (v % 5);   // line them up on the top row of the plot
          pushTree(v, dx, 0);
        }
        pushWildplant('shrub', 0, 2);
        pushWildplant('shrub', 4, 2);
        pushWildplant('nut',   1, 4);
        pushWildplant('nut',   3, 4);
        // Wilderness fauna — gated by relic. Deer drops meat (needs sword /
        // bow / staff); rabbit drops pelt (no gate). Lets a tester exercise
        // both branches of the NEW_DROP table in the creature handler.
        pushCreature('deer',   2, 2, 1);
        pushCreature('rabbit', 1, 3, 1);
        break;
      }
      case 2: {   // SAND / BEACH — collectible shells (common) + a cat sunning.
        pushWildplant('shell', 0, 0);
        pushWildplant('shell', 2, 0);
        pushWildplant('shell', 4, 1);
        pushWildplant('shell', 1, 3);
        pushWildplant('shell', 3, 4);
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
      case 5: {   // RESIDENTIAL — rockfruit + three shop houses.
        pushWildplant('rockfruit', 2, 2);
        // Spread the three specialty houses to the corners of the plot.
        // Adjacent placement (1 cell apart) caused the REACH_HOUSE_M=6m
        // hitboxes to overlap, making the middle house unclickable behind
        // its neighbours — separating to (0,0)/(4,0)/(2,4) gives ≥10m
        // between any two so each gets a clean hit-zone.
        pushHouse(0, 0, 9);   // blacksmith — top-left
        pushHouse(4, 0, 6);   // market     — top-right
        pushHouse(2, 4, 8);   // trader     — bottom-centre
        break;
      }
      case 6: {   // PARK — shrubs + flowers + longgrass + cat/dog + flying fauna.
        pushWildplant('shrub', 0, 0);
        pushWildplant('shrub', 4, 0);
        pushFlora(0, 1, 1);
        pushFlora(1, 3, 1);
        pushFlora(2, 1, 3);
        pushWildplant('longgrass', 2, 4);
        pushCreature('cat', 0, 4, 1);
        pushCreature('dog', 4, 4, 1);
        // Flying fauna — bug-net relic gated. Crow drops a feather, butterfly
        // drops itself. Lets the tester verify both creature-handler branches.
        pushCreature('crow',      2, 0, 1);
        pushCreature('butterfly', 2, 2, 1);
        break;
      }
      case 9:   // SMALL HOUSE — the cluster is itself the interactable; no
        break;  // extra props.
      case 11: { // BUILDING_MED — palisade fort: pop a chest in the middle
        // so the "fort" reads as a defended cache.
        pushChest('shop', 'Sandbox Fort Cache', PLOT_MID, PLOT_MID);
        break;
      }
      case 12: { // BUILDING_LARGE — castle. A tower sprite belongs here
        // (it's the lookout at the castle wall) — not on the player's
        // spawn plot, where it had been a placeholder.
        pushTower(PLOT_MID, 0);
        pushTower(0, PLOT_MID);
        pushTower(PLOT_W - 1, PLOT_MID);
        break;
      }
      case 10: { // ROCK — solid 5×5 of plain rock cells, plus a mineral-rock
        // sample at each milestone tier (T1, T3, T5) on top of three cells.
        // Plain rock-cell taps still work for everywhere else.
        pushMineralRock(1, 0, 0);
        pushMineralRock(3, 2, 2);
        pushMineralRock(5, 4, 4);
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
      case 16:   // COMMERCIAL — mushrooms + a triangle-pad chest (school/college).
      case 17: { // INDUSTRIAL — same; rocky-family, with a cross-pad chest.
        pushWildplant('mushroom', 1, 1);
        pushWildplant('mushroom', 3, 3);
        // POI class varies by biome so each pad shape (triangle / cross)
        // gets a sample under the chest sprite.
        const poiClass = biome === 16 ? 'school' : 'hospital';
        const name = biome === 16 ? 'Sandbox School' : 'Sandbox Hospital';
        pushChest(poiClass, name, PLOT_MID, PLOT_MID);
        break;
      }
      case 22: { // ORCHARD — fruit trees (one of each species) + a chest
        // with a 'pitch' POI class (square2 pad) just so a third pad shape
        // gets exercised.
        pushFruitTree('apple',  0, 0);
        pushFruitTree('cherry', 4, 0);
        pushFruitTree('peach',  0, 4);
        pushFruitTree('banana', 4, 4);
        pushChest('pitch', 'Sandbox Orchard', PLOT_MID, PLOT_MID);
        break;
      }
      case -1: { // PLAYER spawn — small starter kit so test taps land on something.
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
