// Schoolyard games use one flag per connected field, across loaded tile seams.
(function (root) {
  'use strict';
  const scans = new WeakMap(), states = new WeakMap();
  const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const key = c => `${c.cellIX},${c.cellIY}`;

  function regions(scene, entries) {
    const W = root.WorldGen, cells = new Map();
    for (const [tileKey, entry] of entries) {
      const [, tx, ty] = tileKey.split('/').map(Number);
      let scan = scans.get(entry);
      if (!scan || scan.grid !== entry.grid) {
        const indices = [];
        for (let i = 0; i < entry.grid.length; i++) if (entry.grid[i] === W.T.SCHOOL) indices.push(i);
        scans.set(entry, scan = { grid: entry.grid, indices });
      }
      for (const i of scan.indices) {
        const ix = i % entry.cellsPerEdge, iy = Math.floor(i / entry.cellsPerEdge);
        const c = { ...tileCellToAbs(scene, tx, ty, ix, iy), tx, ty, ix, iy, entry };
        cells.set(key(c), c);
      }
    }
    const result = [], unseen = new Set(cells.keys());
    for (const seed of cells.values()) {
      if (!unseen.delete(key(seed))) continue;
      const group = [seed];
      let complete = true;
      for (let i = 0; i < group.length; i++) {
        const c = group[i];
        for (const [dx, dy] of directions) {
          const next = absCellOffset(scene, c.cellIX, c.cellIY, dx, dy), k = key(next);
          if (unseen.delete(k)) group.push(cells.get(k));
          if (!cells.has(k)) {
            const t = absCellToTile(scene, next.cellIX, next.cellIY);
            if (!W.tileCache.get(W.tileKey(t.tx, t.ty))?._spawned) complete = false;
          }
        }
      }
      if (!complete || group.length < 9) continue;
      const cx = group.reduce((sum, c) => sum + c.cellIX, 0) / group.length;
      const cy = group.reduce((sum, c) => sum + c.cellIY, 0) / group.length;
      const stable = group.slice().sort((a, b) => a.cellIY - b.cellIY || a.cellIX - b.cellIX)[0];
      group.sort((a, b) => (a.cellIX - cx) ** 2 + (a.cellIY - cy) ** 2
        - (b.cellIX - cx) ** 2 - (b.cellIY - cy) ** 2 || a.cellIY - b.cellIY || a.cellIX - b.cellIX);
      result.push({ id: `schoolyard:${stable.tx}:${stable.ty}:${stable.ix}:${stable.iy}`, group, cells });
    }
    return result;
  }

  function fields(scene) {
    if (scene.depth !== 0) return [];
    const W = root.WorldGen, size = root.SchoolyardGame.SPEC.size, radius = Math.floor(size / 2);
    const entries = [...W.tileCache].filter(([, e]) => e._spawned && e.grid);
    let state = states.get(scene);
    if (!state || entries.length !== state.entries.length || entries.some(([k, e], i) =>
      k !== state.entries[i][0] || e !== state.entries[i][1] || e.grid !== state.grids[i])) {
      state = { entries, grids: entries.map(([, e]) => e.grid), regions: regions(scene, entries),
        centers: state?.centers || new Map() };
      state.fieldCells = new Set();
      state.bounds = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
      for (const region of state.regions) for (const cell of region.group) {
        state.fieldCells.add(key(cell));
        const p = absCellCenterMeters(scene, cell.cellIX, cell.cellIY);
        const half = rowCellM(scene, cell.ty) / 2, b = state.bounds;
        b.x0 = Math.min(b.x0, p.x - half); b.x1 = Math.max(b.x1, p.x + half);
        b.y0 = Math.min(b.y0, p.y - half); b.y1 = Math.max(b.y1, p.y + half);
      }
      states.set(scene, state);
    }
    // Most loaded neighbourhoods contain no complete school field. Check
    // after refreshing regions so a newly loaded field still appears, but
    // before expanding every object's footprint for the occupancy scan.
    if (!state.regions.length) return [];
    const occupied = new Set();
    const mark = o => {
      if (!o || !Number.isFinite(o.x) || !Number.isFinite(o.y)) return;
      const declaration = o._footprintCells || o.footprintCells;
      const width = Math.max(1, Math.floor(declaration?.width || 1));
      const height = Math.max(1, Math.floor(declaration?.height || 1));
      if (width === 1 && height === 1) {
        // One-cell objects cannot overlap a field unless their anchor lies
        // in its world bounds. Keep the exact cell test for gaps and seams.
        const b = state.bounds;
        if (o.x < b.x0 || o.x > b.x1 || o.y < b.y0 || o.y > b.y1) return;
        const k = key(worldMetersToAbsCell(scene, o.x, o.y));
        if (state.fieldCells.has(k)) occupied.add(k);
        return;
      }
      // A large footprint can reach the field from an adjacent tile or row;
      // retain the canonical expansion instead of culling by its anchor.
      for (const c of root.SpawnOwnership.footprintCells(scene, o)) {
        const k = key(c);
        if (state.fieldCells.has(k)) occupied.add(k);
      }
    };
    for (const [, e] of entries) {
      for (const list of ['objects', 'wildplants', 'extraTreasures', 'parkingTreasures']) (e[list] || []).forEach(mark);
      mark(e.treasure);
    }
    for (const list of ['planted', 'fruittrees', 'fires', 'scarecrows', 'barricades'])
      for (const o of scene.save?.[list] || []) if ((o.depth || 0) === 0) mark(o);
    for (const list of ['tilled', 'placedRocks'])
      for (const cell of scene.save?.[list] || []) occupied.add(cell.replace('_', ','));
    const safe = c => c && c.entry.grid[c.iy * c.entry.cellsPerEdge + c.ix] === W.T.SCHOOL
      && !occupied.has(key(c)) && !W.privateVetoAt(c.tx, c.ty, c.ix, c.iy)
      && W.isSpawnCell(c.entry.grid, c.entry.cellsPerEdge, c.entry.cellsPerEdge, c.ix, c.iy,
        W.spawnOptsOf(c.entry), 'reward');
    const result = [];
    for (const region of state.regions) {
      // Remember the chosen center: planting beside a flag cannot move it.
      let center = state.centers.get(region.id);
      if (center) center = region.cells.get(key(center));
      if (!center) {
        center = region.group.find(safe);
        if (center) state.centers.set(region.id, center);
      }
      if (!safe(center)) continue;
      const board = new Map();
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const c = absCellOffset(scene, center.cellIX, center.cellIY, x - radius, y - radius);
        if (safe(region.cells.get(key(c)))) board.set(`${x},${y}`, { ...c, x, y });
      }
      const centerKey = `${radius},${radius}`;
      const reachable = [board.get(centerKey)], seen = new Set([centerKey]);
      for (let i = 0; i < reachable.length; i++) {
        const c = reachable[i];
        for (const [dx, dy] of directions) {
          const k = `${c.x + dx},${c.y + dy}`;
          if (!seen.has(k) && board.has(k)) { seen.add(k); reachable.push(board.get(k)); }
        }
      }
      if (reachable.length >= 9) result.push({ id: region.id, cellIX: center.cellIX, cellIY: center.cellIY, cells: reachable });
    }
    return result;
  }
  root.SchoolyardFields = { fields };
})(typeof globalThis !== 'undefined' ? globalThis : this);
