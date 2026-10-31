// Armed barrels use a saved foreground countdown, then the ordinary damage,
// burning, ground-fire and blast effects. No offline clock or loot reroll.
(function (root) {
  'use strict';
  const CONFIG = Object.freeze({ fuseMs: 5000, radiusCells: 1, damage: 20, burningMs: 6000, groundFireMs: 10000, maxStepMs: 100 });
  function fuse(scene, object) {
    return scene.save?.barrelFuses?.[typeof object === 'string' ? object : object.id] || null;
  }
  function arm(scene, object) {
    if (!root.isExplosiveBarrel?.(object) || !scene.save || setOf(scene.save.opened).has(object.id)) return false;
    if (fuse(scene, object)) return true;
    (scene.save.barrelFuses ||= {})[object.id] = {
      id: object.id, x: object.x, y: object.y, depth: object.depth || 0, remainingMs: CONFIG.fuseMs,
    };
    persistSave(scene.save);
    return true;
  }
  function countdown(scene, object) {
    const active = fuse(scene, object);
    return active ? Math.max(1, Math.ceil(active.remainingMs / 1000)) : null;
  }
  function tint(scene, object) {
    const active = fuse(scene, object);
    if (active) return Math.floor((CONFIG.fuseMs - active.remainingMs) / 180) % 2 ? 0xffffff : 0xff3322;
    return object.redBarrel ? 0xff2424 : null;
  }
  function detonate(scene, active) {
    const opened = new Set(scene.save.opened || []);
    delete scene.save.barrelFuses[active.id];
    if (opened.has(active.id)) return;
    opened.add(active.id); scene.save.opened = [...opened];
    // Commit the spent barrel before effects, so reload cannot pay damage twice.
    persistSave(scene.save);
    const radius = CONFIG.radiusCells * scene.cellM;
    const inside = o => Math.hypot(o.x - active.x, o.y - active.y) <= radius + 1e-8;
    const now = Date.now(), combatNow = scene.time?.now ?? performance.now();
    const player = playerWorldM(scene);
    if (inside(player) && !root.Combat.playerDowned(scene.save.energy)) {
      const damage = root.Conditions.fireDamage(scene.save, root.Combat.incomingDamage(scene.save, CONFIG.damage, 1, now), now);
      const lost = damage > 0 ? scene._losePlayerEnergy(damage, { closeShop: true }) : 0;
      if (lost > 0) scene._popEnergy?.(-lost);
      root.Conditions.apply(scene.save, 'burning', now, { durationMs: CONFIG.burningMs });
    }
    const caught = setOf(scene.save.caught), seen = new Set();
    const at = scene.cellAt(active.x, active.y);
    root.WorldGen.forEachItemNear('creatures', at.tx, at.ty, (creature, entry) => {
      if (seen.has(creature.id) || creature._spent || creature._surfaceInactive || caught.has(creature.id)
          || (creature.depth ?? entry.depth ?? 0) !== active.depth || !inside(creature)) return;
      seen.add(creature.id);
      const damage = root.Conditions.fireDamage(creature, CONFIG.damage, now);
      if (damage > 0) scene._damageBurningUnit?.(creature, damage, 'player', combatNow);
      if (!creature._spent && root.Combat.ignite(creature, combatNow, 'player') && creature._burnState)
        creature._burnState.remainingMs = CONFIG.burningMs;
    });
    const centre = worldMetersToAbsCell(scene, active.x, active.y);
    for (let dy = -CONFIG.radiusCells; dy <= CONFIG.radiusCells; dy++) {
      for (let dx = -CONFIG.radiusCells; dx <= CONFIG.radiusCells; dx++) {
        const cell = absCellOffset(scene, centre.cellIX, centre.cellIY, dx, dy);
        const point = absCellCenterMeters(scene, cell.cellIX, cell.cellIY);
        if (inside(point)) scene._igniteGroundCell?.({ ...cell, depth: active.depth }, now,
          { durationMs: CONFIG.groundFireMs, relight: true });
      }
    }
    scene._blastAt?.(active.x, active.y, { radiusCells: CONFIG.radiusCells, colour: '#ff742d',
      sparks: 'trailspark', chips: 'timber', ringPx: CONFIG.radiusCells * (scene.cellPx || 24) });
    persistSave(scene.save);
  }
  function tick(scene, dt) {
    if (!scene.save?.barrelFuses || !(dt > 0) || !Number.isFinite(dt)
        || typeof document !== 'undefined' && document.hidden) return;
    const step = Math.min(CONFIG.maxStepMs, dt * 1000);
    let dirty = false;
    for (const active of Object.values(scene.save.barrelFuses)) {
      if (active.depth !== (scene.depth || 0) || !scene.cellAt(active.x, active.y).loaded) continue;
      if (setOf(scene.save.opened).has(active.id)) { delete scene.save.barrelFuses[active.id]; dirty = true; continue; }
      const before = Math.ceil(active.remainingMs / 1000);
      active.remainingMs = Math.max(0, active.remainingMs - step);
      if (!active.remainingMs) { detonate(scene, active); continue; }
      if (Math.ceil(active.remainingMs / 1000) !== before) dirty = true;
    }
    if (dirty) persistSave(scene.save);
  }
  root.ExplosiveBarrels = { CONFIG, arm, fuse, countdown, tint, tick };
})(typeof globalThis !== 'undefined' ? globalThis : this);
