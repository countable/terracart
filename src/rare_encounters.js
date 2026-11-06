// Visit-owned encounters are deliberately absent from ambient density pools.
(function (root) {
  'use strict';
  const rows = [];
  // Per-visit odds (owner, Nov 2026: every rate doubled from .15/.35/.6). A
  // rare encounter is never certain, so the former .6 rows stop at .9.
  const add = (kind, owners, extra = {}) => rows.push(Object.freeze({ kind, owners, chance: .3, ...extra }));
  add('thorn_ball', ['Roads and paths:berry'], { trigger: true });
  add('dire_toad', ['Roads and paths:causeway'], { water: true });
  add('sproutling', ['Roads and paths:overgrown']);
  add('wolfling', ['Nexus:meadow']);
  add('butterfairy', ['Terrain:SCHOOL'], { chance: .9 });
  add('nighthop', ['tar'], { night: true });
  add('fungusaur', ['Terrain:WETLAND']);
  add('corrupticore', ['Terrain:RESIDENTIAL']);
  add('tidal_force', ['Nexus:mystic_reef'], { water: true });
  add('leviathan', ['Nexus:pirate_cove'], { water: true, chance: .7 });
  add('lichling', ['stones'], { chance: .9 });
  add('velox', ['Terrain:FOREST', 'Nexus:ancient_grove']);
  add('watcher', ['Roads and paths:promenade']);
  add('gremling', ['Terrain:COMMERCIAL']);
  add('tortadon', ['Roads and paths:pottery']);
  add('swordasaurus', ['Nexus:quarry-stronghold']);
  add('spectrus', ['Terrain:RESIDENTIAL'], { rain: true, chance: .9 });
  add('roc', ['Nexus:marine_meadow']);
  add('judge', ['tar']);
  for (const [kind, floors, chance, water] of [
    ['giant_rat', [1], .9], ['locylady', [1], .7, true], ['beheld', [5]],
    ['cockathrice', [4]], ['craggan', [6]], ['shadow_scorpion', [3], .7],
    ['gargirl', [3]], ['infernal', [6]], ['stirgling', [4, 5], .7],
    ['ifrit', [6]], ['darkling', [2]], ['spook', [1], .9], ['nocturnus', [2]],
    ['grey_mage', [5]], ['portacular', [2]], ['black_dragon', [7]],
    ['blue_dragon', [7]], ['white_dragon', [7]], ['yellow_dragon', [7]],
  ]) add(kind, [], { floors, chance: chance ?? .3, water: !!water });
  const ROWS = Object.freeze(rows), BY_KIND = Object.fromEntries(rows.map(r => [r.kind, r]));
  const familyVariants = {
    tar: ['flint_field', 'broken_depot', 'seep', 'work_yard', 'black_ring'],
    stones: ['stone_garden', 'ordered_graves', 'overgrown_graves', 'broken_masonry', 'silent_circle'],
  };
  function position(scene) { return { x: (scene.startWorldM?.x || 0) + (scene.playerM?.x || 0), y: (scene.startWorldM?.y || 0) + (scene.playerM?.y || 0) }; }
  function locate(scene, x, y) {
    const WG = root.WorldGen, edge = scene.tileEdgeM || scene.cellsPerTile * scene.cellM;
    if (!(edge > 0)) return null;
    const tx = Math.floor(x / edge), ty = Math.floor(y / edge), depth = scene.depth || 0;
    const entry = WG.tileCacheFor(depth).get(WG.tileKey(tx, ty));
    if (!entry?.grid || !entry.cellsPerEdge) return null;
    const N = entry.cellsPerEdge, cellM = edge / N, cx = Math.floor((x - tx * edge) / cellM), cy = Math.floor((y - ty * edge) / cellM);
    const owner = depth ? null : root.SpawnPipeline.ownerAt(entry, cy * N + cx);
    let area;
    if (depth) area = root.EnemyHabitats.caveAt(entry, tx, ty, cx, cy, depth).id;
    else if (owner?.anchor) area = owner.key + ':' + (owner.anchor.key || owner.anchor.id || `${owner.anchor.x},${owner.anchor.y}`);
    else {
      let section;
      if (owner?.type === 'road' && entry.streetIndex) section = root.StreetVariants.variantOwner(entry.streetIndex, N, Infinity, true)(cx, cy)?.key;
      area = `${owner?.key}:${section || `${Math.floor(x / (cellM * 16))},${Math.floor(y / (cellM * 16))}`}`;
    }
    return { key: `${depth}:${area}`, owner, entry, tx, ty, cx, cy, cellM, depth };
  }
  function matches(row, at) {
    if (!at) return false;
    if (at.depth) return !!row.floors?.includes(at.depth);
    return !row.floors && row.owners.some(key => key === at.owner?.key ||
      (familyVariants[key]?.includes(at.owner?.id) && at.owner?.type === 'zone'));
  }
  function environment(scene, row) {
    if (row.night && (!root.Lighting || root.Lighting.daylight(scene, Date.now()) >= root.EnemySpawns.SURFACE_NIGHT_DAYLIGHT)) return false;
    if (row.rain && !['rain', 'drizzle'].includes(root.Weather?.state?.()?.kind)) return false;
    return true;
  }
  function data(scene) { return scene.save.rareEncounters ||= { areas: {}, active: null, elapsedMs: 0 }; }
  const identity = (key, visit, kind, suffix = '') => `rare:${root.EnemySpawns.hash(key).toString(36)}:${visit}:${kind}${suffix}`;
  function isEncounter(c) { return !!(c && BY_KIND[c.kind] && c._rareEncounter?.key && Number.isInteger(c._rareEncounter.visit) && c.id === identity(c._rareEncounter.key, c._rareEncounter.visit, c.kind, c._rareEncounter.suffix || '')); }
  function stateFor(scene, c) { return isEncounter(c) ? scene.save?.rareEncounters?.areas?.[c._rareEncounter.key]?.seats?.[c.id] : null; }
  function retire(scene, c) { const seat = stateFor(scene, c); if (seat) seat.finished = true; c._rareInactive = true; root.EnemySpawns.surfaceActive(scene, c); flush(scene); if (typeof flushSave === 'function') flushSave(); }
  function flush(scene) { if (typeof persistSave === 'function') persistSave(scene.save); }
  function eligible(scene, c) {
    if (!isEncounter(c) || c.pet) return true;
    const state = scene.save?.rareEncounters, area = state?.areas?.[c._rareEncounter.key];
    return !!(state?.active === c._rareEncounter.key && area?.visit === c._rareEncounter.visit && !area.seats?.[c.id]?.finished && environment(scene, BY_KIND[c.kind]));
  }
  function blocksSeat(scene, creature) {
    if (creature._hp != null && creature._hp <= 0) return false;
    if (creature.pet) return true;
    if (creature._surfaceInactive || (scene.save.caught || []).includes(creature.id)) return false;
    // A visit change precedes the visibility refresh, so consult current save
    // eligibility rather than waiting for the old body's inactive stamp.
    return !isEncounter(creature) || eligible(scene, creature);
  }
  function materialize(scene, at, area, seat) {
    if (seat.finished || (scene.save.caught || []).includes(seat.id)) return;
    const target = locate(scene, seat.x, seat.y);
    if (!target || target.key !== at.key) return;
    const creatures = target.entry.creatures ||= [];
    for (const [body, entry] of scene._rareBodies || []) if (body.id === seat.id && scene._rareLoadedEntries?.has(entry) && entry.creatures?.includes(body)) return;
    for (const entry of root.WorldGen.tileCacheFor(at.depth).values()) {
      const existing = (entry.creatures || []).find(c => c.id === seat.id);
      if (existing) { (scene._rareBodies ||= new Map()).set(existing, entry); return; }
    }
    const row = BY_KIND[seat.kind];
    if (!environment(scene, row)) return;
    // Restoring the same seat never finds a substitute or rolls again.
    const overrides = { waterOnly: !!row.water };
    // Passable props may share this seat; a living creature still may not.
    if (!root.CreatureSpawns.canPlaceAt(scene, target.entry, seat.x, seat.y, seat.kind,
      { id: seat.id, clearance: target.cellM, blocks: c => blocksSeat(scene, c), overrides })) return;
    const extra = { _rareEncounter: { key: at.key, visit: area.visit, suffix: seat.suffix || '' },
      _sharedId: false, depth: at.depth, homeX: seat.x, homeY: seat.y, ...(seat.extra || {}) };
    if (root.EnemyRoster.get(seat.kind)?.rareBehaviour?.hiddenUntilAdjacent) extra.hidden = true;
    if (!at.depth) extra._surfaceSpawn = { x: seat.x, y: seat.y, tx: target.tx, ty: target.ty };
    else extra._cave = true;
    const c = root.CreatureSpawns.createOwned('rare-encounters', at.key, seat.kind, seat.x, seat.y, seat.id, extra);
    if (root.CreatureSpawns.register(target.entry, c)) { root.EnemySpawns.surfaceActive(scene, c); (scene._rareBodies ||= new Map()).set(c, target.entry); }
  }
  const SEAT_NEAR_CELLS = 8, SEAT_FAR_CELLS = 16;
  function chooseSeat(scene, at, row, id, player) {
    // Near ring first (3-8 cells from the entry point), then the rest of the
    // area out to SEAT_FAR_CELLS — a full residual block from any edge. The
    // near ring alone often held no eligible cell, silently ending the visit.
    const candidates = [];
    for (let dy = -SEAT_FAR_CELLS; dy <= SEAT_FAR_CELLS; dy++) for (let dx = -SEAT_FAR_CELLS; dx <= SEAT_FAR_CELLS; dx++) {
      const ring = Math.max(Math.abs(dx), Math.abs(dy));
      if (ring < 3) continue;
      const x = (Math.floor(player.x / at.cellM) + dx + .5) * at.cellM, y = (Math.floor(player.y / at.cellM) + dy + .5) * at.cellM;
      candidates.push({ x, y, far: ring > SEAT_NEAR_CELLS ? 1 : 0, rank: root.EnemySpawns.hash(`${id}:${dx}:${dy}`) >>> 0 });
    }
    candidates.sort((a, b) => a.far - b.far || a.rank - b.rank);
    for (const point of candidates) {
      const target = locate(scene, point.x, point.y);
      if (!target || target.key !== at.key || !matches(row, target)) continue;
      if (!root.CreatureSpawns.canPlaceAt(scene, target.entry, point.x, point.y, row.kind,
        { id, clearance: at.cellM, blocks: c => blocksSeat(scene, c), overrides: { waterOnly: !!row.water } })) continue;
      const probe = { kind: row.kind, id, _rareEncounter: { key: at.key, visit: data(scene).areas[at.key].visit }, _surfaceSpawn: { x: point.x, y: point.y } };
      if (!at.depth && !root.EnemySpawns.homeEligible(scene, probe)) continue;
      return { id, kind: row.kind, x: point.x, y: point.y, behaviour: {} };
    }
    return { id, kind: row.kind, finished: true };
  }
  function tick(scene, now = 0, force = false) {
    if (!scene.save || !scene.playerM) return;
    const previous = scene._rareTickAt;
    if (!force && previous != null && now - previous >= 0 && now - previous < 250) return;
    scene._rareTickAt = now;
    const state = data(scene), player = position(scene), at = locate(scene, player.x, player.y);
    // Unknown cache cells cannot manufacture an exit, even across reloads.
    if (!at) return;
    state.elapsedMs += previous == null ? 0 : Math.max(0, Math.min(1000, now - previous));
    scene._rareLoadedEntries = new Set(root.WorldGen.tileCacheFor(at.depth).values());
    scene._rarePendingDepartures ||= new Set(Object.keys(state.areas).filter(key => state.areas[key].leftAt != null && !state.areas[key].farAway));
    let changed = false;
    if (state.active !== at.key) {
      const old = state.areas[state.active];
      if (old) {
        old.farAway = false; old.leftAt = state.elapsedMs; old.leftX = player.x; old.leftY = player.y; old.leftDepth = Number(state.active.split(':')[0]);
        (scene._rarePendingDepartures ||= new Set()).add(state.active);
      }
      let area = state.areas[at.key];
      const reentry = area && area.leftAt != null && state.elapsedMs - area.leftAt >= 30000 &&
        (area.leftDepth !== at.depth || Math.hypot(player.x - area.leftX, player.y - area.leftY) >= at.cellM * 8 || area.farAway);
      if ((!area || reentry) && ROWS.some(row => matches(row, at))) state.areas[at.key] = { visit: (area?.visit || 0) + 1, seats: {}, rolls: {}, originX: player.x, originY: player.y };
      state.active = at.key; changed = true;
    }
    // Only departures which have not yet crossed the distance threshold need
    // observation; the complete save history is not a per-tick work queue.
    for (const key of scene._rarePendingDepartures) {
      const departed = state.areas[key];
      if (!departed || departed.farAway) { scene._rarePendingDepartures.delete(key); continue; }
      if (key !== at.key && departed.leftAt != null && (departed.leftDepth !== at.depth || Math.hypot(player.x - departed.leftX, player.y - departed.leftY) >= at.cellM * 8)) {
        departed.farAway = true; scene._rarePendingDepartures.delete(key);
      }
    }
    const area = state.areas[at.key];
    for (const row of ROWS) {
      if (row.trigger || !matches(row, at)) continue;
      const id = identity(at.key, area.visit, row.kind);
      if (!(id in area.rolls)) { area.rolls[id] = root.SpawnPipeline.roll(id, row.chance); changed = true; }
      if (!area.rolls[id] || !environment(scene, row)) continue;
      if (!area.seats[id]) { area.seats[id] = chooseSeat(scene, at, row, id, { x: area.originX, y: area.originY }); changed = true; }
      materialize(scene, at, area, area.seats[id]);
    }
    for (const seat of Object.values(area?.seats || {})) if (seat.kind === 'thorn_ball') materialize(scene, at, area, seat);
    const loaded = scene._rareLoadedEntries;
    for (const [c, entry] of scene._rareBodies || []) {
      if (!loaded.has(entry) || !entry.creatures?.includes(c)) { scene._rareBodies.delete(c); continue; }
      if (isEncounter(c)) { c._rareInactive = !eligible(scene, c); root.EnemySpawns.surfaceActive(scene, c); }
    }
    if (changed || !scene._rareFlushedAt || now - scene._rareFlushedAt >= 5000) { flush(scene); scene._rareFlushedAt = now; }
  }
  function berryPicked(scene, wp) {
    if (wp?.crop !== 'goldenberry') return [];
    tick(scene, typeof performance !== 'undefined' ? performance.now() : 0, true);
    const player = position(scene), at = locate(scene, player.x, player.y), source = locate(scene, wp.x, wp.y), row = BY_KIND.thorn_ball;
    if (!matches(row, at) || source?.key !== at.key) return [];
    const area = data(scene).areas[at.key], event = identity(at.key, area.visit, 'thorn_ball', ':' + root.EnemySpawns.hash(wp.id).toString(36));
    if (event in area.rolls) return [];
    area.rolls[event] = root.SpawnPipeline.roll(event, row.chance);
    if (!area.rolls[event]) { flush(scene); return []; }
    const used = new Set(), result = [], chopped = new Set(scene.save.chopped || []), picked = new Set(scene.save.picked || []);
    const bushes = [];
    for (const entry of root.WorldGen.tileCacheFor(0).values()) for (const bush of entry.wildplants || []) {
      if (chopped.has(bush.id) || !(bush.crop === 'shrub' || (['berry', 'poisonberry', 'goldenberry'].includes(bush.crop) && picked.has(bush.id)))) continue;
      if (Math.hypot(bush.x - player.x, bush.y - player.y) > at.cellM * 6) continue;
      bushes.push(bush);
    }
    bushes.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    for (const bush of bushes) {
      const target = locate(scene, bush.x, bush.y), sector = Math.floor((Math.atan2(bush.y - player.y, bush.x - player.x) + Math.PI) / (Math.PI / 2)) % 4;
      if (target?.key !== at.key || used.has(sector)) continue;
      const sharesSeat = item => item.id !== bush.id && Math.floor(item.x / at.cellM) === Math.floor(bush.x / at.cellM) && Math.floor(item.y / at.cellM) === Math.floor(bush.y / at.cellM);
      if ((target.entry.creatures || []).some(c => blocksSeat(scene, c) && sharesSeat(c))) continue;
      if (!root.CreatureSpawns.gateAtEntry(scene, target.entry, bush.x, bush.y, row.kind)) continue;
      const suffix = ':' + root.EnemySpawns.hash(`${wp.id}:${bush.id}`).toString(36), id = identity(at.key, area.visit, row.kind, suffix);
      const seat = { id, kind: row.kind, suffix, bushId: bush.id, x: bush.x, y: bush.y, behaviour: {}, extra: { _rareSurround: { group: event, x: player.x, y: player.y, cells: 2, ordinal: sector, count: 4 } } };
      area.seats[id] = seat; materialize(scene, at, area, seat);
      if ((target.entry.creatures || []).some(c => c.id === id)) { chopped.add(bush.id); used.add(sector); result.push(id); }
      else seat.finished = true;
    }
    scene.save.chopped = [...chopped]; flush(scene); return result;
  }
  root.RareEncounters = Object.freeze({ ROWS, matches, locate, environment, tick, berryPicked, isEncounter, eligible, stateFor, retire });
})(typeof window !== 'undefined' ? window : globalThis);
