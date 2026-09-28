// ─────────────────────────────────────────────────────────────────────────
// Zones — INFLUENCE ZONES: the Sacred Grove, the Old Stones, the Tar Yard.
//
// A few kinds of place stamp their character on the ground around them:
//   grove   — a park POI (poi class park / subclass park)
//   stones  — a CHURCH (a place of worship WorldGen.worshipFaith calls
//             christian — its subclass, or a church's name when the tile
//             gives no faith): the invented churchyard round it
//   tar     — a fuel station (fuel / fuel; charging stations are NOT anchors)
// Unnamed parks (no POI), nature reserves and charging stations are no anchor.
// Nor is anything SENSITIVE (WorldGen.isSensitivePoi — the one table): a
// REAL cemetery is quiet green space (no stones zone, no headstones, no
// hoards, no ghosts; its cells are quiet land, WorldGen.QUIET_LAND), and a
// synagogue, mosque, temple or any place of worship whose faith the tile does
// not name mints nothing at all — no zone, no rocks, no chest.
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
// ── THE PARK FRINGE (a park spills past its border) ──────────────────────
// Around EVERY park polygon (named or not; worldgen collects them as it
// paints T.PARK, with their BiomeProfiles park CHARACTER) a ragged band of
// halo ground: GROVE round a park, CHURCHYARD round a cemetery (the LOOK of
// a graveyard's edge only — no anchor, no stones, nothing laid), repainting
// ONLY the halo's own set (RESIDENTIAL / COMMERCIAL / WASTELAND, recorded in
// fld.under like the halo) out to FRINGE_M·(1 ± FRINGE_JITTER) metres of the
// polygon's edge (≤ 20 m), bent by valueNoise2 at the cell's GLOBAL point.
// Seam-safe: the landcover / landuse layers carry a ~64-unit (~23 m) buffer,
// so a park across a seam is in view for the whole band (fringeSteps
// rasterizes the parks into a grid padded past the square). Past the band,
// out to FRINGE_FILL_M, a LIGHT smattering of the character's `filler`
// (long grass for a meadow / common, shrubs for a wooded / formal park) —
// per cell off a hash of the global cell, on the spawn rule (dressSteps).
// The fill's outer ~7 m can see past the buffer's reach at a seam and stop
// short there: accepted, it is a light scatter. It runs AFTER the zone halo
// (a zone's own ground keeps its code) and is terrain + filler only: no
// anchor, no story, no nexus. What it is NOT: a zone (Zones.at stays null).
//
// ── THE NEXUS ────────────────────────────────────────────────────────────
// Each anchor arranges a PATTERN of interactables around its POI, one of
// 1-3 per kind picked by the anchor's aspect (a hash of its global point):
//   grove   rings of wild roses / a ring of trees / roses inside trees, or a
//           SYMMETRIC figure about the POI cell (compass roses, mirrored
//           flower beds, trees / shrubs at the four diagonals — laid WHOLE by
//           the anchor's own tile, shifted outward together when blocked, or
//           dropped: never lopsided) — weighted among the aspects that suit
//           the park's CHARACTER (GROVE_ASPECTS, roses kept the rarer prize;
//           keyed off BiomeProfiles.parkCharacterAt at the anchor, the key the
//           park polygon around it and its POI pad read too), plus ONE shrine
//           (grove_shrine: a daily gift, a light) beside the chest
//   stones  churches take NO fixed pattern:
//           THE GRAVES are a PER-CELL rule over the churchyard halo — a
//           walkable CHURCHYARD cell of the anchor's disc on the grave-row
//           lattice (GRAVE_ROW / GRAVE_COL global cells) holds a headstone
//           when a hash of its global cell passes HEADSTONE_P · s — so the
//           stones wrap the church building (a POI inside a footprint put
//           most of a fixed pattern on BUILDING cells) and are seam-safe by
//           construction. A grave is INVENTED: it passes the laying tile's
//           isSpawnCell with the quiet-land mask, so no headstone ever
//           stands on a real cemetery / grave_yard cell (QUIET_LAND).
//           EVERY stones anchor also scatters plain rocks over its halo
//           (CHURCHYARD_ROCK_P · s, denser at the core), all wearing ONE
//           look (SpriteLayout.CHURCHYARD_ROCK_VARIANT, the `rockVariant`
//           field — the frame and the drop follow it)
//   tar     a grid of tar pits (they SLOW — app.js _bodyHold), a ring of tar
//           with flint inside, or a tar cross — an OIL-STAINED LOT, nothing
//           more. No garrison: a fire enemy at a live forecourt is the one
//           thing a fuel station must never hold (Sep 2026; lairs.js keeps
//           its 'tar' tier row, but nothing here pushes it).
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
// beside the chest) stay the OWNER's (the anchor's point
// in its square — the tile that mints the chest).
// A piece whose cell is blocked (a building, the road, something there)
// walks OUTWARD along its ray from the centre to the first free cell, at most
// RESCUE_CELLS on, inside the tile that owns its cell (a rescue never crosses
// into a neighbour's square, so no piece is laid twice).
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
// row's slow (StreetVariants.SLOW_KINDS, _bodyHold); a headstone's ghost is
// raiseGhostAt's; the shrine's gift is the coin-burst daily ledger; stories
// are _storySplashOnce.
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
      body: 'Moss-grown stones ring the old chapel, and someone still lights its lantern. Walk softly here.',
      flash: 'The old stones. Walk softly.' },
    tar: { code: 3, R: 100, terrain: 'TAR_YARD', story: 'zone_tar', title: 'The tar yard',
      body: 'Oil stains the old fuel yard black, and the tar drags at your feet. Mind where you step.',
      flash: 'The tar yard. Mind your feet.' },
  };
  const KIND_BY_CODE = [null, 'grove', 'stones', 'tar'];
  const R_MAX_M = Math.max(...Object.values(ZONE_KINDS).map((k) => k.R));
  const R_EDGE_MAX_M = R_MAX_M * (1 + EDGE_JITTER);

  // ── The nexus patterns (aspects) ─────────────────────────────────────────
  // Picked per anchor off its own key. A church's one aspect, 'graves', lays
  // no pattern pieces: its headstones are the per-cell GRAVE rule
  // (groundSteps). (Other faiths' rock squares / rings are gone with their
  // anchors — Sep 2026: another faith's house of prayer mints nothing.)
  const ASPECTS = {
    grove: ['rose_rings', 'tree_ring', 'rose_in_trees', 'compass_roses', 'flower_beds', 'diagonal_trees', 'diagonal_shrubs'],
    stones: ['graves'],
    tar: ['tar_grid', 'tar_ring_flint', 'tar_cross'],
  };
  // A grove picks among the aspects that suit its park's CHARACTER
  // (BiomeProfiles.PARK_CHARACTERS): woods ring trees, a formal garden keeps
  // neat rose rings, a meadow its roses, a common a few trees.
  // [aspect, weight] — weighted so ROSES stay the rarer prize ($35 apiece):
  // the rose-free figures carry most of the weight, and the COMPASS ROSES
  // (one rose at each cardinal point) come up about one named park in 6-7.
  const GROVE_ASPECTS = {
    meadow: [['rose_rings', 1], ['rose_in_trees', 1], ['flower_beds', 3], ['compass_roses', 1]],
    wooded: [['tree_ring', 3], ['rose_in_trees', 1], ['diagonal_trees', 2], ['compass_roses', 1]],
    formal: [['rose_rings', 1], ['flower_beds', 3], ['diagonal_shrubs', 2], ['compass_roses', 1]],
    common: [['tree_ring', 2], ['rose_rings', 1], ['diagonal_trees', 2], ['flower_beds', 1], ['compass_roses', 1]],
  };
  // SYMMETRIC FIGURES: laid about the POI cell as ONE figure — whole or not
  // at all. The anchor's OWN tile lays them (never a neighbour: it cannot see
  // the other half's cells), and only when every cell of the figure lies in
  // its square. A blocked cell moves EVERY piece outward along its ray by the
  // same step (symmetric rounding, so the mirror images stay mirrored), up to
  // RESCUE_CELLS; if no step frees them all, the figure is dropped.
  const SYMMETRIC_ASPECTS = new Set(['compass_roses', 'flower_beds', 'diagonal_trees', 'diagonal_shrubs']);
  // How far (cells) a blocked pattern piece may walk outward along its ray.
  const RESCUE_CELLS = 4;
  // The one standing prop per grove: the shrine seats on the first free cell
  // of these rings (radius 1..SHRINE_SEAT_R, N first, clockwise).
  const SHRINE_SEAT_R = 3;
  const RING_ORDER = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
  // NO STACKING ON A FULL PARK: a grove piece is skipped when this many of its
  // eight neighbours already hold something the TILE put there (the park's
  // own flora clumps, a tree, the pad's greenery) — the rings thin out where
  // the park is already dense instead of packing it (owner, Sep 2026).
  const GROVE_CROWD_MAX = 3;

  // ── Headstones (Old Stones — a church's invented churchyard only) ────────
  // A tap raises a ghost this often, at any hour (creature_ai.js raiseGhostAt);
  // HEADSTONE_HOARD_SHARE of them — by a hash of the stone's own id, so the
  // same stones for every player — hold a one-off low-tier find, rolled from
  // HEADSTONE_CONTEXT at HEADSTONE_TIER and spent in save.opened.
  const HEADSTONE_GHOST_P = 1 / 3;
  const HEADSTONE_HOARD_SHARE = 0.2;
  const HEADSTONE_CONTEXT = 'chest:lowtier';
  const HEADSTONE_TIER = 1;
  // THE GRAVES (every stones anchor): the grave-row lattice over GLOBAL cells
  // (tile·N + local) — every GRAVE_ROW-th row, every GRAVE_COL-th column —
  // and the chance a lattice cell holds a stone, × the zone strength s there.
  const GRAVE_ROW = 2, GRAVE_COL = 2;
  const HEADSTONE_P = 0.9;
  // The churchyard's plain rocks (every place of worship): chance per halo
  // cell × s — denser near the core.
  const CHURCHYARD_ROCK_P = 0.10;

  // ── The park fringe (see the header) ─────────────────────────────────────
  const FRINGE_M = 16;                 // band reach at noise 0.5 (metres)
  const FRINGE_JITTER = 0.25;          // ± share of FRINGE_M → 12..20 m
  const FRINGE_NOISE_UNITS = 48;       // ragged-edge lattice, MVT units
  const FRINGE_NOISE_SALT = 3.7;
  const FRINGE_FILL_M = 30;            // the smattering's reach past the edge
  const FRINGE_FILL_P = 0.10;          // its chance at the edge, → 0 at FILL_M
  const GROVE_FILL_P = 0.06;           // a named grove's halo: chance × s
  // The shrine's daily gift: one roll of this context, once per UTC day per
  // shrine, in the coin-burst ledger (save.coinBurstClaimed[id + dayKey]).
  const SHRINE_CONTEXT = 'treasure:shrine';

  // Salts — one stream per use, off the anchor's key.
  const SALT_ASPECT = 0x5a0e1a57;
  const SALT_NEXUS = 0x6e3c05a1;
  const SALT_GRAVE = 0x6a7e5701;
  const SALT_CHROCK = 0xc4a2c401;
  const SALT_FILL = 0xf1a9e501;

  const u01 = (h) => (h >>> 0) / 4294967296;
  // 0..1 off a GLOBAL cell (tile·N + local) and a salt — one per-cell stream
  // per use, the same for every player; a cell belongs to one tile, so each
  // is decided exactly once.
  function cellU01(gx, gy, salt) {
    let h = Math.imul(gx | 0, 0x27d4eb2d) ^ Math.imul(gy | 0, 0x165667b1) ^ salt;
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return u01(h ^ (h >>> 16));
  }
  function hashStr01(s) { return u01(fnv1a(s)); }

  // ── Detection ────────────────────────────────────────────────────────────
  // What kind of anchor a poi feature is, or null. The sensitive-place table
  // answers FIRST (WorldGen.isSensitivePoi — one table everything reads): a
  // memorial, a real cemetery, a place of worship that is not a church
  // (WorldGen.worshipFaith) is no anchor. What is left of worship IS a
  // church, and a church is the invented churchyard (the stones, the graves).
  function anchorOf(tags) {
    const t = tags || {};
    const WG = root.WorldGen;
    if (WG && WG.isSensitivePoi && WG.isSensitivePoi(t)) return null;
    const c = t.class, sub = t.subclass;
    if (root.BiomeProfiles ? root.BiomeProfiles.isParkPoi(t) : (c === 'park' && sub === 'park')) return { kind: 'grove' };
    if (c === 'fuel' && sub === 'fuel') return { kind: 'tar' };
    // A church, by the table above (without WorldGen loaded: the tag alone).
    if (c === 'place_of_worship' && (WG || sub === 'christian')) return { kind: 'stones' };
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
        out.push({ kind: k.kind, gx, gy, lx: p.x, ly: p.y,
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
        // A grove wears its park's CHARACTER (the key the park polygon and
        // its POI pad read) and picks among the aspects that suit it.
        if (kind === 'grove' && root.BiomeProfiles) a.character = root.BiomeProfiles.parkCharacterAt(a.gx, a.gy);
        const u = root.WorldGen.makeRng((a.key ^ SALT_ASPECT) >>> 0)();
        const wl = kind === 'grove' && a.character && GROVE_ASPECTS[a.character];
        if (wl) {
          const tot = wl.reduce((t, e) => t + e[1], 0);
          let acc = 0;
          a.aspect = wl[wl.length - 1][0];
          for (const [asp, wt] of wl) { acc += wt / tot; if (u < acc) { a.aspect = asp; break; } }
        } else {
          const list2 = ASPECTS[kind];
          a.aspect = list2[Math.floor(u * list2.length)];
        }
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

  // ── The park fringe (a generator — the end of rasterizeTileSteps) ─────────
  // ctx: { parks: [{ rings (tile-local MVT, buffer included), character,
  //        cemetery }], grid (final, zone halo already painted), N, tx, ty,
  //        field (the zone field or null), pathUnder }
  // Rasterizes every park into a grid PADDED past the square (so a park in a
  // neighbour's buffer is seen), runs a two-pass distance transform carrying
  // the nearest park's label, then repaints the ragged band. Returns
  //   { field (ctx.field, or a stub { anchors: [], idx: null, s: null,
  //     reach: [], under } when the tile has no zone), edgeM (Float32Array
  //     N·N: metres from the nearest park's edge, 0 inside, Infinity past
  //     FRINGE_FILL_M), park (Uint16Array N·N: 1 + index into parks),
  //     parks, painted } — or null when there are no parks. edgeM / park are
  //     the dressing's work arrays, never stored on the entry.
  function fringeReach(gx, gy) {
    return FRINGE_M * (1 + FRINGE_JITTER * (2 * valueNoise2(gx / FRINGE_NOISE_UNITS, gy / FRINGE_NOISE_UNITS, FRINGE_NOISE_SALT) - 1));
  }
  function* fringeSteps(ctx) {
    const parks = ctx && ctx.parks;
    if (!parks || !parks.length) return null;
    const WG = root.WorldGen;
    const { grid, N, tx, ty } = ctx;
    const CELL_M = WG.CELL_M;
    const P = Math.ceil(FRINGE_FILL_M / CELL_M) + 1;
    const M = N + 2 * P;
    const mvtToCell = N / EXT;
    const lab = new Uint16Array(M * M);
    // Scanline fill, centre-sampled like worldgen's paintPolygonSteps; the
    // first park to claim a cell keeps it (feature order is the tile's).
    for (let k = 0; k < parks.length; k++) {
      yield 'park fringe raster';
      const polys = parks[k].rings.map((r) => r.map((p) => ({ x: p.x * mvtToCell, y: p.y * mvtToCell })));
      let minY = Infinity, maxY = -Infinity;
      for (const ring of polys) for (const p of ring) { if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; }
      const y0 = Math.max(-P, Math.floor(minY)), y1 = Math.min(N + P - 1, Math.ceil(maxY));
      for (let y = y0; y <= y1; y++) {
        if (((y - y0) & 31) === 31) yield 'park fringe raster rows';
        const ys = y + 0.5, xs = [];
        for (const ring of polys) {
          for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const a = ring[j], b = ring[i];
            if ((a.y > ys) !== (b.y > ys)) xs.push(a.x + (ys - a.y) / (b.y - a.y) * (b.x - a.x));
          }
        }
        xs.sort((p, q) => p - q);
        const row = (y + P) * M;
        for (let q = 0; q + 1 < xs.length; q += 2) {
          const xa = Math.max(-P, Math.ceil(xs[q] - 0.5)), xb = Math.min(N + P - 1, Math.floor(xs[q + 1] - 0.5));
          for (let x = xa; x <= xb; x++) if (!lab[row + x + P]) lab[row + x + P] = k + 1;
        }
      }
    }
    // Two-pass (1, √2) distance transform in cells, carrying the label.
    const D = new Float32Array(M * M);
    for (let i = 0; i < M * M; i++) D[i] = lab[i] ? 0 : Infinity;
    const R2 = Math.SQRT2;
    for (let y = 0; y < M; y++) {
      if ((y & 31) === 31) yield 'park fringe distance';
      for (let x = 0; x < M; x++) {
        const i = y * M + x;
        if (!D[i]) continue;
        let d = D[i], l = lab[i], j;
        if (x > 0 && D[j = i - 1] + 1 < d) { d = D[j] + 1; l = lab[j]; }
        if (y > 0) {
          if (D[j = i - M] + 1 < d) { d = D[j] + 1; l = lab[j]; }
          if (x > 0 && D[j = i - M - 1] + R2 < d) { d = D[j] + R2; l = lab[j]; }
          if (x < M - 1 && D[j = i - M + 1] + R2 < d) { d = D[j] + R2; l = lab[j]; }
        }
        D[i] = d; lab[i] = l;
      }
    }
    for (let y = M - 1; y >= 0; y--) {
      if ((y & 31) === 31) yield 'park fringe distance';
      for (let x = M - 1; x >= 0; x--) {
        const i = y * M + x;
        if (!D[i]) continue;
        let d = D[i], l = lab[i], j;
        if (x < M - 1 && D[j = i + 1] + 1 < d) { d = D[j] + 1; l = lab[j]; }
        if (y < M - 1) {
          if (D[j = i + M] + 1 < d) { d = D[j] + 1; l = lab[j]; }
          if (x < M - 1 && D[j = i + M + 1] + R2 < d) { d = D[j] + R2; l = lab[j]; }
          if (x > 0 && D[j = i + M - 1] + R2 < d) { d = D[j] + R2; l = lab[j]; }
        }
        D[i] = d; lab[i] = l;
      }
    }
    // The square: metres from the nearest park's EDGE (a neighbour cell's
    // centre is half a cell past it), and the band.
    const fld = ctx.field || { anchors: [], idx: null, s: null, reach: [] };
    const under = fld.under || (fld.under = new Uint8Array(N * N));
    const over = haloOver();
    const T = WG.T;
    const edgeM = new Float32Array(N * N), park = new Uint16Array(N * N);
    const cellU = EXT / N;
    const bandAt = (i, ix, iy) => {
      const dm = edgeM[i];
      if (!(dm > 0) || !Number.isFinite(dm)) return 0;
      if (dm > fringeReach(tx * EXT + (ix + 0.5) * cellU, ty * EXT + (iy + 0.5) * cellU)) return 0;
      return parks[park[i] - 1].cemetery ? T.CHURCHYARD : T.GROVE;
    };
    let painted = 0;
    for (let iy = 0; iy < N; iy++) {
      if ((iy & 31) === 31) yield 'park fringe band';
      for (let ix = 0; ix < N; ix++) {
        const j = (iy + P) * M + ix + P, i = iy * N + ix;
        const dc = D[j];
        const dm = dc === 0 ? 0 : (dc - 0.5) * CELL_M;
        if (dm > FRINGE_FILL_M) { edgeM[i] = Infinity; continue; }
        edgeM[i] = dm; park[i] = lab[j];
        if (dm === 0 || !over.has(grid[i])) continue;
        const code = bandAt(i, ix, iy);
        if (!code) continue;
        under[i] = grid[i];
        grid[i] = code;
        painted++;
      }
    }
    // A footpath through the band draws the band's ground under its pebbles
    // (the zone's own ground keeps the halo's answer).
    const pathUnder = ctx.pathUnder;
    if (pathUnder && painted) {
      let k = 0;
      for (const key in pathUnder) {
        if ((++k & 511) === 0) yield 'park fringe paths';
        if (!over.has(pathUnder[key])) continue;
        const us = key.indexOf('_');
        const x = +key.slice(0, us), y = +key.slice(us + 1);
        if (!(x >= 0 && y >= 0 && x < N && y < N)) continue;
        const code = bandAt(y * N + x, x, y);
        if (code) pathUnder[key] = code;
      }
    }
    return { field: fld, edgeM, park, parks, painted };
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
      // The symmetric figures (SYMMETRIC_ASPECTS — laid whole or not at all).
      case 'compass_roses':  add('rose', [[0, -2], [2, 0], [0, 2], [-2, 0]]); break;
      case 'flower_beds':
        add('forgetmenot', [[-3, -1], [3, -1], [-3, 1], [3, 1]]);
        add('marigold', [[-3, 0], [3, 0]]);
        break;
      case 'diagonal_trees':  add('tree', [[-3, -3], [3, -3], [3, 3], [-3, 3]]); break;
      case 'diagonal_shrubs': add('shrub', [[-2, -2], [2, -2], [2, 2], [-2, 2]]); break;
      case 'headstone_ring': add('headstone', ringOffsets(2, 1.5)); break;
      case 'headstone_rows':
        for (const dy of [-3, 3]) for (const dx of [-4, -2, 0, 2, 4]) P.push({ what: 'headstone', dx, dy });
        break;
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
    const treeSpecies = root.WorldGen.TREE_SPECIES;
    const species = treeSpecies[Math.floor(rng() * treeSpecies.length)];
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
  // stamp and the grove shrine stay the OWNER's (a.owned — they belong to the
  // chest). `lairs` stays in the result for its readers, and stays EMPTY: a
  // zone holds no garrison (the tar yard's fire slimes are gone, Sep 2026).
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
    // EVERY churchyard rock wears the one look (the frame and the drop follow
    // the explicit `rockVariant` — SpriteLayout.plainRockVariant reads it first).
    const rockLook = (root.SpriteLayout && root.SpriteLayout.CHURCHYARD_ROCK_VARIANT != null)
      ? root.SpriteLayout.CHURCHYARD_ROCK_VARIANT : 3;
    const ok = (ix, iy) => ix >= 0 && iy >= 0 && ix < N && iy < N
      && WG.isSpawnCell(grid, N, N, ix, iy, spawnOpts);
    for (const a of (fld.reach || fld.anchors)) {
      yield 'zone nexus';
      const c = nexusCentre(a, ty, N);
      // The owner's chest (it may have lost the POI dedup: no chest, no stamp,
      // no shrine — the pattern is the anchor's and is laid still).
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
      // A symmetric figure: the anchor's own tile lays it whole (every cell
      // at one common step) or nobody does.
      let figure = null;
      if (SYMMETRIC_ASPECTS.has(a.aspect)) {
        const mine = Math.floor(a.gx / EXT) === tx && Math.floor(a.gy / EXT) === ty;
        figure = mine ? figureCells(c, plan.pieces, tx, ty, N, ok, crowded) : null;
        if (!figure) { if (chest) res.nexus.push(rec); continue; }
      }
      for (let pi = 0; pi < plan.pieces.length; pi++) {
        const pc = plan.pieces[pi];
        const cell = figure ? figure[pi] : nexusPieceCell(c, pc.dx, pc.dy, tx, ty, N);
        if (!cell) continue;                     // another tile's square lays it
        let { ix, iy } = cell;
        const v = pc.v;
        if (figure) {
          // (already checked whole)
        } else if (!ok(ix, iy)) {
          // BLOCKED (a building, the road, something there): walk outward
          // along the piece's ray to the first free cell, RESCUE_CELLS at
          // most, inside this tile's square only.
          const moved = rescueCell(c, pc.dx, pc.dy, tx, ty, N, ok, crowded);
          if (!moved) continue;
          ix = moved.ix; iy = moved.iy;
        } else if (crowded(ix, iy)) continue;
        claim(ix, iy);
        const x = cx(ix), y = cy(iy);
        if (pc.what === 'rose') {
          res.wildplants.push(WG.makeWildplant('wildrose', x, y, WG.cellId('wz', tx, ty, ix, iy), { zone: zoneTag }));
        } else if (pc.what === 'forgetmenot' || pc.what === 'marigold' || pc.what === 'shrub') {
          res.wildplants.push(WG.makeWildplant(pc.what, x, y, WG.cellId('wz', tx, ty, ix, iy), { zone: zoneTag }));
        } else if (pc.what === 'flint') {
          res.wildplants.push(WG.makeWildplant('flint', x, y, WG.cellId('wz', tx, ty, ix, iy), { zone: zoneTag }));
        } else if (pc.what === 'tree') {
          res.objects.push(WG.makeObject('tree', x, y, WG.cellId('ztree', tx, ty, ix, iy),
            { variant: 1 + Math.floor(v * 4), species, zone: zoneTag }));
        } else if (pc.what === 'headstone') {
          res.objects.push(WG.makeObject('headstone', x, y, WG.cellId('hs', tx, ty, ix, iy), { zone: zoneTag }));
        } else if (pc.what === 'tar') {
          res.objects.push(WG.makeObject('tar', x, y, WG.cellId('tar', tx, ty, ix, iy), { zone: zoneTag }));
          res.slowCells.set(iy * N + ix, 'tar');
        }
      }
      if (chest || rec.pieces) res.nexus.push(rec);
    }
    yield* groundSteps(ctx, res, ok, rockLook);
    return res;
  }

  // Round half AWAY from zero, so a piece and its mirror image land on
  // mirrored cells (Math.round(-1.5) is -1, Math.round(1.5) is 2).
  const roundSym = (x) => (x < 0 ? -Math.round(-x) : Math.round(x));
  // Offset (dx, dy) pushed `k` cells further out along its ray.
  function rayStep(dx, dy, k) {
    const r = Math.hypot(dx, dy);
    if (!k || !(r > 0)) return [dx, dy];
    const f = (r + k) / r;
    return [roundSym(dx * f), roundSym(dy * f)];
  }
  // A symmetric figure's cells at the first step k = 0..RESCUE_CELLS where
  // every piece's cell is in THIS square, distinct, passes `ok` and is not
  // crowded — or null (the figure is dropped whole).
  function figureCells(c, pieces, tx, ty, N, ok, crowded) {
    for (let k = 0; k <= RESCUE_CELLS; k++) {
      const cells = [], seen = new Set();
      let good = true;
      for (const pc of pieces) {
        const [ddx, ddy] = rayStep(pc.dx, pc.dy, k);
        const cell = nexusPieceCell(c, ddx, ddy, tx, ty, N);
        if (!cell || seen.has(cell.iy * N + cell.ix)) { good = false; break; }
        seen.add(cell.iy * N + cell.ix);
        if (!ok(cell.ix, cell.iy) || crowded(cell.ix, cell.iy)) { good = false; break; }
        cells.push(cell);
      }
      if (good) return cells;
    }
    return null;
  }

  // Walk a blocked pattern piece outward along its ray (centre → (dx, dy))
  // to the first cell in THIS tile's square that passes `ok` and is not
  // crowded, at most RESCUE_CELLS on; null when there is none.
  function rescueCell(c, dx, dy, tx, ty, N, ok, crowded) {
    if (!(Math.hypot(dx, dy) > 0)) return null;
    let last = null;
    for (let k = 1; k <= RESCUE_CELLS; k++) {
      const [ddx, ddy] = rayStep(dx, dy, k);
      const cell = nexusPieceCell(c, ddx, ddy, tx, ty, N);
      if (!cell) continue;
      if (last && last.ix === cell.ix && last.iy === cell.iy) continue;
      last = cell;
      if (ok(cell.ix, cell.iy) && !crowded(cell.ix, cell.iy)) return cell;
    }
    return null;
  }

  // ── The zone GROUND: per-cell rules over the square (after the nexus) ─────
  // One pass over the tile's cells, each rule off its own per-cell hash of
  // the GLOBAL cell (cellU01, own salt) — no rng, seam-safe by construction
  // (every cell belongs to one tile), each piece on the spawn rule (roadMask
  // + occupied) and claiming its cell:
  //   THE GRAVES      a church's walkable CHURCHYARD cell on the grave
  //                   lattice → a headstone with chance HEADSTONE_P · s —
  //                   never on real grave land (`ok` reads the quiet mask)
  //   CHURCHYARD ROCKS every stones anchor's CHURCHYARD cell → a plain rock
  //                   (the one look) with chance CHURCHYARD_ROCK_P · s
  //   THE FRINGE FILL past a park's edge (fringeSteps' edgeM) the park
  //                   character's filler with chance FRINGE_FILL_P · (1 − d /
  //                   FRINGE_FILL_M); on a named grove's halo GROVE_FILL_P · s
  //                   of its own character's — whichever is likelier
  function* groundSteps(ctx, res, ok, rockLook) {
    const WG = root.WorldGen, BP = root.BiomeProfiles;
    const fld = ctx.field;
    const fr = ctx.fringe || null;
    const { tx, ty, N, tileEdgeM, grid, spawnOpts } = ctx;
    if (!fld.idx && !fr) return;
    const T = WG.T;
    const occ = spawnOpts.occupied;
    const frameCellM = tileEdgeM / N;
    const ox = tx * tileEdgeM, oy = ty * tileEdgeM;
    const fillerOf = (id) => (BP && BP.parkCharacter(id) && BP.parkCharacter(id).filler) || 'longgrass';
    let graves = 0, rocks = 0, fill = 0;
    for (let iy = 0; iy < N; iy++) {
      if ((iy & 15) === 15) yield 'zone ground rows';
      const gy = ty * N + iy;
      for (let ix = 0; ix < N; ix++) {
        const i = iy * N + ix;
        const gx = tx * N + ix;
        const a = fld.idx && fld.idx[i] ? fld.anchors[fld.idx[i] - 1] : null;
        const s = a ? fld.s[i] / 255 : 0;
        const x = ox + (ix + 0.5) * frameCellM, y = oy + (iy + 0.5) * frameCellM;
        if (a && a.kind === 'stones' && grid[i] === T.CHURCHYARD) {
          if (((gy % GRAVE_ROW) + GRAVE_ROW) % GRAVE_ROW === 0 && ((gx % GRAVE_COL) + GRAVE_COL) % GRAVE_COL === 0
              && cellU01(gx, gy, SALT_GRAVE) < HEADSTONE_P * s && ok(ix, iy)) {
            occ.add(i); graves++;
            res.objects.push(WG.makeObject('headstone', x, y, WG.cellId('hs', tx, ty, ix, iy), { zone: 'stones' }));
            continue;
          }
          if (cellU01(gx, gy, SALT_CHROCK) < CHURCHYARD_ROCK_P * s && ok(ix, iy)) {
            occ.add(i); rocks++;
            res.objects.push(WG.makeObject('mineralrock', x, y, WG.cellId('mrz', tx, ty, ix, iy),
              { requiredTier: 1, yieldTier: 1, rockVariant: rockLook, zone: 'stones' }));
            continue;
          }
        }
        let p = 0, crop = null;
        if (fr) {
          const d = fr.edgeM[i];
          if (d > 0 && d <= FRINGE_FILL_M) {
            p = FRINGE_FILL_P * (1 - d / FRINGE_FILL_M);
            crop = fillerOf(fr.parks[fr.park[i] - 1].character);
          }
        }
        if (a && a.kind === 'grove' && a.character && grid[i] === T.GROVE && GROVE_FILL_P * s > p) {
          p = GROVE_FILL_P * s;
          crop = fillerOf(a.character);
        }
        if (!(p > 0) || cellU01(gx, gy, SALT_FILL) >= p || !ok(ix, iy)) continue;
        occ.add(i); fill++;
        res.wildplants.push(WG.makeWildplant(crop, x, y, WG.cellId('wpf', tx, ty, ix, iy), { fringe: true }));
      }
    }
    // What the balancing page reports: the per-cell tallies, the fringe band
    // and the park polygons by character.
    res.ground = { graves, rocks, fill };
    if (fr) {
      const chars = {};
      for (const pk of fr.parks) chars[pk.character] = (chars[pk.character] || 0) + 1;
      res.fringe = { painted: fr.painted, parks: fr.parks.length, chars };
    }
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
    SHRINE_CONTEXT, GROVE_ASPECTS, SYMMETRIC_ASPECTS, RESCUE_CELLS, rayStep, figureCells, GRAVE_ROW, GRAVE_COL, HEADSTONE_P, CHURCHYARD_ROCK_P,
    FRINGE_M, FRINGE_JITTER, FRINGE_NOISE_UNITS, FRINGE_FILL_M, FRINGE_FILL_P, GROVE_FILL_P,
    cellU01, fringeReach, fringeSteps, rescueCell,
    anchorOf, upmRow, windowM, radiusFor, anchorKey, collectAnchors, resolveAnchors,
    edgeNoise, edgeAt, fieldSteps, field, haloSteps, terrainOf, zoneTerrains, haloOver,
    at, inCore, anchorFrameM, headstoneHoards,
    ringOffsets, patternPieces, nexusCentre, nexusPieceCell, nexusReachCells, nexusPlan, dressSteps, dress,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
