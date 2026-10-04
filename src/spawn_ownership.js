// Saved placements are overlays on a deterministic generated world. Keep
// ownership and footprint checks in one place for Home and tile rebuilds.
(function (root) {
  'use strict';

  function savedIds(save) {
    const ids = new Set();
    if (!save) return ids;
    for (const rec of ((save.starterHome && save.starterHome.placed) || [])) if (rec.id) ids.add(rec.id);
    for (const rec of (save.fruittrees || [])) if (rec.id) ids.add(rec.id);
    if (save.starterTrailer && save.starterTrailer.id) ids.add(save.starterTrailer.id);
    return ids;
  }

  function isProtected(object, save, ids) {
    if (!object) return false;
    return !!(object.planted || object.placed || object.playerOwned ||
      (object.id && (ids || savedIds(save)).has(object.id)));
  }

  // The optional declaration describes cells centred on the object's anchor.
  // It is independent of sprite pixels and works across tile seams and rows.
  function footprintCells(scene, object) {
    const anchor = worldMetersToAbsCell(scene, object.x, object.y);
    const declaration = object._footprintCells || object.footprintCells || {};
    const width = Math.max(1, Math.floor(declaration.width || 1));
    const height = Math.max(1, Math.floor(declaration.height || 1));
    const out = [];
    const x0 = -Math.floor((width - 1) / 2), y0 = -Math.floor((height - 1) / 2);
    for (let dy = 0; dy < height; dy++) for (let dx = 0; dx < width; dx++) {
      out.push(absCellOffset(scene, anchor.cellIX, anchor.cellIY, x0 + dx, y0 + dy));
    }
    return out;
  }

  function overlaps(scene, a, b) {
    const cells = new Set(footprintCells(scene, a).map(c => `${c.cellIX},${c.cellIY}`));
    return footprintCells(scene, b).some(c => cells.has(`${c.cellIX},${c.cellIY}`));
  }

  const _tileScratch = {};
  function tileCells(scene, entry, object, tx, ty, cellsPerEdge) {
    const cells = [];
    const N = entry.cellsPerEdge || cellsPerEdge || scene.cellsPerTile ||
      (entry.grid && Math.sqrt(entry.grid.length));
    if (!N) return cells;
    if (!scene.originPx || !scene.startWorldM || !Number.isFinite(scene.mPerPx)) {
      const unit = scene.tileEdgeM / N;
      const declaration = object._footprintCells || object.footprintCells || {};
      const width = Math.max(1, Math.floor(declaration.width || 1));
      const height = Math.max(1, Math.floor(declaration.height || 1));
      const cx = Math.floor((object.x - tx * scene.tileEdgeM) / unit);
      const cy = Math.floor((object.y - ty * scene.tileEdgeM) / unit);
      const x0 = cx - Math.floor((width - 1) / 2);
      const y0 = cy - Math.floor((height - 1) / 2);
      for (let dy = 0; dy < height; dy++) for (let dx = 0; dx < width; dx++) {
        const x = x0 + dx, y = y0 + dy;
        if (x >= 0 && x < N && y >= 0 && y < N) cells.push(y * N + x);
      }
      return cells;
    }
    const declaration = object._footprintCells || object.footprintCells;
    if (!declaration || (Math.max(1, Math.floor(declaration.width || 1)) === 1
        && Math.max(1, Math.floor(declaration.height || 1)) === 1)) {
      // One cell — the anchor's own (footprintCells' single offset is 0, 0,
      // which absCellOffset hands back unchanged). The spawn pass asks this
      // for every generated object and plant on a tile, thousands of times.
      const a = worldMetersToAbsCell(scene, object.x, object.y);
      const t = absCellToTile(scene, a.cellIX, a.cellIY, _tileScratch);
      if (t.tx === tx && t.ty === ty) cells.push(t.iy * N + t.ix);
      return cells;
    }
    for (const c of footprintCells(scene, object)) {
      const t = absCellToTile(scene, c.cellIX, c.cellIY);
      if (t.tx === tx && t.ty === ty) cells.push(t.iy * N + t.ix);
    }
    return cells;
  }

  // Filter live streams only. genObjects is the generated snapshot used by
  // rebuild/reconciliation and must remain unchanged.
  function reconcileEntry(scene, entry, protectedObjects) {
    const ids = savedIds(scene.save);
    const claims = (protectedObjects || []).filter(o => o && Number.isFinite(o.x) && Number.isFinite(o.y));
    if (!claims.length) return;
    // Resolve each footprint once. Comparing every object with every saved
    // claim repeatedly projected the same cells during background tile loads.
    const owners = new Map();
    for (const claim of claims) for (const cell of footprintCells(scene, claim)) {
      const key = `${cell.cellIX},${cell.cellIY}`;
      if (!owners.has(key)) owners.set(key, new Set());
      owners.get(key).add(claim.id);
    }
    const keep = (o) => {
      if (isProtected(o, scene.save, ids)) return true;
      return !footprintCells(scene, o).some(cell => {
        const claimed = owners.get(`${cell.cellIX},${cell.cellIY}`);
        return claimed && (claimed.size > 1 || !claimed.has(o.id));
      });
    };
    if (entry.objects) entry.objects = entry.objects.filter(keep);
    if (entry.wildplants) entry.wildplants = entry.wildplants.filter(keep);
  }

  root.SpawnOwnership = { savedIds, isProtected, footprintCells, tileCells, overlaps, reconcileEntry };
})(typeof window !== 'undefined' ? window : globalThis);
