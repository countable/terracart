// First-floor pressure plates launch a single slow trap along its chosen line.
(function (root) {
  'use strict';
  const CONFIG = Object.freeze({ chance: .065, maxPresent: 8, retainRadiusCells: 24,
    speedCellsPerSecond: .25, pushCellsPerSecond: .4, travelCells: 6,
    contactDps: 5, frameSize: 24, ballRadiusPixels: 10, ballFrames: 8, maxStepSeconds: .1,
    ballContactCells: .62, wallHalfWidthCells: .62, wallHalfDepthCells: .35 });
  const DIRECTIONS = [[0, -1], [Math.SQRT1_2, -Math.SQRT1_2], [1, 0], [Math.SQRT1_2, Math.SQRT1_2],
    [0, 1], [-Math.SQRT1_2, Math.SQRT1_2], [-1, 0], [-Math.SQRT1_2, -Math.SQRT1_2]];
  function lists(scene) {
    scene._pressureTraps ||= { plates: [], traps: [], visits: new Set() };
    return root.WorldGen.floorProfile(scene.depth).pressureTraps ? scene._pressureTraps : { plates: [], traps: [] };
  }
  function feet(scene) {
    return { x: scene.startWorldM.x + scene.playerM.x,
      y: scene.startWorldM.y + scene.playerM.y + (scene.feetOffsetM || 0) };
  }
  function ground(scene, x, y) {
    if (!root.WorldGen.floorProfile(scene.depth).pressureTraps) return false;
    const p = scene.cellAt(x, y), W = root.WorldGen;
    if (!p.loaded || p.type !== W.T.CAVE_FLOOR) return false;
    const e = W.tileCache.get(W.tileKey(p.tx, p.ty));
    if (!e?._spawnOpts) return false;
    const opts = { ...e._spawnOpts, spawnWhy: e.spawnWhy || e._spawnOpts.spawnWhy,
      roadMask: e.roadMask || e._spawnOpts.roadMask, roadClass: e.roadClass || e._spawnOpts.roadClass };
    return W.isSpawnCell(e.grid, e.cellsPerEdge, e.cellsPerEdge, p.ix, p.iy, opts, 'enemy')
      && !W.privateVetoAt(p.tx, p.ty, p.ix, p.iy);
  }
  function clearSegment(scene, from, to) {
    const n = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / (scene.cellM * .25)));
    let point = { x: from.x, y: from.y };
    for (let i = 1; i <= n; i++) {
      const x = from.x + (to.x - from.x) * i / n, y = from.y + (to.y - from.y) * i / n;
      if (!ground(scene, x, y)) break;
      point = { x, y };
    }
    return point;
  }
  function create(scene, plateCell, launcherCell, kind, id) {
    const p = absCellCenterMeters(scene, plateCell.cellIX, plateCell.cellIY);
    const at = absCellCenterMeters(scene, launcherCell.cellIX, launcherCell.cellIY);
    const plate = { id: id + ':plate', trapId: id, ...p, ...plateCell, pressed: false, frame: 2 };
    const trap = { id, kind, ...at, state: 'parked', frame: 0, direction: 0, travelled: 0, elapsedMs: 0 };
    return { plate, trap };
  }
  function observe(scene) {
    if (!root.WorldGen.floorProfile(scene.depth).pressureTraps) return;
    const s = lists(scene), p = feet(scene), cell = scene.cellAt(p.x, p.y);
    if (!cell.loaded || !ground(scene, p.x, p.y)) return;
    const retained = new Set();
    s.traps = s.traps.filter(h => {
      const keep = Math.hypot(h.x - p.x, h.y - p.y) <= CONFIG.retainRadiusCells * scene.cellM
        && scene.cellAt(h.x, h.y).loaded;
      if (keep) retained.add(h.id);
      else if (h.state === 'parked') s.visits.delete(h.visitKey);
      return keep;
    });
    s.plates = s.plates.filter(h => retained.has(h.trapId));
    const key = `${cell.tx}:${cell.ty}:${cell.ix}:${cell.iy}`;
    if (s.visits.has(key) || s.traps.length >= CONFIG.maxPresent) return;
    s.visits.add(key);
    const rng = root.WorldGen.makeRng(fnv1a('pressure:' + key));
    if (rng() >= CONFIG.chance) return;
    const kind = rng() < .5 ? 'ball' : 'wall';
    for (let attempt = 0; attempt < 12; attempt++) {
      const facing = Math.floor(rng() * 4) * 2, [dx, dy] = DIRECTIONS[facing];
      const plateCell = absCellOffset(scene, cell.cellIX, cell.cellIY, dx * 2, dy * 2);
      const distance = 2 + Math.min(2, Math.floor(rng() * 3));
      const launcherCell = absCellOffset(scene, plateCell.cellIX, plateCell.cellIY, dx * distance, dy * distance);
      const pair = create(scene, plateCell, launcherCell, kind, 'pressure:' + key);
      const candidates = [plateCell, launcherCell]
        .map(at => root.EnvironmentHazards.create(scene, 'vent', at, 'placement'));
      if (!candidates.every(h => root.EnvironmentHazards.eligible(scene, h))) continue;
      const end = clearSegment(scene, pair.trap, pair.plate);
      if (Math.hypot(end.x - pair.plate.x, end.y - pair.plate.y) > .001) continue;
      const env = root.EnvironmentHazards.lists(scene);
      if ([...s.plates, ...s.traps, ...env.vents, ...env.sinkholes, ...env.caveins].some(h =>
        Math.hypot(h.x - pair.plate.x, h.y - pair.plate.y) < scene.cellM * 1.5
        || Math.hypot(h.x - pair.trap.x, h.y - pair.trap.y) < scene.cellM * 1.5)) continue;
      pair.trap.visitKey = key;
      s.plates.push(pair.plate);
      s.traps.push(pair.trap);
      break;
    }
  }
  function trigger(trap, target) {
    if (trap.state !== 'parked') return;
    const dx = target.x - trap.x, dy = target.y - trap.y;
    let direction = (Math.round(Math.atan2(dx, -dy) * 4 / Math.PI) + 8) % 8;
    if (trap.kind === 'wall') direction = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 2 : 6) : (dy > 0 ? 4 : 0);
    trap.direction = direction;
    if (trap.kind === 'wall') [trap.vx, trap.vy] = DIRECTIONS[direction];
    else {
      const d = Math.hypot(dx, dy) || 1;
      trap.vx = dx / d;
      trap.vy = dy / d;
    }
    trap.state = 'moving';
    trap.frame = trap.kind === 'wall' ? direction / 2 : (direction % 4) * CONFIG.ballFrames;
  }
  function ballFrame(trap, cellM) {
    const circumference = 2 * Math.PI * CONFIG.ballRadiusPixels / CONFIG.frameSize * cellM;
    const phase = Math.floor(trap.travelled / circumference * CONFIG.ballFrames) % CONFIG.ballFrames;
    const directed = trap.direction >= 4 ? (CONFIG.ballFrames - phase) % CONFIG.ballFrames : phase;
    return (trap.direction % 4) * CONFIG.ballFrames + directed;
  }
  function touching(scene, trap) {
    const p = feet(scene), dx = (p.x - trap.x) / scene.cellM, dy = (p.y - trap.y) / scene.cellM;
    if (trap.kind === 'ball') return Math.hypot(dx, dy) <= CONFIG.ballContactCells;
    return Math.abs(dx * trap.vx + dy * trap.vy) <= CONFIG.wallHalfDepthCells
      && Math.abs(dx * trap.vy - dy * trap.vx) <= CONFIG.wallHalfWidthCells;
  }
  function contact(scene, trap, dt) {
    if (root.Conditions.flying(scene.save)) { scene._pressureDamageFraction = 0; return; }
    if (trap.state === 'parked' || !touching(scene, trap) || root.Combat.playerDowned(scene.save.energy)) return;
    if (!root.Conditions.damageImmune(scene.save)) {
      const damage = bankWhole(scene, '_pressureDamageFraction', CONFIG.contactDps * dt);
      if (damage > 0) {
        const lost = scene._losePlayerEnergy(damage, { closeShop: true });
        if (lost > 0) scene._popEnergy(-lost);
      }
    } else scene._pressureDamageFraction = 0;
    // A stopped trap can hurt on contact, but cannot propel the player.
    if (trap.state !== 'moving') return;
    const p = feet(scene), distance = CONFIG.pushCellsPerSecond * scene.cellM * dt;
    const end = clearSegment(scene, p, { x: p.x + trap.vx * distance, y: p.y + trap.vy * distance });
    root.Whirlwinds.displacePlayer(scene, { x: end.x, y: end.y - (scene.feetOffsetM || 0) });
  }
  function tick(scene, dt) {
    if (!root.WorldGen.floorProfile(scene.depth).pressureTraps || !scene.startWorldM || !Number.isFinite(dt) || dt <= 0) return;
    dt = Math.min(CONFIG.maxStepSeconds, dt);
    observe(scene);
    const s = lists(scene), p = feet(scene), cell = scene.cellAt(p.x, p.y);
    for (const plate of s.plates) {
      if (!root.Conditions.flying(scene.save) && plate.cellIX === cell.cellIX && plate.cellIY === cell.cellIY && !plate.pressed) {
        plate.pressed = true;
        plate.frame = 3;
        const trap = s.traps.find(h => h.id === plate.trapId);
        if (trap) trigger(trap, p);
      }
    }
    for (const h of s.traps) {
      if (h.state === 'moving') {
        const distance = Math.min(CONFIG.speedCellsPerSecond * scene.cellM * dt,
          Math.max(0, CONFIG.travelCells * scene.cellM - h.travelled));
        const end = clearSegment(scene, h, { x: h.x + h.vx * distance, y: h.y + h.vy * distance });
        const moved = Math.hypot(end.x - h.x, end.y - h.y);
        h.x = end.x;
        h.y = end.y;
        h.travelled += moved;
        h.elapsedMs += dt * 1000;
        if (moved < distance - .00001 || h.travelled >= CONFIG.travelCells * scene.cellM - .00001) h.state = 'spent';
        if (h.kind === 'ball') h.frame = ballFrame(h, scene.cellM);
      }
      contact(scene, h, dt);
    }
  }
  root.PressureTraps = { CONFIG, DIRECTIONS, lists, feet, ground, clearSegment, create, observe,
    trigger, ballFrame, touching, contact, tick };
})(typeof globalThis !== 'undefined' ? globalThis : this);
