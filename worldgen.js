// World generation: fetch MVT tiles and rasterize into a grid of 5m game cells.
// Coords: web-mercator pixel space at z=14. 1 MVT tile = 256 px = 4096 MVT units.
// Game cell = 5 m. Cell size in pixels depends on latitude.

(function (global) {
  const Z = 14;
  const TILE_PX = 256;          // standard
  const TILE_EXTENT = 4096;     // MVT units
  const CELL_M = 5;             // game cell size in meters
  const TILE_URL = 'https://tiles.openfreemap.org/planet/20260520_001001_pt/{z}/{x}/{y}.pbf';

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
    return T.ROAD;
  }
  function roadWidthM(tags) {
    const c = tags.class || '';
    if (c === 'motorway' || c === 'trunk') return 12;
    if (c === 'primary') return 10;
    if (c === 'secondary') return 8;
    if (c === 'tertiary') return 7;
    if (c === 'minor' || c === 'street' || c === 'service') return 5;
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
    [T.PATH]: 6, [T.ROAD]: 7, [T.ROAD_MD]: 7.1, [T.ROAD_LG]: 7.2,
    [T.BUILDING]: 8, [T.BUILDING_MED]: 8, [T.BUILDING_LARGE]: 8,
  };

  // --- Rasterization helpers ---
  function paintCell(grid, w, h, cx, cy, type) {
    if (cx < 0 || cy < 0 || cx >= w || cy >= h) return;
    const i = cy * w + cx;
    if (PRIO[type] >= PRIO[grid[i]]) grid[i] = type;
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
  function paintLine(grid, w, h, line, type, widthCells, mvtToCell) {
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
          if (ox * ox + oy * oy <= r * r) paintCell(grid, w, h, x0 + ox, y0 + oy, type);
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
    5:  'rockfruit', // RESIDENTIAL
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
  const LONGGRASS_TYPES = new Set([0, 6, 15, 18, 19, 21]); // GRASS, PARK, SCHOOL, PLAYGROUND, PITCH, GOLF
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
  };
  const FLORA_VARIANTS = { flower: 4 };

  function rasterizeTile(layers, cellsPerEdge, tx, ty, tileEdgeM) {
    const w = cellsPerEdge, h = cellsPerEdge;
    const grid = new Uint8Array(w * h);
    const mvtToCell = cellsPerEdge / TILE_EXTENT;
    const mvtToM = tileEdgeM / TILE_EXTENT;
    const objects = [];
    const wildplants = [];
    const parkingTreasures = []; // one guaranteed treasure-X per parking-POI
    const rng = makeRng(tx * 73856093 ^ ty * 19349663);

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
            const cx = tileOriginMx + (localIX + 0.5) * (1 / mvtToCell) * mvtToM;
            const cy = tileOriginMy + (localIY + 0.5) * (1 / mvtToCell) * mvtToM;
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
          const cx = tileOriginMx + (localIX + 0.5) * (1 / mvtToCell) * mvtToM;
          const cy = tileOriginMy + (localIY + 0.5) * (1 / mvtToCell) * mvtToM;
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

    const order = ['landcover', 'landuse', 'park', 'water', 'transportation', 'building', 'poi'];
    const layersByName = {};
    for (const l of layers) layersByName[l.name] = l;

    for (const name of order) {
      const layer = layersByName[name];
      if (!layer) continue;
      for (const f of layer.features) {
        if (f.type === 3) { // polygon
          let t = classifyPolygon(name, f.tags);

          // Building polygons get tiered by area + render_height so schools/malls/civic read
          // as a different color from single-family houses. Painted ring-by-ring.
          if (name === 'building') {
            for (const ring of f.geom) {
              if (ring.length < 3) continue;
              const areaM2 = Math.abs(ringSignedArea(ring)) * mvtToM * mvtToM;
              if (areaM2 < 8) continue;
              const tier = buildingTier(areaM2, f.tags.render_height);
              paintPolygon(grid, w, h, [ring], tier, mvtToCell);
              // Civic / industrial slabs (schools, malls, hospitals) read as a cement pad —
              // a residential house roof on top of one looks wrong, so skip the sprite.
              if (tier === T.BUILDING_LARGE) continue;
              const c = ringCentroid(ring);
              const m = toMeters(c.x, c.y);
              // Snap house sprite to the 5m cell centre so a row of houses lines up cleanly.
              const ix = Math.floor(m.x / CELL_M);
              const iy = Math.floor(m.y / CELL_M);
              const cx = (ix + 0.5) * CELL_M;
              const cy = (iy + 0.5) * CELL_M;
              // Stable id for per-house shop state (deal rate-limit, future ledger).
              const id = `h_${Math.round(cx)}_${Math.round(cy)}`;
              // Synthetic 3-digit street address derived from cell coords. Houses
              // whose address ends in 9 become blacksmiths (~10% of houses).
              const address = (((ix * 73856093) ^ (iy * 19349663)) >>> 0) % 1000;
              objects.push({ kind: 'house', x: cx, y: cy, area: areaM2, tier, id, address });
            }
          } else {
            if (t != null) paintPolygon(grid, w, h, f.geom, t, mvtToCell);

            // Per-polygon debris/decor share one centroid-derived key
            // so a given polygon looks the same across reloads.
            const c0 = ringCentroid(f.geom[0]);
            const polyKey = ((Math.round(c0.x) * 73856093) ^ (Math.round(c0.y) * 19349663) ^ (tx * 83492791) ^ (ty * 12345)) >>> 0;

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

            // Scattered Maple Trees on wood/forest landcover.
            if (name === 'landcover') {
              const cls = f.tags.class || f.tags.subclass;
              if (cls === 'wood' || cls === 'forest') {
                const bb = bboxOf(f.geom);
                const stepMvt = 8 / mvtToM; // ~one candidate per 8m
                for (let yy = bb.minY; yy <= bb.maxY; yy += stepMvt) {
                  for (let xx = bb.minX; xx <= bb.maxX; xx += stepMvt) {
                    const jx = xx + (rng() - 0.5) * stepMvt;
                    const jy = yy + (rng() - 0.5) * stepMvt;
                    if (pointInRings(f.geom, jx, jy)) {
                      const m = toMeters(jx, jy);
                      // Snap tree to cell centre too — keeps the forest from looking jittery.
                      const cx = (Math.floor(m.x / CELL_M) + 0.5) * CELL_M;
                      const cy = (Math.floor(m.y / CELL_M) + 0.5) * CELL_M;
                      objects.push({ kind: 'tree', x: cx, y: cy, variant: 1 + Math.floor(rng() * 4) });
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
                    const m = toMeters(xx + stepMvt * 0.5, yy + stepMvt * 0.5);
                    const ix = Math.floor(m.x / CELL_M);
                    const iy = Math.floor(m.y / CELL_M);
                    const cx = (ix + 0.5) * CELL_M;
                    const cy = (iy + 0.5) * CELL_M;
                    objects.push({ kind: 'fruittree', x: cx, y: cy, species,
                      id: `ft_${tx}_${ty}_${ix}_${iy}` });
                  }
                }
              }
            }

            // Residential mineral clusters — a few abandoned-yard / construction
            // piles in town. Sparse: pivot grid is ~30 m so most residential
            // polygons spawn 0-1 clusters; each cluster is 3-5 low-tier rocks
            // grouped within ~6 m. Gives the early game a reliable urban source
            // of stone + low-tier ore without flooding sidewalks with rocks.
            if (t === T.RESIDENTIAL) {
              const resRng = makeRng((polyKey ^ 0xFA11) >>> 0);
              const bb = bboxOf(f.geom);
              const pivotStep = 30 / mvtToM;        // one cluster candidate per ~30 m
              const clusterR  = 6  / mvtToM;        // rocks placed within ~6 m of pivot
              // Lower-tier bias for town rocks (T1 ~80% → T7 negligible). Stronger
              // damping than the wilderness ROCK loop because residential should
              // not be where the player farms platinum.
              const resTierW = [];
              let resTotalW = 0;
              for (let t2 = 1; t2 <= 7; t2++) {
                const w = 1 / Math.pow(3, t2 - 1);
                resTotalW += w;
                resTierW.push(resTotalW);
              }
              for (let yy = bb.minY; yy <= bb.maxY; yy += pivotStep) {
                for (let xx = bb.minX; xx <= bb.maxX; xx += pivotStep) {
                  if (!pointInRings(f.geom, xx + pivotStep * 0.5, yy + pivotStep * 0.5)) continue;
                  if (resRng() > 0.15) continue;   // 15 % of pivots fire a cluster
                  const clusterN = 3 + Math.floor(resRng() * 3);  // 3..5 rocks per cluster
                  for (let k = 0; k < clusterN; k++) {
                    const jx = xx + (resRng() - 0.5) * 2 * clusterR;
                    const jy = yy + (resRng() - 0.5) * 2 * clusterR;
                    if (!pointInRings(f.geom, jx, jy)) continue;
                    const r = resRng() * resTotalW;
                    let requiredTier = 7;
                    for (let i = 0; i < resTierW.length; i++) {
                      if (r <= resTierW[i]) { requiredTier = i + 1; break; }
                    }
                    const m = toMeters(jx, jy);
                    const ix = Math.floor(m.x / CELL_M);
                    const iy = Math.floor(m.y / CELL_M);
                    const cx = (ix + 0.5) * CELL_M;
                    const cy = (iy + 0.5) * CELL_M;
                    objects.push({ kind: 'mineralrock', x: cx, y: cy, requiredTier,
                      id: `mr_${tx}_${ty}_${Math.round(cx)}_${Math.round(cy)}` });
                  }
                }
              }
            }

            // Industrial mineral piles — old quarries, scrap yards, slag heaps.
            // Dense (lots of rocks): tight pivot grid + high fire chance + bigger
            // clusters than residential. Tier dropoff is slower (1/1.6^(t-1)) so
            // mid-tier metals (gold/platinum) actually show up here, but T7 stays
            // very rare via the geometric tail (~3 % per cluster pick).
            if (t === T.INDUSTRIAL) {
              const indRng = makeRng((polyKey ^ 0xC0AL) >>> 0);
              const bb = bboxOf(f.geom);
              const pivotStep = 14 / mvtToM;        // ~one candidate per 14 m — much denser than residential's 30
              const clusterR  = 5  / mvtToM;        // ~5 m cluster radius
              const indTierW = [];
              let indTotalW = 0;
              for (let t2 = 1; t2 <= 7; t2++) {
                const w = 1 / Math.pow(1.6, t2 - 1);
                indTotalW += w;
                indTierW.push(indTotalW);
              }
              for (let yy = bb.minY; yy <= bb.maxY; yy += pivotStep) {
                for (let xx = bb.minX; xx <= bb.maxX; xx += pivotStep) {
                  if (!pointInRings(f.geom, xx + pivotStep * 0.5, yy + pivotStep * 0.5)) continue;
                  if (indRng() > 0.55) continue;   // 55 % of pivots fire — "lots"
                  const clusterN = 4 + Math.floor(indRng() * 5);   // 4..8 rocks per cluster
                  for (let k = 0; k < clusterN; k++) {
                    const jx = xx + (indRng() - 0.5) * 2 * clusterR;
                    const jy = yy + (indRng() - 0.5) * 2 * clusterR;
                    if (!pointInRings(f.geom, jx, jy)) continue;
                    const r = indRng() * indTotalW;
                    let requiredTier = 7;
                    for (let i = 0; i < indTierW.length; i++) {
                      if (r <= indTierW[i]) { requiredTier = i + 1; break; }
                    }
                    const m = toMeters(jx, jy);
                    const ix = Math.floor(m.x / CELL_M);
                    const iy = Math.floor(m.y / CELL_M);
                    const cx = (ix + 0.5) * CELL_M;
                    const cy = (iy + 0.5) * CELL_M;
                    objects.push({ kind: 'mineralrock', x: cx, y: cy, requiredTier,
                      id: `mr_${tx}_${ty}_${Math.round(cx)}_${Math.round(cy)}` });
                  }
                }
              }
            }

            // Mineral-rich rocks on ROCK terrain. Rare — most are low-tier, with
            // ultra-rare high-tier finds via 1/2^(t-1) weighting (T1 ~64%, T7 ~1%).
            if (t === T.ROCK) {
              const rockRng = makeRng((polyKey ^ 0xCAFE) >>> 0);
              const bb = bboxOf(f.geom);
              const stepMvt = 15 / mvtToM;   // one candidate per ~15m
              // Precompute tier-weight CDF: w[i] = 1 / 2^i for i = 0..6.
              const tierWeights = [];
              let totalW = 0;
              for (let t2 = 1; t2 <= 7; t2++) {
                const w = 1 / Math.pow(2, t2 - 1);
                totalW += w;
                tierWeights.push(totalW); // cumulative
              }
              for (let yy = bb.minY; yy <= bb.maxY; yy += stepMvt) {
                for (let xx = bb.minX; xx <= bb.maxX; xx += stepMvt) {
                  if (!pointInRings(f.geom, xx + stepMvt * 0.5, yy + stepMvt * 0.5)) continue;
                  if (rockRng() > 0.4) continue;   // 40% chance per candidate
                  const r = rockRng() * totalW;
                  let requiredTier = 7;
                  for (let i = 0; i < tierWeights.length; i++) {
                    if (r <= tierWeights[i]) { requiredTier = i + 1; break; }
                  }
                  const m = toMeters(xx + stepMvt * 0.5, yy + stepMvt * 0.5);
                  const ix = Math.floor(m.x / CELL_M);
                  const iy = Math.floor(m.y / CELL_M);
                  const cx = (ix + 0.5) * CELL_M;
                  const cy = (iy + 0.5) * CELL_M;
                  objects.push({ kind: 'mineralrock', x: cx, y: cy, requiredTier,
                    id: `mr_${tx}_${ty}_${Math.round(cx)}_${Math.round(cy)}` });
                }
              }
            }
          }
        } else if (f.type === 2 && name === 'transportation') {
          const t = classifyLine(name, f.tags);
          if (t == null) continue;
          const wCells = Math.max(1, Math.round(roadWidthM(f.tags) / CELL_M));
          for (const line of f.geom) paintLine(grid, w, h, line, t, wCells, mvtToCell);
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
          if (cls === 'parking') {
            // Parking lots → guaranteed treasure X (no chest).
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
            // Synthesized concrete-pad terrain around the POI, in a per-class SHAPE.
            // Building polygons are independent of POIs and never overpainted: if the POI
            // point lands on or right next to a building, slide it to the nearest non-
            // building cell — preferring one next to a road/path (so the player can
            // actually reach the chest).
            const KEEP = new Set([3, 7, 8, 9, 11, 12, 13, 14]); // water, roads, path, all buildings
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
              const adjustedMx = tileOriginMx + (finalIX + 0.5) * (1 / mvtToCell) * mvtToM;
              const adjustedMy = tileOriginMy + (finalIY + 0.5) * (1 / mvtToCell) * mvtToM;
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
              const adjustedMx = tileOriginMx + (cellIX + 0.5) * (1 / mvtToCell) * mvtToM;
              const adjustedMy = tileOriginMy + (cellIY + 0.5) * (1 / mvtToCell) * mvtToM;
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
              const poiKey = ((Math.round(cx) * 73856093) ^ (Math.round(cy) * 19349663)) >>> 0;
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
                  const cellCenterMx = tileOriginMx + (ix + 0.5) * (1 / mvtToCell) * mvtToM;
                  const cellCenterMy = tileOriginMy + (iy + 0.5) * (1 / mvtToCell) * mvtToM;
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
    const GROUND = new Set([5, 6, 1, 0, 2, 4, 10, 15, 18, 19, 20, 21, 22]);
    const FOREST_PARK_GRASS = new Set([1, 6, 0, 15, 18, 19, 20, 21]);
    const GRASSLAND_FAMILY  = new Set([0, 6, 15, 18, 19, 21]);
    const CROP_ALLOWED = {
      shrub:     FOREST_PARK_GRASS,
      longgrass: GRASSLAND_FAMILY,
      nut:       new Set([1]),                  // forest only
      mushroom:  new Set([1]),                  // forest only
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
        const cx = tileOriginMx + (ix + 0.5) * (1 / mvtToCell) * mvtToM;
        const cy = tileOriginMy + (iy + 0.5) * (1 / mvtToCell) * mvtToM;
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
    //    first; ties (e.g. house/tower) are stable.
    const STRUCT_PRIO = { chest: 6, house: 5, tower: 5, fruittree: 4, tree: 3, mineralrock: 2 };
    const structs = objects.filter(o => STRUCT_PRIO[o.kind] != null);
    structs.sort((a, b) => (STRUCT_PRIO[b.kind] || 0) - (STRUCT_PRIO[a.kind] || 0));
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
    const FLORA_OK = new Set([2, 4, 10, ...FOREST_PARK_GRASS]);
    for (const o of florae) {
      const ct = grid[o._iy * w + o._ix];
      const cellKey = `${o._ix}_${o._iy}`;
      if (!FLORA_OK.has(ct)) continue;
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
    // Dedup nearby same-name chests inside this tile. OSM frequently has multiple
    // POI points for one physical place (e.g. an entrance + main label + amenity).
    // Group by normalized name, then drop any chest within DEDUP_M of an already-
    // kept chest of the same name. Unnamed chests are left untouched.
    const DEDUP_M = 80;
    const byName = new Map();
    const keepers = [];
    for (const o of objects) {
      if (o.kind !== 'chest' || !o.name) { continue; }
      const key = o.name.trim().toLowerCase();
      const prev = byName.get(key);
      const tooClose = prev && prev.some(p => Math.hypot(p.x - o.x, p.y - o.y) <= DEDUP_M);
      if (tooClose) { o._drop = true; continue; }
      (byName.get(key) || byName.set(key, []).get(key)).push(o);
      keepers.push(o);
    }
    const deduped = objects.filter(o => !o._drop);
    return { grid, objects: deduped, wildplants: filtered, parkingTreasures, roadLetters };
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
      const { grid, objects, wildplants, parkingTreasures, roadLetters } = rasterizeTile(layers, entry.cellsPerEdge, x, y, tileEdgeM);
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
      entry.layers = layers;
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
    Z, CELL_M, T, TILE_URL,
    lonLatToWorldPx, metersPerPixel, tileEdgeMeters, cellsPerEdgeForLat,
    tileXYForLonLat, loadTile, tileCache, makeRng,
    forEachItem,
  };
})(window);
