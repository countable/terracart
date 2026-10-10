// Surface encounters use their own cell/day RNG stream, never the tile's fauna stream.
(function (root) {
  'use strict';
  const CONFIG = Object.freeze({ chance: .035, warningMs: 1800, activeMs: 22000,
    encounterCooldownMs: 90000, contactMs: 1100, damage: 8,
    speedCellsPerSecond: .65, contactRadiusCells: .7, pushCells: 1.5,
    pushMs: 350, turnMs: 1800, leashCells: 5, spawnDistanceCells: 2,
    activeFrameMs: 110, frameSize: 48, anchor: [24, 44] });

  function terrain(type) {
    const T = root.WorldGen.T;
    return [T.GRASS, T.PARK, T.PLAYGROUND, T.PITCH, T.SCHOOL].includes(type);
  }
  // `anyGround` drops the whirlwind's own grassy-terrain rule — a Scroll of
  // Wind's gust blows a foe across any ground the enemy gate allows.
  function ground(scene, x, y, from = null, anyGround = false) {
    const p = scene.cellAt(x, y);
    if (!p.loaded) return false;
    const W = root.WorldGen, entry = W.tileCache.get(W.tileKey(p.tx, p.ty));
    if (!entry?._spawnOpts || (!anyGround && !terrain(p.type))) return false;
    // The shared gate keeps roads, restricted land and KINDERGARTEN out;
    // SCHOOL is deliberately allowed, just as ordinary school fields are.
    // A pushed creature may occupy a reserved spawn seat. Allow it to leave
    // that cell without treating its own seat as a solid wall.
    const leavingSeat = from && p.tx === from.tx && p.ty === from.ty && p.ix === from.ix && p.iy === from.iy;
    const opts = leavingSeat ? { ...entry._spawnOpts, occupied: null } : entry._spawnOpts;
    return W.isSpawnCell(entry.grid, entry.cellsPerEdge, entry.cellsPerEdge,
      p.ix, p.iy, opts, 'enemy')
      && !W.privateVetoAt(p.tx, p.ty, p.ix, p.iy);
  }
  function frame(hazard, now) {
    const age = Math.max(0, now - hazard.born);
    return age < CONFIG.warningMs ? Math.min(3, Math.floor(age * 4 / CONFIG.warningMs))
      : 4 + Math.floor((age - CONFIG.warningMs) / CONFIG.activeFrameMs) % 4;
  }
  function create(point, now, rng, id) {
    return { id, x: point.x, y: point.y, homeX: point.x, homeY: point.y,
      born: now, phase: 'warning', frame: 0, heading: rng() * Math.PI * 2,
      nextTurn: now + CONFIG.warningMs, rng, contacts: new Map() };
  }
  function observe(scene, now) {
    const x = scene.startWorldM.x + scene.playerM.x, y = scene.startWorldM.y + scene.playerM.y;
    const p = scene.cellAt(x, y);
    if (!p.loaded) return;
    const entry = root.WorldGen.tileCache.get(root.WorldGen.tileKey(p.tx, p.ty));
    if (!entry?._spawnOpts) return; // Retry once the tile's spawn masks are ready.
    const key = `${utcDayKey()}:${p.tx}:${p.ty}:${p.ix}:${p.iy}`;
    const seen = scene._whirlwindVisits ||= new Set();
    if (seen.has(key)) return;
    seen.add(key);
    if (scene._whirlwinds.length || now < (scene._whirlwindNextEncounter || 0)
        || !ground(scene, x, y)) return;
    const rng = root.WorldGen.makeRng(fnv1a(`whirlwind:${key}`));
    if (rng() >= CONFIG.chance) return;
    const point = scene.findWalkableDestination(CONFIG.spawnDistanceCells,
      { seed: `whirlwind:${key}`, cls: 'enemy', accept: (wx, wy) => ground(scene, wx, wy) });
    if (!point) return;
    scene._whirlwinds.push(create(point, now, rng, `whirlwind:${key}`));
    scene._whirlwindNextEncounter = now + CONFIG.encounterCooldownMs;
  }

  // A forced move may not cross a road, building, private area or unloaded cell.
  // Quarter-cell sweeps also prevent a large timestep tunnelling through one.
  function sweep(scene, unit, dx, dy, anyGround = false) {
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / (scene.cellM * .25)));
    const from = scene.cellAt(unit.x, unit.y);
    let x = unit.x, y = unit.y;
    for (let i = 0; i < steps; i++) {
      const nx = x + dx / steps, ny = y + dy / steps;
      if (!ground(scene, nx, ny, from, anyGround)) break;
      x = nx; y = ny;
    }
    return { x, y };
  }
  // THE ONE KNOCKBACK: a whirlwind's contact, and a Scroll of Wind's gust
  // (opts: `cells` how far, `ms` over how long, `anyGround` past the
  // whirlwind's grass). A push plays out at the depth it began on.
  function impulse(scene, unit, hazard, now, player = false, opts = {}) {
    const x = player ? scene.startWorldM.x + scene.playerM.x : unit.x;
    const y = player ? scene.startWorldM.y + scene.playerM.y : unit.y;
    const angle = x === hazard.x && y === hazard.y ? hazard.heading : Math.atan2(y - hazard.y, x - hazard.x);
    const ms = opts.ms ?? CONFIG.pushMs;
    unit._whirlwindPush = { x: Math.cos(angle), y: Math.sin(angle),
      last: now, until: now + ms, depth: scene.depth, epoch: scene._whirlwindEpoch || 0,
      cells: opts.cells ?? CONFIG.pushCells, ms, anyGround: !!opts.anyGround };
    scene._whirlwindPushUntil = Math.max(scene._whirlwindPushUntil || 0, now + ms);
  }
  // Shared forced movement ledger for wind and physical dungeon traps.
  // Destination is absolute world BODY position; GPS remains untouched.
  function displacePlayer(scene, end) {
    const dx = end.x - scene.startWorldM.x - scene.playerM.x;
    const dy = end.y - scene.startWorldM.y - scene.playerM.y;
    const offset = scene._manualOffsetM ||= { x: 0, y: 0 };
    const target = scene._targetM ||= { ...scene.playerM };
    scene.playerM.x += dx; scene.playerM.y += dy;
    offset.x += dx; offset.y += dy;
    // Stop the old walk target pulling against the knockback. Reconcile
    // its abandoned lead with the same GPS-offset ledger as stick takeover.
    offset.x += scene.playerM.x - (target.x + dx);
    offset.y += scene.playerM.y - (target.y + dy);
    target.x = scene.playerM.x; target.y = scene.playerM.y;
    scene._lastStickT = Date.now(); scene._followPaused = false;
    return { x: dx, y: dy };
  }
  function pushStep(scene, unit, dt, now, player = false) {
    const push = unit._whirlwindPush;
    if (!push) return;
    if (push.depth !== scene.depth || push.epoch !== (scene._whirlwindEpoch || 0)) {
      unit._whirlwindPush = null; return;
    }
    // Integrate the elapsed slice, including the final partial frame. A hit
    // born this tick has no elapsed movement yet; cadence cannot add/remove
    // distance. Long suspended frames remain capped to avoid instant warps.
    const seconds = Math.min(.1, Math.max(0, (Math.min(now, push.until) - push.last) / 1000));
    push.last = now;
    if (now >= push.until) unit._whirlwindPush = null;
    if (!seconds) return;
    const x = player ? scene.startWorldM.x + scene.playerM.x : unit.x;
    const y = player ? scene.startWorldM.y + scene.playerM.y : unit.y;
    const distance = (push.cells ?? CONFIG.pushCells) * scene.cellM * seconds * 1000 / (push.ms ?? CONFIG.pushMs);
    const end = sweep(scene, { x, y }, push.x * distance, push.y * distance, push.anyGround);
    if (player) {
      displacePlayer(scene, end);
    } else {
      unit.x = end.x; unit.y = end.y;
      unit._startX = unit._targetX = unit.x; unit._startY = unit._targetY = unit.y;
      unit._stepT0 = unit._nextChooseT = now;
      unit._batFlight = null; unit._lungeUntil = unit._attackWindupUntil = null;
    }
  }
  function units(scene) {
    const found = new Set(), caught = new Set(scene.save.caught || []);
    const p = scene.playerToWorldCell();
    root.WorldGen.forEachItemNear('creatures', p.tx, p.ty, c => {
      if (!caught.has(c.id) && !c._surfaceInactive && !c._spent && root.Combat.hp(c) > 0) found.add(c);
    });
    for (const row of Object.values(root.Companions?.KINDS || {})) {
      const c = scene[row.instance];
      if (c && !c._spent && root.Combat.hp(c) > 0) found.add(c);
    }
    return found;
  }
  function contact(scene, hazard, unit, now, player = false) {
    const x = player ? scene.startWorldM.x + scene.playerM.x : unit.x;
    const y = player ? scene.startWorldM.y + scene.playerM.y : unit.y;
    if (Math.hypot(x - hazard.x, y - hazard.y) > CONFIG.contactRadiusCells * scene.cellM) return;
    const id = player ? scene : unit;
    if (now < (hazard.contacts.get(id) || 0)) return;
    hazard.contacts.set(id, now + CONFIG.contactMs);
    if (player) {
      const lost = scene._losePlayerEnergy(root.Combat.incomingDamage(scene.save, CONFIG.damage), { closeShop: true });
      if (lost > 0) scene._popEnergy(-lost);
    } else {
      // This existing environmental dispatcher also owns NPC rest, pet
      // retreat and summoned-companion recovery, not just enemy deaths.
      scene._damageBurningUnit(unit, CONFIG.damage, 'obstacle', now);
    }
    impulse(scene, unit, hazard, now, player);
  }
  function tick(scene, dt, now = performance.now()) {
    scene._whirlwinds ||= [];
    // A depth change cancels every push still under way (its epoch).
    if (scene._whirlwindDepth !== scene.depth) {
      if (scene._whirlwindDepth != null && (scene._whirlwinds.length || scene._whirlwindPushUntil))
        scene._whirlwindEpoch = (scene._whirlwindEpoch || 0) + 1;
      scene._whirlwindDepth = scene.depth;
      scene._whirlwindPush = null; scene._whirlwindPushUntil = 0;
    }
    if (scene.depth !== 0 || !scene.startWorldM) {
      // No whirlwinds below ground, but a gust read down here still blows.
      scene._whirlwinds.length = 0;
      if (scene.startWorldM && scene._whirlwindPushUntil) {
        dt = Math.min(.1, Math.max(0, dt));
        pushStep(scene, scene, dt, now, true);
        for (const c of units(scene)) pushStep(scene, c, dt, now);
        if (now >= scene._whirlwindPushUntil) scene._whirlwindPushUntil = 0;
      }
      return;
    }
    dt = Math.min(.1, Math.max(0, dt));
    observe(scene, now);
    if (!scene._whirlwinds.length && !scene._whirlwindPushUntil) return;
    const live = units(scene);
    scene._whirlwinds = scene._whirlwinds.filter(h => now - h.born < CONFIG.warningMs + CONFIG.activeMs);
    for (const h of scene._whirlwinds) {
      h.frame = frame(h, now);
      if (now - h.born < CONFIG.warningMs) continue;
      h.phase = 'active';
      if (now >= h.nextTurn) {
        h.heading += (h.rng() - .5) * Math.PI;
        if (Math.hypot(h.x - h.homeX, h.y - h.homeY) > CONFIG.leashCells * scene.cellM)
          h.heading = Math.atan2(h.homeY - h.y, h.homeX - h.x);
        h.nextTurn = now + CONFIG.turnMs;
      }
      const distance = CONFIG.speedCellsPerSecond * scene.cellM * dt;
      const end = sweep(scene, h, Math.cos(h.heading) * distance, Math.sin(h.heading) * distance);
      if (end.x === h.x && end.y === h.y) h.heading += Math.PI / 2;
      h.x = end.x; h.y = end.y;
      if (!root.Combat.playerDowned(scene.save.energy)) contact(scene, h, scene, now, true);
      for (const c of live) contact(scene, h, c, now);
    }
    pushStep(scene, scene, dt, now, true);
    for (const c of live) pushStep(scene, c, dt, now);
    if (now >= (scene._whirlwindPushUntil || 0)) scene._whirlwindPushUntil = 0;
  }
  root.Whirlwinds = { CONFIG, terrain, ground, frame, create, observe, sweep, impulse, displacePlayer, pushStep, contact, tick };
})(typeof globalThis !== 'undefined' ? globalThis : this);
