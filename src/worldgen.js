// World generation: fetch MVT tiles and rasterize into a grid of 5m game cells.
// Coords: web-mercator pixel space at z=14. 1 MVT tile = 256 px = 4096 MVT units.
// Game cell = 5 m. Cell size in pixels depends on latitude.

(function (global) {
  const Z = 14;
  const TILE_PX = 256;          // standard
  const TILE_EXTENT = 4096;     // MVT units
  const CELL_M = 6;             // game cell size in meters
  const TILE_URL = 'https://tiles.openfreemap.org/planet/20260520_001001_pt/{z}/{x}/{y}.pbf';

  // Spatial-hash multipliers. The (HASH_MUL_X, HASH_MUL_Y) pair is the classic
  // 2D integer hash used to derive stable per-coordinate seeds (poly keys, tile
  // rng, addresses, satextract tree seeds). Renamed from bare literals — values
  // are byte-identical to the originals.
  const HASH_MUL_X = 73856093;
  const HASH_MUL_Y = 19349663;

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
    // non-tillable, not a road tier (so no road-letter labels or path-stone
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
  const NON_WALKABLE = new Set([
    T.WATER,
    T.ROAD, T.ROAD_MD, T.ROAD_LG,
    T.BUILDING, T.BUILDING_MED, T.BUILDING_LARGE,
    // Underground rock — the solid walls of a cave level. Surface
    // buildings/roads/water rasterize to this in loadCaveTile.
    T.CAVE_WALL,
  ]);
  function isWalkable(t) { return !NON_WALKABLE.has(t); }

  // Default Chebyshev radius for the residential-frontage test: a private cell
  // is only spawnable if a public anchor sits within this many cells.
  const SPAWN_FRONTAGE = 3;

  // Terrain that counts as a "public anchor" for the frontage test. Being near
  // any of these is what makes a RESIDENTIAL cell read as street frontage / the
  // edge of public space rather than someone's back garden:
  //   - every road tier + footpaths/pedestrian squares (the kerb / sidewalk)
  //   - clearly public open space we can detect from OSM: parks, playgrounds,
  //     sports pitches, golf courses, beaches, piers.
  const PUBLIC_NEAR = new Set([
    T.ROAD, T.ROAD_MD, T.ROAD_LG, T.PATH,
    T.PARK, T.PLAYGROUND, T.PITCH, T.GOLF, T.SAND, T.PIER,
  ]);

  // Is (cx,cy) a legitimate place to spawn a pickup? THE single rule every
  // spawner shares. Walkable (never water/road/building) AND not deep in
  // private property. RESIDENTIAL cells model someone's yard/lot, so a spawn is
  // only allowed there when — within `frontage` cells (Chebyshev) — there's a
  // public anchor: a road/path, a detectable public area (PUBLIC_NEAR), or a
  // POI. Unifies the legacy _xRoadOK (app.js) and _mrNearRoadWithin (worldgen).
  //   grid/w/h : flat terrain array + its cell dimensions
  //   opts.frontage : override the default radius (SPAWN_FRONTAGE)
  //   opts.pois     : array of {ix,iy} cell coords of nearby POIs/chests —
  //                   a residential cell within `frontage` of one is fair game
  function isSpawnCell(grid, w, h, cx, cy, opts) {
    if (cx < 0 || cy < 0 || cx >= w || cy >= h) return false;
    const here = grid[cy * w + cx];
    if (!isWalkable(here)) return false;          // never on water/road/building
    if (here !== T.RESIDENTIAL) return true;      // public / open ground — always ok
    const frontage = (opts && opts.frontage != null) ? opts.frontage : SPAWN_FRONTAGE;
    for (let dy = -frontage; dy <= frontage; dy++) {
      for (let dx = -frontage; dx <= frontage; dx++) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        if (PUBLIC_NEAR.has(grid[ny * w + nx])) return true;
      }
    }
    const pois = opts && opts.pois;
    if (pois) {
      for (let i = 0; i < pois.length; i++) {
        if (Math.max(Math.abs(pois[i].ix - cx), Math.abs(pois[i].iy - cy)) <= frontage) return true;
      }
    }
    return false;
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

  // Per-tile distribution-floor enforcement. Per user balance pass: every
  // tile should have AT LEAST 20% small houses, 8% forts, and 2% castles —
  // and the percent floors ALWAYS round UP to at least one of each type, so
  // no tile with buildings is left without a castle/fort/house. (Previously
  // the floors used Math.round, so e.g. 2% castles vanished on any tile with
  // fewer than 25 buildings.) If the default thresholds don't hit those minima
  // on this tile's actual area distribution, promote/demote by area-rank until
  // they do — biggest buildings get the biggest tier. n < 3 skips (can't host
  // one of each type with fewer than three buildings).
  // Mutates each entry's `.tier`.
  function enforceBuildingDistribution(polys) {
    const n = polys.length;
    if (n < 3) return;
    const needLarge = Math.max(1, Math.ceil(n * 0.02));
    const needMed   = Math.max(1, Math.ceil(n * 0.08));
    const needSmall = Math.max(1, Math.ceil(n * 0.20));
    // Count current
    let cLarge = 0, cMed = 0, cSmall = 0;
    for (const p of polys) {
      if (p.tier === T.BUILDING_LARGE) cLarge++;
      else if (p.tier === T.BUILDING_MED) cMed++;
      else cSmall++;
    }
    if (cLarge >= needLarge && cMed >= needMed && cSmall >= needSmall) return;
    // Rank by area descending and FORCE the top / bottom bands. Buildings
    // outside the forced bands keep their default tier — the floors are
    // "at least", so naturally-large mid-tier buildings stay where they were.
    const byArea = [...polys].sort((a, b) => b.areaM2 - a.areaM2);
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
      if (c === 'residential') return T.RESIDENTIAL;
      if (c === 'commercial' || c === 'retail' || c === 'hospital') return T.COMMERCIAL;
      if (c === 'industrial') return T.INDUSTRIAL;
      if (c === 'school' || c === 'college' || c === 'university') return T.SCHOOL;
      if (c === 'farmland' || c === 'farmyard') return T.FARMLAND;
      if (c === 'pitch') return T.PITCH;
      if (c === 'playground') return T.PLAYGROUND;
      // Recreation / sports grounds (leisure=sports_centre, stadium,
      // recreation_ground, track, …). Without these they fell through to the
      // RESIDENTIAL default below, so a rec centre's grounds read as a plain
      // brown housing block. Paint them as a sports field; the indoor facility
      // building itself is synthesized from the matching POI (see CIVIC_BUILDING).
      if (c === 'stadium' || c === 'sports_centre' || c === 'sports' ||
          c === 'recreation_ground' || c === 'track') return T.PITCH;
      if (c === 'dog_park') return T.PARK;
      if (c === 'cemetery' || c === 'park' || c === 'garden') return T.PARK;
      return T.RESIDENTIAL;
    }
    if (layer === 'park') return T.PARK;
    if (layer === 'building') return T.BUILDING;
    return null;
  }
  function classifyLine(layer, tags) {
    if (layer !== 'transportation') return null;
    const c = tags.class || '';
    if (['motorway', 'trunk', 'primary'].includes(c)) return T.ROAD_LG;
    if (['secondary', 'tertiary'].includes(c)) return T.ROAD_MD;
    if (['minor', 'service', 'street'].includes(c)) return T.ROAD;
    if (['path', 'footway', 'track', 'pedestrian', 'cycleway', 'steps'].includes(c)) return T.PATH;
    // Piers: wooden walkways over water. Painted as T.PIER so render.js can
    // overlay the plank sprite and walkability gates don't lump them in with
    // roads or treat them as water.
    if (c === 'pier') return T.PIER;
    return T.ROAD;
  }
  function roadWidthM(tags) {
    const c = tags.class || '';
    if (c === 'motorway' || c === 'trunk') return 12;
    if (c === 'primary') return 10;
    if (c === 'secondary') return 8;
    if (c === 'tertiary') return 7;
    if (c === 'minor' || c === 'street' || c === 'service') return 5;
    // Piers are narrow wooden walkways — keep them single-cell.
    if (c === 'pier') return 2;
    return 3;
  }

  // Precedence: higher wins on conflict
  const PRIO = {
    [T.GRASS]: 0, [T.PARK]: 1, [T.FOREST]: 2, [T.SAND]: 2, [T.ROCK]: 2,
    [T.GOLF]: 1.5, [T.PITCH]: 1.5, [T.PLAYGROUND]: 1.5,
    [T.SCHOOL]: 1.5,  // grassland-biome subtype, so it wins over generic grass but loses to residential/farmland
    [T.ORCHARD]: 2, [T.WETLAND]: 2,
    [T.FARMLAND]: 3,
    [T.RESIDENTIAL]: 4, [T.COMMERCIAL]: 4, [T.INDUSTRIAL]: 4,
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
  function paintPolygon(grid, w, h, rings, type, mvtToCell) {
    // Use signed area to know outer vs inner. For simplicity, rasterize all rings with
    // even-odd fill across all rings combined per feature.
    // Build cell-space polygon, then scanline fill.
    const polys = rings.map(r => r.map(p => ({
      x: p.x * mvtToCell,
      y: p.y * mvtToCell,
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
        // is between the left/right intersection xs[k], xs[k+1]. Previously used mixed
        // ceil/floor with -0.5 offsets which could clip the rightmost cell column.
        const xa = Math.max(0, Math.floor(xs[k] + 0.5));
        const xb = Math.min(w - 1, Math.floor(xs[k + 1] - 0.5));
        for (let x = xa; x <= xb; x++) paintCell(grid, w, h, x, y, type);
      }
    }
  }
  function paintLine(grid, w, h, line, type, widthCells, mvtToCell, under) {
    // Stamp a disk of radius widthCells/2 along the polyline using Bresenham segments.
    const r = Math.max(0, Math.floor(widthCells / 2));
    for (let i = 1; i < line.length; i++) {
      let x0 = Math.round(line[i - 1].x * mvtToCell);
      let y0 = Math.round(line[i - 1].y * mvtToCell);
      const x1 = Math.round(line[i].x * mvtToCell);
      const y1 = Math.round(line[i].y * mvtToCell);
      const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
      const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
      let err = dx + dy;
      while (true) {
        for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) {
          if (ox * ox + oy * oy <= r * r) paintCell(grid, w, h, x0 + ox, y0 + oy, type, under);
        }
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sx; }
        if (e2 <= dx) { err += dx; y0 += sy; }
      }
    }
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

  // Plain-rock fraction of a mineralrock roll (vs an ore-bearing rock), scaled
  // by DEPTH so ore is rare in daylight and grows richer the deeper you mine.
  // The base curve below is then halved in ore terms on EVERY level so plain
  // rock is always the clear majority — basic stone is the most frequent find
  // everywhere. Copper is ~25 % of the ore subset (see the tier weights):
  //   surface (depth 0) → 0.90 plain → 0.10 ore → ~2.5 % copper-bearing rock
  //   one level down (1) → 0.60 plain → 0.40 ore → ~10 % copper-bearing rock
  //   deeper            → ore keeps climbing but plain never drops below ~0.55
  function caveRockP(depth) {
    const basePlain = (!depth || depth <= 0)
      ? 0.80
      : Math.max(0.10, 0.20 - 0.03 * (depth - 1));
    // Halve the ore-embedded share: newPlain = 1 − ½·(1 − basePlain).
    return 1 - 0.5 * (1 - basePlain);
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

  async function fetchTileBytes(x, y) {
    const key = `${Z}/${x}/${y}`;
    const cached = await idbGet(key);
    if (cached) return { bytes: cached, fromCache: true };
    const url = TILE_URL.replace('{z}', Z).replace('{x}', x).replace('{y}', y);
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`tile ${key} HTTP ${resp.status}`);
    const buf = new Uint8Array(await resp.arrayBuffer());
    idbPut(key, buf);
    return { bytes: buf, fromCache: false };
  }

  // Deterministic small PRNG seeded from integers (mulberry32)
  function makeRng(seed) {
    let a = seed >>> 0;
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
  // Local cells (ix, iy) a single ring rasterizes to — identical scanline rule
  // to paintPolygon, so it returns exactly the tiles the building is painted on.
  // Used to anchor a house on its real footprint (the tiles the player sees)
  // rather than the geometric ring centroid, which for an L-shaped or
  // tile-clipped footprint can land on a cell that isn't part of the building.
  function ringFootprintCells(ring, mvtToCell, w, h) {
    const poly = ring.map(p => ({ x: p.x * mvtToCell, y: p.y * mvtToCell }));
    let minY = Infinity, maxY = -Infinity;
    for (const p of poly) { if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; }
    const cells = [];
    const y0 = Math.max(0, Math.floor(minY));
    const y1 = Math.min(h - 1, Math.ceil(maxY));
    for (let y = y0; y <= y1; y++) {
      const ys = y + 0.5;
      const xs = [];
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[j], b = poly[i];
        if ((a.y > ys) !== (b.y > ys)) {
          const t = (ys - a.y) / (b.y - a.y);
          xs.push(a.x + t * (b.x - a.x));
        }
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.max(0, Math.floor(xs[k] + 0.5));
        const xb = Math.min(w - 1, Math.floor(xs[k + 1] - 0.5));
        for (let x = xa; x <= xb; x++) cells.push([x, y]);
      }
    }
    return cells;
  }
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
  // DEBRIS_MIN/MAX remain here as spawnDebris' default density window.
  const DEBRIS_MIN = 0.05;
  const DEBRIS_MAX = 0.30;

  function rasterizeTile(layers, cellsPerEdge, tx, ty, tileEdgeM) {
    const w = cellsPerEdge, h = cellsPerEdge;
    const grid = new Uint8Array(w * h);
    const mvtToCell = cellsPerEdge / TILE_EXTENT;
    const mvtToM = tileEdgeM / TILE_EXTENT;
    const objects = [];
    const wildplants = [];
    const parkingTreasures = []; // one guaranteed treasure-X per parking-POI
    // "cx_cy" → biome code a PATH cell overwrote (see paintCell). Render uses
    // it to draw the under-path biome so paths don't change the ground.
    const pathUnder = {};
    const rng = makeRng(tx * HASH_MUL_X ^ ty * HASH_MUL_Y);

    // Helper: spawn debris within a polygon's rings at the polygon's own stable density.
    // density seed = polygon centroid → stable across reloads.
    // Each debris snaps to the CENTER of its 5m game cell (no jitter), and is keyed
    // by the cell's absolute (cellIX, cellIY) so the same cell is always the same id.
    function spawnDebris(rings, crop, polyKey, dMin = DEBRIS_MIN, dMax = DEBRIS_MAX) {
      const prng = makeRng(polyKey);
      const density = dMin + prng() * (dMax - dMin);
      const bb = bboxOf(rings);
      const stepMvt = 5 / mvtToM; // one candidate per game-cell-width
      for (let yy = bb.minY; yy <= bb.maxY; yy += stepMvt) {
        for (let xx = bb.minX; xx <= bb.maxX; xx += stepMvt) {
          if (!pointInRings(rings, xx + stepMvt * 0.5, yy + stepMvt * 0.5)) continue;
          // Snap to this tile's local cell grid (no absolute-cells drift).
          const localIX = Math.floor(xx * mvtToCell);
          const localIY = Math.floor(yy * mvtToCell);
          if (localIX < 0 || localIY < 0 || localIX >= w || localIY >= h) continue;
          // Absolute world meters for game positioning — at the local cell center.
          const { mx: cx, my: cy } = cellCenterMeters(localIX, localIY);
          if (prng() < density) {
            // Stash local ix/iy on the wp so the post-pass filter can read grid[] directly.
            wildplants.push({ x: cx, y: cy, crop, _ix: localIX, _iy: localIY,
              id: `wp_${tx}_${ty}_${localIX}_${localIY}` });
          }
        }
      }
    }

    // Structured "hedge maze" spawner — used for commercial-plaza shrubs so they
    // read as a neat clipped hedge maze instead of random scatter. Placement is
    // deterministic on ABSOLUTE cell coords (continuous across polygons + tiles),
    // on a period-3 lattice:
    //   • pillars   (ax%3==0 && ay%3==0)            → always a hedge cell
    //   • wall cells (one coord %3==0, the other not) → a hedge IFF that wall
    //                 segment "exists" (a stable per-segment coin flip); both
    //                 cells of a 2-cell wall share the segment id so a wall is
    //                 contiguous and the gaps read as passages.
    //   • interior  (neither coord %3==0)            → never a hedge (open path)
    // ~25% of cells end up hedged (1/9 pillars + ~30% of the 4/9 wall cells).
    function spawnHedgeMaze(rings, crop, salt) {
      const P = 3;                 // lattice period (cells between pillars)
      const WALL_PCT = 30;         // % of wall segments that exist → ~25% fill
      const bb = bboxOf(rings);
      const ix0 = Math.max(0, Math.floor(bb.minX * mvtToCell));
      const iy0 = Math.max(0, Math.floor(bb.minY * mvtToCell));
      const ix1 = Math.min(w - 1, Math.floor(bb.maxX * mvtToCell));
      const iy1 = Math.min(h - 1, Math.floor(bb.maxY * mvtToCell));
      const wallOn = (sx, sy, k) => {
        const hsh = (((sx * 73856093) ^ (sy * 19349663) ^ (k * 83492791) ^ salt) >>> 0);
        return (hsh % 100) < WALL_PCT;
      };
      for (let iy = iy0; iy <= iy1; iy++) {
        for (let ix = ix0; ix <= ix1; ix++) {
          // Cell centre in MVT units for the inside-polygon test.
          if (!pointInRings(rings, (ix + 0.5) / mvtToCell, (iy + 0.5) / mvtToCell)) continue;
          const ax = tx * w + ix, ay = ty * h + iy;     // absolute cell coords
          const mx3 = ((ax % P) + P) % P;
          const my3 = ((ay % P) + P) % P;
          let hedge;
          if (mx3 === 0 && my3 === 0) hedge = true;                                   // pillar
          else if (my3 === 0 && mx3 !== 0) hedge = wallOn(Math.floor(ax / P), ay, 0); // horizontal wall
          else if (mx3 === 0 && my3 !== 0) hedge = wallOn(ax, Math.floor(ay / P), 1); // vertical wall
          else hedge = false;                                                          // open interior
          if (!hedge) continue;
          const { mx: cx, my: cy } = cellCenterMeters(ix, iy);
          wildplants.push({ x: cx, y: cy, crop, _ix: ix, _iy: iy,
            id: `hm_${tx}_${ty}_${ix}_${iy}` });
        }
      }
    }

    // mvt(x,y) within this tile -> ABSOLUTE world meters (anchor: tile(0,0) NW corner at z14).
    const tileOriginMx = tx * tileEdgeM;
    const tileOriginMy = ty * tileEdgeM;
    const toMeters = (mx, my) => ({
      x: tileOriginMx + mx * mvtToM,
      y: tileOriginMy + my * mvtToM,
    });

    // Local-cell index (ix, iy) -> absolute world-meter coordinates of that
    // cell's CENTRE. Same arithmetic the grid/snapCell/object placement all
    // share; extracted so the byte-identical expression isn't repeated ~7×.
    const cellCenterMeters = (ix, iy) => ({
      mx: tileOriginMx + (ix + 0.5) * (1 / mvtToCell) * mvtToM,
      my: tileOriginMy + (iy + 0.5) * (1 / mvtToCell) * mvtToM,
    });
    // Snap an mvt-space point to THIS tile's local cell grid — the same grid
    // the terrain `grid[]` and wildplants (spawnDebris) already use. Every placed object must share this one grid: structs
    // (trees / rocks / fruit trees / houses) used to snap to a GLOBAL 5 m grid
    // anchored at the world origin, which is offset from this tile-local grid
    // by a sub-cell fraction. That misalignment meant a tree and a wildplant
    // sitting in the "same" spot could quantise into different occupancy cells,
    // so the unified occupancy pass failed to dedupe them and both survived.
    // Local cells are also fully contained within the tile (indices 0..w/h-1),
    // so no two tiles ever emit an object for the same physical cell.
    const snapCell = (mx, my) => {
      const ix = Math.floor(mx * mvtToCell);
      const iy = Math.floor(my * mvtToCell);
      const { mx: cx, my: cy } = cellCenterMeters(ix, iy);
      return { ix, iy, cx, cy };
    };

    const order = ['landcover', 'landuse', 'park', 'water', 'waterway', 'transportation', 'building', 'poi'];
    const layersByName = {};
    for (const l of layers) layersByName[l.name] = l;

    for (const name of order) {
      const layer = layersByName[name];
      if (!layer) continue;
      // Building rings get COLLECTED first, then re-tiered against the
      // tile's full distribution before any painting happens. Painting
      // ring-by-ring (the old behaviour) made the per-tile-floor pass
      // impossible because by the time we knew the counts, the grid was
      // already coloured. So: collect → enforce mins → paint + objectify.
      const buildingPolys = [];
      for (const f of layer.features) {
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
              paintPolygon(grid, w, h, f.geom, T.WATER, mvtToCell);
            } else if (t != null) {
              paintPolygon(grid, w, h, f.geom, t, mvtToCell);
            }

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
              const target = Math.min(100, Math.max(5, Math.floor(areaM2 / 25)));
              const rng2 = makeRng((polyKey ^ 0xC0FFEE57) >>> 0);   /* fixed salt — different from longgrass / nut streams */
              let placed = 0, attempts = 0;
              while (placed < target && attempts < target * 6) {
                attempts++;
                const jx = bb.minX + rng2() * (bb.maxX - bb.minX);
                const jy = bb.minY + rng2() * (bb.maxY - bb.minY);
                if (!pointInRings(f.geom, jx, jy)) continue;
                const { cx, cy } = snapCell(jx, jy);
                // Cheap quarry rock. Roll a YIELD tier (mostly T1, occasional
                // T2/T3 for variety) and DERIVE the pick requirement from it —
                // the same single-field model the cluster spawner uses (see
                // _pushMineralrock above). yieldTier drives the sprite, the
                // metal drop, AND the required pick together, so the rock can't
                // look like one tier but pay out another. (Previously this set
                // requiredTier directly and left yieldTier undefined, so the
                // mining code's `yieldTier || 1` fallback always dropped copper
                // while the sprite/pick used the higher requiredTier — the
                // "looks like iron, needs an iron pick, drops copper" bug.)
                const r = rng2();
                const yieldTier = r < 0.05 ? 3 : r < 0.15 ? 2 : 1;
                const requiredTier = Math.max(1, yieldTier - 1);
                objects.push({ kind: 'mineralrock', x: cx, y: cy, requiredTier, yieldTier,
                  id: `rb_${tx}_${ty}_${Math.round(cx)}_${Math.round(cy)}` });
                placed++;
              }
            }

            // Per-biome wild flora / debris — driven by the central
            // BIOME_PROFILES registry (src/biome_profiles.js), the single
            // source of truth for "what grows here". Each biome lists its flora
            // kinds with a density window + an independent RNG salt; `dynamic`
            // entries (longgrass-style) get a stable per-polygon density in
            // [0, dMax] so most polygons grow a tuft, big areas cluster, and the
            // unlucky few grow nothing. Unwired/unknown biomes fall back to
            // their base-family profile, so no walkable zone is ever barren.
            for (const fl of BiomeProfiles.flora(t)) {
              const seed = (polyKey ^ (fl.salt >>> 0)) >>> 0;
              if (fl.pattern === 'hedgemaze') {
                // Deterministic clipped-hedge-maze layout (commercial plazas) —
                // keyed on absolute cell coords so the maze is continuous across
                // polygons/tiles, not a per-polygon scatter.
                spawnHedgeMaze(f.geom, fl.crop, fl.salt >>> 0);
              } else if (fl.dynamic) {
                const density = ((seed % 1000) / 1000) * fl.dMax;
                if (density > 0) spawnDebris(f.geom, fl.crop, seed, density, density);
              } else {
                spawnDebris(f.geom, fl.crop, seed, fl.dMin, fl.dMax);
              }
            }

            // Scattered Trees on wood/forest landcover. Each polygon picks ONE
            // species (maple/pine/birch/mahogany) so a single forest reads as a
            // single woodland type instead of a jumbled mix. Each species has
            // its own real sprite sheet (no tint pass needed).
            if (name === 'landcover') {
              const cls = f.tags.class || f.tags.subclass;
              if (cls === 'wood' || cls === 'forest') {
                const TREE_SPECIES = ['maple', 'pine', 'birch', 'mahogany'];
                const species = TREE_SPECIES[(polyKey >>> 8) % TREE_SPECIES.length];
                const bb = bboxOf(f.geom);
                const stepMvt = 8 / mvtToM; // ~one candidate per 8m
                for (let yy = bb.minY; yy <= bb.maxY; yy += stepMvt) {
                  for (let xx = bb.minX; xx <= bb.maxX; xx += stepMvt) {
                    const jx = xx + (rng() - 0.5) * stepMvt;
                    const jy = yy + (rng() - 0.5) * stepMvt;
                    if (pointInRings(f.geom, jx, jy)) {
                      // Snap to the tile cell grid (shared with rocks/wildplants/
                      // flora) so the occupancy pass can dedupe — and it keeps the
                      // forest from looking jittery.
                      const { cx, cy } = snapCell(jx, jy);
                      // Stable per-cell id so chop tracking can target an
                      // individual tree. Pre-fix, every forest tree spawned
                      // with `id === undefined`; pushing one undefined into
                      // save.chopped made `choppedSet.has(undefined)` match
                      // every other tree → felling one cleared the grove.
                      objects.push({ kind: 'tree', x: cx, y: cy,
                        variant: 1 + Math.floor(rng() * 4),
                        // Trees near the start are softwood (home.js) for easy early wood.
                        species: (typeof HomeArea !== 'undefined')
                          ? HomeArea.softwoodSpeciesNear(cx, cy, species) : species,
                        id: `tree_${Math.round(cx)}_${Math.round(cy)}` });
                    }
                  }
                }
                // (Forest mushrooms + woodland flowers now spawn via the
                // BIOME_PROFILES flora loop above — see the FOREST profile in
                // src/biome_profiles.js.)
              }
              // Fruit trees on ORCHARD landcover. One species per polygon so a single
              // orchard reads as one fruit type.
              if (cls === 'orchard' || f.tags.subclass === 'orchard') {
                // Only two fruit-tree species are available in the world now:
                // common apple, rare peach. Peach is 6x as rare → 1 orchard
                // polygon in 7 is peach. One species per orchard polygon.
                const FRUIT_SPECIES = ((polyKey >>> 8) % 7 === 0) ? ['peach'] : ['apple'];
                const speciesIdx = (polyKey >>> 8) % FRUIT_SPECIES.length;
                const species = FRUIT_SPECIES[speciesIdx];
                const bb = bboxOf(f.geom);
                const stepMvt = 13 / mvtToM; // one fruit tree per ~13m — planted feel
                for (let yy = bb.minY; yy <= bb.maxY; yy += stepMvt) {
                  for (let xx = bb.minX; xx <= bb.maxX; xx += stepMvt) {
                    if (!pointInRings(f.geom, xx + stepMvt * 0.5, yy + stepMvt * 0.5)) continue;
                    const { ix, iy, cx, cy } = snapCell(xx + stepMvt * 0.5, yy + stepMvt * 0.5);
                    objects.push({ kind: 'fruittree', x: cx, y: cy, species,
                      id: `ft_${tx}_${ty}_${ix}_${iy}` });
                  }
                }
              }
            }

            // Mineralrock cluster spawner — shared between RESIDENTIAL,
            // INDUSTRIAL, and ROCK passes. Each rock in a cluster is rolled
            // independently:
            //   70 % → plain CAVE rock (no ore, T1 pick suffices).
            //          Renders as one of the bottom-row sprite variants in
            //          stone with minerals.png. Drops 1-3 rockfruit.
            //   30 % → ORE rock. Tier picked from the caller's tierW table
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
            const _CAVE_VARIANTS = 4;        // row 15 cols 3..6 — see render.js
            // NOTE: we used to do an inline "blocked cell" / "near road"
            // check here, but it was racy — the MVT polygon loop processes
            // roads, buildings, and landuse in feature-order, so a
            // residential polygon's mineralrock spawn might see a grid
            // where roads haven't been painted yet. The cleanup pass at
            // the end of the feature loop (search for "Post-pass:
            // mineralrock cleanup") walks the finished grid and drops any
            // rock on a blocked cell, plus any residential rock not
            // adjacent to a road. Just spawn here; the filter handles
            // correctness.
            const _pushMineralrock = (rng, jx, jy, tierW, totalW, residential, clusterId) => {
              if (!pointInRings(f.geom, jx, jy)) return;
              const { cx, cy } = snapCell(jx, jy);
              if (rng() < _CAVE_ROCK_P) {
                const caveVariant = Math.floor(rng() * _CAVE_VARIANTS);
                objects.push({ kind: 'mineralrock', x: cx, y: cy, requiredTier: 1,
                  caveVariant, _residential: residential || undefined,
                  _clusterId: clusterId,
                  id: `mr_${tx}_${ty}_${Math.round(cx)}_${Math.round(cy)}` });
                return;
              }
              const r = rng() * totalW;
              let yieldTier = 7;
              for (let i = 0; i < tierW.length; i++) {
                if (r <= tierW[i]) { yieldTier = i + 1; break; }
              }
              const requiredTier = Math.max(1, yieldTier - 1);
              objects.push({ kind: 'mineralrock', x: cx, y: cy, requiredTier, yieldTier,
                _residential: residential || undefined,
                id: `mr_${tx}_${ty}_${Math.round(cx)}_${Math.round(cy)}` });
            };

            // Turn a list of per-tier weights into a cumulative table + total,
            // as _pushMineralrock's tier roll expects.
            const cumWeights = (weights) => {
              const tierW = []; let totalW = 0;
              for (const w of weights) { totalW += w; tierW.push(totalW); }
              return { tierW, totalW };
            };

            // Scatter mineralrock clusters across a polygon's bbox. At each pivot
            // on a `pivotStep` grid that lies inside the polygon, fire a cluster
            // with probability `fireChance`; each cluster drops
            // clusterMin..clusterMin+clusterSpan-1 rocks jittered within `clusterR`
            // of the pivot, routed through _pushMineralrock. RNG draw order is
            // identical to the old inline loops (fire roll, count roll, then jx/jy
            // per rock) so world seeds reproduce exactly.
            //
            // VEINS: if the caller supplies `veinChance` + raw `weights`, each
            // fired cluster rolls once more; on a hit it becomes a "vein" — one
            // randomly chosen tier has its weight multiplied by `veinMul` (10×)
            // for that cluster only. This concentrates a single ore/crystal in
            // a few clusters (the veins) without shifting the global rarity much,
            // since the 70 % cave-rock split is untouched and the random tier
            // pick spreads the boost across all tiers over many clusters. The
            // extra rng() draws happen only when `veinChance` is set, so callers
            // that don't pass it (industrial, ROCK) reproduce their seeds exactly.
            const _spawnRockClusters = (rng, geom, o) => {
              const bb = bboxOf(geom);
              const veinMul = o.veinMul || 10;
              for (let yy = bb.minY; yy <= bb.maxY; yy += o.pivotStep) {
                for (let xx = bb.minX; xx <= bb.maxX; xx += o.pivotStep) {
                  if (!pointInRings(geom, xx + o.pivotStep * 0.5, yy + o.pivotStep * 0.5)) continue;
                  if (rng() > o.fireChance) continue;
                  const clusterN = o.clusterMin + Math.floor(rng() * o.clusterSpan);
                  // Per-cluster tier table — defaults to the shared one, but a
                  // vein cluster gets a fresh table with one tier boosted 10×.
                  let tierW = o.tierW, totalW = o.totalW;
                  if (o.veinChance && o.weights && rng() < o.veinChance) {
                    const veinTier = Math.floor(rng() * o.weights.length);
                    const boosted = o.weights.slice();
                    boosted[veinTier] *= veinMul;
                    ({ tierW, totalW } = cumWeights(boosted));
                  }
                  // Stable id for this cluster (residential only) so the cave
                  // entrance pass can roll a per-cluster chance over its rocks.
                  const clusterId = o.residential
                    ? `rc_${tx}_${ty}_${Math.round(xx)}_${Math.round(yy)}`
                    : undefined;
                  for (let k = 0; k < clusterN; k++) {
                    const jx = xx + (rng() - 0.5) * 2 * o.clusterR;
                    const jy = yy + (rng() - 0.5) * 2 * o.clusterR;
                    _pushMineralrock(rng, jx, jy, tierW, totalW, o.residential, clusterId);
                  }
                }
              }
            };

            // Residential mineral clusters — abandoned-yard / construction
            // piles in town. Pivot grid is ~24 m and ~59 % of candidates fire,
            // so a residential polygon spawns a handful of clusters; each is a
            // group of low-tier rocks within ~7 m. Gives the early game a
            // reliable urban source of stone + low-tier ore. ~30 % of clusters
            // are "veins" with one ore/crystal tier concentrated 10× (see the
            // vein path in _spawnRockClusters) without flooding sidewalks.
            if (t === T.RESIDENTIAL) {
              const resRng = makeRng((polyKey ^ 0xFA11) >>> 0);
              const pivotStep = 24 / mvtToM;        // one cluster candidate per ~24 m
              const clusterR  = 7  / mvtToM;        // rocks placed within ~7 m of pivot
              // Tier weights for the ORE subset (the share that isn't plain
              // cave rock — caveRockP(0) ⇒ ~90 % plain on the surface). Copper
              // is T2 at weight 0.25 of the subset, so copper-bearing rock is
              // ~0.10 × 0.25 ≈ 2.5 % of all surface rocks. Underground the same
              // shape is reused with a smaller plain fraction (richer with
              // depth) but plain rock always stays the majority (see caveRockP).
              const weights = [0.30, 0.25, 0.22, 0.08, 0.07, 0.05, 0.03];
              const { tierW, totalW } = cumWeights(weights);
              // 25..40 rocks per cluster: residential rocks survive the
              // road-adjacency filter at a lower rate, so input must overshoot.
              // fireChance 0.585 = 0.45 × 1.3 → 30 % more clusters than before.
              // veinChance 0.30: ~30 % of clusters become a "vein" where one
              // random tier is 10× more likely (see _spawnRockClusters). Pass
              // the raw `weights` so the vein path can rebuild a boosted table.
              _spawnRockClusters(resRng, f.geom, {
                pivotStep, clusterR, fireChance: 0.585,
                clusterMin: 25, clusterSpan: 16, tierW, totalW, residential: true,
                weights, veinChance: 0.30, veinMul: 10 });
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
              const pivotStep = 14 / mvtToM;        // ~one candidate per 14 m — much denser than residential's 30
              const clusterR  = 5  / mvtToM;        // ~5 m cluster radius
              // Slower tier dropoff than residential — mid-tier ore (gold,
              // platinum) shows up regularly while T7 stays ~3 % per ore pick.
              const { tierW, totalW } = cumWeights(
                Array.from({ length: 7 }, (_, i) => 1 / Math.pow(1.6, i)));
              // 80 % fire — "lots"; 18..33 rocks per cluster (3× the prior 6..11).
              _spawnRockClusters(indRng, f.geom, {
                pivotStep, clusterR, fireChance: 0.80,
                clusterMin: 18, clusterSpan: 16, tierW, totalW });
            }

            // Dense mineral rock clusters on ROCK terrain (scree / cliff landcover).
            // Cluster style mirrors residential but at higher density — tight 12 m
            // pivot grid, 70 % fire rate, 10-19 rocks per cluster. Tier weights use
            // a steeper geometric decay than industrial so low-tier stones dominate
            // but rare wilderness finds (T5-T7) are still possible.
            if (t === T.ROCK) {
              const rockRng = makeRng((polyKey ^ 0xCAFE) >>> 0);
              const pivotStep = 12 / mvtToM;
              const clusterR  =  6 / mvtToM;
              // 1/2^(t-1): T1 ~50%, T2 ~25%, T3 ~13% … T7 ~1% of ore subset.
              // _pushMineralrock still routes 70% of picks to cave rock.
              const { tierW, totalW } = cumWeights(
                Array.from({ length: 7 }, (_, i) => 1 / Math.pow(2, i)));
              _spawnRockClusters(rockRng, f.geom, {
                pivotStep, clusterR, fireChance: 0.70,
                clusterMin: 10, clusterSpan: 10, tierW, totalW });
            }
          }
        } else if (f.type === 2 && name === 'transportation') {
          const t = classifyLine(name, f.tags);
          if (t == null) continue;
          const wCells = Math.max(1, Math.round(roadWidthM(f.tags) / CELL_M));
          // Only PATH records its under-biome — roads/piers fully cover their
          // cell so the base never shows, and skipping them keeps pathUnder small.
          const under = t === T.PATH ? pathUnder : undefined;
          for (const line of f.geom) paintLine(grid, w, h, line, t, wCells, mvtToCell, under);
        } else if (f.type === 2 && name === 'waterway') {
          // Streams / rivers / drains carve a 1–2 cell line of WATER. Rivers
          // get 2 cells wide, streams + drains stay at 1 — this lets the
          // bigger named waterways read as something you'd swim across vs a
          // narrow ditch you can almost step over.
          const cls = f.tags.class || '';
          if (cls === 'stream' || cls === 'river' || cls === 'drain' || cls === 'canal') {
            const wCells = cls === 'river' || cls === 'canal' ? 2 : 1;
            for (const line of f.geom) paintLine(grid, w, h, line, T.WATER, wCells, mvtToCell);
          }
        } else if (f.type === 1 && name === 'poi') {
          // POI points → a generic chest (single sprite, no themed subkinds).
          // Only spawn for "useful" POI classes.  Parking POIs are diverted to treasure marks instead.
          const cls = f.tags.class || '';
          const USEFUL = new Set([
            // food / commerce (chest drops PRODUCE for food; SEEDS for commerce)
            'restaurant','cafe','fast_food','grocery','butcher','ice_cream',
            'alcohol_shop','beer','bakery','shop',
            'supermarket','convenience','farm',
            // specialty shops — themed loot via shopCategory()
            'florist','garden_centre','books','pet','fountain',
            // civic / attractions
            'attraction','museum','library','town_hall','memorial',
            'pharmacy','hospital','dentist',
            'place_of_worship','school','college',
            'park','garden','playground','pitch',
            // low-tier street furniture: heavy T1 seed drops
            'bus','fuel','lodging','gate',
            // ── New batch — daily-tap civic services (lowtier)
            'waste_basket','post','recycling','drinking_water','toilets',
            // ── Athletic facilities (park-class chests)
            'sports_centre','yoga','swimming','swimming_pool','bowls',
            'running','ice_rink','stadium',
            // ── Restful shelters (lowtier chest + safe rest spot)
            'shelter','dog_park','picnic_site',
            // ── Cultural plaques (civic chests)
            'art_gallery','information','monument','cemetery','cinema','theatre',
            // ── Authority buildings (civic chests, high-tier feel)
            'police','fire_station','harbor',
            // ── Bike-related: bicycle_parking + atm get the COIN-BURST
            // mechanic via a separate render path (see render.js); they
            // still spawn as objects here so cross-tile dedupe + persistent
            // ids work. (motorcycle_parking is NOT here — like car parking it's
            // diverted to a buried-treasure X below, not a chest.)
            'bicycle_parking','atm',
          ]);
          // Snap POI-derived features to the LOCAL-TILE cell centre — same basis the
          // grid uses (tileEdgeM/cellsPerEdge, which differs slightly from 5m). This
          // matches `offsetForPlacement` and `cellAt()`, so the chest's stored x/y
          // agrees with grid lookups instead of drifting by sub-meter per cell.
          const cellWidthM = tileEdgeM / w;   // w === cellsPerEdge
          const snap = (v) => {
            // Project v back into the tile's local cell index, then expand to cell-centre.
            const origin = (v === undefined) ? 0 : Math.floor(v / tileEdgeM) * tileEdgeM;
            const localCell = Math.floor((v - origin) / cellWidthM);
            return origin + (localCell + 0.5) * cellWidthM;
          };
          if (cls === 'parking' || cls === 'motorcycle_parking') {
            // Car + motorcycle parking → guaranteed treasure X (no chest).
            for (const ring of f.geom) {
              const p = ring[0];
              const m = toMeters(p.x, p.y);
              const cx = snap(m.x), cy = snap(m.y);
              parkingTreasures.push({ x: cx, y: cy, id: `t_park_${Math.round(cx)}_${Math.round(cy)}` });
            }
            continue;
          }
          if (!USEFUL.has(cls)) continue;
          // "Park family" POIs synthesize a small park buffer (radius ~18m) around the point
          // so they read as proper meadows / woodland even when OSM hasn't tagged park
          // landcover here. We paint over residential/grass/etc but NEVER over roads,
          // water, or buildings — those keep their cells.
          const PARK_FAMILY = new Set(['park','garden','playground','pitch']);
          // Big indoor civic facilities — rec centres, arenas, ice rinks. OSM
          // often maps these as a leisure AREA with no building=* footprint, so
          // the vector data carries only the POI point and nothing reads as a
          // building. Synthesize a civic BUILDING_LARGE block at the POI so the
          // facility actually shows as a structure (the same slate slab schools
          // and malls render as). Excludes outdoor pools (swimming/swimming_pool
          // become water elsewhere).
          const CIVIC_BUILDING = new Set(['sports_centre','ice_rink','stadium']);
          for (const ring of f.geom) {
            const p = ring[0];
            const m = toMeters(p.x, p.y);
            const cx = snap(m.x), cy = snap(m.y);
            const id = `c_${Math.round(cx)}_${Math.round(cy)}`;
            objects.push({ kind: 'chest', x: cx, y: cy, id,
              poiClass: cls, name: f.tags.name || '' });
            // Synthesized concrete-pad terrain around the POI, in a per-class SHAPE.
            // Building polygons are independent of POIs and never overpainted: if the POI
            // point lands on or right next to a building, slide it to the nearest non-
            // building cell — preferring one next to a road/path (so the player can
            // actually reach the chest).
            const KEEP = new Set([T.WATER, T.ROAD, T.PATH, T.BUILDING, T.BUILDING_MED, T.BUILDING_LARGE, T.ROAD_LG, T.ROAD_MD]); // 3, 7, 8, 9, 11, 12, 13, 14: water, roads, path, all buildings
            const BUILDING = (gt) => gt === T.BUILDING || gt === T.BUILDING_MED || gt === T.BUILDING_LARGE;
            const ROAD_OR_PATH = (gt) => gt === T.ROAD || gt === T.ROAD_MD || gt === T.ROAD_LG || gt === T.PATH;
            const cellIdxOf = (ix, iy) => iy * w + ix;
            // Find a placement that isn't inside a building, preferring cells adjacent to a road/path.
            function offsetForPlacement(startIx, startIy) {
              const inb = (ix, iy) => ix >= 0 && iy >= 0 && ix < w && iy < h;
              const initialOk = inb(startIx, startIy) && !BUILDING(grid[cellIdxOf(startIx, startIy)]);
              if (initialOk) {
                // Even if not on a building, prefer a tile that's adjacent to a road for reachability.
                let hasRoad = false;
                for (let ddy = -1; ddy <= 1 && !hasRoad; ddy++)
                  for (let ddx = -1; ddx <= 1 && !hasRoad; ddx++)
                    if (inb(startIx + ddx, startIy + ddy) && ROAD_OR_PATH(grid[cellIdxOf(startIx + ddx, startIy + ddy)]))
                      hasRoad = true;
                if (hasRoad) return { ix: startIx, iy: startIy };
              }
              // Spiral search up to radius 6 for a non-building cell, scored by:
              //   + adjacent to road/path  (most important — reachability)
              //   - distance from original POI                (keep close)
              let best = null, bestScore = -Infinity;
              for (let r = 0; r <= 6; r++) {
                for (let dy = -r; dy <= r; dy++) {
                  for (let dx = -r; dx <= r; dx++) {
                    // Iterate only the ring at this radius (Chebyshev)
                    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
                    const ix = startIx + dx, iy = startIy + dy;
                    if (!inb(ix, iy)) continue;
                    const gt = grid[cellIdxOf(ix, iy)];
                    if (BUILDING(gt) || gt === T.WATER) continue;
                    let nearRoad = false;
                    for (let ddy = -2; ddy <= 2 && !nearRoad; ddy++)
                      for (let ddx = -2; ddx <= 2 && !nearRoad; ddx++)
                        if (inb(ix + ddx, iy + ddy) && ROAD_OR_PATH(grid[cellIdxOf(ix + ddx, iy + ddy)]))
                          nearRoad = true;
                    const score = (nearRoad ? 1000 : 0) - r;
                    if (score > bestScore) { bestScore = score; best = { ix, iy }; }
                  }
                }
                if (best && bestScore >= 1000 - r) break; // found a road-adjacent cell, take it
              }
              return best || { ix: startIx, iy: startIy };
            }
            let cellIX = Math.floor(p.x * mvtToCell);
            let cellIY = Math.floor(p.y * mvtToCell);

            // If the POI is INSIDE a building polygon, dissolve that building into a plain
            // concrete pad: remove the house sprite, leave the BUILDING_LARGE cells as-is
            // (they already read as cement), and skip both the placement-offset and the
            // synthesized pad shape — the building's footprint becomes the POI's pad.
            const initialIdx = cellIY * w + cellIX;
            const onBuilding = cellIX >= 0 && cellIY >= 0 && cellIX < w && cellIY < h
              && BUILDING(grid[initialIdx]);
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
                  if (BUILDING(grid[nidx])) { seen.add(nidx); stack.push([nx, ny]); }
                }
              }
              // Remove every house sprite whose centroid falls inside the dissolved footprint.
              // A school/mall is often several adjacent building polygons, each of which pushed
              // its own house sprite — removing only the nearest leaves the others on the pad.
              for (let i = objects.length - 1; i >= 0; i--) {
                const o = objects[i];
                if (o.kind !== 'house') continue;
                const ox = Math.floor((o.x - tileOriginMx) / mvtToM * mvtToCell);
                const oy = Math.floor((o.y - tileOriginMy) / mvtToM * mvtToCell);
                if (ox < 0 || oy < 0 || ox >= w || oy >= h) continue;
                if (seen.has(oy * w + ox)) objects.splice(i, 1);
              }
              // Public-facing chest placement. Most civic buildings are closed to the
              // public (school hours, hospital wings, etc.) — dropping the chest deep
              // inside the slab forces players to "enter" the building. Instead, find
              // the perimeter cell nearest the closest road/path and put the chest
              // there: it reads as the building's entrance / sidewalk frontage.
              const ROADISH = new Set([T.PATH, T.ROAD, T.ROAD_MD, T.ROAD_LG]);
              let nearRoad = null, bestRoadD = 60 * 60;
              for (let dy = -60; dy <= 60; dy++) for (let dx = -60; dx <= 60; dx++) {
                const ix = cellIX + dx, iy = cellIY + dy;
                if (ix<0||iy<0||ix>=w||iy>=h) continue;
                if (!ROADISH.has(grid[iy * w + ix])) continue;
                const d2 = dx*dx + dy*dy;
                if (d2 < bestRoadD) { bestRoadD = d2; nearRoad = { ix, iy }; }
              }
              let finalIX = cellIX, finalIY = cellIY;
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
                if (bestPerim) { finalIX = bestPerim.ix; finalIY = bestPerim.iy; }
              }
              const { mx: adjustedMx, my: adjustedMy } = cellCenterMeters(finalIX, finalIY);
              const lastChest = objects[objects.length - 1];
              if (lastChest && lastChest.kind === 'chest' && lastChest.id === id) {
                lastChest.x = adjustedMx; lastChest.y = adjustedMy;
                lastChest.id = `c_${Math.round(adjustedMx)}_${Math.round(adjustedMy)}`;
              }
            } else {
              // Civic facility with no building footprint in the data: stamp a
              // BUILDING_LARGE block (~9×7 cells ≈ 45×35 m) centred on the POI so
              // it reads as a real building. Painted BEFORE the road-edge offset
              // so offsetForPlacement below pushes the chest off the new block to
              // a reachable, road-facing cell — the facility's entrance. KEEP
              // cells (roads / water / existing buildings) are never overwritten.
              if (CIVIC_BUILDING.has(cls)) {
                const halfW = 4, halfH = 3;
                for (let ddy = -halfH; ddy <= halfH; ddy++) {
                  for (let ddx = -halfW; ddx <= halfW; ddx++) {
                    const bx = cellIX + ddx, by = cellIY + ddy;
                    if (bx < 0 || by < 0 || bx >= w || by >= h) continue;
                    const bidx = by * w + bx;
                    if (KEEP.has(grid[bidx])) continue;
                    grid[bidx] = T.BUILDING_LARGE;
                  }
                }
              }
              // POI is on open ground — apply road-edge offset and synthesize a pad shape.
              const placement = offsetForPlacement(cellIX, cellIY);
              cellIX = placement.ix;
              cellIY = placement.iy;
              const { mx: adjustedMx, my: adjustedMy } = cellCenterMeters(cellIX, cellIY);
              const lastChest = objects[objects.length - 1];
              if (lastChest && lastChest.kind === 'chest' && lastChest.id === id) {
                lastChest.x = adjustedMx; lastChest.y = adjustedMy;
                lastChest.id = `c_${Math.round(adjustedMx)}_${Math.round(adjustedMy)}`;
              }
            }
            // No synthesized pad when the POI dissolved a building (the building IS the pad).
            if (!onBuilding) {
              if (PARK_FAMILY.has(cls)) {
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
              } else if (cls === 'school' || cls === 'college' || cls === 'university') {
                const arr = [];
                const rows = [1, 3, 5, 7];
                for (let r = 0; r < rows.length; r++) {
                  const half = (rows[r] - 1) / 2;
                  for (let dx = -half; dx <= half; dx++) arr.push([dx, r]);
                }
                shapeOffsets = arr;
                padType = T.COMMERCIAL;
              }
            }
            if (shapeOffsets) {
              const poiKey = ((Math.round(cx) * HASH_MUL_X) ^ (Math.round(cy) * HASH_MUL_Y)) >>> 0;
              const prng = makeRng(poiKey ^ 0xfade5a17);
              const shrubDensity = 0.18;
              const longgrassDensity = 0.10;
              for (const [dx, dy] of shapeOffsets) {
                const ix = cellIX + dx, iy = cellIY + dy;
                if (ix < 0 || iy < 0 || ix >= w || iy >= h) continue;
                const idx = iy * w + ix;
                if (KEEP.has(grid[idx])) continue;
                grid[idx] = padType;
                if (spawnGreenery) {
                  const r1 = prng(), r2 = prng();
                  const { mx: cellCenterMx, my: cellCenterMy } = cellCenterMeters(ix, iy);
                  if (r1 < shrubDensity) {
                    wildplants.push({ x: cellCenterMx, y: cellCenterMy, crop: 'shrub',
                      _ix: ix, _iy: iy, id: `wp_${tx}_${ty}_${ix}_${iy}_pp` });
                  } else if (r2 < longgrassDensity) {
                    wildplants.push({ x: cellCenterMx, y: cellCenterMy, crop: 'longgrass',
                      _ix: ix, _iy: iy, id: `wp_${tx}_${ty}_${ix}_${iy}_pl` });
                  }
                }
              }
            }
          }
        }
      }
      // Building distribution post-process — runs ONCE per layer, but only
      // does work when this layer is 'building'. After collecting every
      // building ring (above), enforce the per-tile floors (≥20% small,
      // ≥8% fort, ≥2% castle) by re-tiering by area-rank where needed.
      // Then paint + push house objects (LARGE gets a cement pad with no
      // sprite; everything else gets a 'house' object).
      if (name === 'building' && buildingPolys.length) {
        enforceBuildingDistribution(buildingPolys);
        for (const bp of buildingPolys) {
          paintPolygon(grid, w, h, [bp.ring], bp.tier, mvtToCell);
          // Civic / industrial slabs (schools / malls / hospitals) read as a
          // cement pad — a residential house roof on top of one looks wrong,
          // so skip the sprite.
          if (bp.tier === T.BUILDING_LARGE) continue;
          // Anchor the house on its RASTERIZED FOOTPRINT (the tiles it's painted
          // on), not the geometric ring centroid: take the footprint cells'
          // centroid, then pick the footprint cell nearest it. This guarantees
          // the sprite's bottom-middle sits on an actual building tile even for
          // L-shaped / tile-clipped footprints (where the ring centroid can land
          // off the block). Snapping to a cell also keeps the occupancy pass and
          // row alignment working.
          const fpCells = ringFootprintCells(bp.ring, mvtToCell, w, h);
          let cx, cy;
          if (fpCells.length) {
            let sxc = 0, syc = 0;
            for (const [fx, fy] of fpCells) { sxc += fx + 0.5; syc += fy + 0.5; }
            const ccx = sxc / fpCells.length, ccy = syc / fpCells.length;
            let best = fpCells[0], bd = Infinity;
            for (const [fx, fy] of fpCells) {
              const ex = fx + 0.5 - ccx, ey = fy + 0.5 - ccy, d = ex * ex + ey * ey;
              if (d < bd) { bd = d; best = [fx, fy]; }
            }
            const cc = cellCenterMeters(best[0], best[1]);
            cx = cc.mx; cy = cc.my;
          } else {
            // Degenerate footprint (covers no cell centre) — fall back to the
            // ring centroid snapped to the grid.
            const c = ringCentroid(bp.ring);
            const s = snapCell(c.x, c.y);
            cx = s.cx; cy = s.cy;
          }
          // The address (→ shop type) stays keyed to the GLOBAL cell of the
          // house's chosen position so its shop role is stable across reloads.
          const ix = Math.floor(cx / CELL_M);
          const iy = Math.floor(cy / CELL_M);
          // Stable id for per-house shop state (deal rate-limit, future ledger).
          const id = `h_${Math.round(cx)}_${Math.round(cy)}`;
          // Synthetic 3-digit street address derived from cell coords. Houses
          // whose address ends in 9 become blacksmiths (~10% of houses).
          const address = (((ix * HASH_MUL_X) ^ (iy * HASH_MUL_Y)) >>> 0) % 1000;
          objects.push({ kind: 'house', x: cx, y: cy, area: bp.areaM2, tier: bp.tier, id, address });
        }
        // Thin merged house icons. When several tiny building polygons abut and
        // rasterize into one continuous block of building tiles, each polygon
        // still drops its own roof — so the merged footprint reads as a cluster
        // of crammed-together houses. Cap it at roughly one icon per two
        // continuous tiles: greedily keep the largest-area house and drop any
        // whose anchor cell is adjacent (Chebyshev ≤ 1, i.e. its footprint
        // touches) an already-kept roof. Separate buildings with a gap between
        // their footprints sit ≥ 2 cells apart and both survive.
        const _houseIdx = [];
        for (let k = 0; k < objects.length; k++) if (objects[k].kind === 'house') _houseIdx.push(k);
        _houseIdx.sort((a, b) => (objects[b].area || 0) - (objects[a].area || 0));
        const _keptHouseCells = [];
        const _dropHouse = new Set();
        for (const k of _houseIdx) {
          const o = objects[k];
          const hix = Math.floor(o.x / CELL_M), hiy = Math.floor(o.y / CELL_M);
          let tooClose = false;
          for (const [kx, ky] of _keptHouseCells) {
            if (Math.max(Math.abs(kx - hix), Math.abs(ky - hiy)) <= 1) { tooClose = true; break; }
          }
          if (tooClose) _dropHouse.add(k);
          else _keptHouseCells.push([hix, hiy]);
        }
        if (_dropHouse.size) {
          const _dropArr = [..._dropHouse].sort((a, b) => b - a);
          for (const k of _dropArr) objects.splice(k, 1);
        }
      }
    }
    // Post-pass: mineralrock cleanup. The polygon feature loop processes
    // landuse, roads, and buildings in MVT-supplied order, so a mineralrock
    // spawned by a residential polygon might have been placed on a cell
    // that later got painted as a road / driveway / building. Walk every
    // mineralrock now that the grid is final and drop:
    //   (1) any whose cell became blocked terrain (road, path, water,
    //       building of any tier)
    //   (2) any flagged as residential whose 3×3 neighbourhood contains
    //       no road cell (so residential rocks always read as a kerb or
    //       driveway feature)
    // Strip the temp _residential flag from survivors so it doesn't leak
    // into save state or the render pipeline.
    {
      const _mrIsBlocked = (ix, iy) => {
        const tc = grid[iy * w + ix];
        return tc === T.ROAD     || tc === T.ROAD_LG || tc === T.ROAD_MD
            || tc === T.PATH     || tc === T.WATER    || tc === T.PIER
            || tc === T.BUILDING || tc === T.BUILDING_MED || tc === T.BUILDING_LARGE;
      };
      // No interactable may sit on a road tier or a building footprint. This is
      // the blanket rule for EVERY scatter object (rocks, trees, wells, poles,
      // …); the sole exception is a POI chest, handled explicitly below.
      const _onRoadOrBuilding = (tc) =>
           tc === T.ROAD     || tc === T.ROAD_LG    || tc === T.ROAD_MD
        || tc === T.BUILDING || tc === T.BUILDING_MED || tc === T.BUILDING_LARGE;
      // A house/tower sprite is foot-anchored on its footprint and its base
      // overhangs the immediately adjacent cells, so a rock one cell off the
      // footprint still reads as sitting ON the building's foundation. Keep a
      // one-cell moat clear of rocks around every building cell.
      const _mrNearBuilding = (ix, iy) => {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = ix + dx, ny = iy + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const tc = grid[ny * w + nx];
            if (tc === T.BUILDING || tc === T.BUILDING_MED || tc === T.BUILDING_LARGE) return true;
          }
        }
        return false;
      };
      // The grid is indexed in the TILE's cell basis — cell width =
      // tileEdgeM / cellsPerEdge, NOT the global CELL_M (5 m). Round-up
      // from cellsPerEdge × CELL_M to tileEdgeM produces ~0.03 m of
      // drift per cell, which accumulates to ~1.5 m by the far edge of
      // a 50-cell tile — enough to put the rock's "lookup cell" one
      // column off from where it actually sits on the painted grid.
      // Use the same basis the grid was painted with.
      const _mrCellW = tileEdgeM / w;
      // Houses are placed inside building footprints — always road-adjacent
      // by virtue of OSM data and never something the player wades into a
      // back yard for. Keep them exempt from the residential proximity
      // check below.
      const _mrSkipKind = (k) => k === 'house' || k === 'tower';
      // POI chests are real-world destinations and count as public anchors for
      // the shared isSpawnCell rule below. Snapshot their cell coords now,
      // before we start splicing `objects`.
      const _mrSpawnOpts = {
        pois: objects
          .filter(o => o.kind === 'chest')
          .map(o => ({
            ix: Math.floor((o.x - tileOriginMx) / _mrCellW),
            iy: Math.floor((o.y - tileOriginMy) / _mrCellW),
          })),
      };
      for (let i = objects.length - 1; i >= 0; i--) {
        const o = objects[i];
        if (_mrSkipKind(o.kind)) continue;
        const ix = Math.floor((o.x - tileOriginMx) / _mrCellW);
        const iy = Math.floor((o.y - tileOriginMy) / _mrCellW);
        if (ix < 0 || ix >= w || iy < 0 || iy >= h) continue;   // off-tile objects belong to a neighbour pass
        const here = grid[iy * w + ix];
        // Blanket cull: nothing but a POI chest may sit on a road tier or a
        // building footprint. A chest is a real-world destination deliberately
        // placed at its coordinates — and a POI inside a building is allowed
        // (the player taps the building floor to activate it). House/tower
        // sprites ARE the building and were already skipped via _mrSkipKind.
        if (o.kind !== 'chest' && _onRoadOrBuilding(here)) { objects.splice(i, 1); continue; }
        if (o.kind === 'mineralrock') {
          if (_mrIsBlocked(ix, iy)) { objects.splice(i, 1); continue; }
          // Never sit a rock on a building's foundation (footprint edge / base).
          if (_mrNearBuilding(ix, iy)) { objects.splice(i, 1); continue; }
          // A rock whose FINAL cell turned out to be residential must pass the
          // same shared spawn rule as every other object (isSpawnCell: near a
          // road/path, a detectable public area, or a POI) — otherwise it'd
          // bait the player into someone's back yard. Terrain-based, NOT tied
          // to which polygon spawned the rock: a wilderness ROCK or INDUSTRIAL
          // cluster can drop a rock that ends up on a residential cell after
          // the grid is fully painted. The _residential flag is preserved for
          // telemetry but no longer drives the check.
          if (here === T.RESIDENTIAL && !isSpawnCell(grid, w, h, ix, iy, _mrSpawnOpts)) {
            objects.splice(i, 1); continue;
          }
          delete o._residential;
          continue;
        }
        // Every OTHER object that landed on a residential cell must pass the
        // shared spawn rule (isSpawnCell): near a road/path, a detectable
        // public area, or a POI — otherwise it'd bait the player into someone's
        // back yard. Forts, castles, houses and towers are already exempt above.
        if (here === T.RESIDENTIAL) {
          if (!isSpawnCell(grid, w, h, ix, iy, _mrSpawnOpts)) { objects.splice(i, 1); continue; }
        }
      }
      // Same shared rule for the parallel `wildplants` list — any wild pickup
      // that ended up on a residential cell must pass isSpawnCell. (DEBRIS_CROP
      // no longer seeds residential, but cross-polygon overlap can still
      // drop a shrub or longgrass tuft onto a residential cell.)
      for (let i = wildplants.length - 1; i >= 0; i--) {
        const wp = wildplants[i];
        const ix = Math.floor((wp.x - tileOriginMx) / _mrCellW);
        const iy = Math.floor((wp.y - tileOriginMy) / _mrCellW);
        if (ix < 0 || ix >= w || iy < 0 || iy >= h) continue;
        const wtc = grid[iy * w + ix];
        if (_onRoadOrBuilding(wtc)) { wildplants.splice(i, 1); continue; }
        if (wtc !== T.RESIDENTIAL) continue;
        if (!isSpawnCell(grid, w, h, ix, iy, _mrSpawnOpts)) wildplants.splice(i, 1);
      }
      // Parking-treasure X marks live in a third array (parkingTreasures)
      // and were missed by both filters above. Apply the same shared rule — a
      // buried-X on a residential cell must pass isSpawnCell, else drop.
      // Non-residential parking lots (the typical case) stay.
      for (let i = parkingTreasures.length - 1; i >= 0; i--) {
        const t = parkingTreasures[i];
        const ix = Math.floor((t.x - tileOriginMx) / _mrCellW);
        const iy = Math.floor((t.y - tileOriginMy) / _mrCellW);
        if (ix < 0 || ix >= w || iy < 0 || iy >= h) continue;
        if (grid[iy * w + ix] !== T.RESIDENTIAL) continue;
        if (!isSpawnCell(grid, w, h, ix, iy, _mrSpawnOpts)) parkingTreasures.splice(i, 1);
      }
    }

    // Post-pass: roads/paths/water/buildings are painted AFTER landuse, so a
    // residential polygon may have had debris dropped into a cell that later
    // became road, OR a park polygon's shrubs may have ended up under a
    // residential overpaint. The biome-appropriateness test lives in the central
    // BIOME_PROFILES registry now (BiomeProfiles.allows — a crop survives on any
    // cell whose family grows it); the wildplant filter below calls it directly.
    // Castle towers — place a tower sprite at perimeter cells of every BUILDING_LARGE
    // footprint, roughly one per 5 cells along the wall. Deterministic per absolute
    // cell coord so towers stay aligned across tile boundaries.
    for (let iy = 0; iy < h; iy++) {
      for (let ix = 0; ix < w; ix++) {
        if (grid[iy * w + ix] !== T.BUILDING_LARGE) continue;
        // Perimeter test: at least one 4-neighbor is not BUILDING_LARGE (or off-tile).
        let isPerim = false;
        for (const [ddx, ddy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const nx = ix + ddx, ny = iy + ddy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) { isPerim = true; break; }
          if (grid[ny * w + nx] !== T.BUILDING_LARGE) { isPerim = true; break; }
        }
        if (!isPerim) continue;
        const absX = tx * w + ix, absY = ty * w + iy;
        if (((absX + absY * 13) % 5 + 5) % 5 !== 0) continue;
        const { mx: cx, my: cy } = cellCenterMeters(ix, iy);
        objects.push({ kind: 'tower', x: cx, y: cy, id: `tw_${absX}_${absY}` });
      }
    }

    // Unified occupancy pass — at most one object per cell.
    // Strict priority: chest > house > tree > wildplant.
    // The first one to claim a cell wins; everything else in that cell is
    // dropped so we never have shrubs hiding under chests or pads.
    const occupiedCells = new Set();
    const cellKeyOfWorld = (x, y) => {
      const ix = Math.floor(((x - tileOriginMx) / mvtToM) * mvtToCell);
      const iy = Math.floor(((y - tileOriginMy) / mvtToM) * mvtToCell);
      return `${ix}_${iy}`;
    };

    // 1) High-priority objects first (chest > house > fruittree > tree > mineralrock).
    //    These never get displaced — they claim their cells and wildplants must avoid those cells.
    //    Priority numbers are descending so the sort places higher-priority kinds
    //    first. Within one priority (e.g. house/tower, or two trees) the winner
    //    of a contested cell must be fixed by data, not array order — JS sort
    //    stability isn't guaranteed across engines, and an arbitrary tie-break
    //    would let the same seed resolve a collision differently between reloads.
    const STRUCT_PRIO = { chest: 6, house: 5, tower: 5, fruittree: 4, tree: 3, mineralrock: 2 };
    const structs = objects.filter(o => STRUCT_PRIO[o.kind] != null);
    structs.sort((a, b) => {
      const dp = (STRUCT_PRIO[b.kind] || 0) - (STRUCT_PRIO[a.kind] || 0);
      if (dp) return dp;
      // Deterministic tie-break: position (always defined from generation),
      // then id as a final stable key.
      if (a.x !== b.x) return a.x - b.x;
      if (a.y !== b.y) return a.y - b.y;
      return String(a.id ?? '').localeCompare(String(b.id ?? ''));
    });
    const keptStructs = [];
    for (const o of structs) {
      const k = cellKeyOfWorld(o.x, o.y);
      if (occupiedCells.has(k)) continue;
      occupiedCells.add(k);
      // Stamp the cell's terrain so the renderer can apply a per-biome tint to
      // primary interactables (e.g. rusty mineralrock on industrial lots).
      const ix = Math.floor(((o.x - tileOriginMx) / mvtToM) * mvtToCell);
      const iy = Math.floor(((o.y - tileOriginMy) / mvtToM) * mvtToCell);
      if (ix >= 0 && iy >= 0 && ix < w && iy < h) o._biome = grid[iy * w + ix];
      keptStructs.push(o);
    }

    // 2) Wildplants — biome-appropriate cells only, never on a structure cell.
    //    Allowed-biome test is derived from the central BIOME_PROFILES registry
    //    (a crop survives on any cell whose family grows it), keeping the filter
    //    in lockstep with the spawn pass. The cell's terrain is stamped onto the
    //    kept wildplant as `_biome` so the renderer can apply the biome's flora
    //    tint (e.g. golden field grass, swampy reeds).
    const filtered = [];
    for (const wp of wildplants) {
      const t = grid[wp._iy * w + wp._ix];
      const cellKey = `${wp._ix}_${wp._iy}`;
      if (BiomeProfiles.allows(wp.crop, t) && !occupiedCells.has(cellKey)) {
        occupiedCells.add(cellKey);
        wp._biome = t;
        delete wp._ix; delete wp._iy;
        filtered.push(wp);
      }
    }

    // Rebuild objects = kept structures (preserve everything else
    // like plaques if they sneak in via future code).
    const otherKinds = objects.filter(o => STRUCT_PRIO[o.kind] == null);
    objects.length = 0;
    for (const o of keptStructs) objects.push(o);
    for (const o of otherKinds)  objects.push(o);
    // Road-name letters: walk each transportation_name line at ~1 cell per step
    // and stamp ONE letter per road cell, cycling through "FIRSTWORD " (the
    // first word of the name plus a single space gap before it repeats).
    // To keep labels readable, we pre-orient each polyline so it reads
    // left-to-right (predominantly horizontal roads) or top-to-bottom
    // (predominantly vertical roads), reversing the line if its raw direction
    // points the "wrong" way. Cells visited more than once skip the duplicate.
    // Stored as { "ix_iy": { char, angle } }.
    const roadLetters = {};
    // pathNames[`${ix}_${iy}`] = full street name, recorded ONLY for PATH
    // cells (terrain code 8). Drives the path-stone activation feature in
    // app.js — tap or step on a path stone to "claim" it, fill every stone
    // of one named path to trigger a treasure dialog. We deliberately
    // store the FULL name (not just the first word the road-letters loop
    // uses) so two paths sharing a first word still count as distinct.
    const pathNames = {};
    const tnLayer = layersByName['transportation_name'];
    const ROAD_TYPES = new Set([T.ROAD, T.ROAD_MD, T.ROAD_LG, T.PATH]);
    if (tnLayer) {
      for (const f of tnLayer.features) {
        if (f.type !== 2) continue;
        const name = f.tags?.name;
        if (!name) continue;
        // First word only, then a literal space — the space leaves a one-cell
        // gap before the word repeats so the eye gets a natural break.
        const firstWord = name.trim().split(/\s+/)[0];
        if (!firstWord) continue;
        const letters = (firstWord + ' ').toUpperCase();
        for (const lineOrig of f.geom) {
          if (lineOrig.length < 2) continue;
          // Reverse the polyline if its overall direction reads right-to-left
          // or bottom-to-top — letters always lay out LTR / top-down.
          const a = lineOrig[0], b = lineOrig[lineOrig.length - 1];
          const ndx = b.x - a.x, ndy = b.y - a.y;
          const horizontal = Math.abs(ndx) >= Math.abs(ndy);
          const reverse = (horizontal && ndx < 0) || (!horizontal && ndy < 0);
          const line = reverse ? lineOrig.slice().reverse() : lineOrig;

          let letterIdx = 0;
          let lastKey = '';
          const stepMvt = CELL_M / mvtToM;
          for (let i = 1; i < line.length; i++) {
            const ax = line[i - 1].x, ay = line[i - 1].y;
            const bx = line[i].x,     by = line[i].y;
            const segDx = bx - ax, segDy = by - ay;
            const segLen = Math.hypot(segDx, segDy);
            if (segLen < 1e-6) continue;
            // Local direction in radians (note: MVT y grows downward → that matches screen y).
            const ang = Math.atan2(segDy, segDx);
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
                  ROAD_TYPES.has(grid[iy * w + ix])) {
                const ch = letters.charAt(letterIdx % letters.length);
                // Space cells stay visually blank (no entry written) so the
                // gap between repeats reads as cobble showing through.
                if (ch !== ' ') roadLetters[key] = { char: ch, angle: ang };
                // PATH cells additionally record the full street name so
                // app.js can group stones by named path for the activation
                // / completion-reward loop.
                if (grid[iy * w + ix] === T.PATH) pathNames[key] = name;
                letterIdx++;
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
    // Flood-fill every PATH cell into 4-connected components and give each
    // component ONE name, stamped onto all its cells. The centerline march
    // above only names cells lying exactly on the transportation_name polyline,
    // so wide paths had bare cells and unnamed footpaths had none at all —
    // tapping those did nothing (no blue, no claim). Now every path stone is
    // claimable: a component reuses the real OSM name if any of its cells
    // caught one above, otherwise gets a synthetic per-tile id (so two
    // unnamed trails in one tile stay distinct in save.pathStones).
    {
      const seen = new Uint8Array(w * h);
      const stack = [];
      let synthSeq = 0;
      for (let s = 0; s < w * h; s++) {
        if (seen[s] || grid[s] !== T.PATH) continue;
        const cells = [];
        let realName = null;
        stack.length = 0;
        stack.push(s);
        seen[s] = 1;
        while (stack.length) {
          const idx = stack.pop();
          const cx = idx % w, cy = (idx - cx) / w;
          cells.push(idx);
          const nm = pathNames[`${cx}_${cy}`];
          if (realName == null && nm) realName = nm;
          // 8-connected: thin (r=0) paths are stamped by Bresenham, whose
          // diagonal steps leave consecutive cells touching only at a corner.
          // A 4-connected fill would shatter such a staircase footpath into
          // many 1-cell components, so a 12-cell diagonal trail never reaches
          // the 10-stone coin milestone or the 8-cell completion floor and
          // pays nothing. Including diagonals keeps the whole path one named
          // component.
          for (const [ddx, ddy] of [[1, 0], [-1, 0], [0, 1], [0, -1],
                                     [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
            const nx = cx + ddx, ny = cy + ddy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const ni = ny * w + nx;
            if (seen[ni] || grid[ni] !== T.PATH) continue;
            seen[ni] = 1;
            stack.push(ni);
          }
        }
        // Synthetic names carry a 'trail#' prefix so app.js can show a generic
        // title for them instead of the ugly id. Real OSM names pass through.
        const name = realName || `trail#${tx}_${ty}_${synthSeq++}`;
        for (const idx of cells) {
          const cx = idx % w, cy = (idx - cx) / w;
          pathNames[`${cx}_${cy}`] = name;
        }
      }
    }

    // Dedup nearby same-name chests inside this tile. OSM frequently has multiple
    // POI points for one physical place (e.g. an entrance + main label + amenity).
    // Group by normalized name, then drop any chest within DEDUP_M of an already-
    // kept chest of the same name. Unnamed chests are left untouched.
    const DEDUP_M = 80;
    const byName = new Map();
    for (const o of objects) {
      if (o.kind !== 'chest' || !o.name) { continue; }
      const key = o.name.trim().toLowerCase();
      const prev = byName.get(key);
      const tooClose = prev && prev.some(p => Math.hypot(p.x - o.x, p.y - o.y) <= DEDUP_M);
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
    const NEAR_M = CELL_M * 1.2;   // catches same + orthogonally-adjacent cells
    const keptChests = [];
    const chestsByPriority = objects
      .filter(o => o.kind === 'chest' && !o._drop)
      .sort((a, b) => (b.name ? 1 : 0) - (a.name ? 1 : 0));   // named first
    for (const o of chestsByPriority) {
      if (keptChests.some(k => Math.hypot(k.x - o.x, k.y - o.y) <= NEAR_M)) o._drop = true;
      else keptChests.push(o);
    }
    const deduped = objects.filter(o => !o._drop);
    return { grid, objects: deduped, wildplants: filtered, parkingTreasures, roadLetters, pathNames, pathUnder };
  }

  function tileEdgeMeters(lat) {
    // edge in meters at z=14 at given latitude
    return metersPerPixel(lat, Z) * TILE_PX;
  }
  function cellsPerEdgeForLat(lat) {
    return Math.round(tileEdgeMeters(lat) / CELL_M);
  }

  async function loadTile(x, y, lat) {
    // NOTE: cache key is `${Z}/${x}/${y}` — same tile at a different latitude would alias.
    // Safe today because the player session is anchored to one START_LAT. If we ever
    // support session-scale long-distance teleports between very different latitudes,
    // include `cellsPerEdgeForLat(lat)` in this key AND in every `tileCache.get(...)`
    // call site in app.js.
    //
    // `tileCache` here shadows the module-level one with the ACTIVE depth's map
    // so the surface-build body below (dedup scans, eviction, .set) all operate
    // on the right level. Underground levels take a separate code path.
    const depth = activeDepth;
    const tileCache = cacheFor(depth);
    const key = `${Z}/${x}/${y}`;
    if (tileCache.has(key)) return tileCache.get(key);
    if (depth > 0) return loadCaveTile(tileCache, depth, key, x, y, lat);
    const entry = { status: 'loading', grid: null, cellsPerEdge: cellsPerEdgeForLat(lat) };
    const tileEdgeM = tileEdgeMeters(lat);
    entry.tileEdgeM = tileEdgeM;
    entry.promise = (async () => {
      const { bytes, fromCache } = await fetchTileBytes(x, y);
      const layers = MVT.decodeTile(bytes);
      const { grid, objects, wildplants, parkingTreasures, roadLetters, pathNames, pathUnder } = rasterizeTile(layers, entry.cellsPerEdge, x, y, tileEdgeM);
      // Cross-tile dedup: drop any newly-spawned chest whose name matches one
      // already in a previously-loaded tile within 120m (typical OSM intersection
      // POIs duplicate across the four tiles meeting at that corner).
      //
      // Indexed by lowercased name to keep dedup O(new × matches) rather than
      // O(new × total) — the prior triple-nested scan was quadratic across the
      // entire tileCache for every tile load.
      const DEDUP_M = 120;
      const DEDUP_M2 = DEDUP_M * DEDUP_M;
      const byName = new Map();   // name → [{ x, y }]
      for (const e of tileCache.values()) {
        if (!e || !e.objects) continue;
        for (const p of e.objects) {
          if (p.kind !== 'chest' || !p.name) continue;
          const k = p.name.trim().toLowerCase();
          let arr = byName.get(k);
          if (!arr) { arr = []; byName.set(k, arr); }
          arr.push({ x: p.x, y: p.y });
        }
      }
      // Position index for houses — same building can be duplicated across the
      // 4 tiles meeting at its corner, producing 2-4 sprites for the same
      // physical structure. Dedup any new house within HOUSE_DEDUP_M of an
      // existing one (no name available — OSM doesn't usually name dwellings).
      const HOUSE_DEDUP_M = 6;
      const HOUSE_DEDUP_M2 = HOUSE_DEDUP_M * HOUSE_DEDUP_M;
      const housePositions = [];
      for (const e of tileCache.values()) {
        if (!e || !e.objects) continue;
        for (const p of e.objects) {
          if (p.kind === 'house') housePositions.push({ x: p.x, y: p.y });
        }
      }
      const filteredObjects = [];
      for (const o of objects) {
        if (o.kind === 'chest' && o.name) {
          const arr = byName.get(o.name.trim().toLowerCase());
          let drop = false;
          if (arr) for (const p of arr) {
            const dx = p.x - o.x, dy = p.y - o.y;
            if (dx * dx + dy * dy <= DEDUP_M2) { drop = true; break; }
          }
          if (drop) continue;
        }
        if (o.kind === 'house') {
          let drop = false;
          for (const p of housePositions) {
            const dx = p.x - o.x, dy = p.y - o.y;
            if (dx * dx + dy * dy <= HOUSE_DEDUP_M2) { drop = true; break; }
          }
          if (drop) continue;
          // Record the kept house so other newly-pushed houses in this same
          // tile also dedup against it (not just cross-tile).
          housePositions.push({ x: o.x, y: o.y });
        }
        filteredObjects.push(o);
      }
      entry.grid = grid;
      entry.objects = filteredObjects;
      entry.depth = 0;
      // Cave entrance: drop one "descend" staircase per surface tile beside a
      // cave-rock cluster (a mine mouth). Tiles with no cave rock get no
      // entrance — not every block has a way down, which reads naturally.
      maybePlaceCaveEntrance(entry, x, y, tileEdgeM);
      entry.wildplants = wildplants;
      entry.parkingTreasures = parkingTreasures || [];
      entry.roadLetters = roadLetters || {};
      entry.pathNames   = pathNames   || {};
      entry.pathUnder   = pathUnder   || {};
      entry.layers = layers;

      // Inject pre-extracted Overpass trees + tree_row bushes for this tile.
      // These bypass the in-tile occupancy/biome filters on purpose — they are
      // real-world features and should appear where OSM says they are — but we
      // still skip any that land on a water cell (a tree mid-lake reads wrong).
      const bin = await getTileBin(x, y, lat);
      if (bin) {
        const cpe = entry.cellsPerEdge;
        const mPerCell = tileEdgeM / cpe;
        const onWater = (wx, wy) => {
          const lix = Math.floor((wx - x * tileEdgeM) / mPerCell);
          const liy = Math.floor((wy - y * tileEdgeM) / mPerCell);
          if (lix < 0 || liy < 0 || lix >= cpe || liy >= cpe) return false;
          return grid[liy * cpe + lix] === T.WATER;
        };
        // Injected OSM features skip the BIOME filter (they belong wherever
        // the real world puts them) but must still honour one-interactable-
        // per-cell: stacking two pickables on a cell is unreachable for the
        // player. Seed the occupancy set from everything already placed, then
        // drop any tree/bush that would land on a taken cell.
        const cellKeyOf = (wx, wy) => {
          const lix = Math.floor((wx - x * tileEdgeM) / mPerCell);
          const liy = Math.floor((wy - y * tileEdgeM) / mPerCell);
          return `${lix}_${liy}`;
        };
        // Re-centre an injected feature onto THIS tile's local cell grid. The
        // bins were snapped to the global 5 m grid at fetch time, but every
        // other object on the tile sits on the local grid (tileEdgeM/cpe,
        // anchored at the tile origin) — leaving these on the global grid would
        // reintroduce the sub-cell misalignment that lets a tree and a rock in
        // the "same" cell both survive the occupancy check.
        const localCentre = (wx, wy) => ({
          x: x * tileEdgeM + (Math.floor((wx - x * tileEdgeM) / mPerCell) + 0.5) * mPerCell,
          y: y * tileEdgeM + (Math.floor((wy - y * tileEdgeM) / mPerCell) + 0.5) * mPerCell,
        });
        // Occupancy set — seed from everything rasterizeTile already placed so
        // injected features (and the stream water below) never land on an
        // existing interactable. Built BEFORE stream painting so we don't flood
        // a cell that already hosts a rasterized tree / rock / house / chest.
        const occupied = new Set();
        for (const o of entry.objects)     occupied.add(cellKeyOf(o.x, o.y));
        for (const wp of entry.wildplants) occupied.add(cellKeyOf(wp.x, wp.y));
        // Residential yard rule for the sidecar injections below. These are
        // pushed AFTER rasterizeTile's residential post-pass, so they'd bypass
        // it otherwise — re-apply the shared spawn rule here. Like the post-pass,
        // only RESIDENTIAL cells are gated (non-residential placements pass
        // through); POI chests — both already placed and the ones we're about to
        // inject — count as public anchors.
        const _sxCell = (wx, wy) => ({
          ix: Math.floor((wx - x * tileEdgeM) / mPerCell),
          iy: Math.floor((wy - y * tileEdgeM) / mPerCell),
        });
        const _sxPois = [];
        for (const o of entry.objects) if (o.kind === 'chest') _sxPois.push(_sxCell(o.x, o.y));
        for (const ch of (bin.chests || [])) _sxPois.push(_sxCell(ch.x, ch.y));
        const _sxSpawnOpts = { pois: _sxPois };
        const _sxYardOK = (wx, wy) => {
          const { ix, iy } = _sxCell(wx, wy);
          if (ix < 0 || iy < 0 || ix >= cpe || iy >= cpe) return true;
          if (grid[iy * cpe + ix] !== T.RESIDENTIAL) return true;
          return isSpawnCell(grid, cpe, cpe, ix, iy, _sxSpawnOpts);
        };
        // Streams (OSM waterway=stream) reach the sidecar as single centroid
        // points (the LineString was reduced upstream). Stamp a small 3×3 water
        // patch over each centroid so the stream reads as water on the map —
        // but only over SOFT ground, never roads / buildings / pads / rock /
        // existing water, and never a cell already holding a placed object.
        // Painted BEFORE the object injections below so the onWater() guards
        // skip trees/poles that would land in the new water.
        const STREAM_BLOCK = new Set([
          T.WATER, T.ROAD, T.ROAD_MD, T.ROAD_LG, T.PATH, T.PIER,
          T.BUILDING, T.BUILDING_MED, T.BUILDING_LARGE,
          T.COMMERCIAL, T.INDUSTRIAL, T.ROCK,
        ]);
        for (const st of (bin.streams || [])) {
          const lix = Math.floor((st.x - x * tileEdgeM) / mPerCell);
          const liy = Math.floor((st.y - y * tileEdgeM) / mPerCell);
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const nx = lix + dx, ny = liy + dy;
              if (nx < 0 || ny < 0 || nx >= cpe || ny >= cpe) continue;
              if (occupied.has(`${nx}_${ny}`)) continue;   // don't flood a placed object's cell
              const idx = ny * cpe + nx;
              if (!STREAM_BLOCK.has(grid[idx])) grid[idx] = T.WATER;
            }
          }
        }
        // Trees + fruit trees can NEVER sit on a building footprint, road, path,
        // water or other hard/interactable cell. When a detection lands on one,
        // relocate it to a favourable empty neighbour cell; drop it only if no
        // neighbour works. One tree per cell — process largest crown first so the
        // biggest tree wins a contested cell and smaller ones spill to neighbours.
        const TREE_BLOCK = new Set([
          T.WATER, T.PIER, T.ROAD, T.ROAD_MD, T.ROAD_LG, T.PATH,
          T.BUILDING, T.BUILDING_MED, T.BUILDING_LARGE,
          T.COMMERCIAL, T.INDUSTRIAL, T.ROCK,
        ]);
        // Cell at (wx,wy) is hard terrain a scatter object must never sit on
        // (road/building/water/rock/etc — the same set trees avoid).
        const _sxHard = (wx, wy) => {
          const { ix, iy } = _sxCell(wx, wy);
          if (ix < 0 || iy < 0 || ix >= cpe || iy >= cpe) return false;
          return TREE_BLOCK.has(grid[iy * cpe + ix]);
        };
        // Cell at (wx,wy) is a building footprint — wells get a softer rule than
        // _sxHard (they may supersede a road tile, repainting it) but must still
        // never land on a building.
        const _sxBuilding = (wx, wy) => {
          const { ix, iy } = _sxCell(wx, wy);
          if (ix < 0 || iy < 0 || ix >= cpe || iy >= cpe) return false;
          const tc = grid[iy * cpe + ix];
          return tc === T.BUILDING || tc === T.BUILDING_MED || tc === T.BUILDING_LARGE;
        };
        const tryTreeCell = (ix, iy) => {
          if (ix < 0 || iy < 0 || ix >= cpe || iy >= cpe) return null;
          if (TREE_BLOCK.has(grid[iy * cpe + ix])) return null;
          if (occupied.has(`${ix}_${iy}`)) return null;
          const wcx = x * tileEdgeM + (ix + 0.5) * mPerCell;
          const wcy = y * tileEdgeM + (iy + 0.5) * mPerCell;
          if (!_sxYardOK(wcx, wcy)) return null;
          return { ix, iy, x: wcx, y: wcy, key: `${ix}_${iy}` };
        };
        // 4-neighbours first (closer, axis-aligned), then diagonals.
        const NB8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
        const placeTree = (wx, wy) => {
          const ix = Math.floor((wx - x * tileEdgeM) / mPerCell);
          const iy = Math.floor((wy - y * tileEdgeM) / mPerCell);
          let r = tryTreeCell(ix, iy);
          if (r) return r;
          for (const [dx, dy] of NB8) { r = tryTreeCell(ix + dx, iy + dy); if (r) return r; }
          return null;
        };
        const allTrees = [...(bin.trees || []), ...(bin.fruittrees || [])]
          .sort((a, b) => (b.crown_m || 0) - (a.crown_m || 0));
        for (const t of allTrees) {
          const r = placeTree(t.x, t.y);
          if (!r) continue;
          occupied.add(r.key);
          t.x = r.x; t.y = r.y;
          entry.objects.push(t);
        }
        for (const s of (bin.shrubs || [])) {
          if (onWater(s.x, s.y)) continue;
          if (_sxHard(s.x, s.y)) continue;            // never on road / building / hard cell
          if (!_sxYardOK(s.x, s.y)) continue;
          const k = cellKeyOf(s.x, s.y);
          if (occupied.has(k)) continue;
          occupied.add(k);
          const c = localCentre(s.x, s.y);
          s.x = c.x; s.y = c.y;
          entry.wildplants.push(s);
        }
        for (const p of (bin.poles || [])) {
          if (onWater(p.x, p.y)) continue;
          if (_sxHard(p.x, p.y)) continue;            // never on road / building / hard cell
          if (!_sxYardOK(p.x, p.y)) continue;
          const k = cellKeyOf(p.x, p.y);
          if (occupied.has(k)) continue;
          occupied.add(k);
          const c = localCentre(p.x, p.y);
          p.x = c.x; p.y = c.y;
          entry.objects.push(p);
        }
        // Wells (OSM amenity=fountain) → a tappable well object that refills the
        // watering can (interact.js 'well' branch), rendered as the well sprite.
        const _ROADISH = (tt) => tt === T.ROAD || tt === T.ROAD_MD || tt === T.ROAD_LG || tt === T.PATH;
        for (const wl of (bin.wells || [])) {
          if (onWater(wl.x, wl.y)) continue;
          if (_sxBuilding(wl.x, wl.y)) continue;      // never on a building (roads are superseded below)
          if (!_sxYardOK(wl.x, wl.y)) continue;
          const k = cellKeyOf(wl.x, wl.y);
          if (occupied.has(k)) continue;
          occupied.add(k);
          const c = localCentre(wl.x, wl.y);
          wl.x = c.x; wl.y = c.y;
          entry.objects.push(wl);
          // A well supersedes a road/path tile it lands on — repaint the cell to
          // the dominant soft neighbour biome (so it blends, not a hard grass
          // square) and clear the cobble's road-letter / path-name so no glyph
          // or path-stone tint shows under the well.
          const lix = Math.floor((wl.x - x * tileEdgeM) / mPerCell);
          const liy = Math.floor((wl.y - y * tileEdgeM) / mPerCell);
          if (lix >= 0 && liy >= 0 && lix < cpe && liy < cpe && _ROADISH(grid[liy * cpe + lix])) {
            const NONSOFT = new Set([T.WATER, T.PIER, T.BUILDING, T.BUILDING_MED, T.BUILDING_LARGE]);
            const counts = {};
            for (let ddy = -1; ddy <= 1; ddy++) for (let ddx = -1; ddx <= 1; ddx++) {
              if (!ddx && !ddy) continue;
              const nnx = lix + ddx, nny = liy + ddy;
              if (nnx < 0 || nny < 0 || nnx >= cpe || nny >= cpe) continue;
              const nt = grid[nny * cpe + nnx];
              if (_ROADISH(nt) || NONSOFT.has(nt)) continue;
              counts[nt] = (counts[nt] || 0) + 1;
            }
            let best = T.GRASS, bestN = 0;
            for (const t2 in counts) if (counts[t2] > bestN) { bestN = counts[t2]; best = +t2; }
            grid[liy * cpe + lix] = best;
            const ck = `${lix}_${liy}`;
            if (entry.roadLetters) delete entry.roadLetters[ck];
            if (entry.pathNames)   delete entry.pathNames[ck];
          }
        }
        // POI chests (bus stops, signals, crossings, gates, towers, pitches,
        // gardens, bicycle racks, …). poiClass drives loot / tier / label /
        // coin-burst via loot.js + the render/interact chest paths.
        for (const ch of (bin.chests || [])) {
          if (onWater(ch.x, ch.y)) continue;   // a chest mid-lake / on stream water reads wrong
          if (!_sxYardOK(ch.x, ch.y)) continue;
          const k = cellKeyOf(ch.x, ch.y);
          if (occupied.has(k)) continue;
          occupied.add(k);
          const c = localCentre(ch.x, ch.y);
          ch.x = c.x; ch.y = c.y;
          delete ch.garden;   // internal flag — don't leak into the chest object
          entry.objects.push(ch);
        }
        // Parking lots (OSM amenity=parking) → a buried-treasure "X marks the
        // spot" mark, claimed via the treasure handler (same array the MVT
        // parking path fills). No per-cell occupancy — X marks sit under the
        // terrain and don't block other interactables.
        for (const pk of (bin.parking || [])) {
          const c = localCentre(pk.x, pk.y);
          pk.x = c.x; pk.y = c.y;
          if (!_sxYardOK(pk.x, pk.y)) continue;
          // Skip if an X already sits within ~8m — the MVT parking path fills
          // the SAME array (before this injection) and snaps on a slightly
          // different basis, so the same lot present in both sources would
          // otherwise drop two separately-claimable treasures.
          const dupe = entry.parkingTreasures.some(t =>
            (t.x - pk.x) * (t.x - pk.x) + (t.y - pk.y) * (t.y - pk.y) <= 8 * 8);
          if (dupe) continue;
          entry.parkingTreasures.push(pk);
        }
      }

      entry.status = 'ready';
      entry.fromCache = fromCache;
      return entry;
    })();
    tileCache.set(key, entry);
    // LRU prune to bound memory on long-walking sessions. Insertion order is
    // a reasonable proxy for "least recently loaded"; per-tile state worth
    // preserving (opened chests, chopped trees, picked debris, etc.) lives in
    // save.*, so re-rasterising an evicted tile reconstructs the same view.
    const MAX_CACHED_TILES = 64;
    while (tileCache.size > MAX_CACHED_TILES) {
      const oldestKey = tileCache.keys().next().value;
      if (oldestKey === key) break;   // never evict what we just inserted
      tileCache.delete(oldestKey);
    }
    return entry;
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
    const TREE_SPECIES = ['maple', 'pine', 'birch', 'mahogany'];
    // DeepForest detections below this confidence are dropped on load. OSM
    // trees carry no `score` and are always kept. The z20 classified run is
    // already filtered at 0.30 (the reviewed sweet spot), so match it here.
    const SATEXTRACT_TREE_MIN_SCORE = 0.30;
    const tileEdgeM = tileEdgeMeters(lat);
    const project = (lon, lat0) => {
      const px = lonLatToWorldPx(lon, lat0, Z);
      const fx = px.x / TILE_PX, fy = px.y / TILE_PX;
      return {
        tx: Math.floor(fx), ty: Math.floor(fy),
        wmx: fx * tileEdgeM, wmy: fy * tileEdgeM,
      };
    };
        const bins = new Map();
        const binFor = (tx, ty) => {
          const k = `${tx}_${ty}`;
          let b = bins.get(k);
          if (!b) {
            b = { trees: [], fruittrees: [], shrubs: [], poles: [],
                  wells: [], chests: [], parking: [], streams: [] };
            bins.set(k, b);
          }
          return b;
        };
        // OSM kinds we render as the decorative stone pillar (utility poles /
        // posts). All vertical post-like point features — no interaction.
        const POLE_KINDS = new Set(['pole', 'mast', 'bollard', 'street_lamp']);
        // Sidecar POI kind → in-game chest poiClass. Each becomes a tappable
        // chest; poiClass drives loot / tier / label / pad / coin-burst via
        // loot.js + the render & interact chest paths (see POI_CATEGORY there).
        //   bus_stop → 'bus' (existing lowtier class, "Stagecoach Stop" label)
        //   line     → 'powerline' (power=line way centroid)
        //   tower    → 'tower' POICLASS (lowtier chest) — note this is the chest's
        //              poiClass, NOT the castle 'tower' OBJECT kind.
        //   garden   → 'flora' loot (random flower seed) + a flower burst.
        //   bicycle_parking → coin-burst "treasure hunt" chest (interact.js).
        const SX_CHEST_POI = {
          bus_stop: 'bus', traffic_signals: 'traffic_signals', stop: 'stop',
          crossing: 'crossing', picnic_table: 'picnic_table', memorial: 'memorial',
          gate: 'gate', carport: 'carport', fence: 'fence', line: 'powerline',
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
            const cx = (Math.floor(p.wmx / CELL_M) + 0.5) * CELL_M;
            const cy = (Math.floor(p.wmy / CELL_M) + 0.5) * CELL_M;
            // Species / growth-variant seed. OSM trees key off their stable
            // osm_id; DeepForest trees have none, so derive a stable seed from
            // the snapped cell so a given tree always renders the same.
            const seed = osmId ||
              (((Math.round(cx) * HASH_MUL_X) ^ (Math.round(cy) * HASH_MUL_Y)) >>> 0);
            binFor(p.tx, p.ty).trees.push({
              kind: 'tree', x: cx, y: cy,
              variant: 1 + (seed % 4),
              // DeepForest trees carry a colour-classified species (pine/maple);
              // OSM trees have none → fall back to the seeded random species.
              // Trees near the start are forced softwood (home.js) for easy early wood.
              species: (typeof HomeArea !== 'undefined')
                ? HomeArea.softwoodSpeciesNear(cx, cy, props.species || TREE_SPECIES[seed % TREE_SPECIES.length])
                : (props.species || TREE_SPECIES[seed % TREE_SPECIES.length]),
              id: `tree_${Math.round(cx)}_${Math.round(cy)}`,
              // DeepForest crown diameter (metres) + discrete size class + sampled
              // crown colour → sprite size / tint in render.js. Undefined for OSM
              // trees, which fall back to the flat species scale and no tint.
              crown_m: props.crown_m,
              size: props.size,
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
            const cx = (Math.floor(p.wmx / CELL_M) + 0.5) * CELL_M;
            const cy = (Math.floor(p.wmy / CELL_M) + 0.5) * CELL_M;
            // Peaches are 5× rarer than apples (apple:peach = 5:1). The satellite
            // colour classifier over-reported peaches, so assign species from a
            // stable per-cell hash (1 in 6 → peach) instead of trusting it.
            const ftHash = ((Math.round(cx) * HASH_MUL_X) ^ (Math.round(cy) * HASH_MUL_Y)) >>> 0;
            binFor(p.tx, p.ty).fruittrees.push({
              kind: 'fruittree', x: cx, y: cy,
              species: ftHash % 6 === 0 ? 'peach' : 'apple',
              id: `ft_${Math.round(cx)}_${Math.round(cy)}`,
              crown_m: props.crown_m,
              size: props.size,
              wild: true,            // mature & fruiting (vs a planted sapling)
              individual: true,
            });
          } else if (POLE_KINDS.has(kind)) {
            // Utility pole / post → decorative stone pillar. Snapped to the cell
            // grid like trees; rendered via RENDER_SPEC.pole, no interaction.
            const p = project(lon, lat0);
            const cx = (Math.floor(p.wmx / CELL_M) + 0.5) * CELL_M;
            const cy = (Math.floor(p.wmy / CELL_M) + 0.5) * CELL_M;
            binFor(p.tx, p.ty).poles.push({
              kind: 'pole', x: cx, y: cy,
              id: `pole_${osmId}`,
            });
          } else if (kind === 'tree_row') {
            // Scatter ~5 bushes in a small disc around the row centroid.
            const rng = makeRng((osmId ^ 0xB005FACE) >>> 0);
            const mPerLat = 110540, mPerLon = 111320 * Math.cos(lat0 * Math.PI / 180);
            for (let i = 0; i < 5; i++) {
              const ang = rng() * Math.PI * 2;
              const rad = 2 + rng() * 10;   // 2–12 m from the centroid
              const p = project(lon + (rad * Math.cos(ang)) / mPerLon,
                                lat0 + (rad * Math.sin(ang)) / mPerLat);
              const cx = (Math.floor(p.wmx / CELL_M) + 0.5) * CELL_M;
              const cy = (Math.floor(p.wmy / CELL_M) + 0.5) * CELL_M;
              binFor(p.tx, p.ty).shrubs.push({
                x: cx, y: cy, crop: 'shrub', id: `sxbush_${osmId}_${i}`,
              });
            }
          } else if (kind === 'fountain') {
            // amenity=fountain → a well (water source). Snapped to the cell grid
            // like trees; rendered + interacted as a 'well' object.
            const p = project(lon, lat0);
            const cx = (Math.floor(p.wmx / CELL_M) + 0.5) * CELL_M;
            const cy = (Math.floor(p.wmy / CELL_M) + 0.5) * CELL_M;
            binFor(p.tx, p.ty).wells.push({
              kind: 'well', x: cx, y: cy,
              id: `well_${osmId || (Math.round(cx) + '_' + Math.round(cy))}`,
            });
          } else if (kind === 'parking') {
            // amenity=parking → a buried-treasure X (claimed via the treasure
            // handler), matching the MVT parking path's parkingTreasures.
            const p = project(lon, lat0);
            const cx = (Math.floor(p.wmx / CELL_M) + 0.5) * CELL_M;
            const cy = (Math.floor(p.wmy / CELL_M) + 0.5) * CELL_M;
            binFor(p.tx, p.ty).parking.push({
              x: cx, y: cy, id: `t_park_${Math.round(cx)}_${Math.round(cy)}`,
            });
          } else if (kind === 'stream') {
            // waterway=stream centroid → a small water patch (painted in loadTile).
            const p = project(lon, lat0);
            const cx = (Math.floor(p.wmx / CELL_M) + 0.5) * CELL_M;
            const cy = (Math.floor(p.wmy / CELL_M) + 0.5) * CELL_M;
            binFor(p.tx, p.ty).streams.push({ x: cx, y: cy });
          } else if (SX_CHEST_POI[kind]) {
            // Everything else we care about becomes a POI chest.
            const p = project(lon, lat0);
            const cx = (Math.floor(p.wmx / CELL_M) + 0.5) * CELL_M;
            const cy = (Math.floor(p.wmy / CELL_M) + 0.5) * CELL_M;
            const tags = (f.properties && f.properties.tags) || {};
            binFor(p.tx, p.ty).chests.push({
              kind: 'chest', x: cx, y: cy,
              poiClass: SX_CHEST_POI[kind],
              name: tags.name || '',
              // Garden chests scatter a flower burst at injection time.
              garden: kind === 'garden' || undefined,
              id: `sxc_${osmId || (Math.round(cx) + '_' + Math.round(cy))}`,
            });
          }
        }
        return bins;
  }

  // Static sidecar loader: fetch the pre-extracted (OSM + DeepForest +
  // Grounding DINO) geojson once and bin it. Memoized for the session.
  // ?v bumps whenever data/satextract_osm.geojson is regenerated — the file
  // name is otherwise stable, so without a cache-bust the browser serves a
  // stale copy and freshly-extracted features (poles, relocated trees) never
  // appear. Bump this when you re-run satextract.
  function ensureSatextract(lat) {
    if (_satextractPromise) return _satextractPromise;
    _satextractPromise = fetch('data/satextract_osm.geojson?v=7')
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
  // poles, street furniture, fountains, streams) — the DeepForest crowns and
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
      e.poles   = (bin.poles || []).length;
      e.chests  = (bin.chests || []).length;
      e.wells   = (bin.wells || []).length;
      e.shrubs  = (bin.shrubs || []).length;
      e.streams = (bin.streams || []).length;
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
      const total = (e.trees || 0) + (e.poles || 0) + (e.chests || 0) + (e.wells || 0) + (e.shrubs || 0) + (e.streams || 0) + (e.parking || 0);
      if (!total) return `live=on  src=${src} — area has 0 OSM features` + tail;
      return `live=on  src=${src}: ${e.trees || 0} trees, ${e.poles || 0} poles, ${e.chests || 0} chests, `
        + `${e.wells || 0} wells, ${e.shrubs || 0} bushes, ${e.streams || 0} streams, ${e.parking || 0} parking` + tail;
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
    return { trees: [], fruittrees: [], shrubs: [], poles: [],
             wells: [], chests: [], parking: [], streams: [] };
  }
  // Inverse slippy-map: z14 tile index → lon/lat of its NW corner.
  function tileLon(xt) { return xt / (1 << Z) * 360 - 180; }
  function tileLat(yt) {
    const n = Math.PI - 2 * Math.PI * yt / (1 << Z);
    return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  }
  // OSM tag set → satextract `kind`. Mirrors the tags satextract's `osm`
  // source pulls, so live and static features land in the same bins. Order
  // matters only where a feature could carry two matching tags (rare).
  function osmKindOf(tags) {
    if (!tags) return null;
    if (tags.natural === 'tree') return 'tree';
    if (tags.natural === 'tree_row') return 'tree_row';
    if (tags.power === 'pole' || tags.man_made === 'utility_pole') return 'pole';
    if (tags.man_made === 'mast') return 'mast';
    if (tags.barrier === 'bollard') return 'bollard';
    if (tags.highway === 'street_lamp') return 'street_lamp';
    if (tags.amenity === 'fountain') return 'fountain';
    if (tags.amenity === 'parking') return 'parking';
    if (tags.waterway === 'stream') return 'stream';
    if (tags.highway === 'bus_stop') return 'bus_stop';
    if (tags.highway === 'traffic_signals') return 'traffic_signals';
    if (tags.highway === 'stop') return 'stop';
    if (tags.highway === 'crossing') return 'crossing';
    if (tags.leisure === 'picnic_table') return 'picnic_table';
    if (tags.historic === 'memorial') return 'memorial';
    if (tags.barrier === 'gate') return 'gate';
    if (tags.amenity === 'bicycle_parking') return 'bicycle_parking';
    if (tags.leisure === 'garden') return 'garden';
    if (tags.leisure === 'playground') return 'playground';
    if (tags.leisure === 'pitch') return 'pitch';
    if (tags.leisure === 'swimming_pool' || tags.amenity === 'swimming_pool') return 'swimming_pool';
    if (tags.man_made === 'tower') return 'tower';
    if (tags.power === 'line') return 'line';
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
    // additive set: trees (satextract's whole point), utility posts, fountains,
    // streams, and a little street furniture MVT omits.
    // Nodes for point features; ways (via `out center`) for tree_row / stream.
    const sels = [
      'node["natural"="tree"]', 'way["natural"="tree_row"]',
      'node["power"="pole"]', 'node["man_made"="utility_pole"]',
      'node["man_made"="mast"]', 'node["highway"="street_lamp"]',
      'node["amenity"="fountain"]', 'way["waterway"="stream"]',
      'node["leisure"="picnic_table"]', 'node["historic"="memorial"]',
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
  // Per-tile cache + in-flight dedup so a tile is queried at most once.
  const _overpassInflight = new Map();
  async function fetchOverpassBin(x, y, lat) {
    const key = `ovp/${Z}/${x}/${y}`;
    const cached = await idbGet(key);
    if (cached) return cached;                 // already-transformed bin
    if (_overpassInflight.has(key)) return _overpassInflight.get(key);
    const p = (async () => {
      await overpassAcquire();
      try {
        const body = 'data=' + encodeURIComponent(buildOverpassQL(x, y));
        let json = null;
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
            if (!resp.ok) continue;            // 429 / load-shed → next mirror
            json = await resp.json();
            break;
          } catch (_) { /* abort/network error → try next endpoint */ }
          finally { if (timer) clearTimeout(timer); }
        }
        if (!json) { ovpNote(x, y, 'failed'); return null; }   // fail soft: no decoration, retry later
        const bins = buildBinsFromGeoJSON(overpassToGeoJSON(json.elements), lat);
        // Features near the bbox edge can project into a neighbour tile; we
        // keep only this tile's bin (neighbours fetch their own bbox).
        const bin = bins.get(`${x}_${y}`) || emptyBin();
        idbPut(key, bin);                      // trees/poles ~static → cache forever
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
    const key = `ovp/${Z}/${x}/${y}`;
    let cached = null;
    try { cached = await idbGet(key); } catch (_) { cached = null; }   // local, fast, can't hang on the network
    if (cached) { ovpNote(x, y, 'cache', cached); return cached; }
    ovpNote(x, y, 'fetching');
    fetchOverpassBin(x, y, lat).catch(() => {});   // fire-and-forget; lands in IDB
    return null;
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

  function caveStairId(dir, depth, x, y) {
    return `stair_${dir}_${depth}_${Math.round(x)}_${Math.round(y)}`;
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
    return cellCentreM(tx, ty, idx % N, Math.floor(idx / N), tileEdgeM, N);
  }

  // Surface entrances: ~30 % of residential rock clusters get a down-staircase
  // beside them (so caves are common in town), and every tile is guaranteed at
  // least one entrance — anchored to a cave rock where one exists, otherwise on
  // a random walkable cell.
  function maybePlaceCaveEntrance(entry, tx, ty, tileEdgeM) {
    const caveRocks = (entry.objects || []).filter(
      o => o.kind === 'mineralrock' && o.caveVariant != null);
    const N = entry.cellsPerEdge, grid = entry.grid;
    const rng = makeRng(((tx * HASH_MUL_X) ^ (ty * HASH_MUL_Y)) >>> 0);
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

    // Drop a down-staircase on the first walkable cell touching `rock`. Returns
    // true on success; de-dupes so two clusters can't stack stairs on one cell,
    // and skips cells too near an entrance already placed on this tile.
    const placeBeside = (rock) => {
      const { lix: rlix, liy: rliy } = cellIndexOf(tx, ty, rock.x, rock.y, tileEdgeM, N);
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
      for (const [dx, dy] of dirs) {
        const lix = rlix + dx, liy = rliy + dy;
        if (lix < 0 || liy < 0 || lix >= N || liy >= N) continue;
        const idx = liy * N + lix;
        if (used.has(idx) || !isWalkable(grid[idx]) || tooClose(lix, liy)) continue;
        used.add(idx);
        markPlaced(lix, liy);
        const { x, y } = cellCentreM(tx, ty, lix, liy, tileEdgeM, N);
        entry.objects.push({ kind: 'staircase', dir: 'down', x, y, depth: 0,
          id: caveStairId('down', 0, x, y) });
        return true;
      }
      return false;
    };

    // Drop a down-staircase on a random walkable cell (used when the tile has
    // no cave rock to anchor to). Returns true on success.
    const placeRandomWalkable = () => {
      const cells = [];
      for (let i = 0; i < grid.length; i++) {
        if (!used.has(i) && isWalkable(grid[i]) && !tooClose(i % N, Math.floor(i / N))) {
          cells.push(i);
        }
      }
      if (!cells.length) return false;
      const idx = cells[Math.floor(rng() * cells.length)];
      used.add(idx);
      markPlaced(idx % N, Math.floor(idx / N));
      const { x, y } = cellCentreM(tx, ty, idx % N, Math.floor(idx / N), tileEdgeM, N);
      entry.objects.push({ kind: 'staircase', dir: 'down', x, y, depth: 0,
        id: caveStairId('down', 0, x, y) });
      return true;
    };

    // Group cave rocks by their residential cluster id. Non-residential rocks
    // (industrial / ROCK terrain) carry no cluster id and fall through to the
    // per-tile guarantee below.
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
    if (placed === 0) {
      if (caveRocks.length) placeBeside(caveRocks[Math.floor(rng() * caveRocks.length)]);
      else placeRandomWalkable();
    }
  }

  // Scatter mineralrock clusters across a cave level's floor (caves would
  // otherwise be bare rock-and-staircase shells). Each rock rolls plain-vs-ore
  // via caveRockP, so plain stone is always the majority and ore grows with
  // depth. Some clusters are VEIN ZONES — one ore/crystal tier is concentrated
  // 10× for that cluster only — the same trick the surface residential clusters
  // use (see _spawnRockClusters). Rocks land only on CAVE_FLOOR cells, never on
  // a staircase cell (`occupied`). Deterministic per tile+depth.
  function spawnCaveRocks(grid, N, tx, ty, tileEdgeM, depth, objects, occupied) {
    const rng = makeRng(((tx * HASH_MUL_X) ^ (ty * HASH_MUL_Y) ^ (depth * 0x85EBCA6B)) >>> 0);
    const plainP = caveRockP(depth);
    // Same copper-dominant ore shape as the residential surface clusters.
    const weights = [0.30, 0.25, 0.22, 0.08, 0.07, 0.05, 0.03];
    const cum = (ws) => { let t = 0; const c = ws.map(w => (t += w)); return { tierW: c, totalW: t }; };
    const baseTbl = cum(weights);
    const CAVE_VARIANTS = 4;     // plain-rock art variants (render.js)
    const PIVOT = 6;             // a cluster candidate every 6 cells
    const FIRE = 0.85;           // most candidates fire
    const CLUSTER_MIN = 3, CLUSTER_SPAN = 3;   // 3..5 rocks — ~2× sparser than before
    const RADIUS = 1;            // rocks jitter within ±1 cell — tight clumps, not scatter
    const VEIN_CHANCE = 0.30;    // ~30 % of clusters are a single-tier vein zone
    const VEIN_MUL = 10;
    for (let py = 1; py < N; py += PIVOT) {
      for (let px = 1; px < N; px += PIVOT) {
        if (rng() > FIRE) continue;
        const n = CLUSTER_MIN + Math.floor(rng() * CLUSTER_SPAN);
        // Vein zone: concentrate one randomly-chosen ore tier 10× for this
        // cluster, so a pocket reads as "an iron vein" / "a gold seam" rather
        // than evenly-mixed ore. Doesn't touch the plain-vs-ore split.
        let tbl = baseTbl;
        if (rng() < VEIN_CHANCE) {
          const vt = Math.floor(rng() * weights.length);
          const boosted = weights.slice();
          boosted[vt] *= VEIN_MUL;
          tbl = cum(boosted);
        }
        for (let k = 0; k < n; k++) {
          const lix = px + Math.round((rng() - 0.5) * 2 * RADIUS);
          const liy = py + Math.round((rng() - 0.5) * 2 * RADIUS);
          if (lix < 0 || liy < 0 || lix >= N || liy >= N) continue;
          const idx = liy * N + lix;
          if (grid[idx] !== T.CAVE_FLOOR || occupied.has(idx)) continue;
          occupied.add(idx);
          const { x: cx, y: cy } = cellCentreM(tx, ty, lix, liy, tileEdgeM, N);
          const id = `cmr_${depth}_${tx}_${ty}_${lix}_${liy}`;
          if (rng() < plainP) {
            objects.push({ kind: 'mineralrock', x: cx, y: cy, requiredTier: 1,
              caveVariant: Math.floor(rng() * CAVE_VARIANTS), id });
            continue;
          }
          const r = rng() * tbl.totalW;
          let yieldTier = 7;
          for (let i = 0; i < tbl.tierW.length; i++) {
            if (r <= tbl.tierW[i]) { yieldTier = i + 1; break; }
          }
          objects.push({ kind: 'mineralrock', x: cx, y: cy, yieldTier,
            requiredTier: Math.max(1, yieldTier - 1), id });
        }
      }
    }
  }

  async function loadCaveTile(cache, depth, key, x, y, lat) {
    const above = await loadTile.atDepth(depth - 1, x, y, lat);
    if (above.status === 'loading') await above.promise;
    const N = above.cellsPerEdge;
    const tileEdgeM = above.tileEdgeM;
    const grid = new Uint8Array(N * N);
    for (let i = 0; i < grid.length; i++) {
      grid[i] = isWalkable(above.grid[i]) ? T.CAVE_FLOOR : T.CAVE_WALL;
    }
    const objects = [];
    const downAbove = (above.objects || []).filter(
      o => o.kind === 'staircase' && o.dir === 'down');
    for (const s of downAbove) {
      // Way back up: stand on it the moment you descend.
      objects.push({ kind: 'staircase', dir: 'up', x: s.x, y: s.y, depth,
        id: caveStairId('up', depth, s.x, s.y) });
      // Way deeper: a random floor cell anywhere on this level, so the descent
      // shaft wanders instead of stacking straight down. Seeded off the source
      // stair + depth so the layout is stable across reloads.
      const { lix: ulix, liy: uliy } = cellIndexOf(x, y, s.x, s.y, tileEdgeM, N);
      const skipIdx = (ulix >= 0 && ulix < N && uliy >= 0 && uliy < N)
        ? uliy * N + ulix : -1;
      const dnRng = makeRng(
        ((Math.round(s.x) * HASH_MUL_X) ^ (Math.round(s.y) * HASH_MUL_Y)
          ^ (depth * 0x9E3779B1)) >>> 0);
      const dn = randomFloorCell(grid, N, x, y, tileEdgeM, dnRng, skipIdx);
      if (dn) objects.push({ kind: 'staircase', dir: 'down', x: dn.x, y: dn.y, depth,
        id: caveStairId('down', depth, dn.x, dn.y) });
    }
    // Fill the level with rock clusters, keeping the staircase cells clear so a
    // stair never spawns buried under a rock sprite.
    const occupied = new Set();
    for (const o of objects) {
      const { lix, liy } = cellIndexOf(x, y, o.x, o.y, tileEdgeM, N);
      if (lix >= 0 && lix < N && liy >= 0 && liy < N) occupied.add(liy * N + lix);
    }
    spawnCaveRocks(grid, N, x, y, tileEdgeM, depth, objects, occupied);
    const entry = {
      status: 'ready', grid, cellsPerEdge: N, tileEdgeM, depth,
      objects, wildplants: [], parkingTreasures: [],
      roadLetters: {}, pathNames: {}, pathUnder: {},
    };
    cache.set(key, entry);
    const MAX_CACHED_TILES = 64;
    while (cache.size > MAX_CACHED_TILES) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey === key) break;
      cache.delete(oldestKey);
    }
    return entry;
  }

  // Load a tile at an EXPLICIT depth (used by cave generation to read the level
  // above without disturbing the active depth). Surface/cave dispatch mirrors
  // loadTile's own branch.
  loadTile.atDepth = async function (depth, x, y, lat) {
    const cache = cacheFor(depth);
    const key = `${Z}/${x}/${y}`;
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

  // Specialty shop type for small houses, derived from the synthetic street
  // address. Forts (BUILDING_MED) and civic slabs are excluded — only the
  // small residential tier gets address-based specialties.
  // The specialty-shop taxonomy + label + tint + sell-bonus all live in
  // shops.js; the only thing worldgen owns here is the address field itself.

  global.WorldGen = {
    Z, CELL_M, TILE_PX, T, TILE_URL,
    lonLatToWorldPx, metersPerPixel, tileEdgeMeters, cellsPerEdgeForLat,
    tileXYForLonLat, loadTile, tileCache, makeRng,
    forEachItem, isWalkable, isSpawnCell, setDepth,
    // Live Overpass decoration (ON by default): fills tiles outside the static
    // satextract bbox with OSM features queried at request time, cached per
    // tile in IndexedDB. Opt out with setOverpassLive(false) or ?overpass=off.
    setOverpassLive: (b) => { _overpassLive = !!b; },
    overpassTileInfo,   // one-line status for a tile, surfaced in TILE DEBUG
  };
})(window);
