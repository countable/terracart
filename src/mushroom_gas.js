// Concealed grove mushrooms and gas vents feed the generic, depth-local gas
// simulation: one Gas field per kind, so clouds of different kinds never mix.
(function (root) {
  'use strict';
  const CONFIG = Object.freeze({ sourceChance: .18, triggerCells: 1.25, burstMass: .3,
    cooldownMs: 16000, observeMs: 200, contactMs: 1000, maxFrameMs: 100 });
  // One row per gas kind: the condition a breath applies and for how long,
  // and the cloud's colours (GasRender paints every kind from these rows).
  // Contact renews the condition each second, never shortening a longer one.
  // `rearmMs` holds off the next dose after one lands, so a lingering cloud
  // of paralysis cannot hold the player still until it clears: the gap
  // between doses is the window to walk out.
  const KINDS = Object.freeze({
    confusion: Object.freeze({ condition: 'confused', durationMs: 5000, colour: 0xffde1a, highlight: 0xffffc4 }),
    poison: Object.freeze({ condition: 'poison', durationMs: 30000, colour: 0x7ddc2e, highlight: 0xe2ffb8 }),
    paralysis: Object.freeze({ condition: 'paralysis', durationMs: 5000, rearmMs: 8000,
      colour: 0x3f9dff, highlight: 0xd2ecff }),
  });
  const SOURCE_CROPS = new Set(['mushroom', 'giant_mushroom']);
  const DIRECTIONS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  function prepare(entry, tx, ty) {
    if (entry.depth > 0 || !entry.zone?.coverage ||
        (entry._gasPreparedPlants === entry.wildplants && entry._gasPreparedCount === entry.wildplants?.length)) return;
    entry._gasPreparedPlants = entry.wildplants;
    entry._gasPreparedCount = entry.wildplants?.length;
    const W = root.WorldGen, N = entry.cellsPerEdge, cellM = entry.tileEdgeM / N;
    // These plants already own their cells. Keep the exclusion masks, but do
    // not mistake the source's own existing occupancy for a new collision.
    const opts = W.spawnOptsOf(entry, { occupied: null });
    for (const plant of entry.wildplants || []) {
      if (!SOURCE_CROPS.has(plant.crop)) continue;
      const ix = Math.floor((plant.x - tx * entry.tileEdgeM) / cellM);
      const iy = Math.floor((plant.y - ty * entry.tileEdgeM) / cellM);
      if (ix < 0 || iy < 0 || ix >= N || iy >= N) continue;
      const slot = entry.zone.coverage[iy * N + ix];
      if (entry.zone.anchors?.[slot - 1]?.variant !== 'mushroom_grove') continue;
      if (!W.isSpawnCell(entry.grid, N, N, ix, iy, opts, 'enemy')) continue;
      if (root.EnemyHabitats.unit(`${plant.id}:gas-source`) >= CONFIG.sourceChance) continue;
      plant.gasEmitter = true;
      plant.hidden = true;
      plant.depth = 0;
    }
  }

  function state(scene) {
    const depths = scene._mushroomGas || (scene._mushroomGas = new Map());
    const depth = scene.depth || 0;
    if (!depths.has(depth)) {
      const gases = {}, contacts = {};
      for (const kind of Object.keys(KINDS)) {
        gases[kind] = root.Gas.create();
        contacts[kind] = { nextMs: 0, cell: null, rearmAtMs: 0 };
      }
      depths.set(depth, { gases, contacts, elapsedMs: 0, nextObserveMs: 0, cooldowns: new Map() });
    }
    return depths.get(depth);
  }

  function sourcePresent(scene, plant) {
    return plant.gasEmitter && !plant.picked && !plant.burned
      && !setOf(scene.save.picked).has(plant.id) && !setOf(scene.save.burnedObjects).has(plant.id);
  }

  function emit(scene, cellIX, cellIY, amount = CONFIG.burstMass, kind = 'confusion') {
    return root.Gas.inject(state(scene).gases[kind], cellIX, cellIY, amount);
  }

  function observe(scene, s) {
    if (scene.depth) return;
    const p = playerWorldM(scene), pc = worldMetersToTileCell(scene, p.x, p.y);
    const radius = scene.cellM * CONFIG.triggerCells;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const tx = pc.tx + dx, ty = pc.ty + dy;
      const entry = root.WorldGen.tileCache.get(root.WorldGen.tileKey(tx, ty));
      if (!entry || entry.status !== 'ready' || entry.depth > 0) continue;
      prepare(entry, tx, ty);
      root.WorldGen.forEachItemInBox(entry, 'wildplants', p.x - radius, p.y - radius, p.x + radius, p.y + radius, plant => {
        if (!sourcePresent(scene, plant) || Math.hypot(plant.x - p.x, plant.y - p.y) > radius) return;
        root.HiddenObjects.reveal(scene, plant);
        if ((s.cooldowns.get(plant.id) || 0) > s.elapsedMs) return;
        const c = worldMetersToAbsCell(scene, plant.x, plant.y);
        if (emit(scene, c.cellIX, c.cellIY)) s.cooldowns.set(plant.id, s.elapsedMs + CONFIG.cooldownMs);
      });
    }
    // Expired timers need not accumulate as the player explores new groves.
    for (const [id, until] of s.cooldowns) if (until <= s.elapsedMs) s.cooldowns.delete(id);
  }

  // Gas crosses roads and water; only solid masonry/rock stops its spread.
  // Unknown terrain holds gas in place until loaded. Each step rebuilds this
  // small lookup so mining a wall immediately opens the next diffusion step.
  function terrainReader(scene) {
    const walls = new Map(), W = root.WorldGen;
    return (x, y) => {
      const at = absCellToTile(scene, x, y), e = W.tileCache.get(W.tileKey(at.tx, at.ty));
      if (!e?.grid || e.status !== 'ready' || (e.depth || 0) !== (scene.depth || 0)) return 'unknown';
      const type = e.grid[at.iy * e.cellsPerEdge + at.ix];
      if (type === W.T.CAVE_WALL || W.isBuildingTerrain(type)) return 'wall';
      if (!walls.has(e)) {
        const blocked = new Set(), broken = scene.brokenRockSet || setOf(scene.save.brokenRocks);
        for (const o of e.objects || []) {
          if (o.kind !== 'stronghold_wall' || o.broken || broken.has(o.id)) continue;
          const c = worldMetersToAbsCell(scene, o.x, o.y);
          blocked.add(`${c.cellIX},${c.cellIY}`);
        }
        walls.set(e, blocked);
      }
      return walls.get(e).has(`${x},${y}`) ? 'wall' : 'open';
    };
  }

  function contact(scene, s) {
    const p = playerWorldM(scene);
    const cell = worldMetersToAbsCell(scene, p.x, p.y + (scene.feetOffsetM || 0));
    const key = `${cell.cellIX},${cell.cellIY}`;
    for (const [kind, row] of Object.entries(KINDS)) {
      const c = s.contacts[kind];
      if (!(s.gases[kind].cells.get(key)?.density > 0)) {
        c.cell = null;
        continue;
      }
      if (c.cell === key && s.elapsedMs < c.nextMs) continue;
      if (s.elapsedMs < c.rearmAtMs) continue;
      c.cell = key;
      c.nextMs = s.elapsedMs + CONFIG.contactMs;
      if (row.rearmMs) c.rearmAtMs = s.elapsedMs + row.rearmMs;
      // Each gas shares its condition's own behaviour (confusion's compass,
      // poison's ticks, paralysis's hold). A brief exposure must not shorten
      // an existing longer effect.
      if (scene._applyCondition) scene._applyCondition(row.condition, { durationMs: row.durationMs });
      else root.Conditions.apply(scene.save, row.condition, Date.now(), { durationMs: row.durationMs });
    }
  }

  function tick(scene, dt) {
    if (!scene.startWorldM || !scene.playerM || !(dt > 0) || !Number.isFinite(dt)) return;
    const s = state(scene), ms = Math.min(CONFIG.maxFrameMs, dt * 1000);
    s.elapsedMs += ms;
    if (s.elapsedMs >= s.nextObserveMs) {
      observe(scene, s);
      s.nextObserveMs = s.elapsedMs + CONFIG.observeMs;
    }
    const neighbors = (x, y) => DIRECTIONS.map(([dx, dy]) => {
      const c = absCellOffset(scene, x, y, dx, dy);
      return { x: c.cellIX, y: c.cellIY };
    });
    const terrain = terrainReader(scene);
    for (const gas of Object.values(s.gases)) root.Gas.advance(gas, ms, terrain, neighbors);
    contact(scene, s);
  }

  // Every kind's cells, tagged with their kind; the array is reused until any
  // field changes, so the renderer can skip reconciling on an idle frame.
  function cells(scene) {
    const s = state(scene);
    const revision = Object.values(s.gases).map(g => g.revision).join();
    if (s.drawRevision !== revision) {
      s.drawRevision = revision;
      s.drawCells = Object.entries(s.gases).flatMap(([kind, g]) =>
        [...g.cells.values()].map(c => ({ kind, cellIX: c.x, cellIY: c.y, density: c.density })));
    }
    return s.drawCells || [];
  }
  root.MushroomGas = { CONFIG, KINDS, prepare, state, sourcePresent, emit, terrainReader, contact, tick, cells };
})(typeof globalThis !== 'undefined' ? globalThis : this);
