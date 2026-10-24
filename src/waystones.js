// Pilgrim's Way: step on every stone before their light fades.
(function (root) {
  'use strict';
  const LIGHT_MS = 5 * 60 * 1000;
  function isLit(o, save, now = Date.now()) {
    return !!save?.waystoneSets?.[o.waystoneSet]
      || (save?.waystoneUntil?.[o.id] || 0) > now;
  }
  function rewardSeat(scene, cell) {
    const W = root.WorldGen;
    for (let r = 1; r <= 3; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const c = absCellOffset(scene, cell.cellIX, cell.cellIY, dx, dy);
        const t = absCellToTile(scene, c.cellIX, c.cellIY);
        const entry = W.tileCache.get(W.tileKey(t.tx, t.ty));
        if (!entry?._spawned || !entry.grid) continue;
        const n = entry.cellsPerEdge;
        if (!W.isSpawnCell(entry.grid, n, n, t.ix, t.iy,
            { ...entry._spawnOpts, roadMask: entry.roadMask || entry._spawnOpts?.roadMask,
              spawnWhy: entry.spawnWhy || entry._spawnOpts?.spawnWhy,
              gameplayTiers: entry.gameplayTiers || entry._spawnOpts?.gameplayTiers, roadClass: entry.roadClass }, 'reward')
            || W.privateVetoAt(t.tx, t.ty, t.ix, t.iy)) continue;
        const occupied = o => SpawnOwnership.footprintCells(scene, o).some(p => p.cellIX === c.cellIX && p.cellIY === c.cellIY);
        if (['objects', 'wildplants', 'extraTreasures', 'parkingTreasures'].some(k => (entry[k] || []).some(occupied))
            || (entry.treasure && occupied(entry.treasure))) continue;
        if (['planted', 'fruittrees', 'fires', 'scarecrows', 'furniture'].some(k => (scene.save[k] || []).some(o => PlacedFloor.onDepth(o, 0) && occupied(o)))) continue;
        if (['tilled', 'placedRocks'].some(k => (scene.save[k] || []).includes(`${c.cellIX}_${c.cellIY}`))) continue;
        return { entry, ...absCellCenterMeters(scene, c.cellIX, c.cellIY) };
      }
    }
    return null;
  }
  function restoreRewards(scene, cell) {
    const W = root.WorldGen;
    for (const reward of Object.values(scene.save.waystoneSets || {})) {
      if (!reward?.id || scene.save.opened?.includes(reward.id)) continue;
      if (!Number.isFinite(reward.x) || !Number.isFinite(reward.y)) {
        const seat = cell && rewardSeat(scene, cell);
        if (!seat) continue;
        reward.x = seat.x; reward.y = seat.y;
        persistSave(scene.save);
        scene.flash?.('A chest appears beside you.');
      }
      const t = worldMetersToTile(scene, reward.x, reward.y);
      const entry = W.tileCache.get(W.tileKey(t.tx, t.ty));
      if (!entry?._spawned) continue;
      if (!(entry.objects ||= []).some(o => o.id === reward.id)) entry.objects.push({ ...reward });
    }
  }
  function step(scene, stone, stones, cell, now = Date.now()) {
    const save = scene.save, group = stone.waystoneSet;
    if (!group || save.waystoneSets?.[group]) return false;
    const members = stones.filter(o => o.waystoneSet === group);
    if (members.length !== stone.waystoneCount || members.length < 3 || members.length > 6) return false;
    let changed = false;
    if (!isLit(stone, save, now)) {
      (save.waystoneUntil ||= {})[stone.id] = now + LIGHT_MS;
      changed = true;
    }
    const lit = members.filter(o => isLit(o, save, now)).length;
    if (lit === members.length) {
      const seat = rewardSeat(scene, cell);
      const reward = { kind: 'chest', id: `waystone_reward:${group}`,
        tierSeed: 3, depth: 0, playerOwned: true };
      if (seat) { reward.x = seat.x; reward.y = seat.y; }
      // Completion is permanent even if every nearby safe seat is occupied.
      // The saved pending chest appears as soon as the player reaches free ground.
      (save.waystoneSets ||= {})[group] = reward;
      for (const o of members) delete save.waystoneUntil[o.id];
      if (seat) seat.entry.objects.push({ ...reward });
      scene.flash?.(seat ? 'A T3 chest appears beside you.' : 'The way is alight.');
      changed = true;
    } else if (changed) {
      // Progress for a newly lit stone, in the centred viewport toast.
      scene.flash?.(`${lit}/${members.length} waystones lit`);
    }
    if (changed) {
      persistSave(save);
      scene.mapDirty = true;
    }
    return changed;
  }
  function tick(scene, now = Date.now()) {
    if ((scene.depth || 0) !== 0 || !scene.startWorldM || !scene.playerM) return;
    // A small cadence bounds reward restoration and cell queries, even standing still.
    if (scene._waystoneTickAt > now) return;
    scene._waystoneTickAt = now + 200;

    const p = { x: scene.startWorldM.x + scene.playerM.x,
      y: scene.startWorldM.y + scene.playerM.y + (scene.feetOffsetM || 0) };
    const cell = scene.cellAt(p.x, p.y), W = root.WorldGen;
    restoreRewards(scene, cell);
    if (root.Conditions.flying(scene.save)) return;
    const entry = W.tileCache.get(W.tileKey(cell.tx, cell.ty));
    if (!cell.loaded || !entry?._spawned) return;
    let stone;
    W.forEachItemInBox(entry, 'objects', p.x - scene.cellM, p.y - scene.cellM,
      p.x + scene.cellM, p.y + scene.cellM, o => {
        if (o.kind !== 'waystone') return;
        const at = scene.cellAt(o.x, o.y);
        if (at.cellIX === cell.cellIX && at.cellIY === cell.cellIY) stone = o;
      });
    if (stone) step(scene, stone, entry.objects.filter(o => o.kind === 'waystone'), cell, now);
  }
  root.Waystones = { LIGHT_MS, isLit, step, tick, restoreRewards };
})(typeof window !== 'undefined' ? window : globalThis);
