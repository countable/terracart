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

  // Runtime events resolve their world point back to the generated tile so
  // summons, raised ghosts and hooked slimes read the same gate as generation.
  function gateAt(scene, x, y, kind, overrides) {
    const edge = scene && (scene.tileEdgeM || scene.cellsPerTile * scene.cellM);
    if (!(edge > 0) || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    const tx = Math.floor(x / edge), ty = Math.floor(y / edge);
    const entry = root.WorldGen.tileCache.get(root.WorldGen.tileKey(tx, ty));
    if (!entry) return false;
    const measuredN = scene.cellM > 0 ? Math.round(edge / scene.cellM) : 0;
    const N = entry.cellsPerEdge || scene.cellsPerTile || measuredN || 1;
    const grid = entry.baseGrid || entry.grid;
    const cellM = edge / N;
    const cx = Math.floor((x - tx * edge) / cellM);
    const cy = Math.floor((y - ty * edge) / cellM);
    const opts = {
      ...(entry._spawnOpts || {}),
      ...(entry.roadMask ? { roadMask: entry.roadMask } : {}),
      ...(entry.roadClass ? { roadClass: entry.roadClass } : {}),
      ...(entry.spawnWhy ? { spawnWhy: entry.spawnWhy } : {}),
      ...(overrides || {}),
    };
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
      roadClass: one(opts.roadClass, Uint8Array),
      spawnWhy: one(opts.spawnWhy, Uint16Array),
      occupied,
    };
    return root.WorldGen.isSpawnCell(Uint8Array.of(cell.type), 1, 1, 0, 0,
      projected, creatureSpawnClass(kind));
  }

  // Count ranges use one draw and include both endpoints. Fixed counts consume
  // no draw, which preserves every downstream seeded decision.
  function frequencyCount(spec, rng) {
    const row = spec || {};
    if (row.count != null) {
      if (!Array.isArray(row.count)) return Math.max(0, Math.floor(Number(row.count) || 0));
      const lo = Math.max(0, Math.floor(Number(row.count[0]) || 0));
      const hi = Math.max(lo, Math.floor(Number(row.count[1]) || lo));
      if (hi === lo || typeof rng !== 'function') return lo;
      return lo + Math.min(hi - lo, Math.floor(Math.max(0, Math.min(.999999999999, rng())) * (hi - lo + 1)));
    }
    const roll = typeof rng === 'function' ? rng() : 0;
    if (row.trioAt != null && roll >= row.trioAt) return 3;
    if (row.pairAt != null && roll >= row.pairAt) return 2;
    return 1;
  }

  function pickWeighted(items, position, weightFor) {
    if (!items || !items.length) return null;
    const weight = typeof weightFor === 'function' ? weightFor : () => 1;
    const weights = items.map((item, i) => Math.max(0, Number(weight(item, i)) || 0));
    const total = weights.reduce((sum, n) => sum + n, 0);
    if (!(total > 0)) return items[0];
    let ticket = Math.max(0, Math.min(.999999999999, Number(position) || 0)) * total;
    for (let i = 0; i < items.length; i++) {
      ticket -= weights[i];
      if (ticket < 0) return items[i];
    }
    return items[items.length - 1];
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

  // Placement handlers may themselves be sliced generators. Delegating with
  // yield* preserves their budget checkpoints while this function returns the
  // successfully created records as one finite encounter.
  function* generateSteps(rule, context) {
    const ctx = context || {}, placed = [];
    const count = ctx.count == null ? frequencyCount(rule && rule.frequency, ctx.rng) : ctx.count;
    for (let n = 0; n < count; n++) {
      const memberResult = ctx.member ? ctx.member(n) : {};
      const member = isGenerator(memberResult) ? yield* memberResult : memberResult;
      if (!member) continue;
      const seatResult = ctx.seat ? ctx.seat(member, n) : null;
      const seat = isGenerator(seatResult) ? yield* seatResult : seatResult;
      if (!seat) continue;
      const createResult = ctx.create ? ctx.create(member, seat, n) : { ...member, ...seat };
      const record = isGenerator(createResult) ? yield* createResult : createResult;
      if (!record) continue;
      const placedResult = ctx.onPlaced && ctx.onPlaced(record, member, seat, n);
      if (isGenerator(placedResult)) yield* placedResult;
      placed.push(record);
    }
    return placed;
  }

  root.CreatureSpawns = {
    isSpawnCell, gateAt, frequencyCount, pickWeighted, expandMembers, generateSteps,
  };
})(globalThis);
