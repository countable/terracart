// ─────────────────────────────────────────────────────────────────────────
// StreetVariants — what a STREET is, and what it wears.
//
// A street is a NAME inside a PARISH (streetKey). Every tile can compute it
// from its own layers (the name comes off `transportation_name` by vertex
// vote, nameVote/lineName) and it is the same on both sides of a seam, so a
// pure hash of the key gives the street ONE variant end to end, and every tile
// holding a piece of it dresses its own piece the same way. An UNNAMED way
// has no such identity: it keys off its own line geometry inside the tile
// (anonKey), so an unnamed way crossing a seam may roll differently on each
// side. Accepted: unnamed ways are mostly short (alleys, stubs) and the
// disagreement is a change of dressing at a tile edge, never a change of
// what anything IS for a given player.
//
// TWO SIZES, off WorldGen.classifyLine's tiers:
//   MAJOR — ROAD_MD + ROAD_LG (tertiary / secondary and up): the BANDIT ROADS.
//           Their verges carry the surface traps (traps.js), their bus stops
//           are broken wagons with a goblin guard (loot.js chestLook + the
//           lairs.js 'wagon' tier), and the tile's dogs roam them.
//   MINOR — ROAD with class minor/street (residential streets). Service ways
//           (driveways, alleys, parking) are neither — they stay plain.
//   Footpaths are neither.
//
// THE VARIANTS are rows of STREET_VARIANTS, each on ONE size. The roll
// (variantFor) walks the size's rows in order off one hash of the key; a
// name word (row.words) multiplies a row's share by NAME_NUDGE, so "Cherry
// Lane" is likelier an orchard — the street sign foreshadows the street.
// Separately, ROCK_STREET_SHARE of minor streets are lined with rock clusters
// (rocksFor — worldgen's street rock pass reads it), never a hedgerow.
//
// NOTHING IS STORED. A variant is a pure function of the key; what the
// player does to its pieces lands in the save's existing delta lists
// (picked, foundTreasures, caught). Every piece's id is `cellId(prefix, tx,
// ty, ix, iy)` and every stream is its own (`dress|variant|key|tile|line`),
// so dressing never moves another spawner's stream.
//
// What this is NOT: the restoration arithmetic (streets.js), the road mask
// (worldgen.js roadMask / roadClass — the MAJOR band and verge are stamped
// there, in the same pass as the mask, and read here), nor the drawing.
//
// Pure: no Phaser, no DOM. Reads WorldGen / Streets / fnv1a at CALL time, so
// it loads before worldgen.js. Audit: test/node/street_variants.test.js.
// ─────────────────────────────────────────────────────────────────────────
(function (root) {
  'use strict';

  // ── The key ──────────────────────────────────────────────────────────────
  // A parish is PARISH_TILES z14 tiles on an edge (~25 km: a town). A street
  // changes variant only where it crosses a parish line.
  const PARISH_TILES = 16;
  // A name word multiplies its row's share by this, capped per row.
  const NAME_NUDGE = 4;
  const NUDGED_SHARE_MAX = 0.9;
  // Share of MINOR street keys lined with rock clusters (hedgerows excepted).
  const ROCK_STREET_SHARE = 0.25;

  // ── The verge ────────────────────────────────────────────────────────────
  // Every verge piece searches OUTWARD from the band's edge, k = 1..this
  // cells, and takes the first cell that passes the shared spawn rule.
  const VERGE_MAX_CELLS = 3;
  // A bus stop is on a MAJOR road when a major band touches a cell within
  // this many cells (Chebyshev) of its own.
  const BUS_STOP_MAJOR_CELLS = 2;

  // ── Closes (the hedgerow's dead-end runs) ────────────────────────────────
  const RUN_MIN_M = 40, RUN_MAX_M = 400;
  // A line END with no other vehicle way within this is a dead end; walking
  // back, the first vertex another vehicle way comes within this of is the
  // junction (the close's mouth).
  const JUNCTION_TOUCH_M = 3;
  const CLOSE_SEAT_CELLS = 4;           // relocate reach for the arch / hoard

  // ── Dressing density (generation metres along the way) ───────────────────
  const HEDGE_GAP_MIN = 5, HEDGE_GAP_SPAN = 3;   // a gate-gap every 5..7 cells
  const OVERGROWN_STEP_M = 10, OVERGROWN_MAX = 10;
  const ORCHARD_STEP_M = 40, ORCHARD_MAX = 3;
  const BURNED_STEP_M = 25, BURNED_MAX = 8;
  // Lantern Row: NOT a prop of its own — the street lamps, denser. A lantern
  // street stands its restoration lamps at Streets.lampSpacingM() / this
  // (app.js _streetLampsForTile), same art, same lit-when-restored rule, one
  // lane.
  const LANTERN_SPACING_DIV = 2;

  // What a burned row's verge holds — the two props that SLOW the body
  // (app.js _bodyHold). One table both sides read: dressing lays these kinds,
  // and the slow gate asks isSlowKind.
  const SLOW_KINDS = new Set(['tar', 'stakes']);

  // ── The rows ─────────────────────────────────────────────────────────────
  // `share` is the base probability for a key of that size; the minor rows
  // sum to 0.34 and the major ones to 0.16. The design's shares, rescaled
  // now that each row dresses ONE size (the minor rows took the dressed
  // share the design's minor+medium rows gave minor streets, the major rows
  // likewise), keeping its rarity ladder: Common lantern/overgrown,
  // Uncommon orchard/pilgrim/burned, Rare barricade, Find hedgerow.
  // `story` is the _storySplashOnce key AND the painting stem (sceneArtUrl);
  // `flash` is the ≤30-char map line a later visit gets.
  const STREET_VARIANTS = [
    { id: 'hedgerow', size: 'minor', share: 0.10, nudge: 2, rung: 'find',
      words: /\b(lane|ln|close|court|ct|place|pl|mews|circle|cir|crescent|cres|cove|row|gasse|hecke|weg)\b/i,
      story: 'street_hedgerow', title: 'The hedged lane',
      body: 'Clipped hedges, a stone arch, a gate at the end. Someone keeps this close, and something keeps it for them.',
      flash: 'A hedged lane. Tread softly.' },
    { id: 'overgrown', size: 'minor', share: 0.10, rung: 'common',
      words: /(park|wood|forest|grove|glen|heath|moor|green|meadow|wald|heide|hain|wiese|garten|garden|fern|brook)/i,
      story: 'street_overgrown', title: 'Gone to seed',
      body: 'The green is taking this street back, one crack at a time.',
      flash: 'The green is taking it back.' },
    { id: 'orchard', size: 'minor', share: 0.08, rung: 'uncommon',
      words: /(orchard|apple|cherry|plum|pear|peach|fruit|obst|kirsch|apfel|birn|pflaum|vine|berry)/i,
      story: 'street_orchard', title: 'Orchard Lane',
      body: 'The old trees still fruit. Nobody picks them.',
      flash: 'Old trees, still fruiting.' },
    { id: 'pilgrim', size: 'minor', share: 0.06, rung: 'uncommon',
      words: /(church|chapel|abbey|kirch|kloster|pilgrim|cross|saint|\bst\b|priest|minster|\bdom\b|mission)/i,
      story: 'street_pilgrim', title: "Pilgrim's Way",
      body: 'A waystone, worn smooth by hands. It remembers something.',
      flash: 'A waystone, worn smooth.' },
    { id: 'lantern', size: 'major', share: 0.07, rung: 'common',
      words: /(lantern|lamp|light|candle|latern)/i,
      story: 'street_lantern', title: 'Lantern Row',
      body: 'Lamp posts stand thick along this road, cold and waiting. Rebuild it and it will burn bright.',
      flash: 'Lamp posts, cold and waiting.' },
    { id: 'burned', size: 'major', share: 0.05, rung: 'uncommon',
      words: /(mill|forge|smith|ash|burn|brand|kiln|furnace|cinder|coal|ember|kohle|schmied|asche)/i,
      story: 'street_burned', title: 'Burned Row',
      body: 'Tar in the gutters and iron stakes in the verge. Watch your feet.',
      flash: 'Tar underfoot. Go slow.' },
    { id: 'barricade', size: 'major', share: 0.04, rung: 'rare',
      words: /(gate|wall|fort|\btor\b|mauer|castle|burg|bastion|guard|wache|barrack|kaserne|armou?ry)/i,
      story: 'street_barricade', title: 'The barricade',
      body: 'Barricades across the verge. Goblins held this road once.',
      flash: 'Barricades. Goblins held it.' },
  ];
  const VARIANT_BY_ID = {};
  STREET_VARIANTS.forEach((r, i) => { VARIANT_BY_ID[r.id] = r; r.code = i + 1; });
  // The bandit road: every MAJOR road, variant or not. Not a row of the table
  // (it dresses nothing of its own — its traps, wagons and dogs are other
  // modules' reasons); its story is here beside the others.
  const BANDIT_STORY = {
    story: 'street_bandit', title: 'The bandit road',
    body: 'Wheel ruts, a broken wagon, a dog that watches you pass. Bandits work the big roads.',
    flash: 'Bandit road. Eyes open.',
  };
  // Per-cell marks (dress().marks): a variant's code 1..n, BANDIT_CODE for a
  // plain major cell (resolved from roadClass by the caller).
  function variantByCode(code) { return STREET_VARIANTS[code - 1] || null; }

  // ── Names and keys ──────────────────────────────────────────────────────
  function normName(name) {
    return String(name || '').toLowerCase().replace(/ß/g, 'ss')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, ' ').trim();
  }
  function parishOf(tx, ty) { return `${Math.floor(tx / PARISH_TILES)},${Math.floor(ty / PARISH_TILES)}`; }
  function streetKey(name, tx, ty) { return `${normName(name)}|${parishOf(tx, ty)}`; }
  // An unnamed way: its own geometry in the tile (tile-local MVT ends).
  function anonKey(tx, ty, line) {
    const a = line[0], z = line[line.length - 1];
    return `~${tx},${ty}|${a.x},${a.y}|${z.x},${z.y}|${line.length}`;
  }
  const u01 = (s) => (fnv1a(s) >>> 0) / 4294967296;

  // Which size a way is, off its terrain tier. Rail/transit/ferry are not
  // streets (classifyLine's fallback would call them ROAD).
  const NON_STREET = new Set(['rail', 'transit', 'ferry', 'aerialway', 'service', 'track']);
  function sizeOfTags(tags) {
    const WG = root.WorldGen;
    const t = tags || {};
    const c = t.class || '';
    if (NON_STREET.has(c)) return null;
    const tier = WG.classifyLine('transportation', t);
    if (tier === WG.T.ROAD_MD || tier === WG.T.ROAD_LG) return 'major';
    if (tier === WG.T.ROAD && (c === 'minor' || c === 'street')) return 'minor';
    return null;
  }
  // Is this a way a vehicle drives (junction / dead-end tests)?
  function isVehicleTags(tags) {
    const WG = root.WorldGen;
    const c = (tags && tags.class) || '';
    if (c === 'rail' || c === 'transit' || c === 'ferry' || c === 'aerialway') return false;
    const tier = WG.classifyLine('transportation', tags || {});
    return tier === WG.T.ROAD || tier === WG.T.ROAD_MD || tier === WG.T.ROAD_LG;
  }

  // The roll. One draw off the key; rows of the other size never match.
  function variantFor(key, name, size) {
    if (!key || !size) return null;
    const u = u01('street|' + key);
    let acc = 0;
    for (const row of STREET_VARIANTS) {
      if (row.size !== size) continue;
      let sh = row.share;
      if (name && row.words && row.words.test(name)) {
        sh = Math.min(NUDGED_SHARE_MAX, sh * (row.nudge || NAME_NUDGE));
      }
      acc += sh;
      if (u < acc) return row.id;
    }
    return null;
  }
  // Is this street one of the rock-lined ones? Minor only, never a hedgerow.
  function rocksFor(key, size, variant) {
    return size === 'minor' && variant !== 'hedgerow' && !!key
      && u01('rocks|' + key) < ROCK_STREET_SHARE;
  }

  // ── The name vote ───────────────────────────────────────────────────────
  const vkey = (x, y) => (x + 16384) * 65536 + (y + 16384);
  function nameVote(tnLayer) {
    const m = new Map();
    if (!tnLayer) return m;
    for (const f of tnLayer.features) {
      const name = f.tags && f.tags.name;
      if (!name || !f.geom) continue;
      for (const line of f.geom) for (const p of line) m.set(vkey(p.x, p.y), name);
    }
    return m;
  }
  // The name most of the line's vertices hit, or null.
  function lineName(line, vote) {
    if (!vote || !vote.size) return null;
    let best = null, bestN = 0;
    const counts = new Map();
    for (const p of line) {
      const n = vote.get(vkey(p.x, p.y));
      if (!n) continue;
      const c = (counts.get(n) || 0) + 1;
      counts.set(n, c);
      if (c > bestN) { bestN = c; best = n; }
    }
    return best;
  }

  // ── Walking a line ──────────────────────────────────────────────────────
  // Calls cb(s, x, y, nx, ny) every `step` metres of arclength from `s0`,
  // with the point and the LEFT normal of its segment (streets.js's
  // convention: left of (dx, dy) is (dy, -dx)). One pass over the vertices —
  // never Streets.pointAtM per sample, which walks from the start each time.
  function sampleLine(line, mToM, step, s0, cb) {
    if (!line || line.length < 2 || !(step > 0)) return;
    let acc = 0, next = s0 > 0 ? s0 : 0;
    for (let i = 1; i < line.length; i++) {
      const ax = line[i - 1].x * mToM, ay = line[i - 1].y * mToM;
      const dx = line[i].x * mToM - ax, dy = line[i].y * mToM - ay;
      const seg = Math.hypot(dx, dy);
      if (!(seg > 0)) continue;
      const ux = dx / seg, uy = dy / seg;
      while (next <= acc + seg) {
        const u = next - acc;
        if (cb(next, ax + ux * u, ay + uy * u, uy, -ux) === false) return;
        next += step;
      }
      acc += seg;
    }
  }

  // ── The index (built in rasterizeTileSteps, pure MVT) ────────────────────
  // lines: every MAJOR line and every MINOR line of the transportation layer
  //   { fi, li, line, tags, size, name, key, variant, rocks, halfW, lineKey }
  //   (halfW in metres, WorldGen.roadOverlayWidthM / 2: the drawn band's).
  // closes: the dead-end runs of hedgerow lines this tile OWNS (the dead end
  //   is inside the square)
  //   { rk, lineRef, atStart, runM, head: {x,y}, mouth: {x,y} } (MVT units)
  // A generator for the tile-build rule: one yield per INDEX_YIELD_LINES.
  const INDEX_YIELD_LINES = 256;
  function* buildIndexSteps(layers, tx, ty, mvtToM) {
    const WG = root.WorldGen, S = root.Streets;
    const out = { lines: [], closes: [], extent: 4096 };
    if (!layers || !WG) return out;
    let tr = null, tn = null;
    for (const l of layers) {
      if (l.name === 'transportation') tr = l;
      else if (l.name === 'transportation_name') tn = l;
    }
    if (!tr) return out;
    const ext = tr.extent || 4096;
    out.extent = ext;
    const vote = nameVote(tn);
    yield 'street names';
    let n = 0;
    const veh = [];
    for (let fi = 0; fi < tr.features.length; fi++) {
      const f = tr.features[fi];
      if (f.type !== 2 || !f.geom) continue;
      const vehicle = isVehicleTags(f.tags);
      const size = sizeOfTags(f.tags);
      for (let li = 0; li < f.geom.length; li++) {
        const line = f.geom[li];
        if (!line || line.length < 2) continue;
        if ((++n % INDEX_YIELD_LINES) === 0) yield 'street index lines';
        const rec = { fi, li, line, tags: f.tags, size, vehicle };
        if (vehicle) veh.push(rec);
        if (!size) continue;
        const name = lineName(line, vote);
        const key = name ? streetKey(name, tx, ty) : anonKey(tx, ty, line);
        const variant = variantFor(key, name, size);
        rec.name = name;
        rec.key = key;
        rec.variant = variant;
        rec.rocks = rocksFor(key, size, variant);
        rec.halfW = WG.roadOverlayWidthM(f.tags || {}) / 2;
        rec.lineKey = S ? S.lineKey(f, li) : `${fi}:${li}`;
        out.lines.push(rec);
      }
    }
    yield 'street index';
    const hedges = out.lines.filter((r) => r.variant === 'hedgerow');
    if (hedges.length) {
      out.closes = findCloses(hedges, veh, tx, ty, ext, mvtToM);
      yield 'street closes';
    }
    return out;
  }
  function buildIndex(layers, tx, ty, mvtToM) {
    const it = buildIndexSteps(layers, tx, ty, mvtToM);
    let r = it.next();
    while (!r.done) r = it.next();
    return r.value;
  }

  // The dead-end runs of `lines` (hedgerow pieces), against every vehicle
  // way `veh`. Segments are bucketed at BUCKET MVT units, so each touch test
  // probes a 3×3 of buckets — linear in the tile's road length.
  const BUCKET = 64;
  function segDist2(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const l = dx * dx + dy * dy;
    let t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0;
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    const x = ax + t * dx - px, y = ay + t * dy - py;
    return x * x + y * y;
  }
  function findCloses(lines, veh, tx, ty, ext, mvtToM) {
    const buckets = new Map();
    const bk = (bx, by) => (bx + 1024) * 4096 + (by + 1024);
    for (const rec of veh) {
      const L = rec.line;
      for (let i = 1; i < L.length; i++) {
        const a = L[i - 1], b = L[i];
        const x0 = Math.floor(Math.min(a.x, b.x) / BUCKET), x1 = Math.floor(Math.max(a.x, b.x) / BUCKET);
        const y0 = Math.floor(Math.min(a.y, b.y) / BUCKET), y1 = Math.floor(Math.max(a.y, b.y) / BUCKET);
        for (let bx = x0; bx <= x1; bx++) {
          for (let by = y0; by <= y1; by++) {
            const k = bk(bx, by);
            let arr = buckets.get(k);
            if (!arr) buckets.set(k, arr = []);
            arr.push(rec, i);
          }
        }
      }
    }
    const R = JUNCTION_TOUCH_M / mvtToM, R2 = R * R;
    const touched = (p, self) => {
      const bx = Math.floor(p.x / BUCKET), by = Math.floor(p.y / BUCKET);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const arr = buckets.get(bk(bx + dx, by + dy));
          if (!arr) continue;
          for (let j = 0; j < arr.length; j += 2) {
            const rec = arr[j];
            if (rec.line === self) continue;
            const i = arr[j + 1], a = rec.line[i - 1], b = rec.line[i];
            if (segDist2(p.x, p.y, a.x, a.y, b.x, b.y) <= R2) return true;
          }
        }
      }
      return false;
    };
    const out = [];
    for (const rec of lines) {
      const L = rec.line;
      for (const atStart of [true, false]) {
        const p = atStart ? L[0] : L[L.length - 1];
        if (p.x < 0 || p.y < 0 || p.x >= ext || p.y >= ext) continue;   // owned by the neighbour
        if (touched(p, L)) continue;                                     // not a dead end
        const dir = atStart ? 1 : -1;
        let s = 0, mouth = null;
        for (let k = atStart ? 1 : L.length - 2; k >= 0 && k < L.length; k += dir) {
          s += Math.hypot(L[k].x - L[k - dir].x, L[k].y - L[k - dir].y) * mvtToM;
          if (touched(L[k], L)) { mouth = L[k]; break; }
        }
        if (!mouth) mouth = atStart ? L[L.length - 1] : L[0];
        if (s < RUN_MIN_M || s > RUN_MAX_M) continue;
        out.push({
          rk: `close:${tx * ext + p.x},${ty * ext + p.y}`,
          lineRef: rec, atStart, runM: s,
          head: { x: p.x, y: p.y }, mouth: { x: mouth.x, y: mouth.y },
        });
      }
    }
    return out;
  }

  // ── Bandit stops ────────────────────────────────────────────────────────
  // Stamp `banditStop` on every bus-stop chest within BUS_STOP_MAJOR_CELLS of
  // a MAJOR band (roadClass bit 1), and return one lair candidate per stop —
  // the wagon's guard (lairs.js 'wagon' tier). The chest itself is untouched
  // otherwise: same id, tier, contents and `opened` semantics; loot.js
  // chestLook reads the flag to wear the wagon. Its memoised look is dropped
  // so a stop drawn before this pass re-resolves.
  function markBanditStops(objects, roadClass, N, tx, ty, tileEdgeM) {
    const WG = root.WorldGen;
    const lairs = [];
    if (!objects || !roadClass || !(N > 0)) return lairs;
    const cellM = tileEdgeM / N;
    const R = BUS_STOP_MAJOR_CELLS;
    for (const o of objects) {
      if (!o || o.kind !== 'chest' || o.poiClass !== 'bus' || o.depth > 0) continue;
      const ix = Math.floor((o.x - tx * tileEdgeM) / cellM);
      const iy = Math.floor((o.y - ty * tileEdgeM) / cellM);
      if (ix < 0 || iy < 0 || ix >= N || iy >= N) continue;
      let near = false;
      for (let dy = -R; dy <= R && !near; dy++) {
        for (let dx = -R; dx <= R; dx++) {
          const x = ix + dx, y = iy + dy;
          if (x < 0 || y < 0 || x >= N || y >= N) continue;
          if (roadClass[y * N + x] & WG.ROAD_CLASS_MAJOR_BAND) { near = true; break; }
        }
      }
      if (!near) continue;
      o.banditStop = true;
      delete o._chestLook;
      lairs.push({
        tier: 'wagon', sid: WG.cellId('wagon', tx, ty, ix, iy),
        lx: (ix + 0.5) * cellM, ly: (iy + 0.5) * cellM,
      });
    }
    return lairs;
  }

  // ── Dressing (the end of rasterizeTileSteps; laid by spawnInTile) ─────────
  // ctx: { index, tx, ty, N, tileEdgeM, grid (the GENERATED grid), spawnOpts
  //        (roadMask + occupied + pois — occupied GROWS: each placed piece
  //        claims its cell, so later spawners and later pieces see it) }
  // Returns { objects, wildplants, treasures, lairs, slowCells (Map cell
  // index → 'tar' | 'stakes'), marks } —
  // marks is a Uint8Array (N*N) of variant codes on each dressed line's band
  // and verge (the story trigger reads it), or null when nothing is dressed.
  function dress(ctx) {
    const it = dressSteps(ctx);
    let r = it.next();
    while (!r.done) r = it.next();
    return r.value;
  }
  // The same, as a generator — rasterizeTileSteps drives it (one yield per
  // dressed line), so the dressing is paid inside the sliced tile build and
  // never in the unsliced spawn pass (CLAUDE.md, the worst-block rule).
  function* dressSteps(ctx) {
    const WG = root.WorldGen, S = root.Streets;
    const res = { objects: [], wildplants: [], treasures: [], lairs: [], slowCells: new Map(), marks: null };
    const idx = ctx && ctx.index;
    if (!idx || !WG || !S) return res;
    const { tx, ty, N, tileEdgeM, grid, spawnOpts } = ctx;
    const ext = idx.extent || 4096;
    const CELL_M = WG.CELL_M;
    const gM = (N * CELL_M) / ext;            // GENERATION metres per MVT unit
    const frameCellM = tileEdgeM / N;
    const ox = tx * tileEdgeM, oy = ty * tileEdgeM;
    const occ = spawnOpts.occupied || (spawnOpts.occupied = new Set());
    const cellOk = (ix, iy) => ix >= 0 && iy >= 0 && ix < N && iy < N
      && WG.isSpawnCell(grid, N, N, ix, iy, spawnOpts);
    const claim = (ix, iy) => { occ.add(iy * N + ix); };
    const cx = (ix) => ox + (ix + 0.5) * frameCellM;
    const cy = (iy) => oy + (iy + 0.5) * frameCellM;
    const cellOfM = (m) => Math.floor(m / CELL_M);
    // The first spawnable verge cell k = 1..VERGE_MAX_CELLS out from the
    // band's edge at arclength point (x, y) with left normal (nx, ny).
    const verge = (rec, x, y, nx, ny, side) => {
      for (let k = 1; k <= VERGE_MAX_CELLS; k++) {
        const off = side * (rec.halfW + (k - 0.5) * CELL_M);
        const ix = cellOfM(x + nx * off), iy = cellOfM(y + ny * off);
        if (cellOk(ix, iy)) return { ix, iy };
      }
      return null;
    };
    const seat = (px, py) => {
      const ix = cellOfM(px * gM), iy = cellOfM(py * gM);
      if (ix < -CLOSE_SEAT_CELLS || iy < -CLOSE_SEAT_CELLS
          || ix >= N + CLOSE_SEAT_CELLS || iy >= N + CLOSE_SEAT_CELLS) return null;
      return WG.relocateToSpawnCell(grid, N, N, ix, iy, spawnOpts, CLOSE_SEAT_CELLS);
    };
    const marks = new Uint8Array(N * N);
    let marked = false;
    const mark = (rec, code) => {
      const r = rec.halfW + CELL_M;
      const spans = S.tileSpans(rec.line, gM, ext);
      // A cell's width along the way and ~¾ of one across it: dense enough
      // that no cell of the band + verge is skipped (a diagonal cell is
      // √2·CELL_M wide), cheap enough for the unsliced spawn pass.
      sampleLine(rec.line, gM, CELL_M * 0.7, 0, (s, x, y, nx, ny) => {
        if (!S.covers(spans, s)) return;
        for (let o = -r; o <= r; o += CELL_M * 0.7) {
          const ix = cellOfM(x + nx * o), iy = cellOfM(y + ny * o);
          if (ix < 0 || iy < 0 || ix >= N || iy >= N) continue;
          marks[iy * N + ix] = code;
        }
      });
      marked = true;
    };
    const streamFor = (rec, what) =>
      WG.makeRng(fnv1a(`dress|${what}|${rec.key}|${tx},${ty}|${rec.lineKey}`));
    // Every piece end inside the tile square (where a waystone / barricade
    // stands).
    const ownedEnds = (rec) => {
      const L = rec.line, out = [];
      for (const p of [L[0], L[L.length - 1]]) {
        if (p.x >= 0 && p.y >= 0 && p.x < ext && p.y < ext) out.push(p);
      }
      return out;
    };

    for (const rec of idx.lines) {
      const v = rec.variant;
      if (!v) continue;
      yield 'street dressing';
      const row = VARIANT_BY_ID[v];
      mark(rec, row.code);
      const spans = S.tileSpans(rec.line, gM, ext);
      if (!spans.length) continue;
      if (v === 'hedgerow') {
        const rng = streamFor(rec, v);
        // Hedges both sides, one per cell, with a garden-gate gap every
        // HEDGE_GAP_MIN..+SPAN cells. A hedge is a wild plant on the SHRUB's
        // rule (items.js WILDPLANT_RULES.hedge): chopped with the axe for
        // wood, and `picked` once cut — never scenery (CLAUDE.md: nothing
        // that stands may look tappable and not be).
        for (const side of [1, -1]) {
          let gapIn = HEDGE_GAP_MIN + Math.floor(rng() * HEDGE_GAP_SPAN);
          sampleLine(rec.line, gM, CELL_M, CELL_M / 2, (s, x, y, nx, ny) => {
            if (!S.covers(spans, s)) return;
            if (--gapIn <= 0) {                       // a garden gate
              gapIn = HEDGE_GAP_MIN + Math.floor(rng() * HEDGE_GAP_SPAN);
              return;
            }
            const c = verge(rec, x, y, nx, ny, side);
            if (!c) return;
            claim(c.ix, c.iy);
            res.wildplants.push(WG.makeWildplant('hedge', cx(c.ix), cy(c.iy),
              WG.cellId('hedge', tx, ty, c.ix, c.iy), { _street: v }));
          });
        }
      } else if (v === 'overgrown') {
        const rng = streamFor(rec, v);
        let placed = 0;
        sampleLine(rec.line, gM, OVERGROWN_STEP_M, OVERGROWN_STEP_M / 2, (s, x, y, nx, ny) => {
          if (placed >= OVERGROWN_MAX) return false;
          const side = rng() < 0.5 ? 1 : -1;
          const pick = rng();
          if (!S.covers(spans, s)) return;
          const c = verge(rec, x, y, nx, ny, side);
          if (!c) return;
          const crop = pick < 0.6 ? 'longgrass' : pick < 0.8 ? 'shrub' : pick < 0.95 ? 'mushroom' : 'forgetmenot';
          claim(c.ix, c.iy);
          res.wildplants.push(WG.makeWildplant(crop, cx(c.ix), cy(c.iy),
            WG.cellId('wp_og', tx, ty, c.ix, c.iy), { _street: v }));
          placed++;
        });
      } else if (v === 'orchard') {
        const rng = streamFor(rec, v);
        let placed = 0, side = 1;
        sampleLine(rec.line, gM, ORCHARD_STEP_M, ORCHARD_STEP_M / 2, (s, x, y, nx, ny) => {
          if (placed >= ORCHARD_MAX) return false;
          const peach = rng() < 1 / 8;
          side = -side;
          if (!S.covers(spans, s)) return;
          const c = verge(rec, x, y, nx, ny, side);
          if (!c) return;
          claim(c.ix, c.iy);
          res.objects.push(WG.makeObject('fruittree', cx(c.ix), cy(c.iy),
            WG.cellId('ft_lane', tx, ty, c.ix, c.iy),
            { species: peach ? 'peach' : 'apple', wild: true, _street: v }));
          placed++;
        });
      } else if (v === 'pilgrim') {
        // A waystone at each owned end — tapped, it reads one page of the
        // Book (interactables.js INTERACTABLES.waystone, spent in `opened`).
        for (const p of ownedEnds(rec)) {
          const c = seat(p.x, p.y);
          if (!c) continue;
          claim(c.ix, c.iy);
          res.objects.push(WG.makeObject('waystone', cx(c.ix), cy(c.iy),
            WG.cellId('waystone', tx, ty, c.ix, c.iy), { _street: v }));
        }
      } else if (v === 'barricade') {
        // A barricade at each owned end: a wild plant on the SHRUB's rule
        // (items.js WILDPLANT_RULES.barricade) — broken up with the axe for
        // wood, `picked` once cleared.
        for (const p of ownedEnds(rec)) {
          const c = seat(p.x, p.y);
          if (!c) continue;
          claim(c.ix, c.iy);
          res.wildplants.push(WG.makeWildplant('barricade', cx(c.ix), cy(c.iy),
            WG.cellId('barricade', tx, ty, c.ix, c.iy), { _street: v }));
        }
      } else if (v === 'burned') {
        const rng = streamFor(rec, v);
        let placed = 0;
        sampleLine(rec.line, gM, BURNED_STEP_M, BURNED_STEP_M / 2, (s, x, y, nx, ny) => {
          if (placed >= BURNED_MAX) return false;
          const side = rng() < 0.5 ? 1 : -1;
          const tar = rng() < 0.5;
          if (!S.covers(spans, s)) return;
          const c = verge(rec, x, y, nx, ny, side);
          if (!c) return;
          claim(c.ix, c.iy);
          const kind = tar ? 'tar' : 'stakes';
          res.objects.push(WG.makeObject(kind, cx(c.ix), cy(c.iy),
            WG.cellId(kind, tx, ty, c.ix, c.iy), { _street: v }));
          res.slowCells.set(c.iy * N + c.ix, kind);
          placed++;
        });
      }
      // lantern: nothing seated here — denser street lamps (lampSpacingFor).
    }

    // The hedgerow's closes: the hoard at the head, and the head as a lair
    // candidate (lairs.js 'close' tier, keyed on the dead end in GLOBAL MVT
    // units — the same key from either tile). No arch at the mouth: it would
    // be a standing thing with nothing to do (the owner's rule — nothing
    // non-interactable that reads as interactable).
    for (const cl of idx.closes || []) {
      const h = seat(cl.head.x, cl.head.y);
      if (!h) continue;
      claim(h.ix, h.iy);
      res.treasures.push({ x: cx(h.ix), y: cy(h.iy),
        id: WG.cellId('treasure_close', tx, ty, h.ix, h.iy), rollBonus: 1 });
      res.lairs.push({ tier: 'close', sid: cl.rk,
        lx: (h.ix + 0.5) * frameCellM, ly: (h.iy + 0.5) * frameCellM });
    }
    if (marked) res.marks = marks;
    return res;
  }

  // The lamp spacing for one line of a street: a Lantern Row's is
  // LANTERN_SPACING_DIV times denser than Streets.lampSpacingM().
  function lampSpacingFor(variant) {
    const S = root.Streets;
    const base = S ? S.lampSpacingM() : 100;
    return variant === 'lantern' ? base / LANTERN_SPACING_DIV : base;
  }

  function isSlowKind(kind) { return SLOW_KINDS.has(kind); }

  root.StreetVariants = {
    PARISH_TILES, NAME_NUDGE, NUDGED_SHARE_MAX, ROCK_STREET_SHARE, VERGE_MAX_CELLS,
    BUS_STOP_MAJOR_CELLS, RUN_MIN_M, RUN_MAX_M, JUNCTION_TOUCH_M, CLOSE_SEAT_CELLS,
    HEDGE_GAP_MIN, HEDGE_GAP_SPAN, OVERGROWN_STEP_M, OVERGROWN_MAX, ORCHARD_STEP_M,
    ORCHARD_MAX, BURNED_STEP_M, BURNED_MAX, LANTERN_SPACING_DIV, SLOW_KINDS,
    STREET_VARIANTS, VARIANT_BY_ID, BANDIT_STORY, variantByCode,
    normName, streetKey, anonKey, parishOf, sizeOfTags, isVehicleTags, variantFor, rocksFor,
    nameVote, lineName, sampleLine, buildIndexSteps, buildIndex, findCloses,
    markBanditStops, dress, dressSteps, lampSpacingFor, isSlowKind,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
