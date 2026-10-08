// ─────────────────────────────────────────────────────────────────────────
// Scenic — SCENIC PATHS, BEACHES and VIEWPOINTS: the walks worth taking.
//
// Everything here is GENERATED (a pure function of the tile's own MVT bytes,
// the same for every player) and read by the lanes that already exist — it is
// a table and a set of REASONS, never a lane of its own:
//
//   SCENIC PATHS  an off-road walking way (footway / path / cycleway /
//                 pedestrian / steps, or a pier) that runs by the WATER, along
//                 a named GREENWAY or through a PARK. Its scenic metres bank
//                 heavier on the ONE restore ladder (app.js _ripenStreets →
//                 _bankStreetMetres → Trail.bank, SCENIC_MUL): a new reason on
//                 that ladder, never a second ladder. The km chip shows TRUE
//                 metres restored (Trail.restoredMetres subtracts the bonus);
//                 the bonus shows in the prizes. The LIVING-LAMP re-walk credit
//                 is NOT multiplied: a path lamp already pays twice a street's
//                 (Streets.lampCreditM), and nearly every scenic way is a path,
//                 so the scenic buff is on the first walk (once per metre,
//                 ever) and the lamps stay the daily reason for every path.
//                 Their LOOK is a row of StreetVariants.STREET_VARIANTS (size
//                 'path': promenade / greenway / parkpath — never rolled, read
//                 off the scenic class): the lamp glow and the first-walk story.
//   VISTA CHESTS  one one-time chest per scenic STRETCH — (512-unit lattice
//                 square, scenic kind) holding VISTA_STRETCH_MIN_M or more of
//                 that kind — seated on the path's verge as a 'reward' (the
//                 spawn gate: open ground, off the road, out of the kerb
//                 buffer), on the path's own side of any Major-and-Medium road band.
//   VIEWPOINTS    a poi `attraction / viewpoint` point (OMT tourism=viewpoint).
//                 Its own POI chest is the grail (VISTA_CHEST_TIER.grail, T5,
//                 one-time — loot.js chestBaseTier reads the `vista` stamp),
//                 and a SCOPE stands beside it: it marks a chosen nearby find
//                 for a day, the first vista a save ever taps pays a backpack
//                 (firstVistaPrize, once), its
//                 story panel (zone_viewpoint), and its ring is a REST spot —
//                 a new reason on the campfire's rest (FIRE_REST_R), not a
//                 ward. Rarity is the point: nothing is synthesised.
//   BEACHES       SHORE SAND (a SAND cell within SCENIC_SHORE_CELLS of water —
//                 inland sand, bunkers and volleyball keep today's behaviour):
//                 its buried X marks follow the SHORELINE (beachXCount, one per
//                 BEACH_X_SHORE_M, capped) instead of the tile's flat cap, and
//                 a DAILY TIDE LINE — shells and driftwood on the waterline
//                 cells, the same for every player (seeded by cell id + UTC
//                 day, tideLive), picked into the day ledger (never
//                 save.picked) and back tomorrow — and a few MESSAGE BOTTLES
//                 (BEACH_BOTTLES_PER_TILE, fixed seats): each reads one Book
//                 page once (interactables.js pageStone, save.opened).
//
// SEAM-SAFE BY CONSTRUCTION. Every distance test is geometry within the MVT
// buffer (transportation / water / landcover carry ~64 units, the radii here
// are clamped under it — SHORE_MAX_UNITS) of an IN-SQUARE point, so both
// tiles that can see a way classify its points alike; each metre is only
// ever classified by the tile whose square holds it (Streets.tileSpans).
// Radii are stated in generation METRES / CELLS and converted through the
// tile's own cells (N · CELL_M / extent), never the save's frame. Intervals
// are stored in MVT ARCLENGTH UNITS — frame-free — and scaled by the reader's
// mvtToM (arclength is linear in it), so two players with different homes
// read the same stretches.
//
// SAFETY: nothing pays for standing on a verge or a road. A path sample within
// SIDEWALK_M of any vehicle way, or BUSY_VERGE_M of the Major-and-Medium road group (the kerb buffer's
// internal `major` group — StreetVariants.sizeOfTags — tertiary and up), is not
// scenic whatever its name, so pavements, crossings and arterial side-paths
// drop out. Every reward piece is seated through WorldGen.isSpawnCell (the
// road mask, the occupancy, the kerb buffer) and on its own side of a Major-and-Medium road
// band (StreetVariants.nearestSeat). The multiplier rides the sweep, which
// already refuses a passenger (isTooFast).
//
// What this is NOT: a restoration ladder (Trail), a lamp list (app.js), a Nexus (Zones —
// a viewpoint paints no terrain and has no field), or a crate (it restocks
// nothing: the tide line is the day's, the chests are one-time).
//
// Pure: no Phaser, no DOM. Reads WorldGen / Streets / StreetVariants / fnv1a
// at CALL time. Audit: test/node/scenic.test.js.
// ─────────────────────────────────────────────────────────────────────────
(function (root) {
  'use strict';

  // ── The numbers (owner picks, Sep 2026) ────────────────────────────────
  // What a scenic metre banks on the ladder, per kind: water 2×, park and
  // greenway 1.75×, shore stays 2×.
  // One table: _ripenStreets banks through bonusMetres, the Book tip prints it.
  const SCENIC_MUL = { shore: 2.0, greenway: 1.75, park: 1.75 };
  // Which kind wins a sample several apply to: the richest first.
  const KIND_ORDER = ['shore', 'greenway', 'park'];
  // The scenic path theme row each kind wears (lamp glow + story).
  const KIND_ROW = { shore: 'promenade', greenway: 'greenway', park: 'parkpath' };
  // How near water a path point must be to be SHORE (cells of the tile's own
  // grid), and the ceiling in MVT units that keeps it inside the ~64-unit
  // buffer at high latitudes (exact up to ~57° N, a metre or two short past).
  const SCENIC_SHORE_CELLS = 3;
  const SHORE_MAX_UNITS = 60;
  // THE SIDEWALK FILTER (the safety rule): a path point within SIDEWALK_M of
  // any vehicle way, or BUSY_VERGE_M of a MAJOR way, is not scenic.
  const SIDEWALK_M = 10;
  const BUSY_VERGE_M = 15;
  // A park path counts only in a NAMED park or one of at least this area.
  const PARK_MIN_M2 = 10000;
  // The classification step along a way (generation metres).
  const SAMPLE_M = 5;
  // A grass tuft on each verge every other classification sample.
  const GREENWAY_GRASS_STEP_M = SAMPLE_M * 2;
  // Greenway names (the name alone upgrades only an OFF-ROAD sample).
  const GREENWAY_RE = /greenway|trail|seawall|sea wall|promenade|walkway|boardwalk|esplanade|corridor|ufer|mauerweg|towpath|\bloop\b/i;
  // Eligible ways: the walking subclasses of OMT's class `path` (or the class
  // itself, in a schema that spells it so), plus piers.
  const PATH_SUBCLASSES = new Set(['footway', 'path', 'cycleway', 'pedestrian', 'steps', 'bridleway']);
  // Water that makes a shore: not a pool, a garden pond or a dock basin.
  const NOT_SHORE_WATER = new Set(['swimming_pool', 'pond', 'dock']);
  const SHORE_WATERWAYS = new Set(['river', 'canal']);
  // Park polygons: the park layer, and these landcover kinds.
  const PARK_GRASS = new Set(['park', 'recreation_ground', 'meadow', 'grassland']);

  // ── Vista chests ───────────────────────────────────────────────────────
  // A stretch is (lattice square, kind): the squares are StreetVariants'
  // BANDIT_STRETCH_UNITS (512 global MVT units, ~200 m, tile-aligned — one
  // tile owns each). A stretch with at least this many scenic metres of its
  // kind in the square stands one chest.
  const VISTA_STRETCH_MIN_M = 120;
  // How far (cells) off the way the chest may be seated.
  const VISTA_SEAT_CELLS = 3;
  // loot.js chestBaseTier reads o.vista through this table. Every vista chest
  // for a viewpoint or path is T5; reef discoveries are T2–T3. The grail uses the treasure-only vista pool, while a scenic
  // stretch keeps the park theme through POI_CATEGORY.vista.
  const VISTA_CHEST_TIER = { grail: 5, shore: 5, greenway: 5, park: 5, reef2: 2, reef3: 3 };
  const VISTA_POI_CLASS = 'vista';

  // ── Viewpoints ─────────────────────────────────────────────────────────
  // Two viewpoints closer than this (generation metres) are one place: the
  // later key is dropped (Zones' MERGE rule, off the poi buffer — the
  // neighbour's copy of a point is bit-identical, so both tiles agree).
  const VISTA_MERGE_M = 40;
  // The scope seats on the first free cell of the rings round the chest
  // (radius 1..SCOPE_SEAT_R, WorldGen.RING_ORDER).
  const SCOPE_SEAT_R = 3;
  // The vista treasure context retained for the shared treasure value table.
  const VISTA_CONTEXT = 'treasure:vista';
  // The first vista a save ever taps: a relic, once (save.vistaRelic).
  const FIRST_VISTA_SLOT = 'bag';
  // The vista's story (its painting stem and the _storySplashOnce key).
  const VISTA_STORY = {
    story: 'zone_viewpoint', title: 'A vista',
    body: 'An old spyglass points out across the landscape. You stop to take in the view.',
    flash: 'A vista. Look a while.',
  };

  // ── Beaches ────────────────────────────────────────────────────────────
  // One buried X per this many metres of shoreline (waterline cells ×
  // CELL_M), capped per tile; one tide pickup a day per TIDE_PER_M, capped.
  const BEACH_X_SHORE_M = 40;
  const BEACH_X_MAX = 24;
  const TIDE_PER_M = 25;
  const TIDE_MAX = 12;
  // A shore-sand cell this close to water (cells) is the WATERLINE.
  const WATERLINE_CELLS = 1.5;
  // What the tide leaves, by one hash of (cell, day): driftwood this often,
  // else a shell.
  const TIDE_DRIFTWOOD_P = 0.32;
  // MESSAGE BOTTLES: at most this many per tile, on waterline cells, the
  // lowest hashes of their cell ids — the same seats for every player. A
  // bottle is a ground pickup that reads one Book page (interactables.js
  // INTERACTABLES.bottle — the notice board's pageStone lane) and is gone.
  const BEACH_BOTTLES_PER_TILE = 3;


  // ── Tags ─────────────────────────────────────────────────────────────────
  const truthy = (v) => v != null && v !== '' && v !== 0 && v !== '0' && v !== 'no' && v !== false;
  function isEligibleWay(tags) {
    const t = tags || {};
    const c = t.class || '';
    if (c === 'pier') { /* a pier is a boardwalk */ }
    else if (c === 'path') { if (!PATH_SUBCLASSES.has(t.subclass || 'path')) return false; }
    else if (!PATH_SUBCLASSES.has(c) || c === 'path') return false;
    if (truthy(t.indoor)) return false;
    if (t.brunnel === 'tunnel') return false;
    if (t.foot === 'no' || t.foot === 'private') return false;
    if (t.access === 'no' || t.access === 'private') return false;
    return true;
  }
  // A way a vehicle drives beside the path (the sidewalk test). Driveways and
  // lot lanes (WorldGen.isLotLane — already cut from the layer) are no
  // street; a tunnel is under the ground.
  function isVehicleWay(tags) {
    const t = tags || {};
    const WG = root.WorldGen;
    if (t.service === 'driveway' || (WG && WG.isLotLane(t)) || t.brunnel === 'tunnel') return false;
    const SV = root.StreetVariants;
    return !!(SV && SV.isVehicleTags(t));
  }
  // …and a MAJOR one: the kerb's own tier (StreetVariants.sizeOfTags — one
  // table with the kerb buffer and the Old Trade Road).
  function isBusyWay(tags) {
    const SV = root.StreetVariants;
    return isVehicleWay(tags) && !!SV && SV.sizeOfTags(tags) === 'major';
  }
  function isShoreWater(tags) {
    return !NOT_SHORE_WATER.has((tags && tags.class) || '');
  }
  function isShoreWaterway(tags) {
    const t = tags || {};
    return SHORE_WATERWAYS.has(t.class) && t.brunnel !== 'tunnel';
  }
  function isBeachSand(tags) {
    return !!tags && tags.class === 'sand' && tags.subclass === 'beach';
  }
  // A viewpoint poi (OMT: class attraction, subclass viewpoint), never a
  // sensitive place (WorldGen.isSensitivePoi — the one table).
  function isViewpoint(tags) {
    const t = tags || {};
    if (t.subclass !== 'viewpoint') return false;
    const WG = root.WorldGen;
    return !(WG && WG.isSensitivePoi && WG.isSensitivePoi(t));
  }

  // ── Geometry: a bucketed segment index and a polygon index (MVT units) ──
  const BUCKET_U = 128;
  function segIndex(ext) {
    const lo = -BUCKET_U * 2, span = ext + BUCKET_U * 4;
    const n = Math.ceil(span / BUCKET_U);
    const buckets = new Map();
    const bk = (x) => Math.max(0, Math.min(n - 1, Math.floor((x - lo) / BUCKET_U)));
    let count = 0;
    function add(ax, ay, bx, by) {
      const x0 = bk(Math.min(ax, bx)), x1 = bk(Math.max(ax, bx));
      const y0 = bk(Math.min(ay, by)), y1 = bk(Math.max(ay, by));
      const seg = [ax, ay, bx, by];
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const k = y * n + x;
          let b = buckets.get(k);
          if (!b) buckets.set(k, b = []);
          b.push(seg);
        }
      }
      count++;
    }
    function addLine(line) {
      for (let i = 1; i < line.length; i++) add(line[i - 1].x, line[i - 1].y, line[i].x, line[i].y);
    }
    function addRing(ring) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) add(ring[j].x, ring[j].y, ring[i].x, ring[i].y);
    }
    // Is any segment within r of (x, y)?
    function near(x, y, r) {
      if (!count) return false;
      const r2 = r * r;
      const x0 = bk(x - r), x1 = bk(x + r), y0 = bk(y - r), y1 = bk(y + r);
      for (let by = y0; by <= y1; by++) {
        for (let bx = x0; bx <= x1; bx++) {
          const b = buckets.get(by * n + bx);
          if (!b) continue;
          for (const s of b) if (segD2(x, y, s) <= r2) return true;
        }
      }
      return false;
    }
    return { add, addLine, addRing, near, get count() { return count; } };
  }
  function segD2(px, py, s) {
    const ax = s[0], ay = s[1], dx = s[2] - ax, dy = s[3] - ay;
    const L = dx * dx + dy * dy;
    let t = L > 0 ? ((px - ax) * dx + (py - ay) * dy) / L : 0;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    const qx = ax + dx * t - px, qy = ay + dy * t - py;
    return qx * qx + qy * qy;
  }
  function polyIndex(ext) {
    const lo = -BUCKET_U * 2, span = ext + BUCKET_U * 4;
    const n = Math.ceil(span / BUCKET_U);
    const buckets = new Map();
    const bk = (x) => Math.max(0, Math.min(n - 1, Math.floor((x - lo) / BUCKET_U)));
    let count = 0;
    function add(rings) {
      const { minX: x0, minY: y0, maxX: x1, maxY: y1 } = root.WorldGen.bboxOf(rings);
      if (!(x1 >= x0)) return;
      const poly = { rings, x0, y0, x1, y1 };
      for (let y = bk(y0); y <= bk(y1); y++) {
        for (let x = bk(x0); x <= bk(x1); x++) {
          const k = y * n + x;
          let b = buckets.get(k);
          if (!b) buckets.set(k, b = []);
          b.push(poly);
        }
      }
      count++;
    }
    function contains(x, y) {
      if (!count) return false;
      const b = buckets.get(bk(y) * n + bk(x));
      if (!b) return false;
      for (const P of b) {
        if (x < P.x0 || x > P.x1 || y < P.y0 || y > P.y1) continue;
        if (root.WorldGen.pointInRings(P.rings, x, y)) return true;
      }
      return false;
    }
    return { add, contains, get count() { return count; } };
  }
  // Signed-area total of a feature's rings (outer minus holes), in units².
  function ringsAreaU2(rings) {
    return Math.abs(rings.reduce((a, r) => a + root.WorldGen.ringSignedArea(r), 0));
  }
  // Does a ring reach the edge of what the tile can see (clipped at its
  // buffer)? Then it is part of something bigger than the tile shows.
  function ringsClipped(rings, ext) {
    const B = 48;
    for (const r of rings) for (const p of r) {
      if (p.x <= -B || p.y <= -B || p.x >= ext + B || p.y >= ext + B) return true;
    }
    return false;
  }

  // ── The index (built in rasterizeTileSteps — a generator, one yield per
  // chunk of features / lines) ──────────────────────────────────────────
  // layersByName: { transportation, transportation_name, water, waterway,
  // landcover, park, poi } (any may be missing). N: the tile's own grid.
  // Returns the GEOMETRY context `geo` (the indices + radii) and nothing
  // else; classify() and linesSteps() read it.
  const INDEX_YIELD = 256;
  function* geoSteps(L, tx, ty, N) {
    const WG = root.WorldGen;
    const tr = L.transportation;
    const ext = (tr && tr.extent) || 4096;
    const gM = (N * WG.CELL_M) / ext;               // generation metres per unit
    const geo = {
      ext, gM, tx, ty, N,
      shoreR: Math.min(SHORE_MAX_UNITS, SCENIC_SHORE_CELLS * ext / N),
      waterlineR: WATERLINE_CELLS * ext / N,
      sideR: SIDEWALK_M / gM,
      busyR: BUSY_VERGE_M / gM,
      water: segIndex(ext), waterIn: polyIndex(ext),      // water edges + waterways; water polygons
      shore: segIndex(ext), shoreIn: polyIndex(ext),      // + beach sand + piers
      vehicle: segIndex(ext), busy: segIndex(ext),
      parks: polyIndex(ext),
    };
    let n = 0;
    const tick = () => (++n % INDEX_YIELD) === 0;
    if (L.water) {
      for (const f of L.water.features) {
        if (tick()) yield 'scenic water';
        if (f.type !== 3 || !f.geom || !isShoreWater(f.tags)) continue;
        geo.waterIn.add(f.geom); geo.shoreIn.add(f.geom);
        for (const r of f.geom) { geo.water.addRing(r); geo.shore.addRing(r); }
      }
    }
    if (L.waterway) {
      for (const f of L.waterway.features) {
        if (tick()) yield 'scenic waterways';
        if (f.type !== 2 || !f.geom || !isShoreWaterway(f.tags)) continue;
        for (const l of f.geom) { geo.water.addLine(l); geo.shore.addLine(l); }
      }
    }
    if (L.landcover) {
      for (const f of L.landcover.features) {
        if (tick()) yield 'scenic landcover';
        if (f.type !== 3 || !f.geom) continue;
        const t = f.tags || {};
        if (isBeachSand(t)) {
          geo.shoreIn.add(f.geom);
          for (const r of f.geom) geo.shore.addRing(r);
        } else if ((t.class === 'grass' && PARK_GRASS.has(t.subclass)) || t.class === 'wood') {
          // Unnamed land: a park path needs the polygon to be a park of some
          // size — its area as the tile sees it, or clipped at the tile's
          // buffer (it continues past what the tile can see).
          if (ringsAreaU2(f.geom) * gM * gM >= PARK_MIN_M2 || ringsClipped(f.geom, ext)) geo.parks.add(f.geom);
        }
      }
    }
    if (L.park) {
      for (const f of L.park.features) {
        if (tick()) yield 'scenic parks';
        if (f.type !== 3 || !f.geom) continue;
        const t = f.tags || {};
        if (t.name || ringsAreaU2(f.geom) * gM * gM >= PARK_MIN_M2) geo.parks.add(f.geom);
      }
    }
    if (tr) {
      for (const f of tr.features) {
        if (tick()) yield 'scenic roads';
        if (f.type !== 2 || !f.geom) continue;
        const t = f.tags || {};
        if (t.class === 'pier') {
          for (const l of f.geom) geo.shore.addLine(l);
          continue;
        }
        if (!isVehicleWay(t)) continue;
        const busy = isBusyWay(t);
        for (const l of f.geom) {
          geo.vehicle.addLine(l);
          if (busy) geo.busy.addLine(l);
        }
      }
    }
    // Names and walking routes, by the street index's own vertex vote
    // (StreetVariants.nameVote) — the same answer on both sides of a seam.
    const SV = root.StreetVariants;
    geo.nameVote = SV ? SV.nameVote(L.transportation_name) : new Map();
    geo.routeVote = new Map();
    if (L.transportation_name) {
      for (const f of L.transportation_name.features) {
        if (!f.geom || !isRouteTags(f.tags)) continue;
        for (const l of f.geom) for (const p of l) geo.routeVote.set(vkey(p.x, p.y), 1);
      }
    }
    yield 'scenic geometry';
    return geo;
  }
  const vkey = (x, y) => (x + 16384) * 65536 + (y + 16384);
  function isRouteTags(t) {
    if (!t) return false;
    for (const k in t) if (/^route_\d+_network$/.test(k) && t[k]) return true;
    return false;
  }
  function lineOnRoute(line, geo) {
    if (!geo.routeVote.size) return false;
    let hit = 0;
    for (const p of line) if (geo.routeVote.has(vkey(p.x, p.y))) hit++;
    return hit * 2 >= line.length;
  }
  function isGreenwayLine(line, geo) {
    const SV = root.StreetVariants;
    const name = SV ? SV.lineName(line, geo.nameVote) : null;
    return !!(name && GREENWAY_RE.test(name)) || lineOnRoute(line, geo);
  }

  // What ONE path point (tile-local units) is: 'shore' | 'greenway' | 'park'
  // | null. `greenway` is the line's own flag. THE SAFETY RULE FIRST.
  function classify(geo, x, y, greenway) {
    if (geo.busy.near(x, y, geo.busyR) || geo.vehicle.near(x, y, geo.sideR)) return null;
    if (geo.shoreIn.contains(x, y) || geo.shore.near(x, y, geo.shoreR)) return 'shore';
    if (greenway) return 'greenway';
    if (geo.parks.contains(x, y)) return 'park';
    return null;
  }
  // Is a point (units) within `r` of shore water (not sand, not a pier)?
  function nearWater(geo, x, y, r) {
    return geo.waterIn.contains(x, y) || geo.water.near(x, y, r);
  }

  // Walk one line's in-square arclength in SAMPLE_M steps; returns merged
  // [[a, b, kind], …] in UNITS (a, b along the line) and feeds `each(kind,
  // s, x, y, nx, ny, stepU)` for every scenic sample.
  function lineIntervals(geo, line, greenway, each) {
    const S = root.Streets;
    const spans = S.tileSpans(line, 1, geo.ext);
    if (!spans.length) return [];
    const step = SAMPLE_M / geo.gM;
    const out = [];
    let cur = null;
    let acc = 0, si = 0;
    for (let i = 1; i < line.length; i++) {
      const ax = line[i - 1].x, ay = line[i - 1].y;
      const dx = line[i].x - ax, dy = line[i].y - ay;
      const seg = Math.hypot(dx, dy);
      if (!(seg > 0)) continue;
      const ux = dx / seg, uy = dy / seg;
      // Sample midpoints of the SAMPLE_M steps whose midpoint is on this
      // segment: step k covers [k·step, (k+1)·step].
      for (;;) {
        const mid = (si + 0.5) * step;
        if (mid > acc + seg) break;
        const a = si * step, b = (si + 1) * step;
        si++;
        if (!S.covers(spans, mid)) { cur = null; continue; }
        const u = mid - acc;
        const x = ax + ux * u, y = ay + uy * u;
        const kind = root.Scenic.classify(geo, x, y, greenway);
        if (!kind) { cur = null; continue; }
        if (each) each(kind, mid, x, y, uy, -ux, step);
        if (cur && cur[2] === kind && Math.abs(cur[1] - a) < 1e-6) cur[1] = b;
        else { cur = [a, b, kind]; out.push(cur); }
      }
      acc += seg;
    }
    // Clip to the square exactly (the last step may overhang a span end).
    const clipped = [];
    for (const iv of out) {
      for (const sp of S.intersect([[iv[0], iv[1]]], spans)) clipped.push([sp[0], sp[1], iv[2]]);
    }
    return clipped;
  }

  // Every eligible line of the tile → its scenic intervals, keyed by
  // Streets.lineKey (the key the save restores under). Also the census (in
  // generation metres, in-square) and the STRETCHES for the vista chests.
  function* linesSteps(geo, trLayer) {
    const S = root.Streets, SV = root.StreetVariants;
    const res = { lines: new Map(), census: { shore: 0, greenway: 0, park: 0 }, stretches: [], grassSeats: [], attractionCells: {} };
    if (!trLayer || !S) return res;
    const stretch = new Map();     // `${sx},${sy}|${kind}` → { m, best }
    const ox = geo.tx * geo.ext, oy = geo.ty * geo.ext;
    const SQ = SV ? SV.BANDIT_STRETCH_UNITS : 512;
    let n = 0;
    for (let fi = 0; fi < trLayer.features.length; fi++) {
      const f = trLayer.features[fi];
      if (f.type !== 2 || !f.geom || !isEligibleWay(f.tags)) continue;
      for (let li = 0; li < f.geom.length; li++) {
        const line = f.geom[li];
        if (!line || line.length < 2) continue;
        if ((++n % 24) === 0) yield 'scenic lines';
        const lineKey = S.lineKey(f, li);
        const greenway = isGreenwayLine(line, geo);
        const per = new Map();     // this line's metres per stretch
        const ivs = lineIntervals(geo, line, greenway, (kind, s, x, y, nx, ny, stepU) => {
          const m = stepU * geo.gM;
          res.census[kind] += m;
          // Favourite-ground seats follow classified scenic intervals, not
          // street marks (footpaths are not vehicle street variants).
          const cells = res.attractionCells[kind] || (res.attractionCells[kind] = new Set());
          const vergeU = (root.WorldGen.roadOverlayWidthM(f.tags) / 2 + root.WorldGen.CELL_M) / geo.gM;
          for (const side of [-1, 1]) {
            const ix = Math.floor((x + nx * vergeU * side) * geo.N / geo.ext);
            const iy = Math.floor((y + ny * vergeU * side) * geo.N / geo.ext);
            if (ix >= 0 && iy >= 0 && ix < geo.N && iy < geo.N) cells.add(iy * geo.N + ix);
          }
          if (kind === 'greenway' && Math.floor(s * geo.gM / SAMPLE_M) % (GREENWAY_GRASS_STEP_M / SAMPLE_M) === 0) {
            const vergeU = (root.WorldGen.roadOverlayWidthM(f.tags) / 2 + root.WorldGen.CELL_M) / geo.gM;
            for (const side of [-1, 1]) res.grassSeats.push({ x: x + nx * vergeU * side, y: y + ny * vergeU * side });
          }
          const k = `${Math.floor((ox + x) / SQ)},${Math.floor((oy + y) / SQ)}|${kind}`;
          let r = per.get(k);
          if (!r) per.set(k, r = { m: 0, pts: [] });
          r.m += m;
          r.pts.push({ x, y, nx, ny });
        });
        if (!ivs.length) continue;
        res.lines.set(lineKey, ivs);
        // The stretch's chest stands at the middle of its LONGEST line there
        // (a pure function of the tile's bytes; ties to the earlier line).
        for (const [k, r] of per) {
          let st = stretch.get(k);
          if (!st) stretch.set(k, st = { key: k, m: 0, bestM: -1, at: null });
          st.m += r.m;
          if (r.m > st.bestM) { st.bestM = r.m; st.at = r.pts[Math.floor(r.pts.length / 2)]; }
        }
      }
    }
    for (const st of stretch.values()) {
      if (st.m >= VISTA_STRETCH_MIN_M) st.kind = st.key.split('|')[1], res.stretches.push(st);
    }
    res.stretches.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    yield 'scenic stretches';
    return res;
  }

  // ── SHORE SAND (grid cells) ────────────────────────────────────────────
  // A SAND cell within SCENIC_SHORE_CELLS of water is shore sand (1); within
  // WATERLINE_CELLS it is the waterline (2). Returns { mask, cells, waterline,
  // shoreM } or null when the tile has no shore sand. One yield per 16 rows.
  // SAND is the LAND's class (Zones.landAt over the Nexus paint's `under`
  // ledger): a Nexus's coverage repaints a beach's look but it is still the
  // beach (measured on Vancouver's Kits / English Bay: three quarters of the
  // dry sand wears a grove's ground).
  function* shoreSandSteps(geo, grid, under) {
    const WG = root.WorldGen, Z = root.Zones;
    const N = geo.N, u = geo.ext / N;
    if (!grid || !geo.water.count && !geo.waterIn.count) return null;
    const landAt = (i) => (under && Z && Z.landAt) ? Z.landAt(grid, under, i) : grid[i];
    let mask = null;
    const cells = [], waterline = [];
    for (let iy = 0; iy < N; iy++) {
      if ((iy & 15) === 15) yield 'scenic shore sand';
      for (let ix = 0; ix < N; ix++) {
        const i = iy * N + ix;
        if (landAt(i) !== WG.T.SAND || !WG.isWalkable(grid[i])) continue;
        const x = (ix + 0.5) * u, y = (iy + 0.5) * u;
        if (!nearWater(geo, x, y, geo.shoreR)) continue;
        if (!mask) mask = new Uint8Array(N * N);
        const wl = nearWater(geo, x, y, geo.waterlineR);
        mask[i] = wl ? 2 : 1;
        cells.push(i);
        if (wl) waterline.push(i);
      }
    }
    if (!mask) return null;
    return { mask, cells, waterline, shoreM: waterline.length * WG.CELL_M };
  }
  function beachXCount(shoreM) {
    return Math.max(0, Math.min(BEACH_X_MAX, Math.floor((shoreM || 0) / BEACH_X_SHORE_M)));
  }
  function tideCount(shoreM) {
    return Math.max(0, Math.min(TIDE_MAX, Math.floor((shoreM || 0) / TIDE_PER_M)));
  }

  // ── Viewpoints: collect + merge (pure over the poi layer + buffer) ──────
  function collectVistas(poiLayer, tx, ty, N) {
    const WG = root.WorldGen;
    const ext = (poiLayer && poiLayer.extent) || 4096;
    const out = [];
    if (!poiLayer || !poiLayer.features) return out;
    const seen = new Set();
    for (const f of poiLayer.features) {
      if (f.type !== 1 || !f.geom || !isViewpoint(f.tags)) continue;
      for (const ring of f.geom) {
        const p = ring && ring[0];
        if (!p) continue;
        const gx = tx * ext + p.x, gy = ty * ext + p.y;
        const k = `${gx},${gy}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ gx, gy, lx: p.x, ly: p.y, owned: p.x >= 0 && p.y >= 0 && p.x < ext && p.y < ext });
      }
    }
    // Merge: dropped when an EARLIER key (gy, then gx) sits within
    // VISTA_MERGE_M, in the ANCHOR row's own metres.
    out.sort((a, b) => (a.gy - b.gy) || (a.gx - b.gx));
    for (let i = 0; i < out.length; i++) {
      const a = out[i];
      const row = Math.floor(a.gy / ext);
      const upm = (row === ty && N > 0 ? N : WG.cellsPerEdgeForTile(row)) * WG.CELL_M / ext;
      for (let j = 0; j < i; j++) {
        const b = out[j];
        if (!b.merged && Math.hypot(b.gx - a.gx, b.gy - a.gy) * upm < VISTA_MERGE_M) { a.merged = true; break; }
      }
      a.id = `vista_${a.gx}_${a.gy}`;
    }
    return out.filter((a) => !a.merged);
  }

  // ── The whole build (rasterizeTileSteps, before surface terrain paint) ──
  // Returns entry.scenic: { lines, census, stretches, shore (shoreSandSteps'
  // or null), vistas } — pure MVT + the source land; a rebuild re-derives
  // it (it is generated).
  // `keepGeo` (tests, tools): also hand back the geometry indices as `_geo`
  // (classify() reads them) — the game drops them with the build. `under`:
  // the Nexus paint's land ledger (entry.zone.under), so a beach a Nexus
  // repainted is still shore sand.
  function* buildSteps(L, tx, ty, N, grid, keepGeo, under) {
    const geo = yield* geoSteps(L, tx, ty, N);
    const lines = yield* linesSteps(geo, L.transportation);
    const shore = yield* shoreSandSteps(geo, grid, under);
    const vistas = collectVistas(L.poi, tx, ty, N);
    const out = { ext: geo.ext, lines: lines.lines, census: lines.census, stretches: lines.stretches, grassSeats: lines.grassSeats, attractionCells: lines.attractionCells, shore, vistas };
    if (keepGeo) out._geo = geo;
    return out;
  }
  function build(L, tx, ty, N, grid, keepGeo, under) {
    return root.WorldGen.runSteps(buildSteps(L, tx, ty, N, grid, keepGeo, under));
  }

  // ── The dressing (the end of rasterizeTileSteps; laid by spawnInTile) ────
  // ctx: { scenic, tx, ty, N, tileEdgeM, grid, chests (the tile's deduped
  //        objects), spawnOpts (roadMask + spawnWhy + roadClass + occupied —
  //        occupied GROWS: each piece claims its cell) }
  // Returns { objects (scopes, vista chests, message bottles), wildplants (tide pool + greenway grass) }.
  function* dressSteps(ctx) {
    const WG = root.WorldGen, SV = root.StreetVariants;
    const res = { objects: [], wildplants: [], tideSeats: new Set() };
    const sc = ctx && ctx.scenic;
    if (!sc || !WG) return res;
    const { tx, ty, N, grid, spawnOpts } = ctx;
    const ext = sc.ext || 4096;
    // The dressing frame (WorldGen.dressFrame): the tile's cells in frame
    // metres, the occupancy this pass claims into, the chest each POI minted.
    const { cellM: frameCellM, ox, oy, chestAt, cx, cy, claim, inTile: inSq } = WG.dressFrame(ctx);
    // Scenic rewards are finds the player walks to: the spawn gate's
    // 'reward' class (the attractor row + the kerb buffer — never a reason to
    // step to the kerb of a road in the Major-and-Medium road group), off the road mask and whatever the
    // tile already put there.
    const rewardOk = (ix, iy) => inSq(ix, iy) && WG.isSpawnCell(grid, N, N, ix, iy, spawnOpts, 'reward');
    // Mapped viewpoints keep landmark priority. Procedural scenic rewards
    // yield the full Nexus coverage, including cells its layout leaves empty.
    const zoneCoverage = ctx.zone && (ctx.zone.coverage || ctx.zone.idx);
    const ambientRewardOk = (ix, iy) => !zoneCoverage?.[iy * N + ix] && rewardOk(ix, iy);
    const rc = spawnOpts.roadClass || null;
    const seatOffsets = WG.discOffsets(VISTA_SEAT_CELLS);

    // VIEWPOINTS: the owner's chest becomes the grail; the scope beside it.
    for (const v of sc.vistas || []) {
      if (!v.owned) continue;
      yield 'scenic vista';
      let chest = chestAt.get(`${v.lx},${v.ly}`) || null;
      let ix0 = Math.floor(v.lx * N / ext), iy0 = Math.floor(v.ly * N / ext);
      if (chest) {
        const cix = Math.floor((chest.x - ox) / frameCellM), ciy = Math.floor((chest.y - oy) / frameCellM);
        if (inSq(cix, ciy)) { ix0 = cix; iy0 = ciy; } else chest = null;
      }
      if (chest) {
        chest.vista = 'grail';
        chest.vistaId = v.id;
        delete chest._chestLook;
      } else {
        // The point's chest lost the POI dedup: the grail is minted here, on
        // the nearest open cell (the point is the place).
        const s = SV ? SV.nearestSeat(ix0, iy0, N, rc, seatOffsets, rewardOk) : null;
        if (s) {
          claim(s.ix, s.iy);
          res.objects.push(WG.makeObject('chest', cx(s.ix), cy(s.iy), WG.cellId('vista_grail', tx, ty, s.ix, s.iy),
            { poiClass: 'attraction', subclass: 'viewpoint', name: '', vista: 'grail', vistaId: v.id }));
          ix0 = s.ix; iy0 = s.iy;
        }
      }
      let seated = false;
      for (let r = 1; r <= SCOPE_SEAT_R && !seated; r++) {
        for (const [ux, uy] of WG.RING_ORDER) {
          const ix = ix0 + ux * r, iy = iy0 + uy * r;
          if (!rewardOk(ix, iy)) continue;
          if (rc && SV && SV.crossesMajorBand(rc, N, ix0, iy0, ix, iy)) continue;
          claim(ix, iy);
          res.objects.push(WG.makeObject('vista_scope', cx(ix), cy(iy), WG.cellId('scope', tx, ty, ix, iy),
            { vistaId: v.id }));
          seated = true;
          break;
        }
      }
    }

    // VISTA CHESTS: one per stretch, on the path's verge, its own side.
    for (const st of sc.stretches || []) {
      yield 'scenic vista chests';
      const p = st.at;
      if (!p) continue;
      const pix = Math.floor(p.x * N / ext), piy = Math.floor(p.y * N / ext);
      const s = SV ? SV.nearestSeat(pix, piy, N, rc, seatOffsets, ambientRewardOk) : null;
      if (!s) continue;
      claim(s.ix, s.iy);
      res.objects.push(WG.makeObject('chest', cx(s.ix), cy(s.iy), WG.cellId('vista', tx, ty, s.ix, s.iy),
        { poiClass: VISTA_POI_CLASS, subclass: st.kind, name: '', vista: st.kind }));
    }

    // SCENIC SHRINES (src/shrines.js): the path row's shrine kind beside the
    // stretch's vista chest, on a reward seat — at most
    // Shrines.SCENIC_SHRINES_PER_TILE, lowest hash of the stretch key first.
    const Sh = root.Shrines;
    const shrineStretches = Sh ? (sc.stretches || [])
      .filter((st) => st.at && Sh.kindForStreet(KIND_ROW[st.kind]))
      .sort((a, b) => hash01('shrine|' + a.key) - hash01('shrine|' + b.key)) : [];
    let shrinesSeated = 0;
    for (const st of shrineStretches) {
      if (shrinesSeated >= Sh.SCENIC_SHRINES_PER_TILE) break;
      yield 'scenic shrines';
      const pix = Math.floor(st.at.x * N / ext), piy = Math.floor(st.at.y * N / ext);
      const s = SV ? SV.nearestSeat(pix, piy, N, rc, seatOffsets, ambientRewardOk) : null;
      if (!s) continue;
      claim(s.ix, s.iy);
      shrinesSeated++;
      res.objects.push(WG.makeObject('grove_shrine', cx(s.ix), cy(s.iy), WG.cellId('scenic_shrine', tx, ty, s.ix, s.iy),
        { _shrineStreet: KIND_ROW[st.kind], shrineKind: Sh.kindForStreet(KIND_ROW[st.kind]) }));
    }

    // MESSAGE BOTTLES: before the tide pool, so a bottle's cell is claimed
    // and never doubles as a tide seat.
    const sh = sc.shore;
    // A Nexus owns even its empty cells. Ordinary beach rewards must not
    // reserve its waterline before the authored layout gets a chance to seat.
    if (sh && sh.waterline.length) {
      yield 'scenic bottles';
      const seats = [];
      let scanned = 0;
      for (const i of sh.waterline) {
        if ((scanned++ & 255) === 0) yield 'scenic bottle eligibility';
        const ix = i % N, iy = Math.floor(i / N);
        if (!ambientRewardOk(ix, iy)) continue;
        const id = WG.cellId('bottle', tx, ty, ix, iy);
        seats.push({ ix, iy, id, h: hash01('bottle|' + id) });
      }
      seats.sort((a, b) => a.h - b.h);
      for (const b of seats.slice(0, BEACH_BOTTLES_PER_TILE)) {
        claim(b.ix, b.iy);
        res.objects.push(WG.makeObject('bottle', cx(b.ix), cy(b.iy), b.id));
      }
    }

    // THE TIDE POOL: every waterline cell that takes a minor spawn holds a
    // tide pickup, shown on a day by tideLive (its own hash of id + day) at
    // the rate that lays tideCount(shoreM) a day over the pool.
    if (sh && sh.waterline.length) {
      yield 'scenic tide pool';
      const pool = [];
      let scanned = 0;
      for (const i of sh.waterline) {
        if ((scanned++ & 255) === 0) yield 'scenic tide eligibility';
        const ix = i % N, iy = Math.floor(i / N);
        if (ambientRewardOk(ix, iy)) pool.push(i);
      }
      const want = tideCount(sh.shoreM);
      const p = pool.length ? Math.min(1, want / pool.length) : 0;
      if (p > 0) {
        let seated = 0;
        for (const i of pool) {
          if ((seated++ & 255) === 0) yield 'scenic tide reservations';
          res.tideSeats.add(i);
          const ix = i % N, iy = Math.floor(i / N);
          claim(ix, iy);
          res.wildplants.push(WG.makeWildplant('shell', cx(ix), cy(iy), WG.cellId('tide', tx, ty, ix, iy),
            { tide: true, tideP: p }));
        }
      }
    }
    // Greenway verges: ordinary harvestable grass, after rewards have claimed
    // their seats. The geometry belongs to the tile's scenic classification;
    // the minor gate and cell ids are shared with all other roadside flora.
    let grassCount = 0;
    for (const p of sc.grassSeats || []) {
      if ((grassCount++ % 128) === 0) yield 'scenic greenway grass';
      const ix = Math.floor(p.x * N / ext), iy = Math.floor(p.y * N / ext);
      if (!inSq(ix, iy) || zoneCoverage?.[iy * N + ix] || !WG.isSpawnCell(grid, N, N, ix, iy, spawnOpts, 'minor')) continue;
      claim(ix, iy);
      res.wildplants.push(WG.makeWildplant('longgrass', cx(ix), cy(iy), WG.cellId('greenway_grass', tx, ty, ix, iy),
        { _street: 'greenway' }));
    }
    return res;
  }
  function dress(ctx) { return root.WorldGen.runSteps(dressSteps(ctx)); }

  // ── THE TIDE: which pickups lie on a waterline cell TODAY ────────────────
  // A pure function of the wildplant's id and the UTC day key — the same for
  // every player and every device. Memoised on the plant for the day, and
  // sets its `crop` to the day's find (shell / driftwood), so every
  // reader (the sprite, the tap, the light) sees one answer. Returns whether
  // it lies there today.
  function tideLive(wp, day) {
    if (!wp || !wp.tide) return true;
    const d = day || utcDayKey();
    if (wp._tideDay === d) return !!wp._tideOn;
    wp._tideDay = d;
    wp._tideOn = hash01(`tide|${wp.id}|${d}`) < (wp.tideP || 0);
    const k = hash01(`tidek|${wp.id}|${d}`);
    wp.crop = k < TIDE_DRIFTWOOD_P ? 'driftwood' : 'shell';
    return wp._tideOn;
  }

  // ── THE LADDER: what a restore of scenic metres banks on top ────────────
  // `ivs` a line's scenic intervals (units), `newly` the frame-metre
  // intervals Streets.restore just added, `mvtToM` the tile's frame metres
  // per unit. The EXTRA ladder metres (Σ |newly ∩ kind| × (mul − 1)) —
  // _bankStreetMetres adds them beside the true metres.
  function bonusMetres(ivs, newly, mvtToM) {
    const S = root.Streets;
    if (!ivs || !ivs.length || !newly || !newly.length || !(mvtToM > 0) || !S) return 0;
    let bonus = 0;
    for (const iv of ivs) {
      const mul = SCENIC_MUL[iv[2]];
      if (!(mul > 1)) continue;
      const hit = S.totalM(S.intersect(newly, [[iv[0] * mvtToM, iv[1] * mvtToM]]));
      bonus += hit * (mul - 1);
    }
    return bonus;
  }
  // The scenic kind at frame arclength `s` of a line, or null.
  function kindAt(ivs, s, mvtToM) {
    if (!ivs || !(mvtToM > 0)) return null;
    const u = s / mvtToM;
    for (const iv of ivs) if (u >= iv[0] - 1e-6 && u <= iv[1] + 1e-6) return iv[2];
    return null;
  }
  // The richest kind among the intervals `newly` touches (frame metres).
  function kindOfNewly(ivs, newly, mvtToM) {
    const S = root.Streets;
    if (!ivs || !newly || !S) return null;
    let best = null, bestMul = 1;
    for (const iv of ivs) {
      const mul = SCENIC_MUL[iv[2]] || 1;
      if (mul <= bestMul) continue;
      if (S.intersect(newly, [[iv[0] * mvtToM, iv[1] * mvtToM]]).length) { best = iv[2]; bestMul = mul; }
    }
    return best;
  }
  // The look row (StreetVariants.VARIANT_BY_ID) a kind wears.
  function rowFor(kind) {
    const SV = root.StreetVariants;
    return (kind && SV && SV.VARIANT_BY_ID[KIND_ROW[kind]]) || null;
  }

  const TELESCOPE_DURATION_MS = 24 * 60 * 60 * 1000;
  const TELESCOPE_OPTIONS = [
    { id: 'chest', label: 'Treasure' },
    { id: 'elite', label: 'Danger' },
    { id: 'shiny', label: 'Solace' },
  ];

  // Search only the known world on the player's level. The caller supplies
  // loaded records and its ordinary spent sets, including burned ground.
  // Keep the selected identity and position in the save so its bearing survives
  // leaving the viewpoint, tile eviction and a reload.
  function telescopeTarget(category, { player, depth = 0, objects = [], wildplants = [],
    creatures = [], save = {}, sets = spentSets(null, save), now = Date.now() } = {}) {
    if (!player || !Number.isFinite(player.x) || !Number.isFinite(player.y)) return null;
    if (!TELESCOPE_OPTIONS.some(o => o.id === category)) return null;
    const caught = new Set(save.caught || []);
    const discovered = save.discovered || {};
    let best = null, bestD2 = Infinity;
    function consider(o, type) {
      if (!o || !o.id || !Number.isFinite(o.x) || !Number.isFinite(o.y)
        || (o.depth ?? depth) !== depth) return;
      const d2 = (o.x - player.x) ** 2 + (o.y - player.y) ** 2;
      if (d2 > bestD2 || (d2 === bestD2 && best && String(o.id) >= String(best.targetId))) return;
      bestD2 = d2;
      best = { targetId: o.id, x: o.x, y: o.y, depth, until: now + TELESCOPE_DURATION_MS, category, type };
    }
    for (const o of objects) {
      if (isSpent(o, sets)) continue;
      if (category === 'chest' && o.kind === 'chest' && !sets.opened.has(o.id)
        && chestTier(o) >= 3 && chestLook(o).texKey === 'chest') consider(o, 'object');
      if (category === 'shiny' && isTreeLike(o.kind) && isShiny(o.id, SHINY_RATE.tree)) {
        const fruit = o.kind === 'fruittree';
        const key = fruit ? (ITEM_BY_ID[o.species]?.kind === 'produce' ? o.species : 'apple') : 'wood';
        if (!discovered[key] && (!fruit || Crops.fruitTreeState(o, save.fruitPicked?.[o.id], now).ready)) consider(o, 'object');
      }
    }
    if (category === 'shiny') {
      for (const p of wildplants) {
        if (!isSpent(p, sets) && !discovered[wildplantOutput(p.crop)] && isShiny(p.id, SHINY_RATE.flora)) consider(p, 'wildplant');
      }
    }
    if (category === 'shiny' || category === 'elite') {
      for (const c of creatures) {
        if (caught.has(c.id) || c._surfaceInactive || c._hp <= 0) continue;
        if (category === 'elite' ? Combat.isElite(c) && Combat.isEnemy(c, now)
          : c.shiny && !discovered[c.kind] && !Combat.isEnemyKind(c.kind)
            && (ITEM_BY_ID[`shiny_${c.kind}`] || SpriteLayout.creatureDrop(c.kind))
            && !Combat.isTame(c)) consider(c, 'creature');
      }
    }
    return best;
  }

  // ── The first vista's relic ─────────────────────────────────────────────
  // The walker's relic, one tier over what the save wears (capped): a pure
  // function of the save, paid once (save.vistaRelic). Shape: pickReward's.
  // The caller runs it through reconcileRelicOffer (rarity.js), the one rule
  // for a relic the save already beats — a maxed slot is cashed out.
  const RELIC_TOP_TIER = 7;
  function firstVistaPrize(save) {
    if (save && save.vistaRelic) return null;
    const cur = (save && save.relics && save.relics[FIRST_VISTA_SLOT] && save.relics[FIRST_VISTA_SLOT].tier) || 0;
    return { kind: 'relic', slot: FIRST_VISTA_SLOT, tier: Math.min(RELIC_TOP_TIER, Math.max(1, cur + 1)), jackpot: 0 };
  }

  root.Scenic = {
    SCENIC_MUL, KIND_ORDER, KIND_ROW, SCENIC_SHORE_CELLS, SHORE_MAX_UNITS, SIDEWALK_M, BUSY_VERGE_M,
    PARK_MIN_M2, SAMPLE_M, GREENWAY_GRASS_STEP_M, GREENWAY_RE, PATH_SUBCLASSES,
    VISTA_STRETCH_MIN_M, VISTA_SEAT_CELLS, VISTA_CHEST_TIER, VISTA_POI_CLASS, VISTA_MERGE_M, SCOPE_SEAT_R,
    VISTA_CONTEXT, FIRST_VISTA_SLOT, VISTA_STORY, TELESCOPE_DURATION_MS, TELESCOPE_OPTIONS, telescopeTarget,
    BEACH_X_SHORE_M, BEACH_X_MAX, TIDE_PER_M, TIDE_MAX, WATERLINE_CELLS, TIDE_DRIFTWOOD_P,
    BEACH_BOTTLES_PER_TILE,
    isEligibleWay, isVehicleWay, isBusyWay, isShoreWater, isShoreWaterway, isBeachSand, isViewpoint,
    geoSteps, classify, nearWater, lineIntervals, linesSteps, shoreSandSteps, collectVistas,
    buildSteps, build, dressSteps, dress, beachXCount, tideCount, tideLive,
    bonusMetres, kindAt, kindOfNewly, rowFor, firstVistaPrize, ringsAreaU2,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
