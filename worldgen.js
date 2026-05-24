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
    ROAD: 7,
    PATH: 8,
    BUILDING: 9,
    ROCK: 10,
  };

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
      const c = tags.class || tags.subclass;
      if (c === 'wood' || c === 'forest') return T.FOREST;
      if (c === 'grass' || c === 'meadow') return T.GRASS;
      if (c === 'sand' || c === 'beach') return T.SAND;
      if (c === 'rock' || c === 'scree') return T.ROCK;
      if (c === 'farmland') return T.FARMLAND;
      return T.GRASS;
    }
    if (layer === 'landuse') {
      const c = tags.class;
      if (c === 'residential' || c === 'commercial' || c === 'industrial') return T.RESIDENTIAL;
      if (c === 'farmland' || c === 'farmyard') return T.FARMLAND;
      if (c === 'cemetery' || c === 'pitch' || c === 'park' || c === 'garden') return T.PARK;
      return T.RESIDENTIAL;
    }
    if (layer === 'park') return T.PARK;
    if (layer === 'building') return T.BUILDING;
    return null;
  }
  function classifyLine(layer, tags) {
    if (layer !== 'transportation') return null;
    const c = tags.class || '';
    if (['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service', 'street'].includes(c)) return T.ROAD;
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
    [T.FARMLAND]: 3, [T.RESIDENTIAL]: 4, [T.WATER]: 5,
    [T.PATH]: 6, [T.ROAD]: 7, [T.BUILDING]: 8,
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

  function rasterizeTile(layers, cellsPerEdge, tx, ty, tileEdgeM) {
    const w = cellsPerEdge, h = cellsPerEdge;
    const grid = new Uint8Array(w * h);
    const mvtToCell = cellsPerEdge / TILE_EXTENT;
    const mvtToM = tileEdgeM / TILE_EXTENT;
    const objects = [];
    const rng = makeRng(tx * 73856093 ^ ty * 19349663);

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
          const t = classifyPolygon(name, f.tags);
          if (t != null) paintPolygon(grid, w, h, f.geom, t, mvtToCell);

          // Object placements derived from polygons:
          if (name === 'building') {
            // Each ring (likely outer in single-poly buildings) → one house.
            for (const ring of f.geom) {
              if (ring.length < 3) continue;
              const c = ringCentroid(ring);
              const m = toMeters(c.x, c.y);
              const areaM2 = Math.abs(ringSignedArea(ring)) * mvtToM * mvtToM;
              if (areaM2 < 8) continue;
              objects.push({ kind: 'house', x: m.x, y: m.y, area: areaM2 });
            }
          } else if (name === 'landcover') {
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
                    objects.push({ kind: 'tree', x: m.x, y: m.y, variant: 1 + Math.floor(rng() * 4) });
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
          // POI points: drop a themed object
          for (const ring of f.geom) {
            const p = ring[0];
            const m = toMeters(p.x, p.y);
            const cls = f.tags.class || '';
            const sub = f.tags.subclass || '';
            // For prototype, just mark notable types
            if (['park', 'garden', 'pitch'].includes(cls)) {
              objects.push({ kind: 'tree', x: m.x, y: m.y, variant: 4 });
            } else if (['shop', 'food_and_drink', 'tourism', 'office'].includes(cls)) {
              objects.push({ kind: 'house', x: m.x, y: m.y, area: 60 });
            }
          }
        }
      }
    }
    return { grid, objects };
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
      const { grid, objects } = rasterizeTile(layers, entry.cellsPerEdge, x, y, tileEdgeM);
      entry.grid = grid;
      entry.objects = objects;
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
