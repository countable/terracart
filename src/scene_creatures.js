// The scene's CREATURES — what lives on a tile, and how it moves once it
// does. Three pieces that share one list (entry.creatures):
//   · per-tile SPAWNING: spawnInTile (the surface pass — fauna, crows, traps,
//     the buried X marks and their bonus streams, placed saplings — drawn off
//     the tile's GENERATED layer and handed `_spawnOpts`, the shared road
//     mask + occupied set) with _cullOffLiveGround (the per-player cull after
//     it), and spawnCaveCreatures (the cave's monsters and traps by depth);
//   · the SIM: wanderCreatures (the per-tick loop — the `unnoticed` gate,
//     the fire / Home / castle wards, pets, the lairs' chase, the monsters'
//     hit and arrow, the ghosts' pump) with the wild crow's own tick
//     (_wildCrowTick) and its retreat (_crowDepart);
//   · CATCHING: startCatchProgress (the catch wheel the target flees) and
//     catchCreature (what a catch banks).
// Plus the constants only they read: MONSTER_HIT_MS, MONSTER_ARROW_HITS,
// FIRE_WARD_MAX_DEPTH, BEACH_X_PER_CELLS.
//
// Moved verbatim out of app.js. The methods live on `class SceneCreatures`,
// a MIXIN: app.js installs them onto MapScene.prototype right after the class
// closes (installSceneMixin, from modal_shell.js), so every caller still says
// `this.spawnInTile()` / `this.wanderCreatures()` and nothing else changed.
// The consts stay plain top-level lexical globals (never window.X — see
// lexical_globals.test.js). This file loads BEFORE app.js, so an initializer
// here may only read literals, names defined above it, or modules loaded
// earlier (Combat); the methods read app.js names (HOME_R, FIRE_REST_R,
// crowEatsCrop, persistSave, VIEW_CELLS, …), creature_ai.js's helpers and
// this._popEnergy / this._crowRaids / this._pestFreeZone / … at CALL time
// only.
//
// What this is NOT: the scene-free creature helpers (the slime's gait, flee /
// stalk pacing, the ghosts, the rout and wander-off, wardTrip — creature_ai.js
// holds those; this is the loop that calls them). Not COMBAT: HP, damage, the
// shots, auto-fire, bounty and the health bars (_combatTick, _damageEnemy,
// resolveDefeat, _dropBountyCoin, _turretFire — app.js, over combat.js). Not
// drawing (render.js draws the list), not the work wheel itself
// (startWorkProgress / _drawWorkProgress stay in app.js; the catch wheel only
// arms it), not traps' tick (_tickTraps), not the starter placers
// (starter.js, reached through app.js's one-line wrappers), and not Home's
// yard predicate (_crowRaids / homeGuardsCrop, app.js). See CLAUDE.md
// "NOTHING HUNTS A BODY", "Home is a CAMPFIRE YOU OWN", "Nothing spawns on a
// road" and "A tile can be REBUILT under you" before changing a branch here.

// Seconds between one monster's hits. Per user: monsters were landing a hit a
// second each, so a pack shredded the energy bar faster than it could be read —
// halved to one hit per 2 s. (The surface slime keeps its own 1 s cadence: it's
// a crop pest, not a cave enemy.)
const MONSTER_HIT_MS = 2000;
// A RANGED monster's arrow carries the hits its leech would have landed in the
// same time: the arrow's cadence (the castle turret's, Combat) over the leech
// cadence above — 10 s / 2 s = 5 hits per arrow. Derived, not tuned, so the
// archer deals per minute exactly what it dealt before its hits became a
// visible arrow, and a change to either cadence keeps that correspondence.
const MONSTER_ARROW_HITS = Combat.MONSTER_SHOT_INTERVAL_MS / MONSTER_HIT_MS;
// FIRE WARD DEPTH CAP: a campfire only turns away the WEAKEST cave-dwellers —
// those introduced at the first cave level (Combat.MONSTERS[kind].minDepth <= 1),
// the same tier as the surface slime it already deters. A goblin (minDepth 2)
// or goblin archer (minDepth 3) — and their giants, pushed GIANT_DEPTH_STEP
// deeper still — are past what a lit campfire can plausibly hold off; only
// Home's stronger ward (HOME_R, surface only) turns those around.
const FIRE_WARD_MAX_DEPTH = 1;

// ── Buried X marks: how thick they lie on SAND ────────────────────────────
// A tile's X marks are a flat scatter of 4-10 over every walkable cell plus a
// bonus stream beside footpaths — over a 2.4 km tile that is nothing at all
// along a shoreline, and a beach is the one ground people actually dig. So
// sand gets its own bonus stream, capped at one mark per BEACH_X_PER_CELLS
// cells of it so a golf bunker or a sandpit can't draw the whole roll while a
// real beach can. Read by spawnInTile's beach block; pinned by
// test/node/beach_treasure.test.js.
const BEACH_X_PER_CELLS = 20;

