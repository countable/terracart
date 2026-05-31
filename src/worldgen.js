// World generation: fetch MVT tiles and rasterize into a grid of 5m game cells.
// Coords: web-mercator pixel space at z=14. 1 MVT tile = 256 px = 4096 MVT units.
// Game cell = 5 m. Cell size in pixels depends on latitude.

(function (global) {
  const Z = 14;
  const TILE_PX = 256;          // standard
  const TILE_EXTENT = 4096;     // MVT units
  const CELL_M = 5;             // game cell size in meters
  const TILE_URL = 'https://tiles.openfreemap.org/planet/20260520_001001_pt/{z}/{x}/{y}.pbf';

  // Spatial-hash multipliers. The (HASH_MUL_X, HASH_MUL_Y) pair is the classic
  // 2D integer hash used to derive stable per-coordinate seeds (poly keys, tile
  // rng, addresses, satextract tree seeds). (BURST_MUL_X, BURST_MUL_Y) is a
  // second independent pair used for the garden flower-burst seed. Renamed from
  // bare literals — values are byte-identical to the originals.
  const HASH_MUL_X = 73856093;
  const HASH_MUL_Y = 19349663;
  const BURST_MUL_X = 374761393;
  const BURST_MUL_Y = 668265263;

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
  };
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
  // tile should have AT LEAST 20% small houses, 8% forts, and 2% castles.
  // If the default thresholds don't hit those minima on this tile's actual
  // area distribution, promote/demote by area-rank until they do — biggest
  // buildings get the biggest tier. n < 5 skips (too few to enforce
  // meaningfully); 5 ≤ n < 25 only enforces fort + small (round(n*0.02) = 0).
  // Mutates each entry's `.tier`.
  function enforceBuildingDistribution(polys) {
    const n = polys.length;
    if (n < 5) return;
    const needLarge = Math.max(0, Math.round(n * 0.02));
    const needMed   = Math.max(0, Math.round(n * 0.08));
    const needSmall = Math.max(0, Math.round(n * 0.20));
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
  const tileCache = new Map();   // "z/x/y" -> { promise, grid, cellsPerEdge, status }
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

  // Map terrain type → wild "debris" crop spawned in polygons of that type.
  // Each polygon gets its own stable density in [DEBRIS_MIN, DEBRIS_MAX].
  const DEBRIS_CROP = {
    // Residential no longer spawns rockfruit debris — the cave mineralrock
    // clusters (worldgen mineralrock helper, T.RESIDENTIAL branch) are now
    // the canonical urban stone source. Wild rockfruit on sidewalks read
    // as litter; cave-rock piles read as a quarry corner.
    6:  'shrub',     // PARK
    1:  'shrub',     // FOREST
    2:  'shell',     // SAND — beaches grow shells as common debris
    // longgrass is spawned independently for the whole grassland family below — it isn't
    // wired through DEBRIS_CROP because PARK already grows shrubs, and we want each
    // grassland polygon to get its own seeded longgrass density in [0%, 15%].
  };
  const DEBRIS_MIN = 0.05;
  const DEBRIS_MAX = 0.30;
  // Polygon classes that may grow tufts of harvestable long grass.
  const LONGGRASS_TYPES = new Set([T.GRASS, T.PARK, T.SCHOOL, T.PLAYGROUND, T.PITCH, T.GOLF]); // 0, 6, 15, 18, 19, 21
  const LONGGRASS_MAX_DENSITY = 0.15;
  const LONGGRASS_RNG_SALT = 0x5a17b105;
  // Salt for the rare-nut RNG stream in forests — independent of the shrub stream
  // that shares the same polygon key. (Was `0xdeadbeef`.)
  const NUT_RNG_SALT = 0xdeadbeef;

  // Per-biome decorative items (purely visual, non-interactable). Stored as
  // { kind: 'flora', x, y, deco: '<kind>', variant: 0..N } and rendered by app.js
  // using procedurally-generated 16x16 textures.
  // dMin/dMax is the per-polygon density range — each polygon rolls its own
  // density inside this range (so some grass fields are barren, others bloom).
  // Every grass/park polygon shows SOME flowers (dMin > 0) so a grass tile
  // never reads as flowerless. dMax stays modest — fields shouldn't be
  // wall-to-wall blossoms. Polygon picks one density + one color variant.
  const FLORA_BY_TYPE = {
    [T.GRASS]:      { deco: 'flower', dMin: 0.015, dMax: 0.06 },
    [T.PARK]:       { deco: 'flower', dMin: 0.015, dMax: 0.06 },
    [T.GOLF]:       { deco: 'flower', dMin: 0.015, dMax: 0.06 },
    [T.PITCH]:      { deco: 'flower', dMin: 0.015, dMax: 0.06 },
    [T.PLAYGROUND]: { deco: 'flower', dMin: 0.015, dMax: 0.06 },
    [T.WETLAND]:    { deco: 'flower', dMin: 0.015, dMax: 0.06 },
    // Mushroom decals belong to shady residential yards, not open grass fields.
    [T.RESIDENTIAL]: { deco: 'mushroom', dMin: 0.01, dMax: 0.035 },
  };
  const FLORA_VARIANTS = { flower: 4, mushroom: 2 };

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

    // Spawn purely-decorative flora (flowers/pebbles/mushrooms) inside a polygon at
    // very low density. Snapped to the local cell grid like debris, but stored
    // separately so it never gets picked up.
    function spawnFlora(rings, deco, polyKey, dMin, dMax) {
      const prng = makeRng(polyKey ^ 0xc0ffee);
      const variants = FLORA_VARIANTS[deco] || 1;
      // Per-polygon density inside the [dMin, dMax] range — some fields are
      // barren, some are dense. Density of 0 means we skip this polygon entirely.
      const density = dMin + prng() * (dMax - dMin);
      if (density <= 0.0001) return;
      // Flowers pick ONE color per polygon (so a whole field reads as e.g. all
      // yellow or all red). Pebbles/mushrooms vary per-item for organic look.
      const polyVariant = Math.floor(prng() * variants);
      const bb = bboxOf(rings);
      const stepMvt = 5 / mvtToM;
      for (let yy = bb.minY; yy <= bb.maxY; yy += stepMvt) {
        for (let xx = bb.minX; xx <= bb.maxX; xx += stepMvt) {
          if (!pointInRings(rings, xx + stepMvt * 0.5, yy + stepMvt * 0.5)) continue;
          const localIX = Math.floor(xx * mvtToCell);
          const localIY = Math.floor(yy * mvtToCell);
          if (localIX < 0 || localIY < 0 || localIX >= w || localIY >= h) continue;
          if (prng() < density) {
            const { mx: cx, my: cy } = cellCenterMeters(localIX, localIY);
            const variant = (deco === 'flower') ? polyVariant : Math.floor(prng() * variants);
            // Stable id keyed on tile + local cell so save.picked persists across reloads.
            objects.push({
              kind: 'flora',
              x: cx, y: cy,
              deco,
              variant,
              id: `fl_${tx}_${ty}_${localIX}_${localIY}`,
              _ix: localIX, _iy: localIY,  // for post-pass biome filter
            });
          }
        }
      }
    }

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
    // the terrain `grid[]`, wildplants (spawnDebris) and flora (spawnFlora)
    // already use. Every placed object must share this one grid: structs
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

    const order = ['landcover', 'landuse', 'park', 'water', 'transportation', 'building', 'poi'];
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

            // Per-polygon DEBRIS (e.g. rockfruit in residential, shrub in park/forest).
            const debrisCrop = DEBRIS_CROP[t];
            if (debrisCrop) {
              spawnDebris(f.geom, debrisCrop, polyKey);
              // Extra rare nut sprinkle on forest polygons. XOR with a fixed salt so the
              // nut and shrub debris share the same polygon key but use independent RNG streams.
              if (t === 1) spawnDebris(f.geom, 'nut', polyKey ^ NUT_RNG_SALT, 0.005, 0.03);
            }

            // Long grass — additive spawn across the whole grassland family. Each polygon's
            // density is a stable random value in [0%, 15%] (seeded by polyKey), so most
            // polygons grow at least a tuft or two, big meadows visibly cluster, and the
            // unlucky ones with near-0% density grow nothing — natural per-area variation.
            if (LONGGRASS_TYPES.has(t)) {
              const seed = (polyKey ^ LONGGRASS_RNG_SALT) >>> 0;
              const density = ((seed % 1000) / 1000) * LONGGRASS_MAX_DENSITY;
              if (density > 0) spawnDebris(f.geom, 'longgrass', seed, density, density);
            }

            // Per-polygon FLORA (purely decorative drops: flowers / pebbles / mushrooms).
            const florax = FLORA_BY_TYPE[t];
            if (florax) spawnFlora(f.geom, florax.deco, polyKey, florax.dMin, florax.dMax);

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
                        species,
                        id: `tree_${Math.round(cx)}_${Math.round(cy)}` });
                    }
                  }
                }
                // Rare mushroom clusters in the same forest polygon. Independent RNG
                // stream (different salt) so they don't co-locate with shrubs/nuts.
                spawnDebris(f.geom, 'mushroom', (polyKey ^ 0xBADF00D) >>> 0, 0.04, 0.10);
              }
              // Fruit trees on ORCHARD landcover. One species per polygon so a single
              // orchard reads as one fruit type.
              if (cls === 'orchard' || f.tags.subclass === 'orchard') {
                const FRUIT_SPECIES = ['apple', 'cherry', 'peach', 'banana', 'orange', 'mango', 'coconut', 'apricot'];
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
            const _CAVE_ROCK_P = 0.70;
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
            const _pushMineralrock = (rng, jx, jy, tierW, totalW, residential) => {
              if (!pointInRings(f.geom, jx, jy)) return;
              const { cx, cy } = snapCell(jx, jy);
              if (rng() < _CAVE_ROCK_P) {
                const caveVariant = Math.floor(rng() * _CAVE_VARIANTS);
                objects.push({ kind: 'mineralrock', x: cx, y: cy, requiredTier: 1,
                  caveVariant, _residential: residential || undefined,
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

            // Residential mineral clusters — a few abandoned-yard / construction
            // piles in town. Sparse: pivot grid is ~30 m so most residential
            // polygons spawn 0-1 clusters; each cluster is 3-5 low-tier rocks
            // grouped within ~6 m. Gives the early game a reliable urban source
            // of stone + low-tier ore without flooding sidewalks with rocks.
            if (t === T.RESIDENTIAL) {
              const resRng = makeRng((polyKey ^ 0xFA11) >>> 0);
              const bb = bboxOf(f.geom);
              const pivotStep = 24 / mvtToM;        // one cluster candidate per ~24 m
              const clusterR  = 7  / mvtToM;        // rocks placed within ~7 m of pivot
              // Explicit tier weights for residential — user-tuned to hit:
              //   ~70 %   vanilla cave  (handled at the helper, not here)
              //   ~20 %   copper        T1 + T2 of the ore subset
              //   ~8  %   iron          T3
              //   ~3  %   gold          T4
              //   ~5  %   crystals      T5 + T6 + T7
              // Of TOTAL rock count. Within the 30 % ore subset that's
              // copper 0.55, iron 0.22, gold 0.08, crystals 0.14.
              const weights = [0.30, 0.25, 0.22, 0.08, 0.07, 0.05, 0.03];
              const tierW = [];
              let totalW = 0;
              for (const w of weights) { totalW += w; tierW.push(totalW); }
              for (let yy = bb.minY; yy <= bb.maxY; yy += pivotStep) {
                for (let xx = bb.minX; xx <= bb.maxX; xx += pivotStep) {
                  if (!pointInRings(f.geom, xx + pivotStep * 0.5, yy + pivotStep * 0.5)) continue;
                  if (resRng() > 0.45) continue;   // 45 % of pivots fire a cluster
                  const clusterN = 25 + Math.floor(resRng() * 16);   // 25..40 rocks per cluster (residential rocks survive the road-adjacency filter at a lower rate, so input has to overshoot)
                  for (let k = 0; k < clusterN; k++) {
                    const jx = xx + (resRng() - 0.5) * 2 * clusterR;
                    const jy = yy + (resRng() - 0.5) * 2 * clusterR;
                    _pushMineralrock(resRng, jx, jy, tierW, totalW, /* residential */ true);
                  }
                }
              }
              // Sparse pickable wild mushrooms in residential yards — same crop
              // as the forest clusters but rarer. Independent RNG stream so they
              // don't co-locate with the rock clusters above.
              spawnDebris(f.geom, 'mushroom', (polyKey ^ 0x5EEDCAFE) >>> 0, 0.008, 0.025);
            }

            // Industrial mineral piles — old quarries, scrap yards, slag heaps.
            // Dense (lots of rocks): tight pivot grid + high fire chance + bigger
            // clusters than residential. Tier dropoff is slower (1/1.6^(t-1)) so
            // mid-tier metals (gold/platinum) actually show up here, but T7 stays
            // very rare via the geometric tail (~3 % per cluster pick).
            if (t === T.INDUSTRIAL) {
              const indRng = makeRng((polyKey ^ 0xC0A11D) >>> 0);
              const bb = bboxOf(f.geom);
              const pivotStep = 14 / mvtToM;        // ~one candidate per 14 m — much denser than residential's 30
              const clusterR  = 5  / mvtToM;        // ~5 m cluster radius
              // Slower tier dropoff than residential — mid-tier ore (gold,
              // platinum) shows up regularly while T7 stays ~3 % per ore pick.
              const tierW = [];
              let totalW = 0;
              for (let t2 = 1; t2 <= 7; t2++) {
                const w = 1 / Math.pow(1.6, t2 - 1);
                totalW += w;
                tierW.push(totalW);
              }
              for (let yy = bb.minY; yy <= bb.maxY; yy += pivotStep) {
                for (let xx = bb.minX; xx <= bb.maxX; xx += pivotStep) {
                  if (!pointInRings(f.geom, xx + pivotStep * 0.5, yy + pivotStep * 0.5)) continue;
                  if (indRng() > 0.80) continue;   // 80 % of pivots fire — "lots"
                  const clusterN = 18 + Math.floor(indRng() * 16);   // 18..33 rocks per cluster (3× the prior 6..11)
                  for (let k = 0; k < clusterN; k++) {
                    const jx = xx + (indRng() - 0.5) * 2 * clusterR;
                    const jy = yy + (indRng() - 0.5) * 2 * clusterR;
                    _pushMineralrock(indRng, jx, jy, tierW, totalW);
                  }
                }
              }
            }

            // Dense mineral rock clusters on ROCK terrain (scree / cliff landcover).
            // Cluster style mirrors residential but at higher density — tight 12 m
            // pivot grid, 70 % fire rate, 10-19 rocks per cluster. Tier weights use
            // a steeper geometric decay than industrial so low-tier stones dominate
            // but rare wilderness finds (T5-T7) are still possible.
            if (t === T.ROCK) {
              const rockRng = makeRng((polyKey ^ 0xCAFE) >>> 0);
              const bb = bboxOf(f.geom);
              const pivotStep = 12 / mvtToM;
              const clusterR  =  6 / mvtToM;
              // 1/2^(t-1): T1 ~50%, T2 ~25%, T3 ~13% … T7 ~1% of ore subset.
              // _pushMineralrock still routes 70% of picks to cave rock.
              const tierW = [];
              let totalW = 0;
              for (let t2 = 1; t2 <= 7; t2++) {
                totalW += 1 / Math.pow(2, t2 - 1);
                tierW.push(totalW);
              }
              for (let yy = bb.minY; yy <= bb.maxY; yy += pivotStep) {
                for (let xx = bb.minX; xx <= bb.maxX; xx += pivotStep) {
                  if (!pointInRings(f.geom, xx + pivotStep * 0.5, yy + pivotStep * 0.5)) continue;
                  if (rockRng() > 0.70) continue;
                  const clusterN = 10 + Math.floor(rockRng() * 10);
                  for (let k = 0; k < clusterN; k++) {
                    const jx = xx + (rockRng() - 0.5) * 2 * clusterR;
                    const jy = yy + (rockRng() - 0.5) * 2 * clusterR;
                    _pushMineralrock(rockRng, jx, jy, tierW, totalW);
                  }
                }
              }
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
          for (const ring of f.geom) {
            const p = ring[0];
            const m = toMeters(p.x, p.y);
            const cx = snap(m.x), cy = snap(m.y);
            const id = `c_${Math.round(cx)}_${Math.round(cy)}`;
            objects.push({ kind: 'chest', x: cx, y: cy, id,
              poiClass: cls, name: f.tags.name || '' });
            // (Garden flower burst is emitted AFTER the chest relocation
            // pass below — see the `if (cls === 'garden')` block after the
            // onBuilding / offsetForPlacement branches. Doing it here would
            // (a) break the `lastChest = objects[objects.length-1]` lookup
            // and (b) position floras around the un-relocated chest.)
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
            // Garden POIs get a flower burst — 6–8 flora decorations scattered
            // in a 1–3 cell ring around the chest's FINAL position. Emitted
            // here (after relocation) so positions reflect the actual chest
            // cell, and after the `lastChest` lookups above so we don't break
            // them by pushing non-chest objects on top of the stack.
            //
            // Each flora carries `_ix`/`_iy` because the unified occupancy
            // post-pass (below) reads `grid[o._iy * w + o._ix]` to gate flora
            // by terrain. Without those, every burst flora was being dropped
            // (grid[NaN] = undefined, fails FLORA_OK).
            if (cls === 'garden') {
              const FLOWER_VARIANTS = 4;
              // Use the chest's final cell as the burst centre. After the
              // branches above, cellIX/cellIY point at the chest cell (either
              // the building-perimeter cell or the road-offset placement).
              const chestObj = objects[objects.length - 1];
              const chestX = (chestObj && chestObj.kind === 'chest') ? chestObj.x : cx;
              const chestY = (chestObj && chestObj.kind === 'chest') ? chestObj.y : cy;
              const burstSeed = ((Math.round(chestX) * BURST_MUL_X) ^ (Math.round(chestY) * BURST_MUL_Y)) >>> 0;
              const brng = makeRng(burstSeed);
              const burstN = 6 + Math.floor(brng() * 3);   // 6..8
              for (let i = 0; i < burstN; i++) {
                const ang = brng() * Math.PI * 2;
                const r   = (1 + brng() * 2) * cellWidthM;   // 1–3 cells out
                const fx  = snap(chestX + Math.cos(ang) * r);
                const fy  = snap(chestY + Math.sin(ang) * r);
                // Compute the local-tile cell index for the post-pass filter.
                const fIx = Math.floor((fx - tileOriginMx) / mvtToM * mvtToCell);
                const fIy = Math.floor((fy - tileOriginMy) / mvtToM * mvtToCell);
                if (fIx < 0 || fIy < 0 || fIx >= w || fIy >= h) continue;
                objects.push({ kind: 'flora', deco: 'flower', x: fx, y: fy,
                  variant: Math.floor(brng() * FLOWER_VARIANTS),
                  _ix: fIx, _iy: fIy,
                  id: `gb_${Math.round(fx)}_${Math.round(fy)}` });
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
          const c = ringCentroid(bp.ring);
          const m = toMeters(c.x, c.y);
          // Position the house sprite on this tile's cell grid (shared with
          // every other object) so the occupancy pass dedupes it against
          // trees / rocks / etc and a row of houses still lines up cleanly.
          const { cx, cy } = snapCell(c.x, c.y);
          // The address (→ shop type) stays keyed to the GLOBAL 5 m cell so a
          // house keeps the same shop role regardless of grid changes.
          const ix = Math.floor(m.x / CELL_M);
          const iy = Math.floor(m.y / CELL_M);
          // Stable id for per-house shop state (deal rate-limit, future ledger).
          const id = `h_${Math.round(cx)}_${Math.round(cy)}`;
          // Synthetic 3-digit street address derived from cell coords. Houses
          // whose address ends in 9 become blacksmiths (~10% of houses).
          const address = (((ix * HASH_MUL_X) ^ (iy * HASH_MUL_Y)) >>> 0) % 1000;
          objects.push({ kind: 'house', x: cx, y: cy, area: bp.areaM2, tier: bp.tier, id, address });
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
      const _mrIsRoad = (ix, iy) => {
        const tc = grid[iy * w + ix];
        return tc === T.ROAD || tc === T.ROAD_LG || tc === T.ROAD_MD || tc === T.PATH;
      };
      // The grid is indexed in the TILE's cell basis — cell width =
      // tileEdgeM / cellsPerEdge, NOT the global CELL_M (5 m). Round-up
      // from cellsPerEdge × CELL_M to tileEdgeM produces ~0.03 m of
      // drift per cell, which accumulates to ~1.5 m by the far edge of
      // a 50-cell tile — enough to put the rock's "lookup cell" one
      // column off from where it actually sits on the painted grid.
      // Use the same basis the grid was painted with.
      const _mrCellW = tileEdgeM / w;
      // Reusable Chebyshev "is a road within R cells?" probe.
      const _mrNearRoadWithin = (ix, iy, R) => {
        for (let dy = -R; dy <= R; dy++) {
          for (let dx = -R; dx <= R; dx++) {
            const nx = ix + dx, ny = iy + dy;
            if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
            if (_mrIsRoad(nx, ny)) return true;
          }
        }
        return false;
      };
      // Houses are placed inside building footprints — always road-adjacent
      // by virtue of OSM data and never something the player wades into a
      // back yard for. Keep them exempt from the residential proximity
      // check below.
      const _mrSkipKind = (k) => k === 'house' || k === 'tower';
      for (let i = objects.length - 1; i >= 0; i--) {
        const o = objects[i];
        if (_mrSkipKind(o.kind)) continue;
        const ix = Math.floor((o.x - tileOriginMx) / _mrCellW);
        const iy = Math.floor((o.y - tileOriginMy) / _mrCellW);
        if (ix < 0 || ix >= w || iy < 0 || iy >= h) continue;   // off-tile objects belong to a neighbour pass
        const here = grid[iy * w + ix];
        if (o.kind === 'mineralrock') {
          if (_mrIsBlocked(ix, iy)) { objects.splice(i, 1); continue; }
          // Any rock whose FINAL cell turned out to be residential must be
          // kerb-tight (Chebyshev ≤ 1 from a road) — terrain-based, NOT
          // tied to which polygon spawned the rock. A wilderness ROCK or
          // INDUSTRIAL cluster can drop a rock that ends up on a
          // residential cell after the grid is fully painted, and the
          // player will see "rock in residential, far from road" all the
          // same. The _residential flag is preserved for telemetry but
          // no longer drives the check.
          if (here === T.RESIDENTIAL && !_mrNearRoadWithin(ix, iy, 1)) {
            objects.splice(i, 1); continue;
          }
          delete o._residential;
          continue;
        }
        // Every OTHER object that landed on a residential cell must be
        // within Chebyshev 2 of a road — this stops chests, fruit trees,
        // POI props and other interactables from baiting the player into
        // someone's back yard. (Was 3; tightened to 2 per user feedback —
        // 3 cells deep into a lot still feels like trespassing.) Forts,
        // castles, houses and towers are already exempt above.
        if (here === T.RESIDENTIAL) {
          if (!_mrNearRoadWithin(ix, iy, 2)) { objects.splice(i, 1); continue; }
        }
      }
      // Same proximity rule for the parallel `wildplants` list — any wild
      // pickup on a residential cell must be within 2 of a road. (DEBRIS_CROP
      // no longer seeds residential, but cross-polygon overlap can still
      // drop a shrub or longgrass tuft onto a residential cell.)
      for (let i = wildplants.length - 1; i >= 0; i--) {
        const wp = wildplants[i];
        const ix = Math.floor((wp.x - tileOriginMx) / _mrCellW);
        const iy = Math.floor((wp.y - tileOriginMy) / _mrCellW);
        if (ix < 0 || ix >= w || iy < 0 || iy >= h) continue;
        if (grid[iy * w + ix] !== T.RESIDENTIAL) continue;
        if (!_mrNearRoadWithin(ix, iy, 2)) wildplants.splice(i, 1);
      }
      // Parking-treasure X marks live in a third array (parkingTreasures)
      // and were missed by both filters above. Apply the same residential
      // rule — a buried-X on a residential cell must be ≤ 2 from a road,
      // else drop. Non-residential parking lots (the typical case) stay.
      for (let i = parkingTreasures.length - 1; i >= 0; i--) {
        const t = parkingTreasures[i];
        const ix = Math.floor((t.x - tileOriginMx) / _mrCellW);
        const iy = Math.floor((t.y - tileOriginMy) / _mrCellW);
        if (ix < 0 || ix >= w || iy < 0 || iy >= h) continue;
        if (grid[iy * w + ix] !== T.RESIDENTIAL) continue;
        if (!_mrNearRoadWithin(ix, iy, 2)) parkingTreasures.splice(i, 1);
      }
    }

    // Post-pass: roads/paths/water/buildings are painted AFTER landuse, so a residential
    // polygon may have had rockfruit dropped into a cell that later became road, OR a park
    // polygon's shrubs may have ended up under a residential overpaint. Per-crop ALLOWED
    // terrain sets keep things on their natural biome:
    //   shrubs: forest / park / grassland-subtype family
    //   longgrass: grassland family
    //   nut: forest only
    //   rockfruit / generic: any soft ground (residential/grass/park/farmland/rock/etc)
    // Anything else (road, building, water, path, cement) → drop.
    // COMMERCIAL (16) / INDUSTRIAL (17) are the synthesized concrete pads — kept
    // out of GROUND so debris doesn't end up sitting on a hospital/school slab.
    const GROUND = new Set([T.RESIDENTIAL, T.PARK, T.FOREST, T.GRASS, T.SAND, T.FARMLAND, T.ROCK, T.SCHOOL, T.PLAYGROUND, T.PITCH, T.WETLAND, T.GOLF, T.ORCHARD]); // 5, 6, 1, 0, 2, 4, 10, 15, 18, 19, 20, 21, 22
    const FOREST_PARK_GRASS = new Set([T.FOREST, T.PARK, T.GRASS, T.SCHOOL, T.PLAYGROUND, T.PITCH, T.WETLAND, T.GOLF]); // 1, 6, 0, 15, 18, 19, 20, 21
    const GRASSLAND_FAMILY  = new Set([T.GRASS, T.PARK, T.SCHOOL, T.PLAYGROUND, T.PITCH, T.GOLF]); // 0, 6, 15, 18, 19, 21
    const CROP_ALLOWED = {
      shrub:     FOREST_PARK_GRASS,
      longgrass: GRASSLAND_FAMILY,
      nut:       new Set([T.FOREST]),                  // forest only (1)
      mushroom:  new Set([T.FOREST, T.RESIDENTIAL]),   // forest + residential yards (1, 5)
      // rockfruit + anything else → GROUND fallback
    };
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

    // Unified occupancy pass — at most one interactable / decorative object
    // per cell. Strict priority: chest > house > tree > wildplant > flora.
    // The first one to claim a cell wins; everything else in that cell is
    // dropped so we never have shrubs hiding under chests or pads.
    const occupiedCells = new Set();
    const cellKeyOfWorld = (x, y) => {
      const ix = Math.floor(((x - tileOriginMx) / mvtToM) * mvtToCell);
      const iy = Math.floor(((y - tileOriginMy) / mvtToM) * mvtToCell);
      return `${ix}_${iy}`;
    };

    // 1) High-priority objects first (chest > house > fruittree > tree > mineralrock).
    //    These never get displaced — they claim their cells and everything else
    //    (wildplants, flora) must avoid those cells.
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
      keptStructs.push(o);
    }

    // 2) Wildplants — biome-appropriate cells only, never on a structure cell.
    const filtered = [];
    for (const wp of wildplants) {
      const t = grid[wp._iy * w + wp._ix];
      const allowed = CROP_ALLOWED[wp.crop] || GROUND;
      const cellKey = `${wp._ix}_${wp._iy}`;
      if (allowed.has(t) && !occupiedCells.has(cellKey)) {
        occupiedCells.add(cellKey);
        delete wp._ix; delete wp._iy;
        filtered.push(wp);
      }
    }

    // 3) Flora — lowest priority. Must sit on grass/park/forest/sand/rock/
    //    farmland AND on a cell that isn't already claimed.
    const florae = objects.filter(o => o.kind === 'flora');
    const keptFlora = [];
    const FLORA_OK = new Set([T.SAND, T.FARMLAND, T.ROCK, ...FOREST_PARK_GRASS]); // 2, 4, 10 + FOREST_PARK_GRASS
    // Per-deco terrain gate. Mushroom decals are residential-only (they must
    // never bleed onto the grassy FLORA_OK set); flowers use the default set.
    const FLORA_ALLOWED = { mushroom: new Set([T.RESIDENTIAL]) };
    for (const o of florae) {
      const ct = grid[o._iy * w + o._ix];
      const cellKey = `${o._ix}_${o._iy}`;
      if (!(FLORA_ALLOWED[o.deco] || FLORA_OK).has(ct)) continue;
      if (occupiedCells.has(cellKey)) continue;
      occupiedCells.add(cellKey);
      delete o._ix; delete o._iy;
      keptFlora.push(o);
    }

    // Rebuild objects = kept structures + kept flora (preserve everything else
    // like plaques if they sneak in via future code — anything not in our
    // priority maps just passes through, but currently nothing else exists).
    const otherKinds = objects.filter(o =>
      STRUCT_PRIO[o.kind] == null && o.kind !== 'flora');
    objects.length = 0;
    for (const o of keptStructs) objects.push(o);
    for (const o of keptFlora)   objects.push(o);
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
          for (const [ddx, ddy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
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
    const key = `${Z}/${x}/${y}`;
    if (tileCache.has(key)) return tileCache.get(key);
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
      const sx = await ensureSatextract(lat);
      const bin = sx && sx.get(`${x}_${y}`);
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
        for (const t of bin.trees) {
          if (onWater(t.x, t.y)) continue;
          const k = cellKeyOf(t.x, t.y);
          if (occupied.has(k)) continue;
          occupied.add(k);
          const c = localCentre(t.x, t.y);
          t.x = c.x; t.y = c.y;
          entry.objects.push(t);
        }
        for (const s of bin.shrubs) {
          if (onWater(s.x, s.y)) continue;
          const k = cellKeyOf(s.x, s.y);
          if (occupied.has(k)) continue;
          occupied.add(k);
          const c = localCentre(s.x, s.y);
          s.x = c.x; s.y = c.y;
          entry.wildplants.push(s);
        }
        for (const p of (bin.poles || [])) {
          if (onWater(p.x, p.y)) continue;
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
        // coin-burst via loot.js + the render/interact chest paths. Garden
        // chests additionally scatter a small decorative flower burst.
        const FLOWER_VARIANTS = 4;
        for (const ch of (bin.chests || [])) {
          if (onWater(ch.x, ch.y)) continue;   // a chest mid-lake / on stream water reads wrong
          const k = cellKeyOf(ch.x, ch.y);
          if (occupied.has(k)) continue;
          occupied.add(k);
          const c = localCentre(ch.x, ch.y);
          ch.x = c.x; ch.y = c.y;
          const isGarden = ch.garden;
          delete ch.garden;   // internal flag — don't leak into the chest object
          entry.objects.push(ch);
          if (isGarden) {
            // 6–8 flowers in a 1–3 cell ring around the chest. Decorative flora
            // (same kind the MVT garden burst emits) — pickable as 'flowers'.
            const burstSeed = ((Math.round(ch.x) * BURST_MUL_X) ^ (Math.round(ch.y) * BURST_MUL_Y)) >>> 0;
            const brng = makeRng(burstSeed);
            const burstN = 6 + Math.floor(brng() * 3);
            for (let i = 0; i < burstN; i++) {
              const ang = brng() * Math.PI * 2;
              const rad = (1 + brng() * 2) * mPerCell;
              const c2 = localCentre(ch.x + Math.cos(ang) * rad, ch.y + Math.sin(ang) * rad);
              entry.objects.push({ kind: 'flora', deco: 'flower',
                x: c2.x, y: c2.y, variant: Math.floor(brng() * FLOWER_VARIANTS),
                // index `i` keeps the id unique when two burst flowers snap to
                // the same cell (else picking one silently consumes both).
                id: `gb_${Math.round(c2.x)}_${Math.round(c2.y)}_${i}` });
            }
          }
        }
        // Parking lots (OSM amenity=parking) → a buried-treasure "X marks the
        // spot" mark, claimed via the treasure handler (same array the MVT
        // parking path fills). No per-cell occupancy — X marks sit under the
        // terrain and don't block other interactables.
        for (const pk of (bin.parking || [])) {
          const c = localCentre(pk.x, pk.y);
          pk.x = c.x; pk.y = c.y;
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

  function ensureSatextract(lat) {
    if (_satextractPromise) return _satextractPromise;
    const TREE_SPECIES = ['maple', 'pine', 'birch', 'mahogany'];
    // DeepForest detections below this confidence are dropped on load. OSM
    // trees carry no `score` and are always kept.
    const SATEXTRACT_TREE_MIN_SCORE = 0.4;
    const tileEdgeM = tileEdgeMeters(lat);
    const project = (lon, lat0) => {
      const px = lonLatToWorldPx(lon, lat0, Z);
      const fx = px.x / TILE_PX, fy = px.y / TILE_PX;
      return {
        tx: Math.floor(fx), ty: Math.floor(fy),
        wmx: fx * tileEdgeM, wmy: fy * tileEdgeM,
      };
    };
    // ?v bumps whenever data/satextract_osm.geojson is regenerated — the file
    // name is otherwise stable, so without a cache-bust the browser serves a
    // stale copy and freshly-extracted features (poles, relocated trees) never
    // appear. Bump this when you re-run satextract.
    _satextractPromise = fetch('data/satextract_osm.geojson?v=4')
      .then(r => (r.ok ? r.json() : null))
      .then(gj => {
        const bins = new Map();
        const binFor = (tx, ty) => {
          const k = `${tx}_${ty}`;
          let b = bins.get(k);
          if (!b) {
            b = { trees: [], shrubs: [], poles: [],
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
              species: TREE_SPECIES[seed % TREE_SPECIES.length],
              id: `tree_${Math.round(cx)}_${Math.round(cy)}`,
              // DeepForest crown diameter (metres) → sprite size in render.js.
              // Undefined for OSM trees, which fall back to the flat species scale.
              crown_m: props.crown_m,
              // Flag standalone OSM trees (street / yard) so the T-key teleport
              // can hop between them, distinct from dense forest-grove trees.
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
      })
      .catch(() => new Map());
    return _satextractPromise;
  }

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
    forEachItem,
  };
})(window);
