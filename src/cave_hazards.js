// Cave holes use the feet and prepare a safe destination before committing a fall.
(function (root) {
  'use strict';
  const FALL_ENERGY_FRACTION = .25;
  const LANDING_RADIUS = 3;
  function landing(entry, hole, tileEdgeM) {
    if (!entry?.grid || !(entry.cellsPerEdge > 0)) return null;
    const N = entry.cellsPerEdge, edge = entry.tileEdgeM || tileEdgeM;
    const tx = Math.floor(hole.x / edge), ty = Math.floor(hole.y / edge), cell = edge / N;
    const occupied = new Set();
    for (const list of ['objects', 'wildplants', 'traps', 'laidTraps', 'creatures']) {
      for (const o of entry[list] || []) {
        const x = Math.floor((o.x - tx * edge) / cell), y = Math.floor((o.y - ty * edge) / cell);
        if (x >= 0 && y >= 0 && x < N && y < N) occupied.add(y * N + x);
      }
    }
    let best = null, distance = Infinity;
    const hx = Math.floor((hole.x - tx * edge) / cell), hy = Math.floor((hole.y - ty * edge) / cell);
    for (let iy = Math.max(0, hy - LANDING_RADIUS); iy <= Math.min(N - 1, hy + LANDING_RADIUS); iy++) {
      for (let ix = Math.max(0, hx - LANDING_RADIUS); ix <= Math.min(N - 1, hx + LANDING_RADIUS); ix++) {
        const i = iy * N + ix;
        if (entry.grid[i] !== root.WorldGen.T.CAVE_FLOOR || occupied.has(i)) continue;
        const x = (tx * N + ix + .5) * cell, y = (ty * N + iy + .5) * cell;
        const d = (x - hole.x) ** 2 + (y - hole.y) ** 2;
        if (d < distance) { best = { x, y }; distance = d; }
      }
    }
    return best;
  }
  async function fall(scene, hole, latitude = 0) {
    if (scene._caveFallPending || !(scene.depth > 0) || (hole.depth || 0) !== scene.depth) return false;
    const depth = scene.depth;
    scene._caveFallPending = true;
    try {
      const edge = scene.tileEdgeM, tx = Math.floor(hole.x / edge), ty = Math.floor(hole.y / edge);
      const entry = await root.WorldGen.loadTile.atDepth(depth + 1, tx, ty, latitude);
      if (entry?.status === 'loading') await entry.promise;
      if (entry?.grid && !entry._spawned) {
        scene._ensureHomeUpStair?.(entry, tx, ty);
        scene._ensureLadderUpStairs?.(entry, tx, ty);
        scene.spawnCaveCreatures?.(entry, tx, ty, depth + 1);
      }
      const destination = landing(entry, hole, edge);
      if (!destination || scene.depth !== depth) {
        scene._caveFallPending = false;
        scene.flash?.('No safe landing below.', scene.viewCenterX, scene.viewCenterY);
        return false;
      }
      let resolved = false;
      scene.showMessageModal({ kind: 'story', art: 'cave_first', title: 'The ground gives way',
        body: 'Your foot slips over the broken edge. You fall through the dark and strike the stone floor below.',
        okLabel: 'Continue', mustAcknowledge: true,
        onDismiss() {
          if (resolved) return;
          resolved = true;
          try {
            if (scene.depth !== depth) return;
            const raw = root.Energy.maxEnergy(scene.save) * FALL_ENERGY_FRACTION;
            const lost = scene._losePlayerEnergy(root.Conditions.damageImmune(scene.save) ? 0
              : root.Combat.incomingDamage(scene.save, raw));
            scene.changeDepth(1, destination, { fall: true });
            if (lost > 0) scene._popEnergy(-lost);
            persistSave(scene.save);
          } finally { scene._caveFallPending = false; }
        },
      });
      return true;
    } catch (error) {
      scene._caveFallPending = false;
      scene.flash?.('The floor below is unavailable.', scene.viewCenterX, scene.viewCenterY);
      return false;
    }
  }
  function tick(scene, latitude) {
    if (!(scene.depth > 0) || scene._caveFallPending || !scene.startWorldM
        || root.Combat.playerDowned(scene.save.energy) || scene._dialogOpen?.()) return;
    const p = scene.playerToWorldCell();
    const entry = root.WorldGen.tileCache.get(root.WorldGen.tileKey(p.tx, p.ty));
    if (!entry?._spawned) return;
    const key = `${scene.depth}:${p.tx}:${p.ty}:${Math.floor(p.cx)}:${Math.floor(p.cy)}`;
    if (scene._caveHoleCell === key) return;
    scene._caveHoleCell = key;
    const cell = tileCellToAbs(scene, p.tx, p.ty, Math.floor(p.cx), Math.floor(p.cy));
    const centre = absCellCenterMeters(scene, cell.cellIX, cell.cellIY), half = scene.cellM / 2;
    let hole = null;
    root.WorldGen.forEachItemInBox(entry, 'objects', centre.x - half, centre.y - half,
      centre.x + half, centre.y + half, o => {
      if (o.kind !== 'ground_hole' || (o.depth || 0) !== scene.depth) return;
      const c = worldMetersToAbsCell(scene, o.x, o.y);
      if (c.cellIX === cell.cellIX && c.cellIY === cell.cellIY) hole = o;
    });
    if (hole) void fall(scene, hole, latitude);
  }
  root.CaveHazards = { FALL_ENERGY_FRACTION, LANDING_RADIUS, landing, fall, tick };
})(typeof globalThis !== 'undefined' ? globalThis : this);
