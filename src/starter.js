// Starter-area setup — the handful of things a NEW save finds laid out around
// its first spawn: the trail of crates and its stash, the starter relic chest,
// the tilled plot, the pond, the starter home and its greeter, and the pest
// amnesty that keeps slimes and crows off a player who has not harvested yet.
//
// Moved verbatim out of app.js's MapScene (each function was a `_method` there;
// `this` became the `scene` argument). The scene keeps a one-line wrapper per
// method with the same name, and these functions call each other THROUGH the
// scene (scene._paintPond(...)), so a test stub or a wrapper can stand in for
// any one of them.
//
// What this module is NOT: a pure core. It reads and writes the scene (save,
// tileEdgeM, cellM, depth, startWorldM, tile entries) exactly as the methods
// did, and its constants (STARTER_STASH, POND_*, PEST_FREE_CELLS,
// HOME_GREETER_*, STARTER_RELIC_*) stay top-level in app.js. The invariants it
// sits on are CLAUDE.md's: the placed bucket of the save (starterCratesAt,
// starterPlotAt, starterPondAt, starterHome), nothing spawning on a road or on
// top of anything (roadMask + occupied), and a rebuilt tile re-running the
// spawn pass (entry._spawned) — read those before changing a placer.

(function (root) {
  'use strict';

  // Fixed supply-crate payloads, shared with the item catalogue.
  const STARTER_LOOT = [
    { id: 'potato_seed',    qty: 9 },
    { id: 'rubble_seed', qty: 9 },
    { id: 'rubble',      qty: 9 },
    { id: 'wood',           qty: 9 },
  ];


  // Resolve — and freeze — the world-metre anchor of the starter crate
  // trail (save.starterCratesAt).
  //
  // Healthy saves anchor at the projection origin: either the captured home
  // (save.home — the player's first GPS fix) or, for sessions that will play
  // out at the default origin anyway (no geolocation at all), the default
  // home. But a save whose home capture failed — the old 20 s GPS timeout,
  // a denied prompt, a failed write — keeps the DEFAULT origin while the
  // player actually plays somewhere else entirely; keying the crates off
  // startWorldM then dropped them on a tile that never even loads ("my
  // starting crates are not showing up"), even though Home itself anchors
  // on the player's real position. For those saves the anchor resolves
  // later, off the same Home adoption point (_setStarterCratesAt calls in
  // ensureStarterShopId / startGps), and retro-places onto the loaded tile.
  function starterTrailAnchor(scene) {
    const sv = scene.save;
    if (sv.starterCratesAt && Number.isFinite(sv.starterCratesAt.x)) return sv.starterCratesAt;
    if (scene._sandboxMode) return null;     // sandbox curates its own loot
    // Origin is trustworthy: a captured home, or a save that hasn't anchored
    // anything anywhere else and isn't waiting on a capture reload.
    if (_saveHome || (!scene._homeCapturePending && !sv.starterShopId)) {
      sv.starterCratesAt = { x: scene.startWorldM.x, y: scene.startWorldM.y };
      if (typeof persistSave === 'function') persistSave(sv);
      return sv.starterCratesAt;
    }
    return null;  // unresolved — frozen on home-capture reload or Home adoption
  }

  // The pest (slime + crow) amnesty around home, in cells of the tile being
  // built — or null when it has lapsed (or there is no anchor to measure from
  // yet). See PEST_FREE_CELLS. The centre is returned in TILE-LOCAL cells and
  // is free to be negative or past the tile's edge: a tile a few hundred
  // metres away simply never has a cell inside the box, which is what makes
  // the amnesty work across tile seams without a special case.
  //
  // It ends at the FIRST HARVEST, not on a clock: bringing in a crop is the
  // ladder's proof the player has the loop (and the produce to fight with),
  // where a timer just measured how long the tab sat closed.
  function pestFreeZone(scene, tx, ty) {
    const sv = scene.save;
    if (!sv || sv.hasHarvested) return null;   // first crop is in: the map is itself again
    // Hard mode never had the grace: the pests are in the yard from minute one.
    if (typeof Difficulty !== 'undefined' && !Difficulty.get().pestAmnesty) return null;
    // The frozen trail anchor is where the player actually started; startWorldM
    // is the projection origin, which is the same thing until a save's home
    // capture puts them somewhere else (see _starterTrailAnchor).
    const a = (sv.starterCratesAt && Number.isFinite(sv.starterCratesAt.x))
      ? sv.starterCratesAt : scene.startWorldM;
    if (!a || !Number.isFinite(a.x)) return null;
    // In THIS tile's cells (its row's grid), which is what the spawner asks in.
    const cellM = rowCellM(scene, ty);
    const cx = Math.floor((a.x - tx * scene.tileEdgeM) / cellM);
    const cy = Math.floor((a.y - ty * scene.tileEdgeM) / cellM);
    // `has` travels with the zone so the spawner and the tests ask the same
    // question of the same object — the containment rule can't be restated
    // (and mis-stated) at the call site.
    return {
      cx, cy, r: PEST_FREE_CELLS,
      has: (ix, iy) => Math.max(Math.abs(ix - cx), Math.abs(iy - cy)) <= PEST_FREE_CELLS,
    };
  }

  // Freeze the starter-trail anchor (idempotent — a save keeps its first
  // anchor forever) and retro-place the trail when the anchor's tile has
  // already spawned; tiles loading later place it in spawnInTile.
  function setStarterCratesAt(scene, x, y) {
    const sv = scene.save;
    if (scene._sandboxMode) return;
    if (sv.starterCratesAt && Number.isFinite(sv.starterCratesAt.x)) return;
    sv.starterCratesAt = { x, y };
    if (typeof persistSave === 'function') persistSave(sv);
    if ((scene.depth || 0) !== 0) return;     // tileCache is repointed underground
    const home = scene._starterTileEntry();
    if (home) {
      scene._placeStarterTrail(home.entry, home.tx, home.ty);
      scene._stripStarterCrates(home.entry);                       // hard mode: no supply handout
      scene._placeHomeGreeter(home.entry, home.tx, home.ty);       // the mode's doorstep creature
      scene._placeSafeAreaWarden(home.entry, home.tx, home.ty);    // the safe area's warden
    }
    // The pond's band reaches into the neighbours, which may have spawned
    // before there was an anchor to measure it from — run the pass over
    // everything already in the cache.
    scene._carveStarterPondAround();
  }

  // Starter crate trail + tutorial-pocket clearing around the frozen anchor
  // (save.starterCratesAt). Four starter chests, one stack of 9 each, in the
  // order the ladder wants them (see STARTER_LOOT): potato seeds then rockfruit
  // seeds (the player's first crops — the inventory starts empty), then
  // rockfruit (the "Rock" stone — restoring themed shops) and wood (restoring
  // plain houses + unsealing forts). Per-chest counts stay within the
  // no-bag stack cap (9) so nothing overflows. These are real kind:'chest'
  // objects carrying a `fixedLoot` payload, so they open through the
  // standard chest path (the ceremony modal + one-time save.opened) instead
  // of the rarity picker. (No free scarecrow — Home crafts one for wood,
  // HOME_RECIPES.)
  //
  // The crates are a TRAIL, and where they lie depends on the ground:
  //
  //   1. A road or path passing VERY NEAR the anchor (within NEAR_ROAD_CELLS)
  //      wins. The whole trail moves onto the kerb: the crates seat down the
  //      road's shoulder walking outward — the chip says "supply crates were
  //      left along the road nearby", and when there is a road nearby the
  //      trail keeps its word — and the relic chest seats on the shoulder at
  //      the END of that line, about a screen out, so the line of crates
  //      still leads somewhere. The gold arrow walks the player crate to
  //      crate and hands them the chest last either way.
  //   2. Otherwise they are laid along the walked route from the anchor to
  //      that chest, evenly spaced, so each is in view from the one before
  //      and the last puts the chest in view.
  //   3. A road too far away to prefer still catches the crates when no chest
  //      could be seated at all (the kerb walk below); a tight ring round the
  //      anchor is the last resort.
  //
  // Runs from spawnInTile when the tile holding the anchor rasterizes, and
  // from _setStarterCratesAt when the anchor resolves after the tile already
  // spawned.
  function placeStarterTrail(scene, entry, tx, ty) {
    const anchor = scene.save.starterCratesAt || scene._starterTrailAnchor();
    if (!anchor || entry._starterTrail) return;
    entry._starterTrail = true;             // once per build (rebuilds re-run)
    entry.objects = entry.objects || [];
    // THIS tile's cells (its row's grid): the tile frame.
    const f = WorldGen.tileFrame(entry, tx, ty, scene.tileEdgeM);
    const { N } = f;
    // The ground: a WAY (a road of any tier or a path — the trail follows
    // it, nothing stands on it) and SOLID ground (water, a building).
    const isWay = (t) => WorldGen.isCobbleTerrain(t);
    const isSolid = (t) => t === WorldGen.T.WATER || WorldGen.isBuildingTerrain(t);
    const { ix: spawnIX, iy: spawnIY } = f.cellOf(anchor.x, anchor.y);
    // Forensics for the ☰ Dump-tile readout (dumpTileDebug): which mode this
    // pass took and why, one compact line recorded as it runs. The trail has
    // three fallbacks, so "the crates aren't where the objective said" is
    // unanswerable from a phone without this — costs nothing the pass wasn't
    // already computing.
    const dbg = [`anchor(${spawnIX},${spawnIY}) tile ${tx}/${ty}`];
    // Clear the immediate anchor area of natural mineralrocks and procedural
    // forest fill so the starter crates aren't visually competing with debris
    // the player can't open. Chebyshev radius, in cells, around the anchor.
    // EXCEPTION: real-world detected trees (the player's actual yard / street
    // trees — flagged `individual` or carrying a DeepForest crown_color/size)
    // are kept, so the home reads like the real neighbourhood instead of a
    // bald pocket. Only procedural debris (rocks, groundstacks) and anonymous
    // forest-grove trees get cleared near the anchor.
    //
    // ONE number with HomeArea.POCKET_CELLS, read from it rather than restated
    // here: the pocket this pass CLEARS and the pocket the starter-home audit
    // calls clean have to be the same ring. When they drifted (this was a flat
    // 10 while the ring started at 11), the cleared ground reached two screens
    // out — a whole screen further than the player can see — so the ring of
    // trees seated just past it was never once in frame. See home.js.
    const CLEAR_R = HomeArea.POCKET_CELLS;
    const STRIP_KINDS = new Set(['mineralrock', 'tree', 'fruittree', 'groundstack']);
    const _isRealTree = (o) =>
      isTreeLike(o.kind) &&
      (o.individual || o.crown_color || o.size);
    const _nearSpawn = (wx, wy) => {
      const c = f.cellOf(wx, wy);
      return Math.max(Math.abs(c.ix - spawnIX), Math.abs(c.iy - spawnIY)) <= CLEAR_R;
    };
    entry.objects = entry.objects.filter(o =>
      _isRealTree(o) || !STRIP_KINDS.has(o.kind) || !_nearSpawn(o.x, o.y));
    // Wild rockfruit / debris (entry.wildplants) is its own stream — clear
    // any within the tutorial pocket too so spawn is free of pickable scrub.
    if (Array.isArray(entry.wildplants)) {
      entry.wildplants = entry.wildplants.filter(w => !_nearSpawn(w.x, w.y));
    }
    // Cells with something standing on them — a crate seated on top of a tree
    // reads as a bug whichever one the renderer draws second. Handed to THE
    // SPAWN GATE (WorldGen.isSpawnCell, a 'minor' spawn — a crate is scenery,
    // same as the relic chest below) through the entry's full spawn options
    // (WorldGen.spawnOptsOf: the tile's masks, kerb class, quiet land and POI
    // frontage — the same gate everything else on the tile is judged by),
    // with this pass's own LIVE occupancy in place of the generated one (the
    // pocket was just cleared). Not a bare entry.roadMask read: "which cells
    // are the road" has to mean the ground the player SEES as road (the drawn
    // band), and the gate catches the reasons the relic chest already avoids
    // (a churchyard corner, a yard behind a house). Undefined masks on a tile
    // built before they existed fall back to isSpawnCell's no-mask reading.
    const occupied = WorldGen.occupiedIndexSet(f, entry.objects, entry.wildplants);
    const spawnOpts = WorldGen.spawnOptsOf(entry, { occupied });
    const onRoadBand = (cx, cy) =>
      !WorldGen.isSpawnCell(entry.grid, N, N, cx, cy, spawnOpts, 'minor');
    // BFS from the anchor cell for the nearest road cell within 15 cells.
    let roadCell = null;
    const visited = new Set();
    const queue = [[spawnIX, spawnIY]];
    visited.add(spawnIX + ',' + spawnIY);
    while (queue.length > 0 && !roadCell) {
      const [cx, cy] = queue.shift();
      if (cx < 0 || cx >= N || cy < 0 || cy >= N) continue;
      const dist = Math.max(Math.abs(cx - spawnIX), Math.abs(cy - spawnIY));
      if (dist > 15) continue;
      const t = entry.grid[cy * N + cx];
      if (isWay(t)) { roadCell = { cx, cy }; break; }
      for (const [ddx, ddy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const k = (cx + ddx) + ',' + (cy + ddy);
        if (!visited.has(k)) { visited.add(k); queue.push([cx + ddx, cy + ddy]); }
      }
    }
    dbg.push(roadCell
      ? `road@(${roadCell.cx},${roadCell.cy}) d=${Math.max(Math.abs(roadCell.cx - spawnIX), Math.abs(roadCell.cy - spawnIY))} t=${entry.grid[roadCell.cy * N + roadCell.cx]}`
      : 'no road/path within 15');
    // Loot in the order the crates are seated — nearest the door first — which
    // is deliberately the LADDER's order of need, not the tidiest reading of
    // the list. STARTER_CHAIN goes open a crate → till → SOW A SEED → rebuild a
    // wreck, so the first crate has to be the one holding a seed. Wood (5 per plain house, and what
    // unseals a fort) rides at the far end instead, arriving about when step 4
    // asks for it — and the green arrow, which always points at the nearest
    // unopened crate, now agrees with the chip instead of contradicting it.
    const COUNT = STARTER_LOOT.length;
    const usedSeats = new Set();          // 'cx,cy' of cells already holding a chest
    const placedIdx = new Set();          // loot indices successfully seated
    const MIN_GAP = 3;                    // Chebyshev spacing between consecutive chests
    // The Home trailer covers its own cell and spills into all eight
    // neighbours, and clearHomeTrailerOverlap() deletes whatever sits in them.
    // A crate seated there would be swept away with its starter loot, so the
    // trail skips the moat rather than losing a chest to it. (The ring
    // fallback below already starts 2 cells out.)
    const inTrailerMoat = (cx, cy) =>
      Math.max(Math.abs(cx - spawnIX), Math.abs(cy - spawnIY)) <= 1;
    const seatCrate = (cx, cy, i) => {
      // Snap to the canonical global-cell centre. The tile-relative basis
      // (tx*tileEdgeM + (cx+0.5)*cellM) drifts off the absolute cell grid
      // because tileEdgeM is not an exact multiple of cellM, leaving the
      // chest ~0.8 m off the centre cellAt() resolves it to. Round-tripping
      // through worldMetersToAbsCell → absCellCenterMeters (the same basis
      // POI chests and every cell tap use) keeps the chest exactly on-grid.
      const raw = f.centre(cx, cy);
      const { cellIX, cellIY } = worldMetersToAbsCell(scene, raw.x, raw.y);
      const { x: wmx, y: wmy } = absCellCenterMeters(scene, cellIX, cellIY);
      // A real chest with hardcoded contents — opens via the standard chest
      // handler (interact.js), which reads o.fixedLoot and shows the same
      // reward modal as POI chests. `crate: true` renders the humble lowtier
      // crate (box) sprite instead of the tier-2 treasure chest, matching
      // their role as starter supplies. No poiClass → no POI label.
      entry.objects.push(WorldGen.makeObject('chest', wmx, wmy,
        `chest_start_${tx}_${ty}_${i + 1}`,
        { fixedLoot: STARTER_LOOT[i], crate: true }));
      usedSeats.add(cx + ',' + cy);
      placedIdx.add(i);
    };
    // ── The trail proper: breadcrumbs that lead somewhere ──────────────────
    // The relic chest goes down first, because it is the DESTINATION. It sits
    // one screen out (see _placeStarterRelicChest), which is precisely far
    // enough to be off the opening screen — so a player who is only told "look
    // around" never learns it is there. The crates are then laid along the
    // walk to it, evenly spaced: walk to the crate you can see, and from there
    // the next one is in view, and the last one puts the chest in view. That
    // is the whole onboarding read — a trail with something at the end of it,
    // rather than four boxes scattered down whichever street happened to be
    // nearest. On a kerb spawn (mode 1) the walk IS the road: the crates seat
    // down its shoulder and the chest ends the line, on the kerb like them.
    //
    // How much of the walk the crates occupy. They sit in the NEAR part of
    // it rather than spread the whole way: a new player should meet all four
    // early, while they are still learning what a crate even is, and then
    // have a clear stretch of walking left to the chest at the end. Spread
    // evenly over the whole route the last crate landed a step or two short
    // of the chest, which made the supplies feel like something to hike for.
    const TRAIL_SPAN = 0.55;
    const TRAIL_GAP = 1;            // Chebyshev spacing between crates on the route
    // Where a crate (or the kerb chest) may stand — the street, the trailer
    // moat and occupied cells are all out, and dropping one over them would
    // break the chain the player is following.
    const seatOK = (cx, cy) => {
      if (!f.inTile(cx, cy)) return false;
      const t = entry.grid[cy * N + cx];
      if (isWay(t) || isSolid(t)) return false;
      if (onRoadBand(cx, cy)) return false;             // (the gate reads `occupied` too)
      if (usedSeats.has(cx + ',' + cy)) return false;
      return !inTrailerMoat(cx, cy);
    };
    // A road or path within NEAR_ROAD_CELLS of the anchor takes the trail
    // (mode 1 above). roadCell came back nearest-first from the BFS, so its
    // distance IS the road's distance.
    const roadNear = !!roadCell &&
      Math.max(Math.abs(roadCell.cx - spawnIX), Math.abs(roadCell.cy - spawnIY)) <= NEAR_ROAD_CELLS;
    // The kerb line: walk the road outward from the cell nearest the door
    // until it is about a screen from the anchor, and note the shoulder there
    // — that is where the chest goes, so the line of crates ends at it. BFS
    // over connected road cells, so a bending or branching street is followed
    // by its shape; the first cell reached a screen out picks the direction
    // the road actually goes somewhere. A road that ends short still ends the
    // line with the chest, as long as it at least clears the tidy pocket —
    // shorter than that and there is no line worth ending (kerbPath stays
    // null and the route spread below takes over).
    let kerbPath = null, chestWant = null;
    if (roadNear) {
      const shoulderFor = (cx, cy) => {
        for (const [adx, ady] of [[0, -1], [0, 1], [1, 0], [-1, 0]]) {
          if (seatOK(cx + adx, cy + ady)) return { cx: cx + adx, cy: cy + ady };
        }
        return null;
      };
      const from = new Map([[roadCell.cx + ',' + roadCell.cy, null]]);
      const rq = [[roadCell.cx, roadCell.cy]];
      let target = null, far = null, farSh = null, farD = -1;
      for (let head = 0; head < rq.length && head < 600 && !target; head++) {
        const [cx, cy] = rq[head];
        const d = Math.max(Math.abs(cx - spawnIX), Math.abs(cy - spawnIY));
        const sh = shoulderFor(cx, cy);
        if (sh && d > farD) { farD = d; far = [cx, cy]; farSh = sh; }
        if (sh && d >= VIEW_CELLS) { target = [cx, cy]; chestWant = sh; break; }
        for (const [ddx, ddy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + ddx, ny = cy + ddy;
          if (nx < 0 || nx >= N || ny < 0 || ny >= N) continue;
          const k = nx + ',' + ny;
          if (from.has(k)) continue;
          if (!isWay(entry.grid[ny * N + nx])) continue;
          from.set(k, [cx, cy]);
          rq.push([nx, ny]);
        }
      }
      if (!target && far && farD >= HomeArea.POCKET_CELLS) {
        target = far; chestWant = farSh;
      }
      if (target) {
        kerbPath = [];
        for (let at = target; at; at = from.get(at[0] + ',' + at[1])) {
          kerbPath.push({ cx: at[0], cy: at[1] });
        }
        kerbPath.reverse();          // nearest the door first, the chest end last
      }
    }
    dbg.push(`roadNear=${roadNear} kerb=${kerbPath ? kerbPath.length : 0}`
      + ` chestWant=${chestWant ? chestWant.cx + ',' + chestWant.cy : 'none'}`);
    const trail = scene._placeStarterRelicChest(entry, tx, ty, spawnIX, spawnIY, usedSeats, chestWant);
    const trailPath = trail && trail.path;
    dbg.push(trail ? `chest ok route=${trailPath ? trailPath.length : 0}` : 'CHEST NOT SEATED');
    // Seat the COUNT crates along `path` (anchor end first), evenly spaced
    // across its near TRAIL_SPAN — so on a typical route the four sit at
    // roughly 2, 3, 5 and 6 cells out with the chest at 11, and no leg is long
    // enough to lose the thread. Distance is measured ALONG the path, not
    // across it: a route that bends round a pond still spaces its crates by
    // how far the player actually walks. Each crate tries the cells at
    // `offsets` from its path cell, in order, and slides up to three steps
    // along the path either way when none of them will take it.
    const seatAlong = (path, offsets) => {
      const L = path.length - 1;         // steps from the anchor to the far end
      let lastSeat = null;
      for (let i = 0; i < COUNT; i++) {
        const want = Math.round((TRAIL_SPAN * L * (i + 1)) / COUNT);
        let seat = null;
        for (let off = 0; off <= 3 && !seat; off++) {
          for (const at of (off === 0 ? [want] : [want - off, want + off])) {
            const p = path[at];
            if (!p) continue;
            for (const [adx, ady] of offsets) {
              const cx = p.cx + adx, cy = p.cy + ady;
              if (!seatOK(cx, cy)) continue;
              if (lastSeat && Math.max(Math.abs(cx - lastSeat.cx),
                                       Math.abs(cy - lastSeat.cy)) < TRAIL_GAP) continue;
              seat = { cx, cy }; break;
            }
            if (seat) break;
          }
        }
        if (!seat) continue;
        seatCrate(seat.cx, seat.cy, i);
        lastSeat = seat;
      }
    };
    if (kerbPath && kerbPath.length > 1) {
      // Mode 1: crates down the kerb. Same packing as the route spread but
      // every seat is a shoulder cell: beside the street, never in it.
      seatAlong(kerbPath, [[0, -1], [0, 1], [1, 0], [-1, 0]]);
    } else if (trailPath && trailPath.length > COUNT) {
      // Mode 2: crates along the route to the chest. A crate takes the route
      // cell itself where it legally can, and steps one cell off it where it
      // can't.
      seatAlong(trailPath, [[0, 0], [0, -1], [0, 1], [1, 0], [-1, 0]]);
    }
    // Undirected kerb walk — the last road-shaped resort: neither the kerb
    // line nor the route spread seated anything (no chest could go down, or
    // every shoulder along the line was blocked), so seat the crates on the
    // shoulders of the nearest road nearest-first, which at least reads as
    // breadcrumbs even though it leads nowhere in particular. Only when
    // NOTHING was seated above — a half-laid trail is topped up by the ring
    // below instead, which never double-seats a loot index.
    if (roadCell && placedIdx.size === 0) {
      // BFS-collect connected road cells from the nearest road cell, in
      // nearest-first order, then seat crates on walkable, non-road
      // neighbours spaced at least MIN_GAP apart. Following the road's
      // shape (rather than a fixed straight line) means crates keep
      // getting placed even when the street curves or branches.
      const roadCells = [];
      const rVisited = new Set();
      const rQueue = [[roadCell.cx, roadCell.cy]];
      rVisited.add(roadCell.cx + ',' + roadCell.cy);
      while (rQueue.length > 0 && roadCells.length < 120) {
        const [cx, cy] = rQueue.shift();
        if (cx < 0 || cx >= N || cy < 0 || cy >= N) continue;
        if (!isWay(entry.grid[cy * N + cx])) continue;
        roadCells.push([cx, cy]);
        for (const [ddx, ddy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const k = (cx + ddx) + ',' + (cy + ddy);
          if (!rVisited.has(k)) { rVisited.add(k); rQueue.push([cx + ddx, cy + ddy]); }
        }
      }
      let nextIdx = 0;
      let lastSeat = null;
      for (const [rcx, rcy] of roadCells) {
        if (nextIdx >= COUNT) break;
        let seat = null;
        for (const [adx, ady] of [[0,-1],[0,1],[1,0],[-1,0]]) {
          const nx = rcx + adx, ny = rcy + ady;
          if (nx < 0 || nx >= N || ny < 0 || ny >= N) continue;
          const tt = entry.grid[ny * N + nx];
          if (isWay(tt) || isSolid(tt)) continue;
          // The gate reads `occupied` too: the pocket keeps the player's real
          // street trees (see the CLEAR_R exception), and a crate seated on
          // one reads as a bug whichever the renderer draws second.
          if (onRoadBand(nx, ny)) continue;
          if (usedSeats.has(nx + ',' + ny)) continue;
          if (inTrailerMoat(nx, ny)) continue;
          // Enforce a minimum gap from the previous crate so the trail
          // spreads out instead of clustering on adjacent road cells.
          if (lastSeat &&
              Math.max(Math.abs(nx - lastSeat.nx), Math.abs(ny - lastSeat.ny)) < MIN_GAP) continue;
          seat = { nx, ny }; break;
        }
        if (!seat) continue;
        seatCrate(seat.nx, seat.ny, nextIdx);
        lastSeat = seat;
        nextIdx++;
      }
    }
    // Fill any crates the road couldn't host (no road found, or the road
    // ran out of walkable shoulders) in a tight ring around the anchor
    // on walkable cells. Guarantees the player always gets all four crates.
    if (placedIdx.size < COUNT) {
      const RING = [[2, 0], [-2, 0], [0, 2], [0, -2], [3, 0], [-3, 0],
                    [2, 2], [-2, -2], [2, -2], [-2, 2]];
      let ringPos = 0;
      for (let i = 0; i < COUNT; i++) {
        if (placedIdx.has(i)) continue;
        let seated = false;
        while (ringPos < RING.length && !seated) {
          const [bdx, bdy] = RING[ringPos++];
          let ncx = spawnIX + bdx, ncy = spawnIY + bdy;
          const ringOK = (x, y) => !isSolid(entry.grid[y * N + x]) && !isWay(entry.grid[y * N + x])
            && !onRoadBand(x, y) && !usedSeats.has(x + ',' + y);
          for (let step = 0; step < 5; step++) {
            if (!f.inTile(ncx, ncy) || ringOK(ncx, ncy)) break;
            ncx += Math.sign(bdx) || 0;
            ncy += Math.sign(bdy) || 0;
          }
          if (!f.inTile(ncx, ncy) || !ringOK(ncx, ncy)) continue;
          seatCrate(ncx, ncy, i);
          seated = true;
        }
      }
    }
    // Last, on the now-cleared pocket: the guaranteed patch of soil the
    // ladder's "Break ground" step needs, then the wood / rock / wreck the
    // rest of the ladder needs to have something to act on.
    dbg.push(`crates=${placedIdx.size}/${COUNT}`);
    scene._trailDebug = dbg.join(' | ');
    scene._carveStarterPlot(entry, tx, ty, spawnIX, spawnIY, usedSeats);
    scene._provisionStarterHome(entry, tx, ty, spawnIX, spawnIY, usedSeats);
    scene._scatterStarterStash(entry, tx, ty, spawnIX, spawnIY, usedSeats);
    scene._revealStarterTrail(entry, tx, ty, spawnIX, spawnIY);
  }

  // THE STARTER STASH: a few small crates scattered through the resource ring
  // around home (STARTER_STASH_R_CELLS), each holding one of STARTER_STASH —
  // four Books (the Book is otherwise a rare find outside a school), a Rope
  // and a Trap Disarm Kit. Not on the tutorial trail: the trail is the
  // ladder's path and the green arrow walks it (`chest_start_*`); these are
  // things to stumble on while gathering, so they carry their own id prefix
  // (`stash_start_*`) and the arrow never points at them.
  //   PLACED bucket, like the trail: a pure function of the frozen anchor
  // (save.starterCratesAt) through its own rng stream (seeded off the anchor
  // cell under a 'starter_stash' key — never the trail's), so a rebuild or
  // a reload seats the same crates on the same cells, and `save.opened` is
  // all that remembers one was taken. Only cells in THIS tile are used; a
  // stash crate whose seat falls off the tile edge tries another angle.
  function scatterStarterStash(scene, entry, tx, ty, spawnIX, spawnIY, usedSeats) {
    const f = WorldGen.tileFrame(entry, tx, ty, scene.tileEdgeM);   // THIS tile's cells (its row's grid)
    const { N } = f;
    // Water, a building or a way: nothing stands here.
    const isBlocked = (t) => t === WorldGen.T.WATER || WorldGen.isBuildingTerrain(t) || WorldGen.isCobbleTerrain(t);
    // THE SPAWN GATE, a 'minor' spawn (the stash crate is scenery, same as
    // the trail's), through the entry's full options with this pass's own
    // live occupancy (the crates seated so far claim into it).
    const occupied = WorldGen.occupiedIndexSet(f, entry.objects, entry.wildplants);
    const spawnOpts = WorldGen.spawnOptsOf(entry, { occupied });
    const rng = WorldGen.makeRng(fnv1a(`starter_stash:${tx}:${ty}:${spawnIX}:${spawnIY}`));
    const [R0, R1] = STARTER_STASH_R_CELLS;
    const n = STARTER_STASH.length;
    for (let i = 0; i < n; i++) {
      // Spread round the compass (one sector each) with a jittered radius, so
      // they are sprinkled rather than bunched on one side.
      for (let attempt = 0; attempt < 24; attempt++) {
        const ang = ((i + rng()) / n) * Math.PI * 2 + attempt * 0.7;
        const r = R0 + rng() * (R1 - R0);
        const cx = spawnIX + Math.round(Math.cos(ang) * r);
        const cy = spawnIY + Math.round(Math.sin(ang) * r);
        if (!f.inTile(cx, cy)) continue;
        if (isBlocked(entry.grid[cy * N + cx])) continue;
        if (usedSeats.has(cx + ',' + cy)) continue;
        if (!WorldGen.isSpawnCell(entry.grid, N, N, cx, cy, spawnOpts, 'minor')) continue;
        const raw = f.centre(cx, cy);
        const { cellIX, cellIY } = worldMetersToAbsCell(scene, raw.x, raw.y);
        const { x, y } = absCellCenterMeters(scene, cellIX, cellIY);
        entry.objects.push(WorldGen.makeObject('chest', x, y,
          `stash_start_${tx}_${ty}_${i + 1}`,
          { fixedLoot: STARTER_STASH[i], crate: true }));
        occupied.add(cy * N + cx);
        break;
      }
    }
  }

  // Lift the fog off the onboarding trail the moment it is laid.
  //
  // The trail is a SIGHTLINE CHAIN, and that is the whole of its design: walk
  // to the crate you can see, and from there the next one is in view, and the
  // last one puts the relic chest in view. Fog of war reveals 3 cells around
  // the player and the trail reaches up to 15 from the anchor, so shipping the
  // two together left every crate under an 80% black wash on a brand-new save
  // — the quest said "supply crates were left along the road nearby" and the
  // road was invisible. A chain of landmarks nobody can see is not a chain.
  //
  // So the pocket the player starts in is known ground: their own block, plus
  // a disc around each thing the trail seated. Deliberately NOT a blanket
  // radius around the anchor — that would reveal map in every direction,
  // including the way the trail does not go. Following the crates is what
  // opens the map up; this only makes the crates themselves findable.
  function revealStarterTrail(scene, entry, tx, ty, spawnIX, spawnIY) {
    if (typeof Fog === 'undefined' || scene.depth !== 0) return;
    const f = WorldGen.tileFrame(entry, tx, ty, scene.tileEdgeM);   // THIS tile's cells (its row's grid)
    // Tile-local cell → the ABSOLUTE cell Fog takes (coords.js encoding —
    // never tx * N + cx by hand: the rows' grids differ).
    const abs = (cx, cy) => {
      const c = tileCellToAbs(scene, tx, ty, cx, cy);
      return { ix: c.cellIX, iy: c.cellIY };
    };
    // Home: the tutorial pocket _placeStarterTrail has just cleared and
    // curated. The player lives here; they are not discovering it.
    const home = abs(spawnIX, spawnIY);
    let changed = Fog.revealDisc(home.ix, home.iy, HOME_REVEAL_CELLS);
    // ...and each crate / the relic chest, with enough margin that the crate
    // reads as sitting on ground rather than punched out of the dark. Found by
    // id rather than threaded through the seater: `chest_start_` is already the
    // stamp the onboarding arrow (_nearestStarterCrate) keys off, so the two
    // can't disagree about what the trail consists of.
    for (const o of (entry.objects || [])) {
      if (!o.id || !String(o.id).startsWith('chest_start_')) continue;
      const c = f.cellOf(o.x, o.y);
      const a = abs(c.ix, c.iy);
      if (Fog.revealDisc(a.ix, a.iy, TRAIL_REVEAL_CELLS)) changed = true;
    }
    if (!changed) return;
    Fog.flush(scene.save);
    if (typeof persistSave === 'function') persistSave(scene.save);
  }

  // A treasure chest one screen out from the spawn anchor, holding one random
  // WOODEN (T1) relic. Returns { chest, path } — the walked route from the
  // anchor to it (anchor first, chest last, one 4-connected step per entry) is
  // what _placeStarterTrail lays the crate breadcrumbs along — or null when
  // there is nowhere legal to put it.
  //
  // The supply crates hand a new player materials; nothing hands them a TOOL.
  // Every relic is otherwise bought or forged, so the opening hour is spent
  // bare-handed at 9 s a swing — a wooden one is 2.25× quicker (toolDurationMs) —
  // and which tool it is decides what that hour can even be spent on. So this
  // is a real treasure chest, not another supply crate: no `crate` flag, so it
  // renders as the trunk with its tier gem rather than a box, and it disappears
  // when opened. Its id carries the `chest_start_` stamp, so the gold onboarding
  // arrow (_nearestStarterCrate) will point the way to it like any other.
  //
  // "A screen away": the view is VIEW_CELLS across with the player in the middle
  // of it, so a chest VIEW_CELLS cells out is just past the edge of the opening
  // screen — a walk in some direction, not something already in frame — and
  // clear of the CLEAR_R tutorial pocket that gets stripped bare around the
  // anchor, and of the starter ring that begins at its edge. It takes the
  // first ring from there out with a free cell (searching to RELIC_MAX_R), so
  // a spawn hemmed in by water or buildings still gets it —
  // and only ever a cell the anchor can be WALKED to, since a chest at the end
  // of a trail is no use across a river.
  //
  // Which slot and which direction are both derived from the frozen anchor
  // through a seeded rng, never Math.random: a tile rebuild has to reproduce
  // the same chest, in the same cell, with the same relic in it — a player who
  // walked off and came back to find a different reward waiting would be
  // watching the world re-roll itself. The id is keyed off the tile (not the
  // cell) for the same reason save.opened keys off it: an opened chest must
  // stay opened even if a future rebuild ever seats it one cell over.
  function starterRoutePassable(type) {
    return WorldGen.isWalkable(type) || WorldGen.isRoadTerrain(type);
  }
  function placeStarterRelicChest(scene, entry, tx, ty, spawnIX, spawnIY, usedSeats, seatWant) {
    const grid = entry.grid;
    if (!grid || typeof WorldGen === 'undefined') return null;
    const f = WorldGen.tileFrame(entry, tx, ty, scene.tileEdgeM);   // THIS tile's cells (its row's grid)
    const { N } = f;
    entry.objects = entry.objects || [];
    const id = `chest_start_relic_${tx}_${ty}`;
    if (entry.objects.some(o => o.id === id)) return null;   // already seated
    // Ring band: one screen out, widening only as far as the starter home's
    // own ring reaches so the chest can never end up somewhere that reads as
    // "another neighbourhood" instead of "just off the opening screen".
    const RELIC_MIN_R = VIEW_CELLS;
    const RELIC_MAX_R = HomeArea.RING_MAX_CELLS;
    // Cells already spoken for — a crate seat (`taken`), or anything standing
    // on the tile (`occupied`, handed to the gate). Nothing but the chest may
    // share the cell it seats on.
    const taken = new Set(usedSeats || []);
    const occupied = WorldGen.occupiedIndexSet(f, entry.objects, entry.wildplants);
    // The shared spawn rule — walkable, off anyone's road BAND (not merely off
    // the one cell per way the grid paints), out of the back gardens. A chest
    // in the street is the bug this mask exists to stop. The entry's full
    // options (WorldGen.spawnOptsOf: masks, kerb class, quiet land, the POI
    // frontage lift), with this pass's live occupancy.
    // (THE STARTING AREA is the player's own — the placed bucket — so its
    // things are MINOR spawns: out of the land the spawn gate refuses, but
    // free of the buffers round the player's own street.)
    const spawnOpts = WorldGen.spawnOptsOf(entry, { occupied });
    const cellKey = (cx, cy) => cx + ',' + cy;
    // ── The walk there ──────────────────────────────────────────────────
    // Flood out from the anchor over ground a ROUTE may be drawn across. This
    // is not a collision test — the surface has none (_cellBlocked), the player
    // can walk anywhere — it is about what a trail may cross: stepping over a
    // street is ordinary, so roads are in; wading a river or strolling through
    // someone's living room is not, so water and buildings are out. Every cell
    // it reaches carries the step it was reached FROM, which is what turns the
    // chosen chest cell into a walked route the crate trail can be laid along
    // (see _placeStarterTrail).
    // A few cells of slack past the band, so a route that has to bend round a
    // pond or a block to reach the far side of the ring still gets found.
    const FLOOD_R = RELIC_MAX_R + 4;
    const cameFrom = new Map([[cellKey(spawnIX, spawnIY), null]]);
    const flood = [[spawnIX, spawnIY]];
    for (let head = 0; head < flood.length; head++) {
      const [cx, cy] = flood[head];
      for (const [ddx, ddy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + ddx, ny = cy + ddy;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        if (Math.max(Math.abs(nx - spawnIX), Math.abs(ny - spawnIY)) > FLOOD_R) continue;
        const k = cellKey(nx, ny);
        if (cameFrom.has(k)) continue;
        if (!starterRoutePassable(grid[ny * N + nx])) continue;
        cameFrom.set(k, [cx, cy]);
        flood.push([nx, ny]);
      }
    }
    // A cell the flood never reached is somewhere the player would have to
    // swim or trespass to get to — no trail can lead there, so it is no place
    // for the chest at the end of one.
    const free = (cx, cy) => !taken.has(cellKey(cx, cy)) &&
      cameFrom.has(cellKey(cx, cy)) &&
      WorldGen.isSpawnCell(grid, N, N, cx, cy, spawnOpts, 'minor');
    const seed =
      ((tx * 0x1f1f1f1f) ^ (ty * 0x9e3779b1) ^ (spawnIX * 73856093) ^ (spawnIY * 19349663)) >>> 0;
    const rng = WorldGen.makeRng(seed);
    // The SLOT rolls off its own stream with the per-save salt mixed in, so a
    // save RESET rerolls which relic the chest holds. The SEAT stream (rng)
    // stays purely location-keyed: the chest sits where it always sat, the
    // trail geometry doesn't move, and a tile rebuild mid-save reproduces
    // both — the salt lives in the save, so it is exactly as stable as the
    // loot needs to be and no more. Salt 0 (test stubs, pre-salt saves at
    // the moment of upgrade) degrades to the old purely-location roll.
    const slotRng = WorldGen.makeRng((seed ^ (scene.save?.relicSalt || 0)) >>> 0);
    const slot = STARTER_RELIC_SLOTS[Math.floor(slotRng() * STARTER_RELIC_SLOTS.length)];
    // Burn the draw the slot once took so later rolls off `rng` keep their seats.
    rng();
    // A caller may nominate the seat — the kerb trail (mode 1 in
    // _placeStarterTrail) wants the chest at the end of the crate line, on
    // the road's shoulder. Honoured only if it passes the same legality the
    // ring scan enforces (walkable from the anchor, the shared spawn rule,
    // unclaimed), so a bad hint falls back to the ring below rather than
    // seating the chest across a river or in the street.
    let seat = null;
    if (seatWant && free(seatWant.cx, seatWant.cy)) seat = { cx: seatWant.cx, cy: seatWant.cy };
    // Nearest ring first; within a ring, a seeded pick so the chest isn't
    // always due east of every spawn in the game. Ring cells are collected in
    // a fixed scan order, so the pick is reproducible.
    for (let r = RELIC_MIN_R; r <= RELIC_MAX_R && !seat; r++) {
      const ring = [];
      WorldGen.ringCells(spawnIX, spawnIY, r, r, (cx, cy) => { if (free(cx, cy)) ring.push({ cx, cy }); return null; });
      if (ring.length) seat = ring[Math.floor(rng() * ring.length)];
    }
    // Nothing seated: every ring cell in reach is water, road, floor or taken —
    // or, on a spawn right against a tile seam, off the edge of the only grid
    // this pass can read. A tile is ~220 cells across and the band is 16, so a
    // seam only ever costs the arcs on that side; the rest of the compass still
    // answers, which is why this stays clamped to the anchor's own tile rather
    // than reaching across seams the way _provisionStarterHome has to.
    if (!seat) return null;
    // Snap to the canonical global cell centre, the basis seatCrate and every
    // cell tap share (the tile-relative basis drifts off it — see seatCrate).
    const raw = f.centre(seat.cx, seat.cy);
    const { cellIX, cellIY } = worldMetersToAbsCell(scene, raw.x, raw.y);
    const { x: wmx, y: wmy } = absCellCenterMeters(scene, cellIX, cellIY);
    const chest = {
      kind: 'chest', x: wmx, y: wmy, id,
      // Named so it draws a label: the whole point is that the player can see
      // there is something worth the walk once it comes into view.
      name: 'Old Chest',
      // Opens through the standard chest path (interactables.js), which reads
      // fixedLoot and — for a gear payload — reconciles it against what the
      // player already owns before equipping.
      fixedLoot: { kind: 'relic', slot, tier: STARTER_RELIC_TIER },
    };
    entry.objects.push(chest);
    if (usedSeats) usedSeats.add(seat.cx + ',' + seat.cy);
    // Hand back the walk, anchor first, chest last — one 4-connected step per
    // entry. The caller lays the crate trail along it.
    const path = [];
    for (let at = [seat.cx, seat.cy]; at; at = cameFrom.get(cellKey(at[0], at[1]))) {
      path.push({ cx: at[0], cy: at[1] });
    }
    path.reverse();
    return { chest, path };
  }

  // A guaranteed 2x2 patch of tillable grass near the spawn anchor.
  //
  // STARTER_CHAIN step 2 ("Break ground") assumes there is ground to break,
  // and the gold guidance arrow pointed at a supply CRATE through every step
  // of the ladder. A player who spawns somewhere with no soil in reach — a
  // parking lot, a terraced street, a riverbank — was therefore told to till a
  // patch of grass while the only arrow on screen led to a box that isn't one.
  // This paints a plot the step can actually be performed on, and freezes its
  // position on the save so the arrow has an honest target to point at.
  //
  // 2x2 rather than a single cell: one cell to till for the step itself, and
  // three more beside it so the first crop has somewhere to go without
  // hunting for a second patch.
  //
  // save.starterPlotAt holds the TOP-LEFT cell's centre in world metres. It is
  // chosen once and re-painted at those same cells on every later rebuild of
  // the tile, so the plot can never drift out from under a player who has
  // already tilled it.
  function carveStarterPlot(scene, entry, tx, ty, spawnIX, spawnIY, usedSeats) {
    const grid = entry.grid;
    if (!grid) return;
    // Only for a player the ladder is still guiding. A veteran save has no use
    // for the plot and shouldn't have its home terrain quietly edited on a
    // reload — but one already frozen keeps being repainted forever (below),
    // so a player who finishes the ladder doesn't watch their first field turn
    // back into whatever was under it.
    if (!scene.save.starterPlotAt &&
        (typeof Quests === 'undefined' || Quests.starterHidden(scene.save))) return;
    const f = WorldGen.tileFrame(entry, tx, ty, scene.tileEdgeM);   // THIS tile's cells (its row's grid)
    const { N } = f;
    const paint = (cx, cy) => {
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) grid[(cy + dy) * N + (cx + dx)] = WorldGen.T.GRASS;
      }
    };
    const inTile = (cx, cy) => cx >= 0 && cy >= 0 && cx + 1 < N && cy + 1 < N;

    // Already frozen — repaint in place. The plot lives within a few cells of
    // the anchor, so a frozen plot that doesn't land on THIS tile belongs to a
    // neighbour and is that tile's job to paint.
    const frozen = scene.save.starterPlotAt;
    if (frozen && Number.isFinite(frozen.x)) {
      const c = f.cellOf(frozen.x, frozen.y);
      if (inTile(c.ix, c.iy)) paint(c.ix, c.iy);
      return;
    }

    // Cells a plot must never overwrite: the street, anyone's floor, open
    // water and the decking over it, and the cave layers. Everything else
    // the world puts under your feet — yards, lots, scrub, sand, bare rock —
    // is fair game to turn into a patch of soil.
    const unpaintable = (t) => t === WorldGen.T.WATER || WorldGen.isBuildingTerrain(t) || WorldGen.isCobbleTerrain(t)
      || t === WorldGen.T.PIER || t === WorldGen.T.CAVE_FLOOR || t === WorldGen.T.CAVE_WALL;
    // Anything still standing in a cell blocks the till handler, so the plot
    // has to avoid the objects and wild plants the clearing pass kept (real
    // street trees, houses, the crates themselves) — the live occupancy,
    // handed to the gate with the entry's full options.
    const occupied = WorldGen.occupiedIndexSet(f, entry.objects, entry.wildplants);
    const spawnOpts = WorldGen.spawnOptsOf(entry, { occupied });

    const usable = (cx, cy) => {
      // The Home trailer covers the anchor cell and spills into all eight
      // neighbours (see inTrailerMoat in the caller) — a plot there would sit
      // under the building art.
      if (Math.max(Math.abs(cx - spawnIX), Math.abs(cy - spawnIY)) <= 1) return false;
      if (usedSeats.has(cx + ',' + cy)) return false;
      // `unpaintable` is the road TERRAIN; THE SPAWN GATE (a 'minor' spawn —
      // the plot is placed scenery like the trail crates) catches the rest
      // of the band the player sees drawn over it (entry.roadMask) plus a
      // quiet corner or a yard behind a house, and the live occupancy. Soil
      // tilled under the asphalt reads as a plot in the middle of the street
      // either way.
      if (!WorldGen.isSpawnCell(grid, N, N, cx, cy, spawnOpts, 'minor')) return false;
      return !unpaintable(grid[cy * N + cx]);
    };
    const blockUsable = (cx, cy) => inTile(cx, cy) &&
      usable(cx, cy) && usable(cx + 1, cy) && usable(cx, cy + 1) && usable(cx + 1, cy + 1);

    // Nearest-first ring scan out to 8 cells, so the plot lands as close to
    // the trailer as the surroundings allow. The scan order is fixed (not
    // seeded), so a rebuild of the same tile would reach the same answer even
    // if the freeze above were somehow missing.
    const found = WorldGen.nearestRingCell(spawnIX, spawnIY, 2, 8, blockUsable);
    // Nothing within 8 cells can host one (mid-river, deep inside a block of
    // buildings). Leave the grid alone and freeze nothing — the arrow falls
    // back to the crates, which is where it pointed before this existed.
    if (!found) return;
    paint(found.ix, found.iy);
    // Snap the frozen point to the canonical global cell centre, the same
    // basis seatCrate uses, so the arrow and the tap grid agree on where the
    // plot is.
    const raw = f.centre(found.ix, found.iy);
    const { cellIX, cellIY } = worldMetersToAbsCell(scene, raw.x, raw.y);
    const { x: wmx, y: wmy } = absCellCenterMeters(scene, cellIX, cellIY);
    scene.save.starterPlotAt = { x: wmx, y: wmy };
    if (typeof persistSave === 'function') persistSave(scene.save);
  }

  // ── The fishing pond ────────────────────────────────────────────────────
  // Fishing is a tap on a WATER cell (interact.js 'fishing'), and nothing
  // about a new player's neighbourhood promises one: a suburban spawn can be
  // a kilometre from the nearest creek, and then the whole fishing loop — the
  // rod, the fish the cat wants, the goldenfish — simply doesn't exist for
  // them. This carves a small pond, 2x2 cells of open water, a fixed walk
  // from Home: TWO SCREENS out (POND_MIN_CELLS), past the relic chest and the
  // starter ring, so it is something to find on the second outing rather than
  // part of the opening screen — and beside a POI chest when one stands in
  // the band (POND_POI_CELLS), so the walk to the shops is the walk to the
  // water. It is water in the terrain grid and nothing more: it renders as
  // water, casts like water, refills the can like water, and mirrors as rock
  // in the cave below like water.
  //
  // save.starterPondAt holds the TOP-LEFT cell's centre in world metres — the
  // starterPlotAt convention — and like the plot it is chosen once and
  // repainted in place on every later build of its tile (_paintPond, which
  // also sweeps whatever a rebuild regenerated on those four cells).
  //
  // The band is a ring of cells that can cross a tile seam, so the search
  // runs in WORLD space over every loaded tile — the same cross-seam reader
  // _provisionStarterHome uses — and defers, bounded, until the tiles the
  // band reaches into have arrived: a plan drawn against half a map would
  // seat the pond on whichever side loaded first, POI or no POI. Whichever
  // tile's spawn pass runs first once the map is there does the planning,
  // and the pond is painted into whichever tile owns it. The scan order is
  // fixed (no RNG), so a rebuild reaching this path again reaches the same
  // answer even if the freeze were somehow missing.
  function carveStarterPond(scene, entry, tx, ty) {
    const grid = entry.grid;
    if (!grid || (scene.depth || 0) !== 0 || scene._sandboxMode) return;
    const f = WorldGen.tileFrame(entry, tx, ty, scene.tileEdgeM);   // THIS tile's cells (its row's grid)
    const { N, cellM, ox: tx0, oy: ty0 } = f;
    // (This pass works in cells RELATIVE to this tile that may lie outside
    // it — the band crosses seams — so its sets are keyed 'cx,cy', not by
    // the tile's flat index.)
    const localCell = (wx, wy) => { const c = f.cellOf(wx, wy); return { cx: c.ix, cy: c.iy }; };
    const inTile = (cx, cy) => cx >= 0 && cy >= 0 && cx + 1 < N && cy + 1 < N;

    // Already frozen — repaint in place when this tile owns it. A pond on a
    // neighbouring tile is that tile's job to paint.
    const frozen = scene.save.starterPondAt;
    if (frozen && Number.isFinite(frozen.x)) {
      const f = localCell(frozen.x, frozen.y);
      if (inTile(f.cx, f.cy)) scene._paintPond(entry, tx, ty, f.cx, f.cy);
      return;
    }
    const anchor = scene._starterTrailAnchor();
    if (!anchor) return;                       // resolves later — see _setStarterCratesAt
    const a = localCell(anchor.x, anchor.y);   // may lie outside this tile
    // Only a tile the band reaches into has any business planning.
    const reach = POND_MAX_CELLS + 1;
    if (a.cx + reach < 0 || a.cy + reach < 0 || a.cx - reach >= N || a.cy - reach >= N) return;

    // Terrain lookup that CROSSES TILE SEAMS, in cells relative to this tile
    // (see the same helper in _provisionStarterHome). An unloaded neighbour
    // reads as `miss`, never guessed at.
    const cellAt = (cx, cy, read, miss) => {
      if (cx >= 0 && cy >= 0 && cx < N && cy < N) return read(entry, cy * N + cx);
      const wx = tx0 + (cx + 0.5) * cellM, wy = ty0 + (cy + 0.5) * cellM;
      const ntx = Math.floor(wx / scene.tileEdgeM), nty = Math.floor(wy / scene.tileEdgeM);
      const e = WorldGen.tileCache.get(WorldGen.tileKey(ntx, nty));
      if (!e || !e.grid || (e.status && e.status !== 'ready')) return miss;
      const nN = e.cellsPerEdge;
      const ix = Math.floor((wx - ntx * scene.tileEdgeM) / rowCellM(scene, nty));
      const iy = Math.floor((wy - nty * scene.tileEdgeM) / rowCellM(scene, nty));
      if (ix < 0 || iy < 0 || ix >= nN || iy >= nN) return miss;
      return read(e, iy * nN + ix);
    };
    const gridAt = (cx, cy) => cellAt(cx, cy, (e, i) => e.grid[i], null);
    // THE SPAWN GATE, crossing tile seams the same way gridAt does: resolves
    // which tile entry actually owns (cx, cy) and asks THAT entry's own
    // isSpawnCell — its own roadMask AND spawnWhy — never a bare roadMask
    // read, which only answered the band question and missed every other
    // hard reason (RESTRICTED, QUIET, a yard behind a house, …). Unresolved
    // (an unloaded neighbour) reads as refused, like every other cellAt read.
    const spawnOkAt = (cx, cy, cls) => cellAt(cx, cy, (e, i) => {
      const eN = e.cellsPerEdge;
      return WorldGen.isSpawnCell(e.grid, eN, eN, i % eN, Math.floor(i / eN), WorldGen.spawnOptsOf(e), cls);
    }, false);
    // A synthesized POI plaza (the hospital cross) —
    // a pond punched into one reads as a bug.
    const padAt = (cx, cy) => cellAt(cx, cy, (e, i) => !!(e.poiPadCells && e.poiPadCells.has(i)), false);
    // Which tile owns a cell, by world position — so the 2x2 can be required
    // to sit inside ONE tile's grid rather than straddle a seam.
    const ownerOf = (cx, cy) => {
      const wx = tx0 + (cx + 0.5) * cellM, wy = ty0 + (cy + 0.5) * cellM;
      return Math.floor(wx / scene.tileEdgeM) + ',' + Math.floor(wy / scene.tileEdgeM);
    };
    if (gridAt(a.cx, a.cy) == null) return;    // the anchor's own tile has to be readable
    // Don't plan against HALF A MAP. Wait, bounded, until every tile the band
    // reaches into has loaded — a tile that never arrives must not leave the
    // player with no water at all.
    scene._starterPondDefers = (scene._starterPondDefers || 0) + 1;
    if (scene._starterPondDefers <= 8) {
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        if (gridAt(a.cx + dx * POND_MAX_CELLS, a.cy + dy * POND_MAX_CELLS) == null) {
          scene._pondDebug = `deferred (${scene._starterPondDefers}): band not loaded from tile ${tx}/${ty}`;
          return;
        }
      }
    }

    // Occupancy and POIs across the anchor tile and its loaded neighbours.
    // Anything standing on a cell keeps the pond off it (a tree in a pond is
    // a bug whichever the renderer draws second); a POI CHEST — a real one,
    // carrying its poiClass, never a starter crate — is what the pond seats
    // beside.
    const key = (cx, cy) => cx + ',' + cy;
    const taken = new Set();
    const pois = [];
    const mark = (wx, wy) => { const c = localCell(wx, wy); taken.add(key(c.cx, c.cy)); };
    const collect = (e) => {
      for (const o of (e.objects || [])) {
        mark(o.x, o.y);
        if (o.kind === 'chest' && o.poiClass) pois.push(localCell(o.x, o.y));
      }
      for (const w of (e.wildplants || [])) mark(w.x, w.y);
      for (const t of (e.extraTreasures || [])) mark(t.x, t.y);
      for (const t of (e.parkingTreasures || [])) mark(t.x, t.y);
      if (e.treasure) mark(e.treasure.x, e.treasure.y);
    };
    collect(entry);
    for (const [k, e] of WorldGen.tileCache) {
      if (!e || e === entry || !e.grid) continue;
      const parts = k.split('/');
      if (Math.abs(+parts[1] - tx) > 1 || Math.abs(+parts[2] - ty) > 1) continue;
      collect(e);
    }
    // ...and what the player has done to the ground: a crop or a tilled cell
    // is theirs, not the pond's.
    for (const p of (scene.save.planted || [])) mark(p.x, p.y);
    for (const k of (scene.save.tilled || [])) {
      const [ix, iy] = String(k).split('_').map(Number);
      if (!Number.isFinite(ix) || !Number.isFinite(iy)) continue;
      const c = absCellCenterMeters(scene, ix, iy);
      mark(c.x, c.y);
    }
    const plot = scene.save.starterPlotAt;
    if (plot && Number.isFinite(plot.x)) {
      const c = localCell(plot.x, plot.y);
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) taken.add(key(c.cx + dx, c.cy + dy));
    }

    // ── The walk there ──────────────────────────────────────────────────
    // Flood out from the anchor over ground a walk may cross — roads yes,
    // water and buildings no (the relic chest's rule) — so the pond is never
    // seated across a river or inside a walled block. A cell the flood never
    // reached is no place for it.
    const uncrossable = (t) => t === WorldGen.T.WATER || WorldGen.isBuildingTerrain(t);
    const FLOOD_R = POND_MAX_CELLS + 2;
    const reached = new Set([key(a.cx, a.cy)]);
    const flood = [[a.cx, a.cy]];
    for (let head = 0; head < flood.length; head++) {
      const [cx, cy] = flood[head];
      for (const [ddx, ddy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + ddx, ny = cy + ddy;
        if (Math.max(Math.abs(nx - a.cx), Math.abs(ny - a.cy)) > FLOOD_R) continue;
        const k = key(nx, ny);
        if (reached.has(k)) continue;
        const t = gridAt(nx, ny);
        if (t == null || uncrossable(t)) continue;
        reached.add(k);
        flood.push([nx, ny]);
      }
    }

    // Cells the pond may fill: soft ground the player can walk to — never
    // the street (terrain OR the drawn band), anyone's floor, existing water,
    // the decking over it, the cave layers, a POI plaza, or a cell something
    // stands on. The terrain it refuses is the starter plot's `unpaintable`.
    const unpaintable = (t) => uncrossable(t) || WorldGen.isCobbleTerrain(t)
      || t === WorldGen.T.PIER || t === WorldGen.T.CAVE_FLOOR || t === WorldGen.T.CAVE_WALL;
    const fillable = (cx, cy) => {
      if (!reached.has(key(cx, cy)) || taken.has(key(cx, cy))) return false;
      // THE SPAWN GATE, a 'minor' spawn (the pond is placed scenery, like the
      // plot) — off the drawn road band, a quiet corner or a yard behind a
      // house, not a bare roadMask read.
      if (!spawnOkAt(cx, cy, 'minor') || padAt(cx, cy)) return false;
      const t = gridAt(cx, cy);
      return t != null && !unpaintable(t);
    };
    // The shore: every cell ringing the 2x2 is ground to stand on — not water
    // (the pond would read as a bay of some lake), not the street, not a wall
    // — so a cast can be made from any side and the pond reads as its own
    // thing.
    const shoreOK = (cx, cy) => {
      const t = gridAt(cx, cy);
      return t != null && !uncrossable(t) && !WorldGen.isRoadTerrain(t) && spawnOkAt(cx, cy, 'minor');
    };
    // Chebyshev distance from the 2x2 (top-left cx,cy) to the nearest POI
    // chest; Infinity when there is none in range.
    const poiDist = (cx, cy) => {
      let best = Infinity;
      for (const p of pois) {
        const dx = Math.max(cx - p.cx, p.cx - (cx + 1), 0);
        const dy = Math.max(cy - p.cy, p.cy - (cy + 1), 0);
        best = Math.min(best, Math.max(dx, dy));
      }
      return best;
    };
    const blockOK = (cx, cy) => {
      if (ownerOf(cx, cy) !== ownerOf(cx + 1, cy + 1)) return false;   // one tile's grid
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) if (!fillable(cx + dx, cy + dy)) return false;
      }
      for (let dy = -1; dy <= 2; dy++) {
        for (let dx = -1; dx <= 2; dx++) {
          if (dx >= 0 && dx <= 1 && dy >= 0 && dy <= 1) continue;
          if (!shoreOK(cx + dx, cy + dy)) return false;
        }
      }
      // Never on a chest's doorstep: the occupancy pass keeps the chest's
      // own cell, and its one-cell frontage stays dry too.
      return poiDist(cx, cy) >= 2;
    };

    // Ring scan over the band, nearest ring first. Beside a POI beats
    // anywhere else, and among those the closest to it; otherwise the nearest
    // to Home. Fixed order, no RNG.
    let found = null, foundScore = Infinity;
    WorldGen.ringCells(a.cx, a.cy, POND_MIN_CELLS, POND_MAX_CELLS, (cx, cy, r) => {
      if (!blockOK(cx, cy)) return null;
      const dp = poiDist(cx, cy);
      const score = dp <= POND_POI_CELLS ? dp * 100 + r : 10000 + r;
      if (score < foundScore) { foundScore = score; found = { cx, cy, r, dp }; }
      return null;
    });
    if (!found) {
      scene._pondDebug = `no seat in band ${POND_MIN_CELLS}..${POND_MAX_CELLS} from tile ${tx}/${ty} (anchor ${a.cx},${a.cy}, ${pois.length} POI)`;
      return;
    }
    // Freeze the top-left on the canonical global cell centre — the basis
    // every tap uses — so the fishing tap and the painted cell agree.
    const raw = f.centre(found.cx, found.cy);
    const { cellIX, cellIY } = worldMetersToAbsCell(scene, raw.x, raw.y);
    const { x: wmx, y: wmy } = absCellCenterMeters(scene, cellIX, cellIY);
    scene.save.starterPondAt = { x: wmx, y: wmy };
    if (typeof persistSave === 'function') persistSave(scene.save);
    scene._pondDebug = `seated r=${found.r} at (${found.cx},${found.cy}) of tile ${tx}/${ty}`
      + (found.dp <= POND_POI_CELLS ? ` beside a POI (d=${found.dp})` : ` (no POI within ${POND_POI_CELLS}; ${pois.length} in range)`);
    // Paint it into whichever loaded tile owns it — this one, or the
    // neighbour the band crossed into.
    if (inTile(found.cx, found.cy)) { scene._paintPond(entry, tx, ty, found.cx, found.cy); return; }
    const otx = Math.floor(wmx / scene.tileEdgeM), oty = Math.floor(wmy / scene.tileEdgeM);
    const e = WorldGen.tileCache.get(WorldGen.tileKey(otx, oty));
    if (!e || !e.grid || (e.status && e.status !== 'ready')) return;   // its own spawn pass paints it
    const oc = {
      cx: Math.floor((wmx - otx * scene.tileEdgeM) / rowCellM(scene, oty)),
      cy: Math.floor((wmy - oty * scene.tileEdgeM) / rowCellM(scene, oty)),
    };
    if (oc.cx >= 0 && oc.cy >= 0 && oc.cx + 1 < e.cellsPerEdge && oc.cy + 1 < e.cellsPerEdge) {
      scene._paintPond(e, otx, oty, oc.cx, oc.cy);
    }
  }

  // Paint the 2x2 pond whose top-left is tile-local (cx, cy) into `entry`,
  // and sweep the four cells clear: a rebuild regenerates the rocks and scrub
  // the seat pass avoided, and nothing stands in open water.
  function paintPond(scene, entry, tx, ty, cx, cy) {
    const f = WorldGen.tileFrame(entry, tx, ty, scene.tileEdgeM);   // THIS tile's cells (its row's grid)
    const { N } = f;
    const cells = new Set();
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        entry.grid[(cy + dy) * N + (cx + dx)] = WorldGen.T.WATER;
        cells.add((cy + dy) * N + (cx + dx));
      }
    }
    const on = (wx, wy) => cells.has(f.idxOf(wx, wy));
    if (entry.objects) entry.objects = entry.objects.filter(o => !on(o.x, o.y));
    if (entry.wildplants) entry.wildplants = entry.wildplants.filter(w => !on(w.x, w.y));
    if (entry.extraTreasures) entry.extraTreasures = entry.extraTreasures.filter(t => !on(t.x, t.y));
    if (entry.parkingTreasures) entry.parkingTreasures = entry.parkingTreasures.filter(t => !on(t.x, t.y));
    if (entry.treasure && on(entry.treasure.x, entry.treasure.y)) entry.treasure = null;
  }

  // Run the pond pass over every spawned surface tile in the cache — for an
  // anchor that resolved late (see _setStarterCratesAt), after the tiles the
  // band reaches into had already spawned with no anchor to measure from.
  // Cheap once frozen: each tile just repaints its own pond, if it owns one.
  function carveStarterPondAround(scene) {
    if ((scene.depth || 0) !== 0 || !WorldGen.tileCache) return;
    for (const [k, e] of WorldGen.tileCache) {
      if (!e || !e.grid || !e._spawned || (e.status && e.status !== 'ready')) continue;
      const parts = k.split('/');
      scene._carveStarterPond(e, +parts[1], +parts[2]);
    }
  }

  // Rebuild one frozen starter-home record into a world object. Kept beside
  // the placer so the shape written to the save and the shape pushed into a
  // tile can't drift — the record IS the object, minus its position basis.
  function starterHomeObject(scene, rec) {
    const make = (kind, extra) =>
      WorldGen.makeObject(kind, rec.x, rec.y, rec.id, { _synthetic: true, ...extra });
    // A record may carry a rarity rolled at seat time (see the seatAt roll in
    // _provisionStarterHome): a rock's deposit tier, or a tree grown a size
    // up. The frozen record is the truth — legacy records carry neither and
    // rebuild as the plain starter shape.
    if (rec.k === 'tree') {
      const o = make('tree', { ...HomeArea.STARTER_TREE, variant: rec.variant || 1 });
      if (rec.size) o.size = rec.size;
      return o;
    }
    if (rec.k === 'rock') {
      const o = make('mineralrock', { ...HomeArea.STARTER_ROCK });
      if (rec.yieldTier > 1) {
        o.yieldTier = rec.yieldTier;
        o.requiredTier = rec.requiredTier || Math.max(1, rec.yieldTier - 1);
      }
      return o;
    }
    // A cave entrance on the surface. Same shape maybePlaceCaveEntrance emits,
    // so it descends through the ordinary staircase path and loadCaveTile
    // mirrors an up-stair onto the level below it like any other mine mouth.
    if (rec.k === 'ladder') return make('staircase', { dir: 'down', depth: 0 });
    // A plain small house, so _houseRole draws it as a wreck until the player
    // restores it — which is exactly what step 4 of the ladder asks for. The
    // address decides its post-restore shop role the same way a real one's does.
    return make('house', { tier: WorldGen.T.BUILDING, address: rec.address || 0 });
  }

  // The same, for the one starter record that is NOT an object: a mushroom
  // lives in the tile's `wildplants` stream (keyed by `crop`, picked bare-
  // handed) rather than in `objects`. Kept beside _starterHomeObject so the
  // two halves of "a frozen record becomes a world thing" stay together.
  //
  // _ix/_iy are the ABSOLUTE cell, not the tile-local index worldgen stores.
  // They are only ever a hash for the sprite variant (render.js), so absolute
  // is strictly better: it doesn't change when a record is injected into a
  // neighbour tile across a seam. Derived rather than frozen, so records
  // written before this existed rebuild identically.
  function starterHomeWildplant(scene, rec) {
    const c = worldMetersToAbsCell(scene, rec.x, rec.y);
    return WorldGen.makeWildplant(HomeArea.STARTER_MUSHROOM.crop, rec.x, rec.y, rec.id, {
      ...HomeArea.STARTER_MUSHROOM,
      _synthetic: true, _ix: c.cellIX, _iy: c.cellIY,
    });
  }

  // Which of a tile's two streams a frozen starter record belongs in.
  function starterHomeStream(scene, entry, rec) {
    if (rec.k === 'mushroom') {
      entry.wildplants = entry.wildplants || [];
      return { list: entry.wildplants, make: () => scene._starterHomeWildplant(rec) };
    }
    entry.objects = entry.objects || [];
    return { list: entry.objects, make: () => scene._starterHomeObject(rec) };
  }

  // Make sure the starter ladder has something to teach WITH.
  //
  // The ladder assumes the world around spawn can carry it: wood to chop,
  // rock to mine, a wreck to rebuild. The real map promises none of that. A
  // parkland or rural spawn can have no OSM buildings at all, so step 4
  // ("Rebuild a neighbour") can never fire and the crates' wood and stone have
  // nothing to be spent on. A downtown spawn has the opposite problem: trees
  // everywhere, every one of them a large hardwood wanting a Gold axe.
  //
  // The POLICY — what counts, what a beginner can actually harvest, and how
  // much is required — lives in home.js (HomeArea.planStarterProvision), which
  // is pure and headless-testable. This method only does what needs a tile:
  // seating the shortfall on real cells and freezing the result.
  //
  // Placement follows the same split the tutorial pocket already establishes:
  // the pocket stays tidy for the crate trail and the soil plot, apart from one
  // token tree and one token rock so the first thing to chop and mine is in
  // sight of Home; everything else seats in the ring just outside it.
  function provisionStarterHome(scene, entry, tx, ty, spawnIX, spawnIY, usedSeats) {
    const grid = entry.grid;
    if (!grid || typeof HomeArea === 'undefined' || typeof WorldGen === 'undefined') return;
    // Same gate as the starter plot: provision only while the ladder is still
    // guiding someone, but once frozen keep re-applying forever, so a player
    // who finishes it doesn't watch their home dissolve back into bare map.
    if (!scene.save.starterHome &&
        (typeof Quests === 'undefined' || Quests.starterHidden(scene.save))) return;
    const f = WorldGen.tileFrame(entry, tx, ty, scene.tileEdgeM);   // THIS tile's cells (its row's grid)
    const { N, cellM, ox: tx0, oy: ty0 } = f;
    entry.objects = entry.objects || [];
    // Callable from any tile's spawn, not just the starter trail's own pass:
    // without the spawn cell, derive it from the frozen anchor. It may land
    // outside this tile, which is fine — everything below works in world
    // space (so this pass's sets are keyed 'cx,cy', not by the flat index).
    if (spawnIX == null || spawnIY == null) {
      const a = scene.save.starterCratesAt;
      if (!a || !Number.isFinite(a.x)) return;
      ({ ix: spawnIX, iy: spawnIY } = f.cellOf(a.x, a.y));
    }
    if (!usedSeats) usedSeats = new Set();

    // ── Re-apply what is already frozen ────────────────────────────────
    // Every tile does this for the records that land inside it, so an item
    // seated across a tile seam is that neighbour's job to inject — the same
    // division of labour _carveStarterPlot uses for the soil plot.
    const inThisTile = (wx, wy) =>
      wx >= tx0 && wx < tx0 + scene.tileEdgeM && wy >= ty0 && wy < ty0 + scene.tileEdgeM;
    const present = new Set();
    for (const o of entry.objects) if (o.id) present.add(o.id);
    for (const w of (entry.wildplants || [])) if (w.id) present.add(w.id);
    const playerClaims = [
      ...(Array.isArray(scene.save.fruittrees) ? scene.save.fruittrees : []),
      ...(Array.isArray(scene.save.planted) ? scene.save.planted : []),
    ];
    for (const e of [entry, ...WorldGen.tileCache.values()]) {
      for (const o of [...(e.objects || []), ...(e.wildplants || [])]) {
        if (o && (o.planted || o.placed || o.playerOwned) && !playerClaims.includes(o)) playerClaims.push(o);
      }
    }
    // A frozen starter record is generated story content. If a player later
    // plants on its old seat, retain its ID and move only that story record to
    // the first eligible nearby cell in fixed ring order.
    const avoidPlayer = (rec) => {
      if (!playerClaims.some(o => Number.isFinite(o.x) && Number.isFinite(o.y) &&
          SpawnOwnership.overlaps(scene, rec, o))) return true;
      const sourceX = rec.sourceX ?? rec.x, sourceY = rec.sourceY ?? rec.y;
      const sourceTile = worldMetersToTile(scene, sourceX, sourceY);
      const origin = sourceTile.tx === tx && sourceTile.ty === ty ? entry :
        WorldGen.tileCache.get(WorldGen.tileKey(sourceTile.tx, sourceTile.ty));
      if (!origin || !origin.grid) return false; // The original tile has not loaded yet.
      const old = worldMetersToAbsCell(scene, sourceX, sourceY);
      const check = (c) => {
        const p = absCellCenterMeters(scene, c.cellIX, c.cellIY);
        const probe = { x: p.x, y: p.y, _footprintCells: rec._footprintCells || rec.footprintCells };
        // Every covered cell must meet hard terrain/access rules in the
        // immutable generated grid. This search cannot depend on neighbour
        // load order or ambient objects that the winning record can clear.
        for (const cell of SpawnOwnership.footprintCells(scene, probe)) {
          const t = absCellToTile(scene, cell.cellIX, cell.cellIY);
          if (t.tx !== sourceTile.tx || t.ty !== sourceTile.ty) return false;
          if (!WorldGen.isSpawnCell(origin.baseGrid || origin.grid,
            origin.cellsPerEdge, origin.cellsPerEdge, t.ix, t.iy, WorldGen.spawnOptsOf(origin), 'minor')) return false;
        }
        const trailer = scene.save.starterTrailer;
        if (trailer) {
          const h = worldMetersToAbsCell(scene, trailer.x, trailer.y);
          if (Math.abs(c.cellIX - h.cellIX) <= 1 && Math.abs(c.cellIY - h.cellIY) <= 1) return false;
        }
        return ![...playerClaims, ...((scene.save.starterHome && scene.save.starterHome.placed) || [])]
          .some(o => o.id !== rec.id && Number.isFinite(o.x) && Number.isFinite(o.y) &&
            SpawnOwnership.overlaps(scene, probe, o));
      };
      // The nearest eligible cell round the old seat, in fixed ring order.
      const moved = WorldGen.ringCells(0, 0, 1, 8, (dx, dy) => {
        const c = absCellOffset(scene, old.cellIX, old.cellIY, dx, dy);
        return check(c) ? c : null;
      });
      if (moved) {
        const p = absCellCenterMeters(scene, moved.cellIX, moved.cellIY);
        rec.sourceX = sourceX; rec.sourceY = sourceY;
        rec.x = p.x; rec.y = p.y;
        for (const live of [entry, ...WorldGen.tileCache.values()]) {
          if (live.objects) live.objects = live.objects.filter(o => o.id !== rec.id);
          if (live.wildplants) live.wildplants = live.wildplants.filter(o => o.id !== rec.id);
        }
        present.delete(rec.id);
        if (origin.spawnShortfalls) origin.spawnShortfalls = origin.spawnShortfalls.filter(s => s.id !== rec.id);
        if (typeof persistSave === 'function') persistSave(scene.save);
        return true;
      }
      origin.spawnShortfalls = origin.spawnShortfalls || [];
      if (!origin.spawnShortfalls.some(s => s.id === rec.id)) {
        origin.spawnShortfalls.push({ kind: 'starter_home', id: rec.id, reason: 'no_eligible_cell' });
      }
      return false;
    };
    const claimsByEntry = new Map();
    const claimSeat = (e, claim) => {
      if (!claimsByEntry.has(e)) claimsByEntry.set(e, []);
      claimsByEntry.get(e).push(claim);
    };
    const reconcileClaims = () => {
      for (const [e, claims] of claimsByEntry) SpawnOwnership.reconcileEntry(scene, e, claims);
      claimsByEntry.clear();
    };
    const inject = (rec) => {
      if (!avoidPlayer(rec)) {
        for (const e of [entry, ...WorldGen.tileCache.values()]) {
          if (e.objects) e.objects = e.objects.filter(o => o.id !== rec.id);
          if (e.wildplants) e.wildplants = e.wildplants.filter(o => o.id !== rec.id);
        }
        return;
      }
      if (inThisTile(rec.x, rec.y)) {
        const s = scene._starterHomeStream(entry, rec);
        const previous = s.list.find(o => o.id === rec.id);
        if (previous && (previous.x !== rec.x || previous.y !== rec.y)) {
          previous.x = rec.x; previous.y = rec.y;
        }
        if (!present.has(rec.id)) {
          s.list.push(s.make());
          present.add(rec.id);
        }
        claimSeat(entry, s.list.find(o => o.id === rec.id));
        return;
      }
      // Seated across a seam: put it in whichever loaded tile owns it, so a
      // pass driven by one tile still lands its neighbours' share immediately
      // instead of waiting for those tiles to rebuild.
      const otx = Math.floor(rec.x / scene.tileEdgeM), oty = Math.floor(rec.y / scene.tileEdgeM);
      const e = WorldGen.tileCache.get(WorldGen.tileKey(otx, oty));
      if (!e || !e.objects) return;
      const s = scene._starterHomeStream(e, rec);
      let claim = s.list.find(o => o.id === rec.id);
      if (!claim) {
        claim = s.make();
        s.list.push(claim);
      } else if (claim.x !== rec.x || claim.y !== rec.y) {
        claim.x = rec.x; claim.y = rec.y;
      }
      claimSeat(e, claim);
    };
    const frozen = scene.save.starterHome;
    if (frozen) {
      for (const rec of (frozen.placed || [])) inject(rec);
      reconcileClaims();
      // A tamed natural is regenerated at its original tier on every rebuild,
      // so the downgrade has to be re-applied or the player's one choppable
      // street tree turns back into a hardwood on the next reload.
      const wasTamed = new Set(frozen.tamed || []);
      if (wasTamed.size) {
        for (const o of entry.objects) if (o.id && wasTamed.has(o.id)) HomeArea.makeStarterUsable(o);
      }
      // A finished plan needs nothing more. An UNFINISHED one falls through to
      // top itself up: the first pass runs while the neighbouring tiles are
      // often still streaming, and a spawn near a tile seam can't seat into a
      // tile that hasn't loaded — measured on a real spawn at cell iy=213 of a
      // 222-cell tile, which left the whole southern arc bare. Later passes see
      // more of the map. Bounded, so a genuinely hemmed-in spawn stops trying.
      if (frozen.done || (frozen.tries || 0) >= 4) return;
    }

    // ── First pass: audit, then fill only the gaps ─────────────────────
    // Only the tile holding the anchor can see the home area, so only it
    // plans. (The ring reaches 16 cells and a tile is ~222, so the area sits
    // inside one tile except right on a seam — where the audit simply sees
    // less of the neighbourhood and errs toward providing a little extra.)
    const { x: anchorX, y: anchorY } = f.centre(spawnIX, spawnIY);
    // Audit every loaded tile the home area touches. Reading this tile alone
    // would miss both the neighbourhood across a seam and the items an earlier
    // pass already seated there, and would re-provision them all over again.
    const atx2 = Math.floor(tx0 / scene.tileEdgeM), aty2 = Math.floor(ty0 / scene.tileEdgeM);
    const seen = new Set();
    const areaObjects = [];
    const areaPlants = [];
    const collect = (list, into) => {
      for (const o of (list || [])) {
        if (o.id) { if (seen.has(o.id)) continue; seen.add(o.id); }
        into.push(o);
      }
    };
    collect(entry.objects, areaObjects);
    collect(entry.wildplants, areaPlants);
    for (const [k, e] of WorldGen.tileCache) {
      if (!e || !e.objects) continue;
      const parts = k.split('/');
      if (Math.abs(+parts[1] - atx2) > 1 || Math.abs(+parts[2] - aty2) > 1) continue;
      collect(e.objects, areaObjects);
      collect(e.wildplants, areaPlants);
    }
    // Audit as far out as an earlier pass had to reach. Without this, anything
    // seated in the escalated band sits outside the default audit radius, so
    // the next pass sees the quota unmet and provisions it all over again.
    let auditR = HomeArea.RING_MAX_CELLS;
    for (const rec of ((frozen && frozen.placed) || [])) {
      const d = HomeArea.cellsFromAnchor(rec.x, rec.y, anchorX, anchorY, scene.cellM);
      if (d > auditR) auditR = Math.ceil(d);
    }
    const plan = HomeArea.planStarterProvision(areaObjects, anchorX, anchorY, scene.cellM,
      { homeId: scene.save.starterShopId, radiusCells: auditR, wildplants: areaPlants });

    // Modify the unusable naturals standing here rather than crowding more in
    // beside them: the player's own street tree stays their street tree, it
    // just stops demanding an axe they will not own for hours.
    const tamed = [];
    for (const o of plan.downgrade) {
      if (HomeArea.makeStarterUsable(o) && o.id) tamed.push(o.id);
    }

    // Cells nothing may be seated on: the street, anyone's floor, water and
    // the decking over it, and the cave layers. Mirrors the starter plot's
    // `unpaintable` — the difference is that a plot REPLACES a cell whereas
    // an object has to stand on one, so bare rock is fine for both.
    const blocked = (t) => t === WorldGen.T.WATER || WorldGen.isBuildingTerrain(t) || WorldGen.isCobbleTerrain(t)
      || t === WorldGen.T.PIER || t === WorldGen.T.CAVE_FLOOR || t === WorldGen.T.CAVE_WALL;
    const key = (cx, cy) => cx + ',' + cy;
    const taken = new Set();
    const mark = (wx, wy) => taken.add(key(
      Math.floor((wx - tx0) / cellM), Math.floor((wy - ty0) / cellM)));
    // Plantings may be restored after this pass; their saved cells already
    // belong to the player when a generated starter story seat is chosen.
    for (const o of (Array.isArray(scene.save.fruittrees) ? scene.save.fruittrees : [])) mark(o.x, o.y);
    for (const o of (Array.isArray(scene.save.planted) ? scene.save.planted : [])) mark(o.x, o.y);
    // Terrain lookup that CROSSES TILE SEAMS, in cells relative to the anchor
    // tile, so a spawn near a seam keeps its whole
    // arc. A tile is only consulted once it has
    // loaded; an unloaded neighbour reads as unusable rather than being
    // guessed at, so nothing is ever seated into unseen water or road.
    // Returns null when the cell can't be resolved.
    //
    // One resolver for both per-cell arrays: it finds the tile entry and the
    // index of the cell in it, and `read(e, i)` picks the array (or answers
    // `miss` when that tile hasn't got one). A neighbour tile that isn't ready
    // reads as `miss` whichever array is asked for.
    const cellAt = (cx, cy, read, miss) => {
      if (cx >= 0 && cy >= 0 && cx < N && cy < N) return read(entry, cy * N + cx);
      const wx = tx0 + (cx + 0.5) * cellM, wy = ty0 + (cy + 0.5) * cellM;
      const ntx = Math.floor(wx / scene.tileEdgeM), nty = Math.floor(wy / scene.tileEdgeM);
      const e = WorldGen.tileCache.get(WorldGen.tileKey(ntx, nty));
      if (!e || (e.status && e.status !== 'ready')) return miss;
      const nN = e.cellsPerEdge;
      const ix = Math.floor((wx - ntx * scene.tileEdgeM) / rowCellM(scene, nty));
      const iy = Math.floor((wy - nty * scene.tileEdgeM) / rowCellM(scene, nty));
      if (ix < 0 || iy < 0 || ix >= nN || iy >= nN) return miss;
      return read(e, iy * nN + ix);
    };
    const gridAt = (cx, cy) => cellAt(cx, cy, (e, i) => (e.grid ? e.grid[i] : null), null);
    // THE SPAWN GATE, crossing tile seams the same way gridAt does: resolves
    // which tile entry actually owns (cx, cy) and asks THAT entry's own
    // isSpawnCell — its own roadMask AND spawnWhy — never a bare roadMask
    // read (which only answered the band question and, before this, let the
    // ring seed a tree or rock in a quiet corner or a yard behind a house).
    // Unresolvable cells read as refused — gridAt already refused them too.
    const spawnOkAt = (cx, cy, cls) => cellAt(cx, cy, (e, i) => {
      if (!e.grid) return false;
      const eN = e.cellsPerEdge;
      return WorldGen.isSpawnCell(e.grid, eN, eN, i % eN, Math.floor(i / eN), WorldGen.spawnOptsOf(e), cls);
    }, false);
    // The anchor's own tile has to be readable before anything can be planned.
    if (gridAt(spawnIX, spawnIY) == null) return;
    // And don't plan against HALF A MAP. Seating is spatial: a first pass that
    // can only see the anchor's tile spends the whole quota on the directions
    // it can reach and leaves the rest bare for good, because the quota is then
    // satisfied and no later pass wants anything. So wait until every tile the
    // ring reaches into has loaded. Bounded — a tile that never arrives must
    // not leave the player with no starter resources at all.
    scene._starterHomeDefers = (scene._starterHomeDefers || 0) + 1;
    if (scene._starterHomeDefers <= 8) {
      const R = HomeArea.RING_MAX_CELLS;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        if (gridAt(spawnIX + dx * R, spawnIY + dy * R) == null) return;
      }
    }
    // Occupancy from the anchor tile AND any loaded neighbour, so a seat can't
    // land on a tree that belongs to the tile next door.
    const atx = Math.floor(tx0 / scene.tileEdgeM), aty = Math.floor(ty0 / scene.tileEdgeM);
    for (const [k, e] of WorldGen.tileCache) {
      if (!e || !e.objects) continue;
      const parts = k.split('/');
      if (Math.abs(+parts[1] - atx) > 1 || Math.abs(+parts[2] - aty) > 1) continue;
      for (const o of e.objects) mark(o.x, o.y);
      for (const w of (e.wildplants || [])) mark(w.x, w.y);
    }
    for (const o of entry.objects) mark(o.x, o.y);
    for (const w of (entry.wildplants || [])) mark(w.x, w.y);
    // The soil plot is a 2x2 the player is about to till — keep it clear.
    const plot = scene.save.starterPlotAt;
    if (plot && Number.isFinite(plot.x)) {
      const pcx = Math.floor((plot.x - tx0) / cellM);
      const pcy = Math.floor((plot.y - ty0) / cellM);
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) taken.add(key(pcx + dx, pcy + dy));
    }
    // Nothing goes in the Home trailer's moat (clearHomeTrailerOverlap would
    // sweep it away) or on a crate seat.
    // Every kind seated here (tree, rock, wreck, mushroom, and the 'ladder' —
    // a real cave entrance, see _starterHomeObject) shares this one candidate
    // pool, so it reads as the loosest class the ring seats: 'minor'. The
    // ladder's own row (SPAWN_CLASS_BLOCKS.cave) would also refuse SENSITIVE
    // ground (a churchyard corner) — a difference from 'minor' only a starter
    // ring beside a real graveyard would ever hit, and not worth splitting
    // this shared pool per kind for.
    const free = (cx, cy) => {
      if (Math.max(Math.abs(cx - spawnIX), Math.abs(cy - spawnIY)) <= 1) return false;
      if (usedSeats.has(key(cx, cy)) || taken.has(key(cx, cy))) return false;
      // BLOCKED covers the road TERRAIN; THE SPAWN GATE covers the rest of
      // the band the player sees drawn over it, plus a quiet corner or a
      // yard behind a house. The first thing a new player is taught to chop
      // cannot be standing in the street.
      if (!spawnOkAt(cx, cy, 'minor')) return false;
      const t = gridAt(cx, cy);
      return t != null && !blocked(t);
    };

    // Seating spreads items around the COMPASS, not along one edge. The
    // obvious ring scan (for dy… for dx… take the first free cell) walks the
    // ring's cells in order and so drops every item on its north row, two
    // cells apart: a player who walked north tripped over all of them and one
    // who walked any other direction found nothing at all. Instead each item
    // gets a target bearing, evenly spaced around the circle, and takes the
    // free cell closest to it — so setting off in any direction runs into
    // something. Fixed order, no RNG: a rebuild reaching this path again would
    // reach the same answer.
    const placed = [];
    // Every free cell in a radius band, with its bearing from the anchor.
    const bandCells = (rMin, rMax) => {
      const out = [];
      WorldGen.ringCells(spawnIX, spawnIY, rMin, rMax, (cx, cy, r) => {
        if (free(cx, cy)) out.push({ cx, cy, r, bearing: Math.atan2(cy - spawnIY, cx - spawnIX) });
        return null;
      });
      return out;
    };
    // Cells within one step of something already seeded. Keeping this as a set
    // makes the spacing test O(1): rescanning every placement for every
    // candidate is quadratic, and at a quota of 50 each that alone cost most
    // of a second on the tile that builds under the player.
    const crowded = new Set();
    // `plain` pins the seat to the guaranteed beginner tier (the token pair —
    // the pocket's teaching examples must be workable bare-handed). Everything
    // else rolls rarity like a real deposit below, so the ring holds the
    // occasional better rock or bigger tree instead of fifty identical props.
    const seatAt = (kind, cells, bearing, plain) => {
      let best = null, bestScore = Infinity;
      for (const c of cells) {
        if (c.used) continue;
        // Keep the seeded items a couple of cells apart so they read as
        // scenery rather than a stockpile.
        if (crowded.has(key(c.cx, c.cy))) continue;
        let da = Math.abs(c.bearing - bearing);
        if (da > Math.PI) da = 2 * Math.PI - da;
        // Direction dominates; among cells pointing the same way, take the
        // nearer one so the player meets it sooner.
        const score = da * 100 + c.r;
        if (score < bestScore) { bestScore = score; best = c; }
      }
      if (!best) return false;
      best.used = true;
      const raw = f.centre(best.cx, best.cy);
      // Snap to the canonical global cell centre, the basis every tap and
      // every other placed object uses (see seatCrate).
      const abs = worldMetersToAbsCell(scene, raw.x, raw.y);
      const c = absCellCenterMeters(scene, abs.cellIX, abs.cellIY);
      const rec = { k: kind, x: c.x, y: c.y, cx: best.cx, cy: best.cy,
        id: `starter_${kind}_${abs.cellIX}_${abs.cellIY}` };
      if (kind === 'tree') rec.variant = 1 + ((abs.cellIX ^ abs.cellIY) & 3);
      if (kind === 'wreck') {
        rec.address = (((abs.cellIX * 7919) ^ (abs.cellIY * 104729)) >>> 0) % 1000;
      }
      // Rarity roll for the ring fill — the SAME roll a real deposit gets, so
      // the provisioned home holds the occasional better find. Seeded off the
      // cell (never Math.random) and FROZEN into the record, so a rebuild
      // reproduces the same rock at the same tier — the world must not re-roll
      // itself. Legacy records carry no tier and fall back to the plain
      // starter shape in _starterHomeObject.
      if (!plain && (kind === 'rock' || kind === 'tree')) {
        const rollRng = WorldGen.makeRng(
          ((abs.cellIX * 73856093) ^ (abs.cellIY * 19349663)) >>> 0);
        if (kind === 'rock') {
          // Exactly a residential surface deposit's odds (~90% plain, then
          // the ore-subset weights — WorldGen.rollSurfaceRockTier).
          const t = WorldGen.rollSurfaceRockTier(rollRng);
          if (t.yieldTier > 1) { rec.yieldTier = t.yieldTier; rec.requiredTier = t.requiredTier; }
        } else {
          // Trees have no tier table, so they borrow the deposits' rarity
          // SHAPE: the same ~10% that would have rolled ore instead grows a
          // size up — mostly medium (Wood-axe pine, 2× wood), rarely large
          // (Copper axe, 4×). Species stays the home softwood, so the find is
          // a bigger payday, not a wall.
          const r = rollRng();
          const plainP = WorldGen.SURFACE_PLAIN_ROCK_P ?? 0.90;
          if (r >= plainP) rec.size = (r >= 1 - (1 - plainP) * 0.3) ? 'large' : 'medium';
        }
      }
      taken.add(key(best.cx, best.cy));
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) crowded.add(key(best.cx + dx, best.cy + dy));
      }
      placed.push(rec);
      return true;
    };

    // The token pair goes in the pocket; everything else in the ring outside
    // it. The tokens are NOT conditional on the quota still being short: the
    // pocket is deliberately cleared of trees and rocks, so a spawn in dense
    // woodland can satisfy the whole quota out in the ring and still leave a
    // player at their own front door with nothing in sight to chop or mine.
    // If the quota did still want one, the token counts toward it.
    const POCKET = HomeArea.POCKET_CELLS;
    const TOKEN0 = HomeArea.TOKEN_MIN_CELLS;
    const R0 = HomeArea.RING_MIN_CELLS, R1 = HomeArea.RING_MAX_CELLS;
    // Widen the search when the band can't take something. A spawn on a pier or
    // a riverbank has most of its ring in water, and an all-water spawn would seat
    // nothing, leaving no wreck to rebuild. Built lazily — the wide band is only paid for if needed.
    let wideCells = null;
    const seatOrWiden = (kind, cells, bearing, plain) => {
      if (seatAt(kind, cells, bearing, plain)) return true;
      if (!wideCells) wideCells = bandCells(R0, HomeArea.RING_MAX_ESCALATED_CELLS);
      return seatAt(kind, wideCells, bearing, plain);
    };
    const pocketCells = bandCells(TOKEN0, POCKET);
    // Opposite sides of the doorway, so one doesn't hide behind the other.
    // Seated PLAIN (no rarity roll): these are the examples the first two
    // lessons are performed on, so they must stay bare-hands workable.
    let tokensWanted = 0, tokensSeated = 0;
    if (plan.tokens.tree) {
      tokensWanted++;
      if (seatOrWiden('tree', pocketCells, 0, true)) { tokensSeated++; plan.need.tree = Math.max(0, plan.need.tree - 1); }
    }
    if (plan.tokens.rock) {
      tokensWanted++;
      if (seatOrWiden('rock', pocketCells, Math.PI, true)) { tokensSeated++; plan.need.rock = Math.max(0, plan.need.rock - 1); }
    }
    const ringCells = bandCells(R0, R1);
    // The way down, seated in the RING and seated FIRST. It's a landmark, not
    // scenery: one of a hundred entries in the round-robin below would get
    // whatever cell was left over after the trees and rocks had their pick,
    // which for a hemmed-in spawn means the far end of the escalated band.
    // Taking its cell before the queue runs keeps it a short walk out.
    // Its own bearing (due north) so it doesn't land in the same
    // neighbourhood as the token pair or read as part of the scenery.
    let ladderWanted = 0;
    if (plan.need.ladder > 0) {
      ladderWanted = 1;
      seatOrWiden('ladder', ringCells, -Math.PI / 2);
    }
    // Round-robin the kinds into the queue so the seating ORDER is fair — every
    // kind gets a pick of the good cells each round, instead of the last pool
    // taking whatever the first fifty seats left.
    //
    // The BEARING, though, comes from each item's index within its OWN pool,
    // never from its index in the queue. A queue-index bearing only spreads a
    // kind around the compass when every pool is the same size: round-robin
    // puts a SMALL pool entirely in the first rounds, so its items take the
    // first slice of the circle and nothing else. With six mushrooms against
    // fifty trees that is the whole quota of food in one wedge — the same
    // all-on-one-side bug the round-robin was added to fix, one level down.
    // Per-pool bearings walk each kind around the full circle on its own, and
    // the per-kind phase keeps two kinds from marching in lockstep on the same
    // bearings the whole way round.
    const KIND_PHASE = { tree: 0, rock: Math.PI / 2, wreck: Math.PI, mushroom: Math.PI * 1.5 };
    // atan2 (what a cell's own bearing is measured with) returns -PI..PI, and
    // seatAt's shortest-arc test assumes both sides are in that range.
    const wrapPi = (b) => b - 2 * Math.PI * Math.floor((b + Math.PI) / (2 * Math.PI));
    const pools = [['tree', plan.need.tree], ['rock', plan.need.rock],
                   ['wreck', plan.need.wreck], ['mushroom', plan.need.mushroom]];
    const queue = [];
    const totalWanted = pools.reduce((sum, [, count]) => sum + count, 0);
    for (let n = 0; queue.length < totalWanted; n++) {
      for (const [kind, count] of pools) {
        if (n >= count) continue;
        queue.push({ kind, bearing: wrapPi((2 * Math.PI * n) / count + KIND_PHASE[kind]) });
      }
    }
    for (const q of queue) seatOrWiden(q.kind, ringCells, q.bearing);
    const wanted = tokensWanted + ladderWanted + queue.length;

    // Freeze BOTH halves — what was added and what was tamed. Without the
    // second, a rebuild regenerates the naturals at full tier and the home
    // area silently gets harder. Passes accumulate: a top-up keeps everything
    // the earlier pass seated and adds only what it could not reach then.
    for (const rec of placed) { delete rec.cx; delete rec.cy; }
    const prev = scene.save.starterHome;
    scene.save.starterHome = {
      v: 1,
      placed: (prev && prev.placed ? prev.placed : []).concat(placed),
      tamed: [...new Set((prev && prev.tamed ? prev.tamed : []).concat(tamed))],
      // Everything this pass set out to seat actually found a cell, so there
      // is nothing for a later pass to finish.
      done: placed.length >= wanted,
      tries: ((prev && prev.tries) || 0) + 1,
    };
    for (const rec of placed) inject(rec);
    reconcileClaims();
    if (typeof persistSave === 'function') persistSave(scene.save);
  }

  // ── The doorstep greeter ───────────────────────────────────────────────────
  // The creatures guaranteed around the starting trailer, whatever the tile's
  // biome roll gave it: a chicken on easy, slimes on hard
  // (Difficulty.get().homeGreeter). They are the first living things a new save
  // sees, and they say which game this is before any text does — a bird you can
  // feed and catch, or the neighbourhood already surrounded.
  //
  // The mode's row says how many and where: `homeGreeterDirs` names a compass
  // point per seat (hard takes all four, so whichever way the player walks off
  // the doorstep there is one), and `homeGreeterCells` how far out each stands.
  // A row that names no direction gets ONE, on the nearest legal cell of the
  // ring at that distance — easy's chicken, seated as it always was.
  //
  // Seated by the SHARED spawn rule (WorldGen.isSpawnCell over the tile's own
  // roadMask), nearest legal cell to each seat's ideal point. The fallback pass
  // drops only the residential-frontage clause — never the road mask: "always"
  // does not license standing an animal on the carriageway, and a seat with
  // nowhere legal to stand within HOME_GREETER_SLACK_CELLS simply isn't filled
  // (a direction that falls off the starter tile's own edge is one such: the
  // placer writes to that one entry, never a neighbour's).
  //
  // Deliberately NOT routed through the pest amnesty (_pestFreeZone): the mode
  // that seats a slime is the mode with no amnesty, and an amnesty that pushed
  // this one away would quietly undo the guarantee.
  //
  // Idempotent, and self-correcting on the mode. It runs from spawnInTile (the
  // starter tile's build), from _setStarterCratesAt (the anchor freezing after
  // that tile already spawned) and from chooseMode (the card answered after the
  // tile was built with the default-easy chicken) — so a greeter of the WRONG
  // kind, or one left over on a seat this mode does not ask for, is removed
  // rather than left standing beside the right ones.
  // Killed or caught, it stays gone: save.caught is checked by id, and each
  // seat carries its own, so dealing with one leaves the rest standing.
  function placeHomeGreeter(scene, entry, tx, ty) {
    if (typeof Difficulty === 'undefined') return;
    const prof = Difficulty.get();
    const kind = prof.homeGreeter;
    // Only a tile that has already rolled its fauna — seating onto a
    // not-yet-spawned entry would hand spawnInTile a non-empty creatures array
    // and its `entry.creatures || creatures` would keep MY one and drop the
    // whole tile's roll.
    if (!entry || !entry.grid || !entry._spawned) return;
    const anchor = scene.save.starterCratesAt || scene._starterTrailAnchor();
    if (!anchor || !Number.isFinite(anchor.x)) return;
    entry.creatures = entry.creatures || [];
    // The seats this mode asks for. A row that names no direction asks for one,
    // anywhere on the ring — the `null` seat below.
    const dirs = (Array.isArray(prof.homeGreeterDirs) && prof.homeGreeterDirs.length)
      ? prof.homeGreeterDirs : [null];
    // Only the mode's own greeters stand: drop any left by an earlier mode, or
    // on a seat this mode does not ask for. A PET is never swept — a
    // sapphire-tamed slime is re-minted with a `released_` id (interact.js
    // `releasedId`) that carries none of this tag, but the guard is here anyway
    // because sweeping someone's pet is not a bug worth finding out about in
    // the field.
    const tag = `_greeter_${tx}_${ty}`;
    const idFor = (dir) => `${kind || ''}${dir ? '_' + dir : ''}${tag}`;
    const wanted = new Set(dirs.map(idFor));
    const stale = entry.creatures.filter(c => typeof c.id === 'string'
      && c.id.endsWith(tag) && !wanted.has(c.id) && !Combat.isTame(c));
    if (stale.length) entry.creatures = entry.creatures.filter(c => !stale.includes(c));
    if (!kind) return;                                   // a mode with no greeter

    const f = WorldGen.tileFrame(entry, tx, ty, scene.tileEdgeM);   // THIS tile's cells (its row's grid)
    const { N } = f;
    const { ix: ax, iy: ay } = f.cellOf(anchor.x, anchor.y);
    // Cells already carrying something drawn — a chicken standing inside a
    // starter crate reads as a bug whichever the renderer draws second.
    const occupied = WorldGen.occupiedIndexSet(f, entry.objects, entry.wildplants);
    // The doorstep greeter is the starting area's (a MINOR spawn — see the
    // starter trail's note): the land the spawn gate refuses, not its
    // buffers — the entry's full options with this pass's live occupancy.
    const opts = WorldGen.spawnOptsOf(entry, { occupied });
    // ALLOWLISTED raw roadMask read (spawn_gate_sweep.test.js): NOT the seat
    // test (that's `pickaxe`'s primary pass below, THE SPAWN GATE via
    // isSpawnCell(..., opts, 'minor')). This is the "always" greeter's
    // fallback ONLY — a mode that promises a seat on every save must still
    // never stand an animal in the carriageway, but is allowed to ignore
    // every softer reason (frontage, a yard behind a house, quiet land) the
    // gate would otherwise refuse. Deliberately not isSpawnCell: routing the
    // fallback through the gate would refuse cells "always" is supposed to
    // still fill. See the doorstep-greeter comment above.
    const onRoad = (cx, cy) => !!entry.roadMask && entry.roadMask[cy * N + cx] === 1;
    const standable = (cx, cy) =>
      f.inTile(cx, cy) &&
      !occupied.has(cy * N + cx) &&
      !Combat.faunaBlocksCell(entry.grid[cy * N + cx]) &&
      !WorldGen.isRoadTerrain(entry.grid[cy * N + cx]);   // a seat is never on a street
    // The mode's own distance, never nearer than the placer's floor.
    const dist = Math.max(HOME_GREETER_MIN_CELLS, prof.homeGreeterCells || 0);
    // Nearest cell to (ix, iy) that `accept`s, within `slack` of it and still
    // inside the placer's own ring from the trailer. Scanned in a fixed order,
    // so the same anchor always seats the same cells — a placer that wandered
    // would move its greeters every time the tile rebuilt under the player.
    const pick = (ix, iy, slack, accept) => {
      let best = null, bestD = Infinity;
      for (let cy = iy - slack; cy <= iy + slack; cy++) {
        for (let cx = ix - slack; cx <= ix + slack; cx++) {
          const d = Math.max(Math.abs(cx - ix), Math.abs(cy - iy));           // off the ideal
          const dh = Math.max(Math.abs(cx - ax), Math.abs(cy - ay));          // out from home
          if (d >= bestD) continue;
          if (dh < HOME_GREETER_MIN_CELLS || dh > HOME_GREETER_MAX_CELLS) continue;
          if (!standable(cx, cy) || !accept(cx, cy)) continue;
          best = { cx, cy }; bestD = d;
        }
      }
      return best;
    };
    for (const dir of dirs) {
      const id = idFor(dir);
      if (entry.creatures.some(c => c.id === id)) continue;  // already standing
      if (scene.save.caught?.includes(id)) continue;          // dealt with, stays gone
      const vec = dir ? HOME_GREETER_DIR_VEC[dir] : null;
      if (dir && !vec) continue;                             // a direction nobody drew
      // A named direction aims at its own point `dist` out and may be nudged
      // by the slack. The unnamed seat aims at the TRAILER, so its slack has
      // to carry the ring's radius too: nearest legal cell of the ring, in
      // whatever direction the ground allows.
      const ix = ax + (vec ? vec[0] * dist : 0);
      const iy = ay + (vec ? vec[1] * dist : 0);
      const slack = vec ? HOME_GREETER_SLACK_CELLS : dist + HOME_GREETER_SLACK_CELLS;
      const seat = pick(ix, iy, slack, (cx, cy) => WorldGen.isSpawnCell(entry.grid, N, N, cx, cy, opts, 'minor'))
                || pick(ix, iy, slack, (cx, cy) => !onRoad(cx, cy));
      if (!seat) continue;
      occupied.add(seat.cy * N + seat.cx);   // no two seats on the one cell
      const at = f.centre(seat.cx, seat.cy);
      entry.creatures.push(WorldGen.makeCreature(kind, at.x, at.y, id, { shiny: faunaShiny(kind, id) }));
    }
  }

  // THE STORY NEIGHBOURS. The safe area's WARDEN and the three story
  // neighbours (NPC.STORY_NEIGHBOURS — the survivor of the Warmonger's night,
  // the wanderer without a home, the wizard's believer) stand a few cells
  // from the starting trailer, in either mode. The warden says why the
  // ground round Home is quiet (NPC.WARDEN_LINE — the safe area, EnemySpawns
  // homeAllows), and — on a tap, never as a splash — the family's plea
  // (MemoryStory.HOME); the others speak through MemoryStory.npcDialogue.
  // WHEN each is here is the memory ledger's call (NPC.storyNeighbourDue —
  // the wanderer from the first morning, the rest as memories return), so a
  // new save has the one neighbour on screen; a row that `arrives` another
  // way (the survivor, through StoryEncounters) is never seated here; the arrivals pass
  // (NPC.tickArrivals) calls back here as the count grows, with `seating.
  // offscreen` so nobody is watched appearing. PLACED, like the greeter:
  // they belong to this player's starting area, so their ids are the starter
  // tile's (`npc_<role>_<tx>_<ty>`) and they are seated off the frozen
  // anchor, each on the nearest legal cell in the WARDEN_MIN..MAX_CELLS ring
  // (the warden) or the wider NEIGHBOUR_MAX_CELLS ring (the rest), scanned
  // in a fixed order. The warden is seated first so its cell never moves
  // when the others arrive; the rest keep NEIGHBOUR_GAP_CELLS from every
  // story neighbour already seated, so they spread round the trailer rather
  // than queue along one ring. Idempotent per id; only a tile that has
  // already spawned. Returns how many it seated just now.
  const WARDEN_MIN_CELLS = 3;
  const WARDEN_MAX_CELLS = 6;
  const NEIGHBOUR_MAX_CELLS = 8;
  const NEIGHBOUR_GAP_CELLS = 2;
  function placeSafeAreaWarden(scene, entry, tx, ty, seating = {}) {
    if (typeof NPC === 'undefined' || !entry || !entry.grid || !entry._spawned) return 0;
    const anchor = scene.save.starterCratesAt || scene._starterTrailAnchor();
    if (!anchor || !Number.isFinite(anchor.x)) return 0;
    entry._starterTile = true;   // the arrivals pass knows where to call back
    entry.creatures = entry.creatures || [];
    const f = WorldGen.tileFrame(entry, tx, ty, scene.tileEdgeM);
    const { N } = f;
    const { ix: ax, iy: ay } = f.cellOf(anchor.x, anchor.y);
    // Everything standing on the tile, creatures included — the live
    // occupancy, handed to the gate with the entry's full options (the
    // same gate every other seat on the tile is judged by).
    const occupied = WorldGen.occupiedIndexSet(f, entry.objects, entry.wildplants, entry.creatures);
    const opts = WorldGen.spawnOptsOf(entry, { occupied });
    const roles = (NPC.STORY_NEIGHBOURS || ['warden']).filter(role => !NPC.STORY_ROLES[role]?.radiusM && !NPC.STORY_ROLES[role]?.arrives);
    const seated = [];   // story neighbours' cells, present already or seated now
    for (const role of roles) {
      const c = entry.creatures.find(o => o.id === `npc_${role}_${tx}_${ty}`);
      if (c) seated.push(f.cellOf(c.x, c.y));
    }
    let placed = 0;
    for (const role of roles) {
      const id = `npc_${role}_${tx}_${ty}`;
      if (entry.creatures.some(c => c.id === id)) continue;
      if (!NPC.storyNeighbourDue(scene.save, role)) continue;
      const maxR = role === 'warden' ? WARDEN_MAX_CELLS : NEIGHBOUR_MAX_CELLS;
      // The nearest ring cell (WorldGen.nearestRingCell — a fixed order)
      // that the gate admits and no story neighbour crowds.
      const seat = WorldGen.nearestRingCell(ax, ay, WARDEN_MIN_CELLS, maxR, (cx, cy) => {
        if (!f.inTile(cx, cy)) return false;
        if (role !== 'warden' && seated.some(s => Math.max(Math.abs(s.ix - cx), Math.abs(s.iy - cy)) < NEIGHBOUR_GAP_CELLS)) return false;
        if (Combat.faunaBlocksCell(entry.grid[cy * N + cx])) return false;
        return WorldGen.isSpawnCell(entry.grid, N, N, cx, cy, opts, 'npc');
      });
      if (!seat) continue;
      const { x, y } = f.centre(seat.ix, seat.iy);
      if (seating.offscreen && !seating.offscreen(x, y)) continue;
      const neighbour = WorldGen.makeCreature('npc', x, y, id, { ...NPC.storyNeighbour(id, role), homeX: x, homeY: y });
      entry.creatures.push(neighbour);
      occupied.add(seat.iy * N + seat.ix);
      seated.push(seat);
      placed++;
    }
    return placed + placeDistantStoryNeighbours(scene, seating, { entry, tx, ty });
  }

  // Distant story residents belong to the original Home, even after it moves.
  // Search the loaded surface across tile seams, then freeze a legal reachable
  // seat on the save. Missing tiles defer the search; they never become land.
  function placeDistantStoryNeighbours(scene, seating = {}, suppliedTile = null) {
    if (typeof NPC === 'undefined' || (scene.depth || 0) !== 0) return 0;
    const anchor = scene._sandboxMode ? scene.homeWorldPos?.() : scene.save.starterCratesAt;
    if (!anchor || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) return 0;
    const edge = scene.tileEdgeM;
    const tiles = new Map(WorldGen.tileCacheFor(0));
    if (suppliedTile) tiles.set(WorldGen.tileKey(suppliedTile.tx, suppliedTile.ty), suppliedTile.entry);
    const at = (x, y) => {
      const tx = Math.floor(x / edge), ty = Math.floor(y / edge);
      const entry = tiles.get(WorldGen.tileKey(tx, ty));
      if (!entry?._spawned || !entry.grid) return null;
      const fr = WorldGen.tileFrame(entry, tx, ty, edge);
      const { ix: cx, iy: cy } = fr.cellOf(x, y), c = fr.centre(cx, cy);
      return { entry, tx, ty, N: fr.N, cellM: fr.cellM, cx, cy, x: c.x, y: c.y, key: `${tx}:${ty}:${cx}:${cy}` };
    };
    const around = c => [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) =>
      at(c.x + dx * (c.cellM / 2 + 0.001), c.y + dy * (c.cellM / 2 + 0.001))).filter(Boolean);
    const road = c => WorldGen.isRoadTerrain(c.entry.grid[c.cy * c.N + c.cx]) || c.entry.grid[c.cy * c.N + c.cx] === WorldGen.T.PATH;
    const occupied = new Map();
    const free = (c, includeCreatures = true) => {
      if (!occupied.has(c.entry)) {
        const fixed = new Set();
        for (const o of [...(c.entry.objects || []), ...(c.entry.wildplants || [])]) {
          const p = at(o.x, o.y);
          if (p) fixed.add(p.key);
        }
        const all = new Set(fixed);
        for (const o of c.entry.creatures || []) { const p = at(o.x, o.y); if (p) all.add(p.key); }
        occupied.set(c.entry, { fixed, all });
      }
      return !occupied.get(c.entry)[includeCreatures ? 'all' : 'fixed'].has(c.key)
        && WorldGen.isSpawnCell(c.entry.grid, c.N, c.N, c.cx, c.cy, WorldGen.spawnOptsOf(c.entry), 'npc');
    };
    let placed = 0;
    for (const [role, row] of Object.entries(NPC.STORY_ROLES)) {
      if (!row.radiusM || !NPC.storyNeighbourDue(scene.save, role)) continue;
      const id = `npc_${role}_${Math.floor(anchor.x / edge)}_${Math.floor(anchor.y / edge)}`;
      if ([...tiles.values()].some(e => e.creatures?.some(c => c.id === id))) continue;
      const owner = scene._sandboxMode ? scene : scene.save;
      const ledgerKey = scene._sandboxMode ? '_sandboxStoryNeighbourSeats' : 'storyNeighbourSeats';
      if (!owner[ledgerKey] || typeof owner[ledgerKey] !== 'object' || Array.isArray(owner[ledgerKey])) owner[ledgerKey] = {};
      const ledger = owner[ledgerKey];
      let point = ledger[role];
      if (point && (!Number.isFinite(point.x) || !Number.isFinite(point.y)
        || Math.abs(Math.hypot(point.x - anchor.x, point.y - anchor.y) - row.radiusM) > row.radiusM * 0.3)) {
        delete ledger[role];
        point = null;
      }
      // A changed landscape may cover an old dig. Only a loaded, permanently
      // blocked seat triggers relocation; streaming and passing people do not.
      const oldSeat = point && at(point.x, point.y);
      if (oldSeat && !free(oldSeat, false)) point = null;
      if (!point) {
        const start = at(anchor.x, anchor.y);
        if (!start) continue;
        const slack = Math.max(start.cellM * 3, row.radiusM * 0.1);
        const queue = [start], seen = new Set([start.key]), candidates = [];
        for (let head = 0; head < queue.length; head++) {
          const c = queue[head], d = Math.hypot(c.x - anchor.x, c.y - anchor.y);
          if (Math.abs(d - row.radiusM) <= slack && free(c)) {
            candidates.push({ ...c, error: Math.abs(d - row.radiusM), verge: road(c) || around(c).some(road) });
          }
          for (const next of around(c)) {
            if (seen.has(next.key) || Math.hypot(next.x - anchor.x, next.y - anchor.y) > row.radiusM + slack * 2) continue;
            seen.add(next.key);
            if (!starterRoutePassable(next.entry.grid[next.cy * next.N + next.cx])) continue;
            queue.push(next);
          }
        }
        candidates.sort((a, b) => Number(b.verge) - Number(a.verge) || a.error - b.error || a.x - b.x || a.y - b.y);
        const chosen = candidates[0];
        if (!chosen) continue;
        point = { x: chosen.x, y: chosen.y };
        ledger[role] = point;
        if (!scene._sandboxMode && typeof persistSave === 'function') persistSave(scene.save);
      }
      const seat = at(point.x, point.y);
      if (!seat || !free(seat) || (seating.offscreen && !seating.offscreen(point.x, point.y))) continue;
      const neighbour = WorldGen.makeCreature('npc', point.x, point.y, id,
        { ...NPC.storyNeighbour(id, role), homeX: point.x, homeY: point.y });
      (seat.entry.creatures ||= []).push(neighbour);
      occupied.get(seat.entry).all.add(seat.key);
      placed++;
    }
    return placed;
  }

  // A memory has just been banked (app.js _bankDiscovery): seat whichever
  // story neighbour it brings, if the starter tile is up — off screen only,
  // like every arrival (NPC.offscreenAt); a seat in view waits for the
  // arrivals pass (NPC.tickArrivals) to find the player looking elsewhere.
  function seatStoryNeighbours(scene) {
    const home = scene._starterTileEntry?.();
    if (!home) return 0;
    const offscreen = typeof NPC !== 'undefined' && NPC.offscreenAt ? NPC.offscreenAt(scene) : undefined;
    return placeSafeAreaWarden(scene, home.entry, home.tx, home.ty, { offscreen });
  }

  // Hard mode has no supply handout: drop the starter crates (the `crate: true`
  // chests _placeStarterTrail seats) from a tile. The relic chest at the end of
  // the trail is TREASURE, not supplies, and stays. Idempotent; a no-op on easy.
  function stripStarterCrates(scene, entry) {
    if (typeof Difficulty === 'undefined' || Difficulty.get().starterCrates) return;
    if (!entry || !Array.isArray(entry.objects)) return;
    const kept = entry.objects.filter(o => !(o.kind === 'chest' && o.crate));
    if (kept.length !== entry.objects.length) entry.objects = kept;
  }

  // Ground hints only: the route uses the placement gate (including suppressed
  // land), never changes terrain, reach, fog, or where the player can walk.
  const TRAIL_STYLE = Object.freeze({ colour: 0xf5dda2, alpha: 0.45, width: 1.5, dash: 6, gap: 5, bendCells: 0.28 });
  const trailCellKey = c => `${c.cellIX},${c.cellIY}`;
  const TRAIL_STEPS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

  function trailRoute(start, goal, passable, neighbour, seed = 0) {
    const sk = trailCellKey(start), gk = goal && trailCellKey(goal);
    if (!passable(start) || (goal && !passable(goal))) return [];
    const queue = [start], parents = new Map([[sk, null]]), cells = new Map([[sk, start]]);
    const steps = new Map([[sk, 0]]), candidates = [];
    const unwind = key => {
      const route = [];
      for (let k = key; k != null; k = parents.get(k)) route.push(cells.get(k));
      return route;
    };
    for (let head = 0; head < queue.length && head < 1200; head++) {
      const c = queue[head], ck = trailCellKey(c), distance = steps.get(ck);
      if (ck === gk) return unwind(ck).reverse();
      // An extra trail begins at a seeded reachable point 4–7 walking cells
      // from its chest. One reverse flood chooses it; no repeated pathfinding.
      if (!goal && distance >= 4) candidates.push(ck);
      if (!goal && distance >= 7) continue;
      for (const [dx, dy] of TRAIL_STEPS) {
        const next = neighbour(c, dx, dy), nk = trailCellKey(next);
        if (parents.has(nk) || !passable(next)) continue;
        parents.set(nk, ck); cells.set(nk, next); steps.set(nk, distance + 1); queue.push(next);
      }
    }
    return !goal && candidates.length ? unwind(candidates[(seed >>> 0) % candidates.length]) : [];
  }

  // Round a bend INSIDE its own cell. Unlike smoothing the whole polyline,
  // this quadratic cannot cut through the blocked cell beside an L-turn.
  function smoothTrail(points, cellM) {
    if (points.length < 3) return points.slice();
    const out = [points[0]], radius = cellM * TRAIL_STYLE.bendCells;
    for (let i = 1; i < points.length - 1; i++) {
      const a = points[i - 1], b = points[i], c = points[i + 1];
      const ab = Math.hypot(b.x - a.x, b.y - a.y), bc = Math.hypot(c.x - b.x, c.y - b.y);
      if (!ab || !bc) continue;
      const r = Math.min(radius, ab / 3, bc / 3);
      const p = { x: b.x + (a.x - b.x) * r / ab, y: b.y + (a.y - b.y) * r / ab };
      const q = { x: b.x + (c.x - b.x) * r / bc, y: b.y + (c.y - b.y) * r / bc };
      out.push(p);
      for (let step = 1; step <= 6; step++) {
        const t = step / 6, u = 1 - t;
        out.push({ x: u * u * p.x + 2 * u * t * b.x + t * t * q.x,
          y: u * u * p.y + 2 * u * t * b.y + t * t * q.y });
      }
    }
    out.push(points[points.length - 1]);
    return out;
  }

  function trailPaths(scene, now) {
    const anchor = scene.save.starterCratesAt;
    const player = playerWorldM(scene), radius = HomeArea.RING_MAX_CELLS;
    if ((scene.depth || 0) !== 0 || !anchor || !Number.isFinite(anchor.x)
      || !HomeArea.isNear(player.x, player.y, radius * scene.cellM, anchor)) return [];
    const start = worldMetersToAbsCell(scene, player.x, player.y);
    const key = `${trailCellKey(start)}|${anchor.x},${anchor.y}|${(scene.save.opened || []).length}|${WorldGen.tileCache.size}`;
    const old = scene._starterTrailPaths;
    if (old && old.key === key && now - old.at < 1000) return old.paths;
    const paths = [];
    scene._starterTrailPaths = { key, at: now, paths };
    const target = scene._nearestStarterCrate?.();
    const extra = HomeArea.chestTrailCandidates?.(scene, anchor) || [];
    if (!target && !extra.length) return paths;
    const targets = [target, ...extra].filter(Boolean);
    const targetIds = new Set(targets.map(o => o.id));
    const spent = spentSets(scene, scene.save);
    const tiles = new Map(), checked = new Map();
    const passable = c => {
      const ck = trailCellKey(c);
      if (checked.has(ck)) return checked.get(ck);
      const world = absCellCenterMeters(scene, c.cellIX, c.cellIY);
      let ok = HomeArea.isNear(world.x, world.y, radius * scene.cellM, anchor);
      if (ok) {
        const t = absCellToTile(scene, c.cellIX, c.cellIY), tk = WorldGen.tileKey(t.tx, t.ty);
        if (!tiles.has(tk)) {
          const entry = WorldGen.tileCache.get(tk);
          let opts = null;
          if (entry?.grid && (!entry.status || entry.status === 'ready')) {
            const frame = WorldGen.tileFrame(entry, t.tx, t.ty, scene.tileEdgeM);
            const objects = (entry.objects || []).filter(o => !targetIds.has(o.id) && !isSpent(o, spent));
            const occupied = WorldGen.occupiedIndexSet(frame, objects);
            opts = WorldGen.spawnOptsOf(entry, { occupied });
          }
          tiles.set(tk, { entry, opts });
        }
        const { entry, opts } = tiles.get(tk);
        // 'reward' refuses both KERB and SENSITIVE, as well as all hard
        // reasons. The guide never invites a walk through suppressed land.
        ok = !!opts && WorldGen.isSpawnCell(entry.grid, t.n, t.n, t.ix, t.iy, opts, 'reward');
      }
      checked.set(ck, ok);
      return ok;
    };
    const neighbour = (c, dx, dy) => absCellOffset(scene, c.cellIX, c.cellIY, dx, dy);
    const add = (route, id) => {
      if (route.length > 1) paths.push({ id, points: smoothTrail(route.map(c => absCellCenterMeters(scene, c.cellIX, c.cellIY)), scene.cellM) });
    };
    if (target) add(trailRoute(start, worldMetersToAbsCell(scene, target.x, target.y), passable, neighbour), target.id);
    for (const chest of extra) {
      if (paths.length >= HomeArea.CHEST_TRAIL_LIMIT) break;
      const end = worldMetersToAbsCell(scene, chest.x, chest.y);
      add(trailRoute(end, null, passable, neighbour, strHash31(chest.id)), chest.id);
    }
    return paths;
  }

  root.Starter = {
    TRAIL_STYLE, trailRoute, smoothTrail, trailPaths,
    STARTER_LOOT,
    starterTrailAnchor,
    pestFreeZone,
    setStarterCratesAt,
    placeStarterTrail,
    scatterStarterStash,
    revealStarterTrail,
    placeStarterRelicChest,
    carveStarterPlot,
    carveStarterPond,
    paintPond,
    carveStarterPondAround,
    starterHomeObject,
    starterHomeWildplant,
    starterHomeStream,
    provisionStarterHome,
    placeHomeGreeter,
    placeSafeAreaWarden,
    placeDistantStoryNeighbours,
    seatStoryNeighbours,
    stripStarterCrates,
  };
})(typeof window !== 'undefined' ? window : globalThis);
