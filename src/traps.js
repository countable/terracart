// src/traps.js — hidden traps: where they are, and what stepping on one costs.
//
// A trap is the cheapest possible piece of world state: NOTHING is stored
// until you step on one. Where the traps are is a pure function of the tile's
// coordinates (and, underground, its depth) through WorldGen.makeRng — exactly
// like the X-mark scatter, the wild plants and the cave rocks. The only thing
// that ever reaches the save is the id of a trap the player has SPRUNG
// (save.sprungTraps), which is what makes a revealed trap stay revealed across
// a reload. A tile evicted from the cache and rasterized again lays the same
// traps in the same cells; a tile REBUILT under the player (see CLAUDE.md)
// re-runs the spawn pass because the rebuild drops `entry._spawned`, and lays
// the same set again.
//
// The two placements:
//   • SURFACE — ALONGSIDE roads, never on them. "Nothing spawns on a road" is
//     a hard rule here (CLAUDE.md): the terrain grid under-reports the road, so
//     roadside-ness is judged against `entry.roadMask` — the ground the overlay
//     actually paints, stamped from WorldGen.roadOverlayWidthM — and the cell a
//     trap lands on is a cell the mask does NOT cover, cleared by the shared
//     WorldGen.isSpawnCell rule like every other spawner. So a trap sits on the
//     verge the band stops at, which is where a snare belongs anyway.
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
  // the sprung one is a bleed the player is meant to walk out of — two a
  // second is faster than any passive rest can refill (Home is ~1.1⚡/s), so
  // waiting it out is never the answer; stepping off is.
  const STEP_ENERGY = 10;
  const STAND_ENERGY_PER_S = 2;

  // ── How many, and where ──────────────────────────────────────────────────
  // A tile is ~236 cells (≈1.65 km) on an edge — about 21 screens across — so
  // these BASE counts read as "one every dozen-odd screens of road", not a
  // minefield. The mode and the depth scale up from here — see countMul below.
  const ROAD_TRAP_MIN = 10, ROAD_TRAP_SPAN = 9;    // 10..18 per surface tile, base rate
  // How many roadside cells the one-pass scan below keeps to choose from. Only
  // needs to comfortably exceed the trap count — it is a uniform sample of the
  // whole verge (see sampleRoadsideCells), so more of them buys nothing but
  // room for the isSpawnCell rejections. A countMul > 1 asks for more traps
  // than this reservoir can supply candidates for, so spawnSurface widens it
  // in that case; left alone at the base rate so every existing seed and test
  // keeps drawing the exact same rng sequence.
  const ROADSIDE_SAMPLE = 96;
  // Caves: fewer, but they climb with depth — and they sit where the player
  // actually walks (around the entrances), like the monsters and coins.
  const CAVE_TRAP_MIN = 5, CAVE_TRAP_SPAN = 5, CAVE_TRAP_PER_DEPTH = 1;
  const CAVE_TRAP_DEPTH_CAP = 8;      // depth past which the bonus stops growing
  const CAVE_SPAWN_R = 25;            // cells around each anchor — matches the monster/coin spread
  // Dungeons are dangerous on EITHER game mode, so their density multiplier is
  // flat rather than read off Difficulty (which only scales the surface rate —
  // Difficulty.PROFILES[mode].trapCountMul, 10x easy / 100x hard). Named here,
  // beside the base counts it scales, rather than inlined at the one call site
  // in app.js that reads it.
  const DUNGEON_DENSITY_MUL = 100;

  // Placement attempts per trap. A rejected attempt drops that trap rather
  // than searching harder; small scatter variance is fine (the X scatter in
  // app.js makes the same trade).
  const ATTEMPTS = 8;

  // ── The sprung set ───────────────────────────────────────────────────────
  // save.sprungTraps is a flat array of ids, like save.picked / save.opened.
  // It is the ONLY thing about a trap that is ever written down. The RENDERER
  // does not read it through here — it goes through util.js's memoised setOf,
  // because it asks once a frame and a fresh Set every frame is exactly the
  // allocation setOf exists to avoid.
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

  // ── The verge ────────────────────────────────────────────────────────────
  // A cell is ROADSIDE when it is not itself under the drawn band but shares an
  // EDGE with one that is: the verge the band stops at. Edge adjacency, not the
  // full 3×3 ring — a diagonal touch is a corner, not a verge, and dropping the
  // diagonals is what makes the one-pass scan below cheap enough to run on
  // every tile build. This is the shipping definition of "along the road";
  // the test pins traps against THIS function rather than a restatement of it.
  function isRoadside(roadMask, w, h, cx, cy) {
    const i = cy * w + cx;
    if (roadMask[i]) return false;
    return !!((cx > 0 && roadMask[i - 1])
           || (cx < w - 1 && roadMask[i + 1])
           || (cy > 0 && roadMask[i - w])
           || (cy < h - 1 && roadMask[i + w]));
  }

  // Up to `k` roadside cells, sampled UNIFORMLY across the tile in a single
  // pass (reservoir sampling — algorithm R), returned as flat grid indices.
  //
  // The reservoir rather than a list because of the SIZE of the thing being
  // sampled: a tile is ~236 cells on an edge, and a dense town tile's verge
  // runs to seventeen thousand cells — of which this uses eighteen. Collecting
  // them all meant allocating (and then discarding) a seventeen-thousand entry
  // array on every tile build; this holds a fixed 96 and never grows.
  // Walking the GRID inward (asking each cell whether it touches the band) is
  // also cheaper than walking the mask outward stamping its neighbours, which
  // needs a whole `seen` plane to dedupe where two road cells' rings overlap.
  // Worst case measured (a solid street grid over 14 % of a 236-cell tile):
  // the whole of spawnSurface is under a millisecond per tile build.
  function sampleRoadsideCells(roadMask, w, h, rng, k) {
    const res = [];
    let seen = 0;
    for (let cy = 0; cy < h; cy++) {
      for (let cx = 0; cx < w; cx++) {
        if (!isRoadside(roadMask, w, h, cx, cy)) continue;
        if (res.length < k) res.push(cy * w + cx);
        else {
          const r = Math.floor(rng() * (seen + 1));
          if (r < k) res[r] = cy * w + cx;
        }
        seen++;
      }
    }
    return res;
  }

  // ── Surface spawn ────────────────────────────────────────────────────────
  // `spawnOpts` is the caller's shared spawn options — the SAME object every
  // other spawner in spawnInTile passes to WorldGen.isSpawnCell (roadMask +
  // the tile's POI anchors), so a trap obeys the road rule and the private-yard
  // frontage rule by construction rather than by a copy of them here.
  // A tile with no charted road gets no traps: there is no roadside to be on.
  // `countMul` scales the base 10..18 rate — the caller passes
  // Difficulty.get().trapCountMul (10x easy / 100x hard) — so this module stays
  // free of a Difficulty dependency and the base rate above stays the number a
  // test can pin without reading the mode.
  function spawnSurface(grid, roadMask, w, h, tx, ty, tileEdgeM, spawnOpts, countMul) {
    if (!grid || !roadMask || !root.WorldGen) return [];
    const WG = root.WorldGen;
    const rng = WG.makeRng(((tx * 0x7f4a7c15) ^ (ty * 0x2545f491) ^ 0x51ed270b) >>> 0);
    const mul = countMul > 0 ? countMul : 1;
    const n = Math.round((ROAD_TRAP_MIN + Math.floor(rng() * ROAD_TRAP_SPAN)) * mul);
    // The base reservoir (96) only needs to comfortably exceed the base rate's
    // ~18 traps. A density multiplier asks for many more, so it needs many
    // more distinct roadside cells to draw from — widen the reservoir rather
    // than let most of the extra traps fail on collisions with each other.
    const sampleSize = mul > 1 ? Math.max(ROADSIDE_SAMPLE, n * 6) : ROADSIDE_SAMPLE;
    const cand = sampleRoadsideCells(roadMask, w, h, rng, sampleSize);
    if (!cand.length) return [];
    const traps = [];
    const taken = new Set();
    for (let k = 0; k < n; k++) {
      for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
        const idx = cand[Math.floor(rng() * cand.length)];
        if (taken.has(idx)) continue;
        const lix = idx % w, liy = (idx / w) | 0;
        // The shared rule: walkable, off the band, and out of a private yard.
        if (!WG.isSpawnCell(grid, w, h, lix, liy, spawnOpts)) continue;
        taken.add(idx);
        traps.push(makeTrap(tx, ty, tileEdgeM, w, lix, liy,
          `trap_${tx}_${ty}_${lix}_${liy}`));
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
  function spawnCave(grid, N, tx, ty, tileEdgeM, depth, anchors, occupiedIdx, countMul) {
    if (!grid || !root.WorldGen) return [];
    const WG = root.WorldGen;
    const FLOOR = WG.T.CAVE_FLOOR;
    const rng = WG.makeRng(
      ((tx * 0x7f4a7c15) ^ (ty * 0x2545f491) ^ (depth * 0x9e3779b1) ^ 0x1b873593) >>> 0);
    const anch = (anchors && anchors.length)
      ? anchors : [{ lix: Math.floor(N / 2), liy: Math.floor(N / 2) }];
    const mul = countMul > 0 ? countMul : 1;
    const n = Math.round((CAVE_TRAP_MIN + Math.floor(rng() * CAVE_TRAP_SPAN)
      + Math.min(depth, CAVE_TRAP_DEPTH_CAP) * CAVE_TRAP_PER_DEPTH) * mul);
    const traps = [];
    const taken = new Set();
    for (let k = 0; k < n; k++) {
      for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
        const a = anch[Math.floor(rng() * anch.length)];
        const lix = a.lix + Math.round((rng() - 0.5) * 2 * CAVE_SPAWN_R);
        const liy = a.liy + Math.round((rng() - 0.5) * 2 * CAVE_SPAWN_R);
        if (lix < 0 || liy < 0 || lix >= N || liy >= N) continue;
        const idx = liy * N + lix;
        if (grid[idx] !== FLOOR) continue;
        if (taken.has(idx)) continue;
        if (occupiedIdx && occupiedIdx.has(idx)) continue;
        taken.add(idx);
        traps.push(makeTrap(tx, ty, tileEdgeM, N, lix, liy,
          `trap_d${depth}_${tx}_${ty}_${lix}_${liy}`));
        break;
      }
    }
    return traps;
  }

  // ── Lookup ───────────────────────────────────────────────────────────────
  // The trap on LOCAL cell (lix, liy) of a tile entry, or null. A linear scan:
  // a tile holds at most a couple of dozen traps, and the caller only asks when
  // the player crosses a cell (app.js memoises on the cell key), so an index
  // would cost more to keep than it saves.
  function trapAt(entry, lix, liy) {
    const list = entry && entry.traps;
    if (!list) return null;
    for (let i = 0; i < list.length; i++) {
      if (list[i]._ix === lix && list[i]._iy === liy) return list[i];
    }
    return null;
  }

  root.Traps = {
    STEP_ENERGY, STAND_ENERGY_PER_S,
    ROAD_TRAP_MIN, ROAD_TRAP_SPAN, ROADSIDE_SAMPLE,
    CAVE_TRAP_MIN, CAVE_TRAP_SPAN, CAVE_TRAP_PER_DEPTH, CAVE_TRAP_DEPTH_CAP, CAVE_SPAWN_R,
    DUNGEON_DENSITY_MUL,
    isSprung, spring,
    isRoadside, sampleRoadsideCells, spawnSurface, spawnCave, trapAt,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