class SceneCreatures {
  spawnInTile(entry, tx, ty) {
    const rng = WorldGen.makeRng(tx * 0x1f1f1f1f ^ ty * 0x12345);
    const creatures = [];
    const N = entry.cellsPerEdge;
    // Frame metres per cell of THIS tile's grid (its row's N, not the save's
    // cellsPerTile, and never the nominal cellM — CLAUDE.md "Every player sees
    // the SAME generated world"). Every metre⇄cell step below goes through it.
    const cellM = this.tileEdgeM / N;
    // What the draws below ASK is the tile's GENERATED layer — baseGrid /
    // genObjects, frozen by loadTile before anything per-player or
    // order-dependent lands on it (the starter plot and pond repaint cells,
    // the home stair, an Overpass bin's chests that were only there if they
    // happened to be cached). An answer read off the live entry would change
    // which attempt succeeds, and so every later draw of this tile's stream,
    // for one player (CLAUDE.md "Every player sees the SAME generated world").
    // What the live entry holds instead is applied AFTER the draws, as a
    // cull (see _cullOffLiveGround at the end of this pass).
    const genGrid = entry.baseGrid || entry.grid;
    const genObjects = entry.genObjects || entry.objects || [];
    // Memoised Set, not an Array.includes: tryPlace below calls this per
    // spawn ATTEMPT (up to 12 per creature, across every species in
    // FAUNA_ORDER), so an .includes here was an O(save.caught length) scan
    // hundreds of times per tile build — the same failure shape util.js's
    // setOf was written for (see its comment), and app.js already uses it
    // for exactly this check in the per-frame wander/render loops.
    const caughtSet = setOf(this.save.caught);
    // Cells the tile's own rasterize pass already put something on — a tree,
    // a rock, a chest, a produce stand, a tuft of grass. Snapshotted ONCE,
    // before this method adds anything of its own, into the same flat-index
    // shape roadMask already uses (cy*N+cx), so isSpawnCell can check both
    // with one lookup. Without it a trap could spring under a rock sprite (the
    // art is its only warning — see traps.js) or an X mark could bury itself
    // under a tree, undiggable until the tree is felled: roads and buildings
    // were never the whole rule, just the two terrain alone could see.
    const _occupiedIdx = new Set();
    for (const o of genObjects) {
      const ix = Math.floor((o.x - tx * this.tileEdgeM) / cellM);
      const iy = Math.floor((o.y - ty * this.tileEdgeM) / cellM);
      if (ix >= 0 && iy >= 0 && ix < N && iy < N) _occupiedIdx.add(iy * N + ix);
    }
    for (const wp of (entry.wildplants || [])) {
      const ix = Math.floor((wp.x - tx * this.tileEdgeM) / cellM);
      const iy = Math.floor((wp.y - ty * this.tileEdgeM) / cellM);
      if (ix >= 0 && iy >= 0 && ix < N && iy < N) _occupiedIdx.add(iy * N + ix);
    }
    // Even pets only belong near street frontage / public space inside a
    // residential block, so creature placement shares the spawn rule too.
    // POI chests (already placed by worldgen) count as public anchors.
    const _spawnOpts = {
      // The tile's road footprint — wider than the road TERRAIN wherever the
      // real carriageway is (a motorway's band covers a cell either side of
      // the one it paints) and present at all in a parking lot, whose aisles
      // paint nothing. Without it the X-mark scatter below reads the grid,
      // is told "grass", and buries treasure in the middle of the asphalt.
      roadMask: entry.roadMask,
      occupied: _occupiedIdx,
      pois: genObjects
        .filter(o => o.kind === 'chest')
        .map(o => ({
          ix: Math.floor((o.x - tx * this.tileEdgeM) / cellM),
          iy: Math.floor((o.y - ty * this.tileEdgeM) / cellM),
        })),
    };
    // Home holds no slimes or crows until the first harvest (see
    // PEST_FREE_CELLS). Resolved once per tile build; null once the grace has
    // lapsed, which is the common case.
    const pestFree = this._pestFreeZone(tx, ty);
    const tryPlace = (classesOK, idx, kindStr) => {
      for (let attempt = 0; attempt < 12; attempt++) {
        const cx = Math.floor(rng() * N);
        const cy = Math.floor(rng() * N);
        const t = genGrid[cy * N + cx];
        if (classesOK.has(t)) {
          // Route EVERY candidate cell through the shared spawn rule, not just
          // RESIDENTIAL ones. isSpawnCell checks opts.roadMask FIRST — before
          // its residential-frontage logic — so gating the call on `t === 5`
          // (the old code) made the mask unreachable for grass/park/farmland/
          // etc., and a cow or crow could spawn on ground the player sees as
          // asphalt: a motorway's band covers a cell either side of the cells
          // it paints, and a parking lot's aisles paint no road cells at all.
          // This does NOT impose the frontage rule on non-residential terrain:
          // isSpawnCell returns true right after the walkable+roadMask checks
          // for any `here !== T.RESIDENTIAL` cell (worldgen.js:132), so grass
          // etc. only ever pays the (cheap) roadMask lookup, never the
          // frontage scan. See CLAUDE.md's road-mask invariant / FINDING 2 /
          // test/node/fauna_spawn.test.js.
          if (!WorldGen.isSpawnCell(genGrid, N, N, cx, cy, _spawnOpts)) continue;
          const wmx = tx * this.tileEdgeM + (cx + 0.5) * cellM;
          const wmy = ty * this.tileEdgeM + (cy + 0.5) * cellM;
          const id = `${kindStr}_${tx}_${ty}_${idx}`;
          if (caughtSet.has(id)) return;
          // The pest amnesty DROPS a slime or crow that lands in the zone —
          // after the cell was drawn exactly as it would be for anyone else.
          // It used to re-roll (`continue`) instead, which took extra draws out
          // of the shared stream and reshuffled every later spawn on this tile
          // for this one player (CLAUDE.md "Every player sees the SAME
          // generated world": per-player state may hide a thing, never move
          // the others). Thinning the starting area is the point anyway.
          if ((kindStr === 'slime' || kindStr === 'crow') && pestFree && pestFree.has(cx, cy)) return;
          // ~5% of wild animals spawn as the rare shiny variant — stamped at
          // spawn off the stable id so it survives reloads and rides along
          // through tame/release/re-catch. The slime exception (an energy pest
          // with no catch payout never goes shiny) lives in faunaShiny, so the
          // doorstep greeter below obeys it through the same call.
          creatures.push(WorldGen.makeCreature(kindStr, wmx, wmy, id,
            { shiny: faunaShiny(kindStr, id) }));
          return;
        }
      }
    };
    // Biome-biased fauna spawn — each species' primary (dominant) biome set,
    // wider fallback set, count and primary-share come from the central registry
    // (BIOME_FAUNA in src/biome_profiles.js). ~`share` of a species' count goes
    // to its primary biomes, the rest to the fallback set, so animals read
    // correct (cows in fields, butterflies in parks, pets in the suburbs) while
    // still scattering everywhere — and extending the sets to the newly-wired
    // biomes is what finally puts fauna in wetland / commercial / industrial
    // zones. Iteration order (FAUNA_ORDER) and per-species id scheme are
    // unchanged so seeds reproduce. Slimes never go shiny (see tryPlace).
    for (const sp of FAUNA_ORDER) {
      const cfg = BIOME_FAUNA[sp];
      if (!cfg) continue;
      let n = cfg.base + (cfg.range ? Math.floor(rng() * cfg.range) : 0);
      // Hard mode doubles the surface slimes (Difficulty.slimeCountMul); the
      // extra ids just count on past the easy ones, so seeds still reproduce.
      if (sp === 'slime') n = Math.round(n * Difficulty.get().slimeCountMul);
      // Easy mode halves the wild crow count (Difficulty.crowCountMul); the
      // dropped ids just count off short, so seeds still reproduce.
      if (sp === 'crow') n = Math.round(n * Difficulty.get().crowCountMul);
      const primary  = new Set(cfg.primary);
      const fallback = new Set(cfg.fallback || cfg.primary);
      const primN = Math.round(n * (cfg.share ?? 0.8));
      for (let i = 0; i < primN; i++) tryPlace(primary,  i, sp);
      for (let i = primN; i < n; i++) tryPlace(fallback, i, sp);
    }
    // (Starter-cow at spawn removed — cows are valuable enough that none should be gifted.)
    // Merge in any creatures the player has released back into the world for this tile.
    // save.released is a flat array of {x,y,kind,id,tx,ty} — filter by tile + caught state.
    if (this.save.released) {
      for (const r of this.save.released) {
        if (r.tx !== tx || r.ty !== ty) continue;
        if (caughtSet.has(r.id)) continue;
        creatures.push(WorldGen.makeCreature(r.kind, r.x, r.y, r.id, { shiny: !!r.shiny }));
      }
    }
    // DERELICT LAIRS need the tile's shared spawn options AFTER this pass has
    // finished — the garrisons are woken lazily as the player comes near a ruin
    // (the residency pass in update()), not seated here, because
    // every tier-9 house is a wreck and a city tile holds thousands of them.
    // Stash the one object rather than let that pass rebuild a near-copy: the
    // road rule has to be THE shared rule (CLAUDE.md), not a second reading of
    // it, and the POI anchors are already gathered here.
    entry._spawnOpts = _spawnOpts;
    entry._spawned = true;
    // KEEP creatures the entry already carries. On a rebuild they are the live
    // ones — mid-wander positions, tamed pets, work in progress — handed over
    // by rebuildTileWithBin; the set just rolled is the same deterministic
    // draw they came from, so replacing them would only teleport them home.
    entry.creatures = entry.creatures || creatures;

    // Starter loot now lives entirely in the road-side starter chests placed
    // below (entry.objects, kind:'chest' with fixedLoot). No loose groundstack
    // logs / rockfruit piles near spawn — the tutorial pocket stays clean.
    entry.objects = entry.objects || [];
    // Softwood near home — THIS player's overlay on the world's tree species
    // (HomeArea.applySoftwood; CLAUDE.md "Every player sees the SAME generated
    // world": per-player data may adjust a thing, never decide what it is in
    // the generated world). Here, not in worldgen, and on every build: a
    // rebuilt entry mints fresh objects and re-runs this pass (the `_spawned`
    // gate), so it gets the overlay again. Before any placed/planted tree is
    // added below — a sapling keeps the species it was planted as.
    if (typeof HomeArea !== 'undefined') HomeArea.applySoftwood(entry.objects);

    // Wild debris is generated per-polygon in worldgen and lives on entry.wildplants
    // (set by rasterizeTile). Picked-state filtering happens at render/interact time
    // via this.save.picked.
    entry.wildplants = entry.wildplants || [];

    // Traps ALONGSIDE the roads. Nothing about a trap is stored until it is
    // stepped on: the placement is a pure function of the tile's coordinates
    // (Traps.spawnSurface seeds its own rng off tx/ty, so it takes no draws out
    // of the stream above and every existing world seed is untouched), and only
    // save.sprungTraps ever reaches disk. Handed `_spawnOpts` — the SAME shared
    // spawn options every other spawner in this method uses — so the road rule
    // is the one in WorldGen.isSpawnCell, not a copy of it: a trap sits on the
    // VERGE the drawn band stops at, never under the band. Plain assignment,
    // not `||`: a rebuilt entry (see CLAUDE.md) arrives carrying nothing and
    // re-runs this pass, and the draw is deterministic, so it lays the same set.
    // No traps in test mode, for the reason the extra-X scatter skips it too:
    // the browser harness walks the player over arbitrary cells and asserts on
    // energy, and a trap under one of them would charge a run that never asked
    // to step on one.
    // Density scales with the game mode (Difficulty.PROFILES.trapCountMul:
    // 10x easy, 100x hard) — the base 10..18/tile rate reads as too rare to
    // ever meet in practice.
    // Kept ON THE ENTRY so the density can be re-rolled later without rebuilding
    // a second copy of the rule (see _relayTraps): the how-to card is answered
    // AFTER the starter tile is built, and a copy of these options here and
    // there is exactly how the road mask drifts out of one of them. A rebuilt
    // entry drops it along with `_spawned`, and this pass puts it back.
    entry._spawnOpts = _spawnOpts;
    entry.traps = (typeof Traps !== 'undefined' && !window.__TEST_MODE)
      ? Traps.spawnSurface(genGrid, entry.roadMask, N, N, tx, ty, this.tileEdgeM, _spawnOpts,
          Difficulty.get().trapCountMul)
      : [];

    // Treasure marks. Three streams:
    //  1) entry.treasure       — single legacy slot. Starter tile (guaranteed)
    //                            + low-density random across all tiles.
    //  2) entry.parkingTreasures — one per OSM parking-lot POI (worldgen).
    //  3) entry.extraTreasures   — per-tile random scatter (new). Every tile
    //                            rolls for 4–10 X marks dropped on random
    //                            walkable cells, so X's feel like a regular
    //                            ambient reward instead of a once-a-walk find.
    // All three render + interact through the same code path.
    entry.treasure = null;
    entry.extraTreasures = [];
    // Spawnability for all three treasure streams below is decided by
    // WorldGen.isSpawnCell (the single shared rule): walkable, off-road, and —
    // on RESIDENTIAL cells — only near a public anchor (road/path, public area,
    // or POI). The `_spawnOpts` POI-anchor list was already built at the top of
    // this method for creature placement; reuse it here.
    // Guaranteed starter trail: when this tile holds the starter-trail
    // anchor, place the starter crates along the nearest road. The anchor is
    // the player's HOME (frozen in save.starterCratesAt — see
    // _starterTrailAnchor), NOT raw startWorldM: a save whose home capture
    // failed keeps the default projection origin while the player actually
    // plays somewhere else entirely, and the old origin-keyed check then put
    // the crates on a tile that never loads. When the anchor can't resolve
    // yet (fresh save still waiting on its first GPS fix), no tile places
    // the trail now — it retro-places the moment the anchor freezes (home
    // capture reloads the page; Home adoption calls _setStarterCratesAt).
    const tx0 = tx * this.tileEdgeM, ty0 = ty * this.tileEdgeM;
    const _trailAnchor = this._starterTrailAnchor();
    const isStarterTile = !!_trailAnchor &&
      _trailAnchor.x >= tx0 && _trailAnchor.x < tx0 + this.tileEdgeM &&
      _trailAnchor.y >= ty0 && _trailAnchor.y < ty0 + this.tileEdgeM;
    if (isStarterTile) {
      this._placeStarterTrail(entry, tx, ty);
      this._stripStarterCrates(entry);      // hard mode: no supply handout
      this._placeHomeGreeter(entry, tx, ty); // the mode's doorstep creature
    } else {
      // Any tile arriving can complete a starter-home plan that was deferred
      // (or left short) because the map around spawn was still streaming —
      // this is what lets the arc across a tile seam get filled in at all.
      // Cheap no-op once the plan is done.
      this._provisionStarterHome(entry, tx, ty);
    }
    // The fishing pond, two screens out. Its band can cross a tile seam, so
    // any surface tile it reaches into may plan it, and the tile that owns it
    // repaints it on every build (see _carveStarterPond).
    this._carveStarterPond(entry, tx, ty);
    // The roll and its placement draws are taken on EVERY tile — the starter
    // tile included — and only the RESULT is dropped there. Which tile is a
    // player's starter tile is per-player; skipping the draws on it shifted
    // every later draw of this tile's stream (the X scatter, the path and
    // beach bonuses) for that one player (CLAUDE.md "Every player sees the
    // SAME generated world").
    if (rng() < 1 / 2) {
      // 1/200 → 1/4 → 1/2. Combined with the scatter below, players see X's
      // frequently instead of stumbling onto one a session. This stream caps
      // at ONE mark per tile however it rolls, so the probability IS its yield.
      for (let attempt = 0; attempt < 16; attempt++) {
        const cx = Math.floor(rng() * N);
        const cy = Math.floor(rng() * N);
        // Walkable, off-road, and not deep in a private yard — one shared rule.
        if (!WorldGen.isSpawnCell(genGrid, N, N, cx, cy, _spawnOpts)) continue;
        const wmx = tx * this.tileEdgeM + (cx + 0.5) * cellM;
        const wmy = ty * this.tileEdgeM + (cy + 0.5) * cellM;
        if (!isStarterTile) entry.treasure = { x: wmx, y: wmy, id: `treasure_${tx}_${ty}` };
        break;
      }
    }
    // Extra scatter: 4–10 X's per tile on random walkable cells (doubled from
    // 2–5). Each gets a stable id derived from its cell so save.foundTreasures
    // persists across reloads. Failed placement attempts (water/building cells)
    // just drop that slot — small scatter variance is fine.
    // Skip the extra-X scatter in test mode — the unified treasure handler
    // runs BEFORE wildplant/creature/till/plant/water dispatches, and tests
    // that tap arbitrary cells would have the tap stolen by a random X.
    const EXTRA_X_COUNT = window.__TEST_MODE ? 0 : (4 + Math.floor(rng() * 7));
    for (let k = 0; k < EXTRA_X_COUNT; k++) {
      let placed = false;
      for (let attempt = 0; attempt < 8 && !placed; attempt++) {
        const cx = Math.floor(rng() * N);
        const cy = Math.floor(rng() * N);
        if (!WorldGen.isSpawnCell(genGrid, N, N, cx, cy, _spawnOpts)) continue;
        const wmx = tx * this.tileEdgeM + (cx + 0.5) * cellM;
        const wmy = ty * this.tileEdgeM + (cy + 0.5) * cellM;
        entry.extraTreasures.push({ x: wmx, y: wmy, id: WorldGen.cellId('treasure_x', tx, ty, cx, cy) });
        placed = true;
      }
    }

    // Bonus X marks alongside pedestrian paths (terrain 8). Walkers drop
    // things — the fiction is that the X marks small finds (a coin, an
    // earring) just off the trail. We sample up to PATH_BONUS_COUNT
    // path cells at random and place an X on a tillable neighbour cell
    // (4-connected) so the X visually sits adjacent to the path, not on
    // it. Skipped when the tile has no path cells.
    // ONE pass over the grid for both bonus streams below (the path's and the
    // beach's). This is the post-rasterize path, which has no slicer at all —
    // whatever runs here runs straight through — so a second full-grid scan
    // for the sand would be a second 100k-cell block charged to no span the
    // profile can name.
    // Cells are packed as their grid INDEX (cy * N + cx), which is the index
    // the rest of this file reads them by. It was `cx * 256 + cy` until Sep
    // 2026: cellsPerEdge is tileEdgeM / 7, which is over 256 anywhere below
    // ~43° latitude (349 at the equator), so every path cell in the bottom of
    // the tile decoded to (cx + 1, cy - 256) and its "roadside" X was dropped
    // somewhere else entirely.
    const pathCells = [];
    const sandCells = [];
    for (let cy = 0; cy < N; cy++) {
      for (let cx = 0; cx < N; cx++) {
        const t = genGrid[cy * N + cx];
        if (t === 8 /* PATH */) pathCells.push(cy * N + cx);
        else if (t === WorldGen.T.SAND) sandCells.push(cy * N + cx);
      }
    }
    if (pathCells.length > 0) {
      // 4-8 bonus X marks per tile that has any path (doubled from 2-4).
      // Capped by path density so a tile with one stub doesn't get spammed —
      // the cap doubles with the count (one per 2 path cells, was one per 4),
      // otherwise a thin-path tile clamps at the old number and the extra
      // marks never appear.
      const PATH_BONUS_COUNT = Math.min(
        4 + Math.floor(rng() * 5),
        Math.max(1, Math.floor(pathCells.length / 2))
      );
      const NEIGHBOURS = [[1,0],[-1,0],[0,1],[0,-1]];
      for (let k = 0; k < PATH_BONUS_COUNT; k++) {
        let placed = false;
        for (let attempt = 0; attempt < 8 && !placed; attempt++) {
          const cell = pathCells[Math.floor(rng() * pathCells.length)];
          const pcx = cell % N, pcy = Math.floor(cell / N);
          // Shuffle the neighbour list per attempt so a packed path
          // doesn't always seat the X on the same side.
          const [ndx, ndy] = NEIGHBOURS[Math.floor(rng() * 4)];
          const ncx = pcx + ndx, ncy = pcy + ndy;
          if (ncx < 0 || ncy < 0 || ncx >= N || ncy >= N) continue;
          // Want the X visually OFF the trail: not on the path cell itself,
          // and otherwise a legitimate spawn cell (walkable, off-road, out of
          // private yards). Avoid stacking on an existing X below.
          if (genGrid[ncy * N + ncx] === 8 /* PATH */) continue;
          if (!WorldGen.isSpawnCell(genGrid, N, N, ncx, ncy, _spawnOpts)) continue;
          const wmx = tx * this.tileEdgeM + (ncx + 0.5) * cellM;
          const wmy = ty * this.tileEdgeM + (ncy + 0.5) * cellM;
          const id = WorldGen.cellId('treasure_path', tx, ty, ncx, ncy);
          if (entry.extraTreasures.some(t => t.id === id)) continue;
          entry.extraTreasures.push({ x: wmx, y: wmy, id });
          placed = true;
        }
      }
    }

    // Bonus X marks ON SAND. A beach is the one ground people actually dig,
    // and what the tide leaves stays in it — so a shore carries marks at its
    // OWN rate rather than its share of the tile-wide scatter above, which
    // over a 2.4 km tile is nothing at all along a strip of shoreline. The
    // mark sits on the sand cell itself (unlike the path's, which goes on a
    // neighbour: a footpath is walked, a beach is dug).
    // Capped by the beach's own size the way the path bonus is capped by path
    // density, so a golf bunker or a sandpit doesn't get the whole roll.
    if (sandCells.length > 0) {
      const BEACH_BONUS_COUNT = Math.min(
        4 + Math.floor(rng() * 5),
        Math.max(1, Math.floor(sandCells.length / BEACH_X_PER_CELLS))
      );
      for (let k = 0; k < BEACH_BONUS_COUNT; k++) {
        let placed = false;
        for (let attempt = 0; attempt < 8 && !placed; attempt++) {
          const cell = sandCells[Math.floor(rng() * sandCells.length)];
          const scx = cell % N, scy = Math.floor(cell / N);
          if (!WorldGen.isSpawnCell(genGrid, N, N, scx, scy, _spawnOpts)) continue;
          const wmx = tx * this.tileEdgeM + (scx + 0.5) * cellM;
          const wmy = ty * this.tileEdgeM + (scy + 0.5) * cellM;
          const id = WorldGen.cellId('treasure_sand', tx, ty, scx, scy);
          if (entry.extraTreasures.some(t => t.id === id)) continue;
          entry.extraTreasures.push({ x: wmx, y: wmy, id });
          placed = true;
        }
      }
    }

    // Player-planted saplings (save.fruittrees) → growing objects on the tile
    // that owns each one. Injected AFTER the spawn-area strip above so a
    // sapling planted near home survives. Two kinds share the list: an ACORN
    // record carries kind:'tree' and comes back as TIMBER (chopped for wood,
    // its growth stage read off planted_t by util.js treeGrowthStage); every
    // other record is a `fruittree` (picked, not chopped) whose render spec
    // advances the sprite through its growth frames from planted_t, with the
    // harvest handler gating picking until it matures.
    if (this.save.fruittrees && this.save.fruittrees.length) {
      const t0x = tx * this.tileEdgeM, t0y = ty * this.tileEdgeM;
      for (const ft of this.save.fruittrees) {
        if (ft.x < t0x || ft.x >= t0x + this.tileEdgeM ||
            ft.y < t0y || ft.y >= t0y + this.tileEdgeM) continue;
        if ((entry.objects || []).some(o => o.id === ft.id)) continue;
        entry.objects = entry.objects || [];
        entry.objects.push(ft.kind === 'tree'
          // No `species` and no `size`: a species-less tree draws off the
          // default growth sheet and takes no hardwood/softwood tier shift, so
          // what you planted is what you can fell.
          ? WorldGen.makeObject('tree', ft.x, ft.y, ft.id,
              { planted: true, planted_t: ft.planted_t })
          : WorldGen.makeObject('fruittree', ft.x, ft.y, ft.id,
              { species: ft.species === 'peach' ? 'peach' : 'apple',
                planted: true, planted_t: ft.planted_t }));
      }
    }
    // The per-player cull, AFTER every draw of the shared stream above.
    this._cullOffLiveGround(entry, tx, ty, N, cellM, genGrid, genObjects, creatures);
  }

