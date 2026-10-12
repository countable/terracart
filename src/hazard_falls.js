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
  // ── CREATURES FALL TOO ────────────────────────────────────────────────
  // The open floor gap under (x, y) on the current floor, or null: an opened
  // cave-in or open sinkhole (EnvironmentHazards; a blocked one is not open)
  // or an L1 chasm (the ground_hole CaveHazards drops the player through).
  function gapAt(scene, x, y) {
    const W = root.WorldGen, depth = scene.depth || 0, at = scene.cellAt?.(x, y);
    if (!at?.loaded) return null;
    const s = scene._environmentHazards?.get(depth);
    for (const h of [...(s?.caveins || []), ...(s?.sinkholes || [])]) {
      if (!h.blocked && h.phase === 'open'
          && (h.footprintCells || []).some(c => c.cellIX === at.cellIX && c.cellIY === at.cellIY)) return h;
    }
    if (!(depth > 0)) return null;
    const entry = W.tileCache.get(W.tileKey(at.tx, at.ty));
    if (!entry) return null;
    const centre = absCellCenterMeters(scene, at.cellIX, at.cellIY), half = scene.cellM / 2;
    let hole = null;
    W.forEachItemInBox(entry, 'objects', centre.x - half, centre.y - half, centre.x + half, centre.y + half, o => {
      if (hole || o.kind !== 'ground_hole' || (o.depth || 0) !== depth) return;
      const c = scene.cellAt(o.x, o.y);
      if (c.cellIX === at.cellIX && c.cellIY === at.cellIY) hole = o;
    });
    return hole;
  }
  // Who a gap takes: a grounded foe, pet or charmed creature still standing
  // in the world (not buried, mid-catch or down). Fliers cross; neighbours,
  // calmed animals and hired allies never fall.
  function fallsThrough(c) {
    if (!c || c._spent || c._surfaceInactive || c._beingCaught || root.Conditions.flying(c)
        || root.Combat.hp(c) <= 0) return false;
    return root.Combat.isTame(c) || root.Combat.isCharmed(c) || root.Combat.isEnemy(c);
  }
  // A body that ends its step over a gap leaves this floor. It lands
  // on the floor below when that tile is already spawned there (the same
  // landing the player gets), otherwise it is simply gone this session; its
  // id never enters save.caught, so a falling foe is no kill and pays nothing.
  // A pet left below rejoins through Companions' catch-up once the player
  // changes floors or walks off.
  function dropCreatures(scene, creatures) {
    const fell = [];
    for (const c of creatures) {
      if (fallsThrough(c) && gapAt(scene, c.x, c.y)) fell.push(c);
    }
    for (const c of fell) dropCreature(scene, c);
    return fell;
  }
  function dropCreature(scene, c) {
    const W = root.WorldGen, depth = scene.depth || 0, edge = scene.tileEdgeM;
    const { x, y } = c;
    for (const e of W.tileCache.values()) {
      const i = e.creatures?.indexOf(c) ?? -1;
      if (i >= 0) { e.creatures.splice(i, 1); break; }
    }
    const below = W.tileCacheFor(depth + 1)?.get(W.tileKey(Math.floor(x / edge), Math.floor(y / edge)));
    const at = below?._spawned && below.creatures ? landing(below, c, edge) : null;
    if (at) {
      Object.assign(c, { x: at.x, y: at.y, _startX: at.x, _startY: at.y, _targetX: at.x, _targetY: at.y,
        _nextChooseT: 0, _chaseTarget: null });
      below.creatures.push(c);
    }
    scene.flashAtWorld?.('It fell through!', x, y);
  }
  root.HazardFalls = { LANDING_RADIUS, landing, over, fall, gapAt, fallsThrough, dropCreatures };
})(typeof globalThis !== 'undefined' ? globalThis : this);
