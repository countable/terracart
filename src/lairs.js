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
// GENERATED, NEVER STORED — the traps.js contract, for the same reasons. Where
// a lair is and what is in it is a pure function of the tile's coordinates
// through WorldGen.makeRng, so a tile evicted and rebuilt lays the identical
// garrison, and the ONLY thing that reaches the save is the id of a guard the
// player has killed (save.caught, via the ordinary resolveDefeat path — a lair
// guard is an enemy like any other and pays its bounty). This module seeds its
// OWN rng stream off (tx, ty) rather than drawing from spawnInTile's, because
// taking numbers out of that long chain would re-roll every world seed
// downstream of it.
//
// THE TILE BUDGET IS NOT OPTIONAL. Every tier-9 house is a wreck until the
// player rebuilds it (app.js `_isHouseWreck`), so "derelict structure" is very
// nearly "building" — and a dense city tile carries thousands. At 1..5 guards
// each that is tens of thousands of creatures on one tile, which is not a
// difficulty setting, it is a hang. LAIR_TILE_BUDGET caps the total and it is
// spent LARGEST TIER FIRST, so the castles and forts — the landmarks a player
// actually walks toward — always hold their garrison and the long tail of
// wrecked houses fills whatever is left.
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
    9:  1,   // T.BUILDING      — a wrecked house
    11: 2,   // T.BUILDING_MED  — a fort
    12: 3,   // T.BUILDING_LARGE — a castle
  };
  // Largest-first, so the tile budget below is spent on the landmarks. Frozen
  // at load rather than sorted per tile: three entries, and a tile build has
  // no business sorting anything it can look up.
  const TIER_ORDER = [12, 11, 9];
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

  // ── The tile budget ──────────────────────────────────────────────────────
  // See the header. In the same order of magnitude as the slimes a hard-mode
  // tile already carries (BIOME_FAUNA slime base 50, doubled by
  // Difficulty.slimeCountMul), so a tile whose budget binds is not carrying
  // an unusual population — it is carrying a differently ARRANGED one.
  const LAIR_TILE_BUDGET = 60;
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
  // Strides for the scattered bucket walk in spawnForTile — the first one
  // that does not divide the bucket length is coprime with it, so stepping by
  // it visits every entry exactly once. Primes, largest first, so a short
  // bucket still gets a wide stride; 1 is the fallback for a length that
  // divides them all, which only happens below the smallest of them.
  const STRIDE_PRIMES = [31, 17, 7, 3, 2];

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

  // ── The pass ─────────────────────────────────────────────────────────────
  // Returns the creature objects to push into entry.creatures — the same shape
  // spawnInTile builds, plus `immobile`. Pure: it reads the entry and the
  // options, and writes nothing.
  //
  //   entry      the tile cache entry (grid, cellsPerEdge, roadMask, buildingShapes)
  //   tx, ty     tile coords — the seed, and the tile-local → absolute origin
  //   opts:
  //     cellM, tileEdgeM   the tile's basis
  //     homeM              {x, y} absolute metres — the FROZEN starter anchor,
  //                        never a live player position (see the header)
  //     isClaimed(key)     the caller's claim test (app.js isClaimedKey)
  //     caughtSet          Set of ids already defeated — a guard in it is not
  //                        re-seated, so a cleared lair stays cleared
  //     spawnOpts          the shared WorldGen.isSpawnCell options, ROAD MASK
  //                        INCLUDED (CLAUDE.md's road invariant)
  //     budget             optional override of LAIR_TILE_BUDGET (tests)
  function spawnForTile(entry, tx, ty, opts) {
    const o = opts || {};
    const WG = root.WorldGen;
    const cellM = o.cellM, tileEdgeM = o.tileEdgeM, home = o.homeM;
    if (!WG || !entry || !entry.grid || !(cellM > 0) || !(tileEdgeM > 0)) return [];
    // No anchor yet (a fresh save still waiting on its first fix) means no
    // distance to measure, so no lair — exactly as the pest amnesty declines
    // to place anything it cannot centre. The tile lays them on its next
    // build, once the anchor has frozen.
    if (!home || !Number.isFinite(home.x) || !Number.isFinite(home.y)) return [];
    const shapes = entry.buildingShapes;
    if (!shapes || !shapes.length) return [];

    // Own stream, off the tile's coordinates — never the caller's rng (see
    // the header). The salt is this module's own so it cannot collide with
    // the trap streams or the tile's fauna stream.
    const rng = WG.makeRng(((tx * 0x27d4eb2d) ^ (ty * 0xc2b2ae35) ^ 0x6c078965) >>> 0);
    const N = entry.cellsPerEdge;
    const ox = tx * tileEdgeM, oy = ty * tileEdgeM;
    const isClaimed = typeof o.isClaimed === 'function' ? o.isClaimed : () => false;
    const caught = o.caughtSet;
    let budget = Number.isFinite(o.budget) ? o.budget : LAIR_TILE_BUDGET;
    const out = [];

    // Bucket the shapes by tier in ONE walk, so the three passes below are a
    // lookup rather than three filters of the whole list — a dense tile
    // carries thousands of these and the post-rasterize path has no slicer to
    // hand a frame back from (CLAUDE.md).
    const buckets = new Map();
    for (const tier of TIER_ORDER) buckets.set(tier, []);
    for (let si = 0; si < shapes.length; si++) {
      const sh = shapes[si];
      const b = sh && buckets.get(sh.tier);
      if (b) b.push(si);
    }

    // Largest tier first — the budget belongs to the landmarks.
    for (const tier of TIER_ORDER) {
      if (budget <= 0) break;
      const bucket = buckets.get(tier);
      if (!bucket.length) continue;
      // WALK THE BUCKET SCATTERED, NOT IN ORDER. worldgen pushes building
      // polygons in the order it rasterized them, which is broadly spatial —
      // so a budget spent front-to-back would garrison one CORNER of the tile
      // and leave the rest of it empty, and the player would learn to read the
      // seam rather than the buildings. A seeded start plus a stride coprime
      // to the bucket length visits every entry exactly once in an order
      // spread across the whole list, in O(n) and with no shuffle to allocate.
      const len = bucket.length;
      let step = 1;
      for (const p of STRIDE_PRIMES) { if (len % p !== 0) { step = p; break; } }
      const off = Math.floor(rng() * len);
      for (let k = 0; k < len; k++) {
        if (budget <= 0) break;
        const si = bucket[(off + k * step) % len];
        const sh = shapes[si];
        // A structure the player has taken back is not derelict any more —
        // the same isClaimedKey test the derelict wash reads, so what is lit
        // as yours is what holds no monsters.
        if (sh.key && isClaimed(sh.key)) continue;
        const box = ringBox(sh.ring);
        if (!box) continue;
        const wx = ox + box.cx, wy = oy + box.cy;
        const distM = Math.hypot(wx - home.x, wy - home.y);
        const t = ramp(distM, cellM);
        if (t < 0) continue;                       // inside the near ring
        const cap = capFor(tier, distM, cellM);
        if (cap <= 0) continue;
        const n = countFor(cap, rng);
        // Seat them on a ring just clear of the footprint, spread evenly with
        // a seeded jitter so a garrison does not read as a drawn circle.
        const seatR = Math.hypot(box.halfW, box.halfH) + LAIR_RING_PAD_CELLS * cellM;
        // THE DRAWS BELOW MUST NOT DEPEND ON THE SAVE. Every guard rolls its
        // kind and its seat whether or not it survives the two filters after,
        // and a guard that found a seat spends the tile's budget even when the
        // player has already killed it. Skipping the roll for a defeated guard
        // would take numbers out of this stream, so clearing one lair would
        // re-seat every guard the tile lays after it — the world would rearrange
        // itself behind the player, which is exactly what "generated, never
        // stored" is supposed to rule out. The cost of holding that line is one
        // budget slot left standing empty at a cleared lair; the alternative is
        // a tile that is a different tile depending on what you have done.
        for (let i = 0; i < n; i++) {
          const id = `lair_${tx}_${ty}_${si}_${i}`;
          const kind = kindFor(t, rng);
          let seat = null;
          for (let a = 0; a < LAIR_SEAT_TRIES && !seat; a++) {
            const ang = (i / n) * Math.PI * 2 + (rng() - 0.5) * 0.8 + a * 0.7;
            const r = seatR * (1 + rng() * 0.35);
            const lx = box.cx + Math.cos(ang) * r;
            const ly = box.cy + Math.sin(ang) * r;
            const ix = Math.floor(lx / cellM), iy = Math.floor(ly / cellM);
            if (ix < 0 || iy < 0 || ix >= N || iy >= N) continue;
            // The ONE shared spawn rule, road mask included — a guard on the
            // carriageway is the bug CLAUDE.md's road invariant is about, and
            // this pass gets the mask by passing the tile's own spawnOpts
            // rather than re-deriving "is this a road" from the terrain.
            if (!WG.isSpawnCell(entry.grid, N, N, ix, iy, o.spawnOpts)) continue;
            seat = { x: ox + (ix + 0.5) * cellM, y: oy + (iy + 0.5) * cellM };
          }
          if (!seat) continue;              // ringed by water / road / building
          budget--;                          // spent by the seat, not by the push
          if (caught && caught.has(id)) continue;   // this one is already dead
          if (budget < 0) continue;          // tile budget exhausted mid-structure
          out.push({ x: seat.x, y: seat.y, kind, id, shiny: false, immobile: true });
        }
      }
    }
    return out;
  }

  root.Lairs = {
    LAIR_MIN_HOME_CELLS, LAIR_FAR_M, LAIR_MAX_PER_STRUCTURE,
    LAIR_SLACK, LAIR_TILE_BUDGET, LAIR_RING_PAD_CELLS, LAIR_SEAT_TRIES,
    TIER_GUARDS, TIER_ORDER, MAX_TIER_GUARDS, FAR_MUL, KIND_LADDER,
    ramp, capFor, countFor, kindsAt, kindFor, ringBox, spawnForTile,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
