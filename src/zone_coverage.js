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
  function* buildSteps({ field, poiLayer, parks, tx, ty, N, chests, tileEdgeM, grid }) {
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
    const unit = EXT / N, margin = Z.FRINGE_FILL_M / (N * WG.CELL_M / EXT);
    const associated = [];
    for (const park of parks || []) {
      if (park.cemetery) continue;
      const a = sorted.find(a => a.kind === 'grove' && contains(park.rings, a.gx - tx * EXT, a.gy - ty * EXT));
      if (!a) continue;
      const g = geometry(park);
      associated.push({ a, g });
      const slot = slotFor(a), mask = yield* parkMask(g, N, unit, margin);
      for (let y = 0; y < N; y++) {
        if ((y & 31) === 0) yield 'zone coverage union';
        for (let x = 0; x < N; x++) {
          const i = y * N + x;
          if (!mask[i] || (f.idx && f.idx[i])) continue;
          const b = coverage[i] && f.anchors[coverage[i] - 1];
          if (b && (b.gy < a.gy || (b.gy === a.gy && b.gx <= a.gx))) continue;
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
      if (!a.owned || !(tileEdgeM > 0) || !grid) continue;
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
    f.coverage = coverage;
    return f;
  }
  // Zone ground owns the full placement union, while built structures and
  // transport surfaces retain their visible footprint. The old land remains
  // available to trap-ground rules through the existing underlay ledger.
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
        if (WG.isRoadTerrain(here) || WG.isBuildingTerrain(here) || !WG.isWalkable(here) || here === T.PIER) continue;
        if (here === T.PATH) {
          const key = `${x}_${y}`;
          if (pathUnder && pathUnder[key] != null) {
            const land = pathUnder[key];
            if (WG.isWalkable(land) && !WG.isRoadTerrain(land) && !WG.isBuildingTerrain(land) && land !== T.PIER) pathUnder[key] = code;
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
  root.ZoneCoverage = { buildSteps, paintSteps };
})(typeof window !== 'undefined' ? window : globalThis);
