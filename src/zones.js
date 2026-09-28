// ─────────────────────────────────────────────────────────────────────────
// Zones — INFLUENCE ZONES: the Sacred Grove, the Old Stones, the Tar Yard.
//
// A few kinds of place stamp their character on the ground around them:
//   grove   — a park POI (poi class park / subclass park)
//   stones  — a place of worship (any faith) or a cemetery POI
//   tar     — a fuel station (fuel / fuel; charging stations are NOT anchors)
// Unnamed parks (no POI), nature reserves and charging stations are no anchor.
//
// ── THE ANCHOR AND ITS RADIUS (seam-safe by construction) ─────────────────
// An anchor is a POI POINT. The OpenFreeMap poi layer carries a 1024-unit
// buffer (POI_BUFFER_UNITS — ~370-410 m at play latitudes), and every copy of
// a point in a neighbour's buffer is bit-identical to the owner's, so every
// tile that can see an anchor computes the same numbers for it:
//   upm(row)  generation metres per MVT unit of the ANCHOR's own tile row
//             (WorldGen.cellsPerEdgeForTile(row) · CELL_M / 4096) — never the
//             observer's, so two rows agree across the N / N±1 seam;
//   merge     a same-kind anchor within MERGE_M of one with a smaller (gy, gx)
//             key is dropped (double-mapped stations, shared church halls);
//   q         local crowding: Σ (1 − d/W) over surviving same-kind anchors
//             within W = windowM(row) (≤ W_MAX_M, shrunk only where the buffer
//             could not hold W + the widest ragged edge + MERGE_M);
//   R         clamp(R_kind / (1 + q), R_MIN_M, R_kind) — the kind's row R.
// The window fits inside the buffer, so q (and R) are the same from every
// tile: the design sweep measured 490 anchor×tile evaluations, 0 mismatches.
//
// ── THE FIELD AND THE HALO (a ZONE WRITES TERRAIN) ───────────────────────
// A cell c belongs to an anchor when d(c) ≤ edge(c) = R·(1 + EDGE_JITTER·
// (2·noise(c) − 1)): a RAGGED disc. noise is 2-octave value noise over the
// cell centre in GLOBAL MVT units (tile·4096 + local) — continuous across
// every seam, row seams included, and the same for every player (never a
// per-tile rng). Strength s = 1 − d/edge. One winner per cell: highest s
// (quantised to a byte), then the rarer kind, then the smaller key — so no
// visiting order can change a cell.
// Inside the winner's disc the HALO repaints ONLY lot and commercial ground
// (RESIDENTIAL, COMMERCIAL, WASTELAND — HALO_OVER) to the zone's own terrain
// (T.GROVE / T.CHURCHYARD / T.TAR_YARD). Everything else — parks, roads,
// buildings, water, forest — keeps its code. The halo runs at the END of
// rasterizeTileSteps (after the mineralrock cleanup, the occupancy pass and
// the street dressing), so no older stream or cull sees a different grid;
// what moves is only what reads the grid later (spawnInTile's fauna, traps,
// X marks) — accepted by the owner for the cells a zone repaints.
//
// ── THE NEXUS ────────────────────────────────────────────────────────────
// Each anchor arranges a PATTERN of interactables around its POI, one of
// 2-3 per kind picked by the anchor's aspect (a hash of its global point):
//   grove   rings of wild roses / a ring of trees / roses inside trees, plus
//           ONE shrine (grove_shrine: a daily gift, a light) beside the chest
//   stones  a ring or rows of HEADSTONES (churches + cemeteries only — the
//           ghost anchors), or a square / ring of plain rocks (other faiths)
//   tar     a grid of tar pits (they SLOW — app.js _bodyHold), a ring of tar
//           with flint inside, or a tar cross; plus a fire-slime garrison
//           (lairs.js 'tar' tier, every mode, slimeCountMul)
// THE PATTERN IS THE ANCHOR'S, NOT THE TILE'S — so it is whole across a seam.
// It centres on the anchor's own POI cell in the ANCHOR's tile grid
// (nexusCentre: floor(local point · N_row / 4096), N_row the anchor row's
// cellsPerEdgeForTile) — never on the chest's final cell, which worldgen may
// slide (offsetForPlacement) where no neighbour can see. Each piece's
// anchor-grid cell centre is taken to a GLOBAL MVT point and then into the
// observing tile's grid (nexusPieceCell — a north/south seam may change N).
// EVERY tile whose square a piece lands in lays it (field.reach: the anchors
// whose pattern box touches the square, whether or not their zone won a
// cell here), and only that tile — nothing is laid twice. The draws are one
// stream per anchor (key ^ SALT_NEXUS: the species, then one per piece, laid
// or not — nexusPlan), replayed alike by every tile, so a piece has the same
// variant whichever tile lays it. The chest stamp, the grove shrine (seated
// beside the chest) and the tar garrison stay the OWNER's (the anchor's point
// in its square — the tile that mints the chest).
// Every piece passes the LAYING tile's WorldGen.isSpawnCell with its roadMask +
// occupied (and the grove crowding reads that tile's occupancy), claims its
// cell, and has a tile+cell id of the tile that lays it (one physical piece,
// one id) — the save only ever sees the existing delta lists (picked,
// chopped, brokenRocks, opened, caught). The chest keeps its id;
// it is stamped `zoneNexus` and loot.js pays it ZONE_NEXUS_TIER_BONUS.
// NO DECORATIVE PROPS: every standing thing here is interactable or a hazard,
// one art per interactable.
//
// What this is NOT: a lane of its own for any mechanic. Tar is the burned
// row's slow (StreetVariants.SLOW_KINDS, _bodyHold); the fire slimes are a
// lair tier; the ghosts are ghostsHaunt's second reason; the shrine's gift is
// the coin-burst daily ledger; stories are _storySplashOnce.
//
// Pure: no Phaser, no DOM. Reads WorldGen / SpriteLayout / fnv1a at CALL
// time, so it loads before worldgen.js. Audit: test/node/zones.test.js.
// ─────────────────────────────────────────────────────────────────────────
(function (root) {
  'use strict';

  const EXT = 4096;
  // ── The field's numbers (design §3; the owner's radii) ──────────────────
  const POI_BUFFER_UNITS = 1024;
  const W_MAX_M = 200;
  const R_MIN_M = 30;
  const MERGE_M = 40;
  const WINDOW_MARGIN_M = 5;
  // The ragged edge: ± this share of R, off the noise. 0.25 lets a grove
  // bleed ~15 m further into the houses in places and stop short in others.
  const EDGE_JITTER = 0.25;
  // The noise lattice, in MVT units (~37 m at play latitudes), and its octave.
  const NOISE_UNITS = 96;
  // The zone's CORE (the story trigger): s at or above this.
  const CORE_S = 0.5;
  // The most anchors one tile's field indexes (Uint8 slots, 0 = none).
  const MAX_FIELD_ANCHORS = 255;

  // ── The kinds ────────────────────────────────────────────────────────────
  // `code` is the Uint8 kind code and the rarity rank (ties go to the higher).
  // `terrain` names the WorldGen.T code the halo paints. `story` is the
  // _storySplashOnce key AND the painting stem (assets/art/<story>.webp).
  // `attracts` { species: p }: the FAUNA ATTRACTOR column (scene_creatures.js
  // _seatFaunaOnFavouriteGround) — each of the tile's own spawns of that
  // species moves onto the zone's ground with probability p. Not an add.
  const ZONE_KINDS = {
    grove: { code: 1, R: 60, terrain: 'GROVE', story: 'zone_grove', title: 'A sacred grove',
      attracts: { deer: 0.5, butterfly: 0.5 },
      body: 'The trees lean close around an old stone shrine. Someone still tends it.',
      flash: 'A sacred grove. Hush.' },
    stones: { code: 2, R: 80, terrain: 'CHURCHYARD', story: 'zone_stones', title: 'The old stones',
      attracts: { crow: 0.5 },
      body: 'Moss-grown stones ring the old chapel. Walk softly here, and be gone by dusk.',
      flash: 'The old stones. Walk softly.' },
    tar: { code: 3, R: 100, terrain: 'TAR_YARD', story: 'zone_tar', title: 'The tar yard',
      body: 'The old fuel yard weeps black tar. It drags at your feet — and something in the flames is moving.',
      flash: 'The tar yard. Mind your feet.' },
  };
  const KIND_BY_CODE = [null, 'grove', 'stones', 'tar'];
  const R_MAX_M = Math.max(...Object.values(ZONE_KINDS).map((k) => k.R));
  const R_EDGE_MAX_M = R_MAX_M * (1 + EDGE_JITTER);

  // ── The nexus patterns (aspects) ─────────────────────────────────────────
  // Picked per anchor off its own key; `ghosts` anchors (churches, cemeteries)
  // pick from the headstone list, other faiths' places of worship from rocks.
  const ASPECTS = {
    grove: ['rose_rings', 'tree_ring', 'rose_in_trees'],
    stones: ['headstone_ring', 'headstone_rows', 'rock_square'],
    stones_quiet: ['rock_square', 'rock_ring'],
    tar: ['tar_grid', 'tar_ring_flint', 'tar_cross'],
  };
  // The one standing prop per grove: the shrine seats on the first free cell
  // of these rings (radius 1..SHRINE_SEAT_R, N first, clockwise).
  const SHRINE_SEAT_R = 3;
  const RING_ORDER = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
  const TREE_SPECIES = ['maple', 'pine', 'birch', 'mahogany'];
  // NO STACKING ON A FULL PARK: a grove piece is skipped when this many of its
  // eight neighbours already hold something the TILE put there (the park's
  // own flora clumps, a tree, the pad's greenery) — the rings thin out where
  // the park is already dense instead of packing it (owner, Sep 2026).
  const GROVE_CROWD_MAX = 3;

  // ── Headstones (Old Stones, ghost anchors only) ─────────────────────────
  // A tap raises a ghost this often, at any hour (creature_ai.js raiseGhostAt);
  // HEADSTONE_HOARD_SHARE of them — by a hash of the stone's own id, so the
  // same stones for every player — hold a one-off low-tier find, rolled from
  // HEADSTONE_CONTEXT at HEADSTONE_TIER and spent in save.opened.
  const HEADSTONE_GHOST_P = 1 / 3;
  const HEADSTONE_HOARD_SHARE = 0.2;
  const HEADSTONE_CONTEXT = 'chest:lowtier';
  const HEADSTONE_TIER = 1;
  // The shrine's daily gift: one roll of this context, once per UTC day per
  // shrine, in the coin-burst ledger (save.coinBurstClaimed[id + dayKey]).
  const SHRINE_CONTEXT = 'treasure:shrine';
  // (The fire slimes a fuel yard holds are lairs.js' ZONE_TIER_GUARDS.tar.)

  // Salts — one stream per use, off the anchor's key.
  const SALT_ASPECT = 0x5a0e1a57;
  const SALT_NEXUS = 0x6e3c05a1;

  const u01 = (h) => (h >>> 0) / 4294967296;
  function hashStr01(s) { return u01(fnv1a(s)); }

  // ── Detection ────────────────────────────────────────────────────────────
  // What kind of anchor a poi feature is, or null. `ghosts`: a church (the
  // christian subclass, or none given) or a cemetery — the places the dead
  // walk; other faiths' houses of prayer get the stones but no ghost boost
  // and no headstones.
  function anchorOf(tags) {
    const t = tags || {};
    const c = t.class, sub = t.subclass;
    if (c === 'park' && sub === 'park') return { kind: 'grove', ghosts: false };
    if (c === 'fuel' && sub === 'fuel') return { kind: 'tar', ghosts: false };
    if (c === 'place_of_worship') {
      return { kind: 'stones', ghosts: !sub || sub === 'christian' || sub === 'place_of_worship' };
    }
    if (c === 'cemetery') return { kind: 'stones', ghosts: true };
    return null;
  }

  // Generation metres per MVT unit of tile row `row`, and the q window there.
  function upmRow(row) {
    const WG = root.WorldGen;
    return WG.cellsPerEdgeForTile(row) * WG.CELL_M / EXT;
  }
  function windowM(row) {
    return Math.min(W_MAX_M, POI_BUFFER_UNITS * upmRow(row) - R_EDGE_MAX_M - MERGE_M - WINDOW_MARGIN_M);
  }
  function radiusFor(kind, q) {
    const Rk = ZONE_KINDS[kind].R;
    return Math.max(R_MIN_M, Math.min(Rk, Rk / (1 + (q || 0))));
  }
  // The anchor's identity: its GLOBAL MVT point, hashed.
  function anchorKey(gx, gy) {
    return (Math.imul(gx | 0, 73856093) ^ Math.imul(gy | 0, 19349663)) >>> 0;
  }
  const keyLess = (a, b) => a.gy < b.gy || (a.gy === b.gy && a.gx < b.gx);

  // Every anchor the poi layer shows this tile (its square + buffer), deduped
  // by kind + point. Tile-local MVT points → global.
  function collectAnchors(poiLayer, tx, ty) {
    const out = [];
    if (!poiLayer || !poiLayer.features) return out;
    const seen = new Set();
    for (const f of poiLayer.features) {
      if (f.type !== 1 || !f.geom) continue;
      const k = anchorOf(f.tags);
      if (!k) continue;
      for (const ring of f.geom) {
        const p = ring && ring[0];
        if (!p) continue;
        const gx = tx * EXT + p.x, gy = ty * EXT + p.y;
        const id = `${k.kind}|${gx}|${gy}`;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push({ kind: k.kind, ghosts: k.ghosts, gx, gy, lx: p.x, ly: p.y,
          owned: p.x >= 0 && p.y >= 0 && p.x < EXT && p.y < EXT });
      }
    }
    return out;
  }

  // Merge, crowd and size the anchors — pure over the list, so any tile that
  // sees the same points gets the same survivors, q and R. Each kind is sorted
  // by key and scanned inside a gy band, so it is linear in practice.
  // `self` ({ ty, N }, optional): the observing tile's row and its own grid —
  // an anchor in that row measures with it (identical to cellsPerEdgeForTile
  // in the game; only a synthetic test tile's differs).
  function resolveAnchors(list, self) {
    const byKind = {};
    for (const a of list) (byKind[a.kind] || (byKind[a.kind] = [])).push(a);
    const out = [];
    for (const kind of Object.keys(ZONE_KINDS)) {
      const A = byKind[kind];
      if (!A || !A.length) continue;
      A.sort((a, b) => (a.gy - b.gy) || (a.gx - b.gx));
      for (const a of A) {
        const row = Math.floor(a.gy / EXT);
        a.upm = (self && self.N > 0 && row === self.ty) ? self.N * root.WorldGen.CELL_M / EXT : upmRow(row);
        a.W = Math.min(W_MAX_M, POI_BUFFER_UNITS * a.upm - R_EDGE_MAX_M - MERGE_M - WINDOW_MARGIN_M);
      }
      // Merge: dropped when an EARLIER key sits within MERGE_M.
      for (let i = 0; i < A.length; i++) {
        const a = A[i];
        const bandU = MERGE_M / a.upm;
        for (let j = i - 1; j >= 0 && a.gy - A[j].gy <= bandU; j--) {
          const b = A[j];
          if (keyLess(b, a) && Math.hypot(b.gx - a.gx, b.gy - a.gy) * a.upm < MERGE_M) { a.merged = true; break; }
        }
      }
      const S = A.filter((a) => !a.merged);
      // q over the surviving same-kind anchors inside the window.
      for (let i = 0; i < S.length; i++) {
        const a = S[i];
        const bandU = a.W / a.upm;
        let q = 0;
        for (let j = i - 1; j >= 0 && a.gy - S[j].gy <= bandU; j--) {
          const d = Math.hypot(S[j].gx - a.gx, S[j].gy - a.gy) * a.upm;
          if (d < a.W) q += 1 - d / a.W;
        }
        for (let j = i + 1; j < S.length && S[j].gy - a.gy <= bandU; j++) {
          const d = Math.hypot(S[j].gx - a.gx, S[j].gy - a.gy) * a.upm;
          if (d < a.W) q += 1 - d / a.W;
        }
        a.q = q;
        a.R = radiusFor(kind, q);
        a.key = anchorKey(a.gx, a.gy);
        a.code = ZONE_KINDS[kind].code;
        const list2 = ASPECTS[kind === 'stones' && !a.ghosts ? 'stones_quiet' : kind];
        a.aspect = list2[Math.floor(root.WorldGen.makeRng((a.key ^ SALT_ASPECT) >>> 0)() * list2.length)];
        out.push(a);
      }
    }
    return out;
  }

  // ── The ragged edge ──────────────────────────────────────────────────────
  // 0..1 at a GLOBAL MVT point — the same number from either side of a seam.
  // util.js valueNoise2, the one plane-noise helper (the park flora patches
  // read it too, biome_profiles.js floraPatchMul).
  function edgeNoise(gx, gy) {
    return valueNoise2(gx / NOISE_UNITS, gy / NOISE_UNITS);
  }
  // The anchor's reach at a global point: R bent by the noise.
  function edgeAt(a, gx, gy) {
    return a.R * (1 + EDGE_JITTER * (2 * edgeNoise(gx, gy) - 1));
  }
  // Does anchor `a` beat anchor `b` on a cell where both have strength byte s?
  function beats(a, b) {
    if (a.code !== b.code) return a.code > b.code;
    return keyLess(a, b);
  }

  // ── The field (a generator — rasterizeTileSteps drives it) ────────────────
  // Returns null when no anchor reaches the tile, else
  //   { anchors: [...], idx: Uint8Array(N*N) (0 = none, i+1 = anchors[i]),
  //     s: Uint8Array(N*N) (strength × 255) }
  function* fieldSteps(poiLayer, tx, ty, N) {
    const all = resolveAnchors(collectAnchors(poiLayer, tx, ty), { ty, N });
    yield 'zone anchors';
    if (!all.length) return null;
    const cellU = EXT / N;
    const ox = tx * EXT, oy = ty * EXT;
    // THE NEXUS REACH: every anchor whose pattern box can put a piece in this
    // square — decided off the ANCHOR's own grid (nexusCentre), not off the
    // field, since a pattern cell may lie past the ragged edge or on a cell
    // another zone won. dressSteps walks this list, not `anchors`.
    const reach = [];
    const PR = nexusReachCells();
    for (let k = 0; k < all.length; k++) {
      if ((k & 31) === 31) yield 'zone nexus reach';
      const c = nexusCentre(all[k], ty, N);
      const u = EXT / c.Na;
      const gx0 = c.gx0 + (c.ax0 - PR) * u, gx1 = c.gx0 + (c.ax0 + PR + 1) * u;
      const gy0 = c.gy0 + (c.ay0 - PR) * u, gy1 = c.gy0 + (c.ay0 + PR + 1) * u;
      if (gx1 > ox && gx0 < ox + EXT && gy1 > oy && gy0 < oy + EXT) reach.push(all[k]);
    }
    const anchors = [];
    let idx = null, s = null;
    for (let k = 0; k < all.length; k++) {
      if ((k & 7) === 7) yield 'zone field';
      const a = all[k];
      const lx = a.gx - ox, ly = a.gy - oy;
      const rU = a.R * (1 + EDGE_JITTER) / a.upm;
      const x0 = Math.max(0, Math.floor((lx - rU) / cellU)), x1 = Math.min(N - 1, Math.floor((lx + rU) / cellU));
      const y0 = Math.max(0, Math.floor((ly - rU) / cellU)), y1 = Math.min(N - 1, Math.floor((ly + rU) / cellU));
      if (x0 > x1 || y0 > y1) continue;
      if (anchors.length >= MAX_FIELD_ANCHORS) break;
      if (!idx) { idx = new Uint8Array(N * N); s = new Uint8Array(N * N); }
      const slot = anchors.length + 1;
      let touched = false;
      for (let y = y0; y <= y1; y++) {
        const cyU = (y + 0.5) * cellU;
        for (let x = x0; x <= x1; x++) {
          const cxU = (x + 0.5) * cellU;
          const d = Math.hypot(cxU - lx, cyU - ly) * a.upm;
          if (d > a.R * (1 + EDGE_JITTER)) continue;
          const edge = edgeAt(a, ox + cxU, oy + cyU);
          if (d > edge) continue;
          const sv = Math.max(1, Math.round((1 - d / edge) * 255));
          const i = y * N + x;
          const cur = idx[i];
          if (cur && (sv < s[i] || (sv === s[i] && !beats(a, anchors[cur - 1])))) continue;
          idx[i] = slot; s[i] = sv;
          touched = true;
        }
      }
      // An anchor none of whose cells won takes no slot (nothing points at it).
      if (touched) anchors.push(a);
    }
    if (!anchors.length) {
      if (!reach.length) return null;
      idx = s = null;                 // a pattern reaches in; no zone ground does
    }
    return { anchors, idx, s, reach };
  }
  function field(poiLayer, tx, ty, N) {
    const it = fieldSteps(poiLayer, tx, ty, N);
    let r = it.next();
    while (!r.done) r = it.next();
    return r.value;
  }

  // ── The halo: lot + commercial ground under a zone takes its terrain ──────
  let _haloOver = null;
  function haloOver() {
    if (!_haloOver) {
      const T = root.WorldGen.T;
      _haloOver = new Set([T.RESIDENTIAL, T.COMMERCIAL, T.WASTELAND]);
    }
    return _haloOver;
  }
  function terrainOf(kind) { return root.WorldGen.T[ZONE_KINDS[kind].terrain]; }
  // Every zone terrain code (the enumerations elsewhere ask this).
  function zoneTerrains() { return Object.keys(ZONE_KINDS).map(terrainOf); }
  // Records what it painted over in fld.under (0 = untouched): the LAND's
  // class, for the one reader that is about the land and not its look —
  // the trap ground (traps.js isTrapGround: waste ground stays waste ground).
  function* haloSteps(fld, grid, N, pathUnder) {
    if (!fld || !fld.idx) return 0;
    const over = haloOver();
    const codes = fld.anchors.map((a) => terrainOf(a.kind));
    const under = fld.under = new Uint8Array(N * N);
    let n = 0;
    for (let y = 0; y < N; y++) {
      if ((y & 31) === 31) yield 'zone halo rows';
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        const a = fld.idx[i];
        if (!a || !over.has(grid[i])) continue;
        under[i] = grid[i];
        grid[i] = codes[a - 1];
        n++;
      }
    }
    // A footpath through the halo draws the zone's ground under its pebbles.
    if (pathUnder) {
      let k = 0;
      for (const key in pathUnder) {
        if ((++k & 511) === 0) yield 'zone halo paths';
        if (!over.has(pathUnder[key])) continue;
        const us = key.indexOf('_');
        const x = +key.slice(0, us), y = +key.slice(us + 1);
        if (!(x >= 0 && y >= 0 && x < N && y < N)) continue;
        const a = fld.idx[y * N + x];
        if (a) pathUnder[key] = codes[a - 1];
      }
    }
    return n;
  }

  // ── Reading the field at runtime (one Uint8 read) ─────────────────────────
  // { kind, s (0..1), anchor } or null. entry.zone is the rasterized field.
  function at(entry, ix, iy) {
    const f = entry && entry.zone;
    const N = entry && entry.cellsPerEdge;
    if (!f || !f.idx || !(N > 0) || ix < 0 || iy < 0 || ix >= N || iy >= N) return null;
    const i = iy * N + ix;
    const a = f.idx[i];
    if (!a) return null;
    const anchor = f.anchors[a - 1];
    return { kind: anchor.kind, s: f.s[i] / 255, anchor };
  }
  function inCore(z) { return !!z && z.s >= CORE_S; }
  // The anchor whose dead walk at this cell — a church or cemetery's stones —
  // or null. creature_ai.js ghostSpawnPass reads it (the dusk gate, the
  // cadence, the fan's aim).
  function ghostAnchorAt(entry, ix, iy) {
    const z = at(entry, ix, iy);
    return (z && z.kind === 'stones' && z.anchor.ghosts) ? z.anchor : null;
  }
  // The anchor's point in a save's frame metres (tx·tileEdgeM + local).
  function anchorFrameM(anchor, tileEdgeM) {
    return { x: anchor.gx * tileEdgeM / EXT, y: anchor.gy * tileEdgeM / EXT };
  }
  // Does this headstone hold a one-off find? Off its own id — the world's.
  function headstoneHoards(id) {
    return hashStr01(String(id) + '#hoard') < HEADSTONE_HOARD_SHARE;
  }

  // ── Pattern geometry ─────────────────────────────────────────────────────
  // Cell offsets on a ring of radius r, about `spacing` cells apart, from the
  // top, clockwise; the centre never.
  function ringOffsets(r, spacing, phase) {
    const n = Math.max(4, Math.round((2 * Math.PI * r) / spacing));
    const out = [], seen = new Set();
    for (let k = 0; k < n; k++) {
      const ang = -Math.PI / 2 + (phase || 0) + (k * 2 * Math.PI) / n;
      const dx = Math.round(r * Math.cos(ang)), dy = Math.round(r * Math.sin(ang));
      const key = dx + ',' + dy;
      if ((dx === 0 && dy === 0) || seen.has(key)) continue;
      seen.add(key);
      out.push([dx, dy]);
    }
    return out;
  }
  // What each pattern lays: a list of { what, dx, dy } in the fixed order it
  // is tried (earlier pieces get first claim).
  function patternPieces(aspect) {
    const P = [];
    const add = (what, offs) => { for (const [dx, dy] of offs) P.push({ what, dx, dy }); };
    switch (aspect) {
      // Roses are the grove's prize ($35 apiece — items.js PRICES), so the
      // rings are sparse: 6 + 8 nominal, 4 inside the trees, and the spawn
      // rule thins them further (the design's value budget, §10).
      case 'rose_rings':     add('rose', ringOffsets(2, 2.1)); add('rose', ringOffsets(4, 3.15, 0.3)); break;
      case 'tree_ring':      add('tree', ringOffsets(3, 2.2)); break;
      case 'rose_in_trees':  add('rose', ringOffsets(2, 3.1, Math.PI / 4)); add('tree', ringOffsets(4, 2.6, 0.3)); break;
      case 'headstone_ring': add('headstone', ringOffsets(2, 1.5)); break;
      case 'headstone_rows':
        for (const dy of [-3, 3]) for (const dx of [-4, -2, 0, 2, 4]) P.push({ what: 'headstone', dx, dy });
        break;
      case 'rock_square':
        add('rock', [[-3, -3], [0, -3], [3, -3], [3, 0], [3, 3], [0, 3], [-3, 3], [-3, 0]]);
        break;
      case 'rock_ring':      add('rock', ringOffsets(3, 2.4)); break;
      case 'tar_grid':
        for (const dy of [-3, 0, 3]) for (const dx of [-3, 0, 3]) if (dx || dy) P.push({ what: 'tar', dx, dy });
        break;
      case 'tar_ring_flint': add('flint', [[-1, -1], [1, -1], [1, 1], [-1, 1]]); add('tar', ringOffsets(3, 1.6)); break;
      case 'tar_cross':
        add('flint', [[0, -2], [2, 0], [0, 2], [-2, 0]]);
        for (let k = 2; k <= 3; k++) add('tar', [[-k, -k], [k, -k], [k, k], [-k, k]]);
        break;
      default: break;
    }
    return P;
  }

  // ── Where a nexus sits: the ANCHOR's own POI cell, in the ANCHOR's grid ──
  // A pure function of the anchor (every tile that sees it in its poi buffer
  // gets the same answer) — never of the chest, which worldgen may slide off
  // the point (offsetForPlacement) where only the owner can see it.
  //   Na        the anchor row's grid (cellsPerEdgeForTile(row); the observing
  //             tile's own N when the anchor sits in its row — resolveAnchors'
  //             `self` rule, identical in the game)
  //   ax0, ay0  floor(local point · Na / 4096) in the anchor's tile
  //   gx0, gy0  the anchor tile's global MVT origin
  function nexusCentre(a, ty, N) {
    const txA = Math.floor(a.gx / EXT), tyA = Math.floor(a.gy / EXT);
    const Na = (tyA === ty && N > 0) ? N : root.WorldGen.cellsPerEdgeForTile(tyA);
    const gx0 = txA * EXT, gy0 = tyA * EXT;
    return { Na, gx0, gy0,
      ax0: Math.floor((a.gx - gx0) * Na / EXT), ay0: Math.floor((a.gy - gy0) * Na / EXT) };
  }
  // The observer's cell {ix, iy} that holds pattern offset (dx, dy) — the
  // anchor-grid cell's centre as a GLOBAL MVT point, then the observer's grid
  // (a north/south seam may change N) — or null when it lies in another tile.
  function nexusPieceCell(c, dx, dy, tx, ty, N) {
    const u = EXT / c.Na;
    const lx = c.gx0 + (c.ax0 + dx + 0.5) * u - tx * EXT;
    const ly = c.gy0 + (c.ay0 + dy + 0.5) * u - ty * EXT;
    const ix = Math.floor(lx * N / EXT), iy = Math.floor(ly * N / EXT);
    return (ix >= 0 && iy >= 0 && ix < N && iy < N) ? { ix, iy } : null;
  }
  // The widest pattern offset (cells), over every aspect.
  let _nexusReach = 0;
  function nexusReachCells() {
    if (!_nexusReach) {
      for (const list of Object.values(ASPECTS)) {
        for (const asp of list) {
          for (const p of patternPieces(asp)) _nexusReach = Math.max(_nexusReach, Math.abs(p.dx), Math.abs(p.dy));
        }
      }
    }
    return _nexusReach;
  }
  // The anchor's whole draw, replayed alike by every tile: the per-anchor
  // stream (key ^ SALT_NEXUS), the species first, then ONE draw per piece in
  // pattern order, laid or not — so a piece's variant is the same whichever
  // tile lays it. Returns { species, pieces: [{ what, dx, dy, v }] }.
  function nexusPlan(a) {
    const rng = root.WorldGen.makeRng((a.key ^ SALT_NEXUS) >>> 0);
    const species = TREE_SPECIES[Math.floor(rng() * TREE_SPECIES.length)];
    const pieces = patternPieces(a.aspect).map((pc) => ({ what: pc.what, dx: pc.dx, dy: pc.dy, v: rng() }));
    return { species, pieces };
  }

  // ── The nexus dressing (a generator, the end of rasterizeTileSteps) ──────
  // ctx: { field, tx, ty, N, tileEdgeM, grid (the finished, haloed grid),
  //        chests (the tile's deduped objects), spawnOpts { roadMask,
  //        occupied (GROWS — each piece claims its cell), pois } }
  // Returns { objects, wildplants, lairs, slowCells (Map cell → 'tar'),
  //           nexus: [{ kind, aspect, chestId (owner only, else null), pieces }] }.
  // Walks field.reach (every anchor whose pattern reaches this square, owned
  // or not) and lays ONLY the pieces whose cell is in this square; the chest
  // stamp, the grove shrine and the tar garrison stay the OWNER's (a.owned —
  // they belong to the chest).
  function* dressSteps(ctx) {
    const WG = root.WorldGen;
    const res = { objects: [], wildplants: [], lairs: [], slowCells: new Map(), nexus: [] };
    const fld = ctx && ctx.field;
    if (!fld || !WG) return res;
    const { tx, ty, N, tileEdgeM, grid, spawnOpts } = ctx;
    const frameCellM = tileEdgeM / N;
    const ox = tx * tileEdgeM, oy = ty * tileEdgeM;
    const occ = spawnOpts.occupied || (spawnOpts.occupied = new Set());
    const cx = (ix) => ox + (ix + 0.5) * frameCellM;
    const cy = (iy) => oy + (iy + 0.5) * frameCellM;
    // The chest each owned anchor minted (worldgen stamps `_poiAt` with the
    // POI's tile-local point).
    const chestAt = new Map();
    for (const o of ctx.chests || []) {
      if (o && o.kind === 'chest' && o._poiAt) chestAt.set(o._poiAt, o);
    }
    const nRock = (root.SpriteLayout && root.SpriteLayout.PLAIN_ROCK_VARIANTS)
      ? root.SpriteLayout.PLAIN_ROCK_VARIANTS.length : 4;
    const ok = (ix, iy) => ix >= 0 && iy >= 0 && ix < N && iy < N
      && WG.isSpawnCell(grid, N, N, ix, iy, spawnOpts);
    for (const a of (fld.reach || fld.anchors)) {
      yield 'zone nexus';
      const c = nexusCentre(a, ty, N);
      // The owner's chest (it may have lost the POI dedup: no chest, no stamp,
      // no shrine, no garrison — the pattern is the anchor's and is laid still).
      let chest = a.owned ? chestAt.get(`${a.lx},${a.ly}`) : null;
      let ix0 = -1, iy0 = -1;
      if (chest) {
        ix0 = Math.floor((chest.x - ox) / frameCellM);
        iy0 = Math.floor((chest.y - oy) / frameCellM);
        if (ix0 < 0 || iy0 < 0 || ix0 >= N || iy0 >= N) chest = null;
      }
      if (chest) {
        chest.zoneNexus = a.kind;
        delete chest._chestLook;
      }
      const rec = { kind: a.kind, aspect: a.aspect, chestId: chest ? chest.id : null, pieces: 0 };
      // The tile's own occupancy before this nexus — what "already full" reads.
      const base = a.kind === 'grove' ? new Set(occ) : null;
      const crowded = (ix, iy) => {
        if (!base) return false;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if ((dx || dy) && base.has((iy + dy) * N + (ix + dx))) n++;
          }
        }
        return n >= GROVE_CROWD_MAX;
      };
      const claim = (ix, iy) => { occ.add(iy * N + ix); rec.pieces++; };
      const zoneTag = a.kind;
      if (a.kind === 'grove' && chest) {
        // THE SHRINE first — it takes the best seat beside the chest.
        let seated = false;
        for (let r = 1; r <= SHRINE_SEAT_R && !seated; r++) {
          for (const [ux, uy] of RING_ORDER) {
            const ix = ix0 + ux * r, iy = iy0 + uy * r;
            if (!ok(ix, iy)) continue;
            claim(ix, iy);
            res.objects.push(WG.makeObject('grove_shrine', cx(ix), cy(iy),
              WG.cellId('sh', tx, ty, ix, iy), { zone: zoneTag }));
            seated = true;
            break;
          }
        }
      }
      const plan = nexusPlan(a);
      const species = plan.species;
      for (const pc of plan.pieces) {
        const cell = nexusPieceCell(c, pc.dx, pc.dy, tx, ty, N);
        if (!cell) continue;                     // another tile's square lays it
        const { ix, iy } = cell;
        const v = pc.v;
        if (!ok(ix, iy) || crowded(ix, iy)) continue;
        claim(ix, iy);
        const x = cx(ix), y = cy(iy);
        if (pc.what === 'rose') {
          res.wildplants.push(WG.makeWildplant('wildrose', x, y, WG.cellId('wz', tx, ty, ix, iy), { zone: zoneTag }));
        } else if (pc.what === 'flint') {
          res.wildplants.push(WG.makeWildplant('flint', x, y, WG.cellId('wz', tx, ty, ix, iy), { zone: zoneTag }));
        } else if (pc.what === 'tree') {
          res.objects.push(WG.makeObject('tree', x, y, WG.cellId('ztree', tx, ty, ix, iy),
            { variant: 1 + Math.floor(v * 4), species, zone: zoneTag }));
        } else if (pc.what === 'headstone') {
          res.objects.push(WG.makeObject('headstone', x, y, WG.cellId('hs', tx, ty, ix, iy), { zone: zoneTag }));
        } else if (pc.what === 'rock') {
          res.objects.push(WG.makeObject('mineralrock', x, y, WG.cellId('mrz', tx, ty, ix, iy),
            { requiredTier: 1, caveVariant: Math.floor(v * nRock), zone: zoneTag }));
        } else if (pc.what === 'tar') {
          res.objects.push(WG.makeObject('tar', x, y, WG.cellId('tar', tx, ty, ix, iy), { zone: zoneTag }));
          res.slowCells.set(iy * N + ix, 'tar');
        }
      }
      if (a.kind === 'tar' && chest) {
        // The fire-slime garrison (lairs.js 'tar' tier), held at the pumps.
        res.lairs.push({ tier: 'tar', sid: WG.cellId('taryard', tx, ty, ix0, iy0),
          lx: (ix0 + 0.5) * frameCellM, ly: (iy0 + 0.5) * frameCellM });
      }
      if (chest || rec.pieces) res.nexus.push(rec);
    }
    return res;
  }
  function dress(ctx) {
    const it = dressSteps(ctx);
    let r = it.next();
    while (!r.done) r = it.next();
    return r.value;
  }

  root.Zones = {
    POI_BUFFER_UNITS, W_MAX_M, R_MIN_M, R_MAX_M, MERGE_M, WINDOW_MARGIN_M, EDGE_JITTER,
    NOISE_UNITS, CORE_S, MAX_FIELD_ANCHORS, ZONE_KINDS, KIND_BY_CODE, ASPECTS,
    SHRINE_SEAT_R, GROVE_CROWD_MAX, HEADSTONE_GHOST_P, HEADSTONE_HOARD_SHARE, HEADSTONE_CONTEXT, HEADSTONE_TIER,
    SHRINE_CONTEXT,
    anchorOf, upmRow, windowM, radiusFor, anchorKey, collectAnchors, resolveAnchors,
    edgeNoise, edgeAt, fieldSteps, field, haloSteps, terrainOf, zoneTerrains, haloOver,
    at, inCore, ghostAnchorAt, anchorFrameM, headstoneHoards,
    ringOffsets, patternPieces, nexusCentre, nexusPieceCell, nexusReachCells, nexusPlan, dressSteps, dress,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
