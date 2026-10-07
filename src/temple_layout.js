// Upper temple rooms occupy an unobstructed square around their grove nexus.
(function (root) {
  'use strict';
  const SEARCH_RADIUS = 4;
  function hash(text) {
    let n = 2166136261;
    for (const c of String(text)) n = Math.imul(n ^ c.charCodeAt(0), 16777619);
    return n >>> 0;
  }
  function plan(temple, cache, tileEdgeM) {
    const anchor = temple.templeAnchor, key = root.Temples.zoneKey(temple);
    if (anchor?.kind !== 'grove' || !Number.isFinite(anchor.gx) || !Number.isFinite(anchor.gy)) return null;
    const tx = Math.floor(anchor.gx / 4096), ty = Math.floor(anchor.gy / 4096);
    const entry = cache.get(root.WorldGen.tileKey(tx, ty));
    if (entry?.status !== 'ready' || !entry.cellsPerEdge) return null;
    const N = entry.cellsPerEdge, cellM = tileEdgeM / N;
    const cx = tx * tileEdgeM + (Math.floor((anchor.gx / 4096 - tx) * N) + .5) * cellM;
    const cy = ty * tileEdgeM + (Math.floor((anchor.gy / 4096 - ty) * N) + .5) * cellM;
    // Inspect every underlying cell, including finer cells across a tile-row
    // seam. A missing tile cannot establish that a room is clear.
    function fits(x, y, size) {
      const right = x + size * cellM, bottom = y + size * cellM;
      for (let row = Math.floor(y / tileEdgeM); row <= Math.floor((bottom - 1e-7) / tileEdgeM); row++) {
        for (let col = Math.floor(x / tileEdgeM); col <= Math.floor((right - 1e-7) / tileEdgeM); col++) {
          const e = cache.get(root.WorldGen.tileKey(col, row)), n = e?.cellsPerEdge;
          if (e?.status !== 'ready' || !n || !e.grid) return false;
          const unit = tileEdgeM / n, mask = e.zone?.coverage || e.zone?.idx;
          const x0 = Math.max(0, Math.floor((x - col * tileEdgeM) / unit + 1e-9));
          const y0 = Math.max(0, Math.floor((y - row * tileEdgeM) / unit + 1e-9));
          const x1 = Math.min(n - 1, Math.ceil((right - col * tileEdgeM) / unit - 1e-9) - 1);
          const y1 = Math.min(n - 1, Math.ceil((bottom - row * tileEdgeM) / unit - 1e-9) - 1);
          for (let iy = y0; iy <= y1; iy++) for (let ix = x0; ix <= x1; ix++) {
            const i = iy * n + ix, owner = e.zone?.anchors?.[mask?.[i] - 1];
            if (owner?.kind !== 'grove' || String(owner.key) !== String(key)
                || e.owners?.[i] || e.roadMask?.[i]
                || root.WorldGen.isBuildingTerrain(e.grid[i])
                || root.WorldGen.isCobbleTerrain(e.grid[i])
                || !root.WorldGen.isSpawnCell(e.grid, n, n, ix, iy,
                  { roadMask: e.roadMask, spawnWhy: e.spawnWhy }, 'reward')) return false;
          }
        }
      }
      return true;
    }
    const offsets = [];
    for (let dy = -SEARCH_RADIUS; dy <= SEARCH_RADIUS; dy++) for (let dx = -SEARCH_RADIUS; dx <= SEARCH_RADIUS; dx++) offsets.push({ dx, dy });
    offsets.sort((a, b) => a.dx * a.dx + a.dy * a.dy - b.dx * b.dx - b.dy * b.dy || a.dy - b.dy || a.dx - b.dx);
    const seats = new Map();
    const seed = hash(key);
    const candidates = root.TemplePuzzles.KINDS.map(kind => {
      const [min, max] = root.TemplePuzzles.SIZE_RANGES[kind];
      const sizes = Array.from({ length: max - min + 1 }, (_, i) => min + i)
        .sort((a, b) => Math.abs(a - 7) - Math.abs(b - 7) || b - a);
      for (const size of sizes) {
        if (!seats.has(size)) {
          let seat = null;
          for (const { dx, dy } of offsets) {
            const x = cx + (dx - Math.floor(size / 2) - .5) * cellM;
            const y = cy + (dy - Math.floor(size / 2) - .5) * cellM;
            if (fits(x, y, size)) { seat = { x, y, size, cellM }; break; }
          }
          seats.set(size, seat);
        }
        if (seats.get(size)) return { ...seats.get(size), kind, seed, zoneKey: key };
      }
      return null;
    }).filter(Boolean);
    return candidates.length ? candidates[seed % candidates.length] : null;
  }
  root.TempleLayout = { plan, SEARCH_RADIUS };
})(typeof globalThis !== 'undefined' ? globalThis : this);
