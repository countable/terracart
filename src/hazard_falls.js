// Resolve a landing before changing floors; loading never swaps the active world.
(function (root) {
  'use strict';
  const LANDING_RADIUS = 8;
  function landing(entry, point, tileEdgeM) {
    if (!entry?.grid || !entry.cellsPerEdge) return null;
    const N = entry.cellsPerEdge, edge = entry.tileEdgeM || tileEdgeM;
    const tx = Math.floor(point.x / edge), ty = Math.floor(point.y / edge), cell = edge / N;
    const blocked = new Set();
    for (const name of ['objects', 'wildplants', 'creatures', 'traps', 'laidTraps']) {
      for (const o of entry[name] || []) {
        const ix = Math.floor((o.x - tx * edge) / cell), iy = Math.floor((o.y - ty * edge) / cell);
        if (ix >= 0 && iy >= 0 && ix < N && iy < N) blocked.add(iy * N + ix);
      }
    }
    const hx = Math.floor((point.x - tx * edge) / cell), hy = Math.floor((point.y - ty * edge) / cell);
    let best = null, distance = Infinity;
    for (let iy = Math.max(0, hy - LANDING_RADIUS); iy <= Math.min(N - 1, hy + LANDING_RADIUS); iy++) {
      for (let ix = Math.max(0, hx - LANDING_RADIUS); ix <= Math.min(N - 1, hx + LANDING_RADIUS); ix++) {
        const i = iy * N + ix;
        if (entry.grid[i] !== root.WorldGen.T.CAVE_FLOOR || blocked.has(i) || entry.spawnWhy?.[i]) continue;
        const x = tx * edge + (ix + .5) * cell, y = ty * edge + (iy + .5) * cell;
        const d = (x - point.x) ** 2 + (y - point.y) ** 2;
        if (d < distance) { best = { x, y }; distance = d; }
      }
    }
    return best;
  }
  function over(scene, hole) {
    return root.EnvironmentHazards.overlaps(scene, hole);
  }
  async function fall(scene, hole) {
    if (scene._hazardFallPending || scene._caveFallPending || scene.depth !== hole.depth || hole.phase !== 'open'
        || !over(scene, hole) || root.Combat.playerDowned(scene.save.energy) || root.Conditions.flying(scene.save)) return false;
    const depth = scene.depth;
    if (depth + 1 === root.WorldGen.ARENA_DEPTH || depth === root.WorldGen.ARENA_DEPTH) return false;
    // A sealed floor never opens beneath the player either (same table the
    // minting side reads - DungeonProgression.ROPE_SEALED_FLOORS).
    if (root.DungeonProgression && !root.DungeonProgression.ropeCanDescend(depth)) return false;
    scene._hazardFallPending = true;
    try {
      const edge = scene.tileEdgeM, tx = Math.floor(hole.x / edge), ty = Math.floor(hole.y / edge);
      const latitude = typeof START_LAT === 'number' ? START_LAT : 0;
      let entry = await root.WorldGen.loadTile.atDepth(depth + 1, tx, ty, latitude);
      if (entry.status === 'loading') { await entry.promise; entry = root.WorldGen.tileCacheFor(depth + 1).get(root.WorldGen.tileKey(tx, ty)); }
      if (scene.depth !== depth || hole.phase !== 'open' || !over(scene, hole)
          || root.Combat.playerDowned(scene.save.energy) || root.Conditions.flying(scene.save)) return false;
      // Include the destination's seeded enemies and traps in occupancy before
      // choosing a landing. This pass accepts an explicit depth, so it does not
      // switch the current floor or reroll actors on arrival.
      if (!entry._spawned) scene.spawnCaveCreatures(entry, tx, ty, depth + 1);
      const destination = landing(entry, hole, edge);
      if (!destination) return false;
      const changed = scene.changeDepth(1, { ...destination, descentSource: 'sinkhole' });
      if (changed === false || scene.depth !== depth + 1) return false;
      scene.flashAtPlayer?.('The ground gives way!');
      return true;
    } catch (_) {
      // A failed tile request leaves the player on the loaded floor. Contact
      // retries while the pit remains open; no partial depth/save changes.
      return false;
    } finally { scene._hazardFallPending = false; }
  }
  root.HazardFalls = { LANDING_RADIUS, landing, over, fall };
})(typeof globalThis !== 'undefined' ? globalThis : this);
