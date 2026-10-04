// World generation: fetch MVT tiles and rasterize into a grid of CELL_M-meter game cells.
// Coords: web-mercator pixel space at z=14. 1 MVT tile = 256 px = 4096 MVT units.
// Game cell = CELL_M m (currently 7 m). Cell size in pixels depends on latitude.

(function (global) {
  const SATEXTRACT_URL = typeof document !== 'undefined' && document.currentScript?.src
    ? new URL('../data/satextract_osm.geojson?v=7', document.currentScript.src).href
    : 'data/satextract_osm.geojson?v=7';
  const Z = 14;
  const TILE_PX = 256;          // standard
  const TILE_EXTENT = 4096;     // MVT units
  const CELL_M = 7;             // game cell size in meters
  // Park, forest and grove trees share this ordered set so a species change
  // reaches every generated tree lane.
  const TREE_SPECIES = Object.freeze(['maple', 'pine']);
  // Natural fruit trees share one Worldpeach chance per stable cell.
  // No RNG draws or placement order affect the species.
  const PEACH_ONE_IN = 50;
  function fruitTreeSpecies(hash) {
    return (hash >>> 0) % PEACH_ONE_IN === 0 ? 'worldpeach' : 'apple';
  }
  // Temporarily pause the detected-tree layer, including already cached bins.
  const DEEPFOREST_TREES_ENABLED = false;

  // ── Where the tiles come from ──────────────────────────────────────────
  // OpenFreeMap serves each weekly planet build from a DATED directory
  // (`/planet/20260520_001001_pt/...`), and its host keeps two of them — the
  // newest and the one currently deployed — and deletes the rest. So a tile
  // URL with a version in it has a shelf life of weeks, after which every
  // request for ground that isn't already cached fails, and it fails as a
  // network error rather than a tile 404 (the host has no location block for
  // a version that is gone). That is the "can't reach the map — tap to retry"
  // that retrying could not clear and that nobody at home noticed, because
  // home was in IndexedDB from months ago.
  //
  // The published way to find the live version is the TileJSON at
  // TILEJSON_URL, whose `tiles[0]` is the current template. It is resolved at
  // the first tile fetch (resolveTileUrl), remembered in IndexedDB for a day,
  // and re-asked ONCE whenever a tile fetch fails — so a rotation mid-session
  // heals on the next tile instead of on the next deploy. TILE_URL_FALLBACK is
  // what was last known to work when nothing can be resolved (offline first
  // run): bump it when it rotates, but nothing depends on it being current.
  const TILE_HOST = 'https://tiles.openfreemap.org';
  const TILEJSON_URL = TILE_HOST + '/planet';
  const TILE_URL_FALLBACK = 'https://tiles.openfreemap.org/planet/20260520_001001_pt/{z}/{x}/{y}.pbf';
  const TILEJSON_IDB_KEY = '__tilejson';           // { url, fetchedAt } in the tile store
  const TILEJSON_REFRESH_MS = 24 * 60 * 60 * 1000; // re-ask daily; the planet rotates weekly
  const TILEJSON_RETRY_MIN_MS = 60 * 1000;         // a failing host is asked once a minute, not per tile

  // The tile cache key, spelled one way. `${Z}/${tx}/${ty}` is hand-built
  // across this file and several others (app.js, render.js, …) — this is the
  // one place that does it, exported as WorldGen.tileKey for the rest.
  function tileKey(tx, ty) {
    return `${Z}/${tx}/${ty}`;
  }

  // ── ONE FACTORY PER ENTITY ARRAY ──────────────────────────────────────────
  // A tile carries three streams of world things — `objects`, `wildplants` and
  // `creatures` — and each was minted as a bare object literal at ~30 sites
  // spread over worldgen.js, app.js, interact.js, lairs.js and sandbox.js.
  // Nothing was wrong with any one of them; the cost was that a field EVERY
  // record of a stream must carry had ~30 places to be added and one to be
  // forgotten. (The wildplant's `kind` is exactly that: Lighting.sourceKind
  // used to detect a wild plant by the ABSENCE of a kind — `o.kind ===
  // undefined && o.crop` — because no mint site set one.)
  //
  // So these are the canonical shapes, and every mint site goes through them:
  // a new field on a stream lands HERE, once, and reaches every record.
  //
  // THE ID IS THE CALLER'S. A factory never mints one — the save's delta lists
  // (`picked`, `caught`, `chopped`, …) key off ids that must be a pure function
  // of POSITION so a re-rasterized or rebuilt tile reproduces them exactly
  // (CLAUDE.md, "The world is GENERATED"). Each site keeps the id scheme it
  // has always computed; the factory only says what a record of that stream
  // LOOKS like.
  //
  // `extra` is spread last, so a site can still carry the per-kind fields its
  // stream allows (a tree's species, a chest's loot, a lair guard's ring).
  function makeWildplant(crop, x, y, id, extra) {
    return { kind: 'wildplant', crop, x, y, id, ...extra };
  }
  function makeCreature(kind, x, y, id, extra) {
    return { kind, x, y, id, ...extra };
  }
  function makeObject(kind, x, y, id, extra) {
    return { kind, x, y, id, ...extra };
  }

  // Spatial-hash multipliers. The (HASH_MUL_X, HASH_MUL_Y) pair is the classic
  // 2D integer hash used to derive stable per-coordinate seeds (poly keys, tile
  // rng, addresses, satextract tree seeds). Renamed from bare literals — values
  // are byte-identical to the originals.
  const HASH_MUL_X = 73856093;
  const HASH_MUL_Y = 19349663;

  // A 32-bit seed for one CELL of one TILE: (tx, ty) plus the tile-local cell
  // (ix, iy) on the tile's own grid (cellsPerEdgeForTile(ty) cells an edge).
  // Every generated id and per-thing seed is keyed this way — never on frame
  // metres (Math.round of an x/y, or a global floor(x / CELL_M) cell), which
  // move with the save's home latitude and so gave two players two worlds.
  // Integer maths only (Math.imul + a murmur3 finaliser), so it is exact.
  function cellHash(tx, ty, ix, iy) {
    return murmurMix32(Math.imul(tx | 0, HASH_MUL_X) ^ Math.imul(ty | 0, HASH_MUL_Y)
          ^ Math.imul(ix | 0, 83492791) ^ Math.imul(iy | 0, 0x27D4EB2F));
  }

  // Rooted park enemies have their own per-cell stream. Filtering one blocked
  // cell never shifts another candidate, and no fauna/treasure RNG is consumed.
  const PARK_PLANT_CELL_CHANCE = 1 / 192;
  const PARK_PLANT_SALT = 0x50a17;
  function spawnParkPlants(grid, w, h, tx, ty, tileEdgeM, opts = {}) {
    const plants = [];
    for (let cy = 0; cy < h; cy++) for (let cx = 0; cx < w; cx++) {
      if (grid[cy * w + cx] !== T.PARK) continue;
      const rng = makeRng(cellHash(tx, ty, cx, cy) ^ PARK_PLANT_SALT);
      if (rng() >= PARK_PLANT_CELL_CHANCE) continue;
      // A biting plant is a foe: the enemy class (OPEN cells only).
      if (!isSpawnCell(grid, w, h, cx, cy, opts, 'enemy')) continue;
      plants.push(makeCreature('plant',
        tx * tileEdgeM + (cx + 0.5) * tileEdgeM / w,
        ty * tileEdgeM + (cy + 0.5) * tileEdgeM / h,
        cellId('plant', tx, ty, cx, cy)));
    }
    return plants;
  }

  function isGeneralAmbientRecord(o) {
    return !o.placed && !o.zoneVariant &&
      /^(?:wp|hr|hm|hmpot|ibarrel|ptree|tree|ft|mr|rb)_-?\d+_/.test(o.id || '');
  }

  // Zone layouts own the entire coverage, including intentionally empty motif
  // cells. Replace biome scatter and street dressing there, retaining mapped
  // places/buildings/trees and player objects. Numeric tile-id prefixes belong
  // to procedural ambience; OSM imports have distinct *_osm / *_sx prefixes.
  function* clearZoneAmbientSteps({ field, objects, wildplants, occupied, streetDress, scenicDress, tx, ty, N, tileEdgeM }) {
    const coverage = field && field.coverage;
    if (!coverage) return 0;
    const removed = new Set();
    const frame = tileFrame({ cellsPerEdge: N }, tx, ty, tileEdgeM);
    const cell = o => frame.idxOf(o.x, o.y);
    const streetLists = streetDress ? [streetDress.objects, streetDress.wildplants,
      streetDress.treasures, streetDress.coins, streetDress.traps] : [];
    const scenicLists = scenicDress ? [scenicDress.objects, scenicDress.wildplants] : [];
    let count = 0;
    field.legacyRemovedByAnchor = field.legacyRemovedByAnchor || {};
    const record = (idx, street) => {
      const anchor = field.anchors && field.anchors[coverage[idx] - 1];
      const key = anchor ? `${anchor.kind}:${anchor.gx},${anchor.gy}` : String(coverage[idx]);
      const row = field.legacyRemovedByAnchor[key] || (field.legacyRemovedByAnchor[key] = { ambient: 0, street: 0 });
      row[street ? 'street' : 'ambient']++;
      removed.add(idx);
      count++;
    };
    for (const list of [objects, wildplants, ...streetLists, ...scenicLists]) {
      if (!list) continue;
      const streetList = streetLists.includes(list);
      yield* compactSteps(list, (o) => {
        const idx = cell(o);
        // Scenic landmarks and tide pools retain their seats, but ordinary
        // greenway verge grass yields to the zone just like road dressing.
        const street = streetList || (scenicLists.includes(list) && !!o._street);
        if (!((street || isGeneralAmbientRecord(o)) && idx >= 0 && coverage[idx])) return false;
        record(idx, street);
        return true;
      }, 'zone ambient replacement');
    }
    if (streetDress) {
      yield* compactSteps(streetDress.lairs || [], (lair) => {
        const idx = cell({ x: frame.ox + lair.lx, y: frame.oy + lair.ly });
        if (!(idx >= 0 && coverage[idx])) return false;
        record(idx, true);
        return true;
      }, 'zone street guard replacement');
      for (let i = 0; i < coverage.length; i++) {
        if ((i & 511) === 0) yield 'zone street mark replacement';
        if (!coverage[i]) continue;
        if (streetDress.marks) streetDress.marks[i] = 0;
        if (streetDress.slowCells) streetDress.slowCells.delete(i);
      }
    }
    if (occupied && removed.size) {
      // Release only cleared cells, then restore any mapped place or retained
      // street item sharing one. Other reservation lanes remain untouched.
      for (const idx of removed) occupied.delete(idx);
      for (const list of [objects, wildplants, ...streetLists, ...scenicLists]) {
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          if ((i & 63) === 0) yield 'zone retained occupancy';
          const idx = cell(list[i]);
          if (removed.has(idx)) occupied.add(idx);
        }
      }
    }
    return count;
  }

  // The winner is a property of the area, even when its pattern leaves the
  // cell empty. Runtime and late OSM decoration use the same answer as the
  // rasterizer; streetDress.marks only records story/visual dressing.
  function variantOwnerAt(entry, idx) {
    if (!entry || idx < 0) return null;
    if (entry.zone && entry.zone.coverage && entry.zone.coverage[idx]) return 'zone';
    return entry.streetArea && entry.streetArea[idx] ? 'road' : null;
  }

  // A record's `_street` is a variant id for that variant's own pieces (kept),
  // or `true` for a rock-lined street's verge rocks. Those rocks are general
  // fill: they stay only on a street that is itself a variant (`ownLines`, the
  // lineKeys of variant streets); a plain rock street's rocks crossing or
  // running beside a variant's corridor yield to it.
  function streetRockForeign(o, ownLines) {
    return o._street === true && !!ownLines && !ownLines.has(o._streetLine);
  }

  function* clearStreetAmbientSteps({ area, objects, wildplants, tx, ty, N, tileEdgeM, ownLines }) {
    if (!area) return 0;
    const frame = tileFrame({ cellsPerEdge: N }, tx, ty, tileEdgeM);
    let removed = 0;
    for (const list of [objects, wildplants]) {
      removed += yield* compactSteps(list, (o) => {
        const idx = frame.idxOf(o.x, o.y);
        return isGeneralAmbientRecord(o) && (!o._street || streetRockForeign(o, ownLines)) && idx >= 0 && !!area[idx];
      }, 'street ambient replacement');
    }
    return removed;
  }

  // The id of a generated thing on one CELL of one TILE:
  // `${prefix}_${tx}_${ty}_${ix}_${iy}`. A level or variant goes INTO the
  // prefix (`c_${depth}`), never on the end, so every id minted through here
  // keeps the tile + local-cell tail the rule above asks for.
  function cellId(prefix, tx, ty, ix, iy) {
    return `${prefix}_${tx}_${ty}_${ix}_${iy}`;
  }

  // ── THE TILE FRAME ───────────────────────────────────────────────────────
  // One tile's grid in a save's frame metres: cells an edge (the entry's own
  // row count), metres a cell, the tile's origin, and the three conversions
  // every placer used to re-type — a world point to its local cell or flat
  // index (-1 outside the square), a local cell to its centre. The spelling
  // (`floor((w - origin) / (tileEdgeM / N))`, `origin + (i + 0.5) * cellM`)
  // is the one the dressings, the cave loader, lairs.js and starter.js all
  // key cells by, so a cell resolved here is the cell they resolved.
  function tileFrame(entry, tx, ty, tileEdgeM) {
    const N = entry.cellsPerEdge, cellM = tileEdgeM / N;
    const ox = tx * tileEdgeM, oy = ty * tileEdgeM;
    const inTile = (ix, iy) => ix >= 0 && iy >= 0 && ix < N && iy < N;
    const cellOf = (wx, wy) => ({ ix: Math.floor((wx - ox) / cellM), iy: Math.floor((wy - oy) / cellM) });
    const idxOf = (wx, wy) => { const c = cellOf(wx, wy); return inTile(c.ix, c.iy) ? c.iy * N + c.ix : -1; };
    const centre = (ix, iy) => ({ x: ox + (ix + 0.5) * cellM, y: oy + (iy + 0.5) * cellM });
    return { N, cellM, ox, oy, inTile, cellOf, idxOf, centre };
  }
  // The flat cell indices every record of `lists` stands on (records outside
  // the square are skipped) — THE occupancy set, keyed the way isSpawnCell's
  // `occupied` reads it, so a placer's own occupancy can be handed to the gate.
  function occupiedIndexSet(frame, ...lists) {
    const out = new Set();
    for (const list of lists) {
      for (const o of list || []) { const i = frame.idxOf(o.x, o.y); if (i >= 0) out.add(i); }
    }
    return out;
  }
  // THE SPAWN OPTIONS OF A LIVE ENTRY: what spawnInTile stamped on it
  // (entry._spawnOpts — the generated occupancy and the POI list under the
  // tile's masks), under the entry's own masks, plus a caller's overrides
  // (its own occupancy, a class's extras). Every runtime placer — a story
  // neighbour, the starter stash and plot, a trapper's snare — reads the gate
  // through this, never a rebuilt { roadMask, spawnWhy } pair, which judged
  // its thing by a thinner gate than everything else on the tile (no kerb
  // class, no quiet land, no POI-frontage lift, no shared occupancy).
  function spawnOptsOf(entry, extra) {
    return Object.assign({}, entry._spawnOpts,
      { roadMask: entry.roadMask, spawnWhy: entry.spawnWhy, roadClass: entry.roadClass, quiet: entry.quietMask },
      extra);
  }
  // THE DRESSING FRAME: what every dressSteps pass (zones, scenic, streets,
  // the zone layouts, the reef) derives from its ctx before laying a piece —
  // the tile frame, the occupancy it claims into (ctx.spawnOpts.occupied,
  // created if absent — it GROWS: each piece claims its cell so later passes
  // and later pieces see it), and the chest each owned POI minted (by its
  // tile-local `_poiAt` point).
  function dressFrame(ctx) {
    const { tx, ty, N, tileEdgeM } = ctx;
    const f = tileFrame({ cellsPerEdge: N }, tx, ty, tileEdgeM);
    const opts = ctx.spawnOpts || (ctx.spawnOpts = {});
    const occ = opts.occupied || (opts.occupied = new Set());
    const chestAt = new Map();
    for (const o of ctx.chests || []) if (o && o.kind === 'chest' && o._poiAt) chestAt.set(o._poiAt, o);
    return Object.assign(f, { occ, chestAt,
      cx: (ix) => f.ox + (ix + 0.5) * f.cellM,
      cy: (iy) => f.oy + (iy + 0.5) * f.cellM,
      claim: (ix, iy) => { occ.add(iy * N + ix); },
      // A flat cell index back to its cell (the coverage arrays are flat).
      cellXY: (i) => ({ ix: i % N, iy: Math.floor(i / N) }) });
  }
  // Every cell of a square (or, `disc`, a rounded) footprint of `radius`
  // about (cx, cy) — dy outer then dx — as [x, y] pairs, or null the moment
  // one fails `eligible(x, y)`: a shipwreck's hull, a stone garden's rings.
  function footprintFree(cx, cy, radius, eligible, disc) {
    const cells = [];
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (disc && dx * dx + dy * dy > (radius + 0.5) ** 2) continue;
        if (!eligible(cx + dx, cy + dy)) return null;
        cells.push([cx + dx, cy + dy]);
      }
    }
    return cells;
  }
  // Drop from `list`, in place, every record `drop(o)` names — one yield per
  // 64 records (the tile build's slicing rule). Returns how many went.
  function* compactSteps(list, drop, label) {
    let kept = 0, removed = 0;
    for (let i = 0; i < list.length; i++) {
      if ((i & 63) === 0) yield label;
      const o = list[i];
      if (drop(o)) removed++; else list[kept++] = o;
    }
    list.length = kept;
    return removed;
  }

  // The seed of one spawner's OWN per-tile stream: the (tx, ty) spatial hash,
  // XOR a per-spawner salt times the level. The float multiply (not imul) and
  // the `>>> 0` are what every stream has always used — do not "fix" them, or
  // every existing world re-rolls. depth 0 (the surface) drops the salt.
  function tileStreamSeed(tx, ty, salt = 0, depth = 0) {
    return ((tx * HASH_MUL_X) ^ (ty * HASH_MUL_Y) ^ (depth * salt)) >>> 0;
  }

  // Terrain class enum (uint8). 0 = unknown/grass default.
  const T = {
    GRASS: 0,
    FOREST: 1,
    SAND: 2,
    WATER: 3,
    FARMLAND: 4,
    RESIDENTIAL: 5,
    PARK: 6,
    ROAD: 7,             // minor / service / street (default small road)
    PATH: 8,
    BUILDING: 9,         // small/default — houses, sheds
    ROCK: 10,
    BUILDING_MED: 11,    // shops / mid-rise
    BUILDING_LARGE: 12,  // schools / civic / industrial
    ROAD_LG: 13,         // motorway / trunk / primary
    ROAD_MD: 14,         // secondary / tertiary
    // Subtype splits — each fits into one of three base biomes (rocky/forest/grassland)
    // but has its own colour so the world reads varied.
    SCHOOL: 15,          // ROCKY  — school/college grounds
    COMMERCIAL: 16,      // ROCKY  — retail/commercial/hospital
    INDUSTRIAL: 17,      // ROCKY  — industrial / utility
    PLAYGROUND: 18,      // GRASSLAND — playground surfaces
    PITCH: 19,           // GRASSLAND — sports field (split off PARK)
    WETLAND: 20,         // GRASSLAND — marshy area
    GOLF: 21,            // GRASSLAND — golf course
    ORCHARD: 22,         // FOREST — fruit trees
    // PIER: wooden walkway over water (OSM transportation:pier). Treated as a
    // distinct terrain code rather than a per-cell overlay on WATER so the
    // dozens of "type === WATER" gates around the codebase (creature wander
    // rejection, watering-can refill, fishing taps, mineralrock blocking,
    // building-zone scoring) don't each need to special-case "...unless it's
    // a pier cell". Walkable (not in any building/water blocking set),
    // non-tillable, not a road tier (so no road-name labels or path-stone
    // activation). Rendered by drawing a base water tile + plank sprite
    // overlay via the cobblePool — see render.js PIER_FRAME.
    PIER: 23,
    // --- Underground cave biome (depth > 0) ---
    // The cave map is the "negative" of the surface directly above it: every
    // surface-walkable cell becomes CAVE_FLOOR (you can walk it); every
    // non-walkable surface cell (water, any road, any building) becomes
    // CAVE_WALL — solid rock you can't pass. This is how surface buildings and
    // roads "indicate obstructions" underground: their footprints are rock.
    // See loadCaveTile + isWalkable (CAVE_WALL is in NON_WALKABLE).
    CAVE_FLOOR: 24,
    CAVE_WALL: 25,
    // LAVA — the one cave level (LAVA_DEPTH) where a surface BUILDING's
    // footprint comes down as molten rock instead of solid: walkable, and
    // everything standing on it burns (Combat.LAVA_DMG_PER_S, app.js
    // _tickLava / wanderCreatures). Drawn as the water tile in red. The level
    // below reads it as WALL (see loadCaveTile), so it changes nothing deeper.
    CAVE_LAVA: 26,
    // WASTELAND — landuse the classifier has no row for (railway yards,
    // brownfield, construction, garages, "neighbourhood" / "quarter"
    // outlines, …). Until Sep 2026 it all fell through to RESIDENTIAL and
    // read as housing; it is its own code now so it can LOOK like what it is
    // — abandoned scrub — while PLAYING exactly like residential land: same
    // lot rule (isLotTerrain), rock clusters, yard flora, fauna and tilling.
    // It is a new REASON in the residential lanes, not a new lane — every
    // "is this someone's lot?" test reads isLotTerrain, never the two codes.
    WASTELAND: 27,
    // INFLUENCE ZONES (src/zones.js) — the HALO a zone anchor paints over the
    // lot and commercial ground around it (RESIDENTIAL / COMMERCIAL /
    // WASTELAND only; Zones.haloSteps, the end of rasterizeTileSteps). Each
    // is a REASON in an existing family, not a new lane:
    //   GROVE      — a park's lush sward (grassland; plays like PARK for
    //                flora and fauna)
    //   CHURCHYARD — the worn grey-green sward of a church / cemetery's
    //                old stones (the rocky family)
    //   TAR_YARD   — a fuel yard's dark oily ground (the industrial family)
    // 30 is render.js' UNMAPPED pseudo-terrain, so the tar yard is 31.
    GROVE: 28,
    CHURCHYARD: 29,
    TAR_YARD: 31,
  };

  // --- Walkability / spawnability (single source of truth) ---
  // "Walkable" = anywhere a person could legally and safely stand on foot.
  // We DON'T derive this from an external walkability dataset — the terrain
  // grid is already rasterized from OSM (OpenFreeMap) vector tiles, so the
  // cell's class IS the walkability signal. Walkable is the whole map minus
  // three groups:
  //   - WATER            (can't stand on it)
  //   - every ROAD tier  (unsafe/illegal to stand in traffic)
  //   - every BUILDING   (solid footprint — you walk around it)
  // Everything else stays walkable: PATH/pedestrian squares, PIER, parks,
  // SAND/beaches, grass, forest, farmland, rock, playgrounds, pitches, etc.
  // THE BUILDING SET: the three building tiers, spelled once. Every "is this
  // cell a building footprint?" test reads it through isBuildingTerrain
  // (declared beside isPavedTerrain below) or spreads it into a wider Set.
  const BUILDING_TYPES = new Set([T.BUILDING, T.BUILDING_MED, T.BUILDING_LARGE]);
  const NON_WALKABLE = new Set([
    T.WATER,
    T.ROAD, T.ROAD_MD, T.ROAD_LG,
    ...BUILDING_TYPES,
    // Underground rock — the solid walls of a cave level. Surface
    // buildings/roads/water rasterize to this in loadCaveTile.
    T.CAVE_WALL,
  ]);
  function isWalkable(t) { return !NON_WALKABLE.has(t); }
  // The road tiers as terrain. Nothing SPAWNS here (isSpawnCell, the road
  // mask), and since Sep 2026 no coin lies here either (the safety rule — a
  // kill's coin is stepped off the road, app.js _dropBountyCoin).
  function isRoadTerrain(t) { return t === T.ROAD || t === T.ROAD_MD || t === T.ROAD_LG; }

  // THE LOT SET: built-up land that models somebody's lot — a residential
  // yard, or the unclassified WASTELAND that used to be painted as one. The
  // frontage rule (isSpawnCell), the residential rock clusters and the yard
  // gates all ask this, so a new lot-like code joins here once.
  const LOT_TYPES = new Set([T.RESIDENTIAL, T.WASTELAND]);
  function isLotTerrain(t) { return LOT_TYPES.has(t); }
  // Which lot ground takes NO rock-cluster scatter (the walk still runs for
  // its yard flora): residential yards — their rubble lines the streets now.
  // Waste ground keeps its rubble.
  const LOT_ROCK_DRY = new Set([T.RESIDENTIAL]);

  // Default Chebyshev radius for the residential-frontage test: a private cell
  // is only spawnable if a public anchor sits within this many cells.
  const SPAWN_FRONTAGE = 3;

  // Terrain that counts as a "public anchor" for the frontage test. Being near
  // any of these is what makes a RESIDENTIAL cell read as street frontage / the
  // edge of public space rather than someone's back garden:
  //   - every road tier + footpaths/pedestrian squares (the kerb / sidewalk)
  //   - clearly public open space we can detect from OSM: parks, playgrounds,
  //     sports pitches, beaches, piers.
  // NOT a golf course (Sep 2026): a club's fairway is members' ground, so a
  // yard backing onto one is still a back yard. (Golf ground itself stays
  // open ground — it is not lot land — it just vouches for nobody else.)
  const PUBLIC_NEAR = new Set([
    T.ROAD, T.ROAD_MD, T.ROAD_LG, T.PATH,
    T.PARK, T.PLAYGROUND, T.PITCH, T.SAND, T.PIER,
  ]);

  // Is (cx,cy) a legitimate place to spawn a pickup? THE single rule every
  // spawner shares. Walkable (never water/road/building) AND not deep in
  // private property. Lot cells (isLotTerrain: RESIDENTIAL, WASTELAND) model someone's yard/lot, so a spawn is
  // only allowed there when — within `frontage` cells (Chebyshev) — there's a
  // public anchor: a road/path, a detectable public area (PUBLIC_NEAR), or a
  // POI. Unifies the legacy _xRoadOK (app.js) and _mrNearRoadWithin (worldgen).
  //   grid/w/h : flat terrain array + its cell dimensions
  //   opts.frontage : override the default radius (SPAWN_FRONTAGE)
  //   opts.pois     : array of {ix,iy} cell coords of nearby POIs/chests —
  //                   a residential cell within `frontage` of one is fair game
  //   opts.roadMask : the tile's road-footprint mask (see rasterizeTile). The
  //                   terrain code alone under-reports the road: every way
  //                   rasterizes one cell wide however wide it really is, and
  //                   parking aisles rasterize to nothing at all, so a cell
  //                   the grid calls grass can be ground the player sees as
  //                   asphalt. Pass it and those cells are refused too.
  //   opts.occupied : a Set of flat cell indices (cy*w+cx) already claimed by
  //                   an existing object or wild plant — a rock, a tree, a
  //                   chest, a produce stand, a tuft of grass. Terrain alone
  //                   can't see this: the cell reads as ordinary walkable
  //                   ground, but something is already drawn on it. Without
  //                   this a trap could be sprung under a rock sprite (the art
  //                   is its only warning) or an X mark could bury itself
  //                   under a tree, undiggable until the tree is felled. Caves
  //                   check the same thing directly (Traps.spawnCave's
  //                   `occupiedIdx`); this is the surface side of that rule.
  //   opts.quiet    : the tile's QUIET-LAND mask (entry.quietMask — see
  //                   QUIET_LAND below): military ground, railway land, First
  //                   Nations reserve land and real cemeteries. A quiet cell
  //                   keeps its look and stays walkable, but hosts NOTHING —
  //                   no creature, trap, pickup, chest or hoard. It is the
  //                   roadMask's lane (a masked cell just can't host a spawn)
  //                   with a different reason, not a new gate.
  //   opts.spawnWhy : THE SPAWN GATE (entry.spawnWhy — see below). With it
  //                   the mask answers every land question (quiet, restricted,
  //                   frontage, behind a house, the typed buffers) and
  //                   `quiet` / `roadClass` / `frontage` are not read; without
  //                   it (a synthetic grid) those parts answer as they always
  //                   did.
  // THE KERB BUFFER (ROAD_CLASS_MAJOR_BUFFER, off entry.roadClass) is the
  // mask's KERB reason. inMajorBuffer / onMajorBand stay for the MOVEMENT
  // rules (where a chase may go), which are not spawns.
  function inMajorBuffer(roadClass, w, cx, cy) {
    return !!(roadClass && (roadClass[cy * w + cx] & ROAD_CLASS_MAJOR_BUFFER));
  }
  function onMajorBand(roadClass, w, cx, cy) {
    return !!(roadClass && (roadClass[cy * w + cx] & ROAD_CLASS_MAJOR_BAND));
  }
  // ── THE SPAWN GATE (Sep 2026): entry.spawnWhy + the spawn's CLASS ─────────
  // One per-tile mask (stampSpawnWhySteps, beside roadMask, in the sliced
  // build) records WHY each cell is refused — a Uint16 of reason bits, never
  // a single verdict — and every spawner names what it is seating. Two kinds
  // of reason:
  //   HARD (SPAWN_WHY_HARD) — refuse EVERY class:
  //     TERRAIN       water / building / road tier on the terrain grid
  //     ROAD          the drawn band covers ≥ half the cell (the roadMask,
  //                   ROAD_MASK_MIN_COVER) — nothing narrower: a cell a band
  //                   only licks is not road (road proximity is KERB)
  //     RESTRICTED    hospital, railway, military, garages, building sites
  //     QUIET         quiet land (QUIET_LAND)
  //     KINDERGARTEN  kindergarten grounds
  //     SENSITIVE_SITE a sensitive POI's own point (3×3)
  //     BEHIND_HOUSE  a lot cell whose line to its nearest public way crosses
  //                   a building (somebody's back garden)
  //     PRIVATE       a lot cell no public anchor fronts within
  //                   SPAWN_FRONTAGE (private ways vouch for nobody), or a
  //                   commercial / industrial cell whose nearest POI is not a
  //                   PUBLIC one (COMMERCIAL_POI_KIND — none within
  //                   NEAREST_POI_MAX_M counts as private) — lifted by a POI
  //                   within SPAWN_FRONTAGE (opts.pois: a chest is a public
  //                   place)
  //     FARMLAND      mapped farmland, including its edges and any later paint
  //     GOLF          private golf grounds, including all later overlays
  //     PIER_ACCESS   pier footprint without affirmative public access tags
  //     FARM_INTERIOR orchard / farmland further than FARM_EDGE_CELLS from
  //                   any other ground: nothing grows or stands in a field.
  //                   Orchard edges remain open unless mapped farmland
  //                   underneath them carries the FARMLAND reason.
  //   TYPED SUPPRESSION — refuse only the classes whose row names them:
  //     KERB          a major way's band touches the cell, or its kerb buffer
  //                   — refused ONLY by FAST MOVERS (fastEnemy / fastFauna:
  //                   creature_ai.js creatureSpawnClass, off BRISK_WALK_MPS)
  //     SENSITIVE     round a sensitive POI, real cemetery land, a church on
  //                   cemetery land (churchyardBufferM)
  // (Superseded Sep 2026: the typed HOUSE reason — a 40 m buffer round every
  // house on lot land — and the typed SCHOOL reason — school / college /
  // university grounds, plus the school-hours timing — are both dropped: the
  // owner reviewed the table and decided a house's yard is covered by
  // PRIVATE/BEHIND_HOUSE already and a school field is ordinary public ground.
  // KINDERGARTEN stays hard. Farmland is fully excluded; orchard edges
  // retain their existing access rule.)
  // The spawn's class — isSpawnCell's 7th argument, required of every caller
  // (test/node/spawn_class.test.js sweeps the source) — is a ROW of
  // SPAWN_CLASS_BLOCKS: which typed reasons it refuses (hard ones always).
  //   'minor'     flora, rocks, X marks, crates, scenery, gate posts, boards
  //   'headstone' a churchyard stone (it raises a ghost) — SENSITIVE only,
  //               like most rows: stones stand on the streets round a church
  //   'cave'      a cave entrance ("the ladder") — SENSITIVE only
  //   'fauna'     friendly / wild animals at a walk (cats, dogs, crows, …)
  //   'fastFauna' an animal that out-runs a brisk walk (deer, rabbits, …)
  //   'npc'       villagers — fauna's row (a field's interior is hard for all)
  //   'attractor' hoards, lair points, events (coin bursts), grove shrines
  //   'enemy'     anything hostile seated at a walk: slow foes and guards,
  //               traps, park plants
  //   'fastEnemy' a foe that out-runs a brisk walk — the enemy row + KERB
  //   'reward'    a find the player WALKS TO on purpose (src/scenic.js: a
  //               viewpoint's scope, a vista chest, the tide line) — the
  //               attractor row + KERB: never a reason to step to the kerb
  //               of a major road (the safety rule)
  // A creature's class is never typed at the call site: creature_ai.js
  // creatureSpawnClass(kind) derives fauna / enemy and fast / slow from the
  // kind's own speed data.
  // An unknown / missing class reads as 'minor'.
  // POI chests are the PLACE itself: they sit at their POI point and read
  // only the land (landRefused) — they are the anchor other spawns' frontage
  // reads, never a spawn.
  // What this is NOT: a movement rule. A fast foe's leash at the kerb reads
  // roadClass (inMajorBuffer) because it is about where a chase may GO.
  // Bit values kept stable across the Sep 2026 drop of HOUSE (512), SCHOOL
  // (2048). The former FARM bit now blocks all mapped FARMLAND.
  const SPAWN_WHY = {
    TERRAIN: 1, ROAD: 2, RESTRICTED: 4, QUIET: 8, KINDERGARTEN: 16,
    SENSITIVE_SITE: 32, BEHIND_HOUSE: 64, PRIVATE: 128, FARM_INTERIOR: 256,
    KERB: 1024, SENSITIVE: 4096, FARMLAND: 8192, GOLF: 16384, PIER_ACCESS: 32768,
  };
  const W_ = SPAWN_WHY;
  const SPAWN_WHY_HARD = W_.TERRAIN | W_.ROAD | W_.RESTRICTED | W_.QUIET | W_.KINDERGARTEN
    | W_.SENSITIVE_SITE | W_.BEHIND_HOUSE | W_.PRIVATE | W_.FARM_INTERIOR | W_.FARMLAND | W_.GOLF | W_.PIER_ACCESS;
  const SPAWN_WHY_TYPED = W_.KERB | W_.SENSITIVE;
  // The hard reasons that are about the LAND (not terrain, not the band).
  const SPAWN_WHY_LAND = SPAWN_WHY_HARD & ~(W_.TERRAIN | W_.ROAD);
  // THE ONE TABLE: what each spawn class refuses beyond the hard reasons.
  const SPAWN_CLASS_BLOCKS = {
    minor: 0,
    headstone: W_.SENSITIVE,
    cave: W_.SENSITIVE,
    fauna: W_.SENSITIVE,
    fastFauna: W_.SENSITIVE | W_.KERB,
    npc: W_.SENSITIVE,
    attractor: W_.SENSITIVE,
    enemy: W_.SENSITIVE,
    fastEnemy: W_.SENSITIVE | W_.KERB,
    reward: W_.SENSITIVE | W_.KERB,
    streetObstacle: 0, // declared static cross-sections only; default gate stays hard
  };
  const SPAWN_CLASSES = Object.keys(SPAWN_CLASS_BLOCKS);
  function spawnBlocks(cls) {
    const b = SPAWN_CLASS_BLOCKS[cls];
    return b == null ? 0 : b;
  }
  // The derived VERDICT of a cell (the overlays' and measurements'
  // convenience — never what a spawner reads): INVALID for any hard reason,
  // SUPPRESSED for any typed one, else OPEN.
  const SPAWN_OPEN = 0, SPAWN_SUPPRESSED = 1, SPAWN_INVALID = 2;
  function spawnClassOf(v) {
    return (v & SPAWN_WHY_HARD) ? SPAWN_INVALID : (v & SPAWN_WHY_TYPED) ? SPAWN_SUPPRESSED : SPAWN_OPEN;
  }
  // Does the mask refuse cell `i` for a reason of the LAND — restricted,
  // quiet, kindergarten, sensitive site, behind a house, a field's interior,
  // no frontage (lifted by a POI in `pois`) — rather than of its terrain
  // (water, building) or the road band? For the passes that have their own
  // terrain rule and seat on a road on purpose (a POI chest, a well that
  // repaints the cobble, a gate on its way).
  function landRefused(mask, i, pois, cx, cy) {
    if (!mask) return false;
    const v = mask[i];
    if (v & SPAWN_WHY_LAND & ~W_.PRIVATE) return true;
    return !!(v & W_.PRIVATE) && !poiWithin(pois, cx, cy, SPAWN_FRONTAGE);
  }
  function poiWithin(pois, cx, cy, r) {
    if (!pois) return false;
    for (let i = 0; i < pois.length; i++) {
      if (Math.max(Math.abs(pois[i].ix - cx), Math.abs(pois[i].iy - cy)) <= r) return true;
    }
    return false;
  }
  function isSpawnCell(grid, w, h, cx, cy, opts, cls) {
    if (cx < 0 || cy < 0 || cx >= w || cy >= h) return false;
    const here = grid[cy * w + cx];
    if (here === T.FARMLAND || here === T.GOLF) return false;
    if (here === T.PIER && !(opts && opts.spawnWhy)) return false;
    // Only authored thorny/barricade/snare cross-sections may occupy their own
    // road band. Declared seats never relax any other spawn class.
    const obstacle = cls === 'streetObstacle' && opts?.streetObstacleCells?.has(cy * w + cx);
    const barricade = obstacle && opts.streetObstacleKind === 'barricade';
    const obstacleRoad = obstacle && (here === T.ROAD || (barricade && isRoadTerrain(here)));
    if (obstacle && (isLotTerrain(here) || (!barricade && (onMajorBand(opts.roadClass, w, cx, cy)
        || inMajorBuffer(opts.roadClass, w, cx, cy))))) return false;
    // Terrain and band are read LIVE as well as through the mask: a live grid
    // (the starter pond, a dug wall) can differ from the one the mask was
    // stamped over.
    // Reef scenery and shore-reachable finds explicitly require actual water;
    // all other callers keep the ordinary walkable-terrain gate.
    const waterOnly = !!(opts && opts.waterOnly);
    if (waterOnly ? here !== T.WATER : !isWalkable(here) && !obstacleRoad) return false;
    // ALLOWLISTED raw roadMask read (spawn_gate_sweep.test.js): this IS THE
    // GATE — every other spawner's roadMask question resolves here.
    const roadMask = opts && opts.roadMask;
    if (roadMask && roadMask[cy * w + cx] && !obstacle) return false;   // under a drawn road band
    const occupied = opts && opts.occupied;
    if (occupied && occupied.has(cy * w + cx)) return false;   // already holds an object/wild plant
    const mask = opts && opts.spawnWhy;
    if (mask) {
      const v = mask[cy * w + cx] & ~((waterOnly || obstacleRoad ? W_.TERRAIN : 0) | (obstacle ? W_.ROAD : 0) | (barricade ? W_.KERB : 0));
      if (obstacle && (v & (W_.PRIVATE | W_.KERB))) return false;
      if (v & (SPAWN_WHY_HARD & ~W_.PRIVATE)) return false;
      if (v & spawnBlocks(cls)) return false;
      if (!(v & W_.PRIVATE)) return true;
      return poiWithin(opts.pois, cx, cy, SPAWN_FRONTAGE);
    }
    // ── No mask (a synthetic grid, a caller outside a built tile): the same
    // rules read from their parts — quiet land, the lot frontage and, for a
    // class that refuses KERB, the kerb buffer.
    const quiet = opts && opts.quiet;
    if (quiet && quiet[cy * w + cx]) return false;         // quiet land (QUIET_LAND)
    if ((spawnBlocks(cls) & W_.KERB) && inMajorBuffer(opts && opts.roadClass, w, cx, cy)) return false;
    if (!isLotTerrain(here)) return true;         // public / open ground — always ok
    const frontage = (opts && opts.frontage != null) ? opts.frontage : SPAWN_FRONTAGE;
    for (let dy = -frontage; dy <= frontage; dy++) {
      for (let dx = -frontage; dx <= frontage; dx++) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        if (PUBLIC_NEAR.has(grid[ny * w + nx])) return true;
      }
    }
    return poiWithin(opts && opts.pois, cx, cy, frontage);
  }
  // ── GATES and NOTICE BOARDS (POI_GATE_CLASS / POI_INFO_CLASS) ───────────
  // Where a gate's two POSTS stand: either side of the gate's own cell, along
  // the FENCE — i.e. across the way that runs through the gate. The cheap
  // read of the way: if the cells left/right of the gate are road or path
  // (terrain or the drawn band) and the ones above/below are not, the way
  // runs east-west, so the posts stand north and south of it; otherwise east
  // and west first. `free(ix, iy)` is the caller's seat test (the shared
  // spawn rule plus its own occupancy). Returns [{ix,iy},{ix,iy}] or null —
  // a gate with nowhere for both posts is dropped: posts are what mark the
  // danger, and a spawn point nobody can see is a trap the game did not mean.
  const GATE_POST_OFFSETS = { ew: [[-1, 0], [1, 0]], ns: [[0, -1], [0, 1]] };
  function gatePostsAt(grid, N, roadMask, ix, iy, free) {
    // ALLOWLISTED raw roadMask read (spawn_gate_sweep.test.js): GEOMETRY, not
    // the gate — `way` only asks which direction the fence runs, so the posts
    // land along it. Whether a post's cell may actually be SEATED is `free`,
    // the caller's own isSpawnCell test (placeGatesAndBoards, below).
    const way = (x, y) => x >= 0 && y >= 0 && x < N && y < N
      && (isCobbleTerrain(grid[y * N + x]) || (roadMask && roadMask[y * N + x] === 1));
    const wayEW = way(ix - 1, iy) || way(ix + 1, iy);
    const wayNS = way(ix, iy - 1) || way(ix, iy + 1);
    const order = (wayEW && !wayNS) ? ['ns', 'ew'] : ['ew', 'ns'];
    for (const k of order) {
      const cells = GATE_POST_OFFSETS[k].map(([dx, dy]) => ({ ix: ix + dx, iy: iy + dy }));
      if (cells.every((c) => free(c.ix, c.iy))) return cells;
    }
    return null;
  }
  // Emit the gate posts and notice boards for a tile's gate / information
  // points (tile-local cells), pushing onto `objects`. ctx: { grid, N,
  // roadMask, quiet (the quiet-land mask, optional), tx, ty, centre(ix, iy) → {x,y} frame metres, taken? (Set of
  // "ix_iy" already occupied) }. The seat rule is the shared isSpawnCell
  // with the gate / board itself as the public anchor for the frontage rule
  // (it IS a public place) — O(1) per cell, however many POIs the tile has.
  // Ids and seats come from the TILE + CELL (CLAUDE.md, the world frame):
  //   a post   `gatepost_<tx>_<ty>_<ix>_<iy>`, carrying gateSid
  //            `gate_<tx>_<ty>_<gix>_<giy>` and the gate's point (gateX/Y) —
  //            what spawnInTile hands lairs.js as the 'gate' lair;
  //   a board  `info_<tx>_<ty>_<ix>_<iy>` on the nearest spawn cell.
  function placeGatesAndBoards(objects, gatePoints, infoPoints, ctx) {
    const { grid, N, roadMask, quiet, spawnWhy, tx, ty, centre } = ctx;
    const taken = ctx.taken || new Set();
    const inTile = (p) => p.ix >= 0 && p.iy >= 0 && p.ix < N && p.iy < N;
    const claim = (ix, iy) => taken.add(ix + '_' + iy);
    for (const g of gatePoints || []) {
      if (!inTile(g)) continue;
      // A gate on quiet land (a base's gate, a level crossing's) is no
      // spawn point: its foe would stand where nothing may (QUIET_LAND).
      if (quiet && quiet[g.iy * N + g.ix]) continue;
      // …nor one on land the spawn gate refuses (kindergarten grounds, a
      // yard behind a house): the mask's reading of the same question.
      if (landRefused(spawnWhy, g.iy * N + g.ix, null, g.ix, g.iy)) continue;
      const opts = { roadMask, quiet, spawnWhy, pois: [g] };
      // The posts are scenery (a minor spawn); the gate's daily FOE is a lair
      // point spawnInTile holds to the attractor rule.
      const free = (ix, iy) => !taken.has(ix + '_' + iy) && !(ix === g.ix && iy === g.iy)
        && isSpawnCell(grid, N, N, ix, iy, opts, 'minor');
      const posts = gatePostsAt(grid, N, roadMask, g.ix, g.iy, free);
      if (!posts) continue;
      const gp = centre(g.ix, g.iy);
      const gateSid = cellId('gate', tx, ty, g.ix, g.iy);
      for (const c of posts) {
        claim(c.ix, c.iy);
        const at = centre(c.ix, c.iy);
        objects.push(makeObject('gatepost', at.x, at.y, cellId('gatepost', tx, ty, c.ix, c.iy),
          { gateSid, gateX: gp.x, gateY: gp.y }));
      }
      // The spawn point itself stays clear: nothing else is seated on it.
      claim(g.ix, g.iy);
    }
    for (const b of infoPoints || []) {
      if (!inTile(b)) continue;
      const opts = { roadMask, quiet, spawnWhy, pois: [b],
        occupied: { has: (i) => taken.has((i % N) + '_' + Math.floor(i / N)) } };
      const at = relocateToSpawnCell(grid, N, N, b.ix, b.iy, opts, null, 'minor');
      if (!at) continue;
      claim(at.ix, at.iy);
      const c = centre(at.ix, at.iy);
      objects.push(makeObject('infoboard', c.x, c.y, cellId('info', tx, ty, at.ix, at.iy)));
    }
  }
  // ── POI DENSITY: how many chests of each class a tile holds ─────────────
  // The one count loot.js reads for a crate's restock days
  // (crateRestoreDays) and a pot of gold's burst (potCoinsFor) — never the
  // tier, which is the quota seat (seedChestTiers below) — stamped on each
  // POI chest as
  // `poiDensity`. Surface POI chests only (a starter crate, a fixed-loot chest
  // and a cave copy are not counted; a cave copy carries its surface chest's
  // count — caveChestsFrom). A tile counts ITS OWN chests: a POI belongs to
  // the tile whose square holds its point (ownsPoint), so a seam never counts
  // one chest twice, and a class spread over two tiles is two counts — the
  // tile is the unit, like the lair budget. rasterizeTileSteps stamps the
  // generated chests; loadTile restamps once the Overpass bin has injected
  // its own (a settled tile — bin included — counts the same for every
  // player; a build before the bin lands is the same transient the bin's own
  // chests are). A changed count drops the chest's memoised look.
  function isDensityChest(o) {
    return !!o && o.kind === 'chest' && !!o.poiClass && !o.crate && !o.fixedLoot && !o.chestTopUp && !(o.depth > 0) && !o.caveOf;
  }
  function poiDensityCounts(objects) {
    const counts = new Map();
    for (const o of objects || []) {
      if (!isDensityChest(o)) continue;
      counts.set(o.poiClass, (counts.get(o.poiClass) || 0) + 1);
    }
    return counts;
  }
  function stampPoiDensity(objects) {
    const counts = poiDensityCounts(objects);
    for (const o of objects || []) {
      if (!isDensityChest(o)) continue;
      const n = counts.get(o.poiClass);
      if (o.poiDensity !== n) { o.poiDensity = n; delete o._chestLook; }
    }
    return counts;
  }
  // ── Tier seeds: the per-tile quota pyramid (Oct 2026) ─────────────────────
  // The count-threshold ladder is replaced by QUOTAS. Each tile seeds about
  // 1 T5, 7 T4, 15 T3 and 25 T2 among its budgeted POI chests — every other
  // chest stays T1 — scaling x1..x2 as the budgeted count runs 100..1000, so
  // a dense downtown holds up to 2/14/30/50 promoted chests where a suburb
  // holds the base pyramid. Seats go to the BEST POIs first: the MVT rank
  // tag (every tile POI carries one; lower = more notable), then id as the
  // deterministic tiebreak. Within a tier the seats round-robin across chest
  // CATEGORIES (chestThemeForPoi), each category spending its own best-ranked
  // first, so no single class can own a tier. Vista chests stand outside the
  // budget entirely (a grail keeps its Scenic tier). A NEXUS chest can WIN a
  // tier but never CONSUMES a seat — its +1 lands on top of the seed — and
  // neither vista nor nexus chests count toward the density scaling. A sparse
  // tile fills from the TOP and leaves the lower quotas empty: higher tiers
  // matter more than completeness. Runs at the end of the rasterize steps
  // (zones and scenic stamped already) and again when a settled tile restamps
  // (loadTile after bin injection).
  const TIER_SEED_QUOTA = { 5: 1, 4: 7, 3: 15, 2: 25 };
  const TIER_SEED_DENSE_AT = 100, TIER_SEED_DENSE_MAX_AT = 1000;
  function seedChestTiers(objects, opts = {}) {
    // Underground, the pool is the CAVE MIRRORS (isDensityChest excludes
    // them by design): each level of a tile runs its own pyramid over its
    // own mirrors, the depth bonus adding on top of the seed (loot.js
    // chestTier) so deeper levels concentrate the high tiers.
    const cave = !!(opts && opts.cave);
    const inPool = cave
      ? (o) => o.kind === 'chest' && !!o.poiClass && !o.crate && !o.fixedLoot && o.depth > 0
      : (o) => isDensityChest(o) && !o.vista;
    const pool = [];
    for (const o of objects || []) {
      if (!inPool(o)) continue;
      if (o.tierSeed !== 1) { o.tierSeed = 1; delete o._chestLook; }
      pool.push(o);
    }
    const budgetN = pool.reduce((a, o) => a + (o.zoneNexus ? 0 : 1), 0);
    const m = 1 + Math.max(0, Math.min(1, (budgetN - TIER_SEED_DENSE_AT) / (TIER_SEED_DENSE_MAX_AT - TIER_SEED_DENSE_AT)));
    const byCat = new Map();
    for (const o of pool) {
      const cat = (typeof chestThemeForPoi === 'function') ? chestThemeForPoi(o.poiClass) : o.poiClass;
      if (!byCat.has(cat)) byCat.set(cat, []);
      byCat.get(cat).push(o);
    }
    for (const list of byCat.values())
      list.sort((a, b) => ((a.rank ?? 999) - (b.rank ?? 999)) || String(a.id).localeCompare(String(b.id)));
    const cats = [...byCat.keys()].sort();
    for (const tier of [5, 4, 3, 2]) {
      let seats = Math.round(TIER_SEED_QUOTA[tier] * m);
      while (seats > 0) {
        let gave = false;
        for (const cat of cats) {
          const list = byCat.get(cat);
          if (!list || !list.length) continue;
          const o = list.shift();
          o.tierSeed = tier; delete o._chestLook;
          if (!o.zoneNexus) seats--;   // a nexus takes a tier, never a seat
          gave = true;
          if (seats <= 0) break;
        }
        if (!gave) break;   // sparse tile: lower quotas stay empty
      }
    }
    return budgetN;
  }
  // Low-tier supplies fill existing variant footprints after the POI pyramid.
  // Both tiers must be scarce. These surface-only additions keep their seed
  // on later density/restamp passes and never spend a higher-tier quota seat.
  const CHEST_TOP_UP_MIN = { 1: 25, 2: 10 };
  function* topUpChestsSteps({ objects, dressings = [], zone, streetDress, grid, N, tx, ty, tileEdgeM, spawnOpts }) {
    const counts = { 1: 0, 2: 0 };
    for (const list of [objects, ...dressings.map(d => d?.objects || [])]) {
      for (let j = 0; j < list.length; j++) {
        if ((j & 255) === 0) yield 'chest top-up census';
        const o = list[j];
        if (o.kind !== 'chest' || o.crate || o.fixedLoot || o.depth > 0 || o.caveOf) continue;
        const look = chestLook(o);
        if (look.stand || look.coin || look.bike || look.barrel || look.macro) continue;
        const tier = chestTier(o);
        if (tier in counts) counts[tier]++;
      }
    }
    const result = { before: { ...counts }, added: { 1: 0, 2: 0 }, shortfall: { 1: 0, 2: 0 } };
    if (Object.keys(counts).some(t => counts[t] >= CHEST_TOP_UP_MIN[t])) return result;
    const need = Object.fromEntries(Object.keys(counts).map(t => [t, CHEST_TOP_UP_MIN[t] - counts[t]]));
    const capacity = need[1] + need[2], seats = [];
    const coverage = zone && (zone.coverage || zone.idx), marks = streetDress?.marks;
    const variants = (zone?.anchors || []).map(a => ZoneVariants.pick(a));
    // Keep only the best few hashes, bounding memory and sort work even on
    // very large footprints. Salt is exclusive to this spawner.
    for (let i = 0; i < N * N; i++) {
      if ((i & 255) === 0) yield 'chest top-up seats';
      const ai = (coverage?.[i] || 0) - 1, anchor = zone?.anchors?.[ai];
      const street = !anchor && marks?.[i] ? StreetVariants.variantByCode(marks[i]) : null;
      if (!anchor && !street) continue;
      const ix = i % N, iy = Math.floor(i / N);
      if (!isSpawnCell(grid, N, N, ix, iy, spawnOpts, 'reward')) continue;
      const score = cellHash(tx, ty, ix, iy) ^ 0x61c8a37;
      let at = seats.findIndex(s => score < s.score || (score === s.score && i < s.i));
      if (at < 0) at = seats.length;
      if (at >= capacity) continue;
      seats.splice(at, 0, { i, ix, iy, score, anchor, variant: variants[ai], street });
      if (seats.length > capacity) seats.pop();
    }
    // Alternate tiers when space is scarce instead of starving T2 entirely.
    let tier = 1;
    for (const seat of seats) {
      if (!need[tier]) tier = tier === 1 ? 2 : 1;
      const { i, ix, iy, anchor, variant, street } = seat;
      objects.push(makeObject('chest', (tx + (ix + 0.5) / N) * tileEdgeM,
        (ty + (iy + 0.5) / N) * tileEdgeM, cellId('chest_topup', tx, ty, ix, iy), {
          poiClass: 'shelter', tierSeed: tier, chestTopUp: true,
          ...(anchor ? { zoneKind: anchor.kind, zoneVariant: variant.id, zoneLayer: 'find' } : { _street: street.id }),
        }));
      spawnOpts.occupied.add(i);
      need[tier]--; result.added[tier]++;
      tier = tier === 1 ? 2 : 1;
    }
    result.shortfall = need;
    return result;
  }
  // Nudge a cell onto the nearest one that passes isSpawnCell, searching
  // outward in Chebyshev rings up to `maxR`. Returns null when the whole
  // neighbourhood is unusable, so the caller can drop the item instead.
  //
  // For anchors that come straight from OSM geometry rather than from a scan
  // of the grid — the buried-X on a parking lot is the whole reason this
  // exists: its anchor is the lot polygon's first VERTEX, which is a corner of
  // the lot and so lands on the kerb, the aisle or the street feeding it about
  // as often as it lands on tarmac you can stand on. Dropping those outright
  // would cost the lot its reward, so walk the X into the lot instead.
  // Deterministic: fixed ring order, first hit wins, no rng.
  // The hedge-maze lattice decision — one owner for the commercial plaza's
  // clipped maze (spawnHedgeMazeSteps) and the sandbox's flora mirror, which
  // reads it through the export so the two never tune apart. Deterministic on
  // ABSOLUTE cell coords (continuous across polygons + tiles), on a
  // period-HEDGE_LATTICE_P lattice:
  //   pillars    (ax%P==0 && ay%P==0)             always a hedge cell
  //   wall cells (one coord %P==0, the other not) a hedge IFF that segment
  //                                              "exists" (a stable coin per
  //                                              segment; both cells of a
  //                                              2-cell wall share the id)
  //   interior   (neither coord %P==0)            never a hedge (open path)
  // Pillars and sparse whole wall segments leave broad open passages.
  const HEDGE_LATTICE_P = 3;   // lattice period (cells between pillars)
  const HEDGE_WALL_PCT = 15;   // whole wall segments, with open plaza aisles
  function hedgeWallOn(sx, sy, k, salt) {
    const hsh = (((sx * 73856093) ^ (sy * 19349663) ^ (k * 83492791) ^ salt) >>> 0);
    return (hsh % 100) < HEDGE_WALL_PCT;
  }
  // Regular clay pots replace one in four pillar bushes; the intervening
  // hedge walls and every open passage keep the maze's existing shape.
  function hedgeMazePotCell(ax, ay) {
    const period = HEDGE_LATTICE_P * 2;
    return ax % period === 0 && ay % period === 0;
  }
  function hedgeMazeCell(ax, ay, salt) {
    const P = HEDGE_LATTICE_P;
    const mx3 = ((ax % P) + P) % P;
    const my3 = ((ay % P) + P) % P;
    if (mx3 === 0 && my3 === 0) return true;                                    // pillar
    if (my3 === 0 && mx3 !== 0) return hedgeWallOn(Math.floor(ax / P), ay, 0, salt); // horizontal wall
    if (mx3 === 0 && my3 !== 0) return hedgeWallOn(ax, Math.floor(ay / P), 1, salt); // vertical wall
    return false;                                                               // open interior
  }
  // ── Walking the cells round a point ─────────────────────────────────────
  // THE ONE RING SCAN. Every nearest-first search in the game (a chest off a
  // wall, a stair off a stream, the starter crates round the door, a story
  // neighbour round the trailer) walks Chebyshev rings r = rMin..rMax about
  // (cx, cy), each ring's edge in a FIXED order — dy outer, dx inner — so a
  // seeded pick over a ring is reproducible. `visit(x, y, r)` returns a
  // truthy value to stop; that value is the result, else null.
  function ringCells(cx, cy, rMin, rMax, visit) {
    for (let r = rMin; r <= rMax; r++) {
      if (r === 0) { const v = visit(cx, cy, 0); if (v) return v; continue; }
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;   // ring edge only
          const v = visit(cx + dx, cy + dy, r);
          if (v) return v;
        }
      }
    }
    return null;
  }
  // The nearest cell (same order) that `ok(x, y)` accepts: { ix, iy } or null.
  function nearestRingCell(cx, cy, rMin, rMax, ok) {
    return ringCells(cx, cy, rMin, rMax, (x, y) => (ok(x, y) ? { ix: x, iy: y } : null));
  }
  // The eight compass neighbours one cell out, N first then clockwise — the
  // order a shrine or a scope takes the first free seat round its chest.
  const RING_ORDER = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
  // Every offset within a disc of radius R (Euclidean, d² ≤ R²), nearest
  // first (ties row-major) — the seat-back searches (a foe behind the kerb, a
  // scope beside a vista) walk it. Built once per R: the order is a constant.
  const _discOffsets = new Map();
  function discOffsets(R) {
    let out = _discOffsets.get(R);
    if (out) return out;
    out = [];
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const d2 = dx * dx + dy * dy;
        if (d2 <= R * R) out.push({ dx, dy, d2 });
      }
    }
    out.sort((a, b) => a.d2 - b.d2 || a.dy - b.dy || a.dx - b.dx);
    _discOffsets.set(R, out);
    return out;
  }
  // The cells of the box of radius `r` round (cx, cy), clipped to the w × h
  // grid, y outer then x: `visit(x, y, i)` returns truthy to stop (the
  // result); every "is there a road within two cells" question is this.
  function boxCells(w, h, cx, cy, r, visit) {
    for (let y = Math.max(0, cy - r); y <= Math.min(h - 1, cy + r); y++) {
      for (let x = Math.max(0, cx - r); x <= Math.min(w - 1, cx + r); x++) {
        const v = visit(x, y, y * w + x);
        if (v) return v;
      }
    }
    return null;
  }
  // The eight neighbours of (cx, cy) inside the grid (the cell itself left
  // out): does any pass `test(x, y, i)`, and how many do.
  function anyNeighbour8(w, h, cx, cy, test) {
    return !!boxCells(w, h, cx, cy, 1, (x, y, i) => (x !== cx || y !== cy) && test(x, y, i));
  }
  function countNeighbours8(w, h, cx, cy, test) {
    let n = 0;
    boxCells(w, h, cx, cy, 1, (x, y, i) => { if ((x !== cx || y !== cy) && test(x, y, i)) n++; });
    return n;
  }
  // `cls` is the spawn's class (isSpawnCell's — 'minor' / 'attractor' /
  // 'enemy'), required like isSpawnCell's.
  function relocateToSpawnCell(grid, w, h, cx, cy, opts, maxR, cls) {
    return nearestRingCell(cx, cy, 0, maxR == null ? 4 : maxR,
      (x, y) => isSpawnCell(grid, w, h, x, y, opts, cls));
  }
  // Tier picker: chooses BUILDING / BUILDING_MED / BUILDING_LARGE from polygon area + render_height.
  // Thresholds tuned to put single-family homes in the small bucket, shops in MED,
  // schools/malls/civic in LARGE.
  function buildingTier(areaM2, renderHeight) {
    const h = +renderHeight || 0;
    if (areaM2 >= 1500 || h >= 15) return T.BUILDING_LARGE;
    if (areaM2 >= 350  || h >= 10) return T.BUILDING_MED;
    return T.BUILDING;
  }

  // Per-tile distribution floors — the tuning knobs for how a tile's buildings
  // split across the three tiers. Each is a FRACTION of the buildings that
  // actually landed cells on the tile, always rounded UP to at least one, so no
  // tile with buildings lacks a castle/fort/house. Raise TIER_FLOOR_SMALL to
  // make tiles more residential, TIER_FLOOR_LARGE/MED to make them more civic.
  //
  // TIER_FLOOR_SMALL is 0.50 per user: at least HALF the buildings on any tile
  // read as ordinary houses, so a loaded tile is a neighbourhood rather than a
  // row of civic slabs. (It was 0.20, which on tiles whose polygons all cleared
  // buildingTier's area thresholds left houses in a small minority.)
  const TIER_FLOOR_LARGE = 0.02;   // castles  (BUILDING_LARGE — cement pad, no sprite)
  const TIER_FLOOR_MED   = 0.08;   // forts    (BUILDING_MED)
  const TIER_FLOOR_SMALL = 0.50;   // houses   (BUILDING)

  // Enforce those floors. If buildingTier's defaults don't hit them on this
  // tile's actual area distribution, promote/demote by area-rank until they do
  // — biggest buildings get the biggest tier. n < 3 skips (can't host one of
  // each type with fewer than three buildings).
  //
  // The three forced bands are taken from the top (large), then the next (med),
  // then the BOTTOM needSmall by area, and the branch chain gives LARGE and MED
  // precedence where they'd overlap. With these floors that can only happen at
  // n === 3 (1 + 1 + 2 > 3), where the tile comes out one of each and the house
  // floor goes unmet — the castle/fort guarantees win on a 3-building tile.
  // Every n >= 4 satisfies all three floors.
  //
  // TIER_FLOOR_LARGE is also a CEILING, and that half is load-bearing: a castle
  // is the one tier that paints its footprint and draws NO sprite (see the
  // BUILDING_LARGE skip in the emission loop below), so every castle beyond the
  // few this tile is meant to have is a block of bare building floor with
  // nothing standing on it. The floors alone couldn't hold that line, because
  // buildings OUTSIDE the forced bands keep whatever buildingTier gave them —
  // and it gives LARGE to anything over 1500 m² OR taller than 15 m. On a tile
  // where that describes most of the buildings (a downtown, a row of apartment
  // towers, an industrial estate) the middle band stayed castles wholesale:
  // measured at 40% of the tile's footprints left empty, against a 2% floor.
  // So only the biggest `needLarge` may be castles; any other building that
  // would default to one becomes a fort, which draws a roof sized to its
  // footprint. Applied BEFORE the early-out below so it holds even on a tile
  // whose floors are already satisfied.
  // Mutates each entry's `.tier`.
  function enforceBuildingDistribution(polys) {
    const n = polys.length;
    if (n < 3) return;
    const needLarge = Math.max(1, Math.ceil(n * TIER_FLOOR_LARGE));
    const needMed   = Math.max(1, Math.ceil(n * TIER_FLOOR_MED));
    const needSmall = Math.max(1, Math.ceil(n * TIER_FLOOR_SMALL));
    const byArea = [...polys].sort((a, b) => b.areaM2 - a.areaM2);
    // Castle CEILING — see above. Demote to fort, not to house: these are the
    // tile's big footprints, and a small house roof adrift on one reads as
    // wrong as no roof at all.
    for (let i = needLarge; i < byArea.length; i++) {
      if (byArea[i].tier === T.BUILDING_LARGE) byArea[i].tier = T.BUILDING_MED;
    }
    // Count what the ceiling left behind.
    let cLarge = 0, cMed = 0, cSmall = 0;
    for (const p of polys) {
      if (p.tier === T.BUILDING_LARGE) cLarge++;
      else if (p.tier === T.BUILDING_MED) cMed++;
      else cSmall++;
    }
    if (cLarge >= needLarge && cMed >= needMed && cSmall >= needSmall) return;
    // FORCE the top / bottom bands. Buildings outside them keep the tier they
    // now hold — which, after the ceiling, is never a castle.
    for (let i = 0; i < byArea.length; i++) {
      if (i < needLarge) byArea[i].tier = T.BUILDING_LARGE;
      else if (i < needLarge + needMed) byArea[i].tier = T.BUILDING_MED;
      else if (i >= byArea.length - needSmall) byArea[i].tier = T.BUILDING;
    }
  }

  // --- Mercator helpers ---
  function lonLatToWorldPx(lon, lat, z) {
    const n = (1 << z) * TILE_PX;
    const x = (lon + 180) / 360 * n;
    const sin = Math.sin(lat * Math.PI / 180);
    const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * n;
    return { x, y };
  }
  function metersPerPixel(lat, z) {
    return 156543.03392 * Math.cos(lat * Math.PI / 180) / (1 << z);
  }

  // --- Feature classification ---
  function classifyPolygon(layer, tags) {
    if (layer === 'water') return T.WATER;
    if (layer === 'landcover') {
      const c = tags.class;
      const sub = tags.subclass;
      if (c === 'wood' || c === 'forest') return T.FOREST;
      if (c === 'sand' || c === 'beach') return T.SAND;
      if (c === 'rock' || c === 'scree') return T.ROCK;
      if (c === 'wetland') return T.WETLAND;
      if (c === 'golf_course') return T.GOLF;
      if (c === 'farmland') return sub === 'orchard' ? T.ORCHARD : T.FARMLAND;
      if (c === 'grass') {
        if (sub === 'park' || sub === 'garden') return T.PARK;
        if (sub === 'golf_course') return T.GOLF;
        if (sub === 'allotments') return T.FARMLAND;   // community gardens
        return T.GRASS;
      }
      if (c === 'meadow') return T.GRASS;
      return T.GRASS;
    }
    if (layer === 'landuse') {
      const c = tags.class;
      // A neighbourhood / quarter outline is a built-up district, not a vacant
      // lot: reading it as wasteland painted half a Berlin block as scrub.
      if (c === 'residential' || c === 'neighbourhood' || c === 'quarter') return T.RESIDENTIAL;
      if (c === 'commercial' || c === 'retail' || c === 'hospital') return T.COMMERCIAL;
      if (c === 'industrial') return T.INDUSTRIAL;
      if (c === 'school' || c === 'college' || c === 'university' ||
          c === 'kindergarten' || c === 'education') return T.SCHOOL;
      if (c === 'farmland' || c === 'farmyard') return T.FARMLAND;
      if (c === 'golf_course') return T.GOLF;
      if (c === 'pitch') return T.PITCH;
      if (c === 'playground') return T.PLAYGROUND;
      // Recreation / sports grounds (leisure=sports_centre, stadium,
      // recreation_ground, track, …). Without these they fell through to the
      // RESIDENTIAL default below, so a rec centre's grounds read as a plain
      // brown housing block. Paint them as a sports field; the indoor facility
      // building itself is synthesized from the matching POI (see POI_CIVIC_BUILDING).
      if (c === 'stadium' || c === 'sports_centre' || c === 'sports' ||
          c === 'recreation_ground' || c === 'track') return T.PITCH;
      if (c === 'dog_park') return T.PARK;
      if (c === 'cemetery' || c === 'park' || c === 'garden') return T.PARK;
      // Military ground and railway land keep the scrub look, as explicit
      // rows rather than the catch-all below — because they are QUIET LAND
      // (QUIET_LAND, stamped into entry.quietMask): nothing spawns on them,
      // so nothing lures a player over a base's fence or onto the tracks.
      // What paints them is not what keeps them empty; the mask does that.
      if (c === 'military' || c === 'railway') return T.WASTELAND;
      // Anything else is land nobody here has a name for — brownfield,
      // garages, yards. It plays as residential land (isLotTerrain) but
      // looks like the scrub it is. See T.WASTELAND.
      return T.WASTELAND;
    }
    if (layer === 'park') return PARK_FAMILY_LAYER_CLASS.has(tags.class) ? T.PARK : null;
    if (layer === 'building') return T.BUILDING;
    return null;
  }
  // The big ways — motorway / trunk / primary, exactly the ROAD_LG tier — are
  // drawn half again as wide as their measured carriageway so the trunk
  // network stays legible at map scale. See road_overlay.js. Declared here
  // (ahead of classifyLine) so both the classifier and the width scaling
  // below share this one Set.
  const LARGE_ROAD_CLASSES = new Set(['motorway', 'trunk', 'primary']);
  // Walkable, non-vehicle way classes — footways, tracks, steps and the like.
  // THE PAVED SET: the terrain codes a way rasterizes to (footpath plus the
  // three vehicle-road tiers). Exported: tilling, the pavement erosion and
  // the spawn filters ask the GRID whether a cell is paved. (Restoration is
  // not per cell — src/streets.js measures it along the way's own geometry.)
  const COBBLE_TYPES = new Set([T.ROAD, T.ROAD_MD, T.ROAD_LG, T.PATH]);
  const isCobbleTerrain = (t) => COBBLE_TYPES.has(t);

  // Shared with road_overlay.js (WorldGen.PATH_CLASSES) so the geometry
  // overlay draws exactly the classes the terrain classifier calls T.PATH.
  const PATH_CLASSES = new Set(['path', 'footway', 'track', 'pedestrian', 'cycleway', 'steps']);
  function classifyLine(layer, tags) {
    if (layer !== 'transportation') return null;
    const c = tags.class || '';
    if (LARGE_ROAD_CLASSES.has(c)) return T.ROAD_LG;
    if (['secondary', 'tertiary'].includes(c)) return T.ROAD_MD;
    if (['minor', 'service', 'street'].includes(c)) return T.ROAD;
    if (PATH_CLASSES.has(c)) return T.PATH;
    // Piers: wooden walkways over water. Painted as T.PIER so render.js can
    // overlay the plank sprite and walkability gates don't lump them in with
    // roads or treat them as water.
    if (c === 'pier') return T.PIER;
    return T.ROAD;
  }
  // A PARKING-LOT LANE IS NOT A ROAD IN THIS GAME. A lot carpets itself in
  // parallel service lines spaced closer than one cell, so painting them
  // would weld the lot into a solid asphalt blob — and a lane is nobody's
  // street to restore, light or name. So a lot lane DOES NOT EXIST: it is
  // cut out of the tile's `transportation` layer (and its name out of
  // `transportation_name`) by pruneLotLanesSteps, the FIRST pass of
  // rasterizeTileSteps, before any reader walks the layer. Every consumer
  // downstream — terrain, roadMask / roadClass, the spawn gate's public-way
  // anchors, the street index and its variants, scenic, road labels, the
  // road overlay band, restoration (app.js _rescanStreets) and lamps (app.js
  // _streetLampsForTile) — reads entry.layers, the SAME pruned object, so
  // there is one lane and one predicate: isLotLane.
  //
  // isLotLane(f, lots, li): line `li` of feature `f` is a lot lane when
  //   • the way is TAGGED `service=parking_aisle` (tags alone decide), or
  //   • it is an UNLABELLED service way (no `service` subtype, or
  //     `service=parking`) the tile's own data places CLEARLY inside a lot —
  //     `lots`, the feature → Set(line index) Map lotLaneSetSteps derives
  //     (see LOT_* below for the measured rule), or a connected comb of
  //     at least three substantial rows along one long access spine.
  //     Judged per LINE, not per
  //     feature: the tiles merge every same-tagged service way of a tile into
  //     one feature of dozens of lines, so a feature-wide share means nothing.
  // Called with tags only (no `lots`) it answers the tagged half, which is
  // all a reader of an already-pruned layer can still meet. Driveways,
  // alleys and every other service way stay ordinary roads.
  function isParkingAisle(tags) {
    return !!(tags && tags.service === 'parking_aisle');
  }
  function isLotLane(f, lots, li) {
    if (!f) return false;
    // Accepts a bare tags object too.
    const tags = (f.tags && typeof f.tags === 'object') ? f.tags : f;
    if (isParkingAisle(tags)) return true;
    const set = lots && f.tags ? lots.get(f) : null;
    return !!(set && set.has(li | 0));
  }
  // THE INFERRED LOT LANE (measured Sep 2026 on the 36-tile Berlin / Kelowna /
  // Seattle / Vancouver set). An unlabelled service way is a lot lane when at
  // least LOT_SHARE of its length lies within
  //   LOT_POI_R_M of a LOT parking POI (poi class `parking` — the point
  //     OpenMapTiles puts at a lot's centroid), or
  //   LOT_AISLE_R_M of a tagged parking aisle (it runs through the same lot).
  // A parking POI within LOT_STREETSIDE_M of a public road's centreline is
  // STREET-SIDE parking (Berlin maps every kerb lane as amenity=parking), not
  // a lot, and vouches for nothing — without that cut, courtyard access ways
  // off a parked-up street were being eaten. Ways longer than LOT_MAX_M are
  // never inferred (a lot lane is short; a long service road that merely
  // passes a lot is a road). A "parallel cluster" rule (≥3 short (<60 m)
  // parallel unlabelled ways <15 m apart) was measured too: after the two
  // rules above it found 5 lines, 54 m, all Berlin courtyard stubs — so
  // short parallel rows alone are not enough. A separate connected-comb
  // rule below requires substantial rows joined to one long access spine.
  // Seam: the decision is per tile, off that tile's own layers — the POI
  // layer is buffered far past the tile, the transportation layer only a few
  // metres, so a way straddling a seam is judged on the same POIs both sides
  // but may be cut differently at its ends. Not load-order dependent.
  const LOT_POI_R_M = 30;
  const LOT_AISLE_R_M = 12;
  const LOT_STREETSIDE_M = 10;
  const LOT_SHARE = 0.5;
  const LOT_MAX_M = 200;
  const LOT_SAMPLE_M = 2;
  function isLotCandidate(tags) {
    if (!tags || tags.class !== 'service') return false;
    return !tags.service || tags.service === 'parking';
  }
  // Point → segment distance in MVT units.
  function _segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    let t = L ? ((px - ax) * dx + (py - ay) * dy) / L : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(ax + t * dx - px, ay + t * dy - py);
  }
  // A bucket grid of segments / points (MVT units), so every query below is
  // O(nearby) — the tile-build rule forbids a scan of everything per sample.
  function _bucketGrid(size) {
    const m = new Map();
    const k = (bx, by) => bx * 73856093 ^ by * 19349663;
    return {
      addBox(item, x0, y0, x1, y1) {
        for (let by = Math.floor(y0 / size); by <= Math.floor(y1 / size); by++)
          for (let bx = Math.floor(x0 / size); bx <= Math.floor(x1 / size); bx++) {
            const key = k(bx, by);
            let a = m.get(key); if (!a) m.set(key, a = []);
            a.push(item);
          }
      },
      near(x, y, r, fn) {
        for (let by = Math.floor((y - r) / size); by <= Math.floor((y + r) / size); by++)
          for (let bx = Math.floor((x - r) / size); bx <= Math.floor((x + r) / size); bx++) {
            const a = m.get(k(bx, by));
            if (a) for (const it of a) if (fn(it)) return true;
          }
        return false;
      },
    };
  }
  // Keep diagnostic evidence beside the transient line-index set. Only the
  // plain per-line arrays copied into parkingLanes survive tile generation.
  function lotLineGroup(kind, members) {
    const lines = members.map(({ f, li }) => {
      const points = f.geom[li].map(p => `${p.x},${p.y}`);
      const forward = points.join(';'), backward = points.reverse().join(';');
      return forward < backward ? forward : backward;
    });
    // Tile-local, geometry-owned identity: no feature id, line index, member
    // iteration order or unrelated access-spine geometry enters the key.
    return `${kind}:${[...new Set(lines)].sort().join('|')}`;
  }
  function markLotLane(out, f, li, reasons, group) {
    let set = out.get(f);
    if (!set) { set = new Set(); set.reasons = new Map(); set.lineGroups = new Map(); out.set(f, set); }
    set.add(li);
    let evidence = set.reasons.get(li);
    if (!evidence) set.reasons.set(li, evidence = new Set());
    for (const reason of reasons) evidence.add(reason);
    if (group) {
      let memberships = set.lineGroups.get(li);
      if (!memberships) set.lineGroups.set(li, memberships = new Set());
      memberships.add(group);
    }
  }
  // A three-lane parking shape can be encoded as one U-shaped way and a
  // separate middle row. Recognise only the exact three-leg hairpin, with a
  // substantial parallel centre row attached to its crossbar and matching
  // the longer outer leg's far extent. The U's total length may exceed the
  // ordinary 200 m inference cap; each of its parking rows is still short.
  function* lotHairpinSteps(cands, mvtToM, out) {
    const endpoints = _bucketGrid(128), hairpins = [];
    const joinR = 2 / mvtToM, cosAngle = Math.cos(8 * Math.PI / 180);
    let count = 0;
    for (const f of cands) for (let li = 0; li < f.geom.length; li++) {
      const line = f.geom[li];
      if (!line || line.length < 2) continue;
      if ((++count & 63) === 0) yield 'lot lanes: hairpin index';
      const a = line[0], b = line[line.length - 1];
      const length = Math.hypot(b.x - a.x, b.y - a.y), metres = length * mvtToM;
      if (metres >= 45 && metres <= 160 && line.every(p => _segDist(p.x, p.y, a.x, a.y, b.x, b.y) <= joinR)) {
        const row = { f, li, a, b };
        for (const p of [a, b]) endpoints.addBox({ row, p }, p.x, p.y, p.x, p.y);
      }
      if (line.length !== 4) continue;
      const [p, q, r, t] = line;
      const l1 = Math.hypot(p.x - q.x, p.y - q.y), l2 = Math.hypot(t.x - r.x, t.y - r.y);
      const width = Math.hypot(r.x - q.x, r.y - q.y);
      if (Math.min(l1, l2) * mvtToM < 45 || Math.max(l1, l2) * mvtToM > 160 || width * mvtToM < 12 || width * mvtToM > 50) continue;
      const ux = (p.x - q.x) / l1, uy = (p.y - q.y) / l1;
      if (ux * (t.x - r.x) / l2 + uy * (t.y - r.y) / l2 < cosAngle) continue;
      if (Math.abs(ux * (r.x - q.x) / width + uy * (r.y - q.y) / width) > Math.sin(8 * Math.PI / 180)) continue;
      hairpins.push({ f, li, q, r, ux, uy, l1, l2, width });
    }
    for (const h of hairpins) {
      yield 'lot lanes: hairpin rows';
      const nearby = new Set();
      // Query along the crossbar, never scan every service way per sample.
      const steps = Math.ceil(h.width / joinR);
      for (let i = 0; i <= steps; i++) {
        const x = h.q.x + (h.r.x - h.q.x) * i / steps, y = h.q.y + (h.r.y - h.q.y) * i / steps;
        endpoints.near(x, y, joinR * 2, hit => { nearby.add(hit.row); return false; });
      }
      for (const row of nearby) {
        if (row.f === h.f && row.li === h.li) continue;
        for (const [a, b] of [[row.a, row.b], [row.b, row.a]]) {
          if (_segDist(a.x, a.y, h.q.x, h.q.y, h.r.x, h.r.y) > joinR) continue;
          const length = Math.hypot(b.x - a.x, b.y - a.y);
          if (((b.x - a.x) * h.ux + (b.y - a.y) * h.uy) / length < cosAngle) continue;
          const across = p => ((p.x - h.q.x) * (h.r.x - h.q.x) + (p.y - h.q.y) * (h.r.y - h.q.y)) / h.width;
          const margin = 6 / mvtToM;
          if ([a, b].some(p => across(p) < margin || across(p) > h.width - margin)) continue;
          const along = p => (p.x - h.q.x) * h.ux + (p.y - h.q.y) * h.uy;
          const lo = along(a), hi = along(b), shorter = Math.min(h.l1, h.l2), longer = Math.max(h.l1, h.l2);
          if (Math.min(hi, shorter) - Math.max(lo, 0) < shorter * 0.8 || Math.abs(hi - longer) * mvtToM > 10) continue;
          const group = lotLineGroup('parking_hairpin', [h, row]);
          for (const item of [h, row]) {
            markLotLane(out, item.f, item.li, ['parking_hairpin'], group);
          }
        }
      }
    }
  }
  // A missing parking POI can leave a clear comb of lot rows behind. Require
  // three substantial, straight, overlapping rows on the SAME side of one
  // long access spine. Short parallel courtyard stubs alone prove nothing.
  // The spine is evidence only; it remains a road, as do explicit driveways.
  function* lotRowCombSteps(cands, mvtToM, out) {
    const rows = [], spines = _bucketGrid(128), groups = new Map();
    const joinR = 2 / mvtToM, cosAngle = Math.cos(8 * Math.PI / 180);
    let serial = 0;
    for (const f of cands) for (let li = 0; li < f.geom.length; li++) {
      const line = f.geom[li];
      if (!line || line.length < 2) continue;
      if ((++serial & 63) === 0) yield 'lot lanes: comb index';
      let length = 0;
      for (let i = 1; i < line.length; i++) length += Math.hypot(line[i].x - line[i - 1].x, line[i].y - line[i - 1].y);
      const metres = length * mvtToM;
      if (metres > 100) {
        const spine = { f, li };
        for (let i = 1; i < line.length; i++) {
          const a = line[i - 1], b = line[i];
          spines.addBox({ spine, a, b }, Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y));
        }
      }
      if (metres < 45 || metres > 100) continue;
      const a = line[0], b = line[line.length - 1], chord = Math.hypot(b.x - a.x, b.y - a.y);
      if (chord < length * 0.98 || line.some(p => _segDist(p.x, p.y, a.x, a.y, b.x, b.y) > joinR)) continue;
      rows.push({ f, li, a, b });
    }
    for (const row of rows) {
      yield 'lot lanes: comb joins';
      const ends = [row.a, row.b].map(p => {
        const hit = new Set();
        spines.near(p.x, p.y, joinR, s => {
          if (_segDist(p.x, p.y, s.a.x, s.a.y, s.b.x, s.b.y) <= joinR) hit.add(s.spine);
          return false;
        });
        return hit;
      });
      for (let end = 0; end < 2; end++) for (const spine of ends[end]) {
        if (ends[1 - end].has(spine)) continue; // a through connector, not a row
        const a = end ? row.b : row.a, b = end ? row.a : row.b;
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        let group = groups.get(spine); if (!group) groups.set(spine, group = []);
        group.push({ ...row, a, b, ux: (b.x - a.x) / length, uy: (b.y - a.y) / length });
      }
    }
    for (const group of groups.values()) {
      if (group.length < 3) continue;
      // Each seed checks one common direction/overlap, preventing a chain of
      // gradually turning or staggered driveways from qualifying as a comb.
      for (const seed of group) {
        yield 'lot lanes: comb rows';
        const along = p => p.x * seed.ux + p.y * seed.uy;
        const lo = along(seed.a), hi = along(seed.b);
        const aligned = group.filter(row => {
          if (row.ux * seed.ux + row.uy * seed.uy < cosAngle) return false;
          const rlo = along(row.a), rhi = along(row.b);
          return Math.min(hi, rhi) - Math.max(lo, rlo) >= 0.8 * Math.max(hi - lo, rhi - rlo);
        }).map(row => ({ row, across: -row.a.x * seed.uy + row.a.y * seed.ux })).sort((a, b) => a.across - b.across);
        let run = [];
        const flush = () => {
          if (run.length >= 3) {
            const group = lotLineGroup('connected_rows', run.map(({ row }) => row));
            for (const { row } of run) markLotLane(out, row.f, row.li, ['connected_rows'], group);
          }
          run = [];
        };
        for (const entry of aligned) {
          const gap = run.length ? (entry.across - run[run.length - 1].across) * mvtToM : 0;
          if (run.length && (gap < 6 || gap > 28)) flush();
          run.push(entry);
        }
        flush();
      }
    }
  }
  // Map: transportation feature → Set of its LINE indices that are inferred
  // lot lanes (tagged aisles are not in it — isLotLane answers those from
  // tags).
  // mvtToM: GENERATION metres per MVT unit (the tile's own, never the frame).
  function* lotLaneSetSteps(layersByName, mvtToM) {
    const out = new Map();
    const tl = layersByName['transportation'];
    if (!tl || !tl.features || !(mvtToM > 0)) return out;
    const cands = [];
    for (const f of tl.features) {
      if (f.type === 2 && f.geom && isLotCandidate(f.tags)) cands.push(f);
    }
    if (!cands.length) return out;
    const poiR = LOT_POI_R_M / mvtToM, aisleR = LOT_AISLE_R_M / mvtToM;
    const sideR = LOT_STREETSIDE_M / mvtToM;
    const B = 128;
    // Public road segments (for the street-side cut) and aisle segments.
    const roads = _bucketGrid(B), aisles = _bucketGrid(B);
    let nAisle = 0, k = 0;
    for (const f of tl.features) {
      if (f.type !== 2 || !f.geom) continue;
      const aisle = isParkingAisle(f.tags);
      const t = classifyLine('transportation', f.tags || {});
      const road = !aisle && (f.tags || {}).class !== 'service' &&
        (t === T.ROAD || t === T.ROAD_MD || t === T.ROAD_LG);
      if (!aisle && !road) continue;
      if ((++k & 63) === 0) yield 'lot lanes: index';
      const g = aisle ? aisles : roads;
      for (const line of f.geom) {
        for (let i = 1; i < line.length; i++) {
          const a = line[i - 1], b = line[i];
          g.addBox([a.x, a.y, b.x, b.y], Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y));
          if (aisle) nAisle++;
        }
      }
    }
    const pl = layersByName['poi'];
    const lots = _bucketGrid(B);
    let nLot = 0;
    if (pl && pl.features) {
      for (const p of pl.features) {
        if (p.type !== 1 || !p.geom || !p.tags || p.tags.class !== 'parking') continue;
        const q = p.geom[0] && p.geom[0][0];
        if (!q) continue;
        if ((++k & 63) === 0) yield 'lot lanes: pois';
        const streetSide = roads.near(q.x, q.y, sideR, s => _segDist(q.x, q.y, s[0], s[1], s[2], s[3]) < sideR);
        if (streetSide) continue;
        lots.addBox(q, q.x, q.y, q.x, q.y);
        nLot++;
      }
    }
    yield* lotRowCombSteps(cands, mvtToM, out);
    yield* lotHairpinSteps(cands, mvtToM, out);
    if (!nLot && !nAisle) return out;
    const step = LOT_SAMPLE_M / mvtToM;
    for (const f of cands) {
      for (let li = 0; li < f.geom.length; li++) {
        const line = f.geom[li];
        if (!line || line.length < 2) continue;
        let full = 0;
        for (let i = 1; i < line.length; i++) full += Math.hypot(line[i].x - line[i - 1].x, line[i].y - line[i - 1].y);
        if (!(full > 0) || full * mvtToM > LOT_MAX_M) continue;   // too long to be a lane
        yield 'lot lanes: ways';
        let len = 0, inLot = 0, poiEvidence = false, aisleEvidence = false;
        for (let i = 1; i < line.length; i++) {
          const a = line[i - 1], b = line[i];
          const l = Math.hypot(b.x - a.x, b.y - a.y);
          const n = Math.max(1, Math.ceil(l / step));
          for (let j = 0; j < n; j++) {
            const t = (j + 0.5) / n, x = a.x + t * (b.x - a.x), y = a.y + t * (b.y - a.y);
            const w = l / n;
            len += w;
            const nearPoi = nLot && lots.near(x, y, poiR, q => Math.hypot(q.x - x, q.y - y) < poiR);
            const nearAisle = nAisle && aisles.near(x, y, aisleR, s => _segDist(x, y, s[0], s[1], s[2], s[3]) < aisleR);
            if (nearPoi || nearAisle) inLot += w;
            if (nearPoi) poiEvidence = true;
            if (nearAisle) aisleEvidence = true;
          }
        }
        if (len > 0 && inLot >= LOT_SHARE * len) {
          markLotLane(out, f, li, [...(poiEvidence ? ['parking_poi'] : []), ...(aisleEvidence ? ['nearby_aisle'] : [])]);
        }
      }
    }
    return out;
  }
  // THE CUT. Removes every lot lane (isLotLane) from the transportation
  // layer IN PLACE — the layer object is the one entry.layers carries, so the
  // overlay, restoration and lamps never meet one: a feature whose every line
  // is a lane goes, otherwise it is replaced by a copy without those lines
  // (a surviving line keeps its Streets.lineKey — that hashes the line
  // itself and the feature id, not the line's index). Then every service-class `transportation_name` line whose
  // vertices all sit on a cut lane (its label) goes too. Idempotent: a second
  // run finds nothing. Returns [{ f, lines, reasons, lineGroups }]: removed polylines and
  // parallel arrays of evidence codes. POI/aisle codes report contributors to
  // their combined length threshold, not independent sufficient thresholds.
  // lineGroups is parallel to lines: declared same-lot geometry memberships;
  // nearby POI/aisle evidence alone declares no shared identity.
  function* pruneLotLanesSteps(layersByName, mvtToM) {
    const tl = layersByName['transportation'];
    if (!tl || !tl.features) return [];
    const lots = yield* lotLaneSetSteps(layersByName, mvtToM);
    const cut = [];
    let keep = 0;
    for (let i = 0; i < tl.features.length; i++) {
      const f = tl.features[i];
      if (f.type === 2 && f.geom && isLotLane(f.tags)) {
        cut.push({ f, lines: f.geom, reasons: f.geom.map(() => ['parking_aisle']), lineGroups: f.geom.map(() => []) });
        continue;
      }
      const set = f.type === 2 && f.geom ? lots.get(f) : null;
      if (set) {
        const gone = [], stay = [], reasons = [], lineGroups = [];
        for (let li = 0; li < f.geom.length; li++) {
          if (set.has(li)) {
            gone.push(f.geom[li]);
            reasons.push([...set.reasons.get(li)].sort());
            lineGroups.push([...(set.lineGroups.get(li) || [])].sort());
          } else stay.push(f.geom[li]);
        }
        cut.push({ f, lines: gone, reasons, lineGroups });
        if (!stay.length) continue;
        // A NEW feature object, not f.geom rewritten: Streets.lineKey memoises
        // per feature object by line index, and the indices just shifted.
        tl.features[keep++] = Object.assign({}, f, { geom: stay });
        continue;
      }
      tl.features[keep++] = f;
    }
    tl.features.length = keep;
    const tn = layersByName['transportation_name'];
    if (cut.length && tn && tn.features) {
      const vk = new Set();
      for (const c of cut) for (const line of c.lines) for (const p of line) vk.add(p.x * 65536 + p.y);
      let kn = 0;
      for (let i = 0; i < tn.features.length; i++) {
        const f = tn.features[i];
        let onLot = !!(f.geom && f.tags && f.tags.class === 'service');
        if (onLot) {
          for (const line of f.geom) { for (const p of line) if (!vk.has(p.x * 65536 + p.y)) { onLot = false; break; } if (!onLot) break; }
        }
        if (!onLot) tn.features[kn++] = f;
      }
      tn.features.length = kn;
    }
    // Keep the removed geometry for generated quarries. Replaying an already
    // pruned layer must retain this evidence without duplicating it.
    if (cut.length) tl.parkingLanes = [...(tl.parkingLanes || []),
      ...cut.map(row => ({ ...row, extent: tl.extent || 4096 }))];
    return cut;
  }
  // Approximate real-world carriageway width, in metres, per transportation
  // class. The rasterizer only reads this for PIER (roads and paths always
  // rasterize one cell wide — see the wCells comment in rasterizeTile), but
  // the road-geometry overlay strokes each way at this width so the linework
  // it draws covers roughly the ground the real road covers.
  // The vector tiles carry no width tag, so these are guesses per class,
  // and they are tuned against the ground: measured in Sep 2026 the drawn
  // band read ~10% narrower than the street the player was standing on, so
  // the vehicle tiers below the weighted large classes were widened by
  // about that much (residential 5 → 5.5, tertiary 7 → 7.5, secondary
  // 8 → 9). The drawing itself is at true scale (road_overlay.js widthPxFor
  // is metres × CELL_PX / cellM), so if a band looks wrong, this table is
  // the number to change — not the projection.
  function roadWidthM(tags) {
    const c = tags.class || '';
    if (c === 'motorway' || c === 'trunk') return 12;
    if (c === 'primary') return 10;
    if (c === 'secondary') return 9;
    if (c === 'tertiary') return 7.5;
    if (c === 'minor' || c === 'street' || c === 'service') return 5.5;
    // Piers are narrow wooden walkways — keep them single-cell.
    if (c === 'pier') return 2;
    // Walkable classes: a pedestrian street or plaza is road-wide, a track is
    // a farm/forest lane, and footways / cycleways / steps are person-wide.
    if (c === 'pedestrian') return 6;
    if (c === 'track') return 3;
    if (c === 'cycleway') return 2.5;
    if (c === 'footway' || c === 'path' || c === 'steps') return 2;
    return 3;
  }
  // LARGE_ROAD_CLASSES is declared above classifyLine; it's reused here to
  // scale the same tier's carriageway width up for the overlay.
  const LARGE_ROAD_SCALE = 1.5;
  // The width, in metres, that a way actually COVERS on screen: its
  // carriageway width with the large tier's extra weight applied. One number,
  // two consumers, which is the whole point —
  //   • road_overlay.js strokes its band with it, and
  //   • rasterizeTile measures `roadMask` coverage with it,
  // so the ground the player SEES as road is the ground nothing is allowed to
  // spawn on (a cell is road once the band covers ROAD_MASK_MIN_COVER of it). The terrain grid can't answer that question on its
  // own: every way rasterizes ONE cell wide whatever its class (see the
  // wCells comment in rasterizeTile), so a 12 m motorway's band spills a full
  // cell past its ROAD_LG cells on both sides, and parking aisles rasterize to
  // no cell at all — which is how rocks and shrubs kept turning up sitting in
  // traffic on ground the grid swore was grass.
  function roadOverlayWidthM(tags) {
    const t = tags || {};
    const scale = LARGE_ROAD_CLASSES.has(t.class || '') ? LARGE_ROAD_SCALE : 1;
    return roadWidthM(t) * scale;
  }

  // Precedence: higher wins on conflict
  const PRIO = {
    [T.GRASS]: 0, [T.PARK]: 1, [T.FOREST]: 2, [T.SAND]: 2, [T.ROCK]: 2,
    [T.GOLF]: 1.5, [T.PITCH]: 1.5, [T.PLAYGROUND]: 1.5,
    [T.SCHOOL]: 1.5,  // grassland-biome subtype, so it wins over generic grass but loses to residential/farmland
    [T.ORCHARD]: 2, [T.WETLAND]: 2,
    [T.FARMLAND]: 3,
    [T.RESIDENTIAL]: 4, [T.WASTELAND]: 4, [T.COMMERCIAL]: 4, [T.INDUSTRIAL]: 4,
    [T.WATER]: 5,
    // PIER sits just above WATER so pier lines win where they overlap a
    // water polygon (which is the whole point — they're walkways over water),
    // but below roads/buildings so a road bridge crossing the pier still wins.
    [T.PIER]: 5.5,
    [T.PATH]: 6, [T.ROAD]: 7, [T.ROAD_MD]: 7.1, [T.ROAD_LG]: 7.2,
    [T.BUILDING]: 8, [T.BUILDING_MED]: 8, [T.BUILDING_LARGE]: 8,
  };

  // --- Rasterization helpers ---
  // `under` (optional): a map keyed "cx_cy" that records the biome a cell
  // held *before* this paint overwrote it. Only passed when painting PATH —
  // it lets render draw the surrounding biome under the sparse path pebbles
  // instead of a path-specific base, so a footpath doesn't carve a visibly
  // different patch out of the grass/park it crosses. We skip the record when
  // the previous value was already PATH (overlapping path lines) so the real
  // under-biome from the first stamp isn't clobbered with PATH.
  function paintCell(grid, w, h, cx, cy, type, under) {
    if (cx < 0 || cy < 0 || cx >= w || cy >= h) return;
    const i = cy * w + cx;
    if (PRIO[type] >= PRIO[grid[i]]) {
      if (under && grid[i] !== type) under[`${cx}_${cy}`] = grid[i];
      grid[i] = type;
    }
  }
  // Scanline fill, IN ROWS, so a big polygon isn't one unbroken block.
  //
  // This is the last thing holding the main thread for hundreds of ms at a
  // time. A tile build yields between its passes and every few features, but a
  // SINGLE feature can be the landuse polygon covering the whole tile — 222
  // rows of up to 222 cells, ~50k paintCell calls, measured at 326 ms with
  // nothing able to interrupt it. On a phone that is the walking stutter: the
  // live profiler attributes every frame over 100 ms to a background tile
  // build, and this is what a background tile build is doing.
  //
  // Yields by row, which is the natural seam — the scanline state is rebuilt
  // per row, so pausing between rows costs nothing.
  function* paintPolygonSteps(grid, w, h, rings, type, mvtToCell) {
    yield* forEachPolygonCellSteps(w, h, rings, mvtToCell,
      (x, y) => paintCell(grid, w, h, x, y, type));
  }
  // The scanline itself, for any per-cell stamp (the terrain paint above, the
  // quiet-land mask): visit(x, y) once per cell whose centre is inside.
  // `off` (optional, cells): shift the polygon by this much on both axes —
  // the spawn gate stamps onto a grid wider than the tile by `off` each side
  // (stampSpawnWhySteps), so a cemetery just over the seam still buffers.
  function* forEachPolygonCellSteps(w, h, rings, mvtToCell, visit, off) {
    // Use signed area to know outer vs inner. For simplicity, rasterize all rings with
    // even-odd fill across all rings combined per feature.
    // Build cell-space polygon, then scanline fill.
    const o = off || 0;
    const polys = rings.map(r => r.map(p => ({
      x: p.x * mvtToCell + o,
      y: p.y * mvtToCell + o,
    })));
    // Bounding box
    let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity;
    for (const ring of polys) for (const p of ring) {
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    }
    const y0 = Math.max(0, Math.floor(minY));
    const y1 = Math.min(h - 1, Math.ceil(maxY));
    for (let y = y0; y <= y1; y++) {
      if (((y - y0) & 7) === 7) yield 'polygon fill rows';
      const ys = y + 0.5;
      const xs = [];
      for (const ring of polys) {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const a = ring[j], b = ring[i];
          if ((a.y > ys) !== (b.y > ys)) {
            const t = (ys - a.y) / (b.y - a.y);
            xs.push(a.x + t * (b.x - a.x));
          }
        }
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        // Symmetric pixel-centre fill: a cell (x, y) is "inside" iff its centre (x+0.5, y+0.5)
        // is between the left/right intersection xs[k], xs[k+1].
        const xa = Math.max(0, Math.floor(xs[k] + 0.5));
        const xb = Math.min(w - 1, Math.floor(xs[k + 1] - 0.5));
        for (let x = xa; x <= xb; x++) visit(x, y);
      }
    }
  }
  // Visit every cell a polyline covers when stamped as a disk of radius
  // widthCells/2 along Bresenham segments. Used by the terrain paint
  // (paintLine). The road-footprint mask (stampCoverLineSteps below) used to share
  // this walk, but it now stamps from the exact drawn-band geometry instead —
  // the centerline walk can't see a band spilling into a neighbouring cell.
  //
  // Vertices map to the cell that CONTAINS them — floor(), the same rule
  // snapCell / spawnDebrisSteps use, and the same answer paintPolygonSteps'
  // centre-sample gives. It used to be Math.round(), which picks the cell
  // whose top-LEFT corner is nearest the point and so biased every road,
  // path and pier half a cell south-east of the way it was painted from:
  // roads sat half a cell off their own OSM geometry (visible the moment
  // the road-geometry overlay was drawn over them) and half a cell off the
  // buildings and water that were rasterized by the correct rule.
  function forEachLineCell(line, widthCells, mvtToCell, visit) {
    const r = Math.max(0, Math.floor(widthCells / 2));
    for (let i = 1; i < line.length; i++) {
      let x0 = Math.floor(line[i - 1].x * mvtToCell);
      let y0 = Math.floor(line[i - 1].y * mvtToCell);
      const x1 = Math.floor(line[i].x * mvtToCell);
      const y1 = Math.floor(line[i].y * mvtToCell);
      const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
      const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
      let err = dx + dy;
      const stamp = (cx, cy, isElbow) => {
        for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) {
          if (ox * ox + oy * oy <= r * r) visit(cx + ox, cy + oy, isElbow);
        }
      };
      while (true) {
        stamp(x0, y0);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        const stepX = e2 >= dy, stepY = e2 <= dx;
        if (stepX) { err += dy; x0 += sx; }
        if (stepY) { err += dx; y0 += sy; }
        // 4-connected: a plain Bresenham diagonal step leaves consecutive
        // cells touching only at a corner, which a width-1 road renders as
        // disconnected squares (the renderer draws orthogonal arms only).
        // Stamp the x-stepped intermediate cell too so every diagonal step
        // becomes a real L-elbow in the grid.
        if (stepX && stepY) stamp(x0, y0 - sy, true);
      }
    }
  }
  // A path cell shows its cobble only once this much path lies inside it,
  // measured in cell widths. 1 = the way must cross the whole cell.
  const PATH_CROSS_MIN_CELLS = 1;

  // How much of a way actually lies inside each cell, in CELL WIDTHS.
  //
  // forEachLineCell above is a Bresenham walk: it answers "does this way touch
  // this cell", which is all the paint and the spawn mask need. It cannot
  // answer "how much of the cell does it cross", because it carries no length.
  // The path cobbles need that: a stone should mark a footpath that runs
  // THROUGH a cell, not one that clips its corner or stops just inside it.
  //
  // Exact grid traversal (Amanatides & Woo): step from one cell boundary to the
  // next and add the length of each piece to the cell it fell in. No sampling,
  // so a straight orthogonal crossing measures exactly 1.0 and a corner clip
  // measures what it really is.
  function accumulateLineSpan(span, w, h, line, mvtToCell) {
    for (let i = 1; i < line.length; i++) {
      const x0 = line[i - 1].x * mvtToCell, y0 = line[i - 1].y * mvtToCell;
      const x1 = line[i].x * mvtToCell,     y1 = line[i].y * mvtToCell;
      const dx = x1 - x0, dy = y1 - y0;
      const len = Math.hypot(dx, dy);
      if (!(len > 0)) continue;
      let ix = Math.floor(x0), iy = Math.floor(y0);
      const ex = Math.floor(x1), ey = Math.floor(y1);
      const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1;
      const tDeltaX = dx !== 0 ? 1 / Math.abs(dx) : Infinity;
      const tDeltaY = dy !== 0 ? 1 / Math.abs(dy) : Infinity;
      let tMaxX = dx !== 0 ? ((dx > 0 ? (ix + 1 - x0) : (x0 - ix)) / Math.abs(dx)) : Infinity;
      let tMaxY = dy !== 0 ? ((dy > 0 ? (iy + 1 - y0) : (y0 - iy)) / Math.abs(dy)) : Infinity;
      let t = 0;
      // Bounded: a segment can only cross so many cells, and the +2 covers the
      // final partial cell plus any float wobble right on a boundary.
      const guard = Math.abs(ex - ix) + Math.abs(ey - iy) + 2;
      for (let n = 0; n <= guard; n++) {
        const tNext = Math.min(tMaxX, tMaxY, 1);
        if (ix >= 0 && iy >= 0 && ix < w && iy < h) {
          span[iy * w + ix] += (tNext - t) * len;
        }
        if (tNext >= 1) break;
        t = tNext;
        if (tMaxX < tMaxY) { ix += stepX; tMaxX += tDeltaX; }
        else               { iy += stepY; tMaxY += tDeltaY; }
      }
    }
  }

  // Record, per cell, how much of it a way's drawn band covers. It writes no
  // terrain — a masked cell keeps its biome (and stays walkable); it is only
  // barred from hosting a spawn. See roadMask.
  // ── Road-footprint mask stamping ──────────────────────────────────────────
  // The mask must follow the ground the overlay DRAWS, and the overlay strokes
  // each way as a continuous band `widthCells` wide in world space — not as a
  // run of whole cells. So coverage is measured against the thickened segment
  // itself (a capsule of radius widthCells/2, round caps like the canvas
  // stroke), and a cell is masked once that covers ROAD_MASK_MIN_COVER of it
  // (see stampCoverLineSteps below). The previous-but-one stamp walked
  // Bresenham cells around the way's CENTERLINE at a rounded whole-cell width,
  // so a band running near a cell boundary spilled drawn asphalt into a cell
  // the mask never marked — and that cell stayed tillable and spawnable.
  function segPointDist2(ax, ay, bx, by, px, py) {
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    const qx = ax + t * dx - px, qy = ay + t * dy - py;
    return qx * qx + qy * qy;
  }
  // Liang-Barsky clip: does the (unthickened) segment pass through — or touch —
  // the rect? Touching counts: a way running exactly along a cell boundary
  // draws half its band into each side, so both cells are covered.
  function segCrossesRect(ax, ay, bx, by, x0, y0, x1, y1) {
    const dx = bx - ax, dy = by - ay;
    let t0 = 0, t1 = 1;
    const clip = (p, q) => {
      if (p === 0) return q >= 0;
      const r = q / p;
      if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
      else       { if (r < t0) return false; if (r < t1) t1 = r; }
      return true;
    };
    return clip(-dx, ax - x0) && clip(dx, x1 - ax) && clip(-dy, ay - y0) && clip(dy, y1 - ay);
  }
  // Does the segment's drawn band overlap the unit cell at (cx, cy)? Exact:
  // overlap iff the segment-to-square distance is under halfW. Both shapes are
  // convex, so that distance is attained at a vertex of one against the other —
  // the corner/endpoint checks cover every non-crossing case, and the crossing
  // test covers distance zero. Strictly `<`: a band that only TOUCHES the cell
  // edge covers none of its area, so a street centred in its own cell doesn't
  // leak mask onto its shoulders.
  function bandCoversCell(ax, ay, bx, by, halfW, cx, cy) {
    if (segCrossesRect(ax, ay, bx, by, cx, cy, cx + 1, cy + 1)) return true;
    const r2 = halfW * halfW;
    if (segPointDist2(ax, ay, bx, by, cx,     cy)     < r2) return true;
    if (segPointDist2(ax, ay, bx, by, cx + 1, cy)     < r2) return true;
    if (segPointDist2(ax, ay, bx, by, cx,     cy + 1) < r2) return true;
    if (segPointDist2(ax, ay, bx, by, cx + 1, cy + 1) < r2) return true;
    const endInRange = (px, py) => {
      const ex = Math.max(cx - px, px - (cx + 1), 0);
      const ey = Math.max(cy - py, py - (cy + 1), 0);
      return ex * ex + ey * ey < r2;
    };
    return endInRange(ax, ay) || endInRange(bx, by);
  }
  // ── How much of a cell must be under the band for it to be ROAD ground ──
  // ROAD_MASK_MIN_COVER: a cell is road ground (roadMask = 1) only when the
  // UNION of every drawn band covers at least this fraction of its area. It
  // used to be ANY overlap, which was right for the look (no rock sits on
  // visible asphalt) but far too greedy for the world: a 5.5 m street drawn
  // across 7 m cells clips a sliver of the cells either side of it, and the
  // any-overlap mask took a third of every town tile (47 % of central Berlin)
  // out of play for spawns, tilling and trap verges. At a half the mask is the
  // cells the player reads as MOSTLY road; a verge cell with a lick of paint
  // on its edge is ground again. One number, the mask's own definition, so
  // every reader (isSpawnCell, Traps.canLay, starter.js, stairs, tilling)
  // moves with it.
  //
  // Coverage is ESTIMATED from ROAD_MASK_SAMPLES sample points per cell, laid
  // out as an N-ROOKS lattice (sample k at x = (k+½)/16, y = (5k mod 16 + ½)/16):
  // every sample has its own column AND its own row. A plain 4 × 4 grid reads
  // a band edge running along the grid in quarters — a 5.5 m street straddling
  // a cell boundary covers 39 % of each side and a 4 × 4 grid calls that 50 %
  // — where the lattice reads it in sixteenths along either axis (6/16), and
  // diagonal edges no worse. Each cell keeps a BITMASK of the samples any band covers —
  // not a sum of per-band fractions — so two overlapping bands never count
  // the same ground twice, and two bands that each cover a third of a cell
  // side by side do add up. The mask is resolved from the bits once every way
  // is stamped (resolveRoadMaskSteps).
  const ROAD_MASK_MIN_COVER = 0.5;
  const ROAD_MASK_SAMPLES = 16;                    // one bit each → a Uint16 per cell
  const ROAD_COVER_FULL = 0xffff;
  const ROAD_MASK_MIN_BITS = Math.ceil(ROAD_MASK_MIN_COVER * ROAD_MASK_SAMPLES);
  // The n-rooks lattice, as offsets inside the unit cell. 5 is coprime with
  // 16, so 5k mod 16 visits every row once, and its points spread well (no
  // two closer than √10 sixteenths of a cell).
  const ROAD_SUB_X = new Float64Array(ROAD_MASK_SAMPLES);
  const ROAD_SUB_Y = new Float64Array(ROAD_MASK_SAMPLES);
  for (let k = 0; k < ROAD_MASK_SAMPLES; k++) {
    ROAD_SUB_X[k] = (k + 0.5) / ROAD_MASK_SAMPLES;
    ROAD_SUB_Y[k] = ((5 * k) % ROAD_MASK_SAMPLES + 0.5) / ROAD_MASK_SAMPLES;
  }
  function popcount16(v) {
    v = v - ((v >> 1) & 0x5555);
    v = (v & 0x3333) + ((v >> 2) & 0x3333);
    v = (v + (v >> 4)) & 0x0f0f;
    return (v + (v >> 8)) & 0x1f;
  }
  // OR the samples one way's band covers into `cover` (a Uint16Array, one
  // sample bitmask per cell). widthCells is FRACTIONAL — the caller passes
  // roadOverlayWidthM / CELL_M unrounded, so a 2 m footpath covers exactly the
  // samples its 2 m band draws over. bandCoversCell is the cheap reject (the
  // band misses the square entirely); a square whose four corners all sit
  // inside the capsule is wholly inside it (both are convex) and fills at
  // once; only the cells the band's EDGE crosses pay for the sixteen samples.
  //
  // Each row only walks the columns the capsule can reach in it (the
  // segment's x-span over the rows within halfW, widened by halfW) — never
  // the segment's whole bounding box, which for a long diagonal motorway
  // segment is tens of thousands of cells the band is nowhere near. A
  // generator for the tile-build rule: one yield per ROAD_STAMP_YIELD_SEGS
  // segments, so a long merged way can't hold the thread on its own.
  const ROAD_STAMP_YIELD_SEGS = 128;
  function* stampCoverLineSteps(cover, w, h, line, widthCells, mvtToCell) {
    const halfW = Math.max(0, widthCells / 2);
    if (!(halfW > 0)) return;
    const r2 = halfW * halfW;
    for (let i = 1; i < line.length; i++) {
      if ((i % ROAD_STAMP_YIELD_SEGS) === 0) yield 'road mask stamp';
      const ax = line[i - 1].x * mvtToCell, ay = line[i - 1].y * mvtToCell;
      const bx = line[i].x * mvtToCell,     by = line[i].y * mvtToCell;
      const sdx = bx - ax, sdy = by - ay;
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - halfW));
      const x1 = Math.min(w - 1, Math.floor(Math.max(ax, bx) + halfW));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by) - halfW));
      const y1 = Math.min(h - 1, Math.floor(Math.max(ay, by) + halfW));
      for (let cy = y0; cy <= y1; cy++) {
        let rx0 = x0, rx1 = x1;
        if (sdy !== 0) {
          let ta = (cy - halfW - ay) / sdy, tb = (cy + 1 + halfW - ay) / sdy;
          if (ta > tb) { const tt = ta; ta = tb; tb = tt; }
          if (ta < 0) ta = 0;
          if (tb > 1) tb = 1;
          if (ta > tb) continue;
          const xa = ax + sdx * ta, xb = ax + sdx * tb;
          rx0 = Math.max(x0, Math.floor(Math.min(xa, xb) - halfW));
          rx1 = Math.min(x1, Math.floor(Math.max(xa, xb) + halfW));
        }
        for (let cx = rx0; cx <= rx1; cx++) {
          const ci = cy * w + cx;
          let bits = cover[ci];
          if (bits === ROAD_COVER_FULL) continue;
          if (!bandCoversCell(ax, ay, bx, by, halfW, cx, cy)) continue;
          if (segPointDist2(ax, ay, bx, by, cx,     cy)     < r2
           && segPointDist2(ax, ay, bx, by, cx + 1, cy)     < r2
           && segPointDist2(ax, ay, bx, by, cx,     cy + 1) < r2
           && segPointDist2(ax, ay, bx, by, cx + 1, cy + 1) < r2) {
            cover[ci] = ROAD_COVER_FULL;
            continue;
          }
          for (let k = 0; k < ROAD_MASK_SAMPLES; k++) {
            if (bits & (1 << k)) continue;
            if (segPointDist2(ax, ay, bx, by, cx + ROAD_SUB_X[k], cy + ROAD_SUB_Y[k]) < r2) bits |= (1 << k);
          }
          cover[ci] = bits;
        }
      }
    }
  }
  // Threshold the sample bits into the 0/1 road mask (ROAD_MASK_MIN_COVER).
  // A pass over every cell, so it yields (the tile-build worst-block rule).
  function* resolveRoadMaskSteps(cover, mask, w, h) {
    for (let cy = 0; cy < h; cy++) {
      if ((cy & 63) === 63) yield 'road mask coverage';
      const row = cy * w;
      for (let cx = 0; cx < w; cx++) {
        const bits = cover[row + cx];
        if (bits && popcount16(bits) >= ROAD_MASK_MIN_BITS) mask[row + cx] = 1;
      }
    }
  }
  // ── The road's CLASS, per cell ────────────────────────────────────────────
  // Beside the mask, one byte of bits saying which ROAD this is ground of. Only
  // the MAJOR ways (ROAD_MD + ROAD_LG, the old trade roads — see
  // src/street_variants.js) are recorded, because that is the question the
  // spawners ask: the kerb buffer (ROAD_CLASS_MAJOR_BUFFER), the wagon bus stops and
  // the dogs.
  //   ROAD_CLASS_MAJOR_BAND  a major way's drawn band covers ANY of the cell.
  //   ROAD_CLASS_MAJOR_VERGE the cell is NOT road ground (roadMask 0) and is
  //                          either touched by a major band (under half
  //                          covered) or 8-adjacent to a masked cell a major
  //                          band touches: the major road's verge.
  // Derived from the SAME stamp the mask is (majorCover is the major ways'
  // own copy of roadCover), so a narrow band that masks no cell at all at
  // ROAD_MASK_MIN_COVER still has a verge — the cells it paints a lick of.
  const ROAD_CLASS_MAJOR_BAND = 1;
  const ROAD_CLASS_MAJOR_VERGE = 2;
  //   ROAD_CLASS_BANDIT_VERGE a major-verge cell on an old trade road's
  //                          stretch — the look only since Sep 2026 (no trap
  //                          reads it: snares keep off every road).
  //                          Stamped after the street index is built
  //                          (StreetVariants.stampBanditStretchesSteps).
  const ROAD_CLASS_BANDIT_VERGE = 4;
  //   ROAD_CLASS_MAJOR_BUFFER the KERB BUFFER: within MAJOR_BUFFER_CELLS of a
  //                          major band (the band's own cells included) —
  //                          stamped off the same lines, widened, so it is
  //                          seam-safe the way the band is. THE SAFETY RULE
  //                          (owner, Sep 2026): no FAST mover (foe or animal
  //                          over creature_ai.js BRISK_WALK_MPS) spawns in it
  //                          (the spawn gate's KERB reason) or steps into it,
  //                          every hostile gives up on a player standing in
  //                          it, and nothing
  //                          hostile steps onto the band itself — so the
  //                          sidewalk is where a chase ENDS and nobody ever
  //                          needs the carriageway to get away. It is NOT a
  //                          spawn veto for pickups or scenery (X marks,
  //                          rocks, chests keep isSpawnCell).
  const ROAD_CLASS_MAJOR_BUFFER = 8;
  // About one base reach radius (coords.js reachCells: 2.5 cells) past the
  // band's edge — the ring a player standing on the kerb can act inside.
  const MAJOR_BUFFER_CELLS = 2.5;
  function* resolveRoadClassSteps(majorCover, mask, out, w, h, bufCover) {
    for (let cy = 0; cy < h; cy++) {
      if ((cy & 63) === 63) yield 'road class bands';
      const row = cy * w;
      for (let cx = 0; cx < w; cx++) {
        if (majorCover[row + cx]) out[row + cx] |= ROAD_CLASS_MAJOR_BAND | ROAD_CLASS_MAJOR_BUFFER;
        else if (bufCover && bufCover[row + cx]) out[row + cx] |= ROAD_CLASS_MAJOR_BUFFER;
      }
    }
    for (let cy = 0; cy < h; cy++) {
      if ((cy & 63) === 63) yield 'road class verge';
      for (let cx = 0; cx < w; cx++) {
        const i = cy * w + cx;
        if (mask[i]) continue;
        const verge = !!majorCover[i] || anyNeighbour8(w, h, cx, cy, (nx, ny, j) => mask[j] && majorCover[j]);
        if (verge) out[i] |= ROAD_CLASS_MAJOR_VERGE;
      }
    }
  }
  // `allow`, when given, vetoes individual cells — the traversal still walks
  // the whole way, but only the cells it approves are painted. Footpaths use it
  // to skip cells they merely clip (see pathCross).
  function paintLine(grid, w, h, line, type, widthCells, mvtToCell, under, allow) {
    forEachLineCell(line, widthCells, mvtToCell, (cx, cy, isElbow) => {
      if (allow && !allow(cx, cy, isElbow)) return;
      paintCell(grid, w, h, cx, cy, type, under);
    });
  }

  // Post-paint erosion for merged pavement blobs.
  //
  // Dense road/path networks — parking-lot aisles, plaza perimeter loops,
  // footpath meshes, roads with sidewalk ways on both sides — run closer
  // together than one game cell, so their 1-cell paintLine stamps (2-cell on
  // diagonal steps) weld into solid multi-cell "zones" of pavement instead of
  // distinct lines. This pass dissolves every cell that is STRICTLY INTERIOR
  // to a same-kind paved area — all 8 neighbours paved AND the same kind
  // (vehicle tiers ROAD/ROAD_MD/ROAD_LG count as one kind, PATH as another) —
  // back to the biome the paint covered (recorded in pathUnder/roadUnder at
  // stamp time). What survives:
  //   • 1-wide lines and 2-wide lanes/diagonal staircases — they always touch
  //     unpaved ground, so ordinary streets and dual carriageways never erode;
  //   • the perimeter loop of a blob (reads as the road/path that encircles
  //     the area, which is usually exactly what the OSM ways describe);
  //   • a road line crossing a footpath plaza (and vice versa) — its
  //     neighbours are the wrong kind, so the through-line is protected.
  // Out-of-tile neighbours count as same-kind pavement: the geometry that
  // built a seam-spanning blob extends into the adjacent tile's buffer, so
  // both tiles see the same blob and erode the same interior cells.
  // The same question COBBLE_TYPES answers — a road tier or a footpath — under
  // the name the erosion passes read it by.
  const isPavedTerrain = isCobbleTerrain;
  // …and its counterpart for the building tiers (BUILDING_TYPES, above).
  // Exported: road_overlay.js keeps its band off building floors with it.
  const isBuildingTerrain = (t) => BUILDING_TYPES.has(t);

  // THE BUILDING MOAT. A house/tower sprite is foot-anchored on its footprint
  // and its base overhangs the immediately adjacent cells, so a scatter object
  // one cell off the footprint still reads as sitting ON the building's
  // foundation ("interactables spawning in house boundaries"). True when any
  // cell of the 3×3 block around (ix, iy) — the cell itself included — is a
  // building footprint. Every ground-scatter placement asks this: the
  // rasterize post-pass, the Overpass injection in loadTile, the cave
  // entrance. Trees are exempt everywhere (yard trees grow against walls).
  function nearBuildingCell(grid, w, h, ix, iy) {
    return !!boxCells(w, h, ix, iy, 1, (x, y, i) => isBuildingTerrain(grid[i]));
  }
  // THE CHEST FRONTAGE. A POI chest's cell is protected by the occupancy pass,
  // but its render pad spills past the cell and the player needs to stand
  // beside it — so nothing else may sit in the chest's one-cell ring either.
  // `pois` is a list of { ix, iy } cell coords (the same list isSpawnCell's
  // opts.pois carries).
  function nearPoiCell(pois, ix, iy) { return poiWithin(pois, ix, iy, 1); }

  // PUTTING A PAVED CELL BACK. Two post-passes take pavement off the grid —
  // erodePavementBlobs dissolves a welded interior, pruneShortPathRuns deletes
  // a stub — and both owe the cell the biome the paint covered, which
  // pathUnder / roadUnder recorded at stamp time (see paintCell).
  // Returns restore(x, y): writes that biome and drops the stale record.
  function makePavedRestorer(grid, w, pathUnder, roadUnder) {
    // The biome a paved cell covered, if any was recorded. A cell repainted
    // across kinds (ROAD stamped over PATH) records PATH in roadUnder — skip
    // paved values and fall through to the path stamp's original record.
    const underAt = (x, y) => {
      const k = `${x}_${y}`;
      for (const u of [roadUnder[k], pathUnder[k]]) {
        if (u != null && !isPavedTerrain(u)) return u;
      }
      return null;
    };
    return (x, y) => {
      let u = underAt(x, y);
      if (u == null) {
        // No usable record (shouldn't happen for painted lines) — borrow the
        // most common restorable under-biome among the 8 neighbours.
        const counts = {};
        let best = T.GRASS, bestN = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nu = underAt(x + dx, y + dy);
            if (nu == null) continue;
            const n = (counts[nu] = (counts[nu] || 0) + 1);
            if (n > bestN) { bestN = n; best = nu; }
          }
        }
        u = best;
      }
      grid[y * w + x] = u;
      // Keep entry.pathUnder describing live path cells only.
      delete pathUnder[`${x}_${y}`];
    };
  }

  function erodePavementBlobs(grid, w, h, pathUnder, roadUnder) {
    const isPaved = isPavedTerrain;
    const kindOf = (t) => (t === T.PATH ? 1 : 0);
    const restore = makePavedRestorer(grid, w, pathUnder, roadUnder);
    const eroded = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const t = grid[y * w + x];
        if (!isPaved(t)) continue;
        const kind = kindOf(t);
        // (A neighbour off the grid is skipped — at a seam the blob is assumed
        // to continue.)
        const interior = !anyNeighbour8(w, h, x, y, (nx, ny, j) => !isPaved(grid[j]) || kindOf(grid[j]) !== kind);
        if (interior) eroded.push([x, y]);
      }
    }
    // Two-phase (collect, then write) so erosion decisions all read the
    // original grid — peeling in scan order would cascade through the blob.
    for (const [x, y] of eroded) restore(x, y);
    return eroded.length;
  }

  // ── The short-path-run floor ──────────────────────────────────────────────
  // A PATH cell marks a route you can walk, and a THREE-cell scrap of footway
  // is not one. OSM is full of those scraps — a driveway apron, a crossing
  // across a street, the little tail a way leaves where it meets a road, the
  // two cells of a path whose neighbours all failed the pathCross span test —
  // and each one landed on the map as a lone patch or two sitting in a field.
  //
  // So a run of PATH cells shorter than this is not a path at all: it goes
  // back to the biome it covered, exactly as a cell a way merely clips never
  // becomes PATH in the first place (pathCross, above). Deleting the TERRAIN
  // rather than hiding the ground is what keeps one answer to "is there a path
  // here?": the cell is tillable and spawnable again, and render.js needs no
  // rule of its own.
  //
  // Counted in PATH CELLS — 15 of them is about 105 m of walking. What the
  // player RESTORES is metres of the way itself (src/streets.js, drawn by
  // road_overlay.js), which is a separate question from the terrain; this is
  // the floor on the path EXISTING at all, underneath both.
  const MIN_PATH_RUN_CELLS = 15;

  // Post-pass: dissolve every 4-connected run of PATH cells shorter than
  // MIN_PATH_RUN_CELLS. Runs after the painting and after the blob erosion
  // (both decide what a run IS), and before the road-label / path-name passes,
  // so a dissolved cell is never named, never claimable and never drawn.
  //
  // A run touching the tile edge is EXEMPT: the same way carries on into the
  // neighbouring tile, which rasterizes alone and counts only its own cells,
  // so judging the piece inside this tile would chop a long footpath to
  // nothing at every seam. Same convention as erodePavementBlobs, which reads
  // an out-of-tile neighbour as more of the blob.
  //
  // One flood over the grid, each cell visited once — O(w·h), no per-run
  // rescan (see the tile-build-block rule in CLAUDE.md).
  function pruneShortPathRuns(grid, w, h, pathUnder, roadUnder) {
    const restore = makePavedRestorer(grid, w, pathUnder, roadUnder);
    const seen = new Uint8Array(w * h);
    const run = [];          // reused as the flood queue; no per-run allocation
    let dissolved = 0;
    for (let sy = 0; sy < h; sy++) {
      for (let sx = 0; sx < w; sx++) {
        const start = sy * w + sx;
        if (seen[start] || grid[start] !== T.PATH) continue;
        // 4-connected, which is how paintLine leaves a path: the elbow stamp
        // exists precisely so consecutive cells share an edge, not a corner.
        run.length = 0;
        seen[start] = 1;
        run.push(start);
        let onEdge = false;
        for (let qi = 0; qi < run.length; qi++) {
          const idx = run[qi];
          const x = idx % w, y = (idx - x) / w;
          if (x === 0 || y === 0 || x === w - 1 || y === h - 1) onEdge = true;
          if (x > 0     && !seen[idx - 1] && grid[idx - 1] === T.PATH) { seen[idx - 1] = 1; run.push(idx - 1); }
          if (x < w - 1 && !seen[idx + 1] && grid[idx + 1] === T.PATH) { seen[idx + 1] = 1; run.push(idx + 1); }
          if (y > 0     && !seen[idx - w] && grid[idx - w] === T.PATH) { seen[idx - w] = 1; run.push(idx - w); }
          if (y < h - 1 && !seen[idx + w] && grid[idx + w] === T.PATH) { seen[idx + w] = 1; run.push(idx + w); }
        }
        if (onEdge || run.length >= MIN_PATH_RUN_CELLS) continue;
        for (const idx of run) {
          const x = idx % w;
          restore(x, (idx - x) / w);
        }
        dissolved += run.length;
      }
    }
    return dissolved;
  }

  // --- Tile fetching & caching ---
  // One tile cache PER DEPTH. depth 0 = surface (MVT-derived); depth 1,2,… =
  // underground cave levels (each derived from the level above — see
  // loadCaveTile). setDepth() repoints the module-level `tileCache` (and the
  // exported WorldGen.tileCache) at the active depth's map so every existing
  // `WorldGen.tileCache.get(...)` / forEachItem call site reads the current
  // level with no per-site change.
  const caches = new Map();      // depth -> Map("z/x/y" -> entry)
  function cacheFor(depth) {
    let c = caches.get(depth);
    if (!c) { c = new Map(); caches.set(depth, c); }
    return c;
  }
  let activeDepth = 0;
  let tileCache = cacheFor(0);   // "z/x/y" -> { promise, grid, cellsPerEdge, status }
  function setDepth(depth) {
    activeDepth = depth;
    tileCache = cacheFor(depth);
    // Repoint the external reference so app.js / render.js see the active map.
    if (global.WorldGen) global.WorldGen.tileCache = tileCache;
    return tileCache;
  }

  // Plain-rock fraction of a mineralrock roll (vs an ore-bearing rock).
  //   surface (depth 0) → 0.90 plain → 0.10 ore, spread over every tier
  //                       (SURFACE_ROCK_TIER_WEIGHTS) — ~2.5 % copper-bearing
  //   underground       → CAVE_ORE_SHARE of the rocks for each of the
  //                       level's ore tiers (caveOreTiers, below), the rest
  //                       plain: level 1 LEVEL1_COPPER_SHARE copper (3 %, a
  //                       taste), level 2 90 %, then 80 %
  const CAVE_ORE_SHARE = 0.10;
  // The first level down is no tier's mine (caveOreTiers(1) is empty), but it
  // is where a wood pick first swings, so a thin seam of copper runs through
  // it (owner, Oct 2026): this share of its rocks, the rest plain. The ore
  // table for a level with no tiers of its own is copper (caveOreWeights),
  // which is what makes this one number enough.
  const LEVEL1_COPPER_SHARE = 0.03;
  function caveRockP(depth) {
    if (!depth || depth <= 0) return 0.90;
    if (depth === 1) return 1 - LEVEL1_COPPER_SHARE;
    return 1 - CAVE_ORE_SHARE * caveOreTiers(depth).length;
  }

  // EACH LEVEL IS ITS TIER'S MINE. Level N's ORE ROCKS — the ones drawn with
  // ore in them, which always break into their bar — are tier N and the tier
  // below, CAVE_ORE_SHARE (10 %) of the rocks each: level 3 is 10 % iron,
  // 10 % copper. Only REAL ore counts (tier 2, copper, and up): a "tier 1" ore
  // rock breaks as plain stone (interactables.js isPlain), so level 1 is no
  // tier's mine — it carries only the thin LEVEL1_COPPER_SHARE seam above —
  // and level 2 is 10 % copper. It is the progression ladder in the rocks: a
  // tier-N ore wants a pick of tier N-1 (requiredTier), so level 2's copper
  // forges the pick that opens level 3's iron, down to frost and crimson on
  // level 7 (and below — the table tops out there). Tier 4+ ore carries its
  // gem (sapphire, ruby, emerald, then the diamond on 7).
  // Plain rocks keep their own hidden bar roll on break (interactables.js,
  // 1/(2t²) per tier) on every level — this table is only the visible ore.
  // Until Sep 2026 every level below the first used the surface's spread, so
  // frost was 3 % of ore on level 7 exactly as on level 2.
  function caveOreTiers(depth) {
    const top = Math.max(1, Math.min(7, depth | 0));
    return [top - 1, top].filter((t) => t >= 2);
  }
  function caveOreWeights(depth) {
    const tiers = caveOreTiers(depth);
    const w = [0, 0, 0, 0, 0, 0, 0];
    for (const t of tiers) w[t - 1] += 1 / tiers.length;
    if (!tiers.length) w[1] = 1;   // never rolled (all plain) — a valid table
    return w;
  }

  // Ore-subset tier weights for a SURFACE deposit — the residential/yard table
  // (see the T.RESIDENTIAL cluster spawn, which reads this same array). Applies
  // to the ~10% of rolls that aren't plain rock (caveRockP(0) above): copper
  // (T2) is 0.25 of the subset, so copper-bearing rock is ~2.5% of all surface
  // rocks, tapering to T7 at ~0.3%.
  const SURFACE_ROCK_TIER_WEIGHTS = [0.30, 0.25, 0.22, 0.08, 0.07, 0.05, 0.03];
  // One surface-deposit rarity roll, shared so anything seeding rocks by hand
  // (the starter home provisioner in app.js) gets the exact odds a real
  // residential deposit gets. Same draw shape as _pushMineralrock: the plain
  // split first, then the weighted tier pick — two rng() draws for an ore
  // roll, one for a plain one. Returns { yieldTier, requiredTier } with the
  // requiredTier = yieldTier − 1 pairing the mining gate expects (plain rock
  // is { 1, 1 }: bare hands, drops stone).
  function rollSurfaceRockTier(rng) {
    if (rng() < caveRockP(0)) return { yieldTier: 1, requiredTier: 1 };
    const yieldTier = pickTierFromCum(rng() * SURFACE_ROCK_CUM.totalW, SURFACE_ROCK_CUM.tierW);
    return { yieldTier, requiredTier: Math.max(1, yieldTier - 1) };
  }

  // ── The rock-roll toolkit, shared by every mineralrock spawner ──────────
  // (the surface polygon clusters in rasterizeTileSteps, the cave floor
  // clusters in spawnCaveRocks, and rollSurfaceRockTier above). One copy of
  // each so the surface and the caves can't drift apart in odds — and, since
  // world generation is deterministic, so the rng draw ORDER is the same
  // everywhere: one draw for the plain split, then one more for either the
  // plain variant or the ore tier.
  //
  // Per-tier weights -> cumulative table + total, as the tier pick expects.
  function cumWeights(weights) {
    const tierW = []; let totalW = 0;
    for (const w of weights) { totalW += w; tierW.push(totalW); }
    return { tierW, totalW };
  }
  const SURFACE_ROCK_CUM = cumWeights(SURFACE_ROCK_TIER_WEIGHTS);
  // The tier `r` (a draw scaled to totalW) lands in: first cumulative weight
  // at or above it, T7 if none.
  function pickTierFromCum(r, tierW) {
    for (let i = 0; i < tierW.length; i++) {
      if (r <= tierW[i]) return i + 1;
    }
    return 7;
  }
  // How many looks a plain rock has — SpriteLayout.PLAIN_ROCK_VARIANTS.length,
  // kept as a literal so this file has no load-order dependency on it.
  const PLAIN_ROCK_VARIANT_N = 4;
  // VEINS: a cluster that rolls under `veinChance` has ONE randomly chosen
  // tier's weight multiplied by VEIN_MUL for that cluster only, so a pocket
  // reads as "an iron vein" / "a gold seam" rather than evenly-mixed ore. The
  // plain-vs-ore split is untouched, and the random tier pick spreads the
  // boost across every tier the table offers over many clusters, so global rarity barely
  // moves. Two draws (the chance, then the tier) — callers that never want a
  // vein must not call this, so their seeds reproduce exactly.
  const VEIN_MUL = 10;
  function rollVeinTable(rng, weights, veinChance, baseTbl) {
    if (rng() >= veinChance) return baseTbl;
    const offered = [];
    for (let i = 0; i < weights.length; i++) if (weights[i] > 0) offered.push(i);
    if (!offered.length) return baseTbl;
    const veinTier = offered[Math.floor(rng() * offered.length)];
    const boosted = weights.slice();
    boosted[veinTier] *= VEIN_MUL;
    return cumWeights(boosted);
  }
  // One rock's rarity: the plain split first (one draw), then EITHER its
  // plain-rock look (one draw) OR its ore tier (one draw). The caller builds
  // the object — key order differs per spawner and nothing here cares.
  function rollRock(rng, plainP, tbl) {
    if (rng() < plainP) {
      return { plain: true, caveVariant: Math.floor(rng() * PLAIN_ROCK_VARIANT_N) };
    }
    const yieldTier = pickTierFromCum(rng() * tbl.totalW, tbl.tierW);
    return { plain: false, yieldTier, requiredTier: Math.max(1, yieldTier - 1) };
  }

  const idbName = 'mapgame-tiles';
  let idb;
  function openIDB() {
    if (idb) return idb;
    idb = new Promise((resolve, reject) => {
      const req = indexedDB.open(idbName, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('tiles');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return idb;
  }
  async function idbGet(key) {
    try {
      const db = await openIDB();
      return await new Promise((res, rej) => {
        const tx = db.transaction('tiles', 'readonly');
        const req = tx.objectStore('tiles').get(key);
        req.onsuccess = () => res(req.result || null);
        req.onerror = () => rej(req.error);
      });
    } catch { return null; }
  }
  async function idbPut(key, val) {
    try {
      const db = await openIDB();
      await new Promise((res, rej) => {
        const tx = db.transaction('tiles', 'readwrite');
        tx.objectStore('tiles').put(val, key);
        tx.oncomplete = res;
        tx.onerror = () => rej(tx.error);
      });
    } catch {}
  }

  // --- External map data caching -------------------------------------------
  // The OpenFreeMap MVT bytes for a tile are cached in IndexedDB and served
  // from there FOREVER. Age never invalidates anything: once the bytes are
  // older than TILE_REFRESH_MS the only thing that happens is a background
  // re-fetch, and a re-fetch that fails (offline, 5xx, rate limit) changes
  // nothing — the cached bytes stay exactly where they are. So a tile the
  // player has visited once keeps rendering, forever, on any network.
  //
  // The base map barely moves; a month is a generous refresh cadence for a
  // game whose world is streets and buildings. The ONLY thing that clears
  // these records is the menu's "Reset this game", which wipes the tile DB on
  // purpose.
  const TILE_REFRESH_MS = 30 * 24 * 60 * 60 * 1000;   // 30 days
  const _tileRefreshing = new Set();
  // Retry floor for a tile whose build failed (see loadTile). Short enough
  // that walking back into the tile after a blip re-tries it, long enough that
  // a genuinely offline session doesn't rebuild on every call.
  const TILE_RETRY_MS = 3000;
  const _tileFailedAt = new Map();   // "z/x/y" → Date.now() of the last failure

  // ── The live tile URL template (see the TILE_HOST block at the top) ─────
  let _tileUrl = TILE_URL_FALLBACK;
  let _tileUrlPromise = null;          // the memoised resolve, so N tiles at boot ask once
  let _tileUrlAskedAt = 0;             // last time the TileJSON was actually fetched
  function tileUrlTemplate() { return _tileUrl; }
  function tileUrlFor(x, y) {
    return _tileUrl.replace('{z}', Z).replace('{x}', x).replace('{y}', y);
  }
  // A template is only trusted from the host we already load tiles from — a
  // TileJSON is a fetched document, not a config file — and only if it can
  // actually be filled in.
  function validTileTemplate(u) {
    return typeof u === 'string' && u.startsWith(TILE_HOST + '/')
      && u.includes('{z}') && u.includes('{x}') && u.includes('{y}');
  }
  function _applyTileUrl(url, source) {
    if (url === _tileUrl) return false;
    const _bp = (typeof window !== 'undefined' && window.__boot) || null;
    if (_bp) _bp.mark(`tile url from ${source}: ${url.replace(/\{z\}.*$/, '')}`);
    _tileUrl = url;
    return true;
  }
  async function fetchTileJson() {
    if (typeof fetch !== 'function') throw new Error('no fetch');
    const resp = await fetch(TILEJSON_URL, { cache: 'no-cache' });
    if (!resp.ok) throw new Error(`tilejson HTTP ${resp.status}`);
    const j = await resp.json();
    const u = j && Array.isArray(j.tiles) ? j.tiles[0] : null;
    if (!validTileTemplate(u)) throw new Error('tilejson: no usable tiles url');
    return u;
  }
  // Resolve the template: IndexedDB first (a day's worth of trust, with a
  // background refresh once it is older), then the TileJSON, then whatever we
  // already had. Never rejects — a failure to resolve just means the current
  // template stays, which is the pinned one on a first offline run.
  //
  // `force` is the failed-fetch path: skip the cache and ask the host again,
  // but no more than once per TILEJSON_RETRY_MIN_MS, so a host that is simply
  // down is asked once a minute rather than once per tile of the ring.
  function resolveTileUrl(opts) {
    const force = !!(opts && opts.force);
    if (_tileUrlPromise && !force) return _tileUrlPromise;
    if (force && Date.now() - _tileUrlAskedAt < TILEJSON_RETRY_MIN_MS) {
      return _tileUrlPromise || Promise.resolve(_tileUrl);
    }
    const askHost = async () => {
      _tileUrlAskedAt = Date.now();
      try {
        const u = await fetchTileJson();
        _applyTileUrl(u, 'tilejson');
        idbPut(TILEJSON_IDB_KEY, { url: u, fetchedAt: Date.now() });
      } catch (_) { /* keep what we have */ }
      return _tileUrl;
    };
    _tileUrlPromise = (async () => {
      if (!force) {
        const cached = await idbGet(TILEJSON_IDB_KEY);
        if (cached && validTileTemplate(cached.url)) {
          _applyTileUrl(cached.url, 'cache');
          // Stale: use it now, refresh behind the first tile rather than
          // ahead of it — the cached version is far more likely alive than
          // the pinned one, and the boot is waiting on this.
          if (Date.now() - (cached.fetchedAt || 0) > TILEJSON_REFRESH_MS) askHost();
          return _tileUrl;
        }
      }
      return askHost();
    })();
    return _tileUrlPromise;
  }
  // One tile from the network, under the live template. A failure of ANY
  // shape (a 4xx, a 5xx, the service worker's synthetic 504, a CORS-shaped
  // TypeError) re-asks the TileJSON once; if that yields a DIFFERENT template
  // the tile is fetched again under it, because "the snapshot rotated" is
  // exactly what a failure looks like and the only failure we can fix from
  // here. Same template back means the failure is real: rethrow it as-is.
  async function fetchTileResponse(x, y) {
    await resolveTileUrl();
    const under = _tileUrl;
    const attempt = async () => {
      const resp = await fetch(tileUrlFor(x, y));
      if (!resp.ok) throw new Error(`tile ${tileKey(x, y)} HTTP ${resp.status}`);
      return resp;
    };
    try {
      return await attempt();
    } catch (err) {
      await resolveTileUrl({ force: true });
      if (_tileUrl === under) throw err;
      return attempt();
    }
  }
  // Background refresh of a stale record. Never throws, never deletes: on any
  // failure the existing cached bytes remain the tile's source of truth.
  function refreshTileBytes(x, y) {
    const key = tileKey(x, y);
    if (_tileRefreshing.has(key)) return;
    _tileRefreshing.add(key);
    fetchTileResponse(x, y)
      .then((resp) => resp.arrayBuffer())
      .then((buf) => { if (buf) idbPut(key, { bytes: new Uint8Array(buf), fetchedAt: Date.now() }); })
      .catch(() => {})
      .finally(() => _tileRefreshing.delete(key));
  }
  async function fetchTileBytes(x, y) {
    const key = tileKey(x, y);
    const cached = await idbGet(key);
    if (cached) {
      // Records written before the timestamp existed are bare Uint8Arrays.
      // Re-stamp them as of now rather than treating them as infinitely old —
      // otherwise every returning player's whole cache would refresh at once.
      if (!cached.bytes) {
        idbPut(key, { bytes: cached, fetchedAt: Date.now() });
        return { bytes: cached, fromCache: true };
      }
      if (Date.now() - (cached.fetchedAt || 0) > TILE_REFRESH_MS) refreshTileBytes(x, y);
      return { bytes: cached.bytes, fromCache: true };
    }
    const resp = await fetchTileResponse(x, y);
    const buf = new Uint8Array(await resp.arrayBuffer());
    idbPut(key, { bytes: buf, fetchedAt: Date.now() });
    return { bytes: buf, fromCache: false };
  }
  // Test seam: forget the resolved template and its memo.
  function _resetTileUrlForTest() {
    _tileUrl = TILE_URL_FALLBACK;
    _tileUrlPromise = null; _tileUrlAskedAt = 0;
  }

  // Deterministic small PRNG seeded from integers (mulberry32)
  // THE REVIEW SALT — tools/map-review.html's "Reroll", and nothing else.
  // The world has no global seed on purpose (CLAUDE.md "The world is
  // GENERATED"): every stream is seeded from where it is, so a rebuilt tile
  // and another player's phone lay the same world. The review page needs to
  // see OTHER rolls of the same rules, so it may XOR a salt into every seed
  // here. It is 0 in the game, which leaves every seed exactly as it was, and
  // no game code may ever call setReviewSalt (map_review.test.js pins that).
  let _reviewSalt = 0;
  function setReviewSalt(n) { _reviewSalt = (n >>> 0); }
  function makeRng(seed) {
    let a = (seed ^ _reviewSalt) >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function ringSignedArea(ring) {
    let a = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      a += (ring[j].x * ring[i].y - ring[i].x * ring[j].y);
    }
    return a / 2;
  }
  function ringCentroid(ring) {
    let cx = 0, cy = 0, a = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const cross = (ring[j].x * ring[i].y - ring[i].x * ring[j].y);
      cx += (ring[j].x + ring[i].x) * cross;
      cy += (ring[j].y + ring[i].y) * cross;
      a += cross;
    }
    if (a === 0) {
      let sx = 0, sy = 0;
      for (const p of ring) { sx += p.x; sy += p.y; }
      return { x: sx / ring.length, y: sy / ring.length };
    }
    return { x: cx / (3 * a), y: cy / (3 * a) };
  }
  // Building-footprint tidying. Small OSM buildings often rasterize to janky
  // cell sets — two cells touching only at a corner, 1-cell notches, stray
  // crumbs — because a rotated, roughly cell-sized polygon covers few cell
  // centres. Coerce each footprint to a nicer tiling (slightly less accurate,
  // much more readable):
  //   • dropCrumbs (small/house tier): keep only the largest 8-connected
  //     blob — stray 1-2 cell fragments from thin slivers are dropped;
  //   • fill any empty cell with ≥3 occupied orthogonal neighbours (1-wide
  //     notches and 1-cell courtyards read as raster noise at 7 m/cell);
  //   • where a 2×2 block holds exactly a diagonal pair, fill one of its two
  //     empty cells (the better-connected one; tie → top-then-left), so no
  //     part of a building touches the rest only at a corner.
  // The fills iterate to a fixpoint (they only add cells and can never grow
  // past the footprint's bounding box, so it terminates). Deliberately much
  // weaker than bounding-box coercion: genuine L / T / U buildings with
  // recesses ≥2 cells wide are untouched.
  //
  // The synchronous form of the above — the exported API, and what the tests
  // drive, so they exercise the same passes in the same order as the game.
  function assignBuildingFootprints(polys, mvtToCell, w, h, pad = 0) {
    return runSteps(assignBuildingFootprintsSteps(polys, mvtToCell, w, h, pad));
  }
  // `isFree(x, y)` (optional) vetoes an addition — assignBuildingFootprints
  // passes the claim map so tidying can never take a cell that already
  // belongs to a neighbouring building. Omitted → every cell is fair game
  // (the historical behaviour).
  function tidyFootprintCells(cells, dropCrumbs, isFree) {
    const free = typeof isFree === 'function' ? isFree : () => true;
    const key = (x, y) => x + ',' + y;
    let set = new Set(cells.map(([x, y]) => key(x, y)));
    const has = (x, y) => set.has(key(x, y));
    const orthN = (x, y) => (has(x + 1, y) ? 1 : 0) + (has(x - 1, y) ? 1 : 0)
                          + (has(x, y + 1) ? 1 : 0) + (has(x, y - 1) ? 1 : 0);
    if (dropCrumbs && set.size > 1) {
      // Largest 8-connected component (first-found wins ties — input order is
      // the deterministic scanline order, so this is stable across reloads).
      const seen = new Set();
      let best = null;
      for (const start of set) {
        if (seen.has(start)) continue;
        const comp = [start];
        seen.add(start);
        for (let i = 0; i < comp.length; i++) {
          const [x, y] = comp[i].split(',').map(Number);
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const k = key(x + dx, y + dy);
            if (set.has(k) && !seen.has(k)) { seen.add(k); comp.push(k); }
          }
        }
        if (!best || comp.length > best.length) best = comp;
      }
      set = new Set(best);
    }
    for (let changed = true; changed; ) {
      changed = false;
      // Notch / pinhole fill: empty cells bordered on ≥3 orthogonal sides.
      for (const k of [...set]) {
        const [x, y] = k.split(',').map(Number);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ex = x + dx, ey = y + dy;
          if (!has(ex, ey) && orthN(ex, ey) >= 3 && free(ex, ey)) { set.add(key(ex, ey)); changed = true; }
        }
      }
      // Diagonal-only contact: bridge with the empty corner cell that ends up
      // better connected.
      for (const k of [...set]) {
        const [x, y] = k.split(',').map(Number);
        for (const dy of [-1, 1]) {
          if (!has(x + 1, y + dy) || has(x + 1, y) || has(x, y + dy)) continue;
          const n1 = orthN(x + 1, y), n2 = orthN(x, y + dy);
          const ranked = n1 > n2 ? [[x + 1, y], [x, y + dy]] : n2 > n1 ? [[x, y + dy], [x + 1, y]]
                       : dy < 0 ? [[x, y + dy], [x + 1, y]] : [[x + 1, y], [x, y + dy]];  // tie → the upper cell
          // Bridge with the better-connected corner, or the other one if that
          // cell belongs to someone else. If neither is free the diagonal
          // contact stays — never worth an overlap.
          const pick = ranked.find(([px, py]) => free(px, py));
          if (!pick) continue;
          set.add(key(pick[0], pick[1]));
          changed = true;
        }
      }
    }
    return [...set].map(k => k.split(',').map(Number));
  }
  // --- Building footprint assignment (cell-exact, overlap-free) -------------
  // A cell belongs to the building that covers MORE THAN FOOT_COVER_MIN of it.
  // For non-overlapping polygons that rule can't hand one cell to two
  // buildings once the threshold is at/above 50%; at 45% a rare double-claim
  // is possible, so every phase below arbitrates per cell (best cover wins)
  // rather than letting whoever paints last take it. Footprints are therefore
  // disjoint by construction — no building can be partly or wholly swallowed
  // by its neighbour the way the old last-writer-wins owner stamp allowed.
  //
  // Three passes, in order:
  //   1. cover > FOOT_COVER_MIN                      → the building's real body
  //   2. cover × FOOT_RECT_BONUS > FOOT_COVER_MIN,   → squares the footprint off
  //      but only for cells inside the bounding box of what pass 1 claimed
  //   3. any building still empty takes its single best-covered free cell,
  //      provided it covers FOOT_RESCUE_MIN of a cell in total, so a shed
  //      smaller than half a cell still exists instead of silently vanishing
  //   3.5. a HOUSE (tier 9) left with a single cell takes one adjacent free
  //      cell so its footprint is at least FOOT_HOUSE_MIN cells where space
  //      allows — a 1-cell brick pad reads as clutter, not a dwelling
  // then a claim-aware tidy (notches / diagonal-only contacts / crumbs) that
  // may only take cells nobody claimed.
  //
  // Every ordering decision is a pure function of the polygons themselves
  // (cover, then area, then a geometry-derived key) — never their position in
  // the input array. Two tiles rasterizing the same edge-clipped building see
  // the same winner, so footprints agree across the seam.
  const FOOT_COVER_MIN   = 0.45;
  const FOOT_RECT_BONUS  = 1.3;
  const FOOT_RESCUE_MIN  = 0.15;   // total covered area, in cells
  // Minimum footprint for a small (tier-9) house, in cells, when free space
  // allows: a single brick cell under a roof reads as clutter rather than a
  // dwelling, so a 1-cell house takes one adjacent free cell (see pass 3.5).
  const FOOT_HOUSE_MIN   = 2;

  // Fraction (0..1) of cell (cx, cy) covered by `poly`, a ring already in CELL
  // units. Sutherland-Hodgman clip to the cell square, then shoelace — exact,
  // and no sampling error to tune. This runs for every candidate cell of every
  // building on a tile (tens of thousands of calls on a dense tile), so the
  // clip works in two reused flat scratch buffers instead of allocating four
  // vertex arrays per call.
  let _clipA = new Float64Array(64), _clipB = new Float64Array(64);
  // Clip the polygon in `src` (n vertices, x,y interleaved) against one axis-
  // aligned half-plane, writing to `dst`. axis 0 = x, 1 = y; keep points with
  // coord >= edge when sign is +1, <= edge when -1. Returns the new count.
  function _clipHalfPlane(src, n, dst, axis, sign, edge) {
    let out = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const ax = src[j * 2], ay = src[j * 2 + 1];
      const bx = src[i * 2], by = src[i * 2 + 1];
      const av = axis === 0 ? ax : ay, bv = axis === 0 ? bx : by;
      const ain = sign > 0 ? av >= edge : av <= edge;
      const bin = sign > 0 ? bv >= edge : bv <= edge;
      if (bin) {
        if (!ain) {
          const t = (edge - av) / (bv - av);
          dst[out * 2] = ax + (bx - ax) * t; dst[out * 2 + 1] = ay + (by - ay) * t; out++;
        }
        dst[out * 2] = bx; dst[out * 2 + 1] = by; out++;
      } else if (ain) {
        const t = (edge - av) / (bv - av);
        dst[out * 2] = ax + (bx - ax) * t; dst[out * 2 + 1] = ay + (by - ay) * t; out++;
      }
    }
    return out;
  }
  function cellCoverFraction(poly, cx, cy) {
    const need = (poly.length + 8) * 2;
    if (_clipA.length < need) { _clipA = new Float64Array(need); _clipB = new Float64Array(need); }
    let n = poly.length;
    for (let i = 0; i < n; i++) { _clipA[i * 2] = poly[i].x; _clipA[i * 2 + 1] = poly[i].y; }
    n = _clipHalfPlane(_clipA, n, _clipB, 0, +1, cx);      if (n < 3) return 0;
    n = _clipHalfPlane(_clipB, n, _clipA, 0, -1, cx + 1);  if (n < 3) return 0;
    n = _clipHalfPlane(_clipA, n, _clipB, 1, +1, cy);      if (n < 3) return 0;
    n = _clipHalfPlane(_clipB, n, _clipA, 1, -1, cy + 1);  if (n < 3) return 0;
    let s = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      s += _clipA[j * 2] * _clipA[i * 2 + 1] - _clipA[i * 2] * _clipA[j * 2 + 1];
    }
    return Math.abs(s) / 2;   // one cell has area 1 in cell units
  }

  // Tie-break key for two buildings competing for one cell. Derived from the
  // ring's own centroid (quantized), so it is identical in every tile that
  // sees this building and independent of input order.
  function footprintTieKey(cellRing) {
    let sx = 0, sy = 0;
    for (const p of cellRing) { sx += p.x; sy += p.y; }
    const n = cellRing.length || 1;
    return Math.round((sx / n) * 4096) * 8388608 + Math.round((sy / n) * 4096);
  }

  // Assign every building an exclusive set of cells. Returns an array parallel
  // to `polys`: each entry is that building's [[x, y], …] (possibly empty, and
  // possibly including cells outside [0, w) × [0, h) when pad > 0 — callers
  // paint only the in-bounds ones, exactly as before).
  // Assign each building poly the cells it owns, IN STEPS.
  //
  // The per-building cover scan below walks a poly's whole bounding box calling
  // cellCoverFraction per cell, and as one call for every building on a tile it
  // was the single longest block left in a build: a labelled slice profile on a
  // real 14-layer tile named it at 1.3-1.7 s, which is the walking stutter.
  // Yields between buildings; the shape of the answer is untouched.
  // Footprint cells the shape-cleanup pass (4) tidies between two yields.
  const FOOT_TIDY_YIELD_CELLS = 256;
  function* assignBuildingFootprintsSteps(polys, mvtToCell, w, h, pad = 0) {
    const lo = -pad, hiX = w - 1 + pad, hiY = h - 1 + pad;
    const stride = (hiX - lo + 1);
    const cellIdx = (x, y) => (y - lo) * stride + (x - lo);
    const inRange = (x, y) => x >= lo && x <= hiX && y >= lo && y <= hiY;
    // Claim map over the padded grid: -1 = free, else the building's index.
    const owner = new Int32Array(stride * (hiY - lo + 1)).fill(-1);
    const claimed = (x, y) => owner[cellIdx(x, y)] !== -1;

    // Per-building: ring in cell units, candidate covers, tie-break key.
    const info = [];
    for (let _pi = 0; _pi < polys.length; _pi++) {
      if ((_pi & 3) === 3) yield 'building cover scan';
      const bp = polys[_pi], i = _pi;
      const ring = bp.ring.map(p => ({ x: p.x * mvtToCell, y: p.y * mvtToCell }));
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of ring) {
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
      }
      const covers = [];
      const x0 = Math.max(lo, Math.floor(minX)), x1 = Math.min(hiX, Math.floor(maxX));
      const y0 = Math.max(lo, Math.floor(minY)), y1 = Math.min(hiY, Math.floor(maxY));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const c = cellCoverFraction(ring, x, y);
        if (c > 0) covers.push({ x, y, c });
      }
      info.push({ i, bp, ring, covers, key: footprintTieKey(ring), cells: [] });
    }
    // Best cover first; ties by the bigger building, then by geometry key,
    // then by cell — a total order that never consults the input order.
    const byBid = (a, b) => b.c - a.c || b.area - a.area || a.key - b.key
                         || a.y - b.y || a.x - b.x;
    const claim = (bid) => {
      const k = cellIdx(bid.x, bid.y);
      if (owner[k] !== -1) return false;
      owner[k] = bid.i;
      info[bid.i].cells.push([bid.x, bid.y]);
      return true;
    };

    // Pass 1 — the body: cells more than FOOT_COVER_MIN covered.
    const body = [];
    for (const it of info) for (const cv of it.covers) {
      if (cv.c > FOOT_COVER_MIN) body.push({ x: cv.x, y: cv.y, c: cv.c, i: it.i, area: it.bp.areaM2, key: it.key });
    }
    body.sort(byBid);
    // THE PASSES BELOW YIELD TOO, not just the cover scan above. Chunking the
    // scan left the four claim passes as one unbroken tail — 212 ms of it on a
    // 6000-building tile in a headless trace, which is a frozen frame on the
    // phone the moment a dense tile streams in behind the player. Claim order
    // is what makes the answer order-independent, so every break here is
    // strictly a pause: the sequence of claim() calls is untouched.
    for (let _q = 0; _q < body.length; _q++) {
      if ((_q & 511) === 511) yield 'footprint body claim';
      claim(body[_q]);
    }

    // Pass 2 — rectangle bias: inside the bounding box of what pass 1 gave
    // this building, a cell's cover counts FOOT_RECT_BONUS times over. Squares
    // off ragged edges (a rotated house rasterizes to a staircase otherwise)
    // and fills notches, but can only take cells no other building claimed.
    const fill = [];
    let _fi = 0;
    for (const it of info) {
      if (((_fi++) & 63) === 63) yield 'footprint rect bias';
      if (!it.cells.length) continue;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const [x, y] of it.cells) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
      for (const cv of it.covers) {
        if (cv.x < minX || cv.x > maxX || cv.y < minY || cv.y > maxY) continue;
        if (claimed(cv.x, cv.y)) continue;
        const eff = cv.c * FOOT_RECT_BONUS;
        if (eff > FOOT_COVER_MIN) fill.push({ x: cv.x, y: cv.y, c: eff, i: it.i, area: it.bp.areaM2, key: it.key });
      }
    }
    fill.sort(byBid);
    for (let _q = 0; _q < fill.length; _q++) {
      if ((_q & 511) === 511) yield 'footprint fill claim';
      claim(fill[_q]);
    }

    // Pass 3 — one cell each: a building too small (or too awkwardly straddled
    // across four cells) to pass the cover bar anywhere still takes its best
    // free cell, so it exists on the map instead of disappearing. The floor is
    // on the building's TOTAL area, not its best single cell: a 20 m² shed
    // sitting on a cell corner covers only ~13% of each of four cells but is
    // plainly a building, while a sliver clipped to nothing by the tile edge
    // is not.
    const orphans = info.filter(it => !it.cells.length && it.covers.length)
      .map(it => {
        let best = null, total = 0;
        for (const cv of it.covers) {
          total += cv.c;
          if (!best || cv.c > best.c || (cv.c === best.c && (cv.y - best.y || cv.x - best.x) < 0)) best = cv;
        }
        return { it, best, total };
      })
      .filter(o => o.best && o.total >= FOOT_RESCUE_MIN)
      .sort((a, b) => b.best.c - a.best.c || b.it.bp.areaM2 - a.it.bp.areaM2 || a.it.key - b.it.key);
    let _oi = 0;
    for (const o of orphans) {
      if (((_oi++) & 63) === 63) yield 'footprint orphan rescue';
      if (claim({ x: o.best.x, y: o.best.y, i: o.it.i })) continue;
      // First choice taken — fall back to the best cell still free.
      let alt = null;
      for (const cv of o.it.covers) {
        if (claimed(cv.x, cv.y)) continue;
        if (!alt || cv.c > alt.c) alt = cv;
      }
      if (alt) claim({ x: alt.x, y: alt.y, i: o.it.i });
    }

    // Pass 3.5 — two-cell bias for houses (FOOT_HOUSE_MIN). A house that
    // landed a single cell draws a roof shrunk toward one cell, which reads
    // as yard clutter rather than a dwelling. Give it one orthogonally
    // adjacent free cell when there is one: prefer the neighbour the polygon
    // actually covers most, and a house wholly inside its one cell leans
    // toward the side its centroid sits on. Claim-aware (never takes another
    // building's cell) and processed in geometry-key order, so the result
    // stays a pure function of the polygons — two tiles rasterizing the same
    // seam-clipped house grow it the same way.
    const growOrder = info
      .filter(it => it.bp.tier === T.BUILDING
                 && it.cells.length > 0 && it.cells.length < FOOT_HOUSE_MIN)
      .sort((a, b) => a.key - b.key);
    let _gi = 0;
    for (const it of growOrder) {
      if (((_gi++) & 63) === 63) yield 'footprint house grow';
      const [cx0, cy0] = it.cells[0];
      let sx = 0, sy = 0;
      for (const p of it.ring) { sx += p.x; sy += p.y; }
      const rn = it.ring.length || 1;
      const leanX = sx / rn - (cx0 + 0.5), leanY = sy / rn - (cy0 + 0.5);
      let bestN = null, bestScore = -Infinity;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = cx0 + dx, y = cy0 + dy;
        if (!inRange(x, y) || claimed(x, y)) continue;
        let cov = 0;
        for (const cv of it.covers) if (cv.x === x && cv.y === y) { cov = cv.c; break; }
        // Cover dominates (it is ≤ 1, the lean term ≤ ~1 is scaled well under
        // one cover step); the lean only decides between zero-cover neighbours.
        const score = cov * 1000 + dx * leanX + dy * leanY;
        if (score > bestScore) { bestScore = score; bestN = [x, y]; }
      }
      if (bestN) claim({ x: bestN[0], y: bestN[1], i: it.i });
    }

    // Pass 4 — shape cleanup, claim-aware: drop stray crumbs, fill 1-wide
    // notches, bridge diagonal-only contacts; it may only ADD cells nobody else owns, so it can
    // never re-introduce an overlap. Buildings are processed in geometry-key
    // order for the same reason pass 1 is: no dependence on input order.
    const tidyOrder = info.slice().sort((a, b) => a.key - b.key);
    // Yield by CELLS tidied, not buildings: the tidy's cost is its cell sets,
    // and 64 large footprints between two yields was one 40 ms block.
    let _tiCells = 0;
    for (const it of tidyOrder) {
      if (_tiCells >= FOOT_TIDY_YIELD_CELLS) { _tiCells = 0; yield 'footprint tidy'; }
      _tiCells += it.cells.length + 1;
      if (it.cells.length < 2) continue;
      const before = it.cells;
      const after = tidyFootprintCells(before, it.bp.tier === T.BUILDING,
        (x, y) => inRange(x, y) && !claimed(x, y));
      if (after.length === before.length) continue;
      for (const [x, y] of before) owner[cellIdx(x, y)] = -1;
      it.cells = after.filter(([x, y]) => inRange(x, y) && !claimed(x, y));
      for (const [x, y] of it.cells) owner[cellIdx(x, y)] = it.i;
    }
    return info.map(it => it.cells);
  }

  // ── Polygon geometry, once ───────────────────────────────────────────────
  // Even-odd over every ring of a feature (holes subtract). One spelling of
  // the ray test for the whole game: the flora scatter, the zone coverage and
  // the scenic index all read it (an edge is taken a = ring[j], b = ring[i]).
  function pointInRings(rings, x, y) {
    let inside = false;
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[j], b = ring[i];
        if ((a.y > y) !== (b.y > y)) {
          const xint = a.x + (y - a.y) * (b.x - a.x) / (b.y - a.y);
          if (x < xint) inside = !inside;
        }
      }
    }
    return inside;
  }
  // The same ray's crossings along the row at `y`, sorted — a scanline fill
  // walks them once per row instead of asking pointInRings per cell.
  function rowCrossings(rings, y) {
    const crossings = [];
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[j], b = ring[i];
        if ((a.y > y) !== (b.y > y)) {
          crossings.push(a.x + (y - a.y) * (b.x - a.x) / (b.y - a.y));
        }
      }
    }
    crossings.sort((a, b) => a - b);
    return crossings;
  }
  function bboxOf(rings) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const r of rings) for (const p of r) {
      if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
    }
    return { minX, minY, maxX, maxY };
  }

  // Per-biome wild flora (kinds, densities, RNG salts) now lives in the central
  // BIOME_PROFILES registry (src/biome_profiles.js) — see BiomeProfiles.flora().

  // How long one slice of a tile build may hold the main thread before it hands
  // it back. It is a DIAL, not a constant, because the right answer changes:
  // while the boot overlay is up nobody can tap anything, so slicing finely
  // buys nothing and costs a frame per slice — measured at roughly half the
  // build's wall clock. Once the player has the map, responsiveness is the
  // whole point. app.js turns it down via setSliceBudgetMs when the overlay
  // goes, which also arms the controller below.
  const RASTER_SLICE_BOOT_MS = 24;
  // Once the map is live this is a CEILING, not the cost of a slice — see the
  // controller below. 12 was the flat live budget until Sept 2026 and it is
  // what made the first ten seconds of walking stutter end to end: 12 ms of
  // rasterize plus the game's own 5-9 ms of update and draw is over 16.7, so
  // EVERY frame missed vsync for as long as the neighbour ring was streaming,
  // then everything went smooth the moment it finished.
  const RASTER_SLICE_LIVE_MS = 12;
  let RASTER_SLICE_MS = RASTER_SLICE_BOOT_MS;

  // ── How long a slice may ACTUALLY hold the thread ────────────────────────
  // Whatever the frame has left after the game has drawn — a number that
  // differs by an order of magnitude between a desktop and a five-year-old
  // phone, and changes minute to minute with how much is on screen, so it is
  // measured rather than picked.
  //
  // WHY OVERRUNNING IS NEVER WORTH IT. A yield costs a whole frame either way
  // (rAF), so the intuition behind a fat budget is "use the frame you already
  // paid for". But the frame you paid for is 16.7 ms, and going one
  // millisecond past it does not cost one millisecond — it costs the next
  // vsync, the entire 16.7. Slicing at 12 ms on a phone doing 8 ms of game
  // work delivers 12 ms of tile per 33 ms frame; slicing at 7 delivers 7 per
  // 16.7. That is the same throughput at twice the frame rate, which is why
  // this is a fix and not a trade.
  //
  // AIMD, borrowed from congestion control and for the same reason: back off
  // hard on the signal that we overran, creep back up when we did not, and the
  // budget settles just under whatever the device can actually carry.
  //
  // With a plain AIMD it settles by OSCILLATING across the limit — creep up,
  // miss a frame, back off, creep up — which converged on the right average
  // and still dropped one frame in six, because every cycle has to overrun to
  // find the edge again. So it also remembers: a miss records a headroom just
  // under the budget that caused it, and the creep stops there rather than
  // walking into the same wall. That headroom then relaxes back toward the
  // ceiling very slowly (SLICE_PROBE_MS per fitting frame, about one extra
  // millisecond per second of streaming) so a device that frees up — the
  // player walks out of a crowded block — is not stuck on an old measurement.
  // One dropped frame every few seconds instead of every sixth.
  const SLICE_MIN_MS = 3;
  // WHAT COUNTS AS A MISSED FRAME is relative, not a fixed millisecond count.
  // rAF is quantised to the display: frames come back at 16.7, 33.4, 50 … A
  // phone spending 25 ms a frame on its own work is ALREADY at 33.4 with 8 ms
  // of idle inside it, and judged against a flat threshold every one of those
  // frames reads as a miss — pinning the budget at the floor, punishing the
  // tile build for a frame rate it did not cause and wasting the idle it could
  // have spent. So the threshold is the smallest frame seen lately — that
  // quantum — plus a slack.
  //
  // The slack is ABSOLUTE, not a percentage. Spilling always costs exactly one
  // refresh, so the gap to catch is ~16.7 ms wherever the quantum sits; a
  // percentage that separates 16.7 from 33.4 is far too loose by the time the
  // quantum is 50 ms and three refreshes deep. 6 ms is under half a 60 Hz
  // refresh and still clears a 120 Hz one (8.3 → 14.3, catching 16.6).
  // The learned quantum. min() pulls it down the moment a fast frame proves the
  // device can do better; it relaxes back up slowly, so it tracks a device that
  // has genuinely dropped to 30 fps within a couple of seconds without one slow
  // frame being able to move it.
  const SLICE_FRAME_SLACK_MS = 6;
  const SLICE_BASE_RELAX_MS = 0.25;
  let _sliceBaseMs = 16.7;
  const SLICE_BACKOFF = 0.7;      // multiplicative decrease, on a missed frame
  const SLICE_CREEP_MS = 0.5;     // additive increase, on a frame that fitted
  const SLICE_SAFE_FRAC = 0.9;    // how far under a budget that missed we settle
  const SLICE_PROBE_MS = 0.02;    // how fast that ceiling relaxes back up
  let _sliceMs = RASTER_SLICE_BOOT_MS;
  // The largest budget believed to fit. Infinity = nothing has missed yet, so
  // the dial itself is the only limit.
  let _sliceSafeMs = Infinity;
  // Off during the boot: the overlay is up, nobody can tap anything, and there
  // is no frame rate worth protecting — a controller would only slow the boot
  // down. app.js turns it on with the map (setSliceBudgetMs).
  let _sliceAdapt = false;
  function setSliceBudgetMs(ms, adapt = true) {
    RASTER_SLICE_MS = clamp(+ms || RASTER_SLICE_LIVE_MS, 4, 60);
    _sliceMs = RASTER_SLICE_MS;
    _sliceSafeMs = Infinity;
    _sliceBaseMs = 16.7;
    _sliceAdapt = !!adapt;
  }
  function sliceBudgetMs() { return _sliceMs; }
  // The frame time above which a slice is judged to have spilled into the next
  // frame. Exported so a test can drive the controller with a real device model
  // rather than a copy of this number.
  function sliceFrameTargetMs() { return _sliceBaseMs + SLICE_FRAME_SLACK_MS; }
  // `frameMs` is the whole frame the slice took part in: our own hold plus
  // everything between handing the thread back and getting it again.
  function noteSliceFrame(frameMs) {
    if (!_sliceAdapt || !(frameMs > 0)) return _sliceMs;
    _sliceBaseMs = Math.min(frameMs, _sliceBaseMs + SLICE_BASE_RELAX_MS);
    const target = sliceFrameTargetMs();
    if (frameMs > target) {
      _sliceSafeMs = Math.max(SLICE_MIN_MS, _sliceMs * SLICE_SAFE_FRAC);
      _sliceMs = Math.max(SLICE_MIN_MS, _sliceMs * SLICE_BACKOFF);
    } else {
      // It fitted inside the quantum. (No separate hysteresis band — the
      // remembered headroom below is what stops this walking into the wall.)
      if (_sliceSafeMs < RASTER_SLICE_MS) _sliceSafeMs += SLICE_PROBE_MS;
      _sliceMs = Math.min(RASTER_SLICE_MS, _sliceSafeMs, _sliceMs + SLICE_CREEP_MS);
    }
    return _sliceMs;
  }
  const _now = () => (typeof performance !== 'undefined' && performance.now)
    ? performance.now() : Date.now();

  // ── POI tables (the `poi` layer pass in rasterizeTileSteps) ──────────────
  // Which POI classes spawn a chest. Parking POIs are diverted to treasure
  // marks instead (see the poi branch).
  const POI_USEFUL = new Set([
    // food / commerce (chest drops PRODUCE for food; SEEDS for commerce)
    'restaurant','cafe','fast_food','grocery','butcher','ice_cream',
    'alcohol_shop','beer','bakery','shop',
    'supermarket','convenience','farm',
    // specialty shops — themed loot via shopCategory()
    'florist','garden_centre','books','pet','fountain',
    // civic / attractions
    'attraction','museum','library','town_hall',
    'pharmacy','hospital','dentist',
    'place_of_worship','school','college',
    'park','garden','playground','pitch',
    // low-tier street furniture (a gate is NOT a chest: it is a spawn point
    // with two posts — POI_GATE_CLASS below)
    'bus','fuel','lodging',
    // ── Civic services (lowtier; the bins are BARRELS — loot.js isBarrel)
    'waste_basket','post','recycling','drinking_water','toilets',
    // ── Athletic facilities (park-class chests)
    'sports_centre','yoga','swimming','swimming_pool','bowls',
    'running','ice_rink','stadium',
    // ── Restful shelters (lowtier chest + safe rest spot)
    'shelter','dog_park','picnic_site',
    // ── Culture (civic chests; public art is quota-seeded like every class
    // — seedChestTiers). An information board is NOT a chest: it reads a
    // Book page (POI_INFO_CLASS below). Memorials, monuments and cemeteries
    // are NOT here and never will be: they are SENSITIVE (isSensitivePoi).
    'art_gallery','cinema','theatre',
    // ── Authority buildings (civic chests, high-tier feel)
    'police','fire_station','harbor',
    // ── atm → the pot of gold (a daily coin burst), bicycle_parking → the
    // bike rack (a daily stick-walk boost) — loot.js isPotOfGold /
    // isBikeRack; they still spawn as chest objects here so persistent ids
    // work. (motorcycle_parking is NOT here — like car parking it's
    // diverted to a buried-treasure X below, not a chest.)
    'bicycle_parking','atm',
  ]);
  // Two POI classes that are PLACES but not chests, placed after the road
  // mask is resolved (see the gate / notice-board pass in rasterizeTileSteps
  // and injectTileBin):
  //   gate        → a pair of GATE POSTS round a spawn point: a foe rises
  //                 there each UTC day (lairs.js 'gate' tier). gatePostsAt.
  //   information → a NOTICE BOARD that reads one Book page, once per board
  //                 (interactables.js INTERACTABLES.infoboard — the
  //                 waystone's lane, spent in save.opened).
  const POI_GATE_CLASS = 'gate';
  const POI_INFO_CLASS = 'information';
  // Sidecar / Overpass POI kinds that are road furniture and no PLACE at all —
  // never a chest. SX_CHEST_POI no longer maps them; injectTileBin also drops
  // them from a bin cached before Sep 2026, which still carries them.
  const SX_NOT_A_PLACE = new Set(['traffic_signals', 'crossing', 'stop', 'fence', 'powerline', 'carport']);
  // ── THE SENSITIVE-PLACE TABLE (Sep 2026) — the ONE answer to "may this
  // real place become game content?". A place of grief or of another faith's
  // prayer MINTS NOTHING: no chest, no macro stall, no zone anchor (zones.js
  // anchorOf asks this first), no enemy, no hoard — like SX_NOT_A_PLACE, but
  // for the opposite reason: not too trivial to be a place, too serious to be
  // a prize. Players of location games were sent to Holocaust sites and onto
  // Stolpersteine; this is the line that stops ours. Every reader of a POI
  // (the MVT poi pass, the sidecar / Overpass bin, a bin cached before this
  // table, the zone anchors) asks isSensitivePoi — never its own list.
  //   classes  — an MVT poi `class` / sidecar `kind` that is sensitive whole
  //   osm      — an OSM tag (Overpass / sidecar `tags`) whose presence, or
  //              listed value, marks the point: every memorial=* (the
  //              Stolperstein is memorial=stolperstein), historic memorial /
  //              monument / tomb, amenity=grave_yard, landuse=cemetery
  //   name     — a name that says what the tags may not (a Gedenkstätte, a
  //              Holocaust museum tagged only tourism=museum). Deliberately
  //              narrow: "Memorial Park" / "Memorial Hospital" are ordinary
  //              places and stay so.
  // A PLACE OF WORSHIP is sensitive unless it is a CHRISTIAN one: the chapel
  // stall and the churchyard are invented Christian scenery, and wearing them
  // over a synagogue, mosque or temple is exactly the offence. OpenMapTiles
  // carries the OSM `religion` tag as the poi `subclass` (christian, jewish,
  // muslim, buddhist, …) and omits it when OSM has none. A place with NO
  // religion given is a church only when its NAME says so (`churchName`:
  // "… Church", "… Kirche", "St … Chapel", "Gospel …", a denomination) —
  // otherwise it is unknown, and unknown fails CLOSED: it mints nothing.
  // (22 of Kelowna's 30 are untagged, and not all of those are churches.) A
  // subclass that IS given always wins over the name ("Church of
  // Scientology" is tagged scientologist and stays quiet).
  // What this is NOT: the quiet LAND (QUIET_LAND) — that is per cell over a
  // polygon; this is per point, deciding what a POI mints.
  const SENSITIVE_POI = {
    classes: new Set(['memorial', 'monument', 'cemetery', 'grave_yard']),
    osm: { memorial: true, historic: new Set(['memorial', 'monument', 'tomb']),
      amenity: new Set(['grave_yard']), landuse: new Set(['cemetery']) },
    name: /holocaust|shoah|genocide|stolperstein|gedenkst(?:ä|ae)tte|mahnmal|konzentrationslager|concentration camp/i,
    worshipClass: 'place_of_worship',
    worshipOk: new Set(['christian']),
    churchName: /\b(church|chapel|kirche|kapelle|cathedral|parish|gospel|baptist|lutheran|anglican|catholic|methodist|presbyterian|pentecostal|evangelical|evangelisch|abbey|basilica)\b/i,
  };
  // The faith a place of worship is taken to have: its subclass / religion
  // tag, else 'christian' when its name names a church, else '' (unknown).
  function worshipFaith(tags) {
    if (!tags) return '';
    const faith = tags.subclass || tags.religion;
    if (faith && faith !== SENSITIVE_POI.worshipClass) return faith;
    return (tags.name && SENSITIVE_POI.churchName.test(tags.name)) ? 'christian' : '';
  }
  // `tags`: an MVT poi's { class, subclass, name } or an OSM tag set (both
  // may be merged — the sidecar hands { class: kind, ...tags }).
  function isSensitivePoi(tags) {
    if (!tags) return false;
    const S = SENSITIVE_POI;
    if (S.classes.has(tags.class)) return true;
    for (const k in S.osm) {
      const v = tags[k];
      if (v == null || v === '' || v === 'no') continue;
      if (S.osm[k] === true || S.osm[k].has(v)) return true;
    }
    if ((tags.class === S.worshipClass || tags.amenity === S.worshipClass)
        && !S.worshipOk.has(worshipFaith(tags))) return true;
    return !!(tags.name && S.name.test(tags.name));
  }
  // ── QUIET LAND (Sep 2026) — polygons whose cells host NOTHING. Military
  // ground (a lure over a guarded fence), railway land (onto the tracks),
  // First Nations reserve land (not ours to fill with loot: OpenMapTiles
  // carries boundary=aboriginal_lands as a `boundary` polygon), and a real
  // CEMETERY (grave land is quiet green space — its lawn draws, nothing on it
  // spawns, and no invented headstone may stand on a real grave). Keyed by
  // layer → classes. The land keeps its LOOK (classifyPolygon); rasterize
  // stamps these into `quietMask` (a Uint8Array over the tile's cells, 1 =
  // quiet), carried on the entry as entry.quietMask and handed to isSpawnCell
  // as opts.quiet. Per cell, from polygons the tile's own layers carry, so a
  // cell is decided by the one tile that owns it (seam-safe). A rebuild re-
  // derives it like roadMask. What this is NOT: a terrain code, nor the
  // point table above (a memorial's POINT mints nothing; the land round it is
  // whatever it is).
  const QUIET_LAND = {
    landuse: new Set(['military', 'railway', 'cemetery']),
    boundary: new Set(['aboriginal_lands']),
    park: new Set(['aboriginal_lands']),
  };
  function isQuietLand(layerName, tags) {
    const row = QUIET_LAND[layerName];
    return !!(row && tags && row.has(tags.class));
  }
  // Stamp every quiet polygon the tile's layers carry into `mask` (w·h).
  // Yields per feature and per 8 rows (forEachPolygonCellSteps) — a reserve
  // polygon can cover the whole tile. Returns the count of quiet cells.
  //   `grid` (optional): the tile's terrain grid, painted by the time this
  // runs. Same "paint wins" carve-out as RESTRICTED (COMMERCIAL WELCOMES
  // VISITORS, Sep 2026): military / railway land (landuse) is quiet only
  // where the ground still actually paints as that class's own look
  // (T.WASTELAND) — a commercial polygon overlapping a stray railway/
  // military polygon in the source data wins the cell and reopens it.
  // cemetery (real grave land, always quiet regardless of any overlap) and
  // the boundary/park aboriginal_lands rows are NOT paint-gated: they have
  // no "own paint" of their own to compare against (boundary paints
  // nothing; park always paints T.PARK, so gating on it would be a no-op at
  // best) and reserve land is never ours to reopen on a data coincidence.
  function* stampQuietLandSteps(layers, mask, w, h, mvtToCell, grid) {
    let n = 0;
    for (const L of layers || []) {
      if (!L || !QUIET_LAND[L.name] || !L.features) continue;
      const gated = grid && L.name === 'landuse';
      for (const f of L.features) {
        if (f.type !== 3 || !f.geom || !isQuietLand(L.name, f.tags)) continue;
        const c = f.tags.class;
        const checkPaint = gated && (c === 'military' || c === 'railway');
        yield 'quiet land';
        yield* forEachPolygonCellSteps(w, h, f.geom, mvtToCell, (x, y) => {
          const i = y * w + x;
          if (checkPaint && grid[i] !== T.WASTELAND) return;
          if (!mask[i]) { mask[i] = 1; n++; }
        });
      }
    }
    return n;
  }
  // ── THE SPAWN GATE'S MASK: entry.spawnWhy (see isSpawnCell) ───────────────
  // One pass beside the road mask, over the tile's own layers, per cell of the
  // tile's own grid — generated, the same for every player. The numbers:
  //   SPAWN_SENSITIVE_BUFFER_M round a sensitive POI (isSensitivePoi) and real
  //                            cemetery land
  //   churchyardBufferM()      round a church that stands ON cemetery land:
  //                            its whole would-be churchyard halo (Zones'
  //                            stones R, jitter included — one number both
  //                            read), so no headstone of it stands on the
  //                            streets round a real graveyard
  // Buffers are measured on a grid SPAWN margin cells wider than the tile, off
  // the geometry the tile's MVT carries past its edge, so a source just over
  // the seam still buffers this side of it (as far as the MVT buffer reaches).
  // Distances are a chamfer (1, √2) transform — deterministic arithmetic.
  // (No HOUSE buffer since Sep 2026: a lot's own yard is already covered by
  // PRIVATE (no public frontage) and BEHIND_HOUSE — a flat 40 m ring round
  // every house on top of those was the owner's call to drop.)
  const SPAWN_SENSITIVE_BUFFER_M = 40;
  // RESTRICTED LAND — the hard RESTRICTED reason over the whole polygon
  // (landuse classes): hospital, railway, military, garages and building
  // sites. (Quiet land — QUIET_LAND — folds in beside it.) School grounds are
  // NOT here, and carry no reason at all since Sep 2026 (the owner: most
  // school fields are public, and the typed SCHOOL reason plus its
  // school-hours timing were dropped along with it); KINDERGARTEN grounds
  // stay hard.
  const RESTRICTED_LAND = new Set(['hospital', 'railway', 'military', 'garages', 'construction']);
  const KINDERGARTEN_LAND = new Set(['kindergarten']);
  // (No CHILD buffer since Sep 2026: a radius round a school spilled into the
  // parks beside it. Kindergarten grounds are hard; a playground is public
  // ground.)
  // COMMERCIAL WELCOMES VISITORS (owner, Sep 2026): a shop wants foot
  // traffic, so commercial / retail ground stays open even when its polygon
  // happens to overlap a RESTRICTED or KINDERGARTEN one in the source data
  // (a kindergarten's own play-yard polygon overlapping the block a nearby
  // shop's landuse polygon also covers; a hospital campus with a pharmacy's
  // retail unit inside it). RESTRICTED / KINDERGARTEN are stamped only on
  // the cells whose FINAL terrain paint still agrees with the class's own
  // look (classifyPolygon: hospital and railway/military/garages/
  // construction alike are never COMMERCIAL's own paint) — the same "paint
  // wins" discipline as BEHIND_HOUSE's park-family carve-out. A cell a later
  // polygon (or a civic-building pad) repaints COMMERCIAL is judged as
  // commercial ground, not as whatever used to be under it. hospital IS its
  // own COMMERCIAL paint, so a real hospital campus keeps its RESTRICTED —
  // this only lifts the reason where the ground no longer reads as its
  // source class at all.
  function restrictedExpectedTerrain(c) {
    return c === 'hospital' ? T.COMMERCIAL : T.WASTELAND;   // railway/military/garages/construction
  }
  // ── COMMERCIAL GROUND IS COLOURED BY ITS NEAREST POI (owner, Sep 2026) ──
  // The tile carries no use for a commercial / industrial polygon (landuse has
  // only `class`, buildings no use tag): the POIs are the only signal. So the
  // exterior ground painted T.COMMERCIAL or T.INDUSTRIAL (COMMERCIAL_GROUND —
  // retail and hospital landuse included; a hospital keeps its RESTRICTED
  // besides) takes the KIND of its nearest POI, a Voronoi colouring:
  //   a PUBLIC POI nearest   → no reason (a shop's forecourt welcomes you)
  //   a PRIVATE POI nearest  → the hard PRIVATE reason (an office park, a
  //                            hotel's grounds, a clinic's lot)
  //   no POI of either kind within NEAREST_POI_MAX_M → PRIVATE (a yard nobody
  //                            vouches for)
  // It is the PRIVATE lane (the same reason, the same POI-chest lift in
  // isSpawnCell / landRefused), with a different test for WHO vouches: on lot
  // land a public anchor within SPAWN_FRONTAGE, on commercial ground the
  // nearest POI. It REPLACED the industrial ROADSIDE_ONLY frontage rule;
  // lots keep theirs. Building interiors are TERRAIN, untouched.
  // Distance is Euclidean in the tile's own cell grid, over EVERY poi-layer
  // point in the tile bytes, buffer included (the poi buffer, ~370 m, is past
  // NEAREST_POI_MAX_M), so both tiles of a seam give a cell the same answer.
  const COMMERCIAL_GROUND = new Set([T.COMMERCIAL, T.INDUSTRIAL]);
  const NEAREST_POI_MAX_M = 150;
  // THE ONE TABLE: which POI classes (MVT `class`, else `subclass`; OSM
  // sidecar values alike) say who is welcome on the ground round them.
  // A class NOT listed is NO SIGNAL and seeds nothing — street furniture
  // (parking, bicycle_parking, bollard, gate, waste_basket, recycling,
  // entrance, bus stop, …) and open-space kinds (park, pitch, playground)
  // say nothing about whose lot the ground is. Parking in particular is both
  // a mall's customer lot and a works' staff lot.
  const COMMERCIAL_POI_KIND = (() => {
    const pub = [
      // shops
      'shop', 'grocery', 'supermarket', 'convenience', 'bakery', 'butcher', 'alcohol_shop', 'beer',
      'clothing_store', 'clothes', 'shoes', 'books', 'gift', 'florist', 'garden_centre', 'pet',
      'jewelry', 'jeweler', 'hairdresser', 'beauty', 'laundry', 'doityourself', 'hardware',
      'electronics', 'mobile_phone', 'sports', 'toys', 'stationery', 'optician', 'chemist',
      'car', 'car_repair', 'bicycle', 'bicycle_rental', 'car_rental', 'music', 'variety_store',
      'kiosk', 'copyshop', 'travel_agency', 'tailor', 'tobacco', 'ticket', 'marketplace', 'market',
      'mall', 'department_store', 'fuel',
      // food and drink
      'restaurant', 'cafe', 'fast_food', 'ice_cream', 'bar', 'pub', 'biergarten', 'nightclub',
      // services open to the public
      'bank', 'atm', 'pharmacy', 'post', 'library', 'town_hall', 'community_centre',
      // culture, leisure and transport halls
      'cinema', 'theatre', 'museum', 'art_gallery', 'attraction', 'zoo', 'aquarium', 'casino',
      'sports_centre', 'fitness_centre', 'yoga', 'swimming_pool', 'ice_rink', 'bowls', 'climbing',
      'escape_game', 'railway', 'station', 'ferry_terminal',
    ];
    const priv = [
      'office', 'company', 'lodging', 'hotel', 'motel', 'hostel',
      'hospital', 'clinic', 'doctors', 'dentist', 'veterinary',
      'school', 'college', 'university', 'kindergarten',
      'police', 'fire_station', 'prison', 'border_control', 'embassy', 'courthouse',
      'place_of_worship', 'hackerspace',
      'industrial', 'warehouse', 'works', 'factory', 'depot',
    ];
    const m = new Map();
    for (const c of pub) m.set(c, 1);
    for (const c of priv) m.set(c, 2);
    return m;
  })();
  const POI_PUBLIC = 1, POI_PRIVATE = 2;
  // 0 (no signal) / POI_PUBLIC / POI_PRIVATE for a poi's tags.
  function commercialPoiKind(tags) {
    if (!tags) return 0;
    return COMMERCIAL_POI_KIND.get(tags.class) || COMMERCIAL_POI_KIND.get(tags.subclass) || 0;
  }
  // THE NEAREST-POI FIELD: per cell of the w×w grid, the kind (0 none within
  // NEAREST_POI_MAX_M / POI_PUBLIC / POI_PRIVATE) of its nearest signalling
  // POI. A label-propagating two-pass distance transform (8SSEDT: each cell
  // keeps its nearest SEED, compared by exact integer squared Euclidean
  // distance) over a grid widened by the reach, so a POI past the seam still
  // claims this side — O(cells), yielded. Ties go PRIVATE, then to the
  // lower seed cell (row, col) — translation-invariant, so seam-safe.
  // Returns { kind: Uint8Array(w*w), seeds: [{ ix, iy, kind, cls }] } (seeds
  // in tile cells, possibly outside 0..w-1 — the map-review overlay draws
  // them), or null when no cell is commercial ground (`grid` given).
  function* commercialPoiFieldSteps(layers, w, mvtToCell, mvtToM, grid) {
    const NN = w * w;
    if (grid) {
      let any = false;
      for (let i = 0; i < NN && !any; i++) if (COMMERCIAL_GROUND.has(grid[i])) any = true;
      if (!any) return null;
    }
    const cellM = mvtToM / mvtToCell;
    const R = NEAREST_POI_MAX_M / cellM, R2 = R * R;
    const MC = Math.ceil(R) + 1, E = w + 2 * MC, EE = E * E;
    const sx = [], sy = [], sk = [], seeds = [];
    const lab = new Int32Array(EE).fill(-1);
    let poiL = null;
    for (const L of layers || []) if (L && L.name === 'poi') poiL = L;
    const better = (s, t, x, y) => {   // is seed s nearer (x,y) than seed t?
      if (t < 0) return true;
      const ds = (sx[s] - x) * (sx[s] - x) + (sy[s] - y) * (sy[s] - y);
      const dt = (sx[t] - x) * (sx[t] - x) + (sy[t] - y) * (sy[t] - y);
      if (ds !== dt) return ds < dt;
      if (sk[s] !== sk[t]) return sk[s] === POI_PRIVATE;
      return sy[s] !== sy[t] ? sy[s] < sy[t] : sx[s] < sx[t];
    };
    let k = 0;
    for (const f of (poiL && poiL.features) || []) {
      if (f.type !== 1 || !f.geom) continue;
      const kind = commercialPoiKind(f.tags);
      if (!kind) continue;
      if ((++k & 255) === 0) yield 'commercial poi seeds';
      for (const ring of f.geom) {
        const p = ring && ring[0];
        if (!p) continue;
        const ix = Math.floor(p.x * mvtToCell), iy = Math.floor(p.y * mvtToCell);
        const x = ix + MC, y = iy + MC;
        if (x < 0 || y < 0 || x >= E || y >= E) continue;
        const s = sx.length;
        sx.push(x); sy.push(y); sk.push(kind);
        seeds.push({ ix, iy, kind, cls: f.tags.class });
        const e = y * E + x;
        if (better(s, lab[e], x, y)) lab[e] = s;
      }
    }
    const kindOut = new Uint8Array(NN);
    if (!sx.length) return { kind: kindOut, seeds };
    const take = (e, x, y, n) => { const t = lab[n]; if (t >= 0 && better(t, lab[e], x, y)) lab[e] = t; };
    for (let y = 0; y < E; y++) {
      if ((y & 15) === 15) yield 'commercial poi field';
      const row = y * E;
      for (let x = 0; x < E; x++) {
        const e = row + x;
        if (x > 0) take(e, x, y, e - 1);
        if (y > 0) {
          take(e, x, y, e - E);
          if (x > 0) take(e, x, y, e - E - 1);
          if (x < E - 1) take(e, x, y, e - E + 1);
        }
      }
      for (let x = E - 2; x >= 0; x--) take(row + x, x, y, row + x + 1);
    }
    for (let y = E - 1; y >= 0; y--) {
      if ((y & 15) === 0) yield 'commercial poi field';
      const row = y * E;
      for (let x = E - 1; x >= 0; x--) {
        const e = row + x;
        if (x < E - 1) take(e, x, y, e + 1);
        if (y < E - 1) {
          take(e, x, y, e + E);
          if (x < E - 1) take(e, x, y, e + E + 1);
          if (x > 0) take(e, x, y, e + E - 1);
        }
      }
      for (let x = 1; x < E; x++) take(row + x, x, y, row + x - 1);
    }
    for (let y = 0; y < w; y++) {
      for (let x = 0; x < w; x++) {
        const X = x + MC, Y = y + MC, s = lab[Y * E + X];
        if (s < 0) continue;
        const d2 = (sx[s] - X) * (sx[s] - X) + (sy[s] - Y) * (sy[s] - Y);
        if (d2 <= R2) kindOut[y * w + x] = sk[s];
      }
    }
    return { kind: kindOut, seeds };
  }
  // The same field, run to completion (tools, tests).
  function commercialPoiField(layers, w, mvtToCell, mvtToM, grid) {
    return runSteps(commercialPoiFieldSteps(layers, w, mvtToCell, mvtToM, grid));
  }
  // ORCHARDS: only the EDGE hosts — a cell within
  // FARM_EDGE_CELLS (Chebyshev) of the source field footprint boundary is open
  // (every class may spawn there, same as any other open ground, since the
  // typed FARM reason was dropped Sep 2026); deeper in is the hard
  // FARM_INTERIOR reason. Later road / POI paint cannot create internal edges.
  const FARM_TYPES = new Set([T.FARMLAND, T.ORCHARD]);
  // Which `park`-layer polygons supply park ground, coverage and house-rule
  // eligibility. The layer also carries protected_area, historic and
  // conservation designations drawn over whole neighbourhoods.
  // Landuse / landcover park, playground,
  // pitch, garden, beach … polygons always are.
  const PARK_FAMILY_LAYER_CLASS = new Set(['park', 'nature_reserve', 'national_park']);
  // Named park labels can live only in the `park` layer (Wilson Creek
  // Linear Park is a nature_reserve). Feed these points through the ordinary
  // POI pipeline so they receive one place, grove anchor and variant. Never
  // derive a centre from clipped polygons: neighbouring tiles must agree.
  function parkPoiLayer(poiLayer, parkLayer) {
    const original = poiLayer && poiLayer.features || [], additions = [];
    const ids = new Set(), points = new Set();
    for (const f of original) {
      if (f.type !== 1 || !BiomeProfiles.isParkPoi(f.tags)) continue;
      if (f.id != null) ids.add(f.id);
      for (const ring of f.geom || []) if (ring[0]) points.add(`${ring[0].x},${ring[0].y}`);
    }
    const buffer = typeof Zones !== 'undefined' ? Zones.POI_BUFFER_UNITS : 1024;
    for (const f of parkLayer && parkLayer.features || []) {
      if (f.type !== 1 || !f.tags || !f.tags.name || !PARK_FAMILY_LAYER_CLASS.has(f.tags.class)
          || isSensitivePoi(f.tags) || (f.id != null && ids.has(f.id))) continue;
      const geom = (f.geom || []).filter(ring => {
        const p = ring[0];
        // The park label buffer is wider than the POI buffer. Use the same
        // observation window so crowding and merge decisions stay seam-safe.
        return p && p.x >= -buffer && p.y >= -buffer
          && p.x < TILE_EXTENT + buffer && p.y < TILE_EXTENT + buffer
          && !points.has(`${p.x},${p.y}`);
      });
      if (!geom.length) continue;
      additions.push({ ...f, geom, tags: { ...f.tags, class: 'park', subclass: 'park' } });
      if (f.id != null) ids.add(f.id);
      for (const ring of geom) points.add(`${ring[0].x},${ring[0].y}`);
    }
    return additions.length ? { ...(poiLayer || { name: 'poi' }), features: original.concat(additions) } : poiLayer;
  }
  const FARM_EDGE_CELLS = 2;
  // How far (cells) the behind-a-house line is walked; a lot cell further
  // than this from its nearest public way is left to the frontage rule.
  const BEHIND_HOUSE_MAX_CELLS = 12;
  // A PRIVATE WAY vouches for nobody: a driveway, access=no (OpenMapTiles
  // folds private into it) or foot=private|no. It still paints and still
  // masks its band — it just is not frontage.
  function isPrivateWay(tags) {
    if (!tags) return false;
    if (tags.service === 'driveway') return true;
    if (tags.access === 'no' || tags.access === 'private') return true;
    return tags.foot === 'private' || tags.foot === 'no';
  }
  // A missing access tag is unknown, never proof a pier welcomes visitors.
  // Read pedestrian-specific permission when present; explicit prohibitions
  // on either field win. Ownership/name/nearby park geometry do not prove access.
  function isPublicPier(tags) {
    if (!tags || tags.class !== 'pier' || isPrivateWay(tags)) return false;
    const permission = tags.foot == null ? tags.access : tags.foot;
    return permission === 'yes' || permission === 'public' || permission === 'designated';
  }
  function churchyardBufferM() {
    const Z = (typeof Zones !== 'undefined') ? Zones : null;
    const k = Z && Z.ZONE_KINDS && Z.ZONE_KINDS.stones;
    return k ? k.R * (1 + (Z.EDGE_JITTER || 0)) : 100;
  }
  // Two-pass chamfer distance (in cells) over an E×E Float32 grid whose
  // sources hold 0 and everything else a big number.
  function* chamferSteps(d, E) {
    const D = Math.SQRT2;
    for (let y = 0; y < E; y++) {
      if ((y & 31) === 31) yield 'spawn gate distance';
      const row = y * E;
      for (let x = 0; x < E; x++) {
        const i = row + x;
        let v = d[i];
        if (x > 0 && d[i - 1] + 1 < v) v = d[i - 1] + 1;
        if (y > 0) {
          if (d[i - E] + 1 < v) v = d[i - E] + 1;
          if (x > 0 && d[i - E - 1] + D < v) v = d[i - E - 1] + D;
          if (x < E - 1 && d[i - E + 1] + D < v) v = d[i - E + 1] + D;
        }
        d[i] = v;
      }
    }
    for (let y = E - 1; y >= 0; y--) {
      if ((y & 31) === 0) yield 'spawn gate distance';
      const row = y * E;
      for (let x = E - 1; x >= 0; x--) {
        const i = row + x;
        let v = d[i];
        if (x < E - 1 && d[i + 1] + 1 < v) v = d[i + 1] + 1;
        if (y < E - 1) {
          if (d[i + E] + 1 < v) v = d[i + E] + 1;
          if (x < E - 1 && d[i + E + 1] + D < v) v = d[i + E + 1] + D;
          if (x > 0 && d[i + E - 1] + D < v) v = d[i + E - 1] + D;
        }
        d[i] = v;
      }
    }
  }
  // ctx: { layers, grid, w, h, mvtToCell, mvtToM, roadMask, roadClass,
  // quietMask }. Returns the Uint16Array of reason bits (SPAWN_WHY).
  function* stampSpawnWhySteps(ctx) {
    const { layers, grid, w, h, mvtToCell, mvtToM, roadMask, roadClass, quietMask } = ctx;
    const NN = w * h;
    const mask = new Uint16Array(NN);
    const byName = {};
    for (const L of layers || []) if (L && L.name) byName[L.name] = L;
    const feats = (n) => (byName[n] && byName[n].features) || [];
    const churchM = churchyardBufferM();
    const M = Math.max(FARM_EDGE_CELLS, Math.ceil(Math.max(SPAWN_SENSITIVE_BUFFER_M, churchM) / CELL_M));
    const E = w + 2 * M, EE = E * E;
    const extOf = (p) => {
      const x = Math.floor(p.x * mvtToCell) + M, y = Math.floor(p.y * mvtToCell) + M;
      return (x >= 0 && y >= 0 && x < E && y < E) ? y * E + x : -1;
    };
    const INF = 1e9;
    const newDist = () => { const d = new Float32Array(EE); d.fill(INF); return d; };
    const sensD = newDist(), churchD = newDist();
    let nSens = 0, nChurch = 0;
    const cemExt = new Uint8Array(EE);
    const sensPt = new Uint8Array(NN);
    // Per-cell land reasons stamped straight off a polygon (RESTRICTED,
    // KINDERGARTEN).
    const land = new Uint16Array(NN);
    // Preserve field geometry beyond the tile edge: paint and tile seams do
    // not create public orchard frontage. Adjacent fields share one footprint.
    const fieldSource = new Uint8Array(EE);
    // ── Landuse polygons: cemetery (sensitive land), restricted land,
    // kindergarten grounds.
    let k = 0;
    for (const f of feats('landuse')) {
      if (f.type !== 3 || !f.geom || !f.tags) continue;
      const c = f.tags.class;
      const cem = c === 'cemetery';
      const why = RESTRICTED_LAND.has(c) ? W_.RESTRICTED : KINDERGARTEN_LAND.has(c) ? W_.KINDERGARTEN : 0;
      const rst = !!why;
      if (!cem && !rst) continue;
      if ((++k & 7) === 0) yield 'spawn gate landuse';
      if (cem) {
        yield* forEachPolygonCellSteps(E, E, f.geom, mvtToCell, (x, y) => {
          const i = y * E + x;
          cemExt[i] = 1; sensD[i] = 0; nSens++;
        }, M);
      }
      if (rst) {
        const expect = why === W_.RESTRICTED ? restrictedExpectedTerrain(c) : T.SCHOOL;
        yield* forEachPolygonCellSteps(w, h, f.geom, mvtToCell, (x, y) => {
          const i = y * w + x;
          if (grid[i] === expect) land[i] |= why;
        });
      }
    }
    // Farmland and golf courses remain private across their source footprints.
    // A POI pad, road, orchard or nexus repaint cannot reopen this ground.
    for (const name of ['landcover', 'landuse']) for (const f of feats(name)) {
      if (f.type !== 3 || !f.geom || !f.tags) continue;
      const terrain = classifyPolygon(name, f.tags);
      if (FARM_TYPES.has(terrain)) {
        yield* forEachPolygonCellSteps(E, E, f.geom, mvtToCell, (x, y) => {
          fieldSource[y * E + x] = 1;
        }, M);
      }
      const why = terrain === T.FARMLAND ? W_.FARMLAND : terrain === T.GOLF ? W_.GOLF : 0;
      if (!why) continue;
      yield 'spawn gate private grounds';
      yield* forEachPolygonCellSteps(w, h, f.geom, mvtToCell, (x, y) => { land[y * w + x] |= why; });
    }
    // Only affirmatively public pier geometry can host spawns. Stamp the same
    // width as the drawn planks; an overlapping restricted/unknown pier wins,
    // even where a later park/POI/road paint hides its original footprint.
    const publicPier = new Uint8Array(NN);
    for (const f of feats('transportation')) {
      if (f.type !== 2 || !f.geom || classifyLine('transportation', f.tags || {}) !== T.PIER) continue;
      const accessible = isPublicPier(f.tags);
      const width = Math.max(1, Math.round(roadWidthM(f.tags) / CELL_M));
      for (const line of f.geom) forEachLineCell(line, width, mvtToCell, (x, y) => {
        if (x < 0 || x >= w || y < 0 || y >= h) return;
        const i = y * w + x;
        if (accessible) publicPier[i] = 1;
        else land[i] |= W_.PIER_ACCESS;
      });
      yield 'spawn gate pier access';
    }
    // ── POI points: sensitive places (the point SENSITIVE_SITE, the ground round it
    // SENSITIVE), and a church on cemetery land.
    for (const f of feats('poi')) {
      if (f.type !== 1 || !f.geom || !f.tags) continue;
      const t = f.tags;
      const sens = isSensitivePoi(t);
      const church = !sens && t.class === SENSITIVE_POI.worshipClass;
      if (!sens && !church) continue;
      for (const ring of f.geom) {
        const p = ring && ring[0];
        if (!p) continue;
        const e = extOf(p);
        if (e < 0) continue;
        if (sens) {
          sensD[e] = 0; nSens++;
          const px = Math.floor(p.x * mvtToCell), py = Math.floor(p.y * mvtToCell);
          boxCells(w, h, px, py, 1, (x, y, j) => { sensPt[j] = 1; });
        }
        if (church && cemExt[e]) { churchD[e] = 0; nChurch++; }
      }
    }
    yield 'spawn gate points';
    // ── Ways: which cells a PRIVATE way paints and which a public one does
    // (the paint's own one-cell walk, forEachLineCell).
    const privWay = new Uint8Array(NN), pubWay = new Uint8Array(NN);
    k = 0;
    for (const f of feats('transportation')) {
      if (f.type !== 2 || !f.geom) continue;
      const t = classifyLine('transportation', f.tags || {});
      if (t == null || !COBBLE_TYPES.has(t)) continue;
      if ((++k & 31) === 0) yield 'spawn gate ways';
      const arr = isPrivateWay(f.tags) ? privWay : pubWay;
      for (const line of f.geom) {
        forEachLineCell(line, 1, mvtToCell, (x, y) => {
          if (x >= 0 && y >= 0 && x < w && y < h) arr[y * w + x] = 1;
        });
      }
    }
    const privateOnly = (i) => privWay[i] && !pubWay[i];
    // ── Public LAND by polygon: a park / playground / pitch / beach polygon
    // vouches for its neighbours whatever paint won its cells (a small park
    // inside a residential landuse polygon is painted residential, and is
    // still public ground). Quiet land vouches for nobody (a cemetery still
    // does — its lawn is a public place, it just hosts nothing itself).
    // Bit 1: public land (frontage). Bit 2: a PARK-FAMILY polygon — the
    // leisure ground the house rules never touch (PARK_FAMILY_LAYER_CLASS: a
    // designation polygon — a heritage conservation area over a whole
    // neighbourhood — is not a park).
    const pubArea = new Uint8Array(NN);
    k = 0;
    for (const name of ['landcover', 'landuse', 'park']) {
      for (const f of feats(name)) {
        if (f.type !== 3 || !f.geom || !f.tags) continue;
        if (!PUBLIC_NEAR.has(classifyPolygon(name, f.tags))) continue;
        if (isQuietLand(name, f.tags) && f.tags.class !== 'cemetery') continue;
        if ((++k & 7) === 0) yield 'spawn gate public land';
        const park = (name !== 'park' || PARK_FAMILY_LAYER_CLASS.has(f.tags.class)) && f.tags.class !== 'cemetery';
        const bits = park ? 3 : 1;
        yield* forEachPolygonCellSteps(w, h, f.geom, mvtToCell, (x, y) => { pubArea[y * w + x] |= bits; });
      }
    }
    const anchorAt = (i) => pubArea[i] !== 0 || (PUBLIC_NEAR.has(grid[i]) && !privateOnly(i));
    // ── Distances (only where there is a source at all).
    if (nSens) yield* chamferSteps(sensD, E);
    if (nChurch) yield* chamferSteps(churchD, E);
    const sensR = SPAWN_SENSITIVE_BUFFER_M / CELL_M, churchR = churchM / CELL_M;
    // ── FRONTAGE: a public anchor (PUBLIC_NEAR ground that is not a private
    // way's, or public land by polygon) within SPAWN_FRONTAGE cells,
    // Chebyshev — a separable window.
    const F = SPAWN_FRONTAGE;
    const rowAny = new Uint8Array(NN), front = new Uint8Array(NN);
    for (let y = 0; y < h; y++) {
      if ((y & 31) === 31) yield 'spawn gate frontage rows';
      const row = y * w;
      let run = 0;   // anchors in the window [x-F, x+F]
      for (let x = 0; x < Math.min(F, w); x++) if (anchorAt(row + x)) run++;
      for (let x = 0; x < w; x++) {
        const add = x + F, drop = x - F - 1;
        if (add < w && anchorAt(row + add)) run++;
        if (drop >= 0 && anchorAt(row + drop)) run--;
        rowAny[row + x] = run > 0 ? 1 : 0;
      }
    }
    for (let x = 0; x < w; x++) {
      if ((x & 31) === 31) yield 'spawn gate frontage cols';
      let run = 0;
      for (let y = 0; y < Math.min(F, h); y++) run += rowAny[y * w + x];
      for (let y = 0; y < h; y++) {
        const add = y + F, drop = y - F - 1;
        if (add < h) run += rowAny[add * w + x];
        if (drop >= 0) run -= rowAny[drop * w + x];
        front[y * w + x] = run > 0 ? 1 : 0;
      }
    }
    // ── BEHIND A HOUSE: every cell's nearest public WAY (a multi-source BFS,
    // 4-connected, queue order — deterministic), then for each lot cell with
    // frontage the straight line to it: crossing a building footprint means
    // the cell is somebody's back garden.
    const near = new Int32Array(NN).fill(-1);
    const queue = new Int32Array(NN);
    let qh = 0, qt = 0;
    for (let i = 0; i < NN; i++) {
      if (isCobbleTerrain(grid[i]) && !privateOnly(i)) { near[i] = i; queue[qt++] = i; }
    }
    while (qh < qt) {
      if ((qh & 8191) === 8191) yield 'spawn gate nearest way';
      const i = queue[qh++], x = i % w, y = (i / w) | 0, s = near[i];
      if (x + 1 < w && near[i + 1] < 0) { near[i + 1] = s; queue[qt++] = i + 1; }
      if (x > 0 && near[i - 1] < 0) { near[i - 1] = s; queue[qt++] = i - 1; }
      if (y + 1 < h && near[i + w] < 0) { near[i + w] = s; queue[qt++] = i + w; }
      if (y > 0 && near[i - w] < 0) { near[i - w] = s; queue[qt++] = i - w; }
    }
    const behind = (i) => {
      const s = near[i];
      if (s < 0) return false;
      const x0 = i % w, y0 = (i / w) | 0, x1 = s % w, y1 = (s / w) | 0;
      const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      if (n > BEHIND_HOUSE_MAX_CELLS) return false;
      for (let t = 1; t < n; t++) {
        const x = Math.round(x0 + (x1 - x0) * t / n), y = Math.round(y0 + (y1 - y0) * t / n);
        if (BUILDING_TYPES.has(grid[y * w + x])) return true;
      }
      return false;
    };
    // ── FIELDS: only the outer band of the source footprint is open.
    // Keep a final-terrain fallback for synthetic field cells, but never let
    // roads, POI pads or later nexus paint punch new edges through an orchard.
    const FE = FARM_EDGE_CELLS;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (FARM_TYPES.has(grid[y * w + x])) fieldSource[(y + M) * E + x + M] = 1;
    }
    const farmRow = new Uint8Array(EE), farmEdge = new Uint8Array(NN);
    for (let y = 0; y < E; y++) {
      if ((y & 31) === 31) yield 'spawn gate field rows';
      const row = y * E;
      let run = 0;
      for (let x = 0; x < Math.min(FE, E); x++) if (!fieldSource[row + x]) run++;
      for (let x = 0; x < E; x++) {
        const add = x + FE, drop = x - FE - 1;
        if (add < E && !fieldSource[row + add]) run++;
        if (drop >= 0 && !fieldSource[row + drop]) run--;
        farmRow[row + x] = run > 0 ? 1 : 0;
      }
    }
    for (let x = 0; x < w; x++) {
      if ((x & 31) === 31) yield 'spawn gate field cols';
      let run = 0;
      for (let y = M - FE; y < M + FE; y++) run += farmRow[y * E + x + M];
      for (let y = 0; y < h; y++) {
        run += farmRow[(y + M + FE) * E + x + M];
        farmEdge[y * w + x] = run > 0 ? 1 : 0;
        run -= farmRow[(y + M - FE) * E + x + M];
      }
    }
    // ── COMMERCIAL GROUND's nearest-POI field (null: none on this tile).
    const comField = yield* commercialPoiFieldSteps(layers, w, mvtToCell, mvtToM, grid);
    // ── The reasons, per cell (every one that applies — the classes decide).
    // BEHIND_HOUSE is about somebody's LOT: it never touches public ground (a
    // park-family polygon's cell, whatever paint won it, or any ground that
    // is not lot / field). Orchard edges remain open; all farmland is refused.
    for (let y = 0; y < h; y++) {
      if ((y & 15) === 15) yield 'spawn gate classify';
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const t = grid[i];
        let v = land[i];
        if (!isWalkable(t)) v |= W_.TERRAIN;
        // ALLOWLISTED raw roadMask read (spawn_gate_sweep.test.js): THE
        // GATE'S OWN CONSTRUCTION — this is what stamps the ROAD reason
        // into entry.spawnWhy in the first place (see spawn_class.test.js's
        // "ROAD is the roadMask" pin).
        if (roadMask[i]) v |= W_.ROAD;
        if (quietMask && quietMask[i]) v |= W_.QUIET;
        if (sensPt[i]) v |= W_.SENSITIVE_SITE;
        const lot = isLotTerrain(t);
        const lotLike = (lot || FARM_TYPES.has(t)) && !(pubArea[i] & 2);
        if (lot && lotLike && front[i] && behind(i)) v |= W_.BEHIND_HOUSE;
        if (lot && !front[i]) v |= W_.PRIVATE;
        // Commercial ground: the nearest POI decides (COMMERCIAL_GROUND).
        if (COMMERCIAL_GROUND.has(t) && (!comField || comField.kind[i] !== POI_PUBLIC)) v |= W_.PRIVATE;
        if (t === T.FARMLAND) v |= W_.FARMLAND;
        if (t === T.GOLF) v |= W_.GOLF;
        if (t === T.PIER && !publicPier[i]) v |= W_.PIER_ACCESS;
        if (fieldSource[(y + M) * E + x + M] && !farmEdge[i]) v |= W_.FARM_INTERIOR;
        const e = (y + M) * E + (x + M);
        if (roadClass && (roadClass[i] & (ROAD_CLASS_MAJOR_BUFFER | ROAD_CLASS_MAJOR_BAND))) v |= W_.KERB;
        if (sensD[e] <= sensR || churchD[e] <= churchR) v |= W_.SENSITIVE;
        mask[i] = v;
      }
    }
    return mask;
  }
  // "Park family" POIs synthesize a small park buffer (radius ~18m) around the
  // point so they read as proper meadows / woodland even when OSM hasn't tagged
  // park landcover here. We paint over residential/grass/etc but NEVER over
  // roads, water, or buildings — those keep their cells.
  const POI_PARK_FAMILY = new Set(['park','garden','playground','pitch']);
  // Cells a synthesized POI pad never overwrites: water, every road tier, the
  // footpath and every building tier.
  const POI_PAD_KEEP = new Set([T.WATER, T.ROAD, T.PATH, ...BUILDING_TYPES, T.ROAD_LG, T.ROAD_MD]);

  // Keep the existing one-in-five lattice budget, but move a seat at most
  // two wall cells onto an available convex corner. Several seats may choose
  // the same corner: dedupe them rather than adding towers to the budget.
  // The caller supplies a halo, so a tile seam is never treated as a wall.
  // All comparisons use absolute cells; neither tile load order nor a save's
  // drawing frame participates. The scan includes neighbouring seats that
  // can move into this tile, and emits each destination only on its owner tile.
  function* castleTowerCellsSteps(w, h, originX, originY, ownerAt, blocked = () => false) {
    const directions = [[1, 0], [0, 1], [-1, 0], [0, -1]];
    const cache = new Map(), chosen = new Map();
    function cell(x, y) {
      const key = `${x}_${y}`;
      if (cache.has(key)) return cache.get(key);
      const owner = ownerAt(x, y);
      let edge = false, corner = false;
      if (owner != null) {
        const outside = directions.map(([dx, dy]) => ownerAt(x + dx, y + dy) !== owner);
        edge = outside.some(Boolean);
        // Exactly two adjacent exposed sides: a real convex raster corner,
        // not an isolated cell or a one-cell spur.
        corner = outside.filter(Boolean).length === 2
          && outside.some((v, i) => v && outside[(i + 1) % 4]);
      }
      const result = { owner, edge, corner };
      cache.set(key, result);
      return result;
    }
    for (let y = -2; y < h + 2; y++) {
      if ((y + 2) % 8 === 0) yield 'tower corner seats';
      for (let x = -2; x < w + 2; x++) {
        if (((originX + x + (originY + y) * 13) % 5 + 5) % 5) continue;
        const source = cell(x, y);
        if (!source.edge) continue;
        let best = null, distance = Infinity;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          const d = Math.abs(dx) + Math.abs(dy);
          if (d > 2) continue;
          const nx = x + dx, ny = y + dy, target = cell(nx, ny);
          if (target.owner !== source.owner || !target.corner || blocked(nx, ny)) continue;
          if (d < distance || (d === distance && (ny < best[1] || (ny === best[1] && nx < best[0])))) {
            best = [nx, ny]; distance = d;
          }
        }
        if (!best) {
          if (blocked(x, y)) continue;
          best = [x, y];
        }
        if (best[0] < 0 || best[1] < 0 || best[0] >= w || best[1] >= h) continue;
        chosen.set(`${best[0]}_${best[1]}`, best);
      }
    }
    // Preserve the row-major first-turret flag-post rule after seats move.
    return [...chosen.values()].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  }

  // Shared surface/sandbox grass pattern. The mask contains candidates only;
  // callers retain terrain, area ownership, access and occupancy precedence.
  function* grassFillSteps(tx, ty, w, h = w) {
    const grass = BiomeProfiles.GRASS_FILL;
    const candidates = new Uint8Array(w * h);
    const grassRegions = new Map();
    const grassRegion = (bx, by) => {
      const key = `${bx}_${by}`;
      if (!grassRegions.has(key)) {
        const rng = makeRng((cellHash(0, 0, bx, by) ^ grass.salt) >>> 0);
        grassRegions.set(key, {
          density: grass.dMin + rng() * (grass.dMax - grass.dMin),
          x: (bx + rng()) * grass.spacing,
          y: (by + rng()) * grass.spacing,
          radius: grass.radiusMin + rng() * (grass.radiusMax - grass.radiusMin),
        });
      }
      return grassRegions.get(key);
    };
    const denseGrass = new Uint8Array(w * h);
    const grassX = tx * w, grassY = ty * h;
    for (let by = Math.floor((grassY - grass.radiusMax) / grass.spacing);
      by <= Math.floor((grassY + h + grass.radiusMax) / grass.spacing); by++) {
      yield 'grass stand rows';
      for (let bx = Math.floor((grassX - grass.radiusMax) / grass.spacing);
        bx <= Math.floor((grassX + w + grass.radiusMax) / grass.spacing); bx++) {
        const stand = grassRegion(bx, by);
        const cx = stand.x - grassX, cy = stand.y - grassY;
        for (let iy = Math.max(0, Math.floor(cy - stand.radius)); iy < Math.min(h, Math.ceil(cy + stand.radius)); iy++) {
          for (let ix = Math.max(0, Math.floor(cx - stand.radius)); ix < Math.min(w, Math.ceil(cx + stand.radius)); ix++) {
            if ((ix + 0.5 - cx) ** 2 + (iy + 0.5 - cy) ** 2 <= stand.radius ** 2) denseGrass[iy * w + ix] = 1;
          }
        }
      }
    }
    for (let iy = 0; iy < h; iy++) {
      if ((iy & 7) === 0) yield 'grass ground fill rows';
      const by = Math.floor((grassY + iy + 0.5) / grass.spacing);
      let lastBx = null, background = 0;
      for (let ix = 0; ix < w; ix++) {
        const bx = Math.floor((grassX + ix + 0.5) / grass.spacing);
        if (bx !== lastBx) { background = grassRegion(bx, by).density; lastBx = bx; }
        const density = denseGrass[iy * w + ix] ? grass.dense : background;
        if (makeRng((cellHash(tx, ty, ix, iy) ^ grass.salt) >>> 0)() >= density) continue;
        candidates[iy * w + ix] = 1;
      }
    }
    return candidates;
  }

  // Rasterize a tile, in slices. THE WHOLE POINT IS THE `yield`s: a tile build
  // is ~50k cells through a dozen sequential passes, and as one straight-line
  // call it was a single 300-800 ms block of the main thread on a desktop —
  // seconds on a phone — with nine of them at boot. Nothing could interrupt it,
  // so the app was not slow, it was FROZEN, and no amount of spacing the builds
  // out could change that. Now it stops between passes and every few dozen
  // features, and the driver below hands the thread back whenever a slice has
  // run long enough.
  //
  // Yields are only ever at top-level statement positions of this generator —
  // never inside the arrow functions it defines, where `yield` isn't legal.
  // Pausing is safe anywhere here: grid/objects/wildplants are function-local
  // until the return, so nothing else can observe a half-built tile.
  function* rasterizeTileSteps(layers, cellsPerEdge, tx, ty, tileEdgeM) {
    const w = cellsPerEdge, h = cellsPerEdge;
    const grid = new Uint8Array(w * h);
    // Per-cell building ownership: a 1-based, per-tile id stamped only on
    // building footprint cells (0 = not a building). Lets the renderer draw a
    // seam between distinct buildings whose footprints rasterized into one
    // contiguous block of building tiles (otherwise they read as one blob).
    const owners = new Uint16Array(w * h);
    const syntheticBuildingCells = new Uint8Array(w * h);
    let nextBuildingOwnerId = 0;
    // ownerId → that footprint's stable key (see the mint below). Sparse array,
    // indexed by the same 1-based id `owners` stamps, so a cell resolves to the
    // building it belongs to in two hops and nothing has to search polygons.
    const ownerKeys = [];
    const castleHalo = new Map();
    const castleSourceRings = [];
    // Road FOOTPRINT mask (1 = under a drawn road band). The terrain grid is a
    // lossy record of where the roads are: every way rasterizes exactly ONE
    // cell wide whatever its class, while the road-geometry overlay draws each
    // way at its real carriageway width (roadOverlayWidthM), so a motorway's
    // band covers a full cell past its ROAD_LG cells on either side. Parking
    // lanes are nobody's road at all (isLotLane: no cell, no band, no
    // mask — a lot is open ground). Anything seated on a masked cell
    // reads as sitting in the road, which is precisely the bug that kept
    // coming back: the spawn filters were checking terrain, and terrain wasn't
    // the question. This mask IS the question. It changes no terrain — masked
    // cells keep their biome and stay walkable — it only bars spawns and
    // tilling (app.js isTillableCell reads it as cell.underRoad). Resolved
    // from band COVERAGE (see stampCoverLineSteps / ROAD_MASK_MIN_COVER): a cell
    // counts as road ground once the union of every drawn band covers at
    // least HALF of it — it used to be any overlap at all, which handed a
    // cell to the road for a sliver of paint on its edge. So a street
    // hugging a cell boundary claims the cell it mostly covers (both, if it
    // is wide enough to cover half of each), and a verge with a lick of band
    // across its corner stays ground. `roadCover` holds the per-cell sample
    // bits while the ways are stamped; the mask is resolved from it after the
    // layer loop, before anything reads it.
    const roadMask = new Uint8Array(w * h);
    const roadCover = new Uint16Array(w * h);
    // The same coverage, for the MAJOR ways only, and the per-cell road CLASS
    // resolved from it beside the mask (resolveRoadClassSteps).
    const majorCover = new Uint16Array(w * h);
    // The major ways' band once more, widened by MAJOR_BUFFER_CELLS each side
    // — the KERB BUFFER (ROAD_CLASS_MAJOR_BUFFER) no fast mover spawns in.
    const majorBufCover = new Uint16Array(w * h);
    const roadClass = new Uint8Array(w * h);
    // Per-cell length of PATH geometry, in cell widths — see accumulateLineSpan.
    // Reduced to the pathCross mask below once every way has been walked.
    const pathSpan = new Float32Array(w * h);
    const mvtToCell = cellsPerEdge / TILE_EXTENT;
    // TWO METRE BASES, and generation may only read the first.
    //
    // `mvtToM` is GENERATION metres: every "one candidate per 11.3 m", "~1
    // rock per 25 m²", "cluster radius 7 m" below is measured in it. It is a
    // pure function of the tile's own cell count (CELL_M nominal metres per
    // cell), so it is the same number in every save that loads this tile —
    // and cellsPerEdge is itself a pure function of the tile's row
    // (cellsPerEdgeForTile). Two players with different home latitudes read
    // the same step, the same area, the same draw count: the same world.
    //
    // `mvtToFrameM` is the per-save WORLD FRAME (tileEdgeM comes from the
    // save's START_LAT, placing this tile at tx * tileEdgeM). It is used ONLY
    // to turn a settled cell into x/y metres for drawing (cellCenterMeters,
    // cellOfWorldM, paintCellOf, the overlay rings). A frame metre fed
    // into a step, an area, a threshold, a seed or an id is the bug — it made
    // the world depend on where the player's home was.
    const mvtToM = (w * CELL_M) / TILE_EXTENT;
    const mvtToFrameM = tileEdgeM / TILE_EXTENT;
    // Frame metres per cell (positions only — see above). Generation widths
    // are in cells: a width in metres over CELL_M.
    const cellWidthM = tileEdgeM / w;
    const objects = [];
    // The tile's SOURCE building polygons, kept for the polygonal footprint
    // overlay (building_overlay.js) the way the raw `transportation` lines are
    // kept for the road overlay. The grid is a lossy record of a building: a
    // rotated house squares off to the cells it covers most of, an L-shaped
    // block loses its notch, and two buildings that abut weld into one span of
    // tier colour. The rings below are what the rasterizer was AIMING at, in
    // TILE-LOCAL METRES (x,y interleaved), carrying the tier the distribution
    // pass finally settled on and the ownerKey its footprint was stamped with —
    // so the overlay draws the same building, at the same tier, in the same
    // claimed/unclaimed state the tiled paint would have drawn.
    const buildingShapes = [];
    const wildplants = [];
    // Residential YARD flora (_spawnYardFloraSteps). Held apart and appended
    // to `wildplants` only at the post-pass sweep, so every older wild plant
    // keeps first claim on its cell in the occupancy pass — the yard lane is
    // new and must not displace what existing worlds already grow.
    const yardFlora = [];
    const parkingTreasures = []; // one guaranteed treasure-X per parking-POI
    // Gate and information POI cells (tile-local), placed after the road mask
    // is resolved — see POI_GATE_CLASS / POI_INFO_CLASS.
    const gatePoints = [], infoPoints = [];
    // Grid indices of synthesized CONCRETE POI pads (the hospital cross
    // painted around a POI chest). Scatter interactables are
    // culled off these cells in the post-pass — a rock/tree on a POI's plaza
    // reads as junk dumped on the destination. Park-family buffers (padType
    // PARK) are deliberately NOT tracked: they're meant to read as meadow.
    const poiPadCells = new Set();
    // "cx_cy" → biome code a PATH cell overwrote (see paintCell). Render uses
    // it to draw the under-path biome so paths don't change the ground.
    const pathUnder = {};
    // Same idea for the vehicle road tiers, but rasterize-local only: it isn't
    // exported for render (roads fully cover their cell) — it exists so the
    // pavement-blob erosion pass can restore the biome a dissolved road cell
    // was stamped over. See erodePavementBlobs.
    const roadUnder = {};
    // (No tile-wide rng: every scatter seeds its OWN stream from its polygon
    // or cell, so one pass's draw count can never shift another's.)

    // Helper: spawn debris within a polygon's rings at the polygon's own stable density.
    // density seed = polygon centroid → stable across reloads.
    // Each debris snaps to the CENTER of its 5m game cell (no jitter), and is keyed
    // by the cell's absolute (cellIX, cellIY) so the same cell is always the same id.
    // A GENERATOR, because one call can be the whole tile. The scatter walks a
    // candidate per cell across the polygon's bounding box; a landcover
    // polygon that covers the tile has ~114k — per flora entry in the biome's
    // profile. Each row computes the same ray crossings as pointInRings once,
    // then advances through them as x increases, preserving boundary tests.
    // Called plainly
    // it was one unbroken block between the last `polygon fill rows` yield and
    // the layer's own, measured at 225 ms headless on a whole-tile polygon (so
    // multiples of that on a phone). Delegated with `yield*` it breaks every
    // 8 rows, exactly as the polygon fill it follows does. The prng is drawn in
    // the same order either way, so the scatter is identical.
    // `patch` (optional): the biome's FLORA_PATCH row — the density is scaled
    // per candidate by the plane noise at its global point (clumps, not a
    // blanket). Still one draw per candidate: the stream never moves.
    function* spawnDebrisSteps(rings, crop, polyKey, dMin, dMax, patch) {
      const prng = makeRng(polyKey);
      const density = dMin + prng() * (dMax - dMin);
      const gx0 = tx * TILE_EXTENT, gy0 = ty * TILE_EXTENT;
      const bb = bboxOf(rings);
      const stepMvt = CELL_M / mvtToM; // one candidate per game-cell-width
      let _row = 0;
      for (let yy = bb.minY; yy <= bb.maxY; yy += stepMvt) {
        if ((++_row & 7) === 7) yield 'flora scatter rows';
        const y = yy + stepMvt * 0.5;
        const crossings = rowCrossings(rings, y);
        let crossing = 0, inside = (crossings.length & 1) !== 0;
        for (let xx = bb.minX; xx <= bb.maxX; xx += stepMvt) {
          const x = xx + stepMvt * 0.5;
          while (crossing < crossings.length && crossings[crossing] <= x) {
            inside = !inside;
            crossing++;
          }
          if (!inside) continue;
          // Snap to this tile's local cell grid (no absolute-cells drift).
          const localIX = Math.floor(xx * mvtToCell);
          const localIY = Math.floor(yy * mvtToCell);
          if (localIX < 0 || localIY < 0 || localIX >= w || localIY >= h) continue;
          // Absolute world meters for game positioning — at the local cell center.
          const { mx: cx, my: cy } = cellCenterMeters(localIX, localIY);
          const d = patch
            ? density * BiomeProfiles.patchMul(patch, gx0 + xx + stepMvt * 0.5, gy0 + yy + stepMvt * 0.5)
            : density;
          if (prng() < d) {
            // Stash local ix/iy on the wp so the post-pass filter can read grid[] directly.
            wildplants.push(makeWildplant(crop, cx, cy,
              cellId('wp', tx, ty, localIX, localIY), { _ix: localIX, _iy: localIY }));
          }
        }
      }
    }

    // Structured "hedge maze" spawner — used for commercial-plaza shrubs so they
    // read as a neat clipped hedge maze instead of random scatter. Placement is
    // deterministic on ABSOLUTE cell coords (continuous across polygons + tiles),
    // on a period-HEDGE_LATTICE_P lattice:
    //   • pillars   (ax%P==0 && ay%P==0)            → always a hedge cell
    //   • wall cells (one coord %P==0, the other not) → a hedge IFF that wall
    //                 segment "exists" (a stable per-segment coin flip); both
    //                 cells of a 2-cell wall share the segment id so a wall is
    //                 contiguous and the gaps read as passages.
    //   • interior  (neither coord %P==0)            → never a hedge (open path)
    // Pillars and sparse whole wall segments leave broad open passages.
    // The lattice decision lives in hedgeMazeCell (IIFE level, exported) so
    // the sandbox's flora mirror runs the SAME maze instead of a drifted copy.
    function* spawnHedgeMazeSteps(rings, crop, salt) {
      const bb = bboxOf(rings);
      const ix0 = Math.max(0, Math.floor(bb.minX * mvtToCell));
      const iy0 = Math.max(0, Math.floor(bb.minY * mvtToCell));
      const ix1 = Math.min(w - 1, Math.floor(bb.maxX * mvtToCell));
      const iy1 = Math.min(h - 1, Math.floor(bb.maxY * mvtToCell));
      let _row = 0;
      for (let iy = iy0; iy <= iy1; iy++) {
        if ((++_row & 7) === 7) yield 'hedge maze rows';
        for (let ix = ix0; ix <= ix1; ix++) {
          // Cell centre in MVT units for the inside-polygon test.
          if (!pointInRings(rings, (ix + 0.5) / mvtToCell, (iy + 0.5) / mvtToCell)) continue;
          const ax = tx * w + ix, ay = ty * h + iy;     // absolute cell coords
          if (!hedgeMazeCell(ax, ay, salt)) continue;
          const { mx: cx, my: cy } = cellCenterMeters(ix, iy);
          wildplants.push(makeWildplant(crop, cx, cy,
            cellId('hm', tx, ty, ix, iy), { _ix: ix, _iy: iy }));
        }
      }
    }

    // A FORMAL park's clipped hedge rows (BiomeProfiles.PARK_CHARACTERS.formal
    // `hedgeRows`): a row every `period` ABSOLUTE cell rows, cut into
    // `seg`-cell runs of which `on` stand (a stable coin per run). Keyed on
    // absolute cells like the hedge maze, so a row runs straight on across
    // polygons and east/west seams; no rng, no clumps — neat is the point.
    function* spawnHedgeRowsSteps(rings, crop, row) {
      const bb = bboxOf(rings);
      const ix0 = Math.max(0, Math.floor(bb.minX * mvtToCell));
      const iy0 = Math.max(0, Math.floor(bb.minY * mvtToCell));
      const ix1 = Math.min(w - 1, Math.floor(bb.maxX * mvtToCell));
      const iy1 = Math.min(h - 1, Math.floor(bb.maxY * mvtToCell));
      let _row = 0;
      for (let iy = iy0; iy <= iy1; iy++) {
        if ((++_row & 7) === 7) yield 'hedge row rows';
        const ay = ty * h + iy;
        if (((ay % row.period) + row.period) % row.period !== 0) continue;
        for (let ix = ix0; ix <= ix1; ix++) {
          const ax = tx * w + ix;
          const run = Math.floor(ax / row.seg);
          const hsh = ((Math.imul(run, 73856093) ^ Math.imul(ay, 19349663) ^ row.salt) >>> 0);
          if ((hsh % 1000) >= row.on * 1000) continue;
          if (!pointInRings(rings, (ix + 0.5) / mvtToCell, (iy + 0.5) / mvtToCell)) continue;
          const { mx: cx, my: cy } = cellCenterMeters(ix, iy);
          wildplants.push(makeWildplant(crop, cx, cy,
            cellId('hr', tx, ty, ix, iy), { _ix: ix, _iy: iy }));
        }
      }
    }

    // A WOODED park's trees (PARK_CHARACTERS.wooded `trees`): one candidate
    // per cell, kept with chance p (× the FLORA_PATCH clump), off the
    // polygon's own stream (polyKey ^ salt) — one draw per candidate, then
    // one for the look. The species is the polygon's, as in a forest.
    function* spawnParkTreesSteps(rings, polyKey, trees, patch) {
      const species = TREE_SPECIES[(polyKey >>> 8) % TREE_SPECIES.length];
      const prng = makeRng((polyKey ^ trees.salt) >>> 0);
      const gx0 = tx * TILE_EXTENT, gy0 = ty * TILE_EXTENT;
      const bb = bboxOf(rings);
      const stepMvt = CELL_M / mvtToM;
      let _row = 0;
      for (let yy = bb.minY; yy <= bb.maxY; yy += stepMvt) {
        if ((++_row & 7) === 7) yield 'park tree rows';
        for (let xx = bb.minX; xx <= bb.maxX; xx += stepMvt) {
          if (!pointInRings(rings, xx + stepMvt * 0.5, yy + stepMvt * 0.5)) continue;
          const ix = Math.floor(xx * mvtToCell), iy = Math.floor(yy * mvtToCell);
          if (ix < 0 || iy < 0 || ix >= w || iy >= h) continue;
          const pm = patch ? BiomeProfiles.patchMul(patch, gx0 + xx + stepMvt * 0.5, gy0 + yy + stepMvt * 0.5) : 1;
          if (prng() >= trees.p * pm) continue;
          const { mx: cx, my: cy } = cellCenterMeters(ix, iy);
          objects.push(makeObject('tree', cx, cy, cellId('ptree', tx, ty, ix, iy),
            { variant: 1 + Math.floor(prng() * 4), species }));
        }
      }
    }

    // Scattered trees on wood/forest landcover — same reason as spawnDebrisSteps
    // above: one call can be the whole tile (a park or greenbelt polygon), and
    // called plainly (a bare double `for` with no yield) this was a single
    // unbroken block — measured at 137 ms headless over a whole-tile `wood`
    // polygon at real scale (cellsPerEdge 338), so ~700 ms on the target
    // phone. Every sibling scatter in this loop already yields; this one and
    // spawnFruitTreesSteps below were missed. Delegated with `yield*`,
    // yielding every 8 rows — same cadence as spawnDebrisSteps/
    // spawnHedgeMazeSteps. `yield` consumes no rng, so rng() fires in exactly
    // the same order sliced or not — the forest this produces is identical.
    function* spawnForestTreesSteps(rings, polyKey) {
      // Each polygon picks ONE species (maple/pine) so a single
      // forest reads as a single woodland type instead of a jumbled mix. Each
      // species has its own real sprite sheet (no tint pass needed).
      const species = TREE_SPECIES[(polyKey >>> 8) % TREE_SPECIES.length];
      const bb = bboxOf(rings);
      // The profile owns the canopy spacing. Every in-polygon candidate
      // becomes a tree; the fixed pitch sets density without extra draws.
      const stepMvt = BiomeProfiles.staticObjects(T.FOREST).treeSpacingM / mvtToM;
      // The polygon's OWN stream, like every other scatter (debris, rock
      // clusters, yard flora): drawing from the tile-wide rng made each
      // forest's jitter depend on how many draws every earlier forest on the
      // tile had taken.
      const frng = makeRng((polyKey ^ 0x7EE5F0E5) >>> 0);
      let _row = 0;
      for (let yy = bb.minY; yy <= bb.maxY; yy += stepMvt) {
        if ((++_row & 7) === 7) yield 'forest tree scatter rows';
        for (let xx = bb.minX; xx <= bb.maxX; xx += stepMvt) {
          const jx = xx + (frng() - 0.5) * stepMvt;
          const jy = yy + (frng() - 0.5) * stepMvt;
          if (pointInRings(rings, jx, jy)) {
            // Snap to this tile's cell grid (shared with rocks/wildplants/
            // flora) so the occupancy pass can dedupe — and it keeps the
            // forest from looking jittery.
            const { ix, iy, cx, cy } = snapCell(jx, jy);
            // Stable per-cell id so chop tracking can target an individual
            // tree. Pre-fix, every forest tree spawned with `id === undefined`;
            // pushing one undefined into save.chopped made
            // choppedSet.has(undefined) match every other tree → felling one
            // cleared the grove. Tile + LOCAL cell, never frame metres.
            // The species is the WORLD's: the softwood-near-home rule is a
            // per-player overlay (HomeArea.applySoftwood, app.js), never a
            // generation input.
            objects.push(makeObject('tree', cx, cy,
              cellId('tree', tx, ty, ix, iy), {
                variant: 1 + Math.floor(frng() * 4),
                species,
              }));
          }
        }
      }
      // (Forest mushrooms + woodland flowers now spawn via the BIOME_PROFILES
      // flora loop above — see the FOREST profile in src/biome_profiles.js.)
    }

    // Fruit trees on ORCHARD landcover — same fix, same reason: a whole-tile
    // orchard polygon ran this loop with no yield either. Unlike the forest
    // scatter above this draws no rng() at all (fixed grid, no jitter), so
    // there is no draw order to preserve — only the yield cadence is new.
    function* spawnFruitTreesSteps(rings) {
      // Each tree independently has a 1-in-50 Worldpeach chance. The cell
      // hash keeps its species stable across reloads and polygon boundaries.
      const bb = bboxOf(rings);
      const stepMvt = BiomeProfiles.staticObjects(T.ORCHARD).fruitTreeSpacingM / mvtToM; // planted rows
      let _row = 0;
      for (let yy = bb.minY; yy <= bb.maxY; yy += stepMvt) {
        if ((++_row & 7) === 7) yield 'fruit tree scatter rows';
        for (let xx = bb.minX; xx <= bb.maxX; xx += stepMvt) {
          if (!pointInRings(rings, xx + stepMvt * 0.5, yy + stepMvt * 0.5)) continue;
          const { ix, iy, cx, cy } = snapCell(xx + stepMvt * 0.5, yy + stepMvt * 0.5);
          objects.push(makeObject('fruittree', cx, cy, cellId('ft', tx, ty, ix, iy),
            { species: fruitTreeSpecies(cellHash(tx, ty, ix, iy)) }));
        }
      }
    }

    // This tile's origin in the per-save world frame (positions only).
    const tileOriginMx = tx * tileEdgeM;
    const tileOriginMy = ty * tileEdgeM;

    // Local-cell index (ix, iy) -> absolute world-meter coordinates of that
    // cell's CENTRE. Same arithmetic the grid/snapCell/object placement all
    // share; extracted so the byte-identical expression isn't repeated ~7×.
    const cellCenterMeters = (ix, iy) => ({
      mx: tileOriginMx + (ix + 0.5) * (1 / mvtToCell) * mvtToFrameM,
      my: tileOriginMy + (iy + 0.5) * (1 / mvtToCell) * mvtToFrameM,
    });
    // The inverse: absolute world metres -> this tile's local cell index, on
    // the MVT basis (metres -> mvt units -> cells). This is the spelling the
    // occupancy pass and the civic-building house dedupe key cells by.
    // NOTE: the post-pass filter (paintCellOf, below) divides by cellWidthM
    // instead — algebraically the same, but the two can differ in the last
    // ulp and so in Math.floor at an exact cell boundary. World seeds are
    // pinned on each pass's own spelling, so the two are deliberately NOT
    // unified; a site must keep the spelling it had.
    const cellOfWorldM = (x, y) => ({
      ix: Math.floor(((x - tileOriginMx) / mvtToFrameM) * mvtToCell),
      iy: Math.floor(((y - tileOriginMy) / mvtToFrameM) * mvtToCell),
    });
    // Snap an mvt-space point to THIS tile's local cell grid — the same grid
    // the terrain `grid[]` and wildplants (spawnDebrisSteps) already use. Every placed object must share this one grid: structs
    // (trees / rocks / fruit trees / houses) used to snap to a GLOBAL 5 m grid
    // anchored at the world origin, which is offset from this tile-local grid
    // by a sub-cell fraction. That misalignment meant a tree and a wildplant
    // sitting in the "same" spot could quantise into different occupancy cells,
    // so the unified occupancy pass failed to dedupe them and both survived.
    // Local cells are also fully contained within the tile (indices 0..w/h-1),
    // so no two tiles ever emit an object for the same physical cell.
    // STREET ROCKS — the residential rubble, moved off the lots and onto the
    // kerb. StreetVariants.rocksFor picks ROCK_STREET_SHARE of the MINOR
    // streets (by street key, so a street is rock-lined end to end and never
    // a hedgerow); each piece in this tile walks its own arclength, a cluster
    // candidate every STREET_ROCK_PIVOT_M firing at STREET_ROCK_FIRE (denser
    // than the old lot pivots: most of a verge cluster lands on a sidewalk, a
    // moat or a driveway and is culled — ~20% survive; the owner asked for
    // ~1 rock per 10 m of rock-lined street, up from ~1 per 16 m at a 20 m
    // pivot: at 10 m the Kelowna block where 16 m was measured runs 9.8 m a
    // rock — denser cities lose more of a cluster to sidewalks and yards, 20
    // to 40 m), and each fired cluster drops its rocks
    // on the VERGE: STREET_ROCK_OUT_MIN..+SPAN cells out past the band's
    // edge, jittered STREET_ROCK_ALONG_M along the way. Consume the old tier
    // and vein draws to preserve seats, then emit only plain stone. Keep the
    // original `rc` memberships for cave-entrance grouping. Its OWN stream per piece
    // (fnv1a of street key + tile + lineKey), so no other stream moves; and
    // pushed before the mineralrock cleanup, whose one filter (band, moat,
    // plaza, yard rule) decides what survives. A generator: one yield per line.
    const STREET_ROCK_PIVOT_M = 10, STREET_ROCK_FIRE = 0.8;
    const STREET_ROCK_MIN = 6, STREET_ROCK_SPAN = 6;
    const STREET_ROCK_ALONG_M = 7;
    const STREET_ROCK_OUT_MIN = 0.5, STREET_ROCK_OUT_SPAN = 2;
    function* spawnStreetRocksSteps(index, output = objects) {
      const SV = StreetVariants;
      const plainP = caveRockP(0);
      const ext = index.extent || TILE_EXTENT;
      for (const rec of index.lines) {
        if (!rec.rocks) continue;
        yield 'street rocks';
        const spans = (typeof Streets !== 'undefined') ? Streets.tileSpans(rec.line, mvtToM, ext) : [];
        if (!spans.length) continue;
        const rng = makeRng(fnv1a(`rocks|${rec.key}|${tx},${ty}|${rec.lineKey}`));
        SV.sampleLine(rec.line, mvtToM, STREET_ROCK_PIVOT_M, STREET_ROCK_PIVOT_M / 2, (s, x, y, nx, ny) => {
          if (rng() > STREET_ROCK_FIRE) return;
          const n = STREET_ROCK_MIN + Math.floor(rng() * STREET_ROCK_SPAN);
          const side = rng() < 0.5 ? 1 : -1;
          const tbl = rollVeinTable(rng, SURFACE_ROCK_TIER_WEIGHTS, 0.30, SURFACE_ROCK_CUM);
          if (!Streets.covers(spans, s)) return;     // the neighbour's metres
          const clusterId = cellId('rc', tx, ty, Math.floor(x / CELL_M), Math.floor(y / CELL_M));
          for (let k = 0; k < n; k++) {
            const along = (rng() - 0.5) * 2 * STREET_ROCK_ALONG_M;
            const out = side * (rec.halfW + (STREET_ROCK_OUT_MIN + rng() * STREET_ROCK_OUT_SPAN) * CELL_M);
            const roll = rollRock(rng, plainP, tbl);
            // Along the local tangent (-ny, nx) is (ux, uy): left normal (uy, -ux).
            const px = x - ny * along + nx * out, py = y + nx * along + ny * out;
            const ix = Math.floor(px / CELL_M), iy = Math.floor(py / CELL_M);
            if (ix < 0 || iy < 0 || ix >= w || iy >= h) continue;
            const { mx, my } = cellCenterMeters(ix, iy);
            // Keep the seeded draws and seats, but street rubble is plain stone.
            output.push(makeObject('mineralrock', mx, my, cellId('mr', tx, ty, ix, iy),
              { requiredTier: 1, caveVariant: roll.caveVariant ?? (cellHash(tx, ty, ix, iy) % 4),
                ...(roll.plain ? { _clusterId: clusterId } : {}), _street: true, _streetLine: rec.lineKey }));
          }
        });
      }
    }
    const snapCell = (mx, my) => {
      const ix = Math.floor(mx * mvtToCell);
      const iy = Math.floor(my * mvtToCell);
      const { mx: cx, my: cy } = cellCenterMeters(ix, iy);
      return { ix, iy, cx, cy };
    };

    // NOTE: the OSM 'waterway' layer (streams / rivers / drains / canals) is
    // deliberately NOT painted — these are culverted / underground and not
    // visible on the ground IRL, so they shouldn't carve WATER tiles. Open
    // water bodies (lakes, ponds, ocean, pools) still come in via 'water'.
    const order = ['landcover', 'landuse', 'park', 'water', 'transportation', 'building', 'poi'];
    const layersByName = {};
    for (const l of layers) layersByName[l.name] = l;
    // LOT LANES DO NOT EXIST (isLotLane): cut them out of the layer before
    // any pass below — or any reader of entry.layers — walks it.
    yield* pruneLotLanesSteps(layersByName, mvtToM);
    yield 'lot lanes';
    layersByName['poi'] = parkPoiLayer(layersByName['poi'], layersByName['park']);

    // PARK CHARACTERS (BiomeProfiles.PARK_CHARACTERS). A park polygon's
    // character is keyed on a GLOBAL point: the named-park POI inside it (the
    // grove anchor, so park and grove agree — src/zones.js reads the same
    // parkCharacterAt off the anchor), else the polygon's own global centroid.
    // A polygon clipped differently by two tiles may key differently on each
    // side of a seam — exactly as seam-safe as its flora scatter (polyKey
    // carries tx, ty) already is. Cemeteries are always a lawn.
    // `parkPolys` collects every park polygon for the PARK FRINGE (Zones.
    // fringeSteps, the end of this build).
    const parkPois = [];
    if (layersByName['poi']) {
      for (const f of layersByName['poi'].features) {
        if (f.type !== 1 || !f.geom || !BiomeProfiles.isParkPoi(f.tags)) continue;
        for (const ring of f.geom) {
          const p = ring && ring[0];
          if (p) parkPois.push({ lx: p.x, ly: p.y, gx: tx * TILE_EXTENT + p.x, gy: ty * TILE_EXTENT + p.y });
        }
      }
      parkPois.sort((a, b) => (a.gy - b.gy) || (a.gx - b.gx));
    }
    const parkCharacterFor = (rings, c0, cemetery) => {
      if (cemetery) return BiomeProfiles.CEMETERY_CHARACTER;
      if (parkPois.length) {
        const bb = bboxOf(rings);
        for (const p of parkPois) {
          if (p.lx < bb.minX || p.lx > bb.maxX || p.ly < bb.minY || p.ly > bb.maxY) continue;
          if (pointInRings(rings, p.lx, p.ly)) return BiomeProfiles.parkCharacterAt(p.gx, p.gy);
        }
      }
      return BiomeProfiles.parkCharacterAt(tx * TILE_EXTENT + c0.x, ty * TILE_EXTENT + c0.y);
    };
    const parkPolys = [];

    // PRE-PASS: measure how far every footpath runs through each cell, BEFORE
    // any painting. A cell only becomes PATH where a way genuinely crosses it
    // (see pathCross below), and its total can't be known until every way has
    // been walked — a cell two ways each clip is crossed by their sum. Doing
    // this inside the paint loop would judge each cell on the ways seen so far.
    {
      const tl = layersByName['transportation'];
      if (tl) {
        for (const f of tl.features) {
          if (f.type !== 2 || !f.geom) continue;
          if (isLotLane(f.tags)) continue;   // lot lanes are nothing at all (already cut)
          if (classifyLine('transportation', f.tags) !== T.PATH) continue;
          for (const line of f.geom) accumulateLineSpan(pathSpan, w, h, line, mvtToCell);
        }
      }
    }
    // A cell earns PATH terrain only where at least one full cell width of way
    // lies inside it — the path runs THROUGH the cell rather than clipping its
    // corner or stopping just inside. A clipped cell keeps its own biome: it
    // stays tillable, spawnable and unclaimable, because there is no path
    // there. The epsilon keeps a perfectly straight orthogonal crossing (1.0 in
    // theory) from being rejected by float wobble.
    const pathCross = new Uint8Array(w * h);
    for (let i = 0; i < pathCross.length; i++) {
      if (pathSpan[i] >= PATH_CROSS_MIN_CELLS - 1e-3) pathCross[i] = 1;
    }
    // ELBOWS ARE EXEMPT. forEachLineCell stamps one extra cell on each diagonal
    // step so a width-1 line stays 4-connected — the renderer draws orthogonal
    // arms only, so without it consecutive cells touch at a corner and the path
    // reads as disconnected squares. That cell is a connectivity device, not
    // ground the way crosses, so its span is ~0 by construction and judging it
    // on span deletes it: measured on a 45-degree footpath, 31 of 65 cells were
    // left with no 4-connected neighbour. It sits between two cells the line
    // genuinely runs through, so it is always painted.
    yield 'path pre-pass';
    const pathCrossAt = (cx, cy, isElbow) => isElbow ||
      (cx >= 0 && cy >= 0 && cx < w && cy < h && pathCross[cy * w + cx] === 1);

    // POI chest placement (the `poi` pass below): find a placement that isn't
    // inside a building, preferring cells adjacent to a road/path. Reads the
    // grid as painted so far — `poi` is the last layer in `order`, so by then
    // every road and building is down.
    const cellIdxOf = (ix, iy) => iy * w + ix;
    const inb = (ix, iy) => ix >= 0 && iy >= 0 && ix < w && iy < h;
    function offsetForPlacement(startIx, startIy) {
      const cobbleWithin = (ix, iy, r) => !!boxCells(w, h, ix, iy, r, (x, y, i) => isCobbleTerrain(grid[i]));
      const initialOk = inb(startIx, startIy) && !isBuildingTerrain(grid[cellIdxOf(startIx, startIy)]);
      // Even if not on a building, prefer a tile that's adjacent to a road for reachability.
      if (initialOk && cobbleWithin(startIx, startIy, 1)) return { ix: startIx, iy: startIy };
      // Ring search up to radius 6 for a non-building cell, scored by:
      //   + adjacent to road/path  (most important — reachability)
      //   - distance from original POI                (keep close)
      // The first road-adjacent cell of the nearest ring that has one wins
      // (no later ring can score higher); otherwise the nearest open cell.
      let best = null, bestScore = -Infinity;
      const found = ringCells(startIx, startIy, 0, 6, (ix, iy, r) => {
        if (!inb(ix, iy)) return null;
        const gt = grid[cellIdxOf(ix, iy)];
        if (isBuildingTerrain(gt) || gt === T.WATER) return null;
        const score = (cobbleWithin(ix, iy, 2) ? 1000 : 0) - r;
        if (score > bestScore) { bestScore = score; best = { ix, iy }; }
        return score >= 1000 - r ? best : null;
      });
      return found || best || { ix: startIx, iy: startIy };
    }

    for (const name of order) {
      const layer = layersByName[name];
      if (!layer) continue;
      // Building rings get COLLECTED first, then re-tiered against the
      // tile's full distribution before any painting happens. Painting
      // ring-by-ring (the old behaviour) made the per-tile-floor pass
      // impossible because by the time we knew the counts, the grid was
      // already coloured. So: collect → enforce mins → paint + objectify.
      const buildingPolys = [];
      // Feature loops are the long pole — a dense tile carries thousands, and
      // one polygon can paint hundreds of cells. Stop often enough that a slice
      // stays inside its budget even on the heaviest layer.
      let _sliceCount = 0;
      for (const f of layer.features) {
        if ((++_sliceCount & 7) === 0) yield `${name} features`;
        if (f.type === 3) { // polygon
          let t = classifyPolygon(name, f.tags);

          // Building polygons get tiered by area + render_height so schools/malls/civic read
          // as a different color from single-family houses.
          if (name === 'building') {
            for (const ring of f.geom) {
              if (ring.length < 3) continue;
              const areaM2 = Math.abs(ringSignedArea(ring)) * mvtToM * mvtToM;
              if (areaM2 < 8) continue;
              const tier = buildingTier(areaM2, f.tags.render_height);
              buildingPolys.push({ ring, areaM2, tier });
            }
          } else {
            // Special case: swimming-pool polygons (whether they come in via the
            // water layer, the landuse layer, or the poi layer) should ALWAYS
            // become WATER terrain regardless of the layer's classifier — pools
            // are blue-painted holes in the suburb. Same goes for any layer
            // feature tagged with subclass=swimming_pool.
            const subCls = f.tags.class || f.tags.subclass;
            if (subCls === 'swimming_pool' || subCls === 'pool') {
              yield* paintPolygonSteps(grid, w, h, f.geom, T.WATER, mvtToCell);
            } else if (t != null) {
              yield* paintPolygonSteps(grid, w, h, f.geom, t, mvtToCell);
            }

            // A designation overlay supplies no ground or procedural flora.
            // Its independent quiet/restricted masks still run below.
            if (name === 'park' && t == null) continue;

            // Per-polygon debris/decor share one centroid-derived key
            // so a given polygon looks the same across reloads.
            const c0 = ringCentroid(f.geom[0]);
            const polyKey = ((Math.round(c0.x) * HASH_MUL_X) ^ (Math.round(c0.y) * HASH_MUL_Y) ^ (tx * 83492791) ^ (ty * 12345)) >>> 0;

            // ── Bucket J: rock-burst spawn for industrial / military /
            // quarry polygons. We pepper the polygon with mineralrock T1
            // objects at high density (up to 100 per polygon), giving the
            // player a reason to bring a pickaxe to these zones. Density is
            // capped per-polygon area so a tiny quarry doesn't get 100 rocks
            // on top of each other.
            if (name === 'landuse' && (subCls === 'industrial' ||
                subCls === 'military' || subCls === 'quarry' ||
                subCls === 'brownfield')) {
              const bb = bboxOf(f.geom);
              const areaM2 = (bb.maxX - bb.minX) * (bb.maxY - bb.minY) * mvtToM * mvtToM;
              // ~1 rock per 25 m², capped at 100 — a quarter-acre quarry
              // gets ~40 rocks, a big industrial estate hits the cap.
              const target = clamp(Math.floor(areaM2 / 25), 5, 100);
              const rng2 = makeRng((polyKey ^ 0xC0FFEE57) >>> 0);   /* fixed salt — different from longgrass / nut streams */
              let placed = 0, attempts = 0;
              while (placed < target && attempts < target * 6) {
                attempts++;
                const jx = bb.minX + rng2() * (bb.maxX - bb.minX);
                const jy = bb.minY + rng2() * (bb.maxY - bb.minY);
                if (!pointInRings(f.geom, jx, jy)) continue;
                const { ix, iy, cx, cy } = snapCell(jx, jy);
                // Cheap quarry rock. Roll a YIELD tier (mostly T1, occasional
                // T2/T3 for variety) and DERIVE the pick requirement from it —
                // the same single-field model the cluster spawner uses (see
                // _pushMineralrock above). yieldTier drives the sprite, the
                // metal drop, AND the required pick together, so the rock can't
                // look like one tier but pay out another.
                const r = rng2();
                const yieldTier = r < 0.05 ? 3 : r < 0.15 ? 2 : 1;
                const requiredTier = Math.max(1, yieldTier - 1);
                objects.push(makeObject('mineralrock', cx, cy,
                  cellId('rb', tx, ty, ix, iy),
                  { requiredTier, yieldTier }));
                placed++;
              }
            }

            // Per-biome wild flora / debris — driven by the central
            // BIOME_PROFILES registry (src/biome_profiles.js), the single
            // source of truth for "what grows here". Each biome lists its flora
            // kinds with a density window + an independent RNG salt; `dynamic`
            // entries (longgrass-style) get a stable per-polygon density in
            // [dMin, dMax] (dMin = BiomeProfiles' DYN_MIN floor) so most
            // polygons grow a light tuft, big areas cluster, and even the
            // unluckiest roll still grows the floor rather than reading
            // barren. Unwired/unknown biomes fall back to their base-family
            // profile, so no walkable zone is ever barren.
            // A park polygon reads its CHARACTER's row (meadow / wooded /
            // formal / common) — the same scatter over a variant profile.
            const isCemetery = f.tags.class === 'cemetery';
            const parkChar = t === T.PARK ? parkCharacterFor(f.geom, c0, isCemetery) : null;
            if (parkChar) parkPolys.push({ rings: f.geom, character: parkChar, cemetery: isCemetery });
            const floraPatch = BiomeProfiles.patch(t, parkChar);
            for (const fl of BiomeProfiles.flora(t, parkChar)) {
              if (fl.pattern === 'grassfill') continue; // final-grid pass includes unmapped ground
              const seed = (polyKey ^ (fl.salt >>> 0)) >>> 0;
              if (fl.pattern === 'hedgemaze') {
                // Deterministic clipped-hedge-maze layout (commercial plazas) —
                // keyed on absolute cell coords so the maze is continuous across
                // polygons/tiles, not a per-polygon scatter.
                yield* spawnHedgeMazeSteps(f.geom, fl.crop, fl.salt >>> 0);
              } else if (fl.dynamic) {
                const density = Math.max(fl.dMin, ((seed % 1000) / 1000) * fl.dMax);
                yield* spawnDebrisSteps(f.geom, fl.crop, seed, density, density, floraPatch);
              } else {
                yield* spawnDebrisSteps(f.geom, fl.crop, seed, fl.dMin, fl.dMax, floraPatch);
              }
            }
            // The character's own furniture: a wooded park's trees, a formal
            // park's clipped hedge rows (each on its own stream / lattice).
            const charRow = parkChar ? BiomeProfiles.parkCharacter(parkChar) : null;
            if (charRow && charRow.trees) yield* spawnParkTreesSteps(f.geom, polyKey, charRow.trees, floraPatch);
            if (charRow && charRow.hedgeRows) yield* spawnHedgeRowsSteps(f.geom, 'shrub', charRow.hedgeRows);

            // Scattered trees on wood/forest landcover, and fruit trees on
            // orchard landcover — both delegated as generators (see
            // spawnForestTreesSteps / spawnFruitTreesSteps above for why: a
            // whole-tile polygon runs either loop tens of thousands of times
            // with no yield if written plainly here).
            if (name === 'landcover') {
              const cls = f.tags.class || f.tags.subclass;
              if (cls === 'wood' || cls === 'forest') {
                yield* spawnForestTreesSteps(f.geom, polyKey);
              }
              if (cls === 'orchard' || f.tags.subclass === 'orchard') {
                yield* spawnFruitTreesSteps(f.geom);
              }
            }

            // Mineralrock cluster spawner — shared between RESIDENTIAL,
            // INDUSTRIAL, and ROCK passes. Each rock in a cluster is rolled
            // independently:
            //   70 % → plain CAVE rock (no ore, T1 pick suffices).
            //          Renders as one of the bottom-row sprite variants in
            //          stone with minerals.png. Drops 1-3 rockfruit.
            //   30 % → ORE rock. Tier picked from the caller's cumWeights table
            //          (residential/industrial/ROCK each provide their own
            //          dropoff curve). PICK REQUIREMENT is max(1, yieldT-1)
            //          — to mine copper-bearing rock (yieldT=2) you need a
            //          T1 wood pick; iron-bearing (T3) needs a T2 copper
            //          pick; up to frost-bearing (T7) which needs a T6
            //          crimson pick.
            // Also: never spawn on a BUILDING cell, even if the polygon
            // happens to overlap (residential polygons often contain
            // painted building footprints).
            // Surface generation always runs at depth 0, so ore here is the
            // rare end of the depth curve (~5 % copper). caveRockP makes the
            // underground levels (loadCaveTile) far richer.
            const _CAVE_ROCK_P = caveRockP(0);
            // No inline "blocked cell" / "near road" check here: it would be racy — the MVT polygon loop processes
            // roads, buildings, and landuse in feature-order, so a
            // residential polygon's mineralrock spawn might see a grid
            // where roads haven't been painted yet. The cleanup pass at
            // the end of the feature loop (search for "Post-pass:
            // mineralrock cleanup") walks the finished grid and drops any
            // rock on a blocked cell, plus any rock whose final cell is
            // residential and fails isSpawnCell. Just spawn here; the filter handles
            // correctness.
            // `tbl` is a cumWeights() table; the roll itself is the shared
            // rollRock (same draws as the cave spawner).
            const _pushMineralrock = (rng, jx, jy, tbl, clusterId, dry) => {
              if (!pointInRings(f.geom, jx, jy)) return;
              const { ix, iy, cx, cy } = snapCell(jx, jy);
              const roll = rollRock(rng, _CAVE_ROCK_P, tbl);
              if (dry) return;          // the draws, never the rock
              if (roll.plain) {
                objects.push(makeObject('mineralrock', cx, cy,
                  cellId('mr', tx, ty, ix, iy), {
                    requiredTier: 1, caveVariant: roll.caveVariant, _clusterId: clusterId,
                  }));
                return;
              }
              objects.push(makeObject('mineralrock', cx, cy,
                cellId('mr', tx, ty, ix, iy), {
                  requiredTier: roll.requiredTier, yieldTier: roll.yieldTier,
                }));
            };

            // Scatter mineralrock clusters across a polygon's bbox. At each pivot
            // on a `pivotStep` grid that lies inside the polygon, fire a cluster
            // with probability `fireChance`; each cluster drops
            // clusterMin..clusterMin+clusterSpan-1 rocks jittered within `clusterR`
            // of the pivot, routed through _pushMineralrock. RNG draw order is
            // fixed (fire roll, count roll, then jx/jy per rock) so world seeds reproduce.
            //
            // VEINS: if the caller supplies `veinChance` + raw `weights`, each
            // fired cluster rolls once more (rollVeinTable, VEIN_MUL) and may
            // become a vein cluster. The extra rng() draws happen only when
            // `veinChance` is set, so callers that don't pass it (industrial,
            // ROCK) reproduce their seeds exactly.
            // A GENERATOR for the same reason spawnDebrisSteps is one: the
            // pivot walk covers the polygon's whole bounding box, so one big
            // residential polygon is a single unbroken block sitting between
            // two `polygon fill rows` yields (a headless trace over one
            // measured 228 ms there). Breaking per row of pivots costs the
            // rng nothing — the draw order is untouched, so world seeds
            // reproduce exactly.
            const _spawnRockClustersSteps = function* (rng, geom, o) {
              const bb = bboxOf(geom);
              for (let yy = bb.minY; yy <= bb.maxY; yy += o.pivotStep) {
                // Every row, not every eighth: the pivot grid is coarse, so a
                // polygon has few rows and each of them is expensive.
                yield 'rock cluster rows';
                for (let xx = bb.minX; xx <= bb.maxX; xx += o.pivotStep) {
                  if (!pointInRings(geom, xx + o.pivotStep * 0.5, yy + o.pivotStep * 0.5)) continue;
                  if (rng() > o.fireChance) continue;
                  const clusterN = o.clusterMin + Math.floor(rng() * o.clusterSpan);
                  // Record the fired pivot for the yard-flora lane (no rng).
                  if (o.pivots) o.pivots.push({ x: xx, y: yy });
                  // Per-cluster tier table — defaults to the shared one, but a
                  // vein cluster gets a fresh table with one tier boosted.
                  const tbl = (o.veinChance && o.weights)
                    ? rollVeinTable(rng, o.weights, o.veinChance, o.tbl)
                    : o.tbl;
                  // Stable id for this cluster (residential only) so the cave
                  // entrance pass can roll a per-cluster chance over its rocks.
                  const clusterId = o.residential
                    ? cellId('rc', tx, ty, Math.floor(xx * mvtToCell), Math.floor(yy * mvtToCell))
                    : undefined;
                  for (let k = 0; k < clusterN; k++) {
                    const jx = xx + (rng() - 0.5) * 2 * o.clusterR;
                    const jy = yy + (rng() - 0.5) * 2 * o.clusterR;
                    _pushMineralrock(rng, jx, jy, tbl, clusterId, o.dry);
                  }
                }
              }
            };

            // Residential YARD flora — a bit of long grass and scrub grown in
            // among the yard rubble. Rides the rock lane: scatters around each
            // pivot the residential rock pass FIRED (`pivots`, recorded by
            // _spawnRockClustersSteps without touching its rng), within
            // `radiusK` × the rock cluster radius, from its OWN salted stream
            // (BiomeProfiles.yard(t).salt ^ polyKey) — the rocks' draws are
            // untouched, so existing worlds keep every rock where it was.
            // Cells are the tile-local basis spawnDebrisSteps uses; the id
            // carries a `_ry` suffix so it never collides with a debris tuft
            // (`wp_…_ix_iy`) or a POI pad's greenery (`_pp` / `_pl`). The
            // plants are flagged `_yard` so the post-pass culls them by the
            // ROCK's rule (_mrDrop) and the occupancy pass admits them via
            // BiomeProfiles.yardAllows. A generator for the tile-build rule:
            // one yield per 8 pivots.
            const _spawnYardFloraSteps = function* (geom, polyKey, pivots, clusterR, yard) {
              const yrng = makeRng((polyKey ^ (yard.salt >>> 0)) >>> 0);
              const r = clusterR * yard.radiusK;
              for (let p = 0; p < pivots.length; p++) {
                if ((p & 7) === 7) yield 'yard flora clusters';
                const n = yard.min + Math.floor(yrng() * yard.span);
                for (let k = 0; k < n; k++) {
                  // Fixed three draws per try, so a rejected try never shifts
                  // the stream for the ones after it.
                  const jx = pivots[p].x + (yrng() - 0.5) * 2 * r;
                  const jy = pivots[p].y + (yrng() - 0.5) * 2 * r;
                  let pick = yrng();
                  if (!pointInRings(geom, jx, jy)) continue;
                  const ix = Math.floor(jx * mvtToCell);
                  const iy = Math.floor(jy * mvtToCell);
                  if (ix < 0 || iy < 0 || ix >= w || iy >= h) continue;
                  let crop = yard.crops[yard.crops.length - 1].crop;
                  for (const c of yard.crops) {
                    if (pick < c.share) { crop = c.crop; break; }
                    pick -= c.share;
                  }
                  const { mx, my } = cellCenterMeters(ix, iy);
                  yardFlora.push(makeWildplant(crop, mx, my,
                    `wp_${tx}_${ty}_${ix}_${iy}_ry`, { _ix: ix, _iy: iy, _yard: true }));
                }
              }
            };

            // Residential mineral clusters — abandoned-yard / construction
            // piles in town. Pivot grid is ~24 m and ~59 % of candidates fire,
            // so a residential polygon spawns a handful of clusters; each is a
            // group of low-tier rocks within ~7 m. Gives the early game a
            // reliable urban source of stone + low-tier ore. ~30 % of clusters
            // are "veins" with one ore/crystal tier concentrated 10× (see the
            // vein path in _spawnRockClustersSteps) without flooding sidewalks.
            if (isLotTerrain(t)) {
              const resRng = makeRng((polyKey ^ 0xFA11) >>> 0);
              const pivotStep = 34 / mvtToM;        // one cluster candidate per ~34 m (~5 cells at 7 m/cell; was 24 m when cells were 5 m)
              const clusterR  = 7  / mvtToM;        // rocks placed within ~7 m of pivot
              // Tier weights for the ORE subset (the share that isn't plain
              // cave rock — caveRockP(0) ⇒ ~90 % plain on the surface). Copper
              // is T2 at weight 0.25 of the subset, so copper-bearing rock is
              // ~0.10 × 0.25 ≈ 2.5 % of all surface rocks. Underground the same
              // shape is reused with a smaller plain fraction (richer with
              // depth) but plain rock always stays the majority (see caveRockP).
              const weights = SURFACE_ROCK_TIER_WEIGHTS;   // shared with rollSurfaceRockTier
              // 25..40 rocks per cluster: residential rocks survive the
              // road-adjacency filter at a lower rate, so input must overshoot.
              // fireChance 0.585 = 0.45 × 1.3 → 30 % more clusters than before.
              // veinChance 0.30: ~30 % of clusters become a "vein" where one
              // random tier is VEIN_MUL× more likely (see rollVeinTable). Pass
              // the raw `weights` so the vein path can rebuild a boosted table.
              const pivots = [];
              // DRY on RESIDENTIAL only: residential rubble no longer scatters
              // through the zone — rocks now LINE a quarter of the minor
              // streets instead (spawnStreetRocksSteps, off
              // StreetVariants.rocksFor). The walk still runs there, with
              // every draw it always took, only because the yard flora below
              // grows around the pivots it FIRES — so the flora is exactly
              // what it was. WASTELAND lots keep the old scatter (LOT_ROCK_DRY
              // names which lot ground is dry): waste ground is where rubble
              // belongs, same generator, same stream shape.
              yield* _spawnRockClustersSteps(resRng, f.geom, {
                pivotStep, clusterR, fireChance: BiomeProfiles.staticObjects(t).rockFireChance ?? 0.585,
                clusterMin: 25, clusterSpan: 16, tbl: SURFACE_ROCK_CUM, residential: true,
                weights, veinChance: 0.30, pivots, dry: LOT_ROCK_DRY.has(t) });
              const yard = BiomeProfiles.yard(t);
              if (yard && pivots.length) {
                yield* _spawnYardFloraSteps(f.geom, polyKey, pivots, clusterR, yard);
              }
              // (Sparse residential-yard mushrooms now spawn via the
              // BIOME_PROFILES flora loop above — see the RESIDENTIAL profile.)
            }

            // Industrial mineral piles — old quarries, scrap yards, slag heaps.
            // Dense (lots of rocks): tight pivot grid + high fire chance + bigger
            // clusters than residential. Tier dropoff is slower (1/1.6^(t-1)) so
            // mid-tier metals (gold/platinum) actually show up here, but T7 stays
            // very rare via the geometric tail (~3 % per cluster pick).
            if (t === T.INDUSTRIAL) {
              const indRng = makeRng((polyKey ^ 0xC0A11D) >>> 0);
              const pivotStep = 20 / mvtToM;        // ~one candidate per 20 m — much denser than residential's 34 (was 14 m when cells were 5 m)
              const clusterR  = 5  / mvtToM;        // ~5 m cluster radius
              // Slower tier dropoff than residential — mid-tier ore (gold,
              // platinum) shows up regularly while T7 stays ~3 % per ore pick.
              const tbl = cumWeights(
                Array.from({ length: 7 }, (_, i) => 1 / Math.pow(1.6, i)));
              // 80 % fire — "lots"; 18..33 rocks per cluster (3× the prior 6..11).
              yield* _spawnRockClustersSteps(indRng, f.geom, {
                pivotStep, clusterR, fireChance: 0.80,
                clusterMin: 18, clusterSpan: 16, tbl });
            }

            // Dense mineral rock clusters on ROCK terrain (scree / cliff landcover).
            // Cluster style mirrors residential but at higher density — tight 12 m
            // pivot grid, 70 % fire rate, 10-19 rocks per cluster. Tier weights use
            // a steeper geometric decay than industrial so low-tier stones dominate
            // but rare wilderness finds (T5-T7) are still possible.
            if (t === T.ROCK) {
              const rockRng = makeRng((polyKey ^ 0xCAFE) >>> 0);
              const pivotStep = 17 / mvtToM;        // was 12 m when cells were 5 m; scaled ×7/5
              const clusterR  =  6 / mvtToM;
              // 1/2^(t-1): T1 ~50%, T2 ~25%, T3 ~13% … T7 ~1% of ore subset.
              // _pushMineralrock still routes 70% of picks to cave rock.
              const tbl = cumWeights(
                Array.from({ length: 7 }, (_, i) => 1 / Math.pow(2, i)));
              yield* _spawnRockClustersSteps(rockRng, f.geom, {
                pivotStep, clusterR, fireChance: 0.70,
                clusterMin: 10, clusterSpan: 10, tbl });
            }
          }
        } else if (f.type === 2 && name === 'transportation') {
          const t = classifyLine(name, f.tags);
          if (t == null) continue;
          // Parking-lot aisles are dropped ENTIRELY — and BEFORE the footprint
          // stamp below, so they bar no spawns and no tilling either. A lot
          // carpeted in parallel service lines spaced closer than one cell
          // would rasterize into a solid asphalt blob, not a road network; the
          // lot keeps its landuse paint and the parking-POI treasure X already
          // marks it. See isLotLane for the full reach of the rule (the lane
          // is already cut from the layer; this is belt and braces).
          if (isLotLane(f.tags)) continue;
          // Record the way's full drawn footprint — regardless of how narrow a
          // band the rasterizer is about to paint. This is the mask the spawn
          // filters read; see roadMask above.
          {
            // Fractional width, no rounding: the stamp samples the band's
            // own coverage of each cell, so how much of a cell the band
            // spills into is measured, not rounded to a whole cell.
            // In CELLS (metres over CELL_M, the generation basis), never over
            // the frame's cellWidthM: the mask is generated, so it must not
            // move with the save's home latitude.
            const widthCells = roadOverlayWidthM(f.tags) / CELL_M;
            for (const line of f.geom) yield* stampCoverLineSteps(roadCover, w, h, line, widthCells, mvtToCell);
            // The MAJOR ways (the old trade roads) stamp the same band a second
            // time into their own cover, in this same pass — the one lane
            // roadClass is resolved from (see ROAD_CLASS_MAJOR_BAND).
            if (t === T.ROAD_MD || t === T.ROAD_LG) {
              for (const line of f.geom) yield* stampCoverLineSteps(majorCover, w, h, line, widthCells, mvtToCell);
              // And the kerb buffer: the same line, MAJOR_BUFFER_CELLS wider
              // each side (see ROAD_CLASS_MAJOR_BUFFER). Lines in the tile's
              // MVT buffer stamp too, so a band just over the seam still
              // buffers this side of it.
              const bufCells = widthCells + 2 * MAJOR_BUFFER_CELLS;
              for (const line of f.geom) yield* stampCoverLineSteps(majorBufCover, w, h, line, bufCells, mvtToCell);
            }
          }
          // Roads and paths rasterize exactly ONE cell wide regardless of
          // their OSM width: the cobble tile fills the whole cell, so wider
          // disk stamping only made the band wobble between 1 and 2 rows
          // ("ladder" artifacts) and welded dual carriageways together.
          // Two parallel OSM ways now read as two clean uniform lanes.
          // Piers keep their measured width (their plank sprite fills the
          // whole cell, so coverage IS their width).
          const wCells = (t === T.PIER)
            ? Math.max(1, Math.round(roadWidthM(f.tags) / CELL_M))
            : 1;
          // PATH records its under-biome in pathUnder (render draws it beneath
          // the sparse path pebbles); vehicle road tiers record theirs in the
          // rasterize-local roadUnder so the erosion pass can restore dissolved
          // cells. Piers record nothing — they're never eroded and their plank
          // sprite fully covers the cell.
          const under = t === T.PATH ? pathUnder : (t === T.PIER ? undefined : roadUnder);
          // A footpath paints only the cells it actually crosses; roads and
          // piers paint every cell they touch, as before.
          const allow = t === T.PATH ? pathCrossAt : null;
          for (const line of f.geom) paintLine(grid, w, h, line, t, wCells, mvtToCell, under, allow);
        } else if (f.type === 1 && name === 'poi') {
          // POI points → a generic chest (single sprite, no themed subkinds).
          // Only spawn for "useful" POI classes.  Parking POIs are diverted to treasure marks instead.
          const cls = f.tags.class || '';
          // POI points settle on THIS tile's own cell grid: the cell index is
          // floored straight out of the MVT point (the grid's own basis), and
          // only the settled cell is turned into frame metres. The old snap
          // went through frame metres (tileEdgeM / cellWidthM), which made the
          // chest's cell — and so its id — depend on the save's home latitude.
          //
          // ONE TILE OWNS A POINT. An MVT tile carries every point inside its
          // buffer, so a POI near a seam arrives in two (or four) tiles, each
          // of which used to mint its own chest and rely on a cross-tile dedup
          // whose survivor was whichever tile loaded FIRST. Now a tile keeps a
          // POI only when the point lies inside its own square [0, EXTENT) —
          // a fact of the point, not of the load order — and the neighbour
          // that owns it mints it. Same for the parking X below.
          const ownsPoint = (p) => p.x >= 0 && p.y >= 0 && p.x < TILE_EXTENT && p.y < TILE_EXTENT;
          // A sensitive place (a memorial, a cemetery, another faith's house
          // of prayer — isSensitivePoi) mints NOTHING: no chest, no stall,
          // no X, no gate, no board. First, before any branch can mint.
          if (isSensitivePoi(f.tags)) continue;
          if (cls === 'parking' || cls === 'motorcycle_parking') {
            // Car + motorcycle parking → guaranteed treasure X (no chest).
            for (const ring of f.geom) {
              const p = ring[0];
              if (!ownsPoint(p)) continue;
              const pix = Math.floor(p.x * mvtToCell), piy = Math.floor(p.y * mvtToCell);
              const { mx: cx, my: cy } = cellCenterMeters(pix, piy);
              parkingTreasures.push({ x: cx, y: cy, id: cellId('t_park', tx, ty, pix, piy) });
            }
            continue;
          }
          if (cls === POI_GATE_CLASS || cls === POI_INFO_CLASS) {
            // Placed after the road mask is resolved (the gate / notice-board
            // pass) — both want to know what ground they stand beside.
            for (const ring of f.geom) {
              const p = ring[0];
              if (!ownsPoint(p)) continue;
              const pt = { ix: Math.floor(p.x * mvtToCell), iy: Math.floor(p.y * mvtToCell) };
              (cls === POI_GATE_CLASS ? gatePoints : infoPoints).push(pt);
            }
            continue;
          }
          const beachPoi = typeof Zones !== 'undefined' && Zones.anchorOf(f.tags)?.kind === 'beach';
          if (!POI_USEFUL.has(cls) && !beachPoi) continue;
          for (const ring of f.geom) {
            const p = ring[0];
            if (!ownsPoint(p)) continue;
            // The POI's own cell (before any placement offset): the pad
            // greenery's seed below reads it, so it is fixed by the point.
            const poiIX = Math.floor(p.x * mvtToCell);
            const poiIY = Math.floor(p.y * mvtToCell);
            const { mx: cx, my: cy } = cellCenterMeters(poiIX, poiIY);
            const id = cellId('c', tx, ty, poiIX, poiIY);
            // `_poiAt`: the POI's own tile-local point — how an influence
            // zone (src/zones.js) finds the chest its anchor minted, however
            // far the placement below slides it.
            // `subclass`: the MVT's finer kind (shop/convenience, lodging/hotel,
            // …). Read by loot.js venueProductFor, where a generic `shop`'s
            // subclass can name a produce stall before the Sundries counter
            // takes the rest. Tile bytes only, so the same on every device.
            objects.push(makeObject('chest', cx, cy, id,
              { poiClass: cls, subclass: f.tags.subclass || '', name: f.tags.name || '', _poiAt: `${p.x},${p.y}`,
                // The MVT rank tag (notability, lower = better): the tier
                // seeding's "best POI first" signal. Every tile POI carries one.
                rank: f.tags.rank }));
            // The beach shrine keeps the ordinary POI identity and later
            // dedupe/quiet-land gates, but must not pave its source sand.
            if (beachPoi) continue;
            // Synthesized concrete-pad terrain around the POI, in a per-class SHAPE.
            // Building polygons are independent of POIs and never overpainted: if the POI
            // point lands on or right next to a building, slide it to the nearest non-
            // building cell — preferring one next to a road/path (so the player can
            // actually reach the chest). See offsetForPlacement / POI_PAD_KEEP above.
            let cellIX = poiIX;
            let cellIY = poiIY;

            // If the POI is INSIDE a building polygon, dissolve that building into a plain
            // concrete pad: remove the house sprite, leave the BUILDING_LARGE cells as-is
            // (they already read as cement), and skip both the placement-offset and the
            // synthesized pad shape — the building's footprint becomes the POI's pad.
            const initialIdx = cellIY * w + cellIX;
            const onBuilding = cellIX >= 0 && cellIY >= 0 && cellIX < w && cellIY < h
              && isBuildingTerrain(grid[initialIdx]);
            let shapeOffsets = null;
            let padType = T.PARK;
            let spawnGreenery = false;
            if (onBuilding) {
              // Flood-fill the connected building footprint and promote it to BUILDING_LARGE
              // so the pad reads as one civic slab regardless of original tier.
              const seen = new Set([initialIdx]);
              const stack = [[cellIX, cellIY]];
              while (stack.length) {
                const [ix, iy] = stack.pop();
                grid[iy * w + ix] = T.BUILDING_LARGE;
                for (const [ddx, ddy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
                  const nx = ix + ddx, ny = iy + ddy;
                  if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                  const nidx = ny * w + nx;
                  if (seen.has(nidx)) continue;
                  if (isBuildingTerrain(grid[nidx])) { seen.add(nidx); stack.push([nx, ny]); }
                }
              }
              // buildingShapes was already pushed at this footprint's ORIGINAL tier
              // during the 'building' layer's own pass (`order` runs building before
              // poi — see above), so the flood-fill's grid promotion above never
              // reaches it. Left alone, the polygon overlay (BuildingOverlay, on by
              // default) keeps drawing the source ring as a house or a palisade-
              // fenced fort floor forever, while the grid — and the castle-tower
              // scan that reads it later — correctly treat these cells as one
              // civic slab. That mismatch is what puts turrets on a palisade floor.
              // Match buildingShapes entries to dissolved cells via the same
              // ownerKey the tower/claim logic already keys castles and houses by.
              const dissolvedKeys = new Set();
              for (const idx of seen) {
                const key = ownerKeys[owners[idx]];
                if (key) dissolvedKeys.add(key);
              }
              if (dissolvedKeys.size) {
                for (const shape of buildingShapes) {
                  if (shape.key && dissolvedKeys.has(shape.key)) shape.tier = T.BUILDING_LARGE;
                }
              }
              // Remove every house sprite whose centroid falls inside the dissolved footprint.
              // A school/mall is often several adjacent building polygons, each of which pushed
              // its own house sprite — removing only the nearest leaves the others on the pad.
              // COMPACTED IN PLACE (one write index, order kept), not spliced: a
              // reverse walk calling objects.splice(i, 1) per hit rewrites the tail
              // every time — quadratic on a big civic slab with many house sprites.
              // Kept per footprint (O(objects) per dissolve) rather than deferred to
              // one pass after the POI loop: `objects` is read and pushed between
              // POIs, so a deferred sweep would have to prove nothing in between
              // sees (or adds) a house on a dissolved cell.
              {
                let wr = 0;
                for (let i = 0; i < objects.length; i++) {
                  if ((i & 255) === 0) yield 'civic building dedupe';
                  const o = objects[i];
                  if (o.kind === 'house') {
                    const { ix: ox, iy: oy } = cellOfWorldM(o.x, o.y);
                    if (ox >= 0 && oy >= 0 && ox < w && oy < h && seen.has(oy * w + ox)) continue;
                  }
                  objects[wr++] = o;
                }
                objects.length = wr;
              }
              // Public-facing chest placement. Most civic buildings are closed to the
              // public (school hours, hospital wings, etc.) — dropping the chest deep
              // inside the slab forces players to "enter" the building. Instead, find
              // the perimeter cell nearest the closest road/path and put the chest
              // there: it reads as the building's entrance / sidewalk frontage.
              let nearRoad = null, bestRoadD = 60 * 60;
              for (let dy = -60; dy <= 60; dy++) {
                // 121x121 = ~14.6k cells, once per civic POI. Unbroken, that is
                // one of the longest stretches in a build on a tile with a few
                // schools or malls on it.
                if ((dy & 31) === 0) yield 'civic road scan';
                for (let dx = -60; dx <= 60; dx++) {
                  const ix = cellIX + dx, iy = cellIY + dy;
                  if (ix<0||iy<0||ix>=w||iy>=h) continue;
                  if (!isCobbleTerrain(grid[iy * w + ix])) continue;
                  const d2 = dx*dx + dy*dy;
                  if (d2 < bestRoadD) { bestRoadD = d2; nearRoad = { ix, iy }; }
                }
              }
              if (nearRoad) {
                let bestPerimD = Infinity, bestPerim = null;
                for (const idx of seen) {
                  const ix = idx % w, iy = Math.floor(idx / w);
                  let isPerim = false;
                  for (const [ddx, ddy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
                    const nx = ix + ddx, ny = iy + ddy;
                    if (nx<0||ny<0||nx>=w||ny>=h) { isPerim = true; break; }
                    if (!seen.has(ny * w + nx)) { isPerim = true; break; }
                  }
                  if (!isPerim) continue;
                  const dx = ix - nearRoad.ix, dy = iy - nearRoad.iy;
                  const d2 = dx*dx + dy*dy;
                  if (d2 < bestPerimD) { bestPerimD = d2; bestPerim = { ix, iy }; }
                }
                if (bestPerim) { cellIX = bestPerim.ix; cellIY = bestPerim.iy; }
              }
            } else {
              // A POI can mark an entire campus or playing field. Only source
              // building footprints establish structures; a point alone must
              // not invent a castle on otherwise open ground.
              const placement = offsetForPlacement(cellIX, cellIY);
              cellIX = placement.ix;
              cellIY = placement.iy;
            }
            // Patch the chest we just pushed onto its settled cell — the
            // building's frontage or the road-facing open-ground cell.
            {
              const { mx: adjustedMx, my: adjustedMy } = cellCenterMeters(cellIX, cellIY);
              const lastChest = objects[objects.length - 1];
              if (lastChest && lastChest.kind === 'chest' && lastChest.id === id) {
                lastChest.x = adjustedMx; lastChest.y = adjustedMy;
                lastChest.id = cellId('c', tx, ty, cellIX, cellIY);
              }
            }
            // No synthesized pad when the POI dissolved a building (the building IS the pad).
            if (!onBuilding) {
              if (POI_PARK_FAMILY.has(cls)) {
                const r = Math.ceil(18 / CELL_M);
                const arr = [];
                for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++)
                  if (dx*dx + dy*dy <= r*r) arr.push([dx, dy]);
                shapeOffsets = arr;
                padType = T.PARK;
                spawnGreenery = true;
              } else if (cls === 'hospital') {
                const arr = [];
                const arm = 3;
                for (let d = -arm; d <= arm; d++) {
                  arr.push([d, 0]);
                  if (d !== 0) arr.push([0, d]);
                }
                shapeOffsets = arr;
                padType = T.COMMERCIAL;
              }
            }
            if (shapeOffsets) {
              const poiKey = cellHash(tx, ty, poiIX, poiIY);
              const prng = makeRng(poiKey ^ 0xfade5a17);
              // The pad's greenery reads the park's CHARACTER (keyed on the
              // POI's own global point — the grove anchor's key too), so a
              // named park's heart looks like the park it sits in: its `pad`
              // row (was shrub 0.18 / long grass 0.10 for every park).
              const padChar = spawnGreenery
                ? BiomeProfiles.parkCharacterAt(tx * TILE_EXTENT + p.x, ty * TILE_EXTENT + p.y) : null;
              const padRow = padChar ? BiomeProfiles.parkCharacter(padChar).pad : null;
              const shrubDensity = padRow ? padRow.shrub : 0;
              const longgrassDensity = padRow ? padRow.longgrass : 0;
              // The park's own clumps (BiomeProfiles FLORA_PATCH): the pad's
              // greenery thins and gathers with the park around it.
              const padPatch = spawnGreenery ? BiomeProfiles.patch(padType, padChar) : null;
              for (const [dx, dy] of shapeOffsets) {
                const ix = cellIX + dx, iy = cellIY + dy;
                if (ix < 0 || iy < 0 || ix >= w || iy >= h) continue;
                const idx = iy * w + ix;
                if (POI_PAD_KEEP.has(grid[idx])) continue;
                grid[idx] = padType;
                // Track concrete pads (not park buffers) so the post-pass can
                // keep scatter interactables off the POI's plaza.
                if (padType !== T.PARK) poiPadCells.add(idx);
                if (spawnGreenery) {
                  const r1 = prng(), r2 = prng();
                  const { mx: cellCenterMx, my: cellCenterMy } = cellCenterMeters(ix, iy);
                  const pm = padPatch ? BiomeProfiles.patchMul(padPatch,
                    tx * TILE_EXTENT + (ix + 0.5) / mvtToCell, ty * TILE_EXTENT + (iy + 0.5) / mvtToCell) : 1;
                  if (r1 < shrubDensity * pm) {
                    wildplants.push(makeWildplant('shrub', cellCenterMx, cellCenterMy,
                      `wp_${tx}_${ty}_${ix}_${iy}_pp`, { _ix: ix, _iy: iy }));
                  } else if (r2 < longgrassDensity * pm) {
                    wildplants.push(makeWildplant('longgrass', cellCenterMx, cellCenterMy,
                      `wp_${tx}_${ty}_${ix}_${iy}_pl`, { _ix: ix, _iy: iy }));
                  }
                }
              }
            }
          }
        }
      }
      // Building distribution post-process — runs ONCE per layer, but only
      // does work when this layer is 'building'. After collecting every
      // building ring (above), enforce the per-tile floors (≥50% house,
      // ≥8% fort, ≥2% castle — see TIER_FLOOR_*) by re-tiering by area-rank
      // where needed.
      // Then paint + push house objects (LARGE gets a cement pad with no
      // sprite; everything else gets a 'house' object).
      yield `${name} features`;
      if (name === 'building' && buildingPolys.length) {
        // Give every building an EXCLUSIVE set of cells before anything is
        // painted. Cells are assigned by how much of them the polygon actually
        // covers (>45%, or >34.6% where it squares the footprint off), with
        // every contested cell decided by cover rather than by paint order, so
        // footprints can never overlap and no building can be swallowed by its
        // neighbour. Assignment runs with a 3-cell pad past the tile bounds so
        // an edge-clipped building shapes the same in both tiles that draw it;
        // only the in-bounds cells are painted.
        yield 'building block start';
        const footprints = yield* assignBuildingFootprintsSteps(buildingPolys, mvtToCell, w, h, 3);
        yield 'assignBuildingFootprints';
        // Tier floors are enforced AFTER assignment, over the buildings that
        // actually landed on the tile — a building that got no cell at all
        // mustn't consume the tile's one guaranteed castle/fort slot.
        const _placed = buildingPolys.filter((bp, i) => footprints[i].some(
          ([fx, fy]) => fx >= 0 && fy >= 0 && fx < w && fy < h));
        enforceBuildingDistribution(_placed);
        yield 'enforceBuildingDistribution';
        for (let _bi = 0; _bi < buildingPolys.length; _bi++) {
          if ((_bi & 15) === 0) yield 'building paint';
          const bp = buildingPolys[_bi];
          // Stamp building ownership over this building's footprint cells with
          // a unique per-tile id. Footprints are disjoint, so a cell has
          // exactly one owner. The renderer strokes a seam wherever two
          // adjacent building cells carry different owners, separating
          // buildings whose footprints abut into one contiguous block.
          const ownerId = (++nextBuildingOwnerId) & 0xffff;
          // Remembered on the poly so the overlay's shape can be resolved to
          // the same ownerKey after the loop (a house's key is minted further
          // down, past two `continue`s, so it can't be read here).
          bp._ownerId = ownerId;
          if (bp.tier === T.BUILDING_LARGE) {
            castleSourceRings.push({ ownerId, ring: bp.ring });
            let haloCells = 0;
            for (const [fx, fy] of footprints[_bi]) {
              if ((haloCells++ & 127) === 0) yield 'tower footprint halo';
              if (fx < 0 || fy < 0 || fx >= w || fy >= h) castleHalo.set(`${fx}_${fy}`, ownerId);
            }
          }
          const fpCells = [];
          for (const [fx, fy] of footprints[_bi]) {
            if (fx < 0 || fy < 0 || fx >= w || fy >= h) continue;
            paintCell(grid, w, h, fx, fy, bp.tier);
            owners[fy * w + fx] = ownerId;
            fpCells.push([fx, fy]);
          }
          // A STABLE IDENTITY for this footprint, minted before the sprite
          // skip below so the tiers that draw no sprite still get one.
          //
          // A castle (BUILDING_LARGE) is the reason this exists. It emits no
          // house object at all — it is a block of tier-12 cells with a
          // scatter of separate `tower` objects around its rim, one per ~5
          // perimeter cells, each carrying its own id. So there was nothing in
          // the data that meant "this castle": anything recorded against a
          // tower id was recorded against ONE TURRET, and the same castle read
          // as claimed from one corner and unclaimed from another.
          //
          // The key is the footprint's own anchor cell in ABSOLUTE cell
          // coords, so every cell and every turret of one castle agrees on it
          // and it survives a tile rebuild. (A footprint split across a tile
          // seam mints one key per side. Houses don't have that limitation any
          // more — see the house anchor below.)
          if (fpCells.length && bp.tier === T.BUILDING_LARGE) {
            let kx = 0, ky = 0;
            for (const [fx, fy] of fpCells) { kx += fx; ky += fy; }
            const akx = tx * w + Math.round(kx / fpCells.length);
            const aky = ty * h + Math.round(ky / fpCells.length);
            ownerKeys[ownerId] = `b_${akx}_${aky}`;
          }
          // Civic / industrial slabs (schools / malls / hospitals) read as a
          // cement pad — a residential house roof on top of one looks wrong,
          // so skip the sprite.
          if (bp.tier === T.BUILDING_LARGE) continue;
          // No cell on this tile (a building clipped to a sliver at the seam,
          // or one too small to claim anywhere) → no sprite either. The old
          // code fell back to the ring centroid here, which planted a house
          // roof on a cell that wasn't part of any building footprint.
          if (!fpCells.length) continue;
          // Anchor the house on its RASTERIZED FOOTPRINT: take the footprint
          // cells' centroid, then pick the footprint cell nearest it. This
          // guarantees the sprite's bottom-middle sits on an actual building
          // tile even for L-shaped footprints (where the ring centroid can land
          // off the block). Snapping to a cell also keeps the occupancy pass
          // and row alignment working.
          //
          // THE WHOLE FOOTPRINT, pad cells included — and that is what makes
          // a house at a seam ONE house. assignBuildingFootprints shapes a
          // building with a 3-cell pad past the tile bounds, so the two tiles
          // either side of a seam compute the same footprint and so the same
          // anchor; the tile whose square holds the anchor OWNS the house and
          // mints it, and the other emits nothing (its half still paints, and
          // its cells resolve to the owner's id below). This replaced a
          // cross-tile proximity dedup whose survivor was whichever tile
          // happened to load first — two players got two different houses.
          // Integer arithmetic (doubled coordinates) so the pick is exact and
          // translation-invariant: both tiles see the same numbers shifted by
          // a whole tile, and ties break on (row, column), never array order.
          const allFp = footprints[_bi];
          const nFp = allFp.length;
          let sx2 = 0, sy2 = 0;
          for (const [fx, fy] of allFp) { sx2 += 2 * fx + 1; sy2 += 2 * fy + 1; }
          let best = allFp[0], bd = Infinity;
          for (const [fx, fy] of allFp) {
            const ex = nFp * (2 * fx + 1) - sx2, ey = nFp * (2 * fy + 1) - sy2;
            const d = ex * ex + ey * ey;
            if (d < bd || (d === bd && (fy < best[1] || (fy === best[1] && fx < best[0])))) {
              bd = d; best = [fx, fy];
            }
          }
          // Which tile owns the anchor, and the anchor's cell on THAT tile.
          // (A neighbour across an east/west seam always has this tile's cell
          // count; one across a north/south seam does too except on the rare
          // row where cellsPerEdgeForTile steps by one, where the two grids
          // differ and a seam building can come out doubled or missing.)
          const otx = tx + Math.floor(best[0] / w), oty = ty + Math.floor(best[1] / h);
          const oix = best[0] - Math.floor(best[0] / w) * w;
          const oiy = best[1] - Math.floor(best[1] / h) * h;
          // Stable id for per-house shop state (deal rate-limit, future ledger).
          const id = cellId('h', otx, oty, oix, oiy);
          // House / fort cells resolve to the house object's own id — the key
          // save.restoredHouses and save.unlockedForts are stored under — so
          // "is the building under this cell claimed" is one lookup, from
          // either side of a seam. (A castle has no house object at all, so it
          // keys on its footprint instead; see the BUILDING_LARGE mint above.)
          ownerKeys[ownerId] = id;
          if (otx !== tx || oty !== ty) continue;   // the neighbour mints it
          const cc = cellCenterMeters(best[0], best[1]);
          const cx = cc.mx, cy = cc.my;
          // Synthetic 3-digit street address derived from the house's own
          // tile + cell (→ shop type), so its shop role is the same in every
          // save. Houses whose address ends in 9 become blacksmiths (~10%).
          const address = cellHash(otx, oty, oix, oiy) % 1000;
          objects.push(makeObject('house', cx, cy, id,
            { area: bp.areaM2, tier: bp.tier, address }));
        }
        yield 'building paint (all footprints)';
        // Export the SOURCE rings for the polygonal footprint overlay. Done
        // after the paint loop, not inside it: a house's ownerKey is minted at
        // the very end of the loop body, so reading it any earlier would hand
        // the overlay a null key and draw every house as claimed.
        for (const bp of buildingPolys) {
          const ring = new Float32Array(bp.ring.length * 2);
          for (let i = 0; i < bp.ring.length; i++) {
            ring[i * 2] = bp.ring[i].x * mvtToFrameM;
            ring[i * 2 + 1] = bp.ring[i].y * mvtToFrameM;
          }
          buildingShapes.push({
            ring,
            tier: bp.tier,
            areaM2: bp.areaM2,
            key: (bp._ownerId && ownerKeys[bp._ownerId]) || null,
          });
        }
        // Thin merged house icons. When several tiny building polygons abut and
        // rasterize into one continuous block of building tiles, each polygon
        // still drops its own roof — so the merged footprint reads as a cluster
        // of crammed-together houses. Cap it at roughly one icon per two
        // continuous tiles: greedily keep the largest-area house and drop any
        // whose anchor cell is adjacent (Chebyshev ≤ 1, i.e. its footprint
        // touches) an already-kept roof. Separate buildings with a gap between
        // their footprints sit ≥ 2 cells apart and both survive.
        //
        // THE ADJACENCY TEST IS A LOOKUP, NOT A SCAN. "Is any kept roof within
        // Chebyshev 1" is exactly "is one of these nine cells taken", so the
        // kept anchors live in a Set keyed by cell and each house probes its
        // own 3x3. The scan it replaces walked every roof kept so far — O(H^2)
        // on a tile whose houses are mostly spread out (the case where nothing
        // is dropped, so the list only ever grows), with an array destructure
        // per step. That loop WAS the boot stutter: it sits between the last
        // yield of the building block and the next one, so the slicer could
        // not break it up, and it showed in a device trace as `worst block
        // 1397ms in after the layer loop` on a tile of a few thousand
        // buildings — one frozen frame per tile, eight more streaming in
        // behind the player. Same greedy rule, same survivors, ~O(H).
        const _houseIdx = [];
        for (let k = 0; k < objects.length; k++) if (objects[k].kind === 'house') _houseIdx.push(k);
        _houseIdx.sort((a, b) => (objects[b].area || 0) - (objects[a].area || 0));
        const _keptHouseCells = new Set();
        const _dropHouse = new Set();
        for (const k of _houseIdx) {
          const o = objects[k];
          // This tile's own cell (every house here is on it), not a global
          // floor(x / CELL_M) cell of frame metres.
          const { ix: hix, iy: hiy } = cellOfWorldM(o.x, o.y);
          let tooClose = false;
          for (let dy = -1; dy <= 1 && !tooClose; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (_keptHouseCells.has(`${hix + dx},${hiy + dy}`)) { tooClose = true; break; }
            }
          }
          if (tooClose) _dropHouse.add(k);
          else _keptHouseCells.add(`${hix},${hiy}`);
        }
        // One compaction pass, not one splice per drop: splicing from the tail
        // is still O(drops x objects) of element shuffling, and `objects` is
        // every scatter item on the tile, not just the roofs. Descending
        // splices and a keep-filter leave the identical array.
        if (_dropHouse.size) {
          let _w = 0;
          for (let k = 0; k < objects.length; k++) {
            if (!_dropHouse.has(k)) objects[_w++] = objects[k];
          }
          objects.length = _w;
        }
      }
    }
    yield 'after the layer loop';
    // Every way is stamped: resolve the road mask from the coverage bits
    // (ROAD_MASK_MIN_COVER). Nothing above reads roadMask; everything below does.
    yield* resolveRoadMaskSteps(roadCover, roadMask, w, h);
    yield* resolveRoadClassSteps(majorCover, roadMask, roadClass, w, h, majorBufCover);
    // QUIET LAND (QUIET_LAND): military, railway, reserve and cemetery cells
    // host nothing. Stamped here, beside the road mask, so every cull and
    // spawner below reads it (the mineralrock cleanup, the gates and boards,
    // the street and zone dressing) — and carried on the entry for the ones
    // outside the build (spawnInTile's _spawnOpts.quiet, the stair pass).
    const quietMask = new Uint8Array(w * h);
    yield* stampQuietLandSteps(layers, quietMask, w, h, mvtToCell, grid);
    // THE STREET INDEX (src/street_variants.js): every street's key, size and
    // variant, and the hedgerow closes — pure MVT, so a rebuilt entry derives
    // the same one. Then the street ROCKS it asks for, pushed before the
    // mineralrock cleanup below so they pass the one post-pass filter.
    let streetIndex = null;
    let streetArea = null;
    if (typeof StreetVariants !== 'undefined') {
      streetIndex = yield* StreetVariants.buildIndexSteps(layers, tx, ty, mvtToM);
      streetArea = yield* StreetVariants.areaSteps(streetIndex, w);
      yield* StreetVariants.stampBanditStretchesSteps(streetIndex, roadClass, w, tx, ty);
      yield* spawnStreetRocksSteps(streetIndex);
    }
    const hasStreetArea = !!streetArea && streetArea.some(Boolean);
    // Post-pass: pavement-blob erosion. Overlapping/parallel road + path ways
    // (sidewalk meshes, plaza loops, anything denser than one cell apart)
    // weld into solid paved zones; dissolve the strict same-kind interior back
    // to the under-biome so pavement always reads as lines and loops, never
    // as a flood-filled area. Runs after ALL painting (buildings included) so
    // the interior test sees the final grid, and before the road-label /
    // path-stone passes so no glyph or stone lands on a dissolved cell.
    erodePavementBlobs(grid, w, h, pathUnder, roadUnder);
    yield 'pavement erosion';
    // Post-pass: the short-path-run floor. A run of fewer than
    // MIN_PATH_RUN_CELLS cobble cells is a stub, not a path — dissolve it back
    // to the ground it covered so it grows no stones and carries no trail
    // name. After the erosion (which is what finally decides how long a run
    // is) and before the naming pass below.
    pruneShortPathRuns(grid, w, h, pathUnder, roadUnder);
    yield 'short path runs';
    // THE SPAWN GATE (entry.spawnWhy — see isSpawnCell): on the final
    // grid, the road mask, the kerb buffer and the quiet land, before the
    // first cull below reads it. Pure MVT, re-derived by a rebuild.
    const spawnWhy = yield* stampSpawnWhySteps({ layers, grid, w, h, mvtToCell, mvtToM,
      roadMask, roadClass, quietMask });
    // Replace polygon grass on final GRASS cells, so overlapping mapped
    // polygons and the unclassified fallback get the same single fill pass.
    // Other plants stay first in the occupancy queue; landmarks, special
    // zone/street areas and the shared spawn gate still own their cells.
    let grassKeep = 0;
    for (let i = 0; i < wildplants.length; i++) {
      if ((i & 63) === 0) yield 'grass polygon cleanup';
      const wp = wildplants[i];
      if (wp.crop === 'longgrass' && grid[wp._iy * w + wp._ix] === T.GRASS) continue;
      wildplants[grassKeep++] = wp;
    }
    wildplants.length = grassKeep;
    const grassCandidates = yield* grassFillSteps(tx, ty, w, h);
    for (let iy = 0; iy < h; iy++) {
      if ((iy & 7) === 0) yield 'grass placement rows';
      for (let ix = 0; ix < w; ix++) {
        if (grid[iy * w + ix] !== T.GRASS || !grassCandidates[iy * w + ix]) continue;
        const { mx, my } = cellCenterMeters(ix, iy);
        wildplants.push(makeWildplant(BiomeProfiles.GRASS_FILL.crop, mx, my,
          cellId('wp', tx, ty, ix, iy), { _ix: ix, _iy: iy }));
      }
    }
    let streetRockRefused = null;
    // Post-pass: mineralrock cleanup. The polygon feature loop processes
    // landuse, roads, and buildings in MVT-supplied order, so a mineralrock
    // spawned by a residential polygon might have been placed on a cell
    // that later got painted as a road / driveway / building. Walk every
    // mineralrock now that the grid is final and drop:
    //   (1) any whose cell became blocked terrain (road, path, water,
    //       building of any tier)
    //   (2) any whose FINAL cell is residential and fails the shared spawn
    //       rule (isSpawnCell), whichever polygon spawned it
    {
      // ALLOWLISTED raw roadMask read (spawn_gate_sweep.test.js): THE GATE'S
      // OWN POST-RASTERIZE CULL, not a second spawn decision — this sweep is
      // what the isSpawnCell/landRefused calls a few lines below sit inside
      // (_mrDrop), reimplemented as a direct grid+mask read here for the
      // hot O(n) object sweep rather than a per-object isSpawnCell call.
      // Under a drawn road band. Checked everywhere a road TIER is checked:
      // the two answer the same question, and the tier alone gets it wrong on
      // exactly the cells players notice (the flanks of a big road, the
      // whole of a parking lot).
      const _underRoadBand = (ix, iy) => roadMask[iy * w + ix] === 1;
      const _mrIsBlocked = (ix, iy, ground = grid) => {
        const tc = ground[iy * w + ix];
        return isCobbleTerrain(tc) || tc === T.WATER || tc === T.PIER
            || isBuildingTerrain(tc)
            || _underRoadBand(ix, iy);
      };
      // No interactable may sit on a road tier or a building footprint. This is
      // the blanket rule for EVERY scatter object (rocks, trees, wells,
      // …); the sole exception is a POI chest, handled explicitly below.
      const _onRoadOrBuilding = (tc, ix, iy) =>
           tc === T.ROAD     || tc === T.ROAD_LG    || tc === T.ROAD_MD
        || isBuildingTerrain(tc)
        || _underRoadBand(ix, iy);
      // The grid is indexed in the TILE's cell basis — cell width =
      // tileEdgeM / cellsPerEdge, NOT the global CELL_M (5 m). Round-up
      // from cellsPerEdge × CELL_M to tileEdgeM produces ~0.03 m of
      // drift per cell, which accumulates to ~1.5 m by the far edge of
      // a 50-cell tile — enough to put the rock's "lookup cell" one
      // column off from where it actually sits on the painted grid.
      // Use the same basis the grid was painted with (cellWidthM, above).
      // (Deliberately not cellOfWorldM — see the note there.)
      const paintCellOf = (x, y) => ({
        ix: Math.floor((x - tileOriginMx) / cellWidthM),
        iy: Math.floor((y - tileOriginMy) / cellWidthM),
      });
      // Houses are placed inside building footprints — always road-adjacent
      // by virtue of OSM data and never something the player wades into a
      // back yard for. Keep them exempt from the residential proximity
      // check below.
      const _mrSkipKind = (k) => isBuilding(k);
      // POI chests are real-world destinations and count as public anchors for
      // the shared isSpawnCell rule below. Snapshot their cell coords now,
      // before we start splicing `objects`.
      const _mrSpawnOpts = {
        roadMask,
        quiet: quietMask,
        spawnWhy,
        pois: objects
          .filter(o => o.kind === 'chest')
          .map(o => paintCellOf(o.x, o.y)),
      };
      // Does this object have to go? Every test below reads the FINAL grid,
      // the road mask and the POI snapshot taken above — never the array it is
      // walking — so the verdict for one object is independent of every other,
      // which is what lets the sweep compact instead of splice.
      const _mrDrop = (o, ground = grid) => {
        if (_mrSkipKind(o.kind)) return false;
        const { ix, iy } = paintCellOf(o.x, o.y);
        if (ix < 0 || ix >= w || iy < 0 || iy >= h) return false;   // off-tile objects belong to a neighbour pass
        const here = ground[iy * w + ix];
        // Quiet land, private grounds and unverified piers host nothing — not even a POI chest
        // (a farm shop or kiosk): the mask's whole promise is that
        // nothing there asks to be walked to.
        if (quietMask[iy * w + ix] || (spawnWhy[iy * w + ix] & (W_.FARMLAND | W_.GOLF | W_.PIER_ACCESS))) return true;
        // Blanket cull: nothing but a POI chest may sit on a road tier or a
        // building footprint. A chest is a real-world destination deliberately
        // placed at its coordinates — and a POI inside a building is allowed
        // (the player taps the building floor to activate it). House/tower
        // sprites ARE the building and were already skipped via _mrSkipKind.
        if (o.kind !== 'chest') {
          if (_onRoadOrBuilding(here, ix, iy)) return true;
          // One-cell building moat for ground scatter — anything closer sits
          // visually inside the house/tower sprite's overhang. Trees are
          // EXEMPT: yard trees genuinely grow against house walls (and the
          // home grove the early game's wood supply depends on rings the
          // player's own house), and a tall canopy beside a wall reads
          // naturally where a rock on the foundation reads as junk.
          const _mrIsTree = isTreeLike(o.kind);
          if (!_mrIsTree && nearBuildingCell(ground, w, h, ix, iy)) return true;
          // Synthesized concrete POI pads (the hospital cross)
          // repaint cells AFTER scatter spawns ran — e.g. a residential rock
          // cluster's cell becomes COMMERCIAL pad, skipping the RESIDENTIAL
          // spawn gate below. Nothing but the chest belongs on its plaza.
          if (poiPadCells.has(iy * w + ix)) return true;
          // Keep the chest's one-cell frontage clear too.
          if (nearPoiCell(_mrSpawnOpts.pois, ix, iy)) return true;
        }
        if (o.kind === 'mineralrock') {
          if (_mrIsBlocked(ix, iy, ground)) return true;
        }
        // THE SPAWN GATE, as a MINOR spawn (flora, rocks, scenery — they may
        // stand on SUPPRESSED ground): whatever its FINAL cell's land refuses
        // goes — a back yard with no frontage (a POI in reach vouches for
        // it), a yard behind a house, restricted or sensitive land. Terrain-
        // based, NOT tied to which polygon spawned the thing: a wilderness
        // ROCK or INDUSTRIAL cluster can drop a rock that ends up on a
        // residential cell after the grid is fully painted. A POI chest is
        // the place itself (isSpawnCell's note) and reads only the quiet land
        // above. Forts, castles, houses and towers are already exempt above.
        if (o.kind !== 'chest' && landRefused(spawnWhy, iy * w + ix, _mrSpawnOpts.pois, ix, iy)) return true;
        return false;
      };
      streetRockRefused = _mrDrop;
      // COMPACTED IN PLACE, not spliced — the same change the wildplant sweep
      // below already carries, and for the same reason. This was a reverse walk
      // calling objects.splice(i, 1) on every rejection, and a splice rewrites
      // the whole tail: a tile whose scatter is mostly culled (a big residential
      // polygon is exactly that — every rock away from a road goes) ran
      // quadratic, and a headless trace over one measured 5.6 s in this single
      // loop. Writing the survivors forward and truncating once is the same
      // answer, in O(n), and keeps their order.
      let objKeep = 0;
      for (let i = 0; i < objects.length; i++) {
        if ((i & 63) === 0) yield 'mineralrock object sweep';
        const o = objects[i];
        if (!_mrDrop(o)) objects[objKeep++] = o;
      }
      objects.length = objKeep;
      // Same shared rule for the parallel `wildplants` list — any wild pickup
      // that ended up on a residential cell must pass isSpawnCell. (DEBRIS_CROP
      // no longer seeds residential, but cross-polygon overlap can still
      // drop a shrub or longgrass tuft onto a residential cell.)
      // COMPACTED IN PLACE, not spliced. This was a reverse walk calling
      // wildplants.splice(i, 1) on every rejection, and a splice rewrites the
      // whole tail — so a tile with thousands of wild plants and a lot of
      // rejections ran quadratic. Measured with the labelled slice profiler at
      // 337 ms in this one loop, the longest unbroken block in a tile build and
      // the thing the live profiler blamed for every walking stutter. Writing
      // the survivors forward and truncating once is the same answer in O(n).
      // Yard flora joins here, AFTER every older wild plant (see yardFlora).
      for (let i = 0; i < yardFlora.length; i++) wildplants.push(yardFlora[i]);
      let wpKeep = 0;
      for (let i = 0; i < wildplants.length; i++) {
        if ((i & 63) === 0) yield 'mineralrock wildplant sweep';
        const wp = wildplants[i];
        const { ix, iy } = paintCellOf(wp.x, wp.y);
        let drop = false;
        if (wp._yard) {
          // A yard plant grows among the rocks, so it goes by the ROCK's rule
          // (one lane): _mrDrop's road/band, building moat, POI plaza and
          // frontage tests, plus the rock's blocked-terrain test.
          drop = _mrDrop(wp)
            || (ix >= 0 && ix < w && iy >= 0 && iy < h && _mrIsBlocked(ix, iy));
        } else if (ix >= 0 && ix < w && iy >= 0 && iy < h) {
          const wtc = grid[iy * w + ix];
          // Concrete POI pads stay bare — a shrub/marigold that survived the
          // biome filter (rocky-family crops) still doesn't belong on the plaza.
          if (_onRoadOrBuilding(wtc, ix, iy)) drop = true;
          else if (poiPadCells.has(iy * w + ix)) drop = true;
          // The spawn gate, a MINOR spawn (quiet land folded in).
          else if (landRefused(spawnWhy, iy * w + ix, _mrSpawnOpts.pois, ix, iy)) drop = true;
        }
        if (!drop) wildplants[wpKeep++] = wp;
      }
      wildplants.length = wpKeep;
      // Parking-treasure X marks live in a third array (parkingTreasures) and
      // are missed by both filters above. They used to be checked ONLY for the
      // residential-yard rule, so an X on a road cell — or on water, or inside
      // a building — passed straight through: the mark's anchor is the lot
      // polygon's first VERTEX, a corner of the lot, which lands on the kerb or
      // the street feeding it as often as on tarmac you can stand on. Now they
      // go through the same shared rule as everything else, and rather than
      // losing the lot its reward, an X on a bad cell is walked out to the
      // nearest good one; it's dropped only if the whole neighbourhood is
      // paved.
      for (let i = parkingTreasures.length - 1; i >= 0; i--) {
        const t = parkingTreasures[i];
        const { ix, iy } = paintCellOf(t.x, t.y);
        if (ix < 0 || ix >= w || iy < 0 || iy >= h) continue;
        const moved = relocateToSpawnCell(grid, w, h, ix, iy, _mrSpawnOpts, null, 'minor');
        if (!moved) { parkingTreasures.splice(i, 1); continue; }
        if (moved.ix === ix && moved.iy === iy) continue;
        const { mx, my } = cellCenterMeters(moved.ix, moved.iy);
        t.x = mx; t.y = my;
        t.id = cellId('t_park', tx, ty, moved.ix, moved.iy);
      }
      // GATES and NOTICE BOARDS (POI_GATE_CLASS / POI_INFO_CLASS) — placed
      // here, on the final grid and road mask, by the shared spawn rule.
      // A notice board is walked to the nearest spawn cell like the parking X
      // (dropped only if the whole neighbourhood is paved); a gate seats its
      // two posts either side of its point (gatePostsAt) or is dropped. The
      // occupancy pass below settles them against everything else (below a
      // chest, level with a house).
      placeGatesAndBoards(objects, gatePoints, infoPoints, {
        grid, N: w, roadMask, quiet: quietMask, spawnWhy, tx, ty,
        centre: (ix, iy) => { const c = cellCenterMeters(ix, iy); return { x: c.mx, y: c.my }; },
      });
    }

    yield 'mineralrock cleanup';
    // Towers share their wall's cell. Consult the assigned footprint halo
    // outside the tile, then the source polygon beyond that halo, so the
    // clipping edge cannot manufacture corners or an interior row of towers.
    const castleOwnerAt = (x, y) => {
      if (x >= 0 && y >= 0 && x < w && y < h) {
        return grid[y * w + x] === T.BUILDING_LARGE ? owners[y * w + x] : null;
      }
      const key = `${x}_${y}`;
      if (castleHalo.has(key)) return castleHalo.get(key);
      if (x >= -3 && y >= -3 && x < w + 3 && y < h + 3) return null;
      let owner = null;
      for (const shape of castleSourceRings) {
        if (pointInRings([shape.ring], (x + 0.5) / mvtToCell, (y + 0.5) / mvtToCell)) {
          owner = shape.ownerId; break;
        }
      }
      castleHalo.set(key, owner);
      return owner;
    };
    const towerBlocked = new Set();
    for (let i = 0; i < objects.length; i++) {
      if ((i & 127) === 0) yield 'tower occupancy';
      const o = objects[i];
      if (!['chest', 'house', 'infoboard', 'gatepost'].includes(o.kind)) continue;
      const { ix, iy } = cellOfWorldM(o.x, o.y);
      towerBlocked.add(`${ix}_${iy}`);
    }
    const towerCells = yield* castleTowerCellsSteps(w, h, tx * w, ty * h,
      castleOwnerAt, (x, y) => towerBlocked.has(`${x}_${y}`));
    const _flagged = new Set();
    for (let i = 0; i < towerCells.length; i++) {
      if ((i & 63) === 0) yield 'tower objects';
      const [ix, iy] = towerCells[i];
      const absX = tx * w + ix, absY = ty * h + iy;
      const { mx: cx, my: cy } = cellCenterMeters(ix, iy);
      const castle = ownerKeys[owners[iy * w + ix]] || null;
      const flagPost = !!castle && !_flagged.has(castle);
      if (flagPost) _flagged.add(castle);
      objects.push(makeObject('tower', cx, cy, `tw_${absX}_${absY}`, { castle, flagPost }));
    }

    yield 'castle towers';
    // Unified occupancy pass — at most one object per cell.
    // Strict priority: chest > house > tree > wildplant.
    // The first one to claim a cell wins; everything else in that cell is
    // dropped so we never have shrubs hiding under chests or pads.
    const occupiedCells = new Set();
    const cellKeyOfWorld = (x, y) => {
      const { ix, iy } = cellOfWorldM(x, y);
      return `${ix}_${iy}`;
    };

    // 1) High-priority objects first (chest > house > fruittree > tree > mineralrock).
    //    These never get displaced — they claim their cells and wildplants must avoid those cells.
    //    Priority numbers are descending so the sort places higher-priority kinds
    //    first. Within one priority (e.g. house/tower, or two trees) the winner
    //    of a contested cell must be fixed by data, not array order — JS sort
    //    stability isn't guaranteed across engines, and an arbitrary tie-break
    //    would let the same seed resolve a collision differently between reloads.
    const STRUCT_PRIO = { chest: 6, house: 5, tower: 5, infoboard: 5, gatepost: 5, fruittree: 4, tree: 3, mineralrock: 2 };
    const structs = objects.filter(o => STRUCT_PRIO[o.kind] != null);
    structs.sort((a, b) => {
      const dp = (STRUCT_PRIO[b.kind] || 0) - (STRUCT_PRIO[a.kind] || 0);
      if (dp) return dp;
      // Deterministic tie-break: position (always defined from generation),
      // then id as a final stable key.
      if (a.x !== b.x) return a.x - b.x;
      if (a.y !== b.y) return a.y - b.y;
      // Plain code-unit order, never localeCompare: collation is the
      // runtime's locale, so two players' engines could order it differently.
      const ai = String(a.id ?? ''), bi = String(b.id ?? '');
      return ai < bi ? -1 : ai > bi ? 1 : 0;
    });
    const keptStructs = [], sampledRockCells = new Set();
    yield 'structure sort';
    let structI = 0;
    for (const o of structs) {
      if ((structI & 63) === 0) yield 'structure occupancy sweep';
      structI++;
      const k = cellKeyOfWorld(o.x, o.y);
      if (occupiedCells.has(k)) continue;
      // Thin ordinary rubble by cell after its usual collision winner is
      // known. Never reroll a rejected seat with another overlapping rock.
      const pos = cellOfWorldM(o.x, o.y);
      const biome = grid[pos.iy * w + pos.ix];
      const tuning = BiomeProfiles.staticObjects(biome);
      if (o.kind === 'mineralrock') {
        if (tuning.noRocks || (biome === T.FOREST && o.caveVariant == null && o.yieldTier === 6)) continue;
        if (tuning.plainRockFrame != null && (o.caveVariant != null || (o.yieldTier || 1) <= 1)) {
          o._zoneObjectFrame = tuning.plainRockFrame;
          o.rockVariant = tuning.plainRockVariant; // one pictured shell-covered stone pays one stone
        }
      }
      if (o.kind === 'mineralrock' && !o._street && tuning.rockPlainKeep != null) {
        if (sampledRockCells.has(k)) continue;
        sampledRockCells.add(k);
        const plain = o.caveVariant != null || (o.yieldTier || 1) <= 1;
        const keep = plain ? tuning.rockPlainKeep : tuning.rockOreKeep;
        if (u01(cellHash(tx, ty, pos.ix, pos.iy) ^ 0x4b34a) >= keep) continue;
      }
      occupiedCells.add(k);
      // Stamp the cell's terrain so the renderer can apply a per-biome tint to
      // primary interactables (e.g. rusty mineralrock on industrial lots).
      const { ix, iy } = cellOfWorldM(o.x, o.y);
      if (ix >= 0 && iy >= 0 && ix < w && iy < h) o._biome = grid[iy * w + ix];
      keptStructs.push(o);
    }

    // 2) Wildplants — biome-appropriate cells only, never on a structure cell.
    //    Roads/paths/water/buildings are painted AFTER landuse, so a residential
    //    polygon may have had debris dropped into a cell that later became
    //    road, OR a park polygon's shrubs may have ended up under a residential
    //    overpaint. The allowed-biome test is derived from the central
    //    BIOME_PROFILES registry (BiomeProfiles.allows — a crop survives on any
    //    cell whose family grows it), keeping the filter in lockstep with the
    //    spawn pass. The cell's terrain is stamped onto the
    //    kept wildplant as `_biome` so the renderer can apply the biome's flora
    //    tint (e.g. golden field grass, swampy reeds).
    const filtered = [];
    yield 'structure cells';
    let wpOccI = 0;
    for (const wp of wildplants) {
      if ((wpOccI & 63) === 0) yield 'wildplant occupancy sweep';
      wpOccI++;
      const t = grid[wp._iy * w + wp._ix];
      const cellKey = `${wp._ix}_${wp._iy}`;
      const grows = wp._yard ? BiomeProfiles.yardAllows(wp.crop, t) : BiomeProfiles.allows(wp.crop, t);
      if (grows && !occupiedCells.has(cellKey)) {
        occupiedCells.add(cellKey);
        wp._biome = t;
        // Reed silhouettes identify the one-cell wetland margin. Only art
        // changes: keep this plant's generated id, density and harvest.
        if (wp.crop === 'longgrass' && t === T.WETLAND) {
          const x = wp._ix, y = wp._iy;
          const edge = (x > 0 && grid[y * w + x - 1] !== t)
            || (x + 1 < w && grid[y * w + x + 1] !== t)
            || (y > 0 && grid[(y - 1) * w + x] !== t)
            || (y + 1 < h && grid[(y + 1) * w + x] !== t);
          if (edge) wp._plantArt = 'reeds';
        }
        // Convert only accepted commercial hedge candidates. Pots inherit
        // the hedge's land/road gate and lose to real POIs and structures;
        // minting chest candidates earlier would give them POI exemptions.
        if (t === T.COMMERCIAL && wp.crop === 'shrub' && wp.id.startsWith('hm_')
            && hedgeMazePotCell(tx * w + wp._ix, ty * h + wp._iy)) {
          keptStructs.push(makeObject('chest', wp.x, wp.y, cellId('hmpot', tx, ty, wp._ix, wp._iy),
            { barrel: true, barrelStyle: 'clay_pot', _biome: t }));
          continue;
        }
        delete wp._ix; delete wp._iy; delete wp._yard;
        filtered.push(wp);
      }
    }

    // Public industrial salvage, independently seeded on empty ground.
    // These are ordinary ambient barrels; street/nexus replacement removes
    // them together with rubble, and private land never gains a POI anchor.
    for (let i = 0; i < grid.length; i++) {
      if ((i & 1023) === 0) yield 'industrial salvage';
      const density = BiomeProfiles.staticObjects(grid[i]).barrelDensity;
      if (!density) continue;
      const ix = i % w, iy = Math.floor(i / w), key = `${ix}_${iy}`;
      if (occupiedCells.has(key) || makeRng((cellHash(tx,ty,ix,iy) ^ 0x5a17a9e) >>> 0)() >= density) continue;
      if (!isSpawnCell(grid,w,h,ix,iy,{roadMask,spawnWhy},'minor') || poiPadCells.has(i)) continue;
      const {mx:x,my:y} = cellCenterMeters(ix,iy);
      keptStructs.push(makeObject('chest',x,y,cellId('ibarrel',tx,ty,ix,iy),{barrel:true,_biome:grid[i]}));
      occupiedCells.add(key);
    }

    // Rebuild objects = kept structures (preserve everything else
    // like plaques if they sneak in via future code).
    const otherKinds = objects.filter(o => STRUCT_PRIO[o.kind] == null);
    objects.length = 0;
    for (const o of keptStructs) objects.push(o);
    for (const o of otherKinds)  objects.push(o);
    yield 'occupancy pass';
    // Road-name labels: walk each transportation_name line at ~1 cell per step
    // and drop ONE compact whole-word label (the name's first word) every
    // LABEL_PERIOD road cells, rotated to the local road direction. This
    // Angles are normalized to (-90°, 90°] so a label never renders upside
    // down regardless of the way's digitized direction.
    // Stored as { "ix_iy": { text, angle } } — anchor cells only, vehicle road
    // tiers only (PATH pebbles are too small to carry a label).
    //
    const roadLabels = {};
    const LABEL_PERIOD = 12;   // cells between label repeats (~84 m)
    const LABEL_OFFSET = 2;    // first label a couple of cells in from the line start
    const tnLayer = layersByName['transportation_name'];
    const LABEL_TYPES = new Set([T.ROAD, T.ROAD_MD, T.ROAD_LG]);
    if (tnLayer) {
      for (const f of tnLayer.features) {
        if (f.type !== 2) continue;
        const name = f.tags?.name;
        if (!name) continue;
        // First word only — compact enough to fit along the road at 10px.
        const firstWord = name.trim().split(/\s+/)[0];
        if (!firstWord) continue;
        for (const line of f.geom) {
          if (line.length < 2) continue;
          let cellStep = 0;
          let lastKey = '';
          const stepMvt = CELL_M / mvtToM;
          for (let i = 1; i < line.length; i++) {
            const ax = line[i - 1].x, ay = line[i - 1].y;
            const bx = line[i].x,     by = line[i].y;
            const segDx = bx - ax, segDy = by - ay;
            const segLen = Math.hypot(segDx, segDy);
            if (segLen < 1e-6) continue;
            // Local direction, folded into (-90°, 90°] so the label always
            // reads left-to-right (MVT y grows downward → matches screen y).
            let ang = Math.atan2(segDy, segDx);
            if (ang >   Math.PI / 2) ang -= Math.PI;
            if (ang <= -Math.PI / 2) ang += Math.PI;
            const ux = segDx / segLen, uy = segDy / segLen;
            // March along the segment from its start, one cell-width per step.
            let curX = ax, curY = ay;
            let remaining = segLen;
            while (remaining >= 0) {
              const ix = Math.floor(curX * mvtToCell);
              const iy = Math.floor(curY * mvtToCell);
              const key = `${ix}_${iy}`;
              if (key !== lastKey &&
                  ix >= 0 && iy >= 0 && ix < w && iy < h &&
                  isCobbleTerrain(grid[iy * w + ix])) {
                if (cellStep % LABEL_PERIOD === LABEL_OFFSET &&
                    LABEL_TYPES.has(grid[iy * w + ix])) {
                  roadLabels[key] = { text: firstWord, angle: ang };
                }
                cellStep++;
                lastKey = key;
              }
              curX += ux * stepMvt;
              curY += uy * stepMvt;
              remaining -= stepMvt;
            }
            // Snap to vertex start of next segment to avoid drift.
            curX = bx; curY = by;
          }
        }
      }
    }

    // Dedup nearby same-name chests inside this tile. OSM frequently has multiple
    // POI points for one physical place (e.g. an entrance + main label + amenity).
    // Group by normalized name, then drop any chest within DEDUP_M of an already-
    // kept chest of the same name. Unnamed chests are left untouched.
    // Distances here are in CELLS of this tile (nominal CELL_M metres each),
    // never frame metres — a threshold in frame metres is a threshold that
    // moves with the save's home latitude. Chests sit on cell centres, so the
    // squared cell distance is an exact integer.
    const cellDist2 = (a, b) => {
      const A = cellOfWorldM(a.x, a.y), B = cellOfWorldM(b.x, b.y);
      const dx = A.ix - B.ix, dy = A.iy - B.iy;
      return dx * dx + dy * dy;
    };
    const DEDUP_M = 80;
    const DEDUP_CELLS2 = (DEDUP_M / CELL_M) * (DEDUP_M / CELL_M);
    const byName = new Map();
    for (const o of objects) {
      if (o.kind !== 'chest' || !o.name) { continue; }
      const key = o.name.trim().toLowerCase();
      const prev = byName.get(key);
      const tooClose = prev && prev.some(p => cellDist2(p, o) <= DEDUP_CELLS2);
      if (tooClose) { o._drop = true; continue; }
      (byName.get(key) || byName.set(key, []).get(key)).push(o);
    }
    // Second pass: drop DIFFERENT-named POI chests that land right beside each
    // other (within ~1 cell). OSM often tags one physical spot twice with
    // unrelated labels — e.g. a traffic "signal post" sitting on top of the
    // "Gordon & Casorso" intersection — which the same-name pass above can't
    // catch. Keep the NAMED chest (so the meaningful place wins over a generic
    // marker), else the first seen, and drop its neighbour so two POI sprites
    // don't stack on adjacent cells.
    const NEAR_CELLS2 = 1.2 * 1.2;   // catches same + orthogonally-adjacent cells
    const keptChests = [];
    const chestsByPriority = objects
      .filter(o => o.kind === 'chest' && !o._drop)
      .sort((a, b) => (b.name ? 1 : 0) - (a.name ? 1 : 0));   // named first
    for (const o of chestsByPriority) {
      if (keptChests.some(k => cellDist2(k, o) <= NEAR_CELLS2)) o._drop = true;
      else keptChests.push(o);
    }
    const deduped = objects.filter(o => !o._drop);
    // Each POI chest's DENSITY — how many of its class this tile holds (loot.js
    // crateRestoreDays / potCoinsFor). Stamped once
    // the tile's chests are final; loadTile restamps once a bin has injected
    // its own.
    stampPoiDensity(deduped);
    // Caves retain the old generated occupancy and rock identities while the
    // surface gives the special street its whole corridor, even empty cells.
    // Capture after ordinary dedupe, before either street or zone replacement.
    const caveSource = { grid: grid.slice(), objects: deduped.slice(),
      wildplants: filtered.slice(), spawnWhy: spawnWhy.slice() };
    // Surface shrines change POI kind, theme and sometimes position in place.
    // A slice alone would let those mutations rewrite the cave snapshot.
    for (let i = 0; i < caveSource.objects.length; i++) {
      if ((i & 255) === 0) yield 'cave source objects';
      caveSource.objects[i] = { ...caveSource.objects[i] };
    }
    const ownStreetLines = hasStreetArea
      ? new Set(streetIndex.lines.filter(r => r.variant).map(r => r.lineKey)) : null;
    if (hasStreetArea) yield* clearStreetAmbientSteps({ area: streetArea, objects: deduped,
      wildplants: filtered, tx, ty, N: w, tileEdgeM, ownLines: ownStreetLines });
    // STREET DRESSING (StreetVariants.dressSteps) — computed HERE, inside the
    // sliced build, against every cell the tile's own objects and wild plants
    // now hold; spawnInTile lays it (dropping any piece whose cell something
    // placed after this pass took — the cave stair) before its other draws.
    let streetDress = null;
    // The occupancy both dressings claim into (street first, then the zones'
    // nexus), built once: every cell the tile's own objects and wild plants
    // hold. Built lazily so a tile with neither dressing pays nothing.
    let dressOcc = null, dressPois = null;
    // The dressings' spawn options — one shape, built per pass (a pass that
    // extends its options never hands the next one its extras).
    const dressOpts = (extra) => Object.assign(
      { roadMask, quiet: quietMask, spawnWhy, roadClass, occupied: dressOcc, pois: dressPois }, extra);
    const dressSpawn = () => {
      if (dressOcc) return;
      dressOcc = occupiedIndexSet(tileFrame({ cellsPerEdge: w }, tx, ty, tileEdgeM), deduped, filtered);
      dressPois = [];
      for (const o of deduped) {
        if (o.kind !== 'chest') continue;
        dressPois.push({ ix: Math.floor((o.x - tileOriginMx) / cellWidthM), iy: Math.floor((o.y - tileOriginMy) / cellWidthM) });
      }
    };
    // Build the zone field and final terrain before scenic measurements.
    // Its dressing waits until scenic landmarks and street pieces have claimed
    // their cells; zone coverage then clears street pieces throughout its area.
    // THE PARK FRINGE (Zones.fringeSteps) runs right after the halo, on the
    // ground the halo left: every park polygon collected above spills a
    // ragged band of GROVE (CHURCHYARD round a cemetery) over the lot /
    // commercial ground at its edge, and the dressing smatters its
    // character's filler a little further out. A tile with parks but no zone
    // still gets a (stub) field, so the land's class (`under`) reaches the
    // trap ground the same way.
    let zone = null, zoneDress = null, fringe = null;
    if (typeof Zones !== 'undefined') {
      zone = yield* Zones.fieldSteps(layersByName['poi'], tx, ty, w);
      if (zone) yield* Zones.haloSteps(zone, grid, w, pathUnder);
      fringe = parkPolys.length
        ? yield* Zones.fringeSteps({ parks: parkPolys, grid, N: w, tx, ty, field: zone, pathUnder }) : null;
      if (fringe && !zone) zone = fringe.field;
      if (typeof ZoneCoverage !== 'undefined') zone = yield* ZoneCoverage.buildSteps({
        field: zone, poiLayer: layersByName['poi'], parks: parkPolys, beachLayer: layersByName['landcover'], waterLayer: layersByName['water'], tx, ty, N: w,
        chests: deduped, tileEdgeM, grid });
      if (typeof ZoneCoverage !== 'undefined') zone = yield* ZoneCoverage.quarrySteps({
        field: zone, parkingLanes: layersByName['transportation']?.parkingLanes,
        tx, ty, N: w, grid, tileEdgeM, roadMask, spawnWhy });
    }
    if (streetIndex && typeof StreetVariants.applyAffinitiesSteps === 'function') {
      // Geography changes the selected theme, never whether the corridor is
      // special. Its area and bandit mask are therefore already final. Keep
      // the original rock substrate in caveSource so this visual preference
      // cannot move a mine entrance on an existing map.
      const oldRockLines = new Set(streetIndex.lines.filter(r => r.rocks).map(r => r.lineKey));
      yield* StreetVariants.applyAffinitiesSteps(streetIndex, zone, w, mvtToM, {
        grid,
        pois: deduped.filter(isDensityChest).map(o => ({
          ix: Math.floor((o.x - tileOriginMx) / cellWidthM),
          iy: Math.floor((o.y - tileOriginMy) / cellWidthM),
        })),
      });
      const finalRockLines = new Set(streetIndex.lines.filter(r => r.rocks).map(r => r.lineKey));
      const added = streetIndex.lines.filter(r => r.rocks && !oldRockLines.has(r.lineKey));
      const removed = new Set([...oldRockLines].filter(key => !finalRockLines.has(key)));
      if (removed.size) {
        let keep = 0;
        for (let i = 0; i < deduped.length; i++) {
          if ((i & 63) === 0) yield 'street affinity rock cleanup';
          const o = deduped[i];
          if (!(o._street && removed.has(o._streetLine))) deduped[keep++] = o;
        }
        deduped.length = keep;
      }
      if (added.length) {
        const rocks = [];
        yield* spawnStreetRocksSteps({ ...streetIndex, lines: added }, rocks);
        const occupied = new Set();
        for (const list of [deduped, filtered]) for (let i = 0; i < list.length; i++) {
          if ((i & 63) === 0) yield 'street affinity rock occupancy';
          const c = cellOfWorldM(list[i].x, list[i].y);
          occupied.add(c.iy * w + c.ix);
        }
        for (let i = 0; i < rocks.length; i++) {
          if ((i & 63) === 0) yield 'street affinity new rocks';
          const o = rocks[i], c = cellOfWorldM(o.x, o.y), cell = c.iy * w + c.ix;
          if (occupied.has(cell) || streetRockRefused(o, caveSource.grid)) continue;          occupied.add(cell);
          deduped.push(o);
        }
      }
    }
    // Scenic selection reads source geography before road terrain. Keep its
    // shoreline rewards tied to original beaches, not newly painted sand.
    let scenic = null, scenicDress = null;
    if (typeof Scenic !== 'undefined') {
      scenic = yield* Scenic.buildSteps(layersByName, tx, ty, w, grid, false, zone && zone.under);
    }
    // Polygon scatter is legacy input for caves; surface corridor replacement
    // follows affinity selection and precedes zone paint and all dressings.
    const streetGround = new Uint8Array(w * h);
    const streetTerrain = typeof StreetVariants !== 'undefined'
      ? yield* StreetVariants.paintTerrainSteps({ index: streetIndex, scenic,
        transportation: layersByName.transportation, grid, N: w, roadMask, spawnWhy, zone, streetGround }) : null;
    const hasStreetTerrain = streetTerrain && streetTerrain.some(Boolean);
    if (hasStreetTerrain) yield* clearStreetAmbientSteps({ area: streetTerrain,
      objects: deduped, wildplants: filtered, tx, ty, N: w, tileEdgeM, ownLines: ownStreetLines });
    if (zone) {
      // Mine entrances are world identities, seeded by the original rock
      // clusters and occupancy. Keep that input separate from the visible
      // zone layer so removing scenery cannot reroll an existing cave.
      if (zone.coverage) {
        const caveGrid = caveSource.grid.slice();
        if (zone.under) for (let i = 0; i < caveGrid.length; i++) {
          if ((i & 511) === 0) yield 'zone cave source';
          if (zone.under[i]) caveGrid[i] = zone.under[i];
        }
        zone.caveSource = { grid: caveGrid, objects: caveSource.objects,
          wildplants: caveSource.wildplants, spawnWhy: caveSource.spawnWhy };
      }
      if (typeof ZoneCoverage !== 'undefined') yield* ZoneCoverage.paintSteps(zone, grid, w, pathUnder, roadMask, spawnWhy);
      zone.legacyRemoved = yield* clearZoneAmbientSteps({ field: zone, objects: deduped,
        wildplants: filtered, tx, ty, N: w, tileEdgeM });
    }
    dressSpawn();
    const wreckReservations = zone && typeof ZoneDressing !== 'undefined'
      ? yield* ZoneDressing.reserveWrecksSteps({ field: zone, tx, ty, N: w, tileEdgeM, grid, chests: deduped,
        spawnOpts: dressOpts() })
      : null;
    // Future lamp feet stay clear through both scenic and street dressing,
    // then leave no phantom occupancy behind for unrelated zone spawns.
    const lampReservations = typeof RoadOverlay !== 'undefined'
      ? RoadOverlay.lampReservedCells(tx, ty, { layers, tileEdgeM, cellsPerEdge: w, streetIndex, scenic, zone })
      : new Set();
    const temporaryLampCells = [...lampReservations].filter(cell => !dressOcc.has(cell));
    for (const cell of temporaryLampCells) dressOcc.add(cell);
    if (scenic) {
      scenicDress = yield* Scenic.dressSteps({ scenic, zone, tx, ty, N: w, tileEdgeM, grid, chests: deduped,
        spawnOpts: dressOpts() });
    }
    if (streetIndex && typeof StreetVariants !== 'undefined') {
      yield 'before street dressing';
      dressSpawn();
      // Zone painting runs earlier for scenic measurements, but the street's
      // own hard gates still read the original ground and spawn reasons.
      streetDress = yield* StreetVariants.dressSteps({ index: streetIndex, tx, ty, N: w, tileEdgeM,
        grid: caveSource.grid,
        spawnOpts: dressOpts({ spawnWhy: caveSource.spawnWhy }) });
    }
    for (const cell of temporaryLampCells) dressOcc.delete(cell);
    if (zone) {
      zone.legacyRemoved += yield* clearZoneAmbientSteps({ field: zone, objects: deduped,
        wildplants: filtered, occupied: dressOcc, streetDress, scenicDress, tx, ty, N: w, tileEdgeM });
      dressSpawn();
      zoneDress = yield* ZoneDressing.dressSteps({ field: zone, fringe, tx, ty, N: w, tileEdgeM, grid, chests: deduped,
        wreckReservations, poiPadCells, tideSeats: scenicDress && scenicDress.tideSeats,
        spawnOpts: dressOpts() });
      // Shafts must enter the generated surface snapshot before caves derive
      // their matching up ladders. The live dressing occupancy pass skips
      // these already-seated stairs when it lays the remaining quarry props.
      for (const o of zoneDress.objects) if (o.kind === 'staircase') deduped.push(o);
    }
    if (zone && zoneDress && typeof ReefLayout !== 'undefined') {
      yield* ReefLayout.dressSteps({ field: zone, zoneDress, tx, ty, N: w, tileEdgeM, grid,
        spawnOpts: dressOpts() });
    }
    // Tier seeds last: zones and scenic have stamped their nexus/vista
    // chests, so the quota pyramid knows exactly which chests are budgeted.
    seedChestTiers(deduped);
    const chestTopUp = yield* topUpChestsSteps({ objects: deduped, dressings: [zoneDress, streetDress, scenicDress],
      zone, streetDress, grid, N: w, tx, ty, tileEdgeM,
      spawnOpts: dressOpts({ occupied: new Set([...dressOcc, ...lampReservations]) }) });
    return { grid, owners, ownerKeys, syntheticBuildingCells, objects: deduped, wildplants: filtered, parkingTreasures, roadLabels, pathUnder, streetGround, poiPadCells, roadMask, quietMask, spawnWhy, roadClass, streetIndex, streetArea, streetDress, zone, zoneDress, scenic, scenicDress, chestTopUp, buildingShapes, caveSource: hasStreetArea || hasStreetTerrain ? caveSource : null };
  }

  // Run the whole build now, in one go. The shipping contract for callers that
  // cannot await — and what the tests drive, so they exercise the same passes
  // in the same order as the game.
  function rasterizeTile(layers, cellsPerEdge, tx, ty, tileEdgeM) {
    return runSteps(rasterizeTileSteps(layers, cellsPerEdge, tx, ty, tileEdgeM));
  }

  // Run it in slices, giving the browser a painted frame whenever a slice has
  // held the thread for its slice budget. Same passes, same result — only the
  // wall-clock shape differs.
  let _lastRasterSlices = 0;
  let _lastRasterWorstMs = 0;
  let _lastRasterWorstAt = '';
  async function rasterizeTileSliced(layers, cellsPerEdge, tx, ty, tileEdgeM) {
    const stats = {};
    const value = await driveStepsSliced(rasterizeTileSteps(layers, cellsPerEdge, tx, ty, tileEdgeM), stats);
    _lastRasterSlices = stats.slices;
    _lastRasterWorstMs = Math.round(stats.worstMs);
    _lastRasterWorstAt = stats.worstAt;
    return value;
  }

  // THE SLICE DRIVER, shared by every sliced pass (the rasterize above, the
  // post-rasterize tail in loadTile, the scene's spawn pass): run a steps
  // generator, handing the browser a painted frame whenever a slice has held
  // the thread for its budget. Same steps, same result as driving it straight
  // through (runSteps) — only the wall-clock shape differs.
  //   stats   optional; filled with { slices, worstMs, worstAt }
  //   abort   optional; asked after every handed-back frame — true stops the
  //           pass there (the generator's `finally` blocks run) and the
  //           promise resolves with ABORTED. For a pass whose target can be
  //           replaced while it waits (a tile evicted mid-spawn).
  const ABORTED = Symbol('aborted');
  async function driveStepsSliced(it, stats, abort) {
    let started = _now();
    let slices = 1, worst = 0, worstAt = '';
    for (;;) {
      const r = it.next();
      // Include the final next(): committing a pass can be its longest
      // stretch, even though it returns instead of yielding a label.
      const held = _now() - started;
      if (held > worst) { worst = held; worstAt = r.done ? 'completion' : (r.value || 'unlabelled'); }
      if (r.done) {
        if (stats) { stats.slices = slices; stats.worstMs = worst; stats.worstAt = worstAt; }
        return r.value;
      }
      // The WORST unbroken stretch, which is the number that matters: the
      // budget can only be honoured at a yield, so a single helper call or one
      // huge polygon between two yields blocks for as long as it takes however
      // short the budget is. If a profile shows a worst block far above the
      // budget, THAT is the thing left to chunk.
      if (held >= _sliceMs) {
        const handedBack = _now();
        await _yieldToPaint();
        const back = _now();
        // Our hold plus the rest of the frame: what the player actually felt.
        noteSliceFrame(held + (back - handedBack));
        started = back;
        slices++;
        if (abort && abort()) {
          it.return();
          if (stats) { stats.slices = slices; stats.worstMs = worst; stats.worstAt = worstAt; }
          return ABORTED;
        }
      }
    }
  }
  // Drive a steps generator straight through, synchronously.
  function runSteps(it) {
    let r = it.next();
    while (!r.done) r = it.next();
    return r.value;
  }
  // A sliced pass as its own turn on the heavy chain (runHeavyPhase): at most
  // one heavy chunk runs per frame across every tile in flight.
  function runStepsSliced(makeSteps, opts) {
    const o = opts || {};
    return runHeavyPhase(() => {
      if (o.abort && o.abort()) return ABORTED;
      return driveStepsSliced(makeSteps(), o.stats, o.abort);
    });
  }

  function tileEdgeMeters(lat) {
    // edge in meters at z=14 at given latitude
    return metersPerPixel(lat, Z) * TILE_PX;
  }
  // DEPRECATED for anything generated or indexed. app.js keeps START_LAT's
  // count as the frame's REFERENCE grid (scene.cellsPerTile), which only
  // anchors coords.js' absolute-cell encoding so a save's keys stay put; every
  // tile is indexed by its own row's count, cellsPerEdgeForTile(ty), below.
  function cellsPerEdgeForLat(lat) {
    return Math.round(tileEdgeMeters(lat) / CELL_M);
  }
  // Latitude of the CENTRE of tile row ty at Z. Web-mercator latitude depends
  // on the row alone, so this is a pure function of ty.
  function latOfRowCentre(ty) {
    return tileLat(ty + 0.5);
  }
  // THE TILE'S OWN CELL COUNT — cells per edge from the tile's own latitude,
  // never the save's. This is what makes the world the same for everyone:
  // every generation input (the grid, every step, every id, every seed) is in
  // this tile's cells, and this is a pure function of the row. Two saves with
  // different home latitudes (a different START_LAT, so a different
  // tileEdgeM frame) still rasterize a tile onto the SAME N x N grid. Memoised
  // per row — the trig is cheap, but it is asked per tile per frame.
  const _cpeByRow = new Map();
  function cellsPerEdgeForTile(ty) {
    let n = _cpeByRow.get(ty);
    if (n === undefined) {
      n = Math.round(tileEdgeMeters(latOfRowCentre(ty)) / CELL_M);
      _cpeByRow.set(ty, n);
    }
    return n;
  }
  // Frame metres per cell of a tile in row ty: the save's tile edge (its
  // frame, from START_LAT) over the tile's own cell count. What a consumer
  // draws or measures a cell of that tile with — never CELL_M, and never
  // tileEdgeM / cellsPerEdgeForLat(START_LAT).
  function cellSizeM(tileEdgeM, ty) {
    return tileEdgeM / cellsPerEdgeForTile(ty);
  }

  // Tile builds decode + rasterize on the MAIN thread (no worker), and each
  // phase is tens of ms on a slow phone. Left alone, the whole build ran as
  // ONE synchronous chunk the moment its fetch resolved — and several fetches
  // resolving close together stacked their builds into a single frame, which
  // is the "hitch walking into a new area". This gate serializes the heavy
  // phases across all in-flight tiles and yields to the event loop before
  // each one, so at most one heavy chunk runs per turn and input/render
  // frames get a look-in between them. FIFO through a shared chain; a throw
  // in one phase must not wedge the chain for the next (hence the swallow).
  let _heavyChain = Promise.resolve();
  // Yield long enough for the browser to actually PAINT before the next heavy
  // chunk. setTimeout(0) alone only guarantees another macrotask, and a
  // macrotask is not a frame: with nine tiles queued the chain ran chunk,
  // timeout, chunk, timeout — every one of them 300-800 ms of rasterize — and
  // the display never updated between them, so a five-second build read as a
  // frozen app rather than a loading one. rAF fires BEFORE the paint and the
  // timeout inside it resolves after, so exactly one frame is on screen (and
  // one round of input handled) between consecutive chunks.
  // ONE frame per yield, not two. This used to resolve from a setTimeout NESTED
  // inside the rAF, which costs a whole extra turn of the event loop: measured
  // on an iPhone, a 55-slice tile build spent 2.44 s of wall clock on about
  // 1.2 s of work, because each yield was ~36 ms of waiting. rAF alone still
  // gets a paint (it fires as the frame is being prepared) at half the price.
  const _yieldToPaint = () => new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
  function runHeavyPhase(fn) {
    const run = _heavyChain
      .then(_yieldToPaint)
      .then(fn);
    _heavyChain = run.then(() => {}, () => {});
    return run;
  }

  // opts.detached — build a tile entry WITHOUT touching the shared cache (no
  // hit-check, no insert, no LRU prune, no failure bookkeeping). Used by
  // rebuildTileWithBin so a replacement can be constructed alongside the live
  // entry and swapped in only once it is ready.
  async function loadTile(x, y, lat, opts) {
    const detached = !!(opts && opts.detached);
    // NOTE: cache key is `${Z}/${x}/${y}`. The grid (cellsPerEdge) is a pure
    // function of the tile, so it never aliases; only the frame (tileEdgeM,
    // from `lat`) would, and the session is anchored to one START_LAT.
    //
    // `tileCache` here shadows the module-level one with the ACTIVE depth's map
    // so the surface-build body below (dedup scans, eviction, .set) all operate
    // on the right level. Underground levels take a separate code path.
    const depth = activeDepth;
    const tileCache = cacheFor(depth);
    const key = tileKey(x, y);
    if (!detached && tileCache.has(key)) return tileCache.get(key);
    if (depth > 0) return loadCaveTile(tileCache, depth, key, x, y, lat);
    // Failures evict themselves (below) so the next ensureTilesAround retries, with a short
    // floor so a hard offline stretch doesn't spin on rebuild attempts.
    const failedAt = detached ? 0 : _tileFailedAt.get(key);
    if (failedAt && Date.now() - failedAt < TILE_RETRY_MS) {
      return { status: 'loading', grid: null, cellsPerEdge: cellsPerEdgeForTile(y),
               tileEdgeM: tileEdgeMeters(lat), promise: Promise.reject(new Error(`tile ${key} backoff`)),
               _transient: true };
    }
    // The grid is the TILE's (cellsPerEdgeForTile — a function of the row);
    // only the frame (tileEdgeM, where this tile sits in world metres) comes
    // from the save's lat.
    const entry = { status: 'loading', grid: null, cellsPerEdge: cellsPerEdgeForTile(y) };
    const tileEdgeM = tileEdgeMeters(lat);
    entry.tileEdgeM = tileEdgeM;
    entry.promise = (async () => {
      const _bp = (typeof window !== 'undefined' && window.__boot) || null;
      const _endFetch = _bp && _bp.begin(`tile ${key} fetch`);
      const { bytes, fromCache } = await fetchTileBytes(x, y);
      if (_endFetch) _endFetch(fromCache ? 'from cache' : 'from network');
      // Decode and rasterize in separate scheduled turns (see runHeavyPhase):
      // the two heaviest chunks of a tile build each get their own slice, and
      // the spawn/dedup post-passes below ride the rasterize turn.
      const _endDecode = _bp && _bp.begin(`tile ${key} decode`);
      const layers = await runHeavyPhase(() =>
        MVT.decodeTileSliced(bytes, _yieldToPaint, sliceBudgetMs));
      if (_endDecode) _endDecode(`${layers.length} layers`);
      const _endRaster = _bp && _bp.begin(`tile ${key} rasterize`);
      const { grid, owners, ownerKeys, syntheticBuildingCells, objects, wildplants, parkingTreasures, roadLabels, pathUnder, streetGround, poiPadCells, roadMask, quietMask, spawnWhy, roadClass, streetIndex, streetArea, streetDress, zone, zoneDress, scenic, scenicDress, buildingShapes, caveSource } = await runHeavyPhase(() => rasterizeTileSliced(layers, entry.cellsPerEdge, x, y, tileEdgeM));
      if (_endRaster) _endRaster(`${_lastRasterSlices} slices @ ${_sliceMs.toFixed(1)}ms, ` +
        `worst block ${_lastRasterWorstMs}ms in ${_lastRasterWorstAt}`);
      // NO cross-tile dedup. A seam used to hand the same POI / the same
      // house to two tiles, and a proximity dedup against whatever was already
      // cached kept the copy of whichever tile loaded FIRST — so two players
      // (or one player on two visits) could hold different chests and houses,
      // under different ids. The rasterizer now decides ownership from the
      // data itself: a POI belongs to the tile whose square holds its point,
      // a house to the tile whose square holds its full footprint's anchor
      // (see ownsPoint and the house anchor in rasterizeTileSteps). Each copy
      // is minted by exactly one tile whatever else is loaded, so there is
      // nothing left to reconcile here — and nothing O(cache) to run outside
      // the sliced build.
      const filteredObjects = objects.slice();
      entry.grid = grid;
      entry.owners = owners;
      entry.syntheticBuildingCells = syntheticBuildingCells;
      entry.ownerKeys = ownerKeys;
      entry.objects = filteredObjects;
      entry.depth = 0;
      // Concrete POI pad cells (grid indices) — consumed by the cave-entrance
      // pass below so a surface ladder never lands on a POI's plaza.
      entry.poiPadCells = poiPadCells;
      // Road footprint (see roadMask in rasterizeTile). Carried on the entry so
      // every spawner outside worldgen — app.js's treasure scatter, coin
      // bursts, the starter provisioner — can ask the same question the
      // rasterize post-pass asks, by passing it as isSpawnCell's opts.roadMask.
      entry.roadMask = roadMask;
      // Cosmetic street ground stays separate from transport and cave inputs.
      entry.streetGround = streetGround;
      // QUIET LAND (see QUIET_LAND / isSpawnCell's opts.quiet): 1 = a military,
      // railway, reserve or cemetery cell that hosts nothing. Pure MVT,
      // re-derived by a rebuild like the mask; spawnInTile hands it on as
      // _spawnOpts.quiet.
      entry.quietMask = quietMask;
      // THE SPAWN GATE (see isSpawnCell / stampSpawnWhySteps): what each
      // cell may host — OPEN, SUPPRESSED (minor things only) or INVALID.
      // Every spawner reads it through isSpawnCell's opts.spawnWhy.
      entry.spawnWhy = spawnWhy;
      // The MAJOR road's band and verge (see ROAD_CLASS_MAJOR_BAND) and the
      // street index (src/street_variants.js) — both pure MVT, re-derived by a
      // rebuild like the mask. spawnInTile dresses the streets off the index.
      entry.roadClass = roadClass;
      entry.streetIndex = streetIndex || null;
      entry.streetArea = streetArea || null;
      entry.streetDress = streetDress || null;
      entry.caveSource = caveSource;
      // The influence-zone field (src/zones.js — per-cell winner anchor and
      // strength; the story, the ghosts' dusk gate) and the nexus pieces
      // spawnInTile lays. Pure MVT like the index, re-derived by a rebuild.
      entry.zone = zone || null;
      entry.zoneDress = zoneDress || null;
      // The scenic intervals / shore sand / viewpoints (src/scenic.js) and
      // their dressing spawnInTile lays. Pure MVT + grid, re-derived by a
      // rebuild like the zone field.
      entry.scenic = scenic || null;
      entry.scenicDress = scenicDress || null;
      // Source building polygons (tile-local metres) for building_overlay.js —
      // the polygonal counterpart of entry.layers' road linework.
      entry.buildingShapes = buildingShapes || [];
      // Cave entrance: drop one "descend" staircase per surface tile beside a
      // cave-rock cluster (a mine mouth). Tiles with no cave rock get no
      // entrance — not every block has a way down, which reads naturally.
      //
      // Pass the rasterizer's own `objects`, not entry.objects — see
      // maybePlaceCaveEntrance's own comment: a tile can be REBUILT under you
      // (see CLAUDE.md), and once a player has descended, loadCaveTile has
      // already baked this tile's staircase into a cached cave level. The
      // stair must be a pure function of this tile's MVT bytes.
      // Sliced, as its own heavy turn: the random-cell guarantee judges every
      // cell of the tile (one ~17 ms stretch when it ran inline here).
      await runStepsSliced(() => maybePlaceCaveEntranceSteps(entry, x, y, tileEdgeM, objects, wildplants));
      entry.wildplants = wildplants;
      // THE GENERATED LAYER, frozen before anything order-dependent lands on
      // it. The Overpass bin below is injected only if it happens to be in
      // IndexedDB at build time (a cold cache builds without it and is rebuilt
      // later), and app.js writes into entry.grid / entry.objects for its own
      // per-player reasons (the home stair, dug walls, the starter kit, a
      // well repaint). A cave level is derived from the level above, so it
      // must be derived from THIS, never from the live entry, or two players —
      // or one player before and after a rebuild — descend into two caves.
      //   baseGrid    — the rasterized terrain, copied, never written again.
      //   genObjects  — the rasterized objects + generated mine mouths (no
      //                 bin injections, nothing app.js pushes).
      entry.baseGrid = grid.slice();
      entry.genObjects = entry.objects.slice();
      entry.parkingTreasures = parkingTreasures || [];
      entry.roadLabels = roadLabels || {};
      entry.pathUnder   = pathUnder   || {};
      entry.layers = layers;

      // Inject pre-extracted Overpass trees + tree_row bushes for this tile.
      // These bypass the in-tile occupancy/biome filters on purpose — they are
      // real-world features and should appear where OSM says they are — but we
      // still skip any that land on a water cell (a tree mid-lake reads wrong).
      const bin = await getTileBin(x, y, lat);
      // Remember whether this build had real-world decoration. warmOverpass
      // uses it to evict-and-rebuild the tile once a freshly fetched bin
      // lands, so trees appear THIS session instead of after the next reload
      // (the start area otherwise loads treeless right after a save reset
      // wipes the IDB cache).
      entry.hadBin = !!bin;
      // Sliced like the rasterize: a big bin's placement loops held the thread
      // up to 16 ms. No bin, no turn (and no frame spent waiting for one).
      if (bin) await runStepsSliced(() => injectTileBinSteps(entry, bin, x, y));
      // The bin's chests count too: restamp every POI chest's density off the
      // settled tile (stampPoiDensity — the tile is the unit), then reseed the
      // tier quotas off the settled set.
      stampPoiDensity(entry.objects);
      seedChestTiers(entry.objects);

      // The decoded layers stay on the entry for two consumers only: the road
      // overlay re-strokes `transportation` line geometry on each rebuild, and
      // the tile-debug dump reads layer/feature NAMES, types and tags — never
      // geometry. Vertex lists are the bulk of a decoded tile (every point is
      // a heap object; landcover/building polygons carry thousands), so with
      // 64 tiles LRU-cached, dropping the geom nothing will read again saves
      // tens of MB on a long session — real GC/memory pressure on old phones.
      // Rasterization is fully done by here, so nothing downstream misses it.
      for (const l of layers) {
        if (l.name === 'transportation') continue;
        for (const f of (l.features || [])) f.geom = null;
      }

      entry.status = 'ready';
      _tileFailedAt.delete(key);
      return entry;
    })().catch((err) => {
      // Drop the poisoned entry so the tile can be retried instead of being
      // stuck as grass forever. Callers still see the rejection.
      if (!detached) {
        if (tileCache.get(key) === entry) tileCache.delete(key);
        _tileFailedAt.set(key, Date.now());
      }
      throw err;
    });
    if (detached) return entry;
    tileCache.set(key, entry);
    pruneCache(tileCache, key);
    return entry;
  }

  // Apply cached real-world features to the live tile after its generated
  // snapshots have been captured. Bin rows are cloned before placement so a
  // cached bin can be reused across builds and world frames without changing.
  // Placement order is intentional: destinations win before scenery is seated.
  // A steps generator like the rasterize (loadTile drives it sliced — a big
  // bin's placement loops ran up to 16 ms unbroken); this runs it straight
  // through, for the tests and any caller that cannot await.
  function injectTileBin(entry, bin, x, y) {
    return runSteps(injectTileBinSteps(entry, bin, x, y));
  }
  function* injectTileBinSteps(entry, bin, x, y) {
    if (!bin) return;
    let _yi = 0;
    // One yield per 256 rows of any loop below (the label names the stream).
    const tick = (label) => ((_yi++) & 255) === 255 ? label : null;
    const { grid, roadMask, tileEdgeM } = entry;
    const quiet = entry.quietMask || null;
    const cpe = entry.cellsPerEdge;
    // World metres -> this tile's local cell (the shared cellIndexOf, on the
    // tile's own basis tileEdgeM / cpe), and back to that cell's centre.
    const _sxCell = (wx, wy) => {
      const { lix, liy } = cellIndexOf(x, y, wx, wy, tileEdgeM, cpe);
      return { ix: lix, iy: liy };
    };
    const _sxReserved = (ix, iy) => ix >= 0 && iy >= 0 && ix < cpe && iy < cpe
      && !!variantOwnerAt(entry, iy * cpe + ix);
    const _sxReservedAt = (wx, wy) => {
      const { ix, iy } = _sxCell(wx, wy);
      return _sxReserved(ix, iy);
    };
    const _sxCentre = (ix, iy) => cellCentreM(x, y, ix, iy, tileEdgeM, cpe);
    // A bin row carries its TILE-LOCAL cell (lix, liy on this tile's own
    // grid — see buildBinsFromGeoJSON), never frame metres, so the same
    // bin reads the same in every save. It is snapped ONCE, here, onto
    // this tile's cell centre in this save's frame. And it is CLONED: a
    // bin is shared (the static sidecar map lives all session, an
    // Overpass bin is the IndexedDB value), and the passes below write
    // x/y and relocate rows — mutating the bin in place moved a tree a
    // second time on the next build of the same tile.
    const _sxRows = (rows) => {
      const out = [];
      for (const r of (rows || [])) {
        if (r == null || r.lix == null || r.liy == null) continue;
        const c = _sxCentre(r.lix, r.liy);
        const o = { ...r, x: c.x, y: c.y };
        delete o.lix; delete o.liy;
        out.push(o);
      }
      return out;
    };
    // A bin cached before Sep 2026 still carries road furniture as chests
    // (SX_NOT_A_PLACE — dropped) and its gates as chests (moved to the gate
    // cells, seated as posts below).
    const gateCells = [];
    const binChests = [];
    for (const r of (bin.gates || [])) if (r && r.lix != null && r.liy != null) gateCells.push({ ix: r.lix, iy: r.liy });
    // A bin cached before the sensitive-place table (isSensitivePoi) still
    // carries memorials as chests — dropped here too, mints nothing.
    for (const r of (bin.chests || [])) {
      if (!r || SX_NOT_A_PLACE.has(r.poiClass)) continue;
      if (isSensitivePoi({ class: r.poiClass, name: r.name })) continue;
      if (r.poiClass === POI_GATE_CLASS) { if (r.lix != null && r.liy != null) gateCells.push({ ix: r.lix, iy: r.liy }); continue; }
      binChests.push(r);
    }
    const sx = {
      chests: _sxRows(binChests), trees: _sxRows(bin.trees),
      fruittrees: _sxRows(bin.fruittrees), shrubs: _sxRows(bin.shrubs),
      wells: _sxRows(bin.wells), parking: _sxRows(bin.parking),
    };
    const onWater = (wx, wy) => {
      const { ix: lix, iy: liy } = _sxCell(wx, wy);
      if (lix < 0 || liy < 0 || lix >= cpe || liy >= cpe) return false;
      return grid[liy * cpe + lix] === T.WATER;
    };
    // Injected OSM features skip the BIOME filter (they belong wherever
    // the real world puts them) but must still honour one-interactable-
    // per-cell: stacking two pickables on a cell is unreachable for the
    // player. Seed the occupancy set from everything already placed, then
    // drop any tree/bush that would land on a taken cell.
    const cellKeyOf = (wx, wy) => {
      const { ix: lix, iy: liy } = _sxCell(wx, wy);
      return `${lix}_${liy}`;
    };
    // Frame metres per cell of this tile — only to turn the cell-unit
    // dedup radii below into this frame's distances.
    const _sxCellM = tileEdgeM / cpe;
    // Occupancy set — seed from everything rasterizeTile already placed so
    // injected features never land on an existing interactable (a rasterized
    // tree / rock / house / chest).
    const occupied = new Set();
    for (const o of entry.objects) {
      occupied.add(cellKeyOf(o.x, o.y));
      const y1 = tick('bin occupancy'); if (y1) yield y1;
    }
    for (const wp of entry.wildplants) {
      occupied.add(cellKeyOf(wp.x, wp.y));
      const y1 = tick('bin occupancy'); if (y1) yield y1;
    }
    // Lot-yard rule for the sidecar injections below. These land after
    // rasterizeTile's lot post-pass, so they re-apply the shared spawn rule.
    // Residential and wasteland lot cells are gated (LOT_TYPES); other
    // terrain passes through. POI chests, both placed and pending, count as anchors.
    const _sxPois = [];
    for (const o of entry.objects) if (o.kind === 'chest' || o.kind === 'grove_shrine') _sxPois.push(_sxCell(o.x, o.y));
    for (const ch of sx.chests) _sxPois.push(_sxCell(ch.x, ch.y));
    const spawnWhy = entry.spawnWhy || null;
    const _sxSpawnOpts = { pois: _sxPois, roadMask, quiet, spawnWhy };
    // THE SPAWN GATE for the bin's scenery (a MINOR spawn): the land the mask
    // refuses — quiet, restricted, sensitive, behind a house, no frontage
    // (the chests above and in the bin vouch for their frontage). Terrain and
    // band keep each stream's own rule below (a well may repaint a road).
    const _sxYardOK = (wx, wy) => {
      const { ix, iy } = _sxCell(wx, wy);
      if (ix < 0 || iy < 0 || ix >= cpe || iy >= cpe) return true;
      if (spawnWhy) return !landRefused(spawnWhy, iy * cpe + ix, _sxPois, ix, iy);
      if (quiet && quiet[iy * cpe + ix]) return false;   // quiet land hosts nothing
      if (!isLotTerrain(grid[iy * cpe + ix])) return true;
      return isSpawnCell(grid, cpe, cpe, ix, iy, _sxSpawnOpts, 'minor');
    };
    // Trees + fruit trees can NEVER sit on a building footprint, road, path,
    // water or other hard/interactable cell — nor on a manicured open field
    // (school grounds, playground, sports pitch, golf course), which read
    // wrong carpeted in OSM trees. When a detection lands on one, relocate
    // it to a favourable empty neighbour cell; drop it only if no neighbour
    // works. One tree per cell — process largest crown first so the biggest
    // tree wins a contested cell and smaller ones spill to neighbours.
    const TREE_BLOCK = new Set([
      T.WATER, T.PIER, ...COBBLE_TYPES,
      ...BUILDING_TYPES,
      T.COMMERCIAL, T.INDUSTRIAL, T.TAR_YARD, T.ROCK,
      T.SCHOOL, T.PLAYGROUND, T.PITCH, T.GOLF,
    ]);
    // Cell at (ix,iy) is hard ground a scatter object must never sit on:
    // the TREE_BLOCK terrain set, plus anything under a drawn road band —
    // the injected features are placed from real-world coordinates, so
    // without the band an OSM street tree recorded in the middle of a
    // widened carriageway stays there. Routed through THE SPAWN GATE (a
    // 'minor' spawn, no spawnWhy — the LAND half of the rule is
    // tryTreeCell/_sxYardOK's separate call, right below) rather than a bare
    // roadMask read, so this and every other spawner answer "is this under
    // the band" the same one way.
    yield 'bin ground';
    const detectedGround = entry.zone?.under && typeof Zones !== 'undefined'
      ? grid.map((t, i) => Zones.landAt(grid, entry.zone.under, i)) : grid;
    const _sxHardCell = (ix, iy, detected = false) => {
      if (ix < 0 || iy < 0 || ix >= cpe || iy >= cpe) return false;
      const i = iy * cpe + ix;
      // A zone's decorative ground paint must not erase a real canopy.
      const ground = detected ? detectedGround : grid;
      return TREE_BLOCK.has(ground[i])
        || !isSpawnCell(ground, cpe, cpe, ix, iy, { roadMask }, 'minor')
        || !!(quiet && quiet[iy * cpe + ix]);
    };
    const _sxHard = (wx, wy) => {
      const { ix, iy } = _sxCell(wx, wy);
      return _sxHardCell(ix, iy);
    };
    // Cell at (wx,wy) is a building footprint — wells get a softer rule than
    // _sxHard (they may supersede a road tile, repainting it) but must still
    // never land on a building.
    const _sxBuilding = (wx, wy) => {
      const { ix, iy } = _sxCell(wx, wy);
      if (ix < 0 || iy < 0 || ix >= cpe || iy >= cpe) return false;
      return isBuildingTerrain(grid[iy * cpe + ix]);
    };
    // One-cell building moat (nearBuildingCell) — same rule the rasterize
    // post-pass applies, mirrored here for the sidecar GROUND furniture
    // (wells). Trees are exempt in both passes — yard trees grow
    // right against real houses (see tryTreeCell). And the one-cell POI
    // frontage (nearPoiCell): _sxPois already covers both rasterized and
    // bin chests.
    const _sxNearBuilding = (wx, wy) => {
      const { ix, iy } = _sxCell(wx, wy);
      return nearBuildingCell(grid, cpe, cpe, ix, iy);
    };
    const _sxNearChest = (wx, wy) => {
      const { ix, iy } = _sxCell(wx, wy);
      return nearPoiCell(_sxPois, ix, iy);
    };
    // POI chests (bus stops, signals, crossings, gates, towers, pitches,
    // gardens, bicycle racks, …) are injected FIRST: a chest is a real-world
    // destination, so it must win its cell over a generic tree/shrub
    // (mirroring the rasterize occupancy pass where chest outranks all).
    // poiClass drives loot / tier / label / coin-burst via loot.js + the
    // render/interact chest paths.
    //
    // One real-world place, one chest. Two sidecar chests of the same class
    // within a short distance describe the same thing — see isDupPoiChest
    // for the two radii and the two bugs behind them — so the later copy is
    // skipped. Checked against entry.objects as it grows, so the rule
    // covers MVT chests already on the tile AND the sidecar chests
    // injected just before this one.
    // A chest outranks SCENERY on its cell, not just later injections: the
    // occupied set is seeded from everything rasterizeTile placed, so a
    // bus stop / crossing whose cell happened to hold a rasterized rock,
    // tree or grass tuft was silently dropped — a real-world destination
    // lost to set dressing ("I never see chests at POIs"). Evict the
    // scenery instead; only another chest or a structure (house / tower /
    // staircase) genuinely blocks the cell.
    const SX_CHEST_BLOCKERS = new Set(['chest', 'house', 'tower', 'staircase']);
    //
    // O(n) BY CONSTRUCTION — this post-rasterize path has no slicer (see
    // CLAUDE.md, "A tile build stutters on its WORST BLOCK"). The blocker
    // cells are indexed ONCE; an eviction only records its cell, and one
    // in-place compaction after the loop drops every evicted item, order
    // kept. That is the same result as evicting on the spot: an evicted
    // cell held no blocker, so everything on it is scenery (never a chest,
    // so isDupPoiChest never sees the difference), and the only thing the
    // loop adds to that cell afterwards is the winning chest itself —
    // which sits past `preLen`, outside the sweep, and is a blocker for
    // any later chest on the same cell.
    const sxBlockerCells = new Set();
    for (const o of entry.objects) {
      if (SX_CHEST_BLOCKERS.has(o.kind)) sxBlockerCells.add(cellKeyOf(o.x, o.y));
    }
    const sxEvicted = new Set();
    const sxPreLen = entry.objects.length;
    const evictSceneryAt = (k) => {
      if (sxBlockerCells.has(k)) return false;
      sxEvicted.add(k);
      return true;
    };
    for (const ch of sx.chests) {
      { const y1 = tick('bin chests'); if (y1) yield y1; }
      if (onWater(ch.x, ch.y)) continue;   // a chest mid-lake / on stream water reads wrong
      if (!_sxYardOK(ch.x, ch.y)) continue;
      if (isDupPoiChest(entry.objects, ch, _sxCellM)) continue;
      const k = cellKeyOf(ch.x, ch.y);
      if (occupied.has(k) && !evictSceneryAt(k)) continue;
      occupied.add(k);
      delete ch.garden;   // internal flag — don't leak into the chest object
      entry.objects.push(ch);
      // A chest blocks its cell for every later chest (kind-checked, exactly
      // as the old per-chest scan of entry.objects would have seen it).
      if (SX_CHEST_BLOCKERS.has(ch.kind)) sxBlockerCells.add(k);
    }
    // GATES (a bin's barrier=gate points): two posts round a spawn point,
    // seated by the same rule the rasterize pass uses (placeGatesAndBoards),
    // after the chests have won their cells and before any scenery.
    if (gateCells.length) {
      const before = entry.objects.length;
      placeGatesAndBoards(entry.objects, gateCells, null, {
        grid, N: cpe, roadMask, quiet, spawnWhy, tx: x, ty: y, taken: occupied,
        centre: (ix, iy) => _sxCentre(ix, iy),
      });
      for (let i = before; i < entry.objects.length; i++) {
        sxBlockerCells.add(cellKeyOf(entry.objects[i].x, entry.objects[i].y));
      }
    }
    if (sxEvicted.size) {
      const objs = entry.objects;
      let wr = 0;
      for (let i = 0; i < objs.length; i++) {
        const o = objs[i];
        if (i < sxPreLen && sxEvicted.has(cellKeyOf(o.x, o.y))) continue;
        objs[wr++] = o;
      }
      objs.length = wr;
      const wps = entry.wildplants;
      wr = 0;
      for (let i = 0; i < wps.length; i++) {
        const wp = wps[i];
        if (sxEvicted.has(cellKeyOf(wp.x, wp.y))) continue;
        wps[wr++] = wp;
      }
      wps.length = wr;
    }
    // DeepForest crowns outrank authored dressing, including intentionally
    // empty motif cells. Older cached bins predate the explicit source flag.
    const detectedTree = t => t._treeSource === 'deepforest' ||
      (!t.id && (t.crown_m != null || t.size != null || t.individual === true));
    const replaceable = o => !o.placed && !o.planted && !o.playerOwned &&
      !['chest', 'grove_shrine', 'house', 'tower', 'staircase', 'gatepost', 'well'].includes(o.kind) &&
      !!(o._street || o.zoneVariant || o._scenic);
    const fixedCells = new Set(), themedCells = new Set(), treeClaims = new Set();
    const objectCells = o => {
      const {ix, iy} = _sxCell(o.x, o.y);
      const footprint = o._footprintCells || o.footprintCells || {};
      const width = Math.max(1, Math.floor(footprint.width || o._shrineExtentCells || 1));
      const height = Math.max(1, Math.floor(footprint.height || o._shrineExtentCells || 1));
      const cells = [];
      for (let dy = 0; dy < height; dy++) for (let dx = 0; dx < width; dx++) {
        const cx = ix - Math.floor((width - 1) / 2) + dx;
        const cy = iy - Math.floor((height - 1) / 2) + dy;
        if (cx >= 0 && cy >= 0 && cx < cpe && cy < cpe) cells.push(cy * cpe + cx);
      }
      return cells;
    };
    for (const list of [entry.objects, entry.wildplants]) for (const o of list) {
      { const y1 = tick('bin cell claims'); if (y1) yield y1; }
      const cells = replaceable(o) ? themedCells : fixedCells;
      for (const i of objectCells(o)) cells.add(i);
    }
    const tryTreeCell = (ix, iy, detected) => {
      if (ix < 0 || iy < 0 || ix >= cpe || iy >= cpe) return null;
      if (!detected && _sxReserved(ix, iy)) return null;
      if (_sxHardCell(ix, iy, detected)) return null;
      const cell = iy * cpe + ix;
      if (fixedCells.has(cell)) return null;
      if (occupied.has(`${ix}_${iy}`) && !(detected && themedCells.has(cell))) return null;
      // Chest frontage stays clear (the player stands beside the chest),
      // but trees may hug buildings — no nearBuildingCell here. Yard
      // trees sit right against real houses; routing them through the
      // building moat dropped every detection ringing a house (the cells
      // they'd relocate to are in the moat too) and left home yards bare.
      if (nearPoiCell(_sxPois, ix, iy)) return null;
      const { x: wcx, y: wcy } = _sxCentre(ix, iy);
      if (!_sxYardOK(wcx, wcy)) return null;
      return { ix, iy, x: wcx, y: wcy, key: `${ix}_${iy}` };
    };
    // 4-neighbours first (closer, axis-aligned), then diagonals.
    const NB8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    const placeTree = (wx, wy, detected) => {
      const { ix, iy } = _sxCell(wx, wy);
      let r = tryTreeCell(ix, iy, detected);
      if (r) return r;
      for (const [dx, dy] of NB8) { r = tryTreeCell(ix + dx, iy + dy, detected); if (r) return r; }
      return null;
    };
    const allTrees = [...sx.trees, ...sx.fruittrees]
      .sort((a, b) => (b.crown_m || 0) - (a.crown_m || 0));
    for (const t of allTrees) {
      { const y1 = tick('bin trees'); if (y1) yield y1; }
      const detected = detectedTree(t);
      if (detected && !DEEPFOREST_TREES_ENABLED) continue;
      const r = placeTree(t.x, t.y, detected);
      if (!r) continue;
      occupied.add(r.key);
      fixedCells.add(r.iy * cpe + r.ix);
      if (detected) {
        treeClaims.add(r.iy * cpe + r.ix);
        t._treeSource = 'deepforest';
      }
      t.x = r.x; t.y = r.y;
      // A detection with no OSM id is named by the cell it SETTLED on —
      // unique (one tree per cell, just claimed) and positional. Its bin
      // cell alone was not: two detections in one cell, or one relocated
      // onto a cell a forest tree's id already named, shared an id, and
      // chopping one felled the other.
      if (!t.id) t.id = cellId(`${t.kind === 'fruittree' ? 'ft' : 'tree'}_sx`, x, y, r.ix, r.iy);
      entry.objects.push(t);
    }
    if (treeClaims.size) {
      const overlapsTree = o => objectCells(o).some(i => treeClaims.has(i));
      // Filter live arrays only; genObjects and cave snapshots stay immutable.
      entry.objects = entry.objects.filter(o => !replaceable(o) || !overlapsTree(o));
      entry.wildplants = entry.wildplants.filter(o => !replaceable(o) || !overlapsTree(o));
      for (const dress of [entry.streetDress, entry.zoneDress, entry.scenicDress]) {
        if (!dress) continue;
        for (const key of ['objects', 'wildplants', 'treasures', 'coins', 'traps', 'guards']) {
          if (!dress[key]) continue;
          dress[key] = dress[key].filter(o => !overlapsTree(o) &&
            !(key === 'guards' && Number.isFinite(o.homeX) && Number.isFinite(o.homeY) &&
              overlapsTree({x:o.homeX, y:o.homeY})));
        }
        if (dress.lairs) dress.lairs = dress.lairs.filter(l =>
          !overlapsTree({x:x * tileEdgeM + l.lx, y:y * tileEdgeM + l.ly}));
        for (const i of treeClaims) {
          if (dress.marks) dress.marks[i] = 0;
          if (dress.slowCells) dress.slowCells.delete(i);
        }
      }
    }
    for (const s of sx.shrubs) {
      { const y1 = tick('bin shrubs'); if (y1) yield y1; }
      if (_sxReservedAt(s.x, s.y)) continue;
      if (onWater(s.x, s.y)) continue;
      if (_sxHard(s.x, s.y)) continue;            // never on road / building / hard cell
      if (_sxNearChest(s.x, s.y)) continue;       // keep the POI frontage clear
      if (!_sxYardOK(s.x, s.y)) continue;
      const k = cellKeyOf(s.x, s.y);
      if (occupied.has(k)) continue;
      occupied.add(k);
      const c = s;   // already on this tile's cell centre (_sxRows)
      // Minted HERE rather than where the bin row was built (buildBin's
      // `shrubs.push`): a bin is CACHED in IndexedDB, so a bin written
      // before a stream's shape changed would otherwise inject records
      // missing the new field for as long as it lives in the cache. The
      // bin carries the facts (position, id); the stream's shape is this
      // file's, applied at the moment the row joins the stream.
      entry.wildplants.push(makeWildplant(s.crop, c.x, c.y, s.id));
    }
    // (No poles: utility poles, masts, bollards and OSM street lamps were a
    // non-interactive stone pillar, cut by the no-decorative-props rule. A
    // bin cached before then still carries `poles`; nothing reads them.)
    // Wells (OSM amenity=fountain) → a tappable well object that refills the
    // watering can (interact.js 'well' branch), rendered as the well sprite.
    for (const wl of sx.wells) {
      { const y1 = tick('bin wells'); if (y1) yield y1; }
      if (onWater(wl.x, wl.y)) continue;
      if (_sxBuilding(wl.x, wl.y)) continue;      // never on a building (roads are superseded below)
      if (_sxNearBuilding(wl.x, wl.y)) continue;  // nor inside a house sprite's overhang
      if (_sxNearChest(wl.x, wl.y)) continue;     // keep the POI frontage clear
      if (!_sxYardOK(wl.x, wl.y)) continue;
      const k = cellKeyOf(wl.x, wl.y);
      if (occupied.has(k)) continue;
      occupied.add(k);
      entry.objects.push(wl);
      // A well supersedes a road/path tile it lands on — repaint the cell to
      // the dominant soft neighbour biome (so it blends, not a hard grass
      // square) and clear the cobble's road-label / path-name so no label
      // or path-stone tint shows under the well.
      const { ix: lix, iy: liy } = _sxCell(wl.x, wl.y);
      if (lix >= 0 && liy >= 0 && lix < cpe && liy < cpe && isCobbleTerrain(grid[liy * cpe + lix])) {
        const NONSOFT = new Set([T.WATER, T.PIER, ...BUILDING_TYPES]);
        const counts = {};
        for (let ddy = -1; ddy <= 1; ddy++) for (let ddx = -1; ddx <= 1; ddx++) {
          if (!ddx && !ddy) continue;
          const nnx = lix + ddx, nny = liy + ddy;
          if (nnx < 0 || nny < 0 || nnx >= cpe || nny >= cpe) continue;
          const nt = grid[nny * cpe + nnx];
          if (isCobbleTerrain(nt) || NONSOFT.has(nt)) continue;
          counts[nt] = (counts[nt] || 0) + 1;
        }
        let best = T.GRASS, bestN = 0;
        for (const t2 in counts) if (counts[t2] > bestN) { bestN = counts[t2]; best = +t2; }
        grid[liy * cpe + lix] = best;
        const ck = `${lix}_${liy}`;
        if (entry.roadLabels) delete entry.roadLabels[ck];
      }
    }
    // (POI chests were injected before the trees above — a chest is a
    // real-world destination and must win its cell over scenery; the
    // area-POI ~25 m same-class dedupe moved up with that loop.)
    // Parking lots (OSM amenity=parking) → a buried-treasure "X marks the
    // spot" mark, claimed via the treasure handler (same array the MVT
    // parking path fills). No per-cell occupancy — X marks sit under the
    // terrain and don't block other interactables.
    for (const pk of sx.parking) {
      { const y1 = tick('bin parking'); if (y1) yield y1; }
      // Same treatment the MVT parking path gets in the rasterize
      // post-pass: a lot's anchor lands on its aisle or the street beside
      // it as often as on standable ground, so walk the X to the nearest
      // cell that passes the shared spawn rule instead of burying treasure
      // under the asphalt. Dropped only if nothing nearby works.
      {
        const { ix, iy } = _sxCell(pk.x, pk.y);
        if (ix < 0 || iy < 0 || ix >= cpe || iy >= cpe) continue;
        const moved = relocateToSpawnCell(grid, cpe, cpe, ix, iy, _sxSpawnOpts, null, 'minor');
        if (!moved) continue;
        ({ x: pk.x, y: pk.y } = _sxCentre(moved.ix, moved.iy));
        // Named by its settled cell, in the MVT parking path's own format,
        // so the same lot from both sources is the same X.
        pk.id = cellId('t_park', x, y, moved.ix, moved.iy);
      }
      // Skip if an X already sits within ~8m (in CELLS: 8 / CELL_M, so
      // the same cell or an orthogonal neighbour) — the MVT parking path
      // fills the SAME array (before this injection), so the same lot
      // present in both sources would otherwise drop two
      // separately-claimable treasures.
      const pkc = _sxCell(pk.x, pk.y);
      const dupe = entry.parkingTreasures.some(t => {
        const tc = _sxCell(t.x, t.y);
        const dx = tc.ix - pkc.ix, dy = tc.iy - pkc.iy;
        return (dx * dx + dy * dy) * CELL_M * CELL_M <= 8 * 8;
      });
      if (dupe) continue;
      entry.parkingTreasures.push(pk);
    }
  }

  // LRU prune to bound memory on long-walking sessions. Insertion order is
  // a reasonable proxy for "least recently loaded"; per-tile state worth
  // preserving (opened chests, chopped trees, picked debris, etc.) lives in
  // save.*, so re-rasterising an evicted tile reconstructs the same view.
  // Shared by the surface cache (loadTile) and every cave level's (loadCaveTile).
  const MAX_CACHED_TILES = 64;
  function pruneCache(cache, keepKey) {
    while (cache.size > MAX_CACHED_TILES) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey === keepKey) break;   // never evict what we just inserted
      cache.delete(oldestKey);
    }
  }

  function tileXYForLonLat(lon, lat) {
    const n = 1 << Z;
    const x = Math.floor((lon + 180) / 360 * n);
    const sin = Math.sin(lat * Math.PI / 180);
    const y = Math.floor((0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * n);
    return { x, y };
  }

  // --- satextract sidecar: individual OSM trees + tree_row clusters ---------
  // The OpenFreeMap MVT feed carries no `natural` / `barrier` layer, so real
  // street/yard trees and hedgerows never reach the game. We wire in a
  // pre-extracted Overpass sidecar (data/satextract_osm.geojson) instead:
  //   • each natural=tree point  -> a single choppable `tree` object
  //   • each tree_row centroid   -> a ~5-bush `shrub` wildplant cluster
  //     ("covered with bushes" — the LineString geometry was reduced to a
  //      centroid Point upstream, so we scatter a small disc of bushes).
  // Features are binned by their z14 tile so loadTile can inject only the
  // ones belonging to the tile it just built. Projection uses the SAME
  // (tx * tileEdgeM + localOffset) basis as rasterizeTile so positions line up.
  let _satextractPromise = null;

  // Transform a satextract-style GeoJSON FeatureCollection (Point features
  // tagged with properties.kind) into per-z14-tile bins. Shared by the static
  // sidecar loader (ensureSatextract) and the live Overpass loader
  // (fetchOverpassBin) — both feed the SAME feature shape through here, so
  // there is exactly one binning / projection / species-fallback code path.
  function buildBinsFromGeoJSON(gj, lat) {
    // DeepForest detections below this confidence are dropped on load. OSM
    // trees carry no `score` and are always kept. The z20 classified run is
    // already filtered at 0.30 (the reviewed sweet spot), so match it here.
    const SATEXTRACT_TREE_MIN_SCORE = 0.30;
    // lon/lat -> the z14 tile it falls in, plus its TILE-LOCAL CELL (lix,
    // liy) on that tile's OWN grid (cellsPerEdgeForTile(ty) cells an edge).
    // Frame-free: the tile fraction comes straight off the mercator, and the
    // tile's cell count off its row — nothing here reads a latitude the save
    // chose, so every save bins a feature into the same cell. (This used to
    // snap to a GLOBAL CELL_M grid in frame metres — `lat` was the save's
    // START_LAT — so which cell, which id and which species seed a feature got
    // moved with the player's home.) loadTile snaps the cell onto its frame.
    // `lat` is accepted and ignored, for callers that still pass it.
    void lat;
    const project = (lon, lat0) => {
      const px = lonLatToWorldPx(lon, lat0, Z);
      const fx = px.x / TILE_PX, fy = px.y / TILE_PX;
      const tx = Math.floor(fx), ty = Math.floor(fy);
      const N = cellsPerEdgeForTile(ty);
      const lix = Math.min(N - 1, Math.floor((fx - tx) * N));
      const liy = Math.min(N - 1, Math.floor((fy - ty) * N));
      return { tx, ty, lix, liy };
    };
        const bins = new Map();
        const binFor = (tx, ty) => {
          const k = `${tx}_${ty}`;
          let b = bins.get(k);
          if (!b) {
            b = emptyBin();
            bins.set(k, b);
          }
          return b;
        };
        // Sidecar POI kind → in-game chest poiClass. Each becomes a tappable
        // chest; poiClass drives loot / tier / label / pad / coin-burst via
        // loot.js + the render & interact chest paths (see POI_CATEGORY there).
        //   bus_stop → 'bus' (existing lowtier class, "Stagecoach Stop" label)
        //   line     → 'powerline' (power=line way centroid)
        //   tower    → 'tower' POICLASS (lowtier chest) — note this is the chest's
        //              poiClass, NOT the castle 'tower' OBJECT kind.
        //   garden   → 'flora' loot (random flower seed) + a flower burst.
        //   bicycle_parking → coin-burst "treasure hunt" chest (interact.js).
        // Road furniture that is no PLACE (traffic signals, stop signs,
        // crossings, fences, power lines, carports — SX_NOT_A_PLACE) mints
        // nothing, and a GATE goes to the bin's `gates` (a spawn point with
        // two posts, gatePostsAt), not its chests.
        const SX_CHEST_POI = {
          // (No `memorial`: a memorial is a SENSITIVE place — isSensitivePoi —
          // and mints nothing; the live Overpass query no longer asks for it.)
          bus_stop: 'bus', picnic_table: 'picnic_table',
          tower: 'tower', pitch: 'pitch', swimming_pool: 'swimming_pool',
          playground: 'playground', bicycle_parking: 'bicycle_parking',
          garden: 'garden',
        };
        if (gj && gj.features) for (const f of gj.features) {
          const g = f.geometry;
          if (!g || g.type !== 'Point') continue;
          const kind = f.properties && f.properties.kind;
          const osmId = (f.properties && f.properties.osm_id) || 0;
          const [lon, lat0] = g.coordinates;
          if (kind === 'tree') {
            const props = f.properties || {};
            // Drop low-confidence DeepForest detections. OSM trees have no
            // score (undefined) and pass through untouched.
            if (props.score != null && props.score < SATEXTRACT_TREE_MIN_SCORE) continue;
            const p = project(lon, lat0);
            const { lix, liy } = p;
            // Species / growth-variant seed. OSM trees key off their stable
            // osm_id; DeepForest trees have none, so derive a stable seed from
            // the tile + cell so a given tree always renders the same.
            const seed = osmId || cellHash(p.tx, p.ty, lix, liy);
            binFor(p.tx, p.ty).trees.push({
              kind: 'tree', lix, liy,
              variant: 1 + (seed % 4),
              // DeepForest trees carry a colour-classified species (pine/maple);
              // OSM trees have none → fall back to the seeded random species.
              // The WORLD's species: softwood-near-home is a per-player overlay
              // (HomeArea.applySoftwood, app.js), never baked into a bin.
              species: TREE_SPECIES.includes(props.species) ? props.species
                : TREE_SPECIES[seed % TREE_SPECIES.length],
              // An OSM tree is named by its osm_id; a detection (no id) is
              // named by the cell it SETTLES on, at injection (loadTile).
              id: osmId ? `tree_osm_${osmId}` : undefined,
              // DeepForest crown diameter (metres) + discrete size class + sampled
              // crown colour → sprite size / tint in render.js. Undefined for OSM
              // trees, which fall back to the flat species scale and no tint.
              _treeSource: props.score != null ? 'deepforest' : undefined,
              crown_m: props.crown_m,
              size: props.size === 'bush' ? 'small' : props.size,
              crown_color: props.crown_color,
              // Flag standalone OSM trees (street / yard) so the T-key teleport
              // can hop between them, distinct from dense forest-grove trees.
              individual: true,
            });
          } else if (kind === 'fruittree') {
            // DeepForest tree colour-classified as a fruit tree (apple/peach).
            const props = f.properties || {};
            if (props.score != null && props.score < SATEXTRACT_TREE_MIN_SCORE) continue;
            const p = project(lon, lat0);
            const { lix, liy } = p;
            // The classifier over-reported peaches; use the same rare-peach
            // rate as orchards, keyed by the tree's stable cell identity.
            const ftHash = cellHash(p.tx, p.ty, lix, liy);
            binFor(p.tx, p.ty).fruittrees.push({
              kind: 'fruittree', lix, liy,
              species: fruitTreeSpecies(ftHash),
              // Named by osm_id when it has one, else by its settled cell at
              // injection (loadTile) — see the tree row above.
              id: osmId ? `ft_osm_${osmId}` : undefined,
              _treeSource: props.score != null ? 'deepforest' : undefined,
              crown_m: props.crown_m,
              size: props.size,
              wild: true,            // mature & fruiting (vs a planted sapling)
              individual: true,
            });
          } else if (kind === 'tree_row') {
            // Scatter ~5 bushes in a small disc around the row centroid.
            const rng = makeRng((osmId ^ 0xB005FACE) >>> 0);
            // Metres per degree: 111320 m/deg of latitude (the standard
            // spherical figure), scaled by cos(lat) for longitude. Only used
            // to turn a metre-radius jitter into a degree offset here.
            const mPerLat = 111320, mPerLon = 111320 * Math.cos(lat0 * Math.PI / 180);
            for (let i = 0; i < 5; i++) {
              const ang = rng() * Math.PI * 2;
              const rad = 2 + rng() * 10;   // 2–12 m from the centroid
              const p = project(lon + (rad * Math.cos(ang)) / mPerLon,
                                lat0 + (rad * Math.sin(ang)) / mPerLat);
              const { lix, liy } = p;
              binFor(p.tx, p.ty).shrubs.push({
                lix, liy, crop: 'shrub', id: `sxbush_${osmId}_${i}`,
              });
            }
          } else if (kind === 'fountain') {
            // amenity=fountain → a well (water source). Snapped to the cell grid
            // like trees; rendered + interacted as a 'well' object.
            const p = project(lon, lat0);
            const { lix, liy } = p;
            binFor(p.tx, p.ty).wells.push({
              kind: 'well', lix, liy,
              id: osmId ? `well_${osmId}` : cellId('well', p.tx, p.ty, lix, liy),
            });
          } else if (kind === 'parking') {
            // amenity=parking → a buried-treasure X (claimed via the treasure
            // handler), matching the MVT parking path's parkingTreasures.
            const p = project(lon, lat0);
            const { lix, liy } = p;
            binFor(p.tx, p.ty).parking.push({
              // Re-minted from the SETTLED cell at injection (loadTile), in
              // the MVT parking path's own format.
              lix, liy, id: cellId('t_park', p.tx, p.ty, lix, liy),
            });
          } else if (kind === POI_GATE_CLASS) {
            // A gate → its tile-local cell; injectTileBin seats the posts.
            const p = project(lon, lat0);
            binFor(p.tx, p.ty).gates.push({ lix: p.lix, liy: p.liy });
          } else if (SX_CHEST_POI[kind]) {
            // Everything else we care about becomes a POI chest — unless its
            // tags make it a sensitive place (a bench with memorial=plaque,
            // a garden of remembrance: isSensitivePoi), which mints nothing.
            const tags = (f.properties && f.properties.tags) || {};
            if (isSensitivePoi({ ...tags, class: SX_CHEST_POI[kind] })) continue;
            const p = project(lon, lat0);
            const { lix, liy } = p;
            binFor(p.tx, p.ty).chests.push({
              kind: 'chest', lix, liy,
              poiClass: SX_CHEST_POI[kind],
              name: tags.name || '',
              // Garden chests scatter a flower burst at injection time.
              garden: kind === 'garden' || undefined,
              id: osmId ? `sxc_${osmId}` : cellId('sxc', p.tx, p.ty, lix, liy),
            });
          }
        }
        return bins;
  }

  // Static sidecar loader: fetch the pre-extracted (OSM + DeepForest +
  // Grounding DINO) geojson once and bin it. Memoized for the session.
  // ?v bumps whenever data/satextract_osm.geojson is regenerated — the file
  // name is otherwise stable, so without a cache-bust the browser serves a
  // stale copy and freshly-extracted features (relocated trees) never
  // appear. Bump this when you re-run satextract.
  function ensureSatextract(lat) {
    if (_satextractPromise) return _satextractPromise;
    _satextractPromise = fetch(SATEXTRACT_URL)
      .then(r => (r.ok ? r.json() : null))
      .then(gj => buildBinsFromGeoJSON(gj, lat))
      .catch(() => new Map());
    return _satextractPromise;
  }

  // --- Live Overpass loader (opt-in) -------------------------------------
  // The static sidecar only covers the pre-extracted bbox. When live mode is
  // on, tiles OUTSIDE that bbox are decorated by querying the Overpass API for
  // the tile's bbox at request time, mapping the OSM elements into the SAME
  // satextract-style GeoJSON `kind` vocabulary, and running them through
  // buildBinsFromGeoJSON. This revives ONLY the OSM-tagged features (trees,
  // street furniture, fountains) — the DeepForest crowns and
  // Grounding DINO objects are CV-only and stay exclusive to the static file.
  // ON by default: each tile's result is cached in IndexedDB indefinitely, so
  // we hit Overpass at most once per tile, ever. Opt out at runtime with
  // WorldGen.setOverpassLive(false) or by appending ?overpass=off to the URL.
  let _overpassLive = true;
  function overpassLiveEnabled() {
    try {
      const s = (global.location && global.location.search) || '';
      if (/[?&]overpass=off(?:&|$)/.test(s)) return false;   // explicit opt-out
      if (/[?&]overpass=live(?:&|$)/.test(s)) return true;    // explicit opt-in
    } catch (_) { /* no location (tests/node) → fall through to the flag */ }
    return _overpassLive;
  }
  // In-memory status tracker so the on-screen TILE DEBUG dump can report
  // whether Overpass loaded for a tile (handy on mobile, where there's no
  // DevTools / Network tab). Keyed `${x}_${y}` → { status, counts, ts }.
  const _overpassState = new Map();
  function ovpNote(x, y, status, bin) {
    const e = { status, ts: Date.now() };
    if (bin) {
      e.trees   = (bin.trees || []).length + (bin.fruittrees || []).length;
      e.chests  = (bin.chests || []).length;
      e.wells   = (bin.wells || []).length;
      e.shrubs  = (bin.shrubs || []).length;
      e.parking = (bin.parking || []).length;
    }
    _overpassState.set(`${x}_${y}`, e);
  }
  // One-line human status for tile (x,y), for the debug dump.
  function overpassTileInfo(x, y) {
    if (!overpassLiveEnabled()) return 'live=off (?overpass=off or setOverpassLive(false))';
    const e = _overpassState.get(`${x}_${y}`);
    let loaded = 0;
    for (const v of _overpassState.values()) {
      if (v.status === 'loaded' || v.status === 'cache') loaded++;
    }
    const tail = `  [${loaded} tile(s) decorated this session]`;
    if (!e) return 'live=on  src=? (tile not loaded yet)' + tail;
    if (e.status === 'static')   return 'live=on  src=static sidecar (in prebaked bbox)' + tail;
    if (e.status === 'fetching') return 'live=on  src=overpass — FETCHING… reload this tile to see results' + tail;
    if (e.status === 'failed')   return 'live=on  src=overpass — fetch FAILED (offline/blocked); will retry' + tail;
    if (e.status === 'loaded' || e.status === 'cache') {
      const src = e.status === 'cache' ? 'overpass (cached)' : 'overpass (just fetched)';
      const total = (e.trees || 0) + (e.chests || 0) + (e.wells || 0) + (e.shrubs || 0) + (e.parking || 0);
      if (!total) return `live=on  src=${src} — area has 0 OSM features` + tail;
      return `live=on  src=${src}: ${e.trees || 0} trees, ${e.chests || 0} chests, `
        + `${e.wells || 0} wells, ${e.shrubs || 0} bushes, ${e.parking || 0} parking` + tail;
    }
    return 'live=on  src=none' + tail;
  }
  // Public, CORS-enabled endpoints, tried in order (fail over on error / 429).
  const OVERPASS_ENDPOINTS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
  ];
  // Per-attempt client abort. Slightly above the query's own [timeout:20] so a
  // healthy-but-slow server response isn't cut off, but a true hang still dies.
  const OVERPASS_TIMEOUT_MS = 22000;
  // Empty bin in the exact shape buildBinsFromGeoJSON / loadTile expect.
  function emptyBin() {
    return { trees: [], fruittrees: [], shrubs: [],
             wells: [], chests: [], parking: [], gates: [] };
  }
  // ── POI chest dedupe: one real-world place, one chest ─────────────────────
  // Two chests of the same class this close together are the same place, and
  // only the first is kept. Two radii, for two ways OSM hands us the same
  // thing twice:
  //   AREA (pitches, playgrounds, gardens, pools): the MVT poi layer and the
  //   Overpass sidecar both carry the field, but snap on different bases (MVT
  //   label point + placement offset vs the way centroid on the global 5 m
  //   grid), so the one field's two chests land several metres apart — this is
  //   what duplicated the Children's Yard / Tourney Grounds chests.
  //   POINT (crossings, signals, stops, bus stops, bike racks, …): OSM maps ONE
  //   crossing as a node per carriageway and turn lane it crosses — Gordon Dr
  //   at KLO Rd is six highway=crossing nodes inside 8 m — and a bank of bike
  //   lockers as a node per locker 2 m apart. Each node became its own chest,
  //   and at 5 m cells they sat in adjacent cells: "duplicated side by side".
  //   The cell-only occupancy check can never see that.
  // The point radius stays UNDER the ~15 m that separates two genuinely
  // distinct stops (a bus stop on each side of the street), which must both
  // survive. The 4 legs of an intersection (15–25 m apart) are also kept: they
  // are different crossings, and a bigger radius would eat the far stop too.
  const POI_DUP_AREA_M  = 25;
  const POI_DUP_POINT_M = 12;
  const POI_AREA_CLASSES = new Set(['pitch', 'playground', 'garden', 'swimming_pool']);
  function poiDupRadiusM(poiClass) {
    return POI_AREA_CLASSES.has(poiClass) ? POI_DUP_AREA_M : POI_DUP_POINT_M;
  }
  // Does `objects` already hold a chest of ch's class within its radius?
  // Same class only — a signal post beside a crossing is two places.
  //
  // The radii are GENERATION metres (CELL_M per cell). `cellM`, when given,
  // is the frame metres per cell of the tile being built, and the radius is
  // rescaled into that frame — so the verdict is a count of cells, the same
  // in every save whatever its home latitude. Without it the radius is taken
  // as frame metres (headless callers building in a nominal frame).
  function isDupPoiChest(objects, ch, cellM) {
    const r = poiDupRadiusM(ch.poiClass) * (cellM ? cellM / CELL_M : 1);
    const r2 = r * r;
    for (let i = 0; i < objects.length; i++) {
      const o = objects[i];
      if (o.kind !== 'chest' || o.poiClass !== ch.poiClass) continue;
      const dx = o.x - ch.x, dy = o.y - ch.y;
      if (dx * dx + dy * dy <= r2) return true;
    }
    return false;
  }

  // Inverse slippy-map: z14 tile index → lon/lat of its NW corner.
  function tileLon(xt) { return xt / (1 << Z) * 360 - 180; }
  function tileLat(yt) {
    const n = Math.PI - 2 * Math.PI * yt / (1 << Z);
    return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  }
  // OSM tag set → satextract `kind`, for the LIVE Overpass path
  // (overpassToGeoJSON). It only ever sees the tags buildOverpassQL below
  // asks for, so this is exactly that selector list, kind for kind — the
  // static sidecar arrives with its `kind` already set and never comes
  // through here (which is why SX_CHEST_POI knows more kinds
  // than this does). Order matters only where a feature could carry two
  // matching tags (rare).
  function osmKindOf(tags) {
    if (!tags) return null;
    if (tags.natural === 'tree') return 'tree';
    if (tags.natural === 'tree_row') return 'tree_row';
    if (tags.amenity === 'fountain') return 'fountain';
    if (tags.leisure === 'picnic_table') return 'picnic_table';
    if (tags.barrier === 'gate') return 'gate';
    if (tags.amenity === 'bicycle_parking') return 'bicycle_parking';
    if (tags.leisure === 'garden') return 'garden';
    if (tags.man_made === 'tower') return 'tower';
    return null;
  }
  function buildOverpassQL(x, y) {
    const north = tileLat(y), south = tileLat(y + 1);
    const west = tileLon(x), east = tileLon(x + 1);
    const bb = `(${south},${west},${north},${east})`;
    // Query ONLY what OpenFreeMap's MVT layers don't already carry. The MVT
    // `poi` layer already gives bus stops, parking, pitches, playgrounds,
    // pools, bollards (we see them in the tile), so re-fetching them here just
    // bloats a whole-town z14 query and produces dupes. Keep the genuinely
    // additive set: trees (satextract's whole point), fountains, and a little
    // street furniture MVT omits. (No poles, masts or street lamps: they
    // minted only a decorative pillar, cut by the no-decorative-props rule.) (Waterways are intentionally
    // excluded — they're underground / culverted and shouldn't paint water.)
    // Nodes for point features; ways (via `out center`) for tree_row.
    const sels = [
      'node["natural"="tree"]', 'way["natural"="tree_row"]',
      'node["amenity"="fountain"]',
      // (Never historic=memorial: memorials and Stolpersteine are sensitive
      // places that mint nothing — isSensitivePoi.)
      'node["leisure"="picnic_table"]',
      'node["barrier"="gate"]', 'node["amenity"="bicycle_parking"]',
      'node["leisure"="garden"]', 'way["leisure"="garden"]',
      'node["man_made"="tower"]',
    ];
    // `out center;` prints node lat/lon and way centroids, both with tags.
    return `[out:json][timeout:20];(` + sels.map(s => s + bb + ';').join('') + `);out center;`;
  }
  // Overpass JSON elements → satextract-style GeoJSON Point FeatureCollection.
  // Nodes use their own lat/lon; ways use the `center` from `out center`.
  function overpassToGeoJSON(elements) {
    const features = [];
    for (const el of (elements || [])) {
      const kind = osmKindOf(el.tags);
      if (!kind) continue;
      let lon, lat0;
      if (el.type === 'node') { lon = el.lon; lat0 = el.lat; }
      else if (el.center) { lon = el.center.lon; lat0 = el.center.lat; }
      else continue;
      if (lon == null || lat0 == null) continue;
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lon, lat0] },
        properties: { kind, osm_id: el.id, tags: el.tags || {} },
      });
    }
    return { type: 'FeatureCollection', features };
  }
  // Politeness gate: cap how many Overpass queries are in flight at once, so
  // first entry to a fresh region (a few tiles loading together) trickles
  // rather than bursts. Cached/in-flight tiles never reach here.
  const OVERPASS_MAX_CONCURRENT = 2;
  let _overpassActive = 0;
  const _overpassWaiters = [];
  function overpassAcquire() {
    if (_overpassActive < OVERPASS_MAX_CONCURRENT) { _overpassActive++; return Promise.resolve(); }
    return new Promise((res) => _overpassWaiters.push(res));
  }
  function overpassRelease() {
    const next = _overpassWaiters.shift();
    if (next) next(); else _overpassActive--;   // hand the slot straight to a waiter
  }
  // Negative-cache TTLs: after a failed Overpass fetch we store a sentinel in
  // IDB so the next page reload doesn't hammer the server again immediately.
  // 429 (rate-limited) gets a longer backoff than a generic network error.
  const OVERPASS_FAIL_TTL_MS = 5  * 60 * 1000;   // 5 min — transient / load-shed
  const OVERPASS_429_TTL_MS  = 15 * 60 * 1000;   // 15 min — rate limited

  // Per-tile cache + in-flight dedup so a tile is queried at most once.
  //
  // THE CACHE HOLDS FRAME-FREE BINS. A bin row carries its tile-local cell on
  // the tile's own grid (buildBinsFromGeoJSON), so the same cached bin injects
  // the same features in every save. The key was `ovp/…` while bins held
  // frame metres (snapped on the save's START_LAT grid); the `ovp2/` prefix
  // orphans every one of those, so no old-format row is ever read back.
  const OVERPASS_IDB_PREFIX = 'ovp2';
  const _overpassInflight = new Map();
  async function fetchOverpassBin(x, y, lat) {
    const key = `${OVERPASS_IDB_PREFIX}/${Z}/${x}/${y}`;
    const cached = await idbGet(key);
    if (cached) {
      if (cached._failed) {
        if (Date.now() < (cached.until ?? 0)) return null;   // backoff still active
        // else: TTL expired — fall through and retry
      } else {
        return cached;                         // real bin
      }
    }
    if (_overpassInflight.has(key)) return _overpassInflight.get(key);
    const p = (async () => {
      await overpassAcquire();
      try {
        const body = 'data=' + encodeURIComponent(buildOverpassQL(x, y));
        let json = null;
        let got429 = false;
        for (const ep of OVERPASS_ENDPOINTS) {
          // Per-attempt abort timeout: a slow/hung Overpass request must never
          // wedge here, or the status sticks on FETCHING forever AND its
          // concurrency slot (released in the outer finally) is held hostage,
          // jamming every other tile's query behind it.
          const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
          const timer = ctrl ? setTimeout(() => ctrl.abort(), OVERPASS_TIMEOUT_MS) : null;
          try {
            const resp = await fetch(ep, {
              method: 'POST', body,
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              signal: ctrl ? ctrl.signal : undefined,
            });
            if (resp.status === 429) { got429 = true; continue; }
            if (!resp.ok) continue;            // load-shed → next mirror
            const j = await resp.json();
            // A `remark` is Overpass saying the answer is PARTIAL (a runtime
            // timeout or memory cap cut the query short) while still sending
            // 200 and some elements. Caching that "forever" would bake a
            // half-decorated tile into one player's world and not another's.
            // Treat it as a failure: next mirror, else the negative cache.
            if (!j || j.remark) continue;
            json = j;
            break;
          } catch (_) { /* abort/network error → try next endpoint */ }
          finally { if (timer) clearTimeout(timer); }
        }
        if (!json) {
          // Negative-cache so reloads don't immediately retry the same tile.
          const ttl = got429 ? OVERPASS_429_TTL_MS : OVERPASS_FAIL_TTL_MS;
          idbPut(key, { _failed: true, until: Date.now() + ttl });
          ovpNote(x, y, 'failed'); return null;
        }
        const bins = buildBinsFromGeoJSON(overpassToGeoJSON(json.elements), lat);
        // Features near the bbox edge can project into a neighbour tile; we
        // keep only this tile's bin (neighbours fetch their own bbox).
        const bin = bins.get(`${x}_${y}`) || emptyBin();
        // Awaited so warmOverpass's evict-and-rebuild can't race a rebuild's
        // getTileBin against an uncommitted write (the rebuild would miss the
        // bin and come back treeless again). Trees ~static → cached forever.
        await idbPut(key, bin);
        ovpNote(x, y, 'loaded', bin);
        return bin;
      } catch (_) { ovpNote(x, y, 'failed'); return null; }
      finally { overpassRelease(); _overpassInflight.delete(key); }
    })();
    _overpassInflight.set(key, p);
    return p;
  }
  // Single entry point for loadTile: the static sidecar wins where it exists
  // (it carries the richer CV detail). For Overpass we are STRICTLY
  // non-blocking — a remote query must never gate base tile geometry. We only
  // return an Overpass bin that is ALREADY cached locally in IndexedDB; if it
  // isn't cached yet, we kick the fetch (to fill IDB for next time) and return
  // null now, so this load renders the MVT base immediately. Decoration shows
  // up on the next load of the tile (revisit / reset), served from cache.
  async function getTileBin(x, y, lat) {
    const sx = await ensureSatextract(lat);
    const stat = sx && sx.get(`${x}_${y}`);
    if (stat) { ovpNote(x, y, 'static', stat); return stat; }
    if (!overpassLiveEnabled()) return null;
    const key = `${OVERPASS_IDB_PREFIX}/${Z}/${x}/${y}`;
    let cached = null;
    try { cached = await idbGet(key); } catch (_) { cached = null; }   // local, fast, can't hang on the network
    if (cached) {
      if (cached._failed) {
        if (Date.now() < (cached.until ?? 0)) return null;   // within backoff window — don't retry
        // else: TTL expired — fall through and let fetchOverpassBin retry
      } else {
        ovpNote(x, y, 'cache', cached); return cached;
      }
    }
    return null;   // not cached yet; caller must call warmOverpass() to schedule the fetch
  }

  // ── THE LIVE PRIVATE-GROUND VETO (Sep 2026) — per-player things ONLY ──────
  // What the vector tiles cannot say — a fence line, a walled or gated
  // private area — the live Overpass API can. But a live fetch is NETWORK
  // LUCK (one player's lands, another's fails), so it may never decide
  // anything generated (CLAUDE.md: every player sees the SAME world). It is
  // one more REASON on the spawn gate for the things that are per-player
  // already: a coin burst's cells, a bounty pack's seats, anything
  // walkableDestination finds. A failed, pending or missing fetch is NO veto.
  // Cached per tile in IndexedDB under PRIVATE_VETO_IDB_PREFIX as a
  // frame-free cell mask on the tile's own grid (cellsPerEdgeForTile), and
  // re-asked after PRIVATE_VETO_TTL_MS. Fetched beside the tile's Overpass
  // decoration (warmOverpass: the tile the player stands in).
  const PRIVATE_VETO_IDB_PREFIX = 'pvt1';
  const PRIVATE_VETO_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const PRIVATE_BARRIERS = 'fence|wall|hedge|retaining_wall|guard_rail|city_wall';
  const _privateVeto = new Map();          // `${x}_${y}` → Uint8Array (1 = vetoed)
  const _privateVetoInflight = new Map();
  function buildPrivateVetoQL(x, y) {
    const bb = `(${tileLat(y + 1)},${tileLon(x)},${tileLat(y)},${tileLon(x + 1)})`;
    const sels = [
      `way["barrier"~"^(${PRIVATE_BARRIERS})$"]`,
      'way["access"~"^(private|no)$"][!"highway"]',
    ];
    return `[out:json][timeout:20];(` + sels.map((q) => q + bb + ';').join('') + `);out geom;`;
  }
  // Overpass `out geom` ways → the tile's veto mask. A barrier stamps its
  // line; a CLOSED private way stamps its area (and its edge).
  function privateVetoMask(elements, x, y) {
    const N = cellsPerEdgeForTile(y);
    const mask = new Uint8Array(N * N);
    const toMvt = (pt) => {
      const px = lonLatToWorldPx(pt.lon, pt.lat, Z);
      return { x: (px.x / TILE_PX - x) * TILE_EXTENT, y: (px.y / TILE_PX - y) * TILE_EXTENT };
    };
    const mvtToCell = N / TILE_EXTENT;
    const set = (cx, cy) => { if (cx >= 0 && cy >= 0 && cx < N && cy < N) mask[cy * N + cx] = 1; };
    for (const el of elements || []) {
      if (!el || el.type !== 'way' || !Array.isArray(el.geometry) || el.geometry.length < 2) continue;
      const line = el.geometry.filter((g) => g && g.lat != null && g.lon != null).map(toMvt);
      if (line.length < 2) continue;
      forEachLineCell(line, 1, mvtToCell, set);
      const tags = el.tags || {};
      const g0 = el.geometry[0], gz = el.geometry[el.geometry.length - 1];
      const closed = g0.lat === gz.lat && g0.lon === gz.lon;
      if (closed && !tags.barrier && line.length >= 4) {
        const it = forEachPolygonCellSteps(N, N, [line], mvtToCell, set);
        while (!it.next().done) { /* drain: a small polygon, off the frame path */ }
      }
    }
    return mask;
  }
  // The IndexedDB answer already read this session, until its own `until`:
  // the veto is warmed on every 20 m walk check, and each read structured-
  // clones the tile's whole mask. key -> { until, mask }.
  const _privateVetoRead = new Map();
  async function fetchPrivateVeto(x, y) {
    const key = `${PRIVATE_VETO_IDB_PREFIX}/${Z}/${x}/${y}`;
    const k = `${x}_${y}`;
    const memo = _privateVetoRead.get(key);
    if (memo && Date.now() < memo.until) {
      if (memo.mask) _privateVeto.set(k, memo.mask);
      return memo.mask || null;
    }
    const cached = await idbGet(key);
    if (cached && Date.now() < (cached.until ?? 0)) {
      _privateVetoRead.set(key, { until: cached.until, mask: cached.mask || null });
      if (cached.mask) _privateVeto.set(k, cached.mask);
      return cached.mask || null;
    }
    if (_privateVetoInflight.has(key)) return _privateVetoInflight.get(key);
    if (typeof fetch !== 'function') return null;
    const p = (async () => {
      await overpassAcquire();
      try {
        const body = 'data=' + encodeURIComponent(buildPrivateVetoQL(x, y));
        for (const ep of OVERPASS_ENDPOINTS) {
          const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
          const timer = ctrl ? setTimeout(() => ctrl.abort(), OVERPASS_TIMEOUT_MS) : null;
          try {
            const resp = await fetch(ep, { method: 'POST', body,
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              signal: ctrl ? ctrl.signal : undefined });
            if (!resp.ok) continue;
            const j = await resp.json();
            if (!j || j.remark) continue;        // partial answer: no veto from it
            const mask = privateVetoMask(j.elements, x, y);
            _privateVeto.set(k, mask);
            const until = Date.now() + PRIVATE_VETO_TTL_MS;
            _privateVetoRead.set(key, { until, mask });
            await idbPut(key, { mask, until });
            return mask;
          } catch (_) { /* next mirror */ }
          finally { if (timer) clearTimeout(timer); }
        }
        // Failed: no veto, and a short negative cache so a reload does not
        // hammer the server (the decoration's own backoff).
        const until = Date.now() + OVERPASS_FAIL_TTL_MS;
        _privateVetoRead.set(key, { until, mask: null });
        idbPut(key, { mask: null, until });
        return null;
      } finally { overpassRelease(); _privateVetoInflight.delete(key); }
    })();
    _privateVetoInflight.set(key, p);
    return p;
  }
  function warmPrivateVeto(x, y) {
    if (!overpassLiveEnabled()) return Promise.resolve(null);
    return fetchPrivateVeto(x, y).catch(() => null);
  }
  // Is local cell (ix, iy) of tile (tx, ty) fenced or private ground, as far
  // as this player's live fetch knows? Synchronous; unknown is false.
  function privateVetoAt(tx, ty, ix, iy) {
    const m = _privateVeto.get(`${tx}_${ty}`);
    if (!m) return false;
    const N = cellsPerEdgeForTile(ty);
    return ix >= 0 && iy >= 0 && ix < N && iy < N && m[iy * N + ix] === 1;
  }
  // Tests / tools: install or clear a tile's veto mask directly.
  function setPrivateVeto(tx, ty, mask) {
    if (mask) _privateVeto.set(`${tx}_${ty}`, mask); else _privateVeto.delete(`${tx}_${ty}`);
  }
  // Schedule a background Overpass fetch for one tile. Call this only for the
  // tile the player is currently in — not for every neighbour loaded on startup.
  //
  // Returns a promise resolving true iff the bin arrived AFTER the tile had
  // already rasterized without it — in which case the stale entry is evicted
  // from the surface cache so the caller can reload it with the real-world
  // trees/furniture injected. (Evict-and-rebuild is the sanctioned refresh
  // path: per-tile player state lives in save.*, so a rebuild reconstructs
  // the same view — see the LRU-prune comment in loadTile.) Without this, a
  // tile first loaded with a cold Overpass cache — every tile right after a
  // save reset wipes the IDB — stayed treeless until the next full reload.
  function warmOverpass(x, y, lat) {
    if (!overpassLiveEnabled()) return Promise.resolve(false);
    // The live private-ground veto rides the same tile (per-player things only).
    warmPrivateVeto(x, y);
    // A READY tile that was built WITH its bin has nothing left to learn from
    // this: the answer below is false whatever the fetch returns. It is asked
    // on every 20 m walk check, and the fetch's first step structured-clones
    // the whole bin out of IndexedDB — so answer from the entry instead.
    const live = cacheFor(0).get(tileKey(x, y));
    if (live && live.status === 'ready' && live.hadBin) return Promise.resolve(false);
    ovpNote(x, y, 'fetching');
    return fetchOverpassBin(x, y, lat).then(async (bin) => {
      if (!bin) return false;
      const cache = cacheFor(0);
      const key = tileKey(x, y);
      let e = cache.get(key);
      // The bin can beat a slow MVT fetch: if the tile is still mid-build,
      // wait for it to settle before judging whether it missed the bin (its
      // own getTileBin may have picked the bin up already → hadBin true).
      if (e && e.status === 'loading' && e.promise) {
        try { await e.promise; } catch (_) { /* failed build — re-check below */ }
        e = cache.get(key);
      }
      if (e && e.status === 'ready' && !e.hadBin) return rebuildTileWithBin(x, y, lat);
      return false;
    }).catch(() => false);
  }

  // Rebuild a READY surface tile in place so its freshly-arrived Overpass bin
  // (real-world trees / street furniture) shows up this session.
  //
  // This used to be a plain cache.delete() with the caller re-loading: for the
  // whole rebuild the tile had no entry at all, so it rendered as blank grass
  // — and if the rebuild's fetch failed, it STAYED grass. Now the replacement
  // is built alongside the live entry and only swapped in once it is ready; a
  // failed rebuild leaves the original untouched.
  //
  // (The build has no cross-tile dedup to confuse with the live entry any
  // more — ownership is decided per tile from its own data; see loadTile.)
  async function rebuildTileWithBin(x, y, lat) {
    const cache = cacheFor(0);
    const key = tileKey(x, y);
    const prev = cache.get(key);
    if (!prev || prev.status !== 'ready') return false;
    let fresh = null;
    try {
      fresh = await loadTile(x, y, lat, { detached: true });
      await fresh.promise;
    } catch (_) {
      fresh = null;                      // rebuild failed — the original stands
    }
    if (!fresh || fresh.status !== 'ready') return false;
    // Carry over live per-session state the rebuild can't reconstruct.
    if (prev.creatures && !fresh.creatures) fresh.creatures = prev.creatures;
    if (prev.coinDrops && !fresh.coinDrops) fresh.coinDrops = prev.coinDrops;
    // A goblin trapper's snares (traps.js LAID traps) — session state on
    // their own list, carried like the coins: a trap that just bit you must
    // not blink out because the Overpass bin landed.
    if (prev.laidTraps && !fresh.laidTraps) fresh.laidTraps = prev.laidTraps;
    cache.set(key, fresh);               // atomic swap — never a missing tile
    return true;
  }

  // --- Underground cave generation (depth > 0) ---------------------------
  // A cave tile is the "negative" of the tile one level ABOVE it: walkable
  // surface cells become CAVE_FLOOR, everything else becomes CAVE_WALL. This
  // recurses up to the surface (depth 0), so depth N derives from depth N-1.
  //
  // Staircases connect the levels. The level above's DOWN-stairs become this
  // level's UP-stairs at the same world point (so you arrive standing on the
  // way back up), and each gets a matching DOWN-stair a few cells away on
  // floor, letting you keep descending. Same-coordinate (GPS-mirror) model:
  // a staircase's x/y never changes between levels.

  // A staircase's id: direction, level, and its TILE + LOCAL CELL — never its
  // frame metres (Math.round of an x/y moved with the save's home latitude).
  // An up-stair sits on the cell of the down-stair it mirrors, so the pair
  // share every field but `dir` and the depth.
  function caveStairId(dir, depth, tx, ty, lix, liy) {
    return cellId(`stair_${dir}_${depth}`, tx, ty, lix, liy);
  }

  // World-meter centre of local cell (lix,liy) on tile (tx,ty).
  function cellCentreM(tx, ty, lix, liy, tileEdgeM, N) {
    const mPerCell = tileEdgeM / N;
    return { x: tx * tileEdgeM + (lix + 0.5) * mPerCell,
             y: ty * tileEdgeM + (liy + 0.5) * mPerCell };
  }
  // Local cell index a world point falls in, on tile (tx,ty).
  function cellIndexOf(tx, ty, wx, wy, tileEdgeM, N) {
    const mPerCell = tileEdgeM / N;
    return { lix: Math.floor((wx - tx * tileEdgeM) / mPerCell),
             liy: Math.floor((wy - ty * tileEdgeM) / mPerCell) };
  }

  // Uniformly random CAVE_FLOOR cell on the tile, excluding `skipIdx` (so a
  // down-stair never lands on the up-stair it descends from). Deterministic via
  // the supplied rng. Returns its world centre, or null if there's no floor.
  function randomFloorCell(grid, N, tx, ty, tileEdgeM, rng, skipIdx) {
    const floors = [];
    for (let i = 0; i < grid.length; i++) {
      if (grid[i] === T.CAVE_FLOOR && i !== skipIdx) floors.push(i);
    }
    if (!floors.length) return null;
    const idx = floors[Math.floor(rng() * floors.length)];
    const lix = idx % N, liy = Math.floor(idx / N);
    return { ...cellCentreM(tx, ty, lix, liy, tileEdgeM, N), lix, liy };
  }

  // Surface entrances: ~30 % of residential rock clusters get a down-staircase
  // beside them (so caves are common in town), and every tile is guaranteed at
  // least one entrance — anchored to a cave rock where one exists, otherwise on
  // a random walkable cell.
  //
  // `stableObjects` — the rasterizer's own object list — is what occupancy
  // (objCells/nearChest) is judged against, NOT whatever entry.objects holds
  // by the time anything else has touched it. A tile can be REBUILT under you
  // (see CLAUDE.md) once its Overpass bin arrives, and once a player has
  // descended, loadCaveTile has already baked this tile's staircase into a
  // cached cave level (its 'up' stair is minted on that exact cell) — if the
  // occupancy check that placed it read anything but this tile's own MVT
  // bytes, a rebuild could move the staircase and orphan that cached level.
  // (There is no cross-tile dedup any more — ownership is decided from the
  // data — so this list is exactly the tile's generated objects.) Falls back
  // to entry.objects when no separate list is given (fixtures/tests that
  // build a synthetic entry). `stableWildplants` is the rasterizer's
  // separate, already-filtered wildplant list; loadTile passes it before
  // assigning entry.wildplants so those cells are occupied too.
  // How far (cells, Chebyshev) a mine mouth may walk off its rock to find
  // OPEN ground (the spawn gate) before its cluster goes without one.
  const CAVE_MOUTH_RELOCATE_CELLS = 6;
  // The pass itself is a steps generator (loadTile drives it sliced — its
  // random-cell guarantee judges every cell of the tile); this runs it
  // straight through, for the tests and any caller that cannot await.
  function maybePlaceCaveEntrance(entry, tx, ty, tileEdgeM, stableObjects, stableWildplants) {
    return runSteps(maybePlaceCaveEntranceSteps(entry, tx, ty, tileEdgeM, stableObjects, stableWildplants));
  }
  function* maybePlaceCaveEntranceSteps(entry, tx, ty, tileEdgeM, stableObjects, stableWildplants) {
    const source = (entry.zone && entry.zone.caveSource) || entry.caveSource;
    const occupancySource = source ? source.objects : (stableObjects || entry.objects || []);
    const wildplantSource = source ? source.wildplants : (stableWildplants || entry.wildplants || []);
    const caveRocks = (source ? source.objects : (entry.objects || [])).filter(
      o => o.kind === 'mineralrock' && o.caveVariant != null);
    const N = entry.cellsPerEdge, grid = source ? source.grid : entry.grid;
    // See roadMask in rasterizeTile / entry.roadMask above: the terrain grid
    // under-reports the road (one cell wide however wide the carriageway
    // really is, and a parking lot's aisles paint no cell at all), so a
    // staircase gate that only reads grid[] can seat a descend ladder in the
    // middle of a motorway's band or a parking lot the grid still calls
    // landuse. stairCellOK below must consult it, same as every other spawner.
    const roadMask = entry.roadMask;
    const rng = makeRng(tileStreamSeed(tx, ty));
    const used = new Set();

    // Keep surface entrances spread out: reject a candidate cell that sits
    // within MIN_STAIR_SPACING_M of an already-placed entrance, so dense
    // residential clusters don't bunch a row of mine mouths together. Measured
    // in cells (Chebyshev distance) off the per-tile resolution.
    const MIN_STAIR_SPACING_M = 100;
    const minStairCells = Math.max(1, Math.round(MIN_STAIR_SPACING_M / CELL_M));
    const placedCells = [];
    const tooClose = (lix, liy) => placedCells.some(
      ([plix, pliy]) => Math.max(Math.abs(plix - lix), Math.abs(pliy - liy)) < minStairCells);
    const markPlaced = (lix, liy) => placedCells.push([lix, liy]);

    // This pass runs AFTER every spawn cull, so it must enforce the same
    // placement rules itself or its ladders land where nothing else may:
    //   • never on a cell an interactable already occupies (one per cell)
    //   • never within the one-cell building moat (the house/tower sprite
    //     overhangs its footprint — "interactable in the house boundary")
    //   • never on or beside a POI chest / its concrete plaza pad
    const objCells = new Set();
    const chestCells = [];
    let _oi = 0;
    for (const o of occupancySource) {
      if (((_oi++) & 1023) === 1023) yield 'cave entrance occupancy';
      const { lix, liy } = cellIndexOf(tx, ty, o.x, o.y, tileEdgeM, N);
      if (lix < 0 || liy < 0 || lix >= N || liy >= N) continue;
      objCells.add(liy * N + lix);
      if (o.kind === 'chest') chestCells.push({ ix: lix, iy: liy });
    }
    for (const wp of wildplantSource) {
      if (((_oi++) & 1023) === 1023) yield 'cave entrance occupancy';
      const { lix, liy } = cellIndexOf(tx, ty, wp.x, wp.y, tileEdgeM, N);
      if (lix < 0 || liy < 0 || lix >= N || liy >= N) continue;
      objCells.add(liy * N + lix);
    }
    const pads = entry.poiPadCells;
    // Authored quarry shafts are already in the generated surface layer.
    // Their cells must remain reserved even when legacy cave identities read
    // the older pre-dressing source above.
    for (const stair of stableObjects || entry.objects || []) {
      if (stair.kind !== 'staircase' || stair.zoneLayer !== 'entrance' || stair.dir !== 'down') continue;
      const { lix, liy } = cellIndexOf(tx, ty, stair.x, stair.y, tileEdgeM, N);
      used.add(liy * N + lix); objCells.add(liy * N + lix); markPlaced(lix, liy);
    }
    // THE SPAWN GATE: a mine mouth is a 'cave' spawn (the stairs down — the
    // owner's "ladders"): off the road band (see above), every hard reason
    // (quiet / restricted land, a back yard, a field's interior) and
    // SENSITIVE ground — the cave row's one typed reason (the kerb does not
    // refuse a mouth; a field's edge is open ground).
    const stairOpts = { roadMask, quiet: entry.quietMask, spawnWhy: entry.spawnWhy, roadClass: entry.roadClass };
    // Surface zones can reopen inferred lot ground; existing mine identities
    // still use the mask saved alongside their original terrain and objects.
    if (source && source.spawnWhy) stairOpts.spawnWhy = source.spawnWhy;
    // The mouth's own rules (everything but the gate's reasons)…
    const stairSiteOK = (lix, liy, idx) =>
      !used.has(idx) && !tooClose(lix, liy)
      && !objCells.has(idx) && !(pads && pads.has(idx))
      && !nearBuildingCell(grid, N, N, lix, liy) && !nearPoiCell(chestCells, lix, liy);
    const stairCellOK = (lix, liy, idx) => stairSiteOK(lix, liy, idx)
      && isSpawnCell(grid, N, N, lix, liy, stairOpts, 'cave');
    // …and would the mouth have stood here but for the gate's reasons (the
    // plain spawn rule with no mask)? Only a mouth the GATE displaced walks.
    const gateOnlyRefused = (lix, liy, idx) => stairSiteOK(lix, liy, idx)
      && isSpawnCell(grid, N, N, lix, liy, { roadMask }, 'minor')
      && !isSpawnCell(grid, N, N, lix, liy, stairOpts, 'cave');

    // Drop a down-staircase on the first walkable cell touching `rock`. Returns
    // true on success; de-dupes so two clusters can't stack stairs on one cell,
    // and skips cells too near an entrance already placed on this tile.
    // DISPLACED, NOT LOST: when no cell touching the rock is OPEN ground, the
    // mouth walks outward from it, ring by ring (fixed order, no draws) to
    // CAVE_MOUTH_RELOCATE_CELLS — the same cluster's mine, a few steps on.
    const placeBeside = (rock) => {
      const { lix: rlix, liy: rliy } = cellIndexOf(tx, ty, rock.x, rock.y, tileEdgeM, N);
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
      // The walk outward is only for a mouth the GATE displaced: one whose
      // own ring held a cell the mask alone refused. A rock whose ring was
      // never usable (walls, the moat, neighbours) has no mouth, as always —
      // the walk must not ADD mouths the world never had.
      let displaced = false;
      for (const [dx, dy] of dirs) {
        const lix = rlix + dx, liy = rliy + dy;
        if (lix >= 0 && liy >= 0 && lix < N && liy < N && gateOnlyRefused(lix, liy, liy * N + lix)) { displaced = true; break; }
      }
      if (displaced) {
        for (let r = 2; r <= CAVE_MOUTH_RELOCATE_CELLS; r++) {
          for (let d = -r; d <= r; d++) dirs.push([d, -r], [r, d], [-d, r], [-r, -d]);
        }
      }
      for (const [dx, dy] of dirs) {
        const lix = rlix + dx, liy = rliy + dy;
        if (lix < 0 || liy < 0 || lix >= N || liy >= N) continue;
        const idx = liy * N + lix;
        if (!stairCellOK(lix, liy, idx)) continue;
        used.add(idx);
        markPlaced(lix, liy);
        const { x, y } = cellCentreM(tx, ty, lix, liy, tileEdgeM, N);
        entry.objects.push(makeObject('staircase', x, y, caveStairId('down', 0, tx, ty, lix, liy),
          { dir: 'down', depth: 0 }));
        return true;
      }
      return false;
    };

    // Drop a down-staircase on a random walkable cell (used when the tile has
    // no cave rock to anchor to). Returns true on success.
    // The whole-tile scan yields every row block: stairCellOK over every cell
    // was one ~17 ms stretch after the last rasterize yield.
    const placeRandomWalkable = function* () {
      const cells = [];
      for (let i = 0; i < grid.length; i++) {
        if ((i & 2047) === 2047) yield 'cave entrance random cell';
        if (stairCellOK(i % N, Math.floor(i / N), i)) {
          cells.push(i);
        }
      }
      if (!cells.length) return false;
      const idx = cells[Math.floor(rng() * cells.length)];
      used.add(idx);
      markPlaced(idx % N, Math.floor(idx / N));
      const { x, y } = cellCentreM(tx, ty, idx % N, Math.floor(idx / N), tileEdgeM, N);
      entry.objects.push(makeObject('staircase', x, y,
        caveStairId('down', 0, tx, ty, idx % N, Math.floor(idx / N)),
        { dir: 'down', depth: 0 }));
      return true;
    };

    // Group cave rocks by their residential cluster id. Non-residential rocks
    // (industrial / ROCK terrain) carry no cluster id and fall through to the
    // per-tile guarantee below.
    yield 'cave entrance sites';
    const byCluster = new Map();
    for (const r of caveRocks) {
      if (!r._clusterId) continue;
      let g = byCluster.get(r._clusterId);
      if (!g) byCluster.set(r._clusterId, g = []);
      g.push(r);
    }

    let placed = 0;
    for (const rocks of byCluster.values()) {
      if (rng() < 0.30 && placeBeside(rocks[Math.floor(rng() * rocks.length)])) {
        placed++;
      }
    }

    // Guarantee at least one cave per tile: beside a random cave rock if the
    // tile has any, otherwise on a random walkable cell.
    // (A rock whose ground the spawn gate refuses all round — a yard's rubble
    // behind a house — hands the guarantee on to a random OPEN
    // cell, deterministically, rather than leave the tile without a way down.)
    if (placed === 0) {
      if (!(caveRocks.length && placeBeside(caveRocks[Math.floor(rng() * caveRocks.length)]))) yield* placeRandomWalkable();
    }
  }

  // ── Cave chests: every surface POI chest is mirrored down the levels ────
  // Same-coordinate (GPS-mirror) model, like the staircases: the chest sits at
  // the POI's own world point on every level below it, so the town underground
  // still reads as the town overhead — and every POI pays out again on every
  // level. A level derives its chests from the level ABOVE (the surface for
  // depth 1, depth 1 for depth 2, …), so a chest that had to step off a wall
  // cell keeps that seat all the way down.
  //   • Only POI chests (o.poiClass) mirror, and not the lowtier street
  //     furniture (loot.js chestMirrorsUnderground — the exclusion lives
  //     there, beside the tier table). Starter crates / fixed-loot chests
  //     are surface-only too.
  //   • A POI under a building or road is a CAVE_WALL cell down here; the
  //     chest steps to the nearest floor cell within CAVE_CHEST_SEEK_CELLS
  //     (nearest ring first, deterministic order), or is dropped if none.
  //   • Each level's copy is its OWN chest (id `<surface id>_d<depth>`), so
  //     save.opened records it apart from the one overhead; `caveOf` carries
  //     the surface id down the recursion.
  //   • `depth` is stamped on the copy: loot.js chestTier raises the tier by
  //     one per CHEST_TIER_DEPTH_STEP levels (cap CHEST_TIER_MAX), and the
  //     produce-stand / coin-burst POI paths stand down underground (a bike
  //     rack two floors under the street is just a chest).
  // `occupied` (cell index set) is read AND extended so a rock cluster never
  // lands on a chest, and a chest never lands on a stair.
  const CAVE_CHEST_SEEK_CELLS = 3;
  // Nearest free CAVE_FLOOR cell to local cell (lix, liy), nearest ring first
  // in a deterministic order, within CAVE_CHEST_SEEK_CELLS — or null. Shared
  // by the mirrored chests and the torches so both step off a wall the same
  // way.
  function seekFloorSeat(grid, N, lix, liy, occupied) {
    return ringCells(lix, liy, 0, CAVE_CHEST_SEEK_CELLS, (cx, cy) => {
      if (cx < 0 || cx >= N || cy < 0 || cy >= N) return null;
      const idx = cy * N + cx;
      return (grid[idx] !== T.CAVE_FLOOR || occupied.has(idx)) ? null : { idx, cx, cy };
    });
  }
  function caveChestsFrom(aboveObjects, grid, N, tx, ty, tileEdgeM, depth, occupied) {
    const out = [];
    // A cave copy's DENSITY is its surface chest's, counted HERE off the
    // generated surface objects (never the live entry — a bin's chests are
    // on it only when the bin happened to be cached), and carried down the
    // levels unchanged. It sets no tier (each level seeds its own pyramid
    // over the RANK below) and a cave copy never restocks; it rides along
    // as the surface chest's record.
    const counts = poiDensityCounts(aboveObjects);
    for (const o of aboveObjects || []) {
      if (o.kind !== 'chest' || !o.poiClass || o.crate || o.fixedLoot) continue;
      if (typeof chestMirrorsUnderground === 'function' && !chestMirrorsUnderground(o.poiClass)) continue;
      const { lix, liy } = cellIndexOf(tx, ty, o.x, o.y, tileEdgeM, N);
      if (lix < 0 || lix >= N || liy < 0 || liy >= N) continue;
      const seat = seekFloorSeat(grid, N, lix, liy, occupied);
      if (!seat) continue;
      occupied.add(seat.idx);
      const surfaceId = o.caveOf || o.id;
      const onSpot = seat.cx === lix && seat.cy === liy;
      const { x: cx, y: cy } = onSpot ? { x: o.x, y: o.y }
        : cellCentreM(tx, ty, seat.cx, seat.cy, tileEdgeM, N);
      const poiDensity = (o.depth > 0 || o.caveOf) ? o.poiDensity : counts.get(o.poiClass);
      out.push({ kind: 'chest', x: cx, y: cy, id: `${surfaceId}_d${depth}`,
        caveOf: surfaceId, poiClass: o.poiClass, name: o.name || '', depth, poiDensity,
        // The RANK rides down (each level's pyramid picks its best the same
        // way the surface did); the surface's tierSeed does not - every level
        // seeds its own pyramid, the depth bonus landing on top of it.
        rank: o.rank });
    }
    return out;
  }

  // Each tile/level keeps at most fifty mirrors of its lowest displayed
  // tier. Higher tiers survive intact; when depth folds every seed into the
  // same displayed tier, that shared tier is capped too. Keep the best POIs
  // using the quota's rank/id ordering, independent of input/load order.
  const CAVE_LOWEST_TIER_CHEST_LIMIT = 50;
  function capCaveChests(objects, N, tx, ty, tileEdgeM, occupied) {
    const mirrors = objects.filter(o => o.kind === 'chest' && o.caveOf && o.depth > 0 && !o.crate && !o.fixedLoot);
    let lowest = Infinity;
    for (const o of mirrors) lowest = Math.min(lowest, chestTier(o));
    const lowestChests = mirrors.filter(o => chestTier(o) === lowest);
    if (lowestChests.length <= CAVE_LOWEST_TIER_CHEST_LIMIT) return 0;
    lowestChests.sort((a, b) => ((a.rank ?? 999) - (b.rank ?? 999)) || String(a.id).localeCompare(String(b.id)));
    const dropped = new Set(lowestChests.slice(CAVE_LOWEST_TIER_CHEST_LIMIT));
    let kept = 0;
    for (const o of objects) {
      if (!dropped.has(o)) { objects[kept++] = o; continue; }
      const { lix, liy } = cellIndexOf(tx, ty, o.x, o.y, tileEdgeM, N);
      occupied.delete(liy * N + lix);
    }
    objects.length = kept;
    return dropped.size;
  }

  // ── Cave torches: where the lowtier POIs overhead WOULD have been ───────
  // The lowtier street furniture (bus stops, crossings, bins…) is the one POI
  // class that does not mirror underground (loot.js chestMirrorsUnderground),
  // so the cave under a town has no trace of most of its street. A torch at
  // a random subset of those points gives it back as LIGHT: the level reads
  // as the town's shape in the dark, and a torch is a landmark rather than a
  // T1 box every few cells.
  //   • Sites come from the surface: `caveTorchSites(above)` reads the lowtier
  //     chests out of the surface tile's objects, and every cave level carries
  //     the full site list down as `entry.torchSites` (the chests themselves
  //     are not there to re-read, and a torch on level N-1 says nothing about
  //     level N: each level rolls its OWN subset, seeded per tile+depth, so
  //     the descent finds different corners lit).
  //   • CAVE_TORCH_P of the sites light on a given level. A site under a wall
  //     steps to the nearest floor cell the way a chest does (seekFloorSeat)
  //     or is dropped for that level.
  //   • Decorative: `torch` has no interaction; its light is
  //     Lighting.KINDS.torch and its art the `torch` render spec.
  const CAVE_TORCH_P = 0.6;
  function caveTorchSites(above) {
    if (above.torchSites) return above.torchSites;
    const sites = [];
    if (typeof chestMirrorsUnderground !== 'function') return sites;
    // The GENERATED chests only (genObjects — see loadTile): a sidecar chest
    // is on the live entry only when its bin happened to be cached at build.
    for (const o of above.genObjects || above.objects || []) {
      if (o.kind !== 'chest' || !o.poiClass || o.crate || o.fixedLoot) continue;
      if (chestMirrorsUnderground(o.poiClass)) continue;
      sites.push({ x: o.x, y: o.y, id: o.id });
    }
    return sites;
  }
  function caveTorchesFrom(sites, grid, N, tx, ty, tileEdgeM, depth, occupied) {
    const out = [];
    const rng = makeRng(tileStreamSeed(tx, ty, 0xC2B2AE35, depth));
    for (const s of sites || []) {
      const lit = rng() < CAVE_TORCH_P;     // roll for every site, so the sequence is stable
      if (!lit) continue;
      const { lix, liy } = cellIndexOf(tx, ty, s.x, s.y, tileEdgeM, N);
      if (lix < 0 || lix >= N || liy < 0 || liy >= N) continue;
      const seat = seekFloorSeat(grid, N, lix, liy, occupied);
      if (!seat) continue;
      occupied.add(seat.idx);
      const onSpot = seat.cx === lix && seat.cy === liy;
      const { x: cx, y: cy } = onSpot ? { x: s.x, y: s.y }
        : cellCentreM(tx, ty, seat.cx, seat.cy, tileEdgeM, N);
      out.push({ kind: 'torch', x: cx, y: cy, id: `torch_${s.id}_d${depth}`, site: s.id, depth });
    }
    return out;
  }

  // Fairy rings: some mirrored chests sit in a clearing ringed by the blue
  // cave mushrooms — a chest you can find from across the dark by its glow.
  // The ring is the cells whose distance from the chest rounds to
  // CAVE_RING_R (a round loop of 12 at radius 2); the clearing inside it and
  // the ring itself are swept (in place) of the rocks spawnCaveRocks laid, so the
  // loop is never broken by a boulder. Taking rocks OUT keeps every other
  // rock's roll intact (see the note above) and is as positional as laying
  // them: the same chest clears the same cells on every build. A stair, a
  // torch or another chest on a ring cell is left alone and leaves a gap.
  // Mushrooms are forage, not walls — the chest is still walked up to.
  const CAVE_RING_P = 0.3, CAVE_RING_R = 2;
  const CAVE_RING_CELLS = [], CAVE_RING_INSIDE = [];
  for (let dy = -CAVE_RING_R; dy <= CAVE_RING_R; dy++) {
    for (let dx = -CAVE_RING_R; dx <= CAVE_RING_R; dx++) {
      const d = Math.round(Math.hypot(dx, dy));
      if (d === CAVE_RING_R) CAVE_RING_CELLS.push([dx, dy]);
      else if (d < CAVE_RING_R && (dx || dy)) CAVE_RING_INSIDE.push([dx, dy]);
    }
  }
  function caveChestRings(objects, grid, N, tx, ty, tileEdgeM, depth, wildplants, occupied) {
    const rng = makeRng(tileStreamSeed(tx, ty, 0xD3A2646D, depth));
    const cellOf = (o) => cellIndexOf(tx, ty, o.x, o.y, tileEdgeM, N);
    const wpCells = new Set();
    for (const w of wildplants) {
      const { lix, liy } = cellOf(w);
      wpCells.add(liy * N + lix);
    }
    const sweep = new Set();       // rock cells to clear
    const rings = [];
    for (const o of objects) {
      if (o.kind !== 'chest') continue;
      if (rng() >= CAVE_RING_P) continue;     // one roll per chest, in object order
      const { lix, liy } = cellOf(o);
      rings.push({ lix, liy });
      for (const [dx, dy] of CAVE_RING_CELLS.concat(CAVE_RING_INSIDE)) {
        const cx = lix + dx, cy = liy + dy;
        if (cx >= 0 && cy >= 0 && cx < N && cy < N) sweep.add(cy * N + cx);
      }
    }
    if (!rings.length) return;
    let w = 0;                     // compact in place — the caller's array stays the level's
    for (const o of objects) {
      if (o.kind === 'mineralrock') {
        const { lix, liy } = cellOf(o);
        const idx = liy * N + lix;
        if (sweep.has(idx)) { occupied.delete(idx); continue; }
      }
      objects[w++] = o;
    }
    objects.length = w;
    for (const { lix, liy } of rings) {
      for (const [dx, dy] of CAVE_RING_CELLS) {
        const cx = lix + dx, cy = liy + dy;
        if (cx < 0 || cy < 0 || cx >= N || cy >= N) continue;
        const idx = cy * N + cx;
        if (grid[idx] !== T.CAVE_FLOOR || occupied.has(idx) || wpCells.has(idx)) continue;
        occupied.add(idx);
        wpCells.add(idx);
        const { x: wx, y: wy } = cellCentreM(tx, ty, cx, cy, tileEdgeM, N);
        wildplants.push(makeWildplant('mushroom', wx, wy,
          cellId(`cwr_${depth}`, tx, ty, cx, cy), { _ix: cx, _iy: cy, _cave: true }));
      }
    }
  }

  // ── THE CAVE FLOOR PASSES (CAVE_PASSES) ─────────────────────────────────
  // What a level's floor gets after the mirrored chests and torches have
  // claimed their cells: ONE table, in the order the passes RUN, each row off
  // its OWN stream (tileStreamSeed(tx, ty, salt, depth)) and each run after
  // the one before it, because a pass skips its remaining draws on an occupied
  // cell — claiming a cell ahead of an earlier pass would re-roll every piece
  // downstream of it, and every cave already walked would rearrange itself.
  // Laid in table order, a later pass only ever takes what is left. A row
  // walks the floor one of two ways (runCavePass):
  //   PIVOTS — `pivot` / `from`: a candidate every `pivot` cells, FIRED with
  //     chance `fire(level)` (one draw), then either a `cluster(rng, px, py)`
  //     (the pieces of one clump — EVERY draw taken before any cell is looked
  //     at: "roll, then sweep", so what is already seated only REMOVES the
  //     pieces that would stand on it and never shifts the stream) or
  //     `tries` picks of `pick(rng, px, py)` until one seats;
  //   TRIES — `count(rng)` pieces, each `tries` picks of `pick(rng)` until
  //     one seats.
  // A pick SEATS when it is a free CAVE_FLOOR cell inside the grid that passes
  // the row's `ok`; `emit(level, piece, centre)` lays it. `when(level)` skips
  // a row (the first level's torches and barrels; X marks in test mode, where
  // the treasure tap would steal a test's tap); `pre(level)` lays its unseeded
  // pieces first (a torch at the foot of every up-ladder); `setup(level)` is
  // a row's per-level state (the rocks' ore table); `run(level)` is a row
  // that is no scatter at all (the fairy rings, which only clear and ring).
  // traps.js's cave snares ride the same driver with their own stream.
  // The rows themselves:
  //   rocks — mineralrock clusters (caves would otherwise be bare rock-and-
  //     staircase shells). Each rock rolls plain-vs-ore via caveRockP, so
  //     plain stone is always the majority and ore grows with depth; some
  //     clusters are VEIN ZONES (one tier concentrated VEIN_MUL× — the same
  //     rollVeinTable the residential clusters use) and each rock is the same
  //     rollRock. 3..5 rocks within ±1 cell of a pivot every 6 cells.
  //   mushrooms — sparse clumps of the `mushroom` wildplant, stamped `_cave`
  //     (blue luminous caps, Lighting.KINDS.mushroom): a patch reads from a
  //     few cells off in the dark. Levels 1 and 4 are the forage-heavy ones
  //     and fire twice as often; ids carry the depth so save.picked keeps
  //     levels apart.
  //   rings — caveChestRings (below): fairy rings round some mirrored chests.
  //   wallTorches — a landmark light every so often whatever is overhead: the
  //     same `torch` kind as the street-furniture torches, seated on a floor
  //     cell with rock beside it so it reads as a sconce, not a stake.
  //   coins — loose gold spread over the level, GENERATED where it lies;
  //     `seeded` tells the coin tap to write the id into save.foundTreasures.
  //     app.js folds them into entry.coinDrops.
  //   treasureMarks — X marks underground: the surface scatter's cousin, dug
  //     with the same tap into the same save.foundTreasures (the id carries
  //     the depth). Never under an object: an X beneath a rock can't be dug.
  //   floorTorches — the Torch consumable lying on level 1's floor as a
  //     `torch` wildplant (CROP_SPRITE.torch, the wildplant tap, save.picked):
  //     one at the foot of every up-ladder (where a descent lands, the first
  //     thing the dark hands a new player is the way to push it back) plus a
  //     few dozen more. NOT the wall `torch` object, a fixed light.
  //   barrels — level 1's generated barrels, smashed like a surface bin
  //     (loot.js isBarrel — `barrel: true`, no POI behind it; the stable
  //     appearance selects the loot table, barrelProfile; back daily on the
  //     one day ledger).
  const CAVE_SCONCE_PIVOT = 18, CAVE_SCONCE_P = 0.45, CAVE_SCONCE_TRIES = 10;
  const CAVE_COIN_PIVOT = 12, CAVE_COIN_P = 0.35;
  const CAVE_X_MIN = 4, CAVE_X_SPAN = 7, CAVE_X_TRIES = 8;
  const FLOOR_TORCH_DEPTH = 1;
  const FLOOR_TORCH_MIN = 24, FLOOR_TORCH_SPAN = 13, FLOOR_TORCH_TRIES = 8;
  const CAVE_BARREL_DEPTH = 1;
  const CAVE_BARREL_MIN = 12, CAVE_BARREL_SPAN = 8, CAVE_BARREL_TRIES = 8;
  // A uniformly random cell of the level (the TRIES rows' pick).
  const anyCell = (rng, px, py, L) => ({ lix: Math.floor(rng() * L.N), liy: Math.floor(rng() * L.N) });
  // A cell within ±R of a pivot (the clusters' seat): two draws.
  const jitter = (rng, px, py, R) => ({ lix: px + Math.round((rng() - 0.5) * 2 * R), liy: py + Math.round((rng() - 0.5) * 2 * R) });
  const CAVE_PASSES = [
    { id: 'rocks', salt: 0x85EBCA6B, pivot: 6, from: 1, fire: () => 0.85,
      // The level's own ore — tier `depth` and the tier below (caveOreWeights).
      setup: (L) => { const weights = caveOreWeights(L.depth); return { plainP: caveRockP(L.depth), weights, baseTbl: cumWeights(weights) }; },
      cluster: (rng, px, py, L, st) => {
        const n = 3 + Math.floor(rng() * 3);               // 3..5 rocks
        const tbl = rollVeinTable(rng, st.weights, 0.30, st.baseTbl);   // ~30 % of clusters a vein zone
        const out = [];
        for (let k = 0; k < n; k++) {
          const c = jitter(rng, px, py, 1);
          c.roll = rollRock(rng, st.plainP, tbl);
          out.push(c);
        }
        return out;
      },
      emit: (L, c, p) => {
        const id = cellId(`cmr_${L.depth}`, L.tx, L.ty, c.lix, c.liy);
        L.objects.push(makeObject('mineralrock', p.x, p.y, id, c.roll.plain
          ? { requiredTier: 1, caveVariant: c.roll.caveVariant }
          : { yieldTier: c.roll.yieldTier, requiredTier: c.roll.requiredTier }));
      } },
    { id: 'mushrooms', salt: 0x27D4EB2F, pivot: 8, from: 1,
      fire: (L) => (L.depth === 1 || L.depth === 4) ? 0.5 : 0.25,
      cluster: (rng, px, py) => {
        const n = 1 + Math.floor(rng() * 3), out = [];
        for (let k = 0; k < n; k++) out.push(jitter(rng, px, py, 1));
        return out;
      },
      emit: (L, c, p) => L.wildplants.push(makeWildplant('mushroom', p.x, p.y,
        cellId(`cwp_${L.depth}`, L.tx, L.ty, c.lix, c.liy), { _ix: c.lix, _iy: c.liy, _cave: true })) },
    { id: 'rings', run: (L) => caveChestRings(L.objects, L.grid, L.N, L.tx, L.ty, L.tileEdgeM, L.depth, L.wildplants, L.occupied) },
    { id: 'wallTorches', salt: 0x165667B1, pivot: CAVE_SCONCE_PIVOT, from: 0, fire: () => CAVE_SCONCE_P, tries: CAVE_SCONCE_TRIES,
      pick: (rng, px, py) => ({ lix: px + Math.floor(rng() * CAVE_SCONCE_PIVOT), liy: py + Math.floor(rng() * CAVE_SCONCE_PIVOT) }),
      ok: (L, lix, liy) => {
        const { grid, N } = L;
        return (lix > 0 && grid[liy * N + lix - 1] === T.CAVE_WALL) ||
          (lix < N - 1 && grid[liy * N + lix + 1] === T.CAVE_WALL) ||
          (liy > 0 && grid[(liy - 1) * N + lix] === T.CAVE_WALL) ||
          (liy < N - 1 && grid[(liy + 1) * N + lix] === T.CAVE_WALL);
      },
      emit: (L, c, p) => L.objects.push({ kind: 'torch', x: p.x, y: p.y, id: cellId(`torch_w_${L.depth}`, L.tx, L.ty, c.lix, c.liy), depth: L.depth }) },
    { id: 'coins', salt: 0xFD7046C5, pivot: CAVE_COIN_PIVOT, from: 0, tries: 1,
      // Fire, x and y are drawn for every pivot, fired or not, so the
      // sequence is stable.
      pick: (rng, px, py) => {
        const fire = rng() < CAVE_COIN_P;
        const lix = px + Math.floor(rng() * CAVE_COIN_PIVOT), liy = py + Math.floor(rng() * CAVE_COIN_PIVOT);
        return fire ? { lix, liy } : null;
      },
      emit: (L, c, p) => L.coins.push({ kind: 'coindrop', x: p.x, y: p.y, id: cellId(`ccoin_${L.depth}`, L.tx, L.ty, c.lix, c.liy), seeded: true }) },
    { id: 'treasureMarks', salt: 0xB55A4F09,
      when: () => !(typeof window !== 'undefined' && window.__TEST_MODE),
      count: (rng) => CAVE_X_MIN + Math.floor(rng() * CAVE_X_SPAN), tries: CAVE_X_TRIES, pick: anyCell,
      emit: (L, c, p) => L.treasures.push({ x: p.x, y: p.y, id: cellId(`treasure_c${L.depth}`, L.tx, L.ty, c.lix, c.liy) }) },
    { id: 'floorTorches', salt: 0x5BD1E995, when: (L) => L.depth === FLOOR_TORCH_DEPTH,
      // One at the foot of every up-ladder first, seated on the nearest free
      // floor cell (seekFloorSeat), keyed on the stair's own id. No draws.
      pre: (L) => {
        for (const st of L.objects) {
          if (st.kind !== 'staircase' || st.dir !== 'up') continue;
          const { lix, liy } = cellIndexOf(L.tx, L.ty, st.x, st.y, L.tileEdgeM, L.N);
          if (lix < 0 || lix >= L.N || liy < 0 || liy >= L.N) continue;
          const seat = seekFloorSeat(L.grid, L.N, lix, liy, L.occupied);
          if (!seat) continue;
          L.occupied.add(seat.idx);
          const p = cellCentreM(L.tx, L.ty, seat.cx, seat.cy, L.tileEdgeM, L.N);
          L.wildplants.push(makeWildplant('torch', p.x, p.y, `ctorch_${st.id}`, { _ix: seat.cx, _iy: seat.cy }));
        }
      },
      count: (rng) => FLOOR_TORCH_MIN + Math.floor(rng() * FLOOR_TORCH_SPAN), tries: FLOOR_TORCH_TRIES, pick: anyCell,
      emit: (L, c, p) => L.wildplants.push(makeWildplant('torch', p.x, p.y,
        cellId(`ctorch_${L.depth}`, L.tx, L.ty, c.lix, c.liy), { _ix: c.lix, _iy: c.liy })) },
    { id: 'barrels', salt: 0x7FEB352D, when: (L) => L.depth === CAVE_BARREL_DEPTH,
      count: (rng) => CAVE_BARREL_MIN + Math.floor(rng() * CAVE_BARREL_SPAN), tries: CAVE_BARREL_TRIES, pick: anyCell,
      emit: (L, c, p) => L.objects.push(makeObject('chest', p.x, p.y,
        cellId(`cbarrel_${L.depth}`, L.tx, L.ty, c.lix, c.liy), { barrel: true, depth: L.depth })) },
  ];
  // One pass over a level — see CAVE_PASSES for the two walks. `L` is the
  // level: { grid, N, tx, ty, tileEdgeM, depth, occupied (flat cell indices,
  // read AND extended), objects, wildplants, coins, treasures }.
  function runCavePass(row, L) {
    if (row.when && !row.when(L)) return;
    if (row.run) { row.run(L); return; }
    const { grid, N, occupied } = L;
    const st = row.setup ? row.setup(L) : null;
    if (row.pre) row.pre(L, st);
    const rng = row.rng ? row.rng(L) : makeRng(tileStreamSeed(L.tx, L.ty, row.salt, L.depth));
    const seat = (c) => {
      if (!c || c.lix < 0 || c.liy < 0 || c.lix >= N || c.liy >= N) return false;
      const idx = c.liy * N + c.lix;
      if (grid[idx] !== T.CAVE_FLOOR || occupied.has(idx) || (row.ok && !row.ok(L, c.lix, c.liy))) return false;
      occupied.add(idx);
      row.emit(L, c, cellCentreM(L.tx, L.ty, c.lix, c.liy, L.tileEdgeM, N), st);
      return true;
    };
    const tries = (px, py) => {
      for (let k = 0; k < row.tries; k++) if (seat(row.pick(rng, px, py, L, st))) break;
    };
    if (row.pivot) {
      for (let py = row.from; py < N; py += row.pivot) {
        for (let px = row.from; px < N; px += row.pivot) {
          if (row.fire && rng() > row.fire(L)) continue;
          if (row.cluster) for (const c of row.cluster(rng, px, py, L, st)) seat(c);
          else tries(px, py);
        }
      }
    } else {
      const n = row.count(rng, L);
      for (let k = 0; k < n; k++) tries();
    }
  }
  // A level record for one row run on its own (the tests drive the rows this
  // way), and the rows by the names their tests call them.
  function cavePassLevel(grid, N, tx, ty, tileEdgeM, depth, occupied, lists) {
    return Object.assign({ grid, N, tx, ty, tileEdgeM, depth, occupied, objects: [], wildplants: [], coins: [], treasures: [] }, lists);
  }
  const cavePass = (id) => CAVE_PASSES.find((r) => r.id === id);
  function spawnCaveRocks(grid, N, tx, ty, tileEdgeM, depth, objects, occupied) {
    runCavePass(cavePass('rocks'), cavePassLevel(grid, N, tx, ty, tileEdgeM, depth, occupied, { objects }));
  }
  function spawnCaveMushrooms(grid, N, tx, ty, tileEdgeM, depth, wildplants, occupied) {
    runCavePass(cavePass('mushrooms'), cavePassLevel(grid, N, tx, ty, tileEdgeM, depth, occupied, { wildplants }));
  }
  function caveWallTorches(grid, N, tx, ty, tileEdgeM, depth, occupied) {
    const L = cavePassLevel(grid, N, tx, ty, tileEdgeM, depth, occupied);
    runCavePass(cavePass('wallTorches'), L);
    return L.objects;
  }
  function caveCoins(grid, N, tx, ty, tileEdgeM, depth, occupied) {
    const L = cavePassLevel(grid, N, tx, ty, tileEdgeM, depth, occupied);
    runCavePass(cavePass('coins'), L);
    return L.coins;
  }
  function caveTreasureMarks(grid, N, tx, ty, tileEdgeM, depth, occupied) {
    const L = cavePassLevel(grid, N, tx, ty, tileEdgeM, depth, occupied);
    runCavePass(cavePass('treasureMarks'), L);
    return L.treasures;
  }
  function caveFloorTorches(objects, grid, N, tx, ty, tileEdgeM, depth, wildplants, occupied) {
    runCavePass(cavePass('floorTorches'), cavePassLevel(grid, N, tx, ty, tileEdgeM, depth, occupied, { objects, wildplants }));
  }
  function caveBarrels(objects, grid, N, tx, ty, tileEdgeM, depth, occupied) {
    runCavePass(cavePass('barrels'), cavePassLevel(grid, N, tx, ty, tileEdgeM, depth, occupied, { objects }));
  }

  // The dungeon level whose rock under the town's BUILDINGS is lava (T.CAVE_LAVA).
  // Only this level: the one above and every one below keep plain rock there.
  const LAVA_DEPTH = 5;

  async function loadCaveTile(cache, depth, key, x, y, lat) {
    const above = await loadTile.atDepth(depth - 1, x, y, lat);
    if (above.status === 'loading') await above.promise;
    const N = above.cellsPerEdge;
    const tileEdgeM = above.tileEdgeM;
    // Derived from the level above's GENERATED layer only (baseGrid /
    // genObjects — see loadTile): never the live entry, which carries the
    // Overpass bin when it happened to be cached, and whatever app.js wrote
    // into it for this one player (the home up-stair, the starter ladder, dug
    // walls, a well's repaint). A live read made the cave under a tile depend
    // on who descended into it and when.
    const aboveGrid = above.baseGrid || above.grid;
    const aboveObjects = above.genObjects || above.objects || [];
    const grid = new Uint8Array(N * N);
    // Lava overhead is ROCK to the level below: walkable as it is, reading it
    // as floor would open the lava level's building footprints on every level
    // under it.
    for (let i = 0; i < grid.length; i++) {
      const a = aboveGrid[i];
      grid[i] = (isWalkable(a) && a !== T.CAVE_LAVA) ? T.CAVE_FLOOR : T.CAVE_WALL;
    }
    // THE LAVA LEVEL. By here a building's footprint is indistinguishable from
    // a road's or a lake's — every cave level carries them all as CAVE_WALL —
    // so ask the SURFACE, the one grid that still knows (its generated layer,
    // like aboveGrid: the same tile bytes give every player the same lava).
    // Only wall cells turn: a building cell is never walkable overhead, so this
    // is every building cell, and never a floor something could stand on.
    if (depth === LAVA_DEPTH) {
      const surf = await loadTile.atDepth(0, x, y, lat);
      if (surf.status === 'loading') await surf.promise;
      const sGrid = surf.baseGrid || surf.grid;
      if (sGrid && surf.cellsPerEdge === N) {
        for (let i = 0; i < grid.length; i++) {
          if (grid[i] === T.CAVE_WALL && isBuildingTerrain(sGrid[i])) grid[i] = T.CAVE_LAVA;
        }
      }
    }
    const objects = [];
    // Only GENERATED down-stairs lead down. A `_synthetic` one (the starter
    // ladder app.js lays beside Home) is a per-player overlay: mirroring it
    // here would seat a different cave — every rock and cap after the stair
    // claims its cell — for the player who has one. app.js lays its own
    // up-stair below a synthetic ladder, as it does for the home stair.
    const downAbove = aboveObjects.filter(
      o => o.kind === 'staircase' && o.dir === 'down' && !o._synthetic);
    for (const s of downAbove) {
      const { lix: ulix, liy: uliy } = cellIndexOf(x, y, s.x, s.y, tileEdgeM, N);
      const inTile = ulix >= 0 && ulix < N && uliy >= 0 && uliy < N;
      // Way back up: stand on it the moment you descend.
      objects.push(makeObject('staircase', s.x, s.y, caveStairId('up', depth, x, y, ulix, uliy),
        { dir: 'up', depth }));
      // Way deeper: a random floor cell anywhere on this level, so the descent
      // shaft wanders instead of stacking straight down. Seeded off the source
      // stair's tile + cell + depth so the layout is stable across reloads —
      // and across saves (the old seed was the stair's frame metres).
      const skipIdx = inTile ? uliy * N + ulix : -1;
      const dnRng = makeRng((cellHash(x, y, ulix, uliy) ^ Math.imul(depth, 0x9E3779B1)) >>> 0);
      const dn = randomFloorCell(grid, N, x, y, tileEdgeM, dnRng, skipIdx);
      if (dn) {
        objects.push(makeObject('staircase', dn.x, dn.y, caveStairId('down', depth, x, y, dn.lix, dn.liy),
          { dir: 'down', depth }));
      }
    }
    // Fill the level with rock clusters, keeping the staircase cells clear so a
    // stair never spawns buried under a rock sprite.
    const occupied = occupiedIndexSet(tileFrame({ cellsPerEdge: N }, x, y, tileEdgeM), objects);
    // The POI chests overhead, mirrored down to this level (they claim their
    // cells in `occupied` before the rocks are rolled).
    for (const c of caveChestsFrom(aboveObjects, grid, N, x, y, tileEdgeM, depth, occupied)) {
      objects.push(c);
    }
    // This level's own quota pyramid, over this level's mirrors.
    seedChestTiers(objects, { cave: true });
    // Prune only after final tiers are known; freed cells are available to
    // ordinary cave dressing, and dropped mirrors do not descend further.
    capCaveChests(objects, N, x, y, tileEdgeM, occupied);
    // Torches where the lowtier POIs overhead would have been (a random
    // subset per level), seated before the rocks so they keep their spot.
    const torchSites = caveTorchSites(above);
    for (const t of caveTorchesFrom(torchSites, grid, N, x, y, tileEdgeM, depth, occupied)) {
      objects.push(t);
    }
    // The floor passes (CAVE_PASSES), in table order: the rocks, then the
    // mushrooms, then the level's own extras — each only takes what is left.
    const wildplants = [];
    const level = cavePassLevel(grid, N, x, y, tileEdgeM, depth, occupied, { objects, wildplants });
    for (const row of CAVE_PASSES) runCavePass(row, level);
    const extraTreasures = level.treasures, caveCoinSeeds = level.coins;
    const entry = {
      status: 'ready', grid, cellsPerEdge: N, tileEdgeM, depth,
      objects, wildplants, parkingTreasures: [], extraTreasures, caveCoinSeeds,
      roadLabels: {}, pathUnder: {}, torchSites,
      // The generated layer, frozen for the level below (see loadTile): app.js
      // digs walls into `grid`, filters flora and lays the home up-stair into
      // the live lists.
      baseGrid: grid.slice(), genObjects: objects.slice(), genWildplants: wildplants.slice(),
    };
    cache.set(key, entry);
    pruneCache(cache, key);
    return entry;
  }

  // Load a tile at an EXPLICIT depth (used by cave generation to read the level
  // above without disturbing the active depth). Surface/cave dispatch mirrors
  // loadTile's own branch.
  loadTile.atDepth = async function (depth, x, y, lat) {
    const cache = cacheFor(depth);
    const key = tileKey(x, y);
    if (cache.has(key)) return cache.get(key);
    if (depth > 0) return loadCaveTile(cache, depth, key, x, y, lat);
    // Surface at a non-active depth: temporarily point activeDepth at 0 so the
    // shared loadTile body writes into the surface cache, then restore.
    const prev = activeDepth;
    activeDepth = 0;
    try { return await loadTile(x, y, lat); }
    finally { activeDepth = prev; }
  };

  // Iterate every item across every cached tile's `prop` array. Tiles missing
  // the property are skipped. fn(item, entry) — return any truthy value to
  // short-circuit (the return value is propagated back to the caller).
  function forEachItem(prop, fn) {
    for (const entry of tileCache.values()) {
      const arr = entry[prop];
      if (!arr) continue;
      for (const item of arr) {
        const r = fn(item, entry);
        if (r) return r;
      }
    }
  }

  // Same contract as forEachItem, but restricted to the 3×3 tile
  // neighbourhood around (tx, ty). The tile cache grows unboundedly as the
  // player walks (capped at MAX_CACHED_TILES entries, but that is still tens of
  // thousands of items), so every PER-FRAME consumer that only cares about
  // things near the player must use this instead — a tile edge is hundreds of
  // cells, so one ring of tiles comfortably covers any on-screen/near-player
  // radius. drawObjects in render.js learned this the hard way (its comment
  // records the random hangs the all-tiles scan caused); the creature sim
  // loops in app.js were the same bug and now go through here.
  // ── The chunk index: what drawObjects walks instead of the tile ─────────
  // A tile's `objects` / `wildplants` are one flat array each, and the sprite
  // pass used to walk all of them in the 3×3 ring on EVERY step to keep the
  // few dozen inside the viewport — the Sep 2026 phone profile read 37,000
  // scanned to keep 37, a quarter of all main-thread time, while standing
  // still. So each array is bucketed ONCE into CHUNK_M-metre squares (the
  // `collectDedupIndex` shape, hung on the entry rather than rebuilt per
  // rasterize) and a query walks only the chunks a box overlaps.
  // The index is DERIVED from the array and never stored, so the rebuild rule
  // holds by construction: a rebuilt entry is a new object with no `_chunkIdx`
  // and the first query lays it again. Within an entry the array MUTATES —
  // spawnInTile pushes, a chop or a pickup splices, a dedup reassigns a
  // filter()'s result, and the trailer swap splices one house then pushes
  // another — so the index is keyed on the array's identity, its length AND
  // its last element: a push or a splice moves the length, a filter moves
  // the identity, and a splice-then-push of the same length moves the tail.
  // Objects never move in place (only creatures do, and they are not indexed:
  // a tile holds a handful and they walk every tick).
  const CHUNK_M = 80;
  function chunkKey(x, y) { return Math.floor(x / CHUNK_M) + ',' + Math.floor(y / CHUNK_M); }
  function chunkIndex(entry, prop) {
    const arr = entry[prop];
    if (!arr || !arr.length) return null;
    const store = entry._chunkIdx || (entry._chunkIdx = {});
    const last = arr[arr.length - 1];
    let idx = store[prop];
    if (idx && idx.arr === arr && idx.n === arr.length && idx.last === last) return idx;
    const buckets = new Map();
    for (let i = 0; i < arr.length; i++) {
      const o = arr[i];
      const k = chunkKey(o.x, o.y);
      let b = buckets.get(k);
      if (!b) buckets.set(k, b = []);
      b.push(i);
    }
    idx = store[prop] = { arr, n: arr.length, last, buckets, builds: (idx ? idx.builds : 0) + 1 };
    return idx;
  }
  // Every item of entry[prop] whose (x, y) may lie in the box [x0,x1]×[y0,y1]
  // (metres). The default visits row-major chunks and preserves array order
  // inside each chunk, which avoids collecting candidates in the hot object
  // pass. A caller whose final output depends on flat-array order passes
  // `preserveSourceOrder`; the index then merges the touched bucket positions
  // before calling it. The caller still applies its own exact cull because a
  // chunk is coarser than the box.
  function forEachItemInBox(entry, prop, x0, y0, x1, y1, fn, preserveSourceOrder = false) {
    const idx = chunkIndex(entry, prop);
    if (!idx) return;
    const bx0 = Math.floor(x0 / CHUNK_M), bx1 = Math.floor(x1 / CHUNK_M);
    const by0 = Math.floor(y0 / CHUNK_M), by1 = Math.floor(y1 / CHUNK_M);
    const positions = preserveSourceOrder ? [] : null;
    for (let by = by0; by <= by1; by++) {
      for (let bx = bx0; bx <= bx1; bx++) {
        const b = idx.buckets.get(bx + ',' + by);
        if (!b) continue;
        if (positions) positions.push(...b);
        else for (const i of b) fn(idx.arr[i]);
      }
    }
    if (!positions) return;
    positions.sort((a, b) => a - b);
    for (const i of positions) fn(idx.arr[i]);
  }

  function forEachItemNear(prop, tx, ty, fn) {
    for (let dty = -1; dty <= 1; dty++) {
      for (let dtx = -1; dtx <= 1; dtx++) {
        const entry = tileCache.get(tileKey(tx + dtx, ty + dty));
        if (!entry) continue;
        const arr = entry[prop];
        if (!arr) continue;
        for (const item of arr) {
          const r = fn(item, entry);
          if (r) return r;
        }
      }
    }
  }

  // Specialty shop type for small houses, derived from the synthetic street
  // address. Forts (BUILDING_MED) and civic slabs are excluded — only the
  // small residential tier gets address-based specialties.
  // The specialty-shop taxonomy + label + tint + sell-bonus all live in
  // shops.js; the only thing worldgen owns here is the address field itself.

  global.WorldGen = {
    Z, CELL_M, TILE_PX, T,
    // The live tile source (see the TILE_HOST block at the top):
    // TILE_URL_FALLBACK is only the pinned fallback. tileUrlTemplate() is what
    // tiles are actually fetched under right now; resolveTileUrl asks the
    // TileJSON.
    TILE_URL_FALLBACK, TILEJSON_URL, tileUrlTemplate, tileUrlFor, resolveTileUrl,
    fetchTileBytes, _resetTileUrlForTest,
    // The step generator itself, so the block audit
    // (test/node/tile_build_blocks.test.js) can time the build one step at
    // a time — the only way to see the thing that actually stutters, which
    // is not the total but the longest stretch between two yields.
    rasterizeTileSteps, grassFillSteps,
    setSliceBudgetMs, sliceBudgetMs, noteSliceFrame, sliceFrameTargetMs,
    // The shared slice driver (see driveStepsSliced): a steps generator run
    // straight through, or sliced as a turn on the heavy chain — the scene's
    // spawn pass rides it too. STEPS_ABORTED is what an aborted pass returns.
    runSteps, runStepsSliced, STEPS_ABORTED: ABORTED,
    // One depth's cache, whichever depth is active (tileCache follows the
    // active one) — a sliced surface pass asks whether its entry is still live.
    tileCacheFor: cacheFor,
    RASTER_SLICE_LIVE_MS, SLICE_MIN_MS,
    lonLatToWorldPx, metersPerPixel, tileEdgeMeters,
    // The tile's OWN grid: cells per edge from the tile's row (a pure
    // function of ty), and the frame metres per cell of a tile in a save's
    // frame. cellsPerEdgeForLat is the per-save legacy (START_LAT) size —
    // nothing generates or indexes by it; app.js keeps it only as the frame's
    // reference count anchoring coords.js' absolute-cell encoding.
    cellsPerEdgeForTile, cellSizeM, latOfRowCentre, cellsPerEdgeForLat,
    // Tile + local-cell hash every generated id/seed is keyed on, and the
    // stair id built from it.
    cellHash, cellId, tileStreamSeed, caveStairId,
    // The tile frame and what every placer derives from it (see tileFrame).
    tileFrame, occupiedIndexSet, spawnOptsOf, dressFrame, footprintFree, compactSteps,
    // Sidecar / Overpass GeoJSON → per-tile bins of tile-local cells —
    // exported so world_frame.test.js can pin that binning is frame-free.
    buildBinsFromGeoJSON,
    // Apply cached bins independently of fetching, with placement and snapshot
    // preservation pinned by tile_bin_injection.test.js.
    injectTileBin, injectTileBinSteps,
    tileXYForLonLat, loadTile, tileCache, makeRng,
    forEachItem, forEachItemNear, forEachItemInBox, chunkIndex, CHUNK_M, LAVA_DEPTH, isWalkable, isRoadTerrain, isLotTerrain, LOT_ROCK_DRY, isParkingAisle, isLotLane, pruneLotLanesSteps, LOT_POI_R_M, LOT_AISLE_R_M, LOT_STREETSIDE_M, LOT_MAX_M, isSpawnCell, nearBuildingCell, nearPoiCell, poiWithin, relocateToSpawnCell,
    // The cell walks (one ring scan, one disc order, one box scan) and the
    // polygon geometry every module used to re-type.
    ringCells, nearestRingCell, RING_ORDER, discOffsets, boxCells, anyNeighbour8, countNeighbours8,
    pointInRings, rowCrossings, bboxOf, ringSignedArea, ringCentroid,
    // The hedge-maze lattice decision (spawnHedgeMazeSteps' owner): exported
    // so the sandbox's flora mirror runs the SAME maze, never a drifted copy.
    hedgeMazeCell, hedgeMazePotCell, HEDGE_LATTICE_P,
    // THE SPAWN GATE (entry.spawnWhy): the mask's encoding, the classes, the
    // stamp and its numbers, and the live per-player private-ground veto.
    SPAWN_WHY, SPAWN_WHY_HARD, SPAWN_WHY_TYPED, SPAWN_WHY_LAND, SPAWN_CLASS_BLOCKS, SPAWN_CLASSES,
    SPAWN_OPEN, SPAWN_SUPPRESSED, SPAWN_INVALID, spawnClassOf,
    landRefused, stampSpawnWhySteps, isPrivateWay, isPublicPier, churchyardBufferM, SPAWN_FRONTAGE,
    SPAWN_SENSITIVE_BUFFER_M,
    RESTRICTED_LAND, KINDERGARTEN_LAND, COMMERCIAL_GROUND, NEAREST_POI_MAX_M, COMMERCIAL_POI_KIND, commercialPoiKind, commercialPoiField, POI_PUBLIC, POI_PRIVATE, FARM_TYPES, FARM_EDGE_CELLS, BEHIND_HOUSE_MAX_CELLS, CAVE_MOUTH_RELOCATE_CELLS, PUBLIC_NEAR,
    PRIVATE_VETO_IDB_PREFIX, privateVetoMask, privateVetoAt, setPrivateVeto, warmPrivateVeto, buildPrivateVetoQL,
    SENSITIVE_POI, isSensitivePoi, worshipFaith, QUIET_LAND, isQuietLand, stampQuietLandSteps, stampPoiDensity, poiDensityCounts, seedChestTiers, TIER_SEED_QUOTA, topUpChestsSteps, CHEST_TOP_UP_MIN, gatePostsAt, placeGatesAndBoards, POI_GATE_CLASS, POI_INFO_CLASS, SX_NOT_A_PLACE, POI_USEFUL, parkPoiLayer, setDepth, tidyFootprintCells,
    caveChestsFrom, CAVE_CHEST_SEEK_CELLS, capCaveChests, CAVE_LOWEST_TIER_CHEST_LIMIT,
    caveTorchSites, caveTorchesFrom, CAVE_TORCH_P, spawnCaveMushrooms, CAVE_PASSES, runCavePass, cavePassLevel, spawnCaveRocks,
    caveFloorTorches, FLOOR_TORCH_DEPTH, FLOOR_TORCH_MIN, FLOOR_TORCH_SPAN,
    caveBarrels, CAVE_BARREL_DEPTH, CAVE_BARREL_MIN, CAVE_BARREL_SPAN,
    caveWallTorches, caveChestRings, CAVE_RING_CELLS, caveCoins, caveTreasureMarks,
    // Full-tile rasterization — exported for the headless spawn tests, which
    // build synthetic MVT layers and pin the "nothing spawns on a road" rule
    // end to end (test/node/spawn_roads.test.js).
    rasterizeTile, castleTowerCellsSteps,
    setReviewSalt,
    // Building-footprint assignment (see assignBuildingFootprints) — exported
    // for the headless footprint tests, which pin the no-overlap /
    // one-cell-each / order-independence invariants.
    assignBuildingFootprints, cellCoverFraction,
    FOOT_COVER_MIN, FOOT_RECT_BONUS, FOOT_RESCUE_MIN, FOOT_HOUSE_MIN,
    // Per-tile building tier mix — the classifier and the distribution floors
    // it gets corrected by. Exported so the headless tests can pin the floors
    // (and so the mix is tunable from one place).
    buildingTier, enforceBuildingDistribution,
    TIER_FLOOR_LARGE, TIER_FLOOR_MED, TIER_FLOOR_SMALL,
    // Path-cobble geometry — exported so the headless tests can pin that a way
    // crossing a cell measures a full cell width while a corner clip doesn't.
    accumulateLineSpan, PATH_CROSS_MIN_CELLS, MIN_PATH_RUN_CELLS, isCobbleTerrain,
    // The building-tier predicate — road_overlay.js keeps its band off
    // building floors with it, so the overlay and the grid agree on what a
    // building is.
    isBuildingTerrain,
    // POI chest dedupe (one place, one chest) — exported so the headless tests
    // can pin the radii against the real Gordon-at-KLO crossing cluster.
    isDupPoiChest, poiDupRadiusM, POI_DUP_AREA_M, POI_DUP_POINT_M,
    erodePavementBlobs,
    // Road/path rasterization — exported for the headless tests, which pin the
    // "a vertex paints the cell that contains it" rule (no half-cell bias).
    paintLine,
    // The surface-deposit rarity roll + its plain fraction — shared with the
    // starter home provisioner (app.js) so a hand-seeded starter rock gets the
    // exact odds a real residential deposit gets, and exported for the
    // headless tests that pin those odds.
    rollSurfaceRockTier, SURFACE_PLAIN_ROCK_P: caveRockP(0), caveRockP, caveOreWeights, caveOreTiers, LEVEL1_COPPER_SHARE,
    // One tree-species table feeds parks, forests and zone groves. The vein
    // helper is exported for the deterministic cave distribution regression.
    TREE_SPECIES, PEACH_ONE_IN, fruitTreeSpecies, rollVeinTable,
    // Per-class road width — the road-geometry overlay strokes with it.
    roadWidthM,
    // …and the width it actually COVERS, large-tier weighting included. The
    // overlay strokes with this and rasterizeTile stamps roadMask with it, so
    // "drawn as road" and "no spawns here" are the same number.
    roadOverlayWidthM, ROAD_MASK_MIN_COVER, ROAD_CLASS_MAJOR_BAND, ROAD_CLASS_MAJOR_VERGE, ROAD_CLASS_BANDIT_VERGE,
    ROAD_CLASS_MAJOR_BUFFER, MAJOR_BUFFER_CELLS, inMajorBuffer, onMajorBand,
    // The path-class Set classifyLine keys off — exported so road_overlay.js
    // colours exactly the classes the terrain classifier treats as PATH,
    // instead of hand-copying the list. (The large tier needs no such export:
    // its weighting reaches the overlay through roadOverlayWidthM.)
    PATH_CLASSES,
    // The way's terrain tier from its tags (T.ROAD_LG / ROAD_MD / ROAD / PATH,
    // null for anything that is not a road) — exported so the street lamps
    // (app.js _streetLampsForTile) pick an unlit stone's frame by the SAME
    // classification the terrain grid was painted with, not a second list.
    classifyLine,
    // `${Z}/${tx}/${ty}` — the tile cache key, built in one place so every
    // caller (this file, app.js, render.js, …) spells it the same way.
    tileKey,
    // Live Overpass decoration (ON by default): fills tiles outside the static
    // satextract bbox with OSM features queried at request time, cached per
    // tile in IndexedDB. Opt out with setOverpassLive(false) or ?overpass=off.
    setOverpassLive: (b) => { _overpassLive = !!b; },
    warmOverpass,        // schedule Overpass fetch for one tile (centre only)
    overpassTileInfo,   // one-line status for a tile, surfaced in TILE DEBUG
    // Cave-entrance placement — exported so the headless tests can pin that a
    // descend staircase never lands under a road band (roadMask), the same
    // rule every other spawner in this file is held to
    // (test/node/spawn_roads.test.js). loadTile calls this straight off
    // rasterizeTileSliced's result, so a fixture only needs to hand-build the
    // minimal `entry` shape it reads (grid/cellsPerEdge/objects/roadMask/
    // poiPadCells) rather than driving a full tile load.
    maybePlaceCaveEntrance, maybePlaceCaveEntranceSteps,
    // The three stream factories (see the block by tileKey). Exported because
    // the mint sites are spread across app.js, interact.js, lairs.js and
    // sandbox.js as well as this file — one shape per stream, reachable from
    // all of them.
    makeWildplant, makeCreature, makeObject,
    spawnParkPlants, PARK_PLANT_CELL_CHANCE, clearZoneAmbientSteps,
    clearStreetAmbientSteps, variantOwnerAt, getTileBin,
  };
})(window);
