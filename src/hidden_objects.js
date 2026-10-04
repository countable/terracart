// Discoveries belong to the player's feet, never the camera or equipment reach.
(function (root) {
  'use strict';
  const KINDS = {
    shrine_spirit: { discover: (scene, object) => root.Temples.discoverSpirit(scene, object) },
  };
  function isHidden(save, object) {
    return !!object?.hidden && !save?.hiddenDiscoveries?.[object.id];
  }
  function adjacent(scene, object) {
    if ((object.depth || 0) !== (scene.depth || 0)) return false;
    const player = worldMetersToAbsCell(scene,
      scene.startWorldM.x + scene.playerM.x, scene.startWorldM.y + scene.playerM.y);
    const target = worldMetersToAbsCell(scene, object.x, object.y);
    const delta = absCellDelta(scene, player.cellIX, player.cellIY, target.cellIX, target.cellIY);
    return Math.abs(delta.dx) <= 1 && Math.abs(delta.dy) <= 1;
  }
  function reveal(scene, object) {
    if (!isHidden(scene.save, object) || !adjacent(scene, object)) return false;
    (scene.save.hiddenDiscoveries ||= {})[object.id] = true;
    scene._hiddenDiscoveryTick = null;
    persistSave(scene.save);
    KINDS[object.discovery || object.kind]?.discover?.(scene, object);
    return true;
  }
  function saved(scene) {
    return (scene.save.hiddenObjects || []).filter(o => (o.depth || 0) === (scene.depth || 0));
  }
  function tick(scene) {
    if (!scene.startWorldM || !scene.playerM) return;
    const pc = scene.playerToWorldCell();
    const key = `${scene.depth || 0}:${pc.tx}:${pc.ty}:${Math.floor(pc.cx)}:${Math.floor(pc.cy)}:${scene.save.hiddenObjects?.length || 0}`;
    const entries = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const entry = root.WorldGen.tileCache.get(root.WorldGen.tileKey(pc.tx + dx, pc.ty + dy));
      entries.push(entry?.status === 'ready' ? entry : null);
    }
    const last = scene._hiddenDiscoveryTick;
    if (last?.key === key && entries.every((e, i) => e === last.entries[i])) return;
    scene._hiddenDiscoveryTick = { key, entries };
    // Saved discoveries are few; generated objects use the existing chunk index.
    for (const o of saved(scene)) if (reveal(scene, o)) return;
    const x = scene.startWorldM.x + scene.playerM.x, y = scene.startWorldM.y + scene.playerM.y;
    const pad = scene.cellM * 2;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const entry = root.WorldGen.tileCache.get(root.WorldGen.tileKey(pc.tx + dx, pc.ty + dy));
      if (!entry || entry.status !== 'ready') continue;
      let revealed = false;
      root.WorldGen.forEachItemInBox(entry, 'objects', x - pad, y - pad, x + pad, y + pad, o => {
        if (!revealed && reveal(scene, o)) revealed = true;
      });
      if (revealed) return;
    }
  }
  function ensureSpirit(scene, temple, state) {
    if (!state.ready || state.hadEnemies || state.active) return null;
    const id = `shrine_spirit_${temple.templeZone}`;
    const records = scene.save.hiddenObjects ||= [];
    const previous = records.find(o => o.id === id);
    if (previous) return previous;
    const region = root.Temples.coverage(temple, root.WorldGen.tileCache, scene.tileEdgeM);
    if (!region.complete) return null;
    let best = null;
    for (const { entry, tx, ty } of region.entries) {
      const N = entry.cellsPerEdge, cellM = scene.tileEdgeM / N;
      const mask = entry.zone.coverage || entry.zone.idx;
      const occupied = new Set();
      for (const o of [...(entry.objects || []), ...(entry.wildplants || [])]) {
        const x = Math.floor((o.x / scene.tileEdgeM - tx) * N);
        const y = Math.floor((o.y / scene.tileEdgeM - ty) * N);
        if (x >= 0 && y >= 0 && x < N && y < N) occupied.add(y * N + x);
      }
      for (let i = 0; i < mask.length; i++) {
        const anchor = entry.zone.anchors[mask[i] - 1];
        if (!anchor || String(anchor.key) !== String(temple.templeZone) || occupied.has(i)) continue;
        const ix = i % N, iy = Math.floor(i / N);
        if (!root.WorldGen.isSpawnCell(entry.grid, N, N, ix, iy,
            { roadMask: entry.roadMask, spawnWhy: entry.spawnWhy }, 'attractor')) continue;
        const rank = fnv1a(`${id}:${tx},${ty},${ix},${iy}`);
        if (best && (rank > best.rank || (rank === best.rank && `${tx},${ty},${i}` >= best.tie))) continue;
        best = { rank, tie: `${tx},${ty},${i}`, x: (tx * N + ix + .5) * cellM, y: (ty * N + iy + .5) * cellM };
      }
    }
    if (!best) return null;
    const object = { id, kind: 'shrine_spirit', hidden: true, discovery: 'shrine_spirit',
      templeZone: temple.templeZone, x: best.x, y: best.y, depth: 0 };
    records.push(object);
    persistSave(scene.save);
    return object;
  }
  root.HiddenObjects = { KINDS, isHidden, adjacent, reveal, saved, tick, ensureSpirit };
})(typeof globalThis !== 'undefined' ? globalThis : this);
