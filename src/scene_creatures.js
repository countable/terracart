// The scene's CREATURES — what lives on a tile, and how it moves once it
// does. Three pieces that share one list (entry.creatures):
//   · per-tile SPAWNING: spawnInTile (the surface pass — fauna, crows, traps,
//     the buried X marks and their bonus streams, placed saplings — drawn off
//     the tile's GENERATED layer and handed `_spawnOpts`, the shared road
//     mask + occupied set) with _cullOffLiveGround (the per-player cull after
//     it), and spawnCaveCreatures (the cave's monsters and traps by depth);
//   · the SIM: wanderCreatures (the per-tick loop — the `unnoticed` gate,
//     the fire / Home / castle wards, pets, the lairs' chase, the monsters'
//     hit and arrow, the ghosts' pump, the hard-mode pest deer's pump) with
//     the wild crow's own tick (_wildCrowTick) and its retreat (_crowDepart);
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
// raiderEatsCrop, persistSave, VIEW_CELLS, …), creature_ai.js's helpers and
// this._popEnergy / this._cropRaidable / this._pestFreeZone / … at CALL time
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
// (starter.js, reached through app.js's one-line wrappers), and not the crop
// raider's predicate (_cropRaidable, app.js). See CLAUDE.md
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
// or goblin archer (minDepth 3) — and their giants, at their own roster
// depths — are past what a lit campfire can plausibly hold off; only
// Home's stronger ward (HOME_R, surface only) turns those around.
const FIRE_WARD_MAX_DEPTH = 1;

// ── Buried X marks: how thick they lie on SAND ────────────────────────────
// A tile's X marks are a flat scatter of 4-10 over every walkable cell plus a
// bonus stream beside footpaths — over a 2.4 km tile that is nothing at all
// along a shoreline, and a beach is the one ground people actually dig. So
// sand gets its own bonus stream, capped at one mark per BEACH_X_PER_CELLS
// cells of it so a golf bunker or a sandpit can't draw the whole roll while a
// real beach can. That cap now reads INLAND sand only: SHORE sand (by the
// water, src/scenic.js) lays one mark per Scenic.BEACH_X_SHORE_M of
// shoreline, up to Scenic.BEACH_X_MAX, on its own stream. Read by spawnInTile's beach block; pinned by
// test/node/beach_treasure.test.js.
const BEACH_X_PER_CELLS = 20;
// How many favourite-ground cells an attracted animal tries before it keeps
// its drawn seat (see _seatFaunaOnFavouriteGround).
const FAUNA_ATTRACT_TRIES = 12;
// How far (cells, Chebyshev) from a street lair's point OPEN ground may lie
// for the lair to stand (spawnInTile's attractor test): a gate's point is on
// its own way, so the verge beside it is what answers.
const LAIR_POINT_SLACK_CELLS = 1;

class SceneCreatures {
  _revealMimic(o) {
    if (this.depth > 0 || !(this.tileEdgeM > 0)) return false;
    const tx = Math.floor(o.x / this.tileEdgeM), ty = Math.floor(o.y / this.tileEdgeM);
    const entry = WorldGen.tileCache.get(WorldGen.tileKey(tx, ty));
    if (!entry?.creatures) return false;
    const id = 'mimic:' + o.id;
    const revealed = (this.save.revealedMimics ||= []);
    if (!revealed.some(c => c.id === id)) revealed.push({ id, chestId: o.id, x: o.x, y: o.y });
    if (!entry.creatures.some(c => c.id === id)) {
      entry.creatures.push(WorldGen.makeCreature('mimic', o.x, o.y, id, {
        depth: 0, shiny: false, _hunting: true,
      }));
    }
    return true;
  }
  _restoreMimics(entry, tx, ty) {
    if (this.depth > 0 || !(this.tileEdgeM > 0)) return;
    const caught = new Set(this.save.caught || []);
    const liveIds = new Set(entry.creatures.map(c => c.id));
    for (const c of this.save.revealedMimics || []) {
      if (!Number.isFinite(c.x) || !Number.isFinite(c.y) || !c.id
          || Math.floor(c.x / this.tileEdgeM) !== tx || Math.floor(c.y / this.tileEdgeM) !== ty
          || caught.has(c.id) || liveIds.has(c.id)) continue;
      entry.creatures.push(WorldGen.makeCreature('mimic', c.x, c.y, c.id, {
        depth: 0, shiny: false, _hunting: true,
      }));
      liveIds.add(c.id);
    }
  }
  // THE SPAWN PASS, run straight through — the centre tile (the ground the
  // player stands on appears whole) and every caller that cannot await. The
  // pass itself is spawnInTileSteps; the neighbour ring drives it sliced
  // (_spawnInTileSliced). Same steps, same result.
  spawnInTile(entry, tx, ty) {
    return WorldGen.runSteps(this.spawnInTileSteps(entry, tx, ty));
  }

  // The spawn pass SLICED on the tile builder's heavy chain (WorldGen
  // runStepsSliced): 20-70 ms per ring tile (160 ms the first) used to run
  // unbroken as the tail of that tile's build. One pass per entry — a second
  // ask (a newer ensureTilesAround reaching the same tile mid-pass) gets the
  // pass in flight, never a rival. Aborted, between slices, once the entry is
  // no longer the surface cache's (evicted, or replaced by a rebuild — which
  // runs its own pass): its half-dressed state is then nobody's. Resolves true
  // when the pass ran to the end.
  _spawnInTileSliced(entry, tx, ty) {
    if (entry._spawned) return Promise.resolve(true);
    if (entry._spawnPass) return entry._spawnPass;
    const key = WorldGen.tileKey(tx, ty);
    const gone = () => WorldGen.tileCacheFor(0).get(key) !== entry;
    const pass = WorldGen.runStepsSliced(() => this.spawnInTileSteps(entry, tx, ty), { abort: gone })
      .then((r) => r !== WorldGen.STEPS_ABORTED && !!entry._spawned)
      .finally(() => { if (entry._spawnPass === pass) entry._spawnPass = null; });
    entry._spawnPass = pass;
    return pass;
  }