  // The live-ground cull. spawnInTile draws every creature, trap and X mark
  // off the tile's GENERATED layer so the stream is the same for everyone;
  // this then takes back, for THIS player, whatever landed where their live
  // entry says nothing can stand: a cell repainted unwalkable after
  // generation (the starter pond) or one an object holds that the generated
  // layer doesn't (a starter crate, an Overpass bin's chest). A cull, never a
  // re-roll — it takes no draws, so the stream stays shared (CLAUDE.md "Every
  // player sees the SAME generated world"). `creatures` is this pass's fresh
  // roll, compacted in place (entry.creatures may be that same array).
  _cullOffLiveGround(entry, tx, ty, N, cellM, genGrid, genObjects, creatures) {
    const grid = entry.grid;
    if (!grid) return;
    const x0 = tx * this.tileEdgeM, y0 = ty * this.tileEdgeM;
    const idxOf = (x, y) => {
      const ix = Math.floor((x - x0) / cellM), iy = Math.floor((y - y0) / cellM);
      return (ix >= 0 && iy >= 0 && ix < N && iy < N) ? iy * N + ix : -1;
    };
    const gen = new Set(genObjects);
    const held = new Set();
    for (const o of (entry.objects || [])) {
      if (gen.has(o)) continue;
      const i = idxOf(o.x, o.y);
      if (i >= 0) held.add(i);
    }
    const repainted = grid !== genGrid;
    const off = (t) => {
      const i = idxOf(t.x, t.y);
      if (i < 0) return false;
      if (held.has(i)) return true;
      return repainted && grid[i] !== genGrid[i] && !WorldGen.isWalkable(grid[i]);
    };
    if (!held.size && !repainted) return;
    const keep = (arr) => {
      if (!arr) return arr;
      let w = 0;
      for (let r = 0; r < arr.length; r++) if (!off(arr[r])) arr[w++] = arr[r];
      arr.length = w;
      return arr;
    };
    keep(creatures);
    keep(entry.traps);
    keep(entry.extraTreasures);
    if (entry.treasure && off(entry.treasure)) entry.treasure = null;
  }

  // Cave fauna: hostile wandering MONSTERS on CAVE_FLOOR cells (depth > 0).
  // Unlike surface animals these stalk the player and drain energy in range
  // (see wanderCreatures + MONSTERS). Eligible kinds are gated by depth
  // (MONSTERS.minDepth) and drawn from a weighted bag, so deeper levels mix in
  // tougher foes; density rises gently with depth. Ids are stable + seeded so a
  // defeated monster (recorded in save.caught) stays dead across reloads, just
  // like surface fauna.
  spawnCaveCreatures(entry, tx, ty, depth) {
    const rng = WorldGen.makeRng((tx * 0x2c1b3a5f ^ ty * 0x9e3779b1 ^ depth * 0x85ebca77) >>> 0);
    const N = entry.cellsPerEdge;
    const creatures = [];
    // Memoised Set, not an Array.includes — the monster + rabbit loops below
    // call this up to (count + rabbitN) * 20 times per tile build (up to
    // ~3500 calls at max depth), each an O(save.caught length) scan without
    // this. Same fix as spawnInTile above / setOf's own doc comment.
    const caughtSet = setOf(this.save.caught);
    // Weighted bag of the kinds that may appear at this depth.
    const bag = [];
    // Only the cave kinds: a row with its own `spawn` (the ghost, which the
    // night spawner seats on the surface) is never drawn here.
    for (const [kind, m] of Object.entries(Combat.MONSTERS)) {
      if (!Combat.spawnsUnderground(kind)) continue;
      if (depth >= m.minDepth) for (let w = 0; w < (m.weight || 1); w++) bag.push(kind);
    }
    if (!bag.length) { entry._spawned = true; entry.creatures = entry.creatures || creatures; return; }
    // Anchor spawns near the up-staircases (where the player enters) so
    // monsters are immediately visible rather than scattered across the
    // ~229×229 cell tile. A level has an up-stair at EVERY surface entrance
    // (and the player may descend any of them), so anchor around ALL of them —
    // the old single-anchor (`find` → first stair) left every other entrance
    // monster-free, and with the underground torch bubble only ~2 cells wide
    // the far-away swarm was never seen ("I never see monsters underground").
    // Falls back to the tile centre when no staircase exists on this tile.
    const cellSizeM = entry.tileEdgeM / N;
    // Every draw below asks the level's GENERATED layer (baseGrid /
    // genObjects, frozen by loadCaveTile) — never the live entry, which
    // carries this player's own edits: dug walls, the home up-stair and the
    // up-stair under the starter ladder (both `_synthetic`). Anchoring on, or
    // refusing seats around, a player's own stairs reshuffled the whole cave
    // population everyone else sees (CLAUDE.md "Every player sees the SAME
    // generated world"). What the live entry holds is a CULL after the draw
    // (`heldByPlayer` below), never a re-roll.
    const genGrid = entry.baseGrid || entry.grid;
    const genObjects = (entry.genObjects || entry.objects || []).filter(o => !o._synthetic);
    const anchors = genObjects
      .filter(o => o.kind === 'staircase' && o.dir === 'up')
      .map(s => ({
        lix: Math.floor((s.x - tx * entry.tileEdgeM) / cellSizeM),
        liy: Math.floor((s.y - ty * entry.tileEdgeM) / cellSizeM),
      }));
    if (!anchors.length) anchors.push({ lix: Math.floor(N / 2), liy: Math.floor(N / 2) });
    // Cells an object (rock, staircase, chest…) already sits on. Built ONCE
    // here and shared by every seat-time check below — monsters, rabbits,
    // the coin trickle and the traps — rather than each rescanning
    // entry.objects for the same thing. This is occupancy governing where a
    // thing is SEATED, not where it may later walk: a monster or rabbit is
    // free to wander onto any cell once it exists (the wander loop in
    // wanderCreatures doesn't consult this), it just must not be BORN on a
    // staircase or inside a rock sprite — the same "not under a rock" half of
    // the spawn rule the cave coins and cave traps just below already enforce
    // via their own copies of this scan. Terrain (CAVE_FLOOR) alone can't see
    // an object sitting on top of it, same as the surface roadMask can't see
    // an object sitting on top of a grass cell.
    const occupiedIdx = new Set();
    for (const o of genObjects) {
      const ox = Math.floor((o.x - tx * entry.tileEdgeM) / cellSizeM);
      const oy = Math.floor((o.y - ty * entry.tileEdgeM) / cellSizeM);
      occupiedIdx.add(oy * N + ox);
    }
    // Cells THIS player's live entry holds that the generated layer doesn't —
    // their stairs. A seat drawn onto one is dropped (the attempt still ends
    // exactly where it would for anyone else).
    const genSet = new Set(genObjects);
    const heldByPlayer = new Set();
    for (const o of (entry.objects || [])) {
      if (genSet.has(o)) continue;
      const ox = Math.floor((o.x - tx * entry.tileEdgeM) / cellSizeM);
      const oy = Math.floor((o.y - ty * entry.tileEdgeM) / cellSizeM);
      if (ox >= 0 && oy >= 0 && ox < N && oy < N) heldByPlayer.add(oy * N + ox);
    }
    const SPAWN_R = 25; // cells — fills 2–3 screens worth around each entry point
    const randCell = () => {
      const a = anchors[Math.floor(rng() * anchors.length)];
      return {
        cx: a.lix + Math.round((rng() - 0.5) * 2 * SPAWN_R),
        cy: a.liy + Math.round((rng() - 0.5) * 2 * SPAWN_R),
      };
    };
    // TOTAL population matches the old single-stair tuning, regardless of how
    // many up-staircases this tile has — anchors.length only widens WHERE
    // spawns land (randCell already picks a random anchor per creature), so a
    // stair-dense tile spreads the same population across more entrances
    // instead of multiplying it. This used to multiply the count by
    // anchors.length too, which quietly doubled (or tripled) the population
    // on any tile with more than one up-staircase — the common case, since
    // each residential cluster rolls its own staircase independently (~30%
    // odds each), so 2 anchors on a tile is typical, not an edge case.
    // The 160 cap is a dead-but-harmless safety net at today's depths — keep
    // it in case a much deeper level or a MONSTERS-table change changes that.
    // Hard mode packs the level tighter (Difficulty.monsterCountMul, 1.5×) —
    // still under the cap at every depth that exists today.
    const count = Math.min(160, Math.round((50 + depth * 10) * Difficulty.get().monsterCountMul));
    for (let i = 0; i < count; i++) {
      const kind = bag[Math.floor(rng() * bag.length)];
      for (let attempt = 0; attempt < 20; attempt++) {
        const { cx, cy } = randCell();
        if (cx < 0 || cy < 0 || cx >= N || cy >= N) continue;
        if (genGrid[cy * N + cx] !== 24 /* CAVE_FLOOR */) continue;
        // Don't SEAT a monster on a staircase or inside a rock sprite — see
        // the occupiedIdx comment above. This is a rejected attempt, not an
        // extra rng() draw: randCell() already made its 3 calls for this
        // attempt, so the draw sequence every existing cave level was seeded
        // with is untouched.
        if (occupiedIdx.has(cy * N + cx)) continue;
        const id = `mon_${kind}_${depth}_${tx}_${ty}_${i}`;
        if (caughtSet.has(id)) break;   // already defeated — stays dead
        if (heldByPlayer.has(cy * N + cx)) break;   // on the player's own stair
        const wmx = tx * this.tileEdgeM + (cx + 0.5) * cellSizeM;
        const wmy = ty * this.tileEdgeM + (cy + 0.5) * cellSizeM;
        // ~5% spawn as ELITES — the shiny variant, stamped off the stable id
        // like a shiny animal so it survives reloads. The same `shiny` flag
        // the renderer already tints and sparkles; combat.js reads it as
        // double HP and damage (Combat.isElite), and resolveDefeat pays the
        // memory-or-treasure it promises.
        creatures.push(WorldGen.makeCreature(kind, wmx, wmy, id,
          { shiny: isShiny(id, SHINY_RATE.monster) }));
        break;
      }
    }
    // Rabbits: also anchored near the staircases, spread the same way — not
    // multiplied by anchor count, for the same reason as `count` above.
    const rabbitN = 10 + Math.floor(rng() * 8);
    for (let i = 0; i < rabbitN; i++) {
      for (let attempt = 0; attempt < 20; attempt++) {
        const { cx, cy } = randCell();
        if (cx < 0 || cy < 0 || cx >= N || cy >= N) continue;
        if (genGrid[cy * N + cx] !== 24 /* CAVE_FLOOR */) continue;
        // Same seat-time occupancy check as the monster loop above — a rabbit
        // is no less able to spawn inside a rock than a slime is.
        if (occupiedIdx.has(cy * N + cx)) continue;
        const id = `rabbit_${depth}_${tx}_${ty}_${i}`;
        if (caughtSet.has(id)) break;   // already caught — stays gone
        if (heldByPlayer.has(cy * N + cx)) break;   // on the player's own stair
        const wmx = tx * this.tileEdgeM + (cx + 0.5) * cellSizeM;
        const wmy = ty * this.tileEdgeM + (cy + 0.5) * cellSizeM;
        creatures.push(WorldGen.makeCreature('rabbit', wmx, wmy, id));
        break;
      }
    }
    // ROAMERS: the rest of the level. The pack above crowds the stair mouths,
    // SPAWN_R cells out — a small corner of a ~229-cell tile — so a player who
    // walked off from the stair, or came down a rope or a portal somewhere
    // else, met nothing at all ("no slimes underground"). One chance per
    // ROAM_PIVOT-cell square across the whole floor, scaled by the mode's
    // monsterCountMul like the pack. Off its OWN stream, so every draw the
    // pack, the rabbits and the coins make keeps the number it had. Ids are
    // POSITIONAL (the seat cell), so save.caught keeps a roamer dead.
    const ROAM_PIVOT = 12, ROAM_TRIES = 6;
    const roamP = Math.min(0.6, 0.4 * Difficulty.get().monsterCountMul);
    const roamRng = WorldGen.makeRng((tx * 0x2c1b3a5f ^ ty * 0x9e3779b1 ^ depth * 0x5bd1e995) >>> 0);
    for (let py = 0; py < N; py += ROAM_PIVOT) {
      for (let px = 0; px < N; px += ROAM_PIVOT) {
        if (roamRng() >= roamP) continue;
        const kind = bag[Math.floor(roamRng() * bag.length)];
        for (let attempt = 0; attempt < ROAM_TRIES; attempt++) {
          const cx = px + Math.floor(roamRng() * ROAM_PIVOT);
          const cy = py + Math.floor(roamRng() * ROAM_PIVOT);
          if (cx >= N || cy >= N) continue;
          if (genGrid[cy * N + cx] !== 24 /* CAVE_FLOOR */) continue;
          if (occupiedIdx.has(cy * N + cx)) continue;
          const id = `mon_${kind}_${depth}_${tx}_${ty}_r${cx}_${cy}`;
          if (caughtSet.has(id)) break;
          if (heldByPlayer.has(cy * N + cx)) break;
          const wmx = tx * this.tileEdgeM + (cx + 0.5) * cellSizeM;
          const wmy = ty * this.tileEdgeM + (cy + 0.5) * cellSizeM;
          creatures.push(WorldGen.makeCreature(kind, wmx, wmy, id,
            { shiny: isShiny(id, SHINY_RATE.monster) }));
          break;
        }
      }
    }
    // Loose coins on the cave floor: a handful per level tile, scattered the
    // same way as the fauna (around the entrances, so the ~2-cell torch bubble
    // actually meets them) and picked up with the same tap as a coin-burst
    // coin (interact.js 'coindrop'). They ride entry.coinDrops like the burst
    // coins do — the renderer and the tap handler already walk that list at
    // every depth, since WorldGen.tileCache is repointed per level — but with
    // NO expiresAt: a coin found by digging should still be there when the
    // torch swings back. In-memory only, like every coinDrop: a fresh build of
    // the level lays a fresh handful, which is the trickle intended. The seeded
    // rng keeps the draw order of the monsters and rabbits above untouched.
    // Not on a staircase or a rock: the coin handler wins the tap, but a coin
    // under a rock sprite reads as a rock. Guarded like `creatures` — a tile
    // REBUILT under the player (see CLAUDE.md) carries coinDrops across and
    // re-runs this pass, so it must not lay a second handful onto the first.
    if (!entry.coinDrops) {
      const CAVE_COINS_MIN = 4, CAVE_COINS_MAX = 8;   // per level tile — a trickle, not a burst
      const coins = [];
      // Copy, not the shared Set itself: this loop adds each newly-placed
      // coin's own cell to `taken` so two coins can't stack, and that's a
      // coin-to-coin rule the monster/rabbit/trap passes have no business
      // seeing. The object occupancy underneath it is the same occupiedIdx
      // built once above — no second scan of entry.objects.
      const taken = new Set(occupiedIdx);
      const coinN = CAVE_COINS_MIN + Math.floor(rng() * (CAVE_COINS_MAX - CAVE_COINS_MIN + 1));
      for (let i = 0; i < coinN; i++) {
        for (let attempt = 0; attempt < 20; attempt++) {
          const { cx, cy } = randCell();
          if (cx < 0 || cy < 0 || cx >= N || cy >= N) continue;
          const idx = cy * N + cx;
          if (genGrid[idx] !== 24 /* CAVE_FLOOR */ || taken.has(idx)) continue;
          taken.add(idx);
          if (heldByPlayer.has(idx)) break;   // on the player's own stair
          const wmx = tx * this.tileEdgeM + (cx + 0.5) * cellSizeM;
          const wmy = ty * this.tileEdgeM + (cy + 0.5) * cellSizeM;
          coins.push({ kind: 'coindrop', x: wmx, y: wmy, id: `cavecoin_${depth}_${tx}_${ty}_${i}` });
          break;
        }
      }
      // And the level's SEEDED gold (worldgen.js caveCoins): generated where
      // it lies over the whole floor, less the ones already picked up — the
      // coin tap writes a `seeded` coin's id into save.foundTreasures.
      const foundSet = setOf(this.save.foundTreasures || []);
      for (const c of (entry.caveCoinSeeds || [])) {
        if (foundSet.has(c.id)) continue;
        const idx = Math.floor((c.y - ty * entry.tileEdgeM) / cellSizeM) * N
          + Math.floor((c.x - tx * entry.tileEdgeM) / cellSizeM);
        if (taken.has(idx) || heldByPlayer.has(idx)) continue;
        coins.push(c);
      }
      entry.coinDrops = coins;
    }
    // Cave traps — same anchors, same reason: a trap 200 cells out in the dark
    // is a trap nobody ever meets. Seeded off its own stream (Traps.spawnCave),
    // so the monster / rabbit / coin draws above keep the numbers they had.
    // Every cell an object already holds is refused, so a trap is never laid
    // under a rock or a staircase sprite — down here the art is the only
    // warning there is, and an unlit cell already swallows most of it.
    entry.traps = [];
    if (typeof Traps !== 'undefined' && !window.__TEST_MODE) {
      // Same occupiedIdx built once above for the monster/rabbit seat check —
      // this used to be a third scan of entry.objects for the identical Set;
      // now it's the one this function already has in scope.
      // Flat multiplier regardless of game mode — a dungeon is dangerous on
      // either one (see Traps.DUNGEON_DENSITY_MUL).
      entry.traps = Traps.spawnCave(genGrid, N, tx, ty, entry.tileEdgeM, depth,
        anchors, occupiedIdx, Traps.DUNGEON_DENSITY_MUL)
        .filter(t => !heldByPlayer.has(t._iy * N + t._ix));
    }
    entry._spawned = true;
    entry.creatures = entry.creatures || creatures;
  }

