// Spider silk lands on a fixed cell; saved ground webs expire in wall time.
(function (root) {
  'use strict';
  const CONFIG = Object.freeze({ lifetimeMs: 24 * 60 * 60 * 1000,
    get paralysisMs() { return root.Conditions.DEFINITIONS.paralysis.maxDurationMs; },
    speedCellsPerSecond: 5, maxStepSeconds: .1 });
  const cellKey = (depth, cellIX, cellIY) => `${depth}:${cellIX}:${cellIY}`;
  function runtime(scene) {
    if (!scene._spiderWebRuntime || scene._spiderWebRuntime.save !== scene.save) {
      scene._spiderWebRuntime = { save: scene.save, shots: [], contacts: new WeakMap(),
        source: null, cells: new Map(), byDepth: new Map(), expiry: 0, depth: scene.depth || 0 };
    }
    const state = scene._spiderWebRuntime;
    if (state.depth !== (scene.depth || 0)) {
      state.depth = scene.depth || 0;
      state.shots = [];
      state.contacts = new WeakMap();
    }
    return state;
  }
  function persist(scene) { if (typeof persistSave === 'function') persistSave(scene.save); }
  function index(scene, now) {
    const state = runtime(scene);
    const source = scene.save.spiderWebs;
    if (state.source === source && now < state.expiry) return state;
    const valid = Array.isArray(source) ? source.filter(w => w && Number.isInteger(w.depth) && w.depth >= 0
      && Number.isInteger(w.cellIX) && Number.isInteger(w.cellIY)
      && Number.isFinite(w.x) && Number.isFinite(w.y)
      && Number.isFinite(w.expiresAt) && w.expiresAt > now) : [];
    state.cells.clear(); state.byDepth.clear(); state.expiry = Infinity;
    for (const web of valid) {
      const key = cellKey(web.depth, web.cellIX, web.cellIY);
      const old = state.cells.get(key);
      if (!old || old.expiresAt < web.expiresAt) state.cells.set(key, web);
    }
    for (const web of state.cells.values()) {
      if (!state.byDepth.has(web.depth)) state.byDepth.set(web.depth, []);
      state.byDepth.get(web.depth).push(web);
      state.expiry = Math.min(state.expiry, web.expiresAt);
    }
    if (Array.isArray(source) && state.cells.size !== source.length) {
      scene.save.spiderWebs = [...state.cells.values()];
      persist(scene);
    }
    state.source = scene.save.spiderWebs;
    return state;
  }
  function lists(scene, now = Date.now()) {
    const state = index(scene, now);
    return { webs: state.byDepth.get(scene.depth || 0) || [], shots: state.shots };
  }
  function launch(scene, creature, targetX, targetY) {
    if (![creature?.x, creature?.y, targetX, targetY].every(Number.isFinite)) return false;
    const cell = worldMetersToAbsCell(scene, targetX, targetY);
    const target = absCellCenterMeters(scene, cell.cellIX, cell.cellIY);
    runtime(scene).shots.push({ depth: scene.depth || 0, ...cell,
      fromX: creature.x, fromY: creature.y, x: creature.x, y: creature.y,
      targetX: target.x, targetY: target.y, progress: 0 });
    return true;
  }
  function land(scene, shot, now = Date.now()) {
    if (shot.depth !== (scene.depth || 0)) return false;
    const at = scene.cellAt(shot.targetX, shot.targetY);
    if (!at.loaded || !root.WorldGen.isWalkable(at.type)) return false;
    const state = index(scene, now), key = cellKey(shot.depth, shot.cellIX, shot.cellIY);
    const old = state.cells.get(key);
    if (old) old.expiresAt = now + CONFIG.lifetimeMs;
    else {
      scene.save.spiderWebs ||= [];
      scene.save.spiderWebs.push({ depth: shot.depth, cellIX: shot.cellIX, cellIY: shot.cellIY,
        x: shot.targetX, y: shot.targetY, expiresAt: now + CONFIG.lifetimeMs });
    }
    state.source = null;
    persist(scene);
    return true;
  }
  // A new contact pins once. Remaining in the same web does not renew the
  // paralysis; leaving and touching it again does. Sample swept steps so a
  // fast creature cannot skip a cell between simulation frames.
  function contact(scene, unit, now = Date.now()) {
    const state = index(scene, now), player = unit === 'player';
    const actor = player ? scene.save : unit;
    if (!actor) return false;
    if (root.Conditions.flying(actor, now)) { state.contacts.delete(actor); return false; }
    const position = player
      ? { x: scene.startWorldM.x + scene.playerM.x,
        y: scene.startWorldM.y + scene.playerM.y + (scene.feetOffsetM || 0) }
      : unit;
    const old = state.contacts.get(actor);
    let keyBefore = old?.key || null, touched = false;
    const distance = old ? Math.hypot(position.x - old.x, position.y - old.y) : 0;
    // Teleports establish a new contact at their destination, not a silk trail.
    const sweep = old && distance <= scene.cellM * 4;
    const steps = sweep ? Math.max(1, Math.ceil(distance / (scene.cellM * .25))) : 1;
    for (let step = 1; step <= steps; step++) {
      const x = sweep ? old.x + (position.x - old.x) * step / steps : position.x;
      const y = sweep ? old.y + (position.y - old.y) * step / steps : position.y;
      const cell = worldMetersToAbsCell(scene, x, y);
      const key = cellKey(scene.depth || 0, cell.cellIX, cell.cellIY);
      const webKey = state.cells.has(key) ? key : null;
      if (webKey && webKey !== keyBefore) {
        if (player) {
          if (!root.Combat.playerDowned(scene.save.energy)) {
            root.Conditions.apply(scene.save, 'paralysis', now, { durationMs: CONFIG.paralysisMs });
            persist(scene);
            touched = true;
          }
        } else if (!unit._surfaceInactive && unit._hp !== 0) {
          touched = root.Combat.paralyze(unit, CONFIG.paralysisMs, now) || touched;
        }
      }
      keyBefore = webKey;
    }
    state.contacts.set(actor, { x: position.x, y: position.y, key: keyBefore });
    return touched;
  }
  function tick(scene, dt, now = Date.now()) {
    if (!scene.save || !scene.startWorldM || !scene.playerM || !Number.isFinite(dt) || dt <= 0) return;
    // Preserve the dodge window after a stalled frame, as the other ground
    // hazards do. Saved ground-web expiry still uses the wall clock below.
    dt = Math.min(CONFIG.maxStepSeconds, dt);
    const state = runtime(scene);
    state.shots = state.shots.filter(shot => {
      const distance = Math.hypot(shot.targetX - shot.fromX, shot.targetY - shot.fromY);
      shot.progress = Math.min(1, shot.progress + dt * CONFIG.speedCellsPerSecond * scene.cellM / Math.max(.001, distance));
      shot.x = shot.fromX + (shot.targetX - shot.fromX) * shot.progress;
      shot.y = shot.fromY + (shot.targetY - shot.fromY) * shot.progress;
      if (shot.progress < 1) return true;
      land(scene, shot, now);
      return false;
    });
    index(scene, now);
    contact(scene, 'player', now);
    const caught = new Set(scene.save.caught || []);
    for (const unit of scene._characterBodies || []) {
      if (unit.id !== 'player' && !caught.has(unit.id)) contact(scene, unit, now);
    }
  }
  root.SpiderWebs = { CONFIG, lists, launch, land, contact, tick };
})(typeof window !== 'undefined' ? window : globalThis);
