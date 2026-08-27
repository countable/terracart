// World generation: fetch MVT tiles and rasterize into a grid of CELL_M-meter game cells.
// Coords: web-mercator pixel space at z=14. 1 MVT tile = 256 px = 4096 MVT units.
// Game cell = CELL_M m (currently 7 m). Cell size in pixels depends on latitude.

(function (global) {
  const Z = 14;
  const TILE_PX = 256;          // standard
  const TILE_EXTENT = 4096;     // MVT units
  const CELL_M = 7;             // game cell size in meters
  const TILE_URL = 'https://tiles.openfreemap.org/planet/20260520_001001_pt/{z}/{x}/{y}.pbf';

  // The tile cache key, spelled one way. `${Z}/${tx}/${ty}` is hand-built
  // across this file and several others (app.js, render.js, …) — this is the
  // one place that does it, exported as WorldGen.tileKey for the rest.
  function tileKey(tx, ty) {
    return `${Z}/${tx}/${ty}`;
  }

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
  //   opts.roadMask : the tile's road-footprint mask (see rasterizeTile). The
  //                   terrain code alone under-reports the road: every way
  //                   rasterizes one cell wide however wide it really is, and
  //                   parking aisles rasterize to nothing at all, so a cell
  //                   the grid calls grass can be ground the player sees as
  //                   asphalt. Pass it and those cells are refused too.
  function isSpawnCell(grid, w, h, cx, cy, opts) {
    if (cx < 0 || cy < 0 || cx >= w || cy >= h) return false;
    const here = grid[cy * w + cx];
    if (!isWalkable(here)) return false;          // never on water/road/building
    const roadMask = opts && opts.roadMask;
    if (roadMask && roadMask[cy * w + cx]) return false;   // under a drawn road band
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
  function relocateToSpawnCell(grid, w, h, cx, cy, opts, maxR) {
    if (isSpawnCell(grid, w, h, cx, cy, opts)) return { ix: cx, iy: cy };
    const R = maxR == null ? 4 : maxR;
    for (let r = 1; r <= R; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;   // ring edge only
          if (isSpawnCell(grid, w, h, cx + dx, cy + dy, opts)) return { ix: cx + dx, iy: cy + dy };
        }
      }
    }
    return null;
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
  // The big ways — motorway / trunk / primary, exactly the ROAD_LG tier — are
  // drawn half again as wide as their measured carriageway so the trunk
  // network stays legible at map scale. See road_overlay.js. Declared here
  // (ahead of classifyLine) so both the classifier and the width scaling
  // below share this one Set.
  const LARGE_ROAD_CLASSES = new Set(['motorway', 'trunk', 'primary']);
  // Walkable, non-vehicle way classes — footways, tracks, steps and the like.
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
  // Approximate real-world carriageway width, in metres, per transportation
  // class. The rasterizer only reads this for PIER (roads and paths always
  // rasterize one cell wide — see the wCells comment in rasterizeTile), but
  // the road-geometry overlay strokes each way at this width so the linework
  // it draws covers roughly the ground the real road covers.
  function roadWidthM(tags) {
    const c = tags.class || '';
    if (c === 'motorway' || c === 'trunk') return 12;
    if (c === 'primary') return 10;
    if (c === 'secondary') return 8;
    if (c === 'tertiary') return 7;
    if (c === 'minor' || c === 'street' || c === 'service') return 5;
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
  //   • rasterizeTile stamps `roadMask` with it,
  // so the ground the player SEES as road is exactly the ground nothing is
  // allowed to spawn on. The terrain grid can't answer that question on its
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
  // Visit every cell a polyline covers when stamped as a disk of radius
  // widthCells/2 along Bresenham segments. Used by the terrain paint
  // (paintLine). The road-footprint mask (stampMaskLine below) used to share
  // this walk, but it now stamps from the exact drawn-band geometry instead —
  // the centerline walk can't see a band spilling into a neighbouring cell.
  //
  // Vertices map to the cell that CONTAINS them — floor(), the same rule
  // snapCell / spawnDebris use, and the same answer paintPolygon's
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

  // Flag every cell a way's drawn band covers in a 0/1 mask. Same traversal as
  // paintLine, but it writes no terrain — a masked cell keeps its biome (and
  // stays walkable); it is only barred from hosting a spawn. See roadMask.
  // ── Road-footprint mask stamping ──────────────────────────────────────────
  // The mask must cover the ground the overlay DRAWS, and the overlay strokes
  // each way as a continuous band `widthCells` wide in world space — not as a
  // run of whole cells. So the mask is stamped from exact band coverage: every
  // cell whose square the thickened segment (a capsule of radius widthCells/2,
  // round caps like the canvas stroke) overlaps. The previous stamp walked
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
  // widthCells is FRACTIONAL — the caller passes roadOverlayWidthM / cellWidthM
  // unrounded, so a 2 m footpath masks exactly the cells its 2 m band overlaps.
  function stampMaskLine(mask, w, h, line, widthCells, mvtToCell) {
    const halfW = Math.max(0, widthCells / 2);
    for (let i = 1; i < line.length; i++) {
      const ax = line[i - 1].x * mvtToCell, ay = line[i - 1].y * mvtToCell;
      const bx = line[i].x * mvtToCell,     by = line[i].y * mvtToCell;
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - halfW));
      const x1 = Math.min(w - 1, Math.floor(Math.max(ax, bx) + halfW));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by) - halfW));
      const y1 = Math.min(h - 1, Math.floor(Math.max(ay, by) + halfW));
      for (let cy = y0; cy <= y1; cy++) {
        for (let cx = x0; cx <= x1; cx++) {
          if (mask[cy * w + cx]) continue;
          if (bandCoversCell(ax, ay, bx, by, halfW, cx, cy)) mask[cy * w + cx] = 1;
        }
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
  function erodePavementBlobs(grid, w, h, pathUnder, roadUnder) {
    const isPaved = (t) => t === T.ROAD || t === T.ROAD_MD || t === T.ROAD_LG || t === T.PATH;
    const kindOf = (t) => (t === T.PATH ? 1 : 0);
    // The biome a paved cell covered, if any was recorded. A cell repainted
    // across kinds (ROAD stamped over PATH) records PATH in roadUnder — skip
    // paved values and fall through to the path stamp's original record.
    const underAt = (x, y) => {
      const k = `${x}_${y}`;
      for (const u of [roadUnder[k], pathUnder[k]]) {
        if (u != null && !isPaved(u)) return u;
      }
      return null;
    };
    const eroded = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const t = grid[y * w + x];
        if (!isPaved(t)) continue;
        const kind = kindOf(t);
        let interior = true;
        for (let dy = -1; dy <= 1 && interior; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue; // seam: assume the blob continues
            const nt = grid[ny * w + nx];
            if (!isPaved(nt) || kindOf(nt) !== kind) { interior = false; break; }
          }
        }
        if (interior) eroded.push([x, y]);
      }
    }
    // Two-phase (collect, then write) so erosion decisions all read the
    // original grid — peeling in scan order would cascade through the blob.
    for (const [x, y] of eroded) {
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
      // The cell is no longer PATH — drop its stale under record so the
      // exported entry.pathUnder only describes live path cells.
      delete pathUnder[`${x}_${y}`];
    }
    return eroded.length;
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
  // Tier weights in spawnCaveRocks make depth-1 copper-heavy (~80 % of ores):
  //   surface (depth 0) → 0.90 plain → 0.10 ore → ~2.5 % copper-bearing rock
  //   depth 1           → 0.50 plain → 0.50 ore → ~40 % copper, ~10 % rarer
  //   depth 2           → 0.45 plain → 0.55 ore  (balanced ore table kicks in)
  //   depth 3           → 0.40 plain
  //   depth 4           → 0.35 plain
  //   depth 5+          → floors at 0.30 plain
  function caveRockP(depth) {
    if (!depth || depth <= 0) return 0.90;
    return Math.max(0.30, 0.50 - 0.05 * (depth - 1));
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
    let totalW = 0;
    for (const w of SURFACE_ROCK_TIER_WEIGHTS) totalW += w;
    const r = rng() * totalW;
    let yieldTier = 7, acc = 0;
    for (let i = 0; i < SURFACE_ROCK_TIER_WEIGHTS.length; i++) {
      acc += SURFACE_ROCK_TIER_WEIGHTS[i];
      if (r <= acc) { yieldTier = i + 1; break; }
    }
    return { yieldTier, requiredTier: Math.max(1, yieldTier - 1) };
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
  // Set while rebuildTileWithBin is replacing a tile: the cross-tile spawn
  // dedup skips this key so the rebuild doesn't dedupe against the very entry
  // it is about to replace.
  let _dedupSkipKey = null;

  // Cross-tile spawn-dedup index: everything a newly-built tile's objects are
  // checked against. One pass over the cache collects named chests (name →
  // positions) and house positions.
  //
  // skipKey excludes that tile's own live entry while rebuildTileWithBin
  // replaces it in place — the rebuild produces chests AND houses at exactly
  // the coordinates of the copies it is about to swap out, so without the
  // skip it dedupes against itself and drops them all. Houses learned this
  // the hard way: the skip originally covered only the chest index, and every
  // rebuilt tile (any tile whose Overpass bin landed after it rasterized)
  // kept its painted building footprints but lost every house sprite —
  // brick footings with nothing standing on them.
  function collectDedupIndex(tileCache, skipKey) {
    const byName = new Map();   // chest name → [{ x, y }]
    const housePositions = [];
    for (const [ek, e] of tileCache) {
      if (!e || !e.objects) continue;
      if (ek === skipKey) continue;
      for (const p of e.objects) {
        if (p.kind === 'chest' && p.name) {
          const k = p.name.trim().toLowerCase();
          let arr = byName.get(k);
          if (!arr) { arr = []; byName.set(k, arr); }
          arr.push({ x: p.x, y: p.y });
        } else if (p.kind === 'house') {
          housePositions.push({ x: p.x, y: p.y });
        }
      }
    }
    return { byName, housePositions };
  }

  function tileUrlFor(x, y) {
    return TILE_URL.replace('{z}', Z).replace('{x}', x).replace('{y}', y);
  }
  // Background refresh of a stale record. Never throws, never deletes: on any
  // failure the existing cached bytes remain the tile's source of truth.
  function refreshTileBytes(x, y) {
    const key = tileKey(x, y);
    if (_tileRefreshing.has(key)) return;
    _tileRefreshing.add(key);
    fetch(tileUrlFor(x, y))
      .then((resp) => (resp.ok ? resp.arrayBuffer() : null))
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
    const resp = await fetch(tileUrlFor(x, y));
    if (!resp.ok) throw new Error(`tile ${key} HTTP ${resp.status}`);
    const buf = new Uint8Array(await resp.arrayBuffer());
    idbPut(key, { bytes: buf, fetchedAt: Date.now() });
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
  function assignBuildingFootprints(polys, mvtToCell, w, h, pad = 0) {
    const lo = -pad, hiX = w - 1 + pad, hiY = h - 1 + pad;
    const stride = (hiX - lo + 1);
    const cellIdx = (x, y) => (y - lo) * stride + (x - lo);
    const inRange = (x, y) => x >= lo && x <= hiX && y >= lo && y <= hiY;
    // Claim map over the padded grid: -1 = free, else the building's index.
    const owner = new Int32Array(stride * (hiY - lo + 1)).fill(-1);
    const claimed = (x, y) => owner[cellIdx(x, y)] !== -1;

    // Per-building: ring in cell units, candidate covers, tie-break key.
    const info = polys.map((bp, i) => {
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
      return { i, bp, ring, covers, key: footprintTieKey(ring), cells: [] };
    });
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
    for (const bid of body) claim(bid);

    // Pass 2 — rectangle bias: inside the bounding box of what pass 1 gave
    // this building, a cell's cover counts FOOT_RECT_BONUS times over. Squares
    // off ragged edges (a rotated house rasterizes to a staircase otherwise)
    // and fills the notches the old tidy pass used to, but can only take cells
    // no other building claimed.
    const fill = [];
    for (const it of info) {
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
    for (const bid of fill) claim(bid);

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
    for (const o of orphans) {
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
    for (const it of growOrder) {
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

    // Pass 4 — shape cleanup, claim-aware. Same rules the old footprint tidy
    // enforced (drop stray crumbs, fill 1-wide notches, bridge diagonal-only
    // contacts) except that it may only ADD cells nobody else owns, so it can
    // never re-introduce an overlap. Buildings are processed in geometry-key
    // order for the same reason pass 1 is: no dependence on input order.
    const tidyOrder = info.slice().sort((a, b) => a.key - b.key);
    for (const it of tidyOrder) {
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

  function rasterizeTile(layers, cellsPerEdge, tx, ty, tileEdgeM) {
    const w = cellsPerEdge, h = cellsPerEdge;
    const grid = new Uint8Array(w * h);
    // Per-cell building ownership: a 1-based, per-tile id stamped only on
    // building footprint cells (0 = not a building). Lets the renderer draw a
    // seam between distinct buildings whose footprints rasterized into one
    // contiguous block of building tiles (otherwise they read as one blob).
    const owners = new Uint16Array(w * h);
    // Road FOOTPRINT mask (1 = under a drawn road band). The terrain grid is a
    // lossy record of where the roads are: every way rasterizes exactly ONE
    // cell wide whatever its class, and parking aisles are skipped entirely —
    // while the road-geometry overlay draws each way at its real carriageway
    // width (roadOverlayWidthM), so a motorway's band covers a full cell past
    // its ROAD_LG cells on either side and a parking lot is carpeted in
    // asphalt the grid still calls landuse. Anything seated on those cells
    // reads as sitting in the road, which is precisely the bug that kept
    // coming back: the spawn filters were checking terrain, and terrain wasn't
    // the question. This mask IS the question. It changes no terrain — masked
    // cells keep their biome and stay walkable — it only bars spawns and
    // tilling (app.js isTillableCell reads it as cell.underRoad). Stamped from
    // exact band coverage (see stampMaskLine): a cell counts as road ground
    // the moment the drawn band overlaps ANY of it, so a street hugging a cell
    // boundary claims both cells it draws over.
    const roadMask = new Uint8Array(w * h);
    // Per-cell length of PATH geometry, in cell widths — see accumulateLineSpan.
    // Reduced to the pathCross mask below once every way has been walked.
    const pathSpan = new Float32Array(w * h);
    const mvtToCell = cellsPerEdge / TILE_EXTENT;
    const mvtToM = tileEdgeM / TILE_EXTENT;
    // Metres per cell in THIS tile's basis. Not CELL_M: cellsPerEdge is a
    // rounded division, so the tile's own cells are a few mm off the nominal
    // size and the grid was painted with these, not those.
    const cellWidthM = tileEdgeM / w;
    const objects = [];
    const wildplants = [];
    const parkingTreasures = []; // one guaranteed treasure-X per parking-POI
    // Grid indices of synthesized CONCRETE POI pads (the hospital cross /
    // school pyramid painted around a POI chest). Scatter interactables are
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
    const rng = makeRng(tx * HASH_MUL_X ^ ty * HASH_MUL_Y);

    // Helper: spawn debris within a polygon's rings at the polygon's own stable density.
    // density seed = polygon centroid → stable across reloads.
    // Each debris snaps to the CENTER of its 5m game cell (no jitter), and is keyed
    // by the cell's absolute (cellIX, cellIY) so the same cell is always the same id.
    function spawnDebris(rings, crop, polyKey, dMin, dMax) {
      const prng = makeRng(polyKey);
      const density = dMin + prng() * (dMax - dMin);
      const bb = bboxOf(rings);
      const stepMvt = CELL_M / mvtToM; // one candidate per game-cell-width
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

    // NOTE: the OSM 'waterway' layer (streams / rivers / drains / canals) is
    // deliberately NOT painted — these are culverted / underground and not
    // visible on the ground IRL, so they shouldn't carve WATER tiles. Open
    // water bodies (lakes, ponds, ocean, pools) still come in via 'water'.
    const order = ['landcover', 'landuse', 'park', 'water', 'transportation', 'building', 'poi'];
    const layersByName = {};
    for (const l of layers) layersByName[l.name] = l;

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
          if (f.tags && f.tags.service === 'parking_aisle') continue;   // never painted
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
    const pathCrossAt = (cx, cy, isElbow) => isElbow ||
      (cx >= 0 && cy >= 0 && cx < w && cy < h && pathCross[cy * w + cx] === 1);

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
                        // (Procedural forest trees carry no size → never bush-tier.)
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
              const pivotStep = 34 / mvtToM;        // one cluster candidate per ~34 m (~5 cells at 7 m/cell; was 24 m when cells were 5 m)
              const clusterR  = 7  / mvtToM;        // rocks placed within ~7 m of pivot
              // Tier weights for the ORE subset (the share that isn't plain
              // cave rock — caveRockP(0) ⇒ ~90 % plain on the surface). Copper
              // is T2 at weight 0.25 of the subset, so copper-bearing rock is
              // ~0.10 × 0.25 ≈ 2.5 % of all surface rocks. Underground the same
              // shape is reused with a smaller plain fraction (richer with
              // depth) but plain rock always stays the majority (see caveRockP).
              const weights = SURFACE_ROCK_TIER_WEIGHTS;   // shared with rollSurfaceRockTier
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
              const pivotStep = 20 / mvtToM;        // ~one candidate per 20 m — much denser than residential's 34 (was 14 m when cells were 5 m)
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
              const pivotStep = 17 / mvtToM;        // was 12 m when cells were 5 m; scaled ×7/5
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
          // Record the way's full drawn footprint FIRST — before the
          // parking-aisle skip and regardless of how narrow a band the
          // rasterizer is about to paint. This is the mask the spawn filters
          // read; see roadMask above.
          {
            // Fractional width, no rounding: the stamp is an exact coverage
            // test, so the mask lands on precisely the cells the band draws
            // over — including a cell the band only spills partway into.
            const widthCells = roadOverlayWidthM(f.tags) / cellWidthM;
            for (const line of f.geom) stampMaskLine(roadMask, w, h, line, widthCells, mvtToCell);
          }
          // Parking-lot aisles carpet a lot with parallel service lines spaced
          // closer than one cell, so they rasterize into a solid asphalt blob,
          // not a road network. Skip them entirely: the lot keeps its landuse
          // paint and the parking-POI treasure X already marks it.
          if (f.tags.service === 'parking_aisle') continue;
          // Roads and paths rasterize exactly ONE cell wide regardless of
          // their OSM width: the cobble tile fills the whole cell, so wider
          // disk stamping only made the band wobble between 1 and 2 rows
          // ("ladder" artifacts) and welded dual carriageways together.
          // Two parallel OSM ways now read as two clean uniform lanes.
          // Piers keep their measured width (their plank sprite fills the
          // whole cell, so coverage IS their width).
          const wCells = (t === T.PIER)
            ? Math.max(1, Math.round(roadWidthM(f.tags) / cellWidthM))
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
          // (cellWidthM is the tile-basis cell size hoisted at the top.)
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
                // Track concrete pads (not park buffers) so the post-pass can
                // keep scatter interactables off the POI's plaza.
                if (padType !== T.PARK) poiPadCells.add(idx);
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
      // building ring (above), enforce the per-tile floors (≥50% house,
      // ≥8% fort, ≥2% castle — see TIER_FLOOR_*) by re-tiering by area-rank
      // where needed.
      // Then paint + push house objects (LARGE gets a cement pad with no
      // sprite; everything else gets a 'house' object).
      if (name === 'building' && buildingPolys.length) {
        // Give every building an EXCLUSIVE set of cells before anything is
        // painted. Cells are assigned by how much of them the polygon actually
        // covers (>45%, or >34.6% where it squares the footprint off), with
        // every contested cell decided by cover rather than by paint order, so
        // footprints can never overlap and no building can be swallowed by its
        // neighbour. Assignment runs with a 3-cell pad past the tile bounds so
        // an edge-clipped building shapes the same in both tiles that draw it;
        // only the in-bounds cells are painted.
        const footprints = assignBuildingFootprints(buildingPolys, mvtToCell, w, h, 3);
        // Tier floors are enforced AFTER assignment, over the buildings that
        // actually landed on the tile — a building that got no cell at all
        // mustn't consume the tile's one guaranteed castle/fort slot.
        const _placed = buildingPolys.filter((bp, i) => footprints[i].some(
          ([fx, fy]) => fx >= 0 && fy >= 0 && fx < w && fy < h));
        enforceBuildingDistribution(_placed);
        let _bOwnerId = 0;
        for (let _bi = 0; _bi < buildingPolys.length; _bi++) {
          const bp = buildingPolys[_bi];
          // Stamp building ownership over this building's footprint cells with
          // a unique per-tile id. Footprints are disjoint, so a cell has
          // exactly one owner. The renderer strokes a seam wherever two
          // adjacent building cells carry different owners, separating
          // buildings whose footprints abut into one contiguous block.
          const ownerId = (++_bOwnerId) & 0xffff;
          const fpCells = [];
          for (const [fx, fy] of footprints[_bi]) {
            if (fx < 0 || fy < 0 || fx >= w || fy >= h) continue;
            paintCell(grid, w, h, fx, fy, bp.tier);
            owners[fy * w + fx] = ownerId;
            fpCells.push([fx, fy]);
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
          // Anchor the house on its RASTERIZED FOOTPRINT (the tiles it's painted
          // on), not the geometric ring centroid: take the footprint cells'
          // centroid, then pick the footprint cell nearest it. This guarantees
          // the sprite's bottom-middle sits on an actual building tile even for
          // L-shaped / tile-clipped footprints (where the ring centroid can land
          // off the block). Snapping to a cell also keeps the occupancy pass and
          // row alignment working.
          let sxc = 0, syc = 0;
          for (const [fx, fy] of fpCells) { sxc += fx + 0.5; syc += fy + 0.5; }
          const ccx = sxc / fpCells.length, ccy = syc / fpCells.length;
          let best = fpCells[0], bd = Infinity;
          for (const [fx, fy] of fpCells) {
            const ex = fx + 0.5 - ccx, ey = fy + 0.5 - ccy, d = ex * ex + ey * ey;
            if (d < bd) { bd = d; best = [fx, fy]; }
          }
          const cc = cellCenterMeters(best[0], best[1]);
          const cx = cc.mx, cy = cc.my;
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
    // Post-pass: pavement-blob erosion. Overlapping/parallel road + path ways
    // (sidewalk meshes, plaza loops, anything denser than one cell apart)
    // weld into solid paved zones; dissolve the strict same-kind interior back
    // to the under-biome so pavement always reads as lines and loops, never
    // as a flood-filled area. Runs after ALL painting (buildings included) so
    // the interior test sees the final grid, and before the road-label /
    // path-stone passes so no glyph or stone lands on a dissolved cell.
    erodePavementBlobs(grid, w, h, pathUnder, roadUnder);
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
      // Under a drawn road band — see roadMask. Checked everywhere a road TIER
      // is checked: the two answer the same question, and the tier alone gets
      // it wrong on exactly the cells players notice (the flanks of a big road,
      // the whole of a parking lot).
      const _underRoadBand = (ix, iy) => roadMask[iy * w + ix] === 1;
      const _mrIsBlocked = (ix, iy) => {
        const tc = grid[iy * w + ix];
        return tc === T.ROAD     || tc === T.ROAD_LG || tc === T.ROAD_MD
            || tc === T.PATH     || tc === T.WATER    || tc === T.PIER
            || tc === T.BUILDING || tc === T.BUILDING_MED || tc === T.BUILDING_LARGE
            || _underRoadBand(ix, iy);
      };
      // No interactable may sit on a road tier or a building footprint. This is
      // the blanket rule for EVERY scatter object (rocks, trees, wells, poles,
      // …); the sole exception is a POI chest, handled explicitly below.
      const _onRoadOrBuilding = (tc, ix, iy) =>
           tc === T.ROAD     || tc === T.ROAD_LG    || tc === T.ROAD_MD
        || tc === T.BUILDING || tc === T.BUILDING_MED || tc === T.BUILDING_LARGE
        || _underRoadBand(ix, iy);
      // A house/tower sprite is foot-anchored on its footprint and its base
      // overhangs the immediately adjacent cells, so a scatter object one cell
      // off the footprint still reads as sitting ON the building's foundation
      // ("interactables spawning in house boundaries"). Keep a one-cell moat
      // clear of EVERY scatter object around every building cell.
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
      // Use the same basis the grid was painted with (cellWidthM, above).
      // Houses are placed inside building footprints — always road-adjacent
      // by virtue of OSM data and never something the player wades into a
      // back yard for. Keep them exempt from the residential proximity
      // check below.
      const _mrSkipKind = (k) => k === 'house' || k === 'tower';
      // POI chests are real-world destinations and count as public anchors for
      // the shared isSpawnCell rule below. Snapshot their cell coords now,
      // before we start splicing `objects`.
      const _mrSpawnOpts = {
        roadMask,
        pois: objects
          .filter(o => o.kind === 'chest')
          .map(o => ({
            ix: Math.floor((o.x - tileOriginMx) / cellWidthM),
            iy: Math.floor((o.y - tileOriginMy) / cellWidthM),
          })),
      };
      // A chest's cell is protected by the occupancy pass, but its render pad
      // spills past the cell and the player needs to stand beside it — keep
      // scatter objects out of the chest's one-cell frontage too.
      const _mrNearPoi = (ix, iy) => {
        const ps = _mrSpawnOpts.pois;
        for (let k = 0; k < ps.length; k++) {
          if (Math.abs(ps[k].ix - ix) <= 1 && Math.abs(ps[k].iy - iy) <= 1) return true;
        }
        return false;
      };
      for (let i = objects.length - 1; i >= 0; i--) {
        const o = objects[i];
        if (_mrSkipKind(o.kind)) continue;
        const ix = Math.floor((o.x - tileOriginMx) / cellWidthM);
        const iy = Math.floor((o.y - tileOriginMy) / cellWidthM);
        if (ix < 0 || ix >= w || iy < 0 || iy >= h) continue;   // off-tile objects belong to a neighbour pass
        const here = grid[iy * w + ix];
        // Blanket cull: nothing but a POI chest may sit on a road tier or a
        // building footprint. A chest is a real-world destination deliberately
        // placed at its coordinates — and a POI inside a building is allowed
        // (the player taps the building floor to activate it). House/tower
        // sprites ARE the building and were already skipped via _mrSkipKind.
        if (o.kind !== 'chest') {
          if (_onRoadOrBuilding(here, ix, iy)) { objects.splice(i, 1); continue; }
          // One-cell building moat for ground scatter — anything closer sits
          // visually inside the house/tower sprite's overhang. Trees are
          // EXEMPT: yard trees genuinely grow against house walls (and the
          // home grove the early game's wood supply depends on rings the
          // player's own house), and a tall canopy beside a wall reads
          // naturally where a rock on the foundation reads as junk.
          const _mrIsTree = o.kind === 'tree' || o.kind === 'fruittree';
          if (!_mrIsTree && _mrNearBuilding(ix, iy)) { objects.splice(i, 1); continue; }
          // Synthesized concrete POI pads (hospital cross / school pyramid)
          // repaint cells AFTER scatter spawns ran — e.g. a residential rock
          // cluster's cell becomes COMMERCIAL pad, skipping the RESIDENTIAL
          // spawn gate below. Nothing but the chest belongs on its plaza.
          if (poiPadCells.has(iy * w + ix)) { objects.splice(i, 1); continue; }
          // Keep the chest's one-cell frontage clear too.
          if (_mrNearPoi(ix, iy)) { objects.splice(i, 1); continue; }
        }
        if (o.kind === 'mineralrock') {
          if (_mrIsBlocked(ix, iy)) { objects.splice(i, 1); continue; }
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
        const ix = Math.floor((wp.x - tileOriginMx) / cellWidthM);
        const iy = Math.floor((wp.y - tileOriginMy) / cellWidthM);
        if (ix < 0 || ix >= w || iy < 0 || iy >= h) continue;
        const wtc = grid[iy * w + ix];
        if (_onRoadOrBuilding(wtc, ix, iy)) { wildplants.splice(i, 1); continue; }
        // Concrete POI pads stay bare — a shrub/marigold that survived the
        // biome filter (rocky-family crops) still doesn't belong on the plaza.
        if (poiPadCells.has(iy * w + ix)) { wildplants.splice(i, 1); continue; }
        if (wtc !== T.RESIDENTIAL) continue;
        if (!isSpawnCell(grid, w, h, ix, iy, _mrSpawnOpts)) wildplants.splice(i, 1);
      }
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
        const ix = Math.floor((t.x - tileOriginMx) / cellWidthM);
        const iy = Math.floor((t.y - tileOriginMy) / cellWidthM);
        if (ix < 0 || ix >= w || iy < 0 || iy >= h) continue;
        const moved = relocateToSpawnCell(grid, w, h, ix, iy, _mrSpawnOpts);
        if (!moved) { parkingTreasures.splice(i, 1); continue; }
        if (moved.ix === ix && moved.iy === iy) continue;
        const { mx, my } = cellCenterMeters(moved.ix, moved.iy);
        t.x = mx; t.y = my;
        t.id = `t_park_${Math.round(mx)}_${Math.round(my)}`;
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
    // Road-name labels: walk each transportation_name line at ~1 cell per step
    // and drop ONE compact whole-word label (the name's first word) every
    // LABEL_PERIOD road cells, rotated to the local road direction. This
    // replaced the old letter-per-cell stamping ("C","A","S",… each in its own
    // cobble), which read as a cryptic letter trail rather than a street name.
    // Angles are normalized to (-90°, 90°] so a label never renders upside
    // down regardless of the way's digitized direction.
    // Stored as { "ix_iy": { text, angle } } — anchor cells only, vehicle road
    // tiers only (PATH pebbles are too small to carry a label; named paths
    // keep their identity via pathNames below).
    const roadLabels = {};
    const LABEL_PERIOD = 12;   // cells between label repeats (~84 m)
    const LABEL_OFFSET = 2;    // first label a couple of cells in from the line start
    // pathNames[`${ix}_${iy}`] = full street name, recorded ONLY for PATH
    // cells (terrain code 8). Drives the path-stone activation feature in
    // app.js — tap or step on a path stone to "claim" it, fill every stone
    // of one named path to trigger a treasure dialog. We deliberately
    // store the FULL name (not just the first word the road-label loop
    // uses) so two paths sharing a first word still count as distinct.
    const pathNames = {};
    const tnLayer = layersByName['transportation_name'];
    const ROAD_TYPES = new Set([T.ROAD, T.ROAD_MD, T.ROAD_LG, T.PATH]);
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
                  ROAD_TYPES.has(grid[iy * w + ix])) {
                if (cellStep % LABEL_PERIOD === LABEL_OFFSET &&
                    LABEL_TYPES.has(grid[iy * w + ix])) {
                  roadLabels[key] = { text: firstWord, angle: ang };
                }
                // PATH cells additionally record the full street name so
                // app.js can group stones by named path for the activation
                // / completion-reward loop.
                if (grid[iy * w + ix] === T.PATH) pathNames[key] = name;
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
    return { grid, owners, objects: deduped, wildplants: filtered, parkingTreasures, roadLabels, pathNames, pathUnder, poiPadCells, roadMask };
  }

  function tileEdgeMeters(lat) {
    // edge in meters at z=14 at given latitude
    return metersPerPixel(lat, Z) * TILE_PX;
  }
  function cellsPerEdgeForLat(lat) {
    return Math.round(tileEdgeMeters(lat) / CELL_M);
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
  function runHeavyPhase(fn) {
    const run = _heavyChain
      .then(() => new Promise((r) => setTimeout(r, 0)))
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
    const key = tileKey(x, y);
    if (!detached && tileCache.has(key)) return tileCache.get(key);
    if (depth > 0) return loadCaveTile(tileCache, depth, key, x, y, lat);
    // A failed build used to stay in the cache as a permanent 'loading' entry
    // with a rejected promise: loadTile returns cached entries without looking
    // at their status, so ONE flaky fetch turned that tile into blank grass for
    // the rest of the session, mid-walk. Failures now evict themselves (below)
    // so the next ensureTilesAround retries — with a short floor so a hard
    // offline stretch doesn't spin on rebuild attempts.
    const failedAt = detached ? 0 : _tileFailedAt.get(key);
    if (failedAt && Date.now() - failedAt < TILE_RETRY_MS) {
      return { status: 'loading', grid: null, cellsPerEdge: cellsPerEdgeForLat(lat),
               tileEdgeM: tileEdgeMeters(lat), promise: Promise.reject(new Error(`tile ${key} backoff`)),
               _transient: true };
    }
    const entry = { status: 'loading', grid: null, cellsPerEdge: cellsPerEdgeForLat(lat) };
    const tileEdgeM = tileEdgeMeters(lat);
    entry.tileEdgeM = tileEdgeM;
    entry.promise = (async () => {
      const { bytes, fromCache } = await fetchTileBytes(x, y);
      // Decode and rasterize in separate scheduled turns (see runHeavyPhase):
      // the two heaviest chunks of a tile build each get their own slice, and
      // the spawn/dedup post-passes below ride the rasterize turn.
      const layers = await runHeavyPhase(() => MVT.decodeTile(bytes));
      const { grid, owners, objects, wildplants, parkingTreasures, roadLabels, pathNames, pathUnder, poiPadCells, roadMask } = await runHeavyPhase(() => rasterizeTile(layers, entry.cellsPerEdge, x, y, tileEdgeM));
      // Cross-tile dedup: drop any newly-spawned chest whose name matches one
      // already in a previously-loaded tile within 120m (typical OSM intersection
      // POIs duplicate across the four tiles meeting at that corner), and any
      // new house within HOUSE_DEDUP_M of an existing one — the same building
      // can be duplicated across the 4 tiles meeting at its corner, producing
      // 2-4 sprites for the same physical structure (no name available — OSM
      // doesn't usually name dwellings).
      //
      // Chests are indexed by lowercased name to keep dedup O(new × matches)
      // rather than O(new × total) — the prior triple-nested scan was quadratic
      // across the entire tileCache for every tile load.
      const DEDUP_M = 120;
      const DEDUP_M2 = DEDUP_M * DEDUP_M;
      const HOUSE_DEDUP_M = 6;
      const HOUSE_DEDUP_M2 = HOUSE_DEDUP_M * HOUSE_DEDUP_M;
      const { byName, housePositions } = collectDedupIndex(tileCache, _dedupSkipKey);
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
      entry.owners = owners;
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
      // Cave entrance: drop one "descend" staircase per surface tile beside a
      // cave-rock cluster (a mine mouth). Tiles with no cave rock get no
      // entrance — not every block has a way down, which reads naturally.
      maybePlaceCaveEntrance(entry, x, y, tileEdgeM);
      entry.wildplants = wildplants;
      entry.parkingTreasures = parkingTreasures || [];
      entry.roadLabels = roadLabels || {};
      entry.pathNames   = pathNames   || {};
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
        // injected features never land on an existing interactable (a rasterized
        // tree / rock / house / chest).
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
        const _sxSpawnOpts = { pois: _sxPois, roadMask };
        const _sxYardOK = (wx, wy) => {
          const { ix, iy } = _sxCell(wx, wy);
          if (ix < 0 || iy < 0 || ix >= cpe || iy >= cpe) return true;
          if (grid[iy * cpe + ix] !== T.RESIDENTIAL) return true;
          return isSpawnCell(grid, cpe, cpe, ix, iy, _sxSpawnOpts);
        };
        // Trees + fruit trees can NEVER sit on a building footprint, road, path,
        // water or other hard/interactable cell — nor on a manicured open field
        // (school grounds, playground, sports pitch, golf course), which read
        // wrong carpeted in OSM trees. When a detection lands on one, relocate
        // it to a favourable empty neighbour cell; drop it only if no neighbour
        // works. One tree per cell — process largest crown first so the biggest
        // tree wins a contested cell and smaller ones spill to neighbours.
        const TREE_BLOCK = new Set([
          T.WATER, T.PIER, T.ROAD, T.ROAD_MD, T.ROAD_LG, T.PATH,
          T.BUILDING, T.BUILDING_MED, T.BUILDING_LARGE,
          T.COMMERCIAL, T.INDUSTRIAL, T.ROCK,
          T.SCHOOL, T.PLAYGROUND, T.PITCH, T.GOLF,
        ]);
        // Cell at (ix,iy) is hard ground a scatter object must never sit on:
        // the TREE_BLOCK terrain set, plus anything under a drawn road band
        // (roadMask) — the injected features are placed from real-world
        // coordinates, so without the mask an OSM street tree recorded in the
        // middle of a widened carriageway stays there.
        const _sxHardCell = (ix, iy) => {
          if (ix < 0 || iy < 0 || ix >= cpe || iy >= cpe) return false;
          return TREE_BLOCK.has(grid[iy * cpe + ix]) || roadMask[iy * cpe + ix] === 1;
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
          const tc = grid[iy * cpe + ix];
          return tc === T.BUILDING || tc === T.BUILDING_MED || tc === T.BUILDING_LARGE;
        };
        // One-cell building moat — same rule the rasterize post-pass applies:
        // house/tower sprites overhang their footprint's neighbours, so an
        // injected object one cell off the footprint reads as sitting inside
        // the house. Mirrored here for the sidecar GROUND furniture (poles,
        // wells). Trees are exempt in both passes — yard trees grow right
        // against real houses (see tryTreeCell).
        const _sxNearBuildingCell = (ix, iy) => {
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const nx = ix + dx, ny = iy + dy;
            if (nx < 0 || ny < 0 || nx >= cpe || ny >= cpe) continue;
            const tc = grid[ny * cpe + nx];
            if (tc === T.BUILDING || tc === T.BUILDING_MED || tc === T.BUILDING_LARGE) return true;
          }
          return false;
        };
        // One-cell POI frontage — keep injected features off a chest's cell
        // neighbourhood (its pad spills past the cell and the player stands
        // beside it). _sxPois already covers both rasterized and bin chests.
        const _sxNearChestCell = (ix, iy) => {
          for (let k2 = 0; k2 < _sxPois.length; k2++) {
            if (Math.abs(_sxPois[k2].ix - ix) <= 1
             && Math.abs(_sxPois[k2].iy - iy) <= 1) return true;
          }
          return false;
        };
        const _sxNearBuilding = (wx, wy) => {
          const { ix, iy } = _sxCell(wx, wy);
          return _sxNearBuildingCell(ix, iy);
        };
        const _sxNearChest = (wx, wy) => {
          const { ix, iy } = _sxCell(wx, wy);
          return _sxNearChestCell(ix, iy);
        };
        // POI chests (bus stops, signals, crossings, gates, towers, pitches,
        // gardens, bicycle racks, …) are injected FIRST: a chest is a real-world
        // destination, so it must win its cell over a generic tree/shrub/pole
        // (mirroring the rasterize occupancy pass where chest outranks all).
        // poiClass drives loot / tier / label / coin-burst via loot.js + the
        // render/interact chest paths.
        //
        // Area-derived sidecar POIs (way centroids: pitches, playgrounds,
        // gardens, pools) usually describe the SAME real-world feature the MVT
        // poi layer already spawned a chest for — but the two pipelines snap on
        // different bases (MVT label point + placement offset vs Overpass way
        // centroid on the global 5 m grid), so the same field's two chests land
        // several metres apart and the cell-occupancy check can't catch them
        // (this is what duplicated the Children's Yard / Tourney Grounds
        // chests). Skip the sidecar copy when a same-class chest already sits
        // within ~25 m — point-furniture classes (bus stops, signals, …) keep
        // the cell-only dedupe, since two distinct real stops can legitimately
        // sit ~15 m apart.
        const SX_AREA_POI = new Set(['pitch', 'playground', 'garden', 'swimming_pool']);
        const AREA_DUP_R2 = 25 * 25;
        // A chest outranks SCENERY on its cell, not just later injections: the
        // occupied set is seeded from everything rasterizeTile placed, so a
        // bus stop / crossing whose cell happened to hold a rasterized rock,
        // tree or grass tuft was silently dropped — a real-world destination
        // lost to set dressing ("I never see chests at POIs"). Evict the
        // scenery instead; only another chest or a structure (house / tower /
        // staircase) genuinely blocks the cell.
        const SX_CHEST_BLOCKERS = new Set(['chest', 'house', 'tower', 'staircase']);
        const evictSceneryAt = (k) => {
          for (const o of entry.objects) {
            if (SX_CHEST_BLOCKERS.has(o.kind) && cellKeyOf(o.x, o.y) === k) return false;
          }
          for (let i = entry.objects.length - 1; i >= 0; i--) {
            if (cellKeyOf(entry.objects[i].x, entry.objects[i].y) === k) entry.objects.splice(i, 1);
          }
          for (let i = entry.wildplants.length - 1; i >= 0; i--) {
            if (cellKeyOf(entry.wildplants[i].x, entry.wildplants[i].y) === k) entry.wildplants.splice(i, 1);
          }
          return true;
        };
        for (const ch of (bin.chests || [])) {
          if (onWater(ch.x, ch.y)) continue;   // a chest mid-lake / on stream water reads wrong
          if (!_sxYardOK(ch.x, ch.y)) continue;
          if (SX_AREA_POI.has(ch.poiClass) && entry.objects.some((o) =>
                o.kind === 'chest' && o.poiClass === ch.poiClass &&
                (o.x - ch.x) * (o.x - ch.x) + (o.y - ch.y) * (o.y - ch.y) <= AREA_DUP_R2))
            continue;
          const k = cellKeyOf(ch.x, ch.y);
          if (occupied.has(k) && !evictSceneryAt(k)) continue;
          occupied.add(k);
          const c = localCentre(ch.x, ch.y);
          ch.x = c.x; ch.y = c.y;
          delete ch.garden;   // internal flag — don't leak into the chest object
          entry.objects.push(ch);
        }
        const tryTreeCell = (ix, iy) => {
          if (ix < 0 || iy < 0 || ix >= cpe || iy >= cpe) return null;
          if (_sxHardCell(ix, iy)) return null;
          if (occupied.has(`${ix}_${iy}`)) return null;
          // Chest frontage stays clear (the player stands beside the chest),
          // but trees may hug buildings — no _sxNearBuildingCell here. Yard
          // trees sit right against real houses; routing them through the
          // building moat dropped every detection ringing a house (the cells
          // they'd relocate to are in the moat too) and left home yards bare.
          if (_sxNearChestCell(ix, iy)) return null;
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
          if (_sxNearChest(s.x, s.y)) continue;       // keep the POI frontage clear
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
          if (_sxNearBuilding(p.x, p.y)) continue;    // nor inside a house sprite's overhang
          if (_sxNearChest(p.x, p.y)) continue;       // keep the POI frontage clear
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
          if (_sxNearBuilding(wl.x, wl.y)) continue;  // nor inside a house sprite's overhang
          if (_sxNearChest(wl.x, wl.y)) continue;     // keep the POI frontage clear
          if (!_sxYardOK(wl.x, wl.y)) continue;
          const k = cellKeyOf(wl.x, wl.y);
          if (occupied.has(k)) continue;
          occupied.add(k);
          const c = localCentre(wl.x, wl.y);
          wl.x = c.x; wl.y = c.y;
          entry.objects.push(wl);
          // A well supersedes a road/path tile it lands on — repaint the cell to
          // the dominant soft neighbour biome (so it blends, not a hard grass
          // square) and clear the cobble's road-label / path-name so no label
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
            if (entry.roadLabels) delete entry.roadLabels[ck];
            if (entry.pathNames)   delete entry.pathNames[ck];
          }
        }
        // (POI chests were injected before the trees above — a chest is a
        // real-world destination and must win its cell over scenery; the
        // area-POI ~25 m same-class dedupe moved up with that loop.)
        // Parking lots (OSM amenity=parking) → a buried-treasure "X marks the
        // spot" mark, claimed via the treasure handler (same array the MVT
        // parking path fills). No per-cell occupancy — X marks sit under the
        // terrain and don't block other interactables.
        for (const pk of (bin.parking || [])) {
          const c = localCentre(pk.x, pk.y);
          pk.x = c.x; pk.y = c.y;
          // Same treatment the MVT parking path gets in the rasterize
          // post-pass: a lot's anchor lands on its aisle or the street beside
          // it as often as on standable ground, so walk the X to the nearest
          // cell that passes the shared spawn rule instead of burying treasure
          // under the asphalt. Dropped only if nothing nearby works.
          {
            const { ix, iy } = _sxCell(pk.x, pk.y);
            if (ix < 0 || iy < 0 || ix >= cpe || iy >= cpe) continue;
            const moved = relocateToSpawnCell(grid, cpe, cpe, ix, iy, _sxSpawnOpts);
            if (!moved) continue;
            pk.x = x * tileEdgeM + (moved.ix + 0.5) * mPerCell;
            pk.y = y * tileEdgeM + (moved.iy + 0.5) * mPerCell;
          }
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
      entry.fromCache = fromCache;
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
                  wells: [], chests: [], parking: [] };
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
              // Trees near the start are forced softwood (home.js) for easy early
              // wood — except bush-tier crowns, which render as a uniform bush and
              // gain nothing from the pine stamp (so they keep their own species).
              species: (typeof HomeArea !== 'undefined')
                ? HomeArea.softwoodSpeciesNear(cx, cy, props.species || TREE_SPECIES[seed % TREE_SPECIES.length], props.size)
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
            // 111320 m/deg matches the app-wide METERS_PER_DEG_LAT (app.js);
            // worldgen loads before app.js so it can't reference that constant
            // directly, hence the local literal.
            const mPerLat = 111320, mPerLon = 111320 * Math.cos(lat0 * Math.PI / 180);
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
  // poles, street furniture, fountains) — the DeepForest crowns and
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
      const total = (e.trees || 0) + (e.poles || 0) + (e.chests || 0) + (e.wells || 0) + (e.shrubs || 0) + (e.parking || 0);
      if (!total) return `live=on  src=${src} — area has 0 OSM features` + tail;
      return `live=on  src=${src}: ${e.trees || 0} trees, ${e.poles || 0} poles, ${e.chests || 0} chests, `
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
    return { trees: [], fruittrees: [], shrubs: [], poles: [],
             wells: [], chests: [], parking: [] };
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
    // and a little street furniture MVT omits. (Waterways are intentionally
    // excluded — they're underground / culverted and shouldn't paint water.)
    // Nodes for point features; ways (via `out center`) for tree_row.
    const sels = [
      'node["natural"="tree"]', 'way["natural"="tree_row"]',
      'node["power"="pole"]', 'node["man_made"="utility_pole"]',
      'node["man_made"="mast"]', 'node["highway"="street_lamp"]',
      'node["amenity"="fountain"]',
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
  // Negative-cache TTLs: after a failed Overpass fetch we store a sentinel in
  // IDB so the next page reload doesn't hammer the server again immediately.
  // 429 (rate-limited) gets a longer backoff than a generic network error.
  const OVERPASS_FAIL_TTL_MS = 5  * 60 * 1000;   // 5 min — transient / load-shed
  const OVERPASS_429_TTL_MS  = 15 * 60 * 1000;   // 15 min — rate limited

  // Per-tile cache + in-flight dedup so a tile is queried at most once.
  const _overpassInflight = new Map();
  async function fetchOverpassBin(x, y, lat) {
    const key = `ovp/${Z}/${x}/${y}`;
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
            json = await resp.json();
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
        // bin and come back treeless again). Trees/poles ~static → cached forever.
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
    const key = `ovp/${Z}/${x}/${y}`;
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
  // The build's cross-tile chest dedup has to ignore the tile's own live entry,
  // or the rebuild would dedupe its chests against the copies it is replacing
  // and drop them all.
  async function rebuildTileWithBin(x, y, lat) {
    const cache = cacheFor(0);
    const key = tileKey(x, y);
    const prev = cache.get(key);
    if (!prev || prev.status !== 'ready') return false;
    _dedupSkipKey = key;
    let fresh = null;
    try {
      fresh = await loadTile(x, y, lat, { detached: true });
      await fresh.promise;
    } catch (_) {
      fresh = null;                      // rebuild failed — the original stands
    } finally {
      _dedupSkipKey = null;
    }
    if (!fresh || fresh.status !== 'ready') return false;
    // Carry over live per-session state the rebuild can't reconstruct.
    if (prev.creatures && !fresh.creatures) fresh.creatures = prev.creatures;
    if (prev.coinDrops && !fresh.coinDrops) fresh.coinDrops = prev.coinDrops;
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

    // This pass runs AFTER every spawn cull, so it must enforce the same
    // placement rules itself or its ladders land where nothing else may:
    //   • never on a cell an interactable already occupies (one per cell)
    //   • never within the one-cell building moat (the house/tower sprite
    //     overhangs its footprint — "interactable in the house boundary")
    //   • never on or beside a POI chest / its concrete plaza pad
    const objCells = new Set();
    const chestCells = [];
    for (const o of entry.objects) {
      const { lix, liy } = cellIndexOf(tx, ty, o.x, o.y, tileEdgeM, N);
      if (lix < 0 || liy < 0 || lix >= N || liy >= N) continue;
      objCells.add(liy * N + lix);
      if (o.kind === 'chest') chestCells.push([lix, liy]);
    }
    const isBuildingT = (tc) =>
      tc === T.BUILDING || tc === T.BUILDING_MED || tc === T.BUILDING_LARGE;
    const nearBuilding = (lix, liy) => {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = lix + dx, ny = liy + dy;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        if (isBuildingT(grid[ny * N + nx])) return true;
      }
      return false;
    };
    const nearChest = (lix, liy) => chestCells.some(
      ([cx2, cy2]) => Math.max(Math.abs(cx2 - lix), Math.abs(cy2 - liy)) <= 1);
    const pads = entry.poiPadCells;
    const stairCellOK = (lix, liy, idx) =>
      !used.has(idx) && isWalkable(grid[idx]) && !tooClose(lix, liy)
      && !objCells.has(idx) && !(pads && pads.has(idx))
      && !nearBuilding(lix, liy) && !nearChest(lix, liy);

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
        if (!stairCellOK(lix, liy, idx)) continue;
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
        if (stairCellOK(i % N, Math.floor(i / N), i)) {
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
    // Depth-1 is the intro cave: ~80 % of ore rolls land on T2 (copper) so
    // the player reliably finds copper without grinding. Deeper levels use a
    // balanced spread that grows richer in rarer ores.
    const weights = depth === 1
      ? [0.05, 0.80, 0.09, 0.03, 0.02, 0.01, 0.00]
      : [0.30, 0.25, 0.22, 0.08, 0.07, 0.05, 0.03];
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
      roadLabels: {}, pathNames: {}, pathUnder: {},
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
    Z, CELL_M, TILE_PX, T, TILE_URL,
    lonLatToWorldPx, metersPerPixel, tileEdgeMeters, cellsPerEdgeForLat,
    tileXYForLonLat, loadTile, tileCache, makeRng,
    forEachItem, forEachItemNear, isWalkable, isSpawnCell, relocateToSpawnCell, setDepth, tidyFootprintCells,
    // Full-tile rasterization — exported for the headless spawn tests, which
    // build synthetic MVT layers and pin the "nothing spawns on a road" rule
    // end to end (test/node/spawn_roads.test.js).
    rasterizeTile,
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
    accumulateLineSpan, PATH_CROSS_MIN_CELLS,
    // Cross-tile spawn dedup — exported so the headless tests can pin that a
    // tile being rebuilt in place is excluded from its own dedup index (the
    // bug that stripped every house sprite off rebuilt tiles).
    collectDedupIndex,
    erodePavementBlobs,
    // Road/path rasterization — exported for the headless tests, which pin the
    // "a vertex paints the cell that contains it" rule (no half-cell bias).
    paintLine,
    // The surface-deposit rarity roll + its plain fraction — shared with the
    // starter home provisioner (app.js) so a hand-seeded starter rock gets the
    // exact odds a real residential deposit gets, and exported for the
    // headless tests that pin those odds.
    rollSurfaceRockTier, SURFACE_PLAIN_ROCK_P: caveRockP(0),
    // Per-class road width — the road-geometry overlay strokes with it.
    roadWidthM,
    // …and the width it actually COVERS, large-tier weighting included. The
    // overlay strokes with this and rasterizeTile stamps roadMask with it, so
    // "drawn as road" and "no spawns here" are the same number.
    roadOverlayWidthM,
    // The road-class Sets classifyLine keys off — exported so road_overlay.js
    // draws exactly the classes the terrain classifier treats as ROAD_LG/PATH,
    // instead of hand-copying the lists.
    LARGE_ROAD_CLASSES, PATH_CLASSES,
    // `${Z}/${tx}/${ty}` — the tile cache key, built in one place so every
    // caller (this file, app.js, render.js, …) spells it the same way.
    tileKey,
    // Live Overpass decoration (ON by default): fills tiles outside the static
    // satextract bbox with OSM features queried at request time, cached per
    // tile in IndexedDB. Opt out with setOverpassLive(false) or ?overpass=off.
    setOverpassLive: (b) => { _overpassLive = !!b; },
    warmOverpass,        // schedule Overpass fetch for one tile (centre only)
    overpassTileInfo,   // one-line status for a tile, surfaced in TILE DEBUG
  };
})(window);