  // Catch wheel: like startWorkProgress, but the TARGET CREATURE flees the
  // player at FLEE_MPS while it runs (see _drawWorkProgress). If it escapes the
  // viewport the catch FAILS (onFail) instead of completing; the wheel tracks
  // the fleeing creature. _beingCaught flags it so wanderCreatures leaves its
  // movement to the wheel.
  startCatchProgress(creature, durationMs, onComplete, onFail, toolSlot = null, energyRefund = 0) {
    creature._beingCaught = true;
    const t = performance.now();
    this._setWorkProgressIcon(toolSlot);
    this._workProgress = {
      worldX: creature.x, worldY: creature.y, onComplete, durationMs,
      energyRefund, startT: t, _lastT: t, flee: creature, onFail,
    };
  }

  // Chickens and cows wander ~1 cell every 5s in a random direction.
  // Per-creature state lives on the creature object: _startX/Y, _targetX/Y,
  // _stepT0, _nextChooseT, _homeX/Y, _faceFlip.
  wanderCreatures() {
    const now = performance.now();
    // NOT THERE TO BE HUNTED: a Shadow Powder's minute, or a bar run to zero.
    // isUnnoticed() ORs the two (see it for why they are one state), and
    // everywhere a hostile would take an interest in the player reads THIS —
    // the leech, the monster's hit and arrow, the struck slime's charge, and
    // both stalk branches, each falling back to the aimless wander. Read once
    // per tick, not per creature. The PLAYER's own weapons are gated by
    // neither, and _updatePlayerAura fades the body on the same expression.
    const unnoticed = this.isUnnoticed();
    const STEP_MS = 5000;
    const STEP_M = this.cellM;   // 1 cell per step
    // Only sim creatures near the player. Beyond the bubble they stay frozen
    // at their last position — cheap, and the player cannot see it happen.
    const px = this.startWorldM.x + this.playerM.x;
    const py = this.startWorldM.y + this.playerM.y;
    // THE SIM BUBBLE — measured from the player's FEET, never the camera
    // anchor (a peek drag must not widen who is thinking; see the camera rule
    // in CLAUDE.md).
    //   The viewport corner sits at VIEW_CELLS/2 * √2 ≈ 7.8 cells, and the
    // bubble used to stop at 8 — one tenth of a cell past the glass. That is
    // exactly where it reads as a cheat: a deer frozen mid-stride pops into
    // motion the moment it crosses the corner, and anything that should be
    // walking toward you (a stalking monster, a crow inbound to your field)
    // only starts once it is already on screen. CREATURE_SIM_CELLS gives it a
    // margin of about half a viewport, so a creature is moving for a second or
    // two before you ever see it and arrives already in motion.
    //   The cost is quadratic in the radius (2.25× the creatures of the old 8)
    // but the population is a handful either way, and the 3×3 tile ring below
    // still covers it many times over — a tile edge is hundreds of cells.
    const RANGE_M = CREATURE_SIM_CELLS * this.cellM;
    const RANGE_SQ = RANGE_M * RANGE_M;
    // Per-frame loop hygiene (the render pass documents the same fix): only
    // the 3×3 tile neighbourhood is simmed — the sim range above is a handful
    // of cells and a tile edge is hundreds, so one ring of tiles always covers
    // it — and caught-membership is a memoised Set, not an Array.includes per
    // creature. The all-tiles + includes version was an O(every creature ever
    // loaded × caught) scan per frame that grew the longer you walked.
    const pcW = this.playerToWorldCell();
    // Prune save.caught of pest-crow markers whose tile has since fallen out
    // of the in-memory tile cache. Every OTHER id in this array is
    // deterministic (crow_tx_ty_i, mon_kind_depth_tx_ty_i, rabbit_depth_tx_ty_i,
    // …) and MUST be kept forever — revisiting that tile re-seeds the same rng
    // and mints the identical id, so dropping the marker would let the "dead"
    // creature spawn right back. Pest crows are the one exception: each spawn
    // below mints a fresh id off Date.now()+Math.random() that is never minted
    // again, so once its tile leaves the cache the creature object it named is
    // gone for good and the marker can never matter again. Nothing pruned this
    // before — grepped, only testtools resets the array wholesale — so a save
    // with crops planted and a pet active added one of these roughly every 90s
    // (the pest timer below) for the life of the save, same failure shape as
    // coinBurstClaimed/houseSatisfied/shopCharm before those grew a prune pass.
    //   Depth-gated: WorldGen.tileCache is REPOINTED to the cave-level map
    // underground (see _setStarterCratesAt above), so checking it while the
    // player is down a level would read the wrong map and wrongly prune a
    // surface pest crow whose tile is still very much cached.
    //   Own throttle (not `_lastPestT`) because that timer can go far longer
    // than 90s between resets when no crow-edible crop is planted (see below),
    // and this O(save.caught) filter has no business running every frame either.
    if ((this.depth || 0) === 0 && this.save.caught && this.save.caught.length &&
        now - (this._lastCaughtPruneT || 0) > 90000) {
      this._lastCaughtPruneT = now;
      this.save.caught = this.save.caught.filter((id) => {
        // The ghosts (ghostSpawnPass) and the fished slime (fishedSlimeSpawn)
        // mint their ids the same way and are pruned by the same rule.
        const m = typeof id === 'string' && /^(?:pest_crow|ghost|fished_slime)_(-?\d+)_(-?\d+)_/.exec(id);
        return !m || WorldGen.tileCache.has(WorldGen.tileKey(+m[1], +m[2]));
      });
    }
    const caughtSet = setOf(this.save.caught);
    // HOME'S WARD, resolved ONCE per tick (homeWorldPos memoises, but every
    // creature in the loop below asks the same question and the answer cannot
    // change inside one tick). Null off the surface and before Home is placed,
    // which is what switches the ward off.
    const homePos = this.homeWorldPos();
    const HOME_WARD_R2 = (HOME_R * this.cellM) * (HOME_R * this.cellM);
    // The radius a routed foe is driven out to — the sim bubble's own edge
    // (CREATURE_SIM_CELLS), which is where a creature stops thinking at all, so
    // "it ran off" means gone rather than circling the doormat.
    const HOME_ROUT_R2 = (CREATURE_SIM_CELLS * this.cellM) * (CREATURE_SIM_CELLS * this.cellM);
    // A CASTLE YOU HAVE TAKEN BACK WARDS LIKE HOME: every turret of a claimed
    // castle (the same isClaimedKey test that mans its walls — _turretFire) is
    // a ward point on Home's ring, HOME_R. One lane, a second reason: the same
    // latch, the same away-from-the-point angle, the same stood-down bite.
    const castleWards = this._castleWardPoints(now, pcW);
    // Pest spawn: if the player has any planted crop and there are NO wild
    // crows already near the player, spawn one off-screen every ~90 s. The
    // crow's wander loop targets the nearest crop and destroys it on contact
    // (see below). Eased from "top up to 2 every 30 s" — that relentless pump
    // made crops unfarmable: another bird arrived seconds after you dealt with
    // the last. Now the pump only backfills an emptied field, and slowly, so
    // defeating the crows near your field actually buys a quiet window.
    this._lastPestT = this._lastPestT || 0;
    // Only crops crows actually eat (not potato) justify spawning a pest — and
    // only on HARD (Difficulty.get().cropPests). The pump is not a difficulty
    // KNOB, it is a mode difference: a crow that hunts down your field wherever
    // you plant it is the hard game's answer to farming as a quiet income, and
    // on easy the tile spawner's own crows are the whole crow threat — meet one
    // by walking into it, not by having one dispatched to you. That also
    // retires the amnesty clause this gate used to carry (hasHarvested ||
    // !pestAmnesty): easy never pumps at all now, and hard has no grace to
    // wait out, so the check could only ever answer "true" where it still ran.
    // Timer gate first: the planted-crop scan is O(planted) and has no
    // business running on the ~5400 frames between pest windows.
    if (now - this._lastPestT > 90000) {
      const hasCrowCrop = this.save.planted && this.save.planted.some((p) => this._crowRaids(p));
      if (hasCrowCrop && Difficulty.get().cropPests) {
        this._lastPestT = now;
        // Count nearby wild (non-released, not-yet-caught) crows.
        let wildCrows = 0;
        WorldGen.forEachItemNear('creatures', pcW.tx, pcW.ty, (c) => {
          if (c.kind !== 'crow') return;
          if (typeof c.id === 'string' && c.id.startsWith('released_')) return;
          if (caughtSet.has(c.id)) return;
          const dx = c.x - px, dy = c.y - py;
          if (dx * dx + dy * dy <= RANGE_SQ) wildCrows++;
        });
        if (wildCrows < 1) {
          const pc = pcW;
          const entry = WorldGen.tileCache.get(WorldGen.tileKey(pc.tx, pc.ty));
          if (entry && entry.creatures) {
            // Spawn in a random direction, OUTSIDE the viewport but INSIDE
            // the sim bubble, so the crow flies toward the nearest crop from
            // its first tick. Seated at CREATURE_SIM_CELLS (12) it landed on
            // the rim of the very cull that decides whether it thinks, so the
            // bird the pump had just dispatched sat frozen in the dark until
            // the player happened to walk at it — the comment right here
            // claimed it "flies straight to the nearest crop" and it did not.
            // 10 cells clears the viewport corner (7.8) by a comfortable
            // margin and stays two cells inside the bubble.
            const angle = Math.random() * Math.PI * 2;
            const SPAWN_R = PEST_CROW_SPAWN_CELLS * this.cellM;
            entry.creatures.push(WorldGen.makeCreature('crow',
              px + Math.cos(angle) * SPAWN_R,
              py + Math.sin(angle) * SPAWN_R,
              `pest_crow_${pc.tx}_${pc.ty}_${Math.floor(now)}_${Math.floor(Math.random() * 1e4)}`));
          }
        }
      }
    }

    // The night's ghosts: a group now and then in the dark about the player.
    ghostSpawnPass(this, now, px, py, pcW, homePos, castleWards, HOME_WARD_R2, caughtSet);

    WorldGen.forEachItemNear('creatures', pcW.tx, pcW.ty, (c) => {
      // Cheapest reject first: the sim range cull. Everything below runs only
      // for the handful of creatures actually near the player.
      const ddx = c.x - px, ddy = c.y - py;
      if (ddx * ddx + ddy * ddy > RANGE_SQ) return;
      const isTame = typeof c.id === 'string' && c.id.startsWith('released_');
      // WHAT THINKS AT ALL: everything with a row in the creature behaviour
      // table (SpriteLayout.CREATURE_BEHAVIOUR) — the farm and pet animals,
      // the wild fauna, the surface slime and every cave monster, giants
      // included, since a giant resolves to its base kind's row exactly as it
      // resolves to its base kind's art. This was a nine-name OR-chain plus
      // Combat.isMonster(), which is one more place a kind had to be remembered.
      const wanders = SpriteLayout.creatureWanders(c.kind);
      if (!wanders) return;
      if (caughtSet.has(c.id)) return;
      // Mid-catch: the catch wheel owns this creature's movement (it flees the
      // player), so the generic wander must not also drive it.
      if (c._beingCaught) return;
      // Frost Powder: a frozen foe (c._frozenUntil, wall-clock ms — set by
      // useFrostPowder, which also pins its hop in place) takes no step and
      // lands no hit until the ice thaws. It can still be hit.
      if (c._frozenUntil != null && Date.now() < c._frozenUntil) return;
      // WARDED BY HOME: this foe crossed into Home's ring (HOME_R), so it turns
      // and RUNS (the angle chain below, at the flee pace) and it cannot bite
      // while it goes — a ward that let a slime leech its way to the door would
      // make the doorstep no safer, only slower to lose the bar on.
      // Combat.isEnemy is the registered-hostile test (the wild slime, every
      // cave monster), so a kind added to the monster table is warded the day
      // it ships, and a sapphire-tamed slime is a pet and walks where it likes.
      //
      // THE WARD IS A LATCH, NOT A FENCE, and that is the whole of it: crossing
      // HOME_R sets `_wardFrom`, and only the sim bubble's edge clears it.
      // A plain radius test made the ring a turnstile — a foe stepped out at
      // four cells, stopped being warded on the doorstep's own edge and turned
      // straight back in, so the yard was quiet for one hop and the player
      // watched a slime bob in and out of the same three cells forever. Two
      // radii, one flag: HOME_R is what TRIPS it and CREATURE_SIM_CELLS is what
      // RELEASES it, the hysteresis a lair guard's hold/hunt/return already has
      // (Lairs.guardState). Being hit inside the ring needs no branch of its
      // own any more — a foe close enough to hit at Home is already inside the
      // ring, so it is already routed.
      //   The latch remembers WHICH ward tripped it (`_wardFrom`, a point:
      // Home, or a claimed castle's turret), because the rout angle and the
      // release both measure from that point.
      //   A GHOST has one more ward point: a campfire (fireWardTrip) — the
      // same latch, a third reason, asked only for a haunting kind.
      const haunts = SpriteLayout.creatureHaunts(c.kind);
      const wardFoe = (!!homePos || castleWards.length > 0 || haunts) && !isTame && Combat.isEnemy(c);
      if (wardFoe) {
        const from = c._wardFrom;
        if (from) {
          const fd2 = (c.x - from.x) * (c.x - from.x) + (c.y - from.y) * (c.y - from.y);
          if (fd2 > HOME_ROUT_R2) c._wardFrom = null;                   // released
        } else {
          c._wardFrom = wardTrip(c, homePos, castleWards, HOME_WARD_R2)  // tripped?
            || (haunts ? fireWardTrip(this, c) : null);
        }
      }
      const warded = wardFoe && !!c._wardFrom;
      // WANDERING OFF (monsterWanderingOff, WANDER_OFF_*): every few minutes a
      // wild foe turns its back and walks to the edge of its range, so none
      // piles up forever against a campfire's refused ring. A lair guard has
      // its own leash (Lairs.guardState) and is left to it.
      const wanderOff = !isTame && !c.lair && Combat.isEnemy(c)
        && monsterWanderingOff(c, now, Math.sqrt(ddx * ddx + ddy * ddy), this.cellM);
      // ROUTED: turned onto an away angle at the flee pace — by Home's ward, or
      // by wandering off. Two reasons, one pace; the angle chain says away from
      // WHAT (Home, or the player).
      const routed = warded || wanderOff;
      // A LAIR GUARD'S THREE STATES — src/lairs.js owns the rings, the
      // hysteresis and the arrival test; this asks once and stores the
      // hysteresis back (session state on the creature, like `_hp`).
      //   'hold'   at rest on its seat: it does not step and it is not
      //            interested in the player.
      //   'hunt'   the ruin has noticed: it steps at the player and it bites.
      //   'return' it has given up and is walking back to its seat, and it
      //            does NOT bite on the way — the player got clear, and a
      //            guard still leeching on its walk home would mean they had
      //            not.
      const lairState = c.lair ? Lairs.guardState(c, { x: px, y: py }, this.cellM, !unnoticed) : null;
      c._hunting = lairState === 'hunt';
      // ONE READ FOR "THIS FOE IS NOT ATTACKING YOU RIGHT NOW", the way
      // `unnoticed` is one read for "no hostile takes an interest in you".
      // A ward (Home, or a castle you claimed) is one reason, a foe wandering off is another, and a
      // garrison that has not noticed you (or has given up on you) is two
      // more — the same lane arriving for a
      // different reason, so the attack gates below ask this rather than
      // growing a second condition each. The MOVEMENT chain still asks
      // `warded` by name: an away-from-the-ward angle and a walk back to a seat
      // are two mechanisms, not one, whatever they have in common here.
      const standDown = warded || wanderOff || (!!lairState && lairState !== 'hunt');
      // A GHOST has its own mover (ghostTick — hover, rush, burn) and its own
      // blow: ONE touch of its row's dmg, through the mode, the shield and the
      // armour like every blow, and then it is spent — marked in save.caught
      // like a kill, but no coin (nobody felled it). Nothing else below runs
      // for it: it has no leech, no step chain and no crop to eat.
      if (haunts) {
        const gm = Combat.monster(c.kind);
        const pace = gm.mps / 1000;
        const fate = ghostTick(this, c, now, px, py, unnoticed, warded, pace);
        if (fate === 'touch') {
          const before = this.save.energy ?? 0;
          if (!Combat.playerDowned(before)) {
            const raw = gm.dmg * Combat.powerMul(c) * Difficulty.get().enemyDmgMul;
            const shielded = (this.save.shieldPotionUntil ?? 0) > now ? Math.ceil(raw / 2) : raw;
            const dmg = Combat.playerDamage(shielded, this.save.armor);
            const lost = this._losePlayerEnergy(dmg, { closeShop: true });
            this._popEnergy(-lost, { label: '👻 ghost' });
          }
        }
        if (fate === 'touch' || fate === 'faded') {
          (this.save.caught = this.save.caught || []).push(c.id);
          if (typeof persistSave === 'function') persistSave(this.save);
        }
        return;
      }
      // Slime energy steal: a slime sitting on/near the player drains 1 energy
      // on a per-slime cooldown. Accumulated across all slimes this frame and
      // surfaced with one throttled flash after the loop (see below) so a swarm
      // doesn't spam 50 popups. Runs every frame (wanderCreatures is per-tick),
      // independent of the slime's slow step cadence.
      if (c.kind === 'slime' && !isTame && !unnoticed && !standDown) {
        // The same one cell the player now swings at (Combat.MELEE_REACH_CELLS)
        // — one number for "melee is arm's length", read by both sides.
        const STEAL_R = Combat.meleeReachM(this.cellM);
        if (ddx * ddx + ddy * ddy <= STEAL_R * STEAL_R &&
            (!c._nextStealT || now >= c._nextStealT)) {
          c._nextStealT = now + 1000;   // 3 energy/sec
          const before = this.save.energy ?? 0;
          if (!Combat.playerDowned(before)) {
            // Hard mode doubles the leech (Difficulty.enemyDmgMul), shield or not.
            // WORN ARMOUR SOAKS WHAT IS LEFT (Combat.playerDamage — the mode and
            // the potion scale the blow, armour spends its pool against the
            // result), and never to nothing: a bite always costs at least 1.
            // Scaled by the slime's own power (Combat.powerMul — an elite or a
            // lair guard leeches harder, the same multiplier its HP carries).
            const slimeRaw = ((this.save.shieldPotionUntil ?? 0) > now ? 2 : 3)
              * Combat.powerMul(c) * Difficulty.get().enemyDmgMul;
            const slimeDmg = Combat.playerDamage(slimeRaw, this.save.armor);
            this._slimeStealAccum = (this._slimeStealAccum || 0)
              + this._losePlayerEnergy(slimeDmg, { closeShop: true });
          }
        }
      }
      // Underground monster attack: the slime's energy leech, parametrised.
      // A monster within its RANGE (cells) drains DMG energy on a
      // MONSTER_HIT_MS per-monster cooldown. Melee kinds use range 1
      // (adjacent, Combat.MONSTERS[kind].range itself); a RANGED kind (the goblin
      // archer) instead fires the instant the player is inside the SAME ring
      // the staff's own bolt range is derived from —
      // Combat.rangeCellsFor('staff', reachCells(this)), the player's live
      // reach plus one cell — rather than a flat cell count. So the archer
      // can never open fire from further off than your own ranged weapon
      // would answer from, and the ring tightens underground / grows with
      // Inner Light upgrades exactly as the staff's does. Accumulated +
      // flashed once per window after the loop, like the slime swarm.
      if (Combat.isMonster(c.kind) && !unnoticed && !standDown) {
        const m = Combat.monster(c.kind);
        // A kind whose row lands no blow (Combat.monsterHits — the trapper,
        // dmg 0) skips both halves below: it is not a melee drain at strength
        // zero, which the armour floor would round up to a bite.
        const hits = Combat.monsterHits(c.kind);
        const rangeCells = m.range > 1 ? Combat.rangeCellsFor('staff', reachCells(this)) : m.range;
        const R = rangeCells * this.cellM;
        // A RANGED monster needs a clear line, for the same reason your bow
        // does: the goblin archer reaches out to the player's own live reach,
        // and through rock that is a foe you often cannot even see chipping
        // at your energy from inside a wall. Melee kinds (range 1) are
        // adjacent by definition, so they skip the walk and the cost of it.
        const clear = hits && (m.range <= 1 ||
          Combat.lineOfFire(c.x, c.y, px, py, (x, y) => this._cellBlocked(x, y), this.cellM));
        if (clear && m.range > 1 && ddx * ddx + ddy * ddy <= R * R
            && (!c._nextShotT || now >= c._nextShotT)) {
          // A RANGED kind SHOOTS instead: a visible arrow loosed at the player
          // at the castle turret's cadence (Combat.MONSTER_SHOT_INTERVAL_MS),
          // flying as a bow arrow through the one shot list — it can be seen
          // coming, stops in rock, and lands its hit in _shotHitsPlayer (the
          // shield potion is applied THERE, at the moment it strikes). One
          // arrow carries MONSTER_ARROW_HITS hits of the table — the kind's
          // dmg, doubled for an elite, scaled by the mode — so the slower
          // cadence costs the archer none of its damage per minute.
          c._nextShotT = now + Combat.MONSTER_SHOT_INTERVAL_MS;
          const dmg = m.dmg * MONSTER_ARROW_HITS * Combat.powerMul(c) * Difficulty.get().enemyDmgMul;
          // The arrow carries its hit COUNT as well as its damage, so armour
          // can soak the volley one hit at a time when it lands
          // (_shotHitsPlayer) — mitigating the bundle in one lump would make
          // the slow archer the one foe armour barely helps against.
          const shot = Combat.monsterShot(c.x, c.y, px, py, this.cellM, dmg, MONSTER_ARROW_HITS);
          if (shot) this._shots.push(shot);
        } else if (clear && m.range <= 1 && ddx * ddx + ddy * ddy <= R * R
                   && (!c._nextStealT || now >= c._nextStealT)) {
          c._nextStealT = now + MONSTER_HIT_MS;
          const before = this.save.energy ?? 0;
          if (!Combat.playerDowned(before)) {
            // An elite (shiny) monster hits for double, and a lair guard for its
            // garrison's multiplier — Combat.powerMul (eliteMul × lairMul) is
            // the one multiplier its HP and bounty are scaled by too.
            const dmg = m.dmg * Combat.powerMul(c) * Difficulty.get().enemyDmgMul;
            const shielded = (this.save.shieldPotionUntil ?? 0) > now ? Math.ceil(dmg / 2) : dmg;
            // Worn armour soaks the rest — see the slime leech above; the same
            // pool, the same floor of 1.
            const monDmg = Combat.playerDamage(shielded, this.save.armor);
            this._monsterDmgAccum = (this._monsterDmgAccum || 0)
              + this._losePlayerEnergy(monDmg, { closeShop: true });
          }
        }
      }
      // A LAIR GUARD AT REST DOES NOT MOVE — but it is not switched off.
      // Everything above this line has already run for it: it leeches, a
      // monster kind among them shoots, it takes damage, it dies and pays its
      // bounty. What it never does while HOLDING is choose a step, so the
      // garrison is still on the ruin when the player finally gets there — and
      // reads as holding it from across the street, which a garrison that
      // wandered would not. Placed HERE, below the attack blocks and above
      // every movement branch, because an early return at the top of the loop
      // would have made it harmless furniture instead.
      //   'hunt' and 'return' fall THROUGH to the movement chain: the chase and
      // the walk home are ordinary steps, chosen by the two branches added to
      // the angle chain below rather than by a mover of their own.
      // `immobile` is set by src/lairs.js; nothing else in the game seats an
      // immobile creature, and anything that does must land below the same
      // line.
      // THE TRAPPER'S "ATTACK": a snare on the line between it and you
      // (_trapperLay). Gated exactly as the blows above are — `unnoticed` (a
      // powder, or a body on an empty bar: NOTHING HUNTS A BODY) and
      // `standDown` (a ward, a wander-off, a garrison at rest) — because laying
      // a trap for the player is taking an interest in them. Above the lair
      // guard's hold line like the blows, so a hunting garrison lays too.
      if (Combat.monsterLays(c.kind) && !isTame && !unnoticed && !standDown) {
        this._trapperLay(c, now, px, py);
      }
      if (c.immobile && lairState !== 'hunt' && lairState !== 'return') return;
      // Wild-crow flight rhythm: perch (still 2-4 s) → one long flight
      // burst (500-800 ms, eased) → perch again. Targets a nearest planted
      // crop by ORBITING it — most flight legs end on the ring 1.5-3.5
      // cells out, only ~30% are a tight-ring "landing attempt" that may
      // actually touch the crop's cell. On a landing-on-crop the crow
      // arms a 2-second destroy timer; the crop is only eaten when that
      // timer fires, so scaring / capturing the crow within those 2 s
      // saves it. Tame (released_*) crows fall through to the generic
      // wander below so they behave like other pets.
      if (c.kind === 'crow' && !isTame) {
        this._wildCrowTick(c, now, px, py);
        return;
      }
      // ── THE KIND'S GAIT, AND ITS BOLT ─────────────────────────────────
      // A rabbit hops and sits; a deer is a skittish grazer that bolts in long
      // committed strides once you close on it; a butterfly flits, and after a
      // failed net-catch spends two minutes getting away. Three kinds, one
      // shape — a cadence, a stride, a pause, and a `flee` sub-row of the same
      // three — so they read off ONE row each (SpriteLayout.CREATURE_BEHAVIOUR)
      // instead of three ternaries that each had to name their kind.
      //   A TAME rabbit or deer SETTLES (`tameSettles`): the quick gait and the
      // bolt are a wild animal's wariness, and a pet joins the base wander.
      // That is exactly what the `&& !isTame` on the old isRabbit / isDeer
      // said; a butterfly kept its flit either way and still does.
      const beh = SpriteLayout.creatureBehaviour(c.kind);
      const gait = (beh && !(isTame && beh.tameSettles)) ? beh : null;
      const bolt = gait ? gait.flee : null;
      // TWO TRIGGERS, ONE REACTION. Proximity (`flee.cells` — the player is
      // close enough to spook it), or the two-minute escape window a failed
      // net-catch arms (`flee.escapes` over _escapingUntil, set in
      // _drawWorkProgress — the butterfly's, and only ever stamped on one).
      const bolting = !!bolt && (
        (bolt.cells != null && ddx * ddx + ddy * ddy <= (bolt.cells * this.cellM) ** 2)
        || (!!bolt.escapes && !!(c._escapingUntil && now < c._escapingUntil)));
      // Underground monsters: cadence scales by SPEED (faster ⇒ shorter step,
      // moves more often); flyers (bats) dart a full cell, ground monsters
      // lumber like the slime (0.6 cell).
      const isMon = Combat.isMonster(c.kind);
      const mon = isMon ? Combat.monster(c.kind) : null;
      // Rare shiny animals move at SHINY_SPEED_MUL — same hop distances, but
      // the whole step cadence (hop duration + any pause) is divided by it, so
      // they cover ground that much faster. isShiny() is keyed off the creature id, so the
      // status is stable across reloads (matches the shiny-tint in render).
      // An ELITE monster hits harder, not faster: its cadence comes purely
      // from SPEED, so the shiny check is for animals only.
      const shinyFast = (!isMon && isShiny(c.id, SHINY_RATE.animal)) ? 1 / SHINY_SPEED_MUL : 1;
      // CHARGING: hit by the player or their pet within STRUCK_REACTION_MS and
      // not warded off. Resolved once here because both halves of the charge
      // read it — the quickened beat just below and the committed angle in the
      // chain — and they must not disagree about whether this is a charge.
      // A tamed slime is a pet and never charges its owner; `warded` and
      // `unnoticed` (shadowed, or a player downed on an empty bar) are the two
      // wards that switch it off (the campfire's is a refused target cell, so
      // it needs nothing here).
      const charging = !isTame && !standDown && !unnoticed && slimeCharging(c);
      // stepMs = animation duration of the hop itself (short burst); stepM is
      // how far it carries. Two kinds keep their numbers OUT of the table on
      // purpose: the slime's gait is SLIME_STEP_MUL / SLIME_HOP_CELLS, app.js's
      // own pair with the note that tunes them beside them, and a monster's
      // cadence and stride come from the MONSTERS row it is registered in.
      // Everything else is its gait row, or the loop's own base beat.
      // A ROUTED FOE RUNS, at the same pace anything else in a hurry runs
      // (FLEE_*). Without it the rout was the crawl it was fleeing at: an
      // oozing slime is 0.45 cells every 7.5 s, so being driven off the
      // doorstep meant a full minute parked in the yard just to clear the
      // four-cell ring and minutes more to reach the bubble — a ward you had
      // to take on trust, because nothing you could see was leaving. The
      // slime's charge quickens the BEAT alone; a rout takes the stride too,
      // because the thing being asked for is distance, not urgency.
      const stepMs = (c.kind === 'slime' ? STEP_MS * (charging ? 1 : SLIME_STEP_MUL)
                   : isMon ? STEP_MS / mon.speed
                   : bolting ? (bolt.stepMs ?? STEP_MS)
                   : (gait?.stepMs ?? STEP_MS)) * shinyFast * (routed ? FLEE_BEAT_MUL : 1);
      const stepM = (c.kind === 'slime' ? STEP_M * SLIME_HOP_CELLS
                  : isMon ? STEP_M * monsterStrideCells(mon)
                  : bolting ? STEP_M * (bolt.stepCells ?? 1)
                  : STEP_M * (gait?.stepCells ?? 1)) * (routed ? FLEE_STRIDE_MUL : 1);
      if (c._nextChooseT == null) {
        c._nextChooseT = now + Math.random() * stepMs;
        c._startX = c.x; c._startY = c.y;
        c._targetX = c.x; c._targetY = c.y;
        c._stepT0 = now;
      }
      if (now >= c._nextChooseT) {
        if (c._homeX == null) { c._homeX = c.x; c._homeY = c.y; }
        // Tame butterflies pollinate nearby planted crops while wandering —
        // they raise the same produce-quality figure the BED hands the crop
        // at planting (Crops.bedQuality), by one tier. Each step they're
        // within 8 m of a planted cell, that cell gets armed for a better
        // harvest. Never lower a crop already carrying a richer bed: a
        // butterfly is a bonus, so it takes the max. (This wrote a bare
        // `true` before the field was numeric; `true` read as 1 in the
        // harvest arithmetic, so one tier is exactly what it always gave.)
        if (isTame && beh?.pollinates && this.save.planted) {
          for (const pp of this.save.planted) {
            const dx = pp.x - c.x, dy = pp.y - c.y;
            if (dx * dx + dy * dy <= 64) pp.qualBoost = Math.max(pp.qualBoost ?? pp.canBoost ?? 0, 1);
          }
        }
        // HP healing: if 20 min since last damage, restore to max. Max comes
        // from Combat.maxHp so a monster wounded by an arrow heals back to ITS
        // hit points — the kind's, doubled for an elite — not the 10-HP
        // fallback a local table gave it.
        if (c._lastDamagedT && Date.now() - c._lastDamagedT >= 20 * 60 * 1000) {
          c._hp = Combat.maxHp(c);
          c._lastDamagedT = null;
        }

        // Pet combat: a tame PET (a kind whose row says it hunts for its
        // owner — cats crows, dogs deer + slimes) scans for the nearest valid
        // prey within 8 cells each wander step. Both halves are the one row:
        // which kinds hunt, and what each of them hunts.
        if (isTame && SpriteLayout.isPet(c.kind)) {
          const CHASE_R = 8 * this.cellM;
          const CHASE_R2 = CHASE_R * CHASE_R;
          const PREY = SpriteLayout.creaturePrey(c.kind);
          let nearest = null, nearestD2 = CHASE_R2;
          // Pet is within sim range of the player and prey within 8 cells of
          // the pet, so the player's 3×3 tile ring covers the search box.
          WorldGen.forEachItemNear('creatures', pcW.tx, pcW.ty, (cr) => {
            if (!PREY.has(cr.kind)) return;
            if (cr.id?.startsWith('released_')) return;
            if (caughtSet.has(cr.id)) return;
            const d2 = (cr.x - c.x) ** 2 + (cr.y - c.y) ** 2;
            if (d2 < nearestD2) { nearestD2 = d2; nearest = cr; }
          });
          c._chaseTarget = nearest;
        }

        // Flee override: prey that was just hit runs away.
        if (c._fleeUntilT && c._fleeUntilT > now) {
          const fa = c._fleeAngle ?? 0;
          for (let attempt = 0; attempt < 4; attempt++) {
            const fleeAngle = fa + (Math.random() - 0.5) * 0.6;
            const ftx = c.x + Math.cos(fleeAngle) * stepM * FLEE_STRIDE_MUL;
            const fty = c.y + Math.sin(fleeAngle) * stepM * FLEE_STRIDE_MUL;
            const dest = this.cellAt(ftx, fty);
            if (dest.loaded && !Combat.faunaBlocksCell(dest.type)) {
              c._startX = c.x; c._startY = c.y;
              c._targetX = ftx; c._targetY = fty;
              c._stepT0 = now;
              c._nextChooseT = now + stepMs * FLEE_BEAT_MUL;
              break;
            }
          }
          c._fleeUntilT = 0;
          return;   // skip rest of wander step; interpolation resumes next frame
        }

        // Movement target — modes checked in order:
        //   (a) Pet chasing prey (_chaseTarget set above)
        //   (b) Following (_followUntilT > now): a petted cat homes in on the
        //       player. Which kinds follow is the table's `follows`.
        //   (c) Slime — lazily drawn toward the player.
        //   (d) Tame pets — home-bias keeps them near release point.
        //   (e) Default — wild farm animals random-wander around home.
        // Wild crows take a separate path (_wildCrowTick) above; deer use the
        // generic random wander.
        const FOLLOW_GAP = 1.5 * this.cellM;
        const isFollowing = SpriteLayout.creatureFollows(c.kind)
          && c._followUntilT && c._followUntilT > now;
        const dxh = c._homeX - c.x, dyh = c._homeY - c.y;
        const retreating = c._retreatUntilT && c._retreatUntilT > now;
        const homeRadius = retreating ? 0 : isTame ? 5 * this.cellM : 3 * this.cellM;
        const homeBias = Math.hypot(dxh, dyh) > homeRadius;
        const dxp = px - c.x, dyp = py - c.y;
        const distToPlayer = Math.hypot(dxp, dyp);
        let tx = c.x, ty = c.y, angle = 0;
        let foundValidTarget = false;
        // Fight resolution: if chasing pet is in fight range, deal damage.
        if (c._chaseTarget) {
          const tgt = c._chaseTarget;
          const fd2 = (tgt.x - c.x) ** 2 + (tgt.y - c.y) ** 2;
          const FIGHT_R2 = (1.5 * this.cellM) ** 2;
          if (fd2 <= FIGHT_R2) {
            // One HP table for every fight in the game (combat.js) — a slime a
            // dog has been worrying shows the damage on the player's health
            // ring too, and finishing it off with an arrow is that much less
            // work.
            tgt._hp = Combat.damage(tgt, 1);
            c._hp   = Combat.damage(c, 1);
            tgt._lastDamagedT = Date.now();
            c._lastDamagedT   = Date.now();
            // React to the bite immediately either way — but WHICH reaction
            // depends on the prey. A bird or a deer runs (the flee override
            // below). A SLIME charges, at the player: it is an enemy, not
            // game, and the flee this block used to set on every prey kind
            // alike was shoving it out of the reach of the person whose dog
            // had just bitten it. slimeCharging reads `_lastDamagedT`, stamped
            // just above, so the pet's teeth provoke exactly what the player's
            // sword does.
            tgt._nextChooseT = 0;            // interrupt current step immediately
            if (!slimeCharging(tgt)) {
              // Push prey away from pet.
              tgt._fleeAngle  = Math.atan2(tgt.y - c.y, tgt.x - c.x);
              tgt._fleeUntilT = now + STRUCK_REACTION_MS;  // outlasts one wander step
            }
            if (tgt._hp <= 0) {
              // Auto-defeat the prey — the SAME outcome as the player killing
              // it, by calling the one payout path rather than re-implementing
              // it. This branch used to carry its own copy of the drop logic,
              // which is how a pet's kill came to skip the bounty, the quest
              // tick, the treasure roll and the shiny fanfare: your dog killing
              // a slime paid nothing while your arrow paid coins.
              // A pet is the player's (Combat.isPlayerKill): its kill pays
              // everything the player's own would.
              this.resolveDefeat(tgt, 'pet');
              c._chaseTarget = null;
            }
            if (c._hp <= 0) {
              // Pet retreats home to recover.
              c._hp = 1;
              c._chaseTarget = null;
              c._retreatUntilT = now + 30000;   // 30s forced home-bias
            }
          }
        }

        for (let attempt = 0; attempt < 6; attempt++) {
          // How far THIS step actually travels. A branch below may shorten it
          // (a guard walking home stops ON its seat rather than overshooting);
          // everything else takes the kind's full stride.
          let stepLen = stepM;
          if (c._chaseTarget && !this.save.caught?.includes(c._chaseTarget.id)) {
            const tgt = c._chaseTarget;
            angle = Math.atan2(tgt.y - c.y, tgt.x - c.x) + (Math.random() - 0.5) * 0.3;
          } else if (isFollowing && distToPlayer > FOLLOW_GAP) {
            angle = Math.atan2(dyp, dxp) + (Math.random() - 0.5) * 0.4;
          } else if (bolting) {
            // AWAY FROM THE PLAYER, at the kind's own spread: a rabbit
            // zig-zags in a panic (wide jitter), a deer runs a committed line
            // (mild), a butterfly careens (wider still). One branch, because
            // all three were the same line with a different number in it —
            // and the number is on the kind now.
            angle = Math.atan2(-dyp, -dxp) + (Math.random() - 0.5) * bolt.jitter;
          } else if (warded) {
            // Away from the WARD (Home, or the claimed castle's turret that
            // tripped it — `_wardFrom`), not away from the PLAYER: away-from-player would
            // shove the foe around the ring with the player still inside it,
            // and one standing on the far side of Home would be driven
            // straight through the door. Away-from-home always leaves.
            //   And it is an ANGLE, not a refused target cell like the
            // scarecrow and campfire wards below. A foe already deep inside
            // the ring would have all six of its attempts rejected by a cell
            // test — every hop it can reach is still inside — and it would
            // freeze on the doorstep forever, which is the stall the
            // "surrounded by scarecrows" comment further down warns about.
            angle = Math.atan2(c.y - c._wardFrom.y, c.x - c._wardFrom.x)
                  + (Math.random() - 0.5) * 0.8;
          } else if (wanderOff) {
            // WANDERING OFF: away from the PLAYER, on the same spread as the
            // rout above — out of whatever ring it was stalking the edge of.
            // An angle, not a refused cell, for the same reason as the rout;
            // the cell tests below still refuse water, rocks and fires.
            angle = Math.atan2(c.y - py, c.x - px) + (Math.random() - 0.5) * 0.8;
          } else if (lairState === 'hunt') {
            // THE GARRISON COMES AT YOU, as a group and with commitment. Its
            // own branch rather than the kind's idle logic below: a lair slime
            // would otherwise fall into the lazy half-the-hops meander that
            // makes a wild one read as a pest, and a garrison that ambles is
            // not something anybody runs from.
            // A trapper in the garrison hunts at its own distance: it comes
            // for you to lay, not to bite (keepDistanceAngle).
            angle = Combat.monsterLays(c.kind)
              ? keepDistanceAngle(distToPlayer, dxp, dyp, Combat.monster(c.kind).range * this.cellM, this.cellM)
              : distToPlayer > 0.5 * this.cellM
                ? Math.atan2(dyp, dxp) + (Math.random() - 0.5) * STALK_JITTER
                : Math.random() * Math.PI * 2;
          } else if (lairState === 'return') {
            // GIVEN UP: straight back to the seat it was spawned on, with only
            // enough jitter to keep a rank of them from marching in lockstep.
            // Not "away from the player" — that is the ward's shape and it
            // would scatter a garrison across the neighbourhood; a guard owes
            // its ruin a specific spot, and `stepLen` below lands it exactly
            // there rather than letting it overshoot and orbit forever.
            angle = Math.atan2(c.seatY - c.y, c.seatX - c.x) + (Math.random() - 0.5) * 0.3;
            stepLen = Math.min(stepM, Math.hypot(c.seatX - c.x, c.seatY - c.y));
          } else if (c.kind === 'slime') {
            // STRUCK: it charges. Every hop at the player, on the monsters'
            // stalk jitter — no coin flip, no meander. Below the warded
            // branch above on purpose: a slime being walked out of Home's ring
            // is warded whether or not you hit it, which is the whole point of
            // the ring.
            if (charging && distToPlayer > 0.5 * this.cellM) {
              angle = Math.atan2(dyp, dxp) + (Math.random() - 0.5) * STALK_JITTER;
            // Otherwise lazily drawn to the player: about half its hops amble
            // toward them (heavy ±0.7 rad jitter so it's a meander, not a
            // beeline), the rest are aimless. Slimes ignore home-bias — they
            // roam free and home in on whoever's nearby.
            } else if (!unnoticed && Math.random() < 0.5 && distToPlayer > 0.5 * this.cellM) {
              angle = Math.atan2(dyp, dxp) + (Math.random() - 0.5) * 1.4;
            } else {
              angle = Math.random() * Math.PI * 2;
            }
          } else if (isMon) {
            // Monsters HUNT: a committed stalk toward the player (tighter jitter
            // than the slime's meander), no home-bias. Flyers (bats) careen with
            // wide jitter so they read as erratic. The archer closes in too —
            // its range only lets it start draining sooner, not hang back.
            // The TRAPPER does hang back: it holds its row's `range` off the
            // player and circles there (keepDistanceAngle), laying as it goes.
            if (!unnoticed && Combat.monsterLays(c.kind)) {
              angle = keepDistanceAngle(distToPlayer, dxp, dyp, mon.range * this.cellM, this.cellM);
            } else if (!unnoticed && distToPlayer > 0.5 * this.cellM) {
              angle = Math.atan2(dyp, dxp)
                    + (Math.random() - 0.5) * (mon.fly ? STALK_JITTER * 2 : STALK_JITTER);
            } else {
              angle = Math.random() * Math.PI * 2;
            }
          } else if (homeBias) {
            angle = Math.atan2(dyh, dxh) + (Math.random() - 0.5) * 0.8;
          } else {
            angle = Math.random() * Math.PI * 2;
          }
          tx = c.x + Math.cos(angle) * stepLen;
          ty = c.y + Math.sin(angle) * stepLen;
          const { cellIX, cellIY } = worldMetersToAbsCell(this, tx, ty);
          if (this.placedRockSet && this.placedRockSet.has(cellKeyFromAbsCell(cellIX, cellIY))) continue;
          const dest = this.cellAt(tx, ty);
          if (dest.loaded && Combat.faunaBlocksCell(dest.type)) continue;
          // Scarecrow aversion — refuse any target cell within 4 cells of an
          // active scarecrow to a kind whose row says it keeps clear of one
          // (crow + deer). They get bounced by the attempt loop until they
          // pick a different direction.
          if (SpriteLayout.creatureAvoids(c.kind, 'scarecrow')
              && this._nearAny('scarecrows', tx, ty, 4)) continue;
          // Fire aversion — a lit campfire repels the surface slime exactly
          // like a scarecrow repels crows/deer, so it can't ooze into (or
          // steal energy across) the warm ring around a campfire. Extended to
          // the cave's own entry-level monsters (FIRE_WARD_MAX_DEPTH): a
          // goblin or its archer is undeterred by firelight, only the cave
          // slime and purple slime it's a tier above.
          //   NOT A LAIR GUARD, whatever kind it is. A garrison is a place,
          // not wandering fauna: a campfire dropped by the door cannot empty a
          // ruin, and — the part that would actually have bitten — a guard
          // walking home past a fire would have all six of its attempts
          // refused and freeze in the street, which is the same stall the
          // scarecrow note above warns about. A goblin garrison is past the
          // depth cap anyway; this is what covers the slimes.
          const fireAverts = !c.lair && (c.kind === 'slime' ||
            (isMon && (mon.minDepth || 1) <= FIRE_WARD_MAX_DEPTH));
          // The ward's ring is FIRE_REST_R — the same ring the fire lights
          // (Lighting.KINDS.fire) and warms (update()'s rest) — never a
          // literal of its own (it was 4 while light and rest were 3).
          if (fireAverts && this._nearAny('fires', tx, ty, FIRE_REST_R)) continue;
          foundValidTarget = true;
          break;
        }
        // If every attempt was blocked (e.g. crow surrounded by scarecrows
        // / water / buildings), stand still instead of moving onto a bad
        // cell — the old code took the last attempted target which let
        // crows phase into the very cell the aversion was supposed to
        // protect.
        if (!foundValidTarget) { tx = c.x; ty = c.y; }
        // Deer crop damage: each wander step, 20% chance to eat the nearest
        // planted crop within 1.5 cells, outside Home's ring (homeGuardsCrop). Scarecrows already avert the deer
        // before this point, so no extra scarecrow check needed here.
        if (beh?.raidsCrops && !isTame && this.save.planted?.length) {
          const DR2 = (1.5 * this.cellM) * (1.5 * this.cellM);
          if (Math.random() < 0.20) {
            const idx = this.save.planted.findIndex(p => {
              if (this.homeGuardsCrop(p)) return false;   // Home's yard
              const ddx = p.x - c.x, ddy = p.y - c.y;
              return ddx * ddx + ddy * ddy <= DR2;
            });
            if (idx >= 0) {
              this.save.planted.splice(idx, 1);
              this.flash?.('🦌 crop eaten!', this.viewCenterX, this.viewCenterY - 60);
            }
          }
        }
        c._startX = c.x; c._startY = c.y;
        c._targetX = tx; c._targetY = ty;
        c._stepT0 = now;
        c._hopMs = stepMs;
        // A kind that sits still between hops does it for [base, spread] ms —
        // the rabbit, short when it is bolting and long when it is not.
        const pause = bolting ? bolt.pauseMs : (gait ? gait.pauseMs : null);
        const pauseMs = pause ? pause[0] + Math.random() * pause[1] : 0;
        c._nextChooseT = now + stepMs + pauseMs;
        c._faceFlip = (c._targetX - c._startX) < 0;
      }
      const u = Math.min(1, (now - c._stepT0) / (c._hopMs || STEP_MS));
      c.x = c._startX + (c._targetX - c._startX) * u;
      c.y = c._startY + (c._targetY - c._startY) * u;
    });
    // One throttled flash for everything the slimes drained this window, so a
    // swarm reads as a single "-N⚡" pop rather than 50 of them. Persist here
    // too (debounced in save.js) so the energy loss survives a reload.
    if (this._slimeStealAccum > 0 && now - (this._lastSlimeFlashT || 0) > 1200) {
      this._lastSlimeFlashT = now;
      const drained = this._slimeStealAccum;
      this._slimeStealAccum = 0;
      this._popEnergy(-drained, { label: '🟢 slime' });
      if (typeof persistSave === 'function') persistSave(this.save);
    }
    // Same throttled roll-up for underground monster hits, so a pack reads as a
    // single "-N⚡" pop rather than one flash per monster.
    if (this._monsterDmgAccum > 0 && now - (this._lastMonsterFlashT || 0) > 1200) {
      this._lastMonsterFlashT = now;
      const hit = this._monsterDmgAccum;
      this._monsterDmgAccum = 0;
      this._popEnergy(-hit, { label: '⚔️ monsters' });
      if (typeof persistSave === 'function') persistSave(this.save);
    }
  }

