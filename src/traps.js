// src/traps.js — hidden traps: where they are, and what stepping on one costs.
//
// A trap is the cheapest possible piece of world state: NOTHING is stored
// until you step on one — or disarm one. Where the traps are is a pure
// function of the tile's coordinates (and, underground, its depth) through
// WorldGen.makeRng — exactly like the X-mark scatter, the wild plants and the
// cave rocks. The only things that ever reach the save are the ids of traps
// the player has SPRUNG (save.sprungTraps, which is what makes a revealed
// trap stay revealed across a reload) and DISARMED (save.disarmedTraps, spent
// with a Trap Disarm Kit — see the 'disarm-trap' handler in interact.js —
// which makes a removed trap stay removed). A tile evicted from the cache and
// rasterized again lays the same traps in the same cells; a tile REBUILT
// under the player (see CLAUDE.md) re-runs the spawn pass because the rebuild
// drops `entry._spawned`, and lays the same set again — sprung and disarmed
// ids still apply to it, since the ids are derived from the tile's own
// coordinates and never change.
//
// The two placements:
//   • SURFACE — BESIDE A FOOTPATH (a walkable cell 8-adjacent to T.PATH, never
//     the path itself) or on the EDGE OF A PARK (a park cell 8-adjacent to
//     other ground), and NEVER near a road: no road cell (any tier, or the
//     drawn band `roadMask`) within TRAP_ROAD_CLEAR_CELLS, and never inside
//     the major roads' kerb buffer (WorldGen.inMajorBuffer). The owner's
//     safety pass, Sep 2026: a trap must never be a reason to step toward a
//     road, and never force a detour onto one. The cell a trap lands on is
//     cleared by the shared WorldGen.isSpawnCell rule (mask + occupied + the
//     no-spawn masks) like every other spawner. See trapGroundKind.
//   • CAVES — on CAVE_FLOOR, around the level's up-staircases (the same anchors
//     the monsters and the loose coins use), off any cell an object already
//     holds so a trap is never hidden under a rock sprite.
//
// Each spawner seeds its OWN rng rather than drawing from the caller's. The
// tile spawners are long chains of draws off one stream (spawnInTile rolls
// fauna, then treasure, then the path bonus…), so taking numbers out of that
// stream would re-roll every world seed downstream of it. A separate stream
// costs nothing and leaves every existing world exactly as it was.
//
// Depends on globals: WorldGen (makeRng, isSpawnCell, T) — read at CALL time,
// so this module can load before worldgen.js.
//
// Audit it: node test/node/run.js › test/node/traps.test.js.

