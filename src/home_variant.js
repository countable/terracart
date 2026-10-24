// Home is a player's surface overlay, never an input to shared world generation.
(function (root) {
  'use strict';
  const RADIUS_M = 50;
  function anchor(scene) {
    if (root.FloorSandbox?.isScenario()) return null;
    if ((scene?.depth || 0) !== 0) return null;
    // The projection origin exists before Home is placed. Only the frozen
    // starter anchor authorizes this player's surface overlay.
    const p = scene?.save?.starterCratesAt;
    return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null;
  }
  function contains(scene, x, y) {
    const p = anchor(scene);
    return !!p && Number.isFinite(x) && Number.isFinite(y)
      && (x - p.x) ** 2 + (y - p.y) ** 2 <= RADIUS_M ** 2;
  }
  function isCurated(scene, object, saved) {
    if (!object) return false;
    if (root.SpawnOwnership?.isProtected(object, scene.save, saved) || object.pet || object.summoned || root.SpriteLayout?.isSummoned(object.kind)) return true;
    const id = String(object.id || '');
    if (scene.save?.starterHome?.tamed?.includes(id)) return true;
    if (/^(starter_|chest_start_|stash_start_|stash_pile_|homeup_)/.test(id) || object._homeFootprint) return true;
    if (/_greeter_-?\d+_-?\d+$/.test(id)) return true;
    // Story neighbours are deliberately seated by Starter, unlike generic NPCs.
    if (object.kind === 'npc' && Object.keys(typeof NPC !== 'undefined' ? NPC.STORY_ROLES : {}).some(role => id.startsWith(`npc_${role}_`))) return true;
    // Mapped structures retain their geometry and entrances. Authored Nexus
    // buildings carry provenance and must yield with the rest of that theme.
    return (object.kind === 'house' || object.kind === 'tower') && !object.zoneVariant && !object._street;
  }
  function discardedAt(scene, x, y) {
    if ((scene?.depth || 0) !== 0 || !(scene?.tileEdgeM > 0)) return false;
    const edge = scene.tileEdgeM, tx = Math.floor(x / edge), ty = Math.floor(y / edge);
    const entry = root.WorldGen.tileCache.get(root.WorldGen.tileKey(tx, ty));
    if (!entry?.variantDiscarded) return false;
    const N = entry.cellsPerEdge;
    const ix = Math.floor((x / edge - tx) * N), iy = Math.floor((y / edge - ty) * N);
    return !!entry.variantDiscarded[iy * N + ix];
  }
  function allows(scene, object, x = object?.x, y = object?.y) {
    return !object || !(contains(scene, x, y) || discardedAt(scene, x, y)) || isCurated(scene, object);
  }
  function overlaps(scene, entry, object, tx, ty, mask) {
    if (!object || !Number.isFinite(object.x) || !Number.isFinite(object.y)) return false;
    if (contains(scene, object.x, object.y)) return true;
    const declaration = object._footprintCells || object.footprintCells || {};
    const reach = Math.max(declaration.width || 1, declaration.height || 1) * scene.tileEdgeM / entry.cellsPerEdge;
    const home = anchor(scene);
    if (Math.hypot(object.x - home.x, object.y - home.y) > RADIUS_M + reach) return false;
    const ownership = root.SpawnOwnership;
    if (ownership?.tileCells(scene, entry, object, tx, ty).some(i => mask[i])) return true;
    // A footprint can cross the tile seam into Home even when its anchor's
    // tile has no Home cell. Resolve the complete footprint in that case.
    if (scene.originPx && Number.isFinite(scene.mPerPx) && ownership
        && typeof absCellCenterMeters === 'function') {
      return ownership.footprintCells(scene, object).some(c => {
        const p = absCellCenterMeters(scene, c.cellIX, c.cellIY);
        return contains(scene, p.x, p.y);
      });
    }
    const d = object._footprintCells || object.footprintCells || {};
    const w = Math.max(1, Math.floor(d.width || 1)), h = Math.max(1, Math.floor(d.height || 1));
    const unit = scene.tileEdgeM / entry.cellsPerEdge;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (contains(scene, object.x + (x - Math.floor((w - 1) / 2)) * unit,
        object.y + (y - Math.floor((h - 1) / 2)) * unit)) return true;
    }
    return false;
  }
  function apply(scene, entry, tx, ty, { phase = 'final' } = {}) {
    const home = anchor(scene);
    if (!home || !entry?.grid || (entry.depth != null && entry.depth !== 0)) return false;
    const N = entry.cellsPerEdge, unit = scene.tileEdgeM / N;
    if (!(N > 0) || !(unit > 0)) return false;
    const nearestX = Math.max(tx * scene.tileEdgeM, Math.min(home.x, (tx + 1) * scene.tileEdgeM));
    const nearestY = Math.max(ty * scene.tileEdgeM, Math.min(home.y, (ty + 1) * scene.tileEdgeM));
    const intersects = (nearestX - home.x) ** 2 + (nearestY - home.y) ** 2 <= RADIUS_M ** 2;
    const mask = new Uint8Array(intersects ? N * N : 0);
    for (let i = 0; i < mask.length; i++) {
      mask[i] = contains(scene, (tx * N + i % N + .5) * unit,
        (ty * N + Math.floor(i / N) + .5) * unit) ? 1 : 0;
    }
    entry.homeVariant = mask;
    entry.variantDiscarded = root.WorldGen.smallVariantMask(entry);
    const hasDiscarded = entry.variantDiscarded.some(Boolean);
    const cleared = new Uint8Array(N * N);
    for (let i = 0; i < cleared.length; i++) cleared[i] = mask[i] || entry.variantDiscarded[i];
    const hasCleared = cleared.some(Boolean);
    entry.homeStreetIndex = hasCleared && entry.streetIndex
      ? root.WorldGen.runSteps(root.StreetVariants.homeIndexSteps(entry.streetIndex, cleared, N)) : null;
    // Keep original generated arrays intact: caves, shared spawn draws and
    // rebuilds all need the original world, regardless of whose Home this is.
    const source = entry._homeVariantSource || (entry._homeVariantSource = {
      streetGround: entry.streetGround, streetMarks: entry.streetMarks,
    });
    for (const key of ['streetGround', 'streetMarks']) {
      if (!hasCleared || !entry[key]) continue;
      if (!source[key]) source[key] = entry[key];
      entry[key] = entry[key].slice();
      for (let i = 0; i < cleared.length; i++) if (cleared[i]) entry[key][i] = 0;
    }
    if (hasCleared && entry.slowCells) {
      entry.slowCells = new Map(entry.slowCells);
      for (let i = 0; i < cleared.length; i++) if (cleared[i]) entry.slowCells.delete(i);
    }
    if (entry.variantBaseGrid && entry.baseGrid) {
      for (let i = 0; i < cleared.length; i++) {
        if (cleared[i] && entry.grid[i] === entry.baseGrid[i]) entry.grid[i] = entry.variantBaseGrid[i];
      }
    }
    const saved = root.SpawnOwnership?.savedIds(scene.save);
    const keep = object => {
      const at = object && !Number.isFinite(object.x) && Number.isFinite(object.lx)
        ? { ...object, x: tx * scene.tileEdgeM + object.lx, y: ty * scene.tileEdgeM + object.ly } : object;
      if (isCurated(scene, object, saved)) return true;
      if (overlaps(scene, entry, at, tx, ty, mask)) return false;
      if (!hasDiscarded || !Number.isFinite(at?.x) || !Number.isFinite(at?.y)) return true;
      const ix = Math.floor(at.x / unit - tx * N), iy = Math.floor(at.y / unit - ty * N);
      if (ix >= 0 && iy >= 0 && ix < N && iy < N && entry.variantDiscarded[iy * N + ix]) return false;
      return !root.SpawnOwnership?.tileCells(scene, entry, at, tx, ty).some(i => entry.variantDiscarded[i]);
    };
    const lists = ['objects', 'wildplants', 'traps', 'extraTreasures', 'parkingTreasures', 'streetLairs', 'reefCorals', 'spiderPathWebs', 'pathVents', 'laidTraps'];
    if (phase !== 'prepare') lists.push('creatures');
    for (const key of lists) if (Array.isArray(entry[key])) entry[key] = entry[key].filter(keep);
    if (entry.treasure && !keep(entry.treasure)) entry.treasure = null;
    if (phase !== 'prepare') {
      if (entry._homeVariantApplied !== `${home.x},${home.y}`) {
        root.RoadOverlay?.invalidate(scene);
        scene._streetLampKey = null;
      }
      entry._homeVariantApplied = `${home.x},${home.y}`;
    }
    return true;
  }
  function refresh(scene) {
    const home = anchor(scene);
    if (!home) return;
    const key = `${home.x},${home.y}`;
    for (const [tileKey, entry] of root.WorldGen?.tileCache || []) {
      if (!entry._spawned || entry._homeVariantGenerating || entry._homeVariantApplied === key) continue;
      const parts = String(tileKey).split('/').map(Number);
      const tx = entry.tx ?? parts[parts.length - 2], ty = entry.ty ?? parts[parts.length - 1];
      if (Number.isFinite(tx) && Number.isFinite(ty)) apply(scene, entry, tx, ty);
    }
  }
  root.HomeVariant = { RADIUS_M, anchor, contains, discardedAt, isCurated, allows, apply, refresh };
})(typeof window !== 'undefined' ? window : globalThis);
