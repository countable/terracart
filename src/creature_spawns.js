// CreatureSpawns owns the shared mechanics for finite and triggered creature
// births. Callers choose identities and seats; this module keeps count draws,
// member expansion, placement lifecycle and the one spawn gate consistent.
(function (root) {
  'use strict';

  function creatureSpawnClass(kind) {
    return typeof root.creatureSpawnClass === 'function'
      ? root.creatureSpawnClass(kind) : 'fauna';
  }

  // A creature kind derives its class from the roster and movement tables.
  // WorldGen remains the sole reader of terrain, reason bits and occupancy.
  function isSpawnCell(grid, w, h, cx, cy, opts, kind) {
    return root.WorldGen.isSpawnCell(grid, w, h, cx, cy, opts, creatureSpawnClass(kind));
  }

  // Prop reservations prevent two objects sharing a seat; they do not make
  // that seat impassable to a creature. Keep actual movement blockers and
  // explicit creature reservations separate from the prop occupancy ledger.
  function passableOpts(scene, entry, opts = {}, creatureCells = null, tx = null, ty = null) {
    const occupied = new Set(creatureCells || []);
    const N = entry?.cellsPerEdge || scene?.cellsPerTile;
    const edge = entry?.tileEdgeM || scene?.tileEdgeM || N * scene?.cellM;
    if (N > 0 && edge > 0) {
      const addPoint = (x, y) => {
        const tileX = Math.floor(x / edge), tileY = Math.floor(y / edge);
        if (tx != null && (tileX !== tx || tileY !== ty)) return;
        const ix = Math.floor((x - tileX * edge) * N / edge);
        const iy = Math.floor((y - tileY * edge) * N / edge);
        if (ix >= 0 && iy >= 0 && ix < N && iy < N) occupied.add(iy * N + ix);
      };
      for (const object of entry?.objects || entry?.genObjects || [])
        if (root.PushBlocks?.isBlock(object)) addPoint(object.x, object.y);
      if (tx != null && scene?.placedRockSet?.size && scene.cellsPerTile > 0
          && typeof absCellCenterMeters === 'function') {
        for (const key of scene.placedRockSet) {
          const parts = key.split('_').map(Number);
          if (parts.length !== 2 || !parts.every(Number.isFinite)) continue;
          const point = absCellCenterMeters(scene, parts[0], parts[1]);
          addPoint(point.x, point.y);
        }
      }
    }
    return { ...opts, occupied };
  }

  // Runtime events resolve their world point back to the generated tile so
  // summons, raised ghosts and hooked slimes read the same gate as generation.
  function gateAt(scene, x, y, kind, overrides) {
    const edge = scene && (scene.tileEdgeM || scene.cellsPerTile * scene.cellM);
    if (!(edge > 0) || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    const tx = Math.floor(x / edge), ty = Math.floor(y / edge);
    const entry = root.WorldGen.tileCache.get(root.WorldGen.tileKey(tx, ty));
    return gateAtEntry(scene, entry, x, y, kind, overrides);
  }
  // Tile replay may run before its entry is published in the cache.
  function gateAtEntry(scene, entry, x, y, kind, overrides) {
    const edge = entry?.tileEdgeM || scene?.tileEdgeM || scene?.cellsPerTile * scene?.cellM;
    if (!entry || !(edge > 0) || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    const tx = Math.floor(x / edge), ty = Math.floor(y / edge);
    const measuredN = scene.cellM > 0 ? Math.round(edge / scene.cellM) : 0;
    const N = entry.cellsPerEdge || scene.cellsPerTile || measuredN || 1;
    const grid = entry.grid || entry.baseGrid;
    const cellM = edge / N;
    const cx = Math.floor((x - tx * edge) / cellM);
    const cy = Math.floor((y - ty * edge) / cellM);
    let opts = {
      ...(entry._spawnOpts || {}),
      ...(entry.roadMask ? { roadMask: entry.roadMask } : {}),
      ...(entry.roadClass ? { roadClass: entry.roadClass } : {}),
      ...(entry.spawnWhy ? { spawnWhy: entry.spawnWhy } : {}),
      ...(entry.gameplayTiers ? { gameplayTiers: entry.gameplayTiers } : {}),
      ...(entry.waterEdges ? { waterEdges: entry.waterEdges } : {}),
      ...(overrides || {}),
    };
    if (kind !== 'npc') {
      const row = root.EnemyRoster?.get(kind);
      const waterOnly = !!(row?.movement?.waterOnly || row?.rareBehaviour?.waterSpawn || row?.rareBehaviour?.amphibious);
      opts = passableOpts(scene, entry, { ...opts, waterOnly }, overrides?.creatureCells, tx, ty);
    }
    if (grid) return root.WorldGen.isSpawnCell(grid, N, N, cx, cy, opts, creatureSpawnClass(kind));

    // A tile may be present before its generated arrays are attached. Runtime
    // events still ask the scene for this loaded cell, then project any gate
    // bits the partial entry already owns onto a one-cell grid.
    const cell = scene.cellAt ? scene.cellAt(x, y) : { loaded: true, type: root.WorldGen.T.GRASS };
    if (!cell?.loaded) return false;
    const i = cy * N + cx;
    const one = (values, Type) => values && Type.of(values[i] || 0);
    const occupied = opts.occupied === null ? null
      : opts.occupied && opts.occupied.has(i) ? new Set([0]) : new Set();
    const projected = {
      ...opts,
      roadMask: one(opts.roadMask, Uint8Array),
      roadClass: one(opts.roadClass, Uint16Array),
      spawnWhy: one(opts.spawnWhy, Uint32Array),
      gameplayTiers: one(opts.gameplayTiers, Uint8Array),
      waterEdges: one(opts.waterEdges || root.WorldGen.waterEdgesOf(null, opts), Uint8Array),
      occupied,
    };
    return root.WorldGen.isSpawnCell(Uint8Array.of(cell.type), 1, 1, 0, 0,
      projected, creatureSpawnClass(kind));
  }

  // Count ranges use one draw and include both endpoints. Fixed counts consume
  // no draw, which preserves every downstream seeded decision.
  function frequencyCount(spec, rng) {
    return root.SpawnPipeline.frequencyCount(spec, rng);
  }

  function pickWeighted(items, position, weightFor) {
    if (!items || !items.length) return null;
    const weight = typeof weightFor === 'function' ? weightFor : () => 1;
    const rows = items.map((item, i) => ({ item, weight: Math.max(0, Number(weight(item, i)) || 0) }));
    const picked = weightedPickAt(rows, row => row.weight,
      Math.max(0, Math.min(.999999999999, Number(position) || 0)), { empty: rows[0] });
    return picked.item;
  }

  // Each expanded row retains its source index. The owner adds formation data
  // such as idx/of because only it knows the row's seating rule.
  function expandMembers(rule, rng) {
    const out = [];
    for (const [memberIndex, member] of (rule && rule.members || []).entries()) {
      const count = frequencyCount({ count: member.nRange || member.n || 0 }, rng);
      for (let i = 0; i < count; i++) out.push({ ...member, memberIndex });
    }
    return out;
  }

  function isGenerator(value) {
    return !!value && typeof value.next === 'function';
  }

  // Explicit requests already have an owner. These categories select the
  // caller's lifecycle, never an ambient zone table. Only story progression
  // is an Event; clocks, interactions and repeatable trials are not Events.
  const OWNED_RULES = Object.freeze(Object.fromEntries([
    // Citadel is an audit alias: Lairs always uses building-garrisons, one population.
    ['feature', ['building-garrisons', 'citadel-guards', 'road-lairs', 'tar-guards',
      'gate-guards', 'habitat-lairs', 'zone-formations', 'cave-finite',
      'dragon-roost', 'bone-gallery', 'serpent', 'shore-fauna', 'path-fauna']],
    ['trigger', ['rare-encounters', 'mushroom-hive', 'honey-bees', 'nest', 'mimic', 'pot-snake',
      'bone-cache', 'headstone', 'haunting', 'fishing-slime', 'crop-pests']],
    ['contract', ['guild-bounty', 'debt-collector', 'temple-trials']],
    ['storyEvent', ['story-witness', 'starter']],
    // Object renewal remains a state operation; this inventory row is not an allocator.
    ['identity', ['npcs', 'eggs', 'companions', 'pet-release', 'resource-lifecycle']],
    ['modifier', ['summons', 'splits', 'party-scaling']],
  ].flatMap(([category, ids]) => ids.map(id => [id, Object.freeze({ id, category,
    ...(id === 'citadel-guards' ? { aliasOf: 'building-garrisons' } : {}),
    ...(id === 'resource-lifecycle' ? { stateOnly: true } : {}),
  })]))));

  function ownedRule(source, ownerId) {
    const rule = Object.hasOwn(OWNED_RULES, source) && OWNED_RULES[source];
    if (!rule) throw new Error('Unknown owned spawn source: ' + source);
    if (rule.stateOnly) throw new Error('Object renewal changes existing state, not creature population');
    if ((typeof ownerId !== 'string' && !(typeof ownerId === 'number' && Number.isFinite(ownerId)))
        || String(ownerId) === '') throw new Error('Owned spawn requires a stable owner identity');
    return rule.aliasOf ? OWNED_RULES[rule.aliasOf] : rule;
  }

  // A controller supplies its existing count/condition, legal seat selector,
  // factory and state writer. This common executor handles finite requests,
  // population caps and duplicate prevention without consuming a failed seat.
  // It deliberately does not own clocks or saved story/contract progression.
  function* generateOwnedSteps(source, ownerId, context) {
    const rule = ownedRule(source, ownerId), ctx = context || {};
    if (ctx.when && !ctx.when()) return [];
    let count = ctx.count == null ? frequencyCount(ctx.frequency || { count: 1 }, ctx.rng) : ctx.count;
    if (ctx.maxAlive != null) {
      const live = typeof ctx.liveCount === 'function' ? ctx.liveCount() : ctx.liveCount || 0;
      count = Math.min(count, Math.max(0, ctx.maxAlive - live));
    }
    if (!(count > 0)) return [];
    const exists = id => id != null && (typeof ctx.exists === 'function' ? ctx.exists(id) : ctx.existing?.has(id));
    return yield* root.SpawnPipeline.generateSteps(rule, {
      ...ctx, count,
      *member(ordinal) {
        const result = ctx.member ? ctx.member(ordinal) : {};
        const member = isGenerator(result) ? yield* result : result;
        return member && !exists(member.id) ? member : null;
      },
      create(member, seat, ordinal) {
        if (exists(member.id) || ctx.gate && !ctx.gate(member, seat, ordinal)) return null;
        const result = ctx.create ? ctx.create(member, seat, ordinal)
          : root.WorldGen.makeCreature(member.kind, seat.x, seat.y, member.id, member.extra);
        // The default factory is synchronous; a custom sliced factory keeps
        // its yield boundaries and is stamped by the onPlaced adapter below.
        return result;
      },
      *onPlaced(record, member, seat, ordinal) {
        record._spawnSource = rule.id;
        record._spawnOwner = String(ownerId);
        record._spawnCategory = rule.category;
        ctx.existing?.add(record.id);
        const result = ctx.onPlaced?.(record, member, seat, ordinal);
        if (isGenerator(result)) yield* result;
      },
    });
  }

  // Materialize one identity after the caller's placement policy has selected
  // its seat. Restoration does not roll a rate or mint a replacement identity.
  function createOwned(source, ownerId, kind, x, y, id, extra) {
    const iterator = generateOwnedSteps(source, ownerId, {
      count: 1, member: () => ({ kind, id, extra }), seat: () => ({ x, y }),
    });
    let result;
    do { result = iterator.next(); } while (!result.done);
    return result.value[0] || null;
  }

  // Arena opponents have a different record shape and coordinate system but
  // share owned execution. Their controller supplies arena legality, never
  // the surface world gate or an ambient table.
  function createRecord(source, ownerId, record) {
    const iterator = generateOwnedSteps(source, ownerId, {
      count: 1, member: () => record, seat: () => record, create: () => record,
    });
    let result;
    do { result = iterator.next(); } while (!result.done);
    return result.value[0] || null;
  }

  // Creature and interactable producers execute through the same scheduler.
  function* generateSteps(rule, context) {
    return yield* root.SpawnPipeline.generateSteps(rule, context);
  }

  root.CreatureSpawns = {
    isSpawnCell, passableOpts, gateAt, gateAtEntry, frequencyCount, pickWeighted, expandMembers, generateSteps, OWNED_RULES, generateOwnedSteps, createOwned, createRecord,
  };
})(globalThis);
