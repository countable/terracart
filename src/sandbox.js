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
      pathNames: {},
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

    // Stock the inventory with a representative test set — one stack of
    // ~5 of every sellable / consumable / placeable item in the catalog,
    // so the tester can exercise every icon, sell flow, eat flow, place
    // flow, etc. without first walking the map collecting samples.
    // Skips relics (they live in save.relics, not save.inv) and skips
    // items that have no item entry (e.g. growing-stage placeholders).
    // Always runs on sandbox load — the inv is intentionally clobbered
    // so the test set is predictable across reloads.
    stockSandboxInventory(scene);

    // Seed runtime state that lives outside the tile entry — planted crops,
    // placed scarecrows / rocks, tame released pets, shrine, extra
    // treasures. These all live in save.* arrays and scene-side Sets, so
    // we mutate the scene directly. Clobber-and-rebuild like the inv set.
    seedSandboxState(scene, gridOriginIX, gridOriginIY, centreTX, centreTY,
                     cellsPerEdge, tileEdgeM, cellM);
  }

  // Drop runtime-state interactables into the sandbox plots: a row of crops
  // at every growth stage in FARMLAND (gx=4 gy=0), a placed scarecrow next
  // to them so its 4-cell aversion ring can be seen, a placed rockfruit
  // rock in GRASS to exercise the pickaxe-on-placed cycle, a couple of
  // tame released pets near the player, a crafting shrine in the start
  // plot, and an extra treasure-X at the FOREST plot edge.
  function seedSandboxState(scene, originIX, originIY, centreTX, centreTY,
                            cellsPerEdge, tileEdgeM, cellM) {
    const save = scene.save;
    save.planted = save.planted || [];
    save.placedRocks = save.placedRocks || [];
    save.scarecrows = save.scarecrows || [];
    save.tilled = save.tilled || [];
    // Helper: world coords at the centre of an absolute cell.
    const cellCenter = (cellIX, cellIY) => ({
      x: centreTX * tileEdgeM + (cellIX + 0.5) * cellM,
      y: centreTY * tileEdgeM + (cellIY + 0.5) * cellM,
    });
    // Helper: cell coords of (dx,dy) inside the plot at PLOT_LAYOUT[gy][gx].
    const plotCell = (gx, gy, dx, dy) => ({
      cellIX: originIX + gx * PLOT_W + dx,
      cellIY: originIY + gy * PLOT_W + dy,
    });

    // ── Planted crops in FARMLAND (gx=4 gy=0) — one per growth stage. The
    //    cell must be tilled first; the renderer pulls the stage frame off
    //    each entry's `stage` field directly so we don't have to wait for
    //    real game time.
    const FARM_GX = 4, FARM_GY = 0;
    const CROPS_AT_STAGE = ['rainberry', 'pairy', 'nut', 'potato', 'rockfruit'];
    for (let stage = 0; stage < 5; stage++) {
      const { cellIX, cellIY } = plotCell(FARM_GX, FARM_GY, stage, 0);
      const key = `${cellIX}_${cellIY}`;
      if (!scene.tilledSet.has(key)) {
        scene.tilledSet.add(key);
        save.tilled.push(key);
      }
      const { x, y } = cellCenter(cellIX, cellIY);
      save.planted.push({ x, y, crop: CROPS_AT_STAGE[stage], stage, watered_t: 0 });
    }
    // Stage-4 (mature) one already watered + ready to harvest a doubled
    // yield — flips the canBoost flag the watering-can sets, so harvesting
    // it exercises the double-produce path.
    const mature = save.planted[save.planted.length - 1];
    if (mature) mature.canBoost = 2;

    // ── Placed scarecrow on the row below the crops, same FARMLAND plot.
    //    Renders as a sprite + creates an aversion ring crows/deer respect.
    {
      const { cellIX, cellIY } = plotCell(FARM_GX, FARM_GY, 2, 2);
      const { x, y } = cellCenter(cellIX, cellIY);
      save.scarecrows.push({ x, y });
    }

    // ── Rock pen around the GRASS barnyard plot (gx=0 gy=0): a full
    //    perimeter ring of placed rockfruit-rocks. wanderCreatures()
    //    skips any cell in placedRockSet, so the ring contains the herd in
    //    the 3×3 interior. The player isn't blocked by rock terrain, so
    //    they can still step in to milk / catch / pet — and pickaxing a
    //    rock opens a gate (and drops a rockfruit back to the inventory).
    {
      const addRock = (dx, dy) => {
        const { cellIX, cellIY } = plotCell(0, 0, dx, dy);
        const key = `${cellIX}_${cellIY}`;
        if (!scene.placedRockSet.has(key)) {
          scene.placedRockSet.add(key);
          save.placedRocks.push(key);
        }
      };
      for (let d = 0; d < PLOT_W; d++) {
        addRock(d, 0);            // top edge
        addRock(d, PLOT_W - 1);   // bottom edge
        addRock(0, d);            // left edge
        addRock(PLOT_W - 1, d);   // right edge
      }
    }

    // ── Two tame released pets in the PARK plot (gx=1 gy=1). Released_*
    //    creatures trigger the purr/cluck path on tap and (for cats) the
    //    5-minute follow timer. Butterflies pollinate nearby crops.
    const PARK_GX = 1, PARK_GY = 1;
    const parkEntry = WorldGen.tileCache.get(`${WorldGen.Z}/${centreTX}/${centreTY}`);
    if (parkEntry && parkEntry.creatures) {
      const petAt = (kind, dx, dy) => {
        const { cellIX, cellIY } = plotCell(PARK_GX, PARK_GY, dx, dy);
        const { x, y } = cellCenter(cellIX, cellIY);
        parkEntry.creatures.push({
          x, y, kind,
          id: `released_sandbox_${kind}_${cellIX}_${cellIY}`,
        });
      };
      petAt('cat', 1, 1);
      petAt('butterfly', 3, 3);
    }

    // ── Crafting shrine on the player spawn plot's edge — pushed straight
    //    into the centre tile's objects[]. Tapping opens the shrine UI for
    //    smelting / forging tests.
    if (parkEntry && parkEntry.objects) {
      let pgx = 0, pgy = 0;
      for (let gy = 0; gy < GRID_H; gy++) {
        for (let gx = 0; gx < GRID_W; gx++) {
          if (PLOT_LAYOUT[gy][gx] === -1) { pgx = gx; pgy = gy; }
        }
      }
      const { cellIX, cellIY } = plotCell(pgx, pgy, 0, 0);
      const { x, y } = cellCenter(cellIX, cellIY);
      parkEntry.objects.push({
        kind: 'shrine', x, y,
        id: `sandbox_shrine_${cellIX}_${cellIY}`,
      });
    }

    // ── Coin drops (kind:'coindrop') in the PLAYER plot so the coin-pickup
    //    tap path (interact.js 'coindrop' handler) is exercisable. In the
    //    real game these spawn in an ATM / bike-parking burst and expire
    //    after 60s; here we omit expiresAt so they persist across reloads
    //    for testing. They live in entry.coinDrops, not objects[].
    if (parkEntry) {
      parkEntry.coinDrops = parkEntry.coinDrops || [];
      let pgx = 0, pgy = 0;
      for (let gy = 0; gy < GRID_H; gy++) {
        for (let gx = 0; gx < GRID_W; gx++) {
          if (PLOT_LAYOUT[gy][gx] === -1) { pgx = gx; pgy = gy; }
        }
      }
      const coinAt = (dx, dy) => {
        const { cellIX, cellIY } = plotCell(pgx, pgy, dx, dy);
        const { x, y } = cellCenter(cellIX, cellIY);
        parkEntry.coinDrops.push({ kind: 'coindrop', x, y,
          id: `sandbox_coin_${cellIX}_${cellIY}` });
      };
      // North of spawn (the player stands at plot-centre 2,2): one in reach
      // (2,1) and two a step away (1,0)/(3,0) so they read as a little burst.
      coinAt(2, 1); coinAt(1, 0); coinAt(3, 0);
    }

    // ── An extra treasure-X south-west of spawn, two cells away — within
    //    reach if you take one step but visible at spawn. Each tile entry
    //    only holds ONE `treasure` slot so we hang this one on the SW
    //    neighbour tile rather than overwriting the in-reach one already
    //    placed north of spawn.
    const swKey = `${WorldGen.Z}/${centreTX - 1}/${centreTY + 1}`;
    const swEntry = WorldGen.tileCache.get(swKey);
    if (swEntry && !swEntry.treasure) {
      // Place it at the SW tile's NE corner so it sits at the seam with
      // the centre tile — visually right next to the sandbox grid.
      const cellIX = cellsPerEdge - 2, cellIY = 1;
      swEntry.treasure = {
        id: `sandbox_treasure_sw_${centreTX - 1}_${centreTY + 1}`,
        x: (centreTX - 1) * tileEdgeM + (cellIX + 0.5) * cellM,
        y: (centreTY + 1) * tileEdgeM + (cellIY + 0.5) * cellM,
      };
    }

    if (typeof scene.persistSave === 'function') scene.persistSave();
  }

  function stockSandboxInventory(scene) {
    if (typeof ITEMS === 'undefined') return;
    const COUNT = 5;
    const inv = [];
    // Order items so the most-tested first (seeds, then produce, then
    // animals, then minerals, then consumables) — pagination shows the
    // earlier slots first and the player can scroll for the rest.
    const ORDER = ['seed', 'produce', 'animal', 'mineral', 'consumable'];
    const byKind = {};
    for (const it of ITEMS) {
      if (!it || !it.id || !it.kind) continue;
      (byKind[it.kind] = byKind[it.kind] || []).push(it.id);
    }
    for (const kind of ORDER) {
      const list = byKind[kind] || [];
      for (const id of list) inv.push({ id, count: COUNT });
    }
    // Any kind not in ORDER (future-proofing) appended at the end.
    for (const kind of Object.keys(byKind)) {
      if (ORDER.includes(kind)) continue;
      for (const id of byKind[kind]) inv.push({ id, count: COUNT });
    }
    scene.save.inv = inv;
    scene.save.selSlot = 0;
    if (typeof scene.buildInventoryDOM === 'function') scene.buildInventoryDOM();
    if (typeof scene.persistSave === 'function') scene.persistSave();
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
    23: 'PIER',
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
        // PIER (terrain 23) — there's no spare plot in PLOT_LAYOUT for it, so
        // lay a 1-cell-wide plank walkway across the WATER plot's middle row.
        // Pier cells are walkable (the player isn't blocked the way water/9/11/
        // 12 are) while the surrounding water stays solid, so you can stride
        // out over the water on the planks. The row connects to the walkable
        // SAND plot on the left and FARMLAND on the right — a beach pier. This
        // exercises the pier overlay render path (render.js PIER_FRAME).
        if (biome === 3) {
          const midDy = Math.floor(PLOT_W / 2);
          for (let dx = 0; dx < PLOT_W; dx++) {
            const ix = ix0 + dx, iy = iy0 + midDy;
            if (ix < 0 || iy < 0 || ix >= cellsPerEdge || iy >= cellsPerEdge) continue;
            grid[iy * cellsPerEdge + ix] = 23;   // PIER
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
    const pushTree = (variant, dx, dy, species) => {
      const { x, y } = at(dx, dy);
      const o = { kind: 'tree', x, y, variant,
        id: `${baseId}_tree_${plotTag}_${species || variant}_${dx}_${dy}` };
      // Non-maple species render their own full canopy+trunk sheet (the
      // render tree spec ignores `variant` for them, always frame 3).
      if (species) o.species = species;
      objects.push(o);
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
    const pushWood = (dx, dy, qty = 2) => {
      const { x, y } = at(dx, dy);
      objects.push({ kind: 'groundstack', itemId: 'wood', qty, x, y,
        id: `${baseId}_wood_${plotTag}_${dx}_${dy}` });
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
      case 0: {   // GRASS — the (0,0) plot is a rock-penned barnyard; the
        // duplicate grass plot at (4,4) carries the flowers / longgrass /
        // wood / bonus chest.
        if (gx === 0 && gy === 0) {
          // Herd lives in the 3×3 interior. seedSandboxState() rings the
          // plot's perimeter with placed rocks; wanderCreatures() skips
          // placedRockSet cells, so the ring physically pens the animals.
          pushCreature('chicken', 1, 1, 1);
          pushCreature('chicken', 3, 1, 2);
          pushCreature('cow',     2, 2, 1);
          pushCreature('cat',     1, 3, 1);
          pushCreature('dog',     3, 3, 1);
        } else {
          pushFlora(0, 1, 1); pushFlora(1, 3, 1);
          pushFlora(2, 1, 3); pushFlora(3, 3, 3);
          pushWildplant('longgrass', 2, 0);
          // Two ground stacks so the wood pickup interaction is exercisable
          // in the sandbox without first walking to a real-tile spawn.
          pushWood(1, 0, 2);
          pushWood(3, 0, 3);
          pushWildplant('longgrass', 2, 4);
          // A bonus chest in the duplicate-grass plot at (4, 4) — see
          // PLOT_LAYOUT. Uses the 'playground' POI class so the line3v pad
          // shape gets a sample.
          if (gx === 4 && gy === 4) {
            pushChest('playground', 'Sandbox Chest', PLOT_MID, PLOT_MID);
          }
        }
        break;
      }
      case 1: {   // FOREST — every tree variant + species, shrubs, nuts, wild fauna.
        for (let v = 0; v < 5; v++) {
          const dx = (v % 5);   // line up maple growth stages on the top row
          pushTree(v, dx, 0);
        }
        // The three non-maple species, one per cell on row 1, so all four
        // tree sheets (maple stages above + pine/birch/mahogany) render in
        // the sandbox. Spaced 2 cells apart to stay clear of the shrubs
        // on row 2 and keep one interactable per cell.
        pushTree(2, 0, 1, 'pine');
        pushTree(2, 2, 1, 'birch');
        pushTree(2, 4, 1, 'mahogany');
        pushWildplant('shrub', 0, 2);
        pushWildplant('shrub', 4, 2);
        pushWildplant('nut',   1, 4);
        pushWildplant('nut',   3, 4);
        // Wilderness fauna — gated by relic. Deer drops meat (needs sword /
        // bow / staff); rabbit drops pelt (no gate). Lets a tester exercise
        // both branches of the NEW_DROP table in the creature handler.
        // Two rabbits at opposite corners so at least one is visible when
        // the tree row above shadows the centre — single rabbit at the
        // original (1, 3) was hard to find among the trees + deer.
        pushCreature('deer',   2, 2, 1);
        pushCreature('rabbit', 0, 3, 1);
        pushCreature('rabbit', 4, 3, 2);
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
      case 4: {   // FARMLAND — chickens + cows + a farm-class chest in the
        // middle (square3 pad, T3 chest).
        pushCreature('chicken', 0, 0, 1);
        pushCreature('chicken', 4, 0, 2);
        pushCreature('cow',     0, 4, 1);
        pushCreature('cow',     4, 4, 2);
        pushChest('farm', 'Sandbox Farm', PLOT_MID, PLOT_MID);
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
      case 6: {   // PARK — shrubs + flowers + longgrass + cat/dog + flying
        // fauna + a park-class chest (square3 pad, T2 chest).
        pushWildplant('shrub', 0, 0);
        pushWildplant('shrub', 4, 0);
        pushFlora(0, 1, 1);
        pushFlora(1, 3, 1);
        pushFlora(2, 1, 3);
        pushWildplant('longgrass', 0, 2);
        pushCreature('cat', 0, 4, 1);
        pushCreature('dog', 4, 4, 1);
        // Flying fauna — bug-net relic gated. Crow drops a feather, butterfly
        // drops itself. Lets the tester verify both creature-handler branches.
        pushCreature('crow',      2, 0, 1);
        pushCreature('butterfly', 4, 2, 1);
        pushChest('park', 'Sandbox Park', PLOT_MID, PLOT_MID);
        break;
      }
      case 9: {  // SMALL HOUSE — the cluster terrain is the interactable, but
        // drop a lowtier bus-stop chest too (no pad — bare wooden box) so
        // the no-pad render path gets a sample.
        pushChest('bus', 'Sandbox Bus Stop', PLOT_MID, PLOT_MID);
        break;
      }
      case 11: { // BUILDING_MED — palisade fort: pop a chest in the middle
        // so the "fort" reads as a defended cache.
        pushChest('shop', 'Sandbox Fort Cache', PLOT_MID, PLOT_MID);
        break;
      }
      case 12: { // BUILDING_LARGE — castle. Towers ARE the castle-shop
        // interactable (per app.js: house.tier===12 || kind==='tower' →
        // castle-class relic shop with unlimited stock + re-roll). No
        // chest needed — the towers cover the POI's testable surface.
        pushTower(PLOT_MID, 0);
        pushTower(0, PLOT_MID);
        pushTower(PLOT_W - 1, PLOT_MID);
        break;
      }
      case 10: { // ROCK — solid 5×5 of plain rock cells, plus a mineral-rock
        // sample at EVERY tier T1..T7 so the pickaxe gating ladder can be
        // exercised end-to-end. Cells laid out two rows on top + one on each
        // side so plain-rock taps still work in the gaps.
        pushMineralRock(1, 0, 0);
        pushMineralRock(2, 2, 0);
        pushMineralRock(3, 4, 0);
        pushMineralRock(4, 0, 2);
        pushMineralRock(5, 4, 2);
        pushMineralRock(6, 0, 4);
        pushMineralRock(7, 4, 4);
        break;
      }
      case 15: { // SCHOOL — grassland + a school chest (triangle pad, T3).
        pushFlora(0, 1, 1); pushFlora(1, 3, 1);
        pushWildplant('longgrass', 0, 0);
        pushWildplant('longgrass', 4, 4);
        pushChest('school', 'Sandbox School', PLOT_MID, PLOT_MID);
        break;
      }
      case 18: { // PLAYGROUND — grassland + a playground chest (line3v pad).
        pushFlora(0, 1, 1); pushFlora(1, 3, 1);
        pushWildplant('longgrass', 0, 0);
        pushWildplant('longgrass', 4, 4);
        pushChest('playground', 'Sandbox Playground', PLOT_MID, PLOT_MID);
        break;
      }
      case 19: { // PITCH — grassland + a pitch chest (square2 pad).
        pushFlora(2, 1, 1); pushFlora(2, 3, 1);
        pushWildplant('longgrass', 0, 0);
        pushWildplant('longgrass', 4, 4);
        pushChest('pitch', 'Sandbox Pitch', PLOT_MID, PLOT_MID);
        break;
      }
      case 20:   // WETLAND
      case 21: { // GOLF — both grassland-family with no POI chest in the
        // real game; just flowers + longgrass to differentiate.
        pushFlora(0, 1, 1);
        pushFlora(1, 3, 1);
        pushFlora(2, 2, 3);
        if (biome !== 20) {   // wetland doesn't grow longgrass
          pushWildplant('longgrass', 2, 0);
          pushWildplant('longgrass', 2, 4);
        }
        break;
      }
      case 16: { // COMMERCIAL — mushrooms + a generic 'shop' chest (line3h pad).
        pushWildplant('mushroom', 1, 1);
        pushWildplant('mushroom', 3, 3);
        pushChest('shop', 'Sandbox Commerce', PLOT_MID, PLOT_MID);
        break;
      }
      case 17: { // INDUSTRIAL — mushrooms + a hospital chest (cross pad, T3).
        // Real-game industrial isn't a chest biome; we co-locate a hospital
        // here so the cross pad shape has a sample without inventing a
        // dedicated HEALTH plot in PLOT_LAYOUT.
        pushWildplant('mushroom', 1, 1);
        pushWildplant('mushroom', 3, 3);
        pushChest('hospital', 'Sandbox Hospital', PLOT_MID, PLOT_MID);
        break;
      }
      case 22: { // ORCHARD — fruit trees (one of EACH species: apple, cherry,
        // peach, banana, orange, mango, coconut, apricot) + a chest with a
        // 'pitch' POI class (square2 pad) so a third pad shape gets a sample.
        pushFruitTree('apple',   0, 0);
        pushFruitTree('orange',  2, 0);
        pushFruitTree('cherry',  4, 0);
        pushFruitTree('mango',   0, 2);
        pushFruitTree('coconut', 4, 2);
        pushFruitTree('peach',   0, 4);
        pushFruitTree('apricot', 2, 4);
        pushFruitTree('banana',  4, 4);
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