  // Per-tick movement for wild crows. Three-phase state machine:
  //   PERCH      → still for 2–4.5 s
  //   FLIGHT     → one eased glide over ~800–1200 ms covering ~1–2.5 cells
  //                (slow + short — crows used to be too fast / fly too far)
  //   DESTROYING → committed to a planted crop; the crow must perch ON the
  //                crop for 2 full cycles (hopping in place) before it eats.
  // The flight target is usually picked by ORBITING the nearest crop at
  // radius ~1.5–3.5 cells (so the crow looks like it's circling, casing
  // the field). With ~30% probability the chosen orbit ring collapses
  // toward radius 0 — a "landing attempt" that may end with the crow's
  // landed position inside the crop's cell, starting the 2-cycle pause.
  // Once committed, the crow keeps hopping on the crop, decrementing the
  // cycle counter each landing; it eats only when the counter hits 0.
  // Defeating the crow during the pause cancels the destruction, giving the
  // player a generous grace window.
  // A crow's FULL RETREAT: it launches on this very tick (out of its perch,
  // any flight cut short) and hops straight away from the player for the
  // usual ~2.5–4 minutes (CROW_DEPART_MS), ignoring crops, until it drifts
  // off the sim range and is simply gone. One retreat, two reasons: a crow
  // that has eaten, and a crow the player has started to hunt (interact.js)
  // — a hunted crow used to carry on orbiting as if nothing had happened.
  _crowDepart(c, now = performance.now()) {
    const [base, spread] = CROW_DEPART_MS;
    c._departUntilT = now + base + Math.random() * spread;
    c._perchUntilT = now;
    c._flightUntilT = null;
  }