  // Yields between its phases (and inside the tile-wide loops), and only
  // BEFORE entry._spawned is raised: from there to the end it is one slice,
  // so nothing outside ever meets an entry flagged spawned with its traps or
  // treasure still to come. The heavy but pure work of that stretch (the trap
  // draw, the path / sand / pier scan) is done ahead, before the flag.
  *spawnInTileSteps(entry, tx, ty) {
    // Read once: a sliced pass must not change its mind between slices.
    const testMode = !!window.__TEST_MODE;
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
    let _nOcc = 0;
    for (const records of [genObjects, entry.wildplants || []]) for (const o of records) {
      if (((_nOcc++) & 511) === 511) yield 'spawn occupancy';
      for (const i of SpawnOwnership.tileCells(this, entry, o, tx, ty)) _occupiedIdx.add(i);
    }
    // Even pets only belong near street frontage / public space inside a
    // residential block, so creature placement shares the spawn rule too.
    // POI chests (already placed by worldgen) count as public anchors.
    const _spawnOpts = {
      // The tile's road footprint — wider than the road TERRAIN wherever the
      // real carriageway is (a motorway's band covers a cell either side of
      // the one it paints). Without it a candidate reads the grid, is told
      // "grass", and lands in the middle of the asphalt. A parking lot is
      // open ground: its aisles draw no band (WorldGen.isParkingAisle), so
      // the mask is silent there and spawns are legal.
      roadMask: entry.roadMask,
      // THE SPAWN GATE (worldgen stampSpawnWhySteps — entry.spawnWhy): WHY
      // each cell is refused, as reason bits. Every spawner below names its
      // class to isSpawnCell (WorldGen.SPAWN_CLASS_BLOCKS — a creature's via
      // creatureSpawnClass), and the class's row says which typed reasons
      // (kerb, sensitive) it refuses; the hard ones (road band, quiet /
      // restricted land, kindergartens, back yards, a field's interior, …)
      // refuse all.
      spawnWhy: entry.spawnWhy,
      // The major roads' band / verge / KERB BUFFER bits (worldgen
      // ROAD_CLASS_*) and the QUIET LAND: read by isSpawnCell only on an
      // entry built without a mask (the parts the mask folds together).
      roadClass: entry.roadClass,
      quiet: entry.quietMask,
      occupied: _occupiedIdx,
      pois: genObjects
        .filter(o => o.kind === 'chest' || o.kind === 'grove_shrine')
        .map(o => ({
          ix: Math.floor((o.x - tx * this.tileEdgeM) / cellM),
          iy: Math.floor((o.y - ty * this.tileEdgeM) / cellM),
        })),
    };
    // Replay authored scenery in priority order: place landmarks, zones,
    // then roads. Full footprints matter when anchors occupy different cells.
    // Generated cave mouths already hold their seats in _occupiedIdx.
    let streetTreasures = [];
    entry.streetLairs = [];
    entry.slowCells = null;
    entry.streetMarks = null;
    const sDress = entry.scenicDress;
    if (sDress && !testMode) {
      const lay = (p) => {
        const cells = SpawnOwnership.tileCells(this, entry, p, tx, ty);
        if (!cells.length || cells.some(i => _occupiedIdx.has(i))) return false;
        for (const i of cells) _occupiedIdx.add(i);
        return true;
      };
      entry.objects = entry.objects || [];
      for (const o of sDress.objects) if (lay(o)) entry.objects.push(o);
      entry.wildplants = entry.wildplants || [];
      for (const wp of sDress.wildplants) if (lay(wp)) entry.wildplants.push(wp);
    }
    yield 'spawn scenic dressing';
    const zoneTraps = [], zoneGuards = [], zoneTreasures = [];
    const zDress = entry.zoneDress;
    entry.reefCorals = !testMode ? (zDress?.corals || []).map(o => ({ ...o, kind: 'reef_coral' })) : [];
    if (zDress && !testMode) {
      const cellIdx = (p) => {
        const ix = Math.floor((p.x - tx * this.tileEdgeM) / cellM);
        const iy = Math.floor((p.y - ty * this.tileEdgeM) / cellM);
        return (ix >= 0 && iy >= 0 && ix < N && iy < N) ? iy * N + ix : -1;
      };
      const lay = (p) => {
        const cells = SpawnOwnership.tileCells(this, entry, p, tx, ty);
        if (!cells.length || cells.some(i => _occupiedIdx.has(i))) return false;
        for (const i of cells) _occupiedIdx.add(i);
        return true;
      };
      entry.objects = entry.objects || [];
      const slow = entry.slowCells || new Map();
      const quarryHome = typeof this.homeWorldPos === 'function' ? this.homeWorldPos() : null;
      const quarryHomeRadius = HOME_R * (this.cellM || cellM);
      const liveSeats = new Set();
      for (const o of entry.objects) if (o.kind !== 'lava_vent') {
        for (const i of SpawnOwnership.tileCells(this, entry, o, tx, ty)) liveSeats.add(i);
      }
      const placedZoneObjects = new Set();
      for (const o of zDress.objects) {
        if (o.kind === 'lava_vent') {
          const i = cellIdx(o);
          const protectedSeat = _occupiedIdx.has(i) || liveSeats.has(i)
            || (quarryHome && Math.hypot(o.x - quarryHome.x, o.y - quarryHome.y) <= quarryHomeRadius);
          // Home and player objects are a live overlay, never an input to the
          // shared generated world or the caves derived from its base grid.
          if (protectedSeat && entry.grid[i] === WorldGen.T.CAVE_LAVA) {
            if (entry.grid === genGrid) entry.grid = entry.grid.slice();
            entry.grid[i] = WorldGen.T.ROCK;
          }
          if (protectedSeat || entry.grid[i] !== WorldGen.T.CAVE_LAVA) continue;
        }
        if (!lay(o)) continue;
        entry.objects.push(o);
        placedZoneObjects.add(o.id);
        if (StreetVariants.isSlowKind(o.kind)) slow.set(cellIdx(o), o.kind);
      }
      entry.wildplants = entry.wildplants || [];
      for (const wp of zDress.wildplants) if (lay(wp)) entry.wildplants.push(wp);
      // Claim every generated seat even after a kill/disarm. Player progress
      // may hide a piece, but must never reveal a different spawn underneath.
      for (const trap of (zDress.traps || [])) if (lay(trap)) zoneTraps.push({ ...trap });
      for (const guard of (zDress.guards || [])) if (lay(guard)) zoneGuards.push(guard);
      for (const treasure of (zDress.treasures || [])) {
        const placed = treasure.coverRockId ? placedZoneObjects.has(treasure.coverRockId) : lay(treasure);
        if (placed) zoneTreasures.push(treasure);
      }
      for (const L of (zDress.lairs || [])) entry.streetLairs.push(L);
      // Empty hull and approach cells remain unavailable to later surface scatter.
      // Claim after laying the authored contents, including the wreck's chest.
      for (const i of zDress.reservedCells || []) _occupiedIdx.add(i);
      entry.slowCells = slow.size ? slow : null;
    }
    yield 'spawn zone dressing';
    const dressing = entry.streetDress;
    // A rebuilt tile carries live coinDrops. Replace its authored road coins
    // from the new dressing so collected or newly overridden seats disappear;
    // bounty and burst coins keep their existing session state.
    if (entry.coinDrops) entry.coinDrops = entry.coinDrops.filter(c => c._street !== 'golden');
    if (dressing && typeof StreetVariants !== 'undefined' && !testMode) {
      const cellIdx = (p) => {
        const ix = Math.floor((p.x - tx * this.tileEdgeM) / cellM);
        const iy = Math.floor((p.y - ty * this.tileEdgeM) / cellM);
        return (ix >= 0 && iy >= 0 && ix < N && iy < N) ? iy * N + ix : -1;
      };
      const lay = (p) => {
        const cells = SpawnOwnership.tileCells(this, entry, p, tx, ty);
        if (!cells.length || cells.some(i => _occupiedIdx.has(i))) return false;
        for (const i of cells) _occupiedIdx.add(i);
        return true;
      };
      entry.objects = entry.objects || [];
      const slow = entry.slowCells || new Map();
      for (const o of dressing.objects) {
        if (!lay(o)) continue;
        entry.objects.push(o);
        if (StreetVariants.isSlowKind(o.kind)) slow.set(cellIdx(o), o.kind);
      }
      entry.wildplants = entry.wildplants || [];
      for (const wp of dressing.wildplants) if (lay(wp)) entry.wildplants.push(wp);
      for (const trap of (dressing.traps || [])) if (lay(trap)) zoneTraps.push({ ...trap });
      streetTreasures = dressing.treasures.filter(lay);
      const found = setOf(this.save.foundTreasures || []);
      const coinIds = new Set((entry.coinDrops || []).map(c => c.id));
      const zoneCoverage = entry.zone && (entry.zone.coverage || entry.zone.idx);
      for (const coin of (dressing.coins || [])) {
        if (coinIds.has(coin.id) || zoneCoverage?.[cellIdx(coin)] || !lay(coin)) continue;
        // Reserve even collected seats: a save delta must not change which
        // lower-priority pieces the generated layout admits.
        coinIds.add(coin.id);
        if (!found.has(coin.id)) (entry.coinDrops || (entry.coinDrops = [])).push(coin);
      }
      entry.streetLairs.push(...dressing.lairs);
      entry.slowCells = slow.size ? slow : null;
      entry.streetMarks = dressing.marks;
    }
    yield 'spawn street dressing';
    // BANDIT STOPS: a bus stop on a MAJOR road wears the broken wagon
    // (loot.js chestLook) and holds one goblin (lairs.js 'wagon' tier). Read
    // off the live objects so an Overpass bin's stops are included.
    if (typeof StreetVariants !== 'undefined' && entry.roadClass) {
      for (const L of StreetVariants.markBanditStops(entry.objects, entry.roadClass, N, tx, ty, this.tileEdgeM)) {
        entry.streetLairs.push(L);
      }
    }
    // GATES: a gate is a pair of posts round a SPAWN POINT (worldgen.js
    // gatePostsAt stamps `gateSid` and the point on each post) — one lair
    // candidate per gate, the lairs.js 'gate' tier (a foe a day). Read off the
    // live objects, like the bandit stops, so an Overpass bin's gates count.
    {
      const seen = new Set();
      for (const o of entry.objects || []) {
        if (o.kind !== 'gatepost' || !o.gateSid || seen.has(o.gateSid)) continue;
        seen.add(o.gateSid);
        entry.streetLairs.push({ tier: 'gate', sid: o.gateSid,
          lx: o.gateX - tx * this.tileEdgeM, ly: o.gateY - ty * this.tileEdgeM });
      }
    }
    // A LAIR POINT IS AN ATTRACTOR: a gate's daily foe, a street's guard, a
    // café hoard's giant — each is kept only where attractor ground (the
    // spawn gate: off sensitive ground and every hard reason — yards,
    // kindergartens, a field's interior) lies within LAIR_POINT_SLACK_CELLS of
    // its point — a gate's point sits on its own way, so the ground BESIDE it
    // answers. A gate in a kindergarten's fence or deep in a field gets no foe. The guards' own
    // seats are their kind's class (lairs.js, creatureSpawnClass).
    if (entry.streetLairs.length) {
      const lairOpts = { roadMask: entry.roadMask, spawnWhy: entry.spawnWhy,
        roadClass: entry.roadClass, quiet: entry.quietMask };
      entry.streetLairs = entry.streetLairs.filter((L) => {
        const ix = Math.floor(L.lx / cellM), iy = Math.floor(L.ly / cellM);
        return !!WorldGen.relocateToSpawnCell(genGrid, N, N, ix, iy, lairOpts, LAIR_POINT_SLACK_CELLS, 'attractor');
      });
    }
    // Home holds no slimes or crows until the first harvest (see
    // PEST_FREE_CELLS). Resolved once per tile build; null once the grace has
    // lapsed, which is the common case.
    const pestFree = this._pestFreeZone(tx, ty);
    // DISPLACED, NOT LOST: an animal every one of whose 12 draws failed, at
    // least one of them only because something GENERATED already stood on
    // the cell (the street dressing, the nexus — opts.occupied), is kept
    // aside here instead of dropped; the attractor lane below seats it on its
    // favourite ground if its species has one it always takes (a p = 1
    // column — none today: the dogs' major-verge pull was removed, Sep 2026,
    // as it seated animals beside fast traffic). No extra draws: the shared stream is
    // untouched, only the verdict on a spent attempt is remembered.
    const unseated = [];
    // Animals can share interactable cells. Enemies still reserve their seats
    // before save-specific filtering, including the rooted park enemies.
    const ambientOccupied = new Set(_occupiedIdx);
    for (let i = 0; i < N * N; i++) {
      if ((i & 8191) === 8191) yield 'spawn variant areas';
      if (WorldGen.variantOwnerAt(entry, i)) ambientOccupied.add(i);
    }
    // Zone and road variants own their empty lanes too. Their own rewards,
    // story placements and fauna retain the ordinary placement options.
    const ambientSpawnOpts = { ..._spawnOpts, occupied: ambientOccupied };
    entry._ambientSpawnOpts = ambientSpawnOpts;
    const enemyGroundSeats = new Set(ambientOccupied);
    const faunaSpawnOpts = { ..._spawnOpts, occupied: null };
    const tryPlace = (classesOK, idx, kindStr) => {
      const spClass = creatureSpawnClass(kindStr);
      const fauna = spClass === 'fauna' || spClass === 'fastFauna';
      const seatOpts = fauna ? faunaSpawnOpts : _spawnOpts;
      let displaced = false;
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
          // it paints.
          // This does NOT impose the frontage rule on non-residential terrain:
          // isSpawnCell returns true right after the walkable+roadMask checks
          // for any cell that isn't lot land (WorldGen.isLotTerrain), so grass
          // etc. only ever pays the (cheap) roadMask lookup, never the
          // frontage scan. See CLAUDE.md's road-mask invariant / FINDING 2 /
          // test/node/fauna_spawn.test.js.
          // The draw loop re-rolls on ground nothing may take (a MINOR
          // spawn's refusal — INVALID); SUPPRESSED ground is judged below.
          if (!WorldGen.isSpawnCell(genGrid, N, N, cx, cy, seatOpts, 'minor')) {
            if (!fauna && !displaced && _spawnOpts.occupied && _spawnOpts.occupied.has(cy * N + cx)
                && WorldGen.isSpawnCell(genGrid, N, N, cx, cy, { roadMask: _spawnOpts.roadMask, pois: _spawnOpts.pois,
                  spawnWhy: _spawnOpts.spawnWhy, quiet: _spawnOpts.quiet }, 'minor')) displaced = true;
            continue;
          }
          const wmx = tx * this.tileEdgeM + (cx + 0.5) * cellM;
          const wmy = ty * this.tileEdgeM + (cy + 0.5) * cellM;
          const id = `${kindStr}_${tx}_${ty}_${idx}`;
          if (!fauna) enemyGroundSeats.add(cy * N + cx);
          if (caughtSet.has(id)) return;
          // AN ANIMAL (or a wild slime) IS SEATED BY ITS OWN CLASS (the spawn
          // gate, creatureSpawnClass): every class keeps off the hard reasons
          // and sensitive ground; a FAST one (animal or foe) off the kerb
          // too. DROPPED after the draw, like the
          // pest amnesty below, never re-rolled: the stream stays the same
          // for every later spawn, and the mask is generated, so every player
          // loses the same animals.
          if (!WorldGen.isSpawnCell(genGrid, N, N, cx, cy, seatOpts, spClass)) return;
          // The pest amnesty DROPS a slime, a crow or a raven that lands in the zone —
          // after the cell was drawn exactly as it would be for anyone else.
          // It used to re-roll (`continue`) instead, which took extra draws out
          // of the shared stream and reshuffled every later spawn on this tile
          // for this one player (CLAUDE.md "Every player sees the SAME
          // generated world": per-player state may hide a thing, never move
          // the others). Thinning the starting area is the point anyway.
          if ((kindStr === 'crow' || kindStr === 'raven') && pestFree && pestFree.has(cx, cy)) return;
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
      if (displaced) {
        const id = `${kindStr}_${tx}_${ty}_${idx}`;
        if (!caughtSet.has(id)) unseated.push(WorldGen.makeCreature(kindStr, NaN, NaN, id, { shiny: faunaShiny(kindStr, id) }));
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
      // Draw the same crow candidates in both modes; thin only after placement.
      const emittedCrowN = sp === 'crow' ? Math.round(n * Difficulty.get().crowCountMul) : n;
      const enemyTerrain = sp === 'slime' ? Object.values(WorldGen.T).filter(t => EnemySpawns.surfaceRows(t, { beach: true }).length) : null;
      const primary  = new Set(enemyTerrain || cfg.primary);
      const fallback = new Set(enemyTerrain || cfg.fallback || cfg.primary);
      const primN = Math.round(n * (cfg.share ?? 0.8));
      for (let i = 0; i < primN; i++) tryPlace(primary,  i, sp);
      for (let i = primN; i < n; i++) tryPlace(fallback, i, sp);
      if (sp === 'crow' && emittedCrowN < n) {
        for (let j = creatures.length - 1; j >= 0; j--) {
          if (creatures[j].kind === 'crow' && Number(creatures[j].id.split('_').at(-1)) >= emittedCrowN) creatures.splice(j, 1);
        }
      }
      yield 'spawn fauna';
    }
    // Independent park stream; only static pieces and enemy seats reserve
    // ground. An animal cannot prevent an interactable or rooted enemy spawn.
    const parkPlants = WorldGen.spawnParkPlants(genGrid, N, N, tx, ty, this.tileEdgeM,
      { ..._spawnOpts, occupied: enemyGroundSeats });
    yield 'spawn park plants';
    const plantCells = new Set();
    for (const plant of parkPlants) {
      const cx = Math.floor((plant.x - tx * this.tileEdgeM) / cellM);
      const cy = Math.floor((plant.y - ty * this.tileEdgeM) / cellM);
      plantCells.add(cy * N + cx);
      if (caughtSet.has(plant.id) || (pestFree && pestFree.has(cx, cy))) continue;
      // (A biting plant is a foe: spawnParkPlants seats it as an 'enemy'.)
      // Keep the park stream's stable seat and id; habitat is a per-player
      // overlay just as it is for the ordinary surface encounter budget.
      plant._surfaceSpawn = { x: plant.x, y: plant.y, tx, ty, cx, cy };
      EnemySpawns.surfaceActive(this, plant);
      creatures.push(plant);
    }
    // FAUNA ATTRACTORS. A species' favourite ground pulls the tile's OWN
    // spawns of it (never adds): deer the
    // orchard lanes and groves, cats the walking-path lamps, crows the churchyards… —
    // rows of the `attracts` column (see _seatFaunaOnFavouriteGround). The
    // draw above is taken exactly as before (same count, same ids, same
    // stream for every species after it); the new seats come off each
    // species' OWN stream. A tile without the ground keeps its animals.
    // Run after generated park plants reserve their drawn seats (the same for
    // every save), and pass every generated plant cell (caught or not) so no
    // animal is pulled onto a plant.
    entry.faunaAttracted = this._seatFaunaOnFavouriteGround(entry, tx, ty, N, cellM, genGrid, _spawnOpts, creatures, pestFree, unseated, plantCells);
    yield 'spawn fauna attractors';
    // Replace the existing enemy budget, without adding a population per kind.
    // Identity depends on the candidate cell, never species or this player's Home.
    entry._spawnOpts = _spawnOpts;
    const habitatOccupied = new Set([...enemyGroundSeats, ...plantCells]);
    const habitatGuards = EnemyHabitats.surfaceSites(entry, tx, ty, habitatOccupied);
    const habitatSeats = new Set(habitatGuards.map(c => {
      const x = Math.floor((c.x - tx * this.tileEdgeM) / cellM), y = Math.floor((c.y - ty * this.tileEdgeM) / cellM);
      return y * N + x;
    }));
    for (const idx of habitatSeats) _spawnOpts.occupied.add(idx);
    const enemySeats = new Set();
    let enemyWrite = 0;
    for (const creature of creatures) {
      if (creature.kind !== 'slime') { creatures[enemyWrite++] = creature; continue; }
      const cx = Math.floor((creature.x - tx * this.tileEdgeM) / cellM);
      const cy = Math.floor((creature.y - ty * this.tileEdgeM) / cellM);
      const id = EnemySpawns.surfaceId(tx, ty, cx, cy);
      if (caughtSet.has(id) || enemySeats.has(id)) continue;
      // Drop generic enemies in authored zone/road areas after the draw,
      // preserving every subsequent RNG draw and each variant's own guards.
      if (WorldGen.variantOwnerAt(entry, cy * N + cx)) continue;
      if (habitatSeats.has(cy * N + cx)) continue;
      // (The seat was an 'enemy' spawn already — tryPlace / the attractor
      // lane — so whatever kind the roster puts on it stands on OPEN ground.)
      enemySeats.add(id);
      const kind = EnemySpawns.surfaceKind(genGrid[cy * N + cx], id, EnemyHabitats.surfaceAt(entry, cx, cy));
      if (!kind) continue;
      const row = EnemyRoster.get(kind);
      const replacement = WorldGen.makeCreature(kind, creature.x, creature.y, id, {
        shiny: row.eliteEligible && isShiny(id, SHINY_RATE.monster),
        _surfaceSpawn: { x: creature.x, y: creature.y, tx, ty, cx, cy },
      });
      EnemySpawns.surfaceActive(this, replacement);
      creatures[enemyWrite++] = replacement;
    }
    creatures.length = enemyWrite;
    // Themed roamers have their own small-group budget. Reserve all generated
    // seats before filtering defeats, so caught enemies never reroll a group.
    const themedOccupied = new Set([..._occupiedIdx, ...plantCells]);
    const themedEnemies = EnemyHabitats.surfaceEncounters(entry, tx, ty, themedOccupied);
    for (const c of themedEnemies) {
      const at = c._surfaceSpawn;
      _spawnOpts.occupied.add(at.cy * N + at.cx);
      if (caughtSet.has(c.id)) continue;
      EnemySpawns.surfaceActive(this, c);
      creatures.push(c);
    }
    // Zone guards already have an authored species and seat. Append after
    // attraction and surface-roster replacement so neither can move or turn
    // them into an unrelated enemy. Their kills use the usual caught ledger.
    for (const guard of zoneGuards) {
      if (caughtSet.has(guard.id)) continue;
      const creature = WorldGen.makeCreature(guard.kind, guard.x, guard.y, guard.id, {
        ...guard, shiny: false, immobile: !guard.burrowCells,
        ...(guard.kind === 'wurm' ? { _burrowed: true } : {}),
        lair: guard.burrowCells ? null : (guard.lair || guard.id),
        lairX: guard.homeX ?? guard.x, lairY: guard.homeY ?? guard.y,
        lairR: 0, seatX: guard.x, seatY: guard.y,
      });
      if (creature._surfaceSpawn) EnemySpawns.surfaceActive(this, creature);
      creatures.push(creature);
    }
    for (const c of habitatGuards) {
      if (caughtSet.has(c.id)) continue;
      EnemySpawns.surfaceActive(this, c);
      creatures.push(c);
    }
    // (Starter-cow at spawn removed — cows are valuable enough that none should be gifted.)
    // Merge in any creatures the player has released back into the world for this tile.
    // save.released is a flat array of {x,y,kind,id,tx,ty} — filter by tile + caught state.
    if (this.save.released) {
      for (const r of this.save.released) {
        if (r.tx !== tx || r.ty !== ty) continue;
        if (caughtSet.has(r.id)) continue;
        // A raised pet carries its birth (SpriteLayout.isBabyPet) back too.
        creatures.push(WorldGen.makeCreature(r.kind, r.x, r.y, r.id, {
          ...(r.hp != null ? {_hp:r.hp} : {}), _lastDamagedT:r.lastDamagedAt ?? null,
          ...(r.stayHome == null ? Companions.releasePolicy(this, r.x, r.y)
            : {stayHome:r.stayHome,petHomeX:r.petHomeX,petHomeY:r.petHomeY}),
          shiny: !!r.shiny, ...(r.raised ? { raised: true, born: r.born, favouriteFeeds: r.favouriteFeeds || 0 } : {}),
        }));
      }
    }
    yield 'spawn habitats';
    // AHEAD OF THE FLAG: the two heavy, pure pieces of the stretch after
    // entry._spawned (see spawnInTileSteps) — the trap draw and the one grid
    // pass the bonus X marks and the shore fauna read — are computed here,
    // where the pass may still yield. Neither reads anything the stretch
    // between writes (the trap draw is its own stream on the generated
    // ambient options; the scan reads the generated grid), so the result is
    // the one they gave in place. Both are explained where they are used.
    const surfaceTraps = (typeof Traps !== 'undefined' && !testMode)
      ? yield* Traps.spawnSurfaceSteps(genGrid, entry.roadClass, N, N, tx, ty, this.tileEdgeM, ambientSpawnOpts,
          Difficulty.get().trapCountMul, entry.zone && entry.zone.under)
      : [];
    yield 'spawn traps';
    const shoreMask = entry.scenic && entry.scenic.shore ? entry.scenic.shore.mask : null;
    const pathCells = [];
    const sandCells = [];
    // …and the PIER cells, for the shore fauna below (the gull's perch) —
    // the same pass, so the tile is still walked once.
    const pierCells = [];
    for (let cy = 0; cy < N; cy++) {
      if ((cy & 63) === 63) yield 'spawn path scan';
      for (let cx = 0; cx < N; cx++) {
        const t = genGrid[cy * N + cx];
        if (t === 8 /* PATH */) pathCells.push(cy * N + cx);
        else if (t === WorldGen.T.SAND && !(shoreMask && shoreMask[cy * N + cx])) sandCells.push(cy * N + cx);
        else if (t === WorldGen.T.PIER) pierCells.push(cy * N + cx);
      }
    }
    yield 'spawn path scan';
    // DERELICT LAIRS need the tile's shared spawn options AFTER this pass has
    // finished — the garrisons are woken lazily as the player comes near a ruin
    // (the residency pass in update()), not seated here, because
    // every tier-9 house is a wreck and a city tile holds thousands of them.
    // Stash the one object rather than let that pass rebuild a near-copy: the
    // road rule has to be THE shared rule (CLAUDE.md), not a second reading of
    // it, and the POI anchors are already gathered here.
    // The tile's residents: drawn in full (the same people, the same seats,
    // for every player) and kept on the entry, but NOT seated here — they
    // come back as memories return, to Home's ring or a restored house
    // (NPC.arrivals below, and NPC.tickArrivals as the ledger grows).
    entry._residents = NPC.spawn(this, entry, tx, ty, _spawnOpts);
    entry._residentsTile = { tx, ty };
    entry._spawnOpts = _spawnOpts;
    entry._spawned = true;
    // KEEP creatures the entry already carries. On a rebuild they are the live
    // ones — mid-wander positions, tamed pets, work in progress — handed over
    // by rebuildTileWithBin; the set just rolled is the same deterministic
    // draw they came from, so replacing them would only teleport them home.
    entry.creatures = entry.creatures || creatures;
    // A rebuilt tile carries its live creatures. Preserve their positions and
    // wounds, while admitting newly discovered zone guards and encounters once.
    const liveIds = new Set(entry.creatures.map(c => c.id));
    for (const guard of creatures) {
      if (!guard.zoneVariant || liveIds.has(guard.id)) continue;
      entry.creatures.push(guard);
      liveIds.add(guard.id);
    }
    this._restoreMimics(entry, tx, ty);
    NPC.shrineResidents(this, entry, tx, ty);
    NPC.arrivals(this, entry, tx, ty);

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
    // save.sprungTraps ever reaches disk. The ambient options preserve the
    // shared spawn gate and reserve authored zone and road areas, so the road rule
    // is the one in WorldGen.isSpawnCell, not a copy of it: a trap sits on the
    // VERGE the drawn band stops at, never under the band. Plain assignment,
    // not `||`: a rebuilt entry (see CLAUDE.md) arrives carrying nothing and
    // re-runs this pass, and the draw is deterministic, so it lays the same set.
    // No traps in test mode, for the reason the extra-X scatter skips it too:
    // the browser harness walks the player over arbitrary cells and asserts on
    // energy, and a trap under one of them would charge a run that never asked
    // to step on one.
    // Density scales with the game mode (Difficulty.PROFILES.trapCountMul:
    // 10x easy, 25x hard; Traps.tileDanger spreads it per tile) — the base 10..18/tile rate reads as too rare to
    // ever meet in practice.
    // Kept ON THE ENTRY so the density can be re-rolled later without rebuilding
    // a second copy of the rule (see _relayTraps): the how-to card is answered
    // AFTER the starter tile is built, and a copy of these options here and
    // there is exactly how the road mask drifts out of one of them. A rebuilt
    // entry drops it along with `_spawned`, and this pass puts it back.
    entry._spawnOpts = _spawnOpts;
    // (Drawn ahead of the flag — surfaceTraps, above.)
    entry.traps = surfaceTraps;
    entry.traps.push(...zoneTraps);

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
    // A hedgerow close's buried hoard (StreetVariants.dress) — an X like any
    // other, carrying its rollBonus into the dig's roll.
    for (const t of [...streetTreasures, ...zoneTreasures]) entry.extraTreasures.push(t);
    // Spawnability for all three treasure streams below is decided by
    // WorldGen.isSpawnCell (the single shared rule): walkable, off-road, and —
    // on lot cells (residential / wasteland) — only near a public anchor (road/path, public area,
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
      this._placeSafeAreaWarden(entry, tx, ty);   // the safe area's warden
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
        // Walkable, off-road, and not deep in a private yard — one shared rule
        // (an X mark is an ordinary pickup: a MINOR spawn).
        if (!WorldGen.isSpawnCell(genGrid, N, N, cx, cy, ambientSpawnOpts, 'minor')) continue;
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
    const EXTRA_X_COUNT = testMode ? 0 : (4 + Math.floor(rng() * 7));
    for (let k = 0; k < EXTRA_X_COUNT; k++) {
      let placed = false;
      for (let attempt = 0; attempt < 8 && !placed; attempt++) {
        const cx = Math.floor(rng() * N);
        const cy = Math.floor(rng() * N);
        if (!WorldGen.isSpawnCell(genGrid, N, N, cx, cy, ambientSpawnOpts, 'minor')) continue;
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
    // beach's) — taken ahead of the flag, where the pass can still yield (see
    // `pathCells` above) — so a second full-grid scan for the sand would be a
    // second 100k-cell block.
    // Cells are packed as their grid INDEX (cy * N + cx), which is the index
    // the rest of this file reads them by. It was `cx * 256 + cy` until Sep
    // 2026: cellsPerEdge is tileEdgeM / 7, which is over 256 anywhere below
    // ~43° latitude (349 at the equator), so every path cell in the bottom of
    // the tile decoded to (cx + 1, cy - 256) and its "roadside" X was dropped
    // somewhere else entirely.
    // SHORE SAND (src/scenic.js — a SAND cell within SCENIC_SHORE_CELLS of
    // water, entry.scenic.shore.mask) is the BEACH and takes its own stream
    // below; `sandCells` is the INLAND sand (bunkers, sandpits, volleyball),
    // which keeps the old capped scatter.
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
          if (!WorldGen.isSpawnCell(genGrid, N, N, ncx, ncy, ambientSpawnOpts, 'minor')) continue;
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
    // INLAND sand only since Sep 2026: SHORE sand is the beach's own stream
    // (below, Scenic.beachXCount — its count follows the shoreline).
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
          if (!WorldGen.isSpawnCell(genGrid, N, N, scx, scy, ambientSpawnOpts, 'minor')) continue;
          const wmx = tx * this.tileEdgeM + (scx + 0.5) * cellM;
          const wmy = ty * this.tileEdgeM + (scy + 0.5) * cellM;
          const id = WorldGen.cellId('treasure_sand', tx, ty, scx, scy);
          if (entry.extraTreasures.some(t => t.id === id)) continue;
          entry.extraTreasures.push({ x: wmx, y: wmy, id });
          placed = true;
        }
      }
    }

    // THE BEACH'S OWN MARKS (src/scenic.js): the count follows the SHORELINE
    // — Scenic.beachXCount(shoreM), one per BEACH_X_SHORE_M of waterline,
    // capped at BEACH_X_MAX — not the tile's flat 4-8, so a long beach carries
    // marks at its own rate. Its OWN stream (seeded off the tile, salted), so
    // no other draw moves; each mark on a shore-sand cell that takes a minor
    // spawn, keyed by position (treasure_sand ids, as before).
    const shore = entry.scenic && entry.scenic.shore;
    if (shore && shore.cells.length && typeof Scenic !== 'undefined') {
      const want = Scenic.beachXCount(shore.shoreM);
      const brng = WorldGen.makeRng(fnv1a(`beachx|${tx},${ty}`));
      let placed = 0;
      for (let attempt = 0; attempt < want * 8 && placed < want; attempt++) {
        const cell = shore.cells[Math.floor(brng() * shore.cells.length)];
        const scx = cell % N, scy = Math.floor(cell / N);
        if (!WorldGen.isSpawnCell(genGrid, N, N, scx, scy, ambientSpawnOpts, 'minor')) continue;
        const id = WorldGen.cellId('treasure_sand', tx, ty, scx, scy);
        if (entry.extraTreasures.some(t => t.id === id)) continue;
        entry.extraTreasures.push({ x: tx * this.tileEdgeM + (scx + 0.5) * cellM,
          y: ty * this.tileEdgeM + (scy + 0.5) * cellM, id });
        placed++;
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
    const savedPlantings = [];
    if (this.save.fruittrees && this.save.fruittrees.length) {
      const t0x = tx * this.tileEdgeM, t0y = ty * this.tileEdgeM;
      for (const ft of this.save.fruittrees) {
        if (ft.x < t0x || ft.x >= t0x + this.tileEdgeM ||
            ft.y < t0y || ft.y >= t0y + this.tileEdgeM) continue;
        const present = (entry.objects || []).find(o => o.id === ft.id);
        if (present) { savedPlantings.push(present); continue; }
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
        savedPlantings.push(entry.objects[entry.objects.length - 1]);
      }
    }
    // Saved plantings win against generated static scenery after shared RNG draws.
    if (savedPlantings.length) SpawnOwnership.reconcileEntry(this, entry, savedPlantings);
    // THE SHORE'S OWN FAUNA (biome_profiles.js SHORE_FAUNA): crabs on the
    // shore sand, gulls on the shore and the piers (the
    // shore and pier cells come out of the bonus-X block's one grid pass). Each species on its OWN
    // stream (its `salt`), so no other draw moves; its count follows the
    // waterline; each seat is the kind's own spawn class (creatureSpawnClass)
    // through the shared gate, and its id is the seat cell. See spawnShoreFauna.
    const shoreFauna = this.spawnShoreFauna(creatures, shore, pierCells, N, tx, ty, cellM, genGrid,
      faunaSpawnOpts, _spawnOpts, caughtSet);
    Object.assign(entry.faunaAttracted, this._seatFaunaOnFavouriteGround(entry, tx, ty, N,
      cellM, genGrid, _spawnOpts, shoreFauna, pestFree, null, plantCells));

    // The per-player cull, AFTER every draw of the shared stream above.
    this._cullOffLiveGround(entry, tx, ty, N, cellM, genGrid, genObjects, creatures);
  }

  // THE SHORE FAUNA pass (see the call in spawnInTile). Pure in the tile:
  // the shore (entry.scenic.shore — generated) and the pier cells (the
  // generated grid) decide it; nothing per-player. Returns what it seated.
  //   count   floor((waterline m + pier m) / perShoreM), capped at `max` —
  //           in GENERATION metres (WorldGen.CELL_M per cell), never the
  //           save's frame (CLAUDE.md "Every player sees the SAME world")
  //   seats   drawn from the shore cells (+ pier cells where `pier`), on the
  //           species' own stream; a seat the spawn gate refuses for the
  //           kind's class is spent, not re-rolled past the attempt budget
  //   ids     WorldGen.cellId(kind, tx, ty, cx, cy) — position, so a caught
  //           crab / felled gull stays gone (save.caught)
  spawnShoreFauna(creatures, shore, pierCells, N, tx, ty, cellM, genGrid, faunaOpts, foeOpts, caughtSet) {
    const out = [];
    if (typeof SHORE_FAUNA === 'undefined') return out;
    const shoreCells = (shore && shore.cells) || [];
    const shoreM = (shore && shore.shoreM) || 0;
    for (const kind of SHORE_FAUNA_ORDER) {
      const row = SHORE_FAUNA[kind];
      const pool = row.pier && pierCells.length ? shoreCells.concat(pierCells) : shoreCells;
      if (!pool.length) continue;
      const lenM = shoreM + (row.pier ? pierCells.length * WorldGen.CELL_M : 0);
      const want = Math.max(0, Math.min(row.max, Math.floor(lenM / row.perShoreM)));
      if (!want) continue;
      const spClass = creatureSpawnClass(kind);
      const fauna = spClass === 'fauna' || spClass === 'fastFauna';
      const opts = fauna ? faunaOpts : foeOpts;
      const srng = WorldGen.makeRng(fnv1a(`${row.salt}|${tx},${ty}`));
      const taken = new Set();
      let placed = 0;
      for (let attempt = 0; attempt < want * 8 && placed < want; attempt++) {
        const cell = pool[Math.floor(srng() * pool.length)];
        if (taken.has(cell)) continue;
        const cx = cell % N, cy = Math.floor(cell / N);
        if (!WorldGen.isSpawnCell(genGrid, N, N, cx, cy, opts, 'minor')) continue;
        if (!WorldGen.isSpawnCell(genGrid, N, N, cx, cy, opts, spClass)) continue;
        taken.add(cell);
        placed++;
        const id = WorldGen.cellId(kind, tx, ty, cx, cy);
        if (caughtSet.has(id)) continue;
        const c = WorldGen.makeCreature(kind,
          tx * this.tileEdgeM + (cx + 0.5) * cellM, ty * this.tileEdgeM + (cy + 0.5) * cellM, id,
          { shiny: fauna ? faunaShiny(kind, id) : false });
        creatures.push(c);
        out.push(c);
      }
    }
    return out;
  }

  // FAUNA ATTRACTORS (see the call in spawnInTile) — ONE lane, many grounds.
  // What a ground attracts is a COLUMN on the row that owns the ground, never
  // per-species code here:
  //   street variants   StreetVariants.STREET_VARIANTS[].attracts — the
  //                     cells the dressing marked with that row's code
  //                     (entry.streetMarks: band + verge of a dressed street)
  //   influence zones   ZoneVariants.rows[].attracts — union coverage cells
  //                     (legacy anchors fall back to Zones.ZONE_KINDS)
  //   terrain           BIOME_ATTRACTS[code] — the LAND's class (the halo's
  //                     `under` first, like the trap ground)
  // Each column is { species: p }: every one of the tile's own spawns of that
  // species moves onto the union of its grounds with probability p (p = 1
  // draws nothing, so the dogs keep the exact seats they had when this was
  // their own pass). Seats come off the species' OWN stream (`<kind>s|tx,ty`
  // — the dogs' old key), pass the shared spawn rule, never share a cell, and
  // a slime or crow never moves into the starting area's pest amnesty. A
  // species with no ground on the tile, or an animal that finds no free cell
  // in FAUNA_ATTRACT_TRIES, keeps its drawn seat — except a species the
  // ground takes WHOLE (p = 1: the dogs), which walks on FURTHER ALONG the
  // ground's cells from its last draw to the first free one. `unseated`
  // (optional): animals spawnInTile's draw lost only to a cell something
  // generated already held — a p = 1 species' are seated the same way and
  // join `creatures` (counted in `moved`); the rest stay lost, as before.
  // `blocked` (optional): cells no animal may be pulled onto (the tile's
  // generated park plants).
  // Returns { kind: moved }.
  _seatFaunaOnFavouriteGround(entry, tx, ty, N, cellM, genGrid, spawnOpts, creatures, pestFree, unseated, blocked) {
    const moved = {};
    if (!creatures || (!creatures.length && !(unseated && unseated.length))) return moved;
    const SV = (typeof StreetVariants !== 'undefined') ? StreetVariants : null;
    const Z = (typeof Zones !== 'undefined') ? Zones : null;
    const BA = (typeof BIOME_ATTRACTS !== 'undefined') ? BIOME_ATTRACTS : null;
    // The grounds on this tile, each an `attracts` column plus the ONE cell
    // attribute that selects it: a street row's mark code, the path-lamp
    // cells, a zone row's coverage owners, a land code. Their pools are built
    // in ONE pass over the grid below (a per-cell species bitmask off four
    // lookups), never a scan per species with a closure per ground — that
    // was ~50k cells x grounds x species, the bulk of a tile's spawn pass.
    // Pools come out in ascending cell order, exactly as the per-species
    // scan left them, so every draw below lands where it always did
    // (test/node/fauna_seat_pools.test.js pins the two against each other).
    const marks = (SV && entry.streetMarks) || null;
    const streetRows = [];              // [code, row] with an attracts column
    if (marks) for (const row of SV.STREET_VARIANTS) if (row.attracts) streetRows.push([row.code, row]);
    const scenicRows = [];
    if (SV) for (const [kind, cells] of Object.entries(entry.scenic?.attractionCells || {})) {
      const row = SV.VARIANT_BY_ID[Scenic.KIND_ROW[kind]];
      if (row?.attracts && cells.size) scenicRows.push([cells, row]);
    }
    // WALKING-PATH LAMPS: the cells beside every lamp a footway / path /
    // cycleway stands (Streets.PATH_LAMP_ATTRACTS — the cats, moved here from
    // Lantern Row). Every GENERATED lamp, lit or not: where an animal sits is
    // the same for every player, and restoration is per-save.
    const lampCells = this._pathLampCells ? this._pathLampCells(entry, tx, ty, N) : null;
    const lampAttracts = (lampCells && lampCells.size && typeof Streets !== 'undefined' && Streets.PATH_LAMP_ATTRACTS) || null;
    const zf = entry.zone;
    const coverage = (zf && zf.anchors && (zf.coverage || zf.idx)) || null;
    // A zone owner's row. An explicit empty affinity is intentional: it must
    // not inherit the old grove/churchyard defaults. Terrain and street pulls
    // still apply.
    const ownerRow = (owner) => {
      const anchor = zf.anchors[owner - 1];
      if (!anchor) return null;
      const row = anchor.variant
        ? (typeof ZoneVariants !== 'undefined' && ZoneVariants.byId(anchor.variant))
        : Z && Z.ZONE_KINDS[anchor.kind];
      return row && row.attracts ? row : null;
    };
    const zoneRows = [];                // [owner, row]
    if (coverage) for (let o = 1; o <= zf.anchors.length; o++) { const r = ownerRow(o); if (r) zoneRows.push([o, r]); }
    const landCodes = BA ? Object.keys(BA) : [];
    // Every species any ground here could pull, that the tile spawned.
    const has = (sp) => creatures.some((c) => c && c.kind === sp) || !!(unseated && unseated.some((c) => c && c.kind === sp));
    const cand = [];
    const candIdx = new Map();
    const note = (attracts) => {
      for (const sp of Object.keys(attracts || {})) if (!candIdx.has(sp) && has(sp)) { candIdx.set(sp, cand.length); cand.push(sp); }
    };
    for (const [, row] of streetRows) note(row.attracts);
    for (const [, row] of scenicRows) note(row.attracts);
    note(lampAttracts);
    for (const [, row] of zoneRows) note(row.attracts);
    for (const code of landCodes) note(BA[code]);
    if (!cand.length) return moved;
    const pools = new Map();
    const NN = N * N;
    const under = zf && zf.under;
    const underPresent = under && under.present;
    // Flat typed lookups (a mark code is a byte, a land code a small int, a
    // zone owner 1..anchors) — the pass is ~50k cells, so no holey arrays.
    const markSeen = new Uint8Array(256);
    const nA = coverage ? zf.anchors.length : 0;
    const ownerSeen = new Uint8Array(nA + 1);
    const ownerFirst = [];              // owners in order of first appearance
    // 31 species per pass keeps the mask a small int; FAUNA_ORDER is 8.
    for (let base = 0; base < cand.length; base += 31) {
      const top = Math.min(cand.length, base + 31);
      const maskOf = (attracts) => {
        let m = 0;
        for (const sp of Object.keys(attracts || {})) {
          const k = candIdx.get(sp);
          if (k !== undefined && k >= base && k < top) m |= 1 << (k - base);
        }
        return m;
      };
      const byMark = new Int32Array(256);
      for (const [code, row] of streetRows) if (code >= 0 && code < 256) byMark[code] |= maskOf(row.attracts);
      // Scenic paths have sparse classified verge sets instead of street
      // marks. Fold them into the same single-pass species masks.
      const byScenic = scenicRows.length ? new Int32Array(NN) : null;
      for (const [cells, row] of scenicRows) {
        const mask = maskOf(row.attracts);
        for (const i of cells) if (i >= 0 && i < NN) byScenic[i] |= mask;
      }
      const lampMask = lampAttracts ? maskOf(lampAttracts) : 0;
      const byOwner = new Int32Array(nA + 1);
      for (const [o, row] of zoneRows) byOwner[o] = maskOf(row.attracts);
      const byLand = new Int32Array(256);
      for (const code of landCodes) if (+code >= 0 && +code < 256) byLand[+code] = maskOf(BA[code]);
      const lists = [];
      for (let k = base; k < top; k++) lists.push([]);
      const first = base === 0;
      for (let i = 0; i < NN; i++) {
        let m = 0;
        if (marks) {
          const c = marks[i];
          if (c > 0 && c < 256) { m |= byMark[c]; markSeen[c] = 1; }
        }
        if (byScenic) m |= byScenic[i];
        if (lampMask && lampCells.has(i)) m |= lampMask;
        if (coverage) {
          const o = coverage[i];
          if (o > 0 && o <= nA) {
            m |= byOwner[o];
            if (first && !ownerSeen[o]) { ownerSeen[o] = 1; ownerFirst.push(o); }
          }
        }
        const land = under && (under[i] || (underPresent && underPresent[i])) ? under[i] : genGrid[i];
        if (land >= 0 && land < 256) m |= byLand[land];
        while (m) {
          const b = 31 - Math.clz32(m & -m);
          lists[b].push(i);
          m &= m - 1;
        }
      }
      for (let k = base; k < top; k++) pools.set(cand[k], lists[k - base]);
    }
    // The grounds PRESENT on this tile, as { p } per species — in the order
    // they always were (streets, lamps, zones by first cell, land), which
    // orders any species FAUNA_ORDER does not list.
    const want = {};
    const add = (attracts) => {
      if (!attracts) return;
      for (const [sp, p] of Object.entries(attracts)) (want[sp] || (want[sp] = [])).push({ p });
    };
    // Only present street grounds contribute a probability. An absent
    // Pilgrim's Way must not strengthen another zone's weaker crow pull.
    for (const [code, row] of streetRows) if (markSeen[code]) add(row.attracts);
    for (const [, row] of scenicRows) add(row.attracts);
    add(lampAttracts);
    if (coverage) {
      const rowsSeen = new Set();
      for (const o of ownerFirst) {
        const row = ownerRow(o);
        if (!row || rowsSeen.has(row)) continue;
        rowsSeen.add(row);
        add(row.attracts);
      }
    }
    for (const code of landCodes) add(BA[code]);
    // Only species the tile actually spawned; p = 1 first (the dogs keep the
    // seats they had with an empty `taken`), then FAUNA_ORDER.
    const order = (typeof FAUNA_ORDER !== 'undefined' ? FAUNA_ORDER : []).slice();
    for (const sp of Object.keys(want)) if (!order.includes(sp)) order.push(sp);
    const pOf = (sp) => Math.max(...want[sp].map((g) => g.p));
    const species = order.filter((sp) => want[sp] && has(sp))
      .sort((a, b) => (pOf(b) >= 1) - (pOf(a) >= 1));
    if (!species.length) return moved;
    const taken = new Set();
    // Shore birds need room between landings and the beach's interactables.
    // Failed attraction keeps the original animal; it never removes population.
    const shoreMask = entry.scenic?.shore?.mask;
    const birdLandings = new Set();
    const reserveBirdLanding = idx => {
      const x = idx % N, y = Math.floor(idx / N);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (x + dx >= 0 && x + dx < N && y + dy >= 0 && y + dy < N)
          birdLandings.add((y + dy) * N + x + dx);
      }
    };
    if (shoreMask) for (const c of creatures) if (c && (c.kind === 'crow' || c.kind === 'raven')) {
      const x = Math.floor((c.x - tx * this.tileEdgeM) / cellM);
      const y = Math.floor((c.y - ty * this.tileEdgeM) / cellM);
      if (x >= 0 && x < N && y >= 0 && y < N && shoreMask[y * N + x]) reserveBirdLanding(y * N + x);
    }
    for (const sp of species) {
      const p = pOf(sp);
      const pool = pools.get(sp) || [];
      if (!pool.length) continue;
      const rng = WorldGen.makeRng(fnv1a(`${sp}s|${tx},${ty}`));
      const pest = (sp === 'slime' || sp === 'crow' || sp === 'raven') ? pestFree : null;
      const shoreBird = shoreMask && (sp === 'crow' || sp === 'raven');
      const spClass = creatureSpawnClass(sp);
      const seatOpts = spClass === 'fauna' || spClass === 'fastFauna'
        ? { ...spawnOpts, occupied: null } : spawnOpts;
      const free = (idx) => {
        if (taken.has(idx) || (blocked && blocked.has(idx))) return false;
        if (shoreBird && shoreMask[idx] && (spawnOpts.occupied?.has(idx) || birdLandings.has(idx))) return false;
        const cx = idx % N, cy = (idx / N) | 0;
        if (pest && pest.has(cx, cy)) return false;
        // The seat rule for anything alive: its own spawn class.
        return WorldGen.isSpawnCell(genGrid, N, N, cx, cy, seatOpts, spClass);
      };
      const seatOn = (c) => {
        let k = -1, at = -1;
        for (let a = 0; a < FAUNA_ATTRACT_TRIES; a++) {
          k = Math.floor(rng() * pool.length);
          if (free(pool[k])) { at = pool[k]; break; }
        }
        // A whole-species pull walks on along the ground from its last draw.
        if (at < 0 && p >= 1 && k >= 0) {
          for (let j = 1; j < pool.length; j++) {
            const idx = pool[(k + j) % pool.length];
            if (free(idx)) { at = idx; break; }
          }
        }
        if (at < 0) return false;
        taken.add(at);
        if (shoreBird && shoreMask[at]) reserveBirdLanding(at);
        c.x = tx * this.tileEdgeM + ((at % N) + 0.5) * cellM;
        c.y = ty * this.tileEdgeM + (((at / N) | 0) + 0.5) * cellM;
        moved[sp] = (moved[sp] || 0) + 1;
        return true;
      };
      for (const c of creatures) {
        if (!c || c.kind !== sp) continue;
        if (p < 1 && rng() >= p) continue;
        seatOn(c);
      }
      if (p >= 1 && unseated) {
        for (const c of unseated) if (c && c.kind === sp && seatOn(c)) creatures.push(c);
      }
    }
    return moved;
  }


  // The flat cell indices (cy*N+cx, this tile's own grid) BESIDE each lamp a
  // WALKING PATH stands — the lamp's own cell and its eight neighbours — for
  // the fauna attractor lane above. The lamps are app.js's generated
  // geometry (_streetLampsForTile, tile-cached, flagged `path`); a scene
  // without that pass (a headless stub) has no lamp ground. The spawn gate
  // (isSpawnCell, the species' own class) still judges every seat, so a
  // cell on the band is never taken.
  _pathLampCells(entry, tx, ty, N) {
    if (!this._streetLampsForTile || !entry || !entry.layers || !(entry.tileEdgeM > 0)) return null;
    const lamps = this._streetLampsForTile(tx, ty, entry);
    const out = new Set();
    const cellM = entry.tileEdgeM / N;
    const ox = tx * entry.tileEdgeM, oy = ty * entry.tileEdgeM;
    for (const L of lamps) {
      if (!L.path) continue;
      const cx = Math.floor((L.x - ox) / cellM), cy = Math.floor((L.y - oy) / cellM);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const x = cx + dx, y = cy + dy;
          if (x >= 0 && y >= 0 && x < N && y < N) out.add(y * N + x);
        }
      }
    }
    return out;
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
    const held = new Map();
    const footprintFrame = { cellsPerEdge: N };
    for (const o of (entry.objects || [])) {
      if (gen.has(o)) continue;
      for (const i of SpawnOwnership.tileCells(this, footprintFrame, o, tx, ty))
        held.set(i, held.has(i) ? null : o.id);
    }
    const savedIds = SpawnOwnership.savedIds(this.save);
    for (const plant of (entry.wildplants || [])) {
      if (!SpawnOwnership.isProtected(plant, this.save, savedIds)) continue;
      for (const i of SpawnOwnership.tileCells(this, footprintFrame, plant, tx, ty)) held.set(i, null);
    }
    const repainted = grid !== genGrid;
    const off = (t, allowOverlap = false) => {
      const i = idxOf(t.x, t.y);
      if (i < 0) return false;
      if (!allowOverlap && held.has(i)
          && !(t.coverRockId && held.get(i) === t.coverRockId)) return true;
      return repainted && grid[i] !== genGrid[i] && !WorldGen.isWalkable(grid[i]);
    };
    if (!held.size && !repainted) return;
    const keep = (arr, faunaOverlap = false) => {
      if (!arr) return arr;
      let w = 0;
      for (const record of arr) {
        const cls = faunaOverlap && record.kind !== 'npc' && creatureSpawnClass(record.kind);
        if (!off(record, cls === 'fauna' || cls === 'fastFauna')) arr[w++] = record;
      }
      arr.length = w;
      return arr;
    };
    keep(creatures, true);
    keep(entry.traps);
    keep(entry.extraTreasures);
    if (entry.treasure && off(entry.treasure)) entry.treasure = null;
  }

  // A free surface cell about `dist` cells from the player's FEET (playerM,
  // never the camera anchor): walkable, off the road band, under nothing —
  // the shared spawn rule. The rules and the search order are
  // walkableDestination's (creature_ai.js); this is the scene's door to it.
  // Returns { tx, ty, ix, iy, x, y, n, entry } or null.
  findWalkableDestination(dist, opts) {
    const px = this.startWorldM.x + this.playerM.x;
    const py = this.startWorldM.y + this.playerM.y;
    return walkableDestination(this, px, py, dist, opts);
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
    const eligible = EnemySpawns.caveRows(depth);
    const legacyDefeats = EnemySpawns.legacyCaveDefeats(caughtSet, depth, tx, ty);
    const monsterSeats = new Set();
    if (!eligible.length) { entry._spawned = true; entry.creatures = entry.creatures || creatures; return; }
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
    const genWildplants = entry.genWildplants || entry.wildplants || [];
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
    for (const o of [...genObjects, ...genWildplants]) {
      const ox = Math.floor((o.x - tx * entry.tileEdgeM) / cellSizeM);
      const oy = Math.floor((o.y - ty * entry.tileEdgeM) / cellSizeM);
      if (ox >= 0 && oy >= 0 && ox < N && oy < N) occupiedIdx.add(oy * N + ox);
    }
    // Cave spawners share this generated occupancy because terrain alone
    // cannot reveal a rock, mushroom or floor torch seated on its floor cell.
    entry._spawnOpts = { roadMask: null, occupied: occupiedIdx, pois: [] };
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
    // A roost owns one fixed dragon seat even after defeat. Reserve before
    // ordinary pools so losing the dragon cannot regenerate another enemy.
    for (const dragon of EnemyHabitats.caveSites(entry, tx, ty, depth, occupiedIdx)) {
      const cx = Math.floor((dragon.x - tx * this.tileEdgeM) / cellSizeM);
      const cy = Math.floor((dragon.y - ty * this.tileEdgeM) / cellSizeM);
      if (!caughtSet.has(dragon.id) && !heldByPlayer.has(cy * N + cx)) creatures.push(dragon);
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
    // Both modes share this population; Hard applies only at the recipient.
    const count = Math.min(160, Math.round((50 + depth * 10) * Difficulty.get().monsterCountMul));
    for (let i = 0; i < count; i++) {
      const kindRoll = rng();
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
        const habitat = EnemySpawns.caveContextAt(entry, tx, ty, cx, cy, depth);
        const kind = EnemySpawns.caveKind(depth, kindRoll, habitat);
        if (!kind) continue;
        const id = EnemySpawns.caveId(depth, tx, ty, cx, cy);
        if (caughtSet.has(id) || legacyDefeats.pack.has(i) || legacyDefeats.cells.has(`${cx}_${cy}`) || monsterSeats.has(id)) break;   // already defeated — stays dead
        if (heldByPlayer.has(cy * N + cx)) break;   // on the player's own stair
        const wmx = tx * this.tileEdgeM + (cx + 0.5) * cellSizeM;
        const wmy = ty * this.tileEdgeM + (cy + 0.5) * cellSizeM;
        // ~5% spawn as ELITES — the shiny variant, stamped off the stable id
        // like a shiny animal so it survives reloads. The same `shiny` flag
        // the renderer already tints and sparkles; combat.js reads it as
        // double HP and damage (Combat.isElite), and resolveDefeat pays the
        // memory-or-treasure it promises.
        creatures.push(WorldGen.makeCreature(kind, wmx, wmy, id,
          { shiny: EnemyRoster.get(kind).eliteEligible && isShiny(id, SHINY_RATE.monster), habitat: habitat.theme }));
        monsterSeats.add(id);
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
        // Cave rabbits share interactable cells, like surface fauna.
        const id = `rabbit_${depth}_${tx}_${ty}_${i}`;
        if (caughtSet.has(id)) break;   // already caught — stays gone
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
        const kindRoll = roamRng();
        for (let attempt = 0; attempt < ROAM_TRIES; attempt++) {
          const cx = px + Math.floor(roamRng() * ROAM_PIVOT);
          const cy = py + Math.floor(roamRng() * ROAM_PIVOT);
          if (cx >= N || cy >= N) continue;
          if (genGrid[cy * N + cx] !== 24 /* CAVE_FLOOR */) continue;
          if (occupiedIdx.has(cy * N + cx)) continue;
          const habitat = EnemySpawns.caveContextAt(entry, tx, ty, cx, cy, depth);
        const kind = EnemySpawns.caveKind(depth, kindRoll, habitat);
        if (!kind) continue;
        const id = EnemySpawns.caveId(depth, tx, ty, cx, cy);
          if (caughtSet.has(id) || legacyDefeats.cells.has(`${cx}_${cy}`) || monsterSeats.has(id)) break;
          if (heldByPlayer.has(cy * N + cx)) break;
          const wmx = tx * this.tileEdgeM + (cx + 0.5) * cellSizeM;
          const wmy = ty * this.tileEdgeM + (cy + 0.5) * cellSizeM;
          creatures.push(WorldGen.makeCreature(kind, wmx, wmy, id,
            { shiny: EnemyRoster.get(kind).eliteEligible && isShiny(id, SHINY_RATE.monster), habitat: habitat.theme }));
          monsterSeats.add(id);
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
    durationMs = Gear.workDurationMs(this.save, durationMs);
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
    const npcDt = this._npcTickAt == null ? 0 : Math.min(0.1, (now - this._npcTickAt) / 1000);
    this._npcTickAt = now;
    // Each creature notices a Moss-hidden player only after that player hits
    // it. Shadow Powder, collapse and passenger safety still hide everyone.
    // THE KERB (creature_ai.js): the player's FEET in a major road's kerb
    // buffer. Every hostile turns its back while it holds (`kerbTurn` below) —
    // the pavement is where a chase ends, so the carriageway is never a
    // refuge. Read once per tick, off playerM, never the camera anchor.
    const STEP_MS = WANDER_STEP_MS;
    const STEP_M = this.cellM;   // 1 cell per step
    // Only sim creatures near the player. Beyond the bubble they stay frozen
    // at their last position — cheap, and the player cannot see it happen.
    const px = this.startWorldM.x + this.playerM.x;
    const py = this.startWorldM.y + this.playerM.y;
    const kerbLeash = inKerbAt(this, px, py);
    enemySlimeTrailTick(this, px, py, npcDt);
    // The nearest hostile TAKING AN INTEREST this tick (not standing down, the
    // player not unnoticed) — handed to app.js _foeHeadsUp after the loop,
    // which buzzes the phone when it is close (SAFETY_FOE_BUZZ_CELLS).
    let interestedFoeM = Infinity;
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
    // Prune save.caught of pest-deer markers whose tile has since fallen out
    // of the in-memory tile cache. Every OTHER id in this array is
    // deterministic (crow_tx_ty_i, mon_kind_depth_tx_ty_i, rabbit_depth_tx_ty_i,
    // …) and MUST be kept forever — revisiting that tile re-seeds the same rng
    // and mints the identical id, so dropping the marker would let the "dead"
    // creature spawn right back. Pest deer are the one exception: each spawn
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
    // surface pest deer whose tile is still very much cached.
    //   Own throttle (not `_lastPestT`) because that timer can go far longer
    // than 90s between resets when no raidable crop is planted (see below),
    // and this O(save.caught) filter has no business running every frame either.
    if ((this.depth || 0) === 0 && this.save.caught && this.save.caught.length &&
        now - (this._lastCaughtPruneT || 0) > 90000) {
      this._lastCaughtPruneT = now;
      this.save.caught = this.save.caught.filter((id) => {
        // The ghosts (ghostSpawnPass), the fished slime (fishedSlimeSpawn),
        // a dismissed spirit raven (app.js _tickSpiritRaven) and a
        // guildhall bounty's foes (app.js _spawnGuildBounty) mint their ids
        // the same way and are pruned by the same rule. (`pest_crow_` is the
        // pump's old prefix — a marker left by a session before the deer
        // took the job prunes the same way.)
        const m = typeof id === 'string' && /^(?:pest_deer|pest_crow|ghost|fished_slime|spirit_raven|summoned_skeleton|summoned_wraith|mercenary|guildfoe)_(-?\d+)_(-?\d+)_/.exec(id);
        // A gate's guard (lairs.js DAILY_TIERS) carries its UTC day: one
        // from another day can never rise again, so its marker goes.
        const gateDay = Lairs.dailyGuardDay(id);
        if (gateDay) return gateDay === Delivery.dayKey();
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
    this._npcWardContext = { home: homePos, castles: castleWards, radius2: HOME_WARD_R2 };
    NPC.prepareTargets(this, pcW, px, py, RANGE_M, now);
    // Pest spawn: if the player has any planted crop and there is NO wild
    // deer already near the player, dispatch one off-screen once an hour
    // (PEST_DISPATCH_MS). The deer's wander (`raidsCrops`, below) walks at the
    // nearest crop it may eat and grazes it when it stands beside it. Eased
    // from "top up to 2 every 30 s", then every 90 s — both made crops a
    // chore: another raider arrived soon after you dealt with the last. Now
    // the pump only backfills an emptied field, once an hour, so a raid is an
    // event rather than a drain. (The dispatched pest
    // was a CROW until Sep 2026. Wild crows raid fields again, from their
    // own tick, but the pump sends only deer.)
    this._lastPestT = this._lastPestT || 0;
    // Only crops a deer actually eats (not potato) justify spawning a pest —
    // and only on HARD (Difficulty.get().cropPests). The pump is not a
    // difficulty KNOB, it is a mode difference: a deer that finds your field
    // wherever you plant it is the hard game's answer to farming as a quiet
    // income, and on easy the tile spawner's own deer are the whole deer
    // threat — meet one by walking into it, not by having one dispatched to
    // you. That also retires the amnesty clause this gate used to carry
    // (hasHarvested || !pestAmnesty): easy never pumps at all now, and hard
    // has no grace to wait out, so the check could only ever answer "true"
    // where it still ran.
    // Timer gate first: the planted-crop scan is O(planted) and has no
    // business running on the frames between pest windows.
    // SURFACE ONLY: underground WorldGen.tileCache is the cave level's map
    // (see the prune's depth gate above), so a pest minted here landed in
    // the dungeon — a deer with no crop to walk at, in a cave.
    if ((this.depth || 0) === 0 && now - this._lastPestT > PEST_DISPATCH_MS) {
      const hasRaidableCrop = this.save.planted && this.save.planted.some((p) => this._cropRaidable(p));
      if (hasRaidableCrop && Difficulty.get().cropPests) {
        this._lastPestT = now;
        // Count nearby wild (non-released, not-yet-caught) deer.
        let wildDeer = 0;
        WorldGen.forEachItemNear('creatures', pcW.tx, pcW.ty, (c) => {
          if (c.kind !== 'deer') return;
          if (typeof c.id === 'string' && c.id.startsWith('released_')) return;
          if (caughtSet.has(c.id)) return;
          const dx = c.x - px, dy = c.y - py;
          if (dx * dx + dy * dy <= RANGE_SQ) wildDeer++;
        });
        if (wildDeer < 1) {
          const pc = pcW;
          const entry = WorldGen.tileCache.get(WorldGen.tileKey(pc.tx, pc.ty));
          if (entry && entry.creatures) {
            // Spawn in a random direction, OUTSIDE the viewport but INSIDE
            // the sim bubble, so the deer walks toward the nearest crop from
            // its first tick. Seated at CREATURE_SIM_CELLS (12) it landed on
            // the rim of the very cull that decides whether it thinks, so the
            // pest the pump had just dispatched sat frozen in the dark until
            // the player happened to walk at it — the comment right here
            // claimed it "flies straight to the nearest crop" and it did not.
            // 10 cells clears the viewport corner (7.8) by a comfortable
            // margin and stays two cells inside the bubble.
            //   A deer WALKS, so its seat has to be ground it can stand on:
            // a few angles round the ring, the first whose cell is loaded
            // and not water / a building / a road (Combat.faunaBlocksCell —
            // the same gate its every step passes). None found: no pest this
            // window; the timer has already been stamped, so the next window
            // tries again.
            const SPAWN_R = PEST_SPAWN_CELLS * this.cellM;
            const base = Math.random() * Math.PI * 2;
            for (let k = 0; k < 8; k++) {
              const angle = base + (k * Math.PI * 2) / 8;
              const sx = px + Math.cos(angle) * SPAWN_R, sy = py + Math.sin(angle) * SPAWN_R;
              const dest = this.cellAt(sx, sy);
              if (!dest.loaded || Combat.faunaBlocksCell(dest.type) || WorldGen.isRoadTerrain(dest.type)) continue;
              entry.creatures.push(WorldGen.makeCreature('deer', sx, sy,
                `pest_deer_${pc.tx}_${pc.ty}_${Math.floor(now)}_${Math.floor(Math.random() * 1e4)}`));
              break;
            }
          }
        }
      }
    }

    // The night's ghosts: a group now and then in the dark about the player.
    ghostSpawnPass(this, now, px, py, pcW, homePos, castleWards, HOME_WARD_R2, caughtSet);

    // Most ticks have no charm active: avoid scanning every foe against all
    // creatures just to discover there are no temporary allies to target.
    this._charmedOpponents = [];
    // The same pass gathers the live foes in the sim bubble once a tick, so
    // each foe's spacing (creature_ai.js foeSpacingPush) reads a short list.
    this._foeBodies = [];
    WorldGen.forEachItemNear('creatures', pcW.tx, pcW.ty, c => {
      if (caughtSet.has(c.id)) return;
      if (Combat.isCharmed(c)) this._charmedOpponents.push(c);
      const ddx = c.x - px, ddy = c.y - py;
      if (ddx * ddx + ddy * ddy <= RANGE_SQ && Combat.isEnemy(c) && EnemyRoster.get(c.kind)) this._foeBodies.push(c);
    });

    WorldGen.forEachItemNear('creatures', pcW.tx, pcW.ty, (c) => {
      // Cheapest reject first: the sim range cull. Everything below runs only
      // for the handful of creatures actually near the player.
      const ddx = c.x - px, ddy = c.y - py;
      const far = ddx * ddx + ddy * ddy > RANGE_SQ;
      // Is this surface foe here for this player (EnemySpawns.surfaceActive —
      // it stamps `_surfaceInactive`, which Combat.isEnemy and the draw read)?
      // Asked every tick inside the bubble. Outside it — hundreds of seats
      // across the 3×3 ring on a town's tiles, each call a roster lookup and
      // a tier-band walk — a frozen foe is re-asked once per
      // SURFACE_RECHECK_MS instead: its answer moves with the sun, Home and
      // the pest amnesty, all minutes-slow, so the stamp a far reader
      // (a magic trap, a hint) sees is never more than that stale.
      if (c._surfaceSpawn || c.lair) {
        if (!far || c._surfaceAskedT == null || now - c._surfaceAskedT >= SURFACE_RECHECK_MS) {
          c._surfaceAskedT = now;
          if (!EnemySpawns.surfaceActive(this, c)) return;
        } else if (c._surfaceInactive) return;
      }
      if (far) {
        c._walkHazardPrevious = null;
        if (c.kind === 'npc') c._moving = false;
        return;
      }
      if (enemyDisguiseTick(this, c, px, py)) return;
      if (enemyBurrowTick(this, c, EnemyRoster.get(c.kind), now)) return;
      if (typeof PotionEffects !== 'undefined' && PotionEffects.tick(this, c)) return;
      if (this._tickUnitFire?.(c, now)) return;
      if (this._tickUnitPoison?.(c, now)) return;
      if (!caughtSet.has(c.id) && enemyWalkHazardTick(this, c, now)) return;
      if (c.kind === 'npc') { NPC.tick(this, c, now, npcDt); return; }
      const unnoticed = this.isUnnoticed(c);
      const isTame = typeof c.id === 'string' && c.id.startsWith('released_');
      // HUNTS FOR THE PLAYER: a tame pet, or a summoned ally (the spirit
      // raven, conjured by a scroll — yours without being tame). One flag
      // the pet scan and its fight read; see huntsPrey for what each takes.
      const summoned = SpriteLayout.isSummoned(c.kind);
      // A spent ally (its HP ran out — see the pet fight) stands still until
      // app.js _tickSpiritRaven lifts it off the map.
      if (summoned && c._spent) return;
      const huntsForPlayer = (isTame && SpriteLayout.isPet(c.kind)) || summoned;
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
      if (flowerCreatureTick(this, c, now, px, py, caughtSet,
        { homePos, castleWards, radiusSq: HOME_WARD_R2 })) return;
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
      const stationary = !!c.stationary || EnemyRoster.isRooted(c.kind)
        || !!Combat.monster(c.kind)?.stationary;
      // An ENRAGED game animal (a hunted deer — `fightsBack`, _rageUntil) is
      // hostile for as long as it is angry, so it takes Home's ward exactly as
      // an enemy does: one lane, another reason. Warded, it is turned away
      // and `standDown` switches its butt off.
      const fightsBack = !isTame ? SpriteLayout.creatureFightsBack(c.kind) : null;
      const enraged = !!fightsBack && !!c._rageUntil && Date.now() < c._rageUntil;
      const wardFoe = (!!homePos || castleWards.length > 0 || haunts) && !isTame
        && (Combat.isEnemy(c) || enraged);
      if (wardFoe) {
        const from = c._wardFrom;
        // A declared stationary foe cannot retreat to release a latch. Recheck
        // the live ward each tick so relocating Home does not suppress it forever.
        if (from && !stationary) {
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
      const wanderOff = !stationary && !isTame && !c.lair && Combat.isEnemy(c)
        && monsterWanderingOff(c, now, Math.sqrt(ddx * ddx + ddy * ddy), this.cellM);
      // TURNED BACK AT THE KERB (creature_ai.js THE KERB): the player stands
      // in a major road's kerb buffer, so every hostile — a foe, or a hunted
      // animal while it is angry — stands down and turns away, exactly as a
      // foe wandering off does (the same away angle, below). A lair guard
      // gives up instead (guardState, noticed = false) and walks home; a ghost
      // stops where it is. One more reason in the wander-off lane, never a
      // "frozen while you are on the road" rule — that one would lure a
      // player INTO the road.
      const kerbTurn = kerbLeash && !isTame && (Combat.isEnemy(c) || enraged);
      // ROUTED: turned onto an away angle at the flee pace — by Home's ward, or
      // by wandering off. Two reasons, one pace; the angle chain says away from
      // WHAT (Home, or the player).
      // SATED: a thief that has stolen from you today (Combat.theftSated —
      // the raven's coins, the gull's food; one snatch a day) turns its back
      // and flies off — a third
      // reason in the rout lane (the away-from-the-player angle at the flee
      // pace), and one more reason to stand down below. Asked only of a kind
      // that steals, so the per-creature cost elsewhere is one table read.
      const sated = !isTame && !!Combat.theftKind(c.kind) && Combat.theftSated(this.save, c);
      const frightened = Combat.isEnemy(c) && c._fearUntilT > now;
      // MAD (the Powder of Psychosis — Combat.isPsychotic): the rout lane
      // once more — the flee pace, no blow, no target — but with a RANDOM
      // angle each hop (the chain below) in place of fear's away angle, so
      // it runs every which way rather than off. Home's ward still outranks
      // it: a mad foe inside the ring is walked out like any other.
      const psychotic = Combat.isEnemy(c) && Combat.isPsychotic(c, now);
      const routed = warded || wanderOff || sated || frightened || psychotic;
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
      const lairState = c.lair && !frightened && !psychotic ? Lairs.guardState(c, { x: px, y: py }, this.cellM, !unnoticed && !kerbTurn) : null;
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
      const standDown = frightened || psychotic || warded || wanderOff || kerbTurn || sated || (!!lairState && lairState !== 'hunt');
      const rosterRow = !isTame ? EnemyRoster.get(c.kind) : null;
      const npcTarget = rosterRow && !standDown
        ? NPC.enemyTarget(this, c, rosterRow, px, py, unnoticed) : null;
      const enemyDt = c._enemyTickT == null ? 0 : Math.min(0.1, Math.max(0, (now - c._enemyTickT) / 1000));
      c._enemyTickT = now;
      // A HUNTED DEER CHARGES: enraged, and neither warded nor ignoring you
      // (`unnoticed` — a powder, or a body on an empty bar). Read by the butt
      // below, the stride and the angle chain, so the three agree.
      const gameCharge = enraged && !standDown && !unnoticed;
      if (!isTame && !standDown && !unnoticed && (Combat.isEnemy(c) || enraged)) {
        interestedFoeM = Math.min(interestedFoeM, Math.sqrt(ddx * ddx + ddy * ddy));
      }
      // A GHOST has its own mover (ghostTick — hover, rush, burn) and its own
      // blow: ONE touch of its row's dmg, through the mode, the shield and the
      // armour like every blow, and then it is spent — marked in save.caught
      // like a kill, but no coin (nobody felled it). Nothing else below runs
      // for it: it has no leech, no step chain and no crop to eat.
      if (haunts) {
        const gm = Combat.monster(c.kind);
        const pace = gm.mps / 1000;
        const fate = ghostTick(this, c, now, npcTarget?.x ?? px, npcTarget?.y ?? py,
          (npcTarget ? NPC.isDormant(npcTarget) : unnoticed) || kerbTurn, warded, pace);
        if (fate === 'touch' && npcTarget) NPC.hit(this, npcTarget, Date.now(),
          (gm.dmg * Combat.powerMul(c) + PotionEffects.meleeBonus(c)) * PotionEffects.meleeMul(c));
        if (fate === 'touch' && !npcTarget) {
          const raw = (gm.dmg * Combat.powerMul(c) + PotionEffects.meleeBonus(c)) * PotionEffects.meleeMul(c);
          const dmg = Combat.incomingDamage(this.save, raw);
          if (dmg > 0) {
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
      // LAVA BURNS FOES TOO (Combat.LAVA_DMG_PER_S, the player's rate — see
      // app.js _tickLava). Whole points once a second off the foe's own HP
      // through _damageEnemy, so the health bar and the "-2" read as any
      // other blow; a foe it kills is the ground's kill ('lava' is no player
      // source — Combat.isPlayerKill), which pays the bounty coin and nothing
      // past it, the turret's rule. A tamed slime is a pet, never burned.
      if (!isTame && Combat.isEnemy(c) && !Conditions.fireImmune(c) && !Combat.monster(c.kind)?.lavaImmune && (this.depth === 0 || this.depth === WorldGen.LAVA_DEPTH)
          && now >= (c._lavaNextT || 0)) {
        c._lavaNextT = now + 1000;
        const under = this.cellAt(c.x, c.y);
        if (under.loaded && under.type === WorldGen.T.CAVE_LAVA) Combat.ignite(c, now, 'lava');
        if (under.loaded && under.type === WorldGen.T.CAVE_LAVA
            && this._damageEnemy(c, Combat.LAVA_DMG_PER_S, 'lava')) return;
      }
      if (enemyFireEscapeTick(this, c, rosterRow, now, enemyDt)) return;
      // Slime energy steal: a slime sitting on/near the player drains 1 energy
      // on a per-slime cooldown. Accumulated across all slimes this frame and
      // surfaced with one throttled flash after the loop (see below) so a swarm
      // doesn't spam 50 popups. Runs every frame (wanderCreatures is per-tick),
      // independent of the slime's slow step cadence.
      if (rosterRow && !haunts) {
        if (npcTarget) rosterEnemyAttack(this, c, rosterRow, now, npcTarget.x, npcTarget.y,
          standDown, enemyDt, npcTarget);
        else rosterEnemyAttack(this, c, rosterRow, now, px, py, unnoticed || standDown, enemyDt);
      }
      if (c.kind === 'slime' && !isTame && !unnoticed && !standDown && !rosterRow) {
        // The same one cell the player now swings at (Combat.MELEE_REACH_CELLS)
        // — one number for "melee is arm's length", read by both sides.
        const STEAL_R = Combat.meleeReachM(this.cellM);
        if (ddx * ddx + ddy * ddy <= STEAL_R * STEAL_R &&
            (!c._nextStealT || now >= c._nextStealT)) {
          c._nextStealT = now + 1000;   // one bite a second
          const slimeBite = (SLIME_LEECH_ENERGY * Combat.powerMul(c) + PotionEffects.meleeBonus(c)) * PotionEffects.meleeMul(c);
          const slimeDmg = Combat.incomingDamage(this.save, slimeBite);
          if (slimeDmg > 0) {
            this._slimeStealAccum = (this._slimeStealAccum || 0)
              + this._losePlayerEnergy(slimeDmg, { closeShop: true });
          }
        }
      }
      // THE HUNTED DEER'S BUTT: at arm's length (Combat.meleeReachM, the reach
      // the player swings at) every `hitMs`, for its row's `dmg` — through the
      // mode, the shield and the armour like every blow (Combat.incomingDamage),
      // banked by _losePlayerEnergy (Energy.set + the hit flash) and popped on
      // the player's cell with the monsters' roll-up (_monsterDmgAccum).
      if (gameCharge) {
        const BUTT_R = Combat.meleeReachM(this.cellM);
        if (ddx * ddx + ddy * ddy <= BUTT_R * BUTT_R && (!c._nextStealT || now >= c._nextStealT)) {
          c._nextStealT = now + fightsBack.hitMs;
          const raw = fightsBack.dmg * Combat.powerMul(c);
          const dmg = Combat.incomingDamage(this.save, raw);
          if (dmg > 0) {
            this._monsterDmgAccum = (this._monsterDmgAccum || 0)
              + this._losePlayerEnergy(dmg, { closeShop: true });
          }
        }
      }
      // Underground monster attack: the slime's energy leech, parametrised.
      // A monster within its RANGE (cells) drains DMG energy on a
      // MONSTER_HIT_MS per-monster cooldown. Melee kinds use range 1
      // (adjacent, Combat.MONSTERS[kind].range itself); a RANGED kind (the goblin
      // archer) instead fires the instant the player is inside the SAME ring
      // the player's bow range is derived from —
      // Combat.rangeCellsFor('bow', reachCells(this)), the player's live
      // reach plus one cell — rather than a flat cell count. So the archer
      // can never open fire from further off than your own arrow
      // would answer from, and the ring tightens underground / grows with
      // Inner Light upgrades exactly as the bow's does. Accumulated +
      // flashed once per window after the loop, like the slime swarm.
      if (Combat.isMonster(c.kind) && !isTame && !unnoticed && !standDown && !rosterRow) {
        const m = Combat.monster(c.kind);
        // A kind whose row lands no blow (Combat.monsterHits — the trapper,
        // dmg 0) skips both halves below: it is not a melee drain at strength
        // zero, which the armour floor would round up to a bite.
        const hits = Combat.monsterHits(c.kind);
        const rangeCells = PotionEffects.range(c, m.range > 1 ? Combat.rangeCellsFor('bow', reachCells(this)) : m.range);
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
          const dmg = m.dmg * MONSTER_ARROW_HITS * Combat.powerMul(c);
          // The arrow carries its hit COUNT as well as its damage, so armour
          // can soak the volley one hit at a time when it lands
          // (_shotHitsPlayer) — mitigating the bundle in one lump would make
          // the slow archer the one foe armour barely helps against.
          const shot = Combat.monsterShot(c.x, c.y, px, py, this.cellM, dmg, MONSTER_ARROW_HITS);
          if (shot) shot._sourceGuard = c;
          if (shot) this._shots.push(shot);
        } else if (clear && m.range <= 1 && ddx * ddx + ddy * ddy <= R * R
                   && (!c._nextStealT || now >= c._nextStealT)) {
          c._nextStealT = now + MONSTER_HIT_MS;
          c._attackT0 = now;
          c._attackUntil = now + 600;
          // Elite and lair power scale the attack before shield and armour.
          const dmg = (m.dmg * Combat.powerMul(c) + PotionEffects.meleeBonus(c)) * PotionEffects.meleeMul(c);
          const monDmg = Combat.incomingDamage(this.save, dmg);
          if (monDmg > 0) {
            const lost = this._losePlayerEnergy(monDmg, { closeShop: true });
            this._monsterDmgAccum = (this._monsterDmgAccum || 0) + lost;
            if (lost > 0 && !isTame && Combat.isEnemy(c) && m.condition) {
              this._applyCondition(m.condition);
            }
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
      if (Combat.monsterLays(c.kind) && !isTame && !unnoticed && !standDown && !rosterRow) {
        this._trapperLay(c, now, px, py);
      }
      // A declared stationary kind can bite above but never enters a movement
      // lane. Roster plants also remain rooted through their anchor_spit mover.
      if (stationary) return;
      if (c.immobile && !frightened && !psychotic && lairState !== 'hunt' && lairState !== 'return') return;
      if (rosterRow) {
        // Turned back at the kerb is the wander-off's away angle (as in the
        // step chain below); a lair guard walks home instead (guardState).
        rosterEnemyMove(this, c, rosterRow, now, npcTarget?.x ?? px, npcTarget?.y ?? py,
          (npcTarget ? NPC.isDormant(npcTarget) : unnoticed) || standDown,
          routed || (kerbTurn && !c.lair), lairState, enemyDt);
        return;
      }
      // Wild-crow flight rhythm: perch → one eased glide → perch again,
      // casing and raiding a field it notices (_wildCrowTick has the phases).
      // Tame (released_*) crows fall through to the generic wander below so
      // they behave like other pets.
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
      // A charging deer does not bolt — it comes at you (gameCharge).
      const bolting = !!bolt && !gameCharge && (
        (bolt.cells != null && ddx * ddx + ddy * ddy <= (bolt.cells * this.cellM) ** 2)
        || (!!bolt.escapes && !!(c._escapingUntil && now < c._escapingUntil)));
      // The charge runs at the kind's own flee stride and beat: one pace for
      // "in a hurry", whichever way it is going.
      const sprinting = bolting || (gameCharge && !!bolt);
      // Underground monsters: cadence scales by SPEED (faster ⇒ shorter step,
      // moves more often); flyers (bats) dart a full cell, ground monsters
      // lumber like the slime (0.6 cell).
      const isMon = Combat.isMonster(c.kind);
      const mon = isMon ? Combat.monster(c.kind) : null;
      // Read the same stamped flag as the gold tint, including pets and foes.
      const shinyFast = 1 / Combat.shinySpeedMul(c);
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
      //   NOT ON A SPRINT. A kind already at its bolt (sprinting — bolting,
      // or a hunted deer's charge) is already in a hurry: the bolt row IS its
      // hurry pace, tuned under the speed ceiling (WILD_SPEED_CEILING_MPS),
      // and the FLEE multipliers on top would stack a run on a run (a routed
      // deer at four times its bolt). So the rout quickens what was not
      // already running.
      const hurry = routed && !sprinting;
      let stepMs = (c.kind === 'slime' ? STEP_MS * (charging ? 1 : SLIME_STEP_MUL)
                   : isMon ? STEP_MS / mon.speed
                   : sprinting ? (bolt.stepMs ?? STEP_MS)
                   : (gait?.stepMs ?? STEP_MS)) * shinyFast * (hurry ? FLEE_BEAT_MUL : 1);
      stepMs /= PotionEffects.speedMul(c);
      const stepM = (c.kind === 'slime' ? STEP_M * SLIME_HOP_CELLS
                  : isMon ? STEP_M * monsterStrideCells(mon)
                  : sprinting ? STEP_M * (bolt.stepCells ?? 1)
                  : STEP_M * (gait?.stepCells ?? 1)) * (hurry ? FLEE_STRIDE_MUL : 1);
      // A kind's top speed (SpriteLayout.creatureMaxMps) stretches the glide,
      // never shortens the stride: the step still lands where it was aimed.
      // A shiny's cap rises by the same factor its beat quickens by.
      const maxMps = SpriteLayout.creatureMaxMps(c.kind) / shinyFast * PotionEffects.speedMul(c);
      stepMs = Math.max(stepMs, stepM / maxMps * 1000);
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

        // Pet combat: a creature that HUNTS FOR THE PLAYER scans for the
        // nearest valid prey within 8 cells each wander step. Two reasons, one
        // lane: a tame PET (a kind whose row says it hunts for its owner —
        // cats crows, dogs deer + slimes), or a SUMMONED ally (the spirit
        // raven — every foe and pest deer). What each may take is huntsPrey
        // (creature_ai.js), off the same row.
        if (huntsForPlayer) {
          const CHASE_R = 8 * this.cellM;
          const CHASE_R2 = CHASE_R * CHASE_R;
          let nearest = null, nearestD2 = CHASE_R2;
          // Pet is within sim range of the player and prey within 8 cells of
          // the pet, so the player's 3×3 tile ring covers the search box.
          WorldGen.forEachItemNear('creatures', pcW.tx, pcW.ty, (cr) => {
            if (!huntsPrey(c.kind, cr)) return;
            if (Companions.follows(c, now) && Math.hypot(cr.x - px, cr.y - py) > 4 * this.cellM) return;
            if (c.stayHome && Math.hypot(cr.x - c.petHomeX, cr.y - c.petHomeY) > Companions.HOME_PET_CELLS * this.cellM) return;
            if (caughtSet.has(cr.id)) return;
            const d2 = (cr.x - c.x) ** 2 + (cr.y - c.y) ** 2;
            if (d2 < nearestD2) { nearestD2 = d2; nearest = cr; }
          });
          c._chaseTarget = nearest;
        }

        // Flee override: prey that was just hit runs away — at its BOLT if
        // its row has one (the bolt IS the kind's hurry, tuned under the speed
        // ceiling; the FLEE multipliers on top would stack a run on a run),
        // else at the FLEE pace anything else in a hurry runs. The hop glides
        // over the same beat it is chosen on (_hopMs): it used to inherit
        // whatever _hopMs the last step left, so the shove's speed was an
        // accident of history.
        if (c._fleeUntilT && c._fleeUntilT > now) {
          // Shoved off among houses, it runs the ROADSIDE (creature_ai.js
          // roadsideRunAngle) like every other retreat.
          const shove = c._fleeAngle ?? 0;
          const run = roadsideRunAngle(this, c, shove);
          const fa = run ?? shove;
          const base = hurry ? { m: stepM / FLEE_STRIDE_MUL, ms: stepMs / FLEE_BEAT_MUL } : { m: stepM, ms: stepMs };
          const hurryM = bolt ? STEP_M * (bolt.stepCells ?? 1) : base.m * FLEE_STRIDE_MUL;
          const hurryMs = bolt ? (bolt.stepMs ?? STEP_MS) * shinyFast : base.ms * FLEE_BEAT_MUL;
          for (let attempt = 0; attempt < 4; attempt++) {
            const fleeAngle = fa + (run != null ? 0 : (Math.random() - 0.5) * 0.6);
            const ftx = c.x + Math.cos(fleeAngle) * hurryM;
            const fty = c.y + Math.sin(fleeAngle) * hurryM;
            const dest = this.cellAt(ftx, fty);
            if (dest.loaded && !Combat.faunaBlocksCell(dest.type)) {
              c._startX = c.x; c._startY = c.y;
              c._targetX = ftx; c._targetY = fty;
              c._stepT0 = now;
              // A kind with a top speed (creatureMaxMps) glides the shove no
              // faster than it: the beat and the glide both stretch.
              c._hopMs = Math.max(hurryMs, hurryM / maxMps * 1000);
              c._nextChooseT = now + c._hopMs;
              break;
            }
          }
          c._fleeUntilT = 0;
          return;   // skip rest of wander step; interpolation resumes next frame
        }

        // Movement target — modes checked in order:
        //   (a) Pet chasing prey (_chaseTarget set above)
        //   (b) Released followers and active hired/summoned companions
        //       keep beside their owner through the shared follow predicate.
        //   (c) Slime — lazily drawn toward the player.
        //   (d) Tame pets — home-bias keeps them near release point.
        //   (e) Default — wild farm animals random-wander around home.
        //   A CROP RAIDER (the deer — `raidsCrops`) that has noticed a field
        //   walks at it (raidStep, below) ahead of (d) and (e).
        // Wild crows take a separate path (_wildCrowTick) above.
        const FOLLOW_GAP = 1.5 * this.cellM;
        const isFollowing = Companions.follows(c, now);
        // Travelling allies regroup beside their owner between hunts.
        // Pets assigned to Home keep the anchor saved when released.
        if (isFollowing) { c._homeX = px; c._homeY = py; }
        else if (c.stayHome) { c._homeX = c.petHomeX ?? c._homeX; c._homeY = c.petHomeY ?? c._homeY; }
        const dxh = c._homeX - c.x, dyh = c._homeY - c.y;
        const retreating = c._retreatUntilT && c._retreatUntilT > now;
        const homeRadius = retreating ? 0 : c.stayHome ? Companions.HOME_PET_CELLS * this.cellM : isTame ? 5 * this.cellM : 3 * this.cellM;
        const homeBias = Math.hypot(dxh, dyh) > homeRadius;
        const dxp = px - c.x, dyp = py - c.y;
        const distToPlayer = Math.hypot(dxp, dyp);
        // A CROP RAIDER NOTICES A FIELD: the nearest planted crop it may eat
        // (_cropRaidable — never potato) within
        // RAID_NOTICE_CELLS (the on-screen sim range, so a deer spots a field
        // from across the viewport; a dispatched pest — isPest — from
        // anywhere), and about half its steps walk at it: a grazer that has
        // smelt the beds, not a hunter, so it still reads as a deer. Never a
        // tame one, and never while bolting from you — the flee (bolt.cells)
        // is exactly what keeps a field safe while you stand in it, and a dog
        // (its `prey`) or a scarecrow (its `avoids`) keeps it off without you.
        // Off the crop spatial index (Crops.forEachInBox) so a big farm costs
        // one bucket walk, not a scan of every crop ever planted.
        let raidStep = null;
        if (beh?.raidsCrops && !isTame && !sprinting && this.save.planted?.length && Math.random() < 0.5) {
          const R = (isPest(c) ? CREATURE_SIM_CELLS * 4 : RAID_NOTICE_CELLS) * this.cellM;
          let best = null, bestD2 = R * R;
          Crops.forEachInBox(this.save, this.depth || 0, c.x - R, c.y - R, c.x + R, c.y + R, (p) => {
            if (!this._cropRaidable(p)) return;
            const ddx = p.x - c.x, ddy = p.y - c.y, d2 = ddx * ddx + ddy * ddy;
            if (d2 < bestD2) { bestD2 = d2; best = p; }
          });
          raidStep = best;
        }
        // UNSEEN: `unnoticed` (the player is not there to be hunted) OR this
        // foe cannot see that far (Combat.seesPlayer — slimes are
        // short-sighted, goblins see across the bubble). Read by the two
        // STALK branches only: every attack gate below reaches a cell or
        // three, well inside any sight, and keeps reading `unnoticed`. A
        // struck slime's charge is not sight either — it knows who hit it.
        const unseen = unnoticed || !Combat.seesPlayer(c.kind, distToPlayer, this.cellM, this.save);
        let tx = c.x, ty = c.y, angle = 0;
        let foundValidTarget = false;
        // Fight resolution: if chasing pet is in fight range, deal damage.
        if (c._chaseTarget) {
          const tgt = c._chaseTarget;
          const fd2 = (tgt.x - c.x) ** 2 + (tgt.y - c.y) ** 2;
          const FIGHT_R2 = (PotionEffects.range(c, 1.5) * this.cellM) ** 2;
          if (fd2 <= FIGHT_R2) {
            // One HP table for every fight in the game (combat.js) — a slime a
            // dog has been worrying shows the damage on the player's health
            // ring too, and finishing it off with an arrow is that much less
            // work. The bite is Combat.petBite: a point for a tame pet, the
            // slime's own blow for the spirit raven (summoned as a slime).
            // The prey bites back a point either way.
            tgt._hp = Combat.damage(tgt, Combat.petBlow(c));
            c._hp   = Combat.damage(c, 1);
            tgt._lastDamagedT = Date.now();
            c._lastDamagedT   = Date.now();
            // A pet's bite is a blow too: a splitting slime divides under it
            // (creature_ai.js enemySplit), away from the pet's side.
            if (tgt._hp > 0) enemySplit(this, tgt, c.x, c.y, now);
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
            if (c._hp <= 0 && summoned) {
              // A SUMMONED ally is spent, not wounded: it has no home to limp
              // to. Flagged here, removed by its owner's tick (app.js
              // _tickSpiritRaven) — never spliced out of the array this scan
              // is walking.
              c._spent = true;
              c._chaseTarget = null;
            } else if (c._hp <= 0) {
              // Pet retreats home to recover.
              c._hp = 1;
              c._chaseTarget = null;
              c._retreatUntilT = now + Companions.RECOVERY_MS;   // 30s forced home-bias
            }
          }
        }

        for (let attempt = 0; attempt < 6; attempt++) {
          // How far THIS step actually travels. A branch below may shorten it
          // (a guard walking home stops ON its seat rather than overshooting);
          // everything else takes the kind's full stride.
          let stepLen = stepM;
          if (isFollowing && distToPlayer > 3 * this.cellM) {
            c._chaseTarget = null;
            angle = Math.atan2(dyp, dxp);
            stepLen = Math.min(stepM, distToPlayer - FOLLOW_GAP);
          } else if (c._chaseTarget && !this.save.caught?.includes(c._chaseTarget.id)) {
            const tgt = c._chaseTarget;
            angle = Math.atan2(tgt.y - c.y, tgt.x - c.x) + (Math.random() - 0.5) * 0.3;
          } else if (isFollowing && distToPlayer > FOLLOW_GAP) {
            angle = Math.atan2(dyp, dxp) + (Math.random() - 0.5) * 0.4;
          } else if (isFollowing) {
            stepLen = 0;
          } else if (gameCharge) {
            // A HUNTED DEER turns on you: every stride at the player, on the
            // monsters' stalk jitter, until it is close enough to butt.
            angle = distToPlayer > 0.5 * this.cellM
              ? Math.atan2(dyp, dxp) + (Math.random() - 0.5) * STALK_JITTER
              : Math.random() * Math.PI * 2;
            if (distToPlayer > 0.5 * this.cellM) stepLen = Math.min(stepM, Math.max(0, distToPlayer - 0.5 * this.cellM));
          } else if (bolting) {
            // AWAY FROM THE PLAYER, at the kind's own spread: a rabbit
            // zig-zags in a panic (wide jitter), a deer runs a committed line
            // (mild), a butterfly careens (wider still). One branch, because
            // all three were the same line with a different number in it —
            // and the number is on the kind now.
            //   Among houses the bolt runs the ROADSIDE (creature_ai.js
            // roadsideRunAngle): along the street, never into a yard.
            angle = Math.atan2(-dyp, -dxp);
            angle = roadsideRunAngle(this, c, angle) ?? angle + (Math.random() - 0.5) * bolt.jitter;
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
            angle = Math.atan2(c.y - c._wardFrom.y, c.x - c._wardFrom.x);
            // Home stands among houses: the rout runs the ROADSIDE
            // (roadsideRunAngle) — along the street, not through the yards.
            angle = roadsideRunAngle(this, c, angle) ?? angle + (Math.random() - 0.5) * 0.8;
          } else if (psychotic) {
            // MAD: every hop in a fresh random direction, at the rout's
            // pace. Below the ward (Home still drives it out), above fear:
            // a foe that is both runs about rather than away.
            angle = Math.random() * Math.PI * 2;
          } else if (frightened || wanderOff || (kerbTurn && !c.lair)) {
            // WANDERING OFF (or TURNED BACK AT THE KERB — the same away angle,
            // at its own pace): away from the PLAYER, on the same spread as the
            // rout above — out of whatever ring it was stalking the edge of.
            // An angle, not a refused cell, for the same reason as the rout;
            // the cell tests below still refuse water, rocks and fires.
            // Among houses it runs the ROADSIDE (roadsideRunAngle) too.
            angle = Math.atan2(c.y - py, c.x - px);
            angle = roadsideRunAngle(this, c, angle) ?? angle + (Math.random() - 0.5) * 0.8;
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
            } else if (!unseen && Math.random() < 0.5 && distToPlayer > 0.5 * this.cellM) {
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
            } else if (!unseen && distToPlayer > 0.5 * this.cellM) {
              angle = Math.atan2(dyp, dxp)
                    + (Math.random() - 0.5) * (mon.fly ? STALK_JITTER * 2 : STALK_JITTER);
            } else {
              angle = Math.random() * Math.PI * 2;
            }
          } else if (raidStep) {
            // AT THE FIELD: toward the crop it noticed, with a grazer's wander
            // in it, stopping beside the bed (the graze below reaches 1.5
            // cells) rather than trampling through to the far side.
            const rdx = raidStep.x - c.x, rdy = raidStep.y - c.y, rd = Math.hypot(rdx, rdy);
            angle = Math.atan2(rdy, rdx) + (Math.random() - 0.5) * 0.6;
            stepLen = Math.min(stepM, Math.max(0, rd - 0.5 * this.cellM));
          } else if (homeBias) {
            angle = Math.atan2(dyh, dxh) + (Math.random() - 0.5) * 0.8;
          } else {
            angle = Math.random() * Math.PI * 2;
          }
          tx = c.x + Math.cos(angle) * stepLen;
          ty = c.y + Math.sin(angle) * stepLen;
          if (c.stayHome && Math.hypot(tx - c.petHomeX, ty - c.petHomeY) > homeRadius
              && Math.hypot(tx - c.petHomeX, ty - c.petHomeY) >= Math.hypot(dxh, dyh)) continue;
          const { cellIX, cellIY } = worldMetersToAbsCell(this, tx, ty);
          if (this.placedRockSet && this.placedRockSet.has(cellKeyFromAbsCell(cellIX, cellIY))) continue;
          if (Combat.isEnemy(c) && !fireStepAllowed(this, c, tx, ty)) continue;
          const dest = this.cellAt(tx, ty);
          // A keep's garrison may cross its own floor (Lairs.inOwnKeep).
          if (dest.loaded && Combat.faunaBlocksCell(dest.type)
              && !(WorldGen.isBuildingTerrain(dest.type) && Lairs.inOwnKeep(c, tx, ty))) continue;
          // THE KERB (creature_ai.js): nothing wild steps onto a major road's
          // band, and a FAST mover (isFastMover — a foe or an animal over
          // BRISK_WALK_MPS) never steps INTO its kerb buffer from outside it — so no chase ever runs
          // along or across the carriageway. One already inside may move
          // anywhere off the band (a refused cell for it would freeze it
          // there — the stall the scarecrow note below warns about). A pet
          // and a summoned ally go where they like.
          if (!isTame && !summoned) {
            const road = roadClassBitsAt(this, tx, ty);
            if (road & WorldGen.ROAD_CLASS_MAJOR_BAND) continue;
            if ((road & WorldGen.ROAD_CLASS_MAJOR_BUFFER) && isFastMover(c, this.cellM)
                && !inKerbAt(this, c.x, c.y)) continue;
            // THE ROADSIDE RUN (creature_ai.js): a retreat never steps INTO a
            // yard (the spawn gate's BEHIND_HOUSE / PRIVATE) it is not
            // already in — it runs the street instead. The same shape as the
            // kerb buffer above: refused from outside, free once inside.
            if ((bolting || routed || kerbTurn) && !c.lair
                && yardReasonAt(this, tx, ty) && !yardReasonAt(this, c.x, c.y)) continue;
          }
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
        // Deer crop damage (the crow's own raid is in _wildCrowTick): each
        // wander step, 20% chance to eat the nearest planted crop within 1.5
        // cells that it may (_cropRaidable — never potato). Scarecrows
        // already avert the deer before this point, so no extra scarecrow
        // check needed here.
        if (beh?.raidsCrops && !isTame && this.save.planted?.length) {
          const DR2 = (1.5 * this.cellM) * (1.5 * this.cellM);
          if (Math.random() < 0.20) {
            const idx = this.save.planted.findIndex(p => {
              if (!this._cropRaidable(p)) return false;   // potato
              const ddx = p.x - c.x, ddy = p.y - c.y;
              return ddx * ddx + ddy * ddy <= DR2;
            });
            if (idx >= 0) {
              this.save.planted.splice(idx, 1);
              Crops.invalidateSpatialIndex(this.save);
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
        const pause = sprinting ? bolt.pauseMs : (gait ? gait.pauseMs : null);
        const pauseMs = pause ? pause[0] + Math.random() * pause[1] : 0;
        c._nextChooseT = now + stepMs + pauseMs;
        if (!EnemyRoster.get(c.kind)) c._faceFlip = (c._targetX - c._startX) < 0;
      }
      const u = Math.min(1, (now - c._stepT0) / (c._hopMs || STEP_MS));
      const nx = c._startX + (c._targetX - c._startX) * u;
      const ny = c._startY + (c._targetY - c._startY) * u;
      // Released enemies use the ordinary pet step lane, but keep their
      // directional art, as does any fauna whose art authors directions (the
      // horse, the turtle). NPCs and other fauna retain their existing facing.
      if (EnemyRoster.get(c.kind) || SpriteLayout.creatureArt(c.kind)?.directions) {
        SpriteLayout.updateCreatureFacing(c, nx - c.x, ny - c.y, now);
      }
      if (Combat.isEnemy(c) && !fireStepAllowed(this, c, nx, ny)) {
        c._startX = c._targetX = c.x; c._startY = c._targetY = c.y;
        c._nextChooseT = now;
        return;
      }
      c.x = nx; c.y = ny;
    });
    this._foeHeadsUp?.(interestedFoeM, now);
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

  // Per-tick movement for wild crows. Two-phase state machine:
  //   PERCH      → still for 2–4.5 s
  //   FLIGHT     → one eased glide covering ~0.4–1 cell, peaking at
  //                CROW_FLIGHT_MPS (~0.6–1.6 s; slow + short — crows used to
  //                be too fast / fly too far)
  // A crow is GAME (a feather) AND a crop raider (its row's `raidsCrops`,
  // beside the deer's — owner, Oct 2026: crows take food again, as they did
  // before Sep 2026). It CASES a field: a crop it may eat (_cropRaidable, the
  // one predicate every raider reads) within RAID_NOTICE_CELLS draws its
  // flights onto an orbit ring round it (1.5–3.5 cells); ~30% of those legs
  // are a landing attempt that may end ON the crop's cell. Landed, it must sit
  // two perch cycles there (hopping in place) before the crop is gone — the
  // player's window to scare, net or set a pet on it — and then, SATED, it
  // leaves (_crowDepart). Off water / buildings / roads, clear of a scarecrow
  // (its row `avoids` one). The hard-mode pump still dispatches only deer.
  // A crow's FULL RETREAT: it launches on this very tick (out of its perch,
  // any flight cut short) and hops straight away from the player for the
  // usual ~2.5–4 minutes (CROW_DEPART_MS), until it drifts off the sim range
  // and is simply gone. ONE departure, two forms. 'hunted' (the net's wheel
  // started on it — interact.js, the one caller now): it keeps the perch it
  // is sitting — or the glide it is on, and the landing perch that ends it —
  // and leaves on its next launch. That remaining perch is the hunt's timing
  // window (creature_ai.js CROW_DEPART_HOP has the design). 'sated' (the
  // default): off at once, out of its perch this tick — a crow that has
  // just eaten a crop (_wildCrowTick). crow_hunt_retreat.test.js pins both
  // forms.
  _crowDepart(c, now = performance.now(), reason = 'sated') {
    const [base, spread] = CROW_DEPART_MS;
    c._departUntilT = now + base + Math.random() * spread;
    if (reason === 'hunted') return;
    c._perchUntilT = now;
    c._flightUntilT = null;
  }

  _wildCrowTick(c, now, px, py) {
    // A fleeing crow (just hit by a pet) bolts away in short fast dashes,
    // reusing the SAME FLIGHT-phase fields (_flightUntilT / _startX,Y /
    // _targetX,Y / _flightT0) that a normal glide uses — so the dash gets the
    // existing eased-interpolation code below for free instead of a second
    // position-update path.
    //   This used to just `return` here for the whole 8s flee window — the
    // comment said "skips crop logic and runs" but nothing ran: c.x/c.y are
    // ONLY ever written inside this function, so returning before touching
    // them froze the crow in place while a cat/dog kept landing hits on a
    // stationary target. See CLAUDE.md FINDING 1 / test/node/crow_flee.test.js.
    const fleeing = c._fleeUntilT && c._fleeUntilT > now;
    if (fleeing) {
      // A crow being mauled doesn't finish casing the crop first — abandon
      // any in-progress landing so recovering later starts clean.
      c._destroyCropRef = null;
      c._destroyCyclesLeft = 0;
      // _fleeDash marks a flight leg as ITS OWN panic dash (vs. a normal
      // glide that was already in flight the instant the hit landed).
      // Without that distinction the check below would happily keep gliding
      // the crow ALONG ITS OLD PRE-HIT COURSE for up to a full 1200ms glide
      // before the flee ever took effect, unlike every other kind's flee
      // override (:6249), which reacts on the very next tick.
      if (c._flightUntilT && now < c._flightUntilT && c._fleeDash) {
        const dur = c._flightUntilT - c._flightT0;
        const t = Math.min(1, (now - c._flightT0) / dur);
        const u = creatureFlightEase(t);
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
          // Twice its distance over the crow's peak flight speed
          // (CROW_FLIGHT_MPS — a quadratic leg peaks at twice its mean): the
          // panic is in the short legs and the turn, not a faster bird (it
          // used to cross two cells in 350 ms: 40 m/s).
          c._flightUntilT = now + (2 * d / CROW_FLIGHT_MPS) * 1000 / Combat.shinySpeedMul(c);
          c._fleeDash = true;
          c._faceFlip = (ftx - c.x) < 0;
          break;
        }
      }
      // All 4 attempts blocked (e.g. cornered by water/buildings): stand
      // still this tick and retry next tick rather than phasing into a bad
      // cell — same policy the flight target search uses below.
      return;
    }
    const raids = !!SpriteLayout.creatureBehaviour(c.kind)?.raidsCrops;
    const departing = c._departUntilT && now < c._departUntilT;
    // (0) The crop it sat on is gone (harvested, eaten by another raider) or
    // the crow is leaving: drop the count.
    if (c._destroyCropRef && (departing || !this.save.planted?.includes(c._destroyCropRef))) {
      c._destroyCropRef = null;
      c._destroyCyclesLeft = 0;
    }
    // (1) Initialise rhythm on first encounter.
    if (c._perchUntilT == null && c._flightUntilT == null) {
      c._perchUntilT = now + 1500 + Math.random() * 2500;
    }
    // (2) FLIGHT phase — interpolate with ease-in/out toward target.
    if (c._flightUntilT && now < c._flightUntilT) {
      const dur = c._flightUntilT - c._flightT0;
      const t = Math.min(1, (now - c._flightT0) / dur);
      const u = creatureFlightEase(t);
      c.x = c._startX + (c._targetX - c._startX) * u;
      c.y = c._startY + (c._targetY - c._startY) * u;
      return;
    }
    // (3) FLIGHT completion — snap to final and start a new perch. Landed
    // ON a crop it may eat (within half a cell): the first landing starts a
    // two-cycle count, each landing on the SAME crop spends one, and when it
    // is spent the crop is eaten and the crow, sated, leaves. A landing
    // anywhere else drops the count.
    if (c._flightUntilT && now >= c._flightUntilT) {
      c.x = c._targetX;
      c.y = c._targetY;
      c._flightUntilT = null;
      c._perchUntilT = now + 2000 + Math.random() * 2500;
      c._faceFlip = (c._targetX - c._startX) < 0;
      if (raids && !departing && this.save.planted?.length) {
        const NEAR = 0.5 * this.cellM;
        let landedOn = null;
        Crops.forEachInBox(this.save, this.depth || 0, c.x - NEAR, c.y - NEAR, c.x + NEAR, c.y + NEAR, (p) => {
          if (landedOn || !this._cropRaidable(p)) return;
          const ddx = p.x - c.x, ddy = p.y - c.y;
          if (ddx * ddx + ddy * ddy <= NEAR * NEAR) landedOn = p;
        });
        if (!landedOn) {
          c._destroyCropRef = null;
          c._destroyCyclesLeft = 0;
        } else {
          if (c._destroyCropRef === landedOn) c._destroyCyclesLeft = (c._destroyCyclesLeft || 1) - 1;
          else { c._destroyCropRef = landedOn; c._destroyCyclesLeft = CROW_RAID_PERCHES; }
          if (c._destroyCyclesLeft <= 0) {
            const idx = this.save.planted.indexOf(landedOn);
            if (idx >= 0) {
              this.save.planted.splice(idx, 1);
              Crops.invalidateSpatialIndex(this.save);
              this.flash?.('🐦 crop eaten!', this.viewCenterX, this.viewCenterY - 60);
            }
            c._destroyCropRef = null;
            c._destroyCyclesLeft = 0;
            this._crowDepart(c, now);
          }
        }
      }
      return;
    }
    // (4) PERCH phase — sit still until the timer expires.
    if (c._perchUntilT && now < c._perchUntilT) return;

    // (5) Time to launch a new flight burst. Pick a target with up to
    // 6 attempts so we can reject water / buildings / scarecrow rings.
    let tx = c.x, ty = c.y, chosen = false;
    // A departing crow (hunted, or sated after a meal) — fly steadily away
    // from the player until the few-minute timer lapses (it freezes once it
    // drifts off the sim range, so it simply stays gone). A hunted crow's
    // first departing launch is the one the hunt's wheel races
    // (CROW_DEPART_HOP).
    //   Not leaving: a crow mid-count keeps hopping ON its crop; otherwise
    // the nearest crop it may eat within RAID_NOTICE_CELLS (the crop spatial
    // index, one bucket walk) is the field it cases.
    const committed = !departing && c._destroyCropRef && c._destroyCyclesLeft > 0;
    let casing = null;
    if (raids && !departing && !committed && this.save.planted?.length) {
      const R = RAID_NOTICE_CELLS * this.cellM;
      let bestD2 = R * R;
      Crops.forEachInBox(this.save, this.depth || 0, c.x - R, c.y - R, c.x + R, c.y + R, (p) => {
        if (!this._cropRaidable(p)) return;
        const ddx = p.x - c.x, ddy = p.y - c.y, d2 = ddx * ddx + ddy * ddy;
        if (d2 < bestD2) { bestD2 = d2; casing = p; }
      });
    }
    for (let attempt = 0; attempt < 6 && !chosen; attempt++) {
      if (departing) {
        // Long outbound hop directly away from the player, with a little
        // jitter — CROW_DEPART_HOP's cells, past the approach cap below: a
        // retreat is not an approach, and the hop must clear the reach.
        const away = Math.atan2(c.y - py, c.x - px) + (Math.random() - 0.5) * 0.6;
        const d = CROW_DEPART_HOP.cells * this.cellM;
        tx = c.x + Math.cos(away) * d;
        ty = c.y + Math.sin(away) * d;
      } else if (committed) {
        // Mid-count — hop in place ON the crop, so each landing spends a cycle.
        const ang = Math.random() * Math.PI * 2;
        const r = Math.random() * 0.3 * this.cellM;
        tx = c._destroyCropRef.x + Math.cos(ang) * r;
        ty = c._destroyCropRef.y + Math.sin(ang) * r;
      } else if (casing) {
        // ORBIT the field: a point on the 1.5–3.5-cell ring round the crop,
        // or (~30%) a landing attempt that may end on its cell. The approach
        // cap below makes a far crow arrive over several hops.
        const radius = Math.random() < 0.30
          ? Math.random() * 0.4 * this.cellM
          : (1.5 + Math.random() * 2.0) * this.cellM;
        const ang = Math.random() * Math.PI * 2;
        tx = casing.x + Math.cos(ang) * radius;
        ty = casing.y + Math.sin(ang) * radius;
      } else {
        // Random roam, short hops of 0.4–1 cell. Short on purpose: a glide
        // lasts its distance over CROW_FLIGHT_MPS (below), and the HUNT's
        // odds (crow_hunt_odds.test.js) ride on how much of a crow's rhythm
        // is perch — a tapped crow flies its glide out and sits a full perch
        // before it leaves — so a longer hop is a longer glide and a T1 net
        // that never loses. These hops keep a glide near the second the odds
        // were tuned on (1–2.5-cell hops at the old 800–1200 ms).
        const a = Math.random() * Math.PI * 2;
        const d = (0.4 + Math.random() * 0.6) * this.cellM;
        tx = c.x + Math.cos(a) * d;
        ty = c.y + Math.sin(a) * d;
      }
      // Cap any single flight leg to ~2.5 cells — the approach cap (a crow
      // APPROACHES a crop over several hops; the roam is already under it). Not the retreat: a retreat is not an approach, and its hop must
      // clear the reach (CROW_DEPART_HOP).
      const MAX_LEG = 2.5 * this.cellM;
      const legDX = tx - c.x, legDY = ty - c.y;
      const legD = Math.hypot(legDX, legDY);
      if (!departing && legD > MAX_LEG) {
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
    // A glide lasts twice its distance over the crow's peak flight speed
    // (CROW_FLIGHT_MPS — a quadratic leg peaks at twice its mean: ~0.6–1.6 s
    // over the roam's 0.4–1-cell hops); a departing leg takes its row's own time
    // — the pace the hunt's odds are tuned on, the one declared exception to
    // the speed ceiling (CROW_DEPART_HOP has the reasoning).
    c._flightUntilT = now + (departing ? CROW_DEPART_HOP.ms : (2 * Math.hypot(tx - c.x, ty - c.y) / CROW_FLIGHT_MPS) * 1000) / Combat.shinySpeedMul(c);
    c._perchUntilT = null;
    c._faceFlip = (tx - c.x) < 0;
    // This is a normal glide, not a flee dash — clear the marker so a FUTURE
    // hit mid-glide doesn't mistake this leg for an in-progress dash and
    // wrongly keep flying it out before reacting (see the fleeing branch
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
