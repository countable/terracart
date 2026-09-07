// ─────────────────────────────────────────────────────────────────────────
// Lairs — the monsters squatting in a derelict structure, HARD MODE ONLY.
//
// A ruin you walk past is scenery. A ruin with something living in it is a
// decision: go around, or go in for what the building is worth. On hard
// (Difficulty.get().derelictLairs) every unclaimed structure past a safe ring
// around home holds a small garrison, and how big that garrison is grows with
// two things and only two things:
//
//   HOW BIG THE BUILDING IS — a castle is worth more guards than a fort, a
//   fort more than a house. The tiers are the world's own building tiers
//   (T.BUILDING 9 / BUILDING_MED 11 / BUILDING_LARGE 12), so "bigger" is the
//   same judgement the map already draws.
//
//   HOW FAR IT IS FROM HOME — nothing at all inside LAIR_MIN_HOME_CELLS, the
//   named figures at that ring, and a straight ramp out to LAIR_FAR_M where a
//   castle holds LAIR_MAX_PER_STRUCTURE. The map gets more dangerous the
//   further you push, which is the only pressure a GPS game can apply: it
//   cannot gate an area behind a key, so it prices the walk instead.
//
// THE NUMBERS ARE DERIVED, NOT TUNED — the same discipline as combat.js's
// dps identity. There are exactly three authored figures (TIER_GUARDS: a
// house 1, a fort 2, a castle 3, at the near ring) plus the far ceiling, and
// the distance multiplier falls out of them: FAR_MUL is the ceiling over the
// biggest base, so a castle reaches exactly LAIR_MAX_PER_STRUCTURE at
// LAIR_FAR_M and the other two tiers scale by the same factor (a fort 2 → 10,
// a house 1 → 5). Retune a lair by moving a TIER_GUARDS row or the ceiling;
// a fudge factor added here breaks the correspondence the tests pin.
//
// THEY DO NOT MOVE. A garrison is a place, not a patrol: each guard carries
// `immobile: true` and app.js's wanderCreatures skips its movement step (it
// still leeches, and it can still be killed — see the immobile branch there).
// A wandering garrison would walk itself off the building within a minute and
// the whole point — that THIS ruin is held — would be gone by the time the
// player got close enough to see it.
//
// ── WHY THE GARRISON IS WOKEN, NOT SPAWNED ───────────────────────────────
//
// Every tier-9 house is a wreck until the player rebuilds it (app.js
// `_isHouseWreck`), so "derelict structure" is very nearly "building", and a
// dense city tile carries thousands of them. Materialising a garrison for all
// of them at tile-build time is tens of thousands of creature objects on one
// tile — memory, and a per-frame `forEachItemNear` walk over every one of them.
// The first cut of this module answered that with a per-tile budget, which
// bought the frame rate at the price of most ruins simply being empty.
//
// The answer instead is RESIDENCY. Nothing is materialised at build time: a
// tile keeps only an INDEX of its eligible structures (`buildIndex`, one small
// record per footprint, bucketed on a coarse grid), and `stepResidency` — run
// on a throttle from update() — wakes the garrisons of structures within
// LAIR_WAKE_CELLS of the player and puts back to sleep the ones past
// LAIR_SLEEP_CELLS. Live creatures then track what is actually AROUND the
// player rather than what a tile happens to contain, so a city block and a
// hamlet cost the same to stand in.
//
// The wake ring clears every other radius that matters, which is what makes
// the seam invisible: it is outside the sim bubble (a guard is resident well
// before wanderCreatures will think for it), outside the sprite cull (before
// it can be drawn), and outside bow range (before it can be shot). The gap
// between wake and sleep is hysteresis — one ring would thrash a garrison on
// and off while the player stood on it.
//
// ── GENERATED, NEVER STORED — and now PER STRUCTURE ──────────────────────
//
// The traps.js contract: a lair is a pure function of the world, and the only
// thing that ever reaches the save is the id of a guard the player has killed
// (save.caught, through the ordinary resolveDefeat path — a lair guard is an
// enemy like any other and pays its bounty).
//
// Residency sharpens that from per-TILE to per-STRUCTURE. A garrison is seeded
// from its own building's identity — `structureKey`, the footprint's centre in
// ABSOLUTE cell coordinates, the same shape a castle already mints its claim
// key from — so it depends on nothing but the building itself. That is what
// makes waking safe, and it retires a whole class of hazard the per-tile stream
// had: the draw no longer depends on the ORDER the polygons come in (a rebuild
// that adds an Overpass building would have shifted every index after it), on
// how many guards a neighbouring ruin happened to seat, or on which of them the
// player had already killed. Wake a ruin at any time, in any order, from any
// tile build, and it holds exactly what it held before.
//
// Node-testable: no DOM, no Phaser. WorldGen is read for makeRng / isSpawnCell
// (the shared spawn rule — see the road-mask invariant in CLAUDE.md), and a
// test can hand in a stub.
// ─────────────────────────────────────────────────────────────────────────
(function (root) {
  'use strict';

  // ── The near ring ────────────────────────────────────────────────────────
  // No garrison within this many cells of HOME. Home is where a player is
  // sent to rest, trade and store things; a ruin across the road from it
  // holding three slimes would make the one safe place in the game a siege.
  // It is deliberately its OWN number and not CREATURE_SIM_CELLS, which it
  // happens to equal today: that one is how far a creature thinks from the
  // PLAYER, this one is how close a lair may sit to HOME. Nothing about a
  // change to either implies the other.
  const LAIR_MIN_HOME_CELLS = 12;
  // Where the ramp tops out. A kilometre is roughly a fifteen-minute walk in
  // a game whose map IS the walk, so it is far enough that reaching a maxed
  // lair is a trip you plan and near enough that one exists on a real map.
  const LAIR_FAR_M = 1000;
  // The most guards any one structure may hold, at LAIR_FAR_M.
  const LAIR_MAX_PER_STRUCTURE = 15;

  // ── The three authored figures ───────────────────────────────────────────
  // Guards at the NEAR ring, by the world's own building tier. Everything
  // else in this module is derived from these four numbers.
  const TIER_GUARDS = {
    9:  1,   // T.BUILDING       — a wrecked house
    11: 2,   // T.BUILDING_MED   — a fort
    12: 3,   // T.BUILDING_LARGE — a castle
  };
  const TIERS = [9, 11, 12];
  const MAX_TIER_GUARDS = Math.max(...Object.values(TIER_GUARDS));
  // The distance multiplier — NOT a tuned number. It is exactly what carries
  // the biggest structure from its near figure to the ceiling, so the ceiling
  // and the tier table are the only things to change.
  const FAR_MUL = LAIR_MAX_PER_STRUCTURE / MAX_TIER_GUARDS;   // 15 / 3 = 5

  // ── The roll ─────────────────────────────────────────────────────────────
  // The cap is the nominal garrison; the actual count is the cap less a
  // seeded shortfall of up to this fraction of it, so a lair is a surprise
  // rather than an arithmetic exercise the player can do from the map. Note
  // what the fraction does to the small end: a house (cap 1) and a fort
  // (cap 2) floor to no slack at all and always hold exactly their figure,
  // while a castle (cap 3) holds 2 or 3 and a maxed castle (cap 15) holds
  // 9 to 15. The named numbers are the typical ones, which is what "a castle
  // typically has 3" has to mean.
  const LAIR_SLACK = 0.4;

  // ── What is in it ────────────────────────────────────────────────────────
  // The TYPE axis, on the same distance ramp as the count: a lair near the
  // near ring holds the surface slime the player already knows, and the two
  // tougher slimes unlock further out. All three are SLIMES on purpose — the
  // ladder escalates what a garrison costs to clear without putting a goblin
  // on the surface, which is a different decision about where the cave ends.
  // Every kind here must be a registered enemy (Combat.isEnemyKind) or the
  // guards would be scenery that cannot be fought; `slime` is the surface
  // pest and the other two are rows of app.js's MONSTERS table.
  const KIND_LADDER = [
    { kind: 'slime',        minT: 0    },
    { kind: 'cave_slime',   minT: 0.34 },
    { kind: 'purple_slime', minT: 0.67 },
  ];

  // ── Residency ────────────────────────────────────────────────────────────
  // How close the player must come for a ruin's garrison to exist, and how far
  // they must go for it to stop existing. The wake ring has to clear every
  // radius that could reveal a garrison that is not there yet — the sim bubble
  // (app.js CREATURE_SIM_CELLS, 12: a creature outside it does not think), the
  // sprite cull (VIEW_CELLS/2 + 1, whose corner is under 10), and bow range
  // (Combat SHOT_SPECS bow, 8) — so nothing is ever woken in view or shot at
  // before it is woken. `assertRingsClear` is the check, called by the test.
  const LAIR_WAKE_CELLS = 16;
  // And the gap to sleep is hysteresis. One ring would wake and sleep a
  // garrison every pass while the player stood on it.
  const LAIR_SLEEP_CELLS = 20;
  // The most guards that may be woken around the player at once. This is the
  // cap that the per-tile budget was reaching for and missing: what matters is
  // not how many a TILE holds — the player is never standing in all of it —
  // but how many are around them now, which is the same question on a city
  // block and in a hamlet. In the same order as the surface slimes a hard-mode
  // tile already puts within the wake ring, several times over.
  //   Nothing is ever un-woken to make room: a garrison already standing must
  // not blink out because the player walked toward a different ruin. The cap
  // only refuses NEW wakes, nearest ruin first, and walking away frees it.
  const LAIR_LIVE_MAX = 40;
  // The coarse grid the index buckets structures on, in cells. Sized to the
  // wake ring so a residency pass reads a 3×3 block of buckets instead of
  // walking every footprint on the tile.
  const LAIR_BUCKET_CELLS = 16;
  // Footprints taken into the index per residency pass — see indexChunk. About
  // half a millisecond's worth on the densest tile the build tests use, so even
  // a cold first slice stays well inside a frame.
  const LAIR_INDEX_CHUNK = 500;

  // How far outside a structure's own footprint a guard is seated, in cells.
  // Not ON the footprint: the spec's fauna rule is that nothing stands on a
  // building footing, and a slime drawn over a roof reads as a bug however it
  // got there. One cell out is close enough to read as "this ruin is held".
  const LAIR_RING_PAD_CELLS = 1;
  // Seats attempted per guard before it is given up on. A ruin ringed by
  // water, road or another building simply holds fewer than its figure —
  // which is the same answer the fauna spawner gives, and better than
  // pushing a guard somewhere it does not belong.
  const LAIR_SEAT_TRIES = 8;

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  // 0 at the near ring, 1 at LAIR_FAR_M and beyond. Everything the difficulty
  // of a lair depends on is a function of this one number.
  function ramp(distM, cellM) {
    const near = LAIR_MIN_HOME_CELLS * cellM;
    if (!(distM > near)) return -1;          // inside the ring: no lair at all
    return clamp01((distM - near) / (LAIR_FAR_M - near));
  }

  // The nominal garrison for a structure of `tier` at `distM` from home.
  // 0 when the tier holds no lair or the structure is inside the near ring.
  function capFor(tier, distM, cellM) {
    const base = TIER_GUARDS[tier];
    if (!base) return 0;
    const t = ramp(distM, cellM);
    if (t < 0) return 0;
    return Math.min(LAIR_MAX_PER_STRUCTURE,
                    Math.round(base * (1 + t * (FAR_MUL - 1))));
  }

  // The rolled count: the cap less a seeded shortfall. Takes exactly one draw
  // so a caller can reason about the stream.
  function countFor(cap, rng) {
    if (cap <= 0) return 0;
    const slack = Math.floor(cap * LAIR_SLACK);
    return cap - (slack > 0 ? Math.floor(rng() * (slack + 1)) : 0);
  }

  // Which kinds a lair at ramp position `t` may hold, toughest last.
  function kindsAt(t) {
    return KIND_LADDER.filter((k) => t >= k.minT).map((k) => k.kind);
  }
  // One guard's kind. Uniform over what has unlocked, so a maxed lair is a
  // mixed pack rather than fifteen of the worst thing on the ladder.
  function kindFor(t, rng) {
    const ks = kindsAt(t);
    return ks[Math.min(ks.length - 1, Math.floor(rng() * ks.length))];
  }

  // THE STRUCTURE'S OWN IDENTITY, and the seed of its garrison: the centre of
  // its footprint in ABSOLUTE cell coordinates. Same shape worldgen already
  // mints a castle's claim key from, and for the same reason — it is a fact
  // about the building, so it survives a tile rebuild, an eviction, a change
  // in polygon order, and a garrison woken from a different tile of the ring.
  function structureKey(acx, acy) { return `${acx}_${acy}`; }

  // The bounding box of a buildingShapes ring (tile-local metres), or null.
  // The same read _houseBlastGeometry does — a building's SOURCE polygon is
  // the real outline, where the object's own x/y is only its icon's cell.
  function ringBox(ring) {
    if (!ring || ring.length < 6) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < ring.length; i += 2) {
      const rx = ring[i], ry = ring[i + 1];
      if (rx < x0) x0 = rx;
      if (rx > x1) x1 = rx;
      if (ry < y0) y0 = ry;
      if (ry > y1) y1 = ry;
    }
    if (!Number.isFinite(x0) || !Number.isFinite(y0)) return null;
    return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2,
             halfW: (x1 - x0) / 2, halfH: (y1 - y0) / 2 };
  }

  // ── The index ────────────────────────────────────────────────────────────
  // One record per lair-eligible footprint on the tile, bucketed on a coarse
  // grid. No rng, no creatures, no save read — just where the structures are,
  // so a residency pass can ask "which ruins are near the player" without
  // walking a city's worth of polygons every time. Built once per tile entry
  // and cached on it; a rebuilt entry is a new object and simply builds a new
  // one (CLAUDE.md's rebuild contract — there is nothing here worth carrying).
  function newIndex(cellM) {
    return { bucketM: LAIR_BUCKET_CELLS * cellM, buckets: new Map(), next: 0, done: false };
  }

  // Take up to `limit` more footprints into `idx`, resuming where the last
  // call stopped. THE INDEX IS SLICED because this is the only pass over every
  // building on the tile and a dense one carries thousands: built in one go it
  // is ~7ms on a 6000-building tile, which is a dropped frame the first time
  // the player walks into a city. update() has no slicer of its own (the
  // rasterizer's is upstream of here), so the pass carries its own cursor and
  // spends a slice of it per residency pass instead. A half-indexed tile just
  // wakes fewer ruins for a second or two, and the wake ring is four cells
  // outside the sleep ring — twenty seconds of walking — so nothing shows.
  //
  // Two allocations it deliberately avoids, both paid per building: a bucket
  // key STRING (`bucketKey` packs the two grid coordinates into one integer)
  // and the structure's `sid` string (derived at wake time, for the handful of
  // candidates that ever reach the wake ring). The bbox is inlined for the
  // same reason — ringBox allocates a record this would copy and drop.
  function indexChunk(idx, entry, tx, ty, cellM, tileEdgeM, limit) {
    const shapes = (entry && entry.buildingShapes) || [];
    const ox = tx * tileEdgeM, oy = ty * tileEdgeM;
    const bucketM = idx.bucketM, buckets = idx.buckets;
    const end = Math.min(shapes.length, idx.next + (limit > 0 ? limit : shapes.length));
    for (let si = idx.next; si < end; si++) {
      const sh = shapes[si];
      if (!sh || !TIER_GUARDS[sh.tier]) continue;
      const ring = sh.ring;
      if (!ring || ring.length < 6) continue;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < ring.length; i += 2) {
        const rx = ring[i], ry = ring[i + 1];
        if (rx < x0) x0 = rx;
        if (rx > x1) x1 = rx;
        if (ry < y0) y0 = ry;
        if (ry > y1) y1 = ry;
      }
      if (!Number.isFinite(x0) || !Number.isFinite(y0)) continue;
      const lx = (x0 + x1) / 2, ly = (y0 + y1) / 2;
      // Absolute centre — the world point the player's distance is measured
      // to, and (as a cell) the structure's identity.
      const wx = ox + lx, wy = oy + ly;
      const cand = {
        acx: Math.floor(wx / cellM), acy: Math.floor(wy / cellM),
        tier: sh.tier, key: sh.key || null,
        wx, wy,                                  // absolute metres
        lx, ly,                                  // tile-local metres (seating)
        // The origin of the tile THIS SHAPE BELONGS TO, carried rather than
        // re-derived from wx: a footprint whose centre sits a metre the wrong
        // side of the seam would otherwise be seated against the neighbour's
        // origin while indexed against this tile's grid.
        ox, oy,
        halfW: (x1 - x0) / 2, halfH: (y1 - y0) / 2,
      };
      const bk = bucketKey(Math.floor(wx / bucketM), Math.floor(wy / bucketM));
      const b = buckets.get(bk);
      if (b) b.push(cand); else buckets.set(bk, [cand]);
    }
    idx.next = end;
    idx.done = end >= shapes.length;
    return idx;
  }

  // The whole tile in one go — what a test wants, and what a small tile costs
  // anyway. The shipping path goes through indexFor, which slices.
  function buildIndex(entry, tx, ty, cellM, tileEdgeM) {
    return indexChunk(newIndex(cellM), entry, tx, ty, cellM, tileEdgeM, Infinity);
  }

  // Two bucket-grid coordinates packed into one integer. A tile is 220 cells
  // and a bucket 16, so the per-tile span is tiny; the range here is what a
  // world coordinate needs, and a collision across it would only ever merge
  // two buckets (a correctness no-op — the distance test is exact).
  const BUCKET_SPAN = 1 << 16;
  function bucketKey(bx, by) { return (bx + 32768) * BUCKET_SPAN + (by + 32768); }

  // Cached accessor — one slice per residency pass until the tile is fully
  // indexed, then free. A rebuilt entry is a new object and simply starts a new
  // index (CLAUDE.md's rebuild contract: there is nothing here worth carrying,
  // and the buildingShapes it is derived from are new too).
  function indexFor(entry, tx, ty, cellM, tileEdgeM) {
    let idx = entry._lairIndex;
    if (!idx) idx = entry._lairIndex = newIndex(cellM);
    if (!idx.done) indexChunk(idx, entry, tx, ty, cellM, tileEdgeM, LAIR_INDEX_CHUNK);
    return idx;
  }

  // ── Waking one ruin ──────────────────────────────────────────────────────
  // The guards of ONE structure, seeded from that structure alone. Returns the
  // creature objects to add — the same shape spawnInTile builds, plus
  // `immobile` and the lair's own centre (so the sleep pass can measure a
  // guard's distance without looking its building back up).
  function garrisonFor(entry, cand, opts) {
    const WG = root.WorldGen;
    const o = opts || {};
    const cellM = o.cellM, tileEdgeM = o.tileEdgeM;
    if (!WG || !entry || !entry.grid || !(cellM > 0) || !(tileEdgeM > 0)) return [];
    const home = o.homeM;
    if (!home || !Number.isFinite(home.x) || !Number.isFinite(home.y)) return [];
    const distM = Math.hypot(cand.wx - home.x, cand.wy - home.y);
    const t = ramp(distM, cellM);
    if (t < 0) return [];
    const cap = capFor(cand.tier, distM, cellM);
    if (cap <= 0) return [];

    // ONE STREAM PER STRUCTURE, seeded from the structure's own key. Nothing
    // outside this building can move a single number in it.
    const rng = WG.makeRng(hashKey(cand.sid));
    const n = countFor(cap, rng);
    const N = entry.cellsPerEdge;
    const ox = cand.ox, oy = cand.oy;
    const caught = o.caughtSet;
    const hpMemo = o.hpMemo;
    const spawnOpts = entry._spawnOpts || o.spawnOpts;
    const seatR = Math.hypot(cand.halfW, cand.halfH) + LAIR_RING_PAD_CELLS * cellM;
    const out = [];
    for (let i = 0; i < n; i++) {
      const id = `lair_${cand.sid}_${i}`;
      const kind = kindFor(t, rng);
      let seat = null;
      for (let a = 0; a < LAIR_SEAT_TRIES && !seat; a++) {
        const ang = (i / n) * Math.PI * 2 + (rng() - 0.5) * 0.8 + a * 0.7;
        const r = seatR * (1 + rng() * 0.35);
        const lx = cand.lx + Math.cos(ang) * r;
        const ly = cand.ly + Math.sin(ang) * r;
        const ix = Math.floor(lx / cellM), iy = Math.floor(ly / cellM);
        if (ix < 0 || iy < 0 || ix >= N || iy >= N) continue;
        // The ONE shared spawn rule, road mask included — a guard on the
        // carriageway is the bug CLAUDE.md's road invariant is about. The
        // options come off THE ENTRY (spawnInTile stashes the very object it
        // spawned the tile's fauna, traps and treasure with), never rebuilt
        // here: a second reading of "is this a road" is how the two drift.
        if (!WG.isSpawnCell(entry.grid, N, N, ix, iy, spawnOpts)) continue;
        seat = { x: ox + (ix + 0.5) * cellM, y: oy + (iy + 0.5) * cellM };
      }
      if (!seat) continue;                    // ringed by water / road / building
      // Already killed. The draws above ran anyway — see the note below.
      if (caught && caught.has(id)) continue;
      const g = {
        x: seat.x, y: seat.y, kind, id, shiny: false,
        immobile: true, lair: cand.sid, lairX: cand.wx, lairY: cand.wy,
      };
      // A guard the player wounded and walked away from comes back wounded.
      // Session-only, like every other creature's `_hp` (combat.js) — it is
      // the sleep/wake cycle this covers, not a reload.
      if (hpMemo && hpMemo.has(id)) g._hp = hpMemo.get(id);
      out.push(g);
    }
    return out;
  }

  // A 32-bit hash of the structure key, for makeRng. Two neighbouring
  // buildings differ in one cell coordinate, so the mixing matters more here
  // than the range does.
  function hashKey(sid) {
    let h = 0x811c9dc5;
    for (let i = 0; i < sid.length; i++) {
      h ^= sid.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h >>> 0;
  }

  // ── The residency pass ───────────────────────────────────────────────────
  // Run on a throttle from app.js update(). Mutates each entry's `creatures`
  // in place: garrisons within the wake ring are added, garrisons past the
  // sleep ring are removed. Returns a small report for the tests.
  //
  //   ring   [{ entry, tx, ty }] — the player's 3×3 tile neighbourhood
  //   opts   cellM, tileEdgeM, playerM {x,y}, homeM {x,y},
  //          isClaimed(key), caughtSet, hpMemo (Map id → hp, session-only),
  //          liveMax (test override)
  function stepResidency(ring, opts) {
    const o = opts || {};
    const cellM = o.cellM, tileEdgeM = o.tileEdgeM, p = o.playerM;
    const report = { woken: 0, slept: 0, live: 0 };
    if (!ring || !ring.length || !(cellM > 0) || !(tileEdgeM > 0) || !p) return report;
    const wakeR = LAIR_WAKE_CELLS * cellM, wakeR2 = wakeR * wakeR;
    const sleepR2 = (LAIR_SLEEP_CELLS * cellM) * (LAIR_SLEEP_CELLS * cellM);
    const liveMax = Number.isFinite(o.liveMax) ? o.liveMax : LAIR_LIVE_MAX;
    const isClaimed = typeof o.isClaimed === 'function' ? o.isClaimed : () => false;
    const hpMemo = o.hpMemo;

    // ── Sleep, and count what is left standing ──────────────────────────
    // One compacting walk per entry — never a splice per removal, which is
    // the quadratic CLAUDE.md's tile-build rule warns about in the other
    // direction.
    //
    // THE RESIDENT SET IS NOT REBUILT FROM THE CREATURES. It has to outlive
    // them: a ruin the player has CLEARED holds no creatures at all, and one
    // whose seats were all refused never had any, and neither may be re-rolled
    // on every pass for the rest of the session. So the set persists, a wake
    // adds to it, and only the sleep below takes anything out. A rebuilt entry
    // is a new object and arrives without one (CLAUDE.md's rebuild contract) —
    // it is derived from the carried creatures that once, which loses only the
    // memory of the empty ruins and costs one re-roll each.
    const caught = o.caughtSet;
    let live = 0;
    for (const t of ring) {
      const entry = t && t.entry;
      if (!entry) continue;
      const arr = entry.creatures;
      if (!entry._lairResident) {
        const derived = new Set();
        if (arr) for (const c of arr) { if (c && c.lair) derived.add(c.lair); }
        entry._lairResident = derived;
      }
      if (!arr || !arr.length) continue;
      const resident = entry._lairResident;
      const slept = new Set(), kept = new Set();
      let w = 0;
      for (let i = 0; i < arr.length; i++) {
        const c = arr[i];
        if (c && c.lair) {
          const dx = c.lairX - p.x, dy = c.lairY - p.y;
          if (dx * dx + dy * dy > sleepR2) {
            // Remember the wound before letting it go, then drop it.
            if (hpMemo && Number.isFinite(c._hp)) hpMemo.set(c.id, c._hp);
            slept.add(c.lair);
            report.slept++;
            continue;
          }
          kept.add(c.lair);
          // A DEAD guard is still in the array — resolveDefeat marks
          // save.caught and leaves the object for the caught filters
          // downstream — but it is not a monster standing anywhere, so it must
          // not hold the live cap shut. A district the player has cleared
          // should let the next ruin in, not stay full of corpses.
          if (!(caught && caught.has(c.id))) live++;
        }
        arr[w++] = c;
      }
      arr.length = w;
      // A lair leaves the resident set only when its LAST guard slept — never
      // when its last guard was killed.
      for (const sid of slept) if (!kept.has(sid)) resident.delete(sid);
    }

    // ── Wake, nearest ruin first ────────────────────────────────────────
    // Gather the candidates in range across the ring, then take them in order
    // of distance so the cap, when it binds, refuses the FURTHEST — the ones
    // the player is least likely to be looking at.
    if (live >= liveMax) { report.live = live; return report; }
    const near = [];
    for (const t of ring) {
      const entry = t && t.entry;
      if (!entry || !entry.grid) continue;
      // A tile whose spawn pass has not run yet has no shared spawn options,
      // and the road rule is not something to approximate — skip it and pick
      // it up on the next pass.
      if (!entry._spawnOpts) continue;
      const idx = indexFor(entry, t.tx, t.ty, cellM, tileEdgeM);
      const resident = entry._lairResident;
      if (!resident) continue;          // set by the sleep pass above
      const bm = idx.bucketM;
      const bx0 = Math.floor((p.x - wakeR) / bm), bx1 = Math.floor((p.x + wakeR) / bm);
      const by0 = Math.floor((p.y - wakeR) / bm), by1 = Math.floor((p.y + wakeR) / bm);
      for (let by = by0; by <= by1; by++) {
        for (let bx = bx0; bx <= bx1; bx++) {
          const b = idx.buckets.get(bucketKey(bx, by));
          if (!b) continue;
          for (const cand of b) {
            const dx = cand.wx - p.x, dy = cand.wy - p.y;
            const d2 = dx * dx + dy * dy;
            if (d2 > wakeR2) continue;
            // The structure's own key, built HERE rather than in the index:
            // only the few candidates that reach the wake ring ever need it,
            // and the index runs over every building on the tile.
            if (!cand.sid) cand.sid = structureKey(cand.acx, cand.acy);
            if (resident.has(cand.sid)) continue;
            // A structure the player has taken back is not derelict any more —
            // the same isClaimedKey test the derelict wash reads, so what is
            // lit as yours is what holds no monsters.
            if (cand.key && isClaimed(cand.key)) continue;
            near.push({ d2, cand, entry, resident });
          }
        }
      }
    }
    near.sort((a, b) => a.d2 - b.d2);
    for (const n of near) {
      if (live >= liveMax) break;
      const guards = garrisonFor(n.entry, n.cand, o);
      // Mark it resident even when it woke EMPTY — a ruin the player has
      // cleared, or one with nowhere to stand, must not be re-rolled on every
      // pass for the rest of the session.
      n.resident.add(n.cand.sid);
      if (!guards.length) continue;
      if (!n.entry.creatures) n.entry.creatures = [];
      for (const g of guards) n.entry.creatures.push(g);
      live += guards.length;
      report.woken += guards.length;
    }
    report.live = live;
    return report;
  }

  // The rings this module depends on clearing, for the test to check against
  // the numbers app.js and combat.js actually own. Waking a garrison inside
  // any of these would let the player watch one appear, or shoot at a ruin
  // that is still empty.
  function assertRingsClear(simCells, cullCornerCells, shotCells) {
    return LAIR_WAKE_CELLS > simCells &&
           LAIR_WAKE_CELLS > cullCornerCells &&
           LAIR_WAKE_CELLS > shotCells &&
           LAIR_SLEEP_CELLS > LAIR_WAKE_CELLS;
  }

  root.Lairs = {
    LAIR_MIN_HOME_CELLS, LAIR_FAR_M, LAIR_MAX_PER_STRUCTURE, LAIR_SLACK,
    LAIR_WAKE_CELLS, LAIR_SLEEP_CELLS, LAIR_LIVE_MAX, LAIR_BUCKET_CELLS,
    LAIR_RING_PAD_CELLS, LAIR_SEAT_TRIES, LAIR_INDEX_CHUNK,
    TIER_GUARDS, TIERS, MAX_TIER_GUARDS, FAR_MUL, KIND_LADDER,
    ramp, capFor, countFor, kindsAt, kindFor, structureKey, hashKey, ringBox,
    bucketKey,
    newIndex, indexChunk, buildIndex, indexFor, garrisonFor, stepResidency,
    assertRingsClear,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
