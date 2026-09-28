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
//   MAJOR — ROAD_MD + ROAD_LG (tertiary / secondary and up): the OLD TRADE
//           ROADS (internally still "bandit": BANDIT_STORY, banditStop). The
//           theme is a LOOK only — its story, its torch-orange lamps and the
//           broken wagon a third of its bus stops wear (WAGON_STOP_SHARE,
//           loot.js chestLook). Since Sep 2026 (the owner's safety pass) NOTHING
//           hostile or alive is seated for it: no wagon goblin, no dogs pulled
//           onto its verge, no traps on its stretches (traps.js reads footpaths
//           and park edges now). The stretches are still stamped
//           (ROAD_CLASS_BANDIT_VERGE) but no spawner reads them for a foe.
//   MINOR — ROAD with class minor/street (residential streets). Service ways
//           (driveways, alleys, parking) are neither — they stay plain.
//   Footpaths are neither.
//
// THE KERB BUFFER (WorldGen.ROAD_CLASS_MAJOR_BUFFER, ~one reach radius round
// every MAJOR band): the few foes the variants still seat — a barricade's
// goblin, a burned row's fire slime, a café hoard's giant — are seated BACK
// beyond it (foeSeat: the nearest cell outside it, reached without crossing a
// major band) or not at all. Never a player's reason to step toward the road.
//
// THE CAFÉ HOARDS: a buried hoard (and usually its giant-goblin guard) beside
// a coffee shop — HOARDS_PER_TILE of the tile's own café points, lowest hash
// of the GLOBAL point first (commercial POIs where a tile has no café). Until
// Sep 2026 it sat at the head of a hedgerow's residential dead end.
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
  // Only this share of the stops on a major road wear the broken wagon; the
  // rest stay ordinary bus-stop chests. Decided per stop off a hash of the
  // chest's own id (its POI cell — generated, the same for every player),
  // never a draw. A LOOK only: no guard (the owner, Sep 2026 — no wagon
  // goblins at all).
  const WAGON_STOP_SHARE = 1 / 3;

  // ── The kerb buffer: seating a foe BACK ─────────────────────────────────
  // A foe the dressing seats (barricade goblin, burned-row fire slime, café
  // giant) takes the nearest cell within this many cells of its natural spot
  // that passes WorldGen.isFoeCell (outside ROAD_CLASS_MAJOR_BUFFER) and is
  // reached by a straight walk crossing no MAJOR band cell — so it stays on
  // its own side of the road. None → the foe is dropped.
  const FOE_SEAT_BACK_CELLS = 4;

  // ── Bandit stretches ─────────────────────────────────────────────────────
  // The bandits do not work a major road end to end: each MAJOR street is cut
  // into STRETCHES and BANDIT_STRETCH_SHARE of them are theirs, stamped as
  // the roadClass bit WorldGen.ROAD_CLASS_BANDIT_VERGE. Until Sep 2026 the
  // surface traps sat on those verges; they read footpaths and park edges now
  // (traps.js) and NOTHING reads this bit for a foe or a trap — it stays for
  // the look and the story (and the burned row's per-stretch key).
  // A stretch is (street key, lattice square): the squares are
  // BANDIT_STRETCH_UNITS on an edge in GLOBAL MVT units (tile·4096 + local —
  // ~200 m at play latitudes), aligned to the tile grid, so every square lies
  // inside exactly one tile and a named street's stretch is the same from
  // either side of a seam (the key is; the square is). An unnamed way keys
  // off its own piece (anonKey), so it may disagree at a seam — accepted, as
  // for its variant.
  const BANDIT_STRETCH_UNITS = 512;
  const BANDIT_STRETCH_SHARE = 1 / 3;

  // ── Café hoards ─────────────────────────────────────────────────────────
  // The POI classes a hoard is buried beside: a coffee shop, or — on a tile
  // with no café point of its own — the other commercial food / shop classes.
  const HOARD_POI_CLASSES = new Set(['cafe']);
  const HOARD_POI_FALLBACK = new Set(['bakery', 'ice_cream', 'restaurant', 'fast_food', 'grocery', 'shop']);
  // At most this many hoards per tile (~2.5 km²): lowest hash of the POI's
  // GLOBAL point first, so a tile's pick is a pure function of its own bytes
  // and a seam café is only ever the owning tile's. Keeps the guarded hoards
  // under ~1 per km² even in Berlin (353 cafés over nine tiles).
  const HOARDS_PER_TILE = 2;
  // How far from the POI's cell a hoard may be seated (cells).
  const HOARD_SEAT_CELLS = 5;

  // Relocate reach for an end piece (waystone / barricade) off its line end.
  const END_SEAT_CELLS = 4;

  // ── Dressing density (generation metres along the way) ───────────────────
  const HEDGE_GAP_MIN = 5, HEDGE_GAP_SPAN = 3;   // a gate-gap every 5..7 cells
  const OVERGROWN_STEP_M = 10, OVERGROWN_MAX = 10;
  const ORCHARD_STEP_M = 40, ORCHARD_MAX = 3;
  const TOADSTOOL_STEP_M = 8, TOADSTOOL_MAX = 12, TOADSTOOL_MUSHROOM_SHARE = 0.8;
  const BURNED_STEP_M = 25, BURNED_MAX = 8;
  // How finely a burned row is walked for its one fire slime per stretch.
  const BURNED_GUARD_STEP_M = 10;
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
  // `lampGlow` is the colour its lamps shed (lampGlowFor — light and art read
  // the one value); `attracts` { species: p } is the FAUNA ATTRACTOR column
  // (scene_creatures.js _seatFaunaOnFavouriteGround): each of the tile's own
  // spawns of that species moves onto this street's verge with probability p.
  // `share` is the base probability for a key of that size; the minor rows
  // sum to 0.39 (0.34 + Toadstool Lane's 0.05) and the major ones to 0.16. The design's shares, rescaled
  // now that each row dresses ONE size (the minor rows took the dressed
  // share the design's minor+medium rows gave minor streets, the major rows
  // likewise), keeping its rarity ladder: Common lantern/overgrown,
  // Uncommon orchard/pilgrim/burned, Rare barricade, Find hedgerow.
  // `story` is the _storySplashOnce key AND the painting stem (sceneArtUrl);
  // `flash` is the ≤30-char map line a later visit gets.
  const STREET_VARIANTS = [
    { id: 'hedgerow', size: 'minor', share: 0.10, nudge: 2, rung: 'find',
      words: /\b(lane|ln|close|court|ct|place|pl|mews|circle|cir|crescent|cres|cove|row|gasse|hecke|weg)\b/i,
      lampGlow: '#9be08a', attracts: { rabbit: 0.5 },
      story: 'street_hedgerow', title: 'The hedged lane',
      body: 'Clipped hedges both sides, a gap at every garden gate. The green still knows its shape.',
      flash: 'A hedged lane, still kept.' },
    { id: 'overgrown', size: 'minor', share: 0.10, rung: 'common',
      words: /(park|wood|forest|grove|glen|heath|moor|green|meadow|wald|heide|hain|wiese|garten|garden|fern|brook)/i,
      lampGlow: '#9be08a', attracts: { rabbit: 0.5, butterfly: 0.5 },
      story: 'street_overgrown', title: 'Gone to seed',
      body: 'The green is taking this street back, one crack at a time.',
      flash: 'The green is taking it back.' },
    { id: 'orchard', size: 'minor', share: 0.08, rung: 'uncommon',
      words: /(orchard|apple|cherry|plum|pear|peach|fruit|obst|kirsch|apfel|birn|pflaum|vine|berry)/i,
      lampGlow: '#ffa6c9', attracts: { deer: 0.5 },
      story: 'street_orchard', title: 'Orchard Lane',
      body: 'The old trees still fruit. Nobody picks them.',
      flash: 'Old trees, still fruiting.' },
    { id: 'pilgrim', size: 'minor', share: 0.06, rung: 'uncommon',
      words: /(church|chapel|abbey|kirch|kloster|pilgrim|cross|saint|\bst\b|priest|minster|\bdom\b|mission)/i,
      lampGlow: '#f2eee0', attracts: { crow: 0.5 },
      story: 'street_pilgrim', title: "Pilgrim's Way",
      body: 'A waystone, worn smooth by hands. It remembers something.',
      flash: 'A waystone, worn smooth.' },
    { id: 'lantern', size: 'major', share: 0.07, rung: 'common',
      words: /(lantern|lamp|light|candle|latern)/i,
      // No `attracts`: its marks lie on the major band + verge, all inside
      // the kerb buffer, where no animal is seated (WorldGen.isFoeCell).
      lampGlow: '#ffb347',
      story: 'street_lantern', title: 'Lantern Row',
      body: 'Lamp posts stand thick along this road, cold and waiting. Rebuild it and it will burn bright.',
      flash: 'Lamp posts, cold and waiting.' },
    { id: 'burned', size: 'major', share: 0.05, rung: 'uncommon',
      words: /(mill|forge|smith|ash|burn|brand|kiln|furnace|cinder|coal|ember|kohle|schmied|asche)/i,
      lampGlow: '#ff5a3c',
      story: 'street_burned', title: 'Burned Row',
      body: 'Tar in the gutters and iron stakes in the verge. Watch your feet.',
      flash: 'Tar underfoot. Go slow.' },
    { id: 'barricade', size: 'major', share: 0.04, rung: 'rare',
      words: /(gate|wall|fort|\btor\b|mauer|castle|burg|bastion|guard|wache|barrack|kaserne|armou?ry)/i,
      lampGlow: '#ff8c2a',
      story: 'street_barricade', title: 'The barricade',
      body: 'Barricades across the verge. Goblins held this road once.',
      flash: 'Barricades. Goblins held it.' },
    // Appended LAST so no older row's code (index + 1) moves; the roll walks
    // the minor rows in order, so a street that rolled an older minor row
    // still does — only plain streets can become a toadstool lane.
    { id: 'toadstool', size: 'minor', share: 0.05, rung: 'uncommon',
      words: /(mushroom|toadstool|fung|pilz|fairy|\bring|moss|damp|mycel|spore|schwamm|elfen|feen)/i,
      lampGlow: '#4fd8c4', attracts: { butterfly: 0.5 },
      story: 'street_toadstool', title: 'Toadstool Lane',
      body: 'Pale caps crowd the verge, and after dark they glow. Step round them. Something here is listening.',
      flash: 'Toadstools. They glow at dusk.' },
  ];
  const VARIANT_BY_ID = {};
  STREET_VARIANTS.forEach((r, i) => { VARIANT_BY_ID[r.id] = r; r.code = i + 1; });
  // The OLD TRADE ROAD (internally "bandit"): every MAJOR road, variant or
  // not. Not a row of the table (it dresses nothing of its own — the wagon
  // look is loot.js chestLook's); its story is here beside the others. A LOOK
  // and a story only: no `attracts` (the dogs no longer work major verges —
  // the owner's safety pass, Sep 2026), no foe, no trap.
  const BANDIT_STORY = {
    story: 'street_bandit', title: 'Old trade road',
    body: 'Wheel ruts, and a broken wagon at the odd stop. The carts ran this way once.',
    flash: 'Old trade road. Wheel ruts.',
    // Unthemed major road: torch orange.
    lampGlow: '#ff8c2a',
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

  // Is the stretch of street `key` through lattice square (sx, sy) a bandit
  // stretch? A pure hash of the pair — the same for every player and tile.
  function stretchOf(gx, gy) {
    return { sx: Math.floor(gx / BANDIT_STRETCH_UNITS), sy: Math.floor(gy / BANDIT_STRETCH_UNITS) };
  }
  function isBanditStretch(key, sx, sy) {
    return !!key && u01(`bandit|${key}|${sx},${sy}`) < BANDIT_STRETCH_SHARE;
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
  // hoardPois: the POI points a café hoard may be buried beside — the tile's
  //   OWN café points (inside the square: point ownership, never a neighbour
  //   scan), or its own commercial points when it has no café — each
  //   { x, y, gk } (tile-local MVT, gk the GLOBAL point), sorted by
  //   hoardPick(gk). dress seats the first HOARDS_PER_TILE that seat.
  // roadClass: stamped on by stampBanditStretchesSteps (the tile's resolved
  //   roadClass, kerb buffer included) so the dressing can read the buffer.
  // A generator for the tile-build rule: one yield per INDEX_YIELD_LINES.
  const INDEX_YIELD_LINES = 256;
  function* buildIndexSteps(layers, tx, ty, mvtToM) {
    const WG = root.WorldGen, S = root.Streets;
    const out = { lines: [], hoardPois: [], extent: 4096 };
    if (!layers || !WG) return out;
    let tr = null, tn = null, poi = null;
    for (const l of layers) {
      if (l.name === 'transportation') tr = l;
      else if (l.name === 'transportation_name') tn = l;
      else if (l.name === 'poi') poi = l;
    }
    if (tr) {
      const ext = tr.extent || 4096;
      out.extent = ext;
      const vote = nameVote(tn);
      yield 'street names';
      let n = 0;
      for (let fi = 0; fi < tr.features.length; fi++) {
        const f = tr.features[fi];
        if (f.type !== 2 || !f.geom) continue;
        const size = sizeOfTags(f.tags);
        if (!size) continue;
        for (let li = 0; li < f.geom.length; li++) {
          const line = f.geom[li];
          if (!line || line.length < 2) continue;
          if ((++n % INDEX_YIELD_LINES) === 0) yield 'street index lines';
          const rec = { fi, li, line, tags: f.tags, size };
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
    }
    out.hoardPois = hoardPoisOf(poi, tx, ty, out.extent);
    yield 'street hoard pois';
    return out;
  }
  function buildIndex(layers, tx, ty, mvtToM) {
    const it = buildIndexSteps(layers, tx, ty, mvtToM);
    let r = it.next();
    while (!r.done) r = it.next();
    return r.value;
  }

  // The café hoard's pick: a pure hash of the POI's GLOBAL MVT point, the
  // same for every player and whichever tile asks.
  function hoardPick(gk) { return u01('hoard|' + gk); }
  // The tile's own hoard POIs (see buildIndexSteps' hoardPois). Linear in
  // the poi layer.
  function hoardPoisOf(poiLayer, tx, ty, ext) {
    const cafes = [], other = [];
    if (!poiLayer || !poiLayer.features) return cafes;
    const seen = new Set();
    for (const f of poiLayer.features) {
      if (f.type !== 1 || !f.geom) continue;
      const cls = (f.tags && f.tags.class) || '';
      const isCafe = HOARD_POI_CLASSES.has(cls);
      if (!isCafe && !HOARD_POI_FALLBACK.has(cls)) continue;
      for (const ring of f.geom) {
        const p = ring && ring[0];
        if (!p || p.x < 0 || p.y < 0 || p.x >= ext || p.y >= ext) continue;   // the neighbour's
        const gk = `${tx * ext + p.x},${ty * ext + p.y}`;
        if (seen.has(gk)) continue;
        seen.add(gk);
        (isCafe ? cafes : other).push({ x: p.x, y: p.y, gk, u: hoardPick(gk) });
      }
    }
    const list = cafes.length ? cafes : other;
    list.sort((a, b) => a.u - b.u || (a.gk < b.gk ? -1 : 1));
    return list;
  }

  // ── Stamping the bandit stretches (rasterizeTileSteps, after roadClass) ──
  // For every MAJOR line piece in the tile, walk its arclength (buffer
  // included), and wherever the WAY is on a bandit stretch mark the cells
  // across the band out to its verge (halfW + BANDIT_STAMP_OUT_CELLS). A
  // major-VERGE cell (WorldGen.ROAD_CLASS_MAJOR_VERGE) under a mark gains
  // ROAD_CLASS_BANDIT_VERGE. Generation cells throughout (gM = N·CELL_M/ext),
  // never frame metres. A generator: one yield per major line.
  const BANDIT_STAMP_OUT_CELLS = 2;
  function* stampBanditStretchesSteps(index, roadClass, N, tx, ty) {
    const WG = root.WorldGen, S = root.Streets;
    if (!index || !roadClass || !WG || !S || !(N > 0)) return 0;
    // The tile's resolved roadClass, kept on the index so the dressing (run
    // later in the same build) can read the kerb buffer when its caller's
    // spawn options carry none — one array, never a second reading.
    index.roadClass = roadClass;
    const ext = index.extent || 4096;
    const CELL_M = WG.CELL_M;
    const gM = (N * CELL_M) / ext;
    const VERGE = WG.ROAD_CLASS_MAJOR_VERGE, BANDIT = WG.ROAD_CLASS_BANDIT_VERGE;
    const ox = tx * ext, oy = ty * ext;
    let n = 0;
    for (const rec of index.lines) {
      if (rec.size !== 'major') continue;
      yield 'bandit stretches';
      const r = rec.halfW + BANDIT_STAMP_OUT_CELLS * CELL_M;
      const memo = new Map();
      // The WHOLE piece, buffer included (no tileSpans cut): a way running
      // just past the tile edge still has its verge inside — and the stretch
      // is the square the WAY is in, the same from either tile.
      sampleLine(rec.line, gM, CELL_M * 0.7, 0, (s, x, y, nx, ny) => {
        const st = stretchOf(ox + x / gM, oy + y / gM);
        const mk = st.sx * 65536 + st.sy;
        let on = memo.get(mk);
        if (on === undefined) memo.set(mk, on = isBanditStretch(rec.key, st.sx, st.sy));
        if (!on) return;
        for (let o = -r; o <= r; o += CELL_M * 0.7) {
          const ix = Math.floor((x + nx * o) / CELL_M), iy = Math.floor((y + ny * o) / CELL_M);
          if (ix < 0 || iy < 0 || ix >= N || iy >= N) continue;
          const i = iy * N + ix;
          if ((roadClass[i] & VERGE) && !(roadClass[i] & BANDIT)) { roadClass[i] |= BANDIT; n++; }
        }
      });
    }
    return n;
  }

  // ── Bandit stops (the old trade road's wagons — a LOOK) ─────────────────
  // Stamp `banditStop` on the bus-stop chests within BUS_STOP_MAJOR_CELLS of
  // a MAJOR band (roadClass bit 1) that isWagonStop picks (WAGON_STOP_SHARE).
  // The chest itself is untouched otherwise: same id, tier, contents and
  // `opened` semantics; loot.js chestLook reads the flag to wear the wagon.
  // Its memoised look is dropped so a stop drawn before this pass re-resolves.
  // NO GUARD (the owner, Sep 2026: no wagon goblins at all — a stop is on the
  // kerb of a major road by definition). Returns the lair candidates it adds
  // — always NONE now; kept an (empty) array so a caller that still iterates
  // it (scene_creatures.js spawnInTile) needs no change.
  function isWagonStop(id) { return !!id && u01('wagon|' + id) < WAGON_STOP_SHARE; }
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
      if (!near || !isWagonStop(o.id)) continue;
      o.banditStop = true;
      delete o._chestLook;
    }
    return lairs;
  }

  // ── Seating a foe back from the kerb ────────────────────────────────────
  // The offsets within FOE_SEAT_BACK_CELLS / HOARD_SEAT_CELLS, nearest first
  // (ties row-major) — built once, so the search order is a constant.
  function offsetsWithin(R) {
    const out = [];
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const d2 = dx * dx + dy * dy;
        if (d2 <= R * R) out.push({ dx, dy, d2 });
      }
    }
    out.sort((a, b) => a.d2 - b.d2 || a.dy - b.dy || a.dx - b.dx);
    return out;
  }
  const BACK_OFFSETS = offsetsWithin(FOE_SEAT_BACK_CELLS);
  const HOARD_OFFSETS = offsetsWithin(HOARD_SEAT_CELLS);
  // Does the straight walk from cell (x0, y0) to (x1, y1) touch a MAJOR band
  // cell? Sampled four times a cell, so a band a cell wide is never stepped
  // over. The "same side of the road" test: a seat reached without crossing
  // the band is on the side it started. The START cell is not asked: the
  // band bit covers every cell the band so much as grazes (wider than
  // roadMask), so a verge cell or a café's own cell may carry it, and a walk
  // AWAY from the road must still be allowed out of it.
  function crossesMajorBand(roadClass, N, x0, y0, x1, y1) {
    if (!roadClass) return false;
    const WG = root.WorldGen;
    const dx = x1 - x0, dy = y1 - y0;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) * 4));
    for (let k = 1; k <= steps; k++) {
      const x = Math.floor(x0 + 0.5 + dx * k / steps), y = Math.floor(y0 + 0.5 + dy * k / steps);
      if (x === x0 && y === y0) continue;
      if (x < 0 || y < 0 || x >= N || y >= N) continue;
      if (WG.onMajorBand(roadClass, N, x, y)) return true;
    }
    return false;
  }
  // The first cell of `offsets` round (ix, iy) that passes `ok` and is
  // reached without crossing a major band, or null.
  function nearestSeat(ix, iy, N, roadClass, offsets, ok) {
    for (const o of offsets) {
      const x = ix + o.dx, y = iy + o.dy;
      if (x < 0 || y < 0 || x >= N || y >= N) continue;
      if (!ok(x, y)) continue;
      if (crossesMajorBand(roadClass, N, ix, iy, x, y)) continue;
      return { ix: x, iy: y };
    }
    return null;
  }

  // ── Dressing (the end of rasterizeTileSteps; laid by spawnInTile) ─────────
  // ctx: { index, tx, ty, N, tileEdgeM, grid (the GENERATED grid), spawnOpts
  //        (roadMask + occupied + pois [+ roadClass] — occupied GROWS: each
  //        placed piece claims its cell, so later spawners and later pieces
  //        see it; roadClass, when absent, is read off index.roadClass) }
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
    // THE KERB BUFFER: the caller's roadClass, else the one the stamp pass
    // left on the index. A foe's seat is WorldGen.isFoeCell (the shared rule
    // AND outside ROAD_CLASS_MAJOR_BUFFER), found by foeSeat.
    const rc = spawnOpts.roadClass || idx.roadClass || null;
    const foeOpts = rc && !spawnOpts.roadClass ? Object.assign({}, spawnOpts, { roadClass: rc }) : spawnOpts;
    const foeOk = (ix, iy) => WG.isFoeCell(grid, N, N, ix, iy, foeOpts);
    // Seat a foe BACK: its natural cell if it is a foe cell, else the nearest
    // within FOE_SEAT_BACK_CELLS on the same side of any major band — or null
    // (the foe is dropped).
    const foeSeat = (ix, iy) => nearestSeat(ix, iy, N, rc, BACK_OFFSETS, foeOk);
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
      if (ix < -END_SEAT_CELLS || iy < -END_SEAT_CELLS
          || ix >= N + END_SEAT_CELLS || iy >= N + END_SEAT_CELLS) return null;
      return WG.relocateToSpawnCell(grid, N, N, ix, iy, spawnOpts, END_SEAT_CELLS);
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

    const burnedSeen = new Set();
    // Pilgrim's Way / barricade street key → every owned piece end in the
    // square (tile-local MVT points), in line order.
    const streetEnds = new Map();
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
      } else if (v === 'toadstool') {
        // TOADSTOOL LANE: the verge crowds with mushrooms (the wild mushroom
        // — it glows after dark, items.js WILDPLANT_RULES / wildplantLight),
        // a tuft of long grass among them now and then.
        const rng = streamFor(rec, v);
        let placed = 0;
        sampleLine(rec.line, gM, TOADSTOOL_STEP_M, TOADSTOOL_STEP_M / 2, (s, x, y, nx, ny) => {
          if (placed >= TOADSTOOL_MAX) return false;
          const side = rng() < 0.5 ? 1 : -1;
          const pick = rng();
          if (!S.covers(spans, s)) return;
          const c = verge(rec, x, y, nx, ny, side);
          if (!c) return;
          const crop = pick < TOADSTOOL_MUSHROOM_SHARE ? 'mushroom' : 'longgrass';
          claim(c.ix, c.iy);
          res.wildplants.push(WG.makeWildplant(crop, cx(c.ix), cy(c.iy),
            WG.cellId('wp_ts', tx, ty, c.ix, c.iy), { _street: v }));
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
      } else if (v === 'pilgrim' || v === 'barricade') {
        // ONE PER STREET PER TILE: the ends are pooled by street key and
        // seated after this loop (see `streetEnds` below) — a major road cut
        // into many short pieces stood a barricade at every cut.
        let arr = streetEnds.get(v + '|' + rec.key);
        if (!arr) streetEnds.set(v + '|' + rec.key, arr = { v, key: rec.key, ends: [] });
        for (const p of ownedEnds(rec)) arr.ends.push(p);
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
        // ONE FIRE SLIME PER STRETCH (lairs.js 'burned' tier): the first
        // spawnable verge cell of each (street key, stretch square) this piece
        // walks through inside the tile. The squares are tile-aligned, so a
        // stretch belongs to one tile; `burnedSeen` keeps a street that is
        // several line pieces here to one guard per stretch. No draws.
        sampleLine(rec.line, gM, BURNED_GUARD_STEP_M, BURNED_GUARD_STEP_M / 2, (s, x, y, nx, ny) => {
          if (!S.covers(spans, s)) return;
          const st = stretchOf(tx * ext + x / gM, ty * ext + y / gM);
          const sk = `burned:${rec.key}|${st.sx},${st.sy}`;
          if (burnedSeen.has(sk)) return;
          // Seated BACK beyond the kerb buffer (foeSeat), from whichever
          // verge side seats; neither → try the stretch's next sample.
          let c = null;
          for (const side of [1, -1]) {
            const v = verge(rec, x, y, nx, ny, side);
            c = v && foeSeat(v.ix, v.iy);
            if (c) break;
          }
          if (!c) return;
          burnedSeen.add(sk);
          res.lairs.push({ tier: 'burned', sid: sk,
            lx: (c.ix + 0.5) * frameCellM, ly: (c.iy + 0.5) * frameCellM });
        });
      }
      // lantern: nothing seated here — denser street lamps (lampSpacingFor).
    }

    // THE END PIECES — ONE per (street, tile). A waystone (Pilgrim's Way —
    // tapped, it reads one page of the Book: interactables.js
    // INTERACTABLES.waystone, spent in `opened`) or a barricade (a wild plant
    // on the SHRUB's rule, items.js WILDPLANT_RULES.barricade — broken up
    // with the axe, `picked` once cleared — and the goblin who holds it,
    // lairs.js 'barricade' tier) stands at the ONE owned end of the street's
    // pieces here whose hash endPick(variant, key, global point) is lowest
    // and that seats (the next lowest if not). Ends are tile-owned, so no two
    // tiles seat the same street's piece at one end, and the choice is a pure
    // function of the tile's bytes. (Until Sep 2026 every piece end stood one:
    // a major road cut into many short lines stood 220 goblins over Seattle's
    // nine tiles.)
    for (const grp of streetEnds.values()) {
      yield 'street end pieces';
      const seen = new Set();
      const cands = [];
      for (const p of grp.ends) {
        const gk = `${tx * ext + p.x},${ty * ext + p.y}`;
        if (seen.has(gk)) continue;
        seen.add(gk);
        cands.push({ p, u: u01(`end|${grp.v}|${grp.key}|${gk}`) });
      }
      cands.sort((a, b) => a.u - b.u);
      for (const { p } of cands) {
        const c = seat(p.x, p.y);
        if (!c) continue;
        claim(c.ix, c.iy);
        if (grp.v === 'pilgrim') {
          res.objects.push(WG.makeObject('waystone', cx(c.ix), cy(c.iy),
            WG.cellId('waystone', tx, ty, c.ix, c.iy), { _street: grp.v }));
        } else {
          res.wildplants.push(WG.makeWildplant('barricade', cx(c.ix), cy(c.iy),
            WG.cellId('barricade', tx, ty, c.ix, c.iy), { _street: grp.v }));
          // Its goblin stands BACK from the kerb (foeSeat), keyed on the
          // barricade — or there is none.
          const g = foeSeat(c.ix, c.iy);
          if (g) {
            res.lairs.push({ tier: 'barricade', sid: WG.cellId('barricade', tx, ty, c.ix, c.iy),
              lx: (g.ix + 0.5) * frameCellM, ly: (g.iy + 0.5) * frameCellM });
          }
        }
        break;
      }
    }

    // THE CAFÉ HOARDS: the index's hoard POIs in hash order, the first
    // HOARDS_PER_TILE that seat. A hoard lies BESIDE its POI on public ground
    // (the shared spawn rule) within HOARD_SEAT_CELLS, on the POI's side of
    // any major band (nearestSeat). GUARDED when the hoard's own cell is a foe
    // cell (outside the kerb buffer): a lair candidate on it (lairs.js 'cafe'
    // tier — Lairs seats the giant on isFoeCell too). Else the nearest plain
    // seat, unguarded. Else nothing, and the next café may take the slot.
    // Keyed on the POI's GLOBAL point; the id from the hoard's cell.
    let hoards = 0;
    for (const hp of idx.hoardPois || []) {
      if (hoards >= HOARDS_PER_TILE) break;
      yield 'street hoards';
      const pix = cellOfM(hp.x * gM), piy = cellOfM(hp.y * gM);
      let h = nearestSeat(pix, piy, N, rc, HOARD_OFFSETS, foeOk);
      const guarded = !!h;
      if (!h) h = nearestSeat(pix, piy, N, rc, HOARD_OFFSETS, cellOk);
      if (!h) continue;
      claim(h.ix, h.iy);
      hoards++;
      res.treasures.push({ x: cx(h.ix), y: cy(h.iy),
        id: WG.cellId('treasure_cafe', tx, ty, h.ix, h.iy), rollBonus: 1, guarded });
      if (guarded) {
        res.lairs.push({ tier: 'cafe', sid: `cafe:${hp.gk}`,
          lx: (h.ix + 0.5) * frameCellM, ly: (h.iy + 0.5) * frameCellM });
      }
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

  // THE LAMP'S GLOW: a street's lamps shed its variant's colour (the row's
  // `lampGlow`), an unthemed MAJOR road the bandit road's torch orange, and
  // anything else (a plain minor street, a service way, a footpath) null —
  // the caller's default, util.js UI_LAMP_GLOW. `rec` is a street-index line
  // record ({ size, variant }) or null. One value per lamp, read by both the
  // light and the baked art.
  function lampGlowFor(rec) {
    if (!rec) return null;
    const row = rec.variant ? VARIANT_BY_ID[rec.variant] : null;
    if (row && row.lampGlow) return row.lampGlow;
    if (rec.size === 'major') return BANDIT_STORY.lampGlow;
    return null;
  }

  function isSlowKind(kind) { return SLOW_KINDS.has(kind); }

  root.StreetVariants = {
    PARISH_TILES, NAME_NUDGE, NUDGED_SHARE_MAX, ROCK_STREET_SHARE, VERGE_MAX_CELLS,
    BANDIT_STRETCH_UNITS, BANDIT_STRETCH_SHARE, BANDIT_STAMP_OUT_CELLS,
    stretchOf, isBanditStretch, stampBanditStretchesSteps,
    BUS_STOP_MAJOR_CELLS, WAGON_STOP_SHARE, isWagonStop, END_SEAT_CELLS,
    FOE_SEAT_BACK_CELLS, HOARD_POI_CLASSES, HOARD_POI_FALLBACK, HOARDS_PER_TILE, HOARD_SEAT_CELLS,
    hoardPick, hoardPoisOf, crossesMajorBand, nearestSeat,
    HEDGE_GAP_MIN, HEDGE_GAP_SPAN, OVERGROWN_STEP_M, OVERGROWN_MAX, ORCHARD_STEP_M,
    ORCHARD_MAX, TOADSTOOL_STEP_M, TOADSTOOL_MAX, TOADSTOOL_MUSHROOM_SHARE, BURNED_STEP_M, BURNED_MAX, BURNED_GUARD_STEP_M, LANTERN_SPACING_DIV, SLOW_KINDS,
    STREET_VARIANTS, VARIANT_BY_ID, BANDIT_STORY, variantByCode,
    normName, streetKey, anonKey, parishOf, sizeOfTags, isVehicleTags, variantFor, rocksFor,
    nameVote, lineName, sampleLine, buildIndexSteps, buildIndex,
    markBanditStops, dress, dressSteps, lampSpacingFor, lampGlowFor, isSlowKind,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
