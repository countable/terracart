// Roadside hives retain their wreck identity. Only health and birth serials
// survive reloads; their one-minute clock advances while nearby in play.
(function (root) {
  'use strict';
  const KINDS = Object.freeze({
    mushroom: Object.freeze({ name: 'Mushroom House', texture: 'hive_mushroom', frame: 0,
      hp: 120, enemy: 'mushroom_monster', intervalMs: 60000, maxAlive: 4 }),
  });
  const CONFIG = Object.freeze({ activeCells: 24, spawnRadiusCells: 4, spawnClearanceCells: .7, observeMs: 1000, maxFrameMs: 100 });
  function isActive(save, house) {
    return !!(save && house?.kind === 'house' && KINDS[house.hive]
      && root.Houses.isHouseWreck(save, house) && !root.Houses.isClaimedKey(save, house.id)
      && !root.SpawnOwnership?.isProtected(house, save)
      && save.hives?.[house.id]?.hp !== 0);
  }
  function health(save, house) {
    const max = KINDS[house?.hive]?.hp || 0;
    const hp = save?.hives?.[house?.id]?.hp;
    return Number.isFinite(hp) ? Math.max(0, Math.min(max, hp)) : max;
  }
  function record(save, house) {
    return (save.hives ||= {})[house.id] ||= { hp: KINDS[house.hive].hp, serial: 0 };
  }
  // The ordinary player swing supplies its already calculated damage. Return
  // whether this blow destroyed the hive, leaving the original wreck intact.
  function damage(scene, house, amount) {
    if (!isActive(scene.save, house) || !(amount > 0) || !Number.isFinite(amount)) return false;
    const state = record(scene.save, house);
    const before = health(scene.save, house);
    state.hp = Math.max(0, before - amount);
    scene._popDamageNumber?.(house, before - state.hp);
    if (!state.hp) {
      scene._hives?.clocks.delete(house.id);
      scene.flashAtWorld?.('Hive cleared. Restore wreck.', house.x, house.y);
    }
    persistSave(scene.save);
    return state.hp === 0;
  }
  function living(scene, house) {
    const caught = new Set(scene.save.caught || []), seen = new Set(), out = [];
    root.WorldGen.forEachItem('creatures', c => {
      if (c._hiveId !== house.id || seen.has(c.id) || caught.has(c.id) || c._spent
          || c._hp <= 0) return;
      seen.add(c.id); out.push(c);
    });
    return out;
  }
  function spawn(scene, house) {
    const row = KINDS[house?.hive];
    if (!row) return false;
    const W = root.WorldGen, edge = scene.tileEdgeM || scene.cellsPerTile * scene.cellM;
    if (!(edge > 0)) return false;
    const generated = W.runSteps(root.CreatureSpawns.generateOwnedSteps('mushroom-hive', house.id, {
      when: () => isActive(scene.save, house), count: 1,
      maxAlive: row.maxAlive, liveCount: () => living(scene, house).length,
      member: () => ({ kind: row.enemy }),
      seat() {
        const caught = new Set(scene.save.caught || []);
        const player = playerWorldM(scene), clearance = CONFIG.spawnClearanceCells * scene.cellM;
        // The ordinary gate and live collision checks remain the seat policy.
        // The common executor handles the source's activation and living cap.
        const centre = worldMetersToAbsCell(scene, house.x, house.y);
        for (let r = 1; r <= CONFIG.spawnRadiusCells; r++) {
          for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            const cell = absCellOffset(scene, centre.cellIX, centre.cellIY, dx, dy);
            const { x, y } = absCellCenterMeters(scene, cell.cellIX, cell.cellIY);
            const { tx, ty } = absCellToTile(scene, cell.cellIX, cell.cellIY);
            const entry = W.tileCache.get(W.tileKey(tx, ty));
            if (!entry?.creatures || entry.status !== 'ready' || (entry.depth || 0) !== (scene.depth || 0)
                || !root.CreatureSpawns.canPlaceAt(scene, entry, x, y, row.enemy, { overrides: W.spawnOptsOf(entry) })
                || scene._cellBlocked?.(x, y)
                || Math.hypot(player.x - x, player.y - y) < clearance) continue;
            let blocked = false;
            W.forEachItemNear('creatures', tx, ty, c => {
              if (!c._spent && !caught.has(c.id) && Math.hypot(c.x - x, c.y - y) < clearance) blocked = true;
            });
            if (!blocked) return { x, y, entry };
          }
        }
        return null;
      },
      create(member, seat) {
        const state = record(scene.save, house);
        const serial = state.serial = (Number.isSafeInteger(state.serial) ? state.serial : 0) + 1;
        return W.makeCreature(member.kind, seat.x, seat.y, `${house.id}_hive_${serial}`, {
          depth: scene.depth || 0, _hiveId: house.id, _provoked: true, shiny: false,
        });
      },
      onPlaced(child, member, seat) {
        root.CreatureSpawns.register(seat.entry, child);
        persistSave(scene.save);
      },
    }));
    return generated[0] || false;
  }
  function tick(scene, dt) {
    if (scene.depth || !scene.save || !scene.startWorldM || !scene.playerM
        || !(dt > 0) || !Number.isFinite(dt) || typeof document !== 'undefined' && document.hidden) return;
    const state = scene._hives ||= { clocks: new Map(), elapsedMs: 0, nextObserveMs: 0 };
    state.elapsedMs += Math.min(CONFIG.maxFrameMs, dt * 1000);
    if (state.elapsedMs < state.nextObserveMs) return;
    const elapsed = state.elapsedMs - (state.lastObserveMs ?? state.elapsedMs);
    state.lastObserveMs = state.elapsedMs;
    state.nextObserveMs = state.elapsedMs + CONFIG.observeMs;
    const p = playerWorldM(scene), edge = scene.tileEdgeM || scene.cellsPerTile * scene.cellM;
    if (!(edge > 0)) return;
    const { tx, ty } = worldMetersToTileCell(scene, p.x, p.y), seen = new Set();
    root.WorldGen.forEachItemNear('objects', tx, ty, (house, entry) => {
      if (seen.has(house.id) || entry.status !== 'ready' || !isActive(scene.save, house)
          || root.HomeVariant?.contains(scene, house.x, house.y)
          || root.HomeVariant?.discardedAt(scene, house.x, house.y)
          || Math.hypot(house.x - p.x, house.y - p.y) > CONFIG.activeCells * scene.cellM) return;
      seen.add(house.id);
      let remaining = state.clocks.get(house.id);
      remaining = remaining == null ? KINDS[house.hive].intervalMs : remaining - elapsed;
      if (remaining <= 0) { spawn(scene, house); remaining = KINDS[house.hive].intervalMs; }
      state.clocks.set(house.id, remaining);
    });
    // Unloaded and distant hives start a fresh minute when visited again.
    for (const id of state.clocks.keys()) if (!seen.has(id)) state.clocks.delete(id);
  }
  root.Hives = { KINDS, CONFIG, isActive, active: isActive, health, damage, living, spawn, tick };
})(globalThis);
