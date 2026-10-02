// One winner per cell across influence, associated park and its placement fringe.
(function (root) {
  'use strict';
  const EXT = 4096;
  function contains(rings, x, y) {
    let inside = false;
    for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }
  function geometry(park) {
    const edges = [];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const ring of park.rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      x0 = Math.min(x0, a.x); y0 = Math.min(y0, a.y);
      x1 = Math.max(x1, a.x); y1 = Math.max(y1, a.y);
      edges.push([a, b]);
    }
    return { edges, x0, y0, x1, y1 };
  }
  // Scanline fill reads each edge once per row, rather than twice per cell.
  // Fringe checks visit only the small strip around an edge, even on long
  // diagonals. Holes use the same even/odd rule as the source polygons.
  function* parkMask(g, N, unit, margin) {
    const mask = new Uint8Array(N * N);
    for (let y = Math.max(0, Math.ceil(g.y0 / unit - .5)); y <= Math.min(N - 1, Math.floor(g.y1 / unit - .5)); y++) {
      if ((y & 15) === 0) yield 'zone coverage fill';
      const py = (y + .5) * unit, crossings = [];
      for (const [a, b] of g.edges) if ((a.y > py) !== (b.y > py)) crossings.push((b.x - a.x) * (py - a.y) / (b.y - a.y) + a.x);
      crossings.sort((a, b) => a - b);
      for (let k = 0; k + 1 < crossings.length; k += 2) {
        const from = Math.max(0, Math.ceil(crossings[k] / unit - .5));
        const to = Math.min(N, Math.ceil(crossings[k + 1] / unit - .5));
        if (to > from) mask.fill(1, y * N + from, y * N + to);
      }
    }
    let edgeIndex = 0;
    for (const [a, b] of g.edges) {
      if ((edgeIndex++ & 63) === 0) yield 'zone coverage fringe';
      const dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy;
      const y0 = Math.max(0, Math.ceil((Math.min(a.y, b.y) - margin) / unit - .5));
      const y1 = Math.min(N - 1, Math.floor((Math.max(a.y, b.y) + margin) / unit - .5));
      for (let y = y0; y <= y1; y++) {
        if ((y & 63) === 0) yield 'zone coverage edge rows';
        const py = (y + .5) * unit;
        let lo = 0, hi = 1;
        if (dy) {
          const ta = (py - margin - a.y) / dy, tb = (py + margin - a.y) / dy;
          lo = Math.max(0, Math.min(ta, tb)); hi = Math.min(1, Math.max(ta, tb));
        }
        if (lo > hi) continue;
        const left = Math.min(a.x + lo * dx, a.x + hi * dx) - margin;
        const right = Math.max(a.x + lo * dx, a.x + hi * dx) + margin;
        for (let x = Math.max(0, Math.ceil(left / unit - .5)); x <= Math.min(N - 1, Math.floor(right / unit - .5)); x++) {
          const i = y * N + x;
          if (mask[i]) continue;
          const px = (x + .5) * unit;
          const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / (d2 || 1)));
          if ((px - a.x - t * dx) ** 2 + (py - a.y - t * dy) ** 2 <= margin * margin) mask[i] = 1;
        }
      }
    }
    return mask;
  }
  // Use buffered source geometry at the canonical POI, never the visible
  // sand centroid. Local -Y is the landward approach used by shrine layouts.
  function* orientBeachesSteps(anchors, waterLayer, tx, ty) {
    const scale = EXT / (waterLayer?.extent || EXT);
    for (const a of anchors) {
      if (a.kind !== 'beach') continue;
      let best = null, distance = Infinity, scanned = 0;
      for (const f of waterLayer?.features || []) {
        if (f.type !== 3 || !f.geom || (root.Scenic && !root.Scenic.isShoreWater(f.tags))) continue;
        for (const ring of f.geom) for (let j = 0, k = ring.length - 1; j < ring.length; k = j++) {
          if ((scanned++ & 255) === 0) yield 'beach shoreline orientation';
          const p = ring[k], q = ring[j];
          // Polygon clipping closes water rings along the tile/buffer box.
          // Those axis-aligned outside edges are not shoreline evidence.
          if ((p.x === q.x && (p.x * scale <= 0 || p.x * scale >= EXT))
              || (p.y === q.y && (p.y * scale <= 0 || p.y * scale >= EXT))) continue;
          const x = tx * EXT + p.x * scale, y = ty * EXT + p.y * scale;
          const dx = (q.x - p.x) * scale, dy = (q.y - p.y) * scale;
          const length2 = dx * dx + dy * dy;
          if (!length2) continue;
          const t = Math.max(0, Math.min(1, ((a.gx - x) * dx + (a.gy - y) * dy) / length2));
          const px = x + t * dx, py = y + t * dy;
          const d = (a.gx - px) ** 2 + (a.gy - py) ** 2;
          // A neighbouring tile may clip away the perpendicular projection.
          // Follow the genuine shore's normal, never the clipped endpoint's
          // diagonal toward the POI. Ring winding cannot change this normal.
          const side = Math.sign(-dy * (a.gx - x) + dx * (a.gy - y));
          const length = Math.sqrt(length2), nx = -dy * side / length, ny = dx * side / length;
          // Equal distances are resolved in world space, independent of ring
          // direction, feature ordering and neighbouring tile coordinates.
          if (d < distance || (d === distance && best && (py < best.y || (py === best.y
              && (px < best.x || (px === best.x && (ny < best.ny || (ny === best.ny && nx < best.nx)))))))) {
            distance = d; best = { x: px, y: py, nx, ny };
          }
        }
      }
      if (best && distance > 0 && (best.nx || best.ny)) {
        const angle = Math.atan2(best.ny, best.nx);
        a.rotation = ((Math.round((angle + Math.PI / 2) / (Math.PI / 2)) % 4) + 4) % 4;
        a.orientationSource = 'shoreline';
      } else {
        // Missing/ambiguous geometry (including only clip-box edges or a
        // POI exactly on the shore line) keeps the identity-derived frame and is
        // explicit in map-review data; it must not invent a water direction.
        a.orientationSource = 'unresolved';
      }
    }
  }
  function* buildSteps({ field, poiLayer, parks, beachLayer, waterLayer, tx, ty, N, chests, tileEdgeM, grid }) {
    const Z = root.Zones, V = root.ZoneVariants, WG = root.WorldGen;
    const all = field && field.allAnchors || Z.resolveAnchors(Z.collectAnchors(poiLayer, tx, ty), { ty, N });
    if (!field && !all.length) return null;
    const f = field || { anchors: [], idx: null, s: null, reach: [] };
    const coverage = new Uint16Array(N * N);
    if (f.idx) coverage.set(f.idx);
    const key = a => `${a.kind}|${a.gx}|${a.gy}`;
    const slots = new Map(f.anchors.map((a, i) => [key(a), i + 1]));
    const slotFor = a => {
      if (!slots.has(key(a))) { f.anchors.push(a); slots.set(key(a), f.anchors.length); }
      return slots.get(key(a));
    };
    for (const a of all) a.variant = V.pick(a).id;
    for (const a of f.anchors) a.variant = V.pick(a).id;
    const sorted = all.slice().sort((a, b) => a.gy - b.gy || a.gx - b.gx || a.code - b.code);
    const sourceLand = i => grid && Z.landAt(grid, f.under, i);
    // Beach identity comes from the canonical POI, never an observer's clipped
    // sand patch. Its dry footprint is refined below; ordinary groves leave sand.
    if (grid) for (let i = 0; i < coverage.length; i++) {
      if (i % (N * 16) === 0) yield 'zone coverage shore eligibility';
      const a = f.anchors[coverage[i] - 1];
      if (a && (a.kind === 'beach' || (a.kind === 'grove' && sourceLand(i) === WG.T.SAND))) coverage[i] = 0;
    }
    const unit = EXT / N, margin = Z.FRINGE_FILL_M / (N * WG.CELL_M / EXT);
    // Polygon evidence refines coverage, never the canonical park anchor.
    // A companion's identity and pattern depend only on that existing POI;
    // clipped beaches cannot change the inland grove or create another POI.
    const shore = new Uint8Array(N * N);
    for (const feature of beachLayer?.features || []) {
      if (feature.type !== 3 || !feature.geom || Z.anchorOf(feature.tags)?.kind !== 'beach') continue;
      const mask = yield* parkMask(geometry({ rings: feature.geom }), N, unit, 0);
      for (let i = 0; i < shore.length; i++) {
        if (i % (N * 32) === 0) yield 'mapped beach union';
        if (mask[i]) shore[i] = 1;
      }
    }
    const companions = new Map();
    const shoreFor = a => {
      if (!companions.has(key(a))) {
        const beach = { ...a, kind: 'beach', code: Z.ZONE_KINDS.beach.code,
          R: Z.radiusFor('beach', 0), q: 0, aspect: 'tree_ring',
          parkShore: true };
        delete beach.variant; delete beach.character;
        beach.variant = V.pick(beach).id;
        companions.set(key(a), beach);
      }
      return companions.get(key(a));
    };
    const associated = [];
    for (const park of parks || []) {
      if (park.cemetery) continue;
      const inPark = a => contains(park.rings, a.gx - tx * EXT, a.gy - ty * EXT);
      const a = sorted.find(a => a.kind === 'beach' && inPark(a))
        || sorted.find(a => a.kind === 'grove' && inPark(a));
      if (!a) continue;
      const g = geometry(park);
      associated.push({ a, g });
      const slot = slotFor(a), mask = yield* parkMask(g, N, unit, margin);
      for (let y = 0; y < N; y++) {
        if ((y & 31) === 0) yield 'zone coverage union';
        for (let x = 0; x < N; x++) {
          const i = y * N + x;
          if (!mask[i]) continue;
          const land = sourceLand(i);
          const beach = grid && a.kind === 'grove' && shore[i]
            && [WG.T.SAND, WG.T.PARK, WG.T.GRASS, WG.T.FOREST, WG.T.GROVE].includes(land) ? shoreFor(a) : null;
          if (beach) {
            const previous = coverage[i] && f.anchors[coverage[i] - 1];
            if (!previous || previous.kind === 'grove' || (previous.parkShore
                && (a.gy < previous.gy || (a.gy === previous.gy && a.gx < previous.gx)))) {
              coverage[i] = slotFor(beach);
            }
            continue;
          }
          if (grid && a.kind === 'grove' && land === WG.T.SAND) continue;
          if (grid && a.kind === 'beach' && ![WG.T.SAND, WG.T.PARK, WG.T.GRASS, WG.T.FOREST, WG.T.GROVE].includes(land)) continue;
          const current = coverage[i] && f.anchors[coverage[i] - 1];
          if (f.idx && f.idx[i] && current && !(a.kind === 'beach' && (land === WG.T.SAND || current.kind === 'grove'))) continue;
          const b = coverage[i] && f.anchors[coverage[i] - 1];
          if (b && !(a.kind === 'beach' && b.kind === 'grove')
              && (b.gy < a.gy || (b.gy === a.gy && b.gx <= a.gx))) continue;
          coverage[i] = slot;
        }
      }
    }
    // Sand under a tagged beach's stable influence belongs to that beach,
    // even when a stronger grove field overlaps it. No anchor is minted from
    // local geometry, and unanchored shores receive no finite encounter.
    if (grid) for (const a of sorted.filter(a => a.kind === 'beach')) {
      const slot = slotFor(a), lx = a.gx - tx * EXT, ly = a.gy - ty * EXT;
      const r = a.R * (1 + Z.EDGE_JITTER) / a.upm;
      for (let y = Math.max(0, Math.floor((ly - r) / unit)); y <= Math.min(N - 1, Math.floor((ly + r) / unit)); y++) {
        if ((y & 15) === 0) yield 'beach coverage';
        for (let x = Math.max(0, Math.floor((lx - r) / unit)); x <= Math.min(N - 1, Math.floor((lx + r) / unit)); x++) {
          const i = y * N + x;
          if (sourceLand(i) !== WG.T.SAND) continue;
          const gx = tx * EXT + (x + .5) * unit, gy = ty * EXT + (y + .5) * unit;
          if (Math.hypot(gx - a.gx, gy - a.gy) * a.upm > Z.edgeAt(a, gx, gy)) continue;
          const old = f.anchors[coverage[i] - 1];
          if (old && old.kind === 'beach' && (old.gy < a.gy || (old.gy === a.gy && old.gx <= a.gx))) continue;
          coverage[i] = slot;
        }
      }
    }
    // A settled outdoor POI may phase its pattern only when all its possible
    // coverage is local. Across seams the source point remains canonical:
    // neighbouring tiles cannot know this tile's chest relocation.
    const chestAt = new Map((chests || []).filter(c => c.kind === 'chest' && c._poiAt).map(c => [c._poiAt, c]));
    for (const a of new Set([...all, ...f.anchors])) {
      delete a.originGX; delete a.originGY;
      if (a.parkShore || !a.owned || !(tileEdgeM > 0) || !grid) continue;
      const chest = chestAt.get(`${a.lx},${a.ly}`);
      if (!chest) continue;
      const lx = a.gx - tx * EXT, ly = a.gy - ty * EXT;
      if (WG.isBuildingTerrain(grid[Math.floor(ly / unit) * N + Math.floor(lx / unit)])) continue;
      const r = a.R * (1 + Z.EDGE_JITTER) / a.upm;
      if (!(r >= 0) || lx - r < 0 || ly - r < 0 || lx + r >= EXT || ly + r >= EXT) continue;
      if (associated.some(p => key(p.a) === key(a) &&
        (p.g.x0 - margin < 0 || p.g.y0 - margin < 0 || p.g.x1 + margin >= EXT || p.g.y1 + margin >= EXT))) continue;
      const cx = (chest.x / tileEdgeM - tx) * EXT, cy = (chest.y / tileEdgeM - ty) * EXT;
      if (cx < 0 || cy < 0 || cx >= EXT || cy >= EXT) continue;
      a.originGX = tx * EXT + cx; a.originGY = ty * EXT + cy;
    }
    yield* orientBeachesSteps(new Set([...all, ...f.anchors]), waterLayer, tx, ty);
    f.coverage = coverage;
    return f;
  }
  // Zone ground owns the full placement union, while built structures,
  // transport surfaces AND BEACH SAND retain their visible footprint (T.SAND
  // — a shore, never a zone's own ground: Scenic's shore-sand cells must keep
  // reading as sand, not a grove or churchyard — src/scenic.js's shoreSandSteps
  // comment on Zones.landAt, and the beach measured on Vancouver's Kits /
  // English Bay used to wear grove ground on ~3/4 of its dry sand before this
  // exclusion). The old land remains available to trap-ground rules through
  // the existing underlay ledger.
  function* paintSteps(field, grid, N, pathUnder, roadMask, spawnWhy) {
    if (!field || !field.coverage) return 0;
    const WG = root.WorldGen, T = WG.T, coverage = field.coverage;
    const codes = field.anchors.map(a => root.Zones.terrainOf(a.kind));
    const zoneGround = new Set(root.Zones.zoneTerrains());
    const under = field.under || (field.under = new Uint8Array(N * N));
    const present = under.present || (under.present = new Uint8Array(N * N));
    let painted = 0;
    for (let y = 0; y < N; y++) {
      if ((y & 31) === 0) yield 'zone ground rows';
      for (let x = 0; x < N; x++) {
        const i = y * N + x, code = codes[coverage[i] - 1], here = grid[i];
        // ALLOWLISTED raw roadMask read: terrain geometry preserves the visible
        // road band. The same footprint also keeps its existing spawn reasons.
        if (roadMask && roadMask[i]) {
          // Earlier halo/fringe passes may already have painted the band.
          // Restore their saved land, even outside this coverage winner.
          if (zoneGround.has(here)) grid[i] = root.Zones.landAt(grid, under, i);
          continue;
        }
        if (code == null) continue;
        if (WG.isRoadTerrain(here) || WG.isBuildingTerrain(here) || !WG.isWalkable(here) || here === T.PIER || here === T.SAND) continue;
        if (here === T.PATH) {
          const key = `${x}_${y}`;
          if (pathUnder && pathUnder[key] != null) {
            const land = pathUnder[key];
            if (WG.isWalkable(land) && !WG.isRoadTerrain(land) && !WG.isBuildingTerrain(land) && land !== T.PIER && land !== T.SAND) pathUnder[key] = code;
          }
          continue;
        }
        // The declared zone replaces generic lot zoning as well as its look.
        // Keep source-site restrictions, terrain and road reasons intact; only
        // frontage/back-yard inferences stop applying to this painted ground.
        // Do this even when an earlier halo already painted the winning code.
        if (spawnWhy) spawnWhy[i] &= ~(WG.SPAWN_WHY.PRIVATE | WG.SPAWN_WHY.BEHIND_HOUSE);
        if (here === code) continue;
        if (!under[i] && !present[i]) under[i] = here;
        present[i] = 1;
        grid[i] = code;
        painted++;
      }
    }
    return painted;
  }
  // Removed parking lanes remain map evidence. Nearby lane buffers merge into
  // one generated quarry footprint; they never return as roads or lamp sites.
  const QUARRY_BUFFER_M = root.Zones.ZONE_KINDS.quarry.R;
  function* quarrySteps({ field, parkingLanes, tx, ty, N, grid, roadMask, spawnWhy }) {
    if (!parkingLanes?.length) return field;
    const WG = root.WorldGen, Z = root.Zones;
    const mask = new Uint8Array(N * N), radius = QUARRY_BUFFER_M / WG.CELL_M;
    let segments = 0;
    for (const source of parkingLanes) {
      const scale = N / (source.extent || EXT);
      for (const line of source.lines || []) for (let j = 1; j < line.length; j++) {
        if ((segments++ & 31) === 0) yield 'quarry source segments';
        const a = line[j - 1], b = line[j];
        const ax = a.x * scale, ay = a.y * scale, bx = b.x * scale, by = b.y * scale;
        const dx = bx - ax, dy = by - ay, length2 = dx * dx + dy * dy;
        const y0 = Math.max(0, Math.ceil(Math.min(ay, by) - radius - .5));
        const y1 = Math.min(N - 1, Math.floor(Math.max(ay, by) + radius - .5));
        for (let y = y0; y <= y1; y++) {
          if ((y & 15) === 0) yield 'quarry buffer rows';
          const py = y + .5;
          // Slice a diagonal to this row before scanning its width.
          let lo = 0, hi = 1;
          if (dy) {
            const ta = (py - radius - ay) / dy, tb = (py + radius - ay) / dy;
            lo = Math.max(0, Math.min(ta, tb)); hi = Math.min(1, Math.max(ta, tb));
          }
          if (lo > hi) continue;
          const left = Math.min(ax + lo * dx, ax + hi * dx) - radius;
          const right = Math.max(ax + lo * dx, ax + hi * dx) + radius;
          for (let x = Math.max(0, Math.ceil(left - .5)); x <= Math.min(N - 1, Math.floor(right - .5)); x++) {
            const i = y * N + x;
            if (mask[i]) continue;
            const px = x + .5;
            const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (length2 || 1)));
            if ((px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2 <= radius * radius) mask[i] = 1;
          }
        }
      }
    }
    // As with ordinary zone painting, quarry ownership replaces inferred
    // frontage/back-yard rules, never actual terrain or protected-site gates.
    const why = spawnWhy && spawnWhy.map(bits => bits & ~(WG.SPAWN_WHY.PRIVATE | WG.SPAWN_WHY.BEHIND_HOUSE));
    const opts = { roadMask, spawnWhy: why };
    const eligible = i => !field?.coverage?.[i] && !field?.idx?.[i]
      && !WG.isRoadTerrain(grid[i]) && !WG.isBuildingTerrain(grid[i])
      && grid[i] !== WG.T.PATH && grid[i] !== WG.T.PIER && grid[i] !== WG.T.SAND
      && WG.isSpawnCell(grid, N, N, i % N, Math.floor(i / N), opts, 'minor');
    let result = field;
    for (let start = 0; start < mask.length; start++) {
      if ((start & 511) === 0) yield 'quarry components';
      if (mask[start] !== 1) continue;
      const queue = [start], cells = [];
      mask[start] = 2;
      for (let head = 0; head < queue.length; head++) {
        if ((head & 511) === 0) yield 'quarry component cells';
        const i = queue[head], x = i % N, y = Math.floor(i / N);
        if (eligible(i)) cells.push(i);
        // Eight neighbours merge touching buffers, including diagonal lanes.
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if ((!dx && !dy) || nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
          const next = ny * N + nx;
          if (mask[next] === 1) { mask[next] = 2; queue.push(next); }
        }
      }
      if (!cells.length) continue;
      if (!result) result = { anchors: [], allAnchors: [], reach: [] };
      if (!result.coverage) result.coverage = result.idx ? Uint16Array.from(result.idx) : new Uint16Array(N * N);
      if (!(result.idx instanceof Uint16Array)) result.idx = result.idx ? Uint16Array.from(result.idx) : new Uint16Array(N * N);
      if (!result.s) result.s = new Uint8Array(N * N);
      // Complete local components own one finite budget, without a synthetic
      // daily POI. Incomplete components retain cell-addressed scatter only.
      const first = cells.reduce((a, b) => Math.min(a, b));
      // Clipped source geometry cannot reveal the entire site's size or owner.
      // Border components use reward-free benches until a complete footprint
      // is available; never invent a second crater or duplicate finite finds.
      const clipped = queue.some(i => i % N === 0 || i % N === N - 1 || i < N || i >= N * (N - 1));
      const variants = root.ZoneVariants.forKind('quarry').map(v => v.id);
      const variantHash = (Math.imul(tx, 73856093) ^ Math.imul(ty, 19349663) ^ Math.imul(first, 83492791)) >>> 0;
      const requestedVariant = variants[variantHash % variants.length];
      const variant = clipped ? 'quarry-strip-mine'
        : yield* root.QuarryLayout.variantForSteps(cells, { N, tx, ty }, variantHash % variants.length);
      const lx = (first % N + .5) * EXT / N, ly = (Math.floor(first / N) + .5) * EXT / N;
      const gx = tx * EXT + lx, gy = ty * EXT + ly;
      const row = Z.ZONE_KINDS.quarry;
      const anchor = { kind: 'quarry', variant, aspect: 'quarry', generated: 'parking_lanes',
        clipped, requestedVariant: clipped ? undefined : requestedVariant,
        layoutFallback: clipped ? 'incomplete_source_footprint' : variant !== requestedVariant ? 'usable_footprint' : undefined,
        name: row.title, gx, gy, lx, ly, owned: !clipped, key: Z.anchorKey(gx, gy),
        code: row.code, R: QUARRY_BUFFER_M, upm: N * WG.CELL_M / EXT, q: 0 };
      result.anchors.push(anchor);
      if (result.allAnchors) result.allAnchors.push(anchor);
      const slot = result.anchors.length;
      for (const i of cells) {
        result.coverage[i] = slot; result.idx[i] = slot; result.s[i] = 255;
      }
    }
    return result;
  }

  root.ZoneCoverage = { orientBeachesSteps, buildSteps, paintSteps, quarrySteps, QUARRY_BUFFER_M };
})(typeof window !== 'undefined' ? window : globalThis);