  _wildCrowTick(c, now, px, py) {
    // A fleeing crow (just hit by a pet) skips crop logic and bolts away in
    // short fast dashes, reusing the SAME FLIGHT-phase fields (_flightUntilT /
    // _startX,Y / _targetX,Y / _flightT0) that a normal orbiting glide uses —
    // so the dash gets the existing eased-interpolation code below for free
    // instead of a second position-update path.
    //   This used to just `return` here for the whole 8s flee window — the
    // comment said "skips crop logic and runs" but nothing ran: c.x/c.y are
    // ONLY ever written inside this function, so returning before touching
    // them froze the crow in place while a cat/dog kept landing hits on a
    // stationary target. See CLAUDE.md FINDING 1 / test/node/crow_flee.test.js.
    const fleeing = c._fleeUntilT && c._fleeUntilT > now;
    if (fleeing) {
      // A crow being mauled doesn't finish casing the crop first — abandon
      // any in-progress destroy pause so recovering later starts clean.
      c._destroyCropRef = null;
      c._destroyCyclesLeft = 0;
      c._destroyAtT = null;
      // _fleeDash marks a flight leg as ITS OWN panic dash (vs. a normal
      // orbit glide that was already in flight the instant the hit landed).
      // Without that distinction the check below would happily keep gliding
      // the crow ALONG ITS OLD PRE-HIT COURSE — e.g. still inbound to the very
      // crop it was casing — for up to a full 1200ms glide before the flee
      // ever took effect, unlike every other kind's flee override (:6249),
      // which reacts on the very next tick.
      if (c._flightUntilT && now < c._flightUntilT && c._fleeDash) {
        const dur = c._flightUntilT - c._flightT0;
        const t = Math.min(1, (now - c._flightT0) / dur);
        const u = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        c.x = c._startX + (c._targetX - c._startX) * u;
        c.y = c._startY + (c._targetY - c._startY) * u;
        return;
      }
      // Between dashes (or reacting to the hit for the first time) — launch a
      // new short burst directly away from the hit angle, same ±0.6 rad
      // jitter the generic flee override uses so a fleeing crow reads like
      // every other fleeing kind.
      const fa = c._fleeAngle ?? 0;
      for (let attempt = 0; attempt < 4; attempt++) {
        const fleeAngle = fa + (Math.random() - 0.5) * 0.6;
        const d = 2 * this.cellM;
        const ftx = c.x + Math.cos(fleeAngle) * d;
        const fty = c.y + Math.sin(fleeAngle) * d;
        const dest = this.cellAt(ftx, fty);
        if (dest.loaded && !Combat.faunaBlocksCell(dest.type)) {
          c._startX = c.x; c._startY = c.y;
          c._targetX = ftx; c._targetY = fty;
          c._flightT0 = now;
          // Quicker than a normal 800-1200ms orbit glide — panic speed.
          c._flightUntilT = now + 350 + Math.random() * 200;
          c._fleeDash = true;
          c._faceFlip = (ftx - c.x) < 0;
          break;
        }
      }
      // All 4 attempts blocked (e.g. cornered by water/buildings): stand
      // still this tick and retry next tick rather than phasing into a bad
      // cell — same policy the orbit-flight target search uses below.
      return;
    }
    // (1) Resolve any pending crop destruction. The destroy timer arms
    // when the crow lands on a crop's cell; it fires here if the crop
    // is still present, or quietly cancels if the player harvested it
    // first.
    if (c._destroyCropRef && this.save.planted.indexOf(c._destroyCropRef) < 0) {
      c._destroyCropRef = null;
      c._destroyAtT = null;
      c._destroyCyclesLeft = 0;
    }
    if (c._destroyAtT != null && now >= c._destroyAtT) {
      const idx = c._destroyCropRef ? this.save.planted.indexOf(c._destroyCropRef) : -1;
      if (idx >= 0) {
        this.save.planted.splice(idx, 1);
        this.flash?.('🐦 crop eaten!', this.viewCenterX, this.viewCenterY - 60);
        // Sated: after a meal the crow takes off and stays away for a few
        // minutes before it will case the field again.
        this._crowDepart(c, now);
      }
      c._destroyCropRef = null;
      c._destroyAtT = null;
    }
    // (2) Initialise rhythm on first encounter.
    if (c._perchUntilT == null && c._flightUntilT == null) {
      c._perchUntilT = now + 1500 + Math.random() * 2500;
    }
    // (3) FLIGHT phase — interpolate with ease-in/out toward target.
    if (c._flightUntilT && now < c._flightUntilT) {
      const dur = c._flightUntilT - c._flightT0;
      const t = Math.min(1, (now - c._flightT0) / dur);
      const u = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      c.x = c._startX + (c._targetX - c._startX) * u;
      c.y = c._startY + (c._targetY - c._startY) * u;
      return;
    }
    // (4) FLIGHT completion — snap to final, start a new perch, and
    // arm the destroy timer if we landed on a planted crop's cell.
    if (c._flightUntilT && now >= c._flightUntilT) {
      c.x = c._targetX;
      c.y = c._targetY;
      c._flightUntilT = null;
      c._perchUntilT = now + 2000 + Math.random() * 2500;
      c._faceFlip = (c._targetX - c._startX) < 0;
      if (this.save.planted) {
        const NEAR2 = (this.cellM * 0.5) * (this.cellM * 0.5);
        let landedOn = null;
        for (const pp of this.save.planted) {
          if (!this._crowRaids(pp)) continue;   // not potato, not in Home's yard
          const ddx = pp.x - c.x, ddy = pp.y - c.y;
          if (ddx * ddx + ddy * ddy <= NEAR2) { landedOn = pp; break; }
        }
        if (landedOn) {
          // Require the crow to pause for 2 full perch cycles ON the crop
          // before it destroys it. The first landing starts the count; each
          // subsequent landing on the SAME crop decrements it.
          if (c._destroyCropRef === landedOn) {
            c._destroyCyclesLeft = (c._destroyCyclesLeft || 1) - 1;
          } else {
            c._destroyCropRef = landedOn;
            c._destroyCyclesLeft = 2;
          }
          // When the pause is spent, arm the destroy timer to fire on the
          // next resolution tick (step 1).
          if (c._destroyCyclesLeft <= 0) c._destroyAtT = now;
        } else {
          // Drifted off the crop — abandon any in-progress pause.
          c._destroyCropRef = null;
          c._destroyCyclesLeft = 0;
          c._destroyAtT = null;
        }
      }
      return;
    }
    // (5) PERCH phase — sit still until the timer expires.
    if (c._perchUntilT && now < c._perchUntilT) return;

    // (6) Time to launch a new flight burst. Pick a target with up to
    // 6 attempts so we can reject water / buildings / scarecrow rings.
    let tx = c.x, ty = c.y, chosen = false;
    // Sated crow leaving the field — ignore all crops and fly steadily away
    // from the player until the few-minute timer lapses (it freezes once it
    // drifts off the sim range, so it simply stays gone).
    const departing = c._departUntilT && now < c._departUntilT;
    if (departing) { c._destroyCropRef = null; c._destroyCyclesLeft = 0; c._destroyAtT = null; }
    const committed = !departing && c._destroyCropRef &&
      c._destroyCyclesLeft > 0 && this.save.planted &&
      this.save.planted.indexOf(c._destroyCropRef) >= 0;
    for (let attempt = 0; attempt < 6 && !chosen; attempt++) {
      if (departing) {
        // Long outbound hop directly away from the player, with a little jitter.
        const away = Math.atan2(c.y - py, c.x - px) + (Math.random() - 0.5) * 0.6;
        const d = (2 + Math.random() * 0.5) * this.cellM;
        tx = c.x + Math.cos(away) * d;
        ty = c.y + Math.sin(away) * d;
      } else if (committed) {
        // Committed to a crop mid-pause — keep hopping in place ON the crop
        // so each landing counts down a cycle toward destruction.
        const ang = Math.random() * Math.PI * 2;
        const r = Math.random() * 0.3 * this.cellM;
        tx = c._destroyCropRef.x + Math.cos(ang) * r;
        ty = c._destroyCropRef.y + Math.sin(ang) * r;
      } else if (this.save.planted && this.save.planted.length) {
        // ORBIT the nearest planted crop the crow can NOTICE. Notice radius is
        // DETECT_R (~8 cells — the on-screen sim range, so crows spot a field
        // from across the viewport). They don't teleport in, though: the
        // flight-leg cap below makes them approach over several short hops, so
        // a far crow visibly flies toward the field rather than snapping onto
        // it. Deliberate pest crows (id `pest_crow_*`) keep unlimited range.
        // 30% of notice-flights collapse to a tight ring that may land on the
        // crop cell.
        const isPest = typeof c.id === 'string' && c.id.startsWith('pest_crow_');
        const DETECT_R = 8 * this.cellM;
        let nearest = null, bestD2 = isPest ? Infinity : DETECT_R * DETECT_R;
        for (const pp of this.save.planted) {
          if (!this._crowRaids(pp)) continue;   // not potato, not in Home's yard
          const dx = pp.x - c.x, dy = pp.y - c.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < bestD2) { bestD2 = d2; nearest = pp; }
        }
        if (nearest) {
          const landAttempt = Math.random() < 0.30;
          const radius = landAttempt
            ? Math.random() * 0.4 * this.cellM
            : (1.5 + Math.random() * 2.0) * this.cellM;   // spec orbit ring 1.5-3.5 cells
          const ang = Math.random() * Math.PI * 2;
          tx = nearest.x + Math.cos(ang) * radius;
          ty = nearest.y + Math.sin(ang) * radius;
        } else {
          const a = Math.random() * Math.PI * 2;
          const d = (1 + Math.random() * 1.5) * this.cellM;
          tx = c.x + Math.cos(a) * d;
          ty = c.y + Math.sin(a) * d;
        }
      } else {
        // No crops to harass — random roam, ~1–2.5 cell hops.
        const a = Math.random() * Math.PI * 2;
        const d = (1 + Math.random() * 1.5) * this.cellM;
        tx = c.x + Math.cos(a) * d;
        ty = c.y + Math.sin(a) * d;
      }
      // Cap any single flight leg to ~2.5 cells so a crow APPROACHES a crop
      // over several hops instead of teleport-swooping the whole distance in
      // one glide. In-place hops (committed) and short roams are already
      // under the cap; this only shortens a long approach toward a noticed
      // crop. Capping BEFORE the cell gate means the intermediate landing
      // point — not the far crop — is what gets validated for water/buildings.
      const MAX_LEG = 2.5 * this.cellM;
      const legDX = tx - c.x, legDY = ty - c.y;
      const legD = Math.hypot(legDX, legDY);
      if (legD > MAX_LEG) {
        tx = c.x + (legDX / legD) * MAX_LEG;
        ty = c.y + (legDY / legD) * MAX_LEG;
      }
      // Reject targets on water / buildings / roads / placed rocks. Same gate
      // the generic wander uses.
      const dest = this.cellAt(tx, ty);
      if (dest.loaded && Combat.faunaBlocksCell(dest.type)) continue;
      const { cellIX, cellIY } = worldMetersToAbsCell(this, tx, ty);
      if (this.placedRockSet && this.placedRockSet.has(cellKeyFromAbsCell(cellIX, cellIY))) continue;
      // Scarecrow aversion — refuse any target within 4 cells of an active scarecrow.
      if (this._nearAny('scarecrows', tx, ty, 4)) continue;
      chosen = true;
    }
    if (!chosen) {
      // All 6 attempts blocked — perch a bit longer and re-roll later.
      c._perchUntilT = now + 800;
      return;
    }
    c._startX = c.x; c._startY = c.y;
    c._targetX = tx; c._targetY = ty;
    c._flightT0 = now;
    c._flightUntilT = now + 800 + Math.random() * 400;   // 800–1200 ms slow glide
    c._perchUntilT = null;
    c._faceFlip = (tx - c.x) < 0;
    // This is a normal orbit glide, not a flee dash — clear the marker so a
    // FUTURE hit mid-glide doesn't mistake this leg for an in-progress dash
    // and wrongly keep flying it out before reacting (see the fleeing branch
    // above).
    c._fleeDash = false;
  }

  catchCreature(c, sx, sy) {
    this.save.caught.push(c.id);   // keep so the creature doesn't respawn
    // If this was a player-released creature, also trim it from save.released so the
    // array doesn't grow unbounded across many release-and-recatch cycles.
    if (this.save.released) {
      const ri = this.save.released.findIndex(r => r.id === c.id);
      if (ri >= 0) this.save.released.splice(ri, 1);
    }
    // A shiny animal stays shiny in its own per-kind stack (shiny_chicken,
    // shiny_cow, …) — never folded into the plain stack or other shinies. It
    // also pays the headline 10× money + memory with fanfare.
    const isShinyCatch = !!c.shiny && !!ITEM_BY_ID[`shiny_${c.kind}`];
    const invId = isShinyCatch ? `shiny_${c.kind}` : c.kind;
    // addToInv already persists; passing silent=true to avoid a double write.
    this.addToInv(invId, 1, true);
    persistSave(this.save);
    const item = ITEM_BY_ID[invId];
    // flashLoot draws the item's sprite (from the itemId arg) beside the text,
    // so the text carries the name only — no emoji standing in for the item.
    this.flashLoot(`+1 ${item?.name || invId}`, isShinyCatch ? '#ffd23a' : '#a7ffb0', 1, invId);
    if (isShinyCatch) this.awardShinyBonus(c.kind, sx, sy);
  }
}
