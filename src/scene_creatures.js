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
// Plus the constants only they read: FIRE_WARD_MAX_DEPTH, BEACH_X_PER_CELLS.
//
// The methods live on `class SceneCreatures`, a MIXIN: app.js installs them onto MapScene.prototype right after the class
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

// FIRE WARD DEPTH CAP: a campfire only turns away the WEAKEST foes — the
// rows introduced at the first cave level (enemy_roster.js `cave.minDepth`;
// creature_ai.js fireAverse — a cave DEPTH, never the power tier: a purple
// slime is tier 1 but a depth-3 kind), the surface slime it already deters
// among them. A goblin (minDepth 3) or its archer — and their giants, at
// their own roster depths — are past what a lit campfire can plausibly hold
// off; only Home's stronger ward (HOME_R, surface only) turns those around.
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
// THE LOW-TIER QUOTA'S X MARKS: a tile short of WorldGen.LOW_TIER_CHEST_QUOTA
// tier-1 chests (entry.lowTierDeficit, topUpAmbientCratesSteps) also lays
// extra X marks — X_TOP_UP_MAX on a tile with none, in proportion to its
// shortfall. Cells are drawn off WorldGen.cellHash (never the tile's rng
// stream, so no later draw moves), up to X_TOP_UP_TRIES per mark.
const X_TOP_UP_MAX = 24;
const X_TOP_UP_TRIES = 8;
// How far (cells, Chebyshev) from a street lair's point OPEN ground may lie
// for the lair to stand (spawnInTile's attractor test): a gate's point is on
// its own way, so the verge beside it is what answers.
const LAIR_POINT_SLACK_CELLS = 1;

class SceneCreatures {
  _raiseBoneCacheSkeleton(o) {
    const id = `bone-skeleton:${o.id}`;
    if ((this.save.caught || []).includes(id)) return;
    const tx = Math.floor(o.x / this.tileEdgeM), ty = Math.floor(o.y / this.tileEdgeM);
    const entry = WorldGen.tileCache.get(WorldGen.tileKey(tx, ty));
    if (!entry?.creatures || entry.creatures.some(c => c.id === id)) return;
    entry.creatures.push(EnemySpawns.markShared(WorldGen.makeCreature('skeleton', o.x, o.y, id,
      { depth: o.depth, shiny: false, _hunting: true })));
  }

