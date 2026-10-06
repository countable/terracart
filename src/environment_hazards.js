// Foreground-only hazard clocks. Placement uses canonical cells and the shared spawn gate.
(function (root) {
  'use strict';
  const CONFIG = Object.freeze({ contactMs: 1000, damage: 8, maxStepMs: 100,
    vent: Object.freeze({ chance: .12, inactiveMs: 5000, warningMs: 3000, activeMs: 3000,
      frameSize: 24, renderAnchor: [0.5, 18.5 / 24], widthCells: 1, heightCells: 1, maxPresent: 24, retainRadiusCells: 24 }),
    sinkhole: Object.freeze({ chance: .035, warningMs: 5000, openingMs: 240, openMinMs: 5000, openMaxMs: 20000,
      closingMs: 600, frameSize: 48, renderAnchor: [0.5, 0.5], widthCells: 2, heightCells: 2, maxPresent: 2 }),
  });
  const VENTS = Object.freeze({ poison: { row: 0, condition: 'poison', durationMs: 30000 },
    fire: { row: 1, condition: 'burning', durationMs: 6000 },
    paralysis: { row: 2, condition: 'paralysis', durationMs: 5000 } });
  function state(scene) {
    scene._environmentHazards ||= new Map();
    const depth = scene.depth || 0;
    if (!scene._environmentHazards.has(depth)) scene._environmentHazards.set(depth,
      { vents: [], sinkholes: [], visits: new Set(), elapsedMs: 0 });
    return scene._environmentHazards.get(depth);
  }
  function lists(scene) { return state(scene); }
  function footprint(scene, h) {
    const cells = [];
    for (let y = 0; y < h.heightCells; y++) for (let x = 0; x < h.widthCells; x++) {
      const abs = absCellOffset(scene, h.cellIX, h.cellIY, x, y);
      const point = absCellCenterMeters(scene, abs.cellIX, abs.cellIY);
      cells.push({ ...scene.cellAt(point.x, point.y), ...abs, ...point });
    }
    return cells;
  }
  function suitable(type, depth) {
    const T = root.WorldGen.T;
    return depth > 0 ? type === T.CAVE_FLOOR
      : [T.GRASS, T.FOREST, T.PARK, T.ROCK, T.SAND, T.WETLAND].includes(type);
  }
  function eligible(scene, h, checkCharacters = true) {
    const W = root.WorldGen;
    if (h.depth !== scene.depth || (h.type === 'vent' && !scene.depth)) return false;
    const arenaDepth = W.ARENA_DEPTH;
    if (h.type === 'sinkhole' && (h.depth === arenaDepth || h.depth + 1 === arenaDepth)) return false;
    // Nothing falls out of a sealed floor (DungeonProgression.ROPE_SEALED_FLOORS,
    // docs/design/floors.md): its descent is gated - elevator, dig or key.
    if (h.type === 'sinkhole' && root.DungeonProgression && !root.DungeonProgression.ropeCanDescend(h.depth)) return false;
    return footprint(scene, h).every(p => {
      if (!p.loaded || !suitable(p.type, scene.depth)) return false;
      const e = W.tileCache.get(W.tileKey(p.tx, p.ty));
      if (!e?._spawnOpts) return false;
      const opts = { ...e._spawnOpts, spawnWhy: e.spawnWhy || e._spawnOpts.spawnWhy,
        roadMask: e.roadMask || e._spawnOpts.roadMask, roadClass: e.roadClass || e._spawnOpts.roadClass };
      if (!W.isSpawnCell(e.grid, e.cellsPerEdge, e.cellsPerEdge, p.ix, p.iy, opts, 'enemy')) return false;
      if (W.privateVetoAt(p.tx, p.ty, p.ix, p.iy)) return false;
      // Live placed structures may be newer than the generated occupancy mask.
      const occupied = o => { const at = scene.cellAt(o.x, o.y); return at.cellIX === p.cellIX && at.cellIY === p.cellIY; };
      if ((e.objects || []).some(occupied)) return false;
      return !checkCharacters || !(e.creatures || []).some(c => !c._spent && !c._surfaceInactive && occupied(c));
    });
  }
  function create(scene, type, cell, id, rng = () => .5, kind = 'poison') {
    const cfg = CONFIG[type];
    const h = { id, type, kind, depth: scene.depth, cellIX: cell.cellIX, cellIY: cell.cellIY,
      cellM: scene.cellM, widthCells: cfg.widthCells, heightCells: cfg.heightCells, elapsedMs: 0, nextContactMs: 0,
      phase: type === 'vent' ? 'inactive' : 'warning', frame: 0 };
    if (type === 'sinkhole') h.openMs = cfg.openMinMs + Math.floor(rng() * (cfg.openMaxMs - cfg.openMinMs + 1));
    const cells = footprint(scene, h), first = cells[0], last = cells.at(-1);
    h.x = (first.x + last.x) / 2; h.y = (first.y + last.y) / 2;
    h.footprintCells = cells.map(({ cellIX, cellIY }) => ({ cellIX, cellIY }));
    update(h); return h;
  }
  function update(h) {
    const t = h.elapsedMs, c = CONFIG[h.type];
    if (h.type === 'vent') {
      const phase = t % (c.inactiveMs + c.warningMs + c.activeMs);
      h.phase = phase < c.inactiveMs ? 'inactive' : phase < c.inactiveMs + c.warningMs ? 'warning' : 'active';
      const col = h.phase === 'inactive' ? 0 : h.phase === 'warning'
        ? 1 + Math.min(1, Math.floor((phase - c.inactiveMs) / (c.warningMs / 2)))
        : 3 + Math.floor((phase - c.inactiveMs - c.warningMs) / 180) % 2;
      h.frame = VENTS[h.kind].row * 5 + col;
    } else {
      const openAt = c.warningMs + c.openingMs, closeAt = openAt + h.openMs;
      h.phase = t < c.warningMs ? 'warning' : t < openAt ? 'opening' : t < closeAt ? 'open'
        : t < closeAt + c.closingMs ? 'closing' : 'closed';
      h.frame = h.phase === 'warning' ? Math.min(2, Math.floor(t * 3 / c.warningMs))
        : h.phase === 'opening' ? 3 + Math.min(1, Math.floor((t - c.warningMs) * 2 / c.openingMs))
        : h.phase === 'open' ? 5 + Math.floor((t - openAt) / 220) % 2
        : h.phase === 'closing' ? 7 + Math.min(3, Math.floor((t - closeAt) * 4 / c.closingMs)) : 11;
    }
    return h.frame;
  }
  function overlaps(scene, h) {
    const p = scene.cellAt(scene.startWorldM.x + scene.playerM.x, scene.startWorldM.y + scene.playerM.y + (scene.feetOffsetM || 0));
    return (h.footprintCells || footprint(scene, h)).some(c => c.cellIX === p.cellIX && c.cellIY === p.cellIY);
  }
  function observe(scene) {
    const s = state(scene), px = scene.startWorldM.x + scene.playerM.x,
      py = scene.startWorldM.y + scene.playerM.y + (scene.feetOffsetM || 0), at = scene.cellAt(px, py);
    if (!at.loaded) return;
    const key = `${scene.depth}:${at.tx}:${at.ty}:${at.ix}:${at.iy}`;
    const e = root.WorldGen.tileCache.get(root.WorldGen.tileKey(at.tx, at.ty));
    if (!e?._spawnOpts) return;
    // Keep the vent budget local. A deterministic evicted seat can be
    // rediscovered in its harmless inactive phase when the player returns.
    s.vents = s.vents.filter(h => {
      const keep = Math.hypot(h.x - px, h.y - py) <= CONFIG.vent.retainRadiusCells * scene.cellM
        && scene.cellAt(h.x, h.y).loaded;
      if (!keep && h.visitKey) s.visits.delete(h.visitKey);
      return keep;
    });
    for (const type of ['vent', 'sinkhole']) {
      if (type === 'vent' && !scene.depth) continue;
      const visitKey = `${type}:${key}`;
      if (s.visits.has(visitKey)) continue;
      const cfg = CONFIG[type], list = type === 'vent' ? s.vents : s.sinkholes;
      if (list.length >= cfg.maxPresent) continue;
      s.visits.add(visitKey);
      const id = `environment:${type}:${key}`, rng = root.WorldGen.makeRng(fnv1a(id));
      if (rng() >= cfg.chance) continue;
      const kind = Object.keys(VENTS)[Math.min(2, Math.floor(rng() * 3))];
      for (let attempt = 0; attempt < 12; attempt++) {
        const cell = absCellOffset(scene, at.cellIX, at.cellIY, Math.floor(rng() * 5) - 2, Math.floor(rng() * 5) - 2);
        const h = create(scene, type, cell, id, rng, kind);
        if (!eligible(scene, h)) continue;
        const cells = new Set(footprint(scene, h).map(c => `${c.cellIX}:${c.cellIY}`));
        if ([...s.vents, ...s.sinkholes].some(other => footprint(scene, other).some(c => cells.has(`${c.cellIX}:${c.cellIY}`)))) continue;
        const pressure = scene._pressureTraps;
        if ([...(pressure?.plates || []), ...(pressure?.traps || [])].some(other => {
          const c = scene.cellAt(other.x, other.y);
          return cells.has(`${c.cellIX}:${c.cellIY}`);
        })) continue;
        h.visitKey = visitKey; list.push(h); break;
      }
    }
  }
  function tick(scene, dt) {
    if (!scene.startWorldM || !scene.playerM || !Number.isFinite(dt) || dt <= 0) return;
    const s = state(scene), ms = Math.min(CONFIG.maxStepMs, dt * 1000);
    s.elapsedMs += ms; observe(scene);
    for (const h of [...s.vents, ...s.sinkholes]) {
      const before = h.phase;
      h.elapsedMs += ms; update(h);
      const touching = overlaps(scene, h);
      const contactDue = touching && (h.type === 'vent' ? h.phase === 'active' && h.elapsedMs >= h.nextContactMs
        : h.phase === 'open' && !h.fallTriggered && !h.fallPending && h.elapsedMs >= (h.nextFallMs || 0));
      // Scan live object lists at most once per second while idle. A phase
      // becoming dangerous or a contact always rechecks the whole footprint.
      if (h.elapsedMs >= (h.nextValidationMs || 0) || contactDue
          || (before !== h.phase && ['opening', 'open', 'active'].includes(h.phase))) {
        h.nextValidationMs = h.elapsedMs + CONFIG.contactMs;
        if (footprint(scene, h).every(c => c.loaded) && !eligible(scene, h, false)) {
          h.blocked = true; h.phase = 'closed'; continue;
        }
      }
      if (!touching || root.Combat.playerDowned(scene.save.energy)) continue;
      if (h.type === 'vent' && h.phase === 'active' && h.elapsedMs >= h.nextContactMs) {
        h.nextContactMs = h.elapsedMs + CONFIG.contactMs;
        const now = Date.now();
        const damage = h.kind === 'fire' ? root.Conditions.fireDamage(scene.save, CONFIG.damage, now)
          : root.Conditions.damageImmune(scene.save, now) ? 0 : root.Combat.incomingDamage(scene.save, CONFIG.damage);
        const lost = damage > 0 ? scene._losePlayerEnergy(damage, { closeShop: true }) : 0;
        if (lost > 0) scene._popEnergy(-lost);
        const v = VENTS[h.kind];
        root.Conditions.apply(scene.save, v.condition, now, { durationMs: v.durationMs });
      } else if (h.type === 'sinkhole' && h.phase === 'open' && !h.fallTriggered
          && !h.fallPending && !scene._hazardFallPending && h.elapsedMs >= (h.nextFallMs || 0)) {
        h.fallPending = true;
        h.nextFallMs = h.elapsedMs + CONFIG.contactMs;
        Promise.resolve(root.HazardFalls.fall(scene, h)).then(ok => { h.fallTriggered = ok === true; })
          .catch(() => {}).finally(() => { h.fallPending = false; });
        break; // A depth transition must not process the old floor again.
      }
    }
    s.vents = s.vents.filter(h => !h.blocked);
    s.sinkholes = s.sinkholes.filter(h => h.phase !== 'closed');
  }
  root.EnvironmentHazards = { CONFIG, VENTS, state, lists, footprint, suitable, eligible, create, update, overlaps, observe, tick };
})(typeof globalThis !== 'undefined' ? globalThis : this);
