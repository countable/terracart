// A furnished neighbour's help. Persistent clocks use epoch time; walking
// uses the creature simulation clock and integrates foreground time only.
const NPCBenefits = (() => {
  const HOUR_MS = 60 * 60 * 1000;
  const MINUTE_MS = 60 * 1000;
  const RANGE_CELLS = 15;
  const WATER_INTERVAL_MS = 1200;
  const GIFTS = Object.freeze({
    warden: { id: 'wood', label: 'Wood', line: 'I saved some timber for you.' },
    witness: { id: 'apple', label: 'Apple', line: 'I put aside something to eat.' },
    believer: { id: 'flowers', label: 'Flowers', line: 'A few flowers to brighten your day.' },
    archaeologist: { id: 'rubble', label: 'Rock', line: 'Useful stone from my digging. No potsherds, I checked.' },
    resident: { id: 'berry', label: 'Berry', line: 'A little something from your neighbour.' },
  });
  const dayOf = now => new Date(now).toISOString().slice(0, 10);
  function homeOf(scene, c) {
    return c?.kind === 'npc' && (scene.depth || 0) === 0 ? scene.save?.npcHomes?.[c.id] : null;
  }
  function luxuryOf(scene, c) {
    const home = homeOf(scene, c);
    return home?.houseId ? Furniture.luxuryOf(scene.save, home.houseId) : 0;
  }
  // Chores belong to a loaded home, even when its resident walks beyond the
  // player's ordinary creature bubble. Keep this exception specific to Tilly
  // so distant enemies and ordinary neighbours retain their simulation cap.
  function shouldSimulate(scene, c) {
    if (c?.kind !== 'npc' || c.role !== 'wanderer') return false;
    const home = homeOf(scene, c);
    if (!home?.houseId || (!c._npcBenefitReturning && !scene.save.npcBenefits?.[c.id]?.wateringUntil
      && luxuryOf(scene, c) <= 0)) return false;
    const centre = centreOf(home, c);
    return Number.isFinite(centre.x) && Number.isFinite(centre.y)
      && !!scene.cellAt(centre.x, centre.y).loaded;
  }
  function stateOf(scene, c) {
    const states = scene.save.npcBenefits ||= {};
    if (!states[c.id] || typeof states[c.id] !== 'object') states[c.id] = {};
    return states[c.id];
  }
  function centreOf(home, c) {
    return { x: home.houseX ?? c._homeHouseX ?? home.x ?? c.homeX ?? c.x,
      y: home.houseY ?? c._homeHouseY ?? home.y ?? c.homeY ?? c.y };
  }
  function dryCrops(scene, home, c) {
    const centre = centreOf(home, c), radius = RANGE_CELLS * scene.cellM, crops = [];
    Crops.forEachInBox(scene.save, 0, centre.x - radius, centre.y - radius,
      centre.x + radius, centre.y + radius, p => {
        if (!p.watered_t && !Crops.isMature(p)
          && Math.hypot(p.x - centre.x, p.y - centre.y) <= radius) crops.push(p);
      });
    return crops;
  }
  // Work may leave the ordinary four-cell stroll, but never the NPC spawn
  // gate, roads, fire, traps or the shared character movement sweep.
  function allows(scene, c, home, x, y) {
    const cell = scene.cellAt(x, y), centre = centreOf(home, c);
    if (!cell.loaded || cell.underRoad || Combat.faunaBlocksCell(cell.type) || WorldGen.isRoadTerrain(cell.type)
      || Math.hypot(x - centre.x, y - centre.y) > (RANGE_CELLS + NPC.WANDER_CELLS + 2) * scene.cellM) return false;
    const entry = WorldGen.tileCache.get(WorldGen.tileKey(cell.tx, cell.ty));
    return !!entry && WorldGen.isSpawnCell(entry.grid, entry.cellsPerEdge, entry.cellsPerEdge,
      cell.ix, cell.iy, WorldGen.spawnOptsOf(entry), 'npc') && !creatureStepRefused(scene, c, x, y);
  }
  // One bounded breadth-first search finds the nearest reachable watering
  // seat. Goals sit on the crop or its cardinal neighbours, never across a
  // wall just because the crop is close in metres. Coordinate helpers retain
  // correct neighbours across tiles with different grid resolutions.
  function route(scene, c, home, crops, returning = false) {
    const goals = new Map(), key = p => cellKeyFromAbsCell(p.cellIX, p.cellIY);
    if (returning) {
      goals.set(key(worldMetersToAbsCell(scene, home.x, home.y)), null);
    } else for (const crop of crops) {
      const cell = worldMetersToAbsCell(scene, crop.x, crop.y);
      for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const seat = absCellOffset(scene, cell.cellIX, cell.cellIY, dx, dy);
        goals.set(key(seat), crop);
      }
    }
    const start = worldMetersToAbsCell(scene, c.x, c.y), queue = [{ ...start, parent: -1 }];
    const seen = new Set([key(start)]);
    for (let i = 0; i < queue.length && i < 1600; i++) {
      const current = queue[i], k = key(current);
      if (goals.has(k)) {
        const path = [];
        for (let j = i; j >= 0; j = queue[j].parent) path.push(absCellCenterMeters(scene, queue[j].cellIX, queue[j].cellIY));
        return { path: path.reverse(), crop: goals.get(k), returning };
      }
      for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
        const next = absCellOffset(scene, current.cellIX, current.cellIY, dx, dy), nk = key(next);
        if (seen.has(nk)) continue;
        seen.add(nk);
        const point = absCellCenterMeters(scene, next.cellIX, next.cellIY);
        if (allows(scene, c, home, point.x, point.y)) queue.push({ ...next, parent: i });
      }
    }
    return null;
  }
  function persist(scene) { Save.persist(scene.save); }
  function tick(scene, c, now, dt, epoch = Date.now()) {
    const home = homeOf(scene, c);
    if (c.role !== 'wanderer' || !home?.houseId) return false;
    const luxury = luxuryOf(scene, c), state = stateOf(scene, c);
    if (state.wateringUntil && (state.wateringUntil <= epoch || luxury <= 0)) {
      state.nextWateringAt = state.wateringUntil + HOUR_MS;
      state.wateringUntil = 0;
      c._npcBenefitRoute = null;
      c._npcBenefitReturning = true;
      persist(scene);
    }
    let crops;
    if (!state.wateringUntil && luxury > 0 && epoch >= (state.nextWateringAt || 0)) {
      crops = dryCrops(scene, home, c);
      if (crops.length) {
        state.wateringUntil = epoch + luxury * MINUTE_MS;
        c._npcBenefitReturning = false;
        c._npcBenefitRoute = null;
        persist(scene);
      }
    }
    const working = state.wateringUntil > epoch;
    if (!working && !c._npcBenefitReturning) return false;
    // A paused tab expires a run but never waters, moves or earns missed
    // progress. Even an active run advances at most one ordinary frame.
    dt = Math.min(0.1, Math.max(0, dt || 0));
    c._moving = false;
    if (!(dt > 0)) return true;
    if (!working && Math.hypot(c.x - home.x, c.y - home.y) <= scene.cellM) {
      c._npcBenefitReturning = false;
      c._npcBenefitRoute = null;
      c._npcSteps = 0;
      return false;
    }
    let trip = c._npcBenefitRoute;
    if (!trip || trip.crop?.watered_t || (trip.crop && Crops.isMature(trip.crop))) {
      if (now < (c._npcBenefitRetryAt || 0)) return true;
      c._npcBenefitRetryAt = now + 1000;
      const targets = working ? crops || dryCrops(scene, home, c) : [];
      if (working && !targets.length) { c._npcBenefitRoute = null; return true; }
      trip = c._npcBenefitRoute = route(scene, c, home, targets, !working);
      if (!trip) return true;
    }
    while (trip.path.length && Math.hypot(c.x - trip.path[0].x, c.y - trip.path[0].y) < 0.08) trip.path.shift();
    if (trip.path.length) {
      const target = trip.path[0], step = NPC.WALK_MPS * dt * Combat.paceMul(c);
      c._moving = characterMove(scene, c, target.x, target.y, now,
        { pace: step, allow: (x, y) => allows(scene, c, home, x, y) });
      if (!c._moving) c._npcBenefitRoute = null;
      return true;
    }
    if (working && trip.crop && now >= (c._npcBenefitWaterAt || 0)) {
      const crop = trip.crop;
      if ((scene.save.planted || []).includes(crop) && !PlacedFloor.placedDepth(crop)
        && Crops.waterOne(scene.save, crop, null, epoch)) {
        state.wateredDay = dayOf(epoch);
        state.wateredAt = epoch;
        scene._burstAtWorld?.('water', crop.x, crop.y);
        persist(scene);
      }
      c._npcBenefitWaterAt = now + WATER_INTERVAL_MS;
      c._npcBenefitRoute = null;
    }
    return true;
  }
  function summary(scene, c) {
    const luxury = luxuryOf(scene, c);
    if (!homeOf(scene, c)?.houseId) return '';
    if (c.role === 'wanderer') return `Tilly waters crops within ${RANGE_CELLS} cells of home for ${luxury} minute${luxury === 1 ? '' : 's'} per round, resting an hour between rounds.`;
    const gift = GIFTS[c.role] || GIFTS.resident;
    return `${luxury} ${gift.label} each day. Visit or talk to collect.`;
  }
  function dialogue(scene, c, now = Date.now()) {
    if (!homeOf(scene, c)?.houseId) return '';
    const state = scene.save.npcBenefits?.[c.id];
    if (c.role === 'wanderer') return state?.wateredDay === dayOf(now)
      ? 'Hey, I watered your crops today.' : summary(scene, c);
    return summary(scene, c);
  }
  function visit(scene, c, now = Date.now()) {
    const luxury = luxuryOf(scene, c);
    if (!homeOf(scene, c)?.houseId || NPC.isDormant(c, now)) return { message: '' };
    if (c.role === 'wanderer') return { message: dialogue(scene, c, now) };
    const gift = GIFTS[c.role] || GIFTS.resident, state = stateOf(scene, c), day = dayOf(now);
    const collected = state.giftDay === day ? Math.max(0, state.giftCollected || 0) : 0;
    // Once today's entitlement is fixed, adding or removing furniture cannot
    // re-roll it. A full bag keeps the uncollected portion available today, so
    // the first visit that evaluates the day pins its quantity, accepted or not.
    const quantity = state.giftDay === day && Number.isFinite(state.giftQuantity)
      ? state.giftQuantity : Math.floor(luxury);
    if (state.giftDay !== day || !Number.isFinite(state.giftQuantity)) {
      Object.assign(state, { giftDay: day, giftQuantity: quantity, giftCollected: collected });
      persist(scene);
    }
    const wanted = Math.max(0, quantity - collected), room = Inventory.roomFor(scene.save, gift.id);
    const accepted = wanted > 0 && room > 0
      ? scene.addToInv(gift.id, Math.min(wanted, room), false, { notWild: true }) : 0;
    if (accepted > 0) {
      Object.assign(state, { giftCollected: collected + accepted });
      persist(scene);
      return { message: `${gift.line}\n+${accepted} ${gift.label}`, id: gift.id, qty: accepted };
    }
    return { message: wanted > 0 ? `I have ${wanted} ${gift.label} for you. Make a little room in your bag.`
      : collected > 0 ? 'That was today’s gift. Come by tomorrow.' : summary(scene, c), qty: 0 };
  }
  return { HOUR_MS, MINUTE_MS, RANGE_CELLS, WATER_INTERVAL_MS, GIFTS,
    luxuryOf, shouldSimulate, tick, summary, dialogue, visit, claim: visit };
})();
