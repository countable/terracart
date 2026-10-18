// ─────────────────────────────────────────────────────────────────────────
// PlacedFloor — the ONE place "which level does this placed floor-tile thing
// belong to?" is answered.
//
// THE PROBLEM IT SOLVES:
//   The world is GPS-mirrored across levels: a surface cell and the cave cell
//   directly below it (scene.depth = 0 surface, 1+ underground) share the same
//   world (x, y). Anything the player drops on a cell — crops, scarecrows,
//   campfires, placed rocks — is stored by world coords, so without a per-level
//   tag it renders (and reacts) on EVERY level at once. This collects the
//   isolation rule in one spot so the next placeable can't re-introduce the leak.
//
// TWO IDIOMS, both live here:
//   • Depth-tagged objects (crops, scarecrows, fires): each stored object
//     carries a `depth` field stamped at placement time. `forDepth` / `onDepth`
//     keep the ones on the level being rendered/tapped. These work on ANY
//     level (a cave campfire is just as valid as a surface one).
//   • Surface-locked sets (placed rocks, tilling): these are stored as Sets of
//     bare "ix_iy" cell-key strings with no room for a per-item tag, and they
//     only ever exist on the surface. `isSurface(depth)` gates them.
//
// Untagged objects (no `depth` field) are surface: `?? 0`.
// ─────────────────────────────────────────────────────────────────────────
(function (root) {
  'use strict';

  // The level an object belongs to. Untagged (legacy) objects are surface (0).
  function placedDepth(item) { return (item && item.depth != null) ? item.depth : 0; }

  // Normalise a level value (scene.depth may be undefined very early).
  function levelOf(depth) { return depth != null ? depth : 0; }

  // Stamp the current level onto a freshly-placed object. Call at EVERY
  // placement site so the filters below can isolate it later. Returns the item
  // so callers can `arr.push(stampDepth({ x, y }, depth))`.
  function stampDepth(item, depth) { item.depth = levelOf(depth); return item; }

  // True when a single object belongs on the level currently in play.
  function onDepth(item, depth) { return placedDepth(item) === levelOf(depth); }

  // Filter an array of placed objects down to the current level.
  function forDepth(list, depth) {
    const d = levelOf(depth);
    return (list || []).filter((it) => placedDepth(it) === d);
  }

  // Gate for the surface-locked, Set-based interactables (placed rocks,
  // tilling) that can't carry a per-item depth tag.
  function isSurface(depth) { return levelOf(depth) === 0; }
  // Index of the first entry of `list` on `depth` within `eps` metres of
  // (x, y) on both axes, else -1. `eps` is the caller's question: half a cell
  // asks "is one on the tapped cell", a hair asks "is one on this exact spot".
  function indexAt(list, x, y, depth, eps) {
    if (!list) return -1;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (onDepth(e, depth) && Math.abs(e.x - x) < eps && Math.abs(e.y - y) < eps) return i;
    }
    return -1;
  }

  // Barricades use the existing wildplant art, damage, axe and fire rules.
  // Restore saved overlays after generated scenery and Home have settled.
  function restoreBarricades(scene, entry, tx, ty, depth = scene.depth) {
    const spent = spentSets(scene, scene.save);
    const owned = [];
    for (const b of scene.save.barricades || []) {
      if (!onDepth(b, depth) || Math.floor(b.x / scene.tileEdgeM) !== tx
          || Math.floor(b.y / scene.tileEdgeM) !== ty || isSpent(b, spent)) continue;
      entry.wildplants ||= [];
      if (!entry.wildplants.some(o => o.id === b.id)) entry.wildplants.push({ ...b });
      owned.push(b);
    }
    if (owned.length) SpawnOwnership.reconcileEntry(scene, entry, owned);
  }

  // The ownership grid, not a saved association or distance from Home, owns
  // indoor eligibility. The entry override is the tile currently reconciling.
  function homeCell(scene, x, y, depth = scene.depth, entry = null) {
    if (!isSurface(depth) || !scene.save.starterShopId) return false;
    const c = worldMetersToAbsCell(scene, x, y);
    const t = absCellToTile(scene, c.cellIX, c.cellIY);
    const e = entry || WorldGen.tileCache.get(WorldGen.tileKey(t.tx, t.ty));
    if (!e?.grid || !e.owners || !e.ownerKeys) return false;
    const i = t.iy * t.n + t.ix;
    const type = e.grid[i];
    return (type === WorldGen.T.BUILDING || type === WorldGen.T.BUILDING_MED
      || type === WorldGen.T.BUILDING_LARGE)
      && e.ownerKeys[e.owners[i]] === scene.save.starterShopId;
  }

  function furnitureIndoors(scene, record, entry = null) {
    const indoors = homeCell(scene, record.x, record.y, placedDepth(record), entry);
    record.houseKey = indoors ? scene.save.starterShopId : null;
    return indoors;
  }

  // Durable property joins the normal object stream, so walls, taps and
  // runtime spawn occupancy all see the same furniture after a tile rebuild.
  function restoreFurniture(scene, entry, tx, ty, depth = scene.depth) {
    const owned = [];
    for (const record of scene.save.furniture || []) {
      if (!onDepth(record, depth) || !furnitureSpec(record.itemId)
          || Math.floor(record.x / scene.tileEdgeM) !== tx
          || Math.floor(record.y / scene.tileEdgeM) !== ty) continue;
      furnitureIndoors(scene, record, entry);
      const object = { ...record, kind: 'furniture', placed: true, playerOwned: true,
        spawnCells: SpawnOwnership.tileCells(scene, entry, record, tx, ty) };
      entry.objects = (entry.objects || []).filter(o => o.id !== record.id);
      entry.objects.push(object);
      owned.push(object);
    }
    if (owned.length) SpawnOwnership.reconcileEntry(scene, entry, owned);
  }

  const api = { placedDepth, stampDepth, onDepth, forDepth, isSurface, indexAt, homeCell, furnitureIndoors, restoreBarricades, restoreFurniture };
  root.PlacedFloor = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
