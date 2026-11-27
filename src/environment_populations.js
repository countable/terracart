// Finite and length-based ambient requests share allocation, legal placement,
// reservation and capture handling. Geometry adapters supply candidates and
// canonical identities; they do not mint creatures or maintain another ledger.
(function (root) {
  'use strict';
  function reservations(scene, context) {
    const { N, tx, ty, cellM, creatures, authoredCreatures = [] } = context;
    const reserved = context.reserved || new Set(context.opts?.creatureCells || []);
    for (const c of [...creatures, ...authoredCreatures]) {
      const cx = Math.floor((c.x - tx * scene.tileEdgeM) / cellM);
      const cy = Math.floor((c.y - ty * scene.tileEdgeM) / cellM);
      if (cx >= 0 && cy >= 0 && cx < N && cy < N) reserved.add(cy * N + cx);
    }
    return reserved;
  }

  function run(scene, context, request) {
    const { entry, creatures, N, tx, ty, cellM, grid } = context;
    const reserved = reservations(scene, context), caught = context.caughtSet || new Set();
    const opts = root.CreatureSpawns.passableOpts(scene,
      { ...entry, cellsPerEdge: N, tileEdgeM: scene.tileEdgeM }, context.opts || {}, null, tx, ty);
    const out = [], requested = Math.max(0, request.count || 0);
    let placed = 0;
    root.WorldGen.runSteps(root.CreatureSpawns.generateOwnedSteps(request.source, request.owner, {
      count: requested,
      member(ordinal) {
        const member = request.member(ordinal);
        return member && { kind: request.kind, ...member };
      },
      seat(member, ordinal) {
        let cell = null, best = -Infinity;
        const kind = member.kind, row = root.EnemyRoster?.get(kind);
        const waterOnly = !!(row?.movement?.waterOnly || row?.rareBehaviour?.waterSpawn || row?.rareBehaviour?.amphibious);
        for (const candidate of request.candidates(member, ordinal)) {
          if (!Number.isInteger(candidate) || candidate < 0 || candidate >= N * N || reserved.has(candidate)
              || request.accept && !request.accept(candidate, member)) continue;
          const cx = candidate % N, cy = Math.floor(candidate / N);
          if (!root.CreatureSpawns.isSpawnCell(grid, N, N, cx, cy, { ...opts, waterOnly }, kind)) continue;
          const clearance = request.clearance ? request.clearance(candidate) : Infinity;
          if (clearance > best) { cell = candidate; best = clearance; }
          if (!request.clearance || clearance >= request.preferredClearance) break;
        }
        if (cell == null) return null;
        const cx = cell % N, cy = Math.floor(cell / N);
        return { cell, cx, cy, ...(request.point?.(cell, member)
          || tileCellCentre(scene.tileEdgeM, tx, ty, cellM, cx, cy)) };
      },
      create(member, seat) {
        return request.create ? request.create(member, seat) : root.WorldGen.makeCreature(member.kind, seat.x, seat.y, member.id,
          { ...member.extra, ...request.extra?.(member, seat) });
      },
      onPlaced(record, member, seat) {
        reserved.add(seat.cell); placed++;
        request.onPlaced?.(record, member, seat);
        if (request.surfaceActive !== false) root.EnemySpawns.surfaceActive(scene, record);
        if (caught.has(record.id) || record._legacyDefeatIds?.some(id => caught.has(id))) return;
        creatures.push(record); out.push(record);
      },
    }));
    return { creatures: out, requested, placed, shortfall: Math.max(0, requested - placed) };
  }

  function shore(scene, creatures, shore, pierCells, N, tx, ty, cellM, grid, faunaOpts, foeOpts, caughtSet, zoneCoverage, entry = null, authoredCreatures = []) {
    const out = [], groups = new Map(), allShore = shore?.cells || [];
    const reserved = reservations(scene, { N, tx, ty, cellM, creatures, authoredCreatures, reserved: foeOpts.creatureCells || new Set() });
    const spacing = root.HabitatSpawns.faunaSpacing(N, reserved);
    const groupAt = i => {
      const owner = entry ? root.HabitatSpawns.resolve(entry, i) : null;
      if (entry && root.WorldGen.variantOwnerAt(entry, i) || zoneCoverage?.[i]
          || owner?.profile?.owner === 'zone' || owner?.profile?.owner === 'road') return null;
      const key = 'shore:ordinary';
      if (!groups.has(key)) groups.set(key, { key, owner, shore: [], pier: [] });
      return groups.get(key);
    };
    for (const i of allShore) groupAt(i)?.shore.push(i);
    for (const i of pierCells) groupAt(i)?.pier.push(i);
    const diagnostics = [];
    for (const group of [...groups.values()].sort((a, b) => a.key.localeCompare(b.key))) {
      const ground = new Set(group.shore);
      const shoreM = shore?.waterline ? shore.waterline.filter(i => ground.has(i)).length * root.WorldGen.CELL_M
        : (shore?.shoreM || 0) * group.shore.length / Math.max(1, allShore.length);
      for (const kind of root.SHORE_FAUNA_ORDER || []) {
        const row = root.SHORE_FAUNA[kind];
        if (!row) continue;
        const rawPool = row.pier ? group.shore.concat(group.pier) : group.shore;
        if (!rawPool.length) continue;
        const lenM = shoreM + (row.pier ? group.pier.length * root.WorldGen.CELL_M : 0);
        const cls = creatureSpawnClass(kind), fauna = cls === 'fauna' || cls === 'fastFauna';
        const rawCount = Math.max(0, Math.min(row.max, Math.floor(lenM / row.perShoreM)));
        const count = fauna || root.SpriteLayout.creatureBehaviour(kind)?.animal ? root.HabitatSpawns.faunaCount(rawCount) : rawCount;
        const opts = root.CreatureSpawns.passableOpts(scene, { ...entry, cellsPerEdge: N, tileEdgeM: scene.tileEdgeM }, fauna ? faunaOpts : foeOpts, null, tx, ty);
        const canonicalPool = rawPool.filter(i => root.HabitatSpawns.allows(kind, grid[i], group.owner?.profile));
        const pool = canonicalPool.filter(i => root.WorldGen.isSpawnCell(grid, N, N, i % N, Math.floor(i / N), opts, cls));
        const rng = root.WorldGen.makeRng(fnv1a(`${row.salt}|${tx},${ty}`)), taken = new Set();
        const result = run(scene, { entry, creatures, N, tx, ty, cellM, grid, opts, reserved, caughtSet }, {
          source: 'shore-fauna', owner: group.key, kind, count,
          member() {
            if (taken.size >= canonicalPool.length) return null;
            const start = Math.floor(rng() * canonicalPool.length);
            let canonical;
            for (let at = 0; at < canonicalPool.length; at++) {
              const candidate = canonicalPool[(start + at) % canonicalPool.length];
              if (!taken.has(candidate)) { canonical = candidate; break; }
            }
            if (canonical == null) return null;
            taken.add(canonical);
            return { canonical, id: root.WorldGen.cellId(kind, tx, ty, canonical % N, Math.floor(canonical / N)) };
          },
          candidates(member) {
            const canonicalSeat = pool.indexOf(member.canonical);
            const start = canonicalSeat >= 0 ? canonicalSeat : Math.floor(root.EnemySpawns.roll(member.id + ':seat') * pool.length);
            return pool.slice(start).concat(pool.slice(0, start));
          },
          clearance: i => spacing.clearance(i), preferredClearance: root.HabitatSpawns.FAUNA_SPACING_CELLS,
          extra(member, seat) {
            return { shiny: fauna || ITEM_BY_ID[kind]?.kind === 'animal' ? faunaShiny(kind, member.id) : false,
              _habitatSpawn: { key: `land:${grid[seat.cell]}:shore`, profile: group.owner?.profile?.id || 'shore', tx, ty,
                cx: seat.cx, cy: seat.cy, sourceCx: member.canonical % N, sourceCy: Math.floor(member.canonical / N), x: seat.x, y: seat.y } };
          },
          onPlaced(record, member, seat) { spacing.add(seat.cell); },
        });
        out.push(...result.creatures);
        diagnostics.push({ key: group.key, kind, requested: result.requested, placed: result.placed, shortfall: result.shortfall });
      }
    }
    if (entry) entry.shorePopulation = diagnostics;
    return out;
  }

  function path(scene, creatures, allPathCells, N, tx, ty, cellM, grid, opts, caughtSet, entry, authoredCreatures = []) {
    const out = [], groups = new Map(), diagnostics = [];
    const ownerAt = entry?.streetIndex ? root.StreetVariants.variantOwner(entry.streetIndex, N, Infinity, true) : null;
    for (const cell of allPathCells) {
      const id = root.HabitatSpawns.resolve(entry, cell).variant, variant = root.StreetVariants.VARIANT_BY_ID[id];
      if (!variant?.pathFauna) continue;
      const perPath = Object.values(variant.pathFauna).some(row => row.perPath);
      const owner = perPath && ownerAt?.(cell % N, Math.floor(cell / N));
      const key = owner?.variant === id ? owner.key : `${id}|${tx},${ty}`;
      if (!groups.has(key)) groups.set(key, { variant, key, cells: [] });
      groups.get(key).cells.push(cell);
    }
    for (const { variant, key, cells } of [...groups.values()].sort((a, b) => a.key.localeCompare(b.key))) {
      cells.sort((a, b) => a - b);
      for (const [baseKind, row] of Object.entries(variant.pathFauna)) {
        const stream = row.perPath ? `${row.salt}|${key}` : row.salt, kinds = row.kinds && root.SpriteLayout[row.kinds];
        const kind = kinds ? kinds[Math.floor(root.EnemySpawns.roll(`${stream}|kind`) * kinds.length)].id : baseKind;
        const count = row.count ? row.count[0] + Math.floor(root.EnemySpawns.roll(`${stream}|count`) * (row.count[1] - row.count[0] + 1))
          : Math.min(row.max, Math.floor(cells.length * root.WorldGen.CELL_M / row.perPathM));
        const rng = root.WorldGen.makeRng(fnv1a(`${stream}|${tx},${ty}`)), remaining = cells.slice();
        const result = run(scene, { entry, creatures, N, tx, ty, cellM, grid, opts, caughtSet, authoredCreatures }, {
          source: 'path-fauna', owner: key, kind, count,
          member(ordinal) {
            if (!remaining.length) return null;
            const canonical = remaining.splice(Math.floor(rng() * remaining.length), 1)[0];
            const legacyId = root.WorldGen.cellId(`${kind}_path`, tx, ty, canonical % N, Math.floor(canonical / N));
            return { canonical, id: `${kind}_path_section_${fnv1a(key).toString(36)}_${ordinal}`, extra: { _legacyDefeatIds: [legacyId] } };
          },
          *candidates(member) {
            const start = cells.indexOf(member.canonical);
            for (let at = 0; at < cells.length; at++) {
              const cell = cells[(start + at) % cells.length], px = cell % N, py = Math.floor(cell / N);
              for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const cx = px + dx, cy = py + dy;
                if (cx >= 0 && cy >= 0 && cx < N && cy < N) yield cy * N + cx;
              }
            }
          },
          accept(i) {
            return grid[i] !== root.WorldGen.T.PATH && root.HabitatSpawns.resolve(entry, i).variant === variant.id
              && (!row.perPath || !ownerAt || ownerAt(i % N, Math.floor(i / N))?.key === key);
          },
        });
        out.push(...result.creatures);
        diagnostics.push({ key, kind, requested: result.requested, placed: result.placed, shortfall: result.shortfall });
      }
    }
    if (entry) entry.pathPopulation = diagnostics;
    return out;
  }

  // ── BUSH AMBUSHERS ──────────────────────────────────────────────────────
  // A bush may hide a foe (owner, Nov 2026: "15% of bushes should have
  // ambushes" on hard, 3% on easy; "thieves, slimes, depending on area").
  // Every wild bush (items.js BUSH_CROPS — a nest bush and a golden bush keep
  // their own secret) rolls once off its id; under the largest mode's
  // Difficulty `bushAmbushShare` the world seats an AMBUSHER (`ambush: true`,
  // creature_ai.js isAmbusher) in it for everyone, its kind drawn from the
  // bush's ground below. Each mode then shows the bushes whose same roll is
  // under its own share (bushAmbushVisible, read by EnemySpawns.surfaceActive)
  // — hidden, never rerolled, so easy's bushes are a subset of hard's. The
  // safe area (a thief's own 250 m) and the starter pest amnesty hide a foe
  // through the ordinary `_surfaceSpawn` lane. Unlisted ground holds none.
  const BUSH_AMBUSHERS = Object.freeze({
    RESIDENTIAL: [{ kind: 'thief', weight: 3 }, { kind: 'slime', weight: 1 }],
    COMMERCIAL: [{ kind: 'thief', weight: 3 }, { kind: 'slime', weight: 1 }],
    SCHOOL: [{ kind: 'thief', weight: 1 }, { kind: 'slime', weight: 1 }],
    GRASS: [{ kind: 'slime', weight: 2 }, { kind: 'mini_slime', weight: 1 }],
    PARK: [{ kind: 'slime', weight: 2 }, { kind: 'mini_slime', weight: 1 }],
    PLAYGROUND: [{ kind: 'mini_slime', weight: 1 }],
    PITCH: [{ kind: 'slime', weight: 1 }],
    GOLF: [{ kind: 'slime', weight: 1 }],
    FARMLAND: [{ kind: 'slime', weight: 1 }],
    WETLAND: [{ kind: 'slime', weight: 1 }],
    FOREST: [{ kind: 'moss_slime', weight: 1 }],
    ORCHARD: [{ kind: 'moss_slime', weight: 1 }],
  });
  const ambushShare = profile => Math.max(0, Math.min(1, profile?.bushAmbushShare || 0));
  const maxBushAmbushShare = () => Math.max(0, ...Object.values(root.Difficulty?.PROFILES || {}).map(ambushShare));
  const bushRoll = id => root.EnemySpawns.roll(id + '|ambush');
  function isAmbushBush(o) {
    return !!o && o.kind === 'wildplant' && o.id != null && typeof BUSH_CROPS !== 'undefined' && BUSH_CROPS.has(o.crop)
      && !(typeof isNestBush === 'function' && isNestBush(o.crop, o.id));
  }
  // Which foe this bush seats, or null (no roll under the world's share, or
  // ground no row lists). Pure in the bush's id and the ground's terrain.
  function bushAmbusherKind(id, terrain) {
    if (bushRoll(id) >= maxBushAmbushShare()) return null;
    const name = typeof terrain === 'string' ? terrain
      : Object.keys(root.WorldGen.T).find(key => root.WorldGen.T[key] === terrain);
    const rows = BUSH_AMBUSHERS[name];
    if (!rows?.length) return null;
    const total = rows.reduce((sum, row) => sum + row.weight, 0);
    let r = root.EnemySpawns.roll(id + '|ambush-kind') * total;
    for (const row of rows) if ((r -= row.weight) < 0) return row.kind;
    return rows[rows.length - 1].kind;
  }
  // Does this mode show the foe? Only a bush ambusher (`_bushAmbush`, its
  // bush's id) is ever hidden here.
  function bushAmbushVisible(creature, profile) {
    return !creature?._bushAmbush || bushRoll(creature._bushAmbush) < ambushShare(profile);
  }
  function bushes(scene, creatures, N, tx, ty, cellM, grid, opts, caughtSet, entry, authoredCreatures = []) {
    const tileM = scene.tileEdgeM, picks = [];
    for (const o of entry?.wildplants || []) {
      if (!isAmbushBush(o)) continue;
      const cx = Math.floor((o.x - tx * tileM) / cellM), cy = Math.floor((o.y - ty * tileM) / cellM);
      if (cx < 0 || cy < 0 || cx >= N || cy >= N) continue;
      const kind = bushAmbusherKind(o.id, grid[cy * N + cx]);
      if (kind) picks.push({ bush: o, kind, cell: cy * N + cx });
    }
    picks.sort((a, b) => (a.bush.id < b.bush.id ? -1 : a.bush.id > b.bush.id ? 1 : 0));
    if (!picks.length) { if (entry) entry.bushAmbushPopulation = { requested: 0, placed: 0 }; return []; }
    const result = run(scene, { entry, creatures, N, tx, ty, cellM, grid, opts, caughtSet, authoredCreatures }, {
      source: 'bush-ambush', owner: `bushes|${tx},${ty}`, count: picks.length,
      member: n => ({ kind: picks[n].kind, pick: picks[n], id: `bushfoe_${picks[n].bush.id}` }),
      // The bush's own cell first (a bush never blocks a body), then its ring:
      // a foe seated beside it walks in (lurkSpot) before it is ever drawn.
      *candidates(member) {
        const { cell } = member.pick, px = cell % N, py = Math.floor(cell / N);
        yield cell;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const x = px + dx, y = py + dy;
          if ((dx || dy) && x >= 0 && y >= 0 && x < N && y < N) yield y * N + x;
        }
      },
      point: (cell, member) => cell === member.pick.cell ? { x: member.pick.bush.x, y: member.pick.bush.y } : null,
      extra: (member, seat) => ({
        shiny: root.EnemySpawns.rollsElite(entry, member.kind, member.id, seat.x, seat.y, cellM),
        ambush: true, _bushAmbush: member.pick.bush.id, _sharedId: true,
        homeX: member.pick.bush.x, homeY: member.pick.bush.y,
        _surfaceSpawn: { tx, ty, cx: seat.cx, cy: seat.cy, x: seat.x, y: seat.y },
      }),
    });
    if (entry) entry.bushAmbushPopulation = { requested: result.requested, placed: result.placed };
    return result.creatures;
  }

  root.EnvironmentalPopulations = { run, shore, path, BUSH_AMBUSHERS, isAmbushBush, bushAmbusherKind, bushAmbushVisible, bushes };
})(globalThis);