  _revealMimic(o) {
    if (this.depth > 0 || !(this.tileEdgeM > 0)) return false;
    const tx = Math.floor(o.x / this.tileEdgeM), ty = Math.floor(o.y / this.tileEdgeM);
    const entry = WorldGen.tileCache.get(WorldGen.tileKey(tx, ty));
    if (!entry?.creatures) return false;
    const id = 'mimic:' + o.id;
    const revealed = (this.save.revealedMimics ||= []);
    if (!revealed.some(c => c.id === id)) revealed.push({ id, chestId: o.id, x: o.x, y: o.y });
    if (!entry.creatures.some(c => c.id === id)) {
      entry.creatures.push(EnemySpawns.markShared(WorldGen.makeCreature('mimic', o.x, o.y, id, {
        depth: 0, shiny: false, _hunting: true,
      })));
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
      entry.creatures.push(EnemySpawns.markShared(WorldGen.makeCreature('mimic', c.x, c.y, c.id, {
        depth: 0, shiny: false, _hunting: true,
      })));
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
    const stats = {};
    const endSpawn = window.__boot?.begin(`tile ${key} spawn`);
    const pass = WorldGen.runStepsSliced(() => this.spawnInTileSteps(entry, tx, ty), { abort: gone, stats })
      .then((r) => r !== WorldGen.STEPS_ABORTED && !!entry._spawned)
      .finally(() => {
        endSpawn?.(`${stats.slices || 0} slices, worst block ${Math.round(stats.worstMs || 0)}ms in ${stats.worstAt || 'not started'}`);
        if (entry._spawnPass === pass) entry._spawnPass = null;
      });
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
    // Keep generated enemy provenance before applying the defeat ledger.
    // Temples distinguish a cleared park from one that never had enemies,
    // including after reload when defeated creatures no longer have bodies.
    const templeEnemySites = [];
    const rememberTempleEnemy = c => {
      if (Combat.isEnemyKind(c.kind) && !c._surfaceInactive)
        templeEnemySites.push({ id: c.id, kind: c.kind, x: c.x, y: c.y });
    };
    entry.templeEnemySites = templeEnemySites;
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
    // HABITAT SITES (enemy_habitats.js habitatLairs — a wetland's hungry
    // marsh, an outcrop's orc stronghold) are lair candidates too, pushed
    // onto entry.streetLairs here so the filter below judges them like every
    // other lair point.
    EnemyHabitats.habitatLairs(entry, tx, ty);
    if (entry.streetLairs.length) {
      const lairOpts = WorldGen.spawnOptsOf(entry);
      entry.streetLairs = entry.streetLairs.filter((L) => {
        const ix = Math.floor(L.lx / cellM), iy = Math.floor(L.ly / cellM);
        return !!WorldGen.relocateToSpawnCell(genGrid, N, N, ix, iy, lairOpts, LAIR_POINT_SLACK_CELLS, 'attractor');
      });
    }
    // Home holds no slimes or crows until the first harvest (see
    // PEST_FREE_CELLS). Resolved once per tile build; null once the grace has
    // lapsed, which is the common case.
    const pestFree = this._pestFreeZone(tx, ty);
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
    const faunaSpawnOpts = { ..._spawnOpts, occupied: null };
    const legacyEnemies = yield* this._replayLegacyCreatureDraws(entry, tx, ty, N, cellM, genGrid, _spawnOpts, rng);
    const guardCells = WorldGen.occupiedIndexSet(WorldGen.tileFrame(entry, tx, ty, this.tileEdgeM), zoneGuards);
    entry._spawnOpts = _spawnOpts;
    MushroomGas.prepare(entry, tx, ty);
    const population = yield* HabitatSpawns.populationSteps(this, entry, tx, ty,
      { N, cellM, grid: genGrid, spawnOpts: _spawnOpts, guardCells, legacyEnemies, authoredCreatures: zoneGuards });
    for (const creature of population) {
      if (creature._surfaceSpawn) {
        // The shared elite roll (EnemySpawns.rollsElite) keeps the stair-clear
        // rule and survives reloads off the stable id, on ground and caves alike.
        creature.shiny = EnemySpawns.rollsElite(entry, creature.kind, creature.id, creature.x, creature.y, cellM);
      }
      EnemySpawns.surfaceActive(this, creature);
      rememberTempleEnemy(creature);
      if (!this._habitatPopulationVisible(creature, caughtSet, pestFree)) continue;
      creatures.push(creature);
    }
    yield 'spawn habitat populations';
    // Themed roamers have their own small-group budget. Reserve all generated
    // seats before filtering defeats, so caught enemies never reroll a group.
    const themedOccupied = new Set(_occupiedIdx);
    const themedEnemies = yield* EnemyHabitats.surfaceEncountersSteps(entry, tx, ty, themedOccupied);
    for (const c of themedEnemies) {
      const at = c._surfaceSpawn;
      _spawnOpts.occupied.add(at.cy * N + at.cx);
      _spawnOpts.creatureCells?.add(at.cy * N + at.cx);
      EnemySpawns.surfaceActive(this, c);
      rememberTempleEnemy(c);
      if (caughtSet.has(c.id)) continue;
      creatures.push(c);
    }
    // Zone guards already have an authored species and seat. Append after
    // attraction and surface-roster replacement so neither can move or turn
    // them into an unrelated enemy. Their kills use the usual caught ledger.
    for (const guard of zoneGuards) {
      const fauna = ['fauna', 'fastFauna'].includes(creatureSpawnClass(guard.kind))
        || (!Combat.isEnemyKind(guard.kind) && ITEM_BY_ID[guard.kind]?.kind === 'animal');
      const creature = WorldGen.makeCreature(guard.kind, guard.x, guard.y, guard.id, {
        ...guard, ...(guard.zone === 'grove' ? EnemySpawns.concealment(guard.kind, guard.id, guard.zoneVariant) : {}),
        shiny: fauna ? faunaShiny(guard.kind, guard.id) : false, immobile: !fauna && !guard.burrowCells,
        ...(guard.kind === 'wurm' ? { _burrowed: true } : {}),
        lair: fauna || guard.burrowCells ? null : (guard.lair || guard.id),
        lairX: guard.homeX ?? guard.x, lairY: guard.homeY ?? guard.y,
        lairR: 0, seatX: guard.x, seatY: guard.y,
      });
      if (creature._surfaceSpawn) EnemySpawns.surfaceActive(this, creature);
      rememberTempleEnemy(creature);
      if (caughtSet.has(guard.id)) continue;
      creatures.push(creature);
    }
    // Everything drawn above is the world's (EnemySpawns.isSharedId); the
    // player's own pets and saved animals below are not.
    for (const c of creatures) EnemySpawns.markShared(c);
    // (Starter-cow at spawn removed — cows are valuable enough that none should be gifted.)
    // Owned and individually saved wild animals retain their state across tile rebuilds.
    for (const r of [...Pets.list(this.save), ...(this.save.wildAnimals || [])]) {
      if (r.carried || r.tx !== tx || r.ty !== ty || (!r.pet && caughtSet.has(r.id))) continue;
      creatures.push(WorldGen.makeCreature(r.kind,r.x,r.y,r.id,{
        ...r, _hp:r.hp, _lastDamagedT:r.lastDamagedAt ?? null,
      }));
    }
    for (const c of creatures) {
      if (Pets.eligible(c.kind)) c.tint = Pets.tintFor(c);
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
    for (const c of creatures) c._discovered = !HiddenObjects.isHidden(this.save, c);
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
    NPC.houseNeighbours(this, { offscreen: NPC.offscreenAt(this) });
    NPC.arrivals(this, entry, tx, ty);

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
        const { x: wmx, y: wmy } = tileCellCentre(this.tileEdgeM, tx, ty, cellM, cx, cy);
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
        const { x: wmx, y: wmy } = tileCellCentre(this.tileEdgeM, tx, ty, cellM, cx, cy);
        entry.extraTreasures.push({ x: wmx, y: wmy, id: WorldGen.cellId('treasure_x', tx, ty, cx, cy) });
        placed = true;
      }
    }

    // The low-tier quota's X marks (X_TOP_UP_MAX), skipped in test mode for
    // the same reason as the scatter above.
    const xTopUp = testMode ? 0 : Math.ceil(X_TOP_UP_MAX
      * Math.min(1, (entry.lowTierDeficit || 0) / WorldGen.LOW_TIER_CHEST_QUOTA));
    for (let k = 0, laid = 0; laid < xTopUp && k < xTopUp * X_TOP_UP_TRIES; k++) {
      const i = (WorldGen.cellHash(tx, ty, k, 0x7a0b) >>> 0) % (N * N);
      const cx = i % N, cy = (i - cx) / N;
      if (!WorldGen.isSpawnCell(genGrid, N, N, cx, cy, ambientSpawnOpts, 'minor')) continue;
      const id = WorldGen.cellId('treasure_quota', tx, ty, cx, cy);
      if (entry.extraTreasures.some(t => t.id === id)) continue;
      const { x: wmx, y: wmy } = tileCellCentre(this.tileEdgeM, tx, ty, cellM, cx, cy);
      entry.extraTreasures.push({ x: wmx, y: wmy, id });
      laid++;
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
    // Cells are packed as their grid INDEX (cy * N + cx); cellsPerEdge can exceed 256,
    // so a cx*256+cy packing would decode wrong.
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
          const { x: wmx, y: wmy } = tileCellCentre(this.tileEdgeM, tx, ty, cellM, ncx, ncy);
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
          const { x: wmx, y: wmy } = tileCellCentre(this.tileEdgeM, tx, ty, cellM, scx, scy);
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
        entry.extraTreasures.push({ ...tileCellCentre(this.tileEdgeM, tx, ty, cellM, scx, scy), id });
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
              { species: ft.species === 'worldpeach' ? 'worldpeach' : 'apple',
                planted: true, planted_t: ft.planted_t }));
        savedPlantings.push(entry.objects[entry.objects.length - 1]);
      }
    }
    // Saved plantings win against generated static scenery after shared RNG draws.
    if (savedPlantings.length) SpawnOwnership.reconcileEntry(this, entry, savedPlantings);
    PlacedFloor.restoreBarricades(this, entry, tx, ty, 0);
    // THE SHORE'S OWN FAUNA (biome_profiles.js SHORE_FAUNA): crabs on the
    // shore sand, gulls on the shore and the piers (the
    // shore and pier cells come out of the bonus-X block's one grid pass). Each species on its OWN
    // stream (its `salt`), so no other draw moves; its count follows the
    // waterline; each seat uses the shared gate and its creature class.
    // IDs come from raw shore draws, before safety relocates eligible seats.
    this.spawnShoreFauna(creatures, shore, pierCells, N, tx, ty, cellM, genGrid,
      faunaSpawnOpts, _spawnOpts, caughtSet, entry.zone && (entry.zone.coverage || entry.zone.idx), entry, zoneGuards);


    // The per-player cull, AFTER every draw of the shared stream above.
    this._cullOffLiveGround(entry, tx, ty, N, cellM, genGrid, genObjects, creatures);
    EnemySpawns.refreshHomeFauna(this);
  }

  // Keep unrelated tile RNG and existing enemy-defeat aliases stable while
  // replacing the historical fauna pass. This replay emits no live creatures.
  *_replayLegacyCreatureDraws(entry, tx, ty, N, cellM, grid, spawnOpts, rng) {
    const aliases = [], faunaOpts = { ...spawnOpts, occupied: null };
    for (const kind of FAUNA_ORDER) {
      const row = BIOME_FAUNA[kind];
      if (!row) continue;
      const count = row.base + (row.range ? Math.floor(rng() * row.range) : 0);
      const primaryCount = Math.round(count * (row.share ?? .8));
      const enemyTerrain = kind === 'slime' ? LEGACY_ENEMY_TERRAINS : null;
      const primary = new Set(enemyTerrain || row.primary), fallback = new Set(enemyTerrain || row.fallback || row.primary);
      const spClass = creatureSpawnClass(kind);
      const opts = spClass === 'fauna' || spClass === 'fastFauna' ? faunaOpts : spawnOpts;
      for (let n = 0; n < count; n++) {
        const ground = n < primaryCount ? primary : fallback;
        for (let attempt = 0; attempt < 12; attempt++) {
          const cx = Math.floor(rng() * N), cy = Math.floor(rng() * N), index = cy * N + cx;
          if (!ground.has(grid[index]) || !BiomeProfiles.faunaAllows(kind, grid[index])) continue;
          if (!WorldGen.isSpawnCell(grid, N, N, cx, cy, opts, 'minor')) continue;
          if ((entry.zone?.coverage || entry.zone?.idx)?.[index]) break;
          if (!WorldGen.isSpawnCell(grid, N, N, cx, cy, opts, spClass)) break;
          if (kind === 'slime') aliases.push({ id: EnemySpawns.surfaceId(tx, ty, cx, cy), key: HabitatSpawns.resolve(entry, index).key });
          break;
        }
      }
      yield 'spawn compatibility draws';
    }
    return aliases;
  }

  _habitatPopulationVisible(creature, caughtSet, pestFree) {
    if (caughtSet.has(creature.id) || creature._legacyDefeatIds?.some(id => caughtSet.has(id))) return false;
    const kindStr = creature.kind, at = creature._habitatSpawn;
    if ((kindStr === 'crow' || kindStr === 'raven') && pestFree && pestFree.has(at.cx, at.cy)) return false;
    return kindStr !== 'crow' || EnemySpawns.roll(creature.id + ':mode') < Difficulty.get().crowCountMul;
  }

  // THE SHORE FAUNA pass (see the call in spawnInTile). Pure in the tile:
  // the shore (entry.scenic.shore — generated) and the pier cells (the
  // generated grid) decide it; nothing per-player. Returns what it seated.
  //   count   floor((waterline m + pier m) / perShoreM), capped at `max` —
  //           in GENERATION metres (WorldGen.CELL_M per cell), never the
  //           save's frame (CLAUDE.md "Every player sees the SAME world")
  //   seats   exhaust legal shore cells inside the same owner; safety
  //           changes seats, not population budgets or species identities.
  //   ids     raw canonical cell draws (ordinary) or stable owner ordinals
  //           (Nexus), reserved before saved captures are filtered.
  spawnShoreFauna(creatures, shore, pierCells, N, tx, ty, cellM, genGrid, faunaOpts, foeOpts, caughtSet, zoneCoverage, habitatEntry = null, authoredCreatures = []) {
    const out = [];
    if (typeof SHORE_FAUNA === 'undefined') return out;
    const allShore = shore?.cells || [], groups = new Map();
    const reserved = foeOpts.creatureCells || new Set();
    for (const c of [...creatures, ...authoredCreatures]) {
      const cx = Math.floor((c.x - tx * this.tileEdgeM) / cellM), cy = Math.floor((c.y - ty * this.tileEdgeM) / cellM);
      if (cx >= 0 && cy >= 0 && cx < N && cy < N) reserved.add(cy * N + cx);
    }

    const getGroup = i => {
      const owner = habitatEntry ? HabitatSpawns.resolve(habitatEntry, i) : null;
      const areaOwner = habitatEntry ? WorldGen.variantOwnerAt(habitatEntry, i) : null;
      if ((areaOwner || zoneCoverage?.[i]) && !(owner?.profile?.owner === 'zone' && owner.profile.shoreFauna)) return null;
      // Road variants and unrelated Nexus variants own their empty shore too.
      if (owner?.profile?.owner === 'road' || (owner?.profile?.owner === 'zone' && !owner.profile.shoreFauna)) return null;
      const key = owner?.profile?.owner === 'zone' ? owner.key : 'shore:ordinary';
      if (!groups.has(key)) groups.set(key, { key, owner, shore: [], pier: [] });
      return groups.get(key);
    };
    for (const i of allShore) getGroup(i)?.shore.push(i);
    for (const i of pierCells) getGroup(i)?.pier.push(i);
    const rawWaterline = shore?.waterline;
    const diagnostics = [];
    for (const group of [...groups.values()].sort((a, b) => a.key.localeCompare(b.key))) {
      const native = group.owner?.profile?.owner === 'zone';
      const kinds = native ? group.owner.profile.shoreFauna.map(row => row.kind) : SHORE_FAUNA_ORDER;
      const ground = new Set(group.shore);
      const shoreM = rawWaterline ? rawWaterline.filter(i => ground.has(i)).length * WorldGen.CELL_M
        : (shore?.shoreM || 0) * group.shore.length / Math.max(1, allShore.length);
      for (const kind of kinds) {
        const row = SHORE_FAUNA[kind];
        if (!row) continue;
        const rawPool = row.pier ? group.shore.concat(group.pier) : group.shore;
        if (!rawPool.length) continue;
        const lenM = shoreM + (row.pier ? group.pier.length * WorldGen.CELL_M : 0);
        const requested = Math.max(0, Math.min(row.max, Math.floor(lenM / row.perShoreM)));
        const authored = native ? authoredCreatures.filter(c => {
          if (c.kind !== kind) return false;
          const cx = Math.floor((c.x - tx * this.tileEdgeM) / cellM), cy = Math.floor((c.y - ty * this.tileEdgeM) / cellM);
          return HabitatSpawns.resolve(habitatEntry, cy * N + cx).key === group.key;
        }).length : 0;
        const want = Math.max(0, requested - authored);
        const spClass = creatureSpawnClass(kind);
        const fauna = spClass === 'fauna' || spClass === 'fastFauna';
        const opts = fauna ? faunaOpts : foeOpts;
        const canonicalPool = rawPool.filter(i => HabitatSpawns.allows(kind, genGrid[i], group.owner?.profile));
        const pool = canonicalPool.filter(i => {
          const cx = i % N, cy = Math.floor(i / N);
          return WorldGen.isSpawnCell(genGrid, N, N, cx, cy, opts, spClass);
        });
        const srng = WorldGen.makeRng(fnv1a(`${row.salt}|${tx},${ty}${native ? '|' + group.key : ''}`));
        const taken = new Set();
        let placed = 0;
        for (let n = 0; n < want && taken.size < canonicalPool.length; n++) {
          const start = Math.floor(srng() * canonicalPool.length);
          let canonical = null;
          for (let at = 0; at < canonicalPool.length; at++) {
            const candidate = canonicalPool[(start + at) % canonicalPool.length];
            if (!taken.has(candidate)) { canonical = candidate; break; }
          }
          if (canonical == null) break;
          taken.add(canonical);
          // Identity uses this species' own draw. Other inhabitants can move
          // its seat within the same shore owner without changing that ID.
          const canonicalX = canonical % N, canonicalY = Math.floor(canonical / N);
          const id = native ? `shore_habitat_${kind}_${tx}_${ty}_${encodeURIComponent(group.key)}_${n}` : WorldGen.cellId(kind, tx, ty, canonicalX, canonicalY);
          let cell = null;
          const canonicalSeat = pool.indexOf(canonical);
          const seatStart = canonicalSeat >= 0 ? canonicalSeat : Math.floor(EnemySpawns.roll(id + ':seat') * pool.length);
          for (let at = 0; at < pool.length; at++) {
            const candidate = pool[(seatStart + at) % pool.length];
            if (!reserved.has(candidate)) { cell = candidate; break; }
          }
          if (cell == null) continue;
          reserved.add(cell); placed++;
          const cx = cell % N, cy = Math.floor(cell / N);
          const seat = tileCellCentre(this.tileEdgeM, tx, ty, cellM, cx, cy);
          const point = { key: native ? group.key : `land:${genGrid[cell]}:shore`, profile: group.owner?.profile?.id || 'shore', tx, ty, cx, cy, sourceCx: canonicalX, sourceCy: canonicalY, ...seat };
          const c = WorldGen.makeCreature(kind, seat.x, seat.y, id, {
            shiny: fauna || ITEM_BY_ID[kind]?.kind === 'animal' ? faunaShiny(kind, id) : false,
            _habitatSpawn: point, ...(native ? { zoneVariant: group.owner.profile.id } : {}),
          });
          EnemySpawns.surfaceActive(this, c);
          if (caughtSet.has(id)) continue;
          creatures.push(c); out.push(c);
        }
        diagnostics.push({ key: group.key, kind, requested, authored, placed, shortfall: Math.max(0, want - placed) });
      }
    }
    if (habitatEntry) habitatEntry.shorePopulation = diagnostics;
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
      const waterOnly = EnemyRoster.get(t.kind)?.movement.waterOnly;
      return repainted && grid[i] !== genGrid[i]
        && (waterOnly ? grid[i] !== WorldGen.T.WATER : !WorldGen.isWalkable(grid[i]));
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
    const { x: px, y: py } = playerWorldM(this);
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
    PlacedFloor.restoreBarricades(this, entry, tx, ty, depth);
    const rng = WorldGen.makeRng((tx * 0x2c1b3a5f ^ ty * 0x9e3779b1 ^ depth * 0x85ebca77) >>> 0);
    const N = entry.cellsPerEdge;
    const creatures = [];
    // Memoised Set, not an Array.includes: called up to ~3500 times per tile build.
    const caughtSet = setOf(this.save.caught);
    const eligible = EnemySpawns.caveRows(depth);
    const legacyDefeats = EnemySpawns.legacyCaveDefeats(caughtSet, depth, tx, ty);
    const monsterSeats = new Set();
    if (!eligible.length) { entry._spawned = true; entry.creatures = entry.creatures || creatures; return; }
    // Anchor spawns near the up-staircases so monsters are visible rather than
    // scattered across the tile. A level has an up-stair at EVERY surface entrance,
    // so anchor around ALL of them. Falls back to the tile centre when none exists.
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
    for (let i = 0; i < (entry.spawnWhy?.length || 0); i++) {
      if (entry.spawnWhy[i] & WorldGen.SPAWN_WHY_ALL_FLOORS) occupiedIdx.add(i);
    }
    for (const o of [...genObjects, ...genWildplants]) {
      const ox = Math.floor((o.x - tx * entry.tileEdgeM) / cellSizeM);
      const oy = Math.floor((o.y - ty * entry.tileEdgeM) / cellSizeM);
      if (ox >= 0 && oy >= 0 && ox < N && oy < N) occupiedIdx.add(oy * N + ox);
    }
    const authoredBlocked = new Set(occupiedIdx);
    for (const i of entry.undergroundReserved || []) occupiedIdx.add(i);
    for (const resident of entry.undergroundResidents || []) {
      const { x, y, id, culture, dwarf } = resident;
      const identity = NPC.identity(id, culture);
      creatures.push(WorldGen.makeCreature('npc', x, y, id, {
        ...identity, depth, homeX: x, homeY: y,
        ...(dwarf ? { name: 'Dwarf ' + identity.name, role: 'merchant', roleLabel: 'Dwarven Smith', shopTheme: 'supply', artScale: 0.8 } : {}),
      }));
    }
    // Cave spawners share this generated occupancy because terrain alone
    // cannot reveal a rock, mushroom or floor torch seated on its floor cell.
    entry._spawnOpts = { roadMask: null, spawnWhy: entry.spawnWhy, occupied: occupiedIdx, pois: [] };
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
    // Finite region seats are authored before the ambient passes. Their
    // reservations survive defeat; caught IDs never free ground for a reroll.
    for (const seat of entry.caveAreas?.encounters || []) {
      if (seat.depth !== depth || monsterSeats.has(seat.id)) continue;
      const cx = Math.floor((seat.x - tx * entry.tileEdgeM) / cellSizeM);
      const cy = Math.floor((seat.y - ty * entry.tileEdgeM) / cellSizeM);
      const idx = cy * N + cx;
      if (cx < 0 || cy < 0 || cx >= N || cy >= N || genGrid[idx] !== 24
          || authoredBlocked.has(idx)) continue;
      occupiedIdx.add(idx);
      monsterSeats.add(seat.id);
      if (caughtSet.has(seat.id) || heldByPlayer.has(idx)) continue;
      creatures.push(WorldGen.makeCreature(seat.kind, seat.x, seat.y, seat.id, {
        depth, shiny: false, caveArea: seat.caveArea,
        hidden: !!seat.hidden, dormant: !!seat.dormant,
        revealDistanceCells: seat.revealDistanceCells,
      }));
    }
    // A roost owns one fixed dragon seat even after defeat. Reserve before
    // ordinary pools so losing the dragon cannot regenerate another enemy.
    for (const dragon of EnemyHabitats.caveSites(entry, tx, ty, depth, occupiedIdx)) {
      const cx = Math.floor((dragon.x - tx * this.tileEdgeM) / cellSizeM);
      const cy = Math.floor((dragon.y - ty * this.tileEdgeM) / cellSizeM);
      if (!caughtSet.has(dragon.id) && !heldByPlayer.has(cy * N + cx)) creatures.push(dragon);
    }
    const SPAWN_R = 25; // cells — fills 2–3 screens worth around each entry point
    const randCell = (draw = rng) => {
      const a = anchors[Math.floor(draw() * anchors.length)];
      return {
        cx: a.lix + Math.round((draw() - 0.5) * 2 * SPAWN_R),
        cy: a.liy + Math.round((draw() - 0.5) * 2 * SPAWN_R),
      };
    };
    // TOTAL population is fixed regardless of how many up-staircases the tile has:
    // anchors.length only widens WHERE spawns land. The 160 cap is a safety net
    // at today's depths.
    // Both modes share this population; Hard applies only at the recipient.
    const count = Math.min(160, Math.round((50 + depth * 10) * Difficulty.get().monsterCountMul));
    // Safety and generated occupancy remove seats without reducing these
    // budgets. Keep ordinary random draws first; exhausted searches use all
    // legal ground inside the same geographic cave pocket. Generated seats
    // are reserved before saved defeats/live edits filter the visible bodies.
    let creatureCells = new Set(occupiedIdx), canonicalPass = false;
    const canonicalAliases = new Map(), aliasOwners = new Map();
    // Compatibility identities use a parallel population on raw floor. Safety
    // holes change actual seats, never which old defeat belongs to a request.
    const canonicalOccupied = new Set([...occupiedIdx].filter(i =>
      !(entry.spawnWhy?.[i] & WorldGen.SPAWN_WHY_ALL_FLOORS)));
    for (const o of [...genObjects, ...genWildplants]) {
      const cx = Math.floor((o.x - tx * entry.tileEdgeM) / cellSizeM);
      const cy = Math.floor((o.y - ty * entry.tileEdgeM) / cellSizeM);
      if (cx >= 0 && cy >= 0 && cx < N && cy < N) canonicalOccupied.add(cy * N + cx);
    }
    for (const i of entry.undergroundReserved || []) canonicalOccupied.add(i);
    const caveContexts = new Map();
    const contextAt = (cx, cy) => {
      const at = cy * N + cx;
      if (!caveContexts.has(at)) caveContexts.set(at, EnemySpawns.caveContextAt(entry, tx, ty, cx, cy, depth));
      return caveContexts.get(at);
    };
    const rawFloor = (cx, cy) => cx >= 0 && cy >= 0 && cx < N && cy < N
      && genGrid[cy * N + cx] === WorldGen.T.CAVE_FLOOR
      && !WorldGen.variantOwnerAt(entry, cy * N + cx);
    const legalSeat = (cx, cy, kind) => rawFloor(cx, cy)
      && (canonicalPass ? !creatureCells.has(cy * N + cx)
        : WorldGen.isSpawnCell(genGrid, N, N, cx, cy,
          { ...entry._spawnOpts, occupied: creatureCells }, creatureSpawnClass(kind)));
    const nearEntrance = (cx, cy) => anchors.some(a => Math.abs(cx - a.lix) <= SPAWN_R && Math.abs(cy - a.liy) <= SPAWN_R);
    let floors;
    const floorCells = () => {
      if (!floors) {
        floors = [];
        for (let cy = 0; cy < N; cy++) for (let cx = 0; cx < N; cx++)
          if (rawFloor(cx, cy)) floors.push({ cx, cy });
      }
      return floors;
    };
    const rawAreaPools = new Map(), eligibleClassPools = new Map(), eligibleAreaPools = new Map();
    const rawArea = (key, within) => {
      if (rawAreaPools.has(key)) return rawAreaPools.get(key);
      let cells;
      if (key.startsWith('block:')) {
        const [, bx, by] = key.split(':').map(Number);
        cells = [];
        for (let cy = by; cy < Math.min(N, by + 12); cy++)
          for (let cx = bx; cx < Math.min(N, bx + 12); cx++)
            if (rawFloor(cx, cy)) cells.push({ cx, cy });
      } else cells = key === 'all' ? floorCells() : floorCells().filter(p => within(p.cx, p.cy));
      rawAreaPools.set(key, cells); return cells;
    };
    const eligibleClass = kind => {
      const cls = creatureSpawnClass(kind), key = `${canonicalPass}:${cls}`;
      if (eligibleClassPools.has(key)) return eligibleClassPools.get(key);
      const cells = new Set(), habitats = new Map();
      for (const p of floorCells()) {
        if (!legalSeat(p.cx, p.cy, kind)) continue;
        const index = p.cy * N + p.cx, habitat = contextAt(p.cx, p.cy).id;
        cells.add(index);
        if (!habitats.has(habitat)) habitats.set(habitat, []);
        habitats.get(habitat).push(p);
      }
      const pool = { key, cells, habitats };
      eligibleClassPools.set(key, pool); return pool;
    };
    const fallbackSeat = (key, habitat, kindFor, within, areaKey) => {
      const cells = rawArea(areaKey, within);
      if (!cells.length) return null;
      const start = fnv1a(key) % cells.length;
      // Resolve the requested habitat and species on raw floor, independently
      // of the cached legal ground. Empty safety pools cost one scan per class.
      habitat ||= contextAt(cells[start].cx, cells[start].cy);
      const kind = kindFor(habitat);
      if (!kind) return null;
      const available = eligibleClass(kind);
      if (!available.cells.size) return null;
      const cacheKey = `${available.key}:${areaKey}:${habitat.id}`;
      if (!eligibleAreaPools.has(cacheKey)) {
        const pool = areaKey === 'all' ? available.habitats.get(habitat.id) || []
          : cells.filter(p => available.cells.has(p.cy * N + p.cx)
            && contextAt(p.cx, p.cy).id === habitat.id);
        eligibleAreaPools.set(cacheKey, pool);
      }
      const pool = eligibleAreaPools.get(cacheKey);
      // Preserve the original cyclic raw-cell search order, even though only
      // legal seats remain in the cached pool. Reservations never free seats.
      const origin = cells[start].cy * N + cells[start].cx;
      let lo = 0, hi = pool.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1, index = pool[mid].cy * N + pool[mid].cx;
        if (index < origin) lo = mid + 1; else hi = mid;
      }
      for (let k = 0; k < pool.length; k++) {
        const p = pool[(lo + k) % pool.length];
        if (!legalSeat(p.cx, p.cy, kind)) continue;
        return { ...p, kind, habitat };
      }
      return null;
    };
    const addEnemy = (seat, legacyPackIndex, id) => {
      const { cx, cy, kind, habitat } = seat, at = cy * N + cx;
      const cellId = EnemySpawns.caveId(depth, tx, ty, cx, cy);
      creatureCells.add(at);
      if (canonicalPass) {
        canonicalAliases.set(id, cellId); aliasOwners.set(cellId, id);
        return;
      }
      monsterSeats.add(id);
      const aliases = [], canonical = canonicalAliases.get(id);
      if (canonical) aliases.push(canonical);
      // Honour older saves on the current geometry as well, without allowing
      // one historical cell defeat to consume two population requests.
      if (!aliasOwners.has(cellId)) aliasOwners.set(cellId, id);
      if (aliasOwners.get(cellId) === id && !aliases.includes(cellId)) aliases.push(cellId);
      if (caughtSet.has(id) || aliases.some(alias => caughtSet.has(alias))
          || (legacyPackIndex != null && legacyDefeats.pack.has(legacyPackIndex))
          || aliases.some(alias => legacyDefeats.cells.has(alias.split('_').slice(-2).join('_')))
          || heldByPlayer.has(at)) return;
      const { x: wmx, y: wmy } = tileCellCentre(this.tileEdgeM, tx, ty, cellSizeM, cx, cy);
      creatures.push(WorldGen.makeCreature(kind, wmx, wmy, id,
        { shiny: EnemySpawns.rollsElite(entry, kind, id, wmx, wmy, cellSizeM), habitat: habitat.theme,
          ...(aliases.length ? { _legacyDefeatIds: aliases } : {}) }));
    };
    const populate = () => {
      for (let i = 0; i < count; i++) {
        const draw = WorldGen.makeRng(fnv1a(`cave_pack_${depth}_${tx}_${ty}_${i}:draw`));
        const kindRoll = draw();
        let seat = null, habitat = null;
        for (let attempt = 0; attempt < 20; attempt++) {
          const { cx, cy } = randCell(draw);
          if (!rawFloor(cx, cy)) continue;
          const candidateHabitat = contextAt(cx, cy);
          habitat ||= candidateHabitat;
          if (candidateHabitat.id !== habitat.id) continue;
          const kind = EnemySpawns.caveKind(depth, kindRoll, habitat);
          if (!kind || !legalSeat(cx, cy, kind)) continue;
          seat = { cx, cy, kind, habitat }; break;
        }
        seat ||= fallbackSeat(`cave_pack_${depth}_${tx}_${ty}_${i}`, habitat,
          h => EnemySpawns.caveKind(depth, kindRoll, h), nearEntrance, 'entrance');
        if (seat) addEnemy(seat, i, `enemy_cave_${depth}_${tx}_${ty}_pack_${i}`);
      }
      // Rabbits share the entrance bounds but stay outside authored cave areas.
      const rabbitN = 10 + Math.floor(hash01(`cave_rabbits_${depth}_${tx}_${ty}:count`) * 8);
      for (let i = 0; i < rabbitN; i++) {
        const draw = WorldGen.makeRng(fnv1a(`rabbit_${depth}_${tx}_${ty}_${i}:draw`));
        let seat = null, habitat = null;
        for (let attempt = 0; attempt < 20; attempt++) {
          const { cx, cy } = randCell(draw);
          if (!rawFloor(cx, cy)) continue;
          const candidateHabitat = contextAt(cx, cy);
          habitat ||= candidateHabitat;
          if (candidateHabitat.id !== habitat.id || !legalSeat(cx, cy, 'rabbit')) continue;
          seat = { cx, cy }; break;
        }
        seat ||= fallbackSeat(`rabbit_${depth}_${tx}_${ty}_${i}`, habitat, () => 'rabbit', nearEntrance, 'entrance');
        if (!seat) continue;
        const { cx, cy } = seat, at = cy * N + cx, id = `rabbit_${depth}_${tx}_${ty}_${i}`;
        creatureCells.add(at);
        if (canonicalPass || caughtSet.has(id) || heldByPlayer.has(at)) continue;
        const { x: wmx, y: wmy } = tileCellCentre(this.tileEdgeM, tx, ty, cellSizeM, cx, cy);
        creatures.push(WorldGen.makeCreature('rabbit', wmx, wmy, id));
      }
      // Roamers retain their own stream and one request per present floor block.
      const ROAM_PIVOT = 12, ROAM_TRIES = 6;
      const roamP = Math.min(0.6, 0.4 * Difficulty.get().monsterCountMul);
      for (let py = 0; py < N; py += ROAM_PIVOT) {
        for (let px = 0; px < N; px += ROAM_PIVOT) {
          const draw = WorldGen.makeRng(fnv1a(`cave_roam_${depth}_${tx}_${ty}_${px}_${py}:draw`));
          if (draw() >= roamP) continue;
          const kindRoll = draw();
          let seat = null, habitat = null;
          for (let attempt = 0; attempt < ROAM_TRIES; attempt++) {
            const cx = px + Math.floor(draw() * ROAM_PIVOT);
            const cy = py + Math.floor(draw() * ROAM_PIVOT);
            if (!rawFloor(cx, cy)) continue;
            const candidateHabitat = contextAt(cx, cy);
            habitat ||= candidateHabitat;
            if (candidateHabitat.id !== habitat.id) continue;
            const kind = EnemySpawns.caveKind(depth, kindRoll, habitat);
            if (!kind || !legalSeat(cx, cy, kind)) continue;
            seat = { cx, cy, kind, habitat }; break;
          }
          const inBlock = (cx, cy) => cx >= px && cy >= py && cx < px + ROAM_PIVOT && cy < py + ROAM_PIVOT;
          seat ||= fallbackSeat(`cave_roam_${depth}_${tx}_${ty}_${px}_${py}`, habitat,
            h => EnemySpawns.caveKind(depth, kindRoll, h), inBlock, `block:${px}:${py}`);
          if (!seat && habitat) seat = fallbackSeat(`cave_roam_${depth}_${tx}_${ty}_${px}_${py}:pocket`, habitat,
            h => EnemySpawns.caveKind(depth, kindRoll, h), () => true, 'all');
          if (seat) addEnemy(seat, null, `enemy_cave_${depth}_${tx}_${ty}_roam_${px}_${py}`);
        }
      }
    };
    canonicalPass = true; creatureCells = canonicalOccupied;
    populate();
    canonicalPass = false; creatureCells = new Set(occupiedIdx);
    // Minor is the permissive placement class: if it has no floor seat,
    // every actual creature request is a shortfall. Keep the identity pass
    // above, but avoid searching the same wholly excluded cave repeatedly.
    if (floorCells().some(p => WorldGen.isSpawnCell(genGrid, N, N, p.cx, p.cy,
      { ...entry._spawnOpts, occupied: creatureCells }, 'minor'))) populate();
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
          const { x: wmx, y: wmy } = tileCellCentre(this.tileEdgeM, tx, ty, cellSizeM, cx, cy);
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
      // Same occupiedIdx built once above.
      // Flat multiplier regardless of game mode — a dungeon is dangerous on
      // either one (see Traps.DUNGEON_DENSITY_MUL).
      entry.traps = Traps.spawnCave(genGrid, N, tx, ty, entry.tileEdgeM, depth,
        anchors, occupiedIdx, Traps.DUNGEON_DENSITY_MUL)
        .filter(t => !heldByPlayer.has(t._iy * N + t._ix));
    }
    for (const c of creatures) { c._discovered = !HiddenObjects.isHidden(this.save, c); EnemySpawns.markShared(c); }
    entry._spawned = true;
    entry.creatures = entry.creatures || creatures;
    for (const o of genObjects) {
      if (o.kind === 'bone_cache' && (this.save.opened || []).includes(o.id) && boneCacheSkeleton(o)) {
        this._raiseBoneCacheSkeleton(o);
      }
    }
    for (const guard of entry.underground?.boneGuards || []) {
      if (!caughtSet.has(guard.id) && !entry.creatures.some(c => c.id === guard.id)) {
        entry.creatures.push(WorldGen.makeCreature(guard.kind, guard.x, guard.y, guard.id,
          { depth, shiny: guard.shiny, _hunting: true }));
      }
    }
  }

  // Catch wheel: like startWorkProgress, but the TARGET CREATURE flees the
  // player at FLEE_MPS while it runs (see _drawWorkProgress). If it escapes the
  // viewport the catch FAILS (onFail) instead of completing; the wheel tracks
  // the fleeing creature. _beingCaught flags it so wanderCreatures leaves its
  // movement to the wheel.
  startCatchProgress(creature, durationMs, onComplete, onFail, toolSlot = null, energyRefund = 0) {
    EnemySpawns.refreshHomeFauna(this, false);
    if (!EnemySpawns.surfaceActive(this, creature)) return;
    creature._beingCaught = true;
    durationMs = Gear.workDurationMs(this.save, durationMs);
    const t = performance.now();
    this._setWorkProgressIcon(toolSlot);
    this._workProgress = {
      worldX: creature.x, worldY: creature.y, onComplete, durationMs,
      energyRefund, toolSlot, startT: t, _lastT: t, flee: creature, onFail,
    };
  }

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
    const { x: px, y: py } = playerWorldM(this);
    const kerbLeash = inKerbAt(this, px, py);
    enemySlimeTrailTick(this, px, py, npcDt);
    // THE SIM BUBBLE — measured from the player's FEET, never the camera
    // anchor (a peek drag must not widen who is thinking).
    //   The viewport corner sits at VIEW_CELLS/2 * √2 ≈ 7.8 cells.
    // CREATURE_SIM_CELLS gives about half a viewport of margin so a creature is
    // already moving when it comes into view. The 3×3 tile ring below still
    // covers it many times over.
    const RANGE_M = CREATURE_SIM_CELLS * this.cellM;
    const RANGE_SQ = RANGE_M * RANGE_M;
    // Per-frame loop hygiene: only the 3×3 tile neighbourhood is simmed (the sim
    // range is a handful of cells, a tile edge hundreds), and caught-membership is a
    // memoised Set.
    const pcW = this.playerToWorldCell();
    // Prune save.caught of pest-deer markers whose tile has since fallen out
    // of the in-memory tile cache. Every OTHER id in this array is
    // deterministic (crow_tx_ty_i, mon_kind_depth_tx_ty_i, rabbit_depth_tx_ty_i,
    // …) and MUST be kept forever — revisiting that tile re-seeds the same rng
    // and mints the identical id, so dropping the marker would let the "dead"
    // creature spawn right back. Pest deer are the one exception: each spawn
    // below mints a fresh id off Date.now()+Math.random() that is never minted
    // again, so once its tile leaves the cache the creature object it named is
    // gone for good and the marker can never matter again.
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
      // The ghosts (ghostSpawnPass), the fished slime (fishedSlimeSpawn),
      // every timed ally (Companions.KINDS — Companions.tick mints their
      // ids) and a guildhall bounty's foes (app.js _spawnGuildBounty) mint
      // their ids the same way and are pruned by the same rule. (`pest_crow_`
      // is the pump's old prefix — a marker left by a session before the deer
      // took the job prunes the same way.)
      const sessionId = this._sessionIdRe ||= new RegExp(
        `^(?:pest_deer|pest_crow|ghost|fished_slime|${Object.keys(Companions.KINDS).join('|')}|guildfoe)_(-?\\d+)_(-?\\d+)_`);
      this.save.caught = this.save.caught.filter((id) => {
        const m = typeof id === 'string' && sessionId.exec(id);
        // A gate's guard (lairs.js DAILY_TIERS) carries its UTC day: one
        // from another day can never rise again, so its marker goes.
        const gateDay = Lairs.dailyGuardDay(id);
        if (gateDay) return gateDay === utcDayKey();
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
    EnemySpawns.refreshHomeFauna(this);
    // Only crops a deer actually eats (not potato) justify spawning a pest —
    // and only on HARD (Difficulty.get().cropPests). The pump is not a
    // difficulty KNOB, it is a mode difference: a deer that finds your field
    // wherever you plant it is the hard game's answer to farming as a quiet
    // income, and on easy the tile spawner's own deer are the whole deer
    // threat — meet one by walking into it, not by having one dispatched to
    // you.
    // THE HOUR IS THE SAVE'S (save.pestDispatchAt, wall clock): it survives
    // a reload, so a short session still meets its deer — on the page clock
    // the first window opened only after an hour without a reload, which on
    // a phone was never. Only a DISPATCH stamps it; a window that finds a
    // deer already near, or no seat, re-asks every PEST_RECHECK_MS (also the
    // throttle that keeps the O(planted) scan off ordinary frames).
    // SURFACE ONLY: underground WorldGen.tileCache is the cave level's map
    // (see the prune's depth gate above), so a pest minted here landed in
    // the dungeon — a deer with no crop to walk at, in a cave.
    const wallNow = Date.now();
    if ((this.depth || 0) === 0 && wallNow - (this.save.pestDispatchAt || 0) > PEST_DISPATCH_MS
      && now - (this._pestCheckT ?? -Infinity) > PEST_RECHECK_MS) {
      this._pestCheckT = now;
      const hasRaidableCrop = this.save.planted && this.save.planted.some((p) => this._cropRaidable(p));
      if (hasRaidableCrop && Difficulty.get().cropPests) {
        // Count nearby wild (non-released, not-yet-caught) deer.
        let wildDeer = 0;
        WorldGen.forEachItemNear('creatures', pcW.tx, pcW.ty, (c) => {
          if (c.kind !== 'deer' || c._surfaceInactive) return;
          if (Combat.isTame(c)) return;
          if (caughtSet.has(c.id)) return;
          const dx = c.x - px, dy = c.y - py;
          if (dx * dx + dy * dy <= RANGE_SQ) wildDeer++;
        });
        if (wildDeer < 1) {
          const pc = pcW;
          const entry = WorldGen.tileCache.get(WorldGen.tileKey(pc.tx, pc.ty));
          if (entry && entry.creatures) {
            // Spawn in a random direction, OUTSIDE the viewport but INSIDE the sim
            // bubble (10 cells: clears the viewport corner at 7.8, two cells inside the
            // bubble), so the deer walks toward the nearest crop from its first tick.
            // A deer WALKS: a few angles round the ring, the first whose cell is loaded
            // and not water / a building / a road (Combat.faunaBlocksCell). None found: no
            // pest this window; the timer is already stamped.
            const SPAWN_R = PEST_SPAWN_CELLS * this.cellM;
            const seat = ringSeat(px, py, SPAWN_R, Math.random() * Math.PI * 2, (sx, sy) => {
              const dest = this.cellAt(sx, sy);
              if (!dest.loaded || !BiomeProfiles.faunaAllows('deer', dest.type)) return false;
              const tile = WorldGen.tileCache.get(WorldGen.tileKey(dest.tx, dest.ty));
              if (!tile?.grid) return false;
              return WorldGen.isSpawnCell(tile.grid, tile.cellsPerEdge, tile.cellsPerEdge, dest.ix, dest.iy, WorldGen.spawnOptsOf(tile, { occupied: null }), creatureSpawnClass('deer'));
            });
            if (seat) {
              entry.creatures.push(WorldGen.makeCreature('deer', seat.x, seat.y,
                `pest_deer_${pc.tx}_${pc.ty}_${Math.floor(now)}_${Math.floor(Math.random() * 1e4)}`));
              EnemySpawns.refreshHomeFauna(this);
              this.save.pestDispatchAt = wallNow;
              if (typeof persistSave === 'function') persistSave(this.save);
            }
          }
        }
      }
    }

    // The night's ghosts: a group now and then in the dark about the player.
    // The arena owns its trials; the cave's timed crypt haunt cannot run here.
    if (this.depth !== WorldGen.ARENA_DEPTH)
      ghostSpawnPass(this, now, px, py, pcW, homePos, castleWards, HOME_WARD_R2, caughtSet);

    // THE ACTIVE BUBBLE is the one creature list every per-frame consumer
    // needs: movement below, combat immediately after this method, and the
    // sprite cull later in the same update. A dense town can hold more than a
    // thousand frozen seats across the 3×3 ring while fewer than thirty are
    // close enough to think or draw. Walking that whole ring separately in
    // all three consumers was the steady-state phone cost.
    //
    // While the feet stand still, a creature outside RANGE cannot enter it:
    // the rule above freezes it there. Reuse the bubble until the feet move,
    // a ring array mutates, or the far-surface recheck clock lands. Active
    // creatures remain object references and are range-checked each tick, so
    // their movement and a caught/dead change are live. The array stamp uses
    // the same identity/length/tail rule as WorldGen's derived chunk indexes;
    // the one-second refresh also bounds an in-place mutation it cannot see.
    const ringStamp = [];
    for (let dty = -1; dty <= 1; dty++) {
      for (let dtx = -1; dtx <= 1; dtx++) {
        const entry = WorldGen.tileCache.get(WorldGen.tileKey(pcW.tx + dtx, pcW.ty + dty));
        const list = entry?.creatures || null;
        ringStamp.push({ entry, list, n: list?.length || 0, last: list?.[list.length - 1] });
      }
    }
    const oldBubble = this._activeCreatureMemo;
    const sameRing = !!oldBubble && oldBubble.tx === pcW.tx && oldBubble.ty === pcW.ty
      && oldBubble.depth === (this.depth || 0) && oldBubble.px === px && oldBubble.py === py
      && oldBubble.stamp.length === ringStamp.length
      && ringStamp.every((s, i) => {
        const was = oldBubble.stamp[i];
        return was.entry === s.entry && was.list === s.list && was.n === s.n && was.last === s.last;
      });
    const refreshBubble = !sameRing || now - oldBubble.scannedAt >= SURFACE_RECHECK_MS;
    let bubble = refreshBubble ? [] : oldBubble.creatures;
    if (refreshBubble) {
      WorldGen.forEachItemNear('creatures', pcW.tx, pcW.ty, c => {
        if (caughtSet.has(c.id)) return;
        const ddx = c.x - px, ddy = c.y - py;
        if (ddx * ddx + ddy * ddy <= RANGE_SQ) {
          bubble.push(c);
          return;
        }
        // Frozen surface seats still re-evaluate their player/time gate on its
        // existing slow clock. This is the only work the far ring needs.
        if (EnemySpawns.isSurfaceResident(c)
            && (c._surfaceAskedT == null || now - c._surfaceAskedT >= SURFACE_RECHECK_MS)) {
          c._surfaceAskedT = now;
          EnemySpawns.surfaceActive(this, c);
        }
        c._walkHazardPrevious = null;
        if (c.kind === 'npc') c._moving = false;
      });
      this._activeCreatureMemo = {
        tx: pcW.tx, ty: pcW.ty, depth: this.depth || 0, px, py,
        stamp: ringStamp, scannedAt: now, creatures: bubble,
      };
    }

    // A cached member can walk out of the bubble. Drop it now; frozen things
    // cannot walk back in until the player moves and invalidates the memo.
    // Most ticks have no charm active, and spacing only concerns live nearby
    // foes, so both derived lists come from this same small pass.
    const activeCreatures = [];
    this._charmedOpponents = [];
    // The same bubble pass gathers every live character once a tick, so
    // movement, combat, rendering and spacing share the small nearby set.
    this._foeBodies = [];
    this._characterBodies = [{ id: 'player', x: px, y: py }];
    for (const c of bubble) {
      if (caughtSet.has(c.id)) continue;
      const ddx = c.x - px, ddy = c.y - py;
      if (ddx * ddx + ddy * ddy > RANGE_SQ) {
        c._walkHazardPrevious = null;
        if (c.kind === 'npc') c._moving = false;
        continue;
      }
      activeCreatures.push(c);
      Pirates.sync(this, c);
      if (Combat.isCharmed(c)) this._charmedOpponents.push(c);
      if (!c._surfaceInactive) this._characterBodies.push(c);
      if (Combat.isEnemy(c) && EnemyRoster.get(c.kind)) this._foeBodies.push(c);
    }
    this._activeCreatures = activeCreatures;
    this._activeCreatureMemo.creatures = activeCreatures;

    const spacingIndex = this._characterSpacingIndex = buildCharacterSpacingIndex(this);
    const tickCreature = (c) => {
      if ((EnemySpawns.homeFaunaSubject(c) || c._homeFaunaInactive) && !EnemySpawns.surfaceActive(this, c)) return;
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
      if (EnemySpawns.isSurfaceResident(c)) {
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
      if (Combat.isTame(c)) {
        if (Pets.tick(this.save,c)) persistSave(this.save);
        if (Pets.isDown(c)) { c._moving=false; c._chaseTarget=null; return; }
      }
      if (enemyConcealmentTick(this, c)) return;
      if (enemyDisguiseTick(this, c, px, py)) return;
      if (!Combat.isParalyzed(c) && enemyBurrowTick(this, c, EnemyRoster.get(c.kind), now)) return;
      if (typeof PotionEffects !== 'undefined' && PotionEffects.tick(this, c)) return;
      if (this._tickUnitFire?.(c, now)) return;
      if (this._tickUnitPoison?.(c, now)) return;
      if (!caughtSet.has(c.id) && enemyWalkHazardTick(this, c, now)) return;
      // Hazards keep ticking while web paralysis stops every movement and
      // attack lane, including pets and neighbours.
      if (Combat.isParalyzed(c)) { Combat.cancelCreatureAction(c); return; }
      if (c.kind === 'npc') { NPC.tick(this, c, now, npcDt); return; }
      // A boss's pieces move and bite by their encounter's tick (scene_boss.js).
      if (EnemyRoster.get(c.kind)?.boss) return;
      const unnoticed = this.isUnnoticed(c);
      const isTame = Combat.isTame(c);
      // Read ONCE per creature per tick: is it a hostile right now, and how
      // far off (metres from the feet) — every lane below asks both.
      const enemy = Combat.isEnemy(c);
      // THE STORY PAUSE (app.js _storyPause): a hostile holds still and
      // strikes nothing while a story dialog is up — its hazards above still tick.
      if (enemy && this._storyPause) { c._moving = false; Combat.cancelCreatureAction(c); return; }
      const distM = Math.sqrt(ddx * ddx + ddy * ddy);
      // HUNTS FOR THE PLAYER: a tame pet, or a summoned ally (the spirit
      // raven, conjured by a scroll — yours without being tame). One flag
      // the pet scan and its fight read; see huntsPrey for what each takes.
      const summoned = SpriteLayout.isSummoned(c.kind);
      // A spent ally (its HP ran out — see the pet fight) stands still until
      // app.js _tickSpiritRaven lifts it off the map.
      if (summoned && c._spent) return;
      const huntsForPlayer = (isTame && SpriteLayout.isPet(c.kind)) || summoned;
      // WHAT THINKS AT ALL: everything with a row in the creature behaviour
      // table (SpriteLayout.CREATURE_BEHAVIOUR); a giant resolves to its base kind's
      // row exactly as it resolves to its base kind's art.
      const wanders = SpriteLayout.creatureWanders(c.kind);
      if (!wanders) return;
      if (caughtSet.has(c.id)) return;
      // Mid-catch: the catch wheel owns this creature's movement (it flees the
      // player), so the generic wander must not also drive it.
      if (c._beingCaught) return;
      // (The Frost Powder's chill is a SLOW — Combat.STATUS_LOOKS.frozen,
      // read by Combat.paceMul and the attack cadence — never a skipped tick.)
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
      // THE WARD IS A LATCH, NOT A FENCE: crossing HOME_R sets `_wardFrom`, and
      // only the sim bubble's edge clears it. A plain radius test made the ring a
      // turnstile (a foe bobbing in and out of the same cells forever). Two radii,
      // one flag: HOME_R trips it, CREATURE_SIM_CELLS releases it, the hysteresis a
      // lair guard's hold/hunt/return already has (Lairs.guardState).
      //   The latch remembers WHICH ward tripped it (`_wardFrom`, a point:
      // Home, or a claimed castle's turret), because the rout angle and the
      // release both measure from that point.
      //   A GHOST has one more ward point: a campfire (fireWardTrip) — the
      // same latch, a third reason, asked only for a haunting kind.
      const haunts = SpriteLayout.creatureHaunts(c.kind);
      const stationary = !!c.stationary || EnemyRoster.isRooted(c.kind);
      // An ENRAGED game animal (a hunted deer — `fightsBack`, _rageUntil) is
      // hostile for as long as it is angry, so it takes Home's ward exactly as
      // an enemy does: one lane, another reason. Warded, it is turned away
      // and `standDown` switches its butt off.
      const fightsBack = !isTame ? SpriteLayout.creatureFightsBack(c.kind) : null;
      const enraged = !!fightsBack && !!c._rageUntil && Date.now() < c._rageUntil;
      const wardFoe = (!!homePos || castleWards.length > 0 || haunts) && !isTame
        && (enemy || enraged);
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
      const wanderOff = !stationary && !isTame && !c.lair && enemy
        && monsterWanderingOff(c, now, distM, this.cellM);
      // TURNED BACK AT THE KERB (creature_ai.js THE KERB): the player stands
      // in a major road's kerb buffer, so every hostile — a foe, or a hunted
      // animal while it is angry — stands down and turns away, exactly as a
      // foe wandering off does (the same away angle, below). A lair guard
      // gives up instead (guardState, noticed = false) and walks home; a ghost
      // stops where it is. One more reason in the wander-off lane, never a
      // "frozen while you are on the road" rule — that one would lure a
      // player INTO the road.
      // ANOTHER PLAYER'S FOE (Multiplayer.enemyTarget): a shared foe that
      // the target rule set on a nearby peer — the same pick their device
      // makes. Null offline, or whenever the pick is you, which leaves every
      // line below exactly as it is for a single player. A peer body rides
      // the npcTarget lane: the stalk goes at the peer's spot, and the blow
      // is a feint here (rosterEnemyAttack → peerFeint) — on the peer's own
      // device the same foe hurts them. Its pursuit is theirs, so your kerb
      // does not turn it, and a garrison hunts the peer it noticed.
      const peerTarget = enemy && !isTame && !haunts && typeof Multiplayer !== 'undefined'
        ? Multiplayer.enemyTarget(this, c, px, py) : null;
      const kerbTurn = kerbLeash && !peerTarget && !isTame && (enemy || enraged);
      // ROUTED: turned onto an away angle at the flee pace — by Home's ward, or
      // by wandering off. Two reasons, one pace; the angle chain says away from
      // WHAT (Home, or the player).
      // SATED: a thief that has stolen from you today (Combat.theftSated —
      // the raven's coins, the gull's food; one snatch a day) turns its back
      // and flies off — a third
      // reason in the rout lane (the away-from-the-player angle at the flee
      // pace), and one more reason to stand down below. Asked only of a kind
      // that steals, so the per-creature cost elsewhere is one table read.
      const sated = !isTame && ((!!Combat.theftKind(c.kind) && Combat.theftSated(this.save, c))
        || Combat.raidSpent(this.save, c));
      const frightened = enemy && Combat.isFrightened(c, now);
      // MAD (the Powder of Psychosis — Combat.isPsychotic): the rout lane
      // once more — the flee pace, no blow, no target — but with a RANDOM
      // angle each hop (the chain below) in place of fear's away angle, so
      // it runs every which way rather than off. Home's ward still outranks
      // it: a mad foe inside the ring is walked out like any other.
      const psychotic = enemy && Combat.isPsychotic(c, now);
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
      const lairState = c.lair && !frightened && !psychotic ? Lairs.guardState(c, peerTarget || { x: px, y: py }, this.cellM,
        !!peerTarget || (!unnoticed && !kerbTurn)) : null;
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
      // A foe of a provoked-only zone (the mushroom grove) not yet struck, nor
      // its zone's crops harvested, is one more reason (EnemyHabitats.unprovoked).
      const unprovoked = enemy && EnemyHabitats.unprovoked(c);
      const standDown = frightened || psychotic || warded || wanderOff || kerbTurn || sated || unprovoked
        || (!!lairState && lairState !== 'hunt');
      const rosterRow = !isTame ? EnemyRoster.get(c.kind) : null;
      // A neighbour nearer than the peer it is after still wins its attention.
      const npcTarget = rosterRow && !standDown
        ? (peerTarget ? NPC.enemyTarget(this, c, rosterRow, peerTarget.x, peerTarget.y, false) || peerTarget
          : NPC.enemyTarget(this, c, rosterRow, px, py, unnoticed)) : null;
      const enemyDt = c._enemyTickT == null ? 0 : Math.min(0.1, Math.max(0, (now - c._enemyTickT) / 1000));
      c._enemyTickT = now;
      // A HUNTED DEER CHARGES: enraged, and neither warded nor ignoring you
      // (`unnoticed` — a powder, or a body on an empty bar). Read by the butt
      // below, the stride and the angle chain, so the three agree.
      const gameCharge = enraged && !standDown && !unnoticed;
      // A GHOST has its own mover (ghostTick — hover, rush, burn) and its own
      // blow: ONE touch of its row's dmg (Combat.meleeBlow), through the mode,
      // the shield and the armour like every blow (foeBlowLands — the one
      // writer and the one roll-up), and then it is spent — marked in
      // save.caught like a kill, but no coin (nobody felled it). Nothing else
      // below runs for it: it has no leech, no step chain and no crop to eat.
      if (haunts) {
        const pace = rosterRow.movement.speedMetersPerSecond / 1000;
        const fate = ghostTick(this, c, now, npcTarget?.x ?? px, npcTarget?.y ?? py,
          (npcTarget ? NPC.isDormant(npcTarget) : unnoticed) || kerbTurn, warded, pace);
        if (fate === 'touch') {
          const raw = Combat.meleeBlow(c, rosterRow.dmg);
          if (npcTarget) NPC.hit(this, npcTarget, Date.now(), raw);
          else foeBlowLands(this, c, raw);
        }
        if (fate === 'touch' || fate === 'faded') {
          (this.save.caught = this.save.caught || []).push(c.id);
          if (typeof persistSave === 'function') persistSave(this.save);
        }
        return;
      }
      // LAVA BURNS FOES TOO (creature_ai.js lavaTick — the one lava rule,
      // the flower lane's as well): the ground's kill, never a pet's.
      if (enemy && lavaTick(this, c, now)) return;
      if (enemyFireEscapeTick(this, c, rosterRow, now, enemyDt)) return;
      // EVERY FOE'S BLOW, ARROW, SNARE AND SPELL: rosterEnemyAttack
      // (creature_ai.js) on its row — the slime's leech, a goblin's club, the
      // archer's arrow, the trapper's snare — behind the same `unnoticed` /
      // `standDown` gates. Runs every frame; the row's own cadence paces it.
      // What the player loses rolls up into one throttled "-N" after the loop.
      if (rosterRow && !haunts) {
        if (npcTarget) rosterEnemyAttack(this, c, rosterRow, now, npcTarget.x, npcTarget.y,
          standDown, enemyDt, npcTarget);
        else rosterEnemyAttack(this, c, rosterRow, now, px, py, unnoticed || standDown, enemyDt);
      }
      // THE HUNTED DEER'S BUTT: at arm's length (Combat.meleeReachM, the reach
      // the player swings at) every `hitMs`, for its row's `dmg` through the
      // melee formula (Combat.meleeBlow) — the mode, the shield and the armour
      // like every blow, banked and rolled up by the one writer (foeBlowLands).
      if (gameCharge) {
        const BUTT_R = Combat.meleeReachM(this.cellM);
        if (ddx * ddx + ddy * ddy <= BUTT_R * BUTT_R && (!c._nextStealT || now >= c._nextStealT)) {
          c._nextStealT = now + fightsBack.hitMs;
          creatureMeleeSwing(c, px, py, BUTT_R / this.cellM);
          foeBlowLands(this, c, Combat.meleeBlow(c, fightsBack.dmg));
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
      //   'hunt' and 'return' fall THROUGH to the roster mover: the chase and
      // the walk home are ordinary steps of rosterEnemyMove's one chain.
      // `immobile` is set by src/lairs.js; nothing else in the game seats an
      // immobile creature, and anything that does must land below the same
      // line.
      // A declared stationary kind can bite above but never enters a movement
      // lane. Roster plants also remain rooted through their anchor_spit mover.
      if (stationary) return;
      if (c.immobile && !frightened && !psychotic && lairState !== 'hunt' && lairState !== 'return') return;
      // EVERY FOE MOVES BY ITS ROW (rosterEnemyMove): the stalk, the rout
      // (Home's ward, a wander-off, fear, madness, a sated thief — `routed`),
      // the kerb turn, a garrison's hunt and walk home (`lairState`). What
      // follows below is the animals' and the pets' step chain.
      if (rosterRow) {
        rosterEnemyMove(this, c, rosterRow, now, npcTarget?.x ?? px, npcTarget?.y ?? py,
          (npcTarget ? NPC.isDormant(npcTarget) : unnoticed) || standDown,
          routed || (kerbTurn && !c.lair), lairState, enemyDt);
        return;
      }
      // Wild-crow flight rhythm: perch → one eased glide → perch again,
      // casing and raiding a field it notices (_wildCrowTick has the phases).
      // Owned crows fall through to the generic wander below so
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
      // bolt are a wild animal's wariness, and a pet joins the base wander (a butterfly keeps its flit either way).
      const beh = SpriteLayout.creatureBehaviour(c.kind);
      const gait = (beh && !(isTame && beh.tameSettles)) ? beh : null;
      const bolt = gait ? gait.flee : null;
      // TWO TRIGGERS, ONE REACTION. Proximity (`flee.cells` — the player is
      // close enough to spook it), or the two-minute escape window a failed
      // net-catch arms (`flee.escapes` over _escapingUntil, set in
      // _drawWorkProgress — the butterfly's, and only ever stamped on one).
      // A charging deer does not bolt — it comes at you (gameCharge).
      const bolting = !!bolt && !gameCharge && !Combat.isCalm(c) && (
        (bolt.cells != null && ddx * ddx + ddy * ddy <= (bolt.cells * this.cellM) ** 2)
        || (!!bolt.escapes && !!(c._escapingUntil && now < c._escapingUntil)));
      // The charge runs at the kind's own flee stride and beat: one pace for
      // "in a hurry", whichever way it is going.
      const sprinting = bolting || (gameCharge && !!bolt);
      // The one pace multiplier (Combat.paceMul — a shiny's 1.5, a thrown
      // Speed potion's 2, the frost's slow) quickens the beat and lifts the
      // kind's top speed by the same factor.
      const paceMul = Combat.paceMul(c, now, bolting || routed || c._fleeUntilT > now);
      // stepMs = animation duration of the hop itself (short burst); stepM is
      // how far it carries: the kind's gait row, or the loop's own base beat.
      // A ROUTED animal RUNS, at the same pace anything else in a hurry runs
      // (FLEE_*) — a hunted deer walked out of Home's ring. A rout takes the
      // stride too, because the thing being asked for is distance, not
      // urgency.
      //   NOT ON A SPRINT. A kind already at its bolt (sprinting — bolting,
      // or a hunted deer's charge) is already in a hurry: the bolt row IS its
      // hurry pace, tuned under the speed ceiling (WILD_SPEED_CEILING_MPS),
      // and the FLEE multipliers on top would stack a run on a run (a routed
      // deer at four times its bolt). So the rout quickens what was not
      // already running.
      const hurry = routed && !sprinting;
      let stepMs = (sprinting ? (bolt.stepMs ?? STEP_MS) : (gait?.stepMs ?? STEP_MS))
        / paceMul * (hurry ? FLEE_BEAT_MUL : 1);
      const stepM = STEP_M * (sprinting ? (bolt.stepCells ?? 1) : (gait?.stepCells ?? 1))
        * (hurry ? FLEE_STRIDE_MUL : 1);
      // A kind's top speed (SpriteLayout.creatureMaxMps) stretches the glide,
      // never shortens the stride: the step still lands where it was aimed.
      // A shiny's cap rises by the same factor its beat quickens by.
      const maxMps = SpriteLayout.creatureMaxMps(c.kind) * paceMul;
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
        // butterfly is a bonus, so it takes the max.
        if (isTame && beh?.pollinates && this.save.planted) {
          for (const pp of this.save.planted) {
            const dx = pp.x - c.x, dy = pp.y - c.y;
            if (dx * dx + dy * dy <= 64) pp.qualBoost = Math.max(pp.qualBoost ?? pp.canBoost ?? 0, 1);
          }
        }
        // Rested a while, whole again (Combat.healIfRested — the one rule).
        Combat.healIfRested(c);

        // Pet combat: a creature that HUNTS FOR THE PLAYER scans for the
        // nearest valid prey within 8 cells each wander step. Two reasons, one
        // lane: a tame PET (a kind whose row says it hunts for its owner —
        // cats crows, dogs deer + slimes), or a SUMMONED ally (the spirit
        // raven — every foe and pest deer). What each may take is huntsPrey
        // (creature_ai.js), off the same row.
        if (huntsForPlayer) {
          // Pet is within sim range of the player and prey within 8 cells of
          // the pet, so the player's 3×3 tile ring covers the search box
          // (nearestCreature, creature_ai.js — the one nearest scan).
          const following = Companions.follows(c, now);
          c._chaseTarget = nearestCreature(this, c, 8 * this.cellM, (cr) => {
            if (!huntsPrey(c.kind, cr) || caughtSet.has(cr.id)) return false;
            if (following && Math.hypot(cr.x - px, cr.y - py) > 4 * this.cellM) return false;
            return !(c.stayHome && Math.hypot(cr.x - c.petHomeX, cr.y - c.petHomeY) > Companions.HOME_PET_CELLS * this.cellM);
          }, { tile: pcW });
        }

        // Flee override: prey that was just hit runs away — at its BOLT if
        // its row has one (the bolt IS the kind's hurry, tuned under the speed
        // ceiling; the FLEE multipliers on top would stack a run on a run),
        // else at the FLEE pace anything else in a hurry runs. The hop glides
        // over the same beat it is chosen on (_hopMs).
        // A calmed animal (the Sugar Potion) takes the blow and stays.
        if (c._fleeUntilT > now && Combat.isCalm(c)) c._fleeUntilT = 0;
        if (c._fleeUntilT && c._fleeUntilT > now) {
          const base = hurry ? { m: stepM / FLEE_STRIDE_MUL, ms: stepMs / FLEE_BEAT_MUL } : { m: stepM, ms: stepMs };
          const hurryM = bolt ? STEP_M * (bolt.stepCells ?? 1) : base.m * FLEE_STRIDE_MUL;
          const hurryMs = bolt ? (bolt.stepMs ?? STEP_MS) / paceMul : base.ms * FLEE_BEAT_MUL;
          // Shoved off among houses, it runs the ROADSIDE and never into a yard
          // (fleeTarget — the crow's dash takes the same search).
          const to = fleeTarget(this, c, hurryM);
          if (to) {
            // A kind with a top speed (creatureMaxMps) glides the shove no
            // faster than it: the beat and the glide both stretch.
            c._hopMs = Math.max(hurryMs, hurryM / maxMps * 1000);
            launchStep(c, to.x, to.y, now);
            c._nextChooseT = now + c._hopMs;
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
        const homeRadius = c.stayHome ? Companions.HOME_PET_CELLS * this.cellM : isTame ? 5 * this.cellM : 3 * this.cellM;
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
        let tx = c.x, ty = c.y, angle = 0;
        let foundValidTarget = false;
        // Fight resolution: if chasing pet is in fight range, deal damage.
        if (c._chaseTarget) {
          const tgt = c._chaseTarget;
          const fd2 = (tgt.x - c.x) ** 2 + (tgt.y - c.y) ** 2;
          const fightRange = Combat.petReachCells(c);
          const FIGHT_R2 = (fightRange * this.cellM) ** 2;
          if (fd2 <= FIGHT_R2) {
            // One HP table for every fight (combat.js): the bite is Combat.petBite (a
            // point for a tame pet, the slime's own blow for the spirit raven). The prey
            // bites back a point either way.
            Pirates.say(this, c);
            const tgtHpBefore = Combat.hp(tgt);
            tgt._hp = Combat.damage(tgt, Combat.petBlow(c));
            // The bite is this player's side's blow: nearby players feel it too.
            if (typeof Multiplayer !== 'undefined') Multiplayer.reportHit(this, tgt, tgtHpBefore - tgt._hp, 'pet');
            c._hp   = Combat.damage(c, 1);
            creatureMeleeSwing(c, tgt.x, tgt.y, fightRange);
            creatureMeleeSwing(tgt, c.x, c.y, fightRange);
            tgt._lastDamagedT = Date.now();
            c._lastDamagedT   = Date.now();
            // A pet's bite is a blow too: a splitting slime divides under it
            // (creature_ai.js enemySplit), away from the pet's side.
            if (tgt._hp > 0) enemySplit(this, tgt, c.x, c.y, now);
            // React to the bite immediately either way — but WHICH reaction
            // depends on the prey. A bird or a deer runs (the flee override below).
            // A SLIME charges, at the player: it is an enemy, not game.
            // slimeCharging reads `_lastDamagedT`, stamped just above, so the pet's teeth
            // provoke exactly what the player's sword does.
            tgt._nextChooseT = 0;            // interrupt current step immediately
            if (!slimeCharging(tgt)) {
              // Push prey away from pet.
              tgt._fleeAngle  = Math.atan2(tgt.y - c.y, tgt.x - c.x);
              tgt._fleeUntilT = now + STRUCK_REACTION_MS;  // outlasts one wander step
            }
            if (tgt._hp <= 0) {
              // Auto-defeat the prey through the one payout path the player's kills use.
              // A pet is the player's (Combat.isPlayerKill): its kill pays
              // everything the player's own would.
              this.resolveDefeat(tgt, 'pet');
              c._chaseTarget = null;
            }
            // The bite back pops like any blow; a downed ally takes its
            // kind's rule (Companions.knockedOut: a pet limps home at 1 HP,
            // a timed ally is spent).
            this._popDamageNumber?.(c, 1);
            if (c._hp <= 0) Companions.knockedOut(this, c, now);
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
            // (mild), a butterfly careens (wider still).
            //   Among houses the bolt runs the ROADSIDE (creature_ai.js
            // roadsideRunAngle): along the street, never into a yard.
            angle = Math.atan2(-dyp, -dxp);
            angle = roadsideRunAngle(this, c, angle) ?? angle + (Math.random() - 0.5) * bolt.jitter;
          } else if (warded) {
            // Away from the WARD (Home, or the claimed castle's turret that
            // tripped it — `_wardFrom`), not away from the PLAYER: away-from-player would
            // shove the foe around the ring with the player still inside it.
            //   An ANGLE, not a refused target cell like the scarecrow and campfire wards
            // below: a foe deep inside the ring would have every attempt rejected and
            // freeze on the doorstep (the stall the "surrounded by scarecrows" note warns
            // about).
            angle = Math.atan2(c.y - c._wardFrom.y, c.x - c._wardFrom.x);
            // Home stands among houses: the rout runs the ROADSIDE
            // (roadsideRunAngle) — along the street, not through the yards.
            angle = roadsideRunAngle(this, c, angle) ?? angle + (Math.random() - 0.5) * 0.8;
          } else if (kerbTurn) {
            // TURNED BACK AT THE KERB (an enraged deer; a foe's kerb turn is
            // rosterEnemyMove's): away from the PLAYER, on the same spread as
            // the rout above. An angle, not a refused cell, for the same
            // reason as the rout; the cell tests below still refuse water
            // and rocks. Among houses it runs the ROADSIDE (roadsideRunAngle).
            angle = Math.atan2(c.y - py, c.x - px);
            angle = roadsideRunAngle(this, c, angle) ?? angle + (Math.random() - 0.5) * 0.8;
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
          // THE ONE STEP TEST (creature_ai.js creatureStepRefused — the same
          // the roster mover sweeps by): a placed rock, water / a building /
          // a major road, THE KERB (nothing wild steps onto a major band, a
          // FAST mover never INTO the buffer from outside it; a pet and a
          // summoned ally go where they like), and on a RETREAT (a bolt, the
          // rout, the kerb turn) never INTO a yard it is not already in (THE
          // ROADSIDE RUN). Refused from outside, free once inside — a refused
          // cell for one already there would freeze it (the stall the
          // scarecrow note below warns about).
          if (creatureStepRefused(this, c, tx, ty, { retreating: bolting || routed || kerbTurn })) continue;
          // Scarecrow aversion — refuse any target cell within 4 cells of an
          // active scarecrow to a kind whose row says it keeps clear of one
          // (crow + deer). They get bounced by the attempt loop until they
          // pick a different direction.
          if (SpriteLayout.creatureAvoids(c.kind, 'scarecrow')
              && this._nearAny('scarecrows', tx, ty, 4)) continue;
          foundValidTarget = true;
          break;
        }
        // If every attempt was blocked (e.g. crow surrounded by scarecrows
        // / water / buildings), stand still instead of moving onto a bad
        // cell.
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
        launchStep(c, tx, ty, now);
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
      if (!Combat.isEnemy(c)) {
        const frameMs = Math.min(100, Math.max(0, now - (c._characterMoveT ?? now)));
        c._characterMoveT = now;
        const pace = stepM / (c._hopMs || stepMs) * frameMs;
        characterMove(this,c,nx,ny,now,{pace});
      }
      else { c.x = nx; c.y = ny; }
    };
    for (const c of activeCreatures) {
      tickCreature(c);
      if (EnemySpawns.homeFaunaSubject(c) || c._homeFaunaInactive) EnemySpawns.surfaceActive(this, c);
      updateCharacterSpacingIndex(spacingIndex, c);
    }
    this._characterSpacingIndex = null;
    // What the foes took off the bar this window pops as one "⚔️ monsters"
    // roll-up from the scene's drain lane (app.js _flushDrainPops).
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
    // Never `return` early here: c.x/c.y are ONLY written in this function, so a
    // return would freeze the crow while a pet keeps hitting it
    // (test/node/crow_flee.test.js).
    const fleeing = c._fleeUntilT > now && !Combat.isCalm(c);
    if (fleeing) {
      // A crow being mauled doesn't finish casing the crop first — abandon
      // any in-progress landing so recovering later starts clean.
      c._destroyCropRef = null;
      c._destroyCyclesLeft = 0;
      // _fleeDash marks a flight leg as ITS OWN panic dash (vs. a normal
      // glide that was already in flight the instant the hit landed).
      // Without that distinction the check below would keep gliding the crow along
      // its old pre-hit course instead of reacting on the very next tick.
      if (c._flightUntilT && now < c._flightUntilT && c._fleeDash) {
        const dur = c._flightUntilT - c._flightT0;
        const t = Math.min(1, (now - c._flightT0) / dur);
        const u = creatureFlightEase(t);
        c.x = c._startX + (c._targetX - c._startX) * u;
        c.y = c._startY + (c._targetY - c._startY) * u;
        return;
      }
      // Between dashes (or reacting to the hit for the first time) — launch a
      // new short burst directly away from the hit angle (fleeTarget: the
      // generic flee override's own search, so a fleeing crow reads like
      // every other fleeing kind — the ROADSIDE among houses, never a yard).
      const d = 2 * this.cellM;
      const to = fleeTarget(this, c, d);
      if (to) {
        launchStep(c, to.x, to.y, now, '_flightT0');
        // Twice its distance over the crow's peak flight speed
        // (CROW_FLIGHT_MPS — a quadratic leg peaks at twice its mean): the
        // panic is in the short legs and the turn, not a faster bird (it
        // used to cross two cells in 350 ms: 40 m/s). The one pace
        // multiplier (Combat.paceMul) quickens it like every flight.
        c._flightUntilT = now + (2 * d / CROW_FLIGHT_MPS) * 1000 / Combat.paceMul(c, now, true);
        c._fleeDash = true;
        c._faceFlip = (to.x - c.x) < 0;
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
    launchStep(c, tx, ty, now, '_flightT0');
    // A glide lasts twice its distance over the crow's peak flight speed
    // (CROW_FLIGHT_MPS — a quadratic leg peaks at twice its mean: ~0.6–1.6 s
    // over the roam's 0.4–1-cell hops); a departing leg takes its row's own time
    // — the pace the hunt's odds are tuned on, the one declared exception to
    // the speed ceiling (CROW_DEPART_HOP has the reasoning).
    c._flightUntilT = now + (departing ? CROW_DEPART_HOP.ms : (2 * Math.hypot(tx - c.x, ty - c.y) / CROW_FLIGHT_MPS) * 1000) / Combat.paceMul(c, now, departing);
    c._perchUntilT = null;
    c._faceFlip = (tx - c.x) < 0;
    // This is a normal glide, not a flee dash — clear the marker so a FUTURE
    // hit mid-glide doesn't mistake this leg for an in-progress dash and
    // wrongly keep flying it out before reacting (see the fleeing branch
    // above).
    c._fleeDash = false;
  }

  catchCreature(c, sx, sy) {
    if (Combat.isTame(c)) {
      const carried = Pets.carry(this.save,c);
      if (carried) persistSave(this.save);
      return carried;
    }
    const row = Pets.bond(this.save,c);
    if (!row) return false;
    persistSave(this.save);
    const invId = c.shiny && ITEM_BY_ID[`shiny_${c.kind}`] ? `shiny_${c.kind}` : c.kind;
    this.flashLoot(`${itemName(invId)} joined you`, c.shiny ? '#ffd23a' : '#a7ffb0', 1, invId);
    if (c.shiny) this.awardShinyBonus(c.kind,sx,sy);
    PetStories.queue(this,c.kind);
    this.selectInvCat('animal');
    return row;
  }
}