(function (root) {
  'use strict';

  // ── What a trap costs ────────────────────────────────────────────────────
  // Stepping on a hidden one is a BITE: a tenth of a full bar (STARTING_ENERGY
  // is 100) in one go, the same order as a bare-handed rock break. Standing on
  // the sprung one is a bleed the player is meant to walk out of, at the
  // mode's rate (Difficulty trapBleedPerS — standEnergyPerS).
  const STEP_ENERGY = 10;
  function standEnergyPerS() {
    return root.Difficulty?.get?.().trapBleedPerS ?? 1;
  }

  // ── How many, and where ──────────────────────────────────────────────────
  // A tile is ~236 cells (≈1.65 km) on an edge — about 21 screens across — so
  // these BASE counts read as "one every dozen-odd screens of footpath", not
  // a minefield. The mode and the depth scale up from here — see countMul
  // below.
  const SURFACE_TRAP_MIN = 10, SURFACE_TRAP_SPAN = 9;    // 10..18 per surface tile, base rate
  // How many trap-ground cells the one-pass scan below keeps to choose from.
  // It only needs to exceed the trap count comfortably because it samples the
  // whole ground uniformly (see sampleTrapCells); more buys nothing but
  // room for the isSpawnCell rejections. A countMul > 1 asks for more traps
  // than this reservoir can supply candidates for, so spawnSurface widens it
  // in that case; left alone at the base rate so every existing seed and test
  // keeps drawing the exact same rng sequence.
  const TRAP_GROUND_SAMPLE = 96;
  // DANGER: every surface tile rolls how trapped its paths are, a multiplier
  // on the count uniform in [DANGER_MIN, DANGER_MAX] — mean 1, so the mode's
  // average density (trapCountMul) is unchanged; the SPREAD is what it buys:
  // one neighbourhood's paths nearly clean, the next a gauntlet at 5-6x the
  // first. A fact of the PLACE (seeded from the tile alone, on its own stream
  // — never the placement stream below, so the draws that pick cells don't
  // shift), so every player and both modes agree which quarter is the bad one.
  // Surface only: the caves have their own climb with depth.
  const DANGER_MIN = 0.3, DANGER_MAX = 1.7;
  function tileDanger(tx, ty) {
    const WG = root.WorldGen;
    const r = WG.makeRng(((tx * 0x6c8e9cf5) ^ (ty * 0x3c6ef372) ^ 0x7feb352d) >>> 0)();
    return DANGER_MIN + r * (DANGER_MAX - DANGER_MIN);
  }
  // Caves: fewer, but they climb with depth — and they sit where the player
  // actually walks (around the entrances), like the monsters and coins.
  const CAVE_TRAP_MIN = 5, CAVE_TRAP_SPAN = 5, CAVE_TRAP_PER_DEPTH = 1;
  const CAVE_TRAP_DEPTH_CAP = 8;      // depth past which the bonus stops growing
  const CAVE_SPAWN_R = 25;            // cells around each anchor — matches the monster/coin spread
  // Dungeons are dangerous on EITHER game mode, so their density multiplier is
  // flat rather than read off Difficulty (which only scales the surface rate —
  // Difficulty.PROFILES[mode].trapCountMul, 10x easy / 25x hard). Named here,
  // beside the base counts it scales, rather than inlined at the one call site
  // in app.js that reads it.
  const DUNGEON_DENSITY_MUL = 100;

  // Placement attempts per trap. A rejected attempt drops that trap rather
  // than searching harder; small scatter variance is fine (the X scatter in
  // app.js makes the same trade).
  const ATTEMPTS = 8;

  // ── The sprung set ───────────────────────────────────────────────────────
  // save.sprungTraps is a flat array of ids, like save.picked / save.opened.
  // It — and save.disarmedTraps below — are the ONLY things about a trap
  // that are ever written down. The RENDERER does not read it through here —
  // it goes through util.js's memoised setOf, because it asks once a frame
  // and a fresh Set every frame is exactly the allocation setOf exists to
  // avoid.
  function isSprung(save, id) {
    if (!save || !id) return false;
    const arr = save.sprungTraps;
    return !!arr && arr.indexOf(id) >= 0;
  }
  // Record a spring. Returns false when it was already recorded, so a caller
  // can tell "the trap just went off" from "the player is still standing on
  // one that already did".
  function spring(save, id) {
    if (!save || !id) return false;
    if (!Array.isArray(save.sprungTraps)) save.sprungTraps = [];
    if (save.sprungTraps.indexOf(id) >= 0) return false;
    save.sprungTraps.push(id);
    return true;
  }

  // ── The disarmed set ─────────────────────────────────────────────────────
  // save.disarmedTraps is the same shape as save.sprungTraps, and disjoint
  // from it in EFFECT (a trap can be recorded in both — springing it first
  // and disarming it after is a perfectly normal order of events — but once
  // an id is in here it is gone for every consumer: the per-frame bite/bleed
  // tick and the renderer both treat it as if it were never laid). Written
  // by the 'disarm-trap' tap handler (interact.js) when a Trap Disarm Kit is
  // spent on a trap's own cell — hidden or already sprung, surface or cave.
  function isDisarmed(save, id) {
    if (!save || !id) return false;
    const arr = save.disarmedTraps;
    return !!arr && arr.indexOf(id) >= 0;
  }
  // Record a disarm. Returns false when it was already recorded, so a caller
  // (the tap handler) can tell "spend the kit" from "nothing to spend it on".
  function disarm(save, id) {
    if (!save || !id) return false;
    if (!Array.isArray(save.disarmedTraps)) save.disarmedTraps = [];
    if (save.disarmedTraps.indexOf(id) >= 0) return false;
    save.disarmedTraps.push(id);
    return true;
  }

  // World-metre centre of local cell (lix, liy) on tile (tx, ty), and the trap
  // record itself. `_ix`/`_iy` are the LOCAL cell indices — what the per-frame
  // "is there a trap under me" lookup compares against — and x/y are what the
  // renderer projects, the same pair every other world item carries.
  function makeTrap(tx, ty, tileEdgeM, N, lix, liy, id) {
    const mPerCell = tileEdgeM / N;
    return {
      id,
      x: tx * tileEdgeM + (lix + 0.5) * mPerCell,
      y: ty * tileEdgeM + (liy + 0.5) * mPerCell,
      _ix: lix, _iy: liy,
    };
  }

  // ── The trap ground ──────────────────────────────────────────────────────
  // Surface traps belong to the FOOTPATHS and the PARK EDGES — the ground a
  // walker crosses on foot, away from traffic — and nowhere near a road.
  // A snare on a kerb is a reason to step into the street, and waste ground
  // (T.WASTELAND) is not trap ground either: "only on paths and park edges".
  //
  //   PATH-SIDE (1) — a walkable cell 8-adjacent to a T.PATH cell, never the
  //     path itself: the snare lies BESIDE the way, so walking the path never
  //     steps on one and never has to leave it.
  //   PARK EDGE (2) — a T.PARK cell (the LAND's class: the zone halo's
  //     `under` first) 8-adjacent to ground that is not park.
  //   Either way: not on the drawn band (roadMask), not inside the kerb
  //     buffer (WorldGen.inMajorBuffer off roadClass), and no road cell —
  //     any road tier on the grid, or a roadMask cell — within
  //     TRAP_ROAD_CLEAR_CELLS (Chebyshev). A sidewalk's far side is two cells
  //     from its road's band edge, so a sidewalk carries no snare.
  //
  // What this is NOT: a verge rule (isRoadside is gone) and not the goblin
  // trapper's snare (canLay — session state, but it refuses the same buffer).
  const TRAP_ROAD_CLEAR_CELLS = 2;
  const landAt = (grid, under, i) => root.Zones.landAt(grid, under, i);
  // Is any road cell within TRAP_ROAD_CLEAR_CELLS of (cx, cy)? ALLOWLISTED
  // raw roadMask read (spawn_gate_sweep.test.js): GEOMETRY, not the gate —
  // this defines the SHAPE of trap ground (how close a road may come before
  // a cell stops counting as path-side/park-edge at all), read by
  // trapGroundKind/sampleTrapCells to build the candidate pool. Whether a
  // candidate may actually be SEATED is spawnSurface's isSpawnCell('hazard')
  // call below, the gate proper.
  function nearRoad(grid, roadMask, w, h, cx, cy) {
    const WG = root.WorldGen;
    return !!WG.boxCells(w, h, cx, cy, TRAP_ROAD_CLEAR_CELLS,
      (x, y, i) => WG.isRoadTerrain(grid[i]) || (roadMask && roadMask[i]));
  }
  // `under` (optional): the codes an influence zone's HALO painted over
  // (src/zones.js — entry.zone.under, optional presence mask): the park test reads the
  // LAND's class, so the zones never move a trap. `roadMask` (optional): the
  // drawn band — spawnSurface passes the spawn options' own.
  function isTrapGround(grid, roadClass, w, h, cx, cy, under, roadMask) {
    return trapGroundKind(grid, roadClass, w, h, cx, cy, under, roadMask) !== 0;
  }
  // Which trap ground a cell is: 1 beside a footpath, 2 a park's edge, 0
  // neither. The two are sampled and capped apart (spawnSurface).
  function trapGroundKind(grid, roadClass, w, h, cx, cy, under, roadMask) {
    const WG = root.WorldGen;
    if (!grid || !WG || cx < 0 || cy < 0 || cx >= w || cy >= h) return 0;
    const T = WG.T;
    const i = cy * w + cx;
    const here = grid[i];
    if (here === T.PATH || !WG.isWalkable(here)) return 0;
    // ALLOWLISTED raw roadMask read (spawn_gate_sweep.test.js): GEOMETRY, not
    // the gate — see the note below.
    if (roadMask && roadMask[i]) return 0;
    // The GROUND's shape, not the gate: the pool (and so the per-ground caps)
    // counts only ground a snare could ever hold. Whether one may be SEATED
    // is the spawn gate's answer ('enemy' — spawnSurface). The kerb buffer is
    // the snare's own ground rule, here: a snare does not move, so the gate's
    // KERB reason (fast movers only) is not its.
    if (WG.inMajorBuffer && WG.inMajorBuffer(roadClass, w, cx, cy)) return 0;
    let kind = 0;
    if (WG.anyNeighbour8(w, h, cx, cy, (x, y, j) => grid[j] === T.PATH)) kind = 1;
    else if (landAt(grid, under, i) === T.PARK
      && WG.anyNeighbour8(w, h, cx, cy, (x, y, j) => landAt(grid, under, j) !== T.PARK)) kind = 2;
    if (!kind) return 0;
    return nearRoad(grid, roadMask, w, h, cx, cy) ? 0 : kind;
  }

  // Up to `k` trap-ground cells, sampled UNIFORMLY across the tile in a single
  // pass (reservoir sampling — algorithm R), as flat grid indices, plus
  // `seen`: how many trap-ground cells the tile has in all (the density cap
  // in spawnSurface reads it).
  //
  // The reservoir rather than a list because of the SIZE of the thing being
  // sampled: a park-rich tile's trap ground runs to thousands of cells, of
  // which this uses a few dozen. It holds a fixed k and never grows.
  // TWO reservoirs off the one pass and the one rng — the path-side ground's
  // and the park edge's (`path`, `park`: { cells, seen } each); `cells` /
  // `seen` are their union.
  // A PREFILTER keeps the pass cheap (it runs in the unsliced spawn pass):
  // a cell can only be trap ground if it touches a path or is park, so the
  // path cells mark their ring once and trapGroundKind — the one definition —
  // is asked only of those and of park cells. Same verdicts, same order.
  // (A steps generator — the spawn pass drives it sliced, yielding every
  // block of rows; sampleTrapCells runs it straight through.)
  const drive = (it) => root.WorldGen.runSteps(it);
  function sampleTrapCells(grid, roadClass, w, h, rng, k, under, roadMask) {
    return drive(sampleTrapCellsSteps(grid, roadClass, w, h, rng, k, under, roadMask));
  }
  function* sampleTrapCellsSteps(grid, roadClass, w, h, rng, k, under, roadMask) {
    const pools = [null, { cells: [], seen: 0 }, { cells: [], seen: 0 }];
    const WG = root.WorldGen;
    if (!grid || !WG) return { cells: [], seen: 0, path: pools[1], park: pools[2] };
    const PATH = WG.T.PATH, PARK = WG.T.PARK;
    const nearPath = new Uint8Array(w * h);
    for (let cy = 0; cy < h; cy++) {
      if ((cy & 63) === 63) yield 'trap path ring';
      for (let cx = 0; cx < w; cx++) {
        if (grid[cy * w + cx] !== PATH) continue;
        for (let y = Math.max(0, cy - 1); y <= Math.min(h - 1, cy + 1); y++) {
          for (let x = Math.max(0, cx - 1); x <= Math.min(w - 1, cx + 1); x++) nearPath[y * w + x] = 1;
        }
      }
    }
    for (let cy = 0; cy < h; cy++) {
      if ((cy & 31) === 31) yield 'trap ground';
      for (let cx = 0; cx < w; cx++) {
        const i = cy * w + cx;
        if (!nearPath[i] && landAt(grid, under, i) !== PARK) continue;
        const kind = trapGroundKind(grid, roadClass, w, h, cx, cy, under, roadMask);
        if (!kind) continue;
        const P = pools[kind];
        if (P.cells.length < k) P.cells.push(cy * w + cx);
        else {
          const r = Math.floor(rng() * (P.seen + 1));
          if (r < k) P.cells[r] = cy * w + cx;
        }
        P.seen++;
      }
    }
    return { cells: pools[1].cells.concat(pools[2].cells), seen: pools[1].seen + pools[2].seen,
      path: pools[1], park: pools[2] };
  }

  // ── Surface spawn ────────────────────────────────────────────────────────
  // `spawnOpts` is the caller's shared spawn options — the SAME object every
  // other spawner in spawnInTile passes to WorldGen.isSpawnCell (roadMask +
  // occupied + the tile's POI anchors + the no-spawn masks), so a trap obeys
  // the road rule and the private-yard frontage rule by construction rather
  // than by a copy of them; its roadMask is also the band the trap ground
  // keeps TRAP_ROAD_CLEAR_CELLS clear of.
  // A tile with no footpath and no park edge clear of the roads gets no traps.
  // `countMul` scales the base 10..18 rate — the caller passes
  // Difficulty.get().trapCountMul (10x easy / 25x hard) and tileDanger's
  // per-tile spread — so this module stays free of a Difficulty dependency.
  //
  // THE DENSITY CAP. The count is the mode's and the tile's; the ground it
  // lands on is a fraction of the tile, so the count is capped at a SHARE of
  // the tile's trap ground, and the share scales with the same multiplier the
  // count does (TRAP_GROUND_SHARE_PER_MUL × countMul × tileDanger ×
  // TRAP_GROUND_DENSITY_MUL) — the mode and the place still decide how bad a
  // path is, and a tile with only a stub of footpath cannot turn it into a
  // solid minefield. The cap reads the sampled pools' sizes, not a draw, so
  // no stream moves because of it.
  const TRAP_GROUND_SHARE_PER_MUL = 0.003;
  // Path-side and park-edge ground carry this many times the plain share —
  // easy tops out at 6% of that ground, hard at 15%. MEASURED (Sep 2026, the
  // 36-tile city census, easy): 257 / 408 / 716 / 281 traps over nine tiles of
  // Kelowna / Vancouver / Berlin / Seattle — fewer than the old road verges,
  // on purpose.
  const TRAP_GROUND_DENSITY_MUL = 2;
  // `under`: the zone halo's replaced codes (see isTrapGround), or omitted.
  function spawnSurface(grid, roadClass, w, h, tx, ty, tileEdgeM, spawnOpts, countMul, under) {
    return drive(spawnSurfaceSteps(grid, roadClass, w, h, tx, ty, tileEdgeM, spawnOpts, countMul, under));
  }
  // The same draw as a steps generator (spawnInTileSteps rides it sliced).
  function* spawnSurfaceSteps(grid, roadClass, w, h, tx, ty, tileEdgeM, spawnOpts, countMul, under) {
    if (!grid || !root.WorldGen) return [];
    const WG = root.WorldGen;
    // Deliberately NOT WorldGen.tileStreamSeed / HASH_MUL_X/Y: traps seed their
    // OWN stream, and "unifying" these constants would move every trap in every
    // existing world. Leave them.
    const rng = WG.makeRng(((tx * 0x7f4a7c15) ^ (ty * 0x2545f491) ^ 0x51ed270b) >>> 0);
    const mul = (countMul > 0 ? countMul : 1) * tileDanger(tx, ty);
    let n = Math.round((SURFACE_TRAP_MIN + Math.floor(rng() * SURFACE_TRAP_SPAN)) * mul);
    const sampleSize = mul > 1 ? Math.max(TRAP_GROUND_SAMPLE, n * 6) : TRAP_GROUND_SAMPLE;
    const roadMask = spawnOpts && spawnOpts.roadMask;
    const { cells: all, path, park } = yield* sampleTrapCellsSteps(grid, roadClass, w, h, rng, sampleSize, under, roadMask);
    if (!all.length) return [];
    // The cap per ground, off the pools' sizes (never a draw).
    const share = TRAP_GROUND_SHARE_PER_MUL * mul * TRAP_GROUND_DENSITY_MUL;
    const capPath = path.seen * share;
    const capPark = park.seen * share;
    n = Math.min(n, Math.max(1, Math.floor(capPath + capPark)));
    const nPath = path.cells.length
      ? (park.cells.length ? Math.round(n * capPath / (capPath + capPark)) : n) : 0;
    const traps = [];
    const taken = new Set();
    for (let k = 0; k < n; k++) {
      const cand = k < nPath ? path.cells : park.cells;
      for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
        const idx = cand[Math.floor(rng() * cand.length)];
        if (taken.has(idx)) continue;
        const lix = idx % w, liy = (idx / w) | 0;
        // The shared rule: walkable, off the band, off anything already there,
        // and out of a private yard.
        // A trap is a hazard seated for the player. The spawn gate applies
        // every hard reason plus sensitive ground, the kerb and Small-road
        // junction suppression through the hazard row.
        if (!WG.isSpawnCell(grid, w, h, lix, liy, spawnOpts, 'hazard')) continue;
        taken.add(idx);
        traps.push(makeTrap(tx, ty, tileEdgeM, w, lix, liy,
          WG.cellId('trap', tx, ty, lix, liy)));
        break;
      }
    }
    return traps;
  }

  // ── Cave spawn ───────────────────────────────────────────────────────────
  // `anchors` — the level's up-staircase cells ({lix, liy}), the points the
  // player actually arrives at. Same spread the monster and coin scatters use,
  // for the same reason: a trap 200 cells away in the dark is a trap nobody
  // ever meets. `occupiedIdx` is a Set of flat grid indices already claimed by
  // an object (stairs, chests, torches, rocks) — a trap must never sit under a
  // sprite, or the only warning the art gives is painted over. `countMul`
  // scales the base rate the same way spawnSurface's does — the app.js call
  // site passes DUNGEON_DENSITY_MUL, flat regardless of game mode.
  // A row of the cave floor's TRIES walk (worldgen.js CAVE_PASSES /
  // runCavePass): n snares, ATTEMPTS picks each about a random anchor, on a
  // free floor cell. The level's occupancy is COPIED: a snare claims a cell
  // against the next snare, never against the caller's set.
  function spawnCave(grid, N, tx, ty, tileEdgeM, depth, anchors, occupiedIdx, countMul) {
    if (!grid || !root.WorldGen) return [];
    const WG = root.WorldGen;
    const anch = (anchors && anchors.length)
      ? anchors : [{ lix: Math.floor(N / 2), liy: Math.floor(N / 2) }];
    const mul = countMul > 0 ? countMul : 1;
    const traps = [];
    WG.runCavePass({
      id: 'traps',
      // Own stream on purpose — see spawnSurface; never "unify" with tileStreamSeed.
      rng: () => WG.makeRng(((tx * 0x7f4a7c15) ^ (ty * 0x2545f491) ^ (depth * 0x9e3779b1) ^ 0x1b873593) >>> 0),
      count: (rng) => Math.round((CAVE_TRAP_MIN + Math.floor(rng() * CAVE_TRAP_SPAN)
        + Math.min(depth, CAVE_TRAP_DEPTH_CAP) * CAVE_TRAP_PER_DEPTH) * mul),
      tries: ATTEMPTS,
      pick: (rng) => {
        const a = anch[Math.floor(rng() * anch.length)];
        return { lix: a.lix + Math.round((rng() - 0.5) * 2 * CAVE_SPAWN_R),
                 liy: a.liy + Math.round((rng() - 0.5) * 2 * CAVE_SPAWN_R) };
      },
      emit: (L, c) => traps.push({ ...makeTrap(tx, ty, tileEdgeM, N, c.lix, c.liy,
        WG.cellId(`trap_d${depth}`, tx, ty, c.lix, c.liy)),
        kind: 'pit_trap', hidden: true, depth }),
    }, WG.cavePassLevel(grid, N, tx, ty, tileEdgeM, depth, new Set(occupiedIdx || [])));
    return traps;
  }

  // ── LAID traps: a goblin trapper's snares ────────────────────────────────
  // The trapper (combat.js MONSTERS.goblin_trapper, `lays: 'trap'`) puts a
  // snare on an empty cell on the line between itself and the player
  // (app.js _trapperLay). It is the SAME trap — the same record shape, the
  // same bite and bleed in app.js _tickTraps, the same two textures, the same
  // Trap Disarm Kit — and it is in NONE of the world's buckets: not
  // GENERATED (nothing about where it sits is a function of the tile), not
  // the DELTA and not PLACED. It is SESSION state, like a bounty coin:
  //   • it lives on `entry.laidTraps`, beside the generated `entry.traps`
  //     rather than in it, so the passes that REWRITE the generated list (the
  //     spawn pass, _relayTrapsForMode) never touch it, and a tile REBUILT
  //     under the player carries it across (worldgen.js rebuildTileWithBin,
  //     beside coinDrops). A tile evicted from the cache loses it — by then
  //     it has long expired.
  //   • it is never written to the save: springing one sets `_sprung` on the
  //     record and disarming one sets `_disarmed` (springTrap / disarmTrap
  //     below), never save.sprungTraps / save.disarmedTraps — ids in those
  //     arrays must be derived from a generated position, and a laid one is
  //     gone at the next reload anyway.
  //   • it EXPIRES, LAID_LIFE_MS after it went down: two full rounds of a
  //     trapper's cap (LAID_MAX) at its roster's ten-second attack interval,
  //     so a trapper you
  //     walk away from leaves a minute of mess, not a minefield.
  const LAID_MAX = 3;
  const LAID_LIFE_MS = 60 * 1000;

  // Is this trap record still in play at `now` (wall-clock ms)? A generated
  // trap always is (its state lives on the save); a laid one until it
  // expires or is disarmed.
  function isLive(t, now) {
    if (!t) return false;
    if (!t._laid) return true;
    return !t._disarmed && (now == null ? Date.now() : now) < t._expiresAt;
  }

  // The three questions every consumer asks of a trap, answered for BOTH
  // kinds: a generated trap's state is its id on the save, a laid one's is
  // on the record. Callers ask these rather than Traps.isSprung(save, id) so
  // a laid snare never mints a save id.
  function isTrapSprung(save, t) {
    if (!t) return false;
    return t._laid ? !!t._sprung : isSprung(save, t.id);
  }
  function isTrapDisarmed(save, t) {
    if (!t) return false;
    return t._laid ? !!t._disarmed : isDisarmed(save, t.id);
  }
  // Returns true the FIRST time, like spring() — the bite's one-shot gate.
  function springTrap(save, t) {
    if (!t) return false;
    if (!t._laid) return spring(save, t.id);
    if (t._sprung) return false;
    t._sprung = true;
    return true;
  }
  function disarmTrap(save, t) {
    if (!t) return false;
    if (!t._laid) return disarm(save, t.id);
    if (t._disarmed) return false;
    t._disarmed = true;
    return true;
  }

  // Can a snare go down on LOCAL cell (lix, liy) of `entry`? Walkable ground
  // on the LIVE grid (a dug wall is floor now), off the drawn road band
  // (entry.roadMask) and on ground the spawn gate gives a 'hazard'
  // (entry.spawnWhy), not under anything the spawn pass seated
  // (entry._spawnOpts.occupied — the other half of the rule), and not on a
  // trap already there, generated or laid. The caller adds what only it
  // knows: not the player's cell, not the layer's.
  function canLay(entry, lix, liy) {
    if (!entry || !entry.grid || !root.WorldGen) return false;
    const N = entry.cellsPerEdge;
    if (!(N > 0) || lix < 0 || liy < 0 || lix >= N || liy >= N) return false;
    const i = liy * N + lix;
    if (!root.WorldGen.isWalkable(entry.grid[i])) return false;
    // THE SPAWN GATE: a snare is a 'hazard' spawn. The entry's full options
    // apply sensitive ground, every hard reason, the kerb and the Small-road
    // junction buffer through the one class row. trapGroundKind still owns
    // the broader road-clearance shape. Underground entries carry no mask, so
    // a cave reads through isSpawnCell's own no-mask fallback.
    const WG = root.WorldGen;
    if (!WG.isSpawnCell(entry.grid, N, N, lix, liy, WG.spawnOptsOf(entry), 'hazard')) return false;
    return !trapAt(entry, lix, liy);
  }

  // Lay a snare on LOCAL cell (lix, liy) of tile (tx, ty) at `depth`, for
  // the trapper `byId`. Returns the record. The id names the level and the
  // cell (a cell holds one trap at a time — canLay), which is all it has to
  // be unique for: it never reaches the save.
  // `power` is the laying trapper's own (Combat.powerMul — its elite factor),
  // carried on the snare so it bites as hard as the hand that set it: an
  // elite's snare bites like an elite. Read through trapPower.
  function layTrap(entry, tx, ty, tileEdgeM, lix, liy, byId, now, depth, power) {
    const N = entry.cellsPerEdge;
    const t = makeTrap(tx, ty, tileEdgeM, N, lix, liy,
      root.WorldGen.cellId(`laid_d${depth || 0}`, tx, ty, lix, liy));
    t._laid = true;
    t._by = byId;
    if (Number.isFinite(power) && power > 0) t._power = power;
    t._expiresAt = (now == null ? Date.now() : now) + LAID_LIFE_MS;
    (entry.laidTraps = entry.laidTraps || []).push(t);
    return t;
  }

  // How hard a trap bites, as a multiplier on STEP_ENERGY and
  // standEnergyPerS(): its trapper's power for a laid snare, 1 for every
  // generated trap (the world's own, nobody's hand behind it).
  function trapPower(t) {
    return (t && Number.isFinite(t._power) && t._power > 0) ? t._power : 1;
  }

  // Drop every expired or disarmed snare from `entry.laidTraps`, compacted
  // in place (never a splice per rejection). Each one dropped is flagged
  // `_gone`, so a caller still holding it (app.js memoises the trap under the
  // feet) can tell. Returns how many are left.
  function pruneLaid(entry, now) {
    const list = entry && entry.laidTraps;
    if (!list) return 0;
    let w = 0;
    for (let r = 0; r < list.length; r++) {
      const t = list[r];
      if (isLive(t, now)) list[w++] = t;
      else t._gone = true;
    }
    list.length = w;
    return w;
  }

  // How many of `byId`'s snares are still OUT in `entries` — live and not yet
  // sprung (a sprung jaw has done its job and no longer counts toward the
  // trapper's LAID_MAX).
  function laidOut(entries, byId, now) {
    let n = 0;
    for (const e of entries) {
      const list = e && e.laidTraps;
      if (!list) continue;
      for (const t of list) if (t._by === byId && !t._sprung && isLive(t, now)) n++;
    }
    return n;
  }

  // The points a trapper tries, in order: one per cell-length step strictly
  // BETWEEN the two bodies (never the endpoints — those are the trapper's own
  // cell and the player's), nearest the midpoint first, so the snare lands
  // in the middle of the path the player would take to reach it. World
  // metres in, world metres out; the caller resolves each to a cell.
  function layPoints(x0, y0, x1, y1, cellM) {
    const dx = x1 - x0, dy = y1 - y0;
    const dist = Math.hypot(dx, dy);
    const steps = Math.floor(dist / (cellM || 1));
    const out = [];
    for (let k = 1; k < steps; k++) {
      const u = k / steps;
      out.push({ x: x0 + dx * u, y: y0 + dy * u, u });
    }
    out.sort((a, b) => Math.abs(a.u - 0.5) - Math.abs(b.u - 0.5));
    return out;
  }

  // ── The player's MAGIC TRAP ──────────────────────────────────────────────
  // The trapper's snare, turned: a tier-3 item (items.js magic_trap — a
  // supply-shop purchase, cave find, and what a slain trapper drops) the player sets on an
  // empty cell in reach (interact.js 'place-magic-trap'). PLACED-bucket
  // state: save.magicTraps = [{ id, x, y, depth }], the id from the cell it
  // was set on (tile + local cell + level), never a clock. Drawn as a magenta
  // glow (Lighting.KINDS.magic_trap) over a tinted scuff on its cell.
  //
  // An ENEMY (Combat.isEnemy — never game, never a pet, never the player)
  // that walks onto the cell is CHILLED — the Frost Powder's own slow
  // (Combat.applyFrost; one lane, a second reason) for MAGIC_HOLD_MS — and takes
  // one hit, and the trap is spent. The numbers, both derived in app.js
  // (MAGIC_TRAP_HOLD_MS / magicTrapDamage) so they read off the tables they
  // stand for:
  //   hold   — one STAFF beat (Combat.fireIntervalMs('staff'), 5 s): long
  //            enough that the slowest weapon the player owns lands a shot on
  //            a foe that cannot step out of its line.
  //   damage — one TIER-3 BOW SHOT (Combat.shotDamage at the item's own
  //            tier): the trap is a tier-3 weapon that fires once.
  function magicTrapId(depth, tx, ty, lix, liy) {
    return root.WorldGen.cellId(`mtrap_d${depth || 0}`, tx, ty, lix, liy);
  }

  // ── Lookup ───────────────────────────────────────────────────────────────
  // The trap on LOCAL cell (lix, liy) of a tile entry, or null. A linear scan:
  // a tile holds at most a couple of dozen traps, and the caller only asks when
  // the player crosses a cell (app.js memoises on the cell key), so an index
  // would cost more to keep than it saves. The generated list first, then the
  // laid one — skipping a laid snare that has expired or been disarmed (a
  // generated one is returned whatever its state; the save decides that).
  function trapAt(entry, lix, liy, now) {
    if (!entry) return null;
    const list = entry.traps;
    if (list) {
      for (let i = 0; i < list.length; i++) {
        if (list[i]._ix === lix && list[i]._iy === liy) return list[i];
      }
    }
    const laid = entry.laidTraps;
    if (laid && laid.length) {
      const t0 = now == null ? Date.now() : now;
      for (let i = 0; i < laid.length; i++) {
        const t = laid[i];
        if (t._ix === lix && t._iy === liy && isLive(t, t0)) return t;
      }
    }
    return null;
  }

  root.Traps = {
    STEP_ENERGY, standEnergyPerS,
    SURFACE_TRAP_MIN, SURFACE_TRAP_SPAN, TRAP_GROUND_SAMPLE, DANGER_MIN, DANGER_MAX, tileDanger,
    CAVE_TRAP_MIN, CAVE_TRAP_SPAN, CAVE_TRAP_PER_DEPTH, CAVE_TRAP_DEPTH_CAP, CAVE_SPAWN_R,
    DUNGEON_DENSITY_MUL,
    isSprung, spring,
    isDisarmed, disarm,
    TRAP_ROAD_CLEAR_CELLS, isTrapGround, trapGroundKind, sampleTrapCells, TRAP_GROUND_SHARE_PER_MUL, TRAP_GROUND_DENSITY_MUL, spawnSurface, spawnSurfaceSteps, spawnCave, trapAt,
    LAID_MAX, LAID_LIFE_MS, isLive, isTrapSprung, isTrapDisarmed, springTrap, disarmTrap,
    canLay, layTrap, trapPower, pruneLaid, laidOut, layPoints,
    magicTrapId,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
