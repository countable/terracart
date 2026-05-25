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
        const xa = Math.max(0, Math.ceil(xs[k] - 0.5));
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
    0:  'longgrass', // GRASS (open grassland)
  };
  const DEBRIS_MIN = 0.05;
  const DEBRIS_MAX = 0.30;
  // Salt for the rare-nut RNG stream in forests — independent of the shrub stream
  // that shares the same polygon key. (Was `0xdeadbeef`.)
  const NUT_RNG_SALT = 0xdeadbeef;

  // Each tillable-biome polygon picks a favored crop (stable per polygon). A small
  // wooden plaque sprite sits at the centroid showing that crop. Planting the
  // matching crop within the polygon (≈ within plaque radius) yields a bonus.
  // Pools intentionally biased: farmland favors root/grain; grass favors berries;
  // park favors leafy/floral.
  const AFFINITY_CROPS = {
    [T.FARMLAND]:   ['potato', 'nut', 'coffee'],
    [T.GRASS]:      ['rainberry', 'pairy', 'sunflower'],
    [T.PARK]:       ['potato', 'shrub', 'rainberry'],
    [T.GOLF]:       ['rainberry', 'pairy', 'sunflower'],
    [T.PITCH]:      ['rainberry', 'pairy'],
    [T.PLAYGROUND]: ['sunflower', 'pairy'],
    [T.ORCHARD]:    ['nut', 'pairy', 'rainberry'],
  };

  // Per-biome decorative items (purely visual, non-interactable). Stored as
  // { kind: 'flora', x, y, deco: '<kind>', variant: 0..N } and rendered by app.js
  // using procedurally-generated 16x16 textures.
  const FLORA_BY_TYPE = {
    [T.GRASS]:      { deco: 'flower',   density: 0.10 },
    [T.PARK]:       { deco: 'flower',   density: 0.14 },
    [T.GOLF]:       { deco: 'flower',   density: 0.10 },
    [T.PITCH]:      { deco: 'flower',   density: 0.08 },
    [T.PLAYGROUND]: { deco: 'flower',   density: 0.10 },
    [T.WETLAND]:    { deco: 'flower',   density: 0.10 },
    [T.FOREST]:     { deco: 'mushroom', density: 0.08 },
    [T.ORCHARD]:    { deco: 'mushroom', density: 0.10 },
    [T.SAND]:       { deco: 'pebble',   density: 0.10 },
    [T.ROCK]:       { deco: 'pebble',   density: 0.12 },
  };
  const FLORA_VARIANTS = { flower: 4, pebble: 3, mushroom: 2 };

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
    function spawnFlora(rings, deco, polyKey, density) {
      const prng = makeRng(polyKey ^ 0xc0ffee);
      const variants = FLORA_VARIANTS[deco] || 1;
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
            objects.push({
              kind: 'flora',
              x: cx, y: cy,
              deco,
              variant: Math.floor(prng() * variants),
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
              const c = ringCentroid(ring);
              const m = toMeters(c.x, c.y);
              // Snap house sprite to the 5m cell centre so a row of houses lines up cleanly.
              const cx = (Math.floor(m.x / CELL_M) + 0.5) * CELL_M;
              const cy = (Math.floor(m.y / CELL_M) + 0.5) * CELL_M;
              objects.push({ kind: 'house', x: cx, y: cy, area: areaM2 });
            }
          } else {
            if (t != null) paintPolygon(grid, w, h, f.geom, t, mvtToCell);

            // Per-polygon debris/decor/plaque all share one centroid-derived key
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

            // Per-polygon FLORA (purely decorative drops: flowers / pebbles / mushrooms).
            const florax = FLORA_BY_TYPE[t];
            if (florax) spawnFlora(f.geom, florax.deco, polyKey, florax.density);

            // Per-polygon CROP AFFINITY plaque (only on big enough tillable areas).
            const affinityPool = AFFINITY_CROPS[t];
            if (affinityPool) {
              const polyAreaM2 = Math.abs(ringSignedArea(f.geom[0])) * mvtToM * mvtToM;
              if (polyAreaM2 >= 200) {
                const prng = makeRng(polyKey ^ 0xa771ed);
                const crop = affinityPool[Math.floor(prng() * affinityPool.length)];
                const m = toMeters(c0.x, c0.y);
                const cx = (Math.floor(m.x / CELL_M) + 0.5) * CELL_M;
                const cy = (Math.floor(m.y / CELL_M) + 0.5) * CELL_M;
                // Approximate radius from polygon area, capped — used at plant-time
                // to test whether a tilled cell falls "inside" this plaque's polygon.
                const radius = Math.min(60, Math.sqrt(polyAreaM2 / Math.PI));
                objects.push({ kind: 'plaque', x: cx, y: cy, crop, radius,
                  id: `pl_${Math.round(cx)}_${Math.round(cy)}` });
              }
            }

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
          // Snap POI-derived features to the 5m absolute cell centre so the X /
          // chest sprite always sits squarely in a tile (not floating between two).
          const snap = (v) => (Math.floor(v / CELL_M) + 0.5) * CELL_M;
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
          for (const ring of f.geom) {
            const p = ring[0];
            const m = toMeters(p.x, p.y);
            const cx = snap(m.x), cy = snap(m.y);
            const id = `c_${Math.round(cx)}_${Math.round(cy)}`;
            objects.push({ kind: 'chest', x: cx, y: cy, id,
              poiClass: cls, name: f.tags.name || '' });
          }
        }
      }
    }
    // Post-pass: roads/paths/water/buildings are painted AFTER landuse in this loop, so a
    // residential polygon may have had rockfruit dropped into a cell that later became road.
    // Drop any debris whose final cell type isn't a spawn-eligible biome.
    // residential, park, forest, grass, sand, farmland, rock + new subtype splits (15..22 are all ground tiles)
    const DEBRIS_OK = new Set([5, 6, 1, 0, 2, 4, 10, 15, 16, 17, 18, 19, 20, 21, 22]);
    // Cells with a chest already claim the visual space — no shrubs/rockfruit on them.
    const chestCellKeys = new Set();
    for (const o of objects) {
      if (o.kind !== 'chest') continue;
      const ix = Math.floor(((o.x - tileOriginMx) / mvtToM) * mvtToCell);
      const iy = Math.floor(((o.y - tileOriginMy) / mvtToM) * mvtToCell);
      if (ix >= 0 && iy >= 0 && ix < w && iy < h) chestCellKeys.add(`${ix}_${iy}`);
    }
    const filtered = [];
    for (const wp of wildplants) {
      const t = grid[wp._iy * w + wp._ix];
      if (DEBRIS_OK.has(t) && !chestCellKeys.has(`${wp._ix}_${wp._iy}`)) {
        delete wp._ix; delete wp._iy;
        filtered.push(wp);
      }
    }
    // Same post-pass for decorative flora — drop any whose cell is now road/water/building.
    for (let i = objects.length - 1; i >= 0; i--) {
      const o = objects[i];
      if (o.kind !== 'flora') continue;
      const ct = grid[o._iy * w + o._ix];
      if (!DEBRIS_OK.has(ct)) { objects.splice(i, 1); continue; }
      delete o._ix; delete o._iy;
    }
    // Road-name letters: walk each transportation_name line at ~1 cell per step and assign the
    // next character of the name to whatever cell we're in. Last writer wins on overlap (good
    // enough; intersections are noisy by nature). Skip whitespace so spaces don't blank cells.
    // Stored as { "ix_iy": { char, angle } }.
    const roadLetters = {};
    const tnLayer = layersByName['transportation_name'];
    const ROAD_TYPES = new Set([T.ROAD, T.ROAD_MD, T.ROAD_LG, T.PATH]);
    if (tnLayer) {
      for (const f of tnLayer.features) {
        if (f.type !== 2) continue;
        const name = f.tags?.name;
        if (!name) continue;
        // All-caps, single-space collapse — spaces are part of the sequence so a multi-word
        // name reads with its gaps (one cell per character including ' ').
        const letters = name.toUpperCase().replace(/\s+/g, ' ');
        if (!letters.length) continue;
        for (const line of f.geom) {
          if (line.length < 2) continue;
          let letterIdx = 0;
          // Step ~1 cell along the polyline.
          const stepMvt = CELL_M / mvtToM;
          let curX = line[0].x, curY = line[0].y;
          for (let i = 1; i < line.length; i++) {
            const ax = line[i - 1].x, ay = line[i - 1].y;
            const bx = line[i].x,     by = line[i].y;
            const segDx = bx - ax, segDy = by - ay;
            const segLen = Math.hypot(segDx, segDy);
            if (segLen < 1e-6) continue;
            // Local direction in radians (note: MVT y grows downward → that matches screen y).
            const ang = Math.atan2(segDy, segDx);
            // March along this segment.
            let remaining = segLen - Math.hypot(curX - ax, curY - ay);
            const ux = segDx / segLen, uy = segDy / segLen;
            while (remaining >= 0 && letterIdx < letters.length * 4) {
              const ix = Math.floor(curX * mvtToCell);
              const iy = Math.floor(curY * mvtToCell);
              if (ix >= 0 && iy >= 0 && ix < w && iy < h && ROAD_TYPES.has(grid[iy * w + ix])) {
                roadLetters[`${ix}_${iy}`] = { char: letters[letterIdx % letters.length], angle: ang };
                letterIdx++;
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
    return { grid, objects, wildplants: filtered, parkingTreasures, roadLetters };
  }

  function tileEdgeMeters(lat) {
    // edge in meters at z=14 at given latitude
    return metersPerPixel(lat, Z) * TILE_PX;
  }
  function cellsPerEdgeForLat(lat) {
    return Math.round(tileEdgeMeters(lat) / CELL_M);
  }

  async function loadTile(x, y, lat) {
    const key = `${Z}/${x}/${y}`;
    if (tileCache.has(key)) return tileCache.get(key);
    const entry = { status: 'loading', grid: null, cellsPerEdge: cellsPerEdgeForLat(lat) };
    const tileEdgeM = tileEdgeMeters(lat);
    entry.tileEdgeM = tileEdgeM;
    entry.promise = (async () => {
      const { bytes, fromCache } = await fetchTileBytes(x, y);
      const layers = MVT.decodeTile(bytes);
      const { grid, objects, wildplants, parkingTreasures, roadLetters } = rasterizeTile(layers, entry.cellsPerEdge, x, y, tileEdgeM);
      entry.grid = grid;
      entry.objects = objects;
      entry.wildplants = wildplants;
      entry.parkingTreasures = parkingTreasures || [];
      entry.roadLetters = roadLetters || {};
      entry.layers = layers;
      entry.status = 'ready';
      entry.fromCache = fromCache;
      return entry;
    })();
    tileCache.set(key, entry);
    return entry;
  }

  function tileXYForLonLat(lon, lat) {
    const n = 1 << Z;
    const x = Math.floor((lon + 180) / 360 * n);
    const sin = Math.sin(lat * Math.PI / 180);
    const y = Math.floor((0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * n);
    return { x, y };
  }

  global.WorldGen = {
    Z, CELL_M, T, TILE_URL,
    lonLatToWorldPx, metersPerPixel, tileEdgeMeters, cellsPerEdgeForLat,
    tileXYForLonLat, loadTile, tileCache, makeRng,
  };
})(window);
